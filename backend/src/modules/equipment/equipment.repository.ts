import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';

export interface EquipmentRecord {
  id: string;
  userId: string;
  categoryCode: string;
  parentEquipmentId: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  hardwareRevision: string | null;
  bleName: string | null;
  bleAddress: string | null;
  status: string;
  batteryLevel: number | null;
  lastConnectedAt: Date | null;
  lastCalibratedAt: Date | null;
  metadata: Record<string, unknown>;
  // `pg` devuelve NUMERIC/BIGINT como string por defecto (evita pérdida
  // de precisión silenciosa) — mismo criterio que `UserRecord.weightKg`;
  // se convierte a number en el borde de salida (`EquipmentService`).
  totalDistanceMeters: string;
  totalDurationSeconds: string;
  isDefault: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEquipmentData {
  categoryCode: string;
  parentEquipmentId?: string | null;
  name: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
  hardwareRevision?: string | null;
  bleName?: string | null;
  bleAddress?: string | null;
  status?: string;
  batteryLevel?: number | null;
  lastConnectedAt?: string | null;
  lastCalibratedAt?: string | null;
  metadata?: Record<string, unknown>;
  isDefault?: boolean;
}

export interface UpdateEquipmentData {
  name?: string;
  parentEquipmentId?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
  hardwareRevision?: string | null;
  bleName?: string | null;
  bleAddress?: string | null;
  status?: string;
  batteryLevel?: number | null;
  lastConnectedAt?: string | null;
  lastCalibratedAt?: string | null;
  metadata?: Record<string, unknown>;
  isDefault?: boolean;
}

export interface EquipmentListFilters {
  category?: string;
  includeArchived: boolean;
}

function mapRow(row: Record<string, unknown>): EquipmentRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    categoryCode: row.category_code as string,
    parentEquipmentId: (row.parent_equipment_id as string | null) ?? null,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    serialNumber: (row.serial_number as string | null) ?? null,
    firmwareVersion: (row.firmware_version as string | null) ?? null,
    hardwareRevision: (row.hardware_revision as string | null) ?? null,
    bleName: (row.ble_name as string | null) ?? null,
    bleAddress: (row.ble_address as string | null) ?? null,
    status: row.status as string,
    batteryLevel: (row.battery_level as number | null) ?? null,
    lastConnectedAt: (row.last_connected_at as Date | null) ?? null,
    lastCalibratedAt: (row.last_calibrated_at as Date | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    totalDistanceMeters: row.total_distance_meters as string,
    totalDurationSeconds: row.total_duration_seconds as string,
    isDefault: row.is_default as boolean,
    archivedAt: (row.archived_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

/**
 * Acceso a `equipment`/`equipment_categories` vía `pg.Pool` directo, sin
 * ORM — misma decisión ya tomada en C2, ahora para el Bloque D. Ver
 * docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md sección 2 para el diseño
 * completo (modelo polimórfico, `specs`/`metadata` JSONB, invariante de
 * "un default por categoría").
 */
@Injectable()
export class EquipmentRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async categoryExists(code: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM equipment_categories WHERE code = $1', [code]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Sin filtro de `archived_at`/`user_id` a propósito — ownership y
   * visibilidad de archivados se deciden en `EquipmentService` (un
   * equipo archivado sigue siendo resoluble por `id`, ver sección 2.7 de
   * la spec: "archivar preserva historial"). */
  async findById(id: string): Promise<EquipmentRecord | null> {
    const result = await this.pool.query('SELECT * FROM equipment WHERE id = $1', [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findAllForUser(userId: string, filters: EquipmentListFilters): Promise<EquipmentRecord[]> {
    const conditions: string[] = ['user_id = $1'];
    const values: unknown[] = [userId];

    if (!filters.includeArchived) {
      conditions.push('archived_at IS NULL');
    }
    if (filters.category) {
      values.push(filters.category);
      conditions.push(`category_code = $${values.length}`);
    }

    const result = await this.pool.query(
      `SELECT * FROM equipment WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      values,
    );
    return result.rows.map(mapRow);
  }

  /**
   * Transaccional porque `isDefault: true` dispara la misma operación
   * atómica de "desmarcar el default anterior de la categoría" que usa
   * `update()` — ver `applyDefault` para el razonamiento de concurrencia
   * (mismo patrón `SELECT ... FOR UPDATE` que ya usa
   * `RefreshTokensRepository.rotate()`, C4).
   */
  async create(userId: string, data: CreateEquipmentData): Promise<EquipmentRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `INSERT INTO equipment (
           user_id, category_code, parent_equipment_id, name, brand, model,
           serial_number, firmware_version, hardware_revision, ble_name, ble_address,
           status, battery_level, last_connected_at, last_calibrated_at, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
         RETURNING *`,
        [
          userId,
          data.categoryCode,
          data.parentEquipmentId ?? null,
          data.name,
          data.brand ?? null,
          data.model ?? null,
          data.serialNumber ?? null,
          data.firmwareVersion ?? null,
          data.hardwareRevision ?? null,
          data.bleName ?? null,
          data.bleAddress ?? null,
          data.status ?? 'active',
          data.batteryLevel ?? null,
          data.lastConnectedAt ?? null,
          data.lastCalibratedAt ?? null,
          JSON.stringify(data.metadata ?? {}),
        ],
      );
      let record = mapRow(insertResult.rows[0]);

      if (data.isDefault) {
        record = await this.applyDefault(client, record.id, userId, record.categoryCode);
      }

      await client.query('COMMIT');
      return record;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Devuelve `null` si `id` no existe o ya está archivado (`PATCH` sobre
   * un equipo archivado es responsabilidad de `EquipmentService`, que lo
   * rechaza ANTES de llegar acá — este `WHERE` es la segunda barrera). */
  async update(id: string, patch: UpdateEquipmentData): Promise<EquipmentRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const setDefaultToTrue = patch.isDefault === true;
      const setClauses: string[] = [];
      const values: unknown[] = [id];

      const pushField = (column: string, value: unknown): void => {
        values.push(value);
        setClauses.push(`${column} = $${values.length}`);
      };

      if (patch.name !== undefined) pushField('name', patch.name);
      if (patch.parentEquipmentId !== undefined) pushField('parent_equipment_id', patch.parentEquipmentId);
      if (patch.brand !== undefined) pushField('brand', patch.brand);
      if (patch.model !== undefined) pushField('model', patch.model);
      if (patch.serialNumber !== undefined) pushField('serial_number', patch.serialNumber);
      if (patch.firmwareVersion !== undefined) pushField('firmware_version', patch.firmwareVersion);
      if (patch.hardwareRevision !== undefined) pushField('hardware_revision', patch.hardwareRevision);
      if (patch.bleName !== undefined) pushField('ble_name', patch.bleName);
      if (patch.bleAddress !== undefined) pushField('ble_address', patch.bleAddress);
      if (patch.status !== undefined) pushField('status', patch.status);
      if (patch.batteryLevel !== undefined) pushField('battery_level', patch.batteryLevel);
      if (patch.lastConnectedAt !== undefined) pushField('last_connected_at', patch.lastConnectedAt);
      if (patch.lastCalibratedAt !== undefined) pushField('last_calibrated_at', patch.lastCalibratedAt);
      if (patch.metadata !== undefined) {
        values.push(JSON.stringify(patch.metadata));
        setClauses.push(`metadata = $${values.length}::jsonb`);
      }
      // `isDefault: false` es un simple UPDATE directo; `true` necesita
      // la operación transaccional de `applyDefault` (más abajo), así que
      // se excluye acá para no chocar con esa segunda escritura.
      if (patch.isDefault === false) pushField('is_default', false);

      let record: EquipmentRecord | null;
      if (setClauses.length > 0) {
        setClauses.push('updated_at = now()');
        const result = await client.query(
          `UPDATE equipment SET ${setClauses.join(', ')} WHERE id = $1 AND archived_at IS NULL RETURNING *`,
          values,
        );
        record = result.rows[0] ? mapRow(result.rows[0]) : null;
      } else {
        const result = await client.query(
          'SELECT * FROM equipment WHERE id = $1 AND archived_at IS NULL',
          [id],
        );
        record = result.rows[0] ? mapRow(result.rows[0]) : null;
      }

      if (record && setDefaultToTrue) {
        record = await this.applyDefault(client, record.id, record.userId, record.categoryCode);
      }

      await client.query('COMMIT');
      return record;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Soft delete — nunca borra físico (una actividad futura podría
   * referenciar este equipo, ver módulo 4 de la spec). Idempotente a
   * nivel de fila: si ya estaba archivado, el `WHERE` no matchea y
   * devuelve `null`; `EquipmentService.archive` decide qué hacer con eso
   * (no es un error, ver sección 2.7 — "DELETE es idempotente"). */
  async archive(id: string): Promise<EquipmentRecord | null> {
    const result = await this.pool.query(
      `UPDATE equipment SET archived_at = now(), is_default = FALSE, updated_at = now()
       WHERE id = $1 AND archived_at IS NULL RETURNING *`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Garantiza "como máximo 1 equipo default por categoría y por usuario"
   * bajo concurrencia real, no solo en el caso feliz. El `SELECT ... FOR
   * UPDATE` sobre TODA la categoría (no solo la fila que se va a marcar)
   * es lo que evita la carrera: sin él, dos requests concurrentes
   * marcando equipos DISTINTOS como default en la misma categoría podrían
   * violar el índice único parcial en vez de serializarse limpiamente
   * (el segundo request, al desbloquearse, vería la fila vieja ya
   * desmarcada por el primero pero NO volvería a escanear la fila nueva
   * que el primero acaba de marcar, si no se bloquea el grupo entero de
   * entrada). Mismo patrón que ya usa
   * `RefreshTokensRepository.rotate()` (C4) para el mismo tipo de
   * problema (verificado con un test de concurrencia real, no solo en
   * teoría — ver `equipment.e2e-spec.ts`).
   */
  private async applyDefault(
    client: PoolClient,
    id: string,
    userId: string,
    categoryCode: string,
  ): Promise<EquipmentRecord> {
    await client.query(
      `SELECT id FROM equipment
       WHERE user_id = $1 AND category_code = $2 AND archived_at IS NULL
       ORDER BY id
       FOR UPDATE`,
      [userId, categoryCode],
    );
    await client.query(
      `UPDATE equipment SET is_default = FALSE, updated_at = now()
       WHERE user_id = $1 AND category_code = $2 AND id != $3 AND is_default AND archived_at IS NULL`,
      [userId, categoryCode, id],
    );
    const result = await client.query(
      'UPDATE equipment SET is_default = TRUE, updated_at = now() WHERE id = $1 RETURNING *',
      [id],
    );
    return mapRow(result.rows[0]);
  }
}
