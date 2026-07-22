-- 0003_equipment.sql
-- Bloque D, tarea D1 — ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md
-- sección 2 para el diseño completo y las alternativas descartadas.
--
-- Modelo único y polimórfico para todo el equipamiento del usuario
-- (bicicletas, rodillos/entrenadores inteligentes, sensores BLE) — nunca
-- una tabla por categoría. Incorporar una categoría nueva (zapatillas,
-- ruedas, un rodillo de otra marca) es SIEMPRE un INSERT en
-- `equipment_categories`, nunca un ALTER TABLE — mismo mecanismo que ya
-- usa este proyecto para `roles` (0001_init.sql).

-- Catálogo de categorías: tabla de referencia, no un CHECK hardcodeado,
-- para que agregar una categoría nueva no sea una migración estructural.
CREATE TABLE equipment_categories (
    code            VARCHAR(30) PRIMARY KEY,
    label_es        VARCHAR(50) NOT NULL,
    label_en        VARCHAR(50) NOT NULL,
    is_ble_capable  BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO equipment_categories (code, label_es, label_en, is_ble_capable) VALUES
    ('bike',                'Bicicleta',            'Bike',                FALSE),
    ('smart_trainer',       'Rodillo inteligente',  'Smart trainer',       TRUE),
    ('power_meter',         'Potenciómetro',        'Power meter',         TRUE),
    ('heart_rate_monitor',  'Pulsómetro',           'Heart rate monitor',  TRUE),
    ('cadence_sensor',      'Sensor de cadencia',   'Cadence sensor',      TRUE),
    ('speed_sensor',        'Sensor de velocidad',  'Speed sensor',        TRUE),
    ('speed_cadence_combo', 'Sensor combinado',     'Speed/cadence combo', TRUE),
    ('other',               'Otro',                 'Other',               FALSE);
-- Los 7 valores BLE-capaces reutilizan exactamente `SportDeviceType`
-- (cliente Flutter) en snake_case; `unknown` del cliente mapea a `other`
-- acá (mapeo documentado en `create-equipment.dto.ts`). `bike` y `other`
-- son propios del backend.

-- Núcleo polimórfico: común a CUALQUIER categoría, presente o futura.
-- Los campos de identidad Bluetooth (`ble_name`/`ble_address`) y de
-- estado del dispositivo (`battery_level`, `last_connected_at`,
-- `last_calibrated_at`) viven acá como columnas simples, no en una tabla
-- de emparejamiento aparte — esta tarea NO implementa lógica BLE
-- avanzada (pairing/auto-reconexión/multi-sensor por actividad), así que
-- una tabla `equipment_ble_link` separada sería una abstracción sin
-- consumidor real todavía (ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md,
-- nota de revisión de implementación en la sección 2).
CREATE TABLE equipment (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_code           VARCHAR(30) NOT NULL REFERENCES equipment_categories(code),
    parent_equipment_id     UUID REFERENCES equipment(id) ON DELETE SET NULL,

    name                    VARCHAR(100) NOT NULL,
    brand                   VARCHAR(100),
    model                   VARCHAR(100),
    serial_number           VARCHAR(100),
    firmware_version        VARCHAR(50),
    hardware_revision       VARCHAR(50),

    -- Identidad Bluetooth básica — el emparejamiento/conexión real sigue
    -- siendo 100% local en el cliente (spec M0/M1, sección 6.1); estos
    -- campos son solo el directorio, igual que el resto de la fila.
    ble_name                VARCHAR(100),
    ble_address             VARCHAR(64),

    -- Estado declarado por el usuario ("tengo esta bici pero no la uso
    -- esta temporada") — distinto de `archived_at` (soft delete real,
    -- oculta de todos los listados por defecto). Ambos coexisten porque
    -- responden a necesidades distintas: `status` es reversible y
    -- visible; `archived_at` es la baja lógica.
    status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive')),
    battery_level           SMALLINT CHECK (battery_level IS NULL OR battery_level BETWEEN 0 AND 100),
    last_connected_at       TIMESTAMPTZ,
    last_calibrated_at      TIMESTAMPTZ,

    -- Metadatos extensibles por categoría (peso/tipo de bici, resistencia
    -- máxima de un rodillo, lado de un potenciómetro, etc.) — variabilidad
    -- real y confirmada, no un cajón de sastre especulativo. Mismo
    -- precedente que ya usa este proyecto en `audit_log.metadata JSONB`
    -- (0001_init.sql). Validado en la capa de servicio, no acá.
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,

    total_distance_meters   NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_duration_seconds  BIGINT NOT NULL DEFAULT 0,
    is_default              BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT equipment_parent_not_self CHECK (parent_equipment_id IS DISTINCT FROM id)
);

-- Invariante "como máximo 1 equipo default POR CATEGORÍA y por usuario"
-- (una bici default Y un rodillo default coexisten sin conflicto)
-- garantizada por la propia base, no solo por la app.
CREATE UNIQUE INDEX equipment_one_default_per_user_category
    ON equipment (user_id, category_code) WHERE is_default AND archived_at IS NULL;

CREATE INDEX idx_equipment_user_active ON equipment (user_id, category_code) WHERE archived_at IS NULL;
CREATE INDEX idx_equipment_parent ON equipment (parent_equipment_id) WHERE parent_equipment_id IS NOT NULL;

-- "Un mismo sensor físico no se registra dos veces para el mismo
-- usuario" — garantizado por la base, no solo por la app (mismo
-- criterio que ya llevó a corregir la condición de carrera de email en
-- el cierre de Bloque C). Parcial: excluye archivados, para permitir
-- reusar una dirección BLE si el equipo anterior que la tenía ya se dio
-- de baja.
CREATE UNIQUE INDEX equipment_user_ble_address_unique
    ON equipment (user_id, ble_address) WHERE ble_address IS NOT NULL AND archived_at IS NULL;
