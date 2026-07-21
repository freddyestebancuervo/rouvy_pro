# Modo Demo — frontend navegable con datos simulados

Permite recorrer la app completa (bienvenida → login → home → catálogo de
rutas → dispositivos BLE → entrenamiento en vivo → resumen → perfil →
configuración) **sin Firebase, sin Postgres, sin BLE real, y sin
GitHub Actions** — todo lo que sigue bloqueado por verificación puede
seguir bloqueado mientras esto se usa para demos, revisión de UX, o
desarrollo de pantallas nuevas.

---

## Cómo correrlo

```bash
flutter run -t lib/main_demo.dart
```

(`main_demo.dart`, no `main.dart` — son dos puntos de entrada distintos
en el mismo proyecto, patrón estándar de Flutter para "flavors"/variantes
de build.)

Se reconoce inmediatamente por la cinta morada "DEMO" en la esquina
superior — para que ninguna captura de pantalla compartida se confunda
con la app real.

## Qué es exactamente "modo demo" aquí

**No es una app distinta.** Es la MISMA `RideProApp` (mismas pantallas,
mismo `GoRouter`, mismo tema, misma i18n) que usa `main.dart`, corriendo
con 4 repositorios reemplazados por versiones simuladas:

| Repositorio | Implementación real (`main.dart`) | Implementación demo (`main_demo.dart`) |
|---|---|---|
| `AuthRepository` | `AuthRepositoryImpl` (Firebase Auth + Firestore) | `FakeAuthRepository` (memoria) |
| `DeviceRepository` | `DeviceRepositoryImpl` (flutter_blue_plus) | `FakeDeviceRepository` (Timer simulando BLE) |
| `RideSessionRepository` | `RideSessionRepositoryImpl` (Firestore) | `FakeRideSessionRepository` (memoria) |
| `WearableRepository` | `WearableRepositoryImpl` con 2 adapters reales + 4 mock | El MISMO `WearableRepositoryImpl`, con los 6 adapters simulados |

Todo lo demás — `RoutesRepository` (catálogo de rutas), lógica de
`RideSessionController`, `StatisticsCalculator`, `AchievementEvaluator`,
temas, i18n, snapshot de recuperación de sesión (B1) — es exactamente el
mismo código que en producción, sin ningún `if (modo == demo)` disperso
por la base de código. Es el resultado directo de haber seguido Clean
Architecture desde el principio: la presentación y el dominio nunca
supieron que existía Firebase, así que no les importa que ahora no exista.

## Cómo funciona técnicamente (para quien vaya a tocar esto)

1. **`lib/demo/fixtures/`** — datos fijos: un usuario, 6 sesiones de
   entrenamiento de los últimos 10 días (con un hueco intencional para
   que la racha de Estadísticas no sea "perfecta"), 2 dispositivos BLE
   descubribles, y un generador de telemetría con caminata aleatoria
   acotada (no números totalmente al azar, para que se vea realista).

2. **`lib/demo/fakes/`** — las 4 implementaciones de repositorio, más 2
   adapters de wearables específicos de demo
   (`DemoAppleHealthAdapter`/`DemoGoogleFitAdapter`, para no tocar
   HealthKit/Health Connect nativos) y un `NoOpHealthPlatformGateway`.
   Ninguno de estos archivos importa `firebase_auth`, `cloud_firestore`
   ni `flutter_blue_plus` — se puede verificar con
   `grep -rn "package:firebase\|package:cloud_firestore\|package:flutter_blue_plus" lib/demo/`
   (debería devolver vacío).

3. **`lib/demo/demo_injection.dart`** — registra en el MISMO GetIt
   global (`sl`) solo 3 piezas sin ninguna dependencia de Firebase:
   `SharedPreferences`, `BlePermissionHandler` (real — `permission_handler`
   no depende de Firebase) y `RideSessionSnapshotLocalDataSource` (real —
   solo envuelve `SharedPreferences`). **Nunca** llama a
   `initDependencyInjection()` (la función de producción, que registraría
   `FirebaseAuth`/`FirebaseFirestore` reales y fallaría sin
   `Firebase.initializeApp()`).

4. **`lib/demo/demo_overrides.dart`** — la lista de `Override` de
   Riverpod que reemplaza cada `xRepositoryProvider` Y cada
   `xUseCaseProvider` (los casos de uso también, no solo el repositorio —
   ver el docblock del archivo para la explicación completa de por qué
   hace falta esto y no alcanza con overridear solo el repositorio).

