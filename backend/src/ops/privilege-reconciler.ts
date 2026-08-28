/**
 * Privilege reconciler (T-F1.2 — KORIXA_TF12_PRIVILEGE_MODEL_IMPLEMENTATION).
 *
 * Otorga al runtime role EXACTAMENTE el modelo mínimo probado en NONPROD
 * (MIN_PRIVILEGE_NONPROD_PROOF): SELECT/INSERT/UPDATE/DELETE sobre las
 * tablas existentes + USAGE/SELECT sobre las secuencias existentes, más
 * `ALTER DEFAULT PRIVILEGES` para que las tablas/secuencias que creen
 * migraciones FUTURAS hereden ese mismo acceso automáticamente — sin
 * ningún GRANT manual adicional por migración.
 *
 * Decisión de arquitectura deliberada (no una migración SQL 0008):
 *   - el runtime role es configuración por entorno (Dev/Staging/Prod
 *     usan nombres distintos) — jamás un literal hardcodeado acá;
 *   - CI hoy no tiene una identidad runtime separada de la de
 *     migración — este reconciliador debe poder ejecutarse igual con o
 *     sin esa separación, mientras el nombre llegue por configuración;
 *   - `ALTER DEFAULT PRIVILEGES` (sin `FOR ROLE`) debe ejecutarse COMO
 *     la identidad que será owner de los objetos futuros — eso solo
 *     puede saberlo quien invoca este script (la identidad de
 *     migración real), nunca este archivo por sí mismo.
 *
 * Jamás asume ni otorga SUPERUSER/CREATEDB/CREATEROLE/cloudsqlsuperuser,
 * ownership, CREATE en schema, ni ningún privilegio DDL al runtime role
 * — el único lado que recibe algo acá es el runtime, y lo que recibe es
 * exactamente la lista de 4 statements de `RECONCILIATION_STATEMENT_TEMPLATES`,
 * nunca más.
 *
 * `RUNTIME_DB_ROLE` es un IDENTIFICADOR SQL, no un valor — no existe
 * forma de parametrizarlo vía placeholder ($1) en un GRANT/ALTER DEFAULT
 * PRIVILEGES real. Por eso se valida contra un allowlist estricto
 * (`isValidRoleIdentifier`) ANTES de tocar la base, y se cita
 * (`quoteIdent`) como defensa adicional — nunca se concatena el valor
 * crudo de `process.env.RUNTIME_DB_ROLE` en SQL.
 *
 * Reachability: mismo contrato que `db-readonly-inspector.ts` —
 * `require.main === module` es la única puerta de entrada que toca una
 * base real; importar este módulo para sus funciones exportadas nunca
 * conecta a nada.
 */

import { Client } from 'pg';

// =============================================================================
// Contrato de entorno — únicas dos env vars leídas. Ninguna otra.
// =============================================================================

export interface ReconcilerEnv {
  DATABASE_URL: string;
  RUNTIME_DB_ROLE: string;
}

// =============================================================================
// Códigos de error saneados — igual disciplina que `InspectorError`:
// nunca se propaga el DSN, un password, ni el objeto crudo de `pg`.
// =============================================================================

export type ReconcilerErrorCode =
  | 'MISSING_DATABASE_URL'
  | 'MISSING_RUNTIME_DB_ROLE'
  | 'INVALID_RUNTIME_DB_ROLE_IDENTIFIER'
  | 'RUNTIME_EQUALS_MIGRATION_IDENTITY'
  | 'UNEXPECTED_MIGRATION_CONTEXT'
  | 'RUNTIME_ROLE_NOT_FOUND'
  | 'DB_CONNECTION_FAILED'
  | 'GRANT_STATEMENT_FAILED'
  | 'PARTIAL_GRANT_WARNING'
  | 'UNEXPECTED_RECONCILER_ERROR';

export class ReconcilerError extends Error {
  readonly code: ReconcilerErrorCode;
  /** Evidencia segura adicional — nunca password/DSN/stack de `pg`, y
   * nunca el valor crudo de un RUNTIME_DB_ROLE que falló su propia
   * validación (para no reflejar sin control un string adversarial). */
  readonly evidence?: Record<string, string | number | boolean>;

  constructor(code: ReconcilerErrorCode, message: string, evidence?: Record<string, string | number | boolean>) {
    super(message);
    this.name = 'ReconcilerError';
    this.code = code;
    this.evidence = evidence;
  }
}

// =============================================================================
// Validación/citado seguro del identificador de rol.
//
// Allowlist deliberadamente MÁS estricto que lo que PostgreSQL acepta
// para un identificador sin comillas (que también permite `$`) — no hay
// ningún nombre de rol legítimo en este proyecto que necesite `$`, así
// que se excluye para reducir superficie. Límite de 63 bytes = NAMEDATALEN
// (64) menos el terminador, el límite real de PostgreSQL para cualquier
// identificador.
// =============================================================================

const VALID_ROLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_BYTES = 63;

