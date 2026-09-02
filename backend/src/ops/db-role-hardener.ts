/**
 * Production DB role hardener (T-F1.2 — KORIXA_TF12_POINT8B_ROLE_HARDENER).
 *
 * =============================================================================
 * QUÉ ES Y QUÉ NO ES
 * =============================================================================
 * Este archivo hace EXACTAMENTE una cosa: llevar a `korixa_app` (TARGET_ROLE,
 * hardcodeado, nunca configurable) de su estado actual conocido en Production
 * (CREATEDB/CREATEROLE inesperados, ver `PROJECT_STATUS_POST95.md` §5 y la
 * inspección real de Point 7) a un estado de mínimo privilegio para una
 * identidad de migración: sin CREATEDB/CREATEROLE, con exactamente CONNECT
 * en la base + USAGE/CREATE en el schema `public` — ver `APPLY_MUTATION_STATEMENTS`
 * más abajo para el SQL literal, fijo, sin interpolación de ningún tipo.
 *
 * NO es un ejecutor SQL genérico, NO es un migrador, NO es el reconciliador de
 * privilegios de runtime (`privilege-reconciler.ts`), y NO toca membresía de
 * `cloudsqlsuperuser` — ver la sección "LÍMITE cloudsqlsuperuser" más abajo.
 *
 * =============================================================================
 * POR QUÉ NO SE REUTILIZA `privilege-reconciler.ts`
 * =============================================================================
 * Ese reconciliador exige que los objetos físicos que su matriz espera ya
 * existan (`findMissingExpectedSchemaObjects` aborta si no) — por diseño,
 * asume que las migraciones YA corrieron. Production tiene 0/7 migraciones
 * aplicadas y `pgmigrations` ni siquiera existe todavía (evidencia real,
 * Point 7). Invocar el reconciliador contra ese estado no tiene sentido —
 * la reconciliación de privilegios de RUNTIME es un paso que ocurre DESPUÉS
 * de migrar, nunca antes. Este archivo es un componente completamente
 * independiente, con su propio contrato de entorno, sus propios códigos de
 * error, y su propia conexión — cero imports de `privilege-reconciler.ts`.
 *
 * =============================================================================
 * LÍMITE cloudsqlsuperuser (sección E de la misión)
 * =============================================================================
 * Este archivo NUNCA ejecuta `REVOKE cloudsqlsuperuser`, `GRANT
 * cloudsqlsuperuser`, `CREATE ROLE`, ni `DROP ROLE` — no existe NINGÚN string
 * SQL en todo este archivo que contenga esas palabras fuera de comentarios/
 * mensajes de error. La remoción de la membresía Cloud SQL de `korixa_app`
 * en `cloudsqlsuperuser` es una operación GCP separada
 * (`gcloud sql users assign-roles ...`), ejecutada DESPUÉS de que el
 * endurecimiento SQL de este archivo tenga éxito, bajo su propio Human Gate
 * explícito — nunca automatizada acá.
 *
 * =============================================================================
 * Contrato de entorno
 * =============================================================================
 * REQUERIDAS: `MIGRATION_DATABASE_URL`, `HARDENER_MODE` (`preflight` |
 * `apply` | `verify`, sin ningún otro valor aceptado), `EXPECTED_ADMIN_DB_USER`,
 * `EXPECTED_DATABASE`, `EXPECTED_DB_HOST`, `EXPECTED_SOURCE_SHA`.
 * SOLO EN `apply`: `HARDEN_CONFIRMATION`, que debe ser exactamente
 * `APPLY_CONFIRMATION_TOKEN` — nunca inferido, nunca con valor por defecto.
 * PROHIBIDA: `DATABASE_URL` — su sola presencia aborta antes de leer
 * cualquier otra cosa, igual disciplina que `privilege-reconciler.ts`.
 *
 * `EXPECTED_ADMIN_DB_USER` en `preflight` puede ser el sentinel
 * `PREFLIGHT_ADMIN_SENTINEL` (`'UNPROVEN_PREFLIGHT_ONLY'`) — `runPreflight`
 * descubre la identidad real por sí mismo y nunca la usa como condición de
 * autorización. Ese sentinel es EXPLÍCITAMENTE rechazado si `HARDENER_MODE`
 * es `apply` (`readRequiredEnv` lanza `APPLY_SENTINEL_REJECTED`) — `apply`
 * exige la identidad exacta que `preflight` ya probó, nunca el placeholder.
 *
 * `TARGET_ROLE`, `RUNTIME_ROLE`, `TARGET_SCHEMA` y `TARGET_DATABASE` son
 * constantes hardcodeadas — ningún identificador SQL de este archivo se
 * deriva jamás de una variable de entorno o de un argumento. `EXPECTED_*`
 * son EXPECTATIVAS operativas que se validan contra la realidad (DSN
 * parseado, `current_database()`), nunca valores que este archivo use para
 * construir SQL.
 *
 * =============================================================================
 * Reachability — mismo contrato que `db-readonly-inspector.ts`/
 * `privilege-reconciler.ts`: `require.main === module` es la única puerta de
 * entrada que toca una base real. Importar este módulo para sus funciones
 * exportadas NUNCA conecta a nada.
 * =============================================================================
 */

import { Client } from 'pg';

// =============================================================================
// Identificadores fijos — nunca configurables, nunca leídos de env/args.
// =============================================================================

export const TARGET_ROLE = 'korixa_app' as const;
export const RUNTIME_ROLE = 'korixa_runtime' as const;
export const TARGET_SCHEMA = 'public' as const;
export const TARGET_DATABASE = 'korixa_production' as const;
export const APPLY_CONFIRMATION_TOKEN = 'HARDEN_KORIXA_APP_PRODUCTION' as const;

