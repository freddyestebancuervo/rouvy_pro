/**
 * Inspector de solo lectura para `korixa-production-postgres`
 * (T-F1.2 — KORIXA_TF12_PRODUCTION_DB_READONLY_INSPECTION_PREFLIGHT).
 *
 * Diseño ratificado: sin bootstrap de Nest, sin servidor HTTP, sin API
 * SQL de forma libre. Toda consulta ejecutada es una constante fija
 * (`INSPECTION_QUERIES`), nunca construida a partir de env vars o
 * argumentos — no existe ningún camino de código que acepte SQL, tabla,
 * rol o schema arbitrario desde el entorno de ejecución.
 *
 * Este archivo es código IMPLEMENTADO pero INALCANZABLE: nada en este PR
 * lo invoca contra una base real. `require.main === module` es la única
 * puerta de entrada a la ejecución real (`node dist/ops/db-readonly-inspector.js`);
 * importarlo desde un test nunca conecta a nada.
 */

import { Client } from 'pg';

// =============================================================================
// Contrato de entorno — ver PHASE 2. Ninguna otra env var es leída.
// =============================================================================

export interface InspectorEnv {
  DATABASE_URL: string;
  EXPECTED_DATABASE: string;
  EXPECTED_DB_HOST: string;
  EXPECTED_SOURCE_SHA: string;
  EXPECTED_MIGRATION_SET_HASH: string;
}

// =============================================================================
// Códigos de error saneados — nunca se emite un error crudo de `pg`, del
// parser de URL o del filesystem (PHASE 22). El stack de un error de `pg`
// puede embeber el connection string; jamás se loguea/propaga tal cual.
// =============================================================================

export type InspectorErrorCode =
  | 'MISSING_DATABASE_URL'
  | 'INVALID_DATABASE_URL'
  | 'DATABASE_HOST_MISMATCH'
  | 'DATABASE_NAME_MISMATCH'
  | 'DB_CONNECTION_FAILED'
  | 'READ_ONLY_ASSERTION_FAILED'
  | 'DATABASE_IDENTITY_MISMATCH'
  | 'CREDENTIAL_DB_USER_MISMATCH'
  | 'ROLE_QUERY_FAILED'
  | 'OWNERSHIP_QUERY_FAILED'
  | 'PRIVILEGE_QUERY_FAILED'
  | 'TRACKER_QUERY_FAILED'
  | 'PHYSICAL_SCHEMA_QUERY_FAILED'
  | 'UNEXPECTED_MIGRATION_STATE';

export class InspectorError extends Error {
  readonly code: InspectorErrorCode;
  /** Evidencia segura adicional (nunca password/DSN/stack de `pg`). */
  readonly evidence?: Record<string, string>;

  constructor(code: InspectorErrorCode, message: string, evidence?: Record<string, string>) {
    super(message);
    this.name = 'InspectorError';
    this.code = code;
    this.evidence = evidence;
  }
}

// =============================================================================
// PHASE 3 — validación del connection string SIN loguearlo nunca.
// =============================================================================

interface ParsedConnection {
  /** Host resuelto del DSN — seguro de loguear (no es secreto por sí solo). */
  host: string;
  /** Nombre de base resuelto del DSN — seguro de loguear. */
  database: string;
  /** Solo se usa para confirmar que existe; nunca se expone su valor. */
  hasUsername: boolean;
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/**
 * Parsea `DATABASE_URL` sin loguear ningún fragmento del string original.
 * Cualquier error de parseo se traduce a `INVALID_DATABASE_URL` — el
 * mensaje del `URL` nativo de Node puede incluir la URL completa, así
 * que nunca se propaga tal cual.
 */
export function parseConnectionString(databaseUrl: string): ParsedConnection {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new InspectorError('INVALID_DATABASE_URL', 'DATABASE_URL no es una URL válida.');
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new InspectorError(
      'INVALID_DATABASE_URL',
      `DATABASE_URL tiene un protocolo no reconocido como PostgreSQL: '${parsed.protocol}'`,
    );
  }
  if (!parsed.hostname) {
    throw new InspectorError('INVALID_DATABASE_URL', 'DATABASE_URL no tiene host.');
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) {
    throw new InspectorError('INVALID_DATABASE_URL', 'DATABASE_URL no tiene un nombre de base de datos.');
  }
  if (!parsed.username) {
    throw new InspectorError('INVALID_DATABASE_URL', 'DATABASE_URL no tiene un usuario.');
  }

  return { host: parsed.hostname, database, hasUsername: true };
}

/**
 * Verifica host/database ANTES de conectar. No valida la contraseña —
 * eso es responsabilidad exclusiva del propio intento de conexión.
 */
