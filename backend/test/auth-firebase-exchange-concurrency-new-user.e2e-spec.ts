import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import * as request from 'supertest';
import { PG_POOL } from '../src/database/database.module';
import { FirebaseTokenVerifierService } from '../src/firebase/firebase-token-verifier.service';
import { createTestApp } from './utils/test-app';

/**
 * Fase 4.1 — cierre de la race condition documentada en
 * `docs/audits/AUDITORIA_FINAL/fase_4/06_HALLAZGO_RACE_CONDITION_EXCHANGE.md`.
 * Contra Postgres real (sin mocks salvo `FirebaseTokenVerifierService`,
 * mismo criterio que el resto de la suite de exchange).
 *
 * Archivo separado (mismo criterio que
 * `auth-firebase-exchange-rate-limit.e2e-spec.ts`): 20 requests
 * concurrentes agotan por completo la cuota de 20/15min de
 * `POST /auth/firebase/exchange` — no puede compartir `ThrottlerStorage`
 * con ningún otro test de exchange.
 */
describe('AuthController (e2e) — /auth/firebase/exchange — concurrencia, usuario nuevo', () => {
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

  it('20 exchanges concurrentes para el mismo firebase_uid NUEVO: cero 500, una sola fila users, un solo user_roles, mismo sub en todos los JWT', async () => {
    // 20 conexiones/transacciones reales y simultáneas contra Postgres
    // tardan más que el timeout por defecto de Jest (5s).
    const firebaseUid = `firebase-uid-concurrency-${randomUUID()}`;
    const email = `e2e-concurrency-new-${randomUUID()}@ridepro.com`;

    verifyMock.mockResolvedValue({
      uid: firebaseUid,
      email,
      emailVerified: true,
      displayName: 'Concurrency New User',
      signInProvider: 'password',
    });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer())
          .post('/v1/auth/firebase/exchange')
          .set('Authorization', 'Bearer un-token-cualquiera'),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const userIds = new Set(responses.map((r) => r.body.userId));
    expect(userIds.size).toBe(1);
    const userId = [...userIds][0];

    const subs = new Set(
      responses.map((r) => (jwt.decode(r.body.accessToken) as Record<string, unknown>).sub),
    );
    expect(subs.size).toBe(1);
    expect([...subs][0]).toBe(userId);

    const firebaseUidClaims = new Set(
      responses.map(
        (r) => (jwt.decode(r.body.accessToken) as Record<string, unknown>).firebaseUid,
      ),
    );
    expect([...firebaseUidClaims]).toEqual([firebaseUid]);

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
