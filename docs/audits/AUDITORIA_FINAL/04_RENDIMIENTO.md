# RidePro — Documento Maestro de Arquitectura
## Documento 4 de 9: Rendimiento

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Método:** análisis estático de código (patrones de renderizado, streams, ciclo de vida, bootstrap) — **no incluye profiling en tiempo de ejecución** (DevTools timeline, medición de frames, `flutter drive` con métricas). Esta es la limitación más importante de este documento y se declara aquí, no al final: todo lo que sigue son riesgos identificados por inspección de código, no mediciones de CPU/RAM/tiempo reales. Ver sección 8.
- **No se modifica código en este documento.**

---

## 1. Tiempo de inicio (arranque de la app)

Secuencia real de `lib/main.dart` (leída completa):

```
runZonedGuarded
  └─ WidgetsFlutterBinding.ensureInitialized()
  └─ Firebase.initializeApp()                    ← await, bloquea el primer frame
  └─ [emulador o] Firestore persistence settings  ← await condicional
  └─ FlutterError.onError = ...
  └─ (continúa registrando DI, arrancando la app)
```

- **`Firebase.initializeApp()` es `await`-eado antes del primer frame** — esto es necesario (Firestore/Auth no funcionan sin ello) pero significa que el tiempo de inicialización de Firebase es, hoy, tiempo de arranque percibido por el usuario en su totalidad, sin ninguna pantalla de carga progresiva antes de ese punto (no se verificó si existe un splash nativo que cubra este lapso — ver sección 8).
- **Sin lazy-loading de rutas** (`go_router` registra todo el árbol de páginas al iniciar, confirmado en Documento 1) — a 10 features esto es un costo de arranque marginal; **no medido**, pero es la primera palanca a revisar si el tiempo de arranque se vuelve un problema con más features.
- **`cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED`** (`main.dart`, configuración de Firestore) — sin límite de tamaño de caché local en disco. Correcto para la experiencia offline-first (nunca se purga por tamaño), pero es una decisión que **crece indefinidamente con el uso** — ver sección 3.

**Sin medición de tiempo de arranque real (frío/caliente) en ningún dispositivo** — no verificado en esta pasada.

## 2. Tiempo de login

- Firebase Auth: el propio SDK gestiona el flujo; sin lógica propia adicional de bloqueo detectada en el camino de login (`login_page.dart`, `auth_remote_datasource.dart`) más allá de las llamadas estándar al SDK.
- **No hay medición de latencia real** — depende de la red y de los servidores de Google/Apple para el login social, fuera del control del código de la app.

## 3. Renderizado Flutter — widgets, reconstrucciones, listas

| Práctica | Estado | Evidencia |
|---|---|---|
| Listas largas virtualizadas | ✅ Donde importa | `achievements_page.dart`, `routes_catalog_page.dart`, `workouts_list_page.dart` usan `ListView.builder`/`GridView.builder` — las 3 páginas que muestran colecciones potencialmente largas de datos del usuario/catálogo lo hacen correctamente |
| Riverpod con providers granulares | ✅ | Confirmado en Documento 1 — evita reconstruir el árbol completo ante un cambio de estado parcial |
| `const` en widgets | 🟡 Parcial, no medido | No se contó sistemáticamente el ratio de widgets `const` vs no-`const` en todo el árbol — muestra puntual insuficiente para un veredicto |
| `statistics_page.dart` usa `.map().toList()` en vez de builder | 🟡 Sin verificar impacto | No se leyó el archivo completo para confirmar si la lista subyacente tiene un tamaño acotado (p. ej., un puñado de tarjetas de estadísticas fijas) o puede crecer sin límite — si es lo segundo, debería migrar a `ListView.builder` como las otras 3 páginas |

## 4. Streams y posibles fugas de memoria

**Hallazgo concreto, con evidencia directa:**

