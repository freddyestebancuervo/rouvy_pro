import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import * as request from 'supertest';
import { computeFilterFingerprint } from '../src/common/pagination/pagination.util';
import { PG_POOL } from '../src/database/database.module';
import { createTestApp } from './utils/test-app';

/**
 * e2e de la paginación keyset opt-in de `GET /workouts` — T-F0.5
 * (docs/tasks/TF0_5_PAGINATION_CONTRACT.md, Tarea #14). Complementa
 * `workouts.e2e-spec.ts` (CRUD/ownership/visibilidad, sin tocar) con la
 * matriz de paginación (contract §17).
 *
 * A diferencia de Equipment, `GET /workouts` no tiene un filtro tipo
 * `category` para aislar datasets bajo el mismo usuario — por eso cada
 * grupo que necesita un conteo EXACTO usa su propio usuario registrado
 * (con `mine=true`, scope estrictamente a lo que ese usuario creó). Para
 * no acercarse al rate limit de `/auth/register` (5 req/15min/IP, ver
 * `workouts.e2e-spec.ts`), el total de registros en este archivo se
 * mantiene en 5: mainToken, otherToken (ownership/visibilidad/mismatch/
 * validación — reutilizados en varios tests), walkerToken (dataset de
 * 51 filas), microToken (colección vacía + microsegundos/tie-break,
 * reutilizando el mismo usuario ANTES y DESPUÉS de crear sus 3 filas) y
 * mechanicsToken (mecánica de páginas con conteo exacto de 3 filas).
 */
