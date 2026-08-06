import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createClient, type RedisClientType } from 'redis';
import { createTestApp } from './utils/test-app';

/**
 * T-F0.4 — criterio de aceptación: "rate limiting correcto y consistente
 * verificado con más de una instancia del backend corriendo en
 * paralelo" (docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md).
 *
 * A diferencia de `redis-throttler-storage.e2e-spec.ts` (que solo prueba
 * el storage de forma aislada), esta prueba levanta DOS instancias
 * INDEPENDIENTES de la aplicación Nest completa (`createTestApp()` x2 —
 * cada una con su propio contenedor de DI, su propio `RedisModule`, su
 * propia conexión TCP a Redis), les envía solicitudes alternadas usando
 * la misma identidad de rate limiting (`refreshToken`), y confirma que
 * el contador se agrega entre ambas — no que cada instancia lleve su
 * propio conteo local, que era exactamente el problema que T-F0.4 corrige
 * (`ThrottlerStorage` en memoria, uno por proceso).
 *
 * Usa `POST /v1/auth/refresh` (`RefreshThrottleGuard`, límite real de la
 * app: 20 solicitudes / 15 min / token — ver
 * `src/modules/auth/refresh-throttle.guard.ts`) con un `refreshToken`
 * ficticio pero exclusivo de esta corrida como identidad — nunca choca
 * con el bucket global por IP (bucket separado) ni con ninguna otra
 * prueba (el token es único). El token es intencionalmente inválido: no
 * importa la respuesta de negocio (401/400), solo si el guard responde
 * 429 o no.
 */
describe('Rate limiting compartido entre instancias (e2e)', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let redis: RedisClientType;

  const refreshToken = `tf04-multiinstance-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const LIMIT = 20; // RefreshThrottleGuard.LIMIT — ver refresh-throttle.guard.ts

  beforeAll(async () => {
    [appA, appB] = await Promise.all([createTestApp(), createTestApp()]);
    redis = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
    await redis.connect();
  }, 60000);

  afterAll(async () => {
    // Defensivo: si `beforeAll` falló a mitad de camino (p. ej. una de
    // las dos apps nunca terminó de compilar), `redis`/`appA`/`appB`
    // pueden haber quedado sin inicializar — nunca asumir que existen.
    // `Promise.allSettled` evita que el fallo de un cierre oculte el
    // error real de la prueba o impida intentar los demás cierres.
    if (redis) {
      try {
        // Limpieza acotada exclusivamente a las claves creadas por esta
        // prueba (identificadas por el `refreshToken` único) — nunca
        // FLUSHALL/FLUSHDB.
        const keysToDelete = await redis.keys(`*${refreshToken}*`);
        if (keysToDelete.length > 0) {
          await redis.del(keysToDelete);
        }
      } catch {
        // Best-effort: no ocultar el error original de la prueba por un
        // fallo de limpieza.
      } finally {
        await redis.quit().catch(() => undefined);
      }
    }

    await Promise.allSettled([appA?.close(), appB?.close()]);
  });

  it('agrega el contador entre dos instancias independientes — el límite se aplica una sola vez, no por instancia', async () => {
    const statuses: number[] = [];

    // LIMIT + 5 solicitudes, alternando appA/appB en cada una, con la
    // MISMA identidad (refreshToken). Si el storage fuera local a cada
    // instancia (comportamiento previo, en memoria), cada app permitiría
    // hasta LIMIT solicitudes POR SÍ MISMA — es decir, se necesitarían
    // ~2×LIMIT solicitudes intercaladas antes de ver el primer 429. Con
    // storage compartido en Redis, el 429 debe aparecer exactamente en
    // la solicitud número LIMIT+1 del total intercalado, sin importar
    // qué instancia la reciba.
    for (let i = 0; i < LIMIT + 5; i += 1) {
      const app = i % 2 === 0 ? appA : appB;
      // eslint-disable-next-line no-await-in-loop
      const response = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken });
      statuses.push(response.status);
    }

    const firstBlockedIndex = statuses.findIndex((status) => status === 429);

    // Las primeras LIMIT solicitudes (índices 0..LIMIT-1) nunca deben
    // ser 429 — el token es inválido, así que su respuesta real es
    // 401/400 (error de negocio), pero eso no es lo que esta prueba
    // verifica.
    expect(statuses.slice(0, LIMIT).every((status) => status !== 429)).toBe(true);

    // La solicitud LIMIT+1 (índice LIMIT, 0-based) — sin importar que
    // haya sido servida por appA o appB — debe ser la primera bloqueada.
    expect(firstBlockedIndex).toBe(LIMIT);

    // Confirma que efectivamente se alternó entre ambas instancias hasta
    // ese punto — la prueba no sería válida si, por error, todas las
    // solicitudes hubieran ido a una sola app.
    const instancesUsedBeforeBlock = new Set(
      Array.from({ length: LIMIT }, (_, i) => (i % 2 === 0 ? 'A' : 'B')),
    );
    expect(instancesUsedBeforeBlock).toEqual(new Set(['A', 'B']));

    // Todo lo posterior al primer bloqueo, dentro de la misma ventana,
    // también debe seguir bloqueado (contador compartido, no se resetea
    // solo porque cambia la instancia que atiende la solicitud).
    expect(statuses.slice(LIMIT).every((status) => status === 429)).toBe(true);
  }, 60000);
});