- `lib/features/device_connection/data/datasources/ble_datasource.dart`: la clase `_DeviceSession` (una instancia por cada dispositivo BLE con el que el usuario ha interactuado alguna vez — "visto en escaneo, conectado, o conocido de una sesión anterior", según el comentario propio del archivo, línea 20-23) crea un `StreamController<TelemetrySnapshot>.broadcast()` (línea 30-31). El método `disposeSubscriptions()` de esa misma clase (línea 51-56) cancela las **suscripciones** (`subscriptions`) pero **nunca llama a `telemetryController.close()`** — verificado con `grep -c ".close()"` sobre el archivo completo → 0 resultados.
- `lib/features/wearables/data/repositories/wearable_repository_impl.dart`: un `StreamController<List<WearableConnection>>.broadcast()` a nivel de repositorio (línea 37-38) — este caso es de menor riesgo porque vive durante toda la vida del repositorio (un singleton efectivo vía DI), no se crea uno nuevo por evento.
- **Consecuencia técnica real:** si `_DeviceSession` no se elimina del mapa que lo contiene cuando el usuario llama a `forgetDevice()` (el método existe en la interfaz `BleDataSource`, no se verificó en esta pasada si efectivamente remueve la entrada del mapa — ver sección 8), cada dispositivo que un usuario prueba y descarta a lo largo de meses de uso deja un `StreamController` sin cerrar referenciado indefinidamente. Un ciclista que prueba 5-10 rodillos/sensores distintos a lo largo de la vida de la app (upgrades de equipo, pruebas de gimnasio) acumula ese número de controllers sin cerrar.
- **Severidad: Media** — no es una fuga catastrófica (cada `StreamController` sin listeners activos es liviano), pero es un patrón incorrecto y de bajo costo corregir: cerrar `telemetryController` dentro de `disposeSubscriptions()` o en un método `dispose()` explícito de `_DeviceSession`, invocado cuando el dispositivo se olvida o la app se cierra.
- **Solución recomendada:** agregar `telemetryController.close()` al método `disposeSubscriptions()` (renombrable a `dispose()` para reflejar que ya no es solo de suscripciones), y verificar que `forgetDevice()` lo invoque antes de remover la entrada del mapa interno.

## 5. Consultas repetidas / N+1

**Sin evidencia encontrada** — ya verificado en el Documento 2 (sección 3, "Cuellos de botella") por lectura completa de `equipment.repository.ts` y `workouts.repository.ts`: consultas explícitas y acotadas por endpoint, sin ORM con lazy-loading. Del lado Flutter, no se detectó ningún patrón de "leer N documentos de Firestore dentro de un loop" en los archivos inspeccionados — Firestore expone listeners reactivos (`snapshots()`), no round-trips manuales repetidos, para los casos revisados (`ride_sessions` con `limit(30)`, ya citado en Documento 1).

## 6. Bluetooth (BLE)

- **Backoff exponencial con límite de tiempo total de reconexión** (no solo de número de intentos) — decisión de diseño explícita y ya documentada para evitar drenar batería en segundo plano reintentando indefinidamente (`ble_datasource.dart`, comentario en `_DeviceSession.firstDisconnectAt`).
- **Parsers con estado por dispositivo, no globales** (`CyclingPowerParser`, `CscParser` instanciados por `_DeviceSession`) — evita que el histórico acumulado de un dispositivo contamine el cálculo de otro conectado simultáneamente; correcto para multi-dispositivo (varios sensores a la vez).
- Ver sección 4 para el hallazgo de streams sin cerrar, específico de este módulo.

## 7. Sincronización (sync)

- Offline-first de Firestore: nativo del SDK, sin lógica propia de reintento manual que pueda entrar en un loop — el propio SDK resuelve el `Future` de escritura como exitoso en cuanto se persiste en caché local (documentado en el comentario de `main.dart`), sin bloquear al usuario esperando red.
- Sin motor de sincronización propio para NestJS todavía (Documento 1 sección 9) — por lo tanto, sin riesgo de rendimiento propio de ese componente porque no existe código que ejecutarlo.

## 8. No verificado — limitaciones explícitas de este documento

