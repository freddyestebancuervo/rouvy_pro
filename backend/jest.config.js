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
  // `firebase-admin` (Fase 3) trae `jwks-rsa` → `jose`, publicado como
  // ESM puro (`export`/`import` sin transpilar) — Jest ignora
  // `node_modules` por defecto, así que sin esta excepción explícita
  // falla al parsearlo. Solo se excluye `jose` de la ignora, todo lo
  // demás en `node_modules` sigue sin transformarse (comportamiento
  // estándar, sin este hallazgo no haría falta tocarlo).
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
};
