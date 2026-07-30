# 1. Preflight y diff final

## Único archivo de producción modificado

`backend/src/modules/users/users.repository.ts` — confirmado: el resto de
archivos con diff pendiente contra `git HEAD` (ninguno de esta sesión fue
comprometido nunca a git, restricción vigente en toda la ingeniería) son
código de las Fases 2/3/4, ya incluido en la imagen previamente desplegada
antes de que Fase 4.1 empezara.

Dos cambios sobre `upsertByFirebaseUid`, aplicados en dos revisiones
sucesivas (cada una mostrada como diff y aprobada explícitamente antes de
escribirse):

1. **Rama de la transacción** (`catch` del `INSERT`): captura únicamente
   `23505` sobre una de las 3 constraints únicas conocidas de `users`
   (`users_firebase_uid_unique`, `users_email_unique`,
   `users_email_lower_unique`) — nunca otra constraint, nunca otro código de
   error. Tras la colisión esperada, re-consulta por `firebase_uid`: si
   aparece, devuelve esa fila (`isNew:false`); si no, `FirebaseEmailConflictError`.
2. **Rama del chequeo rápido `findByEmail`** (antes de la transacción):
   misma ventana de carrera pero más temprana — verifica
   `existingByEmail.firebaseUid === params.firebaseUid` antes de decidir si
   es una carrera legítima (mismo criterio, `firebaseUid` distinto o `null`
   sigue siendo conflicto real, nunca vinculación automática).

Nuevos archivos de test (no tocan producción):
- `backend/src/modules/users/users.repository.spec.ts` (8 unit tests)
- `backend/test/auth-firebase-exchange-concurrency-new-user.e2e-spec.ts`
- `backend/test/auth-firebase-exchange-concurrency-existing-user.e2e-spec.ts`
- `backend/test/auth-firebase-exchange-concurrency-two-users.e2e-spec.ts`

## Contexto Docker

`.dockerignore` excluye `.env`/`.env.*`, `secrets`, `*.pem`, `*.key`, `test`,
`coverage`, `jest.config.js`, `.git`, `README.md`, `.eslintrc.js`. El
`Dockerfile` solo copia `package*.json`, `tsconfig.json`, `nest-cli.json` y
`src/` — nunca `test/`. Confirmado en la imagen construida: 0 `.env`/secrets
propios (solo certificados CA del sistema operativo base), 0 archivos
`*.e2e-spec.*`, 0 `devDependencies` (`eslint`/`ts-jest`/`typescript`
ausentes de `node_modules` en la imagen final).

Condición preexistente, no introducida por esta fase (ya documentada en el
cierre de Fase 4): los `*.spec.ts` co-ubicados en `src/**` sí se compilan a
`dist/` (10 archivos) porque `tsconfig.json` incluye todo `src/**/*` —
fuera de alcance de esta corrección puntual.

## Re-ejecución preflight (antes de tocar Docker)

| Comando | Resultado |
|---|---|
| `npm run lint` | 0 errores |
| `npm run build` | limpio |
| `npm test` | 104/104 |
| `npm run test:e2e` (Postgres 16 efímero nuevo, migraciones 0001→0005) | 85/85 |

Sin fallos — no fue necesario detenerse en el preflight.
