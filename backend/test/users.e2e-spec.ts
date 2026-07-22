import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e de `GET/PATCH/DELETE /users/me` (spec sección 1.2), protegidos por
 * `JwtAuthGuard` — contra Postgres real, sin mocks, mismo principio que
 * el resto de la suite. Verifica tanto el guard (401 sin token / con
 * token inválido) como el efecto real de `DELETE` (soft delete +
 * revocación de refresh tokens), no solo el código de status.
 */
describe('UsersController (e2e) — /users/me', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerFreshUser(): Promise<{
    accessToken: string;
    refreshToken: string;
    email: string;
  }> {
    const email = `e2e-users-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: 'Users E2E' })
      .expect(201);
    return {
      accessToken: res.body.accessToken as string,
      refreshToken: res.body.refreshToken as string,
      email,
    };
  }

  it('GET /users/me responde 401 sin Authorization', async () => {
    const res = await request(app.getHttpServer()).get('/v1/users/me').expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING_OR_INVALID');
  });

  it('GET /users/me responde 401 con un token con formato inválido', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', 'Bearer esto-no-es-un-jwt')
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING_OR_INVALID');
  });

  it('GET /users/me responde el perfil real, siguiendo el contrato de la spec', async () => {
    const { accessToken, email } = await registerFreshUser();

    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      email,
      displayName: 'Users E2E',
      photoUrl: null,
      ftp: null,
      weightKg: null,
      premium: false,
      role: 'user',
    });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('PATCH /users/me actualiza displayName/ftp/weightKg y persiste el cambio', async () => {
    const { accessToken } = await registerFreshUser();

    const patchRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Rider Pro', ftp: 260, weightKg: 71.5 })
      .expect(200);

    expect(patchRes.body).toMatchObject({ displayName: 'Rider Pro', ftp: 260, weightKg: 71.5 });

    const getRes = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(getRes.body).toMatchObject({ displayName: 'Rider Pro', ftp: 260, weightKg: 71.5 });
  });

  it('PATCH /users/me responde 400 VALIDATION_ERROR si ftp está fuera de rango', async () => {
    const { accessToken } = await registerFreshUser();

    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ftp: 5000 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /users/me responde 400 VALIDATION_ERROR sin "confirm": true', async () => {
    const { accessToken } = await registerFreshUser();

    const res = await request(app.getHttpServer())
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /users/me con confirm:true borra la cuenta (soft) y revoca sus refresh tokens', async () => {
    const { accessToken, refreshToken } = await registerFreshUser();

    await request(app.getHttpServer())
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: true })
      .expect(202);

    // El access token técnicamente sigue siendo un JWT válido (no expiró),
    // pero la cuenta ya no existe — el guard pasa, el service la rechaza.
    const getAfterDelete = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    expect(getAfterDelete.body.error.code).toBe('AUTH_TOKEN_MISSING_OR_INVALID');

    // El refresh token emitido en el registro debe haber sido revocado.
    const refreshAfterDelete = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect(refreshAfterDelete.body.error.code).toBe('REFRESH_TOKEN_INVALID_OR_REUSED');
  });
});
