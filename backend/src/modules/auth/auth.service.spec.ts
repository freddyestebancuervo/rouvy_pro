import { TokenService } from '../../jwt/token.service';
import { RefreshTokensRepository, RotationOutcome } from '../refresh-tokens/refresh-tokens.repository';
import { UserRecord, UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';

/**
 * Unit tests de `AuthService.refresh` — la pieza de C4 con más ramas de
 * decisión (rotar / reuso / expirado / no encontrado / usuario borrado).
 * `register`/`login` ya están cubiertos end-to-end contra Postgres real
 * en `test/auth.e2e-spec.ts`; acá se aíslan las dependencias con mocks
 * para poder ejercitar cada rama de `RotationOutcome` sin depender de la
 * base de datos ni de temporización real de expiración.
 */
describe('AuthService.refresh', () => {
  const oldTokenHash = 'hash-of-old-token';
  const newTokenHash = 'hash-of-new-token';

  function buildService(overrides?: {
    rotate?: jest.Mock;
    findById?: jest.Mock;
    findRoleNames?: jest.Mock;
    findByEmail?: jest.Mock;
    createWithPassword?: jest.Mock;
  }) {
    const usersRepository = {
      findByEmail: overrides?.findByEmail ?? jest.fn(),
      findById: overrides?.findById ?? jest.fn(),
      createWithPassword: overrides?.createWithPassword ?? jest.fn(),
      findRoleNames: overrides?.findRoleNames ?? jest.fn().mockResolvedValue(['user']),
    } as unknown as jest.Mocked<UsersRepository>;

    const refreshTokensRepository = {
      create: jest.fn(),
      rotate: overrides?.rotate ?? jest.fn(),
    } as unknown as jest.Mocked<RefreshTokensRepository>;

    const tokenService = {
      hashRefreshToken: jest.fn().mockReturnValue(oldTokenHash),
      issueRefreshToken: jest.fn().mockReturnValue({
        token: 'rt_new-plaintext',
        hash: newTokenHash,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      }),
      signAccessToken: jest.fn().mockReturnValue('signed.jwt.token'),
      accessTokenExpiresIn: 3600,
    } as unknown as jest.Mocked<TokenService>;

    const service = new AuthService(usersRepository, refreshTokensRepository, tokenService);
    return { service, usersRepository, refreshTokensRepository, tokenService };
  }

  it('rota exitosamente: revoca el viejo, emite uno nuevo y firma un access token con los roles reales', async () => {
    const rotate = jest.fn<Promise<RotationOutcome>, unknown[]>().mockResolvedValue({
      status: 'rotated',
      userId: 'user-1',
    });
    const findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      emailVerified: true,
    } as UserRecord);
    const findRoleNames = jest.fn().mockResolvedValue(['user', 'premium']);
    const { service, tokenService, refreshTokensRepository } = buildService({
      rotate,
      findById,
      findRoleNames,
    });

    const result = await service.refresh({ refreshToken: 'rt_old-plaintext' });

    expect(refreshTokensRepository.rotate).toHaveBeenCalledWith({
      oldTokenHash,
      newTokenHash,
      newExpiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({
      userId: 'user-1',
      roles: ['user', 'premium'],
      emailVerified: true,
    });
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: 'rt_new-plaintext',
      expiresIn: 3600,
    });
  });

  it.each([['not_found'], ['expired']] as const)(
    'responde REFRESH_TOKEN_INVALID_OR_REUSED (401) cuando el outcome es "%s"',
    async (status) => {
      const rotate = jest.fn<Promise<RotationOutcome>, unknown[]>().mockResolvedValue({ status });
      const { service } = buildService({ rotate });

      await expect(service.refresh({ refreshToken: 'rt_x' })).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_INVALID_OR_REUSED',
      });
    },
  );

  it('detecta reuso: responde 401 sin exponer que fue por reuso (mismo código que inválido/expirado)', async () => {
    const rotate = jest
      .fn<Promise<RotationOutcome>, unknown[]>()
      .mockResolvedValue({ status: 'reused', userId: 'user-1' });
    const { service, usersRepository } = buildService({ rotate });

    await expect(service.refresh({ refreshToken: 'rt_stolen' })).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID_OR_REUSED',
    });
    // El reuso ya implica que `RefreshTokensRepository.rotate` revocó todos
    // los tokens del usuario dentro de su propia transacción — el service
    // no debe emitir credenciales nuevas para ese usuario en esta rama.
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('responde 401 si el usuario del token ya no existe (borrado entre el lock y la lectura)', async () => {
    const rotate = jest
      .fn<Promise<RotationOutcome>, unknown[]>()
      .mockResolvedValue({ status: 'rotated', userId: 'user-ghost' });
    const findById = jest.fn().mockResolvedValue(null);
    const { service } = buildService({ rotate, findById });

    await expect(service.refresh({ refreshToken: 'rt_x' })).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID_OR_REUSED',
    });
  });
});

/**
 * `AuthService.register` — la revisión de arquitectura del cierre de
 * fase (Bloque C) encontró una condición de carrera real: dos registros
 * concurrentes con el mismo email en distinto case pasan ambos el
 * `findByEmail` (ninguno existe todavía) antes de que cualquiera haya
 * insertado. Se cerró con un índice único case-insensitive en la base
 * (migración `0002_users_email_case_insensitive_unique.sql`) — este test
 * cubre que `AuthService` traduce el `23505 unique_violation` resultante
 * al mismo `409 EMAIL_ALREADY_EXISTS` que ya devuelve el chequeo rápido,
 * en vez de dejarlo escapar como un `500` genérico.
 */
describe('AuthService.register', () => {
  function buildService(overrides: {
    findByEmail: jest.Mock;
    createWithPassword: jest.Mock;
  }) {
    const usersRepository = {
      findByEmail: overrides.findByEmail,
      findById: jest.fn(),
      createWithPassword: overrides.createWithPassword,
      findRoleNames: jest.fn().mockResolvedValue(['user']),
    } as unknown as jest.Mocked<UsersRepository>;

    const refreshTokensRepository = {
      create: jest.fn(),
      rotate: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokensRepository>;

    const tokenService = {
      signAccessToken: jest.fn().mockReturnValue('signed.jwt.token'),
      issueRefreshToken: jest
        .fn()
        .mockReturnValue({ token: 'rt_new', hash: 'hash', expiresAt: new Date('2030-01-01') }),
      accessTokenExpiresIn: 3600,
    } as unknown as jest.Mocked<TokenService>;

    return new AuthService(usersRepository, refreshTokensRepository, tokenService);
  }

  it('traduce un 23505 (unique_violation) de la carrera concurrente a 409 EMAIL_ALREADY_EXISTS', async () => {
    const findByEmail = jest.fn().mockResolvedValue(null); // pasa el chequeo rápido
    const createWithPassword = jest.fn().mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    );
    const service = buildService({ findByEmail, createWithPassword });

    await expect(
      service.register({ email: 'rider@ridepro.com', password: 'Abcdefg1', displayName: 'Rider' }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
  });

  it('no absorbe otros errores de la base (los deja propagar sin traducir)', async () => {
    const findByEmail = jest.fn().mockResolvedValue(null);
    const dbError = Object.assign(new Error('connection terminated'), { code: '57P01' });
    const createWithPassword = jest.fn().mockRejectedValue(dbError);
    const service = buildService({ findByEmail, createWithPassword });

    await expect(
      service.register({ email: 'rider@ridepro.com', password: 'Abcdefg1', displayName: 'Rider' }),
    ).rejects.toBe(dbError);
  });
});
