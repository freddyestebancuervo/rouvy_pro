import { Pool, PoolConfig } from 'pg';

/**
 * Se usa `pg.Pool` directo, sin ORM (TypeORM/Prisma), deliberadamente en
 * este scaffold — la tarea C2 solo pide "que levante y conecte a
 * Postgres". Decidir el ORM (o seguir sin uno, con SQL explícito) es una
 * decisión de la tarea C3, cuando ya haya lógica de negocio real que
 * escribir contra el esquema de `migrations/0001_init.sql`.
 */
export function createDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida — copiar .env.example a .env y configurarla antes de arrancar.',
    );
  }

  const config: PoolConfig = {
    connectionString,
    // Límites conservadores para desarrollo local por defecto; ajustables
    // vía env var para producción, sin tocar código (mismos defaults que
    // ya se venían usando si no se configuran).
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5000),
    // Opt-in: la mayoría de los Postgres administrados (RDS, Cloud SQL,
    // etc.) exigen TLS. `rejectUnauthorized: false` porque estos
    // proveedores suelen usar certificados de una CA no incluida en el
    // store por defecto de Node — mismo patrón estándar que usa la
    // documentación de `pg` para este caso. Sin este flag, `DATABASE_URL`
    // solo (aunque incluya `?sslmode=require`) no siempre alcanza.
    ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
  };

  return new Pool(config);
}
