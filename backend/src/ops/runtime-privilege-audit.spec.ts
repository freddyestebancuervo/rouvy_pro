import {
  diffRuntimePrivilegesAgainstMatrix,
  findPgmigrationsRuntimeAccessViolations,
  findPgmigrationsIdSeqRuntimeAccessViolations,
  findAuditLogHardcodedShapeViolations,
  findCloudSqlSuperuserMemberships,
  findUnexpectedRuntimeRoleMemberships,
  findRuntimeSchemaCreateViolation,
  auditRuntimeSafety,
  EXPECTED_RUNTIME_ROLE_MEMBERSHIPS,
  type TablePrivilegeRow,
  type SequencePrivilegeRow,
  type RoleMembershipRow,
} from './runtime-privilege-audit';
import { RUNTIME_TABLE_PRIVILEGE_MATRIX } from './runtime-privilege-matrix';

const RUNTIME = 'runtime_test';

function healthyTableRows(): TablePrivilegeRow[] {
  return Object.entries(RUNTIME_TABLE_PRIVILEGE_MATRIX).map(([table_name, entry]) => ({
    rolname: RUNTIME,
    table_name,
    can_select: entry.select,
    can_insert: entry.insert,
    can_update: entry.update,
    can_delete: entry.delete,
    can_truncate: false,
    can_references: false,
    can_trigger: false,
  }));
}

function auditLogSeqRow(overrides: Partial<SequencePrivilegeRow> = {}): SequencePrivilegeRow {
  return { rolname: RUNTIME, sequence_name: 'audit_log_id_seq', can_usage: true, can_select: false, can_update: false, ...overrides };
}

function pgmigrationsIdSeqRow(overrides: Partial<SequencePrivilegeRow> = {}): SequencePrivilegeRow {
  return { rolname: RUNTIME, sequence_name: 'pgmigrations_id_seq', can_usage: false, can_select: false, can_update: false, ...overrides };
}

