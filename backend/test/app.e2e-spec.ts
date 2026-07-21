import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Test e2e mínimo — confirma que el servidor arranca con `AppModule`
 * completo (incluyendo `AuthModule`/`UsersModule` vacíos) y que
 * `/v1/health` responde. Requiere una base de datos Postgres real
 * accesible vía `DATABASE_URL` (ver `.env.example`) — no usa mocks,
 * porque el propósito explícito de este endpoint es confirmar una
 * conexión real, no simulada.
 *
 * ⚠️ No ejecutado en el entorno donde se escribió (sin red para
 * `npm install` ni una instancia de Postgres disponible) — mismo caso
 * que `firebase/rules-tests/`, ver docs/SECURITY_AUDIT.md para el
 * patrón de cómo se documenta esta limitación.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
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