export type HardenerMode = 'preflight' | 'apply' | 'verify';
const VALID_MODES: readonly HardenerMode[] = ['preflight', 'apply', 'verify'];

// =============================================================================
// SQL de mutación — EXACTAMENTE los 3 statements autorizados por la misión,
// literales fijos sin interpolación de ningún tipo. `apply` nunca ejecuta
// ningún otro statement de escritura.
// =============================================================================

export const APPLY_MUTATION_STATEMENTS = [
  'ALTER ROLE korixa_app NOCREATEDB NOCREATEROLE;',
  'GRANT CONNECT ON DATABASE korixa_production TO korixa_app;',
  'GRANT USAGE, CREATE ON SCHEMA public TO korixa_app;',
] as const;

/**
 * Sentinel documentado para `EXPECTED_ADMIN_DB_USER` en `preflight` —
 * `runPreflight` descubre `current_user` por sí mismo y NUNCA lo usa como
 * condición de autorización (solo `runApply` lo hace, vía
 * `assertExpectedAdminIdentity`). Este valor existe para que un operador
 * pueda ejecutar `preflight` sin conocer todavía la identidad administradora
 * real — es exactamente lo que `preflight` sirve para descubrir y probar.
 * NUNCA es válido para `apply`: `readRequiredEnv` lo rechaza explícitamente
 * (defensa en profundidad además del guard del workflow) para que la
 * identidad probada por `preflight` deba trasladarse verbatim a `apply`,
 * nunca este placeholder.
 */
export const PREFLIGHT_ADMIN_SENTINEL = 'UNPROVEN_PREFLIGHT_ONLY' as const;

// =============================================================================
// Contrato de entorno
// =============================================================================

export interface HardenerEnv {
  MIGRATION_DATABASE_URL: string;
  HARDENER_MODE: HardenerMode;
  EXPECTED_ADMIN_DB_USER: string;
  EXPECTED_DATABASE: string;
  EXPECTED_DB_HOST: string;
  EXPECTED_SOURCE_SHA: string;
  /** Solo requerida/leída cuando `HARDENER_MODE === 'apply'`. */
  HARDEN_CONFIRMATION?: string;
}

// =============================================================================
// Códigos de error saneados — misma disciplina que `ReconcilerError`/
// `InspectorError`: nunca se propaga el DSN, un password, ni el objeto
// crudo de `pg`.
// =============================================================================

export type HardenerErrorCode =
  | 'FORBIDDEN_DATABASE_URL_IN_HARDENER_CONTEXT'
  | 'MISSING_MIGRATION_DATABASE_URL'
  | 'MISSING_HARDENER_MODE'
  | 'INVALID_HARDENER_MODE'
  | 'MISSING_EXPECTED_ADMIN_DB_USER'
  | 'APPLY_SENTINEL_REJECTED'
  | 'MISSING_EXPECTED_DATABASE'
  | 'UNEXPECTED_TARGET_DATABASE_CONFIGURED'
  | 'MISSING_EXPECTED_DB_HOST'
  | 'MISSING_EXPECTED_SOURCE_SHA'
  | 'INVALID_MIGRATION_DATABASE_URL'
  | 'DATABASE_HOST_MISMATCH'
  | 'DATABASE_NAME_MISMATCH'
  | 'DB_CONNECTION_FAILED'
  | 'CONNECTED_IDENTITY_MISMATCH'
  | 'RUNTIME_IDENTITY_REJECTED'
  | 'TARGET_ROLE_IDENTITY_REJECTED'
  | 'UNEXPECTED_ADMIN_IDENTITY'
  | 'TARGET_ROLE_NOT_FOUND'
  | 'RUNTIME_ROLE_NOT_FOUND'
  | 'HOLD_ADMIN_CAPABILITY'
  | 'ACTIVE_SESSION_USING_TARGET_ROLE'
  | 'PGMIGRATIONS_ALREADY_EXISTS'
  | 'MISSING_APPLY_CONFIRMATION'
  | 'INVALID_APPLY_CONFIRMATION'
  | 'ALTER_ROLE_FAILED'
  | 'GRANT_CONNECT_FAILED'
  | 'GRANT_SCHEMA_FAILED'
  | 'HOLD_POST_STATE_MISMATCH'
  | 'RUNTIME_DRIFT_DURING_TRANSACTION'
  | 'UNEXPECTED_HARDENER_ERROR';

export class HardenerError extends Error {
  readonly code: HardenerErrorCode;
  /** Evidencia segura adicional — nunca password/DSN/stack de `pg`. */
  readonly evidence?: Record<string, string | number | boolean>;

  constructor(code: HardenerErrorCode, message: string, evidence?: Record<string, string | number | boolean>) {
    super(message);
    this.name = 'HardenerError';
    this.code = code;
    this.evidence = evidence;
  }
}

function sanitizeUnexpectedError(
  code: HardenerErrorCode,
  context: string,
  evidence?: Record<string, string | number | boolean>,
): HardenerError {
  return new HardenerError(code, `${context} — nunca se propaga DSN, password ni el objeto crudo de \`pg\`.`, evidence);
}

// =============================================================================
// Clasificación segura de fallos de conexión — inspecciona ÚNICAMENTE
// `error.code` (nunca `.message`, `.stack`, ni el objeto crudo) contra un
// allowlist fijo de SQLSTATE de PostgreSQL y códigos de error de Node. Un
// código ausente, no textual, o no reconocido siempre cae en
// `CONNECT_OTHER` — el código crudo nunca se devuelve ni se adjunta a la
// evidencia, así que un valor inventado/hostil nunca puede colarse.
// =============================================================================

