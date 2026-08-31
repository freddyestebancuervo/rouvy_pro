/**
 * Runtime privilege audit — lógica PURA compartida entre
 * `privilege-reconciler.ts` (para su propio gate PRE-GRANT/POST-GRANT,
 * fail-closed) y `db-readonly-inspector.ts` (para clasificar HOLD).
 *
 * T-F1.2 — KORIXA_TF12_PRIVILEGE_MODEL_REMEDIATION, remediación P1-1/
 * P1-2/P1-3 tras auditoría independiente de PR #106:
 *
 *   P1-1  El reconciliador ya NO se limita a ejecutar los GRANT de la
 *         matriz y asumir éxito — usa esta misma lógica de diff ANTES
 *         de otorgar nada (falla cerrado si el runtime YA tiene
 *         cualquier privilegio fuera de lo esperado — un `missing`
 *         puro, sin `unexpected`, es normal pre-grant) y de nuevo
 *         DESPUÉS de otorgar, dentro de la misma transacción, exigiendo
 *         estado EXACTO (missing=0 Y unexpected=0) antes de permitirse
 *         declarar `RECONCILED`.
 *   P1-2  `diffRuntimePrivilegesAgainstMatrix` ahora evalúa los TRES
 *         privilegios de cada secuencia de la matriz (USAGE/SELECT/
 *         UPDATE), no solo USAGE — un SELECT o UPDATE extra sobre
 *         `audit_log_id_seq` se reporta como
 *         `sequence:audit_log_id_seq:select` /
 *         `sequence:audit_log_id_seq:update`, nunca oculto dentro de un
 *         genérico "unexpected_access".
 *   P1-3  La membresía en `cloudsqlsuperuser` ya no se busca solo como
 *         arista directa — el LLAMADOR (reconciler/inspector) debe
 *         alimentar `findCloudSqlSuperuserMemberships` con el CIERRE
 *         TRANSITIVO completo de membresías (ver
 *         `TRANSITIVE_ROLE_MEMBERSHIP_QUERY` en ambos archivos, una
 *         CTE recursiva sobre `pg_auth_members`), no solo la arista
 *         directa — así que `runtime -> intermediate -> cloudsqlsuperuser`
 *         se detecta igual que `runtime -> cloudsqlsuperuser`.
 *
 * COMMON-MODE SAFETY: además del diff derivado de la matriz (que SÍ
 * podría estar mal si alguien edita `runtime-privilege-matrix.ts` por
 * error), este archivo expone invariantes HARDCODEADOS que nunca leen
 * la matriz — `findPgmigrationsRuntimeAccessViolations`,
 * `findPgmigrationsIdSeqRuntimeAccessViolations` y
 * `findAuditLogHardcodedShapeViolations` siguen siendo verdaderas
 * incluso si la matriz compartida se corrompiera, porque no dependen
 * de ella en absoluto.
 */

import { RUNTIME_TABLE_PRIVILEGE_MATRIX, RUNTIME_SEQUENCE_PRIVILEGE_MATRIX } from './runtime-privilege-matrix';

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

export interface RoleMembershipRow {
  member_role: string;
  granted_role: string;
}

export interface SchemaCreatePrivilegeRow {
  rolname: string;
  can_schema_create: boolean;
}

const CLOUDSQLSUPERUSER_ROLE = 'cloudsqlsuperuser';
const PGMIGRATIONS_TABLE = 'pgmigrations';
const PGMIGRATIONS_SEQUENCE = 'pgmigrations_id_seq';

// =============================================================================
// CTE recursiva de cierre transitivo de membresías — misma consulta,
// literal, en `privilege-reconciler.ts` y `db-readonly-inspector.ts`
// (cada uno la parametriza a su manera: el reconciliador por
// `current_user`/runtime role vía $1, el inspector por
// `TARGET_ROLES` fijo). `depth < 20` es una guardia defensiva —
// PostgreSQL ya impide crear ciclos reales de membresía de roles
// (un GRANT que crearía un ciclo falla en el propio servidor), así
// que nunca debería alcanzarse en la práctica; UNION (no UNION ALL)
// deduplica y ayuda a terminar antes en cualquier caso.
// =============================================================================
export const TRANSITIVE_ROLE_MEMBERSHIP_CTE = `
  WITH RECURSIVE role_closure(member_role, granted_role, depth) AS (
    SELECT m.rolname, r.rolname, 1
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles r ON r.oid = am.roleid
    WHERE m.rolname = ANY($1)
    UNION
    SELECT rc.member_role, r2.rolname, rc.depth + 1
    FROM role_closure rc
    JOIN pg_roles gr ON gr.rolname = rc.granted_role
    JOIN pg_auth_members am2 ON am2.member = gr.oid
    JOIN pg_roles r2 ON r2.oid = am2.roleid
    WHERE rc.depth < 20
  )
  SELECT DISTINCT member_role, granted_role FROM role_closure;
`;

