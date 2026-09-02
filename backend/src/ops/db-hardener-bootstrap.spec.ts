import {
  readRequiredBootstrapEnv,
  buildGrantAdminOptionStatement,
  buildRevokeAdminOptionStatement,
  runGrantAdminOption,
  runRevokeAdminOption,
  runBootstrap,
  BootstrapError,
  BOOTSTRAP_TARGET_ROLE,
  type BootstrapEnv,
} from './db-hardener-bootstrap';

// `pg.Client` se mockea por completo — ningún test de este archivo toca una
// base de datos real (misma disciplina que db-role-hardener.spec.ts).
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

const VALID_ADMIN_USERNAME = 'korixa_db_hardener_once_a1b2c3d4e5f6';
const VALID_DSN = `postgres://${VALID_ADMIN_USERNAME}:pw@10.10.16.3:5432/korixa_production`;

function baseEnv(overrides: Partial<BootstrapEnv> = {}): BootstrapEnv {
  return {
    MIGRATION_DATABASE_URL: VALID_DSN,
    BOOTSTRAP_MODE: 'grant-admin-option',
    EPHEMERAL_ADMIN_USERNAME: VALID_ADMIN_USERNAME,
    EXPECTED_DATABASE: 'korixa_production',
    EXPECTED_DB_HOST: '10.10.16.3',
    EXPECTED_SOURCE_SHA: '84d7b2f2d9fb40ad0859671f8f264fec1a61f228',
    ...overrides,
  };
}

