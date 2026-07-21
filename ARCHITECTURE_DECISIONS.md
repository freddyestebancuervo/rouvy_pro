# Decisiones de arquitectura

Este documento registra decisiones de diseño que afectan a varios módulos a
la vez y que no son evidentes solo leyendo el código — el porqué, no solo
el qué. Formato tipo ADR (Architecture Decision Record), una sección por
decisión.

---

## 1. Integraciones de wearables: arquitectura desacoplada (Adapter + Provider)

**Contexto:** la app necesita conectar con 6 ecosistemas de wearables
(Apple Health, Google Fit, Garmin, Polar, Coros, Suunto), cada uno con un
SDK/API distinto, distintos flujos de autorización (permisos del sistema
operativo vs. OAuth de terceros) y distinta disponibilidad de acceso hoy
mismo.

**Decisión:** todo el módulo (`features/wearables/`) programa contra una
única interfaz — el patrón **Adapter**:

```dart
abstract class WearableAdapter {
  WearableProviderType get providerType;
  bool get requiresPartnerApproval;
  Future<bool> requestAuthorization();
  Future<void> connect();
  Future<void> disconnect();
  Future<bool> get isConnected;
  Future<List<ExternalActivity>> fetchActivities({DateTime? since});
}
```

Cada proveedor implementa esta interfaz con su propia lógica interna.
`WearableRepositoryImpl` (el **Provider**/registro) recibe un
`Map<WearableProviderType, WearableAdapter>` ya construido por inyección de
dependencias y delega cada operación al adapter correspondiente — nunca
sabe si detrás hay HealthKit, Health Connect, o una simulación.

**Por qué este patrón y no un `switch` por proveedor esparcido en el
repositorio:** activar una integración real en el futuro (cuando llegue la
aprobación de Garmin, por ejemplo) se reduce a sustituir UNA línea en
`core/di/injection.dart` — cambiar `WearableProviderType.garmin:
GarminAdapter()` por la implementación real — sin tocar el dominio, la
presentación, ni el resto de adapters. El acoplamiento a cada SDK externo
queda contenido en un único archivo por proveedor.

---

## 2. Qué se implementó de verdad y qué quedó simulado

| Proveedor | Estado | Motivo |
|---|---|---|
| Apple Health | ✅ Real (`HealthPackageAdapter`, HealthKit vía paquete `health`) | On-device, autorizado por el propio SO, sin partner externo |
| Google Fit | ✅ Real (`HealthPackageAdapter`, Health Connect vía paquete `health`) | Mismo caso — Health Connect es el sucesor del API de Google Fit REST (descontinuada) |
| Garmin | 🟡 Simulado (`GarminAdapter` → `MockWearableAdapter`) | Requiere aprobación del Garmin Connect Developer Program (semanas de espera) + OAuth 1.0a + backend propio para recibir webhooks |
| Polar | 🟡 Simulado (`PolarAdapter`) | Requiere registro aprobado en Polar AccessLink |
| Coros | 🟡 Simulado (`CorosAdapter`) | Programa de acceso más reciente, cobertura de dispositivos limitada |
| Suunto | 🟡 Simulado (`SuuntoAdapter`) | Documentación pública menos madura; alcance exacto por confirmar al recibir acceso |

**Decisión de diseño para los 4 adapters simulados:** en vez de dejarlos
sin implementar (`UnimplementedError`) o simplemente ocultar el botón,
`MockWearableAdapter` simula un flujo de conexión exitoso con latencia
realista y genera actividades de ejemplo con datos plausibles (potencia,
FC, distancia dentro de rangos razonables de ciclismo). Cada actividad
simulada lleva el prefijo `MOCK-` en su ID para que nunca pueda
confundirse con datos reales, y la UI (`WearableProviderTile`) muestra
permanentemente un badge "Simulado — pendiente de aprobación oficial"
mientras `requiresPartnerApproval == true`.

**Por qué simular en vez de bloquear el desarrollo:** permite construir y
probar TODA la experiencia de usuario alrededor de wearables (lista de
conexiones, importación de actividades, cómo se combinan con las
estadísticas) sin esperar semanas a que cuatro fabricantes distintos
aprueben el acceso — y sirve para hacer demos de producto completas hoy.
Ver `WEARABLES_SETUP.md` para el proceso exacto de solicitar acceso real a
cada uno y sustituir el adapter correspondiente cuando llegue.

---

## 3. Android e iOS como plataformas principales de entrenamiento

**Decisión:** el flujo de entrenamiento (conexión BLE a rodillos/sensores,
HUD en vivo, sesiones) se diseña y prioriza para Android e iOS. Web es una
plataforma soportada pero secundaria para este flujo específico.

