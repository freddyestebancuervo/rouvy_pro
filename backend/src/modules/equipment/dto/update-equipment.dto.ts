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
  ValidateIf,
} from 'class-validator';

/**
 * `categoryCode` NO es editable acá a propósito — convertir una bici en
 * un pulsómetro (o viceversa) no es una operación de negocio real; si un
 * usuario se equivocó de categoría, la acción correcta es archivar y
 * crear de nuevo, no mutar la categoría de un recurso existente.
 *
 * `parentEquipmentId` acepta `null` explícito (desasociar del padre
 * actual) además de `undefined` (no tocar) y un UUID (asociar/cambiar de
 * padre) — `@IsOptional()` de class-validator ya trata `null` y
 * `undefined` como "sin validar", así que `@ValidateIf` es quien decide
 * cuándo SÍ exigir formato UUID (solo si no es `null`).
 */
export class UpdateEquipmentDto {
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'El nombre debe tener entre 2 y 100 caracteres.' })
  name?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  parentEquipmentId?: string | null;

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

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
