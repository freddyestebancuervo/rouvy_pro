import { resolveRedisUrl } from './redis.config';

describe('redis.config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('resolveRedisUrl', () => {
    it('devuelve REDIS_URL cuando está definida', () => {
      process.env.REDIS_URL = 'redis://redis:6379';

      expect(resolveRedisUrl()).toBe('redis://redis:6379');
    });

    it('lanza un error claro cuando REDIS_URL no está definida', () => {
      delete process.env.REDIS_URL;

      expect(() => resolveRedisUrl()).toThrow(/REDIS_URL no está definida/);
    });

    it('lanza un error claro cuando REDIS_URL está vacía', () => {
      process.env.REDIS_URL = '';

      expect(() => resolveRedisUrl()).toThrow(/REDIS_URL no está definida/);
    });

    it('no aplica ninguna corrección automática — devuelve el valor tal cual', () => {
      process.env.REDIS_URL = 'redis://user:pass@redis-host:6380/2';

      expect(resolveRedisUrl()).toBe('redis://user:pass@redis-host:6380/2');
    });
  });
});
