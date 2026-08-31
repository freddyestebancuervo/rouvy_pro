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
 *
 * REMEDIACIÓN (misma PR, tras auditoría independiente
 * KORIXA_TF12_PRODUCTION_DB_READONLY_INSPECTOR_INDEPENDENT_AUDIT,
 * HOLD: P0=0, P1=8, P2=3, P3=3). Cierra los 8 P1 + P2-9/P2-10/P3-12:
 *
 *   P1-1/P1-5  la comparación físico-vs-esperado ahora cubre TODAS las
 *              categorías (tablas, índices, secuencias, extensión,
 *              columnas) en ambas direcciones (faltante Y sobrante),
 *              no solo tablas faltantes — ver `diffPhysicalSchema`.
 *   P1-2       `tablePrivileges`/`sequencePrivileges` ahora se
 *              ejecutan de verdad y sus filas quedan expuestas en
 *              `privileges.tables`/`privileges.sequences`.
 *   P1-3       `db_role_mapping` se separa en
 *              `credential_db_user_mapping` (solo prueba identidad de
 *              login) y `db_role_model` (nunca se declara probado el
 *              modelo completo de ownership/privilegios solo por la
 *              identidad de la credencial).
 *   P1-4       `classifyMigrationPrefix([])` ya no es en sí mismo
 *              "vacío probado" — un prefijo vacío es
 *              TRACKED_AND_CONSISTENT con applied=[]; CLEAN_EMPTY
 *              ahora se deriva por separado, cruzando eso con
 *              presencia física real de objetos de aplicación.
 *   P1-6/P1-7  ausencia de owner de base/schema resuelto, o de
 *              cualquiera de los 2 roles objetivo, ahora produce
 *              HOLD_OWNER_UNRESOLVED / HOLD_EXPECTED_ROLE_MISSING en
 *              vez de continuar en silencio con un valor vacío.
 *   P1-8       (fix en el workflow, no en este archivo).
 *   P2-9       `process.exit()` inmediato tras stdout/stderr.write
 *              reemplazado por `process.exitCode` (deja que Node vacíe
 *              los buffers naturalmente).
 *   P2-10      se retira `ssl: { rejectUnauthorized: false }` — el
 *              inspector ya no debilita la verificación de identidad
 *              del servidor; el comportamiento real de TLS se valida
 *              en el ensayo NONPROD, nunca se fuerza aquí para que
 *              "pase".
 *   P3-12      el catch de nivel superior ya no asume `InspectorError`
 *              por anotación de TypeScript — usa `unknown` + un
 *              `instanceof` en tiempo de ejecución.
 *
 * REMEDIACIÓN (T-F1.2 — KORIXA_TF12_PRIVILEGE_MODEL_REMEDIATION, tras el
 * hallazgo crítico de PR #105 de que el runtime podía terminar con
 * privilegios sobre `pgmigrations`). Cuatro nuevas condiciones de HOLD
 * automático, ninguna dependiente de revisión humana:
 *
 *   membresía cloudsqlsuperuser  `findCloudSqlSuperuserMemberships` se
 *                                suma a `privilegeEscalationFindings`
 *                                (mismo array, mismo disposition
 *                                `HOLD_ROLE_PRIVILEGE_ESCALATION`) —
 *                                mensajes con el literal
 *                                "cloudsqlsuperuser" para que la
 *                                semántica sea inequívoca y testeada.
 *   acceso runtime a pgmigrations `findPgmigrationsRuntimeAccessViolations`
 *                                — cualquier privilegio (SELECT
 *                                incluido) del runtime sobre
 *                                `public.pgmigrations` es HOLD
 *                                automático, nunca
 *                                `UNPROVEN_REQUIRES_REVIEW`.
 *   CREATE en schema para runtime `diffRuntimePrivilegesAgainstMatrix`
 *                                incluye `schema:public:create` en su
 *                                lista de excesos si el runtime tiene
 *                                `can_schema_create`.
 *   drift vs. la matriz mínima   `diffRuntimePrivilegesAgainstMatrix`
 *                                compara privilegios reales de
 *                                tabla/secuencia del runtime contra
 *                                `runtime-privilege-matrix.ts` (única
 *                                fuente de verdad compartida con
 *                                `privilege-reconciler.ts`) — cualquier
 *                                exceso bloquea con
 *                                `HOLD_RUNTIME_PRIVILEGE_DRIFT`.
 */

import { Client } from 'pg';
import { RUNTIME_TABLE_PRIVILEGE_MATRIX, RUNTIME_SEQUENCE_PRIVILEGE_MATRIX } from './runtime-privilege-matrix';

const CLOUDSQLSUPERUSER_ROLE = 'cloudsqlsuperuser';

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
  | 'UNEXPECTED_MIGRATION_STATE'
  | 'UNEXPECTED_INSPECTOR_ERROR';

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

  /** Inventario COMPLETO de índices en `public` — metadata pura
   * (`pg_indexes`), nunca datos de fila. Reemplaza la validación
   * P1-1/P1-5: en vez de listar booleanos ad hoc por índice conocido,
   * se compara el conjunto REAL contra el conjunto esperado en ambas
   * direcciones (faltante y sobrante) — ver `diffPhysicalSchema`. */
  indexInventory: `SELECT indexname FROM pg_indexes WHERE schemaname = 'public';`,

  /** Inventario COMPLETO de columnas en `public` — metadata pura
   * (`information_schema.columns`), nunca datos de fila. Cierra P1-1
   * para la clase de hallazgo "migración trackeada pero columna
   * esperada ausente" (ej. `users.firebase_uid`). */
  columnInventory: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public';`,
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
// exclusivamente del SQL real de los 7 archivos de migración
// (backend/migrations/000{1..7}_*.sql) + comportamiento documentado y
// determinístico de PostgreSQL para nombres implícitos (PK/UNIQUE/
// SERIAL) + comportamiento real de node-pg-migrate (ver
// migration.js:142 y runner.js `ensureMigrationsTable`, node_modules
// instalados, versión 7.9.1). Ningún objeto de esta lista es inventado.
//
// REMEDIACIÓN P1-1: se agrega `columns` — antes solo `tables` se
// comparaba en runtime contra el estado físico real; `indexes`/
// `sequences`/`extensions` estaban definidos pero nunca cruzados con
// evidencia real, y no existía ningún modelo de columnas en absoluto
// (por eso `users.firebase_uid`, agregada por 0005, nunca se validaba).
// =============================================================================

