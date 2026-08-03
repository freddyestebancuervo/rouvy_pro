# Korixa — Documento 24: Android Development Foundation (T-F0.2 / C1, Bloque 5A)

- **Fecha:** 2026-08-03
- **Rol:** Arquitecto de Software Senior / Auditor Técnico
- **Alcance de esta tarea:** dos auditorías de solo lectura (Bloque 5A — diseño de Android Development; Bloque 5A.0 — origen del `applicationId` de Android Production) seguidas de una implementación autorizada, con alcance funcional acotado a Development.
- **SHA base de `main`:** `e6d0a5ff537a44a0aa8b10c3a440b60ad95e861d` (confirmado con `git fetch origin` antes de iniciar cada subbloque; sin cambios entre ellos).
- **Rama y worktree:** `feat/tf02-android-dev-foundation-20260803`, worktree aislado, `feature/d2` no tocada (verificada sin cambios antes/después: HEAD `7fe75a6`, 80 líneas locales).

---

## 1. Resumen ejecutivo

Este bloque cierra parcialmente la Puerta E (multiplataforma) del Documento 15 §12 para Development, registrando una app Android real (`com.ridepro.app.dev`) en `ridepro-development` y wireando un flavor Gradle `development` con `applicationId` absoluto. En el camino, la auditoría de diseño (sección 2) descubrió que el `applicationId` de Android **Production** nunca fue corregido de su placeholder de scaffold original — hallazgo documentado en profundidad en la sección 3, con línea de tiempo completa. Ese hallazgo determinó la decisión de diseño técnica de este bloque (`applicationId` absoluto, no `applicationIdSuffix`) y queda registrado como trabajo pendiente independiente (Bloque 5C, no autorizado). Google Sign-In Android en Development queda explícitamente pendiente de SHA-1/SHA-256 — no se declara validado.

---

## 2. Auditoría de diseño (Bloque 5A) — hallazgos previos a la implementación

Revisados en modo solo lectura: `android/app/build.gradle.kts`, `android/build.gradle.kts`, `android/settings.gradle.kts`, `AndroidManifest.xml` (main/debug/profile), `pubspec.yaml`, `lib/main.dart`, `lib/main_development.dart`, `lib/firebase_options.dart`, `lib/firebase_options_development.dart`, `.firebaserc`, `firebase.json`, Documento 15, Documento 23, `PROJECT_STATUS.md`, y estado real de las apps Firebase de `ridepro-development`/`ridepro-dbafe` vía `firebase apps:list`.

**Determinaciones clave:**
- `namespace` de Gradle (`com.ridepro.app`) es un valor real e intencional, no un placeholder — distinto del `applicationId`.
- El diseño original del Documento 15 §3.2/3.3 (flavors nativos con `applicationIdSuffix`) asume que el `applicationId` de Production ya está resuelto — no lo está (ver sección 3).
- Mecanismo recomendado y adoptado: flavor `development` con `applicationId` **absoluto** (`com.ridepro.app.dev`), no `applicationIdSuffix` — evita heredar el placeholder roto de Production sin necesidad de corregirlo primero.
- Entry point correspondiente: `lib/main_development.dart`, siempre junto con el flavor (`flutter build apk --flavor development -t lib/main_development.dart`) — usar solo uno de los dos mezclaría entornos.
- `firebase_options_development.dart` no soportaba Android antes de este bloque (`currentPlatform` lanzaba `UnsupportedError` para cualquier plataforma que no fuera Web).
- Google Sign-In Android requiere SHA-1/SHA-256 — no generable en este entorno (sin keystore/Android SDK de firma disponible); paso manual del propietario.

---

## 3. Auditoría del `applicationId` de Android Production (Bloque 5A.0)

**Pregunta:** ¿el valor actual `com.ridepro.app.YOUR_APPLICATION_ID` es un placeholder accidental o una decisión deliberada?

**Línea de tiempo (evidencia: `git log`/`git show` sobre `origin/main`):**

| Fecha | Commit | Hallazgo |
|---|---|---|
| 2026-07-21 03:34 | `7b5a238` | Origen: crea `android/app/google-services.json` con `mobilesdk_app_id` completamente dummy (todo ceros) y `package_name` = placeholder. Crea también el `build.gradle` original con el mismo placeholder, marcado con un comentario propio: "PLACEHOLDER a reemplazar". |
| 2026-07-21 13:36 | `2255483` | Reescribe a `build.gradle.kts` (Kotlin DSL), preserva el mismo placeholder. |
| 2026-07-23 16:50 | `e7f1793` | **Momento crítico:** actualiza `mobilesdk_app_id` al App ID real de un proyecto Firebase real — es decir, aquí se registró la app Android en Firebase Console **con el placeholder todavía puesto**, sin corregirlo antes. |
| 2026-07-25 | Documento 15, D3 | Primera decisión formal: `com.ridepro.app` (prod) / `.dev` / `.staging`, aprobada por el propietario. El mismo documento registra el riesgo **R12** (placeholder bloqueando flavors, "prerrequisito explícito") pero otra sección (línea 68) da por hecho "ya fijado" — **falso**, nunca se ejecutó. |
| 2026-07-23 → hoy | — | Ningún commit posterior volvió a tocar el `applicationId`/`package_name`. |

