# RidePro — Documento 11: Inventario y Plan de Separación de Firebase por Entornos
## Fase 1 de `T-F0.2`/`C1` — Modo auditoría, solo lectura

- **Fecha:** 2026-07-24
- **Alcance de esta tarea:** inventario completo + plan reversible. **Ningún cambio fue ejecutado.** No se creó ningún proyecto Firebase, no se tocó Firebase Console, no se desplegó ninguna regla, no se reemplazó ningún archivo de configuración, no se modificó código.
- **Verificación de cumplimiento:** `git status --short` al cierre de este documento muestra únicamente este archivo nuevo — cero cambios en `lib/`, `backend/`, `android/`, `ios/`, `web/`, `firebase.json`, `.firebaserc`, `firestore.rules`, ni ningún otro archivo de configuración.
- **Relación con la serie:** anexo posterior a la Auditoría Oficial v1.1, correspondiente a la Fase 0 de `MASTER_EXECUTION_PLAN.md` (`F0.2`, riesgo `C1`). No modifica ninguna prioridad, dependencia ni conclusión ya aprobada — los desarrolla al nivel de detalle de implementación que `F0.2` todavía no tenía.

---

# PARTE A — Inventario completo

## 1. Proyecto Firebase actual

| Dato | Valor | Evidencia |
|---|---|---|
| Project ID real (el que usan las apps) | `ridepro-dbafe` | `lib/firebase_options.dart`, `android/app/google-services.json`, `firebase.json` (bloque `flutter`) |
| Alias configurado en `.firebaserc` (`"default"`) | `demo-ridepro-security-tests` | `.firebaserc` |
| Number/Sender ID | `731660820861` | `lib/firebase_options.dart` |
| Auth domain | `ridepro-dbafe.firebaseapp.com` | `lib/firebase_options.dart` |
| Storage bucket (declarado, ver hallazgo 4.3) | `ridepro-dbafe.firebasestorage.app` | `lib/firebase_options.dart` |

**Hallazgo aclaratorio (no es un riesgo, pero genera confusión si no se documenta):** `.firebaserc` apunta por defecto a `demo-ridepro-security-tests`, un project ID **que no es un proyecto Firebase real** — está reservado deliberadamente para el modo 100% offline del Emulador (confirmado en el comentario de `firebase/seed/seed_emulator.js`: *"reservado por Firebase para uso 100% offline... Nunca toca el proyecto real `ridepro-dbafe`"*, y en `firebase/rules-tests/package.json`, script `test`: `firebase emulators:exec ... --project=demo-ridepro-security-tests`). El proyecto real que usan las apps (Android/Web/Windows) es `ridepro-dbafe`, tomado de `firebase_options.dart`, no del `.firebaserc` de la raíz. **Quien ejecute `firebase deploy` desde la raíz del repo sin `--project ridepro-dbafe` explícito, deployaría (si el proyecto existiera) contra un alias que no es ninguno de los dos entornos reales** — riesgo de confusión operativa, no de seguridad activa hoy (no hay ningún `firebase deploy` en CI ni documentado como flujo real, ver sección 6).

## 2. Servicios de Firebase habilitados y su estado real

| Servicio | Declarado en `pubspec.yaml` | Configurado en `firebase.json` | Consumidor real en código |
|---|---|---|---|
| Authentication | `firebase_auth: ^5.1.0` | Emulador sí (`auth`, puerto 9099); reglas de producción no aplica (Auth no tiene "rules" desplegables como Firestore) | ✅ Sí — 8/10 features (Documento 1 §1) |
| Firestore | `cloud_firestore: ^5.0.1` | ✅ Sí (`firestore.rules`, `firestore.indexes.json`, emulador puerto 8080) | ✅ Sí — perfil, historial de sesiones |
| Storage | `firebase_storage: ^12.1.0` | 🔴 **No declarado en `firebase.json`** — sin bloque `"storage"`, sin `storage.rules` en el repo (verificado, archivo ausente) | 🟡 Sin consumidor de negocio activo — único punto de código es el botón deshabilitado de `profile_page.dart` (`// TODO: subir foto vía Firebase Storage + image_picker`, ya documentado en Documento 2 §1.13) |
| Messaging (FCM) | `firebase_messaging: ^15.0.1` | No aplica (no tiene reglas desplegables) | ⚪ Sin consumidor (Documento 2 §1.16) |
| Analytics | `firebase_analytics: ^11.1.0` | No aplica | Transversal (SDK, sin verificación de eventos custom en esta pasada) |
| Crashlytics | `firebase_crashlytics: ^4.0.1` | No aplica | Transversal — capturado en `main.dart` (`FlutterError.onError`) |

