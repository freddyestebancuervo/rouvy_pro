# Auditoría final del repositorio — rouvy_pro

- **Fecha:** 2026-07-23
- **Rama:** `feature/d2`
- **Rol:** arquitecto principal / desarrollador senior (modo permanente activado por el usuario el 2026-07-23)
- **Estado:** ningún commit fue publicado (`push`), ninguna rama fue fusionada (`merge`), y no se ejecutó ningún cambio irreversible. Todo lo descrito acá vive en commits locales sobre `feature/d2`, que no tiene upstream configurado.

Este documento reemplaza la versión anterior (auditoría de limpieza de repo del mismo día). Cubre la **corrección final de infraestructura antes de cerrar D2**: `.gitignore`, credenciales QA hardcodeadas, CORS de producción, y verificación completa de pruebas.

---

## 1. Resumen ejecutivo

Se resolvieron los 4 puntos pedidos, cada uno validado con evidencia real (no solo revisión de código):

| # | Punto | Estado | Commit |
|---|---|---|---|
| 1 | `.gitignore` — cobertura completa de artefactos temporales | ✅ Resuelto | `b9a6eef` (+ `dart_define.local.json` en `51dbba5`) |
| 2 | Eliminar credenciales QA hardcodeadas | ✅ Resuelto | `51dbba5` |
| 3 | CORS de producción con allowlist | ✅ Resuelto | `4caea56` |
| 4 | `flutter test` sin fallos | ✅ Resuelto | ver sección 5 |

Además, durante la implementación se detectó y corrigió un quinto problema no solicitado pero crítico: **el job de CI del backend estaba probablemente roto en todos los runs** (migraciones incompletas + claves JWT nunca provistas) — corregido en `79a073c`, con validación real contra un Postgres desechable en Docker (57/57 tests e2e en verde).

No se eliminó código funcional, no se rompió la arquitectura modular existente, y no se realizó ninguna acción irreversible.

---

## 2. Explicación técnica de cada corrección

### 2.1 `.gitignore` — cobertura definitiva

**Problema:** el `.gitignore` raíz no tenía regla genérica para `node_modules/` (dependía de que cada subcarpeta declarara la suya — `firebase/seed/` no lo hacía, y llegó a acumular 173 MB / 14,283 archivos sin ignorar). Tampoco cubría `.playwright-mcp/`, `coverage/` a nivel raíz, ni basura de índice de carpetas de Windows.

**Corrección:**
- `node_modules/` y `.playwright-mcp/` — reglas genéricas (sin slash inicial, así que aplican a cualquier profundidad), agregadas en la sesión de limpieza previa a esta.
- `coverage/` — cierra el hueco a nivel raíz para `flutter test --coverage` (el mismo artefacto que sube el job "Flutter — analyze + test" de CI); antes solo `backend/coverage/` estaba cubierto vía `backend/.gitignore`.
- `Thumbs.db`, `ehthumbs.db`, `desktop.ini`, `*.tmp` — mismo criterio que la regla `.DS_Store` ya existente (macOS), pero para Windows, ya que el equipo también desarrolla ahí.
- `dart_define.local.json` — nuevo, ver punto 2.2: el archivo real con credenciales QA locales nunca debe versionarse, mismo criterio que `*.env`.

**Verificación:** `git status --short` y `git status --ignored` confirmaron que ningún artefacto de estas categorías quedó sin cubrir después del cambio, y que los `node_modules`/`.playwright-mcp` preexistentes ya habían sido eliminados físicamente del working tree.

### 2.2 Eliminación de credenciales QA hardcodeadas

**Problema:** 3 archivos tenían un email/password reales como literales en el código fuente:
- `lib/core/config/dev_backend_test_user.dart` (`static const String password = '[REDACTED_HISTORICAL_QA_BACKEND_PASSWORD]'`)
- `backend/scripts/seed_qa_workouts.js` (`const QA_PASSWORD = '[REDACTED_HISTORICAL_QA_BACKEND_PASSWORD]'`)
- `firebase/seed/seed_emulator.js` (`const QA_PASSWORD = '[REDACTED_HISTORICAL_QA_EMULATOR_PASSWORD]'`)

Los valores históricos quedaron expuestos en commits anteriores. Las cuatro huellas históricas exactas verificadas tienen 0 coincidencias en el árbol tracked actual; esto no demuestra que el historial Git esté saneado. BACKEND_QA_ROTATION_REVOCATION = UNPROVEN. HISTORY_SANITIZATION = NOT_PERFORMED. Cualquier saneamiento del historial es una tarea separada que requiere autorización explícita.

**Corrección — mecanismo por capa:**

