# Auditoría final del repositorio — rouvy_pro

- **Fecha:** 2026-07-23
- **Rama:** `feature/d2`
- **HEAD:** `7ac9d53` — "docs: synchronize documentation for D2 (Workouts)"
- **Estado:** ningún commit, merge ni push realizado durante esta auditoría.

---

## 1. Salida de comandos

### `git status --short`

```
 M android/app/build.gradle.kts
 M android/app/google-services.json
 M android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java
 M backend/src/main.ts
 M firebase.json
 M lib/app/router/app_router.dart
 M lib/core/config/social_login_config.dart
 M lib/core/di/injection.dart
 M lib/core/error/error_handler.dart
 M lib/core/error/failures.dart
 M lib/features/home/presentation/pages/home_page.dart
 M lib/features/profile/presentation/pages/profile_page.dart
 M lib/features/training/presentation/pages/training_hud_page.dart
 M lib/firebase_options.dart
 M lib/l10n/app_en.arb
 M lib/l10n/app_es.arb
 M lib/l10n/generated/app_localizations.dart
 M lib/l10n/generated/app_localizations_en.dart
 M lib/l10n/generated/app_localizations_es.dart
 M lib/main.dart
 M test/core/error_handler_test.dart
 M web/index.html
?? .playwright-mcp/
?? backend/scripts/
?? firebase/seed/
?? lib/core/config/dev_backend_test_user.dart
?? lib/core/config/qa_emulator_config.dart
?? lib/core/network/api_config.dart
?? lib/core/network/backend_auth_service.dart
?? lib/core/network/backend_dio_client.dart
?? lib/core/network/backend_session.dart
?? lib/features/workouts/
?? test/features/workouts/
```

### `git diff --stat`

```
 android/app/build.gradle.kts                       |   1 +
 android/app/google-services.json                   |  25 +-
 backend/src/main.ts                                |  11 +
 firebase.json                                      |  15 +-
 lib/app/router/app_router.dart                     |  31 +++
 lib/core/config/social_login_config.dart           |   3 +-
 lib/core/di/injection.dart                         |  46 ++++
 lib/core/error/error_handler.dart                  |  33 ++-
 lib/core/error/failures.dart                       |  16 ++
 .../home/presentation/pages/home_page.dart         |  41 ++++
 .../profile/presentation/pages/profile_page.dart   |   7 +
 .../presentation/pages/training_hud_page.dart      | 116 ++++-----
 lib/firebase_options.dart                          |  87 ++++---
 lib/l10n/app_en.arb                                |  60 ++++-
 lib/l10n/app_es.arb                                |  60 ++++-
 lib/l10n/generated/app_localizations.dart          | 258 +++++++++++++++++++++
 lib/l10n/generated/app_localizations_en.dart       | 140 +++++++++++
 lib/l10n/generated/app_localizations_es.dart       | 141 +++++++++++
 lib/main.dart                                      |  48 ++--
 test/core/error_handler_test.dart                  |  91 ++++++++
 web/index.html                                     |  17 +-
 21 files changed, 1094 insertions(+), 153 deletions(-)
```

> Nota: `GeneratedPluginRegistrant.java` aparece como `M` en `git status` pero **no figura** en `git diff --stat` — su diff de contenido es vacío. El único cambio es de fin de línea (LF→CRLF, `core.autocrlf=true`), sin cambios reales.

### `git diff --name-status`

```
M	android/app/build.gradle.kts
M	android/app/google-services.json
M	backend/src/main.ts
M	firebase.json
M	lib/app/router/app_router.dart
M	lib/core/config/social_login_config.dart
M	lib/core/di/injection.dart
M	lib/core/error/error_handler.dart
M	lib/core/error/failures.dart
M	lib/features/home/presentation/pages/home_page.dart
M	lib/features/profile/presentation/pages/profile_page.dart
M	lib/features/training/presentation/pages/training_hud_page.dart
M	lib/firebase_options.dart
M	lib/l10n/app_en.arb
M	lib/l10n/app_es.arb
M	lib/l10n/generated/app_localizations.dart
M	lib/l10n/generated/app_localizations_en.dart
M	lib/l10n/generated/app_localizations_es.dart
M	lib/main.dart
M	test/core/error_handler_test.dart
M	web/index.html
```

Todas las entradas son modificaciones (`M`); no hay renames ni deletes.

### `git ls-files --others --exclude-standard`

