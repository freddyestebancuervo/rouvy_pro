import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Filtros de `GET /equipment`. `includeArchived` llega como string desde
 * el query param (`?includeArchived=true`) — se valida como
 * `'true' | 'false'` en vez de `@IsBoolean()` porque `ValidationPipe`
 * con `transform: true` no coacciona automáticamente strings de query a
 * boolean de forma segura (`Boolean('false')` es `true`); la conversión
 * real a boolean ocurre en `EquipmentService.listPaginated` (única ruta
 * HTTP del listado tras T-F0.5 Enforcement,
 * docs/tasks/TF0_5_PAGINATION_CONTRACT.md §6.3).
 */
export class EquipmentQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  category?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: string;

  /**
   * Paginación keyset (T-F0.5, docs/tasks/TF0_5_PAGINATION_CONTRACT.md
   * §6.3, Enforcement) — `limit`/`cursor` siguen siendo opcionales;
   * validados como string acá por el mismo motivo que `includeArchived`:
   * la validación semántica real (rango de `limit`, schema/versión/
   * fingerprint de `cursor`) vive en
   * `common/pagination/pagination.util.ts` para producir exactamente
   * los códigos de error del contrato (`PAGINATION_LIMIT_INVALID`,
   * `PAGINATION_CURSOR_INVALID`, `PAGINATION_CURSOR_FILTER_MISMATCH`),
   * no el `VALIDATION_ERROR` genérico de `class-validator`. `limit`
   * ausente aplica `DEFAULT_LIMIT=50` (contract §9.1) — ya no existe un
   * camino sin límite, con o sin filtros.
   */
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}
