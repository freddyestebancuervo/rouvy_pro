import { EquipmentRecord, EquipmentRepository } from './equipment.repository';
import { EquipmentService } from './equipment.service';

describe('EquipmentService', () => {
  const baseRecord: EquipmentRecord = {
    id: 'equipment-1',
    userId: 'user-1',
    categoryCode: 'bike',
    parentEquipmentId: null,
    name: 'Mi bici',
    brand: 'Trek',
    model: 'Domane',
    serialNumber: null,
    firmwareVersion: null,
    hardwareRevision: null,
    bleName: null,
    bleAddress: null,
    status: 'active',
    batteryLevel: null,
    lastConnectedAt: null,
    lastCalibratedAt: null,
    metadata: {},
    totalDistanceMeters: '120.50', // pg devuelve NUMERIC como string
    totalDurationSeconds: '3600',
    isDefault: false,
    archivedAt: null,
    createdAt: new Date('2026-01-10T08:00:00Z'),
    updatedAt: new Date('2026-01-10T08:00:00Z'),
  };

  function buildService(overrides?: {
    categoryExists?: jest.Mock;
    findById?: jest.Mock;
    findAllForUser?: jest.Mock;
    create?: jest.Mock;
    update?: jest.Mock;
    archive?: jest.Mock;
  }) {
    const equipmentRepository = {
      categoryExists: overrides?.categoryExists ?? jest.fn().mockResolvedValue(true),
      findById: overrides?.findById ?? jest.fn().mockResolvedValue(baseRecord),
      findAllForUser: overrides?.findAllForUser ?? jest.fn().mockResolvedValue([baseRecord]),
      create: overrides?.create ?? jest.fn().mockResolvedValue(baseRecord),
      update: overrides?.update ?? jest.fn().mockResolvedValue(baseRecord),
      archive: overrides?.archive ?? jest.fn().mockResolvedValue({ ...baseRecord, archivedAt: new Date() }),
    } as unknown as jest.Mocked<EquipmentRepository>;

    return { service: new EquipmentService(equipmentRepository), equipmentRepository };
  }

  describe('create', () => {
    it('crea el equipo y mapea los totales NUMERIC/BIGINT (string) a number', async () => {
      const { service } = buildService();

      const response = await service.create('user-1', {
        name: 'Mi bici',
        categoryCode: 'bike',
      });

      expect(response.totalDistanceMeters).toBe(120.5);
      expect(response.totalDurationSeconds).toBe(3600);
      expect(typeof response.totalDistanceMeters).toBe('number');
    });

    it('rechaza una categoría que no existe en equipment_categories, sin llegar a insertar', async () => {
      const categoryExists = jest.fn().mockResolvedValue(false);
      const create = jest.fn();
      const { service } = buildService({ categoryExists, create });

      await expect(
        service.create('user-1', { name: 'Zapatillas', categoryCode: 'shoes' }),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_INVALID_CATEGORY' });
      expect(create).not.toHaveBeenCalled();
    });

    it('rechaza parentEquipmentId de un equipo de otro usuario', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, id: 'parent-1', userId: 'user-2' });
      const { service } = buildService({ findById });

      await expect(
        service.create('user-1', { name: 'Sensor', categoryCode: 'power_meter', parentEquipmentId: 'parent-1' }),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_INVALID_PARENT' });
    });

    it('rechaza parentEquipmentId si el padre ya tiene su propio padre (máximo 1 nivel)', async () => {
      const findById = jest
        .fn()
        .mockResolvedValue({ ...baseRecord, id: 'parent-1', userId: 'user-1', parentEquipmentId: 'grandparent-1' });
      const { service } = buildService({ findById });

      await expect(
        service.create('user-1', { name: 'Sensor', categoryCode: 'power_meter', parentEquipmentId: 'parent-1' }),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_INVALID_PARENT' });
    });

    it('rechaza parentEquipmentId si el padre está archivado', async () => {
      const findById = jest
        .fn()
        .mockResolvedValue({ ...baseRecord, id: 'parent-1', userId: 'user-1', archivedAt: new Date() });
      const { service } = buildService({ findById });

      await expect(
        service.create('user-1', { name: 'Sensor', categoryCode: 'power_meter', parentEquipmentId: 'parent-1' }),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_INVALID_PARENT' });
    });

    it('acepta un parentEquipmentId válido (propio, sin archivar, sin padre propio) y lo delega al repositorio', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, id: 'parent-1', userId: 'user-1' });
      const create = jest.fn().mockResolvedValue(baseRecord);
      const { service, equipmentRepository } = buildService({ findById, create });

      await service.create('user-1', {
        name: 'Sensor',
        categoryCode: 'power_meter',
        parentEquipmentId: 'parent-1',
      });

      expect(equipmentRepository.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ parentEquipmentId: 'parent-1' }),
      );
    });

    it('traduce un 23505 de equipment_user_ble_address_unique a EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED', async () => {
      const create = jest.fn().mockRejectedValue({ code: '23505', constraint: 'equipment_user_ble_address_unique' });
      const { service } = buildService({ create });

      await expect(
        service.create('user-1', { name: 'Sensor', categoryCode: 'power_meter', bleAddress: 'AA:BB' }),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED' });
    });

    it('traduce un 23505 de equipment_one_default_per_user_category a EQUIPMENT_DEFAULT_CONFLICT', async () => {
      const create = jest.fn().mockRejectedValue({ code: '23505', constraint: 'equipment_one_default_per_user_category' });
      const { service } = buildService({ create });

      await expect(
        service.create('user-1', { name: 'Bici', categoryCode: 'bike', isDefault: true }),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_DEFAULT_CONFLICT' });
    });

    it('repropaga cualquier otro error sin traducirlo', async () => {
      const create = jest.fn().mockRejectedValue(new Error('boom'));
      const { service } = buildService({ create });

      await expect(service.create('user-1', { name: 'Bici', categoryCode: 'bike' })).rejects.toThrow('boom');
    });
  });

  describe('list', () => {
    it('traduce includeArchived="true" (string de query param) a boolean', async () => {
      const findAllForUser = jest.fn().mockResolvedValue([baseRecord]);
      const { service, equipmentRepository } = buildService({ findAllForUser });

      await service.list('user-1', { includeArchived: 'true' });

      expect(equipmentRepository.findAllForUser).toHaveBeenCalledWith('user-1', {
        category: undefined,
        includeArchived: true,
      });
    });

    it('rechaza un filtro ?category= que no existe', async () => {
      const categoryExists = jest.fn().mockResolvedValue(false);
      const { service } = buildService({ categoryExists });

      await expect(service.list('user-1', { category: 'nope' })).rejects.toMatchObject({
        code: 'EQUIPMENT_INVALID_CATEGORY',
      });
    });
  });

  describe('getById', () => {
    it('responde el equipo si pertenece al usuario', async () => {
      const { service } = buildService();
      const response = await service.getById('user-1', 'equipment-1');
      expect(response.id).toBe('equipment-1');
    });

    it('responde EQUIPMENT_NOT_FOUND si no existe', async () => {
      const findById = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ findById });

      await expect(service.getById('user-1', 'ghost')).rejects.toMatchObject({ code: 'EQUIPMENT_NOT_FOUND' });
    });

    it('responde EQUIPMENT_NOT_FOUND (no 403) si el equipo es de otro usuario', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, userId: 'user-2' });
      const { service } = buildService({ findById });

      await expect(service.getById('user-1', 'equipment-1')).rejects.toMatchObject({ code: 'EQUIPMENT_NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('actualiza los campos y devuelve el equipo mapeado', async () => {
      const update = jest.fn().mockResolvedValue({ ...baseRecord, name: 'Bici nueva' });
      const { service } = buildService({ update });

      const response = await service.update('user-1', 'equipment-1', { name: 'Bici nueva' });
      expect(response.name).toBe('Bici nueva');
    });

    it('rechaza editar un equipo ya archivado con EQUIPMENT_ARCHIVED, sin llamar al repositorio', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, archivedAt: new Date() });
      const update = jest.fn();
      const { service } = buildService({ findById, update });

      await expect(service.update('user-1', 'equipment-1', { name: 'x' })).rejects.toMatchObject({
        code: 'EQUIPMENT_ARCHIVED',
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('rechaza editar un equipo de otro usuario con EQUIPMENT_NOT_FOUND', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, userId: 'user-2' });
      const { service } = buildService({ findById });

      await expect(service.update('user-1', 'equipment-1', { name: 'x' })).rejects.toMatchObject({
        code: 'EQUIPMENT_NOT_FOUND',
      });
    });

    it('parentEquipmentId: null desasocia sin validar ownership', async () => {
      const update = jest.fn().mockResolvedValue({ ...baseRecord, parentEquipmentId: null });
      const { service, equipmentRepository } = buildService({ update });

      await service.update('user-1', 'equipment-1', { parentEquipmentId: null });

      expect(equipmentRepository.update).toHaveBeenCalledWith(
        'equipment-1',
        expect.objectContaining({ parentEquipmentId: null }),
      );
    });
  });

  describe('archive', () => {
    it('archiva un equipo activo', async () => {
      const archive = jest.fn().mockResolvedValue({ ...baseRecord, archivedAt: new Date() });
      const { service, equipmentRepository } = buildService({ archive });

      await service.archive('user-1', 'equipment-1');
      expect(equipmentRepository.archive).toHaveBeenCalledWith('equipment-1');
    });

    it('es idempotente: si ya estaba archivado, no vuelve a llamar al repositorio', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, archivedAt: new Date() });
      const archive = jest.fn();
      const { service, equipmentRepository } = buildService({ findById, archive });

      await service.archive('user-1', 'equipment-1');
      expect(equipmentRepository.archive).not.toHaveBeenCalled();
    });

    it('rechaza archivar un equipo de otro usuario con EQUIPMENT_NOT_FOUND', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseRecord, userId: 'user-2' });
      const { service } = buildService({ findById });

      await expect(service.archive('user-1', 'equipment-1')).rejects.toMatchObject({
        code: 'EQUIPMENT_NOT_FOUND',
      });
    });
  });
});
