-- 0004_workouts.sql
-- Bloque D, tarea D2 — ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md
-- sección 3 para el diseño completo.
--
-- Entrenamientos estructurados (calentamiento + series con objetivo de
-- potencia/FC + enfriamiento). `owner_id` nullable = catálogo RidePro
-- (creado/editado solo por un admin, fuera de alcance de este bloque —
-- se carga por INSERT manual, mismo mecanismo que `roles` en
-- 0001_init.sql). Sin dependencias de otras tablas de Bloque D.

CREATE TABLE workouts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                    UUID REFERENCES users(id) ON DELETE CASCADE,
    name                        VARCHAR(150) NOT NULL,
    description                 TEXT,
    sport                       VARCHAR(20) NOT NULL DEFAULT 'cycling'
                                CHECK (sport IN ('cycling')),
    estimated_duration_seconds  INT NOT NULL CHECK (estimated_duration_seconds > 0),
    target_type                 VARCHAR(20) NOT NULL DEFAULT 'power'
                                CHECK (target_type IN ('power', 'heart_rate', 'none')),
    is_public                   BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- `position` la asigna el backend a partir del orden del array recibido
-- (0..N-1) — nunca un valor enviado por el cliente, así que la unicidad
-- de acá es una invariante estructural garantizada por el propio código
-- de inserción, no una validación reactiva contra input arbitrario.
CREATE TABLE workout_intervals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id          UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    position            SMALLINT NOT NULL,
    duration_seconds    INT NOT NULL CHECK (duration_seconds > 0),
    target_low          NUMERIC(6,2),
    target_high         NUMERIC(6,2),
    label               VARCHAR(50),
    CONSTRAINT workout_intervals_position_unique UNIQUE (workout_id, position)
);

CREATE INDEX idx_workouts_owner ON workouts (owner_id) WHERE archived_at IS NULL;
CREATE INDEX idx_workout_intervals_workout ON workout_intervals (workout_id, position);
