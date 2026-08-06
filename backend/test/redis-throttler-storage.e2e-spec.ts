import { createClient, type RedisClientType } from 'redis';
import { RedisThrottlerStorage } from '@nestjs-redis/throttler-storage';

/**
 * T-F0.4 — prueba de integración de `RedisThrottlerStorage` contra un
 * Redis REAL (no mockeado), aislada de la app Nest completa. Verifica
 * que el storage por sí mismo cuenta, bloquea y expira correctamente —
 * la prueba de aplicación con dos instancias reales
 * (`rate-limit-multi-instance.e2e-spec.ts`) es la que demuestra el
 * criterio de aceptación completo; esta solo confirma que la pieza de
 * Redis en la que se apoya esa prueba es correcta de forma aislada.
 *
 * Usa una clave y un `throttlerName` exclusivos de esta prueba (con
 * sufijo único por corrida) — al terminar, borra únicamente las claves
 * Redis que ella misma creó (nunca FLUSHALL/FLUSHDB).
 */
describe('RedisThrottlerStorage (integración con Redis real, e2e)', () => {
  let redis: RedisClientType;
  let storage: RedisThrottlerStorage;

  const uniqueSuffix = `tf04-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const throttlerName = uniqueSuffix;
  const key = uniqueSuffix;

  const TTL_MS = 5000;
  const LIMIT = 3;
  // Igual al default real que usa ThrottlerGuard cuando no se especifica
  // blockDuration (ver node_modules/@nestjs/throttler/dist/throttler.guard.js:
  // `blockDuration = ... || namedThrottler.blockDuration || ttl`) — con 0,
  // el bloqueo se resetea dentro de la misma llamada (blockExpiresAt =
  // now + 0, ya "expirado"), y esta prueba nunca vería isBlocked=true.
  const BLOCK_DURATION_MS = TTL_MS;

  beforeAll(async () => {
    redis = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
    await redis.connect();
    storage = new RedisThrottlerStorage(redis);
  });

  afterAll(async () => {
    // Limpieza acotada exclusivamente a las claves de esta prueba —
    // identificadas por el sufijo único, nunca FLUSHALL/FLUSHDB.
    const keysToDelete = await redis.keys(`*${uniqueSuffix}*`);
    if (keysToDelete.length > 0) {
      await redis.del(keysToDelete);
    }
    await redis.quit();
  });

  it('permite hasta el límite y bloquea la solicitud siguiente', async () => {
    const results = [];
    for (let i = 0; i < LIMIT; i += 1) {
      results.push(await storage.increment(key, TTL_MS, LIMIT, BLOCK_DURATION_MS, throttlerName));
    }

    for (const result of results) {
      expect(result.isBlocked).toBe(false);
    }

    const overLimit = await storage.increment(key, TTL_MS, LIMIT, BLOCK_DURATION_MS, throttlerName);
    expect(overLimit.isBlocked).toBe(true);
    expect(overLimit.totalHits).toBeGreaterThan(LIMIT);
  });

  it('reporta un totalHits creciente y consistente entre llamadas', async () => {
    const localKey = `${key}-counting`;
    const first = await storage.increment(localKey, TTL_MS, LIMIT, BLOCK_DURATION_MS, throttlerName);
    const second = await storage.increment(localKey, TTL_MS, LIMIT, BLOCK_DURATION_MS, throttlerName);

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.isBlocked).toBe(false);
  });

  it('expira la ventana después del ttl configurado', async () => {
    const localKey = `${key}-ttl`;
    const shortTtlMs = 500;
    const result = await storage.increment(localKey, shortTtlMs, 1, BLOCK_DURATION_MS, throttlerName);
    expect(result.isBlocked).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, shortTtlMs + 200));

    const afterExpiry = await storage.increment(localKey, shortTtlMs, 1, BLOCK_DURATION_MS, throttlerName);
    expect(afterExpiry.totalHits).toBe(1);
    expect(afterExpiry.isBlocked).toBe(false);
  });
});
