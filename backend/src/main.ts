import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { resolveCorsOptions } from './config/cors.config';

/**
 * Scaffold de la tarea C2 (ROADMAP_M0_M1.md) — levanta el servidor y
 * conecta a Postgres (ver `config/database.config.ts`), SIN lógica de
 * negocio todavía. Los endpoints reales (POST /auth/register, /login)
 * son la tarea C3, deliberadamente separada de esta.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Headers HTTP estándar de seguridad (X-Content-Type-Options,
  // X-Frame-Options, oculta X-Powered-By, etc.) — hallazgo de la revisión
  // de seguridad de cierre de fase (Bloque C): no había ninguna
  // protección a este nivel. `crossOriginResourcePolicy`/CSP por defecto
  // de helmet apuntan a apps que sirven HTML — esta es una API JSON pura
  // consumida por la app móvil, así que se desactivan las políticas
  // pensadas para navegador que no aplican y podrían interferir sin
  // aportar nada acá.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // `ApiConfig.backendBaseUrl` (cliente Flutter) apunta este backend
  // también desde Flutter WEB (`kIsWeb`), no solo desde la app móvil — a
  // diferencia de un cliente nativo, un navegador SÍ aplica CORS a esas
  // llamadas. Allowlist explícita vía `CORS_ALLOWED_ORIGINS`, con un
  // fallback de conveniencia solo-localhost fuera de producción — nunca
  // "cualquier origen". Ver el docblock de `resolveCorsOptions`.
  app.enableCors(resolveCorsOptions());

  // Solo confía en `X-Forwarded-For` (usado para `req.ip`, la base del
  // rate limiting por IP) si el operador confirma explícitamente que hay
  // un proxy/load balancer real por delante — confiar en él por defecto
  // permitiría a cualquier cliente falsificar su IP y saltarse el rate
  // limiting con un header falso.
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

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

  // Sobre de error único de la spec sección 1.2 — ver ApiExceptionFilter.
  app.useGlobalFilters(new ApiExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`RidePro backend escuchando en http://localhost:${port}/v1`);
}

bootstrap();