export type SafeConnectionFailureClass =
  | 'AUTH_INVALID_PASSWORD'
  | 'AUTH_REJECTED'
  | 'DATABASE_NOT_FOUND'
  | 'NETWORK_CONNECTION_REFUSED'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_HOST_UNREACHABLE'
  | 'NETWORK_UNREACHABLE'
  | 'NETWORK_DNS_FAILURE'
  | 'NETWORK_CONNECTION_RESET'
  | 'TLS_CERTIFICATE_FAILURE'
  | 'SERVER_TOO_MANY_CONNECTIONS'
  | 'SERVER_NOT_ACCEPTING_CONNECTIONS'
  | 'CONNECT_OTHER';

/** SQLSTATE de PostgreSQL — https://www.postgresql.org/docs/current/errcodes-appendix.html */
const SQLSTATE_TO_SAFE_CLASS = new Map<string, SafeConnectionFailureClass>([
  ['28P01', 'AUTH_INVALID_PASSWORD'],
  ['28000', 'AUTH_REJECTED'],
  ['3D000', 'DATABASE_NOT_FOUND'],
  ['53300', 'SERVER_TOO_MANY_CONNECTIONS'],
  ['57P03', 'SERVER_NOT_ACCEPTING_CONNECTIONS'],
]);

const NODE_ERROR_CODE_TO_SAFE_CLASS = new Map<string, SafeConnectionFailureClass>([
  ['ECONNREFUSED', 'NETWORK_CONNECTION_REFUSED'],
  ['ETIMEDOUT', 'NETWORK_TIMEOUT'],
  ['EHOSTUNREACH', 'NETWORK_HOST_UNREACHABLE'],
  ['ENETUNREACH', 'NETWORK_UNREACHABLE'],
  ['ENOTFOUND', 'NETWORK_DNS_FAILURE'],
  ['ECONNRESET', 'NETWORK_CONNECTION_RESET'],
]);

/** Solo códigos TLS/certificado de Node conocidos como no sensibles — nunca
 * incluyen host/DSN/nombre de archivo. */
const TLS_CODE_ALLOWLIST = new Set<string>([
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
]);

export function classifySafeConnectionFailure(error: unknown): SafeConnectionFailureClass {
  if (typeof error !== 'object' || error === null) return 'CONNECT_OTHER';

  // La lectura de `.code` se aísla en su propio try/catch: un objeto hostil
  // puede definir `code` como un getter que lanza (o que hace cualquier otra
  // cosa arbitraria) — eso nunca debe tumbar la clasificación completa ni
  // degradar DB_CONNECTION_FAILED a UNEXPECTED_HARDENER_ERROR más arriba.
  // Cualquier fallo acá, de cualquier tipo, cae directo en CONNECT_OTHER; el
  // valor lanzado (que podría contener cualquier cosa) nunca se lee ni se
  // propaga.
  let code: unknown;
  try {
    code = (error as { code?: unknown }).code;
  } catch {
    return 'CONNECT_OTHER';
  }

  if (typeof code !== 'string') return 'CONNECT_OTHER';
  return SQLSTATE_TO_SAFE_CLASS.get(code) ?? NODE_ERROR_CODE_TO_SAFE_CLASS.get(code) ?? (TLS_CODE_ALLOWLIST.has(code) ? 'TLS_CERTIFICATE_FAILURE' : 'CONNECT_OTHER');
}

// =============================================================================
// Lectura/validación de entorno — pura, sin conectar. `DATABASE_URL` se
// verifica PRIMERO, antes de leer cualquier otra cosa (mismo orden que
// `privilege-reconciler.ts`).
// =============================================================================

export function readRequiredEnv(env: NodeJS.ProcessEnv = process.env): HardenerEnv {
  if (env.DATABASE_URL !== undefined) {
    throw new HardenerError(
      'FORBIDDEN_DATABASE_URL_IN_HARDENER_CONTEXT',
      'DATABASE_URL está presente en el proceso del hardener — un contexto de endurecimiento de la identidad de migración nunca debe recibir la variable exclusiva del runtime, sin importar su valor. Abortando antes de conectar.',
    );
  }

  const MIGRATION_DATABASE_URL = env.MIGRATION_DATABASE_URL;
  if (!MIGRATION_DATABASE_URL) {
    throw new HardenerError('MISSING_MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL no está definida.');
  }

  const rawMode = env.HARDENER_MODE;
  if (!rawMode) {
    throw new HardenerError('MISSING_HARDENER_MODE', 'HARDENER_MODE no está definida.');
  }
  if (!VALID_MODES.includes(rawMode as HardenerMode)) {
    throw new HardenerError(
      'INVALID_HARDENER_MODE',
      `HARDENER_MODE debe ser exactamente uno de: ${VALID_MODES.join(', ')}. Ningún otro valor es aceptado.`,
      { received_length: rawMode.length },
    );
  }
  const HARDENER_MODE = rawMode as HardenerMode;

  const EXPECTED_ADMIN_DB_USER = env.EXPECTED_ADMIN_DB_USER;
  if (!EXPECTED_ADMIN_DB_USER) {
    throw new HardenerError(
      'MISSING_EXPECTED_ADMIN_DB_USER',
      'EXPECTED_ADMIN_DB_USER no está definida — nunca se infiere la identidad administradora esperada.',
    );
  }
  if (HARDENER_MODE === 'apply' && EXPECTED_ADMIN_DB_USER === PREFLIGHT_ADMIN_SENTINEL) {
    throw new HardenerError(
      'APPLY_SENTINEL_REJECTED',
      `EXPECTED_ADMIN_DB_USER no puede ser el sentinel '${PREFLIGHT_ADMIN_SENTINEL}' cuando HARDENER_MODE='apply' — ese valor solo es válido para preflight (que descubre la identidad real por sí mismo); apply exige la identidad EXACTA que preflight ya probó.`,
    );
  }

  const EXPECTED_DATABASE = env.EXPECTED_DATABASE;
  if (!EXPECTED_DATABASE) {
    throw new HardenerError('MISSING_EXPECTED_DATABASE', 'EXPECTED_DATABASE no está definida.');
  }
  if (EXPECTED_DATABASE !== TARGET_DATABASE) {
    throw new HardenerError(
      'UNEXPECTED_TARGET_DATABASE_CONFIGURED',
      `EXPECTED_DATABASE debe ser exactamente '${TARGET_DATABASE}' (la única base que este hardener endurece) — valor recibido no coincide.`,
      { expected: TARGET_DATABASE },
    );
  }

  const EXPECTED_DB_HOST = env.EXPECTED_DB_HOST;
  if (!EXPECTED_DB_HOST) {
    throw new HardenerError('MISSING_EXPECTED_DB_HOST', 'EXPECTED_DB_HOST no está definida.');
  }

  const EXPECTED_SOURCE_SHA = env.EXPECTED_SOURCE_SHA;
  if (!EXPECTED_SOURCE_SHA) {
    throw new HardenerError('MISSING_EXPECTED_SOURCE_SHA', 'EXPECTED_SOURCE_SHA no está definida.');
  }

  return {
    MIGRATION_DATABASE_URL,
    HARDENER_MODE,
    EXPECTED_ADMIN_DB_USER,
    EXPECTED_DATABASE,
    EXPECTED_DB_HOST,
    EXPECTED_SOURCE_SHA,
    HARDEN_CONFIRMATION: env.HARDEN_CONFIRMATION,
  };
}