export const EXPECTED_MIGRATION_NAMES = [
  '0001_init',
  '0002_users_email_case_insensitive_unique',
  '0003_equipment',
  '0004_workouts',
  '0005_users_firebase_uid',
  '0006_tf0_5_pagination_indexes',
  '0007_drop_unused_ride_sessions',
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
  /** Columnas creadas por esta migración, ya sea vía CREATE TABLE o
   * ALTER TABLE ... ADD COLUMN — formato `{table, column}`. */
  columns: { table: string; column: string }[];
  /** Índices de una migración ANTERIOR que esta migración elimina. */
  removes?: string[];
  /** Tablas de una migración ANTERIOR que esta migración elimina. */
  removesTables?: string[];
  /** Columnas de una migración ANTERIOR que esta migración elimina. */
  removesColumns?: { table: string; column: string }[];
}

function cols(table: string, columns: string[]): { table: string; column: string }[] {
  return columns.map((column) => ({ table, column }));
}

export const EXPECTED_MIGRATION_OBJECTS: Record<ExpectedMigrationName, MigrationObjectDelta> = {
  '0001_init': {
    // pgcrypto removed from this migration (gen_random_uuid() is core in
    // PostgreSQL 13+, this project targets 16) -- it is never installed by
    // a fresh migration run, so it must never be part of the expected set.
    extensions: [],
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
    columns: [
      ...cols('users', [
        'id', 'email', 'password_hash', 'display_name', 'photo_url', 'ftp', 'weight_kg',
        'premium', 'email_verified', 'auth_provider', 'created_at', 'updated_at', 'deleted_at',
      ]),
      ...cols('roles', ['id', 'name']),
      ...cols('user_roles', ['user_id', 'role_id', 'granted_at']),
      ...cols('refresh_tokens', [
        'id', 'user_id', 'token_hash', 'expires_at', 'revoked_at',
        'replaced_by_token_hash', 'device_info', 'created_at',
      ]),
      ...cols('ride_sessions', [
        'id', 'user_id', 'start_time', 'end_time', 'distance_meters', 'calories_kcal',
        'last_power_watts', 'last_cadence_rpm', 'last_heart_rate_bpm', 'device_count', 'created_at',
      ]),
      ...cols('audit_log', ['id', 'user_id', 'action', 'metadata', 'created_at']),
    ],
  },
  '0002_users_email_case_insensitive_unique': {
    extensions: [],
    tables: [],
    indexes: ['users_email_lower_unique'],
    sequences: [],
    columns: [],
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
    columns: [
      ...cols('equipment_categories', ['code', 'label_es', 'label_en', 'is_ble_capable']),
      ...cols('equipment', [
        'id', 'user_id', 'category_code', 'parent_equipment_id', 'name', 'brand', 'model',
        'serial_number', 'firmware_version', 'hardware_revision', 'ble_name', 'ble_address',
        'status', 'battery_level', 'last_connected_at', 'last_calibrated_at', 'metadata',
        'total_distance_meters', 'total_duration_seconds', 'is_default', 'archived_at',
        'created_at', 'updated_at',
      ]),
    ],
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
    columns: [
      ...cols('workouts', [
        'id', 'owner_id', 'name', 'description', 'sport', 'estimated_duration_seconds',
        'target_type', 'is_public', 'archived_at', 'created_at', 'updated_at',
      ]),
      ...cols('workout_intervals', [
        'id', 'workout_id', 'position', 'duration_seconds', 'target_low', 'target_high', 'label',
      ]),
    ],
  },
  '0005_users_firebase_uid': {
    extensions: [],
    tables: [],
    indexes: ['users_firebase_uid_unique'],
    sequences: [],
    columns: cols('users', ['firebase_uid']),
  },
  '0006_tf0_5_pagination_indexes': {
    extensions: [],
    tables: [],
    indexes: ['idx_equipment_user_created_id', 'idx_workouts_owner_created_id', 'idx_workouts_visible_created_id'],
    sequences: [],
    columns: [],
  },
  '0007_drop_unused_ride_sessions': {
    extensions: [],
    tables: [],
    indexes: [],
    sequences: [],
    columns: [],
    // DROP TABLE removes the table, both indexes that belong to it and
    // every one of its columns. Keeping those removals explicit lets the
    // read-only Production inspector distinguish an applied 0007 from an
    // unexpectedly incomplete schema.
    removesTables: ['ride_sessions'],
    removes: ['idx_ride_sessions_user_start', 'ride_sessions_pkey'],
    removesColumns: cols('ride_sessions', [
      'id', 'user_id', 'start_time', 'end_time', 'distance_meters', 'calories_kcal',
      'last_power_watts', 'last_cadence_rpm', 'last_heart_rate_bpm', 'device_count', 'created_at',
    ]),
  },
};

