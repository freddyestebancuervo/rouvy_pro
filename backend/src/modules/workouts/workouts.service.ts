import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { assertOwned } from '../../common/ownership/assert-owned.util';
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../../common/pagination/pagination.util';
import { CreateWorkoutDto, CreateWorkoutIntervalDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { WorkoutQueryDto } from './dto/workout-query.dto';
import { WorkoutIntervalRecord, WorkoutRecord, WorkoutsRepository } from './workouts.repository';

export interface WorkoutIntervalResponse {
  position: number;
  durationSeconds: number;
  targetLow: number | null;
  targetHigh: number | null;
  label: string | null;
}

export interface WorkoutListItemResponse {
  id: string;
  name: string;
  description: string | null;
  sport: string;
  estimatedDurationSeconds: number;
  targetType: string;
  isPublic: boolean;
  /** Calculado — no es una columna de la tabla. Le permite al cliente
   * decidir si mostrar controles de edición sin tener que comparar IDs
   * de usuario del lado del front. */
  isMine: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutDetailResponse extends WorkoutListItemResponse {
  intervals: WorkoutIntervalResponse[];
}

/** T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — resultado interno
 * del modo paginado, mismo criterio que `EquipmentPage`. */
export interface WorkoutPage {
  items: WorkoutListItemResponse[];
  nextCursor: string | null;
}

const WORKOUT_NOT_FOUND = (): ApiException =>
  new ApiException(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'El entrenamiento solicitado no existe.');

const WORKOUT_ARCHIVED = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'WORKOUT_ARCHIVED',
    'Este entrenamiento está archivado y no se puede editar.',
  );

const WORKOUT_INVALID_INTERVALS = (message: string): ApiException =>
  new ApiException(HttpStatus.BAD_REQUEST, 'WORKOUT_INVALID_INTERVALS', message);

/** Rangos razonables de dominio por `targetType` — `none` no admite
 * ningún target en ninguno de sus intervalos. */
const TARGET_RANGES: Record<'power' | 'heart_rate', { min: number; max: number }> = {
  power: { min: 0, max: 300 },
  heart_rate: { min: 60, max: 220 },
};

/** Sentinel que nunca coincide con un UUID real de usuario — permite
 * reutilizar `assertOwned` tal cual para el caso de catálogo
 * (`ownerId === null`), sin escribir una segunda función de ownership
 * (ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md sección 3, "seguridad y
 * ownership"). */
const CATALOG_SENTINEL = '__catalog__';

@Injectable()
export class WorkoutsService {
  constructor(private readonly workoutsRepository: WorkoutsRepository) {}

  async create(userId: string, dto: CreateWorkoutDto): Promise<WorkoutDetailResponse> {
    this.validateIntervals(dto.targetType, dto.intervals);
    const estimatedDurationSeconds = dto.intervals.reduce(
      (sum, interval) => sum + interval.durationSeconds,
      0,
    );

    const { workout, intervals } = await this.workoutsRepository.create(
      userId,
      {
        name: dto.name,
        description: dto.description,
        sport: dto.sport ?? 'cycling',
        targetType: dto.targetType,
        isPublic: dto.isPublic,
        intervals: dto.intervals,
      },
      estimatedDurationSeconds,
    );
    return this.toDetailResponse(workout, intervals, userId);
  }

  /**
   * Helper anterior a T-F0.5 Enforcement (docs/tasks/TF0_5_PAGINATION_CONTRACT.md
   * §6.3) — `WorkoutsController.list` ya no lo invoca: TODO listado HTTP
   * pasa por `listPaginated()` de abajo. Se conserva temporalmente sin
   * cambios de comportamiento (no es un camino HTTP activo); su
   * eliminación queda fuera de esta corrección (ver Fase E, MINIMAL_CHANGE).
   */
  async list(userId: string, query: WorkoutQueryDto): Promise<WorkoutListItemResponse[]> {
    const records = await this.workoutsRepository.findAllForUser(userId, {
      mineOnly: query.mine === 'true',
    });
    return records.map((record) => this.toListResponse(record, userId));
  }

  /**
   * T-F0.5 (contract §6.1/§9/§11) — usada por `WorkoutsController.list`
   * para TODO listado HTTP, con o sin `limit`/`cursor` (Enforcement,
   * contract §6.3): `limit` ausente aplica `DEFAULT_LIMIT=50` vía
   * `parseLimit(undefined)`, no un camino sin límite.
   */
  async listPaginated(userId: string, query: WorkoutQueryDto): Promise<WorkoutPage> {
    const mineOnly = query.mine === 'true';
    // Ausente y `false` son el mismo filtro efectivo (mismo criterio que
    // `list()` arriba) — mismo fingerprint (contract §8.1 nota de Fase H).
    const fingerprint = computeFilterFingerprint({ mine: mineOnly });
    const limit = parseLimit(query.limit);
    const cursor = query.cursor !== undefined ? decodeCursor(query.cursor, fingerprint) : null;

    const rows = await this.workoutsRepository.findPageForUser(userId, { mineOnly }, { limit: limit + 1, cursor });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => this.toListResponse(row.record, userId));

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor({ createdAt: last.cursorCreatedAt, id: last.record.id, fingerprint });
    }

    return { items, nextCursor };
  }

  async getById(userId: string, id: string): Promise<WorkoutDetailResponse> {
    const workout = await this.workoutsRepository.findById(id);
    if (!workout || !this.isVisible(workout, userId)) {
      throw WORKOUT_NOT_FOUND();
    }
    const intervals = await this.workoutsRepository.findIntervalsForWorkout(id);
    return this.toDetailResponse(workout, intervals, userId);
  }

  async update(userId: string, id: string, dto: UpdateWorkoutDto): Promise<WorkoutDetailResponse> {
    const workout = await this.workoutsRepository.findById(id);
    const owned = assertOwned(
      workout ? { ...workout, userId: workout.ownerId ?? CATALOG_SENTINEL } : null,
      userId,
      WORKOUT_NOT_FOUND,
    );
    if (owned.archivedAt) {
      throw WORKOUT_ARCHIVED();
    }

    const updated = await this.workoutsRepository.update(id, dto);
    if (!updated) {
      throw WORKOUT_NOT_FOUND();
    }
    const intervals = await this.workoutsRepository.findIntervalsForWorkout(id);
    return this.toDetailResponse(updated, intervals, userId);
  }

  /** `DELETE /workouts/:id` — soft delete, idempotente (mismo criterio
   * que Equipment): archivar algo ya archivado no es un error. */
  async archive(userId: string, id: string): Promise<void> {
    const workout = await this.workoutsRepository.findById(id);
    const owned = assertOwned(
      workout ? { ...workout, userId: workout.ownerId ?? CATALOG_SENTINEL } : null,
      userId,
      WORKOUT_NOT_FOUND,
    );
    if (owned.archivedAt) {
      return;
    }
    await this.workoutsRepository.archive(id);
  }

  /** `GET /workouts`/`GET /workouts/:id`: propio, catálogo
   * (`ownerId === null`), o marcado público por su dueño. */
  private isVisible(workout: WorkoutRecord, userId: string): boolean {
    return workout.ownerId === userId || workout.ownerId === null || workout.isPublic;
  }

  private validateIntervals(targetType: string, intervals: CreateWorkoutIntervalDto[]): void {
    for (const interval of intervals) {
      const hasLow = interval.targetLow !== undefined;
      const hasHigh = interval.targetHigh !== undefined;

      if (targetType === 'none') {
        if (hasLow || hasHigh) {
          throw WORKOUT_INVALID_INTERVALS(
            'No se puede definir targetLow/targetHigh en un intervalo cuando targetType es "none".',
          );
        }
        continue;
      }

      const range = TARGET_RANGES[targetType as 'power' | 'heart_rate'];
      if (hasLow && (interval.targetLow! < range.min || interval.targetLow! > range.max)) {
        throw WORKOUT_INVALID_INTERVALS(
          `targetLow fuera de rango para "${targetType}" (${range.min}-${range.max}).`,
        );
      }
      if (hasHigh && (interval.targetHigh! < range.min || interval.targetHigh! > range.max)) {
        throw WORKOUT_INVALID_INTERVALS(
          `targetHigh fuera de rango para "${targetType}" (${range.min}-${range.max}).`,
        );
      }
      if (hasLow && hasHigh && interval.targetLow! > interval.targetHigh!) {
        throw WORKOUT_INVALID_INTERVALS('targetLow no puede ser mayor que targetHigh.');
      }
    }
  }

  private toListResponse(record: WorkoutRecord, userId: string): WorkoutListItemResponse {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      sport: record.sport,
      estimatedDurationSeconds: record.estimatedDurationSeconds,
      targetType: record.targetType,
      isPublic: record.isPublic,
      isMine: record.ownerId === userId,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toDetailResponse(
    record: WorkoutRecord,
    intervals: WorkoutIntervalRecord[],
    userId: string,
  ): WorkoutDetailResponse {
    return {
      ...this.toListResponse(record, userId),
      intervals: intervals.map((interval) => ({
        position: interval.position,
        durationSeconds: interval.durationSeconds,
        targetLow: interval.targetLow === null ? null : Number(interval.targetLow),
        targetHigh: interval.targetHigh === null ? null : Number(interval.targetHigh),
        label: interval.label,
      })),
    };
  }
}