**Hallazgo de riesgo — Storage sin reglas de seguridad versionadas:** si en el futuro se activa la subida de fotos de perfil (funcionalidad hoy incompleta, no un bug) sin antes crear y desplegar `storage.rules`, el bucket de Storage queda con el comportamiento por defecto de Firebase, que **deniega todo por defecto sin un archivo de reglas explícito solo si se configuró así al crear el bucket** — no hay forma de confirmar el estado real del bucket sin acceso a Firebase Console (fuera del alcance de esta auditoría de solo lectura sobre el repositorio). Se documenta como riesgo a verificar antes de habilitar Storage, no como vulnerabilidad confirmada.

## 3. Inventario de datos y usuarios

**Advertencia de alcance:** esta tarea es una auditoría de **repositorio**, sin credenciales ni acceso a Firebase Console/Firestore en vivo. Todo lo que sigue es el **esquema** de qué se almacena (deducido del código y de `firestore.rules`), no una consulta a los datos reales — no puedo confirmar cuántos usuarios reales existen hoy en `ridepro-dbafe`, ni el volumen de datos, sin acceso directo que no tengo en este modo de auditoría.

| Colección/documento | Contenido | Fuente |
|---|---|---|
| `users/{uid}` | Perfil: nombre, foto, FTP, peso, `premium`, `role`, `permissions`, `subscription`, `isAdmin`, `customClaims` (campos protegidos) | `firestore.rules`, Documento 1 §5 |
| `users/{uid}/ride_sessions/{sessionId}` | Historial de sesiones de entrenamiento, append-only | `firestore.rules` |
| Auth (usuarios) | Cuentas reales de Firebase Authentication (email/password, Google, Apple) | `lib/features/auth/` |

**Dato QA/emulador (no es un usuario real del proyecto):** `firebase/seed/seed_emulator.js` crea un usuario de prueba únicamente dentro del **Auth Emulator local** (`localhost:9099`), con `emailVerified: true` vía `firebase-admin` — este usuario **nunca existe en el proyecto real** `ridepro-dbafe`, confirmado por el propio comentario del script y por `process.env.FIREBASE_AUTH_EMULATOR_HOST` fijado antes de cualquier llamada al SDK.

**No verificable en esta auditoría:** número real de usuarios activos, volumen de documentos en `ride_sessions`, uso real de Storage/Analytics — requiere acceso a Firebase Console, fuera de este modo de solo lectura sobre el repositorio.

## 4. Archivos que configuran Firebase (inventario completo)

| Archivo | Rol | Trackeado en git |
|---|---|---|
| `.firebaserc` | Alias de proyecto para Firebase CLI | ✅ |
| `firebase.json` | Config de Firestore (rules/indexes), emuladores, y bloque `flutter` (usado por `flutterfire configure`) | ✅ |
| `firestore.rules` | Reglas de seguridad de Firestore — 106 líneas, ya auditadas (Documento 3 §4) | ✅ |
| `firestore.indexes.json` | 1 índice compuesto (`ride_sessions`, `startTime DESC`) | ✅ |
| `lib/firebase_options.dart` | Config de cliente por plataforma (`web`, `android`, `windows`) — **generado por FlutterFire CLI, no manual** | ✅ |
| `android/app/google-services.json` | Config nativa Android — **real**, `project_id: ridepro-dbafe` | ✅ |
| `ios/Runner/GoogleService-Info.plist` | Config nativa iOS — 🔴 **placeholder sin rellenar** (`YOUR_FIREBASE_PROJECT_ID`), ver hallazgo 4.1 | ✅ (el placeholder está commiteado tal cual) |
| `dart_define.local.json.example` | Plantilla de flags de cliente, incluye `USE_FIREBASE_EMULATORS` | ✅ (el `.example`; el real está gitignorado) |
| `lib/core/config/qa_emulator_config.dart` | Mecanismo de "doble candado" para activar el emulador | ✅ |
| `firebase/rules-tests/*` | Suite de tests de `firestore.rules` contra el emulador | ✅ |
| `firebase/seed/*` | Script de siembra de datos QA, solo emulador | ✅ |
| `firebase/scripts/backfill_user_roles.js` | Script de mantenimiento — **el único que toca el proyecto real con privilegios de Admin**, ver hallazgo 4.2 | ✅ |

