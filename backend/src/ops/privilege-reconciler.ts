/**
 * Privilege reconciler (T-F1.2 — KORIXA_TF12_PRIVILEGE_MODEL_REMEDIATION).
 *
 * Otorga al runtime role EXACTAMENTE el modelo de mínimo privilegio
 * declarado en `runtime-privilege-matrix.ts` — un GRANT nombrado por
 * tabla/verbo, nunca `ON ALL TABLES IN SCHEMA` ni `ALTER DEFAULT
 * PRIVILEGES`. Ver ese archivo para la matriz completa y su evidencia.
 *
 * =============================================================================
 * POR QUÉ NO "GRANT ALL ... ON ALL TABLES" + "REVOKE ... ON pgmigrations"
 * =============================================================================
 * La versión anterior de este archivo (PR #105) otorgaba
 * SELECT/INSERT/UPDATE/DELETE sobre TODAS las tablas del schema + un
 * `ALTER DEFAULT PRIVILEGES` que extendía automáticamente ese mismo CRUD
 * completo a CUALQUIER tabla futura creada por la identidad de
 * migración. Un parche que agregara un `REVOKE ... ON pgmigrations`
 * puntual sería estructuralmente inseguro por dos razones, no solo
 * estéticamente peor:
 *
 *   1. `pgmigrations` es creada por `node-pg-migrate` mismo (no por
 *      ninguna migración `.sql` de este repo) — desde la perspectiva del
 *      `ALTER DEFAULT PRIVILEGES` anterior, es una "tabla futura" como
 *      cualquier otra. Mientras exista CUALQUIER regla de privilegio por
 *      defecto que cubra "todas las tablas futuras", `pgmigrations`
 *      recibe CRUD completo automáticamente en el instante en que se
 *      crea — el propio hallazgo crítico que originó este bloque.
 *      Ningún `REVOKE` posterior punutal cierra esa ventana estructural;
 *      solo la evita un modelo que NUNCA otorga privilegio por defecto a
 *      tablas futuras (Estrategia A, ver abajo).
 *   2. Un GRANT amplio seguido de REVOKE selectivo depende del ORDEN de
 *      dos statements separados para ser seguro — un fallo/rerun parcial
 *      entre ambos deja una ventana real (por breve que sea) con
 *      `pgmigrations` de hecho otorgada. Un modelo deny-by-default +
 *      allowlist nunca la otorga en ningún punto de su ejecución,
 *      exitosa o no.
 *
 * =============================================================================
 * ESTRATEGIA DE DEFAULT PRIVILEGES: A — sin defaults generales
 * =============================================================================
 * Este archivo NO ejecuta `ALTER DEFAULT PRIVILEGES` en absoluto. Una
 * tabla nueva (creada por una migración futura) NUNCA recibe privilegio
 * runtime automáticamente — requiere una entrada nueva, explícita y
 * revisada en `RUNTIME_TABLE_PRIVILEGE_MATRIX` antes de que este
 * reconciliador pueda otorgar nada sobre ella. `future table !=
 * automatic broad runtime access` por construcción, no por disciplina
 * operativa.
 *
 * =============================================================================
 * Contrato de conexión (T-F1.2 — KORIXA_TF12_RECONCILER_CONTRACT_FIX)
 * =============================================================================
 * Proceso de CONTEXTO DE MIGRACIÓN — lee exclusivamente
 * `MIGRATION_DATABASE_URL` (nunca `DATABASE_URL`, variable exclusiva del
 * runtime — ver `backend/scripts/production-contract.js`). Aborta ANTES
 * de conectar si `DATABASE_URL` está presente en su propio
 * `process.env`, sin depender únicamente de que un runner externo haya
 * corrido `validateMigrationEnvironment()` antes de invocarlo.
 *
 * `RUNTIME_DB_ROLE` es configuración por entorno (Dev/Staging/Prod usan
 * nombres distintos) — jamás un literal hardcodeado acá. Es un
 * IDENTIFICADOR SQL, no un valor: se valida contra un allowlist estricto
 * (`isValidRoleIdentifier`) y se cita (`quoteIdent`) antes de
 * interpolarlo en cualquier DDL — nunca se concatena el valor crudo.
 *
 * `ALTER DEFAULT PRIVILEGES` no existe ya en este archivo, así que la
 * identidad de migración/ownership de objetos futuros deja de ser
 * relevante para este script — pero `assertMigrationContext` sigue
 * exigiendo que la identidad conectada tenga CREATE en schema public
 * (la propiedad que el ensayo NONPROD probó que define al migration
 * role) y no sea la misma que el runtime role, como defensa de
 * contexto general.
 *
 * Reachability: mismo contrato que `db-readonly-inspector.ts` —
 * `require.main === module` es la única puerta de entrada que toca una
 * base real; importar este módulo para sus funciones exportadas nunca
 * conecta a nada.
 */

