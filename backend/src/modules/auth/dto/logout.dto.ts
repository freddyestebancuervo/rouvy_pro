import { IsString, MaxLength, MinLength } from 'class-validator';

/** Mismo formato/cota que `RefreshDto` — el cliente debe indicar cuál de
 * sus sesiones (refresh tokens) cerrar. */
export class LogoutDto {
  @IsString()
  @MinLength(1, { message: 'El refresh token es requerido.' })
  @MaxLength(512, { message: 'El refresh token no tiene un formato válido.' })
  refreshToken!: string;
}