- **Flutter (`dev_backend_test_user.dart`):** los 3 valores ahora vienen de `String.fromEnvironment('QA_BACKEND_EMAIL')` / `'QA_BACKEND_PASSWORD'` / `'QA_BACKEND_DISPLAY_NAME'` — el mismo mecanismo `--dart-define-from-file` que ya usaba `QaEmulatorConfig` para `USE_FIREBASE_EMULATORS`. Se agregó `DevBackendTestUser.isConfigured` (`true` solo si email y password no están vacíos), y `BackendAuthService._ensureAccessToken()` ahora verifica ese flag **antes** de intentar login/registro, lanzando un `StateError` con instrucciones claras si no está configurado — en vez de intentar autenticarse con strings vacíos.

  El archivo real `dart_define.local.json` (gitignored) alimenta esos defines; `dart_define.local.json.example` (versionado) documenta las claves esperadas. Uso: `flutter run --dart-define-from-file=dart_define.local.json`.

  **Garantía de que nunca llega a producción:** doble candado sin cambios — `kDebugMode` sigue haciendo que toda esta rama sea código muerto en `flutter build`/`--release` (el compilador la elimina), y ahora además el desarrollador tiene que optar explícitamente por un archivo local nunca commiteado. Si alguien corre un build de debug sin pasar el `--dart-define-from-file`, `email`/`password` quedan vacíos, `isConfigured` es `false`, y el intento de auto-login falla con un error explicativo en vez de silenciosamente usar un valor hardcodeado.

- **`backend/scripts/seed_qa_workouts.js`:** lee `process.env.QA_BACKEND_EMAIL`/`QA_BACKEND_PASSWORD`/`QA_BACKEND_DISPLAY_NAME`, cargados vía `require('dotenv').config()` desde `backend/.env` — `dotenv` ya es una dependencia transitiva de `@nestjs/config`, así que no se agregó ninguna dependencia nueva. Si faltan, el script termina con `process.exit(1)` y un mensaje claro. Se agregó el script `npm run seed:qa-workouts` y se documentaron las claves (comentadas, sin valores reales) en `backend/.env.example`.

- **`firebase/seed/seed_emulator.js`:** lee `process.env.QA_EMULATOR_EMAIL`/`QA_EMULATOR_PASSWORD`/`QA_EMULATOR_DISPLAY_NAME`, cargados vía el flag nativo de Node `--env-file=.env` (disponible sin dependencias desde Node 20.6+) — se actualizó el script `npm run seed` para incluir el flag. `firebase/seed/.env.example` documenta las claves. Misma validación fail-fast que el script anterior.

**Validación real ejecutada:**
- Se corrió el script del backend sin las variables definidas → falló inmediatamente con el mensaje esperado, sin llegar a la red.
- Se corrió con las variables cargadas desde `backend/.env` real → pasó la validación y llegó hasta el `fetch` real (falló con `ECONNREFUSED` porque el backend no estaba levantado en ese momento — comportamiento esperado, confirma que la lectura de credenciales funciona).
- Se corrió `firebase/seed/seed_emulator.js` vía `npm run seed` (con `--env-file`) → pasó la validación de credenciales y llegó hasta `require('firebase-admin')` (falló porque ese `node_modules` fue eliminado en la limpieza previa de la sesión anterior — no relacionado con este fix).
- Búsqueda exhaustiva adicional (`grep` de patrones `password`/`token`/`secret` en todo el repo, excluyendo `node_modules`): el resto de coincidencias están en archivos de test (`*.spec.ts`, `test/**/*.dart`) contra repositorios fake en memoria o bases de datos efímeras de CI — no son credenciales reales ni se compilan en ningún artefacto distribuible. No requieren cambio.

### 2.3 CORS preparado para producción

**Problema:** `backend/src/main.ts` llamaba `app.enableCors()` sin argumentos — refleja `Access-Control-Allow-Origin` para **cualquier** origen que lo pida. Estaba documentado en el propio código como medida temporal "hasta que exista un origen de producción", pero sin ningún mecanismo de allowlist para reemplazarlo.

**Corrección:** nuevo módulo `backend/src/config/cors.config.ts` (`resolveCorsOptions()`), siguiendo el mismo patrón que `database.config.ts` ya establecido en el proyecto:

