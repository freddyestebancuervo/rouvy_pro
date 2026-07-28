-- Up Migration
-- 0005_users_firebase_uid.sql
-- Fase 2 del puente Firebase Auth → NestJS → PostgreSQL (documento de
-- diseño, Fase 1 de esta misma sesión). Identidad estable de Firebase por
-- usuario — nullable a propósito: las filas existentes (incluida la
-- cuenta QA compartida) no tienen Firebase UID todavía y no se tocan por
-- esta migración. Índice único PARCIAL: permite múltiples NULL, exige
-- unicidad solo entre los valores no nulos — mismo patrón ya usado por
-- `equipment_user_ble_address_unique` en 0003_equipment.sql.
ALTER TABLE users
ADD COLUMN firebase_uid VARCHAR(128);

CREATE UNIQUE INDEX users_firebase_uid_unique
ON users (firebase_uid)
WHERE firebase_uid IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS users_firebase_uid_unique;

ALTER TABLE users
DROP COLUMN IF EXISTS firebase_uid;