export function assertExpectedTarget(
  parsed: ParsedConnection,
  expectedHost: string,
  expectedDatabase: string,
): void {
  if (parsed.host !== expectedHost) {
    throw new InspectorError('DATABASE_HOST_MISMATCH', 'El host del DATABASE_URL no coincide con EXPECTED_DB_HOST.', {
      actual_host: parsed.host,
      expected_host: expectedHost,
    });
  }
  if (parsed.database !== expectedDatabase) {
    throw new InspectorError(
      'DATABASE_NAME_MISMATCH',
      'El nombre de base del DATABASE_URL no coincide con EXPECTED_DATABASE.',
      { actual_database: parsed.database, expected_database: expectedDatabase },
    );
  }
}

// =============================================================================
// PHASE 6-13 — consultas fijas. Toda ejecución real usa exactamente uno
// de estos strings, nunca una concatenación con input externo.
// =============================================================================

export const TARGET_ROLES = ['korixa_app', 'korixa_runtime'] as const;
export const TARGET_SCHEMA = 'public';
export const EXPECTED_DB_USER = 'korixa_runtime';

export const INSPECTION_QUERIES = {
  beginReadOnly: 'BEGIN READ ONLY;',
  readOnlyAssertion: `SELECT current_setting('transaction_read_only') AS transaction_read_only;`,
  rollback: 'ROLLBACK;',

  identity: `SELECT current_database() AS database, current_user AS current_user, session_user AS session_user;`,

  roleCapabilities: `
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolcanlogin, rolreplication, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('korixa_app', 'korixa_runtime');
  `,

  roleMemberships: `
    SELECT m.rolname AS member_role, r.rolname AS granted_role
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles r ON r.oid = am.roleid
    WHERE m.rolname IN ('korixa_app', 'korixa_runtime');
  `,

  databaseOwnership: `
    SELECT datname, pg_get_userbyid(datdba) AS owner
    FROM pg_database WHERE datname = 'korixa_production';
  `,

  schemaOwnership: `
    SELECT nspname, pg_get_userbyid(nspowner) AS owner
    FROM pg_namespace WHERE nspname = 'public';
  `,

  objectOwnership: `
    SELECT n.nspname AS schema, c.relname AS object_name,
           CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
                           WHEN 'S' THEN 'sequence' END AS object_type,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
    ORDER BY object_type, object_name;
  `,

  databasePrivileges: `
    SELECT rolname,
           has_database_privilege(rolname, 'korixa_production', 'CONNECT') AS can_connect,
           has_schema_privilege(rolname, 'public', 'USAGE') AS can_schema_usage,
           has_schema_privilege(rolname, 'public', 'CREATE') AS can_schema_create
    FROM pg_roles WHERE rolname IN ('korixa_app', 'korixa_runtime');
  `,

  tablePrivileges: `
    SELECT r.rolname, c.relname AS table_name,
           has_table_privilege(r.oid, c.oid, 'SELECT')     AS can_select,
           has_table_privilege(r.oid, c.oid, 'INSERT')     AS can_insert,
           has_table_privilege(r.oid, c.oid, 'UPDATE')     AS can_update,
           has_table_privilege(r.oid, c.oid, 'DELETE')     AS can_delete,
           has_table_privilege(r.oid, c.oid, 'TRUNCATE')   AS can_truncate,
           has_table_privilege(r.oid, c.oid, 'REFERENCES') AS can_references,
           has_table_privilege(r.oid, c.oid, 'TRIGGER')    AS can_trigger
    FROM pg_roles r
    CROSS JOIN pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rolname IN ('korixa_app', 'korixa_runtime')
      AND n.nspname = 'public' AND c.relkind = 'r';
  `,

  sequencePrivileges: `
    SELECT r.rolname, c.relname AS sequence_name,
           has_sequence_privilege(r.oid, c.oid, 'USAGE')  AS can_usage,
           has_sequence_privilege(r.oid, c.oid, 'SELECT') AS can_select,
           has_sequence_privilege(r.oid, c.oid, 'UPDATE') AS can_update
    FROM pg_roles r
    CROSS JOIN pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rolname IN ('korixa_app', 'korixa_runtime')
      AND n.nspname = 'public' AND c.relkind = 'S';
  `,

  migrationTrackerExists: `SELECT to_regclass('public.pgmigrations') IS NOT NULL AS pgmigrations_exists;`,

  /** Única lectura de filas fuera de catálogo del sistema — metadata de
   * migración, no dato de negocio (ver PHASE 15/Correction C). */
  migrationTrackerRows: `SELECT name, run_on FROM public.pgmigrations ORDER BY run_on, name;`,

  pgcryptoPresent: `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto_present;`,

  /** Existencia únicamente — nunca `SELECT *`/`COUNT(*)` de una tabla de
   * aplicación (Correction C: APPLICATION_DATA_ROWS_READ debe ser 0). */
  physicalSchemaExistence: `
    SELECT
      to_regclass('public.users')                IS NOT NULL AS users_exists,
      to_regclass('public.roles')                 IS NOT NULL AS roles_exists,
      to_regclass('public.user_roles')             IS NOT NULL AS user_roles_exists,
      to_regclass('public.refresh_tokens')         IS NOT NULL AS refresh_tokens_exists,
      to_regclass('public.ride_sessions')          IS NOT NULL AS ride_sessions_exists,
      to_regclass('public.audit_log')              IS NOT NULL AS audit_log_exists,
      to_regclass('public.users_email_lower_unique') IS NOT NULL AS users_email_lower_unique_exists,
      to_regclass('public.equipment_categories')   IS NOT NULL AS equipment_categories_exists,
      to_regclass('public.equipment')              IS NOT NULL AS equipment_exists,
      to_regclass('public.workouts')               IS NOT NULL AS workouts_exists,
      to_regclass('public.workout_intervals')      IS NOT NULL AS workout_intervals_exists,
      to_regclass('public.idx_equipment_user_created_id')  IS NOT NULL AS idx_equipment_user_created_id_exists,
      to_regclass('public.idx_workouts_owner_created_id')  IS NOT NULL AS idx_workouts_owner_created_id_exists,
      to_regclass('public.idx_workouts_visible_created_id') IS NOT NULL AS idx_workouts_visible_created_id_exists
    ;
  `,

  firebaseUidColumnExists: `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'firebase_uid'
    ) AS firebase_uid_column_exists;
  `,
} as const;

