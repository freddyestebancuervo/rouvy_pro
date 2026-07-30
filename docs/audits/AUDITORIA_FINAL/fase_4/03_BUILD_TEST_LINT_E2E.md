# 3. Repetición completa: build, unit tests, lint, E2E

Evidencia cruda: [`evidencia/build_lint_unit_output.txt`](evidencia/build_lint_unit_output.txt),
[`evidencia/e2e_output.txt`](evidencia/e2e_output.txt).

## Build

`npm run build` (`nest build`) — limpio, sin errores.

## Lint

`npm run lint` (`eslint "{src,test}/**/*.ts" --fix`) — **0 errores, 0
warnings**, sobre `src/**` y `test/**` (ver [02](02_LINT_FIX.md)).

## Unit tests

`npm test` (Jest, `src/**/*.spec.ts`):

```
Test Suites: 9 passed, 9 total
Tests:       96 passed, 96 total
```

## E2E

Postgres 16 efímero en Docker (contenedor nuevo, sin datos previos), migraciones
0001→0005 aplicadas con `node-pg-migrate up` antes de correr la suite:

```
Test Suites: 11 passed, 11 total
Tests:       82 passed, 82 total
```

Incluye toda la suite del puente Firebase (Fase 3/4): `users-firebase-uid`,
`auth-firebase-exchange` (+ rate-limit dedicado), `auth-logout`, además de la
suite preexistente (`auth`, `auth-refresh`, `auth-email-race`, `workouts`,
`equipment`, `users`, `app`).

Contenedor efímero eliminado al finalizar (`docker rm -f`).
