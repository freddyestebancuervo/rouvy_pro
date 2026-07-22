import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e de `POST/GET/GET:id/PATCH/DELETE /workouts` (Bloque D, D2) —
 * contra Postgres real, sin mocks. Solo 2 usuarios registrados en todo
 * el archivo (reutilizados vía `beforeAll`), mismo criterio que
 * `equipment.e2e-spec.ts` para no acercarse al rate limit de
 * `/auth/register` (5 req/15min/IP).
 *
 * Nota de cobertura: la visibilidad de "catálogo" (`ownerId IS NULL`)
 * no tiene forma de ejercitarse por HTTP — `POST /workouts` siempre
 * asigna el dueño autenticado, y crear una fila de catálogo real es
 * tarea de un panel admin fuera de alcance de D2 (mismo criterio que
 * `routes` en D3). Ese caso queda cubierto a nivel unitario
 * (`workouts.service.spec.ts`), no acá.
 */
describe('WorkoutsController (e2e) — /workouts', () => {
  let app: INestApplication;
  let mainToken: string;
  let otherToken: string;

  async function registerUser(label: string): Promise<string> {
    const email = `e2e-workouts-${label}-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: `Workouts ${label}` })
      .expect(201);
    return res.body.accessToken as string;
  }

  function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Series de umbral',
      targetType: 'power',
      intervals: [
        { durationSeconds: 600, targetLow: 50, targetHigh: 60, label: 'Calentamiento' },
        { durationSeconds: 1200, targetLow: 90, targetHigh: 100, label: 'Umbral' },
        { durationSeconds: 300, targetLow: 40, targetHigh: 50, label: 'Enfriamiento' },
      ],
      ...overrides,
    };
  }

  async function createWorkout(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/v1/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload(overrides))
      .expect(201);
    return res.body;
  }

  beforeAll(async () => {
    app = await createTestApp();
    mainToken = await registerUser('main');
    otherToken = await registerUser('other');
  });

  afterAll(async () => {
    await app.close();
  });

  // --- 401 sin token ---

  it('POST /workouts responde 401 sin Authorization', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/workouts')
      .send(validPayload())
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING_OR_INVALID');
  });

  it('GET /workouts responde 401 sin Authorization', async () => {
    await request(app.getHttpServer()).get('/v1/workouts').expect(401);
  });

  // --- CRUD completo ---

  it('POST /workouts crea el workout con sus intervalos y calcula estimatedDurationSeconds', async () => {
    const body = await createWorkout(mainToken, { name: 'Mi primer entrenamiento' });

    expect(body).toMatchObject({
      name: 'Mi primer entrenamiento',
      sport: 'cycling',
      targetType: 'power',
      isPublic: false,
      isMine: true,
      estimatedDurationSeconds: 600 + 1200 + 300,
      archivedAt: null,
    });
    expect(body.intervals).toEqual([
      { position: 0, durationSeconds: 600, targetLow: 50, targetHigh: 60, label: 'Calentamiento' },
      { position: 1, durationSeconds: 1200, targetLow: 90, targetHigh: 100, label: 'Umbral' },
      { position: 2, durationSeconds: 300, targetLow: 40, targetHigh: 50, label: 'Enfriamiento' },
    ]);
    expect(typeof body.id).toBe('string');
  });

  it('GET /workouts/:id responde el workout propio con sus intervalos', async () => {
    const created = await createWorkout(mainToken, { name: 'Consultable' });
    const res = await request(app.getHttpServer())
      .get(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(res.body.id).toBe(created.id);
    expect(res.body.intervals).toHaveLength(3);
  });

  it('GET /workouts lista sin intervalos (payload liviano)', async () => {
    await createWorkout(mainToken, { name: 'Para el listado' });
    const res = await request(app.getHttpServer())
      .get('/v1/workouts')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].intervals).toBeUndefined();
  });

  it('PATCH /workouts/:id actualiza name/description/isPublic y persiste', async () => {
    const created = await createWorkout(mainToken, { name: 'Antes del patch' });

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Después del patch', isPublic: true })
      .expect(200);
    expect(patchRes.body).toMatchObject({ name: 'Después del patch', isPublic: true });

    const getRes = await request(app.getHttpServer())
      .get(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(getRes.body).toMatchObject({ name: 'Después del patch', isPublic: true });
  });

  it('DELETE /workouts/:id archiva (soft-delete), es idempotente, y sigue resoluble por id', async () => {
    const created = await createWorkout(mainToken, { name: 'A archivar' });

    await request(app.getHttpServer())
      .delete(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(getRes.body.archivedAt).not.toBeNull();
  });

  // --- visibilidad cross-usuario (propio de D2, no existía en D1) ---

  it('GET /workouts/:id responde 404 para un workout privado de otro usuario', async () => {
    const created = await createWorkout(mainToken, { name: 'Privado de main' });
    const res = await request(app.getHttpServer())
      .get(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('WORKOUT_NOT_FOUND');
  });

  it('GET /workouts/:id responde 200 para un workout PÚBLICO de otro usuario (visible, no editable)', async () => {
    const created = await createWorkout(mainToken, { name: 'Público de main' });
    await request(app.getHttpServer())
      .patch(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ isPublic: true })
      .expect(200);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(getRes.body.isMine).toBe(false);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'hackeado' })
      .expect(404);
    expect(patchRes.body.error.code).toBe('WORKOUT_NOT_FOUND');
  });

  it('GET /workouts con ?mine=true filtra a solo propios (excluye públicos ajenos)', async () => {
    const otherPublic = await createWorkout(otherToken, { name: 'Público de other' });
    await request(app.getHttpServer())
      .patch(`/v1/workouts/${otherPublic.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ isPublic: true })
      .expect(200);

    const listMine = await request(app.getHttpServer())
      .get('/v1/workouts?mine=true')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(listMine.body.find((w: { id: string }) => w.id === otherPublic.id)).toBeUndefined();

    const listAll = await request(app.getHttpServer())
      .get('/v1/workouts')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(listAll.body.find((w: { id: string }) => w.id === otherPublic.id)).toBeDefined();
  });

  it('DELETE /workouts/:id de otro usuario responde 404, incluso si es público', async () => {
    const created = await createWorkout(mainToken, { name: 'No borrable por otros' });
    const res = await request(app.getHttpServer())
      .delete(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('WORKOUT_NOT_FOUND');
  });

  // --- estado archivado bloquea edición ---

  it('PATCH /workouts/:id sobre uno archivado responde 409 WORKOUT_ARCHIVED', async () => {
    const created = await createWorkout(mainToken, { name: 'Se va a archivar' });
    await request(app.getHttpServer())
      .delete(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .patch(`/v1/workouts/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'no debería aplicar' })
      .expect(409);
    expect(res.body.error.code).toBe('WORKOUT_ARCHIVED');
  });

  // --- validación de intervalos ---

  it('POST /workouts responde 400 VALIDATION_ERROR con un array de intervalos vacío', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/workouts')
      .set('Authorization', `Bearer ${mainToken}`)
      .send(validPayload({ intervals: [] }))
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /workouts responde 400 WORKOUT_INVALID_INTERVALS si targetHigh excede el rango de "power"', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/workouts')
      .set('Authorization', `Bearer ${mainToken}`)
      .send(validPayload({ intervals: [{ durationSeconds: 600, targetLow: 50, targetHigh: 500 }] }))
      .expect(400);
    expect(res.body.error.code).toBe('WORKOUT_INVALID_INTERVALS');
  });

  it('POST /workouts responde 400 WORKOUT_INVALID_INTERVALS si hay un target definido con targetType "none"', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/workouts')
      .set('Authorization', `Bearer ${mainToken}`)
      .send(
        validPayload({
          targetType: 'none',
          intervals: [{ durationSeconds: 600, targetLow: 50 }],
        }),
      )
      .expect(400);
    expect(res.body.error.code).toBe('WORKOUT_INVALID_INTERVALS');
  });

  it('GET /workouts/:id responde 400 si el id no tiene formato UUID', async () => {
    await request(app.getHttpServer())
      .get('/v1/workouts/esto-no-es-un-uuid')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(400);
  });
});
