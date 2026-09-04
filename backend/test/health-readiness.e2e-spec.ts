import { INestApplication, Logger } from '@nestjs/common';
import * as request from 'supertest';
import { PG_POOL } from '../src/database/database.module';
import { createTestApp } from './utils/test-app';

/**
 * KORIXA-MVP-SAFETY-01 — demuestra, contra un servidor HTTP real
 * (`supertest`, nunca contra las funciones internas directamente), los
 * tres hallazgos cerrados por esta tarea:
 *
 *   A/B. `/v1/live` nunca depende de Postgres; `/v1/ready` sí, y
 *        responde 200 cuando la conexión funciona.
 *   C/D. `/v1/ready` responde 503 cuando Postgres falla, y el cuerpo de
 *        esa respuesta NUNCA contiene el texto interno del error real
 *        (`SUPER_SECRET_INTERNAL_DB_ERROR`, usado acá como marcador de
 *        prueba reconocible que jamás debería llegar al cliente).
 *   Además: `/v1/health` (alias de compatibilidad) se comporta
 *        exactamente igual que `/v1/ready` en ambos casos — ver
 *        `app.controller.ts`.
 *
 * KORIXA-MVP-SAFETY-01A — hallazgo de auditoría independiente: el HTTP
 * ya estaba saneado, pero `checkDatabaseReadiness` seguía mandando
 * `error.stack`/`String(error)` a `Logger.error`. El bloque de más abajo
 * ("logging no debe contener el error interno") prueba lo mismo que C/D
 * pero contra `Logger.prototype.error` en vez del body HTTP.
 */
const INTERNAL_ERROR_MARKER = 'SUPER_SECRET_INTERNAL_DB_ERROR host=internal-db.private user=admin password=hunter2';

function failingPool() {
  return {
    query: jest.fn().mockRejectedValue(new Error(INTERNAL_ERROR_MARKER)),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Liveness / readiness (e2e)', () => {
  describe('con Postgres accesible (pool real vía DATABASE_URL del entorno e2e)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('A. GET /v1/live responde 200 {status: ok} — liveness pura, sin tocar Postgres', () => {
      return request(app.getHttpServer())
        .get('/v1/live')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ status: 'ok' });
        });
    });

    it('B. GET /v1/ready responde 200 {status: ok, database: connected} cuando SELECT 1 funciona', () => {
      return request(app.getHttpServer())
        .get('/v1/ready')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ status: 'ok', database: 'connected' });
        });
    });

    it('GET /v1/health (alias de compatibilidad) responde igual que /v1/ready cuando Postgres está accesible', () => {
      return request(app.getHttpServer())
        .get('/v1/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ status: 'ok', database: 'connected' });
        });
    });
  });

  describe('con Postgres fallando (PG_POOL sobreescrito por un mock que rechaza SIEMPRE)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp([{ provide: PG_POOL, useValue: failingPool() }]);
    });

    afterAll(async () => {
      await app.close();
    });

    it('A (repetida con el pool roto). GET /v1/live sigue respondiendo 200 aunque Postgres esté completamente caído — nunca lo consulta', () => {
      return request(app.getHttpServer())
        .get('/v1/live')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ status: 'ok' });
        });
    });

    it('C. GET /v1/ready responde 503 cuando Postgres falla', () => {
      return request(app.getHttpServer()).get('/v1/ready').expect(503);
    });

    it('D. el cuerpo del 503 de /v1/ready NUNCA contiene el error interno original', () => {
      return request(app.getHttpServer())
        .get('/v1/ready')
        .expect(503)
        .expect((res) => {
          const rawBody = JSON.stringify(res.body);
          expect(rawBody).not.toContain(INTERNAL_ERROR_MARKER);
          expect(rawBody).not.toContain('hunter2');
          expect(rawBody).not.toContain('internal-db.private');
          // El contrato de error único de la spec (sección 1.2) sigue
          // aplicando acá — no un cuerpo `{status, database}` suelto —
          // pero la señal "unreachable" queda disponible en `details`,
          // sin exponer nada derivado de `error`.
          expect(res.body.error.details).toEqual({ status: 'error', database: 'unreachable' });
          expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
        });
    });

    it('GET /v1/health (alias) responde 503 con el mismo cuerpo sanitizado que /v1/ready', () => {
      return request(app.getHttpServer())
        .get('/v1/health')
        .expect(503)
        .expect((res) => {
          const rawBody = JSON.stringify(res.body);
          expect(rawBody).not.toContain(INTERNAL_ERROR_MARKER);
          expect(res.body.error.details).toEqual({ status: 'error', database: 'unreachable' });
        });
    });
  });

  describe('logging no debe contener el error interno (KORIXA-MVP-SAFETY-01A)', () => {
    let app: INestApplication;
    let errorSpy: jest.SpyInstance;

    beforeAll(async () => {
      // Se intercepta a nivel de prototipo — `this.logger` en
      // `AppController` es una instancia de `Logger`, así que cualquier
      // `.error(...)` que llame resuelve a este método sin importar la
      // instancia. `mockImplementation` evita ensuciar stdout del runner
      // de test con el mensaje genérico (que sí es seguro, pero no aporta
      // nada acá).
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      app = await createTestApp([{ provide: PG_POOL, useValue: failingPool() }]);
      // Descarta cualquier llamada de bootstrap previa a nuestro request —
      // no relacionada con el hallazgo que esta suite prueba.
      errorSpy.mockClear();
    });

    beforeEach(() => {
      errorSpy.mockClear();
    });

    afterAll(async () => {
      errorSpy.mockRestore();
      await app.close();
    });

    it('el marcador interno del error real NUNCA aparece en ningún argumento pasado a Logger.error', async () => {
      await request(app.getHttpServer()).get('/v1/ready').expect(503);

      expect(errorSpy).toHaveBeenCalled();

      const serializedArgs = errorSpy.mock.calls
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join('\n');

      expect(serializedArgs).not.toContain(INTERNAL_ERROR_MARKER);
      expect(serializedArgs).not.toContain('SUPER_SECRET_INTERNAL_DB_ERROR');
      expect(serializedArgs).not.toContain('hunter2');
      expect(serializedArgs).not.toContain('internal-db.private');
      expect(serializedArgs).not.toContain('user=admin');
    });

    it('mismo resultado a través del alias /v1/health', async () => {
      await request(app.getHttpServer()).get('/v1/health').expect(503);

      const serializedArgs = errorSpy.mock.calls
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join('\n');

      expect(serializedArgs).not.toContain(INTERNAL_ERROR_MARKER);
      expect(serializedArgs).not.toContain('hunter2');
    });

    it('sigue ocurriendo un log genérico y controlado — la sanitización no elimina toda observabilidad', async () => {
      await request(app.getHttpServer()).get('/v1/ready').expect(503);

      expect(errorSpy).toHaveBeenCalledWith('Readiness check failed: PostgreSQL is unavailable.');
      // Exactamente un argumento por llamada — nada adjunto (segundo
      // parámetro con stack/contexto) que pudiera reintroducir el error
      // real más adelante sin que este assert lo note.
      for (const call of errorSpy.mock.calls) {
        expect(call.length).toBe(1);
      }
    });
  });
});