El comando devuelve **14,308 líneas**. La inmensa mayoría (14,283 archivos) corresponde a **`firebase/seed/node_modules/`** (dependencias npm, 173 MB), que no está cubierto por ningún `.gitignore`. El resto de archivos untracked, sin ruido de `node_modules`, es:

```
.playwright-mcp/page-2026-07-23T02-15-50-126Z.yml
.playwright-mcp/page-2026-07-23T02-26-07-420Z.png
backend/scripts/seed_qa_workouts.js
firebase/seed/package-lock.json
firebase/seed/package.json
firebase/seed/seed_emulator.js
lib/core/config/dev_backend_test_user.dart
lib/core/config/qa_emulator_config.dart
lib/core/network/api_config.dart
lib/core/network/backend_auth_service.dart
lib/core/network/backend_dio_client.dart
lib/core/network/backend_session.dart
lib/features/workouts/data/datasources/workouts_remote_datasource.dart
lib/features/workouts/data/models/workout_model.dart
lib/features/workouts/data/repositories/workouts_repository_impl.dart
lib/features/workouts/domain/entities/workout.dart
lib/features/workouts/domain/repositories/workouts_repository.dart
lib/features/workouts/presentation/pages/workout_detail_page.dart
lib/features/workouts/presentation/pages/workout_form_page.dart
lib/features/workouts/presentation/pages/workouts_list_page.dart
lib/features/workouts/presentation/providers/workouts_providers.dart
lib/features/workouts/presentation/widgets/workout_card.dart
lib/features/workouts/presentation/widgets/workout_target_type_ui.dart
test/features/workouts/data/models/workout_model_test.dart
test/features/workouts/presentation/pages/workouts_list_page_test.dart
```

---

## 2. Revisión de artefactos que no deben versionarse

| Artefacto | Estado |
|---|---|
| `node_modules/` dentro del proyecto | ⚠️ `backend/node_modules/` y `firebase/rules-tests/node_modules/` están correctamente ignorados. **`firebase/seed/node_modules/` NO está ignorado** (173 MB, 14,283 archivos) — riesgo real de commit accidental. |
| Screenshots/videos de Playwright | ⚠️ `.playwright-mcp/page-2026-07-23T02-15-50-126Z.yml` y `.png` **no están ignorados** y aparecen como untracked. |
| Scratchpads | ✅ Ninguno dentro del repositorio. |
| Logs (Flutter/Firebase/backend/Playwright) | ✅ `firebase-debug.log`, `firestore-debug.log`, `firebase_emulators.log`, `flutter_01.log`, `flutter_run_debug.log`, `flutter_run_qa.log`, `firebase/rules-tests/firestore-debug.log` — todos ignorados (verificado con `git status --ignored`). |
| Archivos temporales | ✅ No se encontraron. |
| Resultados de cobertura | ✅ Ninguno propio del proyecto (solo un `coverage/` interno de una dependencia dentro de `backend/node_modules`, ya ignorado). |
| Builds generados | ✅ `backend/dist/` y `/build/` están ignorados. |
| Credenciales/tokens/secretos | ⚠️ Ver sección de confirmaciones — valores reales de Firebase en archivos trackeados (config cliente, no secreta por diseño) y contraseñas QA hardcodeadas en 3 archivos nuevos. `backend/.env` está correctamente ignorado y no aparece modificado. |
| Archivos de emuladores | ✅ Los logs de emulador están ignorados. `firebase/seed/node_modules` es el único artefacto de tooling de emulador expuesto. |

### Resultado de la revisión de `.gitignore`

El `.gitignore` raíz **no tiene una regla genérica `node_modules/`**; depende de que cada subcarpeta declare la suya (`backend/.gitignore`, `firebase/rules-tests/.gitignore`). `firebase/seed/` no tiene `.gitignore` propio, así que su `node_modules/` quedó expuesto. Tampoco existe ninguna regla para `.playwright-mcp/`.

Todo lo demás que el `.gitignore` raíz cubre (Flutter/Dart, Android Studio, iOS/Xcode, `*.env`, `key.properties`, `*.keystore`, `*.jks`, logs sueltos) funciona correctamente y coincide con `git status --ignored`.

**Cambios propuestos (no aplicados):**

```gitignore
# Node dependencies (cualquier subcarpeta)
node_modules/

# Playwright MCP — artefactos de sesión, no código
.playwright-mcp/
```

---

## 3. Clasificación de archivos