import { Client } from 'pg';
import {
  RUNTIME_TABLE_PRIVILEGE_MATRIX,
  RUNTIME_SEQUENCE_PRIVILEGE_MATRIX,
  type TablePrivilegeVerb,
} from './runtime-privilege-matrix';

// =============================================================================
// Contrato de entorno — únicas dos env vars leídas. Ninguna otra.
// =============================================================================

export interface ReconcilerEnv {
  MIGRATION_DATABASE_URL: string;
  RUNTIME_DB_ROLE: string;
}

// =============================================================================
// Códigos de error saneados — igual disciplina que `InspectorError`:
// nunca se propaga el DSN, un password, ni el objeto crudo de `pg`.
// =============================================================================

export type ReconcilerErrorCode =
  | 'MISSING_MIGRATION_DATABASE_URL'
  | 'FORBIDDEN_DATABASE_URL_IN_MIGRATION_CONTEXT'
  | 'MISSING_RUNTIME_DB_ROLE'
  | 'INVALID_RUNTIME_DB_ROLE_IDENTIFIER'
  | 'RUNTIME_EQUALS_MIGRATION_IDENTITY'
  | 'UNEXPECTED_MIGRATION_CONTEXT'
  | 'RUNTIME_ROLE_NOT_FOUND'
  | 'EXPECTED_SCHEMA_OBJECT_MISSING'
  | 'PGMIGRATIONS_PRIVILEGE_DETECTED'
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

const VERB_SQL: Record<TablePrivilegeVerb, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

// =============================================================================
// Statements de reconciliación — un GRANT nombrado por tabla/secuencia,
// derivado exclusivamente de `RUNTIME_TABLE_PRIVILEGE_MATRIX`/
// `RUNTIME_SEQUENCE_PRIVILEGE_MATRIX`. Nunca `ON ALL TABLES IN SCHEMA`,
// nunca `ALTER DEFAULT PRIVILEGES`. Función pura y testeable sin tocar
// ninguna base real. `pgmigrations`/`pgmigrations_id_seq` no pueden
// aparecer acá — no existe ninguna entrada para ellos en ninguna matriz.
// =============================================================================

export function buildReconciliationStatements(quotedRuntimeRole: string): string[] {
  const statements: string[] = [];

  for (const [table, entry] of Object.entries(RUNTIME_TABLE_PRIVILEGE_MATRIX)) {
    const verbs = (['select', 'insert', 'update', 'delete'] as const).filter((verb) => entry[verb]).map((verb) => VERB_SQL[verb]);
    if (verbs.length === 0) continue;
    statements.push(`GRANT ${verbs.join(', ')} ON TABLE "${table}" TO ${quotedRuntimeRole};`);
  }

  for (const [sequence, entry] of Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)) {
    if (!entry.usage) continue;
    statements.push(`GRANT USAGE ON SEQUENCE "${sequence}" TO ${quotedRuntimeRole};`);
  }

  return statements;
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
// Verificación estructural del schema físico ANTES de otorgar nada — si
// alguna tabla/secuencia esperada por la matriz no existe todavía, el
// schema real no coincide con lo que este reconciliador asume y NO se
// intenta ningún GRANT (evita otorgar sobre un schema parcial/drift).
// =============================================================================

export interface SchemaPresenceFacts {
  actualTables: Set<string>;
  actualSequences: Set<string>;
}

export function findMissingExpectedSchemaObjects(facts: SchemaPresenceFacts): string[] {
  const missing: string[] = [];
  for (const table of Object.keys(RUNTIME_TABLE_PRIVILEGE_MATRIX)) {
    if (!facts.actualTables.has(table)) missing.push(`table:${table}`);
  }
  for (const [sequence, entry] of Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)) {
    if (entry.usage && !facts.actualSequences.has(sequence)) missing.push(`sequence:${sequence}`);
  }
  return missing;
}

// =============================================================================
// Orquestación real — única función que toca una base. Solo se alcanza
// vía `require.main === module`.
// =============================================================================

