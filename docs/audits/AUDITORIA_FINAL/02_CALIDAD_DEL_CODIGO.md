# RidePro — Documento Maestro de Arquitectura
## Documento 2 de 9: Calidad del Código

- **Fecha:** 2026-07-24
- **Rama / HEAD:** `feature/d2` / `d3d01d8`
- **Método:** evaluación módulo por módulo (existentes y ausentes) + inspección estructural transversal (tamaño de archivo, duplicación, acoplamiento, dependencias muertas, violaciones SOLID/Clean Architecture). Se apoya en, sin duplicar, `01_ARQUITECTURA_GENERAL.md` (este mismo directorio) y `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md` (evidencia H1-H7 ya levantada).
- **No se modifica código en este documento.**

---

## 1. Evaluación módulo por módulo

Formato por módulo: qué hace · qué tan bien está diseñado · problemas · dividir/unificar/eliminar/mover · nivel de calidad (A-F) · riesgo técnico.

### 1.1 Frontend (Flutter, `lib/`) — visión general antes del detalle por feature

- **Qué hace:** cliente único para Android/iOS/Web (Windows declarado, sin proyecto nativo — ver Documento 6), Clean Architecture por feature.
- **Qué tan bien diseñado:** alto. Patrón consistente sin excepciones en 10 features, regla de dependencia hacia adentro verificada por inspección de imports (`domain/` nunca importa Flutter/SDKs externos).
- **Problemas:** acoplamiento de `presentation` entre 4 pares de features (H2, ver 1.5 más abajo); DI manual en vez del `injectable` ya declarado; 9 paquetes de generación de código completamente muertos (ver sección 3).
- **Dividir/unificar/eliminar/mover:** eliminar del `pubspec.yaml` las 9 dependencias muertas o adoptar el toolchain que representan (decisión pendiente, ver sección 3.1).
- **Nivel de calidad:** **B+**
- **Riesgo técnico:** Bajo-Medio (nada bloquea hoy; la deuda es de higiene, no de corrección).

### 1.2 Backend (NestJS, `backend/src/`)

- **Qué hace:** API REST propia para Equipment y Workouts, con su propio sistema de auth/JWT.
- **Qué tan bien diseñado:** alto para su tamaño actual (5 módulos). Sin ORM (decisión deliberada, evita N+1 de lazy-loading), guard + ownership pattern reutilizado, filtro de excepciones único.
- **Problemas:** vive desconectado de la identidad real de la app (H1); sin idempotencia en escrituras (H3); sin `lint`/`tsc --noEmit` como pasos explícitos de CI (solo se ejecutan localmente).
- **Dividir/unificar/eliminar/mover:** nada que dividir hoy — 5 módulos con 1-4 endpoints cada uno no justifican más granularidad. Ver Documento 1 sección 4 (decisión monolito modular, ya tomada y documentada en ADR-0001).
- **Nivel de calidad:** **A-**
- **Riesgo técnico:** Alto — no por la calidad del código en sí, sino porque es funcionalmente inalcanzable en producción real (H1).

### 1.3 Firebase

- **Qué hace:** Auth, Firestore (perfil + historial de sesiones), Storage (declarado, sin consumidor de negocio verificado — ver 1.13), Messaging (declarado, sin consumidor — ver 1.16), Analytics/Crashlytics (transversal).
- **Qué tan bien diseñado:** alto donde se usa activamente (Auth, Firestore) — reglas de seguridad auditadas, 28/28 tests en verde (`firebase/rules-tests`), offline-first nativo bien aprovechado.
- **Problemas:** proyecto único para todos los entornos (riesgo de infraestructura, no de código — ver Documento 3); dos servicios declarados en `pubspec.yaml` (Storage, Messaging) sin código de negocio que los consuma todavía.
- **Dividir/unificar/eliminar/mover:** ninguna acción de código — es una decisión de infraestructura (Documento 3/7).
- **Nivel de calidad:** **A** (en lo que se usa)
- **Riesgo técnico:** Medio (ver Documento 3 para el detalle de por qué).

### 1.4 PostgreSQL

