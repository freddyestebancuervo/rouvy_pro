'use strict';

const RUNTIME_REQUIRED = Object.freeze([
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_PRIVATE_KEY_PATH',
  'JWT_PUBLIC_KEY_PATH',
  'FIREBASE_PROJECT_ID',
  'CORS_ALLOWED_ORIGINS',
]);

function present(env, name) {
  return typeof env[name] === 'string' && env[name].trim().length > 0;
}

function validateRuntimeEnvironment(env) {
  const missing = RUNTIME_REQUIRED.filter((name) => !present(env, name));
  const errors = [];

  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  if (env.BACKEND_ENVIRONMENT !== 'production') {
    errors.push('BACKEND_ENVIRONMENT must be production');
  }
  if (present(env, 'MIGRATION_DATABASE_URL')) {
    errors.push('MIGRATION_DATABASE_URL must not be injected into the runtime');
  }

  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

function validateMigrationEnvironment(env) {
  const missing = present(env, 'MIGRATION_DATABASE_URL') ? [] : ['MIGRATION_DATABASE_URL'];
  const errors = [];

  if (present(env, 'DATABASE_URL')) {
    errors.push('DATABASE_URL must not be supplied to the migration process');
  }

  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

function summarize(result) {
  return {
    valid: result.ok,
    missing_variable_names: result.missing,
    error_messages: result.errors,
    secret_values_exposed: false,
  };
}

module.exports = {
  RUNTIME_REQUIRED,
  summarize,
  validateMigrationEnvironment,
  validateRuntimeEnvironment,
};