/** Cada statement ejecutable debe ser BEGIN READ ONLY, SELECT o ROLLBACK
 * (PHASE 24) — verificado por statement, nunca por substring naive
 * (una consulta de privilegios legítima contiene literales como
 * 'DELETE'/'CREATE'). */
export function topLevelStatementForm(sql: string): 'BEGIN_READ_ONLY' | 'SELECT' | 'ROLLBACK' | 'OTHER' {
  const trimmed = sql.trim().replace(/;$/, '').trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'BEGIN READ ONLY') return 'BEGIN_READ_ONLY';
  if (upper === 'ROLLBACK') return 'ROLLBACK';
  if (upper.startsWith('SELECT')) return 'SELECT';
  return 'OTHER';
}

// =============================================================================
// PHASE 14 — mapa completo de objetos físicos esperados, derivado
// exclusivamente del SQL real de los 6 archivos de migración
// (backend/migrations/000{1..6}_*.sql) + comportamiento documentado y
// determinístico de PostgreSQL para nombres implícitos (PK/UNIQUE/
// SERIAL) + comportamiento real de node-pg-migrate (ver
// migration.js:142 y runner.js `ensureMigrationsTable`, node_modules
// instalados, versión 7.9.1). Ningún objeto de esta lista es inventado.
// =============================================================================

export const EXPECTED_MIGRATION_NAMES = [
  '0001_init',
  '0002_users_email_case_insensitive_unique',
  '0003_equipment',
  '0004_workouts',
  '0005_users_firebase_uid',
  '0006_tf0_5_pagination_indexes',
] as const;

export type ExpectedMigrationName = (typeof EXPECTED_MIGRATION_NAMES)[number];

interface MigrationObjectDelta {
  /** Objetos que esta migración crea y que siguen existiendo si se
   * aplicó (a menos que una migración POSTERIOR los elimine — ver
   * `removes`). */
  tables: string[];
  /** Índices/constraints únicos creados explícita o implícitamente
   * (PK/UNIQUE con nombre explícito o el nombre autogenerado
   * determinístico de Postgres `<tabla>_<columna>_key`). */
  indexes: string[];
  sequences: string[];
  extensions: string[];
  /** Objetos de una migración ANTERIOR que esta migración elimina. */
  removes?: string[];
}