function readRequiredEnv(): ReconcilerEnv {
  // Defensa local, redundante a propósito (ver comentario de contrato en
  // el header del archivo): abortar ANTES de leer/usar cualquier otra
  // cosa si el proceso trae una `DATABASE_URL` — la variable exclusiva
  // del runtime nunca debe coexistir con un contexto de migración, sin
  // importar su valor. Nunca se imprime su contenido.
  if (process.env.DATABASE_URL !== undefined) {
    throw new ReconcilerError(
      'FORBIDDEN_DATABASE_URL_IN_MIGRATION_CONTEXT',
      'DATABASE_URL está presente en el proceso del reconciliador — un contexto de migración nunca debe recibir la variable exclusiva del runtime, sin importar su valor. Abortando antes de conectar.',
    );
  }

  const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  if (!MIGRATION_DATABASE_URL) {
    throw new ReconcilerError('MISSING_MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL no está definida.');
  }
  const RUNTIME_DB_ROLE = process.env.RUNTIME_DB_ROLE;
  if (!RUNTIME_DB_ROLE) {
    throw new ReconcilerError(
      'MISSING_RUNTIME_DB_ROLE',
      'RUNTIME_DB_ROLE no está definida — es un parámetro de configuración explícito y obligatorio, nunca inferido ni hardcodeado en este archivo.',
    );
  }
  return { MIGRATION_DATABASE_URL, RUNTIME_DB_ROLE };
}

/** Nunca propaga `error.stack`/el objeto crudo de `pg` (puede embeber el
 * DSN) — siempre un mensaje saneado, fijo. Mismo patrón que
 * `db-readonly-inspector.ts`. */
function sanitizeUnexpectedError(code: ReconcilerErrorCode, context: string): ReconcilerError {
  return new ReconcilerError(code, `${context} — nunca se propaga DSN, password ni el objeto crudo de \`pg\`.`);
}

const PGMIGRATIONS_PRIVILEGE_CHECK = `
  SELECT
    has_table_privilege($1, 'public.pgmigrations', 'SELECT')     AS can_select,
    has_table_privilege($1, 'public.pgmigrations', 'INSERT')     AS can_insert,
    has_table_privilege($1, 'public.pgmigrations', 'UPDATE')     AS can_update,
    has_table_privilege($1, 'public.pgmigrations', 'DELETE')     AS can_delete,
    has_table_privilege($1, 'public.pgmigrations', 'TRUNCATE')   AS can_truncate,
    has_table_privilege($1, 'public.pgmigrations', 'TRIGGER')    AS can_trigger,
    has_table_privilege($1, 'public.pgmigrations', 'REFERENCES') AS can_references;
`;

async function assertRuntimeHasNoPgmigrationsPrivilege(client: Client, runtimeRole: string): Promise<void> {
  const existsResult = await client.query(`SELECT to_regclass('public.pgmigrations') IS NOT NULL AS exists;`);
  if (!existsResult.rows[0]?.exists) return; // nada que verificar todavía — pgmigrations no existe.

  const result = await client.query(PGMIGRATIONS_PRIVILEGE_CHECK, [runtimeRole]);
  const row = result.rows[0] as Record<string, boolean> | undefined;
  const found = row
    ? (['can_select', 'can_insert', 'can_update', 'can_delete', 'can_truncate', 'can_trigger', 'can_references'] as const).filter(
        (key) => row[key],
      )
    : [];
  if (found.length > 0) {
    throw new ReconcilerError(
      'PGMIGRATIONS_PRIVILEGE_DETECTED',
      'El runtime role ya tiene al menos un privilegio sobre public.pgmigrations (tabla de tracking de node-pg-migrate) — el reconciliador nunca otorga nada sobre esta tabla y se niega a proceder mientras exista cualquier privilegio previo, sin importar su origen.',
      { detected_privileges: found.join(',') },
    );
  }
}

export interface ReconciliationResult {
  runtime_role_identifier_valid: true;
  migration_context_valid: true;
  runtime_role_existed: true;
  expected_schema_objects_present: true;
  pgmigrations_privilege_absent_before: true;
  statements_executed: number;
  outcome: 'RECONCILED';
}