/** Deny-by-default: ninguna membresía de rol runtime está esperada hoy.
 * Si Korixa llega a necesitar una legítima, se agrega ACÁ, explícita y
 * revisada — nunca inferida de una membresía histórica encontrada en
 * vivo (ver header del archivo). */
export const EXPECTED_RUNTIME_ROLE_MEMBERSHIPS: readonly string[] = [];

// =============================================================================
// P1-3 — cloudsqlsuperuser, directo o transitivo. El llamador DEBE
// alimentar esta función con filas que ya incluyan el cierre
// transitivo completo (`TRANSITIVE_ROLE_MEMBERSHIP_CTE`) — esta
// función en sí misma solo filtra `granted_role === cloudsqlsuperuser`,
// sin importar si esa arista es directa o fue derivada.
// =============================================================================
export function findCloudSqlSuperuserMemberships(rows: RoleMembershipRow[]): string[] {
  return rows.filter((r) => r.granted_role === CLOUDSQLSUPERUSER_ROLE).map((r) => `${r.member_role}: membresía insegura (directa o transitiva) en cloudsqlsuperuser`);
}

/** Deny-by-default para CUALQUIER membresía del runtime role — evalúa
 * únicamente aristas DIRECTAS (no el cierre transitivo, que es un
 * concepto distinto usado solo para el caso cloudsqlsuperuser) contra
 * `EXPECTED_RUNTIME_ROLE_MEMBERSHIPS`. */
export function findUnexpectedRuntimeRoleMemberships(directMembershipRows: RoleMembershipRow[], runtimeRoleName: string): string[] {
  const allowlist = new Set(EXPECTED_RUNTIME_ROLE_MEMBERSHIPS);
  return directMembershipRows
    .filter((r) => r.member_role === runtimeRoleName && !allowlist.has(r.granted_role))
    .map((r) => `${runtimeRoleName}: membresía inesperada en "${r.granted_role}" (EXPECTED_RUNTIME_ROLE_MEMBERSHIPS = [])`);
}

// =============================================================================
// Invariantes HARDCODEADOS — nunca leen ninguna matriz. Ver header.
// =============================================================================

export function findPgmigrationsRuntimeAccessViolations(tableRows: TablePrivilegeRow[], runtimeRoleName: string): string[] {
  const violations: string[] = [];
  for (const row of tableRows) {
    if (row.table_name !== PGMIGRATIONS_TABLE || row.rolname !== runtimeRoleName) continue;
    if (row.can_select) violations.push(`${runtimeRoleName}: SELECT inesperado en ${PGMIGRATIONS_TABLE}`);
    if (row.can_insert) violations.push(`${runtimeRoleName}: INSERT inesperado en ${PGMIGRATIONS_TABLE}`);
    if (row.can_update) violations.push(`${runtimeRoleName}: UPDATE inesperado en ${PGMIGRATIONS_TABLE}`);
    if (row.can_delete) violations.push(`${runtimeRoleName}: DELETE inesperado en ${PGMIGRATIONS_TABLE}`);
    if (row.can_truncate) violations.push(`${runtimeRoleName}: TRUNCATE inesperado en ${PGMIGRATIONS_TABLE}`);
    if (row.can_trigger) violations.push(`${runtimeRoleName}: TRIGGER inesperado en ${PGMIGRATIONS_TABLE}`);
    if (row.can_references) violations.push(`${runtimeRoleName}: REFERENCES inesperado en ${PGMIGRATIONS_TABLE}`);
  }
  return violations;
}

/** P1-1A — mismo invariante que la tabla, para su secuencia de
 * tracking. USAGE/SELECT/UPDATE deben ser FALSE los tres. */
