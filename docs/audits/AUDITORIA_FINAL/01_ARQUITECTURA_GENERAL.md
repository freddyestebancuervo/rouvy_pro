# RidePro — Documento Maestro de Arquitectura
## Documento 1 de 9: Arquitectura General

- **Fecha:** 2026-07-24
- **Rol:** Arquitecto Principal / Chief Software Architect
- **Rama auditada:** `feature/d2`, HEAD `d3d01d8`
- **Método:** inspección directa del código (`lib/`, `backend/`, `firebase*`, `.github/workflows/`), no de la documentación — cada afirmación cita archivo/línea o el comando que la sostiene. Donde este documento se apoya en `docs/architecture/01_SYSTEM_ARCHITECTURE.md` (auditoría del mismo día, sin cambios de código desde entonces — confirmado con `git status`), se cita explícitamente en vez de duplicar el análisis.
- **Alcance de este documento:** arquitectura actual, capas, responsabilidades, dependencias, flujo de datos, comunicación entre módulos, puntos débiles, fortalezas, deuda técnica. El resto de los ejes pedidos (módulo a módulo, seguridad, rendimiento, escalabilidad, multiplataforma, riesgos, roadmap, recomendaciones) se entregan en los Documentos 2-9, para no mezclar niveles de detalle.

---

## 1. Qué es RidePro hoy, en una frase por capa

| Capa | Tecnología | Estado real (no aspiracional) |
|---|---|---|
| Cliente | Flutter 3.19+ / Dart 3.3+, Clean Architecture por feature | 10 features, ~250 archivos Dart en `lib/`, compila y pasa `flutter analyze --fatal-infos` |
| Backend propio | NestJS + PostgreSQL (`pg.Pool` sin ORM) | 5 módulos (`auth`, `users`, `equipment`, `workouts`, `refresh-tokens`), 4 migraciones SQL |
| Backend gestionado | Firebase (Auth, Firestore, Storage, Messaging, Analytics, Crashlytics) | Sistema **original** y todavía dominante — 8 de 10 features lo usan como única fuente de datos |
| Infraestructura | GitHub Actions (3 jobs), sin Docker, sin CD | CI corre en cada push/PR a `main`/`master` |

**El hecho arquitectónico más importante de todo el sistema, y el que condiciona la lectura de todo lo demás**: RidePro no tiene un backend, tiene **dos**, construidos en momentos distintos, sin puente entre sí. Esto no es una opinión — es verificable en `lib/core/config/dev_backend_test_user.dart`, que existe únicamente porque un usuario autenticado con Firebase no puede, hoy, obtener una sesión válida contra el backend NestJS sin pasar por una cuenta de prueba fija en modo debug. Todo el resto de este documento debe leerse con ese hecho como trasfondo.

---

## 2. Arquitectura actual — vista de capas

### 2.1 Diagrama de capas (texto)

