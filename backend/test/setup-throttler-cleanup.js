const { createClient } = require('redis');

const EXPECTED_NODE_ENV = 'test';
const EXPECTED_REDIS_URL = 'redis://redis:6379/15';

let redis;

beforeAll(async () => {
  if (process.env.NODE_ENV !== EXPECTED_NODE_ENV) {
    throw new Error(
      `La limpieza de Redis solo puede ejecutarse con NODE_ENV=${EXPECTED_NODE_ENV}.`,
    );
  }

  if (process.env.REDIS_URL !== EXPECTED_REDIS_URL) {
    throw new Error(
      `REDIS_URL no corresponde a la base e2e reservada: "${process.env.REDIS_URL}" ` +
        `(se requiere exactamente "${EXPECTED_REDIS_URL}").`,
    );
  }

  redis = createClient({ url: EXPECTED_REDIS_URL });
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