5. **`lib/main_demo.dart`** — el entrypoint: `initDemoDependencyInjection()`
   + `ProviderScope(overrides: buildDemoOverrides())`. Nunca llama a
   `Firebase.initializeApp()`.

## Cómo volver a producción (reemplazar los fakes por lo real)

**No hace falta "deshacer" nada** — `main.dart` (el entrypoint de
producción) ya existe sin tocar, y sigue usando las implementaciones
reales de siempre. El modo demo es aditivo, no una modificación de la app
real.

Si en el futuro se quisiera, por ejemplo, dejar de simular
`RideSessionRepository` específicamente y usar Firestore real dentro del
propio modo demo (manteniendo el resto simulado): en
`demo_overrides.dart`, quitar las 2 líneas de override de
`saveRideSessionUseCaseProvider`/`observeRideSessionsUseCaseProvider`, y
en `demo_injection.dart` registrar `RideSessionRemoteDataSource` +
`RideSessionRepository` reales (requiere entonces sí llamar a
`Firebase.initializeApp()` en `main_demo.dart` antes de
`initDemoDependencyInjection()`).

## Qué cubre y qué NO cubre el modo demo (honestidad sobre el alcance)

**Cubre (los 12 puntos del encargo):**
1-3. Bienvenida, login/registro simulados, inicio ✅ (páginas reales,
     repositorio de auth simulado)
4-5. Catálogo de rutas y detalle ✅ (feature nueva, mock — no hay
     backend real todavía para rutas en NINGÚN modo, ni siquiera
     producción, ver docstring de `TrainingRoute`)
6-7. Conexión BLE y HUD con métricas simuladas ✅ (`FakeDeviceRepository`
     + `DemoTelemetryGenerator`)
8. Pausar/reanudar/finalizar ✅ (código real de `RideSessionController`,
   sin cambios)
9. Resumen con gráficas ✅ (`SessionSummaryPage` real +
   `StatisticsPage`/`AchievementsPage` reales, alimentadas por
   `FakeRideSessionRepository`)
10-11. Perfil y Configuración ✅ (páginas reales; Configuración es
      feature nueva de esta misma tarea)
12. Estados de carga/vacío/error/sin conexión ✅ — `AsyncValueView`,
    `EmptyStateView`, `ErrorStateView` nuevos, aplicados en
    `RoutesCatalogPage` como referencia; el resto de pantallas ya tenía
    manejo de estos 4 estados de antes (no se tocaron).

**NO cubre (limitaciones honestas):**
- El estado "sin conexión" real (offline) del modo demo no tiene sentido
  del mismo modo que en producción — no hay ninguna llamada de red que
  simular fallando por falta de conexión, ya que todo vive en memoria.
  `ErrorStateView` distingue `NetworkFailure` de otros errores, pero
  ningún fake de este árbol produce esa `Failure` específica hoy.
- Video/terreno 3D real de las rutas — el botón "Entrenar esta ruta" va
  a una sesión libre genérica (`/training`), no una sesión sincronizada
  con el contenido de la ruta — eso es trabajo de una fase posterior de
  M4, fuera del alcance de "frontend navegable con datos simulados".

## Tests

- `test/demo/demo_fakes_smoke_test.dart` — los 3 fakes principales a
  nivel de repositorio (sin pump de widgets).
- `test/features/routes_catalog/presentation/pages/routes_catalog_page_test.dart`
  — los 4 estados (carga/datos/vacío/error) de la nueva pantalla.
- `test/features/settings/presentation/pages/settings_page_test.dart` —
  tema e idioma.
- `test/navigation/demo_navigation_test.dart` — navegación de extremo a
  extremo con el router y la app REALES, usando los overrides de demo:
  Bienvenida → Login simulado → Home → Catálogo → Detalle → volver.

⚠️ **Ninguno de estos tests se ha ejecutado en el entorno donde se
escribieron** (sin Flutter SDK disponible aquí) — mismo patrón de
limitación que el resto del proyecto (ver `docs/SECURITY_AUDIT.md`,
`backend/README.md`). Se verificaron manualmente: balance de
paréntesis/llaves, que cada import resuelve a un archivo real, y que los
textos/claves de `l10n` usados en las aserciones (`find.text(...)`)
coinciden exactamente con los valores reales de `app_es.arb`. Antes de
dar por buena esta tarea, correr `flutter test` en un entorno real y
confirmar que los 4 archivos nuevos pasan.