```
┌─────────────────────────────────────────────────────────────────────┐
│  PRESENTATION                                                        │
│  Flutter: pages / widgets / providers (Riverpod)                     │
│  NestJS:  controllers + DTOs de entrada/salida                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │  (solo llama a Application, nunca a Infra)
┌───────────────────────────────▼───────────────────────────────────────┐
│  APPLICATION                                                         │
│  Flutter: casos de uso (core/usecase/usecase.dart, contrato base)     │
│  NestJS:  services (orquestación; sin SQL propio, delegan a repository)│
└───────────────────────────────┬───────────────────────────────────────┘
                                 │  (solo conoce contratos de Domain)
┌───────────────────────────────▼───────────────────────────────────────┐
│  DOMAIN                                                               │
│  Flutter: entidades (Equatable), repositorios ABSTRACTOS, Failures     │
│  NestJS:  reglas de negocio embebidas en services + DTOs validados     │
│           (el framework fusiona Application+Domain aquí — ver 2.3)     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │  Infra IMPLEMENTA estas interfaces
┌───────────────────────────────▼───────────────────────────────────────┐
│  INFRASTRUCTURE                                                       │
│  Flutter: repositorios concretos, datasources, mappers                │
│  NestJS:  repositories (pg.Pool directo), migraciones SQL              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
┌───────────────────────────────▼───────────────────────────────────────┐
│  EXTERNAL SERVICES                                                     │
│  Firebase (Auth/Firestore/Storage/Messaging)  │  PostgreSQL             │
│  BLE (flutter_blue_plus)  │  Health (HealthKit/Health Connect)          │
│  Google/Apple Sign-In                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

Esta separación **no es aspiracional**: es el patrón real encontrado en las 10 carpetas de `lib/features/*` sin excepción — cada una replica `data/domain/presentation`. Verificado por inspección directa de la estructura de directorios (no hay un feature que rompa el patrón).

### 2.2 Por qué "por feature" y no "por capa global"

RidePro organiza el cliente Flutter como `features/<nombre>/{data,domain,presentation}` en vez de `lib/{data,domain,presentation}/<nombre>`. Es la decisión correcta a esta escala: cada feature (`auth`, `training`, `workouts`, `wearables`, `device_connection`, `routes_catalog`, `achievements`, `home`, `profile`, `settings`) se puede leer, testear y —eventualmente— extraer como paquete independiente sin tocar el resto. La alternativa ("por capa global") es la que peor escala en equipos que crecen, porque obliga a tocar 4 carpetas distantes para un cambio de un solo feature.

`home`, `profile` y parte de `settings` son **solo `presentation/`** — no tienen `data/`/`domain/` propios. Esto es correcto, no un hueco: son páginas de composición que orquestan otros features, no dueñas de datos.

### 2.3 Asimetría Flutter vs. NestJS en la separación de capas

En Flutter, la regla de dependencia hacia adentro (Clean Architecture clásica) se cumple de forma literal: `domain/` no importa `dio`, `cloud_firestore` ni ningún widget de Flutter — solo `dartz`/`equatable`. Verificable con una búsqueda de imports en cualquier archivo de `lib/features/*/domain/`.

En NestJS, la separación es más laxa **por convención del framework**, no por descuido: los `*.service.ts` fusionan lo que en un modelo estricto serían "application" y "domain" (orquestación + reglas de negocio), mientras que `*.repository.ts` es la única capa que toca `pg.Pool` directamente. Esto es aceptable a esta escala (5 módulos, 1-4 endpoints cada uno) — forzar una separación adicional (p. ej. un `domain/` NestJS separado de `service.ts`) sería sobre-ingeniería sin beneficio medible hoy. Si el backend crece a 15+ módulos con reglas de negocio complejas compartidas entre varios, esta es la primera costura a revisar (ver Documento 8, Roadmap).

---

## 3. Responsabilidades por módulo (mapa completo)

### 3.1 Cliente Flutter — `lib/`

| Carpeta | Responsabilidad | Depende de |
|---|---|---|
| `app/` | Bootstrap (`main.dart`), router (`go_router`), tema, widgets globales | Todos los features (composición) |
| `core/ble` | Descubrimiento y conexión Bluetooth Low Energy, parsing de protocolos FTMS/HR | — |
| `core/config` | Configuración de entorno del cliente (`dart-define`, emuladores, `DevBackendTestUser`) | — |
| `core/di` | Service locator (`GetIt`, registro manual en `injection.dart`) | Todos los features (los registra) |
| `core/error` | `Failure` tipado, `AppErrorHandler` (mapeo de excepciones de proveedor a dominio) | — |
| `core/health` | Integración HealthKit/Health Connect vía paquete `health` | — |
| `core/network` | Cliente HTTP (`Dio`) hacia el backend NestJS, interceptores | — |
| `core/platform` | Abstracciones específicas de plataforma (p. ej. soporte condicional de Web Bluetooth) | — |
| `core/sync` | Sincronización offline-first (hoy, solo el patrón ya usado por Firestore) | — |
| `core/usecase` | Contrato base de caso de uso | — |
| `core/widgets` | Widgets compartidos entre features | — |
| `demo/` | Modo demo con datos falsos (`main_demo.dart` como entry point alternativo) | Ninguno de producción — aislado explícitamente |
| `features/auth` | Login/registro (Firebase Auth + Google/Apple Sign-In) | — |
| `features/home` | Composición: tarjetas de entrada a otros features | `auth`, `training`, `routes_catalog`, `workouts` |
| `features/profile` | Perfil de usuario, navegación a ajustes/dispositivos | `auth`, `device_connection`, `workouts` |
| `features/training` | HUD de entrenamiento en vivo, agregación de telemetría | `device_connection`, `wearables` (indirecto) |
| `features/workouts` | CRUD de entrenamientos estructurados contra el backend NestJS | Aislado — solo `core/network` |
| `features/device_connection` | Conexión a rodillos/sensores BLE | Aislado — solo BLE |
| `features/wearables` | Integración con wearables (patrón Adapter) | Aislado — solo `core/health` |
| `features/routes_catalog` | Catálogo de rutas (hoy: mock local) | Aislado |
| `features/achievements` | Logros/gamificación | Aislado |
| `features/settings` | Configuración de la app | Aislado |

### 3.2 Backend NestJS — `backend/src/`

| Carpeta/módulo | Responsabilidad | Depende de |
|---|---|---|
| `jwt/` (`@Global()`) | Emisión/verificación de JWT RS256 | — (vive fuera de `AuthModule` deliberadamente, evita import circular con `UsersModule`) |
| `database/` | `DatabaseModule`, pool de conexión Postgres | — |
| `config/` | `resolveX()`/`createX()` por preocupación (`database.config.ts`, `cors.config.ts`), valida y falla explícito si falta algo | — |
| `common/auth` | `JwtAuthGuard`, decorador `@CurrentUser()` | `jwt/` |
| `common/ownership` | `assertOwned()` — patrón "404, no 403" reutilizado por `equipment` y `workouts` | — |
| `common/exceptions`, `common/filters` | `ApiExceptionFilter` (sobre de error único), `pg-error.util.ts` (traduce errores nativos de Postgres a excepciones de dominio) | — |
| `modules/auth` | Registro, login, refresh de tokens propios | `users`, `jwt`, `refresh-tokens` |
| `modules/users` | CRUD de usuarios del backend propio | `database` |
| `modules/refresh-tokens` | Rotación y revocación de refresh tokens | `database` |
| `modules/equipment` | CRUD de equipamiento | `database`, `common/auth`, `common/ownership` |
| `modules/workouts` | CRUD de entrenamientos estructurados | `database`, `common/auth`, `common/ownership` |

### 3.3 Firebase

| Servicio | Responsabilidad | Consumido por |
|---|---|---|
| Firebase Auth | Identidad/sesión de la app principal | 8 de 10 features |
| Firestore | Perfil (`users/{uid}`), historial de sesiones (`users/{uid}/ride_sessions`) | `auth`, `home`, `profile`, `training`, `wearables`, `routes_catalog`, `achievements`, `settings` |
| Storage | (declarado en `pubspec.yaml`, sin consumidor de negocio verificado en esta pasada — ver Documento 2) | — |
| Messaging (FCM) | Declarado, **sin `NotificationDispatcher` ni consumidor visible** | Ninguno hoy |
| Analytics / Crashlytics | Observabilidad | Transversal |

---

## 4. Dependencias entre módulos

### 4.1 Backend — matriz de dependencias

| Módulo | Depende de | Expone a |
|---|---|---|
| `JwtModule` (global) | — | `AuthModule`, `common/auth` |
| `DatabaseModule` | — | Todos los módulos con repositorio |
| `AuthModule` | `UsersModule`, `JwtModule`, `RefreshTokensModule` | `common/auth` |
| `UsersModule` | `DatabaseModule` | `AuthModule` |
| `RefreshTokensModule` | `DatabaseModule` | `AuthModule` |
| `EquipmentModule` | `DatabaseModule`, `common/auth`, `common/ownership` | — (hoja) |
| `WorkoutsModule` | `DatabaseModule`, `common/auth`, `common/ownership` | — (hoja) |

**Sin ciclos.** `EquipmentModule` y `WorkoutsModule` son hermanos — no se conocen entre sí, correcto: no hay razón de negocio hoy para que lo hagan.

### 4.2 Cliente Flutter — matriz de dependencias (nivel `domain` → `domain`)

| Feature | Depende del dominio de | Motivo |
|---|---|---|
| `home` | `auth`, `training`, `routes_catalog`, `workouts` | Composición (tarjetas de entrada) |
| `profile` | `auth`, `device_connection`, `workouts` | Composición + navegación |
| `training` | `device_connection`, `wearables` (indirecto vía providers) | HUD consume telemetría ya agregada |
| `workouts`, `device_connection`, `wearables`, `auth`, `routes_catalog`, `achievements`, `settings` | — | Aislados |

**Corrección respecto a la primera versión de este documento:** una revisión de código dirigida (`HALLAZGOS_CODIGO_Y_ARQUITECTURA.md`, hallazgo H2) encontró que la afirmación "ningún feature importa `data`/`presentation` de otro" **es falsa**, verificado por grep directo de imports. La regla real, confirmada en el código:

- **`domain`→`domain` entre features: sin excepciones** (p. ej. `training/domain` importa `device_connection/domain`, `achievements/domain` importa `training/domain`) — esto sí se cumple siempre.
- **`presentation`→`presentation` entre features: ocurre, y solo a nivel de `providers` (nunca widgets ni datasources)** — evidencia: `home_page.dart` y `profile_page.dart` importan `auth/presentation/providers/*`; `ride_session_controller.dart` (training) importa `device_connection/presentation/providers/device_providers.dart`; `achievements_providers.dart` importa dos providers de `training/presentation/providers/*`.
- **Todas las direcciones encontradas son unidireccionales, sin ciclos** (`home`→`auth`, `profile`→`auth`, `training`→`device_connection`, `achievements`→`training`; ninguna en sentido inverso, verificado explícitamente).

Este acoplamiento de providers entre features es un patrón pragmático común en apps Riverpod feature-first (el provider actúa como interfaz pública razonablemente estable) y no se ha encontrado evidencia de que haya causado un bug — se documenta como regla real, no como defecto a corregir de inmediato. Ver Documento 2 (Calidad del Código) para el análisis de severidad y la decisión de no refactorizar sin necesidad comprobada.

### 4.3 Los dos backends, y por qué no hay dependencia formal entre ellos

Firebase y NestJS+PostgreSQL **no se conocen entre sí a nivel de código** — no hay ningún cliente HTTP de NestJS hacia Firebase Admin SDK, ni ninguna Cloud Function que escriba en Postgres. La única conexión es indirecta y frágil: `lib/core/config/dev_backend_test_user.dart`, que en `kDebugMode` sustituye la sesión real de Firebase por una cuenta de prueba fija para poder llamar al backend NestJS. Esto significa que, en producción, **hoy no hay ningún camino para que un usuario autenticado use Workouts** — es una feature construida y probada (7 suites e2e contra Postgres real) pero inalcanzable end-to-end desde la app real. Ver Documento 7 (Riesgos) para la clasificación de severidad.

---

## 5. Flujo completo de datos

### 5.1 Diagrama (texto)

```
                         ┌───────────────────────────┐
                         │        Flutter UI          │
                         └──────────┬─────────┬────────┘
                                    │         │
                  login/perfil/     │         │  equipment/workouts
                  sesiones/logros   │         │  (vía cuenta QA fija
                                    │         │   en debug, hoy)
                                    ▼         ▼
                    ┌───────────────────┐   ┌──────────────────────┐
                    │   Firebase Auth    │   │   NestJS REST /v1     │
                    └─────────┬──────────┘   └──────────┬────────────┘
                              │                          │
                              ▼                          ▼
                    ┌───────────────────┐   ┌──────────────────────┐
                    │     Firestore       │   │      PostgreSQL       │
                    │  users/{uid}         │   │  users, refresh_tokens │
                    │  users/{uid}/         │   │  equipment,            │
                    │    ride_sessions      │   │  equipment_categories, │
                    │                       │   │  workouts,             │
                    │                       │   │  workout_intervals,    │
                    │                       │   │  ride_sessions (⚠ sin  │
                    │                       │   │   uso, ver 6.3),       │
                    │                       │   │  audit_log (⚠ sin      │
                    │                       │   │   INSERT, ver 6.3)     │
                    └───────────────────────┘   └────────────────────────┘

    BLE (rodillo/sensores) ──► TelemetryAggregator (RAM, proceso) ──► HUD (training)
                                        │
                                        └──► resumen final ──► Firestore ride_sessions

    Wearables (HealthKit / Health Connect) ──► core/health ──► features/wearables (Adapter)
```

### 5.2 Dos fuentes de verdad, sin solapamiento de datos (pero sí de intención)

No hay ningún dato que se escriba en Firestore **y** en PostgreSQL a la vez — cada tabla/colección tiene un único escritor. Donde sí hay una duplicación real es conceptual: existe una tabla `ride_sessions` en PostgreSQL (creada en la migración `0001_init.sql`) que replica el nombre y propósito de `users/{uid}/ride_sessions` en Firestore, pero **nadie escribe en la tabla Postgres** — es un remanente del diseño original antes de que la decisión fuera "las sesiones viven en Firestore". No genera bugs hoy (tabla vacía, sin lecturas), pero es señal de esquema no depurado tras ese pivote.

### 5.3 Comunicación entre módulos: contrato, no acoplamiento directo

- **Flutter → Firebase**: SDK oficial, tipado, offline-first nativo (Firestore cachea localmente y sincroniza al reconectar — patrón ya documentado en `docs/OFFLINE_FIRST.md`).
- **Flutter → NestJS**: `Dio` + interceptores, DTOs propios en `data/models/`. Sin cliente generado desde OpenAPI — los modelos Flutter y los DTOs NestJS se mantienen sincronizados manualmente, sin ningún test que lo verifique automáticamente (ver Documento 2, sección Workouts, y Documento 7).
- **Entre features Flutter**: nunca directo entre `data`/`presentation` — solo vía `domain` (interfaces) o composición en `presentation`. No existe hoy un bus de eventos ni un mecanismo formal de pub/sub entre features (p. ej. "cuando termina una sesión, notificar a Logros") — la comunicación cruzada, donde existe, pasa por providers de Riverpod leídos desde la página compuesta, no por un evento explícito. Es manejable a 10 features; a 19+ (ver Documento 2) empieza a doler sin un mecanismo de eventos de dominio.
- **Entre módulos NestJS**: inyección de dependencias estándar de Nest, sin bus de eventos (`EventEmitterModule` no está en uso) — igual de manejable a 5 módulos, mismo punto de vigilancia que el anterior si crece a 15+.

---

## 6. Puntos débiles (con evidencia)

1. **Dos sistemas de autenticación sin puente real** (`lib/core/config/dev_backend_test_user.dart`, docblock propio del archivo) — el hallazgo estructural más importante del proyecto. Bloquea llevar Workouts a producción real tal como está. Detalle de severidad en Documento 7.
2. **Sin matriz formal de entornos** (dev/QA/staging/prod) — un único proyecto Firebase (`ridepro-dbafe`, ver `.firebaserc`) sirve para todo. No hay forma de que un desarrollador "apunte a producción por accidente": desarrollo y producción ya son, en la práctica, el mismo proyecto.
3. **Sin idempotencia en los endpoints de escritura de NestJS** (`workouts`, `equipment`) — un reintento de red tras un timeout ambiguo puede crear un recurso duplicado. Ningún endpoint acepta hoy una idempotency key.
4. **`audit_log` (Postgres) definida sin un solo `INSERT` en todo `backend/src/`** — cero trazabilidad de acciones críticas (cambios de rol, borrado de cuenta) pese a que el esquema sugiere que existe.
5. **Sin tests de contrato Flutter↔NestJS** — un cambio de DTO en el backend puede romper el cliente sin que ningún test lo detecte antes de runtime.
6. **`windows/` no generado** pese a ser plataforma objetivo declarada (`ARCHITECTURE_DECISIONS.md`, `firebase_options.dart` ya tiene un bloque `DefaultFirebaseOptions.windows` con la config de Web reutilizada como placeholder).
7. **Sin Docker/`docker-compose.yml`** — no hay forma reproducible de levantar backend + Postgres + emulador Firebase con un solo comando.
8. **`integration_test/` sin ningún archivo** pese a que la dependencia está declarada en `pubspec.yaml` — cero cobertura end-to-end de flujos completos (login→home, BLE simulado→HUD→resumen).
9. **Sin lazy-loading de rutas** (`go_router` registra todo el árbol al iniciar) — no es un problema hoy con 10 features, pero no escala sin revisión a los 19+ módulos que el propio roadmap de negocio contempla (ver Documento 2/5).
10. **`injection.dart` con registro manual de DI** (`GetIt`), pese a que `injectable`+`build_runner` ya están en `pubspec.yaml` sin usarse — deuda ya identificada internamente (umbral de ~300 líneas para migrar, hoy ~250).

---

## 7. Fortalezas (con evidencia)

1. **Clean Architecture aplicada de forma consistente y sin excepciones** en los 10 features Flutter — no es una aspiración de README, es el patrón real en cada carpeta.
2. **Regla de dependencia hacia adentro respetada en la práctica**, verificado por inspección de imports: `domain/` nunca importa `dio`/`cloud_firestore`/widgets.
3. **Manejo de errores funcional y consistente** (`Either<Failure, T>` con `dartz` en todo repositorio Flutter; `ApiExceptionFilter` + `pg-error.util.ts` en NestJS) — ningún error crudo de proveedor llega al llamador final en ninguno de los dos lados del stack.
4. **Seguridad de autorización ya resuelta con un patrón reutilizable**: `assertOwned()` (404 en vez de 403, para no confirmar la existencia de un recurso ajeno) extraído a `common/ownership/` tras detectarse duplicado una vez — señal de que el equipo refactoriza cuando detecta duplicación, no la deja acumularse.
5. **Refresh tokens con rotación obligatoria y detección de reuso** — defensa estándar contra robo de token, ya implementada, no pendiente.
6. **Patrón Adapter para wearables** — el dominio no conoce el proveedor concreto (HealthKit vs. Health Connect vs. simulado), documentado como el ejemplo de referencia a replicar para cualquier capacidad nueva de plataforma.
7. **Backend sin ORM, con SQL explícito** (`pg.Pool`) — decisión deliberada (no un descuido), evita la fuente más común de N+1 (lazy-loading de ORM); cada `repository.ts` hace consultas acotadas por endpoint.
8. **Monolito modular con "camino de escape" ya dejado abierto**: la separación por módulos de NestJS (cada uno con su propio `repository.ts`) es exactamente la frontera que se usaría el día que un dominio necesite escalar por separado — extraer sería mover una carpeta, no rediseñar límites de datos.
9. **CI con 3 jobs reales** (Flutter, reglas de Firestore, backend contra Postgres real) — no es un CI de fachada, corre migraciones y e2e reales en cada push/PR.
10. **Reglas de Firestore auditadas y con 28/28 tests de seguridad en verde** (`firebase/rules-tests`) — deny-by-default, no una configuración abierta.

---

## 8. Deuda técnica (inventario consolidado)

| # | Deuda | Evidencia | Impacto si no se resuelve |
|---|---|---|---|
| 1 | Dos sistemas de auth sin puente | `dev_backend_test_user.dart` | Workouts inalcanzable end-to-end en producción |
| 2 | `ride_sessions` duplicada conceptualmente (Postgres vacía / Firestore real) | migración `0001_init.sql` | Confusión para cualquier desarrollador nuevo que lea el esquema |
| 3 | `audit_log` sin escritura | `grep -rn audit_log backend/src` → 0 resultados en INSERT | Sin trazabilidad forense si algo sale mal |
| 4 | Sin idempotencia en escrituras NestJS | inspección de `*.controller.ts`/`*.dto.ts` | Riesgo de recursos duplicados ante reintentos de red |
| 5 | `windows/` no generado | ausencia de carpeta + config ya generada en `firebase_options.dart` | Plataforma objetivo declarada, no entregable hoy |
| 6 | Sin Docker Compose | ausencia de `Dockerfile`/`docker-compose.yml` | Onboarding no reproducible, "funciona en mi máquina" |
| 7 | `integration_test/` sin archivos | ausencia del directorio pese a dependencia declarada | Hueco real en la pirámide de pruebas |
| 8 | Paquete `logger` sin uso en `lib/` | `grep -rl "package:logger" lib` → 0 | Limpieza menor, dependencia muerta |
| 9 | `CI_CD_GUIDE.md` desactualizado (asume que el repo no está en GitHub) | `git remote -v` muestra `origin` real | Deuda de documentación, riesgo de confundir a alguien nuevo |
| 10 | Sin matriz formal de entornos | ver sección 6.2 | Condiciona directamente seguridad y despliegue (Documentos 3 y 8) |
| 11 | Sin tests de contrato Flutter↔NestJS | ausencia de Pact/OpenAPI validado | Cambios de DTO rompen el cliente silenciosamente |
| 12 | DI manual (`GetIt`) pese a tener `injectable` sin usar | `injection.dart`, ~250 líneas | Escalamiento de mantenibilidad a vigilar, no urgente |

---

## 9. Comunicación entre módulos — resumen de mecanismos existentes vs. ausentes

| Mecanismo | ¿Existe hoy? | Dónde |
|---|---|---|
| Interfaces de dominio (contratos abstractos) | ✅ | Cada `domain/repositories/*.dart` |
| Composición en presentación | ✅ | `home`, `profile` embeben widgets de otros features |
| Inyección de dependencias | ✅ (`GetIt` manual en Flutter, nativa en NestJS) | `core/di/injection.dart` |
| Eventos de dominio / bus de eventos | ⚪ No existe | Ni `EventEmitterModule` (NestJS) ni un mecanismo equivalente en Flutter |
| Contrato de API validado automáticamente | ⚪ No existe | Ver deuda #11 |
| Cola de sincronización offline genérica | 🟡 Solo para Firestore (offline-first nativo del SDK); no existe para NestJS | `core/sync/` (contrato parcial, sin motor genérico) |

---

## 10. Cierre de este documento

Este documento cubre exclusivamente arquitectura general — capas, responsabilidades, dependencias, flujo de datos, puntos débiles/fortalezas y deuda técnica, con evidencia directa del código a 2026-07-24. **No implementa ningún cambio** — es un documento de análisis.

### Mapa de los 14 ejes pedidos → los 9 documentos de entrega

El pedido original tiene 14 ejes de análisis pero 9 documentos de entrega — este es el mapeo que se sigue en el resto de la serie, para que quede explícito dónde aparece cada eje:

| Eje pedido | Documento donde se responde |
|---|---|
| 1. Arquitectura general | **Documento 1** (este) |
| 2. Evaluación de módulos (uno por uno, incluyendo los que no existen: ANT+, Video, Mapas reales, Notificaciones, Eventos, Clubes, Marketplace...) | **Documento 2** — Calidad del Código |
| 6. Calidad del código (duplicación, SOLID, clases gigantes, código muerto) | **Documento 2** — Calidad del Código |
| 3. Escalabilidad (1K→10M usuarios) | **Documento 5** — Escalabilidad |
| 4. Rendimiento (CPU/RAM/render/streams) | **Documento 4** — Rendimiento |
| 5. Seguridad | **Documento 3** — Seguridad |
| 7. Multiplataforma | **Documento 6** — Arquitectura Multiplataforma |
| 8. Experiencia de usuario | **Documento 9** — Recomendaciones Finales (junto con el plan de acción) |
| 9. Futuro (IA, VR/AR, wearables, marketplace) | **Documento 8** — Roadmap Arquitectónico |
| 10. Riesgos priorizados | **Documento 7** — Riesgos Técnicos |
| 11. Plan Maestro / roadmap | **Documento 8** — Roadmap Arquitectónico |
| 12. Autonomía (decisiones tomadas, justificación) | Transversal — cada documento documenta sus propias decisiones; consolidado en **Documento 9** |
| 13. Evidencia | Transversal — cada documento cita archivo/línea/comando; sin sección separada |
| 14. Formato de entrega | Este mapeo |

**Siguiente documento:** Documento 2 — Calidad del Código (evaluación módulo por módulo + hallazgos de calidad general).
