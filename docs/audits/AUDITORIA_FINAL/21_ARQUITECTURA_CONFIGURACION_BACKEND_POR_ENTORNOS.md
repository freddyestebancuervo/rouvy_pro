# RidePro — Documento 21: Arquitectura de Configuración por Entornos (Backend NestJS + servicios futuros)
## Fase 0 — Análisis, diseño y planificación (sin ejecución)

- **Fecha:** 2026-07-26
- **Rol:** Arquitecto de Software Senior / Líder Técnico
- **Estado de esta tarea:** Solo análisis, diseño arquitectónico y planificación. **Cero cambios ejecutados** — sin archivos modificados, sin `git add`/commit/push, sin tocar Firebase, sin nuevas funcionalidades.
- **Origen:** priorizado por el propietario tras la auditoría del módulo de Entrenamientos (hallazgo: `ApiConfig.backendBaseUrl` hardcodeado a `http://localhost:3000/v1` para todo build Web, sin excepción — bloquea estructuralmente cualquier feature que dependa del backend NestJS propio en cualquier entorno desplegado real).
- **Relación con documentos previos:** extiende, sin contradecir, las decisiones ya aprobadas en el Documento 15 (D1/D2: `ridepro-dbafe` = Producción; 3 proyectos Firebase — Development/Staging/Production, QA comparte Development) y el patrón de selección de entorno 100% build-time ya implementado para Firebase (`main.dart`/`main_development.dart`, Documentos 19-20).

---

## 1. Resumen ejecutivo

`ApiConfig.backendBaseUrl` es hoy la única pieza de configuración de todo RidePro que **no** sigue el principio ya validado en este proyecto ("selección de entorno 100% en build time, nunca runtime"). Es una constante fija a `localhost`, documentada por el propio código como deuda técnica, y es la causa raíz confirmada (Documento de auditoría de Entrenamientos, sección A) de que cualquier feature que dependa del backend propio (Workouts hoy, Equipment/rutas/telemetría/IA/sync a futuro) falle en todo entorno que no sea la máquina del desarrollador.

Este documento diseña una arquitectura de configuración **unificada** — no una solución puntual para `backendBaseUrl`, sino la misma abstracción que también gobierna Firebase, extendida para cubrir cualquier servicio HTTP presente o futuro, en los 5 niveles de entorno que pediste, para las 4 plataformas del proyecto.

**Recomendación en una frase:** extender el mecanismo de entry-points ya aprobado para Firebase (compile-time, sin `if` de runtime) hacia una clase `AppEnvironment` única que agrupe *toda* la configuración dependiente de entorno — Firebase incluido —, complementada (no reemplazada) por `--dart-define`/`--dart-define-from-file` **solo** para secretos y overrides locales no estructurales, exactamente como ya se usa hoy para `QA_BACKEND_EMAIL`/`USE_FIREBASE_EMULATORS`.

---

## 2. Auditoría de la infraestructura actual (evidencia)

