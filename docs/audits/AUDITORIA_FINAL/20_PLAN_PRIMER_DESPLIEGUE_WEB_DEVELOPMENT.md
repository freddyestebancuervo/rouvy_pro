# RidePro — Documento 20: Plan del Primer Despliegue Web (Development, Canal Preview)
## Fase de Análisis y Diseño — sin ejecución

- **Fecha:** 2026-07-25
- **Rol:** Lead Software Engineer / Software Architect / DevOps Engineer / Auditor Técnico / Security Engineer / Release Manager
- **Estado de esta tarea:** Solo análisis, diseño y documentación. **Cero cambios ejecutados** — sin build, sin deploy, sin registro de apps, sin `flutterfire configure`, sin modificación de `firebase.json`/`.firebaserc`/`firebase_options.dart`/`main.dart`/`web/index.html`, sin `git add`/`git commit`.
- **Verificación de cumplimiento:** este documento es la única adición al repositorio en esta tarea — `git status --short` al cierre debe mostrarlo como único archivo nuevo.
- **Fuente de verdad del estado del proyecto:** `PROJECT_STATUS.md` (raíz del repositorio) — este documento lo referencia, no lo duplica.
- **Documentos base (no alterados, solo referenciados y, en un punto puntual, corregidos por ambigüedad interna — ver §2.7):** `11_PLAN_SEPARACION_FIREBASE.md`, `15_PLAN_PARTE_B_SEPARACION_ENTORNOS_FIREBASE.md`, `17_CIERRE_FIRESTORE_RIDEPRO_DEVELOPMENT.md`, `19_AUDITORIA_AUTHENTICATION_RIDEPRO_DEVELOPMENT.md`, `RIDEPRO_DEVELOPMENT_PROTOCOL.md`.
- **Estándar:** este documento sigue el formato oficial obligatorio fijado en el Documento 15 §15 (matriz de riesgos profesional, criterios Go/No-Go, checklist de salida, veredicto).

---

## 1. Resumen ejecutivo

### 1.1 Objetivo

Diseñar, sin ejecutar, el primer despliegue de RidePro Web contra el proyecto Firebase `ridepro-development`, publicado **únicamente** en un canal Preview de Firebase Hosting (`web-dev`), nunca directamente en `live`, con separación de configuración por entorno resuelta en **compilación**, no en tiempo de ejecución.

### 1.2 Contexto que resuelve

La verificación de solo lectura de Firebase Hosting (turnos anteriores de esta misma sesión) confirmó:
- `https://ridepro-development.web.app` responde `404 Site Not Found`, incluso con caché forzada a `MISS`.
- `firebase.json` nunca ha tenido sección `hosting` (confirmado contra `HEAD` y contra los dos commits que lo tocaron).
- `.firebaserc` apunta a `demo-ridepro-security-tests` (ni `ridepro-development` ni `ridepro-dbafe`), sin bloque `targets`.
- No hay ninguna app Web (ni de ningún tipo) registrada en `ridepro-development` (`firebase apps:list` → "No apps found").
- `build/web` existe localmente (compilado 2026-07-24 18:10:18 -05:00) pero usa `lib/firebase_options.dart`, cuyo bloque `web` apunta a `projectId: 'ridepro-dbafe'` (Producción) — **inválido para este propósito** (ver D20-5).
- No existe ninguna versión pública funcional de RidePro que deba preservarse (confirmado por el propietario).

### 1.3 Relación con el Documento 15

Este documento **no reabre** el diseño general de separación de entornos (Android/iOS/Windows/backend/PostgreSQL) ya cubierto por el Documento 15 — se limita a la porción **Web** de ese diseño, aterrizándola a nivel de implementación concreta y corrigiendo una ambigüedad puntual detectada en Doc 15 §3.4 (ver §2.7 de este documento). Firestore de `ridepro-development` ya fue cerrado y aprobado en el Documento 17 — este plan no lo reabre (ver D20-6).

---

## 2. Decisiones oficiales registradas (aprobadas por el propietario, 2026-07-25)

| # | Decisión | Resolución oficial |
|---|---|---|
| D20-1 | Mecanismo de selección de entorno Web | **Build-time puro, sin `if` runtime.** `lib/firebase_options_development.dart` + punto de entrada independiente `lib/main_development.dart`, compilado con `flutter build web --target lib/main_development.dart`. `QaEmulatorConfig` se mantiene únicamente para activar emuladores en debug — nunca para seleccionar proyecto Firebase real. |
| D20-2 | Alias y target | Alias de proyecto Firebase: `development`. Target de Hosting: `development`. Sin dependencia del alias `default`. Mapeo explícito target → sitio `ridepro-development`. |
| D20-3 | Nombre visible de la app Web | `RidePro Web (Development)` |
| D20-4 | Canal Preview | `web-dev`, expiración 7 días, reutilizable/renovable. Prohibido publicar directamente en `live` en esta fase. |
| D20-5 | Build existente (`build/web`) | **INVÁLIDO PARA DEVELOPMENT Y NO REUTILIZABLE** — contiene configuración de `ridepro-dbafe`. Antes del build futuro autorizado: verificar contenido, eliminar únicamente `build/web`, build limpio desde `main_development.dart`, auditar el nuevo artefacto antes de desplegarlo. **No se elimina nada en esta tarea de diseño.** |
| D20-6 | Firestore y Storage | Firestore de `ridepro-development` ya cerrado y aprobado (Doc 17) — **no se redespliega** `firestore.rules`/`firestore.indexes.json` en este plan; solo se **verifica** que las reglas existentes permiten `users/{uid}`. Storage permanece como subfase independiente, pendiente de aprobación — no se mezcla con este despliegue Web. Las funcionalidades que dependan de Storage se marcan No aplicable/Bloqueado hasta esa subfase. |

