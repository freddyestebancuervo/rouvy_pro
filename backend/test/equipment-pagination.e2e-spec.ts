import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import * as request from 'supertest';
import { computeFilterFingerprint } from '../src/common/pagination/pagination.util';
import { PG_POOL } from '../src/database/database.module';
import { createTestApp } from './utils/test-app';

/**
 * e2e de la paginación keyset opt-in de `GET /equipment` — T-F0.5
 * (docs/tasks/TF0_5_PAGINATION_CONTRACT.md, Tarea #14). Complementa
 * `equipment.e2e-spec.ts` (CRUD/ownership, sin tocar) con la matriz de
 * paginación (contract §17).
 *
 * Aislamiento de datasets: cada grupo de tests que necesita un conteo
 * EXACTO usa una `categoryCode` dedicada (bajo el mismo `mainToken`) en
 * vez de registrar un usuario nuevo por test — evita acercarse al rate
 * limit de `/auth/register` (5 req/15min/IP, ver
 * `equipment.e2e-spec.ts`) mientras conserva conteos deterministas
 * (`GET /equipment?category=X` filtra exactamente a lo creado en ese
 * grupo, sin importar qué haya creado otro test en otra categoría).
 */
describe('EquipmentController (e2e) — paginación T-F0.5', () => {
  let app: INestApplication;
  let pool: Pool;
  let mainToken: string;
  let otherToken: string;

  async function registerUser(label: string): Promise<string> {
    const email = `e2e-equipment-page-${label}-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: `EquipmentPage ${label}` })
      .expect(201);
    return res.body.accessToken as string;
  }

  async function createEquipment(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Equipo de paginación', categoryCode: 'other', ...overrides })
      .expect(201);
    return res.body;
  }

  async function forceCreatedAt(id: string, isoMicroseconds: string): Promise<void> {
    await pool.query('UPDATE equipment SET created_at = $1::timestamptz WHERE id = $2', [isoMicroseconds, id]);
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

  // --- validación de limit (contract §9.3 / Task14 Fase E) ---

  describe('validación de limit', () => {
    it.each([['0'], ['-1'], ['abc'], ['1.5'], ['101']])(
      'limit=%s responde 400 PAGINATION_LIMIT_INVALID',
      async (value) => {
        const res = await request(app.getHttpServer())
          .get(`/v1/equipment?limit=${encodeURIComponent(value)}`)
          .set('Authorization', `Bearer ${mainToken}`)
          .expect(400);
        expect(res.body.error.code).toBe('PAGINATION_LIMIT_INVALID');
      },
    );

    it('limit=100 (el máximo) es válido', async () => {
      await request(app.getHttpServer())
        .get('/v1/equipment?category=speed_sensor&limit=100')
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
    });
  });

  // --- validación de cursor (contract §15) ---

  describe('validación de cursor', () => {
    it('cursor malformado (no base64url/JSON) responde 400 PAGINATION_CURSOR_INVALID', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/equipment?limit=10&cursor=esto-no-es-un-cursor-valido')
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
        .get(`/v1/equipment?limit=10&cursor=${unknownVersionCursor}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(400);
      expect(res.body.error.code).toBe('PAGINATION_CURSOR_INVALID');
    });

    it('cursor estructuralmente correcto pero con fecha de calendario imposible (30 de febrero) responde 400 PAGINATION_CURSOR_INVALID, nunca 500', async () => {
      // Sin `category`/`includeArchived` en el request → filtros efectivos
      // { category: null, includeArchived: false }, exactamente lo que
      // calcula el servicio real — el fingerprint DEBE coincidir para que
      // este test pruebe específicamente el timestamp inválido y no falle
      // antes por PAGINATION_CURSOR_FILTER_MISMATCH.
      const fingerprint = computeFilterFingerprint({ category: null, includeArchived: false });
      const impossibleDateCursor = Buffer.from(
        JSON.stringify({ v: 1, createdAt: '2026-02-30T10:20:30.123456Z', id: randomUUID(), f: fingerprint }),
        'utf8',
      ).toString('base64url');

      const res = await request(app.getHttpServer())
        .get(`/v1/equipment?limit=10&cursor=${impossibleDateCursor}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(400);
      expect(res.body.error.code).toBe('PAGINATION_CURSOR_INVALID');
    });
  });

  // --- colección vacía ---

  it('colección paginada vacía responde 200, array vacío, sin X-Next-Cursor', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/equipment?category=cadence_sensor&limit=10')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
    expect(res.headers['x-next-cursor']).toBeUndefined();
  });

  // --- mecánica básica: primera página / intermedia / última sin header ---

  describe('mecánica de páginas', () => {
    const category = 'smart_trainer';
    let ids: string[] = [];

    beforeAll(async () => {
      ids = [];
      for (let i = 0; i < 3; i += 1) {
        const item = await createEquipment(mainToken, { name: `Mecánica ${i}`, categoryCode: category });
        ids.push(item.id);
      }
    });

    it('primera página (limit=2) devuelve 2 items y X-Next-Cursor', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/equipment?category=${category}&limit=2`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(typeof res.headers['x-next-cursor']).toBe('string');
      // El body sigue siendo un ARRAY plano — nunca `{ items, nextCursor }`.
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('última página (la fila restante) no trae X-Next-Cursor', async () => {
      const first = await request(app.getHttpServer())
        .get(`/v1/equipment?category=${category}&limit=2`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
      const cursor = first.headers['x-next-cursor'];

      const second = await request(app.getHttpServer())
        .get(`/v1/equipment?category=${category}&limit=2&cursor=${cursor}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
      expect(second.body).toHaveLength(1);
      expect(second.headers['x-next-cursor']).toBeUndefined();

      const combinedIds = [...first.body, ...second.body].map((e: { id: string }) => e.id).sort();
      expect(combinedIds).toEqual([...ids].sort());
    });
  });

  // --- filtros ligados al cursor (fingerprint mismatch) ---

  it('reusar un cursor con un filtro distinto responde 400 PAGINATION_CURSOR_FILTER_MISMATCH', async () => {
    await createEquipment(mainToken, { name: 'Bici A', categoryCode: 'bike' });
    await createEquipment(mainToken, { name: 'Bici B', categoryCode: 'bike' });

    const firstPage = await request(app.getHttpServer())
      .get('/v1/equipment?category=bike&limit=1')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    const cursor = firstPage.headers['x-next-cursor'];
    expect(typeof cursor).toBe('string');

    const res = await request(app.getHttpServer())
      .get(`/v1/equipment?category=power_meter&limit=1&cursor=${cursor}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(400);
    expect(res.body.error.code).toBe('PAGINATION_CURSOR_FILTER_MISMATCH');
  });

  // --- ownership intacto en modo paginado ---

  it('el modo paginado nunca devuelve equipamiento de otro usuario', async () => {
    await createEquipment(otherToken, { name: 'Equipo ajeno', categoryCode: 'heart_rate_monitor' });

    const res = await request(app.getHttpServer())
      .get('/v1/equipment?category=heart_rate_monitor&limit=10')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  // --- Enforcement: GET /equipment completamente SIN ningún query param ---

  describe('sin ningún query param (usuario dedicado)', () => {
    let noQueryToken: string;

    beforeAll(async () => {
      noQueryToken = await registerUser('noquery');
      for (let i = 0; i < 51; i += 1) {
        await createEquipment(noQueryToken, { name: `SinQuery ${i}` });
      }
    });

    it('T-F0.5 Enforcement: GET /equipment completamente sin category/includeArchived/limit/cursor también aplica DEFAULT_LIMIT=50 — el legacy ilimitado no sobrevive sin ningún filtro', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/equipment')
        .set('Authorization', `Bearer ${noQueryToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(50);
      expect(typeof res.headers['x-next-cursor']).toBe('string');
    });
  });

  // --- dataset grande: Enforcement (default sin limit/cursor) + recorrido completo sin dup/omisión ---

  describe('dataset de 51 filas (categoría dedicada)', () => {
    const category = 'speed_cadence_combo';
    let createdIds: string[] = [];

    beforeAll(async () => {
      createdIds = [];
      for (let i = 0; i < 51; i += 1) {
        const item = await createEquipment(mainToken, { name: `Walker ${i}`, categoryCode: category });
        createdIds.push(item.id);
      }
    });

    it('T-F0.5 Enforcement: sin limit/cursor (solo filtro category) aplica DEFAULT_LIMIT=50, no el legacy ilimitado — y el cursor devuelto permite completar el recorrido sin duplicar ni omitir', async () => {
      const first = await request(app.getHttpServer())
        .get(`/v1/equipment?category=${category}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
      expect(Array.isArray(first.body)).toBe(true);
      expect(first.body).toHaveLength(50);
      expect(typeof first.headers['x-next-cursor']).toBe('string');

      const cursor = first.headers['x-next-cursor'];
      const second = await request(app.getHttpServer())
        .get(`/v1/equipment?category=${category}&cursor=${cursor}`)
        .set('Authorization', `Bearer ${mainToken}`)
        .expect(200);
      expect(second.body).toHaveLength(1);
      expect(second.headers['x-next-cursor']).toBeUndefined();

      const combinedIds = [...first.body, ...second.body].map((e: { id: string }) => e.id);
      expect(new Set(combinedIds).size).toBe(51);
      expect(combinedIds.sort()).toEqual([...createdIds].sort());
    });

    it('recorrido paginado completo (limit=20) visita las 51 filas exactas, sin duplicados ni omisiones, conservando el filtro', async () => {
      const limit = 20;
      let cursor: string | undefined;
      const seen = new Set<string>();
      let pages = 0;

      do {
        const url = cursor
          ? `/v1/equipment?category=${category}&limit=${limit}&cursor=${cursor}`
          : `/v1/equipment?category=${category}&limit=${limit}`;
        const res = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${mainToken}`)
          .expect(200);

        expect(res.body.length).toBeLessThanOrEqual(limit);
        for (const item of res.body as Array<{ id: string; categoryCode: string }>) {
          expect(item.categoryCode).toBe(category);
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

  // --- precisión de microsegundos + desempate por id DESC ---

  describe('precisión de timestamp y desempate (dataset dedicado de 3 filas)', () => {
    const category = 'cadence_sensor';
    let rowA: Record<string, any>;
    let rowB: Record<string, any>;
    let rowC: Record<string, any>;

    beforeAll(async () => {
      rowA = await createEquipment(mainToken, { name: 'Micro A', categoryCode: category });
      rowB = await createEquipment(mainToken, { name: 'Micro B', categoryCode: category });
      rowC = await createEquipment(mainToken, { name: 'Micro C', categoryCode: category });

      // A y B: mismo milisegundo, microsegundos distintos — el `Date` de
      // JS (precisión de milisegundos) los vería como iguales; el cursor
      // (contract §8.2) debe distinguirlos igual.
      await forceCreatedAt(rowA.id, '2026-01-01T00:00:00.100001Z');
      await forceCreatedAt(rowB.id, '2026-01-01T00:00:00.100002Z');
      // C: EXACTAMENTE el mismo timestamp que A (hasta el microsegundo) —
      // fuerza el desempate por `id DESC` (contract §7).
      await forceCreatedAt(rowC.id, '2026-01-01T00:00:00.100001Z');
    });

    it('dos filas con el mismo milisegundo pero microsegundos distintos generan cursores distintos y se recorren sin duplicar ni omitir', async () => {
      let cursor: string | undefined;
      const order: string[] = [];
      let pages = 0;
      do {
        const url = cursor
          ? `/v1/equipment?category=${category}&limit=1&cursor=${cursor}`
          : `/v1/equipment?category=${category}&limit=1`;
        const res = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${mainToken}`)
          .expect(200);
        order.push(res.body[0].id);
        cursor = res.headers['x-next-cursor'];
        pages += 1;
        expect(pages).toBeLessThan(10);
      } while (cursor);

      expect(order).toHaveLength(3);
      expect(new Set(order).size).toBe(3);

      // DESC: B (microsegundo mayor) antes que A y C (empatados entre sí,
      // desempatados por id DESC).
      expect(order[0]).toBe(rowB.id);
      const [idA, idC] = [rowA.id, rowC.id].sort().reverse(); // id DESC esperado
      expect(order[1]).toBe(idA);
      expect(order[2]).toBe(idC);
    });
  });
});
