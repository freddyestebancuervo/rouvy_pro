import { IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * Rangos idénticos a los `CHECK` de `users` en
 * `migrations/0001_init.sql` (`ftp BETWEEN 0 AND 1000`,
 * `weight_kg BETWEEN 20 AND 300`) — validar acá da un `400
 * VALIDATION_ERROR` claro en vez de dejar que Postgres rechace el UPDATE
 * con un error genérico.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'El nombre debe tener entre 2 y 100 caracteres.' })
  displayName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  ftp?: number;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(300)
  weightKg?: number;
}
