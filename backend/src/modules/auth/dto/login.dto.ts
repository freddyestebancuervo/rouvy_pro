import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @MaxLength(255, { message: 'El email es demasiado largo.' })
  @IsEmail({}, { message: 'El email no es válido.' })
  email!: string;

  // Sin política acá a propósito (min 1, max 128): es login, no
  // registro — la contraseña real ya puede tener cualquier forma previa
  // a que existiera esta política. El máximo es solo un límite de
  // payload, mismo motivo que en `RegisterDto`.
  @IsString()
  @MinLength(1, { message: 'La contraseña es requerida.' })
  @MaxLength(128, { message: 'La contraseña es demasiado larga.' })
  password!: string;
}
