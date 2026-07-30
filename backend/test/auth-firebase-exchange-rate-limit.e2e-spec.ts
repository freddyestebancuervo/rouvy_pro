import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { FirebaseTokenVerifierService } from '../src/firebase/firebase-token-verifier.service';
import { createTestApp } from './utils/test-app';

/**
 * Archivo SEPARADO a propósito (mismo criterio que
 * `auth-refresh.e2e-spec.ts`, ver su docblock): cada `*.e2e-spec.ts` corre
 * en su propia instancia de `AppModule`, con su propio `ThrottlerStorage`
 * en memoria — así estos tests no compiten por cuota con los demás tests
 * de `auth-firebase-exchange.e2e-spec.ts`.
 *
 * Fase 4.2 Parte 2 — el rate limit de este endpoint pasó de un único
 * bucket por IP a 3 capas (`AuthService.exchangeFirebaseToken` +
 * `AuthController`): Capa 1 (IP, 60/15min, cubre tokens inválidos que
 * nunca llegan a `AuthService`), Capa 2 (Firebase UID hasheado, 20/15min,
 * la protección real por identidad) y Capa 3 (IP ya verificada, 100/15min,
 * respaldo contra muchas identidades desde una sola IP). El primer test de
 * abajo reutiliza la MISMA identidad en las 21 llamadas, así que ahora es
 * la Capa 2 la que bloquea al llegar a 20 — no la Capa 1, que con el
 * límite nuevo (60) no se activaría con solo 21 requests.
 */
describe('AuthController (e2e) — /auth/firebase/exchange — rate limiting', () => {
  let app: INestApplication;
  let verifyMock: jest.Mock;

  beforeAll(async () => {
    verifyMock = jest.fn().mockResolvedValue({
      uid: `firebase-uid-${randomUUID()}`,
      email: `e2e-exchange-ratelimit-${randomUUID()}@ridepro.com`,
      emailVerified: true,
      displayName: 'Rate Limit E2E',
      signInProvider: 'password',
    });
    app = await createTestApp([
      { provide: FirebaseTokenVerifierService, useValue: { verify: verifyMock } },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('misma identidad (Capa 2, UID): bloquea con 429 después de 20 requests en 15 minutos', async () => {
    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer())
        .post('/v1/auth/firebase/exchange')
        .set('Authorization', 'Bearer token-rate-limit')
        .expect(200);
    }

    const res21 = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer token-rate-limit')
      .expect(429);
    expect(res21.body.error.code).toBe('RATE_LIMITED');
    expect(res21.headers['retry-after']).toBeDefined();
  });

  it('identidades distintas compartiendo IP (Capa 3): 30 usuarios nuevos seguidos desde la misma IP de test, ninguno bloqueado', async () => {
    for (let i = 0; i < 30; i += 1) {
      verifyMock.mockResolvedValueOnce({
        uid: `firebase-uid-${randomUUID()}`,
        email: `e2e-exchange-ratelimit-distinct-${randomUUID()}@ridepro.com`,
        emailVerified: true,
        displayName: 'Rate Limit E2E Distinct',
        signInProvider: 'password',
      });
      await request(app.getHttpServer())
        .post('/v1/auth/firebase/exchange')
        .set('Authorization', `Bearer token-rate-limit-distinct-${i}`)
        .expect(200);
    }
  });
});