### 4.1 — Hallazgo crítico nuevo: iOS no tiene Firebase configurado a nivel de código, no solo de plist

`lib/firebase_options.dart`, método `currentPlatform` (líneas 22-46):
```dart
case TargetPlatform.iOS:
  throw UnsupportedError(
    'DefaultFirebaseOptions have not been configured for ios - '
    'you can reconfigure this by running the FlutterFire CLI again.',
  );
```
No existe una constante `static const FirebaseOptions ios = ...` en todo el archivo — a diferencia de `web`, `android` y `windows`, que sí están definidas (líneas 49-75). Esto significa que **`Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform)` (`lib/main.dart`, llamada incondicional al arrancar) lanza una excepción no capturada en cualquier build/ejecución real en iOS**, antes de que la app llegue a mostrar ninguna pantalla — no es un problema acotado a un feature, es un bloqueo total de arranque en esa plataforma. Consistente con que `ios/Runner/GoogleService-Info.plist` (línea con `PROJECT_ID`) todavía tiene el valor placeholder `YOUR_FIREBASE_PROJECT_ID` sin rellenar: `flutterfire configure` nunca se ejecutó seleccionando iOS como plataforma de salida.

**Relación con esta tarea:** esto es un prerrequisito para la separación de entornos, no parte de ella — no tiene sentido decidir "qué app de iOS se registra en cada entorno" mientras iOS no tenga ninguna configuración de Firebase funcional en el código. Se documenta aquí porque apareció durante el inventario pedido explícitamente ("impacto en iOS"); **no se corrige en esta tarea** (modo auditoría, solo lectura). Recomendación: tratarlo como tarea propia del Backlog Maestro (candidato `T-NEW.2`), independiente de `T-F0.2`, con severidad **Alta** — bloquea cualquier build de iOS que llegue a `Firebase.initializeApp()`, es decir, bloquea el arranque completo de la app en iOS.

### 4.2 — Hallazgo: único punto de acceso Admin/privilegiado contra el proyecto real

`firebase/scripts/backfill_user_roles.js` es el **único archivo de todo el repositorio que opera con `firebase-admin` contra el proyecto real** (sin override de `FIRESTORE_EMULATOR_HOST`, a diferencia de `seed_emulator.js`). Requiere `GOOGLE_APPLICATION_CREDENTIALS` apuntando a una clave de cuenta de servicio descargada manualmente desde Firebase Console (instrucción en el propio script, líneas 14-17) — **ese archivo de clave no existe en el repositorio** (verificado: ningún archivo trackeado contiene `"type": "service_account"`), lo cual es correcto, pero **`.gitignore` no tiene ningún patrón específico para ese tipo de archivo** (solo cubre `*.env`, `key.properties`, `*.keystore`, `*.jks`, `dart_define.local.json` — ver `.gitignore` líneas 106-117). Si alguien descarga la clave con un nombre no cubierto por esos patrones (p. ej. `ridepro-dbafe-firebase-adminsdk-xxxxx.json`, el nombre por defecto que da Firebase Console) y la coloca dentro del repo, **no hay ninguna regla de `.gitignore` que la bloquee de un commit accidental**.

### 4.3 — Hallazgo: Windows usa la config de Web como placeholder (ya conocido, reconfirmado)

`lib/firebase_options.dart`, bloque `windows` (líneas 67-75): mismo `apiKey`, `authDomain`, `storageBucket` que `web`, con un `appId` propio (`1:731660820861:web:10f330e27c347846c16c14` — nótese que el `appId` en sí sigue el formato `:web:`, es decir, es literalmente la app Web registrada en Firebase Console, reutilizada). Ya documentado en Documento 1 §6 y Documento 6 §4 (`PLAT-4`/`M8`) — reconfirmado aquí sin cambios, sin builds de Windows para probarlo (proyecto nativo `windows/` no generado, `PLAT-2`).

## 5. Conexión con NestJS y PostgreSQL

