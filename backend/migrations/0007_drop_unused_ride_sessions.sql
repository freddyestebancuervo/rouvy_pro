-- Up Migration
-- T-F2.4 — remove the unused legacy ride_sessions table.
--
-- Repository-wide searches performed before this migration found no
-- application/runtime references to `ride_sessions` or `RideSession`.
-- Deliberately no CASCADE: if an unexpected dependent object exists in a
-- real database, the migration must fail closed instead of silently
-- deleting that dependency.
DROP TABLE IF EXISTS ride_sessions;

-- Down Migration
-- Restore the exact schema originally created by 0001_init.sql.
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
CREATE INDEX idx_ride_sessions_user_start
ON ride_sessions (user_id, start_time DESC);
