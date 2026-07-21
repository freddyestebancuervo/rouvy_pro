-- 0001_init.sql
-- Ver docs/TECHNICAL_SPECIFICATION_M0_M1.md sección 2.2 para el
-- diagrama ER completo y la justificación de cada restricción.
-- Aplicar con: npm run migrate:up (node-pg-migrate) o psql -f directo
-- en un entorno de desarrollo.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- para gen_random_uuid()

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255),         -- NULL si el usuario solo usa login social
    display_name    VARCHAR(100) NOT NULL DEFAULT '',
    photo_url       VARCHAR(500),
    ftp             SMALLINT CHECK (ftp IS NULL OR ftp BETWEEN 0 AND 1000),
    weight_kg       NUMERIC(5,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 300),
    premium         BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    auth_provider   VARCHAR(20) NOT NULL DEFAULT 'password'
                    CHECK (auth_provider IN ('password', 'google', 'apple')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,          -- soft delete (ver spec sección 5.6, derecho al olvido)
    CONSTRAINT users_email_unique UNIQUE (email)
);
CREATE INDEX idx_users_email_lower ON users (LOWER(email));
CREATE INDEX idx_users_premium_active ON users (premium) WHERE deleted_at IS NULL AND premium = TRUE;

CREATE TABLE roles (
    id      SMALLINT PRIMARY KEY,
    name    VARCHAR(20) NOT NULL UNIQUE
);
INSERT INTO roles (id, name) VALUES (1, 'user'), (2, 'premium'), (3, 'coach'), (4, 'admin');

CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     SMALLINT NOT NULL REFERENCES roles(id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash              VARCHAR(64) NOT NULL,
    expires_at              TIMESTAMPTZ NOT NULL,
    revoked_at              TIMESTAMPTZ,
    replaced_by_token_hash  VARCHAR(64),
    device_info             VARCHAR(255),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT refresh_tokens_hash_unique UNIQUE (token_hash)
);
CREATE INDEX idx_refresh_tokens_user_active ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE ride_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL CHECK (end_time > start_time),
    distance_meters     NUMERIC(10,2) NOT NULL DEFAULT 0,
    calories_kcal       NUMERIC(8,2) NOT NULL DEFAULT 0,
    last_power_watts    SMALLINT,
    last_cadence_rpm    SMALLINT,
    last_heart_rate_bpm SMALLINT,
    device_count        SMALLINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_sessions_user_start ON ride_sessions (user_id, start_time DESC);

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(50) NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at DESC);