export const EXPECTED_MIGRATION_OBJECTS: Record<ExpectedMigrationName, MigrationObjectDelta> = {
  '0001_init': {
    extensions: ['pgcrypto'],
    tables: ['users', 'roles', 'user_roles', 'refresh_tokens', 'ride_sessions', 'audit_log'],
    indexes: [
      // explícitos
      'idx_users_email_lower', // eliminado por 0002 — ver removes ahí
      'idx_users_premium_active',
      'idx_refresh_tokens_user_active',
      'idx_ride_sessions_user_start',
      'idx_audit_log_user',
      // PK implícitos (nombre determinístico Postgres: `<tabla>_pkey`)
      'users_pkey',
      'roles_pkey',
      'user_roles_pkey',
      'refresh_tokens_pkey',
      'ride_sessions_pkey',
      'audit_log_pkey',
      // UNIQUE con CONSTRAINT nombrado explícitamente en el SQL
      'users_email_unique',
      'refresh_tokens_hash_unique',
      // UNIQUE de columna sin nombre explícito (`roles.name ... UNIQUE`)
      // -> nombre autogenerado determinístico `<tabla>_<columna>_key`
      'roles_name_key',
    ],
    sequences: ['audit_log_id_seq'], // BIGSERIAL en audit_log.id
  },
  '0002_users_email_case_insensitive_unique': {
    extensions: [],
    tables: [],
    indexes: ['users_email_lower_unique'],
    sequences: [],
    removes: ['idx_users_email_lower'],
  },
  '0003_equipment': {
    extensions: [],
    tables: ['equipment_categories', 'equipment'],
    indexes: [
      'equipment_categories_pkey',
      'equipment_pkey',
      'equipment_one_default_per_user_category',
      'idx_equipment_user_active',
      'idx_equipment_parent',
      'equipment_user_ble_address_unique',
    ],
    sequences: [],
  },
  '0004_workouts': {
    extensions: [],
    tables: ['workouts', 'workout_intervals'],
    indexes: [
      'workouts_pkey',
      'workout_intervals_pkey',
      'workout_intervals_position_unique',
      'idx_workouts_owner',
      'idx_workout_intervals_workout',
    ],
    sequences: [],
  },
  '0005_users_firebase_uid': {
    extensions: [],
    tables: [],
    indexes: ['users_firebase_uid_unique'],
    sequences: [],
  },
  '0006_tf0_5_pagination_indexes': {
    extensions: [],
    tables: [],
    indexes: ['idx_equipment_user_created_id', 'idx_workouts_owner_created_id', 'idx_workouts_visible_created_id'],
    sequences: [],
  },
};

/** Objetos propios del motor node-pg-migrate — nunca deben clasificarse
 * como UNEXPECTED_SCHEMA_OBJECTS (Correction B / PHASE 17). Nombre
 * determinístico: `id SERIAL PRIMARY KEY` (runner.js) crea
 * `pgmigrations_pkey` + `pgmigrations_id_seq`. */
export const ENGINE_TRACKING_OBJECTS: { tables: string[]; indexes: string[]; sequences: string[] } = {
  tables: ['pgmigrations'],
  indexes: ['pgmigrations_pkey'],
  sequences: ['pgmigrations_id_seq'],
};

// =============================================================================
// PHASE 18-19 — clasificación del prefijo de migraciones aplicadas.
// =============================================================================

export type MigrationPrefixClassification =
  | { state: 'CLEAN_EMPTY' }
  | { state: 'TRACKED_AND_CONSISTENT'; applied: ExpectedMigrationName[]; pending: ExpectedMigrationName[] }
  | { state: 'INVALID_MIGRATION_ORDER'; reason: string }
  | { state: 'UNEXPECTED_MIGRATION_NAMES'; unexpected: string[] };

/**
 * Clasifica el conjunto de nombres trackeados en `pgmigrations`. Un
 * prefijo válido (ej. [0001,0002,0003]) es TRACKED_AND_CONSISTENT con
 * PENDING=[0004,0005,0006] — nunca corrupción (Correction D). Solo un
 * gap, duplicado, nombre desconocido u orden alterado es inválido.
 */
export function classifyMigrationPrefix(trackedNames: string[]): MigrationPrefixClassification {
  const unexpected = trackedNames.filter((n) => !EXPECTED_MIGRATION_NAMES.includes(n as ExpectedMigrationName));
  if (unexpected.length > 0) {
    return { state: 'UNEXPECTED_MIGRATION_NAMES', unexpected };
  }

  const seen = new Set<string>();
  for (const name of trackedNames) {
    if (seen.has(name)) {
      return { state: 'INVALID_MIGRATION_ORDER', reason: `Nombre duplicado en pgmigrations: '${name}'` };
    }
    seen.add(name);
  }

  if (trackedNames.length === 0) {
    return { state: 'CLEAN_EMPTY' };
  }

  const expectedPrefix = EXPECTED_MIGRATION_NAMES.slice(0, trackedNames.length);
  for (let i = 0; i < expectedPrefix.length; i += 1) {
    if (trackedNames[i] !== expectedPrefix[i]) {
      return {
        state: 'INVALID_MIGRATION_ORDER',
        reason: `Posición ${i}: se esperaba '${expectedPrefix[i]}', se encontró '${trackedNames[i]}' — el conjunto trackeado no es un prefijo ordenado válido de las 6 migraciones conocidas.`,
      };
    }
  }

  const applied = expectedPrefix as ExpectedMigrationName[];
  const pending = EXPECTED_MIGRATION_NAMES.slice(trackedNames.length) as ExpectedMigrationName[];
  return { state: 'TRACKED_AND_CONSISTENT', applied, pending };
}