- **Qué hace:** persistencia del backend NestJS — `users`, `refresh_tokens`, `equipment`, `equipment_categories`, `workouts`, `workout_intervals`; `ride_sessions` y `audit_log` definidas sin uso real.
- **Qué tan bien diseñado:** esquema limpio, migraciones versionadas a mano, tipos `NUMERIC`/`BIGINT` manejados explícitamente como `string` en el borde de entrada para evitar pérdida de precisión (`equipment.repository.ts`, comentado en el código).
- **Problemas:** `ride_sessions` (H5) y `audit_log` (H6) son esquema sin escritor real — deuda de esquema, no de motor.
- **Dividir/unificar/eliminar/mover:** eliminar `ride_sessions` de Postgres (H5); implementar escritura real en `audit_log` o eliminarla también si se decide no auditar (H6) — no dejarla a medias.
- **Nivel de calidad:** **B+**
- **Riesgo técnico:** Bajo (esquema, no motor — nada de esto genera un bug hoy).

### 1.5 Servicios (capa `services`/`repositories`, ambos lados)

- **Qué hace:** orquestación (NestJS `*.service.ts`) y traducción datasource→dominio (Flutter `data/repositories/*.dart`).
- **Qué tan bien diseñado:** consistente — mismo principio en ambos lados del stack (nunca exponer el error crudo del proveedor).
- **Problemas:** ninguno nuevo respecto a lo ya listado.
- **Dividir/unificar/eliminar/mover:** ninguna acción.
- **Nivel de calidad:** **A-**
- **Riesgo técnico:** Bajo.

### 1.6 Autenticación (`features/auth` + `backend/src/modules/auth`)

- **Qué hace:** login/registro/logout vía Firebase (Google/Apple/email); JWT propio en NestJS, independiente.
- **Qué tan bien diseñado:** cada mitad, bien diseñada individualmente (rotación de refresh tokens con detección de reuso, nonce de Sign in with Apple). El conjunto, mal — dos sistemas de identidad sin puente (H1).
- **Problemas:** H1 (crítico de negocio, ver Documento 1 y 7).
- **Dividir/unificar/eliminar/mover:** **unificar** — implementar el intercambio Firebase→JWT (ya definido en Documento 1/`HALLAZGOS...` H1, y ADR-0003 de `docs/architecture/adr/`).
- **Nivel de calidad:** **B** (penalizado por el diseño de conjunto, no por la implementación de cada parte)
- **Riesgo técnico:** **Alto**.

### 1.7 Entrenamientos (`features/training`)

- **Qué hace:** HUD de sesión en vivo, agregación de telemetría (`TelemetryAggregator`), resumen de sesión, historial, estadísticas.
- **Qué tan bien diseñado:** alto — `RideSessionController` desacopla explícitamente el transporte de datos (BLE hoy, cualquier otro mañana) del dominio de entrenamiento (comentario propio del archivo, verificado línea por línea en esta revisión: importa solo `device_connection/domain/*` + un provider, nunca `flutter_blue_plus` directamente).
- **Problemas:** el único import de `presentation` de otro feature (`device_providers.dart`, H2) vive acá; alcance exacto de `checkForRecoverableSnapshot()` no verificado línea por línea todavía (pendiente heredado de la auditoría previa).
- **Dividir/unificar/eliminar/mover:** ninguna acción estructural — el archivo más grande del feature (`ride_session_controller.dart`, 265 líneas) está cohesionado, no es un candidato real a dividir.
- **Nivel de calidad:** **A-**
- **Riesgo técnico:** Bajo-Medio (el "medio" es por la pieza sin verificar de recuperación de sesión).

### 1.8 Videos

- **Qué hace / estado:** **no existe.** Sin paquete de reproducción de video en `pubspec.yaml` (`video_player`, `chewie` u otro — verificado, ausentes), sin ninguna carpeta o archivo relacionado en `lib/`.
- **Nivel de calidad:** N/A — no hay código que calificar.
- **Riesgo técnico:** N/A hoy; **relevante para el roadmap** si RidePro apunta a contenido tipo Zwift/ROUVY (rutas en video 360°/3D) — ver Documento 8.