export function isValidRoleIdentifier(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) return false;
  return VALID_ROLE_IDENTIFIER.test(name);
}

/**
 * Devuelve el identificador citado y seguro de interpolar en DDL.
 * Lanza `ReconcilerError` si el nombre no pasa el allowlist — nunca
 * devuelve una mejor aproximación ni "sanitiza" silenciosamente un
 * nombre inválido. El mensaje de error reporta longitud, nunca el
 * valor crudo (defensa en profundidad: un string adversarial jamás se
 * refleja en logs/stdout/stderr).
 */
export function quoteIdent(name: unknown): string {
  if (!isValidRoleIdentifier(name)) {
    throw new ReconcilerError(
      'INVALID_RUNTIME_DB_ROLE_IDENTIFIER',
      'RUNTIME_DB_ROLE no es un identificador SQL seguro (debe empezar con letra/guion bajo y contener solo letras/dígitos/guion bajo, máx. 63 bytes). El valor recibido no se refleja en este mensaje.',
      { received_length: typeof name === 'string' ? name.length : -1 },
    );
  }
  // Defensa adicional aunque el allowlist ya excluye comillas: dobla
  // cualquier `"` embebida antes de envolver, igual que `quote_ident`.
  return `"${name.replace(/"/g, '""')}"`;
}

// =============================================================================
// Statements de reconciliación — exactamente estos 4, nunca más. Función
// pura y testeable sin tocar ninguna base real.
// =============================================================================

export function buildReconciliationStatements(quotedRuntimeRole: string): string[] {
  return [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRuntimeRole};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRuntimeRole};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntimeRole};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRuntimeRole};`,
  ];
}

// =============================================================================
// Validación del contexto de ejecución — fail-closed antes de cualquier
// GRANT. "Contexto de migración esperado" se define, sin hardcodear
// ningún nombre de rol, como: la identidad conectada tiene CREATE en el
// schema public (la propiedad que el ensayo NONPROD probó que define al
// migration role) y no es la misma identidad que el runtime role.
// =============================================================================

export interface MigrationContextFacts {
  currentUser: string;
  runtimeRole: string;
  canCreateInSchema: boolean;
}

export function assertMigrationContext(facts: MigrationContextFacts): void {
  if (facts.currentUser === facts.runtimeRole) {
    throw new ReconcilerError(
      'RUNTIME_EQUALS_MIGRATION_IDENTITY',
      'RUNTIME_DB_ROLE coincide con la identidad conectada (current_user) — el reconciliador nunca debe ejecutarse usando la misma identidad como runtime y como migración.',
    );
  }
  if (!facts.canCreateInSchema) {
    throw new ReconcilerError(
      'UNEXPECTED_MIGRATION_CONTEXT',
      'current_user no tiene CREATE en schema public — no corresponde al contexto de migración esperado. El reconciliador debe ejecutarse como la identidad de migración (la misma que corre 0001-0007), nunca como una identidad sin capacidad de creación en el schema.',
    );
  }
}

// =============================================================================
// Orquestación real — única función que toca una base. Solo se alcanza
// vía `require.main === module`.
// =============================================================================

function readRequiredEnv(): ReconcilerEnv {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new ReconcilerError('MISSING_DATABASE_URL', 'DATABASE_URL no está definida.');
  }
  const RUNTIME_DB_ROLE = process.env.RUNTIME_DB_ROLE;
  if (!RUNTIME_DB_ROLE) {
    throw new ReconcilerError(
      'MISSING_RUNTIME_DB_ROLE',
      'RUNTIME_DB_ROLE no está definida — es un parámetro de configuración explícito y obligatorio, nunca inferido ni hardcodeado en este archivo.',
    );
  }
  return { DATABASE_URL, RUNTIME_DB_ROLE };
}

/** Nunca propaga `error.stack`/el objeto crudo de `pg` (puede embeber el
 * DSN) — siempre un mensaje saneado, fijo. Mismo patrón que
 * `db-readonly-inspector.ts`. */
function sanitizeUnexpectedError(code: ReconcilerErrorCode, context: string): ReconcilerError {
  return new ReconcilerError(code, `${context} — nunca se propaga DSN, password ni el objeto crudo de \`pg\`.`);
}

export interface ReconciliationResult {
  runtime_role_identifier_valid: true;
  migration_context_valid: true;
  runtime_role_existed: true;
  statements_executed: number;
  outcome: 'RECONCILED';
}