describe('runtime-privilege-audit', () => {
  // ===========================================================================
  // Mission: "PRUEBAS UNITARIAS OBLIGATORIAS — Sequence" (P1-2)
  // ===========================================================================
  describe('audit_log_id_seq — los tres privilegios evaluados explícitamente (P1-2)', () => {
    it('USAGE only => PASS (missing/unexpected vacíos)', () => {
      const drift = diffRuntimePrivilegesAgainstMatrix(healthyTableRows(), [auditLogSeqRow()], undefined, RUNTIME);
      expect(drift.missing.filter((m) => m.startsWith('sequence:audit_log_id_seq'))).toEqual([]);
      expect(drift.unexpected.filter((u) => u.startsWith('sequence:audit_log_id_seq'))).toEqual([]);
    });

    it('USAGE + SELECT => HOLD (sequence:audit_log_id_seq:select en unexpected)', () => {
      const drift = diffRuntimePrivilegesAgainstMatrix(healthyTableRows(), [auditLogSeqRow({ can_select: true })], undefined, RUNTIME);
      expect(drift.unexpected).toContain('sequence:audit_log_id_seq:select');
      expect(drift.unexpected).not.toContain('sequence:audit_log_id_seq:update');
    });

    it('USAGE + UPDATE => HOLD (sequence:audit_log_id_seq:update en unexpected)', () => {
      const drift = diffRuntimePrivilegesAgainstMatrix(healthyTableRows(), [auditLogSeqRow({ can_update: true })], undefined, RUNTIME);
      expect(drift.unexpected).toContain('sequence:audit_log_id_seq:update');
      expect(drift.unexpected).not.toContain('sequence:audit_log_id_seq:select');
    });

    it('USAGE + SELECT + UPDATE => HOLD (ambos, estructurados por separado, nunca colapsados en un genérico)', () => {
      const drift = diffRuntimePrivilegesAgainstMatrix(healthyTableRows(), [auditLogSeqRow({ can_select: true, can_update: true })], undefined, RUNTIME);
      expect(drift.unexpected).toContain('sequence:audit_log_id_seq:select');
      expect(drift.unexpected).toContain('sequence:audit_log_id_seq:update');
      expect(drift.unexpected).not.toContain('sequence:audit_log_id_seq:unexpected_access');
    });

    it('missing USAGE => HOLD (sequence:audit_log_id_seq:usage en missing)', () => {
      const drift = diffRuntimePrivilegesAgainstMatrix(healthyTableRows(), [auditLogSeqRow({ can_usage: false })], undefined, RUNTIME);
      expect(drift.missing).toContain('sequence:audit_log_id_seq:usage');
    });
  });

  // ===========================================================================
  // Mission: "PRUEBAS UNITARIAS OBLIGATORIAS — pgmigrations_id_seq" (P1-1A)
  // ===========================================================================
  describe('pgmigrations_id_seq — invariante hardcoded, independiente de la matriz (P1-1A)', () => {
    it('USAGE => violation', () => {
      const violations = findPgmigrationsIdSeqRuntimeAccessViolations([pgmigrationsIdSeqRow({ can_usage: true })], RUNTIME);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('USAGE'))).toBe(true);
    });

    it('SELECT => violation', () => {
      const violations = findPgmigrationsIdSeqRuntimeAccessViolations([pgmigrationsIdSeqRow({ can_select: true })], RUNTIME);
      expect(violations.some((v) => v.includes('SELECT'))).toBe(true);
    });

    it('UPDATE => violation', () => {
      const violations = findPgmigrationsIdSeqRuntimeAccessViolations([pgmigrationsIdSeqRow({ can_update: true })], RUNTIME);
      expect(violations.some((v) => v.includes('UPDATE'))).toBe(true);
    });

    it('zero privileges => PASS (empty)', () => {
      const violations = findPgmigrationsIdSeqRuntimeAccessViolations([pgmigrationsIdSeqRow()], RUNTIME);
      expect(violations).toEqual([]);
    });

    it('is a hardcoded invariant — proven independent of RUNTIME_SEQUENCE_PRIVILEGE_MATRIX by construction: pgmigrations_id_seq never appears as a key there, yet this function still flags it', () => {
      const { RUNTIME_SEQUENCE_PRIVILEGE_MATRIX } = jest.requireActual('./runtime-privilege-matrix');
      expect(Object.keys(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)).not.toContain('pgmigrations_id_seq');
      const violations = findPgmigrationsIdSeqRuntimeAccessViolations([pgmigrationsIdSeqRow({ can_usage: true })], RUNTIME);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('pgmigrations (tabla) — invariante hardcoded (P1-1)', () => {
    it('zero privileges => PASS', () => {
      const rows: TablePrivilegeRow[] = [
        { rolname: RUNTIME, table_name: 'pgmigrations', can_select: false, can_insert: false, can_update: false, can_delete: false, can_truncate: false, can_references: false, can_trigger: false },
      ];
      expect(findPgmigrationsRuntimeAccessViolations(rows, RUNTIME)).toEqual([]);
    });

    it.each(['can_select', 'can_insert', 'can_update', 'can_delete', 'can_truncate', 'can_trigger', 'can_references'] as const)(
      '%s => violation',
      (verb) => {
        const rows: TablePrivilegeRow[] = [
          {
            rolname: RUNTIME,
            table_name: 'pgmigrations',
            can_select: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_truncate: false,
            can_references: false,
            can_trigger: false,
            [verb]: true,
          },
        ];
        expect(findPgmigrationsRuntimeAccessViolations(rows, RUNTIME).length).toBeGreaterThan(0);
      },
    );
  });

  // ===========================================================================
  // Mission: "PRUEBAS UNITARIAS OBLIGATORIAS — Membership" (P1-3)
  // ===========================================================================
  describe('Membership (P1-3)', () => {
    it('runtime -> cloudsqlsuperuser (directo) => HOLD', () => {
      const rows: RoleMembershipRow[] = [{ member_role: RUNTIME, granted_role: 'cloudsqlsuperuser' }];
      expect(findCloudSqlSuperuserMemberships(rows).length).toBeGreaterThan(0);
    });

    it('runtime -> intermediate -> cloudsqlsuperuser (transitivo, alimentado como cierre ya resuelto) => HOLD', () => {
      // El cierre transitivo real lo resuelve la CTE recursiva en SQL —
      // acá se prueba que, UNA VEZ alimentada con el cierre ya resuelto
      // (como lo haría `TRANSITIVE_ROLE_MEMBERSHIP_CTE`), la función
      // detecta la arista derivada `runtime_test -> cloudsqlsuperuser`
      // exactamente igual que si fuera directa — la CTE ya "aplanó" el
      // salto por `intermediate_role` en el resultado que esta función
      // consume.
      const transitiveClosureRows: RoleMembershipRow[] = [
        { member_role: RUNTIME, granted_role: 'intermediate_role' },
        { member_role: RUNTIME, granted_role: 'cloudsqlsuperuser' }, // derivado por la CTE
      ];
      const findings = findCloudSqlSuperuserMemberships(transitiveClosureRows);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]).toContain('cloudsqlsuperuser');
    });

    it('runtime -> unexpected_role => HOLD si EXPECTED_RUNTIME_ROLE_MEMBERSHIPS=[]', () => {
      expect(EXPECTED_RUNTIME_ROLE_MEMBERSHIPS).toEqual([]);
      const rows: RoleMembershipRow[] = [{ member_role: RUNTIME, granted_role: 'unexpected_role' }];
      const findings = findUnexpectedRuntimeRoleMemberships(rows, RUNTIME);
      expect(findings.length).toBeGreaterThan(0);
    });

    it('no membership at all => PASS (empty)', () => {
      expect(findCloudSqlSuperuserMemberships([])).toEqual([]);
      expect(findUnexpectedRuntimeRoleMemberships([], RUNTIME)).toEqual([]);
    });

    it('a membership belonging to a DIFFERENT role (e.g. migration identity) is never attributed to the runtime role', () => {
      const rows: RoleMembershipRow[] = [{ member_role: 'migration_test', granted_role: 'some_role' }];
      expect(findUnexpectedRuntimeRoleMemberships(rows, RUNTIME)).toEqual([]);
    });
  });

  describe('findRuntimeSchemaCreateViolation', () => {
    it('false when can_schema_create is false', () => {
      expect(findRuntimeSchemaCreateViolation({ rolname: RUNTIME, can_schema_create: false })).toBe(false);
    });
    it('true when can_schema_create is true', () => {
      expect(findRuntimeSchemaCreateViolation({ rolname: RUNTIME, can_schema_create: true })).toBe(true);
    });
    it('false when undefined (no row for the role)', () => {
      expect(findRuntimeSchemaCreateViolation(undefined)).toBe(false);
    });
  });

  describe('findAuditLogHardcodedShapeViolations — invariante hardcoded, independiente de la matriz', () => {
    it('exact expected shape => PASS', () => {
      const tableRows: TablePrivilegeRow[] = [
        { rolname: RUNTIME, table_name: 'audit_log', can_select: false, can_insert: true, can_update: false, can_delete: false, can_truncate: false, can_references: false, can_trigger: false },
      ];
      expect(findAuditLogHardcodedShapeViolations(tableRows, [auditLogSeqRow()], RUNTIME)).toEqual([]);
    });

    it('missing INSERT on audit_log => violation', () => {
      const tableRows: TablePrivilegeRow[] = [
        { rolname: RUNTIME, table_name: 'audit_log', can_select: false, can_insert: false, can_update: false, can_delete: false, can_truncate: false, can_references: false, can_trigger: false },
      ];
      expect(findAuditLogHardcodedShapeViolations(tableRows, [auditLogSeqRow()], RUNTIME).length).toBeGreaterThan(0);
    });

    it('SELECT on audit_log => violation', () => {
      const tableRows: TablePrivilegeRow[] = [
        { rolname: RUNTIME, table_name: 'audit_log', can_select: true, can_insert: true, can_update: false, can_delete: false, can_truncate: false, can_references: false, can_trigger: false },
      ];
      expect(findAuditLogHardcodedShapeViolations(tableRows, [auditLogSeqRow()], RUNTIME).length).toBeGreaterThan(0);
    });
  });

  describe('auditRuntimeSafety — treatMissingAsBlocking distingue PRE-GRANT de POST-GRANT', () => {
    it('PRE-GRANT (treatMissingAsBlocking=false): un missing puro no bloquea', () => {
      const audit = auditRuntimeSafety({
        tableRows: [],
        sequenceRows: [],
        schemaCreateRow: undefined,
        transitiveMembershipRows: [],
        directMembershipRows: [],
        runtimeRoleName: RUNTIME,
        treatMissingAsBlocking: false,
      });
      expect(audit.matrixDrift.missing.length).toBeGreaterThan(0);
      expect(audit.blockingFindings).toEqual([]);
    });

    it('POST-GRANT (treatMissingAsBlocking=true): el mismo missing SÍ bloquea', () => {
      const audit = auditRuntimeSafety({
        tableRows: [],
        sequenceRows: [],
        schemaCreateRow: undefined,
        transitiveMembershipRows: [],
        directMembershipRows: [],
        runtimeRoleName: RUNTIME,
        treatMissingAsBlocking: true,
      });
      expect(audit.blockingFindings.length).toBeGreaterThan(0);
    });

    it('un unexpected siempre bloquea, en ambas fases', () => {
      const tableRows = healthyTableRows().map((r) => (r.table_name === 'users' ? { ...r, can_delete: true } : r));
      const preGrant = auditRuntimeSafety({
        tableRows,
        sequenceRows: [auditLogSeqRow()],
        schemaCreateRow: undefined,
        transitiveMembershipRows: [],
        directMembershipRows: [],
        runtimeRoleName: RUNTIME,
        treatMissingAsBlocking: false,
      });
      const postGrant = auditRuntimeSafety({
        tableRows,
        sequenceRows: [auditLogSeqRow()],
        schemaCreateRow: undefined,
        transitiveMembershipRows: [],
        directMembershipRows: [],
        runtimeRoleName: RUNTIME,
        treatMissingAsBlocking: true,
      });
      expect(preGrant.blockingFindings.length).toBeGreaterThan(0);
      expect(postGrant.blockingFindings.length).toBeGreaterThan(0);
    });
  });
});
