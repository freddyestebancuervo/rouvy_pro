import { WorkoutRecord, WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

describe('WorkoutsService', () => {
  const baseWorkout: WorkoutRecord = {
    id: 'workout-1',
    ownerId: 'user-1',
    name: 'Series de umbral',
    description: null,
    sport: 'cycling',
    estimatedDurationSeconds: 1800,
    targetType: 'power',
    isPublic: false,
    archivedAt: null,
    createdAt: new Date('2026-01-10T08:00:00Z'),
    updatedAt: new Date('2026-01-10T08:00:00Z'),
  };

  const baseIntervals = [
    { id: 'i-1', workoutId: 'workout-1', position: 0, durationSeconds: 600, targetLow: '50', targetHigh: '60', label: 'Calentamiento' },
    { id: 'i-2', workoutId: 'workout-1', position: 1, durationSeconds: 1200, targetLow: '90', targetHigh: '100', label: 'Umbral' },
  ];

  function buildService(overrides?: {
    findById?: jest.Mock;
    findIntervalsForWorkout?: jest.Mock;
    findAllForUser?: jest.Mock;
    create?: jest.Mock;
    update?: jest.Mock;
    archive?: jest.Mock;
  }) {
    const workoutsRepository = {
      findById: overrides?.findById ?? jest.fn().mockResolvedValue(baseWorkout),
      findIntervalsForWorkout: overrides?.findIntervalsForWorkout ?? jest.fn().mockResolvedValue(baseIntervals),
      findAllForUser: overrides?.findAllForUser ?? jest.fn().mockResolvedValue([baseWorkout]),
      create: overrides?.create ?? jest.fn().mockResolvedValue({ workout: baseWorkout, intervals: baseIntervals }),
      update: overrides?.update ?? jest.fn().mockResolvedValue(baseWorkout),
      archive: overrides?.archive ?? jest.fn().mockResolvedValue({ ...baseWorkout, archivedAt: new Date() }),
    } as unknown as jest.Mocked<WorkoutsRepository>;

    return { service: new WorkoutsService(workoutsRepository), workoutsRepository };
  }

  const validDto = {
    name: 'Series de umbral',
    targetType: 'power',
    intervals: [
      { durationSeconds: 600, targetLow: 50, targetHigh: 60, label: 'Calentamiento' },
      { durationSeconds: 1200, targetLow: 90, targetHigh: 100, label: 'Umbral' },
    ],
  };

  describe('create', () => {
    it('calcula estimatedDurationSeconds como la suma de los intervalos y lo delega al repositorio', async () => {
      const create = jest.fn().mockResolvedValue({ workout: baseWorkout, intervals: baseIntervals });
      const { service, workoutsRepository } = buildService({ create });

      await service.create('user-1', validDto);

      expect(workoutsRepository.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ targetType: 'power' }),
        1800, // 600 + 1200
      );
    });

    it('mapea la respuesta con los intervalos convertidos de string (NUMERIC) a number', async () => {
      const { service } = buildService();
      const response = await service.create('user-1', validDto);

      expect(response.intervals).toEqual([
        { position: 0, durationSeconds: 600, targetLow: 50, targetHigh: 60, label: 'Calentamiento' },
        { position: 1, durationSeconds: 1200, targetLow: 90, targetHigh: 100, label: 'Umbral' },
      ]);
      expect(response.isMine).toBe(true);
    });

    it('rechaza targetLow/targetHigh fuera de rango para targetType "power"', async () => {
      const { service } = buildService();
      await expect(
        service.create('user-1', {
          ...validDto,
          intervals: [{ durationSeconds: 600, targetLow: 50, targetHigh: 500 }],
        }),
      ).rejects.toMatchObject({ code: 'WORKOUT_INVALID_INTERVALS' });
    });

    it('rechaza targetLow/targetHigh fuera de rango para targetType "heart_rate"', async () => {
      const { service } = buildService();
      await expect(
        service.create('user-1', {
          name: 'FC',
          targetType: 'heart_rate',
          intervals: [{ durationSeconds: 600, targetLow: 30, targetHigh: 100 }],
        }),
      ).rejects.toMatchObject({ code: 'WORKOUT_INVALID_INTERVALS' });
    });

    it('rechaza un target definido en un intervalo cuando targetType es "none"', async () => {
      const { service } = buildService();
      await expect(
        service.create('user-1', {
          name: 'Libre',
          targetType: 'none',
          intervals: [{ durationSeconds: 600, targetLow: 50 }],
        }),
      ).rejects.toMatchObject({ code: 'WORKOUT_INVALID_INTERVALS' });
    });

    it('rechaza targetLow mayor que targetHigh', async () => {
      const { service } = buildService();
      await expect(
        service.create('user-1', {
          ...validDto,
          intervals: [{ durationSeconds: 600, targetLow: 90, targetHigh: 60 }],
        }),
      ).rejects.toMatchObject({ code: 'WORKOUT_INVALID_INTERVALS' });
    });

    it('acepta un intervalo sin target definido aunque el workout sí tenga targetType', async () => {
      const create = jest.fn().mockResolvedValue({ workout: baseWorkout, intervals: baseIntervals });
      const { service } = buildService({ create });

      await expect(
        service.create('user-1', {
          name: 'Con descanso libre',
          targetType: 'power',
          intervals: [{ durationSeconds: 300 }],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('traduce mine="true" (string de query param) a mineOnly boolean', async () => {
      const findAllForUser = jest.fn().mockResolvedValue([baseWorkout]);
      const { service, workoutsRepository } = buildService({ findAllForUser });

      await service.list('user-1', { mine: 'true' });

      expect(workoutsRepository.findAllForUser).toHaveBeenCalledWith('user-1', { mineOnly: true });
    });

    it('sin el filtro, mineOnly es false (catálogo + públicos incluidos)', async () => {
      const findAllForUser = jest.fn().mockResolvedValue([baseWorkout]);
      const { service, workoutsRepository } = buildService({ findAllForUser });

      await service.list('user-1', {});

      expect(workoutsRepository.findAllForUser).toHaveBeenCalledWith('user-1', { mineOnly: false });
    });

    it('marca isMine correctamente según el owner_id de cada fila', async () => {
      const findAllForUser = jest.fn().mockResolvedValue([
        baseWorkout,
        { ...baseWorkout, id: 'workout-2', ownerId: 'user-2', isPublic: true },
        { ...baseWorkout, id: 'workout-3', ownerId: null },
      ]);
      const { service } = buildService({ findAllForUser });

      const results = await service.list('user-1', {});

      expect(results.map((r) => r.isMine)).toEqual([true, false, false]);
    });
  });

  describe('getById', () => {
    it('responde el workout propio con sus intervalos', async () => {
      const { service } = buildService();
      const response = await service.getById('user-1', 'workout-1');
      expect(response.id).toBe('workout-1');
      expect(response.intervals).toHaveLength(2);
    });

    it('responde un workout público de otro usuario', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: 'user-2', isPublic: true });
      const { service } = buildService({ findById });
      const response = await service.getById('user-1', 'workout-1');
      expect(response.isMine).toBe(false);
    });

    it('responde un workout de catálogo (ownerId null)', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: null });
      const { service } = buildService({ findById });
      const response = await service.getById('user-1', 'workout-1');
      expect(response.isMine).toBe(false);
    });

    it('responde WORKOUT_NOT_FOUND para un workout privado de otro usuario', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: 'user-2', isPublic: false });
      const { service } = buildService({ findById });
      await expect(service.getById('user-1', 'workout-1')).rejects.toMatchObject({ code: 'WORKOUT_NOT_FOUND' });
    });

    it('responde WORKOUT_NOT_FOUND si no existe', async () => {
      const findById = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ findById });
      await expect(service.getById('user-1', 'ghost')).rejects.toMatchObject({ code: 'WORKOUT_NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('el dueño puede editar', async () => {
      const update = jest.fn().mockResolvedValue({ ...baseWorkout, name: 'Nuevo nombre' });
      const { service } = buildService({ update });
      const response = await service.update('user-1', 'workout-1', { name: 'Nuevo nombre' });
      expect(response.name).toBe('Nuevo nombre');
    });

    it('rechaza con WORKOUT_NOT_FOUND si no es el dueño (aunque sea público)', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: 'user-2', isPublic: true });
      const { service } = buildService({ findById });
      await expect(service.update('user-1', 'workout-1', { name: 'x' })).rejects.toMatchObject({
        code: 'WORKOUT_NOT_FOUND',
      });
    });

    it('rechaza con WORKOUT_NOT_FOUND si es de catálogo (ownerId null)', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: null });
      const { service } = buildService({ findById });
      await expect(service.update('user-1', 'workout-1', { name: 'x' })).rejects.toMatchObject({
        code: 'WORKOUT_NOT_FOUND',
      });
    });

    it('rechaza con WORKOUT_ARCHIVED si ya está archivado', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, archivedAt: new Date() });
      const update = jest.fn();
      const { service, workoutsRepository } = buildService({ findById, update });
      await expect(service.update('user-1', 'workout-1', { name: 'x' })).rejects.toMatchObject({
        code: 'WORKOUT_ARCHIVED',
      });
      expect(workoutsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('el dueño puede archivar', async () => {
      const archive = jest.fn().mockResolvedValue({ ...baseWorkout, archivedAt: new Date() });
      const { service, workoutsRepository } = buildService({ archive });
      await service.archive('user-1', 'workout-1');
      expect(workoutsRepository.archive).toHaveBeenCalledWith('workout-1');
    });

    it('es idempotente si ya estaba archivado', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, archivedAt: new Date() });
      const archive = jest.fn();
      const { service, workoutsRepository } = buildService({ findById, archive });
      await service.archive('user-1', 'workout-1');
      expect(workoutsRepository.archive).not.toHaveBeenCalled();
    });

    it('rechaza con WORKOUT_NOT_FOUND si no es el dueño', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: 'user-2' });
      const { service } = buildService({ findById });
      await expect(service.archive('user-1', 'workout-1')).rejects.toMatchObject({ code: 'WORKOUT_NOT_FOUND' });
    });

    it('rechaza con WORKOUT_NOT_FOUND si es de catálogo', async () => {
      const findById = jest.fn().mockResolvedValue({ ...baseWorkout, ownerId: null });
      const { service } = buildService({ findById });
      await expect(service.archive('user-1', 'workout-1')).rejects.toMatchObject({ code: 'WORKOUT_NOT_FOUND' });
    });
  });
});
