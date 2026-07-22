import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  // El formato real es `rt_` + 64 hex (ver `TokenService.issueRefreshToken`,
  // 67 caracteres) — 512 da margen sin dejar el campo sin cota.
  @IsString()
  @MinLength(1, { message: 'El refresh token es requerido.' })
  @MaxLength(512, { message: 'El refresh token no tiene un formato válido.' })
  refreshToken!: string;
}
