# T-F0.1 — Análisis y Diseño
## Corregir el crash del módulo Wearables en Flutter Web

- **Fecha:** 2026-07-24
- **Fase del ciclo de vida cubierta por este documento:** Etapa 1 (Análisis), Etapa 2 (Diseño), Etapa 3 (Evaluación de riesgos) de `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §1. **No cubre Implementación, Pruebas, Autoauditoría de código, Documentación de cierre, Revisión independiente, Aprobación ni Cierre** — esas etapas empiezan solo tras aprobación explícita de este diseño.
- **IDs de origen:** `T-F0.1` (`BACKLOG_MAESTRO.md`), `A2` (`07_RIESGOS_TECNICOS.md`), `PLAT-1` (`06_MULTIPLATAFORMA.md`).
- **Restricciones respetadas:** no se modificó código, no se creó ningún commit, no se alteró `MASTER_EXECUTION_PLAN.md` ni `BACKLOG_MAESTRO.md`, no se tocó ningún documento de la auditoría existente. Este documento es de solo análisis.

---

## 1. Resumen ejecutivo

`HealthPlatformGatewayImpl.checkAvailability()` accede a `Platform.isIOS`/`Platform.isAndroid` (de `dart:io`) como primera instrucción de un método que se ejecuta en cualquier plataforma, incluida Web — donde `dart:io`'s `Platform` lanza `UnsupportedError` en tiempo de ejecución. El propio archivo **ya tiene escrita la rama correcta para Web/desktop** (`return HealthAvailability.unavailable;`, línea 78), pero es código muerto: nunca se alcanza porque la excepción ocurre antes, en la línea 42.

**Corrección de precisión respecto a la auditoría original:** el Documento 6 (`PLAT-1`) describía esto como una excepción **no capturada**. La traza completa del código (sección 3 de este documento) muestra que **sí está capturada**, en dos puntos distintos (`WearableRepositoryImpl.connect()` y `.importActivities()`, ambos con `try/catch` que enrutan a `AppErrorHandler.handle()`). El efecto real en Web no es un crash de la pestaña/app — es que **tocar "Conectar" en Apple Health o Google Fit siempre falla, mostrando un mensaje de error técnico crudo** (`Unsupported operation: Platform._operatingSystem`) en vez de la respuesta correcta ya prevista en el propio código (`HealthAvailability.unavailable` → "no disponible en esta plataforma"). Sigue siendo un defecto real que bloquea el feature en Web — se corrige el matiz de severidad/mecanismo, no la necesidad de la corrección.

**Hallazgo adicional, fuera del alcance de T-F0.1** (registrado en la sección 12, no corregido aquí, según instrucción explícita): `HealthPackageAdapter` (archivo distinto) tiene el mismo patrón de bug de forma independiente, con un camino de disparo distinto.

**Solución recomendada:** guarda de plataforma (`kIsWeb`) como primera línea de `checkAvailability()`, reutilizando la utilidad ya centralizada `PlatformCapabilities.isWeb` — 3 líneas de cambio, sin tocar la interfaz de dominio, sin archivo nuevo. Ver sección 8 para la comparación completa contra la alternativa de un archivo/clase separada.

---

## 2. Investigación realizada (comandos y alcance)

Búsqueda dirigida sobre `lib/features/wearables/`, `lib/core/health/`, `lib/core/platform/`, `lib/core/di/injection.dart` y sus tests, cubriendo explícitamente: Wearables, BLE, Web, `Platform`, Streams, Bluetooth, adaptadores, imports condicionales, widgets relacionados. Cada archivo relevante se leyó completo (no solo grep), incluyendo la interfaz de dominio, la implementación concreta, el repositorio, los providers de Riverpod, el widget de UI, el manejador de errores central, y el registro de DI. Se rastreó la cadena real de llamadas desde el tap del usuario hasta la excepción, no se asumió el flujo.

```
grep -rln "dart:io\|Platform\.is" lib/features/wearables lib/core/health --include="*.dart"
grep -n "Health\|Wearable\|BleDataSource\|kIsWeb\|registerLazySingleton" lib/core/di/injection.dart
grep -rn "emptyFetchesHintMessage" lib/ test/
grep -n "Health|Wearable" lib/main.dart
grep -rn "sl<HealthPlatformGateway>|sl<Map<WearableProviderType" lib --include="*.dart"
find test -iname "*health*" -o -iname "*wearable*"
```

Archivos leídos completos: `health_platform_gateway_impl.dart`, `health_platform_gateway.dart`, `health_availability.dart`, `health_permission_status.dart`, `health_package_adapter.dart`, `wearable_repository_impl.dart`, `wearables_page.dart`, `wearable_providers.dart`, `wearable_actions_controller.dart`, `wearable_provider_tile.dart`, `web_bluetooth_support.dart` (+ `_stub`/`_web`), `platform_capabilities.dart`, `error_handler.dart` (sección relevante), `injection.dart` (sección relevante).

---

## 3. Causa raíz

**Archivo:** `lib/core/health/health_platform_gateway_impl.dart`
**Línea exacta:** 1 (`import 'dart:io';`) y 42 (`if (Platform.isIOS) {`), dentro de `checkAvailability()`.

`dart:io`'s `Platform.isIOS`/`Platform.isAndroid` leen `Platform.operatingSystem` internamente, que en el runtime de Flutter Web **lanza `UnsupportedError`** en vez de devolver un valor — es una limitación conocida y documentada del SDK de Dart, no un comportamiento específico de este proyecto. `checkAvailability()` evalúa esa condición como su primera instrucción ejecutable, sin ninguna comprobación previa de plataforma.

**Por qué existe:** el archivo fue escrito pensando en las dos plataformas donde el `health` package tiene sentido (iOS/Android) y **sí contempló correctamente el caso contrario** — la línea 77-78 dice literalmente `// Web/desktop: ninguna plataforma de salud aplicable. return HealthAvailability.unavailable;` — pero esa línea está después de los `if` de iOS/Android en el flujo de control, y en Dart un `if (Platform.isIOS)` no es "se salta si no aplica", es "se evalúa y truena si `Platform` no está soportado en este runtime" — la intención estaba bien, la posición del chequeo de plataforma no.

**Cadena de disparo verificada (no asumida):**
```
Usuario pulsa "Conectar" en la tarjeta de Apple Health o Google Fit (WearableProviderTile → _ActionButton)
  → WearableActionsController.connect(provider)
    → ConnectWearableUseCase → WearableRepositoryImpl.connect(provider)
      → try { adapter.connect() }                              [wearable_repository_impl.dart:47, dentro de try]
        → HealthPackageAdapter.connect()
          → _gateway.checkPermissionStatus()
            → HealthPlatformGatewayImpl.checkPermissionStatus()
              → checkAvailability()
                → Platform.isIOS   ←── 💥 UnsupportedError, SOLO en Web
      → catch (e) { AppErrorHandler.handle(e) }                  [wearable_repository_impl.dart:57-59]
        → UnexpectedFailure(error.toString())                    [error_handler.dart:63, fallback final]
      → WearableConnectionStatus.error, con el texto crudo de la excepción
```

Mismo patrón, mismo destino, si en cambio se pulsa "Importar actividades" (`importActivities`, línea 89-107 de `wearable_repository_impl.dart`) para un proveedor ya en estado `connected`/`pendingPartnerApproval` — el `try/catch` de esa rama también captura la excepción.

**Lo que NO ocurre (corrección respecto al Documento 6):** simplemente abrir la pantalla de Wearables (`WearablesPage.build()`) no dispara la excepción — esa pantalla solo observa `wearableConnectionsProvider`, que refleja un mapa de estado ya construido en el constructor de `WearableRepositoryImpl` sin tocar `Platform`. El disparo real requiere una interacción del usuario (Conectar o Importar) sobre un proveedor basado en `HealthPackageAdapter`.

---

## 4. Evidencias encontradas

| Evidencia | Archivo:línea | Qué demuestra |
|---|---|---|
| `import 'dart:io';` | `health_platform_gateway_impl.dart:1` | La clase depende de una API no soportada en Web |
| `if (Platform.isIOS) {` | `health_platform_gateway_impl.dart:42` | Primer punto de fallo, sin guarda previa |
| `if (Platform.isAndroid) {` | `health_platform_gateway_impl.dart:57` | Segundo punto de fallo (inalcanzable hoy porque el primero ya truena antes en Web, pero sería el siguiente en fallar si se reordenara sin arreglarlo) |
| `// Web/desktop: ninguna plataforma de salud aplicable. return HealthAvailability.unavailable;` | `health_platform_gateway_impl.dart:77-78` | La respuesta correcta ya existe en el código — es código muerto por la posición del chequeo, no lógica faltante |
| `sl.registerLazySingleton<HealthPlatformGateway>(HealthPlatformGatewayImpl.new);` | `injection.dart:133` | Registro sin condicional de plataforma — contrasta con la línea 92 del mismo archivo (`clientId: kIsWeb ? ... : null`), que sí resuelve un caso análogo correctamente |
| `try { await adapter.connect(); } catch (e) { ... AppErrorHandler.handle(e) }` | `wearable_repository_impl.dart:46-60` | La excepción SÍ se captura — corrige la caracterización de "no capturada" del Documento 6 |
| `try { ... adapter.fetchActivities ... adapter.emptyFetchesHintMessage ...} catch (e) { ... }` | `wearable_repository_impl.dart:89-107` | Segundo punto de captura, mismo patrón |
| `return UnexpectedFailure(error.toString());` | `error_handler.dart:63` | Confirma que `AppErrorHandler` nunca relanza — todo error desconocido termina en un `Failure`, nunca en una excepción no manejada hacia la UI |
| `abstract class PlatformCapabilities { static bool get isWeb => kIsWeb; }` | `platform_capabilities.dart:22` | Utilidad centralizada ya existente y lista para reutilizar en la solución |
| `library; export 'web_bluetooth_support_stub.dart' if (dart.library.html) 'web_bluetooth_support_web.dart';` | `web_bluetooth_support.dart:18-19` | Patrón de referencia alternativo ya usado en el proyecto — evaluado y descartado para este caso, ver sección 9 |

---

## 5. Archivos involucrados

| Archivo | Rol en el problema |
|---|---|
| `lib/core/health/health_platform_gateway_impl.dart` | **Causa raíz** — archivo a modificar |
| `lib/core/di/injection.dart` (línea 133) | Punto de registro — **no requiere cambio** con la solución recomendada (ver sección 8) |
| `lib/core/platform/platform_capabilities.dart` | Utilidad a reutilizar — **no requiere cambio** |
| `lib/features/wearables/data/adapters/health_package_adapter.dart` | Consumidor del gateway; su propio bug independiente se documenta en sección 12, **no se modifica en T-F0.1** |
| `lib/features/wearables/data/repositories/wearable_repository_impl.dart` | Confirma que la excepción se captura — **no requiere cambio** |
| `lib/core/error/error_handler.dart` | Confirma el comportamiento de fallback — **no requiere cambio** |
| `test/features/wearables/data/adapters/health_package_adapter_test.dart` | Test existente a revisar para no romper (usa `FakeHealthPlatformGateway`, no la implementación real — bajo riesgo) |

## 6. Módulos afectados

Únicamente `core/health` (Flutter, capa de infraestructura). **Aislado** — confirmado por la matriz de dependencias de Documento 1 §4.2: `wearables` no depende de ningún otro feature ni es dependido por ninguno salvo a través de la interfaz de dominio `HealthPlatformGateway`, que no cambia. Cero impacto en `training`, `device_connection`, `auth`, backend NestJS o PostgreSQL.

## 7. Dependencias

Ninguna — confirmado en `BACKLOG_MAESTRO.md` (`T-F0.1`: "Depende de: — (ninguna)"). No requiere que ninguna otra tarea del backlog esté cerrada primero, y ninguna tarea depende de esta antes de poder iniciarse.

---

## 8. Impacto por plataforma y sistema

| Área | Impacto |
|---|---|
| **Android** | Ninguno. La guarda nueva solo se activa cuando `kIsWeb == true`; en Android el flujo actual (`Platform.isAndroid` → Health Connect) queda exactamente igual, línea por línea. |
| **iOS** | Ninguno, mismo motivo — el flujo `Platform.isIOS` → HealthKit no cambia. |
| **Web** | Corrige el defecto: `checkAvailability()`/`requestPermissions()`/`checkPermissionStatus()` devuelven de inmediato `HealthAvailability.unavailable`/`HealthPermissionStatus.unavailable` en vez de fallar. La UI ya sabe mostrar ese estado correctamente (`_messageFor()` en `HealthPackageAdapter` ya tiene un mensaje para `unavailable`, línea 161: *"$providerName no está disponible en este dispositivo."*) — **sin cambios de UI necesarios**, el mensaje correcto ya existe y quedará alcanzable por primera vez. |
| **Windows** | Sin proyecto nativo generado todavía (`PLAT-2`, sin relación con esta tarea) — no verificable en un build real. Análisis de código: en Windows, `dart:io`'s `Platform` **sí funciona con normalidad** (a diferencia de Web) — `Platform.isIOS`/`Platform.isAndroid` evaluarían `false` sin lanzar, y el flujo ya caería correctamente en la línea 78 (`unavailable`) tal como está escrito hoy. **Windows no tiene el bug de Web** — dato nuevo de esta investigación, no estaba explícito en la auditoría original. La guarda `kIsWeb` no interfiere (es `false` en Windows), así que el comportamiento correcto ya existente se mantiene intacto. |
| **Firebase** | Ninguno — este código no toca Firebase Auth/Firestore/Storage en absoluto. |
| **NestJS** | Ninguno — `wearables`/`core/health` nunca llaman al backend propio (confirmado, Documento 1 §4.2, "aislado — solo `core/health`"). |
| **PostgreSQL** | Ninguno, mismo motivo. |
| **Rendimiento** | Negligible — una comprobación booleana adicional (`kIsWeb`, ya calculado en tiempo de compilación por Flutter, sin costo de I/O) antes de la lógica existente. No agrega `await` nuevo en el camino feliz de Android/iOS. |
| **Memoria** | Sin cambio — no se agrega estado persistente, `StreamController`, ni objeto retenido. |
| **Seguridad** | Sin cambio funcional; mejora marginal de higiene de información — hoy, en Web, el usuario ve el texto crudo de una excepción interna de Dart (`error.toString()` de un `UnexpectedFailure`) en la UI; con la corrección, ve el mensaje ya diseñado y localizado para "no disponible en este dispositivo", sin fuga de detalle interno de implementación. |
| **Escalabilidad** | Ninguno — cambio de lógica pura por instancia de cliente, sin estado compartido ni interacción con infraestructura escalable. |
| **Deuda técnica** | **Reduce** deuda existente (cierra `A2`/`PLAT-1`). No introduce deuda nueva. No resuelve la deuda relacionada de `HealthPackageAdapter` (sección 12) — se documenta explícitamente como fuera de alcance, no como "arreglado por accidente". |

---

## 9. Riesgos (de esta tarea específica, no los que resuelve)

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Que exista algún test unitario que mockee `Platform.isIOS`/`isAndroid` asumiendo que `checkAvailability()` nunca recibe `kIsWeb == true` de forma real y falle por un cambio de orden de evaluación | Baja — `kIsWeb` es una constante de compilación (`false` en cualquier test corrido con `flutter test`, que compila para VM/native, no para Web); ningún test existente puede verse afectado por este cambio | Confirmar ejecutando la suite completa de `health_package_adapter_test.dart` antes de cerrar (ver Plan de pruebas) |
| Que `PlatformCapabilities.isWeb` no esté pensado para usarse desde `core/health` (hoy solo lo consume código de `training`/UI) y su reutilización sea, en la práctica, un acoplamiento nuevo entre dos áreas de `core/` | Muy baja — es una clase `abstract` de utilidad pura (`static`, sin estado, sin dependencias), diseñada explícitamente para reutilizarse "como único punto" de esta decisión, según su propio docstring | Ninguna acción adicional — es exactamente el uso previsto |
| Que el fix quede incompleto si en el futuro se agrega una tercera rama de plataforma (p. ej. Windows real) que sí necesite comportamiento distinto de "unavailable" | Baja, y no aplica a esta tarea — hoy Windows ya cae correctamente en `unavailable` sin necesitar ninguna rama nueva (sección 8) | Ninguna — se documenta como supuesto verificado, no como riesgo abierto |

**Complejidad de la solución recomendada:** Baja. **Posibilidad de regresión:** Baja (ver tabla de riesgos y Plan de pruebas).

---

## 10. Solución recomendada

Agregar una guarda de plataforma como primera instrucción de `checkAvailability()` en `HealthPlatformGatewayImpl`:

```dart
// Boceto de diseño — NO implementado en esta tarea, solo para aprobación.
@override
Future<HealthAvailability> checkAvailability() async {
  if (PlatformCapabilities.isWeb) {
    // dart:io Platform.isIOS/isAndroid lanza UnsupportedError en Web —
    // ninguna plataforma de salud aplica ahí, igual que en desktop
    // (ver el fallback ya existente más abajo para Windows/Linux/macOS).
    return HealthAvailability.unavailable;
  }

  if (Platform.isIOS) {
    ...
  }
  ...
}
```

Import nuevo requerido: `../platform/platform_capabilities.dart` (ya existe, sin crear nada). **Ningún otro archivo cambia** — `requestPermissions()` y `checkPermissionStatus()` ya delegan en `checkAvailability()` como primer paso y ya saben interpretar `HealthAvailability.unavailable` correctamente (líneas 84-85 y 119-120), así que quedan corregidos de forma transitiva sin tocarlos.

### Por qué esta solución es la mejor

1. **Es la más simple que resuelve el problema completo** — 4 líneas, en el punto exacto de la causa raíz, sin mover responsabilidades.
2. **Reutiliza la utilidad de plataforma ya centralizada del proyecto** (`PlatformCapabilities.isWeb`), en vez de introducir un `kIsWeb` disperso nuevo — coherente con el propio principio que esa clase declara.
3. **No introduce ningún archivo, clase ni registro de DI nuevo** — cero superficie nueva de mantenimiento, cero riesgo de que alguien registre el DI mal (como ya pasó una vez, línea 133 sin condicional).
4. **Hace alcanzable código que el propio autor original ya escribió correctamente** (la rama `unavailable` de la línea 78) — no reinterpreta la intención del código existente, la completa.
5. **Corrige las 3 funciones públicas afectadas con un solo cambio**, porque las otras dos ya dependían de esta.

---

## 11. Alternativas descartadas

### Alternativa A — Clase `HealthPlatformGatewayWebStub` separada + registro condicional en DI
Crear una segunda implementación de `HealthPlatformGateway` que devuelva siempre "no disponible", seleccionada en `injection.dart` con `kIsWeb ? HealthPlatformGatewayWebStub.new : HealthPlatformGatewayImpl.new` (mismo patrón de ternario que la línea 92, aplicado a una clase completa en vez de a un valor).

- **Ventajas:** separación de responsabilidad más explícita a nivel de tipo; coincide más literalmente con la redacción original del Documento 7 ("stub condicional que devuelva un estado explícito"); independientemente testeable como su propia clase.
- **Desventajas:** un archivo nuevo, una línea de registro condicional nueva en `injection.dart` (superficie de error ya demostrada — la línea 133 actual es precisamente un registro sin condicional), y resuelve exactamente el mismo problema que la Alternativa recomendada con más piezas móviles.
- **Por qué se descarta:** el criterio "sin sobre-ingeniería" (`RIDEPRO_DEVELOPMENT_PROTOCOL.md` §0, principio 2) exige comparar contra la solución más simple antes de aceptar una más compleja. El patrón de conditional-export a nivel de librería (`web_bluetooth_support*.dart`) existe en el proyecto porque `dart:js_interop` **no compila** fuera de Web — una restricción real del compilador. `dart:io` no tiene esa restricción: compila en todas las plataformas, solo falla en tiempo de ejecución en un método puntual. Replicar el patrón de una clase separada aquí copiaría la forma de la solución de BLE sin tener la misma necesidad técnica que la justificó. **No se recomienda, queda documentada por si el Product Owner/Arquitecto Principal prefiere la consistencia literal con el texto del Documento 7 sobre la minimalidad.**

### Alternativa B — Conditional export a nivel de librería (mismo patrón que `web_bluetooth_support*.dart`)
- **Ventajas:** máxima consistencia visual con el precedente ya establecido en el proyecto.
- **Desventajas:** innecesaria — ese patrón resuelve un problema de **compilación** (código que usa `dart:html`/`dart:js_interop` y no compilaría en Android/iOS/Windows). Aquí no hay ningún problema de compilación, solo de comportamiento en tiempo de ejecución en Web. Usar este patrón sería tratar un problema de runtime como si fuera de compile-time, con 3 archivos en vez de un cambio de 4 líneas.
- **Por qué se descarta:** sobre-ingeniería respecto a la naturaleza real del problema (mismo principio que la Alternativa A).

### Alternativa C — Envolver cada llamada a `Platform.isX` en un `try/catch` local, sin `kIsWeb`
- **Ventajas:** no requiere conocer `kIsWeb` en absoluto.
- **Desventajas:** oculta la intención (un `try/catch` alrededor de un chequeo de plataforma no comunica "esto es Web", cualquiera que lea el código después tiene que inferirlo); no está alineado con el principio del protocolo "el código habla, la documentación explica el porqué" — un `kIsWeb` explícito es más legible que un `catch` genérico que además podría enmascarar un error real distinto de plataforma no soportada.
- **Por qué se descarta:** peor legibilidad y peor especificidad de error para el mismo resultado.

---

## 12. Hallazgo adicional — fuera del alcance de T-F0.1, no corregido en este análisis

Según instrucción explícita recibida durante esta investigación ("si descubres otros problemas críticos relacionados con Wearables que no formen parte de esta tarea, no los resuelvas todavía, regístralos como hallazgos separados"):

### H-WEARABLES-NEW-1 — `HealthPackageAdapter._isIOS` tiene el mismo patrón de bug, de forma independiente al gateway

- **Archivo:** `lib/features/wearables/data/adapters/health_package_adapter.dart:1` (`import 'dart:io';`) y línea 39 (`_isIOS = isIOS ?? (() => Platform.isIOS)`), consumido en la línea 134 dentro del getter `emptyFetchesHintMessage`.
- **Evidencia de alcance real:** `emptyFetchesHintMessage` se invoca desde `WearableRepositoryImpl.importActivities()` (`wearable_repository_impl.dart:100`), dentro de un bloque `try` que sí captura la excepción (`catch` en la línea 104-106) — **no es un crash no capturado**, es el mismo tipo de defecto que `A2`/`PLAT-1`: en Web, para el proveedor **Apple Health específicamente** (el `&&` de la línea 134 evalúa `_providerType == appleHealth` primero, así que para `googleFit` nunca se alcanza `_isIOS()` — Google Fit NO está afectado por este hallazgo), toda llamada a "Importar actividades" termina en estado `error` con un mensaje técnico crudo, en vez de procesar la importación con normalidad.
- **Relación con T-F0.1:** **es independiente del gateway** — corregir `HealthPlatformGatewayImpl` (T-F0.1) no arregla este segundo punto, porque `_isIOS` no pasa por `HealthPlatformGateway` en absoluto; es una llamada directa a `dart:io` embebida en el adapter.
- **Impacto:** Alto para el proveedor Apple Health en Web específicamente (Google Fit no afectado); mismo tipo de degradación de UX que `A2` (mensaje de error técnico en vez de comportamiento correcto), capturado (no crashea la app), pero bloquea funcionalmente la importación de actividades de Apple Health en Web.
- **Recomendación:** registrar como tarea nueva en `BACKLOG_MAESTRO.md` (ID sugerido, a decidir por el Arquitecto Principal: `T-NEW.1`, según `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §8) — mismo patrón de solución que T-F0.1 (guarda `PlatformCapabilities.isWeb` antes de evaluar `_isIOS()`, o devolver `false` directamente si `kIsWeb`), costo estimado **S**, sin dependencias, mismo perfil de riesgo bajo. **No se implementa en esta tarea.**

### Observación menor (no crítica, no accionable de forma independiente)
`AppErrorHandler.handle()` no tiene un caso especial para `UnsupportedError` — cualquier excepción de plataforma no reconocida termina como `UnexpectedFailure(error.toString())`, mostrando texto técnico crudo en la UI cuando ocurre. La corrección de T-F0.1 y de `H-WEARABLES-NEW-1` elimina las dos únicas fuentes conocidas hoy de ese tipo de excepción en el módulo Wearables — no se recomienda una acción adicional sobre `AppErrorHandler` mientras no exista otra fuente conocida del mismo problema.

---

## 13. Plan detallado de implementación (para aprobación — no ejecutado)

| Paso | Objetivo | Archivos | Riesgo | Pruebas necesarias | Criterio de aceptación |
|---|---|---|---|---|---|
| 1 | Agregar import de `PlatformCapabilities` en `health_platform_gateway_impl.dart` | `lib/core/health/health_platform_gateway_impl.dart` | Ninguno — solo un import | `flutter analyze --fatal-infos` sin issues | Import resuelto sin warning de import no usado (se usa en el paso 2) |
| 2 | Agregar guarda `if (PlatformCapabilities.isWeb) return HealthAvailability.unavailable;` como primera línea de `checkAvailability()` | Mismo archivo | Bajo (ver sección 9) | Test unitario nuevo: `checkAvailability()` devuelve `unavailable` cuando se fuerza `kIsWeb`-equivalente (ver nota de testabilidad abajo) | El resto del cuerpo del método (ramas iOS/Android) permanece exactamente igual, sin reordenar ni modificar |
| 3 | Ejecutar la suite completa de Flutter (`flutter analyze --fatal-infos`, `flutter test`) | N/A (verificación) | Ninguno | Ver Plan de pruebas (sección 14) | 100% verde, sin ninguna regresión en `health_package_adapter_test.dart` ni en el resto de la suite |
| 4 | Verificación manual en `flutter build web` + servir localmente: abrir Wearables, pulsar "Conectar" en Apple Health y en Google Fit | Ninguno (verificación) | Ninguno | Ver Plan de pruebas | Estado pasa a mostrar "no disponible en este dispositivo" (vía `_messageFor`), no un texto de excepción cruda |
| 5 | Confirmar que Android/iOS no cambiaron de comportamiento (regresión) | Ninguno (verificación) | Bajo | Ver Plan de pruebas | Suite existente de `health_package_adapter_test.dart` (que ya cubre ramas iOS/Android vía `FakeHealthPlatformGateway`) sigue en verde sin modificar sus expectativas |

**Nota de testabilidad para el paso 2 (a resolver en la etapa de Implementación, no en este documento):** `kIsWeb` es una constante de compilación de Flutter, no directamente mockeable en un test unitario estándar de VM. La forma de testear la guarda sin depender de un build Web real es análoga al patrón ya usado en `HealthPackageAdapter` (parámetro `isIOS` inyectable, ver línea 31 de ese archivo) — se decidirá en el diseño detallado de la Etapa 2 real (post-aprobación) si conviene un parámetro inyectable equivalente (`bool Function()? isWeb`) en `HealthPlatformGatewayImpl`, mismo criterio ya validado en el propio código del proyecto. Se deja como decisión de implementación, no de este análisis, para no exceder el alcance de "no implementar" pedido.

## 14. Plan de pruebas

| Verificación | Cómo se comprueba |
|---|---|
| El crash/error desapareció en Web | `flutter build web` real, servir localmente, abrir Wearables, pulsar "Conectar" en Apple Health y Google Fit — el estado debe pasar a "no disponible en este dispositivo", nunca a un texto con "UnsupportedError"/"Platform" |
| Android sigue funcionando | Ejecutar `health_package_adapter_test.dart` completo (cubre las ramas Android vía `FakeHealthPlatformGateway`) — 100% verde, sin cambiar ninguna expectativa existente. Si hay disponible un emulador/dispositivo Android, verificación manual adicional de "Conectar" en Google Fit |
| iOS sigue funcionando | Misma suite (cubre ramas iOS). Verificación manual en simulador/dispositivo iOS si está disponible |
| Web funciona correctamente | Paso 4 del plan de implementación — criterio de aceptación explícito arriba |
| Windows no resulta afectado | No verificable en build real (sin proyecto nativo, `PLAT-2`, fuera de esta tarea) — verificación por análisis de código: `kIsWeb == false` en Windows, por lo que la guarda nueva es un no-op ahí; el comportamiento ya correcto de la línea 78 (`unavailable`) se mantiene intacto, confirmado en la sección 8 |
| BLE sigue operativo | `device_connection`/`core/ble` no se tocan en absoluto en esta tarea — verificación de no-regresión: `flutter test` sobre la suite de `device_connection` sigue en verde sin cambios, y `git diff` (al momento de implementar) debe mostrar cero líneas modificadas fuera de `health_platform_gateway_impl.dart` |
| No aparecen regresiones | `flutter analyze --fatal-infos` (0 issues) + `flutter test` (100% verde, suite completa, no solo la de wearables) — mismo estándar exigido por `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §4, Puerta 2 y 3 |

## 15. Riesgos de regresión

- **Riesgo real de regresión: Bajo.** El cambio es aditivo (una guarda nueva al principio de una función), no reescribe ni reordena la lógica existente de iOS/Android, y esa lógica no se toca en absoluto.
- **Superficie de cambio:** 1 archivo, 1 método, ~4 líneas — la menor superficie posible para resolver la causa raíz completa (ver sección 10, punto 5).
- **Cobertura de red de seguridad existente:** `health_package_adapter_test.dart` ya prueba las ramas de iOS/Android contra un `FakeHealthPlatformGateway` inyectado — cualquier regresión accidental en el comportamiento nativo sería detectada por esa suite sin necesidad de escribir tests nuevos para las plataformas ya cubiertas.
- **Ausencia total de superficie compartida con backend/datos** elimina cualquier riesgo de regresión fuera del cliente Flutter.

---

## 16. Autoauditoría (antes de finalizar este análisis)

- **¿Existe una solución más simple?** No — la solución recomendada (sección 10) ya es la más simple que resuelve la causa raíz completa; las 3 alternativas más "robustas" evaluadas (sección 11) fueron descartadas explícitamente por añadir superficie sin necesidad comprobada.
- **¿Existe una solución más mantenible?** No de forma clara — la Alternativa A (clase separada) sería marginalmente más "descubrible" para alguien que solo mire `injection.dart`, pero a costa de un archivo y un registro condicional más para mantener sincronizados; se juzga que la solución recomendada, con el comentario explicativo propuesto en el boceto, es igual de mantenible con menos piezas.
- **¿Existe una solución más escalable?** No aplica — este es un cambio de comportamiento por instancia de cliente, sin dimensión de escalabilidad de infraestructura.
- **¿Estoy generando deuda técnica?** No. Al contrario, cierra deuda existente (`A2`/`PLAT-1`). La deuda hermana (`H-WEARABLES-NEW-1`) se documenta explícitamente en vez de ignorarse u ocultarse.
- **¿Estoy respetando Clean Architecture?** Sí — el cambio vive enteramente en la capa de infraestructura (`core/health`, la implementación concreta del gateway); la interfaz de dominio `HealthPlatformGateway` no cambia, ningún `domain/` de ningún feature se toca, y `PlatformCapabilities` es exactamente el tipo de utilidad de `core/` que Clean Architecture prevé para decisiones transversales de plataforma.

---

## 17. Recomendación final

**Aprobar la Solución recomendada (sección 10)** para su implementación bajo el ciclo de vida completo de `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §1 (Etapas 4-10), con el plan de la sección 13 como base. Costo confirmado: **S**, consistente con `BACKLOG_MAESTRO.md`. No requiere autorización del propietario (cambio aditivo, sin ambigüedad de producto, sin tocar datos ni infraestructura).

**Adicionalmente, se recomienda** que el Product Owner/Arquitecto Principal decida si `H-WEARABLES-NEW-1` (sección 12) se incorpora al Backlog Maestro como tarea nueva (`T-NEW.1` sugerido) — no se ejecuta ninguna acción sobre ese hallazgo sin esa decisión.

**Este documento queda a la espera de aprobación explícita antes de iniciar la Etapa 4 (Implementación).**
