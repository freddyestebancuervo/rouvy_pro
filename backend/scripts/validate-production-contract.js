'use strict';

const {
  summarize,
  validateMigrationEnvironment,
  validateRuntimeEnvironment,
} = require('./production-contract');

const mode = process.argv[2];
const validators = {
  runtime: validateRuntimeEnvironment,
  migration: validateMigrationEnvironment,
};

if (!Object.hasOwn(validators, mode)) {
  console.error('Usage: node scripts/validate-production-contract.js <runtime|migration>');
  process.exit(2);
}

const result = validators[mode](process.env);
console.log(JSON.stringify({ mode, ...summarize(result) }));
process.exit(result.ok ? 0 : 1);