function mockHappyPath(currentUser: string = VALID_ADMIN_USERNAME): void {
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockEnd.mockReset().mockResolvedValue(undefined);
  mockQuery.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('current_user')) {
      return { rows: [{ current_user: currentUser }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  mockConnect.mockReset();
  mockQuery.mockReset();
  mockEnd.mockReset();
});

describe('readRequiredBootstrapEnv', () => {
  it('lee un entorno válido completo para grant-admin-option', () => {
    expect(readRequiredBootstrapEnv(baseEnv() as unknown as NodeJS.ProcessEnv)).toEqual(baseEnv());
  });

  it('lee un entorno válido completo para revoke-admin-option', () => {
    const env = baseEnv({ BOOTSTRAP_MODE: 'revoke-admin-option' });
    expect(readRequiredBootstrapEnv(env as unknown as NodeJS.ProcessEnv)).toEqual(env);
  });

  it('rechaza DATABASE_URL presente, sin importar su valor, ANTES de leer nada más', () => {
    expect(() => readRequiredBootstrapEnv({ ...baseEnv(), DATABASE_URL: '' } as unknown as NodeJS.ProcessEnv)).toThrow(BootstrapError);
    try {
      readRequiredBootstrapEnv({ ...baseEnv(), DATABASE_URL: 'anything' } as unknown as NodeJS.ProcessEnv);
      fail('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(BootstrapError);
      expect((e as BootstrapError).code).toBe('FORBIDDEN_DATABASE_URL_IN_BOOTSTRAP_CONTEXT');
    }
  });

  it('rechaza MIGRATION_DATABASE_URL ausente', () => {
    const env = { ...baseEnv(), MIGRATION_DATABASE_URL: undefined } as unknown as NodeJS.ProcessEnv;
    expect(() => readRequiredBootstrapEnv(env)).toThrow(BootstrapError);
  });

  it('rechaza BOOTSTRAP_MODE ausente o inválido', () => {
    expect(() => readRequiredBootstrapEnv({ ...baseEnv(), BOOTSTRAP_MODE: undefined } as unknown as NodeJS.ProcessEnv)).toThrow(
      BootstrapError,
    );
    for (const bad of ['preflight', 'apply', 'verify', 'GRANT-ADMIN-OPTION', 'grant_admin_option', '']) {
      expect(() =>
        readRequiredBootstrapEnv({ ...baseEnv(), BOOTSTRAP_MODE: bad } as unknown as NodeJS.ProcessEnv),
      ).toThrow(BootstrapError);
    }
  });

  it('rechaza EPHEMERAL_ADMIN_USERNAME ausente', () => {
    expect(() =>
      readRequiredBootstrapEnv({ ...baseEnv(), EPHEMERAL_ADMIN_USERNAME: undefined } as unknown as NodeJS.ProcessEnv),
    ).toThrow(BootstrapError);
  });

  it('rechaza EPHEMERAL_ADMIN_USERNAME que no coincide EXACTAMENTE con el patrón esperado — nunca acepta un identificador de rol no probado', () => {
    const attempts = [
      'korixa_app', // el rol objetivo, nunca un admin efímero
      'postgres',
      'korixa_db_hardener_once_', // sin sufijo
      'korixa_db_hardener_once_ABCDEF012345', // mayúsculas
      'korixa_db_hardener_once_0123456789a', // 11 hex
      `${VALID_ADMIN_USERNAME}; DROP TABLE pg_roles; --`, // intento de inyección
      `${VALID_ADMIN_USERNAME} WITH ADMIN OPTION`, // intento de inyección de cláusula
      '',
    ];
    for (const bad of attempts) {
      let thrown: unknown;
      try {
        readRequiredBootstrapEnv({ ...baseEnv(), EPHEMERAL_ADMIN_USERNAME: bad } as unknown as NodeJS.ProcessEnv);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BootstrapError);
      expect((thrown as BootstrapError).code).toBe(
        bad === '' ? 'MISSING_EPHEMERAL_ADMIN_USERNAME' : 'INVALID_EPHEMERAL_ADMIN_USERNAME_FORMAT',
      );
    }
  });

  it('rechaza EXPECTED_DATABASE ausente o distinto de korixa_production', () => {
    expect(() => readRequiredBootstrapEnv({ ...baseEnv(), EXPECTED_DATABASE: undefined } as unknown as NodeJS.ProcessEnv)).toThrow(
      BootstrapError,
    );
    expect(() => readRequiredBootstrapEnv({ ...baseEnv(), EXPECTED_DATABASE: 'other_db' } as unknown as NodeJS.ProcessEnv)).toThrow(
      BootstrapError,
    );
  });

  it('rechaza EXPECTED_DB_HOST ausente', () => {
    expect(() => readRequiredBootstrapEnv({ ...baseEnv(), EXPECTED_DB_HOST: undefined } as unknown as NodeJS.ProcessEnv)).toThrow(
      BootstrapError,
    );
  });

  it('rechaza EXPECTED_SOURCE_SHA ausente', () => {
    expect(() =>
      readRequiredBootstrapEnv({ ...baseEnv(), EXPECTED_SOURCE_SHA: undefined } as unknown as NodeJS.ProcessEnv),
    ).toThrow(BootstrapError);
  });
});

describe('buildGrantAdminOptionStatement / buildRevokeAdminOptionStatement', () => {
  it('produce EXACTAMENTE el statement fijo esperado, con BOOTSTRAP_TARGET_ROLE constante', () => {
    expect(buildGrantAdminOptionStatement(VALID_ADMIN_USERNAME)).toBe(
      `GRANT ${BOOTSTRAP_TARGET_ROLE} TO ${VALID_ADMIN_USERNAME} WITH ADMIN OPTION;`,
    );
    expect(buildRevokeAdminOptionStatement(VALID_ADMIN_USERNAME)).toBe(
      `REVOKE ${BOOTSTRAP_TARGET_ROLE} FROM ${VALID_ADMIN_USERNAME};`,
    );
  });

  it('BOOTSTRAP_TARGET_ROLE es exactamente korixa_app — nunca configurable', () => {
    expect(BOOTSTRAP_TARGET_ROLE).toBe('korixa_app');
  });

  it('rechaza un username que no matchea el patrón exacto, ANTES de construir el statement — nunca interpola SQL no probado', () => {
    const injections = [
      "korixa_db_hardener_once_a1b2c3d4e5f6'; DROP TABLE pg_roles; --",
      'korixa_app', // intento de auto-otorgarse el rol objetivo directamente
      'postgres',
      '',
    ];
    for (const bad of injections) {
      expect(() => buildGrantAdminOptionStatement(bad)).toThrow(BootstrapError);
      expect(() => buildRevokeAdminOptionStatement(bad)).toThrow(BootstrapError);
    }
  });

  it('el statement de grant y el de revoke son siempre distintos entre sí, para el mismo username', () => {
    expect(buildGrantAdminOptionStatement(VALID_ADMIN_USERNAME)).not.toBe(buildRevokeAdminOptionStatement(VALID_ADMIN_USERNAME));
  });
});

describe('runGrantAdminOption', () => {
  it('conecta, confirma identidad, ejecuta EXACTAMENTE el GRANT, y devuelve ADMIN_OPTION_GRANTED', async () => {
    mockHappyPath();
    const result = await runGrantAdminOption(baseEnv());
    expect(result).toEqual({
      mode: 'grant-admin-option',
      source_sha: baseEnv().EXPECTED_SOURCE_SHA,
      ephemeral_admin_username: VALID_ADMIN_USERNAME,
      outcome: 'ADMIN_OPTION_GRANTED',
    });
    const grantCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.startsWith('GRANT'));
    expect(grantCall?.[0]).toBe(`GRANT korixa_app TO ${VALID_ADMIN_USERNAME} WITH ADMIN OPTION;`);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('nunca ejecuta ningún statement fuera del GRANT fijo', async () => {
    mockHappyPath();
    await runGrantAdminOption(baseEnv());
    for (const [sql] of mockQuery.mock.calls as Array<[string]>) {
      const isIdentityQuery = sql.includes('current_user');
      const isFixedGrant = sql === `GRANT korixa_app TO ${VALID_ADMIN_USERNAME} WITH ADMIN OPTION;`;
      expect(isIdentityQuery || isFixedGrant).toBe(true);
    }
  });

  it('rechaza el host/database del DSN que no coincida con EXPECTED_DB_HOST/EXPECTED_DATABASE, sin conectar', async () => {
    await expect(runGrantAdminOption(baseEnv({ EXPECTED_DB_HOST: '10.10.16.9' }))).rejects.toThrow(BootstrapError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('DB_CONNECTION_FAILED si connect() rechaza — nunca propaga el error crudo de pg', async () => {
    mockConnect.mockReset().mockRejectedValue(Object.assign(new Error('boom'), { code: '28P01' }));
    mockEnd.mockReset().mockResolvedValue(undefined);
    let thrown: unknown;
    try {
      await runGrantAdminOption(baseEnv());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BootstrapError);
    expect((thrown as BootstrapError).code).toBe('DB_CONNECTION_FAILED');
    expect((thrown as BootstrapError).message).not.toContain('boom');
  });

  it('CONNECTED_IDENTITY_NOT_EPHEMERAL_ADMIN si current_user no coincide con EPHEMERAL_ADMIN_USERNAME — nunca se infiere', async () => {
    mockHappyPath('some_other_role');
    let thrown: unknown;
    try {
      await runGrantAdminOption(baseEnv());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BootstrapError);
    expect((thrown as BootstrapError).code).toBe('CONNECTED_IDENTITY_NOT_EPHEMERAL_ADMIN');
    // nunca se ejecuta el GRANT si la identidad no coincide
    expect(mockQuery.mock.calls.some(([sql]: [string]) => sql.startsWith('GRANT'))).toBe(false);
  });

  it('GRANT_ADMIN_OPTION_FAILED si el GRANT falla en el servidor — nunca propaga el error crudo', async () => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('current_user')) return { rows: [{ current_user: VALID_ADMIN_USERNAME }] };
      if (sql.startsWith('GRANT')) throw new Error('permission denied');
      return { rows: [] };
    });
    let thrown: unknown;
    try {
      await runGrantAdminOption(baseEnv());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BootstrapError);
    expect((thrown as BootstrapError).code).toBe('GRANT_ADMIN_OPTION_FAILED');
    expect((thrown as BootstrapError).message).not.toContain('permission denied');
  });

  it('siempre cierra la conexión (client.end) incluso si el GRANT falla', async () => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('current_user')) return { rows: [{ current_user: VALID_ADMIN_USERNAME }] };
      throw new Error('boom');
    });
    await expect(runGrantAdminOption(baseEnv())).rejects.toThrow(BootstrapError);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});