| Componente | Archivo | Hallazgo |
|---|---|---|
| `ApiConfig` | `lib/core/network/api_config.dart` | `backendBaseUrl` fijo a `http://localhost:3000/v1` (Web/iOS) o `http://10.0.2.2:3000/v1` (Android). Ya documentado como deuda técnica en el propio archivo. Sin ninguna rama por entorno |
| `main.dart` | `lib/main.dart` | Entry point de Producción. Inicializa Firebase con `DefaultFirebaseOptions.currentPlatform` y pasa `SocialLoginConfig.googleWebClientId` a `initDependencyInjection` — **no pasa nada relacionado con el backend**, `injection.dart` sigue leyendo `ApiConfig.backendBaseUrl` como global estático |
| `main_development.dart` | `lib/main_development.dart` | Entry point de Development (creado en esta misma sesión). Mismo patrón, mismo vacío respecto al backend |
| `firebase_options.dart` / `firebase_options_development.dart` | `lib/` | Ya siguen el patrón correcto: un archivo `const` por entorno, sin selección runtime. **Este es el patrón a reutilizar**, no a sustituir |
| `injection.dart` | `lib/core/di/injection.dart` | `initDependencyInjection({required String? googleWebClientId})` ya demuestra el patrón correcto de inyección explícita (sin lectura de constante global) — implementado en esta misma sesión para el Client ID de Google. `backendBaseUrl`, en cambio, **no** pasa por este mecanismo: `createAuthlessBackendDio`/`createAuthenticatedBackendDio` (`backend_dio_client.dart:6-10`) leen `ApiConfig.backendBaseUrl` directamente, sin parámetro |
| `QaEmulatorConfig` | `lib/core/config/qa_emulator_config.dart` | Precedente real de `bool.fromEnvironment` + doble candado `kDebugMode`, ya en uso — mecanismo correcto para *flags*, no para identidad de entorno |
| `DevBackendTestUser` | `lib/core/config/dev_backend_test_user.dart` | Precedente real de `String.fromEnvironment` + `--dart-define-from-file=dart_define.local.json` para **secretos** (usuario QA contra el backend real) — nunca hardcodeados, nunca en git |
| `dart_define.local.json.example` | raíz del repo | Convención ya establecida y documentada: un archivo JSON local, gitignorado, con claves como `QA_BACKEND_EMAIL`/`USE_FIREBASE_EMULATORS` |
| Backend (`backend/.env.example`) | `backend/` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS` — el backend mismo ya tiene su propia configuración por entorno (`.env`), completamente separada e independiente de la del cliente Flutter (correcto, no hay que unificarlas) |
| Variables de entorno del SO (`Platform.environment`) | — | No usadas hoy en el cliente — **correcto que no se usen**: no existen en Flutter Web (sin proceso, sin acceso a variables de entorno del sistema operativo desde el navegador) |
| Windows | `lib/core/network/*` | Sin ninguna referencia específica a Windows — el mismo `ApiConfig.backendBaseUrl` se usaría tal cual (rama `else` genérica), ya wired correctamente a nivel de código, solo falta que el entorno de configuración lo cubra |

**Conclusión de la auditoría:** RidePro ya tiene, hoy, **dos mecanismos de configuración por entorno correctos y en producción activa** (entry-points para Firebase; `dart-define`/`dart-define-from-file` para secretos/flags). El problema no es la ausencia de un patrón — es que `backendBaseUrl` quedó fuera de ambos. La solución correcta es extender los patrones existentes, no inventar un tercero.

---

## 3. Requisitos de la arquitectura (recordatorio, para trazabilidad)

Debe soportar Local Development / Development / QA-Testing / Staging / Production; Web + Android + iOS + Windows; cero cambio de código fuente entre despliegues; ningún módulo debe conocer URLs específicas; una única fuente de verdad; extensible a nuevos servicios (rutas, telemetría, IA, sync, CDN, media) sin rediseño.

---

## 4. Alternativas evaluadas

| Alternativa | Ventajas | Desventajas | Rendimiento | Mantenibilidad | Despliegue | Seguridad |
|---|---|---|---|---|---|---|
| **A — `--dart-define` individual por valor** (uno por URL) | Simple para 1-2 valores; ya usado en el proyecto (`USE_FIREBASE_EMULATORS`) | No escala a 5 entornos × N servicios (docenas de flags en cada comando de build); fácil olvidar uno y que el build "compile" con un valor vacío/default silencioso | Óptimo — `const`, resuelto en compilación, cero costo en runtime | Baja a partir de ~5 valores — comandos de build kilométricos, propenso a error humano | Requiere que CI/CD arme el comando completo cada vez, alto riesgo de typos | Bueno para secretos individuales, pero no aporta nada para URLs no sensibles |
| **B — `--dart-define-from-file` (un JSON grande con todo)** | Un solo archivo por entorno, ya hay precedente (`dart_define.local.json`); legible | Mezclar secretos reales (contraseñas QA) con configuración no sensible (URLs públicas) en el mismo archivo termina obligando a proteger como secreto algo que no lo es, o a exponer un archivo que si contiene secretos | Óptimo — igual que A | Media — mejor que A, pero un solo archivo JSON por entorno es fácil de desalinear entre Android/iOS/Web si no se referencia desde un único lugar | Debe copiarse/generarse por CI para cada entorno — mismo problema de gestión de secretos que ya tiene el proyecto para QA, ahora multiplicado ×5 | Débil si se usa para *todo* — un archivo de config con URLs públicas no necesita el mismo tratamiento de secreto que uno con contraseñas, y mezclarlos generalmente termina bajando el nivel de protección del que sí lo necesita |
| **C — Archivos de configuración compilados en el árbol (extensión del patrón `firebase_options_*.dart`)** — 🟢 recomendada | Reutiliza un patrón ya aprobado y probado en este mismo proyecto; el compilador garantiza que un binario de un entorno **físicamente no contiene** los valores de otro (no es una promesa, es una propiedad del árbol de imports, igual que ya demostramos con `ridepro-dbafe`/`ridepro-development`); cero dependencias nuevas | Requiere un entry point (`main_X.dart`) por identidad de entorno que de verdad importa aislar (no por cada combinación posible) | Óptimo — igual que A/B, sin overhead de parseo de JSON en runtime | Alta — un archivo `const` por entorno, mismo patrón ya usado y entendido por el equipo; sin código generado, sin build_runner | Cada entorno es un target de build explícito (`--target lib/main_X.dart`) — igual de simple de automatizar en CI que las alternativas A/B, pero sin comandos kilométricos | La mejor — nada que no deba estar en un binario puede terminar ahí, por construcción, no por disciplina |
| **D — Configuración leída en runtime** (asset JSON embebido + selector por variable, o remote config) | Un solo binario "universal", cambiar de entorno sin recompilar | **Rechazada explícitamente ya en este proyecto** (Documento 15 §4.3, decisión ya tomada para Firebase): un binario que puede "convertirse" en cualquier entorno según un dato que lee es un binario de Producción con la capacidad teórica de apuntar a cualquier otro lado — el peor caso de R2 (build de un entorno con config de otro) deja de ser "imposible por diseño" y pasa a ser "posible si algo falla en la lectura del dato" | Leve costo de parseo al arrancar (marginal) | Aparenta ser más simple, pero reintroduce exactamente el riesgo que ya eliminamos para Firebase — inconsistente con el resto de la arquitectura | Atractivo para "cambiar de entorno sin recompilar", pero eso es una desventaja disfrazada de ventaja para una app que sí distingue Producción de todo lo demás | La más débil — el binario de Producción contendría, físicamente, los datos/lógica para apuntar a Staging/QA/Dev también |
| **E — Variables de entorno del sistema operativo** (`Platform.environment`) | Ninguna aplicable aquí | No existen en Flutter Web (sin proceso en el navegador) — descalifica automáticamente por el requisito #3 (debe funcionar en Web) | N/A | N/A | N/A | N/A |
| **F — Paquete `flutter_dotenv`** (`.env` leído en runtime como asset) | Popular, fácil de empezar | Es la Alternativa D con otro nombre — el `.env` se empaqueta *dentro* de cada binario y se lee en runtime; incluso si el `.env` "correcto" se selecciona en build time, el archivo entero (con los 5 entornos, si se gestiona mal) puede terminar embebido en todos los binarios | Leve overhead de I/O + parseo al arrancar | Depende de disciplina del equipo para no commitear `.env` reales — mismo riesgo que ya se decidió evitar | Fácil de romper en CI (archivo faltante = fallo silencioso en algunos casos) | Débil — incluso usado "bien", es runtime, no compile-time |
| **G — Paquete `envied`** (genera constantes Dart desde `.env` en build time vía `build_runner`) | Sí es compile-time (más cercano a C que a D/F); autogenera getters tipados | Introduce `build_runner` + anotaciones + un paso de generación de código para resolver algo que ya resolvemos con clases `const` simples, sin herramientas nuevas; una dependencia más que mantener actualizada | Óptimo, igual que C | Media-Alta, pero con una curva de herramienta nueva que el equipo tendría que aprender sin necesidad | Añade un paso de build (`build_runner build`) a cada pipeline | Buena, comparable a C, pero sin ventaja real sobre C para este caso |

---

## 5. Arquitectura recomendada

### 5.1 Principio rector (heredado, no nuevo)

*"La identidad de entorno se decide en build time, nunca en runtime — la garantía la da el compilador (qué se importa), no una condición evaluada en ejecución."* Ya es la regla vigente del proyecto (Documento 15 §4.3, Documento 20 D20-1). Este documento la extiende de "solo Firebase" a "toda configuración dependiente de entorno".

### 5.2 `AppEnvironment` — la única fuente de verdad

```dart
// lib/core/config/app_environment.dart (diseño de referencia, NO implementado)
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

/// Única fuente de verdad de configuración dependiente de entorno. Ningún
/// módulo de la app conoce URLs directamente — todo pasa por una instancia
/// de esta clase, inyectada explícitamente desde el entry point.
class AppEnvironment {
  const AppEnvironment({
    required this.name,
    required this.firebaseOptions,
    required this.googleSignInWebClientId,
    required this.backendBaseUrl,
    // Futuro (NO agregado hoy — ver sección 5.5): routesApiBaseUrl,
    // telemetryApiBaseUrl, aiApiBaseUrl, syncApiBaseUrl, cdnBaseUrl,
    // mediaStorageBaseUrl. Cada uno, cuando exista el servicio real, se
    // agrega como un campo más aquí — nunca como una constante nueva
    // suelta en otro archivo.
  });

  final String name;
  final FirebaseOptions firebaseOptions;
  final String? googleSignInWebClientId;
  final String backendBaseUrl;
}
```

Cada entorno que constituye una **identidad real y aislada** (ver 5.3) tiene su propio archivo `const AppEnvironment` — mismo patrón que `firebase_options_development.dart` hoy.

### 5.3 Reconciliación de tus 5 niveles con las 3 identidades Firebase ya aprobadas (Documento 15 D2)

Pediste 5 niveles (Local Development / Development / QA-Testing / Staging / Production). El Documento 15 ya decidió, con tu aprobación, **3 proyectos Firebase** (Development compartido con QA, Staging, Production). Estas dos decisiones **no están en conflicto** si se reconoce que "identidad de entorno" (qué proyecto Firebase, qué Client ID — un límite de seguridad real) y "a qué backend le hablo hoy" (una URL, no un límite de seguridad) son ejes independientes:

| Nivel pedido | Entry point (identidad Firebase) | `backendBaseUrl` |
|---|---|---|
| **Local Development** | `main_development.dart` (Firebase `ridepro-development`) | `http://localhost:3000/v1` — **default**, overridable por `--dart-define` (ver 5.4) |
| **Development** | `main_development.dart` (mismo) | URL del backend de Development ya desplegado (pendiente de `T-F1.1`, Documento 15 §4.5) |
| **QA/Testing** | `main_development.dart` (mismo, D2 ya aprobado: QA comparte Development) | URL del backend de QA si se decide uno separado, o la misma de Development — **pendiente de tu decisión de producto**, no técnica |
| **Staging** | `main_staging.dart` (nuevo, Firebase `ridepro-staging` — aún no creado, Documento 15 Fase 8) | URL del backend de Staging |
| **Production** | `main.dart` (Firebase `ridepro-dbafe`) | URL del backend de Producción |

**Por qué esto es mejor que 5 entry points:** Local Development y Development comparten exactamente la misma identidad de seguridad (mismo proyecto Firebase, mismo Client ID) — la única diferencia real es una URL no sensible. Forzar un 4º/5º entry point solo para eso sería sobre-ingeniería (mismo criterio anti-sobreingeniería ya aplicado en todo el proyecto): más archivos que mantener sin una ganancia de seguridad real. QA queda resuelto automáticamente por la misma razón — ya se decidió que comparte Development.

**Punto que requiere tu decisión, no la tomo yo:** si QA/Testing necesita un backend *desplegado* distinto al de Development (para no interferir con datos de desarrollo activo), eso es una URL distinta en la config de ese nivel, no un proyecto Firebase distinto — perfectamente soportado por este diseño sin cambiarlo.

### 5.4 Override local — solo para `backendBaseUrl`, nunca para Firebase

```dart
// lib/core/config/backend_config_resolver.dart (diseño de referencia)
String resolveBackendBaseUrl(AppEnvironment environment) {
  const String override = String.fromEnvironment('BACKEND_BASE_URL_OVERRIDE');
  return override.isEmpty ? environment.backendBaseUrl : override;
}
```

Mismo mecanismo que `QaEmulatorConfig`/`DevBackendTestUser` ya usan (`--dart-define-from-file=dart_define.local.json`, agregando la clave `BACKEND_BASE_URL_OVERRIDE` al archivo ya existente — **sin crear un segundo archivo de secretos**). Deliberadamente **no existe un override equivalente para `firebaseOptions`** — ese es exactamente el límite que no debe cruzarse nunca vía `dart-define`, por la misma razón ya validada en el Documento 20.

### 5.5 Extensibilidad a futuros servicios (requisito #7) — demostración, no implementación

Cuando exista, por ejemplo, la API de rutas real:
```dart
// Cambio futuro, ilustrativo — NO se implementa en esta tarea:
class AppEnvironment {
  const AppEnvironment({
    // ...campos actuales...
    required this.routesApiBaseUrl,   // ← el único cambio estructural
  });
  final String routesApiBaseUrl;
}
```
Un campo nuevo en la clase, un valor nuevo en cada uno de los ~3-4 archivos de entorno (`environment_development.dart`, `environment_staging.dart`, `environment_production.dart`) — **cero cambios en `injection.dart`, en el árbol de imports, ni en el mecanismo de selección**. Esto cumple literalmente el requisito #7: agregar servicios sin volver a modificar la arquitectura.

### 5.6 Compatibilidad multiplataforma (requisito #3)

- **Web/Windows:** ambas usan `--target lib/main_X.dart` (Windows no tiene "flavors" nativos, mismo hallazgo ya documentado en el Documento 15 §3.5) — sin cambios respecto al mecanismo ya validado para Web en esta sesión.
- **Android:** los product flavors ya diseñados en el Documento 15 §3.2 (`development`/`staging`/`production`) deben pasarse **junto con** `--target lib/main_X.dart` en el mismo comando/configuración de build — **riesgo real a documentar** (sección 7): flavor y target son dos flags independientes en Flutter; nada impide, hoy, ejecutar `--flavor production --target lib/main_development.dart` por error humano. Mitigación propuesta (sin implementar aún): centralizar los comandos válidos en scripts (`Makefile`/`melos`/tareas de VS Code) en vez de exigir que cada desarrollador los recuerde de memoria.
- **iOS:** mismo mecanismo, vía Schemes/`.xcconfig` (Documento 15 §3.3) + `--target`, mismo riesgo y mitigación que Android.

### 5.7 Refactor necesario, no opcional: extraer el bootstrap compartido

`main.dart` y `main_development.dart` hoy duplican ~60 líneas idénticas de arranque (runZonedGuarded, Crashlytics, DI, sync). Escalar a 3-5 entry points **sin** extraer esa lógica multiplicaría la duplicación — exactamente el tipo de deuda que este modo de trabajo pide evitar proactivamente. Propuesta:

```dart
// lib/app/bootstrap.dart (diseño de referencia, NO implementado)
Future<void> bootstrapRideProApp(AppEnvironment environment) async {
  // Todo el cuerpo actual de main()/main_development(), parametrizado por
  // `environment` en vez de leer constantes globales.
}

// lib/main_development.dart pasaría a ser, literalmente:
Future<void> main() => bootstrapRideProApp(developmentEnvironment);
```
Cada `main_X.dart` queda en ~3 líneas — el único lugar donde de verdad importa que sean archivos separados es la referencia a `environment`, que es lo que el compilador usa para decidir qué se incluye en el árbol.

---

## 6. Por qué esta arquitectura y no otra (justificación)

1. **Cero dependencias nuevas** — reutiliza Dart puro, ya en uso.
2. **Cero deuda añadida** — de hecho *elimina* deuda ya documentada (`ApiConfig`) y deuda oculta (duplicación de bootstrap).
3. **Consistente con decisiones ya tomadas y validadas en producción de este mismo proyecto** — no es una teoría nueva, es la misma que ya pasó por diseño, implementación, auditoría y build real para Firebase.
4. **Escala a los 5 niveles pedidos sin forzar 5 identidades de seguridad** — reconcilia el pedido de hoy con el Documento 15 sin reabrirlo ni contradecirlo.
5. **Extensible de verdad** — un campo por servicio nuevo, no una arquitectura nueva por servicio nuevo.
6. **Rendimiento** — `const`, resuelto en compilación, sin overhead de parseo ni I/O al arrancar, en ninguna alternativa competidora se logra algo mejor.
7. **Seguridad** — mantiene la propiedad más fuerte de todas las alternativas evaluadas: un binario de Producción no contiene, ni en teoría, los datos de otro entorno.

---

## 7. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Flavor/Scheme nativo y `--target` Dart pasados de forma inconsistente (Android/iOS) | Medio-Alto | Centralizar en scripts/tareas de IDE los comandos válidos por entorno (sección 5.6) — no depender de que cada persona los recuerde |
| Decisión de negocio pendiente (¿QA necesita backend propio o comparte el de Development?) | Bloquea solo la Fase donde se define la URL de QA, no el resto del diseño | Confirmar antes de la Fase correspondiente (ver plan) |
| Refactor de `main.dart`/`main_development.dart` a bootstrap compartido podría introducir una regresión si no se replica el comportamiento exacto | Medio | Cobertura de `flutter analyze`/`flutter test`/`flutter build web --target` para AMBOS entry points antes y después del refactor, comparando comportamiento observable |
| `dart_define.local.json` crece en responsabilidades (ahora también backend override) | Bajo | Ya es un archivo gitignorado con ese propósito explícito — agregar una clave más no cambia su naturaleza ni su protección |
| Confundir "Local Development" con un entorno que necesita su propio proyecto Firebase | Bajo, pero conceptualmente importante | Sección 5.3 lo deja explícito: comparte identidad con Development, no crea una nueva |

---

## 8. Plan de implementación (fases pequeñas y auditables — nada ejecutado)

### Fase 0.1 — Extraer bootstrap compartido (sin cambiar comportamiento)
- **Objetivo:** eliminar la duplicación entre `main.dart`/`main_development.dart` antes de escalar a más entornos.
- **Archivos afectados:** nuevo `lib/app/bootstrap.dart`; `lib/main.dart` y `lib/main_development.dart` reducidos a llamar a `bootstrapRideProApp(...)`.
- **Riesgos:** regresión de comportamiento si el refactor no es 1:1 (ver tabla de riesgos).
- **Pruebas:** `flutter analyze --fatal-infos`; `flutter test` completo; `flutter build web --release --target lib/main_development.dart` y verificación del artefacto (misma puerta de seguridad ya usada: 0 coincidencias de Producción, presencia de valores de Development).
- **Criterio de aceptación:** comportamiento observable idéntico al actual en ambos entry points; cero cambio en `firebase_options.dart`/`firebase_options_development.dart`.
- **Estrategia de migración:** ninguna — no hay datos ni usuarios afectados, es reorganización de código puro.
- **Compatibilidad:** total — no cambia ninguna API pública ni comportamiento.

### Fase 0.2 — Introducir `AppEnvironment` y migrarlo (solo Development/Production, sin entornos nuevos todavía)
- **Objetivo:** que `firebaseOptions`, `googleSignInWebClientId` y `backendBaseUrl` vivan en un único objeto por entorno, inyectado explícitamente.
- **Archivos afectados:** nuevo `lib/core/config/app_environment.dart`; nuevos `lib/core/config/environments/environment_development.dart` y `environment_production.dart` (envuelven los `firebase_options*.dart`/`social_login_config*.dart` ya existentes, sin duplicar sus valores); `lib/core/di/injection.dart` (parámetro `backendBaseUrl` explícito, mismo patrón ya usado para `googleWebClientId`); `lib/core/network/backend_dio_client.dart` (recibe la URL como parámetro, no la lee de `ApiConfig`); `lib/main.dart`/`lib/main_development.dart` (pasan su `AppEnvironment`).
- **Riesgos:** superficie de cambio mayor que 0.1, pero mecánico — mismo patrón ya aplicado exitosamente para el Client ID de Google en esta misma sesión.
- **Pruebas:** las mismas de 0.1 + pruebas unitarias del nuevo `resolveBackendBaseUrl` (mismo estilo que `resolveGoogleSignInClientId`, ya existente y ya probado) + verificación de que `ApiConfig` puede eliminarse sin romper nada (`grep` de cero referencias restantes).
- **Criterio de aceptación:** `ApiConfig.backendBaseUrl` ya no existe en el árbol de compilación de ningún entry point; Workouts sigue funcionando idéntico contra `localhost` en Development (mismo comportamiento actual, ahora explícito en vez de implícito).
- **Estrategia de migración:** eliminar `api_config.dart` solo después de confirmar cero referencias.
- **Compatibilidad:** Workouts (único consumidor hoy de `backendBaseUrl`) no cambia su comportamiento observable.

### Fase 0.3 — Agregar override local (`BACKEND_BASE_URL_OVERRIDE`)
- **Objetivo:** cubrir "Local Development" como variante de Development sin nuevo entry point.
- **Archivos afectados:** `lib/core/config/backend_config_resolver.dart` (nuevo); `dart_define.local.json.example` (agregar la clave documentada); `injection.dart` (usar el resolver en vez del valor crudo de `AppEnvironment`).
- **Riesgos:** bajo.
- **Pruebas:** unitarias del resolver (override presente vs. ausente).
- **Criterio de aceptación:** sin `--dart-define-from-file`, se usa la URL del `AppEnvironment`; con la clave definida, se usa el override.
- **Dependencias:** Fase 0.2 cerrada.

### Fase 0.4 — Entorno Staging (cuando el Documento 15 Fase 8 cree el proyecto Firebase correspondiente)
- **Bloqueada** hasta que exista `ridepro-staging` — fuera de alcance ejecutar esto hoy.

### Fase 0.5 — Decisión de producto sobre backend de QA/Testing
- **No es una fase de código** — requiere tu decisión (sección 5.3) antes de fijar la URL correspondiente en `environment_development.dart` o crear una variante.

---

## 9. Fuera de alcance de este documento

- Desplegar el backend NestJS en ningún entorno real (`T-F1.1`, Documento 15 §4.5) — este documento diseña *cómo apuntar* a él, no *dónde vive*.
- Crear el proyecto Firebase de Staging (Documento 15 Fase 8).
- Cualquier servicio nuevo (rutas, telemetría, IA, sync, CDN, media) — solo se demuestra que la arquitectura los soporta, no se implementan.
- Android/iOS flavors nativos en sí (ya diseñados en el Documento 15, no rediseñados aquí, solo referenciados por su interacción con `--target`).

---

## 10. Veredicto

**⚠️ LISTO CON DECISIONES PENDIENTES** — el diseño está completo y no depende de ninguna implementación previa no autorizada, pero antes de implementar necesito tu confirmación en:

1. ¿Apruebas la arquitectura `AppEnvironment` + bootstrap compartido (Alternativa C) tal como se describe en la sección 5?
2. ¿QA/Testing usa el mismo backend desplegado que Development, o necesita uno propio? (sección 5.3)
3. ¿Autorizas empezar por la Fase 0.1 (refactor de bootstrap, sin entornos nuevos, cero riesgo funcional) como primer paso auditable?

**Detenido aquí.** Sin cambios de código, sin `git add`/commit/push, sin tocar Firebase. Esperando tu autorización.
