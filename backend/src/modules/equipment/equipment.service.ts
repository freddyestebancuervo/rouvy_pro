import { HttpStatus, Injectable } from '@nestjs/common';
import { isPgUniqueViolation, pgConstraintName } from '../../common/database/pg-error.util';
import { ApiException } from '../../common/exceptions/api.exception';
import { assertOwned } from '../../common/ownership/assert-owned.util';
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../../common/pagination/pagination.util';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { EquipmentQueryDto } from './dto/equipment-query.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { EquipmentRecord, EquipmentRepository } from './equipment.repository';

export interface EquipmentResponse {
  id: string;
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
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  isDefault: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — resultado interno
 * del modo paginado. El controller es quien decide cómo exponer
 * `nextCursor` (header `X-Next-Cursor`, nunca en el body — contract
 * §6.1/§10). */
export interface EquipmentPage {
  items: EquipmentResponse[];
  nextCursor: string | null;
}

const EQUIPMENT_NOT_FOUND = (): ApiException =>
  new ApiException(HttpStatus.NOT_FOUND, 'EQUIPMENT_NOT_FOUND', 'El equipo solicitado no existe.');

const EQUIPMENT_ARCHIVED = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'EQUIPMENT_ARCHIVED',
    'Este equipo está archivado y no se puede editar.',
  );

const EQUIPMENT_INVALID_CATEGORY = (code: string): ApiException =>
  new ApiException(HttpStatus.BAD_REQUEST, 'EQUIPMENT_INVALID_CATEGORY', `La categoría "${code}" no existe.`);

// Mismo mensaje sin importar si el padre no existe, es de otro usuario,
// está archivado o ya tiene su propio padre — no hace falta distinguir
// esos casos de cara al cliente (mismo principio de no confirmar detalles
// de recursos ajenos que ya usa `assertOwned`).
const EQUIPMENT_INVALID_PARENT = (): ApiException =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'EQUIPMENT_INVALID_PARENT',
    'parentEquipmentId no es válido: debe ser un equipo propio, existente, sin archivar y sin padre propio (máximo 1 nivel).',
  );

const EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED',
    'Ya registraste otro equipo con esa dirección Bluetooth.',
  );

const EQUIPMENT_DEFAULT_CONFLICT = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'EQUIPMENT_DEFAULT_CONFLICT',
    'Otra actualización en curso ya cambió el equipo default de esta categoría — reintentá.',
  );

/** Nombre de la constraint si el error es un `unique_violation`, o `null`
 * en cualquier otro caso — usa el helper compartido con `AuthService`
 * (`src/common/database/pg-error.util.ts`, hallazgo de la revisión de
 * limpieza post-D1: antes cada servicio reimplementaba esta extracción
 * por separado). */
function uniqueViolationConstraint(error: unknown): string | null {
  return isPgUniqueViolation(error) ? pgConstraintName(error) : null;
}

