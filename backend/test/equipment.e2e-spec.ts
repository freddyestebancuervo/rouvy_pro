import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * e2e de `POST/GET/PATCH/DELETE /equipment` (Bloque D, D1) — contra
 * Postgres real, sin mocks, mismo principio que el resto de la suite.
 * Registra solo 2 usuarios en todo el archivo (reutilizados entre tests
 * vía `beforeAll`, no uno por test) para no acercarse al rate limit de
 * `/auth/register` (5 req/15min/IP) — `/equipment` en sí no está
 * throttleado, así que crear equipamiento de sobra dentro de un mismo
 * test no tiene ese límite.
 */
describe('EquipmentController (e2e) — /equipment', () => {
  let app: INestApplication;
  let mainToken: string;
  let otherToken: string;

  async function registerUser(label: string): Promise<string> {
    const email = `e2e-equipment-${label}-${randomUUID()}@ridepro.com`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: `Equipment ${label}` })
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
      .send({ name: 'Equipo de prueba', categoryCode: 'bike', ...overrides })
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

  it('POST /equipment responde 401 sin Authorization', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .send({ name: 'x', categoryCode: 'bike' })
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING_OR_INVALID');
  });

  it('GET /equipment responde 401 sin Authorization', async () => {
    await request(app.getHttpServer()).get('/v1/equipment').expect(401);
  });

  // --- CRUD completo ---

  it('POST /equipment crea un equipo con el contrato completo de campos', async () => {
    const body = await createEquipment(mainToken, {
      name: 'Trek Domane',
      categoryCode: 'bike',
      brand: 'Trek',
      model: 'Domane SL7',
      serialNumber: 'SN-123',
      firmwareVersion: '1.2.0',
      hardwareRevision: 'rev-b',
      bleName: 'Trek Sensor',
      bleAddress: 'AA:BB:CC:DD:EE:01',
      metadata: { bikeType: 'road', weightKg: 8.2 },
    });

    expect(body).toMatchObject({
      name: 'Trek Domane',
      categoryCode: 'bike',
      brand: 'Trek',
      model: 'Domane SL7',
      serialNumber: 'SN-123',
      firmwareVersion: '1.2.0',
      hardwareRevision: 'rev-b',
      bleName: 'Trek Sensor',
      bleAddress: 'AA:BB:CC:DD:EE:01',
      status: 'active',
      batteryLevel: null,
      isDefault: false,
      archivedAt: null,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      metadata: { bikeType: 'road', weightKg: 8.2 },
    });
    expect(typeof body.id).toBe('string');
  });

  it('GET /equipment lista los equipos propios ordenados, excluyendo archivados por defecto', async () => {
    const created = await createEquipment(mainToken, { name: 'Para archivar', categoryCode: 'other' });
    await request(app.getHttpServer())
      .delete(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(list.body.find((e: { id: string }) => e.id === created.id)).toBeUndefined();

    const listWithArchived = await request(app.getHttpServer())
      .get('/v1/equipment?includeArchived=true')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    const found = listWithArchived.body.find((e: { id: string }) => e.id === created.id);
    expect(found).toBeDefined();
    expect(found.archivedAt).not.toBeNull();
  });

  it('GET /equipment/:id responde el equipo propio', async () => {
    const created = await createEquipment(mainToken, { name: 'Consultable' });
    const res = await request(app.getHttpServer())
      .get(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(res.body.id).toBe(created.id);
  });

  it('PATCH /equipment/:id actualiza campos y persiste el cambio', async () => {
    const created = await createEquipment(mainToken, { name: 'Antes del patch' });

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Después del patch', batteryLevel: 80, status: 'inactive' })
      .expect(200);
    expect(patchRes.body).toMatchObject({ name: 'Después del patch', batteryLevel: 80, status: 'inactive' });

    const getRes = await request(app.getHttpServer())
      .get(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(getRes.body).toMatchObject({ name: 'Después del patch', batteryLevel: 80, status: 'inactive' });
  });

  it('DELETE /equipment/:id archiva (soft-delete) y es idempotente', async () => {
    const created = await createEquipment(mainToken, { name: 'A borrar' });

    await request(app.getHttpServer())
      .delete(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);
    // Segunda vez: ya archivado, no debe fallar (idempotente).
    await request(app.getHttpServer())
      .delete(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(getRes.body.archivedAt).not.toBeNull();
  });

  // --- 404 recurso inexistente / ajeno ---

  it('GET /equipment/:id responde 404 EQUIPMENT_NOT_FOUND para un id inexistente', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/equipment/${randomUUID()}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('EQUIPMENT_NOT_FOUND');
  });

  it('GET/PATCH/DELETE /equipment/:id responden 404 (no 403) para un equipo de otro usuario', async () => {
    const created = await createEquipment(mainToken, { name: 'Solo de main' });

    const getRes = await request(app.getHttpServer())
      .get(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    expect(getRes.body.error.code).toBe('EQUIPMENT_NOT_FOUND');

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'hackeado' })
      .expect(404);
    expect(patchRes.body.error.code).toBe('EQUIPMENT_NOT_FOUND');

    const deleteRes = await request(app.getHttpServer())
      .delete(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    expect(deleteRes.body.error.code).toBe('EQUIPMENT_NOT_FOUND');
  });

  it('GET /equipment/:id responde 400 (no 404) si el id ni siquiera tiene formato UUID', async () => {
    await request(app.getHttpServer())
      .get('/v1/equipment/esto-no-es-un-uuid')
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(400);
  });

  // --- validación de categorías / campos ---

  it('POST /equipment responde 400 EQUIPMENT_INVALID_CATEGORY para una categoría que no existe', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Zapatillas', categoryCode: 'shoes' })
      .expect(400);
    expect(res.body.error.code).toBe('EQUIPMENT_INVALID_CATEGORY');
  });

  it('POST /equipment responde 400 VALIDATION_ERROR si el nombre es demasiado corto', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'a', categoryCode: 'bike' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /equipment responde 400 VALIDATION_ERROR si batteryLevel está fuera de rango', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Pulsómetro', categoryCode: 'heart_rate_monitor', batteryLevel: 150 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // --- estado archivado bloquea edición ---

  it('PATCH /equipment/:id sobre un equipo archivado responde 409 EQUIPMENT_ARCHIVED', async () => {
    const created = await createEquipment(mainToken, { name: 'Se va a archivar' });
    await request(app.getHttpServer())
      .delete(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .patch(`/v1/equipment/${created.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'no debería aplicar' })
      .expect(409);
    expect(res.body.error.code).toBe('EQUIPMENT_ARCHIVED');
  });

  // --- parent_equipment_id ---

  it('parentEquipmentId acepta un padre propio de 1 nivel', async () => {
    const bike = await createEquipment(mainToken, { name: 'Bici madre', categoryCode: 'bike' });
    const sensor = await createEquipment(mainToken, {
      name: 'Potenciómetro instalado',
      categoryCode: 'power_meter',
      parentEquipmentId: bike.id,
    });
    expect(sensor.parentEquipmentId).toBe(bike.id);
  });

  it('parentEquipmentId responde 400 EQUIPMENT_INVALID_PARENT si el padre ya tiene su propio padre', async () => {
    const bike = await createEquipment(mainToken, { name: 'Bici abuela', categoryCode: 'bike' });
    const sensor = await createEquipment(mainToken, {
      name: 'Potenciómetro nivel 1',
      categoryCode: 'power_meter',
      parentEquipmentId: bike.id,
    });

    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Nivel 2 no permitido', categoryCode: 'other', parentEquipmentId: sensor.id })
      .expect(400);
    expect(res.body.error.code).toBe('EQUIPMENT_INVALID_PARENT');
  });

  it('parentEquipmentId responde 400 EQUIPMENT_INVALID_PARENT si el padre es de otro usuario', async () => {
    const otherBike = await createEquipment(otherToken, { name: 'Bici ajena', categoryCode: 'bike' });

    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Intento cruzado', categoryCode: 'other', parentEquipmentId: otherBike.id })
      .expect(400);
    expect(res.body.error.code).toBe('EQUIPMENT_INVALID_PARENT');
  });

  // --- is_default ---

  it('isDefault: una bici default y un rodillo default coexisten sin conflicto (categorías distintas)', async () => {
    const bike = await createEquipment(mainToken, { name: 'Bici default', categoryCode: 'bike', isDefault: true });
    const trainer = await createEquipment(mainToken, {
      name: 'Rodillo default',
      categoryCode: 'smart_trainer',
      isDefault: true,
    });
    expect(bike.isDefault).toBe(true);
    expect(trainer.isDefault).toBe(true);
  });

  it('isDefault: marcar un equipo nuevo como default desmarca el anterior de la misma categoría', async () => {
    const category = 'speed_sensor';
    const first = await createEquipment(mainToken, { name: 'Sensor A', categoryCode: category, isDefault: true });
    const second = await createEquipment(mainToken, { name: 'Sensor B', categoryCode: category });
    expect(first.isDefault).toBe(true);

    await request(app.getHttpServer())
      .patch(`/v1/equipment/${second.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ isDefault: true })
      .expect(200);

    const refreshedFirst = await request(app.getHttpServer())
      .get(`/v1/equipment/${first.id}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    expect(refreshedFirst.body.isDefault).toBe(false);
  });

  // --- concurrencia básica ---

  it('concurrencia: 5 requests marcando equipos DISTINTOS como default en la misma categoría se serializan sin violar la invariante', async () => {
    const category = 'cadence_sensor';
    const items = [];
    for (let i = 0; i < 5; i += 1) {
      items.push(await createEquipment(mainToken, { name: `Sensor concurrente ${i}`, categoryCode: category }));
    }

    const results = await Promise.all(
      items.map((item) =>
        request(app.getHttpServer())
          .patch(`/v1/equipment/${item.id}`)
          .set('Authorization', `Bearer ${mainToken}`)
          .send({ isDefault: true }),
      ),
    );

    // El lock (`SELECT ... FOR UPDATE` sobre toda la categoría, ver
    // `EquipmentRepository.applyDefault`) serializa las 5 requests en vez
    // de dejarlas competir — ninguna debería fallar.
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);

    const list = await request(app.getHttpServer())
      .get(`/v1/equipment?category=${category}`)
      .set('Authorization', `Bearer ${mainToken}`)
      .expect(200);
    const defaults = list.body.filter((e: { isDefault: boolean }) => e.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('bleAddress: responde 409 EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED si ya está en uso por otro equipo propio', async () => {
    const address = `AA:BB:CC:${randomUUID().slice(0, 8)}`;
    await createEquipment(mainToken, {
      name: 'Sensor con BLE',
      categoryCode: 'power_meter',
      bleAddress: address,
    });

    const res = await request(app.getHttpServer())
      .post('/v1/equipment')
      .set('Authorization', `Bearer ${mainToken}`)
      .send({ name: 'Otro sensor', categoryCode: 'power_meter', bleAddress: address })
      .expect(409);
    expect(res.body.error.code).toBe('EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED');
  });
});
