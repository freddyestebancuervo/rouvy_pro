import type { INestApplication } from '@nestjs/common';

/**
 * T-F0.2 Puerta F / KORIXA-Z1-Z2-FINOPS-POLICY-AND-STAGING-MEMORY-THROTTLER
 * — decisión BACKEND_ENVIRONMENT (ver docblock de
 * `resolveThrottlerStrategy` en `src/config/redis.config.ts`,
 * `MEMORY_FALLBACK_ENVIRONMENTS`).
 *
 * A diferencia de `redis.config.spec.ts` (que solo prueba la función de
 * decisión de forma aislada), esta suite demuestra que `AppModule`
 * REALMENTE puede compilarse/inicializarse end-to-end. Estado actual,
 * probado a nivel de bootstrap completo, no solo de la función que decide
 * la estrategia:
 *   - Development y Staging arrancan con throttling en memoria cuando
 *     `REDIS_URL` está ausente (`MEMORY_FALLBACK_ENVIRONMENTS`).
 *   - Production, y cualquier entorno ausente/desconocido, siguen
 *     fallando cerrado de verdad al arrancar — nunca se degradan a
 *     memoria en silencio.
 *
 * `AppModule` construye su `imports` (incluido `buildThrottlerModule()`)
 * al evaluarse el decorador `@Module`, es decir, en el momento en que el
 * módulo se importa — por eso cada caso usa `jest.isolateModulesAsync()`
 * con `require()` DENTRO del callback (nunca `import` de nivel de
 * archivo) para forzar una reevaluación fresca de TODO el grafo de
 * módulos (incluido `@nestjs/testing` y `@nestjs/core`) contra el
 * `REDIS_URL`/`BACKEND_ENVIRONMENT` de ESE caso.
 *
 * IMPORTANTE: `Test` (de `@nestjs/testing`) se obtiene con `require()`
 * DENTRO del mismo callback de `isolateModulesAsync`, nunca con un
 * `import` estático de nivel de archivo — un primer intento que
 * mezclaba un `Test` importado fuera del sandbox aislado con un
 * `AppModule` recargado dentro de él producía un error confuso de Nest
 * ("Reflector no disponible en el contexto de AppModule"), porque
 * terminaban existiendo dos instancias de clase distintas de
 * `@nestjs/core` (una para cada lado) — confirmado empíricamente: con
 * `Test` y `AppModule` requeridos juntos dentro del mismo
 * `isolateModulesAsync`, los 4 casos pasan.
 *
 * DATABASE_URL/JWT_*_PATH/FIREBASE_PROJECT_ID NO se tocan — se dejan
 * exactamente como los provee el entorno e2e (docker-compose/CI), igual
 * que en `rate-limit-multi-instance.e2e-spec.ts`. Ningún caso de esta
 * suite requiere Redis real: los casos Development/Staging nunca lo
 * usan (fallback en memoria), y los casos Production/entorno-ausente
 * fallan antes de intentar conectarse.
 */
describe('BACKEND_ENVIRONMENT throttler fallback (e2e)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('Development sin REDIS_URL arranca con throttling en memoria (DEVELOPMENT_MEMORY_BOOT)', async () => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    process.env.BACKEND_ENVIRONMENT = 'development';

    let app: INestApplication | undefined;
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Test } = require('@nestjs/testing');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AppModule } = require('../src/app.module');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const freshApp: INestApplication = moduleRef.createNestApplication();
      await freshApp.init();
      app = freshApp;
    });

    await app?.close();
  }, 30000);

  it('Staging sin REDIS_URL arranca con throttling en memoria (STAGING_MEMORY_BOOT)', async () => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    process.env.BACKEND_ENVIRONMENT = 'staging';

    let app: INestApplication | undefined;
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Test } = require('@nestjs/testing');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AppModule } = require('../src/app.module');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const freshApp: INestApplication = moduleRef.createNestApplication();
      await freshApp.init();
      app = freshApp;
    });

    await app?.close();
  }, 30000);

  it('Production sin REDIS_URL falla cerrado al arrancar (PRODUCTION_NO_REDIS_FAIL_FAST)', async () => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    process.env.BACKEND_ENVIRONMENT = 'production';

    await expect(
      jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Test } = require('@nestjs/testing');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AppModule } = require('../src/app.module');
        await Test.createTestingModule({ imports: [AppModule] }).compile();
      }),
    ).rejects.toThrow(/REDIS_URL no está definida/);
  }, 30000);

  it('BACKEND_ENVIRONMENT ausente sin REDIS_URL falla cerrado (nunca asume Development)', async () => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.BACKEND_ENVIRONMENT;

    await expect(
      jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Test } = require('@nestjs/testing');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AppModule } = require('../src/app.module');
        await Test.createTestingModule({ imports: [AppModule] }).compile();
      }),
    ).rejects.toThrow(/REDIS_URL no está definida/);
  }, 30000);
});