@Injectable()
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  async create(userId: string, dto: CreateEquipmentDto): Promise<EquipmentResponse> {
    await this.assertValidCategory(dto.categoryCode);
    const parentEquipmentId = await this.resolveParentForWrite(userId, dto.parentEquipmentId, undefined);

    try {
      const record = await this.equipmentRepository.create(userId, {
        categoryCode: dto.categoryCode,
        parentEquipmentId,
        name: dto.name,
        brand: dto.brand,
        model: dto.model,
        serialNumber: dto.serialNumber,
        firmwareVersion: dto.firmwareVersion,
        hardwareRevision: dto.hardwareRevision,
        bleName: dto.bleName,
        bleAddress: dto.bleAddress,
        status: dto.status,
        batteryLevel: dto.batteryLevel,
        lastConnectedAt: dto.lastConnectedAt,
        lastCalibratedAt: dto.lastCalibratedAt,
        metadata: dto.metadata,
        isDefault: dto.isDefault,
      });
      return this.toResponse(record);
    } catch (error) {
      return this.translateUniqueViolation(error);
    }
  }

  /**
   * Helper anterior a T-F0.5 Enforcement (docs/tasks/TF0_5_PAGINATION_CONTRACT.md
   * §6.3) — `EquipmentController.list` ya no lo invoca: TODO listado HTTP
   * pasa por `listPaginated()` de abajo. Se conserva temporalmente sin
   * cambios de comportamiento (no es un camino HTTP activo); su
   * eliminación queda fuera de esta corrección (ver Fase E, MINIMAL_CHANGE).
   */
  async list(userId: string, query: EquipmentQueryDto): Promise<EquipmentResponse[]> {
    if (query.category) {
      await this.assertValidCategory(query.category);
    }
    const records = await this.equipmentRepository.findAllForUser(userId, {
      category: query.category,
      includeArchived: query.includeArchived === 'true',
    });
    return records.map((record) => this.toResponse(record));
  }

  /**
   * T-F0.5 (contract §6.1/§9/§10) — usada por `EquipmentController.list`
   * para TODO listado HTTP, con o sin `limit`/`cursor` (Enforcement,
   * contract §6.3): `limit` ausente aplica `DEFAULT_LIMIT=50` vía
   * `parseLimit(undefined)`, no un camino sin límite.
   */
  async listPaginated(userId: string, query: EquipmentQueryDto): Promise<EquipmentPage> {
    if (query.category) {
      await this.assertValidCategory(query.category);
    }
    const includeArchived = query.includeArchived === 'true';
    // Ausente y `false` son el mismo filtro efectivo (mismo criterio que
    // `list()` arriba) — deben producir el mismo fingerprint (contract
    // §8.1 nota de Fase H).
    const fingerprint = computeFilterFingerprint({
      category: query.category ?? null,
      includeArchived,
    });
    const limit = parseLimit(query.limit);
    const cursor = query.cursor !== undefined ? decodeCursor(query.cursor, fingerprint) : null;

    const rows = await this.equipmentRepository.findPageForUser(
      userId,
      { category: query.category, includeArchived },
      { limit: limit + 1, cursor },
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => this.toResponse(row.record));

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor({ createdAt: last.cursorCreatedAt, id: last.record.id, fingerprint });
    }

    return { items, nextCursor };
  }

  async getById(userId: string, id: string): Promise<EquipmentResponse> {
    const record = await this.findOwned(userId, id);
    return this.toResponse(record);
  }

  async update(userId: string, id: string, dto: UpdateEquipmentDto): Promise<EquipmentResponse> {
    const existing = await this.findOwned(userId, id);
    if (existing.archivedAt) {
      throw EQUIPMENT_ARCHIVED();
    }

    const parentEquipmentId =
      dto.parentEquipmentId === undefined
        ? undefined
        : await this.resolveParentForWrite(userId, dto.parentEquipmentId, id);

    try {
      const updated = await this.equipmentRepository.update(id, {
        name: dto.name,
        parentEquipmentId,
        brand: dto.brand,
        model: dto.model,
        serialNumber: dto.serialNumber,
        firmwareVersion: dto.firmwareVersion,
        hardwareRevision: dto.hardwareRevision,
        bleName: dto.bleName,
        bleAddress: dto.bleAddress,
        status: dto.status,
        batteryLevel: dto.batteryLevel,
        lastConnectedAt: dto.lastConnectedAt,
        lastCalibratedAt: dto.lastCalibratedAt,
        metadata: dto.metadata,
        isDefault: dto.isDefault,
      });
      if (!updated) {
        throw EQUIPMENT_NOT_FOUND();
      }
      return this.toResponse(updated);
    } catch (error) {
      return this.translateUniqueViolation(error);
    }
  }

  /** `DELETE /equipment/:id` — soft delete, idempotente: archivar algo
   * que ya estaba archivado no es un error (mismo criterio REST estándar
   * que el resto de operaciones idempotentes de este proyecto). */
  async archive(userId: string, id: string): Promise<void> {
    const existing = await this.findOwned(userId, id);
    if (existing.archivedAt) {
      return;
    }
    await this.equipmentRepository.archive(id);
  }

  private async findOwned(userId: string, id: string): Promise<EquipmentRecord> {
    const record = await this.equipmentRepository.findById(id);
    return assertOwned(record, userId, EQUIPMENT_NOT_FOUND);
  }

  private async assertValidCategory(code: string): Promise<void> {
    const exists = await this.equipmentRepository.categoryExists(code);
    if (!exists) {
      throw EQUIPMENT_INVALID_CATEGORY(code);
    }
  }

  /**
   * Valida `parentEquipmentId` para escritura (create/update):
   * `undefined` = no tocar; `null` = desasociar; string = debe ser un
   * equipo propio, existente, sin archivar, y con profundidad máxima de
   * 1 nivel (el padre no puede tener a su vez otro padre) — ver
   * docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md sección 2.6/2.10.
   */
  private async resolveParentForWrite(
    userId: string,
    parentEquipmentId: string | null | undefined,
    selfId: string | undefined,
  ): Promise<string | null | undefined> {
    if (parentEquipmentId === undefined) return undefined;
    if (parentEquipmentId === null) return null;
    if (parentEquipmentId === selfId) {
      throw EQUIPMENT_INVALID_PARENT();
    }

    const parent = assertOwned(
      await this.equipmentRepository.findById(parentEquipmentId),
      userId,
      EQUIPMENT_INVALID_PARENT,
    );
    if (parent.archivedAt || parent.parentEquipmentId !== null) {
      throw EQUIPMENT_INVALID_PARENT();
    }
    return parentEquipmentId;
  }

  private translateUniqueViolation(error: unknown): never {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === 'equipment_user_ble_address_unique') {
      throw EQUIPMENT_BLE_ADDRESS_ALREADY_REGISTERED();
    }
    if (constraint === 'equipment_one_default_per_user_category') {
      throw EQUIPMENT_DEFAULT_CONFLICT();
    }
    throw error;
  }

  private toResponse(record: EquipmentRecord): EquipmentResponse {
    return {
      id: record.id,
      categoryCode: record.categoryCode,
      parentEquipmentId: record.parentEquipmentId,
      name: record.name,
      brand: record.brand,
      model: record.model,
      serialNumber: record.serialNumber,
      firmwareVersion: record.firmwareVersion,
      hardwareRevision: record.hardwareRevision,
      bleName: record.bleName,
      bleAddress: record.bleAddress,
      status: record.status,
      batteryLevel: record.batteryLevel,
      lastConnectedAt: record.lastConnectedAt,
      lastCalibratedAt: record.lastCalibratedAt,
      metadata: record.metadata,
      totalDistanceMeters: Number(record.totalDistanceMeters),
      totalDurationSeconds: Number(record.totalDurationSeconds),
      isDefault: record.isDefault,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
