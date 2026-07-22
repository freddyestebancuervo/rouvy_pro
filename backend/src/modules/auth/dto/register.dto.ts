import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Política de contraseña: 8+ caracteres, al menos un número y una
 * mayúscula — MISMA regla que `Validators.password` en el cliente Flutter
 * (`lib/core/utils/validators.dart`), replicada server-side porque la
 * spec (sección 5.5) exige no confiar solo en la validación de UI. Sin
 * tope superior en el regex a propósito (no es parte de la política) —
 * el `@MaxLength` de abajo es un límite de payload, no de la política.
 */
const PASSWORD_POLICY = /^(?=.*[0-9])(?=.*[A-Z]).{8,}$/;

export class RegisterDto {
  // Mismo `VARCHAR(255)` de `users.email` en `migrations/0001_init.sql`
  // — sin este límite, un email "válido" pero absurdamente largo pasaría
  // el DTO y recién fallaría al insertar, como un 500 en vez de un 400.
  @MaxLength(255, { message: 'El email es demasiado largo.' })
  @IsEmail({}, { message: 'El email no es válido.' })
  email!: string;

  @IsString()
  @MaxLength(128, { message: 'La contraseña es demasiado larga.' })
  @Matches(PASSWORD_POLICY, {
    message: 'La contraseña debe tener 8+ caracteres, con al menos un número y una mayúscula.',
  })
  password!: string;

  @IsString()
  @Length(2, 100, { message: 'El nombre debe tener entre 2 y 100 caracteres.' })
  displayName!: string;
}
