import {
  readRequiredEnv,
  parseConnectionString,
  assertExpectedTarget,
  assertSafeConnectedIdentity,
  assertExpectedAdminIdentity,
  classifyAdminCapability,
  runPreflight,
  runApply,
  runVerify,
  runHardener,
  HardenerError,
  APPLY_MUTATION_STATEMENTS,
  APPLY_CONFIRMATION_TOKEN,
  TARGET_ROLE,
  RUNTIME_ROLE,
  TARGET_SCHEMA,
  TARGET_DATABASE,
  type HardenerEnv,
  type RoleStateSnapshot,
} from './db-role-hardener';

// `pg.Client` se mockea por completo — ningún test de este archivo toca una
// base de datos real (misma disciplina que privilege-reconciler.spec.ts /
// db-readonly-inspector.spec.ts).
const mockConnect = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation((config: unknown) => ({
    __config: config,
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
  })),
}));

const VALID_DSN = 'postgres://admin_user:pw@10.10.16.3:5432/korixa_production';

const ADMIN_ROLE_STATE: RoleStateSnapshot = {
  rolname: 'korixa_production_admin',
  rolsuper: false,
  rolcreaterole: true,
  rolcreatedb: false,
  rolcanlogin: true,
  rolreplication: false,
  rolbypassrls: false,
};

const TARGET_ROLE_STATE_PRE: RoleStateSnapshot = {
  rolname: TARGET_ROLE,
  rolsuper: false,
  rolcreaterole: true,
  rolcreatedb: true,
  rolcanlogin: true,
  rolreplication: false,
  rolbypassrls: false,
};

const TARGET_ROLE_STATE_HARDENED: RoleStateSnapshot = {
  ...TARGET_ROLE_STATE_PRE,
  rolcreaterole: false,
  rolcreatedb: false,
};

const RUNTIME_ROLE_STATE: RoleStateSnapshot = {
  rolname: RUNTIME_ROLE,
  rolsuper: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolcanlogin: true,
  rolreplication: false,
  rolbypassrls: false,
};

function baseEnv(overrides: Partial<HardenerEnv> = {}): HardenerEnv {
  return {
    MIGRATION_DATABASE_URL: VALID_DSN,
    HARDENER_MODE: 'preflight',
    EXPECTED_ADMIN_DB_USER: ADMIN_ROLE_STATE.rolname,
    EXPECTED_DATABASE: TARGET_DATABASE,
    EXPECTED_DB_HOST: '10.10.16.3',
    EXPECTED_SOURCE_SHA: '84d7b2f2d9fb40ad0859671f8f264fec1a61f228',
    ...overrides,
  };
}

interface MockOptions {
  currentUser?: string;
  sessionUser?: string;
  adminRoleRow?: RoleStateSnapshot | undefined;
  targetRoleRow?: RoleStateSnapshot | undefined;
  targetRoleRowPost?: RoleStateSnapshot | undefined;
  runtimeRoleRow?: RoleStateSnapshot | undefined;
  runtimeRoleRowPost?: RoleStateSnapshot | undefined;
  adminOptionOnTarget?: boolean;
  activeSessionCount?: number;
  pgmigrationsExists?: boolean;
  targetPrivileges?: { connect: boolean; schema_usage: boolean; schema_create: boolean };
  cloudsqlsuperuserDirect?: boolean;
  cloudsqlsuperuserTransitive?: boolean;
  failOn?: 'ALTER_ROLE' | 'GRANT_CONNECT' | 'GRANT_SCHEMA';
}

/** Dispatcher genérico por contenido del SQL — evita depender del orden
 * exacto de llamadas, que cambiaría de forma frágil si la orquestación
 * interna se reordena sin cambiar el comportamiento observable. */
