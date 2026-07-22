import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * `categoryCode` se valida como string simple acá — la existencia real
 * se comprueba en `EquipmentService` contra la tabla `equipment_categories`
 * (no contra una lista hardcodeada en este DTO). Es la decisión de diseño
 * central del módulo (ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md,
 * sección 2.13): agregar una categoría nueva es un `INSERT` en esa tabla,
 * y NO debe requerir tocar este archivo.
 */
export class CreateEquipmentDto {
  @IsString()
  @Length(2, 100, { message: 'El nombre debe tener entre 2 y 100 caracteres.' })
  name!: string;

  @IsString()
  @Length(1, 30, { message: 'La categoría no es válida.' })
  categoryCode!: string;

  @IsOptional()
  @IsUUID()
  parentEquipmentId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  brand?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  hardwareRevision?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  bleName?: string;

  // Mismo largo que `ble_address VARCHAR(64)` — un MAC/UUID BLE real
  // nunca se acerca a ese límite, pero acota el payload de todas formas
  // (mismo criterio que el resto del proyecto para campos de texto libre).
  @IsOptional()
  @IsString()
  @Length(0, 64)
  bleAddress?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'status debe ser "active" o "inactive".' })
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @IsOptional()
  @IsISO8601()
  lastConnectedAt?: string;

  @IsOptional()
  @IsISO8601()
  lastCalibratedAt?: string;

  // Validado solo como "objeto JSON plano" acá — el detalle de qué
  // atributos tiene sentido para cada categoría (peso de una bici,
  // resistencia máxima de un rodillo, ...) queda deliberadamente fuera de
  // esta tarea (D1 es CRUD + ownership, no el mapa de validación por
  // categoría completo) — ver riesgo documentado en la spec.
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
