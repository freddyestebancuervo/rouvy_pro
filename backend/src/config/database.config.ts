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
    // Límites conservadores para desarrollo local; en producción, ajustar
    // según el tamaño real del pool de conexiones de Postgres disponible.
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  return new Pool(config);
}