describe('WorkoutsController (e2e) — paginación T-F0.5', () => {
  let app: INestApplication;
  let pool: Pool;
  let mainToken: string;
  let otherToken: string;

  async function registerUser(label: string): Promise<string> {
    const email = `e2e-workouts-page-${label}-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: `WorkoutsPage ${label}` })
      .expect(201);
    return res.body.accessToken as string;
  }

  function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Workout de paginación',
      targetType: 'power',
      intervals: [{ durationSeconds: 600, targetLow: 50, targetHigh: 60, label: 'Bloque' }],
      ...overrides,
    };
  }

  async function createWorkout(token: string, overrides: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/v1/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload(overrides))
      .expect(201);
    return res.body;
  }

  async function forceCreatedAt(id: string, isoMicroseconds: string): Promise<void> {
    await pool.query('UPDATE workouts SET created_at = $1::timestamptz WHERE id = $2', [isoMicroseconds, id]);
  }

  beforeAll(async () => {
    app = await createTestApp();
    pool = app.get<Pool>(PG_POOL);
    mainToken = await registerUser('main');
    otherToken = await registerUser('other');
  });

  afterAll(async () => {
    await app.close();
  });

  // --- validación de limit ---

  describe('validación de limit', () => {
    it.each([['0'], ['-1'], ['abc'], ['1.5'], ['101']])(
      'limit=%s responde 400 PAGINATION_LIMIT_INVALID',
      async (value) => {
        const res = await request(app.getHttpServer())
          .get(`/v1/workouts?limit=${encodeURIComponent(value)}`)
          .set('Authorization', `Bearer ${mainToken}`)
          .expect(400);
        expect(res.body.error.code).toBe('PAGINATION_LIMIT_INVALID');
      },
    );

    it('limit=100 (el máximo) es válido', async () => {
      await request(app.getHttpServer())
        .get('/v1/workouts?mine=true&limit=100')
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
    });
  });

  // --- validación de cursor ---

  describe('validación de cursor', () => {
    it('cursor malformado responde 400 PAGINATION_CURSOR_INVALID', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/workouts?limit=10&cursor=esto-no-es-un-cursor-valido')
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(400);
      expect(res.body.error.code).toBe('PAGINATION_CURSOR_INVALID');
    });

    it('cursor con versión desconocida responde 400 PAGINATION_CURSOR_INVALID', async () => {
      const unknownVersionCursor = Buffer.from(
        JSON.stringify({ v: 2, createdAt: '2026-01-01T00:00:00.000000Z', id: randomUUID(), f: '000000000000' }),
        'utf8',
      ).toString('base64url');
      const res = await request(app.getHttpServer())
        .get(`/v1/workouts?limit=10&cursor=${unknownVersionCursor}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(400);
      expect(res.body.error.code).toBe('PAGINATION_CURSOR_INVALID');
    });

    it('cursor estructuralmente correcto pero con fecha de calendario imposible (30 de febrero) responde 400 PAGINATION_CURSOR_INVALID, nunca 500', async () => {
      // Sin `mine` en el request → filtro efectivo { mine: false },
      // exactamente lo que calcula el servicio real — el fingerprint DEBE
      // coincidir para que este test pruebe específicamente el timestamp
      // inválido y no falle antes por PAGINATION_CURSOR_FILTER_MISMATCH.
      const fingerprint = computeFilterFingerprint({ mine: false });
      const impossibleDateCursor = Buffer.from(
        JSON.stringify({ v: 1, createdAt: '2026-02-30T10:20:30.123456Z', id: randomUUID(), f: fingerprint }),
        'utf8',
      ).toString('base64url');

      const res = await request(app.getHttpServer())
        .get(`/v1/workouts?limit=10&cursor=${impossibleDateCursor}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(400);
      expect(res.body.error.code).toBe('PAGINATION_CURSOR_INVALID');
    });
  });

  // --- filtros ligados al cursor (fingerprint mismatch sobre `mine`) ---

  it('reusar un cursor obtenido con mine=true bajo mine=false (u otro valor efectivo) responde 400 PAGINATION_CURSOR_FILTER_MISMATCH', async () => {
    // Dos filas propias, no una: con limit=1 y una sola fila visible,
    // hasMore sería false (rows.length <= limit) y jamás se emitiría
    // X-Next-Cursor — correcto por contrato, pero no serviría para
    // probar este escenario. Con dos filas, LIMIT N+1=2 trae ambas y
    // hasMore=true, forzando un cursor real emitido por el backend.
    await createWorkout(mainToken, { name: 'Para mismatch A' });
    await createWorkout(mainToken, { name: 'Para mismatch B' });

    const firstPage = await request(app.getHttpServer())
      .get('/v1/workouts?mine=true&limit=1')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    const cursor = firstPage.headers['x-next-cursor'];
    expect(typeof cursor).toBe('string');

    const res = await request(app.getHttpServer())
      .get(`/v1/workouts?mine=false&limit=1&cursor=${cursor}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(400);
    expect(res.body.error.code).toBe('PAGINATION_CURSOR_FILTER_MISMATCH');
  });

  // --- ownership/visibilidad intactos en modo paginado ---

  it('mine=true en modo paginado nunca incluye workouts públicos ajenos; sin mine sí los incluye (visibilidad sin cambios)', async () => {
    const otherPublic = await createWorkout(otherToken, { name: 'Público ajeno para paginación' });
    await request(app.getHttpServer())
      .patch(`/v1/workouts/${otherPublic.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ isPublic: true })
      .expect(200);

    const mineOnly = await request(app.getHttpServer())
      .get('/v1/workouts?mine=true&limit=100')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(mineOnly.body.find((w: { id: string }) => w.id === otherPublic.id)).toBeUndefined();

    const withCatalog = await request(app.getHttpServer())
      .get('/v1/workouts?limit=100')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(withCatalog.body.find((w: { id: string }) => w.id === otherPublic.id)).toBeDefined();
  });

  // --- mecánica básica: primera página / última sin header ---

  describe('mecánica de páginas (usuario dedicado, conteo exacto)', () => {
    let mechanicsToken: string;
    let ids: string[] = [];

    beforeAll(async () => {
      mechanicsToken = await registerUser('mechanics');
      ids = [];
      for (let i = 0; i < 3; i += 1) {
        const w = await createWorkout(mechanicsToken, { name: `Mecánica ${i}` });
        ids.push(w.id);
      }
    });

    it('primera página (limit=2) devuelve 2 items, X-Next-Cursor, body sigue siendo ARRAY', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/workouts?mine=true&limit=2')
        .set('Authorization', `Bearer ${mechanicsToken}`)
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(typeof res.headers['x-next-cursor']).toBe('string');
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('última página (fila restante) no trae X-Next-Cursor; el recorrido completo cubre exactamente las 3 filas', async () => {
      const first = await request(app.getHttpServer())
        .get('/v1/workouts?mine=true&limit=2')
        .set('Authorization', `Bearer ${mechanicsToken}`)
        .expect(200);
      const cursor = first.headers['x-next-cursor'];

      const second = await request(app.getHttpServer())
        .get(`/v1/workouts?mine=true&limit=2&cursor=${cursor}`)
        .set('Authorization', `Bearer ${mechanicsToken}`)
        .expect(200);
      expect(second.body).toHaveLength(1);
      expect(second.headers['x-next-cursor']).toBeUndefined();

      const combinedIds = [...first.body, ...second.body].map((w: { id: string }) => w.id).sort();
      expect(combinedIds).toEqual([...ids].sort());
    });
  });

  // --- dataset grande: legacy sin truncar + recorrido completo sin dup/omisión ---

  describe('dataset de 51 filas (usuario dedicado)', () => {
    let walkerToken: string;
    let createdIds: string[] = [];

    beforeAll(async () => {
      walkerToken = await registerUser('walker');
      createdIds = [];
      for (let i = 0; i < 51; i += 1) {
        const w = await createWorkout(walkerToken, { name: `Walker ${i}` });
        createdIds.push(w.id);
      }
    });

    it('modo legacy (sin limit/cursor) sigue devolviendo las 51 filas completas — no se trunca a 50', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/workouts?mine=true')
        .set('Authorization', `Bearer ${walkerToken}`)
        .expect(200);
      expect(res.body).toHaveLength(51);
      expect(res.headers['x-next-cursor']).toBeUndefined();
    });

    it('recorrido paginado completo (limit=20) visita las 51 filas exactas, sin duplicados ni omisiones, conservando mine=true', async () => {
      const limit = 20;
      let cursor: string | undefined;
      const seen = new Set<string>();
      let pages = 0;

      do {
        const url = cursor
          ? `/v1/workouts?mine=true&limit=${limit}&cursor=${cursor}`
          : `/v1/workouts?mine=true&limit=${limit}`;
        const res = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${walkerToken}`)
          .expect(200);

        expect(res.body.length).toBeLessThanOrEqual(limit);
        for (const item of res.body as Array<{ id: string; isMine: boolean }>) {
          expect(item.isMine).toBe(true);
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        cursor = res.headers['x-next-cursor'];
        pages += 1;
        expect(pages).toBeLessThan(10);
      } while (cursor);

      expect(seen.size).toBe(51);
      expect([...seen].sort()).toEqual([...createdIds].sort());
    });
  });

  // --- colección vacía + precisión de microsegundos + desempate ---

  describe('usuario dedicado: colección vacía primero, luego microsegundos/tie-break', () => {
    let microToken: string;

    beforeAll(async () => {
      microToken = await registerUser('micro');
    });

    it('colección paginada vacía responde 200, array vacío, sin X-Next-Cursor', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/workouts?mine=true&limit=10')
        .set('Authorization', `Bearer ${microToken}`)
        .expect(200);
      expect(res.body).toEqual([]);
      expect(res.headers['x-next-cursor']).toBeUndefined();
    });

    describe('con 3 filas de timestamps forzados', () => {
      let rowA: Record<string, any>;
      let rowB: Record<string, any>;
      let rowC: Record<string, any>;

      beforeAll(async () => {
        rowA = await createWorkout(microToken, { name: 'Micro A' });
        rowB = await createWorkout(microToken, { name: 'Micro B' });
        rowC = await createWorkout(microToken, { name: 'Micro C' });

        // A y B: mismo milisegundo, microsegundos distintos (contract §8.2).
        await forceCreatedAt(rowA.id, '2026-01-01T00:00:00.200001Z');
        await forceCreatedAt(rowB.id, '2026-01-01T00:00:00.200002Z');
        // C: EXACTAMENTE el mismo timestamp que A — fuerza desempate por id DESC.
        await forceCreatedAt(rowC.id, '2026-01-01T00:00:00.200001Z');
      });

      it('microsegundos distintos generan cursores distintos; recorrido sin duplicar ni omitir; desempate por id DESC', async () => {
        let cursor: string | undefined;
        const order: string[] = [];
        let pages = 0;
        do {
          const url = cursor ? `/v1/workouts?mine=true&limit=1&cursor=${cursor}` : '/v1/workouts?mine=true&limit=1';
          const res = await request(app.getHttpServer())
            .get(url)
            .set('Authorization', `Bearer ${microToken}`)
            .expect(200);
          order.push(res.body[0].id);
          cursor = res.headers['x-next-cursor'];
          pages += 1;
          expect(pages).toBeLessThan(10);
        } while (cursor);

        expect(order).toHaveLength(3);
        expect(new Set(order).size).toBe(3);

        expect(order[0]).toBe(rowB.id);
        const [idHigh, idLow] = [rowA.id, rowC.id].sort().reverse(); // id DESC esperado
        expect(order[1]).toBe(idHigh);
        expect(order[2]).toBe(idLow);
      });
    });
  });
});