/** Objetos físicos esperados dado un conjunto APLICADO (nunca incluye
 * objetos de migraciones PENDING — PHASE 16). */
export function expectedObjectsForApplied(applied: ExpectedMigrationName[]): {
  tables: Set<string>;
  indexes: Set<string>;
  sequences: Set<string>;
  extensions: Set<string>;
} {
  const tables = new Set<string>();
  const indexes = new Set<string>();
  const sequences = new Set<string>();
  const extensions = new Set<string>();

  for (const name of applied) {
    const delta = EXPECTED_MIGRATION_OBJECTS[name];
    delta.tables.forEach((t) => tables.add(t));
    delta.indexes.forEach((i) => indexes.add(i));
    delta.sequences.forEach((s) => sequences.add(s));
    delta.extensions.forEach((e) => extensions.add(e));
    (delta.removes ?? []).forEach((r) => indexes.delete(r));
  }

  return { tables, indexes, sequences, extensions };
}

// =============================================================================
// PHASE 20 — clasificación del modelo de ownership.
// =============================================================================

export type OwnerModelClassification =
  | 'CASE_A_APP_OWNER_RUNTIME_DML'
  | 'CASE_B_POSTGRES_OWNER'
  | 'CASE_C_RUNTIME_OWNER_VIOLATION'
  | 'CASE_D_MIXED_OWNERSHIP'
  | 'CASE_E_CLEAN_EMPTY'
  | 'UNKNOWN';

export function classifyOwnerModel(objectOwners: string[], hasAnyObjects: boolean): OwnerModelClassification {
  if (!hasAnyObjects) return 'CASE_E_CLEAN_EMPTY';
  const distinctOwners = new Set(objectOwners);
  if (distinctOwners.has('korixa_runtime')) return 'CASE_C_RUNTIME_OWNER_VIOLATION';
  if (distinctOwners.size > 1) return 'CASE_D_MIXED_OWNERSHIP';
  if (distinctOwners.has('korixa_app')) return 'CASE_A_APP_OWNER_RUNTIME_DML';
  if (distinctOwners.has('postgres')) return 'CASE_B_POSTGRES_OWNER';
  return 'UNKNOWN';
}

// =============================================================================
// PHASE 9 — flags de alto privilegio inesperado.
// =============================================================================

export interface RoleCapabilityRow {
  rolname: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}

export function findPrivilegeEscalations(rows: RoleCapabilityRow[]): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    if (row.rolsuper) findings.push(`${row.rolname}: SUPERUSER inesperado`);
    if (row.rolcreaterole) findings.push(`${row.rolname}: CREATEROLE inesperado`);
    if (row.rolcreatedb) findings.push(`${row.rolname}: CREATEDB inesperado`);
    if (row.rolreplication) findings.push(`${row.rolname}: REPLICATION inesperado`);
    if (row.rolbypassrls) findings.push(`${row.rolname}: BYPASSRLS inesperado`);
  }
  return findings;
}

// =============================================================================
// PHASE 21 — esquema de resultado. Solo estos campos; nunca DATABASE_URL,
// password, ni ningún dato de una tabla de aplicación.
// =============================================================================

