# ADR-0007: Adaptadores multiplataforma

- **Fecha:** 2026-07-24
- **Estado:** Aceptado (formaliza y extiende un patrón ya implementado)

## Contexto

RidePro debe correr en Android, iOS, Web y Windows. Cada plataforma expone capacidades de sistema (Bluetooth, salud, almacenamiento seguro, permisos, notificaciones, ejecución en segundo plano) con APIs distintas y, en algunos casos, disponibilidad distinta (Web Bluetooth solo en navegadores Chromium; Windows sin proyecto nativo generado todavía, ver hallazgo 1.16 #4). El proyecto ya resolvió un caso de esto de forma ejemplar: `core/platform/web_bluetooth_support*.dart`, con imports condicionales de Dart (`dart.library.html`) para que el código de JS interop nunca se compile fuera de Web, y `ARCHITECTURE_DECISIONS.md` #4 documenta explícitamente el principio de "degradación local, nunca global" (una pantalla se adapta, la app entera no se bloquea).

Este ADR formaliza ese patrón como el estándar a seguir para **toda** capacidad dependiente de plataforma, no solo Bluetooth.

## Decisión

1. **El dominio (`domain/`) nunca referencia una API de plataforma directamente.** Toda capacidad dependiente de plataforma se expone como una interfaz abstracta (en `domain/` si es propia de un feature, o en `core/platform/`/`core/<capacidad>/` si es transversal) — mismo patrón que `WearableAdapter` (`ARCHITECTURE_DECISIONS.md` #1) y `HealthPlatformGateway` (`core/health/`) ya usan.
2. **Cada plataforma implementa la interfaz con su propio adapter**, seleccionado en tiempo de compilación (imports condicionales de Dart, el mecanismo ya usado para Web Bluetooth) o en tiempo de ejecución vía inyección de dependencias (`core/di/injection.dart`, el mecanismo ya usado para wearables reales vs. simulados).
3. **Cuando una capacidad no está disponible en una plataforma, la degradación es local a la pantalla/feature que la usa** — nunca un bloqueo global de la app. `WebBluetoothUnavailablePage` es el ejemplo de referencia: mensaje claro, camino alternativo sugerido ("instalá la app en tu teléfono"), el resto de la app funciona con normalidad.
4. **Windows se trata como una plataforma de primera clase a generar (T7 del plan de transición), no como un descarte.** La ausencia del proyecto nativo hoy es una tarea pendiente, no una decisión de excluir Windows — la config de Firebase ya está preparada (`firebase_options.dart` ya tiene el bloque `windows`).
5. **Capacidades sin implementación hoy (ANT+, Descargas, Video, Notificaciones)** deben diseñarse, cuando se prioricen, con el mismo molde interfaz+adapter desde el primer commit — no como un `if (Platform.isX)` disperso por el código.

## Alternativas descartadas

1. **`if (Platform.isAndroid) { ... } else if (Platform.isIOS) { ... }` disperso en el código de features.** Descartada — es exactamente el antipatrón que el proyecto ya evitó conscientemente para Bluetooth (`ARCHITECTURE_DECISIONS.md` #4 lo contrasta explícitamente con "un simple chequeo de `kIsWeb`, que no distingue navegadores"). Dificulta testear (no se puede inyectar un fake) y esparce el conocimiento de plataforma por todo el árbol de código.
2. **Un plugin/paquete propio unificado que intente abstraer todas las plataformas internamente sin capa de dominio propia** (delegar toda la responsabilidad al plugin de terceros, sin una interfaz propia intermedia). Descartada: acopla el dominio directamente a la API del plugin de terceros — si el plugin cambia su API (ya documentado como riesgo real para `health` en `pubspec.yaml`: "el ecosistema de este plugin cambia versión con cierta frecuencia"), el cambio se propaga a `domain/` en vez de quedar contenido en el adapter.
3. **Excluir Windows del alcance hasta que "haga falta de verdad".** Descartada — está explícitamente en la lista de plataformas objetivo del propietario; se prioriza como P1 (T7), no se descarta.

## Consecuencias

- Cualquier capacidad nueva (Descargas, Notificaciones, ANT+) empieza por definir su interfaz en `domain/` o `core/`, antes de elegir el paquete/SDK concreto — invierte el orden habitual ("elegir el paquete primero") a propósito, para no acoplar el dominio a una elección de implementación que podría cambiar.
- La tabla de la sección 7 de `01_SYSTEM_ARCHITECTURE.md` (Compartido / Adaptador por capacidad) se mantiene como el inventario vivo — cualquier capacidad nueva se agrega ahí con su estado real, no aspiracional.
- Generar el proyecto Windows (T7) es un prerrequisito técnico simple (`flutter create --platforms=windows .`) pero debe validarse con un build real antes de darlo por cerrado — algunas dependencias actuales (`flutter_blue_plus`, `health`) pueden no tener soporte completo de Windows, lo cual es información nueva que solo aparece al intentar el build, no antes.

## Riesgos

- **Windows puede descubrir incompatibilidades de dependencias** (BLE, salud) que no existen en Android/iOS/Web — si ocurre, la app en Windows podría necesitar degradar esas capacidades específicas (mismo patrón de degradación local ya definido, no un bloqueo total de la plataforma). Se marca como riesgo a validar en T7, no una certeza hoy.
- **El paquete `health` ya está documentado como volátil** (cambia de versión con frecuencia) — el adapter (`HealthPackageAdapter`) es precisamente lo que contiene ese riesgo, pero requiere disciplina de mantenimiento (revisar el adapter en cada actualización mayor del paquete, no asumir compatibilidad).
