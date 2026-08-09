# Korixa

> **Nombre del producto y del repositorio:** el producto se llama
> **Korixa**. Este repositorio (`freddyestebancuervo/rouvy_pro`) y varios
> identificadores técnicos conservan el nombre anterior del producto,
> **RidePro**, y no han sido renombrados: nombre del repositorio
> (`rouvy_pro`), namespace Android `com.ridepro.app` (Development usa el
> `applicationId`/package `com.ridepro.app.dev`; Production conserva el
> `applicationId` placeholder `com.ridepro.app.YOUR_APPLICATION_ID`,
> pendiente — ver `android/app/build.gradle.kts`), nombres de archivo
> como `RIDEPRO_DEVELOPMENT_PROTOCOL.md`, y referencias internas en
> código/configuración. **El Bundle ID de iOS sí fue renombrado**:
> `com.korixa.app` en Production y `com.korixa.app.dev` en Development
> — ver `PROJECT_STATUS.md` §5 para el detalle. Este documento usa "Korixa" para el producto y
> conserva los identificadores técnicos reales sin alterarlos — no se ha
> ejecutado ninguna migración masiva de nombre. Ver
> `PROJECT_STATUS.md` y `docs/product/PRODUCT_IDEAS_REGISTRY.md` para más
> detalle.