export async function reconcilePrivileges(): Promise<ReconciliationResult> {
  const env = readRequiredEnv();

  // Se valida el identificador ANTES de conectar — falla cerrado sin
  // siquiera abrir una conexión si el nombre no es seguro de interpolar.
  const quotedRuntimeRole = quoteIdent(env.RUNTIME_DB_ROLE);

  const client = new Client({
    connectionString: env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'korixa-privilege-reconciler',
  });

  // Hallazgo empírico del ensayo NONPROD: `GRANT ... ON ALL TABLES IN
  // SCHEMA public TO x` (la forma multi-objeto) puede reportarse exitosa
  // aun cuando el rol que ejecuta el GRANT no es owner de alguna tabla —
  // emite un WARNING ("no privileges were granted for <tabla>") en vez
  // de un error. Este archivo ya no usa esa forma multi-objeto (cada
  // GRANT es sobre una tabla nombrada), pero el listener se conserva
  // como defensa en profundidad: cualquier NOTICE/WARNING inesperado
  // durante la transacción aborta con ROLLBACK — nunca se asume éxito
  // solo porque ningún statement individual lanzó una excepción.
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

    const tablesResult = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`);
    const actualTables = new Set((tablesResult.rows as { tablename: string }[]).map((r) => r.tablename));
    const sequencesResult = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S';`,
    );
    const actualSequences = new Set((sequencesResult.rows as { relname: string }[]).map((r) => r.relname));

    const missing = findMissingExpectedSchemaObjects({ actualTables, actualSequences });
    if (missing.length > 0) {
      throw new ReconcilerError(
        'EXPECTED_SCHEMA_OBJECT_MISSING',
        'Al menos un objeto que RUNTIME_TABLE_PRIVILEGE_MATRIX/RUNTIME_SEQUENCE_PRIVILEGE_MATRIX espera no existe físicamente todavía — el schema real no coincide con lo que este reconciliador asume; no se intenta ningún GRANT sobre un schema parcial/con drift.',
        { missing_count: missing.length, missing: missing.join(',') },
      );
    }

    // Verificación PREVIA (antes de otorgar nada): si el runtime role ya
    // tiene cualquier privilegio sobre pgmigrations por cualquier motivo
    // ajeno a este reconciliador (nunca lo otorga él mismo), se niega a
    // proceder — ver `PGMIGRATIONS_PRIVILEGE_DETECTED`.
    await assertRuntimeHasNoPgmigrationsPrivilege(client, env.RUNTIME_DB_ROLE);

    const statements = buildReconciliationStatements(quotedRuntimeRole);

    await client.query('BEGIN;');
    inTransaction = true;
    for (const statement of statements) {
      await client.query(statement).catch(() => {
        throw sanitizeUnexpectedError(
          'GRANT_STATEMENT_FAILED',
          'Falló uno de los statements de GRANT — se revierte la transacción completa (todo-o-nada, nunca aplicación parcial)',
        );
      });
    }

    // Ningún statement lanzó una excepción — pero eso NO basta para
    // declarar éxito (ver comentario junto al listener de 'notice' más
    // arriba). Si el servidor emitió algún WARNING durante la
    // transacción, se aborta con ROLLBACK en vez de reportar
    // `RECONCILED` sobre una reconciliación parcialmente vacía.
    if (capturedWarnings.length > 0) {
      throw new ReconcilerError(
        'PARTIAL_GRANT_WARNING',
        'El servidor emitió advertencias durante los statements de GRANT (típicamente indicando que la identidad de migración no es owner de algún objeto existente) — se revierte la transacción completa; nunca se declara RECONCILED sobre una reconciliación parcial.',
        { warnings_count: capturedWarnings.length },
      );
    }

    // Verificación POSTERIOR, todavía dentro de la misma transacción: los
    // GRANT que se acaban de ejecutar están scopeados exclusivamente a
    // la matriz (pgmigrations no aparece en ninguna), así que esta
    // segunda comprobación debería ser idéntica a la previa — se repite
    // de todas formas como cierre del invariante, nunca asumido.
    await assertRuntimeHasNoPgmigrationsPrivilege(client, env.RUNTIME_DB_ROLE);

    await client.query('COMMIT;');
    inTransaction = false;

    return {
      runtime_role_identifier_valid: true,
      migration_context_valid: true,
      runtime_role_existed: true,
      expected_schema_objects_present: true,
      pgmigrations_privilege_absent_before: true,
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
      // aprobados únicamente. Nunca MIGRATION_DATABASE_URL ni RUNTIME_DB_ROLE crudo.
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