**Cero conexión, confirmado de nuevo en esta pasada** (`grep -rli "firebase" backend/src backend/package.json backend/.env.example` → sin resultados). El backend NestJS tiene su propio sistema de identidad (JWT RS256 propio) sin ningún uso de Firebase Admin SDK, Firebase Auth, ni Firestore. Esto es exactamente el hallazgo `A1`/`H1` ya documentado — la separación de entornos de Firebase **no resuelve** ni **es resuelta por** el puente de autenticación pendiente (`T-F1.5`); son dos piezas de trabajo independientes que comparten el mismo proyecto Firebase como telón de fondo.

`backend/.env.example` sí tiene `GOOGLE_OAUTH_CLIENT_ID`/`APPLE_OAUTH_BUNDLE_ID` — pero son para verificación **server-side e independiente** de tokens de OAuth social (Google/Apple Sign-In), no para Firebase Admin SDK. Es una integración paralela con Google/Apple, no con Firebase.

## 6. Servicios externos relacionados (fuera de Firebase/NestJS)

| Servicio | Uso | Conexión con Firebase |
|---|---|---|
| Google Sign-In | Login social (cliente) | Provider de Firebase Auth |
| Sign in with Apple | Login social (cliente) | Provider de Firebase Auth |
| Google/Apple OAuth (server-side) | Verificación de token en el backend NestJS | Independiente — no pasa por Firebase |

Sin otros servicios externos (pasarela de pago, CDN, servicio de mapas, etc.) conectados a Firebase en el código inspeccionado.

## 7. Secretos y su manejo actual

| Secreto/config | Naturaleza | Dónde vive | Estado |
|---|---|---|---|
| `apiKey`/`appId`/`projectId` de Firebase (cliente) | **No es secreto por diseño** — protegido por Security Rules, no por ocultamiento (principio ya establecido, Documento 1 §5) | `firebase_options.dart`, `google-services.json`, versionados | ✅ Correcto tal como está |
| Credenciales QA del emulador | Secreto de desarrollo local | `firebase/seed/.env` (gitignorado), `.env.example` versionado | ✅ Correcto |
| `USE_FIREBASE_EMULATORS` | Flag, no secreto | `dart_define.local.json` (gitignorado), doble candado con `kDebugMode` | ✅ Correcto |
| Clave de cuenta de servicio (Admin SDK) | 🔴 Secreto de alto privilegio | Fuera del repo, vía `GOOGLE_APPLICATION_CREDENTIALS` | 🟡 Sin patrón de `.gitignore` dedicado (hallazgo 4.2) |
| CI (`ci.yml`) | Sin ningún secreto de Firebase referenciado — el job de `firestore-rules-tests` usa el emulador, no credenciales reales | `.github/workflows/ci.yml` | ✅ Correcto, sin superficie de secretos de Firebase en CI hoy |

## 8. Riesgos identificados al separar Development, Staging y Production

| # | Riesgo | Severidad | Notas |
|---|---|---|---|
| R1 | Migrar datos reales de usuarios de `ridepro-dbafe` a un proyecto "producción" nuevo, si se decide no usar `ridepro-dbafe` como producción | Alto (si aplica) | Ver Parte B, punto 1 — la recomendación evita este riesgo por diseño |
| R2 | Reemplazar `firebase_options.dart`/`google-services.json`/`GoogleService-Info.plist` con la config del entorno equivocado en un build de producción | Alto | Requiere mecanismo de selección explícito y verificable en CI, no solo en la máquina del desarrollador (ver Parte B, puntos 5 y 8) |
| R3 | Confusión entre el alias `demo-ridepro-security-tests` de `.firebaserc` y un futuro alias real de "desarrollo" — alguien podría asumir que ya existe separación cuando ese alias es solo del emulador | Medio | Ya documentado en sección 1; se resuelve con nomenclatura explícita en el plan (Parte B, punto 2) |
| R4 | Reglas de Firestore (`firestore.rules`) desplegadas al proyecto equivocado por error humano al correr `firebase deploy` sin `--project` explícito | Alto | Mitigable con `firebase target`/alias nombrados + confirmación obligatoria en CI (Parte B, punto 6) |
| R5 | Storage sin `storage.rules` versionado — si se habilita antes de crear las reglas, el comportamiento de seguridad del bucket queda fuera del control del repositorio | Medio | Ver hallazgo 2 |
| R6 | Clave de cuenta de servicio (Admin SDK) committeada por accidente, dado el gap de `.gitignore` (hallazgo 4.2) | Alto (si ocurre) | Mitigable de forma preventiva, aditiva, sin tocar nada más |
| R7 | iOS no arranca hoy con Firebase real (hallazgo 4.1) — cualquier plan de "registrar la app iOS en cada entorno" queda bloqueado hasta resolver esto primero | Alto | Prerrequisito, no parte de esta tarea |
| R8 | Costo/facturación no planificado al crear proyectos adicionales | Medio | Decisión de negocio del propietario, no técnica |