1. **`CORS_ALLOWED_ORIGINS` definida** (lista separada por comas, con `trim()` y filtrado de vacíos) → allowlist explícita. Gana en **cualquier** entorno, incluida producción.
2. **Sin definir y `NODE_ENV !== 'production'`** → fallback de conveniencia: cualquier origen `http(s)://localhost` o `127.0.0.1` en cualquier puerto (regex `^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$`) — necesario porque `flutter run -d chrome` asigna un puerto distinto en cada corrida, y no tiene sentido exigirle a cada desarrollador que lo fije a mano solo para poder levantar la app.
3. **Sin definir y `NODE_ENV === 'production'`** → `origin: false`, cierra CORS por completo. Un despliegue de producción sin `CORS_ALLOWED_ORIGINS` configurada ahora falla de forma **visible** (Flutter Web no puede llamar al backend) en vez de fallar **abierto** (cualquier sitio podría llamarlo). Estrategia deliberada: "falla cerrado, nunca abierto".

`backend/.env.example` documenta la variable nueva.

**Validación real ejecutada** (no solo tests unitarios — contra un servidor real corriendo):
- 5 tests unitarios nuevos (`cors.config.spec.ts`) cubren las 3 ramas, incluida la prioridad de la allowlist explícita sobre producción y el tratamiento de un valor en blanco como "no configurado".
- Servidor real levantado con Postgres/JWT reales: preflight `OPTIONS` desde `https://evil.example.com` → **sin** header `Access-Control-Allow-Origin` (bloqueado). Preflight desde `http://localhost:5173` en modo desarrollo → header presente (permitido). Con `NODE_ENV=production` y `CORS_ALLOWED_ORIGINS` vacía → **ningún** origen permitido, ni siquiera `localhost` (fail-closed confirmado en producción).

---

## 3. Hallazgo adicional resuelto (no solicitado, crítico): CI del backend

Durante la verificación de infraestructura se encontró que `.github/workflows/ci.yml` (job `backend-tests`) tenía dos problemas independientes que casi con certeza rompían el pipeline en cada `push`/PR:

1. Solo aplicaba `migrations/0001_init.sql` con `psql -f` directo — las migraciones `0002`-`0004` (incluida la de `workouts`, parte de este mismo D2) nunca se aplicaban.
2. Nunca generaba ni proveía `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` — `TokenService.onModuleInit()` lanza una excepción si faltan, lo que rompe tanto el arranque del servidor como los tests e2e (que también bootean la app completa).

**Corrección** (commit `79a073c`, de una sesión anterior de esta misma auditoría, incluida acá por completitud): se agregó un paso que genera un par de claves RSA efímero por corrida, y se reemplazó el `psql -f` de un solo archivo por `npm run migrate:up` (aplica todas las migraciones pendientes en orden, es idempotente).

**Validación:** contra un Postgres 16 desechable en Docker, `migrate:up` aplicó `0001`→`0004` sin errores y la suite e2e completa corrió **57/57** con las claves generadas — antes del fix, ambos pasos fallaban.

---

## 4. Pruebas ejecutadas y resultados

| Comando | Resultado | Cuándo |
|---|---|---|
| `npm test` (backend, unitarios) | ✅ **73/73**, 8/8 suites (incluye los 5 tests nuevos de `cors.config.spec.ts`) | Tras el fix de CORS |
| `npm run test:e2e` (backend, contra Postgres real en Docker) | ✅ **57/57**, 7/7 suites | Tras el fix de CORS y credenciales |
| `npm run lint` (backend, ESLint) | ✅ sin hallazgos | Tras el fix de CORS |
| `npx tsc --noEmit` + `npm run build` (backend) | ✅ compila sin errores | Tras el fix de CORS |
| `node --check` sobre ambos scripts de seed modificados | ✅ sintaxis válida | Tras el fix de credenciales |
| Verificación manual de CORS contra servidor real (curl, 3 escenarios) | ✅ los 3 escenarios se comportan según lo diseñado | Tras el fix de CORS |
| `flutter analyze --fatal-infos` (mismo comando que exige CI) | ✅ **No issues found!** | Tras el fix de credenciales |
| `flutter test` (suite completa) | ✅ **186/186 tests, "All tests passed!"** | Tras el fix de credenciales |

---

## 5. Riesgos encontrados y cómo fueron mitigados

