import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e dedicado al hallazgo de la revisión de arquitectura de cierre de
 * fase (Bloque C): unicidad de email case-insensitive. Antes de la
 * migración `0002_users_email_case_insensitive_unique.sql`, dos
 * registros concurrentes con el mismo email en distinto case podían
 * pasar ambos el chequeo de aplicación (`findByEmail`) y crear cuentas
 * duplicadas — acá se verifica tanto el caso secuencial como el
 * verdaderamente concurrente, contra Postgres real, sin mocks.
 *
 * Archivo separado (no en `auth.e2e-spec.ts`): el test de concurrencia
 * dispara 2 requests en paralelo, y ese archivo ya usa 3 de sus 5
 * llamadas permitidas a `register` por ventana de rate limit — separar
 * le da a este archivo su propia cuota (ver `auth-refresh.e2e-spec.ts`
 * para el mismo patrón).
 */
describe('AuthController (e2e) — unicidad de email case-insensitive', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register responde 409 para el mismo email en otro case (secuencial)', async () => {
    const base = `e2e-case-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `${base}@ridepro.com`, password: 'Abcdefg1', displayName: 'Original' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `${base.toUpperCase()}@RIDEPRO.COM`, password: 'Abcdefg1', displayName: 'Variante' })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('dos registros CONCURRENTES con el mismo email en distinto case: exactamente uno gana', async () => {
    const base = `e2e-race-${randomUUID()}`;

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `${base}@ridepro.com`, password: 'Abcdefg1', displayName: 'Rider A' }),
      request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `${base.toUpperCase()}@RIDEPRO.COM`, password: 'Abcdefg1', displayName: 'Rider B' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });
});