export function findPgmigrationsIdSeqRuntimeAccessViolations(sequenceRows: SequencePrivilegeRow[], runtimeRoleName: string): string[] {
  const violations: string[] = [];
  for (const row of sequenceRows) {
    if (row.sequence_name !== PGMIGRATIONS_SEQUENCE || row.rolname !== runtimeRoleName) continue;
    if (row.can_usage) violations.push(`${runtimeRoleName}: USAGE inesperado en ${PGMIGRATIONS_SEQUENCE}`);
    if (row.can_select) violations.push(`${runtimeRoleName}: SELECT inesperado en ${PGMIGRATIONS_SEQUENCE}`);
    if (row.can_update) violations.push(`${runtimeRoleName}: UPDATE inesperado en ${PGMIGRATIONS_SEQUENCE}`);
  }
  return violations;
}

/** Forma exacta esperada de `audit_log`/`audit_log_id_seq`, escrita
 * literal acá — NUNCA derivada de `RUNTIME_TABLE_PRIVILEGE_MATRIX`/
 * `RUNTIME_SEQUENCE_PRIVILEGE_MATRIX` — para que un error al editar la
 * matriz compartida no pueda arrastrar consigo, sin darse cuenta,
 * también a este chequeo independiente. Devuelve violaciones tanto por
 * exceso como por defecto — pensado para usarse cuando se espera
 * estado FINAL exacto (p. ej. POST-GRANT), no durante PRE-GRANT (donde
 * "falta INSERT" es normal, todavía no se otorgó nada). */
export function findAuditLogHardcodedShapeViolations(
  tableRows: TablePrivilegeRow[],
  sequenceRows: SequencePrivilegeRow[],
  runtimeRoleName: string,
): string[] {
  const violations: string[] = [];
  const auditLog = tableRows.find((r) => r.table_name === 'audit_log' && r.rolname === runtimeRoleName);
  if (auditLog) {
    if (!auditLog.can_insert) violations.push(`${runtimeRoleName}: falta INSERT en audit_log (invariante hardcoded)`);
    if (auditLog.can_select) violations.push(`${runtimeRoleName}: SELECT inesperado en audit_log (invariante hardcoded)`);
    if (auditLog.can_update) violations.push(`${runtimeRoleName}: UPDATE inesperado en audit_log (invariante hardcoded)`);
    if (auditLog.can_delete) violations.push(`${runtimeRoleName}: DELETE inesperado en audit_log (invariante hardcoded)`);
  }
  const auditLogSeq = sequenceRows.find((r) => r.sequence_name === 'audit_log_id_seq' && r.rolname === runtimeRoleName);
  if (auditLogSeq) {
    if (!auditLogSeq.can_usage) violations.push(`${runtimeRoleName}: falta USAGE en audit_log_id_seq (invariante hardcoded)`);
    if (auditLogSeq.can_select) violations.push(`${runtimeRoleName}: SELECT inesperado en audit_log_id_seq (invariante hardcoded)`);
    if (auditLogSeq.can_update) violations.push(`${runtimeRoleName}: UPDATE inesperado en audit_log_id_seq (invariante hardcoded)`);
  }
  return violations;
}

/** ¿current_user tiene CREATE en schema public? Se reporta como
 * `schema:public:create` dentro de `unexpected` — el runtime NUNCA lo
 * autoriza, sin importar la matriz. */
export function findRuntimeSchemaCreateViolation(schemaCreateRow: SchemaCreatePrivilegeRow | undefined): boolean {
  return Boolean(schemaCreateRow?.can_schema_create);
}

// =============================================================================
// P1-2 — drift completo tabla+secuencia (los TRES privilegios por
// secuencia) contra la matriz compartida. Usado tanto por el
// reconciliador (PRE/POST-GRANT) como por el inspector (HOLD).
// =============================================================================

export interface RuntimePrivilegeDrift {
  missing: string[];
  unexpected: string[];
}