### 2.7 Corrección de ambigüedad detectada en Documento 15 §3.4

Doc 15 §3.4 (Web) describe el mecanismo como `flutter build web --dart-define=ENVIRONMENT=<env>` combinado con `firebase_options_<flavor>.dart`. Esa redacción, aislada, admite una lectura donde `ENVIRONMENT` se evalúa con un `if` en Dart en tiempo de ejecución — lo cual **contradice el propio principio rector que el mismo Documento 15 fija en §4.3**: *"nunca usar runtime/`dart-define` para decidir a qué proyecto Firebase o backend apunta un build — eso siempre se decide en build time"*.

D20-1 resuelve esta ambigüedad a favor de la interpretación estricta de §4.3, con un mecanismo más fuerte que el literal de §3.4: un **entry point Dart completamente independiente** (`main_development.dart`) que solo importa y usa `firebase_options_development.dart`, seleccionado mediante `--target` de Flutter (una decisión del compilador/comando de build, no una rama de código). El binario de Development, en este diseño, **no contiene en su código ninguna referencia textual ni ejecutable** a `ridepro-dbafe` — la garantía la da la ausencia física del símbolo en el árbol compilado, no una condición que decida entre dos configuraciones presentes ambas en el mismo binario.

Esta corrección se documenta aquí; **no se modifica el archivo del Documento 15**.

---

## 3. Fase 1 — Estado actual (evidencia consolidada de esta sesión)

| Ítem | Evidencia | Fuente |
|---|---|---|
| `ridepro-development.web.app` | `404 Site Not Found`, reproducido con `Cache-Control: no-cache` (`X-Cache: MISS`) — no es un artefacto de caché | Verificación HTTP directa, turno anterior |
| `firebase.json` | Sin clave `hosting` en working tree ni en `HEAD` ni en ningún commit que lo tocó (`e7f1793`, `7b5a238`) | `git show HEAD:firebase.json`, `git log --oneline -- firebase.json` |
| `.firebaserc` | `{"projects":{"default":"demo-ridepro-security-tests"}}`, sin `targets` | `cat .firebaserc`, `firebase use` |
| Apps registradas en `ridepro-development` | "No apps found" (4ª verificación consistente, incluyendo la de esta sesión y las 3 previas registradas en Doc 17 §5) | `firebase apps:list --project ridepro-development` |
| `build/web` | Compilado `2026-07-24 18:10:18 -05:00`; `version.json`: `app_name: rouvy_pro, version 0.1.0, build 1`; gitignorado (`/build/` en `.gitignore`, línea 50) | `stat`, lectura de `version.json` |
| `lib/firebase_options.dart` (bloque `web`) | `projectId: 'ridepro-dbafe'`, `authDomain: 'ridepro-dbafe.firebaseapp.com'`, `appId: '1:731660820861:web:09812a8dd64a0e06c16c14'` | Lectura directa del archivo |
| `lib/core/config/social_login_config.dart` | Un único `googleWebClientId` global (`731660820861-3jkse9...`), mismo número de proyecto que `ridepro-dbafe` | Lectura directa |
| `lib/main.dart` | Inicializa con `DefaultFirebaseOptions.currentPlatform` (fijo, sin selección de entorno) | Lectura directa |
| `web/index.html` | Sin meta tag `google-signin-client_id` — retirado a propósito (comentario explícito: evita doble-inicialización de Google Identity Services) | Lectura directa |
| Patrón de entorno ya existente en el repo | `QaEmulatorConfig`: `bool.fromEnvironment('USE_FIREBASE_EMULATORS')` + doble candado `kDebugMode` — precedente válido solo para emuladores, no para selección de proyecto real (D20-1) | Lectura directa |
| Dominios autorizados de Authentication | **No verificable por CLI de solo lectura** — `firebase-tools` no expone lectura de `authorizedDomains`; requiere Firebase Console | Limitación declarada, no asumida |
| Firestore de `ridepro-development` | Ya desplegado y aprobado (`firestore.rules` + `firestore.indexes.json`, región `southamerica-east1`) | Documento 17 |
| Storage/Authentication de `ridepro-development` | Pendientes, fuera de alcance de este documento (D20-6) | Documento 17 §7, ítems 8-9 |

---

## 4. Fase 2 — Arquitectura propuesta

### 4.1 App Web en `ridepro-development`

- Registro **previo** a generar cualquier configuración (Fase 3, paso 1) — no puede existir `firebase_options_development.dart` real sin que la app exista primero en la consola/proyecto.
- Nombre visible: `RidePro Web (Development)` (D20-3).
- App ID esperado: formato `1:1020003121433:web:<hash>` — el prefijo `1020003121433` es el **Project Number** de `ridepro-development`, ya confirmado en el Documento 17 §1 (distinto del `731660820861` de `ridepro-dbafe` — esta diferencia de prefijo es, en sí misma, la primera señal verificable de que no hay cruce de proyecto). El hash final lo asigna Firebase al registrar la app — no se puede predecir antes de ejecutar.

