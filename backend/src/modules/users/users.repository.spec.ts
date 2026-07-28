import { FirebaseEmailConflictError } from './errors/firebase-email-conflict.error';
import { UsersRepository } from './users.repository';

/**
 * Unit tests de la lógica de manejo de concurrencia de
 * `upsertByFirebaseUid` (Fase 4.1) — la concurrencia REAL (múltiples
 * conexiones/instancias de verdad compitiendo en Postgres) se prueba en
 * `test/auth-firebase-exchange-concurrency.e2e-spec.ts`; acá se verifica,
 * con un `pg.Pool` mockeado, que la rama de manejo de la colisión hace
 * exactamente lo que dice su docblock: la constraint solo habilita el
 * camino controlado, la re-consulta por `firebaseUid` decide el resultado.
 */
describe('UsersRepository.upsertByFirebaseUid — manejo de colisión 23505', () => {
  function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'winner-id',
      email: 'race@ridepro.test',
      password_hash: null,
      display_name: 'Winner',
      photo_url: null,
      ftp: null,
      weight_kg: null,
      premium: false,
      email_verified: true,
      auth_provider: 'password',
      firebase_uid: 'firebase-uid-race',
      created_at: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    };
  }

  function buildRepository() {
    const clientQuery = jest.fn();
    const client = { query: clientQuery, release: jest.fn() };
    const poolQuery = jest.fn();
    const pool = { query: poolQuery, connect: jest.fn().mockResolvedValue(client) };
    const repository = new UsersRepository(pool as never);
    return { repository, pool, poolQuery, client, clientQuery };
  }

  const params = {
    firebaseUid: 'firebase-uid-race',
    email: 'race@ridepro.test',
    emailVerified: true,
    displayName: 'Race',
    provider: 'password' as const,
  };

  it('constraint users_firebase_uid_unique + fila encontrada al re-consultar → devuelve al ganador, isNew:false, sin duplicar user_roles', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    // findByFirebaseUid (chequeo rápido) y findByEmail: ninguno existe todavía.
    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByFirebaseUid inicial
    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByEmail

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_firebase_uid_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError); // INSERT INTO users
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    // Re-consulta por firebaseUid tras la colisión: encuentra al ganador.
    poolQuery.mockResolvedValueOnce({ rows: [buildRow({ id: 'winner-id' })] });

    const result = await repository.upsertByFirebaseUid(params);

    expect(result).toEqual({ user: expect.objectContaining({ id: 'winner-id' }), isNew: false });

    // Nunca se intentó el INSERT de user_roles (el error corta antes de esa línea).
    const queriesRun = clientQuery.mock.calls.map((call) => String(call[0]));
    expect(queriesRun).toEqual(['BEGIN', expect.stringContaining('INSERT INTO users'), 'ROLLBACK']);
    expect(queriesRun.some((q) => q.includes('user_roles'))).toBe(false);
  });

  it('constraint users_email_unique + fila NO encontrada al re-consultar (firebase_uid distinto) → FirebaseEmailConflictError', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByFirebaseUid inicial
    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByEmail

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError); // INSERT INTO users
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    // Re-consulta por ESTE firebaseUid: no existe (el email lo ganó otra cuenta distinta).
    poolQuery.mockResolvedValueOnce({ rows: [] });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
  });

  it('constraint users_email_lower_unique + fila encontrada → también se trata como carrera legítima', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [] });

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_lower_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError);
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    poolQuery.mockResolvedValueOnce({ rows: [buildRow({ id: 'winner-id-2' })] });

    const result = await repository.upsertByFirebaseUid(params);
    expect(result.isNew).toBe(false);
    expect(result.user.id).toBe('winner-id-2');
  });

  it('23505 sobre una constraint NO relacionada con users → se propaga sin capturar (no genérico)', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [] });

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'equipment_user_ble_address_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError);
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBe(pgError);
    // No debe haber intentado la re-consulta (solo los 2 chequeos rápidos iniciales).
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });

  it('error de base de datos que no es 23505 → se propaga sin capturar, no se oculta', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [] });

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const connectionError = Object.assign(new Error('connection terminated unexpectedly'), {
      code: '08006',
    });
    clientQuery.mockRejectedValueOnce(connectionError);
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBe(connectionError);
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });
});

describe('UsersRepository.upsertByFirebaseUid — chequeo rápido findByEmail (antes de la transacción)', () => {
  function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'existing-id',
      email: 'race@ridepro.test',
      password_hash: null,
      display_name: 'Existing',
      photo_url: null,
      ftp: null,
      weight_kg: null,
      premium: false,
      email_verified: true,
      auth_provider: 'password',
      firebase_uid: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    };
  }

  function buildRepository() {
    const clientQuery = jest.fn();
    const client = { query: clientQuery, release: jest.fn() };
    const poolQuery = jest.fn();
    const connect = jest.fn().mockResolvedValue(client);
    const pool = { query: poolQuery, connect };
    const repository = new UsersRepository(pool as never);
    return { repository, pool, poolQuery, connect, client, clientQuery };
  }

  const params = {
    firebaseUid: 'firebase-uid-race',
    email: 'race@ridepro.test',
    emailVerified: true,
    displayName: 'Race',
    provider: 'password' as const,
  };

  it('mismo firebase_uid que el solicitado (ganó la carrera entre los dos chequeos) → devuelve esa fila, isNew:false, sin abrir transacción', async () => {
    const { repository, poolQuery, connect } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByFirebaseUid inicial: nada todavía
    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'winner-id', firebase_uid: 'firebase-uid-race' })],
    }); // findByEmail: ya existe, MISMO firebaseUid que params

    const result = await repository.upsertByFirebaseUid(params);

    expect(result).toEqual({
      user: expect.objectContaining({ id: 'winner-id', firebaseUid: 'firebase-uid-race' }),
      isNew: false,
    });
    expect(connect).not.toHaveBeenCalled(); // nunca se abrió transacción/INSERT
  });

  it('firebase_uid DISTINTO (otra cuenta Firebase real con el mismo email) → FirebaseEmailConflictError, sin abrir transacción', async () => {
    const { repository, poolQuery, connect } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByFirebaseUid inicial
    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'other-account-id', firebase_uid: 'firebase-uid-OTRA-CUENTA' })],
    });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('firebase_uid NULL (cuenta legacy de password) → FirebaseEmailConflictError, nunca se vincula automáticamente', async () => {
    const { repository, poolQuery, connect } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findByFirebaseUid inicial
    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'legacy-password-id', firebase_uid: null })],
    });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
    expect(connect).not.toHaveBeenCalled();
  });
});
