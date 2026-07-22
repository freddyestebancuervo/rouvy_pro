import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Test e2e mínimo — confirma que el servidor arranca con `AppModule`
 * completo y que `/v1/health` responde. Requiere una base de datos
 * Postgres real accesible vía `DATABASE_URL` (ver `.env.example`) — no
 * usa mocks, porque el propósito explícito de este endpoint es confirmar
 * una conexión real, no simulada. Ejecutado y verificado por primera vez
 * en la sesión de Track 2 (`VERIFICATION_GUIDE.md`) — ver
 * `ROADMAP_M0_M1.md`.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/v1/health (GET) responde ok cuando Postgres está accesible', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.database).toBe('connected');
      });
  });
});