| Riesgo | Mitigación |
|---|---|
| `firebase/seed/node_modules` y `.playwright-mcp/` podían commitearse por accidente | Eliminados del working tree + reglas `.gitignore` genéricas que cubren cualquier profundidad |
| Credenciales QA históricas en texto plano en Git | Los valores fueron retirados del árbol actual en T-TRANS.1 B1, pero permanecen recuperables en commits históricos. La rotación/revocación de la credencial backend QA permanece **UNPROVEN** y la eliminación de los valores del historial requiere un tratamiento separado y autorización explícita. |
| CORS abierto a cualquier origen | Allowlist por variable de entorno, fail-closed en producción sin configurar |
| CI del backend probablemente roto en cada push (hallazgo adicional) | Corregido y validado con evidencia real (Docker + 57/57 e2e) |
| `dotenv` usado en `backend/scripts/seed_qa_workouts.js` sin ser una dependencia directa declarada en `package.json` | Es una dependencia transitiva garantizada mientras `@nestjs/config` siga siendo una dependencia — riesgo bajo, pero si se elimina `@nestjs/config` en el futuro este script dejaría de funcionar silenciosamente hasta notarlo. Documentado en un comentario en el propio script. |
| `applicationId`/`package_name` de Android siguen en placeholder | Fuera de alcance de esta sesión — es una decisión de producto pendiente del equipo, no un problema de infraestructura que deba resolver unilateralmente. |
| `flutter pub outdated` reporta 86 paquetes con versiones más nuevas | No se tocó ninguno — actualizar dependencias mayores sin poder correr la app completa en un dispositivo real dentro de este entorno es un cambio de alto impacto/bajo control; queda como recomendación (ver sección 7). |

---

## 6. Archivos modificados en esta sesión (4 puntos + hallazgo de CI)

**Commit `b9a6eef`** — `chore(gitignore): close remaining gaps for coverage reports and OS cruft`
- `.gitignore`

**Commit `51dbba5`** — `fix(security): remove hardcoded QA credentials, drive them from env config`
- `.gitignore` (regla `dart_define.local.json`)
- `backend/.env.example`
- `backend/package.json` (script `seed:qa-workouts`)
- `backend/scripts/seed_qa_workouts.js`
- `dart_define.local.json.example` (nuevo)
- `firebase/seed/.env.example` (nuevo)
- `firebase/seed/package.json`
- `firebase/seed/seed_emulator.js`
- `lib/core/config/dev_backend_test_user.dart`
- `lib/core/network/backend_auth_service.dart`

**Commit `4caea56`** — `fix(security): replace open CORS with an env-driven origin allowlist`
- `backend/.env.example`
- `backend/src/config/cors.config.ts` (nuevo)
- `backend/src/config/cors.config.spec.ts` (nuevo)
- `backend/src/main.ts`

**Commit `79a073c`** (hallazgo adicional, sesión previa) — `fix(ci): apply all pending migrations and provision JWT keys in backend job`
- `.github/workflows/ci.yml`

No versionados (solo local, uso del propio desarrollador, gitignorados):
- `dart_define.local.json` — no se creó uno real; el `.example` es la referencia.
- `firebase/seed/.env` — creado localmente con valores de desarrollo para que el script siga funcionando en esta máquina.
- `backend/.env` — se le agregaron `CORS_ALLOWED_ORIGINS` y las 3 claves `QA_BACKEND_*` para no romper el flujo local existente.

---

## 7. Recomendaciones siguientes, por prioridad

1. **Validar el fix de CI en un push/PR real** contra GitHub Actions — se verificó localmente con Docker, pero la prueba definitiva es verlo correr ahí.
2. **Decidir si rotar el historial de git** para los 2 valores de contraseña QA que quedaron en commits anteriores (ver sección 5) — requiere autorización explícita por ser una operación destructiva sobre el historial.
3. **Configurar `CORS_ALLOWED_ORIGINS` real** en el entorno de despliegue antes de exponer el backend fuera de desarrollo — sin esto, producción queda con CORS cerrado por completo (comportamiento seguro, pero Flutter Web no funcionará hasta configurarlo).
4. **Resolver el `applicationId`/`package_name` placeholder** de Android — bloquea cualquier build real de Play Store.
5. **Auditoría de dependencias** (`flutter pub outdated`, `npm outdated`) como tarea aparte y deliberada.

---

## 8. Confirmaciones explícitas

- ✅ **No se ejecutó `git push`** en ningún momento de esta sesión.
- ✅ **No se ejecutó ningún `merge`.**
- ✅ **No se eliminó código funcional** — todos los cambios fueron sustituciones (literal hardcodeado → lectura de config) o adiciones (allowlist de CORS, reglas de `.gitignore`), nunca remoción de funcionalidad.
- ✅ **Se mantuvo la arquitectura modular existente** — el nuevo `cors.config.ts` sigue el mismo patrón que `database.config.ts`; el mecanismo de credenciales QA sigue el mismo patrón `--dart-define` que `QaEmulatorConfig` ya establecía.
- ✅ **Todos los commits son locales** sobre `feature/d2`, rama sin upstream configurado (`fatal: no upstream configured for branch 'feature/d2'`) — no hay forma de que se haya publicado nada accidentalmente.