**Motivo:** el entrenamiento indoor depende física y constantemente de
Bluetooth Low Energy contra un rodillo/sensores en la misma habitación —
es, por naturaleza, un caso de uso de "app instalada en un dispositivo que
está ahí, encendida, cerca del hardware", no de "pestaña de navegador
abierta". Android/iOS además dan:
- Reconexión BLE en segundo plano más confiable que un navegador.
- Acceso a HealthKit/Health Connect nativos (el módulo de wearables de la
  decisión 1 depende de esto).
- Notificaciones push para retos/eventos en vivo (módulos futuros).

**Qué significa esto en la práctica, hoy:**
- El catálogo de rutas, HUD 3D/video y demás pantallas de contenido pesado
  se optimizan primero para móvil; Web las hereda sin trabajo adicional
  extra de layout responsive ya presente en el proyecto (ver
  `ConstrainedBox`/`LayoutBuilder` en las páginas existentes).
- La funcionalidad BLE en Web queda condicionada a la decisión 4 —
  disponible cuando el navegador lo permite, con una salida airosa cuando
  no.

Esta decisión **no excluye** Web del roadmap — simplemente evita que el
desarrollo del núcleo de entrenamiento quede bloqueado o degradado
intentando dar soporte igualitario a un entorno (navegador de escritorio)
que no es donde ocurre físicamente el entrenamiento.

---

## 4. Web Bluetooth: detección automática con degradación local, no global

**Contexto:** `flutter_blue_plus` en Web usa la **Web Bluetooth API**
del navegador, que solo Chrome y Edge (motor Chromium) implementan —
Safari y Firefox no la soportan por decisión de esos fabricantes, no por
ninguna limitación de este proyecto.

**Decisión:** se implementa "feature detection" real (no un simple chequeo
de `kIsWeb`, que no distingue navegadores) mediante JS interop:

```dart
// lib/core/platform/web_bluetooth_support_web.dart
Future<bool> isWebBluetoothSupported() async {
  return js_util.hasProperty(html.window.navigator, 'bluetooth');
}
```

Con **imports condicionales** de Dart (`core/platform/web_bluetooth_support.dart`
exporta la implementación real solo si `dart.library.html` está disponible,
y un stub que siempre devuelve `true` en cualquier otra plataforma), de
forma que:
- El código de JS interop nunca se compila en el build de Android/iOS.
- En Android/iOS/desktop, la comprobación es un no-op instantáneo — nunca
  hay parpadeo de carga ni lógica condicional visible.

`DeviceManagementPage` consulta este resultado UNA vez al entrar a la
pantalla (`webBluetoothSupportedProvider`, un `FutureProvider`) y, si es
`false`, reemplaza su contenido por `WebBluetoothUnavailablePage` — un
mensaje claro ("necesitas Chrome o Edge, o instala la app en tu teléfono")
en vez de un escaneo que fallaría en silencio o un error críptico del
plugin.

**Por qué el gating es LOCAL a esa pantalla y no global:** el resto de la
app (autenticación, perfil, wearables, futuro catálogo de rutas) no
depende de Bluetooth y funciona perfectamente en Safari/Firefox. Bloquear
la app entera por una limitación que solo afecta a una función específica
sería tratar un problema de una pantalla como si fuera un problema de
plataforma — degradación local, nunca global, es el principio aplicado
aquí y el mismo que ya regía en `BLE_PERMISSIONS.md`/`bluetoothEnabledProvider`
para "Bluetooth apagado" (mismo patrón de banner/pantalla contenida, no
`Navigator` global ni splash bloqueante).

---

## 5. Estas decisiones no bloquean el desarrollo

Las cuatro decisiones anteriores están **implementadas**, no solo
documentadas como intención futura:
- El registro de adapters en `injection.dart` ya resuelve 2 proveedores
  reales y 4 simulados sin ninguna rama de código a medio escribir.
- `DeviceManagementPage` ya renderiza condicionalmente según soporte de
  Web Bluetooth, con tests de compilación limpios en las 3 plataformas.
- Ningún flujo existente (auth, perfil, conexión BLE en Android/iOS) se
  modificó de forma incompatible — se extendió.

El criterio para el resto del proyecto, de aquí en adelante: cuando una
integración externa no esté disponible todavía (por credenciales,
aprobación, o cualquier bloqueo externo), se sigue el mismo patrón
Adapter + mock explícito + documentación de activación, en vez de dejar
la funcionalidad a medias o detener el desarrollo del resto de la app a la
espera de un tercero.