### A. Conservar y versionar

| Archivo | Motivo |
|---|---|
| `lib/app/router/app_router.dart` | Rutas nuevas de Workouts, parte central de D2. |
| `lib/core/di/injection.dart` | Registro DI de los nuevos providers/servicios de Workouts y backend. |
| `lib/core/error/error_handler.dart`, `lib/core/error/failures.dart` | Extensión del manejo de errores para el nuevo dominio Workouts. |
| `lib/features/home/presentation/pages/home_page.dart`, `lib/features/profile/presentation/pages/profile_page.dart` | Integración de Workouts en navegación existente. |
| `lib/features/training/presentation/pages/training_hud_page.dart` | Refactor asociado al mismo esfuerzo D2. |
| `lib/l10n/app_en.arb`, `app_es.arb` + `lib/l10n/generated/*.dart` | Nuevas strings de localización para Workouts; los `generated/*` son autogenerados por `flutter gen-l10n`, coherentes con el `.arb` fuente. |
| `lib/main.dart` | Bootstrap actualizado para el nuevo flujo. |
| `test/core/error_handler_test.dart` | Cobertura de test para los cambios de `error_handler.dart`. |
| `android/app/build.gradle.kts` | Añade plugin de Crashlytics — cambio de infraestructura intencional y de bajo riesgo. |
| `android/app/src/main/java/.../GeneratedPluginRegistrant.java` | Diff de contenido vacío — solo ruido de fin de línea, no hay cambio real. |
| `web/index.html` | Elimina un meta-tag placeholder que causaba un bug real (doble `initialize()` de Google Identity Services). |
| `lib/core/config/social_login_config.dart` | Ajuste menor asociado al fix anterior. |
| `lib/core/network/api_config.dart`, `backend_dio_client.dart`, `backend_session.dart` | Infraestructura de cliente HTTP para el backend NestJS, sin secretos (usa `flutter_secure_storage`). |
| `lib/core/config/qa_emulator_config.dart` | Solo un flag booleano con doble candado (`kDebugMode && --dart-define`); sin datos sensibles. |
| `lib/features/workouts/**` (11 archivos) | Feature Workouts completa del lado Flutter (D2). |
| `test/features/workouts/**` (2 archivos) | Tests de la feature anterior. |
| `firebase/seed/seed_emulator.js`, `firebase/seed/package.json`, `firebase/seed/package-lock.json` | Script de seed contra el **emulador** local, con credencial declarada explícitamente como no-secreta (`fake-api-key`, cuenta que solo existe en el emulador). |

### B. Eliminar antes del commit

| Archivo/carpeta | Motivo |
|---|---|
| `firebase/seed/node_modules/` | 173 MB, 14,283 archivos de dependencias npm. Nunca debe versionarse; no cubierto por ningún `.gitignore` actual. |
| `.playwright-mcp/` (`.yml` + `.png`) | Artefactos de sesión de un MCP de Playwright (snapshot de página + screenshot), no son código ni documentación del proyecto. |

### C. Revisar manualmente antes de decidir

| Archivo | Motivo |
|---|---|
| `android/app/google-services.json`, `firebase.json`, `lib/firebase_options.dart` | Contienen valores reales del proyecto Firebase `ridepro-dbafe` (apiKey, appId, project number, OAuth client ID) en lugar de los placeholders anteriores. Salida esperada de `flutterfire configure`/consola; las API keys de Firebase para apps cliente no son secretas por diseño (se protegen con Security Rules/App Check). Aun así, es un cambio real de estado ("plantilla" → "proyecto real vinculado") que requiere tu confirmación explícita. |
| `backend/src/main.ts` | Añade `app.enableCors()` sin restricción de origen (allow-all). Correcto para desarrollo (falta origen de producción configurado, según el propio comentario), pero relevante desde seguridad antes de desplegar. |
| `backend/scripts/seed_qa_workouts.js` | Contiene `QA_PASSWORD` hardcodeada, usada contra el backend **real** (no emulador) vía `/auth/register`/`/auth/login`. Confirmar que se quiere versionar una contraseña en texto plano como tooling de QA. |
| `lib/core/config/dev_backend_test_user.dart` | Misma contraseña fija compilada en el binario, documentada como excluida de release vía `kDebugMode`. Confirmar que es aceptable en el repo. |

---

## 4. Confirmaciones

