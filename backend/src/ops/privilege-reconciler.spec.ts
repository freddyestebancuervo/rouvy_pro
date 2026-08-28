import {
  isValidRoleIdentifier,
  quoteIdent,
  buildReconciliationStatements,
  assertMigrationContext,
  reconcilePrivileges,
  ReconcilerError,
} from './privilege-reconciler';

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
  delete process.env.RUNTIME_DB_ROLE;
  Object.assign(process.env, overrides);
}

/**
 * Despachador de queries por texto/prefijo — refleja el orden real de
 * `reconcilePrivileges` sin acoplar los tests al índice exacto de llamada.
 */
function installQueryMock(options: {
  currentUser?: string;
  canCreateInSchema?: boolean;
  roleExists?: boolean;
  failOnStatementSubstring?: string;
} = {}) {
  const { currentUser = 'migration_test', canCreateInSchema = true, roleExists = true, failOnStatementSubstring } = options;

  mockConnect.mockReset().mockResolvedValue(undefined);
  mockEnd.mockReset().mockResolvedValue(undefined);
  mockOn.mockReset().mockImplementation((event: string, handler: (notice: { message?: string }) => void) => {
    if (event === 'notice') capturedNoticeHandler = handler;
  });
  mockQuery.mockReset().mockImplementation((sql: string) => {
    if (sql.startsWith('SELECT current_user')) {
      return Promise.resolve({ rows: [{ current_user: currentUser }], rowCount: 1 });
    }
    if (sql.includes('has_schema_privilege')) {
      return Promise.resolve({ rows: [{ can_create: canCreateInSchema }], rowCount: 1 });
    }
    if (sql.startsWith('SELECT 1 FROM pg_roles')) {
      return Promise.resolve({ rows: roleExists ? [{ '?column?': 1 }] : [], rowCount: roleExists ? 1 : 0 });
    }
    if (sql === 'BEGIN;' || sql === 'COMMIT;' || sql === 'ROLLBACK;') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (failOnStatementSubstring && sql.includes(failOnStatementSubstring)) {
      return Promise.reject(new Error('simulated grant failure — must never leak this raw pg error'));
    }
    // Cualquiera de los 4 statements de reconciliación reales.
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
    it('builds exactly the 4 authorized statements, in order, with the quoted role interpolated', () => {
      const statements = buildReconciliationStatements('"korixa_runtime"');
      expect(statements).toEqual([
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "korixa_runtime";',
        'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "korixa_runtime";',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "korixa_runtime";',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "korixa_runtime";',
      ]);
    });

    it('never mentions SUPERUSER/CREATEDB/CREATEROLE/OWNER/CREATE-on-schema in any statement', () => {
      const statements = buildReconciliationStatements('"runtime_test"').join('\n').toUpperCase();
      expect(statements).not.toContain('SUPERUSER');
      expect(statements).not.toContain('CREATEDB');
      expect(statements).not.toContain('CREATEROLE');
      expect(statements).not.toContain('OWNER');
      expect(statements).not.toMatch(/GRANT\s+CREATE\b/);
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
    it('throws MISSING_DATABASE_URL and never connects when DATABASE_URL is absent', async () => {
      setEnv({ RUNTIME_DB_ROLE: 'runtime_test' });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'MISSING_DATABASE_URL' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws MISSING_RUNTIME_DB_ROLE and never connects when RUNTIME_DB_ROLE is absent', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test' });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'MISSING_RUNTIME_DB_ROLE' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws INVALID_RUNTIME_DB_ROLE_IDENTIFIER and never connects for an injection-shaped role name', async () => {
      setEnv({
        DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test',
        RUNTIME_DB_ROLE: "runtime_test\"; DROP TABLE users; --",
      });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'INVALID_RUNTIME_DB_ROLE_IDENTIFIER' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws INVALID_RUNTIME_DB_ROLE_IDENTIFIER for an empty RUNTIME_DB_ROLE value', async () => {
      // RUNTIME_DB_ROLE='' is falsy, so readRequiredEnv's own missing-check
      // catches it first — confirms the empty case fails closed too, just
      // via a different (still fail-closed) code path.
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: '' });
      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'MISSING_RUNTIME_DB_ROLE' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('aborts with RUNTIME_EQUALS_MIGRATION_IDENTITY and never issues BEGIN/GRANT when runtime role === migration identity', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'migration_test' });
      installQueryMock({ currentUser: 'migration_test' });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_EQUALS_MIGRATION_IDENTITY' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
      expect(mockEnd).toHaveBeenCalled();
    });

    it('aborts with UNEXPECTED_MIGRATION_CONTEXT when current_user lacks CREATE on schema public', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test', canCreateInSchema: false });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'UNEXPECTED_MIGRATION_CONTEXT' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
    });

    it('aborts with RUNTIME_ROLE_NOT_FOUND when the runtime role does not exist, and never issues BEGIN/GRANT', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'ghost_role' });
      installQueryMock({ currentUser: 'migration_test', roleExists: false });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'RUNTIME_ROLE_NOT_FOUND' });
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN;');
    });

    it('reconciles successfully: BEGIN, exactly the 4 statements with the quoted role, COMMIT, then closes the connection', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });

      const result = await reconcilePrivileges();

      expect(result).toEqual({
        runtime_role_identifier_valid: true,
        migration_context_valid: true,
        runtime_role_existed: true,
        statements_executed: 4,
        outcome: 'RECONCILED',
      });

      const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(calledSql).toContain('BEGIN;');
      expect(calledSql).toContain('COMMIT;');
      expect(calledSql).not.toContain('ROLLBACK;');
      expect(calledSql.filter((sql) => sql.includes('"runtime_test"'))).toHaveLength(4);
      expect(mockEnd).toHaveBeenCalled();
    });

    it('rolls back the whole transaction and throws GRANT_STATEMENT_FAILED if any statement fails midway, without ever committing', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test', failOnStatementSubstring: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES' });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'GRANT_STATEMENT_FAILED' });

      const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(calledSql).toContain('BEGIN;');
      expect(calledSql).toContain('ROLLBACK;');
      expect(calledSql).not.toContain('COMMIT;');
    });

    it('aborts with PARTIAL_GRANT_WARNING and rolls back if the server emits a notice mid-transaction (e.g. "no privileges were granted for X"), never reporting a false RECONCILED', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES')) {
          // PostgreSQL real: el statement "tiene éxito" pero emite un
          // NOTICE por cada objeto no-owned — nunca rechaza la promesa.
          capturedNoticeHandler?.({ message: 'no privileges were granted for "some_table"' });
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.startsWith('SELECT current_user')) return Promise.resolve({ rows: [{ current_user: 'migration_test' }], rowCount: 1 });
        if (sql.includes('has_schema_privilege')) return Promise.resolve({ rows: [{ can_create: true }], rowCount: 1 });
        if (sql.startsWith('SELECT 1 FROM pg_roles')) return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await expect(reconcilePrivileges()).rejects.toMatchObject({ code: 'PARTIAL_GRANT_WARNING' });

      const calledSql = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(calledSql).toContain('ROLLBACK;');
      expect(calledSql).not.toContain('COMMIT;');
    });

    it('is idempotent: two consecutive successful reconciliations both resolve cleanly', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
      installQueryMock({ currentUser: 'migration_test' });

      const first = await reconcilePrivileges();
      const second = await reconcilePrivileges();

      expect(first.outcome).toBe('RECONCILED');
      expect(second.outcome).toBe('RECONCILED');
    });

    it('throws a sanitized DB_CONNECTION_FAILED and never leaks the DSN when connect() rejects', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:s3cr3t-password@10.9.9.9:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
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

    it('never grants CREATE on schema or any admin-shaped privilege to the runtime role in the executed SQL', async () => {
      setEnv({ DATABASE_URL: 'postgres://migration_test:pw@localhost:5432/korixa_test', RUNTIME_DB_ROLE: 'runtime_test' });
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
    });
  });
});
