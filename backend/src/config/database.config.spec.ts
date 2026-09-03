import { createDatabasePool } from './database.config';

/**
 * TASK21-PHASE21B (T-F1.3) — cobertura que faltaba para `database.config.ts`
 * (cero specs previos). Mismo criterio que `redis.config.spec.ts`: probar
 * el comportamiento real, nunca solo su presencia. El objetivo específico
 * de este archivo es demostrar que `createDatabasePool` es 100%
 * provider-neutral (nunca asume Cloud SQL, RDS, ni ningún otro proveedor
 * específico) y que `DATABASE_URL`/`MIGRATION_DATABASE_URL` son
 * identidades estructuralmente separadas — `createDatabasePool` (la
 * identidad runtime) nunca lee `MIGRATION_DATABASE_URL`.
 *
 * `pg.Pool` no abre ninguna conexión de red al construirse (es
 * perezoso — solo conecta en el primer `.query()`/`.connect()`), así que
 * estas pruebas son 100% locales, sin I/O real.
 */
describe('database.config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('createDatabasePool', () => {
    it('lanza un error claro cuando DATABASE_URL no está definida', () => {
      delete process.env.DATABASE_URL;

      expect(() => createDatabasePool()).toThrow(/DATABASE_URL no está definida/);
    });

    it('lanza un error claro cuando DATABASE_URL está vacía', () => {
      process.env.DATABASE_URL = '';

      expect(() => createDatabasePool()).toThrow(/DATABASE_URL no está definida/);
    });

    it('acepta cualquier DSN postgres:// genérico, sin asumir ningún proveedor específico (ni Cloud SQL, ni RDS, ni ningún host particular)', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@some-arbitrary-host.example:5432/ridepro_staging';

      const pool = createDatabasePool();

      expect(pool.options.connectionString).toBe('postgres://ridepro:secret@some-arbitrary-host.example:5432/ridepro_staging');
    });

    it('DATABASE_POOL_MAX por defecto es 10 cuando no se define', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@localhost:5432/ridepro_dev';
      delete process.env.DATABASE_POOL_MAX;

      const pool = createDatabasePool();

      expect(pool.options.max).toBe(10);
    });

    it('DATABASE_POOL_MAX es configurable vía env var, sin tocar código', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@localhost:5432/ridepro_dev';
      process.env.DATABASE_POOL_MAX = '25';

      const pool = createDatabasePool();

      expect(pool.options.max).toBe(25);
    });

    it('DATABASE_SSL ausente -> ssl NO se configura (conexión sin TLS, comportamiento histórico para desarrollo local)', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@localhost:5432/ridepro_dev';
      delete process.env.DATABASE_SSL;

      const pool = createDatabasePool();

      expect(pool.options.ssl).toBeUndefined();
    });

    it('DATABASE_SSL=true -> ssl se activa con rejectUnauthorized:false (patrón estándar para Postgres administrado — Cloud SQL, RDS, o cualquier otro)', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@managed-host.example:5432/ridepro_staging';
      process.env.DATABASE_SSL = 'true';

      const pool = createDatabasePool();

      expect(pool.options.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('DATABASE_SSL con cualquier valor distinto de la string exacta "true" NO activa TLS (nunca truthy laxo)', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@localhost:5432/ridepro_dev';
      process.env.DATABASE_SSL = 'yes';

      const pool = createDatabasePool();

      expect(pool.options.ssl).toBeUndefined();
    });

    it('nunca lee MIGRATION_DATABASE_URL — la identidad runtime y la identidad de migración están estructuralmente separadas, nunca se cruzan', () => {
      process.env.DATABASE_URL = 'postgres://runtime_role:secret@host.example:5432/db';
      process.env.MIGRATION_DATABASE_URL = 'postgres://migration_role:other-secret@host.example:5432/db';

      const pool = createDatabasePool();

      expect(pool.options.connectionString).toBe('postgres://runtime_role:secret@host.example:5432/db');
      expect(pool.options.connectionString).not.toContain('migration_role');
    });

    it('DATABASE_IDLE_TIMEOUT_MS / DATABASE_CONNECTION_TIMEOUT_MS son configurables, con los mismos defaults históricos', () => {
      process.env.DATABASE_URL = 'postgres://ridepro:secret@localhost:5432/ridepro_dev';
      delete process.env.DATABASE_IDLE_TIMEOUT_MS;
      delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;

      const pool = createDatabasePool();

      expect(pool.options.idleTimeoutMillis).toBe(30000);
      expect(pool.options.connectionTimeoutMillis).toBe(5000);
    });
  });
});
