-- 0002_users_email_case_insensitive_unique.sql
-- Hallazgo de la revisión de arquitectura de cierre de fase (Bloque C):
-- `UsersRepository.findByEmail` compara con `LOWER(email)` a nivel de
-- aplicación (ver su docblock), pero `idx_users_email_lower` en
-- 0001_init.sql es un índice normal, no UNIQUE — la única constraint
-- real de unicidad en la base es `UNIQUE (email)`, sensible a
-- mayúsculas/minúsculas. Dos registros concurrentes con el mismo email
-- en distinto case ("Rider@x.com" / "rider@x.com") pasan ambos el
-- chequeo de aplicación (ninguno existe todavía en el instante de la
-- lectura) y terminan creando dos cuentas duplicadas — exactamente el
-- mismo tipo de condición de carrera que ya se resolvió con locking para
-- la rotación de refresh tokens (C4), pero sin cerrar acá.
--
-- Se reemplaza el índice no-único por uno único: ahora la propia base de
-- datos rechaza el segundo INSERT con `23505 unique_violation` sin
-- importar el timing — `AuthService.register` traduce ese error al mismo
-- `409 EMAIL_ALREADY_EXISTS` que ya devuelve el chequeo de aplicación
-- (que se mantiene, sigue siendo el camino rápido para el caso común, no
-- concurrente).

DROP INDEX IF EXISTS idx_users_email_lower;
CREATE UNIQUE INDEX users_email_lower_unique ON users (LOWER(email));