- **Producción no usa emuladores salvo `USE_FIREBASE_EMULATORS=true`**: ✅ confirmado — `QaEmulatorConfig.useFirebaseEmulators` exige `kDebugMode && bool.fromEnvironment('USE_FIREBASE_EMULATORS')`, código muerto en builds `--release`.
- **No se modificaron credenciales reales**: ⚠️ con matiz — `google-services.json`, `firebase.json` y `firebase_options.dart` sí pasaron de placeholders a valores reales del proyecto `ridepro-dbafe`. No son secretos de servidor (son config cliente pensada para ser pública), pero es un cambio de estado que debe confirmarse como intencional. `backend/.env` no fue tocado.
- **No se hizo commit, merge ni push**: ✅ confirmado — `HEAD` sigue en `7ac9d53`, sin `MERGE_HEAD` ni operación en curso.
- **D3 no fue iniciado**: ✅ confirmado — única mención en `ROADMAP_M0_M1.md`: *"D3 (Rutas) es la siguiente prioridad — no iniciada"*. No hay código de rutas/Postgres nuevo.
- **Pruebas**: backend `npm test` → **68/68 tests, 7/7 suites** en verde. `flutter test` no se pudo ejecutar en esta sesión (`flutter` no está en el `PATH` de este entorno) — pendiente de verificación manual.

---

## 5. Mensaje de commit propuesto (no ejecutado)

**Título (Conventional Commits):**
```
feat(workouts): add Flutter Workouts UI and backend session integration (D2)
```

**Cuerpo:**
```
- Add Workouts feature (data/domain/presentation) wired into home,
  router and DI, with generated l10n strings for the new screens.
- Add backend network layer (api_config, backend_dio_client,
  backend_auth_service, backend_session) to authenticate against the
  NestJS backend independently of Firebase Auth.
- Add debug-only QA fixtures (dev_backend_test_user, qa_emulator_config)
  and seed tooling (backend/scripts, firebase/seed) to exercise
  Workouts without a backend login screen.
- Fix duplicate Google Identity Services initialize() on web by
  removing the static google-signin-client_id meta tag.
- Enable permissive CORS on the backend for Flutter Web dev traffic
  (no production origin configured yet).
- Bind Firebase config to the real ridepro-dbafe project and enable
  Crashlytics.
```

---

## 6. Comandos sugeridos para revisión y commit (no ejecutados)

```bash
# 1. Limpiar artefactos que no deben versionarse (grupo B)
rm -rf firebase/seed/node_modules
rm -rf .playwright-mcp

# 2. Cerrar el hueco de .gitignore detectado
printf "\n# Node dependencies (cualquier subcarpeta)\nnode_modules/\n\n# Playwright MCP - artefactos de sesion\n.playwright-mcp/\n" >> .gitignore

# 3. Revisar el grupo C con calma
git diff android/app/google-services.json firebase.json lib/firebase_options.dart
git diff backend/src/main.ts
cat backend/scripts/seed_qa_workouts.js
cat lib/core/config/dev_backend_test_user.dart

# 4. Correr pruebas
cd backend && npm test && cd ..
flutter test   # ejecutar donde el SDK esté en PATH

# 5. Stage selectivo (evitar git add -A por el hallazgo del punto 2)
git add lib/ test/ web/index.html android/app/build.gradle.kts \
        android/app/google-services.json firebase.json \
        backend/src/main.ts backend/scripts/ firebase/seed/seed_emulator.js \
        firebase/seed/package.json firebase/seed/package-lock.json \
        .gitignore

# 6. Confirmar qué quedó staged
git status --short

# 7. Commit
git commit -F- <<'EOF'
feat(workouts): add Flutter Workouts UI and backend session integration (D2)

- Add Workouts feature (data/domain/presentation) wired into home,
  router and DI, with generated l10n strings for the new screens.
- Add backend network layer (api_config, backend_dio_client,
  backend_auth_service, backend_session) to authenticate against the
  NestJS backend independently of Firebase Auth.
- Add debug-only QA fixtures (dev_backend_test_user, qa_emulator_config)
  and seed tooling (backend/scripts, firebase/seed) to exercise
  Workouts without a backend login screen.
- Fix duplicate Google Identity Services initialize() on web by
  removing the static google-signin-client_id meta tag.
- Enable permissive CORS on the backend for Flutter Web dev traffic
  (no production origin configured yet).
- Bind Firebase config to the real ridepro-dbafe project and enable
  Crashlytics.
EOF
```