// =============================================================================
// Parseo del DSN sin loguear ningún fragmento del string original — mismo
// patrón que `db-readonly-inspector.ts`, deliberadamente autocontenido
// (sin import cruzado) para mantener este archivo mínimo y auditable.
// =============================================================================

interface ParsedConnection {
  host: string;
  database: string;
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export function parseConnectionString(databaseUrl: string): ParsedConnection {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new HardenerError('INVALID_MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL no es una URL válida.');
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new HardenerError('INVALID_MIGRATION_DATABASE_URL', `Protocolo no reconocido como PostgreSQL: '${parsed.protocol}'`);
  }
  if (!parsed.hostname) {
    throw new HardenerError('INVALID_MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL no tiene host.');
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) {
    throw new HardenerError('INVALID_MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL no tiene un nombre de base de datos.');
  }
  return { host: parsed.hostname, database };
}

export function assertExpectedTarget(parsed: ParsedConnection, expectedHost: string, expectedDatabase: string): void {
  if (parsed.host !== expectedHost) {
    throw new HardenerError('DATABASE_HOST_MISMATCH', 'El host de MIGRATION_DATABASE_URL no coincide con EXPECTED_DB_HOST.', {
      expected_host: expectedHost,
    });
  }
  if (parsed.database !== expectedDatabase) {
    throw new HardenerError(
      'DATABASE_NAME_MISMATCH',
      'El nombre de base de MIGRATION_DATABASE_URL no coincide con EXPECTED_DATABASE.',
      { expected_database: expectedDatabase },
    );
  }
}

// =============================================================================
// Identidad conectada — reglas compartidas por los 3 modos.
// =============================================================================

export interface ConnectedIdentity {
  currentUser: string;
  sessionUser: string;
}

export function assertSafeConnectedIdentity(identity: ConnectedIdentity): void {
  if (identity.currentUser !== identity.sessionUser) {
    throw new HardenerError(
      'CONNECTED_IDENTITY_MISMATCH',
      'current_user y session_user difieren — el hardener nunca opera bajo una identidad con SET ROLE/SET SESSION AUTHORIZATION activo.',
    );
  }
  if (identity.currentUser === RUNTIME_ROLE) {
    throw new HardenerError(
      'RUNTIME_IDENTITY_REJECTED',
      `La identidad conectada es '${RUNTIME_ROLE}' — el hardener nunca debe ejecutarse usando la identidad de runtime.`,
    );
  }
  if (identity.currentUser === TARGET_ROLE) {
    throw new HardenerError(
      'TARGET_ROLE_IDENTITY_REJECTED',
      `La identidad conectada es '${TARGET_ROLE}' — el rol objetivo nunca puede auto-endurecerse; se requiere una identidad administradora separada.`,
    );
  }
}

export function assertExpectedAdminIdentity(currentUser: string, expectedAdminDbUser: string): void {
  if (currentUser !== expectedAdminDbUser) {
    throw new HardenerError(
      'UNEXPECTED_ADMIN_IDENTITY',
      'current_user no coincide con EXPECTED_ADMIN_DB_USER — nunca se infiere la identidad administradora esperada; apply exige una coincidencia exacta.',
    );
  }
}

// =============================================================================
// Capacidad administrativa — semántica de PostgreSQL 16: un rol NO
// superusuario con CREATEROLE únicamente puede administrar otro rol NO
// superusuario si además tiene ADMIN OPTION sobre ese rol específico. Nunca
// se infiere capacidad solo porque CREATEROLE=true.
// =============================================================================

export interface RoleStateSnapshot {
  rolname: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}

export type AdminCapability = 'SUPERUSER' | 'CREATEROLE_WITH_ADMIN_OPTION_ON_TARGET' | 'INSUFFICIENT';

