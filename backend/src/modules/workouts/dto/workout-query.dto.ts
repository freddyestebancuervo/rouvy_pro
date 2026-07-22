import { IsIn, IsOptional } from 'class-validator';

/**
 * `mine` llega como string desde el query param (`?mine=true`) — mismo
 * criterio que `includeArchived` en `EquipmentQueryDto`: se valida como
 * `'true' | 'false'` acá, la conversión real a boolean ocurre en
 * `WorkoutsService.list`.
 */
export class WorkoutQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: string;
}
