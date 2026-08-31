import {
  isValidRoleIdentifier,
  quoteIdent,
  buildReconciliationStatements,
  assertMigrationContext,
  findMissingExpectedSchemaObjects,
  reconcilePrivileges,
  ReconcilerError,
  RUNTIME_TABLE_PRIVILEGES_QUERY,
  RUNTIME_SEQUENCE_PRIVILEGES_QUERY,
  RUNTIME_SCHEMA_CREATE_QUERY,
  RUNTIME_DIRECT_MEMBERSHIPS_QUERY,
} from './privilege-reconciler';
import { RUNTIME_TABLE_PRIVILEGE_MATRIX, RUNTIME_SEQUENCE_PRIVILEGE_MATRIX } from './runtime-privilege-matrix';
import { TRANSITIVE_ROLE_MEMBERSHIP_CTE, type TablePrivilegeRow, type SequencePrivilegeRow, type RoleMembershipRow } from './runtime-privilege-audit';

// `pg.Client` se mockea por completo — ningún test de este archivo toca
// una base de datos real (misma disciplina que db-readonly-inspector.spec.ts).
const mockConnect = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn();
const mockOn = jest.fn();
/** Handler registrado vía `client.on('notice', ...)` en el módulo real —
 * capturado acá para poder simular un WARNING del servidor en un test. */
let capturedNoticeHandler: ((notice: { message?: string }) => void) | undefined;

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation((config: unknown) => ({
    __config: config,
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
    on: mockOn,
  })),
}));

function setEnv(overrides: Partial<NodeJS.ProcessEnv>) {
  delete process.env.DATABASE_URL;
  delete process.env.MIGRATION_DATABASE_URL;
  delete process.env.RUNTIME_DB_ROLE;
  Object.assign(process.env, overrides);
}

const ALL_MATRIX_TABLES = Object.keys(RUNTIME_TABLE_PRIVILEGE_MATRIX);
const ALL_MATRIX_SEQUENCES = Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)
  .filter(([, entry]) => entry.usage)
  .map(([name]) => name);

/** Filas de privilegio de tabla/secuencia que reflejan EXACTAMENTE el
 * modelo mínimo de la matriz para `runtimeRole` — el punto de partida
 * "sano" (post-grant esperado) de todos los fixtures de este archivo. */
