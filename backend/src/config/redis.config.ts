import type { DynamicModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisModule, RedisToken } from '@nestjs-redis/client';
import { RedisThrottlerStorage } from '@nestjs-redis/throttler-storage';
import type { RedisClientType } from 'redis';

/**
 * T-F0.4 (docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md) — única fuente
 * de la URL de Redis usada por el `ThrottlerStorage` distribuido (ver
 * `buildThrottlerModule` más abajo). Mismo criterio que
 * `createDatabasePool` (`database.config.ts`) y `FirebaseAdminModule`:
 * falla rápido al arrancar si falta, en vez de dejar que
 * `RedisModule`/`redis` fallen más tarde con un error menos claro.
 */
export function resolveRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL no está definida — copiar .env.example a .env y configurarla antes de arrancar.',
    );
  }
  return url;
}

export const THROTTLE_TTL_MS = 60000;
export const THROTTLE_LIMIT = 100;

export type ThrottlerStrategy = 'redis' | 'memory';

const DEVELOPMENT_MEMORY_FALLBACK_ENVIRONMENT = 'development';

/**
 * T-F0.2 Puerta F (docs/audits/AUDITORIA_FINAL/15_PLAN_PARTE_B_SEPARACION_ENTORNOS_FIREBASE.md
 * sección 12: el criterio de Puerta F no exige Redis administrado, solo
 * que el backend arranque correctamente) — Development puede usar el
 * fallback en memoria como optimización de costo para un entorno de baja
 * concurrencia. Antes del despliegue real se configurará un máximo de
 * servicio de Cloud Run de 1 como guard operativo; ese máximo reduce
 * fuertemente la posibilidad de múltiples instancias, pero no constituye
 * una garantía matemática de consistencia distribuida (Cloud Run puede
 * superar brevemente un máximo configurado). Por lo tanto, el fallback en
 * memoria NO sustituye Redis cuando se requiere escalado horizontal o
 * consistencia distribuida fuerte. Staging y Production continúan
 * requiriendo `REDIS_URL` — fallan cerrado, nunca se degradan a memoria
 * en silencio.
 *
 * `BACKEND_ENVIRONMENT` es una variable propia, deliberadamente distinta
 * de `NODE_ENV` (la imagen Docker final fija `NODE_ENV=production`
 * incluso cuando se despliega en el entorno GCP Development — no sirve
 * como selector) y de `FIREBASE_PROJECT_ID` (no acoplar la
 * infraestructura del throttler a Firebase).
 */
export function resolveThrottlerStrategy(): ThrottlerStrategy {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && redisUrl.trim() !== '') {
    return 'redis';
  }

  const backendEnvironment = process.env.BACKEND_ENVIRONMENT;
  if (backendEnvironment === DEVELOPMENT_MEMORY_FALLBACK_ENVIRONMENT) {
    return 'memory';
  }

  // Falla cerrado: sin REDIS_URL, cualquier BACKEND_ENVIRONMENT distinto
  // de 'development' — incluido ausente o desconocido — aborta el
  // arranque. Nunca se asume Development por defecto.
  throw new Error(
    `REDIS_URL no está definida y BACKEND_ENVIRONMENT=${JSON.stringify(backendEnvironment ?? null)} no permite el fallback en memoria (solo 'development' lo permite) — copiar .env.example a .env y configurar REDIS_URL, o BACKEND_ENVIRONMENT=development si es intencional.`,
  );
}

/**
 * Construye el módulo de throttling según `resolveThrottlerStrategy()`.
 * En estrategia `memory` NO se toca `RedisModule` en absoluto — ni se
 * crea cliente, ni se intenta conectar, ni se exige `REDIS_URL` — usa el
 * storage en memoria por defecto de `@nestjs/throttler`. En estrategia
 * `redis` conserva exactamente el comportamiento distribuido anterior a
 * esta tarea (`RedisModule`, `RedisToken`, `RedisThrottlerStorage`).
 */
export function buildThrottlerModule(): DynamicModule {
  const strategy = resolveThrottlerStrategy();

  if (strategy === 'memory') {
    return ThrottlerModule.forRoot([{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }]);
  }

  return ThrottlerModule.forRootAsync({
    imports: [RedisModule.forRoot({ options: { url: resolveRedisUrl() } })],
    inject: [RedisToken()],
    useFactory: (redis: RedisClientType) => ({
      throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
      storage: new RedisThrottlerStorage(redis),
    }),
  });
}