---

# PARTE B — Plan reversible de separación (propuesta, no ejecutada)

## 1. Qué función debe asumir el proyecto Firebase actual (`ridepro-dbafe`)

**Recomendación: `ridepro-dbafe` se convierte en el proyecto de PRODUCCIÓN**, no se abandona ni se recrea.

Justificación (comparación de alternativas, con la misma disciplina de "comparar y justificar" del resto de esta serie):
- **Opción A — `ridepro-dbafe` = producción (recomendada).** Es el proyecto que ya está referenciado en `google-services.json` (real, no placeholder) y en `firebase_options.dart` para Web/Android/Windows. Evita cualquier migración de datos existentes. Riesgo: si hoy ya hay datos de prueba mezclados con datos reales (Documento 1 §6, hallazgo ya conocido), esos datos de prueba quedan "heredados" en producción — se gestionan con una limpieza puntual (fuera del alcance de este documento), no con una migración de proyecto completa.
- **Opción B — `ridepro-dbafe` = desarrollo, crear un proyecto nuevo para producción.** Descartada: requeriría migrar cualquier dato real ya existente (si lo hay) a un proyecto nuevo, con mayor riesgo y esfuerzo que limpiar datos de prueba de uno ya existente. No hay evidencia de que valga la pena ese costo mayor.

## 2. Qué proyectos nuevos deben crearse

| Entorno | Project ID sugerido | ¿Es necesario un proyecto Firebase real (facturable)? |
|---|---|---|
| Producción | `ridepro-dbafe` (ya existe, sin crear nada) | — |
| Desarrollo | `ridepro-dev` (o `ridepro-development`) | Sí — nuevo |
| Staging (opcional, si se decide un 3er nivel) | `ridepro-staging` | Sí — nuevo, solo si el propietario decide que hace falta un nivel intermedio antes de producción (ver Documento 1 §6, la matriz de entornos ya contemplaba 4 niveles: dev/QA/staging/prod) |
| Pruebas automatizadas (rules-tests, CI) | `demo-ridepro-security-tests` (ya existe, sin crear nada — reservado por Firebase para emulador, no factura) | No — ya resuelto |

**Decisión pendiente del propietario, no técnica:** si el nivel "QA" (mencionado en Documento 1 §6 junto a dev/staging/prod) necesita su propio proyecto Firebase o puede compartir el de "Desarrollo" — se recomienda que QA comparta `ridepro-dev` inicialmente (mismo criterio anti-sobreingeniería del resto de la auditoría: no crear un proyecto Firebase adicional sin necesidad comprobada), y separarlo solo si en la práctica QA y desarrollo empiezan a interferirse entre sí.

## 3. Qué aplicaciones deben registrarse en cada entorno

| Plataforma | Producción (`ridepro-dbafe`) | Desarrollo (`ridepro-dev`) | Prerrequisito |
|---|---|---|---|
| Android | Ya registrada | Registrar app Android nueva | Ninguno |
| Web | Ya registrada | Registrar app Web nueva | Ninguno |
| iOS | No registrada (placeholder) | No registrada | 🔴 **Resolver primero el hallazgo 4.1** — sin esto, registrar la app en Firebase Console no serviría de nada, el código seguiría lanzando `UnsupportedError` antes de usar cualquier configuración |
| Windows | Usa la app Web como placeholder | Ídem, hasta que exista proyecto nativo | `PLAT-2` (generar `windows/`) primero |

## 4. Qué archivos se modificarían (cuando se autorice la ejecución — ninguno se toca en esta tarea)