### 1.9 Sensores / Bluetooth (`features/device_connection`, `core/ble`)

- **Qué hace:** descubrimiento, conexión, parsing FTMS/HR/potencia/cadencia/batería vía BLE.
- **Qué tan bien diseñado:** alto — parsers por protocolo separados (`CyclingPowerParser`, `CscParser`, `FtmsParser`, `HeartRateParser`, `BatteryLevelParser`), backoff exponencial de reconexión con límite de tiempo total (no solo de intentos — decisión explícita documentada en el código para evitar drenar batería en segundo plano).
- **Problemas:** H7 (concentración de responsabilidades en `ble_datasource.dart`, 473 líneas) — sin impacto real hoy, solo vigilancia.
- **Dividir/unificar/eliminar/mover:** ninguna acción inmediata (ver H7).
- **Nivel de calidad:** **A-**
- **Riesgo técnico:** Bajo.

### 1.10 ANT+

- **Qué hace / estado:** **no existe.** Mencionado en un comentario de `ride_session_controller.dart` como posibilidad arquitectónica futura ("podría ser BLE hoy y ANT+ u otra cosa mañana"), sin paquete ni código real.
- **Nivel de calidad:** N/A.
- **Riesgo técnico:** N/A hoy. El dominio ya está desacoplado del transporte (1.7/1.9), así que agregarlo no debería tocar `training` — es una fortaleza de diseño a favor de que esto sea barato de agregar después.

### 1.11 Mapas

- **Qué hace / estado:** **no existe como mapa real.** `features/routes_catalog` existe pero con **datos mock locales**, sin paquete de mapas (`google_maps_flutter`, `mapbox_gl` u otro — verificado, ausentes en `pubspec.yaml`).
- **Nivel de calidad:** N/A (mock).
- **Riesgo técnico:** Bajo hoy (nadie depende de datos reales todavía); alto impacto de producto si se prioriza sin planificar el costo de licencias de mapas/GPX (fuera del alcance técnico de este documento).

### 1.12 Usuarios (`backend/src/modules/users` + Firestore `users/{uid}`)

- **Qué hace:** dos implementaciones — perfil de la app principal (Firestore) y cuenta del backend propio (Postgres) — ver H1 para por qué no son la misma identidad todavía.
- **Qué tan bien diseñado:** cada una, bien; el conjunto, con la misma falla estructural que Autenticación (1.6).
- **Nivel de calidad:** **B**
- **Riesgo técnico:** Alto (mismo origen que H1).

### 1.13 Perfil (`features/profile`)

- **Qué hace:** vista de perfil, navegación a ajustes/dispositivos, logout.
- **Qué tan bien diseñado:** correcto como página de composición (sin `data`/`domain` propios, por diseño).
- **Problemas:** botón de "subir foto" con `onPressed: () {}` vacío (`profile_page.dart:152`, comentario `// TODO: subir foto vía Firebase Storage + image_picker`) — confirma que Storage (1.3) está declarado sin consumidor real todavía.
- **Dividir/unificar/eliminar/mover:** ninguna acción estructural — es una funcionalidad incompleta, no un problema de diseño.
- **Nivel de calidad:** **B+**
- **Riesgo técnico:** Bajo (funcionalidad pendiente, visible y ya marcada, no oculta).

### 1.14 Sincronización (`core/sync`)

- **Qué hace hoy:** offline-first nativo de Firestore únicamente (cachea y sincroniza al reconectar). No existe un motor genérico para NestJS.
- **Qué tan bien diseñado:** el contrato propuesto (`SyncQueue`, definido en documentación de arquitectura previa del proyecto, fuera de esta serie) es sólido y reutiliza el patrón de backoff ya probado dos veces en el proyecto (BLE, wearables) en vez de inventar un tercero.
- **Problemas:** sin idempotencia en el backend (H3), prerrequisito antes de construir el motor real.
- **Nivel de calidad:** **B** (por lo que existe; el contrato sin implementar no se califica)
- **Riesgo técnico:** Medio.

