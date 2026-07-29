import { FirebaseEmailConflictError } from './errors/firebase-email-conflict.error';
import { UsersRepository } from './users.repository';

/**
 * Unit tests de `upsertByFirebaseUid` (Fase 4.1, rediseñado en Fase 4.2
 * Parte 2 — ver `findIdentityCandidates`) — la concurrencia REAL (múltiples
 * conexiones/instancias de verdad compitiendo en Postgres) se prueba en
 * `test/auth-firebase-exchange-concurrency.e2e-spec.ts`; acá se verifica,
 * con un `pg.Pool` mockeado, que el pre-chequeo combinado (una sola
 * consulta) y el manejo de la colisión 23505 en la transacción hacen
 * exactamente lo que dicen sus docblocks.
 */
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

describe('UsersRepository.upsertByFirebaseUid — pre-chequeo combinado (findIdentityCandidates)', () => {
  it('encontrado por firebase_uid (usuario existente, mismo email) → UPDATE, isNew:false, sin abrir transacción', async () => {
    const { repository, poolQuery, connect, clientQuery } = buildRepository();

    // Una sola consulta combinada — devuelve la fila que matchea por firebase_uid.
    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'existing-id', firebase_uid: 'firebase-uid-race' })],
    });
    // UPDATE ... RETURNING *
    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'existing-id', firebase_uid: 'firebase-uid-race', display_name: 'Race' })],
    });

    const result = await repository.upsertByFirebaseUid(params);

    expect(result).toEqual({
      user: expect.objectContaining({ id: 'existing-id', firebaseUid: 'firebase-uid-race' }),
      isNew: false,
    });
    expect(connect).not.toHaveBeenCalled(); // nunca abre transacción por este camino
    expect(clientQuery).not.toHaveBeenCalled();
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });

  it('encontrado por firebase_uid, pero el email cambió a uno de OTRA cuenta distinta → FirebaseEmailConflictError, sin UPDATE ni transacción', async () => {
    const { repository, poolQuery, connect, clientQuery } = buildRepository();

    // Una sola consulta combinada devuelve DOS filas: la del uid y la del email, con ids distintos.
    poolQuery.mockResolvedValueOnce({
      rows: [
        buildRow({ id: 'uid-owner-id', firebase_uid: 'firebase-uid-race', email: 'old@ridepro.test' }),
        buildRow({ id: 'other-account-id', firebase_uid: 'firebase-uid-OTRA-CUENTA', email: 'race@ridepro.test' }),
      ],
    });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
    expect(connect).not.toHaveBeenCalled();
    expect(clientQuery).not.toHaveBeenCalled();
    expect(poolQuery).toHaveBeenCalledTimes(1); // nunca llega a intentar el UPDATE
  });

  it('no encontrado por firebase_uid, pero el email ya pertenece a otra cuenta con firebase_uid DISTINTO → FirebaseEmailConflictError, sin abrir transacción', async () => {
    const { repository, poolQuery, connect } = buildRepository();

    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'other-account-id', firebase_uid: 'firebase-uid-OTRA-CUENTA' })],
    });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('no encontrado por firebase_uid, pero el email ya pertenece a una cuenta legacy (firebase_uid NULL) → FirebaseEmailConflictError, nunca se vincula automáticamente', async () => {
    const { repository, poolQuery, connect } = buildRepository();

    poolQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'legacy-password-id', firebase_uid: null })],
    });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('ni firebase_uid ni email encontrados → usuario nuevo, abre transacción, INSERT users + user_roles, isNew:true', async () => {
    const { repository, poolQuery, connect, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates: nada

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [buildRow({ id: 'new-user-id' })] }); // INSERT users
    clientQuery.mockResolvedValueOnce(undefined); // INSERT user_roles
    clientQuery.mockResolvedValueOnce(undefined); // COMMIT

    const result = await repository.upsertByFirebaseUid(params);

    expect(result).toEqual({ user: expect.objectContaining({ id: 'new-user-id' }), isNew: true });
    expect(connect).toHaveBeenCalledTimes(1);
    const queriesRun = clientQuery.mock.calls.map((call) => String(call[0]));
    expect(queriesRun[0]).toBe('BEGIN');
    expect(queriesRun[1]).toEqual(expect.stringContaining('INSERT INTO users'));
    expect(queriesRun[2]).toEqual(expect.stringContaining('user_roles'));
    expect(queriesRun[3]).toBe('COMMIT');
  });
});