function installMockQuery(opts: MockOptions = {}) {
  const {
    currentUser = ADMIN_ROLE_STATE.rolname,
    sessionUser = currentUser,
    adminRoleRow = ADMIN_ROLE_STATE,
    targetRoleRow = TARGET_ROLE_STATE_PRE,
    targetRoleRowPost = TARGET_ROLE_STATE_HARDENED,
    runtimeRoleRow = RUNTIME_ROLE_STATE,
    runtimeRoleRowPost = RUNTIME_ROLE_STATE,
    adminOptionOnTarget = true,
    activeSessionCount = 0,
    pgmigrationsExists = false,
    targetPrivileges = { connect: true, schema_usage: true, schema_create: true },
    cloudsqlsuperuserDirect = false,
    cloudsqlsuperuserTransitive = false,
    failOn,
  } = opts;

  let targetRoleCallCount = 0;
  let runtimeRoleCallCount = 0;

  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('current_user AS current_user')) {
      return { rows: [{ current_user: currentUser, session_user: sessionUser, database: TARGET_DATABASE }], rowCount: 1 };
    }
    if (sql.trim() === 'BEGIN READ ONLY;' || sql.trim() === 'BEGIN;' || sql.trim() === 'COMMIT;' || sql.trim() === 'ROLLBACK;') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM pg_roles WHERE rolname = $1')) {
      const requested = (params as [string])[0];
      if (requested === TARGET_ROLE) {
        targetRoleCallCount += 1;
        const row = targetRoleCallCount > 1 ? targetRoleRowPost : targetRoleRow;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (requested === RUNTIME_ROLE) {
        runtimeRoleCallCount += 1;
        const row = runtimeRoleCallCount > 1 ? runtimeRoleRowPost : runtimeRoleRow;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: adminRoleRow ? [adminRoleRow] : [], rowCount: adminRoleRow ? 1 : 0 };
    }
    if (sql.includes('am.admin_option')) {
      return { rows: [{ admin_option: adminOptionOnTarget }], rowCount: 1 };
    }
    if (sql.includes('pg_stat_activity')) {
      return { rows: [{ active_count: activeSessionCount }], rowCount: 1 };
    }
    if (sql.includes('pgmigrations_exists')) {
      return { rows: [{ pgmigrations_exists: pgmigrationsExists }], rowCount: 1 };
    }
    if (sql.includes('has_database_privilege')) {
      return { rows: [targetPrivileges], rowCount: 1 };
    }
    if (sql.includes("r.rolname = 'cloudsqlsuperuser'") && sql.includes('pg_auth_members am')) {
      return { rows: cloudsqlsuperuserDirect ? [{ '?column?': 1 }] : [], rowCount: cloudsqlsuperuserDirect ? 1 : 0 };
    }
    if (sql.includes('role_tree')) {
      return { rows: cloudsqlsuperuserTransitive ? [{ member_role: TARGET_ROLE }] : [], rowCount: cloudsqlsuperuserTransitive ? 1 : 0 };
    }
    if (sql.startsWith('ALTER ROLE')) {
      if (failOn === 'ALTER_ROLE') throw new Error('simulated ALTER ROLE failure');
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('GRANT CONNECT')) {
      if (failOn === 'GRANT_CONNECT') throw new Error('simulated GRANT CONNECT failure');
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('GRANT USAGE')) {
      if (failOn === 'GRANT_SCHEMA') throw new Error('simulated GRANT USAGE/CREATE failure');
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unmocked query in test: ${sql}`);
  });
}

function setProcessEnv(overrides: Partial<NodeJS.ProcessEnv>) {
  delete process.env.DATABASE_URL;
  delete process.env.MIGRATION_DATABASE_URL;
  delete process.env.HARDENER_MODE;
  delete process.env.EXPECTED_ADMIN_DB_USER;
  delete process.env.EXPECTED_DATABASE;
  delete process.env.EXPECTED_DB_HOST;
  delete process.env.EXPECTED_SOURCE_SHA;
  delete process.env.HARDEN_CONFIRMATION;
  Object.assign(process.env, overrides);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
  installMockQuery();
});

// =============================================================================
// 1/2/3 — contrato de entorno
// =============================================================================

describe('readRequiredEnv', () => {
  it('1. aborta si DATABASE_URL está presente, sin importar otras variables', () => {
    expect(() =>
      readRequiredEnv({
        DATABASE_URL: 'postgres://x/y',
        MIGRATION_DATABASE_URL: VALID_DSN,
        HARDENER_MODE: 'preflight',
        EXPECTED_ADMIN_DB_USER: 'admin',
        EXPECTED_DATABASE: TARGET_DATABASE,
        EXPECTED_DB_HOST: 'h',
        EXPECTED_SOURCE_SHA: 'sha',
      }),
    ).toThrow(HardenerError);
    try {
      readRequiredEnv({ DATABASE_URL: 'postgres://x/y' });
    } catch (e) {
      expect((e as HardenerError).code).toBe('FORBIDDEN_DATABASE_URL_IN_HARDENER_CONTEXT');
    }
  });

  it('2. aborta si MIGRATION_DATABASE_URL falta', () => {
    try {
      readRequiredEnv({ HARDENER_MODE: 'preflight' });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('MISSING_MIGRATION_DATABASE_URL');
    }
  });

  it('3. aborta si HARDENER_MODE tiene un valor inválido', () => {
    try {
      readRequiredEnv({
        MIGRATION_DATABASE_URL: VALID_DSN,
        HARDENER_MODE: 'destroy-everything',
        EXPECTED_ADMIN_DB_USER: 'admin',
        EXPECTED_DATABASE: TARGET_DATABASE,
        EXPECTED_DB_HOST: 'h',
        EXPECTED_SOURCE_SHA: 'sha',
      });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('INVALID_HARDENER_MODE');
    }
  });

  it('rechaza HARDENER_MODE faltante', () => {
    try {
      readRequiredEnv({ MIGRATION_DATABASE_URL: VALID_DSN });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('MISSING_HARDENER_MODE');
    }
  });

  it('rechaza EXPECTED_DATABASE distinta de korixa_production', () => {
    try {
      readRequiredEnv({
        MIGRATION_DATABASE_URL: VALID_DSN,
        HARDENER_MODE: 'preflight',
        EXPECTED_ADMIN_DB_USER: 'admin',
        EXPECTED_DATABASE: 'some_other_db',
        EXPECTED_DB_HOST: 'h',
        EXPECTED_SOURCE_SHA: 'sha',
      });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('UNEXPECTED_TARGET_DATABASE_CONFIGURED');
    }
  });
});

// =============================================================================
// 4/5 — identidad conectada rechazada
// =============================================================================

describe('assertSafeConnectedIdentity', () => {
  it('4. rechaza current_user = korixa_runtime', () => {
    try {
      assertSafeConnectedIdentity({ currentUser: RUNTIME_ROLE, sessionUser: RUNTIME_ROLE });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('RUNTIME_IDENTITY_REJECTED');
    }
  });

  it('5. rechaza current_user = korixa_app', () => {
    try {
      assertSafeConnectedIdentity({ currentUser: TARGET_ROLE, sessionUser: TARGET_ROLE });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('TARGET_ROLE_IDENTITY_REJECTED');
    }
  });

  it('rechaza current_user != session_user', () => {
    try {
      assertSafeConnectedIdentity({ currentUser: 'a', sessionUser: 'b' });
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('CONNECTED_IDENTITY_MISMATCH');
    }
  });
});

describe('assertExpectedAdminIdentity', () => {
  it('6. apply rechaza una identidad administradora inesperada', () => {
    try {
      assertExpectedAdminIdentity('someone_else', ADMIN_ROLE_STATE.rolname);
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('UNEXPECTED_ADMIN_IDENTITY');
    }
  });
});

// =============================================================================
// 7 — capacidad administrativa (PostgreSQL 16: CREATEROLE solo no basta)
// =============================================================================

describe('classifyAdminCapability', () => {
  it('7. CREATEROLE=true sin ADMIN OPTION sobre el target es INSUFFICIENT (nunca se infiere)', () => {
    const result = classifyAdminCapability({ ...ADMIN_ROLE_STATE, rolcreaterole: true }, false);
    expect(result).toBe('INSUFFICIENT');
  });

  it('superusuario es siempre suficiente, incluso sin CREATEROLE ni ADMIN OPTION', () => {
    const result = classifyAdminCapability({ ...ADMIN_ROLE_STATE, rolsuper: true, rolcreaterole: false }, false);
    expect(result).toBe('SUPERUSER');
  });

  it('CREATEROLE + ADMIN OPTION sobre el target es suficiente', () => {
    const result = classifyAdminCapability({ ...ADMIN_ROLE_STATE, rolcreaterole: true }, true);
    expect(result).toBe('CREATEROLE_WITH_ADMIN_OPTION_ON_TARGET');
  });

  it('runPreflight se detiene en HOLD_ADMIN_CAPABILITY sin capacidad probada', async () => {
    installMockQuery({ adminOptionOnTarget: false });
    try {
      await runPreflight(baseEnv());
      fail('debía lanzar');
    } catch (e) {
      expect((e as HardenerError).code).toBe('HOLD_ADMIN_CAPABILITY');
    }
  });
});

// =============================================================================
// 8 — preflight ejecuta cero mutaciones
// =============================================================================

describe('runPreflight', () => {
  it('8. ejecuta cero mutaciones — solo BEGIN READ ONLY / SELECT / ROLLBACK', async () => {
    const result = await runPreflight(baseEnv());
    expect(result.mode).toBe('preflight');
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    for (const sql of calledSql) {
      const isMutation = /^(ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|CREATE)\b/i.test(sql);
      expect(isMutation).toBe(false);
    }
    expect(calledSql).toContain('BEGIN READ ONLY;');
    expect(calledSql).toContain('ROLLBACK;');
    expect(calledSql).not.toContain('COMMIT;');
  });

  it('preflight nunca conecta al importar el módulo (ver test de import más abajo)', () => {
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 9/10/11/12/13/14/15/16 — apply
// =============================================================================

describe('runApply', () => {
  function applyEnv(overrides: Partial<HardenerEnv> = {}) {
    return baseEnv({ HARDENER_MODE: 'apply', HARDEN_CONFIRMATION: APPLY_CONFIRMATION_TOKEN, ...overrides });
  }

  it('9. usa exactamente una transacción BEGIN/COMMIT en el camino de éxito', async () => {
    await runApply(applyEnv());
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql.filter((s) => s === 'BEGIN;')).toHaveLength(1);
    expect(calledSql.filter((s) => s === 'COMMIT;')).toHaveLength(1);
    expect(calledSql.filter((s) => s === 'ROLLBACK;')).toHaveLength(0);
  });

  it('10. ALTER ROLE falla -> ROLLBACK, nunca COMMIT', async () => {
    installMockQuery({ failOn: 'ALTER_ROLE' });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'ALTER_ROLE_FAILED' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).toContain('ROLLBACK;');
    expect(calledSql).not.toContain('COMMIT;');
  });

  it('11. el primer GRANT (CONNECT) falla -> ROLLBACK, nunca COMMIT', async () => {
    installMockQuery({ failOn: 'GRANT_CONNECT' });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'GRANT_CONNECT_FAILED' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).toContain('ROLLBACK;');
    expect(calledSql).not.toContain('COMMIT;');
  });

  it('12. el segundo GRANT (USAGE, CREATE) falla -> ROLLBACK, nunca COMMIT', async () => {
    installMockQuery({ failOn: 'GRANT_SCHEMA' });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'GRANT_SCHEMA_FAILED' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).toContain('ROLLBACK;');
    expect(calledSql).not.toContain('COMMIT;');
  });

  it('13. mismatch de estado post-mutación -> ROLLBACK con HOLD_POST_STATE_MISMATCH', async () => {
    installMockQuery({ targetRoleRowPost: { ...TARGET_ROLE_STATE_HARDENED, rolcreatedb: true } });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'HOLD_POST_STATE_MISMATCH' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).toContain('ROLLBACK;');
    expect(calledSql).not.toContain('COMMIT;');
  });

  it('14. drift del runtime durante la transacción -> ROLLBACK con RUNTIME_DRIFT_DURING_TRANSACTION', async () => {
    installMockQuery({ runtimeRoleRowPost: { ...RUNTIME_ROLE_STATE, rolcreatedb: true } });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'RUNTIME_DRIFT_DURING_TRANSACTION' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).toContain('ROLLBACK;');
    expect(calledSql).not.toContain('COMMIT;');
  });

  it('15. el camino de éxito ejecuta ÚNICAMENTE los 3 statements de mutación autorizados', async () => {
    await runApply(applyEnv());
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    const mutations = calledSql.filter((s) => /^(ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|CREATE)\b/i.test(s));
    expect(mutations).toEqual([...APPLY_MUTATION_STATEMENTS]);
  });

  it('16. no existe ningún parámetro SQL arbitrario — los 3 statements son literales fijos idénticos a la constante exportada', () => {
    expect(APPLY_MUTATION_STATEMENTS).toEqual([
      'ALTER ROLE korixa_app NOCREATEDB NOCREATEROLE;',
      'GRANT CONNECT ON DATABASE korixa_production TO korixa_app;',
      'GRANT USAGE, CREATE ON SCHEMA public TO korixa_app;',
    ]);
    for (const s of APPLY_MUTATION_STATEMENTS) {
      expect(s.includes('${')).toBe(false);
      expect(s.includes('$1')).toBe(false);
    }
  });

  it('exige la identidad administradora esperada exacta', async () => {
    installMockQuery({ currentUser: 'unexpected_identity', sessionUser: 'unexpected_identity' });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'UNEXPECTED_ADMIN_IDENTITY' });
  });

  it('exige el token de confirmación exacto', async () => {
    await expect(runApply(applyEnv({ HARDEN_CONFIRMATION: 'WRONG_TOKEN' }))).rejects.toMatchObject({
      code: 'INVALID_APPLY_CONFIRMATION',
    });
  });

  it('exige el token de confirmación presente', async () => {
    await expect(runApply(applyEnv({ HARDEN_CONFIRMATION: undefined }))).rejects.toMatchObject({
      code: 'MISSING_APPLY_CONFIRMATION',
    });
  });

  it('se detiene ANTES de BEGIN si hay una sesión activa usando korixa_app', async () => {
    installMockQuery({ activeSessionCount: 2 });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'ACTIVE_SESSION_USING_TARGET_ROLE' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).not.toContain('BEGIN;');
  });

  it('se detiene ANTES de BEGIN si public.pgmigrations ya existe', async () => {
    installMockQuery({ pgmigrationsExists: true });
    await expect(runApply(applyEnv())).rejects.toMatchObject({ code: 'PGMIGRATIONS_ALREADY_EXISTS' });
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calledSql).not.toContain('BEGIN;');
  });
});

// =============================================================================
// 17 — DSN/password nunca aparece en errores
// =============================================================================

describe('sanitización de errores', () => {
  it('17. un fallo de conexión nunca expone el DSN/password', async () => {
    mockConnect.mockRejectedValueOnce(new Error(`connection failed to ${VALID_DSN}`));
    try {
      await runPreflight(baseEnv());
      fail('debía lanzar');
    } catch (e) {
      const err = e as HardenerError;
      expect(err.code).toBe('DB_CONNECTION_FAILED');
      expect(err.message).not.toContain('pw');
      expect(err.message).not.toContain(VALID_DSN);
      expect(JSON.stringify(err)).not.toContain(VALID_DSN);
    }
  });

  it('un error inesperado durante apply nunca propaga el error crudo de pg', async () => {
    mockQuery.mockImplementationOnce(async () => {
      throw new Error(`pg internal error near ${VALID_DSN}`);
    });
    try {
      await runApply(baseEnv({ HARDENER_MODE: 'apply', HARDEN_CONFIRMATION: APPLY_CONFIRMATION_TOKEN }));
      fail('debía lanzar');
    } catch (e) {
      const err = e as HardenerError;
      expect(JSON.stringify(err)).not.toContain(VALID_DSN);
    }
  });
});

// =============================================================================
// 18 — importar el módulo nunca conecta
// =============================================================================

describe('reachability', () => {
  it('18. importar el módulo para sus funciones exportadas nunca conecta a nada', () => {
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 19 — verify es de solo lectura
// =============================================================================

describe('runVerify', () => {
  it('19. verify ejecuta cero mutaciones — solo BEGIN READ ONLY / SELECT / ROLLBACK', async () => {
    const result = await runVerify(baseEnv({ HARDENER_MODE: 'verify' }));
    expect(result.mode).toBe('verify');
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    for (const sql of calledSql) {
      const isMutation = /^(ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|CREATE)\b/i.test(sql);
      expect(isMutation).toBe(false);
    }
    expect(calledSql).toContain('BEGIN READ ONLY;');
    expect(calledSql).toContain('ROLLBACK;');
  });

  it('reporta SQL_HARDENED_CLOUDSQL_MEMBERSHIP_PENDING cuando el SQL ya está endurecido pero cloudsqlsuperuser sigue presente', async () => {
    installMockQuery({ targetRoleRow: TARGET_ROLE_STATE_HARDENED, cloudsqlsuperuserDirect: true });
    const result = await runVerify(baseEnv({ HARDENER_MODE: 'verify' }));
    expect(result.disposition).toBe('SQL_HARDENED_CLOUDSQL_MEMBERSHIP_PENDING');
  });

  it('reporta SQL_HARDENING_NOT_YET_APPLIED cuando korixa_app sigue con CREATEDB/CREATEROLE', async () => {
    installMockQuery({ targetRoleRow: TARGET_ROLE_STATE_PRE });
    const result = await runVerify(baseEnv({ HARDENER_MODE: 'verify' }));
    expect(result.disposition).toBe('SQL_HARDENING_NOT_YET_APPLIED');
  });

  it('reporta SQL_AND_CLOUDSQL_FULLY_HARDENED cuando ambos están resueltos', async () => {
    installMockQuery({ targetRoleRow: TARGET_ROLE_STATE_HARDENED, cloudsqlsuperuserDirect: false, cloudsqlsuperuserTransitive: false });
    const result = await runVerify(baseEnv({ HARDENER_MODE: 'verify' }));
    expect(result.disposition).toBe('SQL_AND_CLOUDSQL_FULLY_HARDENED');
  });

  it('nunca emite un campo literal POINT_8_PASS', async () => {
    const result = await runVerify(baseEnv({ HARDENER_MODE: 'verify' }));
    expect(JSON.stringify(result)).not.toContain('POINT_8_PASS');
  });
});

// =============================================================================
// 20 — cloudsqlsuperuser nunca se toca desde este programa
// =============================================================================

describe('límite cloudsqlsuperuser', () => {
  it('20. ningún statement ejecutado por apply contiene la palabra cloudsqlsuperuser, REVOKE, CREATE ROLE o DROP ROLE', async () => {
    await runApply(baseEnv({ HARDENER_MODE: 'apply', HARDEN_CONFIRMATION: APPLY_CONFIRMATION_TOKEN }));
    const calledSql = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    const mutations = calledSql.filter((s) => /^(ALTER|GRANT|REVOKE|CREATE|DROP)\b/i.test(s));
    for (const sql of mutations) {
      expect(sql.toLowerCase()).not.toContain('cloudsqlsuperuser');
      expect(sql.toUpperCase().startsWith('REVOKE')).toBe(false);
      expect(sql.toUpperCase()).not.toMatch(/^CREATE ROLE/);
      expect(sql.toUpperCase()).not.toMatch(/^DROP ROLE/);
    }
  });

  it('el código fuente de APPLY_MUTATION_STATEMENTS no contiene cloudsqlsuperuser/CREATE ROLE/DROP ROLE', () => {
    const joined = APPLY_MUTATION_STATEMENTS.join('\n').toLowerCase();
    expect(joined).not.toContain('cloudsqlsuperuser');
    expect(joined).not.toContain('create role');
    expect(joined).not.toContain('drop role');
    expect(joined).not.toContain('revoke');
  });
});

// =============================================================================
// Extras de robustez — DSN, target esperado, dispatcher.
// =============================================================================

describe('parseConnectionString / assertExpectedTarget', () => {
  it('rechaza una URL inválida', () => {
    expect(() => parseConnectionString('not-a-valid-url')).toThrow(HardenerError);
  });

  it('rechaza host inesperado', () => {
    const parsed = parseConnectionString(VALID_DSN);
    expect(() => assertExpectedTarget(parsed, 'wrong-host', TARGET_DATABASE)).toThrow(HardenerError);
  });

  it('rechaza database inesperada', () => {
    const parsed = parseConnectionString(VALID_DSN);
    expect(() => assertExpectedTarget(parsed, '10.10.16.3', 'wrong_db')).toThrow(HardenerError);
  });
});

describe('runHardener dispatcher', () => {
  it('despacha a runPreflight/runApply/runVerify según HARDENER_MODE', async () => {
    setProcessEnv({
      MIGRATION_DATABASE_URL: VALID_DSN,
      HARDENER_MODE: 'preflight',
      EXPECTED_ADMIN_DB_USER: ADMIN_ROLE_STATE.rolname,
      EXPECTED_DATABASE: TARGET_DATABASE,
      EXPECTED_DB_HOST: '10.10.16.3',
      EXPECTED_SOURCE_SHA: '84d7b2f2d9fb40ad0859671f8f264fec1a61f228',
    });
    const result = await runHardener();
    expect(result.mode).toBe('preflight');
  });
});

// TARGET_SCHEMA se usa por las consultas de privilegio de schema; se valida
// indirectamente arriba (has_schema_privilege(..., public, ...)) — este test
// solo documenta que la constante sigue siendo exactamente 'public'.
it('TARGET_SCHEMA sigue siendo exactamente "public"', () => {
  expect(TARGET_SCHEMA).toBe('public');
});
