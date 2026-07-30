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
/**
 * `overrideProviders` (Fase 3, `/auth/firebase/exchange`): permite
 * reemplazar un provider real por un mock ANTES de compilar el módulo —
 * único mecanismo para no depender de Firebase real en la suite e2e
 * (mockear `FirebaseTokenVerifierService`) manteniendo todo lo demás
 * (Postgres, `TokenService`, rate limiting) real. Vacío por defecto: no
 * cambia el comportamiento de ningún test existente.
 */
export async function createTestApp(
  overrideProviders: Array<{ provide: unknown; useValue: unknown }> = [],
): Promise<INestApplication> {
  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });
  for (const { provide, useValue } of overrideProviders) {
    moduleBuilder = moduleBuilder.overrideProvider(provide).useValue(useValue);
  }
  const moduleFixture: TestingModule = await moduleBuilder.compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}
