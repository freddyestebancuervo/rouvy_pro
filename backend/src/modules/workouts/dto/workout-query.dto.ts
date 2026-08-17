import { IsIn, IsOptional, IsString } from 'class-validator';

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

  /**
   * Paginación keyset opt-in (T-F0.5,
   * docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — mismo criterio que
   * `EquipmentQueryDto.limit`/`.cursor`: validados como string acá, la
   * validación semántica real vive en
   * `common/pagination/pagination.util.ts` para producir los códigos de
   * error exactos del contrato en vez del `VALIDATION_ERROR` genérico.
   */
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}