function healthyTablePrivilegeRows(runtimeRole: string): TablePrivilegeRow[] {
  return Object.entries(RUNTIME_TABLE_PRIVILEGE_MATRIX).map(([table_name, entry]) => ({
    rolname: runtimeRole,
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

function healthySequencePrivilegeRows(runtimeRole: string): SequencePrivilegeRow[] {
  return Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX).map(([sequence_name, entry]) => ({
    rolname: runtimeRole,
    sequence_name,
    can_usage: entry.usage,
    can_select: false,
    can_update: false,
  }));
}

/** Filas VACÍAS de tabla/secuencia — el estado PRE-GRANT esperado
 * (ningún privilegio otorgado todavía). */
function emptyTablePrivilegeRows(): TablePrivilegeRow[] {
  return Object.keys(RUNTIME_TABLE_PRIVILEGE_MATRIX).map((table_name) => ({
    rolname: '__unused__',
    table_name,
    can_select: false,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_references: false,
    can_trigger: false,
  }));
}

function emptySequencePrivilegeRows(): SequencePrivilegeRow[] {
  return Object.keys(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX).map((sequence_name) => ({
    rolname: '__unused__',
    sequence_name,
    can_usage: false,
    can_select: false,
    can_update: false,
  }));
}

/**
 * Despachador de queries por texto/prefijo — refleja el orden real de
 * `reconcilePrivileges` sin acoplar los tests al índice exacto de
 * llamada. `preGrant*`/`postGrant*` permiten simular estados DISTINTOS
 * antes y después de los GRANT — por defecto PRE-GRANT es "vacío"
 * (nada otorgado todavía, normal) y POST-GRANT es "exactamente sano"
 * (la matriz, ni más ni menos) — el shape que un reconcile exitoso real
 * produciría.
 */
function installQueryMock(
  options: {
    currentUser?: string;
    canCreateInSchema?: boolean;
    roleExists?: boolean;
    presentTables?: string[];
    presentSequences?: string[];
    runtimeRole?: string;
    preGrantTableRows?: TablePrivilegeRow[];
    preGrantSequenceRows?: SequencePrivilegeRow[];
    preGrantSchemaCreate?: boolean;
    preGrantDirectMemberships?: RoleMembershipRow[];
    preGrantTransitiveMemberships?: RoleMembershipRow[];
    postGrantTableRows?: TablePrivilegeRow[];
    postGrantSequenceRows?: SequencePrivilegeRow[];
    postGrantSchemaCreate?: boolean;
    postGrantDirectMemberships?: RoleMembershipRow[];
    postGrantTransitiveMemberships?: RoleMembershipRow[];
    failOnStatementSubstring?: string;
  } = {},
) {
  const {
    currentUser = 'migration_test',
    canCreateInSchema = true,
    roleExists = true,
    presentTables = ALL_MATRIX_TABLES,
    presentSequences = ALL_MATRIX_SEQUENCES,
    runtimeRole = 'runtime_test',
    preGrantTableRows = emptyTablePrivilegeRows(),
    preGrantSequenceRows = emptySequencePrivilegeRows(),
    preGrantSchemaCreate = false,
    preGrantDirectMemberships = [],
    preGrantTransitiveMemberships = [],
    postGrantTableRows = healthyTablePrivilegeRows(runtimeRole),
    postGrantSequenceRows = healthySequencePrivilegeRows(runtimeRole),
    postGrantSchemaCreate = false,
    postGrantDirectMemberships = [],
    postGrantTransitiveMemberships = [],
    failOnStatementSubstring,
  } = options;

  let grantsExecuted = false;

  mockConnect.mockReset().mockResolvedValue(undefined);
  mockEnd.mockReset().mockResolvedValue(undefined);
  mockOn.mockReset().mockImplementation((event: string, handler: (notice: { message?: string }) => void) => {
    if (event === 'notice') capturedNoticeHandler = handler;
  });
  mockQuery.mockReset().mockImplementation((sql: string) => {
    if (sql.startsWith('SELECT current_user')) {
      return Promise.resolve({ rows: [{ current_user: currentUser }], rowCount: 1 });
    }
    if (sql.includes('has_schema_privilege(current_user')) {
      return Promise.resolve({ rows: [{ can_create: canCreateInSchema }], rowCount: 1 });
    }
    if (sql.startsWith('SELECT 1 FROM pg_roles')) {
      return Promise.resolve({ rows: roleExists ? [{ '?column?': 1 }] : [], rowCount: roleExists ? 1 : 0 });
    }
    if (sql.includes('FROM pg_tables')) {
      return Promise.resolve({ rows: presentTables.map((tablename) => ({ tablename })), rowCount: presentTables.length });
    }
    if (sql.includes("c.relkind = 'S'") && !sql.includes('has_sequence_privilege')) {
      return Promise.resolve({ rows: presentSequences.map((relname) => ({ relname })), rowCount: presentSequences.length });
    }
    if (sql === RUNTIME_TABLE_PRIVILEGES_QUERY) {
      return Promise.resolve({ rows: grantsExecuted ? postGrantTableRows : preGrantTableRows });
    }
    if (sql === RUNTIME_SEQUENCE_PRIVILEGES_QUERY) {
      return Promise.resolve({ rows: grantsExecuted ? postGrantSequenceRows : preGrantSequenceRows });
    }
    if (sql === RUNTIME_SCHEMA_CREATE_QUERY) {
      return Promise.resolve({
        rows: [{ rolname: runtimeRole, can_schema_create: grantsExecuted ? postGrantSchemaCreate : preGrantSchemaCreate }],
      });
    }
    if (sql === RUNTIME_DIRECT_MEMBERSHIPS_QUERY) {
      return Promise.resolve({ rows: grantsExecuted ? postGrantDirectMemberships : preGrantDirectMemberships });
    }
    if (sql === TRANSITIVE_ROLE_MEMBERSHIP_CTE) {
      return Promise.resolve({ rows: grantsExecuted ? postGrantTransitiveMemberships : preGrantTransitiveMemberships });
    }
    if (sql === 'BEGIN;') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sql === 'COMMIT;' || sql === 'ROLLBACK;') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (failOnStatementSubstring && sql.includes(failOnStatementSubstring)) {
      return Promise.reject(new Error('simulated grant failure — must never leak this raw pg error'));
    }
    if (sql.startsWith('GRANT')) {
      grantsExecuted = true;
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe('privilege-reconciler', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  describe('isValidRoleIdentifier', () => {
    it.each([['runtime_test'], ['korixa_runtime'], ['_leading_underscore'], ['a'], ['A1'], ['a'.repeat(63)]])(
      'accepts a safe identifier: %s',
      (name) => {
        expect(isValidRoleIdentifier(name)).toBe(true);
      },
    );

    it.each([
      [''],
      ['1abc'],
      ['foo bar'],
      ['foo"bar'],
      ["foo';DROP TABLE users;--"],
      ['foo-bar'],
      ['foo\\bar'],
      ['foo;bar'],
      ['foo`bar'],
      ['a'.repeat(64)],
      ['ñañá'],
      [null],
      [undefined],
      [123],
      [{}],
    ])('rejects an unsafe/invalid identifier: %p', (name) => {
      expect(isValidRoleIdentifier(name)).toBe(false);
    });
  });

  describe('quoteIdent', () => {
    it('quotes a valid identifier', () => {
      expect(quoteIdent('korixa_runtime')).toBe('"korixa_runtime"');
    });

    it('throws ReconcilerError for an invalid identifier without echoing the raw value', () => {
      const malicious = "runtime\"; DROP TABLE users; --";
      let caught: unknown;
      try {
        quoteIdent(malicious);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ReconcilerError);
      const err = caught as ReconcilerError;
      expect(err.code).toBe('INVALID_RUNTIME_DB_ROLE_IDENTIFIER');
      expect(err.message).not.toContain(malicious);
      expect(err.message).not.toContain('DROP TABLE');
      expect(err.evidence?.received_length).toBe(malicious.length);
    });
  });

  describe('buildReconciliationStatements', () => {
    it('builds one named GRANT per table (never ON ALL TABLES) with exactly the verbs the matrix authorizes', () => {
      const statements = buildReconciliationStatements('"korixa_runtime"');

      expect(statements).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "users" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT ON TABLE "roles" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT, INSERT ON TABLE "user_roles" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "refresh_tokens" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "equipment" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT ON TABLE "equipment_categories" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "workouts" TO "korixa_runtime";');
      expect(statements).toContain('GRANT SELECT, INSERT ON TABLE "workout_intervals" TO "korixa_runtime";');
      expect(statements).toContain('GRANT INSERT ON TABLE "audit_log" TO "korixa_runtime";');
      expect(statements).toContain('GRANT USAGE ON SEQUENCE "audit_log_id_seq" TO "korixa_runtime";');
    });

    it('never mentions pgmigrations in any generated statement', () => {
      const statements = buildReconciliationStatements('"runtime_test"').join('\n');
      expect(statements.toLowerCase()).not.toContain('pgmigrations');
    });

    it('never uses ON ALL TABLES/ALL SEQUENCES IN SCHEMA or ALTER DEFAULT PRIVILEGES', () => {
      const statements = buildReconciliationStatements('"runtime_test"').join('\n').toUpperCase();
      expect(statements).not.toContain('ALL TABLES');
      expect(statements).not.toContain('ALL SEQUENCES');
      expect(statements).not.toContain('ALTER DEFAULT PRIVILEGES');
    });

    it('never mentions SUPERUSER/CREATEDB/CREATEROLE/OWNER/CREATE-on-schema in any statement', () => {
      const statements = buildReconciliationStatements('"runtime_test"').join('\n').toUpperCase();
      expect(statements).not.toContain('SUPERUSER');
      expect(statements).not.toContain('CREATEDB');
      expect(statements).not.toContain('CREATEROLE');
      expect(statements).not.toContain('OWNER');
      expect(statements).not.toMatch(/GRANT\s+CREATE\b/);
    });

    it('produces exactly one GRANT statement per matrix entry with at least one true verb, plus one per usage-true sequence', () => {
      const tableStatementCount = Object.values(RUNTIME_TABLE_PRIVILEGE_MATRIX).filter(
        (entry) => entry.select || entry.insert || entry.update || entry.delete,
      ).length;
      const sequenceStatementCount = Object.values(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX).filter((entry) => entry.usage).length;

      const statements = buildReconciliationStatements('"runtime_test"');
      expect(statements).toHaveLength(tableStatementCount + sequenceStatementCount);
    });
  });

  describe('findMissingExpectedSchemaObjects', () => {
    it('returns empty when every matrix table/sequence is physically present', () => {
      const missing = findMissingExpectedSchemaObjects({
        actualTables: new Set(ALL_MATRIX_TABLES),
        actualSequences: new Set(ALL_MATRIX_SEQUENCES),
      });
      expect(missing).toEqual([]);
    });

    it('reports a missing table', () => {
      const missing = findMissingExpectedSchemaObjects({
        actualTables: new Set(ALL_MATRIX_TABLES.filter((t) => t !== 'users')),
        actualSequences: new Set(ALL_MATRIX_SEQUENCES),
      });
      expect(missing).toContain('table:users');
    });

    it('reports a missing sequence', () => {
      const missing = findMissingExpectedSchemaObjects({
        actualTables: new Set(ALL_MATRIX_TABLES),
        actualSequences: new Set(),
      });
      expect(missing).toContain('sequence:audit_log_id_seq');
    });
  });

  describe('assertMigrationContext', () => {
    it('throws RUNTIME_EQUALS_MIGRATION_IDENTITY when runtime role equals current_user', () => {
      expect(() => assertMigrationContext({ currentUser: 'shared_role', runtimeRole: 'shared_role', canCreateInSchema: true })).toThrow(
        expect.objectContaining({ code: 'RUNTIME_EQUALS_MIGRATION_IDENTITY' }),
      );
    });

    it('throws UNEXPECTED_MIGRATION_CONTEXT when current_user lacks CREATE on schema public', () => {
      expect(() => assertMigrationContext({ currentUser: 'migration_test', runtimeRole: 'runtime_test', canCreateInSchema: false })).toThrow(
        expect.objectContaining({ code: 'UNEXPECTED_MIGRATION_CONTEXT' }),
      );
    });

    it('does not throw for a valid migration context', () => {
      expect(() => assertMigrationContext({ currentUser: 'migration_test', runtimeRole: 'runtime_test', canCreateInSchema: true })).not.toThrow();
    });
  });

  describe('reconcilePrivileges', () => {
    it('throws MISSING_MIGRATION_DATABASE_URL and never connects when MIGRATION_DATABASE_URL is absent', async () => {
      setEnv({ RUNTIME_DB_ROLE: 'runtime_test' });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'MISSING_MIGRATION_DATABASE_URL' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN_DATABASE_URL_IN_MIGRATION_CONTEXT and never connects when only DATABASE_URL is present (no MIGRATION_DATABASE_URL at all)', async () => {
      setEnv({ DATABASE_URL: 'postgres://runtime:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'FORBIDDEN_DATABASE_URL_IN_MIGRATION_CONTEXT' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN_DATABASE_URL_IN_MIGRATION_CONTEXT and never connects when both MIGRATION_DATABASE_URL and DATABASE_URL are present', async () => {
      setEnv({
        MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test',
        DATABASE_URL: 'postgres://runtime:pw@localhost:5432/korixa_test',
        RUNTIME_DB_ROLE: 'runtime_test',
      });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'FORBIDDEN_DATABASE_URL_IN_MIGRATION_CONTEXT' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('never leaks the DATABASE_URL value when rejecting it as forbidden', async () => {
      const forbiddenValue = 'postgres://runtime:s3cr3t-runtime-pw@10.1.1.1:5432/korixa_production';
      setEnv({
        MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test',
        DATABASE_URL: forbiddenValue,
        RUNTIME_DB_ROLE: 'runtime_test',
      });
      let caught: unknown;
      try {
        await reconcilePrivileges();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ReconcilerError);
      expect(JSON.stringify(caught)).not.toContain('s3cr3t-runtime-pw');
      expect(JSON.stringify(caught)).not.toContain('10.1.1.1');
    });

    it('throws MISSING_RUNTIME_DB_ROLE and never connects when RUNTIME_DB_ROLE is absent', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test' });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'MISSING_RUNTIME_DB_ROLE' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws INVALID_RUNTIME_DB_ROLE_IDENTIFIER and never connects for an injection-shaped role name', async () => {
      setEnv({
        MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test',
        RUNTIME_DB_ROLE: "runtime_test\"; DROP TABLE users; --",
      });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'INVALID_RUNTIME_DB_ROLE_IDENTIFIER' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('aborts with RUNTIME_EQUALS_MIGRATION_IDENTITY and never issues BEGIN/GRANT when runtime role === migration identity', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'migration_test' });
      installQueryMock({ currentUser: 'migration_test' });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_EQUALS_MIGRATION_IDENTITY' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      expect(mockEnd).toHaveBeenCalled();
    });

    it('aborts with UNEXPECTED_MIGRATION_CONTEXT when current_user lacks CREATE on schema public', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test', canCreateInSchema: false });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'UNEXPECTED_MIGRATION_CONTEXT' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
    });

    it('aborts with RUNTIME_ROLE_NOT_FOUND when the runtime role does not exist, and never issues BEGIN/GRANT', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'ghost_role' });
      installQueryMock({ currentUser: 'migration_test', roleExists: false });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_ROLE_NOT_FOUND' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
    });

    it('aborts with EXPECTED_SCHEMA_OBJECT_MISSING and never issues BEGIN/GRANT when a matrix table is physically absent', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test', presentTables: ALL_MATRIX_TABLES.filter((t) => t !== 'workouts') });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'EXPECTED_SCHEMA_OBJECT_MISSING' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
    });

    it('aborts with EXPECTED_SCHEMA_OBJECT_MISSING when the expected sequence is physically absent', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test', presentSequences: [] });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'EXPECTED_SCHEMA_OBJECT_MISSING' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
    });

    // =========================================================================
    // P1-1 — PRE-GRANT fail-closed. Un privilegio EXCEDENTE ya presente
    // (nunca uno faltante) aborta ANTES de BEGIN.
    // =========================================================================
    describe('PRE-GRANT fail-closed (P1-1)', () => {
      it('pre-existing DELETE ON users => NO RECONCILED (RUNTIME_PRIVILEGE_DRIFT_DETECTED), never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const preGrantTableRows = emptyTablePrivilegeRows().map((r) =>
          r.table_name === 'users' ? { ...r, rolname: 'runtime_test', can_delete: true } : r,
        );
        installQueryMock({ currentUser: 'migration_test', preGrantTableRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_PRIVILEGE_DRIFT_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing UPDATE ON audit_log => NO RECONCILED, never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const preGrantTableRows = emptyTablePrivilegeRows().map((r) =>
          r.table_name === 'audit_log' ? { ...r, rolname: 'runtime_test', can_update: true } : r,
        );
        installQueryMock({ currentUser: 'migration_test', preGrantTableRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_PRIVILEGE_DRIFT_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing CREATE ON SCHEMA public => NO RECONCILED, never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        installQueryMock({ currentUser: 'migration_test', preGrantSchemaCreate: true });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_PRIVILEGE_DRIFT_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing UPDATE ON audit_log_id_seq => NO RECONCILED, never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const preGrantSequenceRows = emptySequencePrivilegeRows().map((r) =>
          r.sequence_name === 'audit_log_id_seq' ? { ...r, rolname: 'runtime_test', can_update: true } : r,
        );
        installQueryMock({ currentUser: 'migration_test', preGrantSequenceRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_PRIVILEGE_DRIFT_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing privilege on pgmigrations => PGMIGRATIONS_PRIVILEGE_DETECTED specifically (not the generic drift code), never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const preGrantTableRows = [
          ...emptyTablePrivilegeRows(),
          { rolname: 'runtime_test', table_name: 'pgmigrations', can_select: true, can_insert: false, can_update: false, can_delete: false, can_truncate: false, can_references: false, can_trigger: false },
        ];
        installQueryMock({ currentUser: 'migration_test', preGrantTableRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'PGMIGRATIONS_PRIVILEGE_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing privilege on pgmigrations_id_seq => PGMIGRATIONS_PRIVILEGE_DETECTED, never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const preGrantSequenceRows = [
          ...emptySequencePrivilegeRows(),
          { rolname: 'runtime_test', sequence_name: 'pgmigrations_id_seq', can_usage: true, can_select: false, can_update: false },
        ];
        installQueryMock({ currentUser: 'migration_test', preGrantSequenceRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'PGMIGRATIONS_PRIVILEGE_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('a missing (not-yet-granted) matrix privilege does NOT block PRE-GRANT — clean state + missing expected grants => GRANT + exact postcheck + RECONCILED', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        installQueryMock({ currentUser: 'migration_test' }); // defaults: pre-grant empty, post-grant healthy

        const result = await reconcilePrivileges();
        expect(result.outcome).toBe('RECONCILED');
        expect(mockQuery).toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing runtime -> cloudsqlsuperuser membership (direct) => RUNTIME_PRIVILEGE_DRIFT_DETECTED via unsafe membership, never BEGIN', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        installQueryMock({
          currentUser: 'migration_test',
          preGrantTransitiveMemberships: [{ member_role: 'runtime_test', granted_role: 'cloudsqlsuperuser' }],
        });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_PRIVILEGE_DRIFT_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });

      it('pre-existing runtime -> unexpected_role membership (not cloudsqlsuperuser, not in the empty allowlist) => blocks too', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        installQueryMock({
          currentUser: 'migration_test',
          preGrantDirectMemberships: [{ member_role: 'runtime_test', granted_role: 'some_other_role' }],
        });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_PRIVILEGE_DRIFT_DETECTED' });
        expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      });
    });

    // =========================================================================
    // P1-1 — POST-GRANT exact-state proof.
    // =========================================================================
    describe('POST-GRANT exact-state proof (P1-1)', () => {
      it('if the post-grant state still has an unexpected privilege, ROLLBACK and POST_GRANT_STATE_MISMATCH (never RECONCILED)', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const postGrantTableRows = healthyTablePrivilegeRows('runtime_test').map((r) => (r.table_name === 'users' ? { ...r, can_delete: true } : r));
        installQueryMock({ currentUser: 'migration_test', postGrantTableRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'POST_GRANT_STATE_MISMATCH' });
        const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
        expect(calledSql).toContain('BEGIN;');
        expect(calledSql).toContain('ROLLBACK;');
        expect(calledSql).not.toContain('COMMIT;');
      });

      it('if the post-grant state is still missing a required matrix privilege, ROLLBACK and POST_GRANT_STATE_MISMATCH', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        const postGrantTableRows = healthyTablePrivilegeRows('runtime_test').map((r) => (r.table_name === 'audit_log' ? { ...r, can_insert: false } : r));
        installQueryMock({ currentUser: 'migration_test', postGrantTableRows });

        await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'POST_GRANT_STATE_MISMATCH' });
        const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
        expect(calledSql).toContain('ROLLBACK;');
        expect(calledSql).not.toContain('COMMIT;');
      });

      it('clean state + missing expected grants => GRANT + exact postcheck + RECONCILED', async () => {
        setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
        installQueryMock({ currentUser: 'migration_test' });

        const result = await reconcilePrivileges();

        expect(result).toEqual({
          runtime_role_identifier_valid: true,
          migration_context_valid: true,
          runtime_role_existed: true,
          expected_schema_objects_present: true,
          pre_grant_drift_absent: true,
          post_grant_exact_state_proven: true,
          statements_executed: buildReconciliationStatements('"runtime_test"').length,
          outcome: 'RECONCILED',
        });
        const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
        expect(calledSql).toContain('BEGIN;');
        expect(calledSql).toContain('COMMIT;');
        expect(calledSql).not.toContain('ROLLBACK;');
      });
    });

    it('reconciles successfully: BEGIN, exactly the matrix-derived statements, COMMIT, then closes the connection', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });

      const result = await reconcilePrivileges();

      const expectedStatementCount = buildReconciliationStatements('"runtime_test"').length;
      expect(result.outcome).toBe('RECONCILED');
      expect(result.statements_executed).toBe(expectedStatementCount);

      const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(calledSql).toContain('BEGIN;');
      expect(calledSql).toContain('COMMIT;');
      expect(calledSql).not.toContain('ROLLBACK;');
      expect(calledSql.filter((sql) => sql.includes('TO "runtime_test"'))).toHaveLength(expectedStatementCount);
      expect(mockEnd).toHaveBeenCalled();
    });

    it('rolls back the whole transaction and throws GRANT_STATEMENT_FAILED if any statement fails midway, without ever committing', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test', failOnStatementSubstring: 'GRANT INSERT ON TABLE "audit_log"' });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'GRANT_STATEMENT_FAILED' });

      const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(calledSql).toContain('BEGIN;');
      expect(calledSql).toContain('ROLLBACK;');
      expect(calledSql).not.toContain('COMMIT;');
    });

    it('aborts with PARTIAL_GRANT_WARNING and rolls back if the server emits a notice mid-transaction, never reporting a false RECONCILED', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });
      const baseImpl = mockQuery.getMockImplementation()!;
      mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes('GRANT SELECT, INSERT, UPDATE ON TABLE "users"')) {
          // PostgreSQL real: el statement "tiene éxito" pero puede emitir
          // un NOTICE — nunca rechaza la promesa por sí solo.
          capturedNoticeHandler?.({ message: 'no privileges were granted for "users"' });
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return baseImpl(sql, params);
      });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'PARTIAL_GRANT_WARNING' });

      const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(calledSql).toContain('ROLLBACK;');
      expect(calledSql).not.toContain('COMMIT;');
    });

    it('is idempotent: two consecutive successful reconciliations both resolve cleanly', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });

      const first = await reconcilePrivileges();
      installQueryMock({ currentUser: 'migration_test' }); // reset "grantsExecuted" state for a fresh second run
      const second = await reconcilePrivileges();

      expect(first.outcome).toBe('RECONCILED');
      expect(second.outcome).toBe('RECONCILED');
    });

    it('throws a sanitized DB_CONNECTION_FAILED and never leaks the DSN when connect() rejects', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:s3cr3t-password@10.9.9.9:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      mockConnect.mockReset().mockRejectedValue(new Error('connection to server at "10.9.9.9" failed: password authentication failed for user "migration_test"'));
      mockEnd.mockReset().mockResolvedValue(undefined);
      mockQuery.mockReset();

      let caught: unknown;
      try {
        await reconcilePrivileges();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ReconcilerError);
      const err = caught as ReconcilerError;
      expect(err.code).toBe('DB_CONNECTION_FAILED');
      expect(err.message).not.toContain('s3cr3t-password');
      expect(err.message).not.toContain('10.9.9.9');
      expect(JSON.stringify(err)).not.toContain('s3cr3t-password');
    });

    it('never grants CREATE on schema, ALL TABLES/SEQUENCES, ALTER DEFAULT PRIVILEGES, or pgmigrations privileges in the executed SQL', async () => {
      setEnv({ MIGRATION_DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });

      await reconcilePrivileges();

      const executedSql = mockQuery.mock.calls
        .map((c) => c[0] as string)
        .join('\n')
        .toUpperCase();
      expect(executedSql).not.toContain('SUPERUSER');
      expect(executedSql).not.toContain('CREATEDB');
      expect(executedSql).not.toContain('CREATEROLE');
      expect(executedSql).not.toMatch(/GRANT\s+CREATE\b/);
      expect(executedSql).not.toContain('OWNER TO');
      expect(executedSql).not.toContain('ALL TABLES');
      expect(executedSql).not.toContain('ALL SEQUENCES');
      expect(executedSql).not.toContain('ALTER DEFAULT PRIVILEGES');

      const grantStatements = mockQuery.mock.calls
        .map((c) => c[0] as string)
        .filter((sql) => sql.startsWith('GRANT'));
      expect(grantStatements.every((sql) => !sql.toLowerCase().includes('pgmigrations'))).toBe(true);
    });
  });
});