### 1.15 Configuración (`core/config` + `features/settings`)

- **Qué hace:** flags de entorno del cliente (`dart-define`, emuladores), configuración de la app.
- **Qué tan bien diseñado:** alto — doble candado para el modo QA (`kDebugMode && --dart-define`), patrón `resolveX()`/`createX()` consistente en el backend.
- **Problemas:** ninguno nuevo.
- **Nivel de calidad:** **A-**
- **Riesgo técnico:** Bajo.

### 1.16 Notificaciones

- **Qué hace / estado:** **no existe como funcionalidad.** `firebase_messaging` está en `pubspec.yaml`; búsqueda de `FirebaseMessaging`/consumidor real en `lib/` no encontró ningún dispatcher ni listener de negocio.
- **Nivel de calidad:** N/A.
- **Riesgo técnico:** Bajo hoy (dependencia inerte, no genera bugs); costo de limpieza si se decide no implementarlo pronto (dependencia declarada sin uso, mismo criterio que la sección 3).

### 1.17 Actualizaciones (in-app update / versión mínima forzada)

- **Qué hace / estado:** **no existe.** Sin paquete tipo `in_app_update`/`upgrader`/`package_info_plus` con lógica de versión mínima en `pubspec.yaml` ni en `lib/`.
- **Nivel de calidad:** N/A.
- **Riesgo técnico:** Bajo hoy (app no publicada todavía); se vuelve relevante antes del primer release público (forzar actualización ante una vulnerabilidad de seguridad sin este mecanismo implica depender 100% de las tiendas de aplicaciones, con demoras de días).

### 1.18 Resumen — módulos que NO existen todavía (evidencia negativa, tan válida como la positiva)

Verificado por ausencia de paquete en `pubspec.yaml` y ausencia de carpeta/archivo relacionado en `lib/`: **Videos, ANT+, Mapas reales, Notificaciones (funcional), Actualizaciones forzadas, Eventos, Clubes, Estadísticas agregadas (más allá de lo que ya expone `training/presentation/pages/statistics_page.dart` por consulta directa), Descargas offline, Creadores, Marketplace, Entrenadores/Gimnasios (como rol operable), IA, Panel de Administración.** Ninguno de estos es "código de mala calidad" — es superficie de producto no construida todavía; se listan acá para que el inventario de módulos del pedido original quede completo y no se confunda "no implementado" con "implementado y mal hecho".

---

## 2. Calidad del código — hallazgos transversales

### 2.1 Código duplicado

**No se encontró duplicación significativa.** Los tres puntos de posible duplicación revisados explícitamente resultaron ser reutilización correcta, no copia-pega: `translatePgError` (4 repositorios backend), `assertOwned()` (2 servicios backend), el patrón de backoff exponencial (BLE y wearables, cada uno con su propia instancia pero mismo diseño documentado como intencional). Ver `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md` sección 5 para el detalle.

### 2.2 Funciones/clases demasiado largas

| Archivo | Líneas | Veredicto |
|---|---|---|
| `lib/features/workouts/presentation/pages/workout_form_page.dart` | 489 (7 clases) | ✅ Patrón idiomático Flutter (widgets privados de un solo uso), verificado consistente en 15 páginas del proyecto — no es un hallazgo (ver `HALLAZGOS...` sección 7.1) |
| `lib/features/device_connection/data/datasources/ble_datasource.dart` | 473 (3 clases) | 🟢 H7 — vigilar, no actuar |
| `backend/src/modules/equipment/equipment.repository.ts` | 322 | ✅ Verificado línea por línea — extenso por jerarquía padre/hijo + conversión de tipos numéricos explícita, no por lógica repetida |
| `lib/features/auth/data/datasources/auth_remote_datasource.dart` | 354 | No revisado línea por línea en esta pasada — ver sección 5 (pendientes) |

**No se encontraron clases "Dios"** (clases que conocen y manipulan directamente el estado interno de múltiples dominios no relacionados) en el código inspeccionado.

### 2.3 Dependencias circulares