### 4.2 `lib/firebase_options_development.dart` + `lib/main_development.dart`

```
lib/
├── main.dart                        (sin cambios — sigue siendo Producción)
├── main_development.dart             (NUEVO — entry point exclusivo de Development)
├── firebase_options.dart             (sin cambios — sigue apuntando a ridepro-dbafe)
└── firebase_options_development.dart (NUEVO — generado, apunta solo a ridepro-development)
```

`main_development.dart` es una copia estructural de `main.dart` que:
- Importa `firebase_options_development.dart` en vez de `firebase_options.dart`.
- Llama `Firebase.initializeApp(options: DefaultFirebaseOptionsDevelopment.currentPlatform)` (o el nombre de clase que genere FlutterFire CLI para este target) — **sin ningún `if`/`switch` entre proyectos**.
- Conserva intacto el resto del bootstrap (Crashlytics, `runZonedGuarded`, `QaEmulatorConfig` para emuladores si se activa explícitamente con `--dart-define=USE_FIREBASE_EMULATORS=true`, que sigue siendo un uso legítimo de dart-define porque no decide *cuál proyecto* sino *si se usa el emulador local del proyecto ya fijado por el entry point*).

Compilación:
```
flutter build web --target lib/main_development.dart
```

**Garantía de diseño:** el árbol de símbolos compilado a partir de `main_development.dart` nunca importa `firebase_options.dart` (Producción) — no hay forma de que el bundle JS resultante contenga el `projectId`/`appId` de `ridepro-dbafe`, porque ese archivo nunca entra en el grafo de compilación de ese target.

### 4.3 Google Web Client ID de Development (por entorno, sin valor global)

`SocialLoginConfig` pasa de un valor único a una constante por archivo de configuración de entorno, resuelta también en build-time vía el entry point:

```dart
// lib/core/config/social_login_config_development.dart (NUEVO, diseño de referencia)
abstract class SocialLoginConfigDevelopment {
  static const String googleWebClientId = '<CLIENT_ID_DE_DEVELOPMENT>'; // pendiente de generar (Fase 3, paso 3)
}
```

`main_development.dart` (vía la capa de inyección de dependencias, `core/di/injection.dart`) referencia `SocialLoginConfigDevelopment.googleWebClientId`, nunca `SocialLoginConfig.googleWebClientId` (Producción). El valor real del Client ID de Development no existe todavía — se genera en Google Cloud Console del proyecto `ridepro-development` cuando se registre la app Web (Fase 3, paso 1), como consecuencia automática de habilitar el proveedor Google en Authentication.

### 4.4 `firebase.json` — sección `hosting` propuesta (diseño, no aplicado)

```json
{
  "hosting": {
    "target": "development",
    "public": "build/web",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

- `"target": "development"` — nunca un `"site"` implícito ni el sitio por defecto sin nombrar.
- `"public": "build/web"` — el directorio real que Flutter Web genera; hoy no está referenciado por ninguna configuración (confirmado en Fase 1).
- `"rewrites"` — SPA rewrite obligatorio: cualquier ruta no encontrada como archivo estático se sirve como `/index.html`, requisito de cualquier app Flutter Web con `GoRouter`/navegación por rutas (confirmado como parte del `app/app.dart` de RidePro).
- `"ignore"` — exclusiones estándar de Firebase Hosting; ninguna carpeta adicional identificada como necesaria de excluir (no hay `.env` ni secretos dentro de `build/web`, que es contenido 100% compilado y estático).

### 4.5 `.firebaserc` — alias explícitos propuestos (diseño, no aplicado)

```json
{
  "projects": {
    "development": "ridepro-development"
  },
  "targets": {
    "ridepro-development": {
      "hosting": {
        "development": ["ridepro-development"]
      }
    }
  }
}
```

**Nota de diseño explícita:** este bloque **no elimina** `"default": "demo-ridepro-security-tests"` unilateralmente — esa entrada pertenece a un alcance distinto (emulador local, Documento 15 §3.0) y su remoción no fue solicitada en esta tarea. El diseño solo **agrega** el alias `development`, sin tocar `default`. Si en la ejecución futura se decide remover `default`, esa es una decisión adicional a confirmar en su momento, no asumida aquí.

### 4.6 Mapeo target Hosting → sitio `ridepro-development`

El sitio `ridepro-development` **ya existe** (confirmado con `firebase hosting:sites:list` en el turno anterior — es el sitio por defecto, auto-creado junto con el proyecto). No se requiere `firebase hosting:sites:create` — solo aplicar el mapeo target→sitio:

```
firebase target:apply hosting development ridepro-development --project ridepro-development
```

Este comando **escribe en `.firebaserc`** (es el único mecanismo oficial para poblar el bloque `targets` con la sintaxis correcta) — se documenta aquí como parte del diseño de la Fase 3, pero no se ejecuta en esta tarea.

### 4.7 SPA rewrite y exclusiones

Ya incluido en 4.4 — `rewrites: [{"source": "**", "destination": "/index.html"}]`. Sin excepciones adicionales identificadas (RidePro Web no sirve ningún asset fuera de `build/web` que requiera una regla de rewrite distinta, p. ej. no hay API propia servida desde el mismo dominio de Hosting).

### 4.8 Canal Preview `web-dev`

```
firebase hosting:channel:deploy web-dev --project ridepro-development --expires 7d
```

- Nombre: `web-dev` (D20-4).
- Expiración: 7 días, renovable re-ejecutando el mismo comando (Firebase extiende la expiración en cada deploy al mismo canal, no crea uno nuevo).
- URL temporal esperada (formato estándar de Firebase, patrón determinístico aunque el sufijo exacto lo asigna Firebase): `https://ridepro-development--web-dev-<sufijo-aleatorio>.web.app`.
- **Prohibido en esta fase:** `firebase deploy --only hosting` sin `--only hosting:channel` (eso publicaría directo a `live`) y `firebase hosting:channel:deploy live` (equivalente a publicar en producción del sitio).

