const { createClient } = require('redis');

const EXPECTED_NODE_ENV = 'test';
// Base Redis 15, reservada exclusivamente para la suite e2e, en los dos
// hosts válidos donde esta suite corre hoy: "redis" (servicio de
// docker-compose.yml, servicio "backend-e2e") y "localhost" (contenedor
// de servicio de .github/workflows/ci.yml, job "Backend — migración +
// e2e (C2)", que publica el puerto 6379 en el runner). Cualquier otra
// URL sigue rechazada — fail-closed, no se limpia nada.
const ALLOWED_REDIS_URLS = new Set([
  'redis://redis:6379/15',
  'redis://localhost:6379/15',
]);

let redis;

beforeAll(async () => {
  if (process.env.NODE_ENV !== EXPECTED_NODE_ENV) {
    throw new Error(
      `La limpieza de Redis solo puede ejecutarse con NODE_ENV=${EXPECTED_NODE_ENV}.`,
    );
  }

  if (!ALLOWED_REDIS_URLS.has(process.env.REDIS_URL)) {
    throw new Error(
      `REDIS_URL no corresponde a la base e2e reservada: "${process.env.REDIS_URL}" ` +
        `(se requiere una de: ${[...ALLOWED_REDIS_URLS].join(', ')}).`,
    );
  }

  redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
});

beforeEach(async () => {
  await redis.flushDb();
});

afterAll(async () => {
  if (redis?.isOpen) {
    await redis.quit();
  }
});
