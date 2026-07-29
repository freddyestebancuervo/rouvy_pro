# Auditoría de dependencias e integración — `origin/main..feature/d2`

**Método**: estrictamente de solo lectura (`git log`, `git show --stat
--summary`, `git diff-tree --no-commit-id --name-status -r`, `git diff
--stat`/`--name-status`, `git merge-base`, lectura de diffs de contenido).
Ningún archivo de código, prueba o configuración fue modificado para
producir este informe. Ningún `git add`/`commit`/`push`/`merge`/`rebase`/
`cherry-pick`/`reset`/`restore`/`stash` se ejecutó, ni se creó ninguna
rama, tag o despliegue.

**Objetivo**: determinar cómo integrar el contenido de `feature/d2` en
`main` de forma segura, sin abrir un Pull Request inmanejable ni separar
commits que dependan entre sí.

**Dato base**: `git merge-base origin/main feature/d2` = `9492108` = tip
actual de `origin/main` (no divergió desde que se creó la rama). Historia
de `feature/d2` **lineal**, sin merges internos, 20 commits,
`origin/main..feature/d2` = 144 archivos, +19184/-318.

---

## 1. Resumen ejecutivo

**`feature/d2` no debería integrarse completa en un solo Pull Request.**
Los 20 commits cubren iniciativas funcionalmente independientes entre sí
(Workouts D2 backend+Flutter, hardening de seguridad/CI, dockerización del
backend, puente de autenticación Firebase, Fase 4.2/4.2.1) acumuladas en
una rama única por orden cronológico de trabajo, no por diseño modular
para revisión. Internamente, cada iniciativa sí tiene dependencias de
contenido fuertes entre sus propios commits que impiden separarlos entre
sí sin romper compilación o reintroducir riesgos ya cerrados. La
estrategia recomendada (sección 6, corregida) es integración secuencial
por 5 bloques funcionales, cada uno mergeado a `main` con merge commit
tradicional antes de iniciar el siguiente.

---

## 2. Inventario de commits

