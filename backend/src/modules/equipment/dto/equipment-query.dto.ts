import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Filtros de `GET /equipment`. `includeArchived` llega como string desde
 * el query param (`?includeArchived=true`) — se valida como
 * `'true' | 'false'` en vez de `@IsBoolean()` porque `ValidationPipe`
 * con `transform: true` no coacciona automáticamente strings de query a
 * boolean de forma segura (`Boolean('false')` es `true`); la conversión
 * real a boolean ocurre en `EquipmentService.list`.
 */
export class EquipmentQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  category?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: string;
}