**Ninguna encontrada** — backend verificado por lectura directa de `auth.module.ts`/`users.module.ts` (sin ciclo, `JwtModule` global evita uno a propósito) + evidencia indirecta fuerte (57/57 e2e pasan, Nest falla al bootear si hay un ciclo no resuelto). Flutter verificado por dirección de imports cruzados: todos unidireccionales (`home`→`auth`, `profile`→`auth`, `training`→`device_connection`, `achievements`→`training`), sin ningún caso en sentido inverso.

### 2.4 Imports innecesarios / módulos acoplados

`flutter analyze --fatal-infos` pasa sin issues (evidencia citada en Documento 1 §1 y reconfirmado sin cambios de código desde entonces) — el analizador de Dart marca imports no usados dentro de un archivo como error, así que **no hay imports muertos a nivel de archivo**. El acoplamiento entre features vía `presentation/providers` (H2) es acoplamiento real pero **no accidental** (7 imports concretos, todos unidireccionales, todos hacia providers y no hacia widgets/datasources) — se documenta como decisión de diseño a mantener, no como una fuga a limpiar (ver Documento 1, sección 4.2 corregida, y H2 en `HALLAZGOS...`).

### 2.5 Malas prácticas / violaciones SOLID y Clean Architecture

| Principio | Estado | Evidencia |
|---|---|---|
| Single Responsibility | 🟡 Mayormente cumplido | `BleDataSourceImpl` (H7) es el único caso con más de una responsabilidad clara en un archivo, sin llegar a "clase Dios" |
| Open/Closed | ✅ | Patrón Adapter de wearables (`WearableAdapter`) permite agregar un proveedor nuevo sin modificar el código existente — ejemplo de referencia ya documentado en `ARCHITECTURE_DECISIONS.md` |
| Liskov | ✅ | Sin evidencia de violación — las implementaciones concretas de repositorios abstractos (`BleDataSource`/`BleDataSourceImpl`, etc.) no restringen el contrato de su interfaz |
| Interface Segregation | ✅ | Interfaces de dominio pequeñas y específicas por feature, no un contrato "todo en uno" |
| Dependency Inversion | ✅ | `domain/` define interfaces, `data/` las implementa — verificado sin excepciones en los imports de `domain/` |
| Regla de dependencia (Clean Architecture) | 🟡 | Cumplida a nivel `domain`; con la excepción documentada de `presentation`→`presentation` vía providers (H2) — ver corrección en Documento 1 |

### 2.6 Código muerto

**Hallazgo nuevo de este documento — 9 dependencias declaradas en `pubspec.yaml` sin un solo uso en `lib/`:**

| Paquete | Archivos que lo usan | Propósito declarado |
|---|---|---|
| `logger` | 0 | Logging estructurado — nunca adoptado |
| `injectable` | 0 (solo `get_it` manual se usa) | Generación de DI |
| `injectable_generator` (dev) | 0 archivos `.g.dart` generados | Genera código para `injectable` |
| `riverpod_generator` (dev) | 0 | Genera providers — el proyecto usa `Provider`/`Notifier` manual |
| `riverpod_annotation` | 0 | Anotaciones para `riverpod_generator` |
| `freezed` (dev) | 0 archivos `.freezed.dart` | Genera clases inmutables |
| `freezed_annotation` | 0 | Anotaciones para `freezed` |
| `json_serializable` (dev) | 0 | Genera `fromJson`/`toJson` |
| `json_annotation` | 0 | Anotaciones para `json_serializable` |

Confirmado también que `build_runner` (la herramienta que ejecutaría los 4 generadores de arriba) **no está wireado en `.github/workflows/ci.yml`** — ni siquiera se intenta correr en CI. **`flutter analyze` no detecta esto** porque son dependencias declaradas, no imports muertos dentro de un archivo — es exactamente el tipo de hallazgo que requiere una revisión dirigida como esta, no solo tooling automático.