| # | Hash | Mensaje | Módulo | Archivos principales | Dependencias | Riesgo | ¿Separable? |
|---|---|---|---|---|---|---|---|
| 1 | `33abc42` | feat(backend): Workouts module (D2) | Backend NestJS | `workouts.{controller,service,repository}.ts`, migración `0004` | Ninguna (primer commit del rango) | Bajo | Sí — raíz de su propio bloque |
| 2 | `7ac9d53` | docs: sync D2 (Workouts) | Docs | `ROADMAP_M0_M1.md`, `VERIFICATION_GUIDE.md` | `33abc42` (documenta su API) | Nulo | Solo junto a #1 |
| 3 | `e7f1793` | chore(config): Firebase project, Crashlytics, repo hygiene | Flutter/Firebase config | `google-services.json`, `firebase.json`, `firebase_options.dart` | Ninguna | Bajo | Sí en aislamiento, pero agrupado por practicidad (ver sección 4) |
| 4 | `2730fe5` | fix(backend): enable CORS for Web dev | Backend | `main.ts` (`app.enableCors()`) | Ninguna | Medio (CORS abierto, temporal) | **No** — `4caea56` reescribe este mismo bloque línea por línea; no debe quedar como estado intermedio visible en `main` |
| 5 | `338da36` | feat(auth): backend session client (Flutter) | Flutter/network | `backend_auth_service.dart`, `backend_dio_client.dart`, `api_config.dart` | Necesita el backend accesible (`2730fe5` para Web) | Medio | Parcial — ver #6 |
| 6 | `65cc14e` | feat(workouts): Flutter feature + QA fixtures | Flutter/Workouts | `lib/features/workouts/**`, `dev_backend_test_user.dart`, `seed_qa_workouts.js` | **Fuerte**: depende de `33abc42` (API) y `338da36` (cliente) — confirmado en el propio mensaje del commit ("Wire the backend auth client, added in the previous commit") | Medio (credenciales QA hardcodeadas en este momento) | **No** |
| 7 | `c8ca365` | fix(training): HUD overflow | Flutter/UI | `training_hud_page.dart` | Ninguna | Bajo | Sí en aislamiento, agrupado por practicidad |
| 8 | `79a073c` | fix(ci): apply migrations 0001→0004 + JWT keys | CI (`.github/workflows/ci.yml`) | 1 archivo | **Fuerte**: el propio mensaje documenta que corrige un job roto por `33abc42` (migración `0004`) nunca aplicada | Medio (CI estaba silenciosamente roto) | Solo junto al bloque D2 |
| 9 | `b9a6eef` | chore(gitignore): coverage/OS cruft | Repo hygiene | `.gitignore` | Ninguna | Nulo | Sí en aislamiento, agrupado por practicidad |
| 10 | `51dbba5` | fix(security): remove hardcoded QA creds | Seguridad | `dev_backend_test_user.dart`, `seed_qa_workouts.js`, `seed_emulator.js` | **Fuerte**: modifica 3 archivos creados por `65cc14e`/`338da36` — no aplica sin ellos | Alto si se separa mal (reintroduciría credenciales hardcodeadas) | **No** |
| 11 | `4caea56` | fix(security): CORS allowlist por env | Backend/seguridad | `main.ts`, `cors.config.ts` (nuevo) | **Fuerte**: reemplaza textualmente el bloque que `2730fe5` insertó (confirmado con diff línea por línea) | Alto si se separa (CORS abierto quedaría en producción) | **No** |
| 12 | `d3d01d8` | docs: closeout D2 infra | Docs | `docs/AUDITORIA_FINAL.md` | **Fuerte**: cita `51dbba5` y `4caea56` por hash explícitamente en una tabla | Nulo | Solo junto a #10, #11 |
| 13 | `2705463` | chore(backend): Docker + build hardening | Backend/infra | `Dockerfile`, `tsconfig.json` (`rootDir`/`include` nuevos), `.eslintrc.js` | Débil/blanda — necesita `backend/` compilable (cualquier punto ≥ #1); ningún commit posterior depende *estrictamente* de este | Medio (cambia qué termina en `dist/`) | Sí, con precaución |
| 14 | `8dfe5aa` | feat(auth): puente Firebase → backend | Backend/auth | `users.repository.ts` (+180), `auth.service.ts`, `auth.controller.ts`, `firebase-token-verifier.service.ts` (nuevo), migración `0005` | Necesita backend funcional (≥#1); no depende de Docker/CI en sí | Alto (superficie nueva: verificación de tokens, identidad) | **No** — raíz de todo el bloque Firebase/Fase 4.2 |
| 15 | `2bdb49a` | test(auth): carreras de identidad concurrentes | Tests | `users.repository.spec.ts` (nuevo), 3 e2e de concurrencia | **Fuerte**: prueba código introducido en `8dfe5aa` | Bajo (solo agrega tests) | **No**, sin `8dfe5aa` no tiene qué probar |
| 16 | `211c6de` | docs: Fase 4/4.1 (deploy + concurrencia real) | Docs | `docs/audits/AUDITORIA_FINAL/fase_4*/` | **Fuerte**: documenta el despliegue y las pruebas reales de `8dfe5aa`/`2bdb49a` | Nulo | Solo junto a #14, #15 |
| 17 | `789d925` | fix(auth): self-deadlock + saturación pool | Backend/auth | `users.repository.ts`, `pg-error.util.ts`, `api-exception.filter.ts` | **Fuerte**: modifica `users.repository.spec.ts` creado en `2bdb49a` y la función `upsertByFirebaseUid` introducida en `8dfe5aa` | Bajo (validado exhaustivamente, ver `10_FASE_4_2_1_ESTABILIZACION_E2E.md`) | **No** |
| 18 | `91c97a1` | feat(auth): rate limit híbrido | Backend/auth | `auth.controller.ts`, `auth.service.ts`, `firebase-exchange.errors.ts` | **Fuerte**: depende de `ApiException.retryAfterSeconds` (`789d925`) y de `exchangeFirebaseToken` (`8dfe5aa`) | Bajo-medio (cambia contrato observable del endpoint) | **No** |
| 19 | `b02f065` | docs: Fase 4.2 (capacidad + rate limit) | Docs | `docs/.../fase_4_2/00-10` | Documenta `789d925`+`91c97a1` | Nulo | Solo junto a #17, #18 |
| 20 | `acadd3b` | docs: revisión independiente Fase 4.2 | Docs | `fase_4_2/00_RESUMEN.md`, `revision_independiente/00_...md` | Documenta/audita `789d925`+`91c97a1`+`b02f065` | Nulo | Solo junto a #17-19 |

---

## 3. Grafo lógico de dependencias

```
33abc42 (Workouts backend) ──┬──> 7ac9d53 (docs)
                              ├──> 79a073c (CI: aplica migración 0004)
                              └──> 65cc14e (Flutter Workouts) ──┐
e7f1793 (Firebase config) [independiente]                       │
2730fe5 (CORS abierto) ──> 4caea56 (CORS allowlist) ────────────┼──> d3d01d8 (docs closeout, cita ambos hashes)
338da36 (cliente backend Flutter) ──> 65cc14e ───────────────────┘
                                        └──> 51dbba5 (quita creds QA) ──> d3d01d8
c8ca365 (fix UI HUD) [independiente]
b9a6eef (gitignore) [independiente total]
2705463 (Docker/build) [independiente, acoplamiento blando con todo lo posterior]

8dfe5aa (puente Firebase) ──> 2bdb49a (tests concurrencia) ──> 211c6de (docs Fase 4/4.1)
        │
        └──> 789d925 (self-deadlock/503) ──> 91c97a1 (rate limit) ──> b02f065 (docs) ──> acadd3b (docs)
```

**Cadenas que no pueden romperse** (aplicar uno sin el otro rompe
compilación, pierde contexto de auditoría, o reintroduce un riesgo ya
cerrado): `2730fe5→4caea56`, `{338da36,65cc14e}→51dbba5`,
`{51dbba5,4caea56}→d3d01d8`, `8dfe5aa→2bdb49a→211c6de`,
`8dfe5aa→789d925→91c97a1→b02f065→acadd3b`.

---

## 4. Plan de integración — 5 bloques (corregido)

**Corrección aplicada sobre una versión anterior de este plan**: `2730fe5`
(CORS abierto) ya no se propone como bloque separado ni previo a
`4caea56` — queda dentro del mismo bloque que su reemplazo, para que
`main` nunca pase por un estado intermedio con CORS abierto ni con
credenciales QA hardcodeadas.

| # | Nombre sugerido | Hash inicial | Hash final | Commits (orden) | Dependencias | Validación necesaria | Método de merge |
|---|---|---|---|---|---|---|---|
| 1 | `feat/d2-workouts-backend` | `33abc42` | `7ac9d53` | `33abc42`, `7ac9d53` | Ninguna (raíz) | `npm test` + `npm run test:e2e` backend, migración `0004` aplicando limpio desde cero | Merge commit tradicional |
| 2 | `feat/d2-flutter-ci-security` | `e7f1793` | `d3d01d8` | `e7f1793`, `2730fe5`, `338da36`, `65cc14e`, `c8ca365`, `79a073c`, `b9a6eef`, `51dbba5`, `4caea56`, `d3d01d8` | Bloque 1 (`65cc14e` necesita la API de Workouts) | `flutter test`, `npm test` backend, `cors.config.spec.ts`, job de CI real corriendo (migraciones 0001→0004 + claves JWT), grep de secretos — CORS abierto y credenciales QA nunca quedan como estado intermedio visible en `main`, por eso todo el bloque entra en un solo merge | Merge commit tradicional |
| 3 | `chore/d2-backend-docker` | `2705463` | `2705463` | `2705463` | Bloque 1 (necesita `backend/` compilable) | `docker build` real de la imagen, `npm run build` + `npm run lint` con el `tsconfig.json`/`rootDir` nuevo | Merge commit tradicional |
| 4 | `feat/d2-firebase-auth-bridge` | `8dfe5aa` | `211c6de` | `8dfe5aa`, `2bdb49a`, `211c6de` | Bloque 1 (backend base); recomendado Bloque 3 ya mergeado (mismo `tsconfig`/build usado para validar) | Suite e2e completa, migración `0005` aplicando limpio | Merge commit tradicional |
| 5 | `fix/d2-phase-4.2` | `789d925` | `acadd3b` | `789d925`, `91c97a1`, `b02f065`, `acadd3b` | **Bloque 4 obligatorio** (modifica archivos/funciones que solo existen desde `8dfe5aa`/`2bdb49a`) | Validación ya ejecutada: lint 0, build limpio, 122/122 unitarias, 86/86 e2e ×2 con pool 10, contenedor nuevo | Merge commit tradicional |

**Orden obligatorio de integración: 1 → 2 → 3 → 4 → 5.** Ningún bloque
posterior se crea, se sube ni se mergea antes de que el anterior esté
efectivamente mergeado en `main` real (no basta con haberlo validado en
la rama local).

### Por qué el rango es únicamente `<hash-final>`

La historia de `feature/d2` es lineal (sin merges internos). Cada bloque
es un tramo *contiguo* de esa misma historia, así que la rama de un
bloque, creada en su hash final, incluye automáticamente como ancestros
todos los commits de los bloques anteriores — no hace falta ni es válido
especificar un rango al crearla. El comando correcto es exclusivamente:

```
git branch <nombre-del-bloque> <hash-final-del-bloque>
```

`git branch <nombre> <hash-inicial>..<hash-final>` **no es válido** — `git
branch` solo acepta un punto de partida (commit), no un rango.

---

## 5. Análisis específico de Fase 4.2

**`789d925`, `91c97a1`, `b02f065` y `acadd3b` no pueden aislarse desde
`main` — requieren `8dfe5aa` y `2bdb49a` como prerrequisito estricto**,
verificado a nivel de contenido (no solo de mensaje):

- `789d925` modifica `backend/src/modules/users/users.repository.spec.ts`,
  archivo que no existe hasta `2bdb49a` (creado ahí, `A`).
- `789d925`/`91c97a1` modifican `upsertByFirebaseUid`/
  `exchangeFirebaseToken`, funciones que no existen hasta `8dfe5aa`
  (introducidas ahí).
- Un `cherry-pick` de `789d925` sobre `main` fallaría o aplicaría contra
  una base de código sin la lógica de Firebase que ese commit asume.

`b02f065`/`acadd3b` son puramente documentales pero narran y hacen
referencia directa a `789d925`/`91c97a1` — separarlos de su código dejaría
documentación sin código que describir.

**Conclusión**: el bloque mínimo indivisible que "Fase 4.2" requiere es
`{8dfe5aa, 2bdb49a, 211c6de, 789d925, 91c97a1, b02f065, acadd3b}` — 7
commits, no 4. Corresponde a los Bloques 4 y 5 de la sección 4, en ese
orden.

---

## 6. Estrategia recomendada

| Estrategia | Evaluación |
|---|---|
| PR único desde `feature/d2` | Descartada — 144 archivos, iniciativas no relacionadas en una sola revisión; un solo `revert` afectaría todo |
| Varios PR acumulativos (cada uno contiene también el anterior) | Descartada — ruido de revisión innecesario dado que la historia ya es lineal |
| Ramas nuevas + `cherry-pick` | Descartada — riesgo real de conflictos o de aplicar commits sobre una base semánticamente incorrecta (sección 3); además reescribe metadatos de commit (autor de aplicación, fecha), perdiendo trazabilidad exacta |
| **Integración secuencial por 5 bloques funcionales, merge commit tradicional** | **Recomendada.** Cada bloque es un rango contiguo de la misma rama — no hace falta `cherry-pick`. El orden de merge (1→2→3→4→5) respeta exactamente el grafo de dependencias de la sección 3 |

### Requisitos explícitos de esta estrategia

- **Uso exclusivo de merge commit tradicional** (`git merge --no-ff` en
  local, o "Create a merge commit" en la interfaz del remoto) para cada
  uno de los 5 bloques.
- **Squash y rebase quedan prohibidos** mientras se use esta estrategia —
  ambos reescriben hashes, y la seguridad de encadenar bloques sin
  `cherry-pick` depende enteramente de que cada bloque mergeado conserve
  los hashes exactos que ya se validaron localmente. Si en el futuro se
  diseña una estrategia distinta (p. ej. squash de cada bloque en un único
  commit), debe reevaluarse desde cero — no es una variación menor de
  esta.
- **Verificación de hashes antes de avanzar de bloque**: tras cada merge
  real a `main`, confirmar (`git log --oneline` sobre el `main` remoto
  actualizado) que los commits del bloque recién mergeado conservan
  exactamente los hashes cortos de la tabla de la sección 4, antes de
  crear la rama del bloque siguiente. Si algún hash cambiara (indicio de
  que se usó squash/rebase por error), detenerse — la cadena de
  dependencias de la sección 3 ya no estaría garantizada.

---

## 7. Plan exacto de ejecución futura (no ejecutado)

```
Para cada bloque N, en orden 1→5:

  [DETENCIÓN — autorización separada para crear la rama]
  git branch <nombre-del-bloque> <hash-final-del-bloque>

  [DETENCIÓN — autorización separada antes de push]
  git push origin <nombre-del-bloque>

  [DETENCIÓN — autorización separada antes de abrir PR]
  gh pr create --base main --head <nombre-del-bloque> --title "..." --body "..."

  [Validaciones de la tabla de la sección 4, correr y confirmar en verde]

  [DETENCIÓN — autorización separada antes de merge]
  # Merge commit tradicional exclusivamente:
  #   en GitHub: botón "Create a merge commit"
  #   (NUNCA "Squash and merge" ni "Rebase and merge")
  #   equivalente local, si aplicara: git merge --no-ff <nombre-del-bloque>

  [Verificación obligatoria antes de continuar]
  # Confirmar que origin/main conserva los hashes originales de este
  # bloque (git log --oneline sobre origin/main actualizado) antes de
  # crear la rama del bloque N+1.
```

Cada una de las 4 detenciones (crear rama / push / PR / merge) requiere
autorización explícita y separada — ninguna se asume por la aprobación de
la anterior. Nada de este plan fue ejecutado en esta auditoría.

---

## 8. Riesgos y deudas

- **H1** (deuda técnica, no bloqueante) — `UPDATE` de usuario existente en
  `users.repository.ts` sin recuperación de `23505`. Severidad media,
  preexistente desde `8dfe5aa`, no introducido ni cerrado por `789d925`.
  Sin resolver — documentado en detalle en
  `00_REVISION_INDEPENDIENTE_COMMITS.md`.
- **H2** (deuda técnica, no bloqueante) — cardinalidad no acotada de la
  Capa 2 del rate limit (`91c97a1`) en `ThrottlerStorageService`.
  Severidad baja-media, mitigada operacionalmente por el ciclo de vida de
  Cloud Run. Sin resolver — documentado en detalle en
  `00_REVISION_INDEPENDIENTE_COMMITS.md`.
- **H3** (riesgo de proceso, ya abordado por este plan) — el alcance real
  de un PR único desde `feature/d2` (144 archivos, ~17% Fase 4.2, ~83%
  trabajo no relacionado) queda resuelto por la estrategia de 5 bloques de
  este documento: ningún PR individual mezcla iniciativas no relacionadas.
  No se ejecutó ninguna acción para materializar esta resolución —
  permanece como plan pendiente de autorización, no como hecho.

---

## Alcance de lo NO hecho en esta auditoría

No se modificó ningún archivo de código de producción, prueba ni
configuración. No se ejecutó `git add`, `git commit`, `git push`, `git
merge`, `git rebase`, `git cherry-pick`, `git reset`, `git restore`, `git
stash`, ni se creó ninguna rama o tag. No se desplegó nada. Este
documento es exclusivamente el resultado de comandos de lectura
(`git log`, `git show --stat --summary`, `git diff-tree`, `git diff
--stat`/`--name-status`, `git merge-base`) y de la lectura de contenido de
diffs específicos para verificar dependencias reales, no solo mensajes de
commit.