/** Objetos propios del motor node-pg-migrate — nunca deben clasificarse
 * como parte del inventario de APLICACIÓN (ni faltantes ni sobrantes).
 * Nombre determinístico: `id SERIAL PRIMARY KEY` (runner.js) crea
 * `pgmigrations_pkey` + `pgmigrations_id_seq`. */
export const ENGINE_TRACKING_OBJECTS: { tables: string[]; indexes: string[]; sequences: string[] } = {
  tables: ['pgmigrations'],
  indexes: ['pgmigrations_pkey'],
  sequences: ['pgmigrations_id_seq'],
};

// =============================================================================
// PHASE 18-19 — clasificación del prefijo de migraciones aplicadas.
//
// REMEDIACIÓN P1-4: esta función YA NO decide "vacío probado" — un
// conjunto trackeado vacío es un prefijo válido y trivial
// (TRACKED_AND_CONSISTENT, applied=[]), exactamente igual que cualquier
// otro prefijo válido. La distinción CLEAN_EMPTY vs.
// HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING se decide después, en
// `runInspection`, cruzando `applied.length` con evidencia física real
// — nunca con la sola existencia/ausencia de la tabla `pgmigrations`.
// =============================================================================

export type MigrationPrefixClassification =
  | { state: 'TRACKED_AND_CONSISTENT'; applied: ExpectedMigrationName[]; pending: ExpectedMigrationName[] }
  | { state: 'INVALID_MIGRATION_ORDER'; reason: string }
  | { state: 'UNEXPECTED_MIGRATION_NAMES'; unexpected: string[] };

/**
 * Clasifica el conjunto de nombres trackeados en `pgmigrations`. Un
 * prefijo válido (ej. [], [0001], [0001,0002,0003]) es siempre
 * TRACKED_AND_CONSISTENT — nunca corrupción (Correction D). Solo un
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

  const expectedPrefix = EXPECTED_MIGRATION_NAMES.slice(0, trackedNames.length);
  for (let i = 0; i < expectedPrefix.length; i += 1) {
    if (trackedNames[i] !== expectedPrefix[i]) {
      return {
        state: 'INVALID_MIGRATION_ORDER',
        reason: `Posición ${i}: se esperaba '${expectedPrefix[i]}', se encontró '${trackedNames[i]}' — el conjunto trackeado no es un prefijo ordenado válido de las ${EXPECTED_MIGRATION_NAMES.length} migraciones conocidas.`,
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
  columns: Set<string>;
} {
  const tables = new Set<string>();
  const indexes = new Set<string>();
  const sequences = new Set<string>();
  const extensions = new Set<string>();
  const columns = new Set<string>();

  for (const name of applied) {
    const delta = EXPECTED_MIGRATION_OBJECTS[name];
    delta.tables.forEach((t) => tables.add(t));
    delta.indexes.forEach((i) => indexes.add(i));
    delta.sequences.forEach((s) => sequences.add(s));
    delta.extensions.forEach((e) => extensions.add(e));
    delta.columns.forEach((c) => columns.add(`${c.table}.${c.column}`));
    (delta.removesTables ?? []).forEach((t) => tables.delete(t));
    (delta.removes ?? []).forEach((r) => indexes.delete(r));
    (delta.removesColumns ?? []).forEach((c) => columns.delete(`${c.table}.${c.column}`));
  }

  return { tables, indexes, sequences, extensions, columns };
}

// =============================================================================
// REMEDIACIÓN P1-1/P1-5 — comparación físico-vs-esperado completa, en
// ambas direcciones, para las 5 categorías (tablas, índices,
// secuencias, extensión, columnas). Reemplaza la validación previa que
// solo comparaba `expected.tables` y dejaba `UNEXPECTED_SCHEMA_OBJECTS`
// estructuralmente inalcanzable.
// =============================================================================

export interface ExpectedPhysicalSet {
  tables: Set<string>;
  indexes: Set<string>;
  sequences: Set<string>;
  extensions: Set<string>;
  columns: Set<string>;
}

export interface ActualPhysicalInventory {
  tables: Set<string>;
  indexes: Set<string>;
  sequences: Set<string>;
  pgcryptoPresent: boolean;
  /** Formato `table.column`, sin filtrar — el filtrado por tabla
   * esperada ocurre dentro de `diffPhysicalSchema`. */
  columns: Set<string>;
}

export interface PhysicalDiff {
  missingTables: string[];
  missingIndexes: string[];
  missingSequences: string[];
  missingExtensions: string[];
  missingColumns: string[];
  unexpectedTables: string[];
  unexpectedIndexes: string[];
  unexpectedSequences: string[];
  /** Solo columnas sobrantes en tablas que SÍ son esperadas — una
   * tabla enteramente inesperada ya se reporta vía `unexpectedTables`;
   * evaluar sus columnas por separado sería redundante. */
  unexpectedColumns: string[];
}

export function diffPhysicalSchema(expected: ExpectedPhysicalSet, actual: ActualPhysicalInventory): PhysicalDiff {
  const missingTables = [...expected.tables].filter((t) => !actual.tables.has(t));
  const missingIndexes = [...expected.indexes].filter((i) => !actual.indexes.has(i));
  const missingSequences = [...expected.sequences].filter((s) => !actual.sequences.has(s));
  const missingExtensions = expected.extensions.has('pgcrypto') && !actual.pgcryptoPresent ? ['pgcrypto'] : [];
  const missingColumns = [...expected.columns].filter((c) => !actual.columns.has(c));

  const unexpectedTables = [...actual.tables].filter((t) => !expected.tables.has(t));
  const unexpectedIndexes = [...actual.indexes].filter((i) => !expected.indexes.has(i));
  const unexpectedSequences = [...actual.sequences].filter((s) => !expected.sequences.has(s));
  const unexpectedColumns = [...actual.columns].filter((c) => {
    const table = c.slice(0, c.indexOf('.'));
    return expected.tables.has(table) && !expected.columns.has(c);
  });

  return {
    missingTables,
    missingIndexes,
    missingSequences,
    missingExtensions,
    missingColumns,
    unexpectedTables,
    unexpectedIndexes,
    unexpectedSequences,
    unexpectedColumns,
  };
}