### 4.9 Puerta de seguridad del artefacto — verificación negativa y positiva

Paso obligatorio antes de cualquier publicación (Fase 3, paso 10), ejecutable como comando de solo lectura sobre el directorio de salida:

**Verificación negativa (el build DEBE fallar la publicación si aparece cualquiera de estos):**
```
grep -r "ridepro-dbafe" build/web/
grep -r "ridepro-dbafe.firebaseapp.com" build/web/
grep -r "731660820861" build/web/
grep -r "731660820861-3jkse9cbmat7bl4nk9ig9qj2728cv2r9" build/web/   # Google Web Client ID de Producción
```
Cualquier coincidencia → **detener, no publicar, investigar** (probablemente indica que se compiló `main.dart` en vez de `main_development.dart`, o que el entry point importó accidentalmente `firebase_options.dart`).

**Verificación positiva (el build DEBE contener esto):**
```
grep -r "ridepro-development" build/web/
grep -r "1020003121433" build/web/      # Project Number de Development (Documento 17 §1)
grep -r "<APP_ID_WEB_DEVELOPMENT>" build/web/     # a completar cuando se registre la app (Fase 3, paso 1)
grep -r "<GOOGLE_CLIENT_ID_DEVELOPMENT>" build/web/  # a completar cuando se genere (Fase 3, paso 3)
```
Ausencia de cualquiera de estos → **detener, no publicar** (indica que el build no incluyó realmente la configuración de Development).

Nota: `main.dart.js` es un bundle minificado; los strings literales (API keys, project IDs, client IDs) sobreviven la minificación sin ofuscar porque `firebase_core`/`google_sign_in` los consumen como valores, no como identificadores de código — el `grep` es válido y suficiente, no requiere desminificar.

### 4.10 Estrategia anti-caché y service worker

1. **Build limpio:** eliminar `build/web` completo antes de generar el nuevo build (D20-5) — un `flutter build web` incremental sobre un `build/web` de otro entry point puede dejar artefactos mixtos (`flutter_service_worker.js` referenciando hashes de assets antiguos).
2. **Preview con URL nueva:** cada `hosting:channel:deploy` a `web-dev` genera una URL con un `version` interno nuevo en el CDN de Firebase — no reutiliza cache de `live` (que ni siquiera tiene contenido hoy).
3. **Prueba en ventana privada obligatoria:** la primera verificación manual (Fase 3, paso 12) se hace en una ventana de navegador privada/incógnito, para eliminar cualquier `flutter_service_worker.js` o caché de Service Worker de una visita anterior a ese mismo origen (aplica sobre todo si se re-despliega al mismo canal `web-dev` más de una vez).
4. **Verificación de versión publicada:** comparar `build/web/version.json` (local, recién generado) contra el `version.json` servido por la URL del canal Preview (`curl <preview-url>/version.json`) — deben coincidir en `build_number`/timestamp de compilación antes de dar por válida la prueba manual.

### 4.11 Rollback del Preview

- **Eliminar el canal antes de su expiración natural:**
  ```
  firebase hosting:channel:delete web-dev --project ridepro-development
  ```
- **O dejarlo expirar** (7 días, D20-4) sin acción adicional — Firebase lo desactiva automáticamente, sin dejar contenido servible.
- **Cero cambios en `live`:** ningún paso de este plan escribe en el canal `live` de `ridepro-development` — el rollback de un canal Preview no tiene ningún efecto sobre `live` porque nunca lo tocó (son namespaces de release independientes dentro del mismo sitio).

---

## 5. Fase 3 — Orden de ejecución futuro (13 micro-pasos)

### Paso 1 — Registrar app Web en `ridepro-development`
- **Objetivo:** crear la app Web `RidePro Web (Development)` en el proyecto, obteniendo Project Number/App ID reales.
- **Comandos previstos:** `firebase apps:create web "RidePro Web (Development)" --project ridepro-development`.
- **Archivos afectados:** ninguno todavía (acción en el proyecto Firebase, no en el repo).
- **Riesgos:** R6 (App ID registrado en el entorno incorrecto) — mitigado verificando `--project` explícito antes de confirmar.
- **Evidencia:** salida del comando con el App ID nuevo; `firebase apps:list --project ridepro-development` mostrando la app.
- **Rollback:** eliminar la app desde Firebase Console (acción reversible, sin impacto en otras apps ni en `ridepro-dbafe`).
- **Criterio Go/No-Go:** Project Number de la respuesta debe ser `1020003121433` (el de `ridepro-development`, Documento 17) — si no coincide, detener y no continuar al paso 2.
- **Autorización requerida:** Sí, explícita, antes de ejecutar (acción no destructiva pero creadora de recurso real).