describe('runRevokeAdminOption', () => {
  it('conecta, confirma identidad, ejecuta EXACTAMENTE el REVOKE, y devuelve ADMIN_OPTION_REVOKED', async () => {
    mockHappyPath();
    const env = baseEnv({ BOOTSTRAP_MODE: 'revoke-admin-option' });
    const result = await runRevokeAdminOption(env);
    expect(result).toEqual({
      mode: 'revoke-admin-option',
      source_sha: env.EXPECTED_SOURCE_SHA,
      ephemeral_admin_username: VALID_ADMIN_USERNAME,
      outcome: 'ADMIN_OPTION_REVOKED',
    });
    const revokeCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.startsWith('REVOKE'));
    expect(revokeCall?.[0]).toBe(`REVOKE korixa_app FROM ${VALID_ADMIN_USERNAME};`);
  });

  it('REVOKE_ADMIN_OPTION_FAILED si el REVOKE falla en el servidor', async () => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('current_user')) return { rows: [{ current_user: VALID_ADMIN_USERNAME }] };
      if (sql.startsWith('REVOKE')) throw new Error('server exploded');
      return { rows: [] };
    });
    let thrown: unknown;
    try {
      await runRevokeAdminOption(baseEnv({ BOOTSTRAP_MODE: 'revoke-admin-option' }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BootstrapError);
    expect((thrown as BootstrapError).code).toBe('REVOKE_ADMIN_OPTION_FAILED');
    expect((thrown as BootstrapError).message).not.toContain('server exploded');
  });

  it('CONNECTED_IDENTITY_NOT_EPHEMERAL_ADMIN aplica igual en modo revoke — nunca se infiere la identidad', async () => {
    mockHappyPath('wrong_user');
    await expect(runRevokeAdminOption(baseEnv({ BOOTSTRAP_MODE: 'revoke-admin-option' }))).rejects.toThrow(BootstrapError);
  });
});

describe('runBootstrap — dispatcher', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('despacha a runGrantAdminOption cuando BOOTSTRAP_MODE=grant-admin-option', async () => {
    mockHappyPath();
    process.env = { ...baseEnv() } as unknown as NodeJS.ProcessEnv;
    const result = await runBootstrap();
    expect(result.mode).toBe('grant-admin-option');
  });

  it('despacha a runRevokeAdminOption cuando BOOTSTRAP_MODE=revoke-admin-option', async () => {
    mockHappyPath();
    process.env = { ...baseEnv({ BOOTSTRAP_MODE: 'revoke-admin-option' }) } as unknown as NodeJS.ProcessEnv;
    const result = await runBootstrap();
    expect(result.mode).toBe('revoke-admin-option');
  });
});