**Estado real de Firebase Production:** `firebase apps:list --project ridepro-dbafe` confirma una única app Android registrada, con el placeholder como `package_name` (verificado contra el `google-services.json` real trackeado en el repo). No existe una segunda app con `com.ridepro.app`.

**Consecuencias técnicas de corregirlo (no ejecutado en este bloque):** el `package_name` de una app Android en Firebase es inmutable tras el registro — corregirlo exige registrar una app **nueva**, con un App ID nuevo, nuevo `google-services.json`, actualizar `firebase_options.dart`/`firebase.json`, nuevo SHA-1/SHA-256 de release, y deja huérfano cualquier historial de Analytics/Crashlytics del App ID anterior.

**Riesgos reales (no hipotéticos):** el placeholder funciona técnicamente hoy (compila, instala, Firebase/Google Sign-In operan con normalidad bajo esa identidad). No hay evidencia, en ninguna fuente auditada, de distribución real (Play Store, dispositivos físicos, usuarios) — el riesgo de pérdida de usuarios/datos es bajo, no verificable como cero desde este entorno.

**Recomendación:** **B — avanzar con Development, corregir Production después**, en un bloque independiente y autorizado por separado. Justificación completa en el informe de auditoría previo a este bloque (mismo veredicto, sin cambios).

---

## 4. Implementación (Bloque 5A)

**Registrado:** app Android en `ridepro-development`, package `com.ridepro.app.dev`, nombre visible "Korixa Android Development" — verificado de solo lectura antes de crear que no existía ya (`firebase apps:list --project ridepro-development`, 1 app Web únicamente).

**Archivos modificados/creados (lista cerrada, exactamente estos 4 + esta documentación):**
- `android/app/build.gradle.kts` — flavor `development` (`applicationId` absoluto `com.ridepro.app.dev`) + flavor `production` (hereda `defaultConfig.applicationId` sin cambios). `defaultConfig` no se modificó.
- `android/app/src/development/google-services.json` — nuevo, descargado directo a archivo (nunca impreso en consola/chat).
- `lib/firebase_options_development.dart` — `currentPlatform` ahora soporta Android además de Web; iOS sigue lanzando `UnsupportedError` explícito.
- `firebase.json` — referencia `flutter.platforms.android.development` y `flutter.dart["lib/firebase_options_development.dart"]` añadidas; referencias de Production sin alterar.

**No tocado (confirmado por `git status`/`git diff` en cada paso):** `android/app/google-services.json` (Production), `lib/firebase_options.dart`, `lib/core/config/environments/environment_production.dart`, `.firebaserc`.

---

## 5. Validaciones ejecutadas

| # | Prueba | Resultado |
|---|---|---|
| 1 | `git diff --check` | Limpio |
| 2 | `flutter analyze --fatal-infos` | 12 issues — idénticos, verificado contra un worktree limpio de `origin/main` sin tocar (deprecación de `Radio.groupValue`/`onChanged` en `settings_page.dart`, deriva del SDK de Flutter instalado en esta máquina). Cero issues nuevos. |
| 3 | `flutter test` | 248 passed / 6 failed — idéntico al baseline de `origin/main` sin tocar, mismos 6 tests fallando por nombre (auth widgets + 1 test de navegación demo, ninguno tocado por este bloque). Ejecutado con `--no-test-assets` por el bloqueo de entorno descrito en la sección 6; sin ese flag, el armado del bundle de test cae en el mismo bloqueo. |
| 4 | `flutter build apk --flavor development -t lib/main_development.dart` | Exitoso (`--debug` y `--release`) |
| 5 | `applicationId` compilado exacto | Verificado con `aapt dump badging` sobre el APK release: `com.ridepro.app.dev` |
| 6 | Auditoría de aislamiento del APK | En modo `--release` (tree-shaken por punto de entrada, la prueba válida): APK Development contiene `ridepro-development`, cero referencias a `ridepro-dbafe` o al App ID/`applicationId` de Production; APK Production contiene `ridepro-dbafe`, cero referencias a `ridepro-development`, su App ID o `com.ridepro.app.dev`. (Nota: en modo `--debug`, el `kernel_blob.bin` — snapshot JIT no tree-shaken, usado para hot reload — mostró referencias cruzadas en ambas direcciones; confirmado como artefacto esperado del modo debug, no una fuga real, mediante análisis del grafo de imports del código fuente: `main.dart`→`environment_production.dart`→`firebase_options.dart` y `main_development.dart`→`environment_development.dart`→`firebase_options_development.dart`, sin ningún cruce en `lib/`.) |
| 7 | Production sin cambios | `git diff` de archivos de Production vacío; `flutter build apk --flavor production -t lib/main.dart` (`--debug` y `--release`) exitoso, mismo `applicationId` placeholder sin alterar |
| 8 | Escaneo silencioso de secretos/PII | OK en las 5 categorías (correos, `DATABASE_URL`, JWT/clave privada, ID de cuenta de facturación, `client_secret`). El `api_key` de la nueva app Android de Development está presente en `google-services.json`/`firebase_options_development.dart` — dato de cliente Firebase, no secreto de control de acceso por diseño, mismo patrón que el resto del repositorio. |
| 9 | Diff limitado a archivos autorizados | Confirmado — exactamente los 4 archivos funcionales |
| 10 | `feature/d2` idéntica antes y después | Confirmado — HEAD `7fe75a6`, 80 líneas locales, sin cambios |

