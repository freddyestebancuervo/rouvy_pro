import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import * as request from 'supertest';
import { PG_POOL } from '../src/database/database.module';
import { FirebaseTokenVerifierService } from '../src/firebase/firebase-token-verifier.service';
import { createTestApp } from './utils/test-app';

/**
 * Fase 4.1 — mismo hallazgo que
 * `auth-firebase-exchange-concurrency-new-user.e2e-spec.ts`, pero para un
 * `firebase_uid` que YA existe en Postgres al momento de la ráfaga
 * concurrente (pasa por el camino `UPDATE ... WHERE firebase_uid = $1`,
 * no por el `INSERT` — no hay unique constraint que competir, pero sí
 * vale confirmar que la ráfaga concurrente sigue siendo estable: cero
 * 500, ninguna fila duplicada, mismo `sub` en todos los JWT).
 *
 * Archivo separado (mismo criterio de cuota de `ThrottlerStorage` que el
 * resto de la suite de exchange).
 */
describe('AuthController (e2e) — /auth/firebase/exchange — concurrencia, usuario existente', () => {
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

  it('15 exchanges concurrentes para un firebase_uid YA existente: cero 500, sigue habiendo una sola fila users/user_roles, mismo sub en todos los JWT', async () => {
    const firebaseUid = `firebase-uid-concurrency-existing-${randomUUID()}`;
    const email = `e2e-concurrency-existing-${randomUUID()}@ridepro.com`;

    verifyMock.mockResolvedValue({
      uid: firebaseUid,
      email,
      emailVerified: true,
      displayName: 'Concurrency Existing User',
      signInProvider: 'password',
    });

    // Crea el usuario primero (fuera de la ráfaga concurrente).
    const first = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer un-token-cualquiera')
      .expect(200);
    const userId = first.body.userId;

    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        request(app.getHttpServer())
          .post('/v1/auth/firebase/exchange')
          .set('Authorization', 'Bearer un-token-cualquiera'),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(responses.every((r) => r.body.userId === userId)).toBe(true);

    const subs = new Set(
      responses.map((r) => (jwt.decode(r.body.accessToken) as Record<string, unknown>).sub),
    );
    expect(subs.size).toBe(1);
    expect([...subs][0]).toBe(userId);

    const usersCount = await pool.query('SELECT count(*)::int AS n FROM users WHERE firebase_uid = $1', [
      firebaseUid,
    ]);
    expect(usersCount.rows[0].n).toBe(1);

    const rolesCount = await pool.query(
      'SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1',
      [userId],
    );
    expect(rolesCount.rows[0].n).toBe(1);
  }, 20000);
});