export type PhysicalSchemaClassification = 'MATCHES_APPLIED' | 'MISSING_EXPECTED_OBJECTS' | 'UNEXPECTED_SCHEMA_OBJECTS';

export interface PhysicalSchemaSummary {
  classification: PhysicalSchemaClassification;
  expected_present: string[];
  expected_missing: string[];
  unexpected_objects: string[];
}

const tag = (category: string, items: string[]): string[] => items.map((i) => `${category}:${i}`);

/** Aplana el diff categorizado al contrato de salida plano (Remediación
 * 19: `expected_present` / `expected_missing` / `unexpected_objects`),
 * conservando la precedencia MISSING > UNEXPECTED cuando ambos ocurren
 * a la vez (misma precedencia que el disposition final — Remediación
 * 11: HOLD_TRACKING_WITH_MISSING_OBJECTS antes que
 * HOLD_UNEXPECTED_SCHEMA_OBJECTS). */
export function summarizePhysicalDiff(expected: ExpectedPhysicalSet, diff: PhysicalDiff): PhysicalSchemaSummary {
  const expectedAll = [
    ...tag('table', [...expected.tables]),
    ...tag('index', [...expected.indexes]),
    ...tag('sequence', [...expected.sequences]),
    ...tag('extension', [...expected.extensions]),
    ...tag('column', [...expected.columns]),
  ];
  const missingAll = [
    ...tag('table', diff.missingTables),
    ...tag('index', diff.missingIndexes),
    ...tag('sequence', diff.missingSequences),
    ...tag('extension', diff.missingExtensions),
    ...tag('column', diff.missingColumns),
  ];
  const missingSet = new Set(missingAll);
  const expectedPresent = expectedAll.filter((item) => !missingSet.has(item));
  const unexpectedAll = [
    ...tag('table', diff.unexpectedTables),
    ...tag('index', diff.unexpectedIndexes),
    ...tag('sequence', diff.unexpectedSequences),
    ...tag('column', diff.unexpectedColumns),
  ];

  const classification: PhysicalSchemaClassification =
    missingAll.length > 0 ? 'MISSING_EXPECTED_OBJECTS' : unexpectedAll.length > 0 ? 'UNEXPECTED_SCHEMA_OBJECTS' : 'MATCHES_APPLIED';

  return { classification, expected_present: expectedPresent, expected_missing: missingAll, unexpected_objects: unexpectedAll };
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

/** REMEDIACIÓN P1-7: el filtro `WHERE rolname IN (...)` de
 * `roleCapabilities` simplemente devuelve menos filas si un rol
 * objetivo no existe — nada lo detectaba. Compara el conjunto de
 * `rolname` realmente devueltos contra `TARGET_ROLES` exacto. */
export function findMissingExpectedRoles(rows: RoleCapabilityRow[]): string[] {
  const present = new Set(rows.map((r) => r.rolname));
  return TARGET_ROLES.filter((r) => !present.has(r));
}

// =============================================================================
// REMEDIACIÓN — membresía en `cloudsqlsuperuser` (7.1). Se alimenta al
// MISMO array que `findPrivilegeEscalations` (nunca una disposición
// separada silenciosa) para que `HOLD_ROLE_PRIVILEGE_ESCALATION` la
// cubra automáticamente — el literal "cloudsqlsuperuser" en el mensaje
// es lo que hace la semántica inequívoca y testeable, no una disposición
// nueva.
// =============================================================================

export interface RoleMembershipRow {
  member_role: string;
  granted_role: string;
}

export function findCloudSqlSuperuserMemberships(rows: RoleMembershipRow[]): string[] {
  return rows.filter((r) => r.granted_role === CLOUDSQLSUPERUSER_ROLE).map((r) => `${r.member_role}: membresía insegura en cloudsqlsuperuser`);
}

// =============================================================================
// REMEDIACIÓN — acceso runtime a `pgmigrations` (7.2). Violación
// automática, nunca `UNPROVEN_REQUIRES_REVIEW`: cualquier privilegio del
// runtime (SELECT incluido) sobre la tabla de tracking del motor de
// migración es HOLD. Reusa las filas YA recolectadas por
// `tablePrivileges` (cross-join sin filtro de nombre de tabla) — no
// requiere ninguna consulta nueva.
// =============================================================================

export function findPgmigrationsRuntimeAccessViolations(tableRows: TablePrivilegeRow[], runtimeRoleName: string): string[] {
  const violations: string[] = [];
  for (const row of tableRows) {
    if (row.table_name !== 'pgmigrations' || row.rolname !== runtimeRoleName) continue;
    if (row.can_select) violations.push(`${runtimeRoleName}: SELECT inesperado en pgmigrations`);
    if (row.can_insert) violations.push(`${runtimeRoleName}: INSERT inesperado en pgmigrations`);
    if (row.can_update) violations.push(`${runtimeRoleName}: UPDATE inesperado en pgmigrations`);
    if (row.can_delete) violations.push(`${runtimeRoleName}: DELETE inesperado en pgmigrations`);
    if (row.can_truncate) violations.push(`${runtimeRoleName}: TRUNCATE inesperado en pgmigrations`);
    if (row.can_trigger) violations.push(`${runtimeRoleName}: TRIGGER inesperado en pgmigrations`);
    if (row.can_references) violations.push(`${runtimeRoleName}: REFERENCES inesperado en pgmigrations`);
  }
  return violations;
}

// =============================================================================
// REMEDIACIÓN — drift de privilegios runtime vs. la matriz mínima
// (7.3). Única fuente de verdad compartida con `privilege-reconciler.ts`
// (`runtime-privilege-matrix.ts`) — evita que inspector y reconciliador
// diverjan silenciosamente. Cubre en ambas direcciones: privilegio
// requerido por la matriz pero ausente (`missing`), y privilegio real
// que la matriz nunca autorizó (`unexpected`) — incluye CREATE en schema
// public y TRUNCATE/TRIGGER/REFERENCES en cualquier tabla (la matriz
// nunca los autoriza para ninguna). Cualquier tabla/secuencia con
// privilegio real que ni siquiera aparece en la matriz (p. ej.
// `pgmigrations`, o una tabla futura sin entrada todavía) también cuenta
// como `unexpected` acá — redundante a propósito con
// `findPgmigrationsRuntimeAccessViolations`, que ya la cubre por
// separado con un mensaje específico.
// =============================================================================

export interface RuntimePrivilegeDrift {
  missing: string[];
  unexpected: string[];
}

export function diffRuntimePrivilegesAgainstMatrix(
  tableRows: TablePrivilegeRow[],
  sequenceRows: SequencePrivilegeRow[],
  schemaCreateRow: { rolname: string; can_schema_create: boolean } | undefined,
  runtimeRoleName: string,
): RuntimePrivilegeDrift {
  const missing: string[] = [];
  const unexpected: string[] = [];

  const runtimeTableRows = tableRows.filter((r) => r.rolname === runtimeRoleName);
  const matrixTableNames = new Set(Object.keys(RUNTIME_TABLE_PRIVILEGE_MATRIX));

  for (const [table, entry] of Object.entries(RUNTIME_TABLE_PRIVILEGE_MATRIX)) {
    const row = runtimeTableRows.find((r) => r.table_name === table);
    const actual = {
      select: row?.can_select ?? false,
      insert: row?.can_insert ?? false,
      update: row?.can_update ?? false,
      delete: row?.can_delete ?? false,
    };
    (['select', 'insert', 'update', 'delete'] as const).forEach((verb) => {
      if (entry[verb] && !actual[verb]) missing.push(`table:${table}:${verb}`);
      if (!entry[verb] && actual[verb]) unexpected.push(`table:${table}:${verb}`);
    });
    if (row?.can_truncate) unexpected.push(`table:${table}:truncate`);
    if (row?.can_trigger) unexpected.push(`table:${table}:trigger`);
    if (row?.can_references) unexpected.push(`table:${table}:references`);
  }

  for (const row of runtimeTableRows) {
    if (matrixTableNames.has(row.table_name)) continue;
    if (row.can_select || row.can_insert || row.can_update || row.can_delete || row.can_truncate || row.can_trigger || row.can_references) {
      unexpected.push(`table:${row.table_name}:unexpected_access`);
    }
  }

  const runtimeSequenceRows = sequenceRows.filter((r) => r.rolname === runtimeRoleName);
  const matrixSequenceNames = new Set(Object.keys(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX));

  for (const [sequence, entry] of Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)) {
    const row = runtimeSequenceRows.find((r) => r.sequence_name === sequence);
    const hasUsage = row?.can_usage ?? false;
    if (entry.usage && !hasUsage) missing.push(`sequence:${sequence}:usage`);
    if (!entry.usage && hasUsage) unexpected.push(`sequence:${sequence}:usage`);
  }

  for (const row of runtimeSequenceRows) {
    if (matrixSequenceNames.has(row.sequence_name)) continue;
    if (row.can_usage || row.can_select || row.can_update) unexpected.push(`sequence:${row.sequence_name}:unexpected_access`);
  }

  if (schemaCreateRow?.can_schema_create) {
    unexpected.push('schema:public:create');
  }

  return { missing, unexpected };
}

