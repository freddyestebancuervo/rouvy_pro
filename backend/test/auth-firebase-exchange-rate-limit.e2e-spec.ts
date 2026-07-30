import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { FirebaseTokenVerifierService } from '../src/firebase/firebase-token-verifier.service';
import { createTestApp } from './utils/test-app';

/**
 * Archivo SEPARADO a propósito (mismo criterio que
 * `auth-refresh.e2e-spec.ts`, ver su docblock): cada `*.e2e-spec.ts` corre
 * en su propia instancia de `AppModule`, con su propio `ThrottlerStorage`
 * en memoria — así este test de 21 requests no compite por cuota con los
 * demás tests de `auth-firebase-exchange.e2e-spec.ts` (que ya consumen
 * varias unidades del mismo bucket de 20/15min contra el mismo endpoint).
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

  it('bloquea con 429 después de 20 requests en 15 minutos', async () => {
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
  });
});
