import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

export interface WorkoutRecord {
  id: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  sport: string;
  estimatedDurationSeconds: number;
  targetType: string;
  isPublic: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutIntervalRecord {
  id: string;
  workoutId: string;
  position: number;
  durationSeconds: number;
  // `pg` devuelve NUMERIC como string — se convierte a number en el
  // borde de salida (WorkoutsService), mismo criterio que el resto del
  // proyecto (ver UserRecord.weightKg, EquipmentRecord.totalDistanceMeters).
  targetLow: string | null;
  targetHigh: string | null;
  label: string | null;
}

export interface CreateWorkoutInterval {
  durationSeconds: number;
  targetLow?: number | null;
  targetHigh?: number | null;
  label?: string | null;
}

export interface CreateWorkoutData {
  name: string;
  description?: string | null;
  sport: string;
  targetType: string;
  isPublic?: boolean;
  intervals: CreateWorkoutInterval[];
}

export interface UpdateWorkoutData {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
}

export interface WorkoutListFilters {
  mineOnly: boolean;
}

/**
 * T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — tipos de la ruta
 * paginada, separados del camino legacy de arriba a propósito (contract
 * Task14 Fase K).
 */
export interface WorkoutKeysetCursor {
  createdAt: string;
  id: string;
}

export interface WorkoutPageArgs {
  limit: number;
  cursor: WorkoutKeysetCursor | null;
}

export interface WorkoutPageRow {
  record: WorkoutRecord;
  cursorCreatedAt: string;
}

function mapWorkoutRow(row: Record<string, unknown>): WorkoutRecord {
  return {
    id: row.id as string,
    ownerId: (row.owner_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    sport: row.sport as string,
    estimatedDurationSeconds: row.estimated_duration_seconds as number,
    targetType: row.target_type as string,
    isPublic: row.is_public as boolean,
    archivedAt: (row.archived_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapIntervalRow(row: Record<string, unknown>): WorkoutIntervalRecord {
  return {
    id: row.id as string,
    workoutId: row.workout_id as string,
    position: row.position as number,
    durationSeconds: row.duration_seconds as number,
    targetLow: (row.target_low as string | null) ?? null,
    targetHigh: (row.target_high as string | null) ?? null,
    label: (row.label as string | null) ?? null,
  };
}

/**
 * Acceso a `workouts`/`workout_intervals` vía `pg.Pool` directo, sin ORM
 * — misma decisión ya tomada en C2. Ver
 * docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md sección 3 para el diseño
 * completo (intervalos inmutables tras creación, `position`/
 * `estimated_duration_seconds` derivados en el servidor).
 */
@Injectable()
export class WorkoutsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Crea el workout y sus intervalos en una única transacción (todo o
   * nada) — mismo patrón ya usado en `EquipmentRepository.create()` y,
   * antes, en `RefreshTokensRepository.rotate()`. `position` se asigna
   * acá a partir del índice del array recibido (0..N-1) —
   * `estimated_duration_seconds` es la suma de `durationSeconds` de cada
   * intervalo, calculada por el servicio antes de llamar a este método.
   */
  async create(
    ownerId: string,
    data: CreateWorkoutData,
    estimatedDurationSeconds: number,
  ): Promise<{ workout: WorkoutRecord; intervals: WorkoutIntervalRecord[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workoutResult = await client.query(
        `INSERT INTO workouts (
           owner_id, name, description, sport, estimated_duration_seconds,
           target_type, is_public
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          ownerId,
          data.name,
          data.description ?? null,
          data.sport,
          estimatedDurationSeconds,
          data.targetType,
          data.isPublic ?? false,
        ],
      );
      const workout = mapWorkoutRow(workoutResult.rows[0]);

      const intervals: WorkoutIntervalRecord[] = [];
      for (let position = 0; position < data.intervals.length; position += 1) {
        const interval = data.intervals[position];
        const intervalResult = await client.query(
          `INSERT INTO workout_intervals (
             workout_id, position, duration_seconds, target_low, target_high, label
           ) VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            workout.id,
            position,
            interval.durationSeconds,
            interval.targetLow ?? null,
            interval.targetHigh ?? null,
            interval.label ?? null,
          ],
        );
        intervals.push(mapIntervalRow(intervalResult.rows[0]));
      }

      await client.query('COMMIT');
      return { workout, intervals };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Sin filtro de `archived_at`/visibilidad a propósito — esas
   * decisiones viven en `WorkoutsService` (un workout archivado sigue
   * siendo resoluble por `id`, mismo criterio que Equipment). */
  async findById(id: string): Promise<WorkoutRecord | null> {
    const result = await this.pool.query('SELECT * FROM workouts WHERE id = $1', [id]);
    return result.rows[0] ? mapWorkoutRow(result.rows[0]) : null;
  }

  async findIntervalsForWorkout(workoutId: string): Promise<WorkoutIntervalRecord[]> {
    const result = await this.pool.query(
      'SELECT * FROM workout_intervals WHERE workout_id = $1 ORDER BY position ASC',
      [workoutId],
    );
    return result.rows.map(mapIntervalRow);
  }

  /**
   * `GET /workouts` — visible si es propio, catálogo (`owner_id IS
   * NULL`), o marcado público por su dueño; `mineOnly` restringe a solo
   * propios. Excluye archivados. Sin intervalos (payload liviano, ver
   * `findIntervalsForWorkout` para el detalle).
   */
  async findAllForUser(userId: string, filters: WorkoutListFilters): Promise<WorkoutRecord[]> {
    const condition = filters.mineOnly
      ? 'owner_id = $1'
      : '(owner_id = $1 OR owner_id IS NULL OR is_public = TRUE)';
    const result = await this.pool.query(
      `SELECT * FROM workouts WHERE ${condition} AND archived_at IS NULL ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(mapWorkoutRow);
  }

  /**
   * T-F0.5 — ruta paginada keyset, usada exclusivamente cuando el
   * caller pasó `limit`/`cursor` (contract §6.1/§11). Conserva
   * exactamente la misma visibilidad que `findAllForUser` (`mineOnly` ?
   * propios : propio OR catálogo OR público), solo le agrega con `AND`
   * el predicado de continuación keyset — nunca la reemplaza (contract
   * §13). Mismo criterio de precisión de timestamp que
   * `EquipmentRepository.findPageForUser` (contract §8.2); todos los
   * valores parametrizados, nunca interpolados.
   */
  async findPageForUser(
    userId: string,
    filters: WorkoutListFilters,
    page: WorkoutPageArgs,
  ): Promise<WorkoutPageRow[]> {
    const values: unknown[] = [userId];
    const visibility = filters.mineOnly ? 'owner_id = $1' : '(owner_id = $1 OR owner_id IS NULL OR is_public = TRUE)';
    const conditions: string[] = [visibility, 'archived_at IS NULL'];

    if (page.cursor) {
      values.push(page.cursor.createdAt, page.cursor.id);
      const createdAtParam = `$${values.length - 1}::timestamptz`;
      const idParam = `$${values.length}::uuid`;
      conditions.push(`(created_at < ${createdAtParam} OR (created_at = ${createdAtParam} AND id < ${idParam}))`);
    }
    values.push(page.limit);

    const result = await this.pool.query(
      `SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
       FROM workouts WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => ({
      record: mapWorkoutRow(row),
      cursorCreatedAt: row.cursor_created_at as string,
    }));
  }

  /** Devuelve `null` si `id` no existe o ya está archivado — mismo
   * criterio que `EquipmentRepository.update()`. Los intervalos son
   * inmutables tras la creación (ver spec sección 3), así que este
   * método nunca los toca. */
  async update(id: string, patch: UpdateWorkoutData): Promise<WorkoutRecord | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [id];

    const pushField = (column: string, value: unknown): void => {
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (patch.name !== undefined) pushField('name', patch.name);
    if (patch.description !== undefined) pushField('description', patch.description);
    if (patch.isPublic !== undefined) pushField('is_public', patch.isPublic);

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push('updated_at = now()');
    const result = await this.pool.query(
      `UPDATE workouts SET ${setClauses.join(', ')} WHERE id = $1 AND archived_at IS NULL RETURNING *`,
      values,
    );
    return result.rows[0] ? mapWorkoutRow(result.rows[0]) : null;
  }

  /** Soft delete idempotente — mismo criterio que
   * `EquipmentRepository.archive()`. */
  async archive(id: string): Promise<WorkoutRecord | null> {
    const result = await this.pool.query(
      `UPDATE workouts SET archived_at = now(), updated_at = now()
       WHERE id = $1 AND archived_at IS NULL RETURNING *`,
      [id],
    );
    return result.rows[0] ? mapWorkoutRow(result.rows[0]) : null;
  }
}