### Paso 2 — Generar `firebase_options_development.dart`
- **Objetivo:** obtener la configuración oficial de FlutterFire para la app recién registrada.
- **Comandos previstos:** `flutterfire configure --project=ridepro-development --out=lib/firebase_options_development.dart --platforms=web` (limitado a `web` explícitamente, para no tocar Android/iOS/Windows en esta tarea).
- **Archivos afectados:** `lib/firebase_options_development.dart` (nuevo).
- **Riesgos:** que el CLI sobrescriba `lib/firebase_options.dart` (Producción) si no se pasa `--out` correctamente — mitigado verificando el nombre del archivo generado antes de continuar.
- **Evidencia:** diff del archivo nuevo mostrando `projectId: 'ridepro-development'`.
- **Rollback:** eliminar el archivo nuevo; `firebase_options.dart` no se toca por este comando si `--out` se usó correctamente.
- **Criterio Go/No-Go:** el archivo generado debe contener `ridepro-development` y el Project Number `1020003121433`; **debe fallar la aprobación de este paso si contiene `ridepro-dbafe` en cualquier forma**.
- **Autorización requerida:** Sí.

### Paso 3 — Verificar Project ID, App ID y OAuth Client ID
- **Objetivo:** confirmar en Firebase Console → Authentication → Google que el "Web client ID" generado corresponde al proyecto `ridepro-development`, no uno heredado de `ridepro-dbafe`.
- **Comandos previstos:** ninguno automatizable — verificación manual en Console (no existe lectura CLI de OAuth Client IDs de Authentication).
- **Archivos afectados:** ninguno.
- **Riesgos:** confundir el Client ID de Development con el de Producción al copiarlo.
- **Evidencia:** captura o transcripción del Client ID exacto desde Console.
- **Rollback:** no aplica (solo lectura).
- **Criterio Go/No-Go:** el Client ID debe tener un prefijo numérico distinto a `731660820861` (el de Producción).
- **Autorización requerida:** No (solo lectura), pero el valor obtenido alimenta el paso 5.

### Paso 4 — Crear configuración por entorno (entry point)
- **Objetivo:** crear `lib/main_development.dart` según el diseño de §4.2.
- **Archivos afectados:** `lib/main_development.dart` (nuevo).
- **Riesgos:** divergencia accidental respecto a `main.dart` si se edita luego solo uno de los dos (mismo riesgo que cualquier duplicación de bootstrap — mitigado documentando explícitamente en el propio archivo que es un espejo intencional de `main.dart`, ver comentario de por qué en el archivo mismo).
- **Evidencia:** `flutter analyze` sin nuevos errores sobre el archivo nuevo.
- **Rollback:** eliminar el archivo.
- **Criterio Go/No-Go:** el archivo no debe importar `firebase_options.dart` (verificable con `grep -n "firebase_options.dart'" lib/main_development.dart` → debe devolver 0 resultados, solo debe importar `firebase_options_development.dart`).
- **Autorización requerida:** Sí (modifica el repositorio).

### Paso 5 — Corregir `SocialLoginConfig` sin hardcodear un único Client ID global
- **Objetivo:** crear `lib/core/config/social_login_config_development.dart` (§4.3) con el Client ID obtenido en el paso 3, y ajustar `core/di/injection.dart` para que `main_development.dart` resuelva ese valor en vez del de Producción — sin introducir un `if` de entorno en `injection.dart` (la resolución debe seguir viniendo del entry point, no de una condición interna).
- **Archivos afectados:** `lib/core/config/social_login_config_development.dart` (nuevo), posible ajuste mínimo de `core/di/injection.dart` si hoy importa `SocialLoginConfig` de forma no parametrizable (a confirmar leyendo el archivo real en el momento de ejecutar este paso — no auditado en profundidad en este documento de diseño).
- **Riesgos:** introducir sin querer una rama runtime en `injection.dart` — prohibido por D20-1; el diseño correcto es que sea `main_development.dart` quien decida qué configuración inyecta, no `injection.dart` quien pregunte en qué entorno está.
- **Evidencia:** `flutter analyze` en verde; revisión manual de que no exista ningún `if (environment == ...)` nuevo.
- **Rollback:** revertir el archivo nuevo y el ajuste puntual de `injection.dart`.
- **Criterio Go/No-Go:** cero ramas condicionales de entorno en código compartido entre `main.dart` y `main_development.dart`.
- **Autorización requerida:** Sí.

### Paso 6 — Configurar Hosting y alias explícitos
- **Objetivo:** aplicar el diseño de §4.4-§4.6: agregar sección `hosting` a `firebase.json`, ejecutar `firebase target:apply hosting development ridepro-development --project ridepro-development` (agrega el bloque `targets` a `.firebaserc`), agregar el alias `development` → `ridepro-development` en `.firebaserc`.
- **Archivos afectados:** `firebase.json`, `.firebaserc`.
- **Riesgos:** R3 (deploy al proyecto incorrecto) — mitigado por el propio propósito de este paso (eliminar la ambigüedad).
- **Evidencia:** `cat .firebaserc` mostrando el bloque `targets` nuevo; `firebase hosting:sites --project ridepro-development` (o equivalente) confirmando el mapeo.
- **Rollback:** revertir ambos archivos (cambios aditivos sobre JSON, sin pérdida de las claves ya existentes como `firestore`/`storage`/`flutter`/`emulators`).
- **Criterio Go/No-Go:** `firebase.json` debe seguir siendo JSON válido y conservar intactas las secciones `firestore`/`storage`/`emulators`/`flutter` ya existentes.
- **Autorización requerida:** Sí.

