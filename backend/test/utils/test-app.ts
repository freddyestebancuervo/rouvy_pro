import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter';

/**
 * Bootstrap idéntico al de `main.ts` (prefijo `/v1`, `ValidationPipe`,
 * `ApiExceptionFilter`) para los tests e2e — extraído de
 * `auth.e2e-spec.ts`/`auth-refresh.e2e-spec.ts`/`users.e2e-spec.ts`, que
 * lo repetían línea por línea (hallazgo de la revisión de código
 * duplicado, cierre de fase Bloque C). Un cambio futuro en el bootstrap
 * real solo necesita reflejarse acá, no en cada archivo de test.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}
