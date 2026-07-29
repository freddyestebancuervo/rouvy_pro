/**
 * Extracción segura de metadata de un error de `pg` — el driver no tipa
 * sus excepciones (son objetos planos con `code`/`constraint`/etc. según
 * el error de Postgres subyacente), así que cualquier consumidor termina
 * necesitando el mismo cast defensivo. Compartido entre `AuthService`
 * (unicidad de email, Bloque C) y `EquipmentService` (default por
 * categoría / dirección BLE única, Bloque D) — hallazgo de la revisión de
 * limpieza post-D1: ambos reimplementaban la misma extracción por
 * separado.
 */

/** Código SQLSTATE de Postgres para `unique_violation`. */
export const PG_UNIQUE_VIOLATION = '23505';

export function pgErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Nombre de la constraint/índice que disparó el error — solo presente en
 * violaciones de constraint (`unique_violation`, `foreign_key_violation`,
 * ...), no en cualquier error de Postgres. */
export function pgConstraintName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : null;
}

export function isPgUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === PG_UNIQUE_VIOLATION;
}

/** Mensaje exacto que `pg-pool` usa para el timeout de adquisición de una
 * conexión (`node_modules/pg-pool/index.js`, cuando `connectionTimeoutMillis`
 * se cumple esperando un slot libre) — hallazgo de Fase 4.1/4.2. */
const POOL_CONNECTION_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

/**
 * Distingue el timeout de adquisición del pool (`pg-pool`, generado en el
 * cliente, ANTES de tocar Postgres) de cualquier error real de Postgres —
 * estos últimos SIEMPRE traen `.code` (SQLSTATE: `23505`, `42601`, etc.),
 * este nunca lo trae. Exige coincidencia exacta del mensaje Y ausencia total
 * de `.code` a propósito: ninguna violación de integridad, error de
 * programación ni fallo de migración cumple ambas condiciones a la vez, así
 * que no hay forma de que esos terminen traducidos a `503` por error.
 */
export function isPoolConnectionTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    !('code' in error) &&
    error.message === POOL_CONNECTION_TIMEOUT_MESSAGE
  );
}