Korixa es una plataforma de ciclismo indoor construida en **Flutter**
(cliente Android/iOS/Web, Windows como plataforma objetivo declarada
— ver "Plataformas objetivo" abajo) + **Firebase** (Auth, Firestore,
Analytics, Crashlytics, Messaging) + **NestJS/PostgreSQL** (backend
propio para Equipment/Workouts, en paralelo a Firebase — ver
`backend/README.md` y `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0
para el porqué de dos fuentes de datos).

> **Especificación técnica de producción:** antes de seguir extendiendo
> M0/M1, revisar `docs/TECHNICAL_SPECIFICATION_M0_M1.md` (contratos de
> API, esquema de datos, seguridad, tiempo real, offline-first,
> arquitectura completa y cuellos de botella) y `ROADMAP_M0_M1.md` (el
> siguiente paso exacto de implementación). Para el núcleo funcional
> futuro (equipamiento, entrenamientos, rutas, métricas), ver
> `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` — diseño propuesto, **sin
> implementar**.

## Plataformas objetivo

| Plataforma | Estado |
|---|---|
| Android | Implementado — proyecto nativo generado y en uso. Flavor `development` real, con **Google Sign-In validado en runtime** (2026-08-09 — ver `PROJECT_STATUS.md` §5); Production conserva un `applicationId` placeholder pendiente de corrección. |
| iOS | CI valida por separado Production y Development (`ios-build.yml`): compilación sin firma, Bundle ID (`com.korixa.app`/`com.korixa.app.dev`), `GoogleService-Info.plist` empaquetado, `PROJECT_ID` y callback/configuración de Google Sign-In (ver `PROJECT_STATUS.md` §1.1/§3/§5). El smoke test de simulador (`ios-simulator-smoke.yml`) compila con `flutter build ios --debug --simulator`, sin `--flavor development` ni `-t lib/main_development.dart` — **no constituye evidencia runtime del flavor Development**. No validado: login Google/Auth real en runtime (no en iOS; sí validado en Android Development), Firestore/Analytics funcional real, HealthKit, APNs, firma de código real. |
| Web | Implementado — incluye el guard de plataforma para Wearables (`T-F0.1`, integrado a `main`). |
| Windows | **Objetivo declarado, no implementado todavía.** El directorio nativo `windows/` no existe en `main`; generarlo y validar plugins de riesgo (Google/Apple Sign-In, Firebase con config de Web como placeholder) es la tarea abierta `T-F2.7` del backlog. |

## Módulo de Autenticación (Clean Architecture)

El módulo de autenticación está **completo e implementado**: bienvenida,
registro, login (correo, Google, Apple), recuperación de contraseña,
verificación de correo, perfil editable, logout y protección de rutas.
Sirve de plantilla arquitectónica para el resto de features (rutas,
entrenamiento, multijugador, retos...).

## Cómo arrancar

```bash
flutter pub get

# Conectar el proyecto a Firebase real (sobrescribe firebase_options.dart):
dart pub global activate flutterfire_cli
flutterfire configure

# Ver SETUP_SOCIAL_LOGIN.md para la guía paso a paso completa de
# credenciales de Google/Apple Sign-In (con checklist final).

flutter gen-l10n   # genera las clases de internacionalización
flutter run
```

Pruebas:

```bash
flutter test
```

> **Nota:** este proyecto NO usa `build_runner`/`injectable` para la
> inyección de dependencias (ver justificación en `core/di/injection.dart`).

---

## Flujo de pantallas y protección de rutas

```
Sin sesión ──► Welcome ──► Login / Registro / Recuperar contraseña
                              │
                    (login o registro exitoso)
                              │
                              ▼
              ¿Cuenta con correo/contraseña y NO verificada?
                    │ sí                         │ no (o Google/Apple)
                    ▼                             ▼
          Verificación de correo ──(verificado)──► Home ──► Perfil
```

`GoRouter.redirect` (en `app_router.dart`) aplica estas reglas en cada
navegación — ninguna pantalla individual comprueba sesión manualmente:

1. Sin sesión → solo accesible: Welcome, Login, Registro, Recuperar contraseña.
2. Con sesión y correo sin verificar (solo cuentas password) → forzado a
   la pantalla de verificación, sin poder navegar a ninguna otra parte.
3. Con sesión y verificado → si intenta entrar a una pantalla de auth,
   se le redirige a Home.

## Estructura de carpetas y qué hace cada archivo

```
lib/
├── main.dart                          # Entry point: Firebase, errores globales, DI, runApp
├── firebase_options.dart              # Configuración real de Firebase (`ridepro-dbafe`), generada por FlutterFire CLI
│
├── app/
│   ├── app.dart                       # MaterialApp.router: conecta tema + router + l10n
│   ├── router/app_router.dart         # GoRouter — protección de rutas completa (ver arriba)
│   └── theme/
│       ├── app_colors.dart            # Paleta de marca (única fuente de verdad de color)
│       ├── app_theme.dart             # ThemeData claro/oscuro (Material 3)
│       └── theme_provider.dart        # Notifier de Riverpod + persistencia del modo de tema
│
├── core/
│   ├── error/
│   │   ├── failures.dart              # Errores de DOMINIO (cruzan hacia la UI)
│   │   ├── exceptions.dart            # Errores de DATA (Firebase, Dio — nunca llegan a domain)
│   │   └── error_handler.dart         # Traductor Exception → Failure (incl. Google/Apple)
│   ├── usecase/usecase.dart           # Contrato base UseCase<Type, Params>
│   ├── network/network_info.dart      # Verificación de conectividad
│   ├── di/injection.dart              # get_it — registro de todas las dependencias
│   ├── utils/
│   │   ├── validators.dart            # Validadores puros (testeables sin Flutter)
│   │   └── validation_l10n.dart       # Traduce ValidationError → texto localizado
│   └── widgets/app_primary_button.dart
│
├── features/
│   ├── auth/                          # FEATURE DE REFERENCIA — copiar este patrón
│   │   ├── domain/
│   │   │   ├── entities/user_entity.dart   # incluye emailVerified, providerType
│   │   │   ├── repositories/auth_repository.dart
│   │   │   └── usecases/              # 10 casos de uso, uno por acción
│   │   ├── data/
│   │   │   ├── models/user_model.dart
│   │   │   ├── datasources/auth_remote_datasource.dart  # Firebase + Google + Apple
│   │   │   └── repositories/auth_repository_impl.dart
│   │   └── presentation/
│   │       ├── providers/             # auth_providers, login/register/forgot/
│   │       │                          # email_verification/profile/logout/social controllers
│   │       ├── widgets/social_sign_in_buttons.dart
│   │       └── pages/                 # welcome, login, register, forgot_password,
│   │                                  # email_verification, splash
│   ├── profile/presentation/pages/profile_page.dart   # perfil editable + logout
│   └── home/presentation/pages/home_page.dart
│
└── l10n/
    ├── app_es.arb                     # Español (idioma plantilla/base)
    ├── app_en.arb                     # Inglés
    └── generated/                     # Autogenerado por `flutter gen-l10n` — no editar a mano

test/
├── core/
│   ├── error_handler_test.dart
│   └── validators_test.dart
└── features/auth/domain/usecases/
    ├── login_usecase_test.dart
    ├── register_usecase_test.dart
    ├── sign_in_with_google_usecase_test.dart
    ├── send_password_reset_usecase_test.dart
    └── update_profile_usecase_test.dart
```

## Decisiones de arquitectura clave (por qué está hecho así)

1. **Regla de dependencia de Clean Architecture:** `domain` no importa nada
   de `data` ni de paquetes de Flutter/Firebase. Esto es lo que permite
   testear `LoginUseCase`/`RegisterUseCase` con un repositorio mockeado
   (ver `test/features/auth/domain/usecases/`) sin encender Firebase.

2. **`Either<Failure, T>` (dartz) en vez de excepciones en `domain`:** las
   excepciones (`AuthException`, `ServerException`...) viven solo en `data`;
   `AuthRepositoryImpl` las captura y las convierte a `Failure` mediante
   `AppErrorHandler`. La UI nunca hace `try/catch` de Firebase, solo
   `result.fold(onError, onSuccess)`.

3. **Un caso de uso por acción**, no un `AuthUseCase` genérico con varios
   métodos — cada uno es una clase con una sola responsabilidad, fácil de
   testear en aislamiento y de reutilizar en distintos controllers.

4. **`StreamProvider<UserEntity?>` como fuente única de verdad de sesión:**
   `GoRouter.redirect` observa `authStateProvider` para decidir la
   navegación — ninguna pantalla individual necesita comprobar "¿hay
   sesión?" manualmente.

5. **DI manual con `get_it`** en vez de `injectable` + `build_runner`: el
   proyecto compila sin pasos de generación previos. Documentado como
   decisión reversible en el propio archivo `injection.dart`.

6. **Responsive sin paquetes adicionales:** `LoginPage`/`RegisterPage` usan
   `ConstrainedBox(maxWidth: 420)` para no estirarse en pantallas anchas;
   `HomePage` usa `LayoutBuilder` para cambiar de columna a fila según el
   ancho disponible (ver `_wideBreakpoint`). Este mismo patrón debe
   replicarse en el resto de pantallas del documento funcional.

7. **`UserEntity.requiresEmailVerification` como regla de negocio en el
   dominio, no en la UI:** el router solo pregunta ese getter — la lógica
   de "¿a quién le exijo verificar?" vive en una sola clase, no repartida
   entre `redirect` y las pantallas.

8. **Reload manual + `ref.invalidate(authStateProvider)`:** Firebase no
   emite un nuevo evento en `authStateChanges()` cuando solo cambia
   `emailVerified` (requiere `user.reload()`, que no dispara el stream).
   `EmailVerificationController.checkIfVerified()` fuerza el reload y
   luego invalida el provider para que el stream se vuelva a suscribir y
   entregue el valor ya actualizado — mismo patrón se usa en
   `ProfileController` tras editar el perfil.

## Qué falta (siguientes módulos, según el plan de desarrollo)

Este scaffold cubre la base transversal (M0) + **Auth completo** (M1):
bienvenida, registro/login con correo, Google, Apple, recuperación de
contraseña, verificación de correo, perfil editable, logout y protección de
rutas. Pendiente dentro del propio M1: subida de foto de perfil (Storage +
`image_picker`) y eliminación de cuenta. Los siguientes módulos (conexión
BLE, catálogo de rutas, HUD de entrenamiento, multijugador, retos,
wearables, IA, panel admin) se construyen como nuevas carpetas bajo
`features/`, replicando exactamente la estructura `domain/data/presentation`
de `features/auth`.

Antes de compilar en un dispositivo real, revisar **`SETUP_SOCIAL_LOGIN.md`**
(guía completa y checklist de credenciales de Google/Apple Sign-In),
**`BLE_PERMISSIONS.md`** para los permisos de Bluetooth en Android/iOS,
**`ARCHITECTURE_DECISIONS.md`** + **`WEARABLES_SETUP.md`** para el módulo
de integraciones con wearables, y **`HEALTH_SETUP.md`** para la
configuración específica de HealthKit/Health Connect.

## Seguridad — reglas de Firestore y backend, validados en CI

Se encontró y corrigió una vulnerabilidad crítica de escalada de
privilegios en las reglas de Firestore (ver `docs/SECURITY_AUDIT.md`).
La corrección (`firestore.rules` + `firebase/rules-tests/`) **está
implementada y validada**: el job `Firestore — reglas de seguridad
(A3/A5)` de CI corre 28 pruebas contra el emulador en cada PR, todas en
verde (evidencia directa, run de CI de 2026-07-31 — ver
`PROJECT_STATUS.md` §3 "Tests"). El backend (`backend/`, NestJS +
PostgreSQL) tampoco es ya un scaffold sin ejecutar: existe, se prueba en
CI contra un Postgres 16 real (86/86 pruebas e2e en verde) y tiene una
imagen Docker de producción validada — ver `backend/README.md` y
`PROJECT_STATUS.md`. **Pendiente:** despliegue real a un hosting en vivo
(`T-F1.1`). `T-F0.2`/`C1` sigue abierto. Development ya tiene
configuración para Web, Android e iOS y Google Sign-In real fue
validado en Android Development. El cierre formal sigue pendiente de la
reconciliación final de las puertas A–J; entre los gaps ya confirmados
están la validación de reglas de Firestore contra el proyecto real,
CI/CD de despliegue y el ensayo de rollback. Ver `PROJECT_STATUS.md`.

**Ver `VERIFICATION_GUIDE.md`** para los comandos exactos y el resultado
esperado de cada uno. **Sin terminal disponible (p. ej. desde el celular)?**
Ver `CI_CD_GUIDE.md` — mismo resultado, corriendo en GitHub Actions.

## Offline-First (`core/sync`)

Persistencia offline de Firestore activada en `main.dart` — la app sigue
siendo completamente funcional sin conexión (lecturas desde caché,
escrituras encoladas y sincronizadas solas al volver la red).
`FirestoreSyncService` + `ConnectivitySyncBanner` añaden un estado
observable ("sincronizando…") sobre ese comportamiento nativo. Ver
`docs/OFFLINE_FIRST.md` para el detalle completo, el modelo de
resolución de conflictos, y el protocolo de verificación manual.

## Módulo de HUD de entrenamiento (`features/training`)

Sesión de entrenamiento libre que consume directamente la telemetría
combinada de `device_connection` (sin depender aún del catálogo de rutas,
módulo M4 pendiente). `RideSessionController` fusiona dinámicamente los
streams de todos los dispositivos conectados —incluso si se conectan a
mitad de sesión— y usa `TelemetryAggregator` para acumular distancia y
calorías. Accesible desde el botón "Entrenar ahora" en Home.

## Modo Demo (`docs/DEMO_MODE.md`)

`flutter run -t lib/main_demo.dart` — recorre la app completa con datos
simulados, sin Firebase/Postgres/BLE real. Útil mientras A3/C2 siguen
pendientes de verificación. Incluye catálogo de rutas (`features/routes_catalog`,
nuevo) y Configuración (`features/settings`, nuevo — tema e idioma).

## Accesibilidad (`docs/ACCESSIBILITY.md`)

Primera auditoría de accesibilidad del proyecto — encontró y corrigió un
problema real y no trivial: **el color primario de todos los botones
principales de la app tenía contraste insuficiente (3.31:1) con el texto
blanco**, por debajo del mínimo WCAG AA (4.5:1). Corregido junto con
`success`/`warning`/`error`, más 3 widgets sin equivalente semántico para
lectores de pantalla (`SignalStrengthIndicator`, `WeeklyBarChart`, toggle
de contraseña). Incluye `core/utils/color_contrast.dart` (verificador de
contraste WCAG reutilizable) con test de regresión.

## Logros (`features/achievements`)

`AchievementsPage` (Perfil → Logros): catálogo estático de 10 logros
(`AchievementCatalog`) evaluado por `AchievementEvaluator` — lógica pura,
sin Firestore ni backend, reutilizando `StatisticsSummary` y el historial
ya cargados (mismo patrón que Estadísticas). Añadir un logro nuevo es
agregar una entrada a la lista, sin tocar infraestructura. 8 tests cubren
criterios agregados (distancia/sesiones/racha total) y de una sola sesión
(century, resistencia), incluyendo el caso de que el progreso nunca
exceda el 100%.

## Estadísticas (`features/training`, M3 del roadmap general)

`StatisticsPage` (Perfil → Estadísticas): totales, racha de días
consecutivos y gráfico semanal, calculados con `StatisticsCalculator` —
lógica 100% pura (sin Firestore, sin red) sobre el historial que
`rideSessionsProvider` ya carga para `RideHistoryPage`. No agrega
ninguna colección ni consulta nueva a Firestore, así que no requiere
ninguna verificación adicional de reglas de seguridad más allá de las ya
cubiertas por `firebase/rules-tests/` (A3) — es lectura pura sobre
`ride_sessions`, ya probado ahí. 15 tests cubren la lógica de racha
(incluyendo el caso de "racha rota por un hueco") y la distribución
semanal.

## Historial de entrenamientos (`features/training`, persistencia)

Cada sesión finalizada se guarda automáticamente en Firestore
(`users/{uid}/ride_sessions`, subcolección por usuario para que las reglas
de seguridad sean triviales) sin bloquear la pantalla de resumen — el
guardado ocurre en background y un ícono discreto en el AppBar indica si
tuvo éxito, sin interrumpir el momento post-entrenamiento con un error de
red. `RideHistoryPage` (Perfil → Historial de entrenamientos) lista las
últimas 30 sesiones. Es la base de datos sobre la que se construirá el
módulo de Estadísticas (M3: gráficas, curva de potencia, récords).

## Capa de abstracción de salud (`core/health`)

`HealthPlatformGateway` desacopla `HealthPackageAdapter` (módulo
wearables) del paquete `health` concreto — ver `HEALTH_SETUP.md` para la
configuración nativa completa (HealthKit/Health Connect) y cómo se
gestionan los 5 estados posibles (concedido, denegado, denegado
permanentemente, no instalado, no disponible) sin bloquear el resto de la
app.

## Módulo de conexión BLE (`features/device_connection`)

Escaneo, emparejamiento, reconexión automática y lectura en tiempo real de
rodillos inteligentes, medidores de potencia, sensores de cadencia/velocidad
y pulsómetros, implementado contra los **estándares BLE** (FTMS Indoor Bike
Data, Cycling Power Measurement, CSC Measurement, Heart Rate Measurement),
sin SDK propietario por fabricante. Esto da **compatibilidad prevista** con
cualquier dispositivo que implemente correctamente estos estándares —
incluyendo marcas habituales del mercado como Wahoo, Tacx, Elite, Zwift Hub,
JetBlack o ThinkRider — pero el código y los tests actuales verifican los
**protocolos y parsers** (con datos simulados/mockeados), no la validación
física de cada marca/modelo real. **Validación con hardware real: pendiente**
antes de afirmar compatibilidad confirmada dispositivo por dispositivo.

- `core/ble/` — UUIDs GATT estándar del Bluetooth SIG y el wrapper de
  permisos (Android 12+ vs ≤11 vs iOS difieren bastante, ver `BLE_PERMISSIONS.md`).
- `data/parsers/` — un parser puro (o con estado mínimo) por protocolo:
  FTMS Indoor Bike Data, Cycling Power Measurement, CSC Measurement, Heart
  Rate Measurement, Battery Level. Los tres primeros están cubiertos por
  tests en `test/features/device_connection/data/parsers/`.
- `data/datasources/ble_datasource.dart` — única capa que importa
  `flutter_blue_plus`. Mantiene una `_DeviceSession` por dispositivo
  (suscripciones activas, parsers con estado, intentos de reconexión) y
  aplica backoff exponencial (2s→30s, hasta 6 intentos) ante una caída de
  señal inesperada.
- `domain/services/telemetry_aggregator.dart` — fusiona snapshots de
  varios dispositivos en una sola vista para el futuro HUD de
  entrenamiento (M2), integrando distancia y calorías en el tiempo.
- `presentation/pages/device_management_page.dart` — pantalla accesible
  desde Perfil → Dispositivos conectados.

Los dispositivos conectados se recuerdan en `shared_preferences`
(`known_devices_local_datasource.dart`) y `main.dart` intenta reconectarlos
automáticamente al arrancar la app, sin bloquear la primera pantalla.
