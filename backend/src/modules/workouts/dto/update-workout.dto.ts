import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * Solo metadata de nivel superior — `sport`/`targetType` son inmutables
 * (cambiar la categoría de un workout existente no es una operación de
 * negocio real, mismo criterio que `categoryCode` en Equipment) y los
 * intervalos son inmutables tras la creación (ver spec sección 3,
 * decisión de implementación): si el usuario quiere una estructura
 * distinta, archiva y crea uno nuevo.
 */
export class UpdateWorkoutDto {
  @IsOptional()
  @IsString()
  @Length(2, 150, { message: 'El nombre debe tener entre 2 y 150 caracteres.' })
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
