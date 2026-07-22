import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e de C4 (`POST /auth/refresh` — rotación + detección de reuso, spec
 * sección 5.2) contra Postgres real, sin mocks — mismo principio que
 * `auth.e2e-spec.ts` (C3). Archivo separado a propósito: cada archivo
 * `*.e2e-spec.ts` corre en su propia instancia de `AppModule` (Jest aísla
 * el registro de módulos por archivo), lo que le da a este archivo su
 * propio `ThrottlerStorage` en memoria — así el test de rate limiting de
 * abajo (21 requests) no consume ni es afectado por la cuota de
 * `register`/`login` de `auth.e2e-spec.ts`.
 */
describe('AuthController (e2e) — /auth/refresh', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerFreshUser(): Promise<{ refreshToken: string; email: string }> {
    const email = `e2e-refresh-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: 'Refresh E2E' })
      .expect(201);
    return { refreshToken: res.body.refreshToken as string, email };
  }

  it('rota el refresh token: devuelve un par nuevo y el viejo deja de servir', async () => {
    const { refreshToken: original } = await registerFreshUser();

    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: original })
      .expect(200);

    expect(typeof rotated.body.accessToken).toBe('string');
    expect(rotated.body.refreshToken).toMatch(/^rt_/);
    expect(rotated.body.refreshToken).not.toBe(original);
    expect(rotated.body.expiresIn).toBe(3600);
    // El sobre de /auth/refresh NO incluye userId/email (spec 1.2) —
    // a diferencia de register/login.
    expect(rotated.body.userId).toBeUndefined();

    // El token original ya fue canjeado — no puede volver a usarse.
    const reuseOriginal = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: original })
      .expect(401);
    expect(reuseOriginal.body.error.code).toBe('REFRESH_TOKEN_INVALID_OR_REUSED');
  });

  it('detección de reuso: reintentar un token ya canjeado revoca también el token vigente de la cadena', async () => {
    const { refreshToken: original } = await registerFreshUser();

    const firstRotation = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: original })
      .expect(200);
    const currentValidToken = firstRotation.body.refreshToken as string;

    // Reuso del token viejo (ya revocado por la rotación anterior) —
    // dispara la revocación masiva de TODOS los tokens activos del
    // usuario (spec 5.2, punto 4), incluyendo `currentValidToken`.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: original })
      .expect(401);

    // El token que SÍ era válido hasta este punto también quedó revocado.
    const afterReuse = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: currentValidToken })
      .expect(401);
    expect(afterReuse.body.error.code).toBe('REFRESH_TOKEN_INVALID_OR_REUSED');
  });

  it('responde 401 REFRESH_TOKEN_INVALID_OR_REUSED para un token que nunca existió', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: `rt_${randomUUID()}` })
      .expect(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID_OR_REUSED');
  });

  it('rate limit por token: bloquea con 429 después de 20 requests con el mismo refresh token', async () => {
    const fixedToken = `rt_ratelimit-${randomUUID()}`;

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: fixedToken });
      expect(res.status).toBe(401); // token inexistente, pero pasa el guard
    }

    const res21 = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: fixedToken })
      .expect(429);
    expect(res21.body.error.code).toBe('RATE_LIMITED');
  }, 20000);
});