export function diffRuntimePrivilegesAgainstMatrix(
  tableRows: TablePrivilegeRow[],
  sequenceRows: SequencePrivilegeRow[],
  schemaCreateRow: SchemaCreatePrivilegeRow | undefined,
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

  // P1-2: los TRES privilegios se evalúan explícitamente y por
  // separado — la matriz solo declara `usage` como autorizable; SELECT
  // y UPDATE están SIEMPRE implícitamente prohibidos para cualquier
  // secuencia que la matriz sí conoce (nunca autorizados hoy), y se
  // reportan con su propio tag estructurado, nunca ocultos dentro de
  // "unexpected_access".
  for (const [sequence, entry] of Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)) {
    const row = runtimeSequenceRows.find((r) => r.sequence_name === sequence);
    const actual = {
      usage: row?.can_usage ?? false,
      select: row?.can_select ?? false,
      update: row?.can_update ?? false,
    };
    if (entry.usage && !actual.usage) missing.push(`sequence:${sequence}:usage`);
    if (!entry.usage && actual.usage) unexpected.push(`sequence:${sequence}:usage`);
    // select/update nunca están autorizados por ninguna entrada actual
    // de la matriz — se comparan contra `false` explícitamente, no
    // contra un campo `entry.select`/`entry.update` que no existe hoy,
    // precisamente para que agregar uno en el futuro sea una decisión
    // consciente en este mismo archivo, no un olvido silencioso.
    if (actual.select) unexpected.push(`sequence:${sequence}:select`);
    if (actual.update) unexpected.push(`sequence:${sequence}:update`);
  }

  for (const row of runtimeSequenceRows) {
    if (matrixSequenceNames.has(row.sequence_name)) continue;
    if (row.can_usage || row.can_select || row.can_update) unexpected.push(`sequence:${row.sequence_name}:unexpected_access`);
  }

  if (findRuntimeSchemaCreateViolation(schemaCreateRow)) {
    unexpected.push('schema:public:create');
  }

  return { missing, unexpected };
}

/** Agrupa TODO lo que debe ser cero para que el estado del runtime sea
 * seguro: drift vs. matriz (parámetro `matrixMissingIsOk` controla si
 * `missing` cuenta como violación — PRE-GRANT lo ignora a propósito,
 * POST-GRANT lo exige en cero) + los invariantes hardcoded de
 * pgmigrations/pgmigrations_id_seq (SIEMPRE, sin importar la fase) +
 * membresías inseguras (directas inesperadas + cloudsqlsuperuser
 * transitivo). No incluye `findAuditLogHardcodedShapeViolations` —
 * ese chequeo asume estado final y el llamador decide explícitamente
 * cuándo correrlo (ver `reconcilePrivileges`). */
export interface RuntimeSafetyAudit {
  matrixDrift: RuntimePrivilegeDrift;
  pgmigrationsViolations: string[];
  pgmigrationsIdSeqViolations: string[];
  unsafeMemberships: string[];
  unexpectedMemberships: string[];
  blockingFindings: string[];
}

export function auditRuntimeSafety(params: {
  tableRows: TablePrivilegeRow[];
  sequenceRows: SequencePrivilegeRow[];
  schemaCreateRow: SchemaCreatePrivilegeRow | undefined;
  transitiveMembershipRows: RoleMembershipRow[];
  directMembershipRows: RoleMembershipRow[];
  runtimeRoleName: string;
  treatMissingAsBlocking: boolean;
}): RuntimeSafetyAudit {
  const matrixDrift = diffRuntimePrivilegesAgainstMatrix(params.tableRows, params.sequenceRows, params.schemaCreateRow, params.runtimeRoleName);
  const pgmigrationsViolations = findPgmigrationsRuntimeAccessViolations(params.tableRows, params.runtimeRoleName);
  const pgmigrationsIdSeqViolations = findPgmigrationsIdSeqRuntimeAccessViolations(params.sequenceRows, params.runtimeRoleName);
  const unsafeMemberships = findCloudSqlSuperuserMemberships(params.transitiveMembershipRows);
  const unexpectedMemberships = findUnexpectedRuntimeRoleMemberships(params.directMembershipRows, params.runtimeRoleName);

  const blockingFindings = [
    ...(params.treatMissingAsBlocking ? matrixDrift.missing.map((m) => `missing:${m}`) : []),
    ...matrixDrift.unexpected.map((u) => `unexpected:${u}`),
    ...pgmigrationsViolations,
    ...pgmigrationsIdSeqViolations,
    ...unsafeMemberships,
    ...unexpectedMemberships,
  ];

  return { matrixDrift, pgmigrationsViolations, pgmigrationsIdSeqViolations, unsafeMemberships, unexpectedMemberships, blockingFindings };
}