| Archivo | Cambio previsto |
|---|---|
| `lib/firebase_options.dart` | Ya no sería un único archivo estático — pasaría a tener una variante por entorno (ver punto 5) |
| `android/app/google-services.json` | Un archivo por entorno, seleccionado en build time (Android product flavors) |
| `ios/Runner/GoogleService-Info.plist` | Un archivo por entorno, **una vez resuelto el hallazgo 4.1** |
| `.firebaserc` | Agregar alias nombrados explícitos (`production`, `development`, `staging`) apuntando a cada project ID real, en vez de un único `"default"` ambiguo |
| `firebase.json` | Agregar `"targets"` o configuración multi-proyecto para reglas/índices por entorno |
| `firestore.rules`/`firestore.indexes.json` | Sin cambio de contenido necesariamente — se despliegan por separado a cada proyecto, mismo archivo fuente |
| `storage.rules` (nuevo archivo, no existe hoy) | Crear antes de habilitar Storage en cualquier entorno |
| `.gitignore` | Agregar patrón para claves de cuenta de servicio (hallazgo 4.2) |
| `lib/core/config/` | Nuevo mecanismo de selección de entorno en build time (ver punto 8) — probablemente un archivo nuevo, análogo a `qa_emulator_config.dart` |
| `.github/workflows/ci.yml` | Si se agrega CD (fuera del alcance de `T-F0.2` en sí, pertenece a `C2`/`F1.2`), pasos que seleccionen el proyecto Firebase correcto por entorno de despliegue |

## 5. Cómo se manejarán flavors o configuraciones por ambiente

**Recomendación: Flutter flavors (Android product flavors + iOS schemes) + `flutterfire configure` por flavor**, no un único `firebase_options.dart` con `if` de entorno.

Justificación frente a la alternativa de "un solo `firebase_options.dart` con selección por `dart-define`":
- **Flavors (recomendado):** es el mecanismo nativo de Android/iOS para tener builds completamente separados (nombre de paquete, ícono, y configuración de Firebase distintos) — reduce a cero el riesgo de "seleccionar el entorno equivocado en runtime", porque la selección ocurre en **build time**, a nivel de comando (`flutter build apk --flavor production`), no de una condición que pueda evaluarse mal. FlutterFire CLI ya soporta generar `firebase_options_development.dart`/`firebase_options_production.dart` por flavor de forma nativa.
- **Alternativa descartada — selección por `dart-define` en runtime:** ya existe un precedente parcial de este patrón (`QaEmulatorConfig`, `kDebugMode && --dart-define`), pero ese mecanismo protege contra un caso distinto (emulador sí/no en debug), no reemplaza tener credenciales de proyecto realmente distintas compiladas en el binario — con `dart-define` puro, **el binario de producción seguiría conteniendo, en teoría, la capacidad de apuntar a cualquier proyecto** si el flag se calculara mal; con flavors, el binario de producción **físicamente no contiene** la configuración de desarrollo. Se descarta por ofrecer una garantía más débil para el mismo problema.

## 6. Cómo se separarán reglas, índices, Storage, Authentication y Functions

| Componente | Estrategia |
|---|---|
| Firestore rules (`firestore.rules`) | Mismo archivo fuente en el repo, desplegado por separado a cada proyecto vía `firebase deploy --only firestore:rules --project <alias>` — nunca "una regla distinta por entorno" salvo necesidad justificada (mismo criterio anti-sobreingeniería) |
| Índices (`firestore.indexes.json`) | Igual que reglas — mismo archivo, despliegue por proyecto |
| Storage | Crear `storage.rules` (no existe hoy) **antes** de habilitar Storage en cualquier entorno — mismo criterio deny-by-default ya usado en `firestore.rules` |
| Authentication | Cada proyecto tiene sus propios usuarios — no hay "regla" que desplegar, pero sí proveedores a habilitar por separado en cada proyecto (Email/Password, Google, Apple) vía Firebase Console (acción manual, fuera del alcance de este documento) |
| Functions | **No existen hoy** (`functions/` no está presente en el repo, verificado) — nada que separar todavía; si se crean en el futuro, seguirían el mismo patrón de despliegue por proyecto |

## 7. Cómo se protegerán los secretos

