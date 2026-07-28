import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e de `POST /auth/logout` (Fase 3 §C) contra Postgres real, sin mocks
 * — mismo principio que `users.e2e-spec.ts`.
 */
describe('AuthController (e2e) — /auth/logout', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerFreshUser(): Promise<{ accessToken: string; refreshToken: string }> {
    const email = `e2e-logout-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: 'Logout E2E' })
      .expect(201);
    return {
      accessToken: res.body.accessToken as string,
      refreshToken: res.body.refreshToken as string,
    };
  }

  it('sin Authorization: 401 (mismo guard que /users/me)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refreshToken: 'rt_cualquiera' })
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING_OR_INVALID');
  });

  it('revoca el refresh token presentado: 204, y ese refresh token deja de servir', async () => {
    const { accessToken, refreshToken } = await registerFreshUser();

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    const afterLogout = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect(afterLogout.body.error.code).toBe('REFRESH_TOKEN_INVALID_OR_REUSED');
  });

  it('es idempotente: llamarlo dos veces con el mismo refresh token sigue devolviendo 204', async () => {
    const { accessToken, refreshToken } = await registerFreshUser();

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);
  });

  it('no puede revocar el refresh token de OTRO usuario, aunque presente un access token propio válido', async () => {
    const victim = await registerFreshUser();
    const attacker = await registerFreshUser();

    // El atacante intenta cerrar la sesión de la víctima usando SU PROPIO
    // access token (válido) pero el refresh token AJENO.
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ refreshToken: victim.refreshToken })
      .expect(204); // idempotente: no revela si el token era ajeno o inexistente

    // El refresh token de la víctima sigue funcionando — no fue revocado.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: victim.refreshToken })
      .expect(200);
  });
});
