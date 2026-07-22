/**
 * Config de tests unitarios (`npm run test`) — separada de
 * `test/jest-e2e.json` (que corre contra Postgres real). Convención Nest
 * estándar: specs colocados junto al código (`src/**\/*.spec.ts`).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.spec.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