export function classifyAdminCapability(adminRow: RoleStateSnapshot, adminOptionOnTarget: boolean): AdminCapability {
  if (adminRow.rolsuper) return 'SUPERUSER';
  if (adminRow.rolcreaterole && adminOptionOnTarget) return 'CREATEROLE_WITH_ADMIN_OPTION_ON_TARGET';
  return 'INSUFFICIENT';
}

// =============================================================================
// Consultas fijas — toda ejecución real usa exactamente uno de estos
// strings; ningún identificador se interpola desde env/args.
// =============================================================================

const QUERY_IDENTITY = `SELECT current_user AS current_user, session_user AS session_user, current_database() AS database;`;

const QUERY_ROLE_STATE = `
  SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
  FROM pg_roles WHERE rolname = $1;
`;

const QUERY_ADMIN_OPTION_ON_TARGET = `
  SELECT am.admin_option
  FROM pg_auth_members am
  JOIN pg_roles m ON m.oid = am.member
  JOIN pg_roles r ON r.oid = am.roleid
  WHERE m.rolname = $1 AND r.rolname = $2;
`;

const QUERY_ACTIVE_SESSION = `SELECT count(*)::int AS active_count FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid();`;

const QUERY_PGMIGRATIONS_EXISTS = `SELECT to_regclass('public.pgmigrations') IS NOT NULL AS pgmigrations_exists;`;

const QUERY_TARGET_PRIVILEGES = `
  SELECT
    has_database_privilege($1, $2, 'CONNECT') AS connect,
    has_schema_privilege($1, $3, 'USAGE')     AS schema_usage,
    has_schema_privilege($1, $3, 'CREATE')    AS schema_create;
`;

/** Cierre transitivo de membresía en un rol dado — mismo algoritmo que
 * `TRANSITIVE_ROLE_MEMBERSHIP_CTE` de `runtime-privilege-audit.ts`,
 * reimplementado localmente (parametrizado por un único rol, no un array)
 * para mantener este archivo sin ninguna dependencia de módulos que lean
 * `RUNTIME_TABLE_PRIVILEGE_MATRIX`/reconcilien nada — este hardener no
 * necesita ni importa esa matriz. */
const QUERY_CLOUDSQLSUPERUSER_MEMBERSHIP = `
  WITH RECURSIVE role_tree AS (
    SELECT m.member AS member_oid, m.roleid AS granted_oid, am.rolname AS member_role
    FROM pg_auth_members m
    JOIN pg_roles am ON am.oid = m.member
    UNION ALL
    SELECT rt.member_oid, m.roleid, rt.member_role
    FROM role_tree rt
    JOIN pg_auth_members m ON m.member = rt.granted_oid
  )
  SELECT DISTINCT rt.member_role
  FROM role_tree rt
  JOIN pg_roles gr ON gr.oid = rt.granted_oid
  WHERE gr.rolname = 'cloudsqlsuperuser' AND rt.member_role = $1;
`;

const QUERY_DIRECT_CLOUDSQLSUPERUSER_MEMBERSHIP = `
  SELECT 1
  FROM pg_auth_members am
  JOIN pg_roles m ON m.oid = am.member
  JOIN pg_roles r ON r.oid = am.roleid
  WHERE m.rolname = $1 AND r.rolname = 'cloudsqlsuperuser';
`;

async function fetchRoleState(client: Client, rolname: string): Promise<RoleStateSnapshot> {
  const result = await client.query(QUERY_ROLE_STATE, [rolname]);
  const row = result.rows[0] as RoleStateSnapshot | undefined;
  if (!row) {
    throw rolname === TARGET_ROLE
      ? new HardenerError('TARGET_ROLE_NOT_FOUND', `El rol objetivo '${TARGET_ROLE}' no existe — el hardener nunca crea roles.`)
      : new HardenerError('RUNTIME_ROLE_NOT_FOUND', `El rol de runtime '${RUNTIME_ROLE}' no existe.`);
  }
  return row;
}

async function fetchCloudSqlSuperuserMembership(client: Client, rolname: string): Promise<{ direct: boolean; transitive: boolean }> {
  const directResult = await client.query(QUERY_DIRECT_CLOUDSQLSUPERUSER_MEMBERSHIP, [rolname]);
  const transitiveResult = await client.query(QUERY_CLOUDSQLSUPERUSER_MEMBERSHIP, [rolname]);
  return { direct: (directResult.rowCount ?? 0) > 0, transitive: (transitiveResult.rowCount ?? 0) > 0 };
}

// =============================================================================
// Conexión — nunca se sobreescribe `ssl` (misma lección que
// `db-readonly-inspector.ts` P2-10: no debilitar la verificación TLS acá).
// =============================================================================

function createClient(migrationDatabaseUrl: string): Client {
  return new Client({
    connectionString: migrationDatabaseUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'korixa-db-role-hardener',
  });
}

async function connectAndIdentify(client: Client): Promise<ConnectedIdentity & { database: string }> {
  try {
    await client.connect();
  } catch (error: unknown) {
    throw sanitizeUnexpectedError('DB_CONNECTION_FAILED', 'No se pudo conectar a la base de datos', {
      connection_failure_class: classifySafeConnectionFailure(error),
    });
  }
  const identityResult = await client.query(QUERY_IDENTITY);
  const row = identityResult.rows[0] as { current_user: string; session_user: string; database: string };
  return { currentUser: row.current_user, sessionUser: row.session_user, database: row.database };
}

// =============================================================================
// MODO preflight — READ ONLY.
// =============================================================================

export interface PreflightResult {
  mode: 'preflight';
  source_sha: string;
  admin_identity: string;
  admin_capability: AdminCapability;
  admin_option_on_target: boolean;
  target_state: RoleStateSnapshot;
  runtime_state: RoleStateSnapshot;
}

