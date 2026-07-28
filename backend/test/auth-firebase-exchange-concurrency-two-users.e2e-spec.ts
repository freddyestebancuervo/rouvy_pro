import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import * as request from 'supertest';
import { PG_POOL } from '../src/database/database.module';
import { FirebaseTokenVerifierService } from '../src/firebase/firebase-token-verifier.service';
import { createTestApp } from './utils/test-app';

/**
 * Fase 4.1 — variante de
 * `auth-firebase-exchange-concurrency-new-user.e2e-spec.ts`: dos
 * `firebase_uid` NUEVOS y distintos, cada uno con su propia ráfaga
 * concurrente, disparadas todas juntas (interleaved) en el mismo
 * `Promise.all` — confirma que la re-consulta tras la colisión de un
 * usuario nunca "contamina" al otro (cada uno resuelve a su propia fila,
 * nunca comparten `sub`).
 *
 * Archivo separado (mismo criterio de cuota de `ThrottlerStorage`).
 */
describe('AuthController (e2e) — /auth/firebase/exchange — concurrencia, dos usuarios nuevos en paralelo', () => {
  let app: INestApplication;
  let pool: Pool;
  let verifyMock: jest.Mock;

  beforeAll(async () => {
    verifyMock = jest.fn();
    app = await createTestApp([
      { provide: FirebaseTokenVerifierService, useValue: { verify: verifyMock } },
    ]);
    pool = app.get(PG_POOL);
  });

  afterAll(async () => {
    await app.close();
  });

  it('2 firebase_uid nuevos distintos, 8 requests concurrentes cada uno (16 total interleaved): cada uno resuelve a su propia fila, sin contaminación cruzada', async () => {
    const userA = {
      firebaseUid: `firebase-uid-concurrency-A-${randomUUID()}`,
      email: `e2e-concurrency-two-a-${randomUUID()}@ridepro.com`,
    };
    const userB = {
      firebaseUid: `firebase-uid-concurrency-B-${randomUUID()}`,
      email: `e2e-concurrency-two-b-${randomUUID()}@ridepro.com`,
    };

    function exchangeAs(user: typeof userA) {
      verifyMock.mockResolvedValueOnce({
        uid: user.firebaseUid,
        email: user.email,
        emailVerified: true,
        displayName: 'Concurrency Two Users',
        signInProvider: 'password',
      });
      return request(app.getHttpServer())
        .post('/v1/auth/firebase/exchange')
        .set('Authorization', 'Bearer un-token-cualquiera');
    }

    const requestsA = Array.from({ length: 8 }, () => exchangeAs(userA));
    const requestsB = Array.from({ length: 8 }, () => exchangeAs(userB));
    // Interleaved a propósito (A, B, A, B, ...) — cada `mockResolvedValueOnce`
    // ya fija por adelantado qué usuario le corresponde a cada request,
    // independientemente del orden real en que el servidor las procese.
    const interleaved = requestsA.flatMap((reqA, i) => [reqA, requestsB[i]]);

    const responses = await Promise.all(interleaved);
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const responsesA = responses.filter((r) => r.body.email === userA.email);
    const responsesB = responses.filter((r) => r.body.email === userB.email);
    expect(responsesA).toHaveLength(8);
    expect(responsesB).toHaveLength(8);

    const userIdsA = new Set(responsesA.map((r) => r.body.userId));
    const userIdsB = new Set(responsesB.map((r) => r.body.userId));
    expect(userIdsA.size).toBe(1);
    expect(userIdsB.size).toBe(1);
    expect([...userIdsA][0]).not.toBe([...userIdsB][0]);

    const subsA = new Set(
      responsesA.map((r) => (jwt.decode(r.body.accessToken) as Record<string, unknown>).sub),
    );
    const subsB = new Set(
      responsesB.map((r) => (jwt.decode(r.body.accessToken) as Record<string, unknown>).sub),
    );
    expect(subsA.size).toBe(1);
    expect(subsB.size).toBe(1);

    for (const user of [userA, userB]) {
      const usersCount = await pool.query(
        'SELECT count(*)::int AS n FROM users WHERE firebase_uid = $1',
        [user.firebaseUid],
      );
      expect(usersCount.rows[0].n).toBe(1);
    }

    const rolesCountA = await pool.query('SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1', [
      [...userIdsA][0],
    ]);
    expect(rolesCountA.rows[0].n).toBe(1);
    const rolesCountB = await pool.query('SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1', [
      [...userIdsB][0],
    ]);
    expect(rolesCountB.rows[0].n).toBe(1);
  }, 20000);
});