Este documento es **análisis estático únicamente**. Lo siguiente requiere herramientas que no se ejecutaron en esta pasada (profiler de Flutter DevTools, medición de frames, `flutter build --profile` + captura de timeline, pruebas de carga del backend):

1. **Tiempo de arranque real** (frío/caliente, por plataforma) — no medido.
2. **Tiempo de login/primera pantalla útil** — no medido.
3. **Duración de una sesión de entrenamiento típica bajo uso real** (¿el HUD mantiene 60fps con telemetría BLE llegando varias veces por segundo?) — no medido, es precisamente el escenario de mayor riesgo de jank (recepción de datos BLE a alta frecuencia + renderizado en vivo) y el que más se beneficiaría de profiling real antes de cualquier release.
4. **Uso de RAM a lo largo de una sesión larga** (¿`TelemetryAggregator` y los buffers de los parsers crecen sin límite durante una sesión de 3+ horas, típica de ciclismo indoor de larga distancia?) — no verificado; el código de `TelemetryAggregator.reset()` sugiere que se libera al finalizar la sesión (citado en Documento 1), pero no se confirmó el comportamiento **durante** una sesión larga.
5. **Si `forgetDevice()` remueve realmente `_DeviceSession` del mapa que lo contiene** — necesario para confirmar la severidad exacta del hallazgo de la sección 4.
6. **Comportamiento de `statistics_page.dart`** con datos reales de un usuario con historial extenso — no se confirmó si la lista renderizada ahí está acotada por diseño.
7. **Rendimiento del backend bajo carga** (tiempo de respuesta de `equipment`/`workouts` con volumen de datos realista) — no se ejecutó ninguna prueba de carga (`k6`, `autocannon`, o equivalente).
8. **Tamaño del bundle/APK** y su impacto en tiempo de descarga/instalación — no medido.

**Recomendación explícita antes de cualquier release público:** ejecutar al menos una sesión de profiling real con Flutter DevTools durante un entrenamiento simulado con telemetría BLE a frecuencia realista (los puntos 3 y 4 de arriba son los de mayor riesgo y menor costo de verificar: requieren un dispositivo BLE simulado o real, no infraestructura nueva).

---

## 9. Resumen de hallazgos

| # | Hallazgo | Severidad | Verificado con evidencia de código |
|---|---|---|---|
| R1 | `telemetryController` en `_DeviceSession` nunca se cierra | Medio | ✅ Sí (grep + lectura directa) |
| R2 | `Firebase.initializeApp()` bloquea el primer frame, sin splash/estrategia de carga progresiva verificada | Bajo-Medio | 🟡 Parcial (secuencia confirmada, impacto en UX no medido) |
| R3 | Caché de Firestore sin límite de tamaño (`CACHE_SIZE_UNLIMITED`) | Bajo (a vigilar con el tiempo) | ✅ Confirmado en código, impacto real no medido |
| R4 | Posible lista no virtualizada en `statistics_page.dart` | Bajo, sin confirmar | 🟡 No verificado el tamaño real de los datos |
| R5 | Sin profiling de la sesión de entrenamiento en vivo (mayor riesgo de jank del proyecto) | **No es un hallazgo de código — es un hueco de verificación** | ⚪ No ejecutado |

## 10. Criterios de aprobación de este documento

- [x] Cubre los ejes pedidos donde es posible verificarlos con análisis estático: CPU/RAM (parcial), renderizado, widgets, reconstrucciones, streams, fugas de memoria, inicialización, BLE, sincronización.
- [x] Cada hallazgo con evidencia de archivo/línea.
- [ ] **No cumplido — declarado explícitamente:** medición real de tiempos (arranque, login, entrenamiento) y profiling de CPU/RAM en ejecución — requiere herramientas y un dispositivo/emulador con sesión activa, fuera del alcance de una revisión de código estático. Este documento no se declara "completo" en el sentido de rendimiento medido, solo en el de rendimiento analizado por código.

**Siguiente documento:** Documento 5 — Escalabilidad.
