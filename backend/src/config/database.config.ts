import { readFileSync } from 'fs';
import { Pool, PoolConfig } from 'pg';

/**
 * Se usa `pg.Pool` directo, sin ORM (TypeORM/Prisma), deliberadamente en
 * este scaffold — la tarea C2 solo pide "que levante y conecte a
 * Postgres". Decidir el ORM (o seguir sin uno, con SQL explícito) es una
 * decisión de la tarea C3, cuando ya haya lógica de negocio real que
 * escribir contra el esquema de `migrations/0001_init.sql`.
 */

/**
 * KORIXA-MVP-SAFETY-01 — reemplaza el antiguo `ssl: { rejectUnauthorized:
 * false }` (deshabilitaba la verificación de identidad del servidor
 * incondicionalmente). Investigado contra el comportamiento REAL instalado
 * (`pg@8.22.0`, `pg-connection-string@2.14.0`, ver
 * `node_modules/pg-connection-string/index.js`):
 *
 *   - Si `DATABASE_URL` ya trae `sslmode=` (p. ej. Neon, que lo incluye
 *     por defecto), `pg` construye la config final con
 *     `Object.assign({}, config, parse(connectionString))` — el resultado
 *     del parseo de la connection string se aplica DESPUÉS de (y por lo
 *     tanto pisa a) lo que este archivo pase como `ssl`. En la versión
 *     instalada, `sslmode=require/prefer/verify-ca/verify-full` ya NO
 *     deshabilita la verificación (solo `sslmode=no-verify` lo hace) —
 *     así que un `DATABASE_URL` con `sslmode=require` ya queda validado
 *     con el certificate verification activo por el propio DSN, sin
 *     depender de este objeto `ssl` en absoluto.
 *   - Si `DATABASE_URL` NO trae `sslmode=` (p. ej. el DSN de socket Unix
 *     de Cloud SQL usado hoy en Development, o cualquier DSN TCP simple),
 *     el parseo no toca `ssl` y este objeto es el que efectivamente
 *     controla el transporte.
 *
 * Por eso: `DATABASE_SSL=true` activa `ssl: true` (verificación con el
 * store de CAs por defecto de Node/el runtime — NUNCA
 * `rejectUnauthorized: false`), y si el proveedor usa una CA propia no
 * incluida en ese store (p. ej. Cloud SQL sobre IP pública, cuyo
 * certificado firma `GOOGLE_MANAGED_INTERNAL_CA`), `DATABASE_SSL_CA_PATH`
 * permite apuntar a un archivo de CA montado en runtime — mismo patrón ya
 * usado para `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` (nunca el
 * contenido de la CA embebido directo en una env var). Sin CA propia,
 * `ssl: true` usa la verificación estándar del runtime — nunca se
 * deshabilita nada por default.
 */
function resolveSslConfig(): PoolConfig['ssl'] {
  if (process.env.DATABASE_SSL !== 'true') {
    return undefined;
  }

  const caPath = process.env.DATABASE_SSL_CA_PATH;
  if (!caPath) {
    return true;
  }

  return { ca: readFileSync(caPath, 'utf8') };
}

export function createDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida — copiar .env.example a .env y configurarla antes de arrancar.',
    );
  }

  const ssl = resolveSslConfig();

  const config: PoolConfig = {
    connectionString,
    // Límites conservadores para desarrollo local por defecto; ajustables
    // vía env var para producción, sin tocar código (mismos defaults que
    // ya se venían usando si no se configuran).
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5000),
    ...(ssl !== undefined ? { ssl } : {}),
  };

  return new Pool(config);
}
