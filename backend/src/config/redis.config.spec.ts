import { resolveRedisUrl, resolveThrottlerStrategy } from './redis.config';

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

  // T-F0.2 Puerta F — decisión BACKEND_ENVIRONMENT (ver docblock de
  // resolveThrottlerStrategy en redis.config.ts). No usa passwords reales
  // en ningún caso — solo strings ficticios para probar que REDIS_URL se
  // conserva sin alteración cuando está presente (caso 8).
  describe('resolveThrottlerStrategy', () => {
    it('caso 1: BACKEND_ENVIRONMENT=development + REDIS_URL presente -> redis', () => {
      process.env.BACKEND_ENVIRONMENT = 'development';
      process.env.REDIS_URL = 'redis://redis:6379';

      expect(resolveThrottlerStrategy()).toBe('redis');
    });

    it('caso 2: BACKEND_ENVIRONMENT=development + REDIS_URL ausente -> memory', () => {
      process.env.BACKEND_ENVIRONMENT = 'development';
      delete process.env.REDIS_URL;

      expect(resolveThrottlerStrategy()).toBe('memory');
    });

    it('caso 3: BACKEND_ENVIRONMENT=development + REDIS_URL vacía -> memory', () => {
      process.env.BACKEND_ENVIRONMENT = 'development';
      process.env.REDIS_URL = '';

      expect(resolveThrottlerStrategy()).toBe('memory');
    });

    it('caso 4: BACKEND_ENVIRONMENT=staging + REDIS_URL ausente -> FAIL FAST', () => {
      process.env.BACKEND_ENVIRONMENT = 'staging';
      delete process.env.REDIS_URL;

      expect(() => resolveThrottlerStrategy()).toThrow(/REDIS_URL no está definida/);
    });

    it('caso 5: BACKEND_ENVIRONMENT=production + REDIS_URL ausente -> FAIL FAST', () => {
      process.env.BACKEND_ENVIRONMENT = 'production';
      delete process.env.REDIS_URL;

      expect(() => resolveThrottlerStrategy()).toThrow(/REDIS_URL no está definida/);
    });

    it('caso 6: BACKEND_ENVIRONMENT ausente + REDIS_URL ausente -> FAIL FAST (nunca asume Development)', () => {
      delete process.env.BACKEND_ENVIRONMENT;
      delete process.env.REDIS_URL;

      expect(() => resolveThrottlerStrategy()).toThrow(/REDIS_URL no está definida/);
    });

    it('caso 7: BACKEND_ENVIRONMENT=valor-desconocido + REDIS_URL ausente -> FAIL FAST', () => {
      process.env.BACKEND_ENVIRONMENT = 'valor-desconocido';
      delete process.env.REDIS_URL;

      expect(() => resolveThrottlerStrategy()).toThrow(/REDIS_URL no está definida/);
    });

    it('caso 8: REDIS_URL válida se conserva sin alteración automática, incluso fuera de Development', () => {
      process.env.BACKEND_ENVIRONMENT = 'production';
      process.env.REDIS_URL = 'redis://redis-host:6380/2';

      expect(resolveThrottlerStrategy()).toBe('redis');
      expect(resolveRedisUrl()).toBe('redis://redis-host:6380/2');
    });

    it('REDIS_URL presente tiene prioridad sobre BACKEND_ENVIRONMENT, sin importar su valor', () => {
      process.env.BACKEND_ENVIRONMENT = 'valor-desconocido';
      process.env.REDIS_URL = 'redis://redis:6379';

      expect(resolveThrottlerStrategy()).toBe('redis');
    });
  });
});