// =============================================================================
// PHASE 21 — esquema de resultado. Solo estos campos; nunca DATABASE_URL,
// password, ni ningún dato de una tabla de aplicación.
// =============================================================================

export interface TablePrivilegeRow {
  rolname: string;
  table_name: string;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_references: boolean;
  can_trigger: boolean;
}

export interface SequencePrivilegeRow {
  rolname: string;
  sequence_name: string;
  can_usage: boolean;
  can_select: boolean;
  can_update: boolean;
}

export interface InspectionResult {
  inspection_version: string;
  source_sha: string;
  migration_set_hash: string;
  database_identity: { database: string; current_user: string; session_user: string };
  read_only: { transaction_read_only: string };
  /** `null` cuando la consulta de ownership no devolvió exactamente 1
   * fila — nunca un string vacío silencioso (P1-6). */
  database_owner: string | null;
  public_schema_owner: string | null;
  roles: {
    capabilities: RoleCapabilityRow[];
    direct_memberships: { member_role: string; granted_role: string }[];
    privilege_escalation_findings: string[];
    missing_expected_roles: string[];
  };
  privileges: {
    database: { rolname: string; can_connect: boolean; can_schema_usage: boolean; can_schema_create: boolean }[];
    tables: TablePrivilegeRow[];
    sequences: SequencePrivilegeRow[];
  };
  object_owners: { schema: string; object_name: string; object_type: string; owner: string }[];
  pgmigrations: {
    exists: boolean;
    classification: MigrationPrefixClassification;
    /** Cualquier privilegio del runtime (SELECT incluido) sobre esta
     * tabla — violación automática, nunca `UNPROVEN_REQUIRES_REVIEW`. */
    runtime_access_violations: string[];
  };
  physical_schema: PhysicalSchemaSummary;
  /** Comparación del runtime real contra `runtime-privilege-matrix.ts`
   * — `missing` = requerido por la matriz pero ausente; `unexpected` =
   * presente pero la matriz nunca lo autorizó (incluye CREATE en schema
   * public y cualquier privilegio fuera de la matriz). Cualquier
   * `unexpected` bloquea (ver `HOLD_RUNTIME_PRIVILEGE_DRIFT`). */
  runtime_privilege_drift: RuntimePrivilegeDrift;
  pgcrypto_present: boolean;
  /** Solo prueba que la credencial autenticó como el login esperado —
   * NUNCA que el modelo completo de ownership/privilegios está
   * correcto (P1-3). */
  credential_db_user_mapping: 'MATCHES_EXPECTED' | 'CREDENTIAL_DB_USER_MISMATCH';
  /** OBVIOUS_VIOLATION solo cuando la evidencia YA recolectada prueba
   * una violación (korixa_runtime dueño de objetos de aplicación, o
   * escalamiento de privilegio). En cualquier otro caso,
   * UNPROVEN_REQUIRES_REVIEW — el modelo completo nunca se declara
   * probado automáticamente solo por identidad de credencial. */
  db_role_model: 'UNPROVEN_REQUIRES_REVIEW' | 'OBVIOUS_VIOLATION';
  production_schema_state: string;
  final_disposition:
    | 'CLEAN_EMPTY'
    | 'TRACKED_AND_CONSISTENT'
    | 'HOLD_ROLE_PRIVILEGE_ESCALATION'
    | 'HOLD_EXPECTED_ROLE_MISSING'
    | 'HOLD_OWNER_UNRESOLVED'
    | 'HOLD_PGMIGRATIONS_RUNTIME_ACCESS'
    | 'HOLD_RUNTIME_PRIVILEGE_DRIFT'
    | 'HOLD_UNEXPECTED_MIGRATION_NAMES'
    | 'HOLD_INVALID_MIGRATION_ORDER'
    | 'HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING'
    | 'HOLD_TRACKING_WITH_MISSING_OBJECTS'
    | 'HOLD_UNEXPECTED_SCHEMA_OBJECTS'
    | 'HOLD_INCONSISTENT_OWNER_MODEL'
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

/** Extrae el `owner` de una consulta de ownership de-base/schema que
 * DEBE devolver exactamente 1 fila — `null` en cualquier otro caso
 * (0 o >1 filas, u owner vacío), nunca un string vacío silencioso
 * (P1-6). */
function resolveExactlyOneOwner(rows: { owner: string }[]): string | null {
  if (rows.length !== 1) return null;
  const owner = rows[0]?.owner;
  return owner ? owner : null;
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
    // P2-10: sin override de `ssl` — se deja que `pg`/el propio
    // DATABASE_URL controlen el transporte, en vez de forzar
    // `rejectUnauthorized: false` (que debilitaba la verificación de
    // identidad del servidor incondicionalmente). El comportamiento
    // real de TLS contra Cloud SQL se prueba en el ensayo NONPROD, sin
    // debilitar nada aquí para que "pase".
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

    let credentialDbUserMapping: InspectionResult['credential_db_user_mapping'] = 'MATCHES_EXPECTED';
    if (identity.current_user !== EXPECTED_DB_USER) {
      credentialDbUserMapping = 'CREDENTIAL_DB_USER_MISMATCH';
      // Fail-closed inmediato: no se continúa con inspección de catálogo
      // amplia bajo una credencial cuyo mapeo real no coincide con lo
      // esperado — podría ser un rol más privilegiado que korixa_runtime.
      throw new InspectorError(
        'CREDENTIAL_DB_USER_MISMATCH',
        `current_user real ('${identity.current_user}') no coincide con el usuario esperado ('${EXPECTED_DB_USER}') — DB_ROLE_MAPPING permanecía UNPROVEN, no se asume. Deteniendo inspección de catálogo amplia.`,
        { actual_current_user: identity.current_user },
      );
    }

    const [
      roleCapsResult,
      membershipsResult,
      dbOwnerResult,
      schemaOwnerResult,
      objectOwnersResult,
      dbPrivilegesResult,
      tablePrivilegesResult,
      sequencePrivilegesResult,
      indexInventoryResult,
      columnInventoryResult,
      pgcryptoResult,
    ] = await Promise.all([
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
      client.query(INSPECTION_QUERIES.databasePrivileges).catch(() => {
        throw sanitizeUnexpectedError('PRIVILEGE_QUERY_FAILED', 'Falló la consulta de privilegios de base de datos');
      }),
      client.query(INSPECTION_QUERIES.tablePrivileges).catch(() => {
        throw sanitizeUnexpectedError('PRIVILEGE_QUERY_FAILED', 'Falló la consulta de privilegios de tabla');
      }),
      client.query(INSPECTION_QUERIES.sequencePrivileges).catch(() => {
        throw sanitizeUnexpectedError('PRIVILEGE_QUERY_FAILED', 'Falló la consulta de privilegios de secuencia');
      }),
      client.query(INSPECTION_QUERIES.indexInventory).catch(() => {
        throw sanitizeUnexpectedError('PHYSICAL_SCHEMA_QUERY_FAILED', 'Falló el inventario de índices');
      }),
      client.query(INSPECTION_QUERIES.columnInventory).catch(() => {
        throw sanitizeUnexpectedError('PHYSICAL_SCHEMA_QUERY_FAILED', 'Falló el inventario de columnas');
      }),
      client.query(INSPECTION_QUERIES.pgcryptoPresent).catch(() => {
        throw sanitizeUnexpectedError('PHYSICAL_SCHEMA_QUERY_FAILED', 'Falló la verificación de pgcrypto');
      }),
    ]);

    const roleCapabilities = roleCapsResult.rows as RoleCapabilityRow[];
    const cloudSqlSuperuserFindings = findCloudSqlSuperuserMemberships(membershipsResult.rows as RoleMembershipRow[]);
    // Mismo array/disposition que el resto de privilege escalation
    // findings (7.1) — nunca una rama separada silenciosa.
    const privilegeEscalationFindings = [...findPrivilegeEscalations(roleCapabilities), ...cloudSqlSuperuserFindings];
    const missingExpectedRoles = findMissingExpectedRoles(roleCapabilities);
    const pgmigrationsAccessViolations = findPgmigrationsRuntimeAccessViolations(tablePrivilegesResult.rows as TablePrivilegeRow[], EXPECTED_DB_USER);
    const runtimeSchemaCreateRow = (dbPrivilegesResult.rows as { rolname: string; can_schema_create: boolean }[]).find(
      (r) => r.rolname === EXPECTED_DB_USER,
    );
    const runtimePrivilegeDrift = diffRuntimePrivilegesAgainstMatrix(
      tablePrivilegesResult.rows as TablePrivilegeRow[],
      sequencePrivilegesResult.rows as SequencePrivilegeRow[],
      runtimeSchemaCreateRow,
      EXPECTED_DB_USER,
    );

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

    const objectOwners = objectOwnersResult.rows as {
      schema: string;
      object_name: string;
      object_type: string;
      owner: string;
    }[];
    const isEngineObject = (name: string) => ENGINE_TRACKING_OBJECTS.tables.includes(name) || ENGINE_TRACKING_OBJECTS.sequences.includes(name);
    const applicationObjects = objectOwners.filter((o) => !isEngineObject(o.object_name));
    const applicationObjectOwners = applicationObjects.map((o) => o.owner);
    const ownerModel = classifyOwnerModel(applicationObjectOwners, applicationObjectOwners.length > 0);

    const actualTables = new Set(applicationObjects.filter((o) => o.object_type === 'table' || o.object_type === 'partitioned_table').map((o) => o.object_name));
    const actualSequences = new Set(applicationObjects.filter((o) => o.object_type === 'sequence').map((o) => o.object_name));
    const actualIndexes = new Set(
      (indexInventoryResult.rows as { indexname: string }[]).map((r) => r.indexname).filter((name) => !ENGINE_TRACKING_OBJECTS.indexes.includes(name)),
    );
    const actualColumns = new Set(
      (columnInventoryResult.rows as { table_name: string; column_name: string }[])
        .filter((r) => !ENGINE_TRACKING_OBJECTS.tables.includes(r.table_name))
        .map((r) => `${r.table_name}.${r.column_name}`),
    );
    const pgcryptoPresent = Boolean(pgcryptoResult.rows[0]?.pgcrypto_present);

    const applied = migrationClassification.state === 'TRACKED_AND_CONSISTENT' ? migrationClassification.applied : [];
    const expected = expectedObjectsForApplied(applied);
    const diff = diffPhysicalSchema(expected, {
      tables: actualTables,
      indexes: actualIndexes,
      sequences: actualSequences,
      pgcryptoPresent,
      columns: actualColumns,
    });
    const physicalSchema = summarizePhysicalDiff(expected, diff);

    const databaseOwner = resolveExactlyOneOwner(dbOwnerResult.rows as { owner: string }[]);
    const publicSchemaOwner = resolveExactlyOneOwner(schemaOwnerResult.rows as { owner: string }[]);
    const ownerUnresolved = databaseOwner === null || publicSchemaOwner === null;

    // REMEDIACIÓN P1-4: CLEAN_EMPTY y HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING
    // ahora se derivan de `applied.length` (evidencia REAL de qué se
    // trackeó como aplicado) cruzado con presencia física de objetos de
    // APLICACIÓN — nunca de la sola existencia/ausencia de la tabla
    // `pgmigrations`. Esto cubre los 4 casos de la Remediación 4:
    //   A. pgmigrations ausente + sin objetos de app       -> CLEAN_EMPTY
    //   B. pgmigrations existe vacía + sin objetos de app  -> CLEAN_EMPTY
    //   C. pgmigrations existe vacía + objetos de app       -> HOLD
    //   D. pgmigrations ausente + objetos de app            -> HOLD
    // `pgmigrations.exists` se reporta siempre en el resultado, sin
    // importar cuál de estos casos aplique.
    const hasApplicationObjects = applicationObjectOwners.length > 0;
    const isCleanEmpty = applied.length === 0 && !hasApplicationObjects;
    const isPhysicalWithoutTracking = applied.length === 0 && hasApplicationObjects;

    let finalDisposition: InspectionResult['final_disposition'];
    if (privilegeEscalationFindings.length > 0) {
      finalDisposition = 'HOLD_ROLE_PRIVILEGE_ESCALATION';
    } else if (missingExpectedRoles.length > 0) {
      finalDisposition = 'HOLD_EXPECTED_ROLE_MISSING';
    } else if (ownerUnresolved) {
      finalDisposition = 'HOLD_OWNER_UNRESOLVED';
    } else if (pgmigrationsAccessViolations.length > 0) {
      // 7.2 — violación automática, nunca UNPROVEN_REQUIRES_REVIEW.
      finalDisposition = 'HOLD_PGMIGRATIONS_RUNTIME_ACCESS';
    } else if (runtimePrivilegeDrift.unexpected.length > 0 || runtimePrivilegeDrift.missing.length > 0) {
      // 7.3 — cualquier exceso ('unexpected') bloquea; un privilegio
      // requerido pero ausente ('missing') también produce disposición
      // explícita, nunca un PASS silencioso sobre un runtime incompleto.
      finalDisposition = 'HOLD_RUNTIME_PRIVILEGE_DRIFT';
    } else if (migrationClassification.state === 'UNEXPECTED_MIGRATION_NAMES') {
      finalDisposition = 'HOLD_UNEXPECTED_MIGRATION_NAMES';
    } else if (migrationClassification.state === 'INVALID_MIGRATION_ORDER') {
      finalDisposition = 'HOLD_INVALID_MIGRATION_ORDER';
    } else if (isPhysicalWithoutTracking) {
      finalDisposition = 'HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING';
    } else if (physicalSchema.classification === 'MISSING_EXPECTED_OBJECTS') {
      finalDisposition = 'HOLD_TRACKING_WITH_MISSING_OBJECTS';
    } else if (physicalSchema.classification === 'UNEXPECTED_SCHEMA_OBJECTS') {
      finalDisposition = 'HOLD_UNEXPECTED_SCHEMA_OBJECTS';
    } else if (ownerModel === 'CASE_C_RUNTIME_OWNER_VIOLATION' || ownerModel === 'CASE_D_MIXED_OWNERSHIP') {
      finalDisposition = 'HOLD_INCONSISTENT_OWNER_MODEL';
    } else if (ownerModel === 'UNKNOWN' && hasApplicationObjects) {
      finalDisposition = 'HOLD_UNKNOWN';
    } else if (isCleanEmpty) {
      finalDisposition = 'CLEAN_EMPTY';
    } else {
      finalDisposition = 'TRACKED_AND_CONSISTENT';
    }

    // REMEDIACIÓN P1-3: `db_role_model` nunca se declara probado solo
    // por la identidad de la credencial — únicamente refleja una
    // violación OBVIA ya confirmada por evidencia recolectada
    // (ownership o escalamiento de privilegio). Cualquier otro caso
    // exige revisión humana explícita del resto de la evidencia
    // (privilegios de tabla/secuencia, membresías, etc.) antes de
    // declarar el modelo completo correcto.
    const dbRoleModel: InspectionResult['db_role_model'] =
      ownerModel === 'CASE_C_RUNTIME_OWNER_VIOLATION' ||
      privilegeEscalationFindings.length > 0 ||
      pgmigrationsAccessViolations.length > 0 ||
      runtimePrivilegeDrift.unexpected.length > 0
        ? 'OBVIOUS_VIOLATION'
        : 'UNPROVEN_REQUIRES_REVIEW';

    const result: InspectionResult = {
      inspection_version: '2.0.0',
      source_sha: env.EXPECTED_SOURCE_SHA,
      migration_set_hash: env.EXPECTED_MIGRATION_SET_HASH,
      database_identity: identity,
      read_only: { transaction_read_only: transactionReadOnly },
      database_owner: databaseOwner,
      public_schema_owner: publicSchemaOwner,
      roles: {
        capabilities: roleCapabilities,
        direct_memberships: membershipsResult.rows,
        privilege_escalation_findings: privilegeEscalationFindings,
        missing_expected_roles: missingExpectedRoles,
      },
      privileges: {
        database: dbPrivilegesResult.rows,
        tables: tablePrivilegesResult.rows,
        sequences: sequencePrivilegesResult.rows,
      },
      object_owners: objectOwners,
      pgmigrations: { exists: pgmigrationsExists, classification: migrationClassification, runtime_access_violations: pgmigrationsAccessViolations },
      runtime_privilege_drift: runtimePrivilegeDrift,
      physical_schema: physicalSchema,
      pgcrypto_present: pgcryptoPresent,
      credential_db_user_mapping: credentialDbUserMapping,
      db_role_model: dbRoleModel,
      production_schema_state: finalDisposition,
      final_disposition: finalDisposition,
    };

    await client.query(INSPECTION_QUERIES.rollback);
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

if (require.main === module) {
  runInspection()
    .then((result) => {
      // Único punto de salida de evidencia — JSON estructurado, campos
      // aprobados únicamente (ver InspectionResult). Nunca DATABASE_URL.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      // P2-9: `process.exitCode` en vez de `process.exit()` inmediato —
      // deja que Node vacíe naturalmente los buffers de stdout antes de
      // terminar, en vez de arriesgar truncar el JSON de evidencia bajo
      // backpressure (comportamiento documentado de Node cuando stdout
      // es un pipe no-TTY, como en Cloud Run).
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      // P3-12: `unknown` + `instanceof` en tiempo de ejecución — ya no
      // se asume por anotación de TypeScript que todo lo que rechaza
      // la promesa es un InspectorError ya saneado. Cualquier error
      // inesperado que de algún modo evada el saneamiento interno de
      // `runInspection` se colapsa a un código fijo, sin serializar
      // jamás el objeto crudo/su mensaje/su stack.
      const safe =
        error instanceof InspectorError
          ? { error_code: error.code, message: error.message, evidence: error.evidence }
          : {
              error_code: 'UNEXPECTED_INSPECTOR_ERROR' as InspectorErrorCode,
              message: 'Ocurrió un error inesperado durante la inspección, de un tipo no reconocido — nunca se serializa el error crudo, su mensaje ni su stack.',
              evidence: undefined,
            };
      process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
      process.exitCode = 1;
    });
}