---

## 6. Incidencias de entorno de esta máquina (no del código)

1. **Bloqueo de Control de Aplicaciones de Windows sobre `impellerc.exe`** (compilador de shaders del motor Flutter): reproducido de forma idéntica contra un worktree limpio de `origin/main` sin tocar, confirmando que no lo causó este bloque. Registros de `Microsoft-Windows-CodeIntegrity/Operational` (eventos 3033/3077) identificaron la causa exacta: proceso `dartvm.exe` intentando cargar `impellerc.exe`, bloqueado por Smart App Control (Policy ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`) por no cumplir el nivel de firma "Enterprise". Resuelto por el propietario activando Smart App Control (evaluación) y reiniciando Windows — confirmado sin nuevos eventos de bloqueo tras el reinicio.
2. **Límite de longitud de ruta de Windows en un build `--release`**: una ruta de salida de 273 caracteres (por la ubicación del worktree aislado bajo el directorio temporal de la sesión) excedió el límite clásico de 260. No relacionado con Code Integrity/AppLocker (sin eventos correlacionados). Resuelto compilando una copia de los archivos fuente (sin `.git`) en una ruta corta (`C:\Users\Usuario\AppData\Local\Temp\wt-android-dev`), únicamente para esta verificación — la rama y el worktree real nunca se movieron ni modificaron por esta causa.

---

## 7. Estado de Google Sign-In Android (Development)

**No validado — explícitamente pendiente.** Requiere SHA-1/SHA-256 del keystore de debug (y eventualmente de release), no generables desde este entorno (sin Android SDK de firma/keystore accesible). Pasos pendientes del propietario: generar la huella con `keytool` en su máquina/CI, cargarla en la configuración de la app Android ya registrada en Firebase Console, y solo entonces declarar Google Sign-In Android Development como validado.

---

## 8. Riesgos

| Riesgo | Severidad | Mitigación / estado |
|---|---|---|
| Build mezclando flavor `development` con `main.dart` (o viceversa) | Medio | Documentado explícitamente el comando combinado único válido; verificación automatizada en CI queda pendiente (ligada a Puerta H) |
| `applicationId` placeholder de Production sin resolver | Medio, preexistente | Documentado en profundidad (sección 3); Bloque 5C propuesto, no autorizado en este bloque |
| Google Sign-In Android Development no probado | Medio | Declarado explícitamente pendiente, no silenciado |
| Incidencias de entorno de esta máquina (Code Integrity, longitud de ruta) | Bajo, ya resueltas | Documentadas con causa raíz exacta; no bloquean CI (que usa runners con rutas cortas y sin esta política) |

---

## 9. Checklist de salida (resumen)

Arquitectura aprobada (diseño ya decidido por D3, mecanismo técnico ajustado por el hallazgo de la sección 3) ✅ · Alcance cumplido ✅ · Archivos modificados revisados (4 + documentación) ✅ · `git diff` auditado ✅ · `flutter analyze` sin issues nuevos ✅ · `flutter test` sin regresiones ✅ · Build APK verificado (`--release`, ambos flavors) ✅ · Seguridad revisada (aislamiento confirmado en modo release) ✅ · Secretos protegidos (escaneo silencioso, sin hallazgos) ✅ · Multiplataforma: Puerta E pasa a **parcial** para Development (Android registrado y compilado; Google Sign-In pendiente; iOS explícitamente fuera de este bloque) ⚠️ · Documentación actualizada (`PROJECT_STATUS.md` + este documento) ✅ · Riesgos pendientes registrados ✅ · Auditoría independiente: pendiente (autoauditado).

---

## 10. Próximo subbloque recomendado

Dos caminos independientes, ninguno autorizado todavía: (a) registrar SHA-1/SHA-256 de Android Development y validar Google Sign-In real, cerrando por completo la Puerta E para Development; (b) Bloque 5C — corregir el `applicationId` placeholder de Android Production, empezando por verificar disponibilidad de `com.ridepro.app` en Play Store antes de registrar la app nueva en Firebase.

---

**Detenido aquí. Sin push, sin PR, sin fusión — commits locales únicamente, en espera de autorización explícita.**