export interface InspectionResult {
  inspection_version: string;
  source_sha: string;
  migration_set_hash: string;
  database_identity: { database: string; current_user: string; session_user: string };
  read_only: { transaction_read_only: string };
  database_owner: string;
  public_schema_owner: string;
  roles: {
    capabilities: RoleCapabilityRow[];
    direct_memberships: { member_role: string; granted_role: string }[];
    privilege_escalation_findings: string[];
  };
  privileges: {
    database: { rolname: string; can_connect: boolean; can_schema_usage: boolean; can_schema_create: boolean }[];
    tables_summary_only: boolean;
  };
  object_owners: { schema: string; object_name: string; object_type: string; owner: string }[];
  pgmigrations: {
    exists: boolean;
    classification: MigrationPrefixClassification;
  };
  physical_schema: {
    classification: 'MATCHES_APPLIED' | 'MISSING_EXPECTED_OBJECTS' | 'UNEXPECTED_SCHEMA_OBJECTS';
    expected_present: string[];
    expected_missing: string[];
  };
  pgcrypto_present: boolean;
  db_role_mapping: 'MATCHES_EXPECTED' | 'CREDENTIAL_DB_USER_MISMATCH';
  production_schema_state: string;
  final_disposition:
    | 'CLEAN_EMPTY'
    | 'TRACKED_AND_CONSISTENT'
    | 'HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING'
    | 'HOLD_TRACKING_WITH_MISSING_OBJECTS'
    | 'HOLD_UNEXPECTED_MIGRATION_NAMES'
    | 'HOLD_INVALID_MIGRATION_ORDER'
    | 'HOLD_UNEXPECTED_SCHEMA_OBJECTS'
    | 'HOLD_INCONSISTENT_OWNER_MODEL'
    | 'HOLD_ROLE_PRIVILEGE_ESCALATION'
    | 'HOLD_UNKNOWN';
}

// =============================================================================
// PHASE 4-5 — conexión conservadora + transacción de solo lectura. Solo se
// ejecuta bajo `require.main === module` (nunca al importar el módulo).
// =============================================================================

function readRequiredEnv(): InspectorEnv {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new InspectorError('MISSING_DATABASE_URL', 'DATABASE_URL no está definida.');
  }
  const EXPECTED_DATABASE = process.env.EXPECTED_DATABASE ?? '';
  const EXPECTED_DB_HOST = process.env.EXPECTED_DB_HOST ?? '';
  const EXPECTED_SOURCE_SHA = process.env.EXPECTED_SOURCE_SHA ?? '';
  const EXPECTED_MIGRATION_SET_HASH = process.env.EXPECTED_MIGRATION_SET_HASH ?? '';
  if (!EXPECTED_DATABASE || !EXPECTED_DB_HOST || !EXPECTED_SOURCE_SHA || !EXPECTED_MIGRATION_SET_HASH) {
    throw new InspectorError(
      'INVALID_DATABASE_URL',
      'EXPECTED_DATABASE/EXPECTED_DB_HOST/EXPECTED_SOURCE_SHA/EXPECTED_MIGRATION_SET_HASH son todas requeridas.',
    );
  }
  return { DATABASE_URL, EXPECTED_DATABASE, EXPECTED_DB_HOST, EXPECTED_SOURCE_SHA, EXPECTED_MIGRATION_SET_HASH };
}

/** Nunca propaga `error.stack`/el objeto crudo de `pg` (puede embeber el
 * DSN) — siempre un mensaje saneado, fijo. */
function sanitizeUnexpectedError(code: InspectorErrorCode, context: string): InspectorError {
  return new InspectorError(code, `${context} — ver logs del Job para detalle no sensible adicional (nunca DSN/password).`);
}

