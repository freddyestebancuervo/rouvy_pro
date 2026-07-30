import { resolveCorsOptions } from './cors.config';

describe('cors.config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('resolveCorsOptions', () => {
    it('usa la allowlist explícita cuando CORS_ALLOWED_ORIGINS está definida', () => {
      process.env.CORS_ALLOWED_ORIGINS = 'https://app.ridepro.com, https://admin.ridepro.com ,,';

      expect(resolveCorsOptions()).toEqual({
        origin: ['https://app.ridepro.com', 'https://admin.ridepro.com'],
      });
    });

    it('la allowlist explícita gana incluso en producción', () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ALLOWED_ORIGINS = 'https://app.ridepro.com';

      expect(resolveCorsOptions()).toEqual({ origin: ['https://app.ridepro.com'] });
    });

    it('sin allowlist y fuera de producción, permite solo localhost/127.0.0.1 en cualquier puerto', () => {
      delete process.env.CORS_ALLOWED_ORIGINS;
      process.env.NODE_ENV = 'development';

      const { origin } = resolveCorsOptions();
      expect(origin).toBeInstanceOf(RegExp);
      const pattern = origin as RegExp;
      expect(pattern.test('http://localhost:5173')).toBe(true);
      expect(pattern.test('http://127.0.0.1:52341')).toBe(true);
      expect(pattern.test('https://localhost')).toBe(true);
      expect(pattern.test('https://evil.example.com')).toBe(false);
      expect(pattern.test('http://localhost.evil.com')).toBe(false);
    });

    it('sin allowlist y en producción, cierra CORS por completo (fail closed)', () => {
      delete process.env.CORS_ALLOWED_ORIGINS;
      process.env.NODE_ENV = 'production';

      expect(resolveCorsOptions()).toEqual({ origin: false });
    });

    it('una CORS_ALLOWED_ORIGINS vacía se trata como no definida', () => {
      process.env.CORS_ALLOWED_ORIGINS = '   ';
      process.env.NODE_ENV = 'production';

      expect(resolveCorsOptions()).toEqual({ origin: false });
    });
  });
});