describe('UsersRepository.upsertByFirebaseUid — manejo de colisión 23505 en la transacción', () => {
  it('constraint users_firebase_uid_unique + re-consulta (reusando el client retenido) encuentra al ganador → devuelve esa fila, isNew:false', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates: nada todavía

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_firebase_uid_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError); // INSERT INTO users
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK
    // Fase 4.2.1 — la re-consulta reusa `client` (NO pide una conexión nueva
    // del pool, evita el self-deadlock bajo colisiones concurrentes que
    // agotan el pool — ver docblock del método).
    clientQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'winner-id', firebase_uid: 'firebase-uid-race' })],
    });

    const result = await repository.upsertByFirebaseUid(params);

    expect(result).toEqual({ user: expect.objectContaining({ id: 'winner-id' }), isNew: false });

    // Nunca se intentó el INSERT de user_roles (el error corta antes de esa línea).
    const queriesRun = clientQuery.mock.calls.map((call) => String(call[0]));
    expect(queriesRun[0]).toBe('BEGIN');
    expect(queriesRun[1]).toEqual(expect.stringContaining('INSERT INTO users'));
    expect(queriesRun[2]).toBe('ROLLBACK');
    expect(queriesRun[3]).toEqual(expect.stringContaining('SELECT * FROM users WHERE firebase_uid'));
    expect(queriesRun.some((q) => q.includes('user_roles'))).toBe(false);
    // La re-consulta va por `client`, no por `pool` — el pool solo se usó
    // para el pre-chequeo inicial, nunca una segunda vez.
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('constraint users_email_unique + fila NO encontrada al re-consultar (firebase_uid distinto ganó el email) → FirebaseEmailConflictError', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError); // INSERT INTO users
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    // Re-consulta (por `client`) por ESTE firebaseUid: no existe (el email lo ganó otra cuenta distinta).
    clientQuery.mockResolvedValueOnce({ rows: [] });

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBeInstanceOf(
      FirebaseEmailConflictError,
    );
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('constraint users_email_lower_unique + fila encontrada → también se trata como carrera legítima', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_lower_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError);
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    clientQuery.mockResolvedValueOnce({
      rows: [buildRow({ id: 'winner-id-2', firebase_uid: 'firebase-uid-race' })],
    });

    const result = await repository.upsertByFirebaseUid(params);
    expect(result.isNew).toBe(false);
    expect(result.user.id).toBe('winner-id-2');
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('23505 sobre una constraint NO relacionada con users → se propaga sin capturar (no genérico)', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'equipment_user_ble_address_unique',
    });
    clientQuery.mockRejectedValueOnce(pgError);
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBe(pgError);
    // No debe haber intentado la re-consulta (solo el pre-chequeo inicial).
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('error de base de datos que no es 23505 → se propaga sin capturar, no se oculta', async () => {
    const { repository, poolQuery, clientQuery } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates

    clientQuery.mockResolvedValueOnce(undefined); // BEGIN
    const connectionError = Object.assign(new Error('connection terminated unexpectedly'), {
      code: '08006',
    });
    clientQuery.mockRejectedValueOnce(connectionError);
    clientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBe(connectionError);
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('timeout de adquisición del pool (pg-pool, sin .code) al pedir la conexión de la transacción → se propaga tal cual, no se traduce acá', async () => {
    const { repository, poolQuery, connect } = buildRepository();

    poolQuery.mockResolvedValueOnce({ rows: [] }); // findIdentityCandidates: pasa el pre-chequeo

    const poolTimeoutError = new Error('timeout exceeded when trying to connect');
    connect.mockRejectedValueOnce(poolTimeoutError);

    await expect(repository.upsertByFirebaseUid(params)).rejects.toBe(poolTimeoutError);
  });
});