- **Consecuencia técnica:** tiempo de `pub get`/CI ligeramente mayor, tamaño de `.dart_tool` mayor, y una señal confusa para cualquier desarrollador nuevo que asuma (razonablemente, por la presencia de estas dependencias) que el proyecto genera modelos/DI/providers automáticamente, cuando en realidad todo es manual.
- **Decisión recomendada (no ambigua, con justificación):** **eliminar las 9 dependencias**, no adoptar el toolchain. Razón: el proyecto ya tiene un patrón manual consistente y funcionando (modelos con `fromJson`/`toJson` escritos a mano, DI manual en `injection.dart` con ~250 líneas, providers manuales) — adoptar generación de código ahora sería un cambio de convención en 10 features simultáneamente, sin que ningún problema actual lo exija (mismo principio anti-sobreingeniería aplicado en ADR-0001/ADR-0005). La única excepción ya documentada en el propio proyecto es `injectable`: si `injection.dart` supera ~300 líneas (hoy ~250), ahí sí se justifica adoptarlo — hasta entonces, es peso muerto.
- **Severidad:** Baja (higiene, no riesgo).

---

## 3. Nivel de calidad consolidado

| Área | Nota | Justificación breve |
|---|---|---|
| Arquitectura de capas (Flutter) | A- | Consistente, sin excepciones, con una desviación documentada y aceptada (H2) |
| Arquitectura de módulos (NestJS) | A- | Monolito modular apropiado a la escala, sin ciclos |
| Manejo de errores | A | Consistente en ambos lados del stack |
| Higiene de dependencias | C+ | 9 paquetes muertos (sección 2.6) |
| Cobertura de pruebas | B | Fuerte en unit/e2e backend y unit/widget Flutter; hueco real en integración end-to-end (`integration_test/` vacío) y contratos de API (H4) |
| Consistencia de patrones | A- | Mismo criterio (backoff, ownership, traducción de errores) reutilizado en vez de reinventado |
| Documentación en código | A- | Comentarios explican decisiones no obvias (por qué, no qué) de forma consistente — ejemplo de referencia: `ble_datasource.dart` |

**Nota global de calidad de código: B+.** El código existente está por encima del promedio para el tamaño del equipo/proyecto; los problemas reales son de **integración entre sistemas** (H1, dos backends sin puente) y de **huecos de producto** (módulos no construidos), no de mala escritura de código.

---

## 4. Criterios de aprobación de este documento

- [x] Cada módulo pedido por el usuario (Frontend, Backend, Firebase, Postgres, Servicios, Autenticación, Entrenamientos, Videos, Sensores, Bluetooth, ANT+, Mapas, Usuarios, Perfil, Sincronización, Configuración, Notificaciones, Actualizaciones) evaluado individualmente, incluyendo los que no existen.
- [x] Cada evaluación responde las 6 preguntas pedidas (qué hace, calidad de diseño, problemas, dividir/unificar/eliminar/mover, nivel de calidad, riesgo técnico).
- [x] Hallazgos transversales de calidad (duplicación, funciones largas, ciclos, imports, SOLID, código muerto) con evidencia verificable.
- [x] Ningún hallazgo se reporta sin archivo/línea/comando que lo sostenga (ver también `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md`).
- [x] Se distingue explícitamente lo verificado-y-descartado de lo no-revisado (sección 5).
- [ ] **No cumplido — pendiente:** revisión línea por línea de `lib/features/*/data/` completo (~200 archivos, se inspeccionaron en detalle menos de 20 en el conjunto de Documento 1 + este documento). Este documento se entrega con esa limitación explícita, no se declara "cobertura total del código".

---

## 5. Elementos no verificados en este documento

1. `auth_remote_datasource.dart` (354 líneas) — no leído línea por línea.
2. Todos los `data/models/*.dart` de los 10 features — no se verificó exhaustivamente que cada `fromJson`/`toJson` manual esté libre de bugs de mapeo (es el tipo de error que un test de contrato, H4, detectaría automáticamente).
3. `lib/app/router/app_router.dart` (236 líneas) — no revisado en detalle por posibles rutas huérfanas o guards duplicados.
4. Cobertura de tests real por archivo (se citó el conteo total de 39 archivos de test Flutter / 8 backend, no se verificó qué porcentaje de líneas cubren).

**Siguiente documento:** Documento 3 — Seguridad.