### Paso 7 — Ejecutar `flutter analyze`
- **Objetivo:** confirmar que los archivos nuevos (`main_development.dart`, `firebase_options_development.dart`, `social_login_config_development.dart`) no introducen errores ni warnings nuevos.
- **Comandos previstos:** `flutter analyze`.
- **Archivos afectados:** ninguno (solo lectura/análisis estático).
- **Riesgos:** ninguno propio — es una puerta de calidad.
- **Evidencia:** salida completa del comando, 0 issues nuevos respecto a la línea base actual.
- **Rollback:** no aplica.
- **Criterio Go/No-Go:** `flutter analyze` en verde (mismo estándar que `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §3.11, ya vigente).
- **Autorización requerida:** No (verificación), pero un resultado en rojo bloquea el paso 8.

### Paso 8 — Ejecutar `flutter test`
- **Objetivo:** confirmar que la suite completa sigue en verde tras los cambios de los pasos 4-6.
- **Comandos previstos:** `flutter test`.
- **Archivos afectados:** ninguno.
- **Riesgos:** ninguno propio.
- **Evidencia:** resultado `All tests passed` (o el conteo exacto vigente, p. ej. el "166/166" ya referenciado en el historial de commits del repo).
- **Rollback:** no aplica.
- **Criterio Go/No-Go:** suite en verde, sin excepción — regla ya vigente (§3.11 del protocolo).
- **Autorización requerida:** No (verificación), bloquea el paso 9 si falla.

### Paso 9 — Generar build Web Development limpio y reproducible
- **Objetivo:** producir el artefacto real a publicar.
- **Comandos previstos:**
  ```
  rm -rf build/web    # eliminar el build inválido de D20-5, únicamente esa carpeta
  flutter build web --target lib/main_development.dart
  ```
- **Archivos afectados:** `build/web/**` (generado, gitignorado, no versionado).
- **Riesgos:** que quede algún artefacto de un build anterior si no se limpia — mitigado por el `rm -rf build/web` explícito antes de compilar.
- **Evidencia:** salida de `flutter build web` sin errores; `build/web/version.json` con timestamp nuevo.
- **Rollback:** eliminar `build/web` de nuevo — no es contenido versionado, cero impacto en el repositorio.
- **Criterio Go/No-Go:** build exitoso, sin warnings de compilación nuevos.
- **Autorización requerida:** Sí (es el primer build real de este plan).

### Paso 10 — Auditar el contenido del artefacto (puerta de seguridad)
- **Objetivo:** ejecutar las verificaciones negativa y positiva de §4.9 contra `build/web` recién generado.
- **Comandos previstos:** los 4 `grep` negativos + los 4 `grep` positivos de §4.9.
- **Archivos afectados:** ninguno (solo lectura).
- **Riesgos:** falso negativo si el `grep` no cubre todas las variantes de string relevantes — mitigado listando explícitamente las 4 cadenas críticas conocidas (§4.9), ampliable si aparece una nueva credencial relevante.
- **Evidencia:** salida completa de los 8 comandos, adjunta al informe de cierre de esta fase.
- **Rollback:** no aplica (auditoría de solo lectura); si falla, no se avanza al paso 11 (no hay "rollback" de una publicación que aún no ocurrió).
- **Criterio Go/No-Go:** **0 coincidencias** en los 4 `grep` negativos y **coincidencia positiva** en los 4 `grep` positivos — cualquier desviación detiene el plan antes del paso 11, sin excepción.
- **Autorización requerida:** No (verificación), pero es bloqueante — ningún despliegue procede sin este paso en verde.

### Paso 11 — Publicar únicamente a un canal Preview
- **Objetivo:** desplegar `build/web` al canal `web-dev` de `ridepro-development`, nunca a `live`.
- **Comandos previstos:** `firebase hosting:channel:deploy web-dev --project ridepro-development --expires 7d`.
- **Archivos afectados:** ninguno del repositorio (acción contra el proyecto Firebase).
- **Riesgos:** R2 (build de un entorno servido en el canal equivocado) — mitigado por el paso 10 ya aprobado, y por usar siempre `--project ridepro-development` explícito (nunca el alias `default`, que hoy ni siquiera es este proyecto).
- **Evidencia:** URL del canal Preview devuelta por el comando; `curl` a esa URL confirmando `200 OK` y contenido de RidePro (no "Site Not Found").
- **Rollback:** `firebase hosting:channel:delete web-dev --project ridepro-development`, o dejar expirar (§4.11).
- **Criterio Go/No-Go:** respuesta `200` en la URL del canal, `version.json` coincide con el build local (§4.10, punto 4).
- **Autorización requerida:** ⛔ **Sí, explícita, sin excepción** — es el primer paso de este plan que publica contenido real accesible externamente.

### Paso 12 — Pruebas manuales en el canal Preview
- **Objetivo:** validar el flujo completo antes de considerar Development "probado".
- **Checklist de prueba** (en ventana privada/incógnito, §4.10 punto 3):
  - [ ] Carga de la app (sin pantalla en blanco, sin error de consola de Firebase init)
  - [ ] Navegación entre pantallas (SPA rewrite funcionando — recargar una ruta interna no debe dar 404)
  - [ ] Registro Email/Password
  - [ ] Login Email/Password
  - [ ] Logout
  - [ ] Google Sign-In (usando el Client ID de Development verificado en el paso 3)
  - [ ] Creación de documento `users/{uid}` en Firestore (verificable en Firebase Console → Firestore de `ridepro-development`, o con `firebase firestore:get` de solo lectura si el CLI lo soporta para el documento esperado)
  - [ ] Reglas Firestore no bloquean el flujo esperado (ya desplegadas, Documento 17 — este paso solo **verifica**, no redespliega, conforme a D20-6)
  - [ ] Consola del navegador sin errores no esperados (warnings conocidos y ya documentados, como el de doble-init de Google Identity Services que `web/index.html` ya mitigó, quedan excluidos de este criterio)
  - [ ] Diseño responsive (desktop y viewport móvil vía DevTools)
  - [ ] **Funciones dependientes de Storage:** marcar explícitamente como **No aplicable / Bloqueado** (D20-6) — no se prueban en esta fase.
- **Archivos afectados:** ninguno.
- **Riesgos:** R10 (confusión de entorno si el tester no usa la URL del canal Preview exacta).
- **Evidencia:** captura o registro de cada ítem del checklist, marcado explícitamente ✅/❌/N-A.
- **Rollback:** no aplica (pruebas de solo lectura sobre el Preview); cualquier hallazgo de bug se documenta como incidencia, no se corrige silenciosamente dentro de esta fase.
- **Criterio Go/No-Go:** todos los ítems aplicables en ✅ antes de considerar avanzar al paso 13.
- **Autorización requerida:** No (verificación), pero es la puerta de entrada al paso 13.

### Paso 13 — Solicitar autorización para `live`
- **Objetivo:** una vez el paso 12 esté 100% en verde (excluyendo los ítems marcados N/A por Storage), presentar un informe de cierre y **solicitar explícitamente** autorización del propietario para publicar en `live` — nunca asumida.
- **Archivos afectados:** ninguno todavía.
- **Riesgos:** ninguno propio (es una solicitud, no una acción).
- **Evidencia:** el informe de cierre de esta fase, con el checklist del paso 12 adjunto.
- **Rollback:** no aplica.
- **Criterio Go/No-Go:** paso 12 completo.
- **Autorización requerida:** ⛔ **Sí, explícita — este documento no la otorga por adelantado, ni siquiera condicionalmente.**

---

## 6. Fase 4 — Matriz de riesgos obligatorios

| ID | Riesgo | Probabilidad | Impacto | Severidad | Mitigación | Contingencia |
|---|---|---|---|---|---|---|
| R1 | Build Development apuntando a Producción | Media (ya ocurrió una vez: `build/web` actual) | Crítico | **Crítico** | D20-1: entry point independiente sin `if` runtime; puerta de seguridad negativa (§4.9, paso 10) | Eliminar `build/web`, recompilar desde `main_development.dart`, repetir paso 10 |
| R2 | Google Web Client ID cruzado (Dev usando el de Prod o viceversa) | Media (hoy es un único valor global) | Alto | **Alto** | §4.3: constante separada por entorno, resuelta desde el entry point, sin fallback compartido | Corregir el valor en `social_login_config_development.dart`, recompilar, repetir pasos 10-11 |
| R3 | Deploy al proyecto default incorrecto | Media (el alias `default` hoy es `demo-ridepro-security-tests`, ni Dev ni Prod) | Alto | **Alto** | `--project ridepro-development` explícito en todo comando (nunca depender de `default`); alias `development` dedicado (D20-2) | Verificar `--project` antes de cada comando; si ya se ejecutó, identificar qué proyecto recibió el cambio y revertir ahí |
| R4 | Publicar un build antiguo/desactualizado | Baja (build limpio obligatorio, paso 9) | Medio | **Medio** | `rm -rf build/web` antes de cada build (§4.10 punto 1); verificación de `version.json` (§4.10 punto 4) | Recompilar y republicar al mismo canal (Preview es reemplazable sin costo) |
| R5 | Service worker sirviendo una versión anterior en el navegador del tester | Media (comportamiento por defecto de Service Workers) | Bajo | **Bajo** | Prueba obligatoria en ventana privada (§4.10 punto 3) | Hard-refresh / limpiar Service Workers del origen en DevTools |
| R6 | Secretos o IDs incorrectos (App ID, Client ID, Project Number cruzados) | Baja (con verificación de 5 puntos ya validada en iOS Producción, Documento 13) | Alto | **Medio** | Verificación explícita de Project Number (`1020003121433` vs `731660820861`) en pasos 1-3 y en la puerta de seguridad (paso 10) | Eliminar la app mal configurada desde Console, repetir el registro |
| R7 | SPA routing roto (404 al recargar una ruta interna) | Media (si se omite el rewrite) | Medio | **Medio** | `rewrites` obligatorio en `firebase.json` (§4.4/§4.7), verificado explícitamente en el checklist de pruebas (paso 12) | Corregir `firebase.json`, redesplegar al mismo canal Preview |
| R8 | Caché CDN sirviendo contenido obsoleto o la página "Site Not Found" ya observada | Baja (cache-busting ya demostrado efectivo en la verificación previa de esta sesión) | Bajo | **Bajo** | Canal Preview genera una URL/versión nueva por diseño (§4.10 punto 2); verificación con `curl` antes de la prueba manual | Repetir el deploy al canal; si persiste, purgar con una nueva expiración/relanzamiento del canal |
| R9 | Canal Preview convertido accidentalmente en `live` | Baja (requiere un comando distinto y explícito) | Crítico | **Alto** | Prohibición expresa (§8) de `firebase deploy --only hosting` y de cualquier variante que publique a `live` en esta fase; único comando autorizado es `hosting:channel:deploy web-dev` | Si ocurriera, `firebase hosting:rollback` o eliminar el release de `live` inmediatamente vía Console/CLI, y notificar al propietario sin demora |
| R10 | Reglas Firestore incompatibles con el flujo Web probado | Baja (reglas ya desplegadas y aprobadas, Documento 17) | Medio | **Bajo-Medio** | Este plan solo **verifica** (paso 12), no modifica reglas (D20-6) — si el flujo falla por reglas, es un hallazgo a documentar, no una corrección silenciosa dentro de esta fase | Abrir un documento de auditoría específico para la corrección de reglas, con su propio ciclo de aprobación (no se toca `firestore.rules` desde este plan) |
| R11 | Usuarios de prueba creados en Producción por error de configuración | Baja (mitigado por R1/R3 ya cubiertos) | Crítico | **Alto** | Consecuencia directa de que R1 y R3 tengan mitigación fuerte — si ambas se cumplen, es estructuralmente imposible que un build de Development escriba en `ridepro-dbafe` | Si ocurriera pese a las mitigaciones: identificar los documentos de usuario de prueba en `ridepro-dbafe` por patrón conocido (mismo criterio que el `seed_emulator.js` ya usado, Documento 15 §5/R1) y eliminarlos manualmente, nunca con un script masivo automático contra producción |

---

## 7. Fase 5 — Checklist de salida del diseño

| # | Ítem | Estado |
|---|---|---|
| 1 | Arquitectura aprobada | ✅ D20-1 a D20-6 aprobadas explícitamente por el propietario, 2026-07-25 |
| 2 | App Web identificada | ✅ Nombre visible (`RidePro Web (Development)`) y Project Number de destino (`1020003121433`) confirmados; App ID real pendiente de generarse en la Fase 3, paso 1 |
| 3 | Separación Development/Production diseñada | ✅ Entry points independientes (`main.dart` / `main_development.dart`), sin `if` runtime — §4.2 |
| 4 | Client ID por entorno diseñado | ✅ §4.3 — pendiente solo el valor real, a obtener en Fase 3 paso 3 |
| 5 | Aliases/targets diseñados | ✅ §4.5/§4.6 — alias `development`, target `development`, mapeo a sitio `ridepro-development` ya existente |
| 6 | Hosting Preview diseñado | ✅ Canal `web-dev`, 7 días, renovable — §4.8 |
| 7 | Rollback | ✅ §4.11 (Preview) y rollback específico por paso en la sección 5 |
| 8 | Pruebas E2E previstas | ✅ Checklist de 11 puntos en el paso 12 (10 aplicables + 1 explícitamente N/A por Storage, conforme D20-6) |
| 9 | Seguridad revisada | ✅ Puerta de seguridad negativa/positiva del artefacto (§4.9), obligatoria antes de publicar |
| 10 | Riesgos registrados | ✅ 11 riesgos obligatorios, todos con mitigación y contingencia — sección 6 |
| 11 | Cero cambios ejecutados | ✅ Único archivo nuevo en esta tarea: este documento — verificar con `git status --short` |

---

## 8. Prohibiciones expresas de esta tarea (cumplidas)

No se ejecutó ninguno de los siguientes comandos ni acciones durante la redacción de este documento:
- `firebase deploy --only hosting`
- `firebase hosting:channel:deploy`
- `flutterfire configure`
- `flutter build web`
- Registro de apps (`firebase apps:create`)
- Modificación de `firebase.json`, `.firebaserc`, `lib/firebase_options.dart`, `lib/main.dart`, `web/index.html`
- `git add` / `git commit`

Estas mismas prohibiciones aplican integralmente a cada micro-paso de la sección 5 hasta que reciba su autorización explícita individual — ninguna autorización general de "aprobar el diseño" implica autorización para ejecutar la Fase 3.

---

## 9. Veredicto

**⚠️ LISTO CON DECISIONES PENDIENTES**

El diseño arquitectónico completo (D20-1 a D20-6, más la corrección de ambigüedad de Doc 15 §3.4) está cerrado y aprobado. Quedan pendientes, todas ellas **valores concretos que solo se obtienen al ejecutar la Fase 3** (no decisiones de arquitectura):
- App ID Web real de `ridepro-development` (paso 1).
- Google Web Client ID real de Development (pasos 1/3).
- Confirmación manual de dominios autorizados en Authentication (fuera del alcance de CLI, requiere Console — no bloquea el diseño, sí bloquea la ejecución del paso 12, ítem Google Sign-In).

Ninguna de estas pendencias requiere una nueva decisión del propietario sobre *cómo* diseñar el despliegue — son datos que surgen naturalmente de ejecutar los pasos 1-3, ya autorizados a nivel de diseño y a la espera de autorización de ejecución real.

**Detenido aquí. A la espera de tu autorización para iniciar la Fase 3 (ejecución real).**
