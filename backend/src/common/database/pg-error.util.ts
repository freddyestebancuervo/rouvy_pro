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
