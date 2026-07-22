import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * `targetLow`/`targetHigh` se validan acá solo como "número razonable"
 * (0-1000) — el rango real depende de `targetType` del workout padre
 * (`power` → 0-300 %FTP, `heart_rate` → 60-220 bpm), y esa validación
 * cruzada vive en `WorkoutsService`, no en este DTO (mismo criterio que
 * la validación de `metadata` por categoría en Equipment: cross-field
 * real, no expresable limpio como decorator de un solo campo).
 */
export class CreateWorkoutIntervalDto {
  @IsNumber()
  @Min(1)
  @Max(36000) // 10 horas — tope de sanidad, no la política real
  durationSeconds!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  targetLow?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  targetHigh?: number;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  label?: string;
}

export class CreateWorkoutDto {
  @IsString()
  @Length(2, 150, { message: 'El nombre debe tener entre 2 y 150 caracteres.' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Único valor válido hoy (`cycling`) — CHECK extensible en la
  // migración, no hardcodeado sin validación (ver spec sección 3).
  @IsOptional()
  @IsIn(['cycling'])
  sport?: string;

  @IsIn(['power', 'heart_rate', 'none'], {
    message: 'targetType debe ser "power", "heart_rate" o "none".',
  })
  targetType!: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  // `position` NO se recibe del cliente — lo asigna el servicio a partir
  // del índice de este array (ver WorkoutsRepository.create).
  @IsArray()
  @ArrayMinSize(1, { message: 'El entrenamiento debe tener al menos un intervalo.' })
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutIntervalDto)
  intervals!: CreateWorkoutIntervalDto[];
}