export async function runPreflight(env: HardenerEnv): Promise<PreflightResult> {
  const parsed = parseConnectionString(env.MIGRATION_DATABASE_URL);
  assertExpectedTarget(parsed, env.EXPECTED_DB_HOST, env.EXPECTED_DATABASE);

  const client = createClient(env.MIGRATION_DATABASE_URL);
  let connected = false;
  try {
    const identity = await connectAndIdentify(client);
    connected = true;
    assertSafeConnectedIdentity(identity);

    await client.query('BEGIN READ ONLY;');
    try {
      const targetState = await fetchRoleState(client, TARGET_ROLE);
      const runtimeState = await fetchRoleState(client, RUNTIME_ROLE);
      const adminState = await fetchRoleState(client, identity.currentUser);
      const adminOptionResult = await client.query(QUERY_ADMIN_OPTION_ON_TARGET, [identity.currentUser, TARGET_ROLE]);
      const adminOptionOnTarget = Boolean((adminOptionResult.rows[0] as { admin_option?: boolean } | undefined)?.admin_option);

      const capability = classifyAdminCapability(adminState, adminOptionOnTarget);
      if (capability === 'INSUFFICIENT') {
        throw new HardenerError(
          'HOLD_ADMIN_CAPABILITY',
          `La identidad conectada ('${identity.currentUser}') no tiene capacidad administrativa probada sobre '${TARGET_ROLE}' — no es superusuario y no tiene ADMIN OPTION sobre el rol objetivo (PostgreSQL 16: CREATEROLE por sí solo no basta). Ningún mutation se ejecuta.`,
          { admin_capability: capability, admin_option_on_target: adminOptionOnTarget },
        );
      }

      return {
        mode: 'preflight',
        source_sha: env.EXPECTED_SOURCE_SHA,
        admin_identity: identity.currentUser,
        admin_capability: capability,
        admin_option_on_target: adminOptionOnTarget,
        target_state: targetState,
        runtime_state: runtimeState,
      };
    } finally {
      await client.query('ROLLBACK;').catch(() => {
        // best-effort — read-only transacción, nada que revertir realmente.
      });
    }
  } catch (error) {
    if (error instanceof HardenerError) throw error;
    throw sanitizeUnexpectedError('UNEXPECTED_HARDENER_ERROR', 'Error inesperado durante preflight');
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

// =============================================================================
// MODO apply — la ÚNICA función de este archivo que muta algo.
// =============================================================================

export interface ApplyResult {
  mode: 'apply';
  source_sha: string;
  outcome: 'HARDENED';
  statements_executed: number;
  target_post_state: { rolcreatedb: false; rolcreaterole: false; rolcanlogin: true };
  target_post_privileges: { connect: true; schema_usage: true; schema_create: true };
  runtime_unchanged: true;
  cloudsqlsuperuser_removed_by_this_program: false;
}

export async function runApply(env: HardenerEnv): Promise<ApplyResult> {
  if (!env.HARDEN_CONFIRMATION) {
    throw new HardenerError('MISSING_APPLY_CONFIRMATION', 'HARDEN_CONFIRMATION no está definida — requerida exactamente para apply.');
  }
  if (env.HARDEN_CONFIRMATION !== APPLY_CONFIRMATION_TOKEN) {
    throw new HardenerError(
      'INVALID_APPLY_CONFIRMATION',
      `HARDEN_CONFIRMATION debe ser exactamente '${APPLY_CONFIRMATION_TOKEN}' — el valor recibido no coincide.`,
    );
  }

  const parsed = parseConnectionString(env.MIGRATION_DATABASE_URL);
  assertExpectedTarget(parsed, env.EXPECTED_DB_HOST, env.EXPECTED_DATABASE);

  const client = createClient(env.MIGRATION_DATABASE_URL);
  let connected = false;
  let inTransaction = false;
  try {
    const identity = await connectAndIdentify(client);
    connected = true;
    assertSafeConnectedIdentity(identity);
    assertExpectedAdminIdentity(identity.currentUser, env.EXPECTED_ADMIN_DB_USER);

    // Todas las precondiciones de apply se prueban ANTES de BEGIN — "STOP
    // before BEGIN" si cualquiera falla (misión, sección D). El único uso de
    // esta lectura de `korixa_app` es su efecto de existencia (lanza
    // `TARGET_ROLE_NOT_FOUND` si no existe) — su estado de ATRIBUTOS pre-mutación
    // no se compara contra nada (a diferencia de `runtimeStatePre`, que sí se
    // usa para probar `RUNTIME_DRIFT_DURING_TRANSACTION` más abajo).
    await fetchRoleState(client, TARGET_ROLE);
    const runtimeStatePre = await fetchRoleState(client, RUNTIME_ROLE);
    const adminState = await fetchRoleState(client, identity.currentUser);
    const adminOptionResult = await client.query(QUERY_ADMIN_OPTION_ON_TARGET, [identity.currentUser, TARGET_ROLE]);
    const adminOptionOnTarget = Boolean((adminOptionResult.rows[0] as { admin_option?: boolean } | undefined)?.admin_option);
    const capability = classifyAdminCapability(adminState, adminOptionOnTarget);
    if (capability === 'INSUFFICIENT') {
      throw new HardenerError(
        'HOLD_ADMIN_CAPABILITY',
        `La identidad conectada ('${identity.currentUser}') no tiene capacidad administrativa probada sobre '${TARGET_ROLE}'. Ningún mutation se ejecuta.`,
        { admin_capability: capability, admin_option_on_target: adminOptionOnTarget },
      );
    }

    const activeSessionResult = await client.query(QUERY_ACTIVE_SESSION, [TARGET_ROLE]);
    const activeCount = Number((activeSessionResult.rows[0] as { active_count: number } | undefined)?.active_count ?? 0);
    if (activeCount > 0) {
      throw new HardenerError(
        'ACTIVE_SESSION_USING_TARGET_ROLE',
        `Existen ${activeCount} sesión(es) activa(s) usando '${TARGET_ROLE}' — apply se niega a ejecutar mientras el rol objetivo tiene actividad concurrente.`,
        { active_count: activeCount },
      );
    }

    const pgmigrationsResult = await client.query(QUERY_PGMIGRATIONS_EXISTS);
    const pgmigrationsExists = Boolean((pgmigrationsResult.rows[0] as { pgmigrations_exists: boolean } | undefined)?.pgmigrations_exists);
    if (pgmigrationsExists) {
      throw new HardenerError(
        'PGMIGRATIONS_ALREADY_EXISTS',
        'public.pgmigrations ya existe — este endurecimiento asume explícitamente 0/7 migraciones aplicadas (evidencia Point 7); si el estado cambió, apply se niega a proceder sin una revisión nueva.',
      );
    }

    // ===== BEGIN — única transacción, exactamente 3 mutaciones =====
    await client.query('BEGIN;');
    inTransaction = true;

    try {
      await client.query(APPLY_MUTATION_STATEMENTS[0]);
    } catch {
      throw sanitizeUnexpectedError('ALTER_ROLE_FAILED', 'Falló ALTER ROLE — se revierte la transacción completa');
    }
    try {
      await client.query(APPLY_MUTATION_STATEMENTS[1]);
    } catch {
      throw sanitizeUnexpectedError('GRANT_CONNECT_FAILED', 'Falló GRANT CONNECT — se revierte la transacción completa');
    }
    try {
      await client.query(APPLY_MUTATION_STATEMENTS[2]);
    } catch {
      throw sanitizeUnexpectedError('GRANT_SCHEMA_FAILED', 'Falló GRANT USAGE, CREATE ON SCHEMA — se revierte la transacción completa');
    }

    // ===== Prueba de estado EXACTO, todavía dentro de la transacción =====
    const targetStatePost = await fetchRoleState(client, TARGET_ROLE);
    const targetPrivilegesResult = await client.query(QUERY_TARGET_PRIVILEGES, [TARGET_ROLE, TARGET_DATABASE, TARGET_SCHEMA]);
    const targetPrivileges = targetPrivilegesResult.rows[0] as { connect: boolean; schema_usage: boolean; schema_create: boolean };
    const runtimeStatePost = await fetchRoleState(client, RUNTIME_ROLE);

    const targetStateProven =
      targetStatePost.rolcreatedb === false && targetStatePost.rolcreaterole === false && targetStatePost.rolcanlogin === true;
    const targetPrivilegesProven = targetPrivileges.connect === true && targetPrivileges.schema_usage === true && targetPrivileges.schema_create === true;

    if (!targetStateProven || !targetPrivilegesProven) {
      throw new HardenerError(
        'HOLD_POST_STATE_MISMATCH',
        'El estado de korixa_app tras los 3 GRANT/ALTER no coincide EXACTAMENTE con lo esperado — se revierte la transacción completa; nunca se declara HARDENED sobre un estado post-mutación no probado.',
        {
          rolcreatedb: targetStatePost.rolcreatedb,
          rolcreaterole: targetStatePost.rolcreaterole,
          rolcanlogin: targetStatePost.rolcanlogin,
          connect: targetPrivileges.connect,
          schema_usage: targetPrivileges.schema_usage,
          schema_create: targetPrivileges.schema_create,
        },
      );
    }

    const runtimeUnchanged =
      runtimeStatePost.rolsuper === runtimeStatePre.rolsuper &&
      runtimeStatePost.rolcreaterole === runtimeStatePre.rolcreaterole &&
      runtimeStatePost.rolcreatedb === runtimeStatePre.rolcreatedb &&
      runtimeStatePost.rolcanlogin === runtimeStatePre.rolcanlogin &&
      runtimeStatePost.rolreplication === runtimeStatePre.rolreplication &&
      runtimeStatePost.rolbypassrls === runtimeStatePre.rolbypassrls;

    if (!runtimeUnchanged) {
      throw new HardenerError(
        'RUNTIME_DRIFT_DURING_TRANSACTION',
        `El estado de '${RUNTIME_ROLE}' cambió durante la transacción de apply — el hardener nunca debe afectar al runtime; se revierte la transacción completa.`,
      );
    }

    await client.query('COMMIT;');
    inTransaction = false;

    return {
      mode: 'apply',
      source_sha: env.EXPECTED_SOURCE_SHA,
      outcome: 'HARDENED',
      statements_executed: APPLY_MUTATION_STATEMENTS.length,
      target_post_state: { rolcreatedb: false, rolcreaterole: false, rolcanlogin: true },
      target_post_privileges: { connect: true, schema_usage: true, schema_create: true },
      runtime_unchanged: true,
      cloudsqlsuperuser_removed_by_this_program: false,
    };
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK;').catch(() => {});
    }
    if (error instanceof HardenerError) throw error;
    throw sanitizeUnexpectedError('UNEXPECTED_HARDENER_ERROR', 'Error inesperado durante apply');
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

// =============================================================================
// MODO verify — READ ONLY, nunca lanza sobre un HALLAZGO de estado (solo
// sobre violaciones de contrato/identidad) — su trabajo es REPORTAR, no
// bloquear. "No declarar POINT_8_PASS falso hasta que la membresía Cloud
// SQL también se remueva" se resuelve devolviendo `disposition` explícito,
// nunca un campo genérico de éxito.
// =============================================================================

export type VerifyDisposition =
  | 'SQL_HARDENING_NOT_YET_APPLIED'
  | 'SQL_HARDENED_CLOUDSQL_MEMBERSHIP_PENDING'
  | 'SQL_AND_CLOUDSQL_FULLY_HARDENED'
  | 'SQL_HARDENING_PARTIAL_OR_UNEXPECTED_STATE';

export interface VerifyResult {
  mode: 'verify';
  source_sha: string;
  target_state: { rolcreatedb: boolean; rolcreaterole: boolean; rolcanlogin: boolean };
  target_privileges: { connect: boolean; schema_usage: boolean; schema_create: boolean };
  runtime_state: RoleStateSnapshot;
  runtime_safe: boolean;
  target_cloudsqlsuperuser_direct: boolean;
  target_cloudsqlsuperuser_transitive: boolean;
  disposition: VerifyDisposition;
}

const RUNTIME_SAFE_BASELINE = { rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false, rolsuper: false } as const;

export async function runVerify(env: HardenerEnv): Promise<VerifyResult> {
  const parsed = parseConnectionString(env.MIGRATION_DATABASE_URL);
  assertExpectedTarget(parsed, env.EXPECTED_DB_HOST, env.EXPECTED_DATABASE);

  const client = createClient(env.MIGRATION_DATABASE_URL);
  let connected = false;
  try {
    const identity = await connectAndIdentify(client);
    connected = true;
    assertSafeConnectedIdentity(identity);

    await client.query('BEGIN READ ONLY;');
    try {
      const targetState = await fetchRoleState(client, TARGET_ROLE);
      const runtimeState = await fetchRoleState(client, RUNTIME_ROLE);
      const targetPrivilegesResult = await client.query(QUERY_TARGET_PRIVILEGES, [TARGET_ROLE, TARGET_DATABASE, TARGET_SCHEMA]);
      const targetPrivileges = targetPrivilegesResult.rows[0] as { connect: boolean; schema_usage: boolean; schema_create: boolean };
      const membership = await fetchCloudSqlSuperuserMembership(client, TARGET_ROLE);

      const sqlHardened =
        targetState.rolcreatedb === false &&
        targetState.rolcreaterole === false &&
        targetState.rolcanlogin === true &&
        targetPrivileges.connect === true &&
        targetPrivileges.schema_usage === true &&
        targetPrivileges.schema_create === true;

      const runtimeSafe =
        runtimeState.rolcreaterole === RUNTIME_SAFE_BASELINE.rolcreaterole &&
        runtimeState.rolcreatedb === RUNTIME_SAFE_BASELINE.rolcreatedb &&
        runtimeState.rolbypassrls === RUNTIME_SAFE_BASELINE.rolbypassrls &&
        runtimeState.rolreplication === RUNTIME_SAFE_BASELINE.rolreplication &&
        runtimeState.rolsuper === RUNTIME_SAFE_BASELINE.rolsuper;

      const cloudsqlsuperuserGone = !membership.direct && !membership.transitive;

      let disposition: VerifyDisposition;
      if (!sqlHardened) {
        disposition = 'SQL_HARDENING_NOT_YET_APPLIED';
      } else if (!runtimeSafe) {
        disposition = 'SQL_HARDENING_PARTIAL_OR_UNEXPECTED_STATE';
      } else if (!cloudsqlsuperuserGone) {
        disposition = 'SQL_HARDENED_CLOUDSQL_MEMBERSHIP_PENDING';
      } else {
        disposition = 'SQL_AND_CLOUDSQL_FULLY_HARDENED';
      }

      return {
        mode: 'verify',
        source_sha: env.EXPECTED_SOURCE_SHA,
        target_state: { rolcreatedb: targetState.rolcreatedb, rolcreaterole: targetState.rolcreaterole, rolcanlogin: targetState.rolcanlogin },
        target_privileges: targetPrivileges,
        runtime_state: runtimeState,
        runtime_safe: runtimeSafe,
        target_cloudsqlsuperuser_direct: membership.direct,
        target_cloudsqlsuperuser_transitive: membership.transitive,
        disposition,
      };
    } finally {
      await client.query('ROLLBACK;').catch(() => {});
    }
  } catch (error) {
    if (error instanceof HardenerError) throw error;
    throw sanitizeUnexpectedError('UNEXPECTED_HARDENER_ERROR', 'Error inesperado durante verify');
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

// =============================================================================
// Dispatcher — única función invocada por el entrypoint CLI real.
// =============================================================================

export type HardenerResult = PreflightResult | ApplyResult | VerifyResult;

export async function runHardener(): Promise<HardenerResult> {
  const env = readRequiredEnv();
  switch (env.HARDENER_MODE) {
    case 'preflight':
      return runPreflight(env);
    case 'apply':
      return runApply(env);
    case 'verify':
      return runVerify(env);
  }
}

if (require.main === module) {
  runHardener()
    .then((result) => {
      // Único punto de salida de evidencia — JSON estructurado, campos
      // aprobados únicamente. Nunca MIGRATION_DATABASE_URL cruda.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      const safe =
        error instanceof HardenerError
          ? { error_code: error.code, message: error.message, evidence: error.evidence }
          : {
              error_code: 'UNEXPECTED_HARDENER_ERROR' as HardenerErrorCode,
              message: 'Ocurrió un error inesperado, de un tipo no reconocido — nunca se serializa el error crudo, su mensaje ni su stack.',
              evidence: undefined,
            };
      process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
      process.exitCode = 1;
    });
}