export async function runInspection(): Promise<InspectionResult> {
  const env = readRequiredEnv();
  const parsed = parseConnectionString(env.DATABASE_URL);
  assertExpectedTarget(parsed, env.EXPECTED_DB_HOST, env.EXPECTED_DATABASE);

  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'korixa-db-readonly-inspector',
    ssl: { rejectUnauthorized: false },
  });

  let connected = false;
  try {
    try {
      await client.connect();
      connected = true;
    } catch {
      throw sanitizeUnexpectedError('DB_CONNECTION_FAILED', 'No se pudo conectar a la base de datos');
    }

    await client.query(INSPECTION_QUERIES.beginReadOnly);

    const roResult = await client.query(INSPECTION_QUERIES.readOnlyAssertion);
    const transactionReadOnly = roResult.rows[0]?.transaction_read_only;
    if (transactionReadOnly !== 'on') {
      throw new InspectorError(
        'READ_ONLY_ASSERTION_FAILED',
        `transaction_read_only no es 'on' (valor real: '${transactionReadOnly}') — no se ejecuta ninguna consulta de inspección.`,
      );
    }

    const identityResult = await client.query(INSPECTION_QUERIES.identity);
    const identity = identityResult.rows[0] as { database: string; current_user: string; session_user: string };

    if (identity.database !== env.EXPECTED_DATABASE) {
      throw new InspectorError('DATABASE_IDENTITY_MISMATCH', 'current_database() no coincide con EXPECTED_DATABASE.', {
        actual_database: identity.database,
        expected_database: env.EXPECTED_DATABASE,
      });
    }

    let dbRoleMapping: InspectionResult['db_role_mapping'] = 'MATCHES_EXPECTED';
    if (identity.current_user !== EXPECTED_DB_USER) {
      dbRoleMapping = 'CREDENTIAL_DB_USER_MISMATCH';
      // Fail-closed inmediato: no se continúa con inspección de catálogo
      // amplia bajo una credencial cuyo mapeo real no coincide con lo
      // esperado — podría ser un rol más privilegiado que korixa_runtime.
      throw new InspectorError(
        'CREDENTIAL_DB_USER_MISMATCH',
        `current_user real ('${identity.current_user}') no coincide con el usuario esperado ('${EXPECTED_DB_USER}') — DB_ROLE_MAPPING permanecía UNPROVEN, no se asume. Deteniendo inspección de catálogo amplia.`,
        { actual_current_user: identity.current_user },
      );
    }

    const [roleCapsResult, membershipsResult, dbOwnerResult, schemaOwnerResult, objectOwnersResult] =
      await Promise.all([
        client.query(INSPECTION_QUERIES.roleCapabilities).catch(() => {
          throw sanitizeUnexpectedError('ROLE_QUERY_FAILED', 'Falló la consulta de capacidades de rol');
        }),
        client.query(INSPECTION_QUERIES.roleMemberships).catch(() => {
          throw sanitizeUnexpectedError('ROLE_QUERY_FAILED', 'Falló la consulta de membresías de rol');
        }),
        client.query(INSPECTION_QUERIES.databaseOwnership).catch(() => {
          throw sanitizeUnexpectedError('OWNERSHIP_QUERY_FAILED', 'Falló la consulta de ownership de base de datos');
        }),
        client.query(INSPECTION_QUERIES.schemaOwnership).catch(() => {
          throw sanitizeUnexpectedError('OWNERSHIP_QUERY_FAILED', 'Falló la consulta de ownership de schema');
        }),
        client.query(INSPECTION_QUERIES.objectOwnership).catch(() => {
          throw sanitizeUnexpectedError('OWNERSHIP_QUERY_FAILED', 'Falló la consulta de ownership de objetos');
        }),
      ]);

    const roleCapabilities = roleCapsResult.rows as RoleCapabilityRow[];
    const privilegeEscalationFindings = findPrivilegeEscalations(roleCapabilities);

    const dbPrivilegesResult = await client.query(INSPECTION_QUERIES.databasePrivileges).catch(() => {
      throw sanitizeUnexpectedError('PRIVILEGE_QUERY_FAILED', 'Falló la consulta de privilegios de base de datos');
    });

    const trackerExistsResult = await client.query(INSPECTION_QUERIES.migrationTrackerExists).catch(() => {
      throw sanitizeUnexpectedError('TRACKER_QUERY_FAILED', 'Falló la verificación de existencia de pgmigrations');
    });
    const pgmigrationsExists = Boolean(trackerExistsResult.rows[0]?.pgmigrations_exists);

    let trackedNames: string[] = [];
    if (pgmigrationsExists) {
      const rowsResult = await client.query(INSPECTION_QUERIES.migrationTrackerRows).catch(() => {
        throw sanitizeUnexpectedError('TRACKER_QUERY_FAILED', 'Falló la lectura de filas de pgmigrations');
      });
      trackedNames = rowsResult.rows.map((r: { name: string }) => r.name);
    }
    const migrationClassification = classifyMigrationPrefix(trackedNames);

    const physicalResult = await client.query(INSPECTION_QUERIES.physicalSchemaExistence).catch(() => {
      throw sanitizeUnexpectedError('PHYSICAL_SCHEMA_QUERY_FAILED', 'Falló la verificación física del schema');
    });
    const firebaseUidResult = await client.query(INSPECTION_QUERIES.firebaseUidColumnExists).catch(() => {
      throw sanitizeUnexpectedError('PHYSICAL_SCHEMA_QUERY_FAILED', 'Falló la verificación de la columna firebase_uid');
    });
    const pgcryptoResult = await client.query(INSPECTION_QUERIES.pgcryptoPresent).catch(() => {
      throw sanitizeUnexpectedError('PHYSICAL_SCHEMA_QUERY_FAILED', 'Falló la verificación de pgcrypto');
    });

    const objectOwners = objectOwnersResult.rows as {
      schema: string;
      object_name: string;
      object_type: string;
      owner: string;
    }[];
    const applicationObjectOwners = objectOwners
      .filter((o) => !ENGINE_TRACKING_OBJECTS.tables.includes(o.object_name) && !ENGINE_TRACKING_OBJECTS.sequences.includes(o.object_name))
      .map((o) => o.owner);
    const ownerModel = classifyOwnerModel(applicationObjectOwners, applicationObjectOwners.length > 0);

    let physicalClassification: InspectionResult['physical_schema']['classification'] = 'MATCHES_APPLIED';
    const expectedPresent: string[] = [];
    const expectedMissing: string[] = [];
    if (migrationClassification.state === 'TRACKED_AND_CONSISTENT') {
      const expected = expectedObjectsForApplied(migrationClassification.applied);
      const presence: Record<string, boolean> = physicalResult.rows[0] ?? {};
      const tableExistsKey = (t: string) => `${t}_exists`;
      for (const t of expected.tables) {
        const key = tableExistsKey(t);
        if (key in presence) {
          (presence[key] ? expectedPresent : expectedMissing).push(t);
        }
      }
    }
    if (expectedMissing.length > 0) physicalClassification = 'MISSING_EXPECTED_OBJECTS';

    let finalDisposition: InspectionResult['final_disposition'];
    if (privilegeEscalationFindings.length > 0) {
      finalDisposition = 'HOLD_ROLE_PRIVILEGE_ESCALATION';
    } else if (migrationClassification.state === 'UNEXPECTED_MIGRATION_NAMES') {
      finalDisposition = 'HOLD_UNEXPECTED_MIGRATION_NAMES';
    } else if (migrationClassification.state === 'INVALID_MIGRATION_ORDER') {
      finalDisposition = 'HOLD_INVALID_MIGRATION_ORDER';
    } else if (!pgmigrationsExists && applicationObjectOwners.length > 0) {
      finalDisposition = 'HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING';
    } else if (physicalClassification === 'MISSING_EXPECTED_OBJECTS') {
      finalDisposition = 'HOLD_TRACKING_WITH_MISSING_OBJECTS';
    } else if (ownerModel === 'CASE_C_RUNTIME_OWNER_VIOLATION' || ownerModel === 'CASE_D_MIXED_OWNERSHIP') {
      finalDisposition = 'HOLD_INCONSISTENT_OWNER_MODEL';
    } else if (ownerModel === 'UNKNOWN' && applicationObjectOwners.length > 0) {
      finalDisposition = 'HOLD_UNKNOWN';
    } else if (migrationClassification.state === 'CLEAN_EMPTY') {
      finalDisposition = 'CLEAN_EMPTY';
    } else {
      finalDisposition = 'TRACKED_AND_CONSISTENT';
    }

    const result: InspectionResult = {
      inspection_version: '1.0.0',
      source_sha: env.EXPECTED_SOURCE_SHA,
      migration_set_hash: env.EXPECTED_MIGRATION_SET_HASH,
      database_identity: identity,
      read_only: { transaction_read_only: transactionReadOnly },
      database_owner: dbOwnerResult.rows[0]?.owner ?? '',
      public_schema_owner: schemaOwnerResult.rows[0]?.owner ?? '',
      roles: {
        capabilities: roleCapabilities,
        direct_memberships: membershipsResult.rows,
        privilege_escalation_findings: privilegeEscalationFindings,
      },
      privileges: {
        database: dbPrivilegesResult.rows,
        tables_summary_only: true,
      },
      object_owners: objectOwners,
      pgmigrations: { exists: pgmigrationsExists, classification: migrationClassification },
      physical_schema: { classification: physicalClassification, expected_present: expectedPresent, expected_missing: expectedMissing },
      pgcrypto_present: Boolean(pgcryptoResult.rows[0]?.pgcrypto_present),
      db_role_mapping: dbRoleMapping,
      production_schema_state: finalDisposition,
      final_disposition: finalDisposition,
    };

    await client.query(INSPECTION_QUERIES.rollback);
    void firebaseUidResult;
    return result;
  } catch (error) {
    try {
      if (connected) await client.query(INSPECTION_QUERIES.rollback);
    } catch {
      // ROLLBACK best-effort — el cliente se cierra de todas formas abajo.
    }
    if (error instanceof InspectorError) throw error;
    throw sanitizeUnexpectedError('DB_CONNECTION_FAILED', 'Error inesperado durante la inspección');
  } finally {
    if (connected) {
      await client.end().catch(() => {
        // Cierre best-effort — no hay nada más seguro que intentar hacer acá.
      });
    }
  }
}

/* eslint-disable @typescript-eslint/no-var-requires */
if (require.main === module) {
  runInspection()
    .then((result) => {
      // Único punto de salida de evidencia — JSON estructurado, campos
      // aprobados únicamente (ver InspectionResult). Nunca DATABASE_URL.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(0);
    })
    .catch((error: InspectorError) => {
      process.stderr.write(
        `${JSON.stringify({ error_code: error.code ?? 'UNKNOWN', message: error.message, evidence: error.evidence }, null, 2)}\n`,
      );
      process.exit(1);
    });
}
