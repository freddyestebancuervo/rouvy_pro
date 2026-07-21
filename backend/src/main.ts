import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Scaffold de la tarea C2 (ROADMAP_M0_M1.md) — levanta el servidor y
 * conecta a Postgres (ver `config/database.config.ts`), SIN lógica de
 * negocio todavía. Los endpoints reales (POST /auth/register, /login)
 * son la tarea C3, deliberadamente separada de esta.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Coincide con el prefijo `/v1` usado en todos los contratos de
  // docs/TECHNICAL_SPECIFICATION_M0_M1.md sección 1.2 — así el path real
  // (`/v1/auth/login`, etc.) queda consistente con lo ya documentado sin
  // tener que repetir el prefijo en cada controller.
  app.setGlobalPrefix('v1');

  // Rechaza cualquier request cuyo body no cumpla los DTOs decorados con
  // class-validator — sin esto, la validación de la spec (política de
  // contraseñas, formato de email, etc.) tendría que reimplementarse a
  // mano en cada controller.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta cualquier campo no declarado en el DTO
      forbidNonWhitelisted: true, // y rechaza la request si llega alguno
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`RidePro backend escuchando en http://localhost:${port}/v1`);
}

bootstrap();
