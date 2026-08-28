'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarize,
  validateMigrationEnvironment,
  validateRuntimeEnvironment,
} = require('./production-contract');

const runtimeEnv = () => ({
  NODE_ENV: 'production',
  BACKEND_ENVIRONMENT: 'production',
  DATABASE_URL: 'postgres://runtime.example.invalid/db',
  REDIS_URL: 'redis://cache.example.invalid',
  JWT_PRIVATE_KEY_PATH: '/secrets/private',
  JWT_PUBLIC_KEY_PATH: '/secrets/public',
  FIREBASE_PROJECT_ID: 'example-project',
  CORS_ALLOWED_ORIGINS: 'https://app.example.invalid',
});

test('runtime contract accepts the complete provider-neutral contract', () => {
  assert.equal(validateRuntimeEnvironment(runtimeEnv()).ok, true);
});

test('runtime contract rejects migration credentials', () => {
  const result = validateRuntimeEnvironment({
    ...runtimeEnv(),
    MIGRATION_DATABASE_URL: 'postgres://migration.example.invalid/db',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /must not be injected/);
});

test('migration contract requires its own URL', () => {
  assert.equal(validateMigrationEnvironment({}).ok, false);
  assert.equal(
    validateMigrationEnvironment({
      MIGRATION_DATABASE_URL: 'postgres://migration.example.invalid/db',
    }).ok,
    true,
  );
});

test('migration contract rejects the runtime URL variable', () => {
  const result = validateMigrationEnvironment({
    DATABASE_URL: 'postgres://runtime.example.invalid/db',
    MIGRATION_DATABASE_URL: 'postgres://migration.example.invalid/db',
  });
  assert.equal(result.ok, false);
});

test('sanitized summary never includes environment values', () => {
  const secret = 'do-not-report-this-value';
  const serialized = JSON.stringify(
    summarize(validateRuntimeEnvironment({ ...runtimeEnv(), DATABASE_URL: secret })),
  );
  assert.equal(serialized.includes(secret), false);
});
