import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e de C3 (`POST /auth/register` / `POST /auth/login`) contra Postgres
 * real — mismo principio que `app.e2e-spec.ts` (C2): sin mocks, porque el
 * propósito es confirmar el contrato de
 * `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 1.2 end-to-end.
 *
 * Los `email` de cada test son únicos (`randomUUID()`) para poder correr
 * la suite repetidas veces contra la misma base sin colisionar con datos
 * de una corrida anterior. El número de llamadas a `register`/`login` se
 * mantiene deliberadamente bajo (≤4 cada uno) para no disparar el rate
 * limit de 5 req/15min del propio endpoint bajo prueba.
 */
describe('AuthController (e2e)', () => {
  let app: INestApplication;
  const password = 'Abcdefg1';
  const registeredEmail = `e2e-${randomUUID()}@ridepro.com`;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register crea el usuario y devuelve el sobre de sesión', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: registeredEmail, password, displayName: 'Rider E2E' })
      .expect(201);

    expect(res.body.userId).toEqual(expect.any(String));
    expect(res.body.email).toBe(registeredEmail);
    expect(res.body.emailVerified).toBe(false);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.split('.')).toHaveLength(3); // JWT: header.payload.signature
    expect(res.body.refreshToken).toMatch(/^rt_/);
    expect(res.body.expiresIn).toBe(3600);
  });

  it('POST /auth/register responde 409 EMAIL_ALREADY_EXISTS si el email ya existe', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: registeredEmail, password, displayName: 'Otro Nombre' })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('POST /auth/register responde 400 VALIDATION_ERROR si la contraseña no cumple la política', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `e2e-${randomUUID()}@ridepro.com`, password: 'sinnumero', displayName: 'X' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /auth/login responde 200 con credenciales válidas', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: registeredEmail, password })
      .expect(200);

    expect(res.body.email).toBe(registeredEmail);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.refreshToken).toMatch(/^rt_/);
  });

  it('POST /auth/login responde 401 AUTH_INVALID_CREDENTIALS con contraseña incorrecta', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: registeredEmail, password: 'ContraseñaMala1' })
      .expect(401);

    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('POST /auth/login responde 401 AUTH_INVALID_CREDENTIALS con usuario inexistente (sin revelar cuál falló)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: `no-existe-${randomUUID()}@ridepro.com`, password })
      .expect(401);

    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