export async function reconcilePrivileges(): Promise<ReconciliationResult> {
  const env = readRequiredEnv();

  // Se valida el identificador ANTES de conectar — falla cerrado sin
  // siquiera abrir una conexión si el nombre no es seguro de interpolar.
  const quotedRuntimeRole = quoteIdent(env.RUNTIME_DB_ROLE);

  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'korixa-privilege-reconciler',
  });

  // Hallazgo empírico del ensayo NONPROD: `GRANT ... ON ALL TABLES IN
  // SCHEMA public TO x` NO lanza un error de PostgreSQL cuando el rol
  // que ejecuta el GRANT no es owner de alguna tabla — emite un WARNING
  // ("no privileges were granted for <tabla>") y el statement se reporta
  // como exitoso igual. Bajo el invariante probado (la identidad de
  // migración es owner de TODOS los objetos de la aplicación) esto nunca
  // ocurre — pero si ese invariante llegara a romperse, un reconciliador
  // que solo mirara "¿el statement lanzó una excepción?" reportaría
  // `RECONCILED` habiendo otorgado privilegios reales sobre 0 de esas
  // tablas: un falso PASS. Por eso se capturan los NOTICE/WARNING del
  // servidor durante la transacción y CUALQUIER warning aborta con
  // ROLLBACK — nunca se asume éxito solo porque ningún statement lanzó.
  const capturedWarnings: string[] = [];
  client.on('notice', (notice: { message?: string }) => {
    capturedWarnings.push(notice.message ?? 'unknown notice');
  });

  let connected = false;
  let inTransaction = false;
  try {
    try {
      await client.connect();
      connected = true;
    } catch {
      throw sanitizeUnexpectedError('DB_CONNECTION_FAILED', 'No se pudo conectar a la base de datos');
    }

    const currentUserResult = await client.query('SELECT current_user AS current_user;');
    const currentUser = currentUserResult.rows[0]?.current_user as string;

    const canCreateResult = await client.query(`SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create;`);
    const canCreateInSchema = Boolean(canCreateResult.rows[0]?.can_create);

    assertMigrationContext({ currentUser, runtimeRole: env.RUNTIME_DB_ROLE, canCreateInSchema });

    const roleExistsResult = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1;', [env.RUNTIME_DB_ROLE]);
    if (roleExistsResult.rowCount === 0) {
      throw new ReconcilerError(
        'RUNTIME_ROLE_NOT_FOUND',
        'RUNTIME_DB_ROLE no existe como rol en la base de datos — el reconciliador nunca crea roles, solo otorga privilegios sobre uno ya existente.',
      );
    }

    const statements = buildReconciliationStatements(quotedRuntimeRole);

    await client.query('BEGIN;');
    inTransaction = true;
    for (const statement of statements) {
      await client.query(statement).catch(() => {
        throw sanitizeUnexpectedError(
          'GRANT_STATEMENT_FAILED',
          'Falló uno de los statements de GRANT/ALTER DEFAULT PRIVILEGES — se revierte la transacción completa (todo-o-nada, nunca aplicación parcial)',
        );
      });
    }

    // Ningún statement lanzó una excepción — pero eso NO basta para
    // declarar éxito (ver comentario junto al listener de 'notice' más
    // arriba). Si el servidor emitió algún WARNING durante la
    // transacción (p. ej. "no privileges were granted for X" por falta
    // de ownership real), se aborta con ROLLBACK en vez de reportar
    // `RECONCILED` sobre una reconciliación parcialmente vacía.
    if (capturedWarnings.length > 0) {
      throw new ReconcilerError(
        'PARTIAL_GRANT_WARNING',
        'El servidor emitió advertencias durante los statements de GRANT/ALTER DEFAULT PRIVILEGES (típicamente "no privileges were granted for <objeto>", indicando que la identidad de migración no es owner de algún objeto existente) — se revierte la transacción completa; nunca se declara RECONCILED sobre una reconciliación parcial.',
        { warnings_count: capturedWarnings.length },
      );
    }

    await client.query('COMMIT;');
    inTransaction = false;

    return {
      runtime_role_identifier_valid: true,
      migration_context_valid: true,
      runtime_role_existed: true,
      statements_executed: statements.length,
      outcome: 'RECONCILED',
    };
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK;').catch(() => {
        // ROLLBACK best-effort — el cliente se cierra de todas formas abajo.
      });
    }
    if (error instanceof ReconcilerError) throw error;
    throw sanitizeUnexpectedError('UNEXPECTED_RECONCILER_ERROR', 'Error inesperado durante la reconciliación de privilegios');
  } finally {
    if (connected) {
      await client.end().catch(() => {
        // Cierre best-effort.
      });
    }
  }
}

if (require.main === module) {
  reconcilePrivileges()
    .then((result) => {
      // Único punto de salida de evidencia — JSON estructurado, campos
      // aprobados únicamente. Nunca DATABASE_URL ni RUNTIME_DB_ROLE crudo.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      const safe =
        error instanceof ReconcilerError
          ? { error_code: error.code, message: error.message, evidence: error.evidence }
          : {
              error_code: 'UNEXPECTED_RECONCILER_ERROR' as ReconcilerErrorCode,
              message: 'Ocurrió un error inesperado durante la reconciliación, de un tipo no reconocido — nunca se serializa el error crudo, su mensaje ni su stack.',
              evidence: undefined,
            };
      process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
      process.exitCode = 1;
    });
}