1. **Claves de cuenta de servicio (Admin SDK):** una por entorno, nunca en el repo — mismo patrón ya usado para las claves JWT del backend (`backend/secrets/*.pem`, gitignorado). Agregar a `.gitignore` un patrón explícito (p. ej. `*serviceAccount*.json`, `*firebase-adminsdk*.json`) — cierra el hallazgo 4.2 de forma aditiva, sin tocar nada más.
2. **CI/CD (cuando exista, `F1.2`):** credenciales de despliegue por entorno como secretos de GitHub Actions (`secrets.FIREBASE_SERVICE_ACCOUNT_DEV`, `..._PROD`, etc.), nunca en texto plano en el workflow.
3. **`apiKey`/`appId` de cliente:** sin cambios — siguen sin ser secretos por diseño, protegidos por Security Rules (principio ya vigente, correcto).

## 8. Cómo evitar conexiones accidentales a producción

Extender el patrón de "doble candado" ya validado en `QaEmulatorConfig` a la selección de entorno completa:

1. **Selección en build time (flavors), no en runtime** — ver punto 5, es la primera y más fuerte barrera.
2. **`kReleaseMode` como segunda barrera**, igual que hoy protege el modo debug/emulador: cualquier mecanismo de "forzar desarrollo" debe ser código muerto garantizado por el compilador en un build `--release`, igual que `QaEmulatorConfig` ya lo logra.
3. **CI verifica, no solo confía:** un paso de CI que confirme que un build etiquetado "producción" efectivamente referencia el `projectId` de producción (`ridepro-dbafe`) antes de publicarlo — un chequeo simple de texto sobre el artefacto generado, sin necesidad de infraestructura nueva.
4. **Nomenclatura sin ambigüedad:** eliminar el alias `"default"` ambiguo de `.firebaserc` (hallazgo, sección 1) en favor de alias nombrados explícitos — nadie debería poder ejecutar un comando de Firebase CLI sin especificar a qué entorno apunta.

## 9. Pruebas y criterios de aceptación

| Prueba | Criterio de aceptación |
|---|---|
| Build de desarrollo (`--flavor development`) | La app inicializa contra `ridepro-dev`, verificable leyendo el `projectId` real usado en runtime (log de depuración) |
| Build de producción (`--flavor production`) | La app inicializa contra `ridepro-dbafe`; el binario **no contiene** ninguna referencia compilada a `ridepro-dev` (verificable con `strings`/inspección del binario, o por diseño de flavors que ya lo garantiza) |
| Reglas de Firestore | Suite existente de `firebase/rules-tests` (28 casos) pasa igual contra cada proyecto real desplegado, además de contra el emulador |
| CI | El paso nuevo de verificación de `projectId` (punto 8.3) falla el build si detecta un cruce entorno/proyecto incorrecto |
| Regresión | `flutter analyze`, `flutter test`, suite de backend — 100% verde, sin relación directa con este cambio pero como puerta de calidad general del protocolo |

## 10. Rollback

Cada paso de ejecución (cuando se autorice) debe ser reversible de forma independiente:

| Acción | Cómo revertir |
|---|---|
| Crear proyecto Firebase nuevo (`ridepro-dev`) | Eliminar el proyecto desde Firebase Console — sin impacto en producción, es un proyecto aislado |
| Agregar flavors a Android/iOS | Revertir el commit — no afecta el flavor único existente hasta que se termine de migrar |
| Cambiar `.firebaserc` a alias nombrados | Revertir el commit — `"default"` sigue funcionando mientras tanto |
| Desplegar `firestore.rules`/`storage.rules` a un proyecto nuevo | Sin impacto en `ridepro-dbafe` — proyectos Firebase son completamente aislados entre sí por diseño de la plataforma |
| Agregar patrón a `.gitignore` | Revertir el commit — cambio puramente aditivo |

**No hay ningún paso de este plan, tal como está diseñado, que requiera tocar `ridepro-dbafe` (producción) antes de que todo lo demás esté validado en desarrollo primero** — el rollback más simple posible es, en la mayoría de los pasos, simplemente no continuar al siguiente.

---

## Cierre

**Este documento es un plan para aprobación, no una ejecución.** Contiene un hallazgo nuevo relevante (4.1, iOS sin Firebase configurado a nivel de código) descubierto durante el inventario, documentado y no corregido, según el modo de solo lectura de esta tarea. Quedo a la espera de tu autorización antes de ejecutar cualquier parte de la Parte B.
