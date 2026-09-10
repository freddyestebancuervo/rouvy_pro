# ADR-0008: BLE Protocol Device Adapters

- **Fecha:** 2026-09-09
- **Estado:** Aceptado y fusionado en `main` por PR #138 (`bdd40fecd158120454607ad6526e5859a1ef7679`)
- **Tarea:** `T-NEW.3` — Device Adapter Phase A, core estándar BLE

## Contexto

`BleDataSourceImpl` seleccionaba directamente los parsers de protocolo BLE
estándar durante el descubrimiento de servicios. Ese diseño funcionaba para
FTMS, Heart Rate, Cycling Power y CSC, pero cualquier expansión futura de
protocolos estándar o familias vendor aumentaría el acoplamiento dentro del
datasource.

El objetivo de Phase A es separar interpretación de protocolo sin extraer todavía
todo el transporte BLE ni cambiar semántica de telemetría.

## Decisión

El transporte y la orquestación de sesión BLE permanecen en `BleDataSourceImpl`.
Esto incluye discovery, conexión/desconexión, service discovery, suscripciones,
reconexión, batería y ciclo de vida de `_DeviceSession`.

La interpretación de protocolo vive detrás de `BleDeviceAdapter`. El resolver es
capability-based y determinista: recibe servicios/características descubiertos y
devuelve los adapters estándar compatibles en prioridad estable.

Adapters estándar de Phase A:

- FTMS.
- Cycling Power.
- CSC.
- Heart Rate.

Los parsers existentes se reutilizan detrás de esos adapters. Las instancias de
parsers con estado, como Cycling Power y CSC, son por dispositivo/sesión para
preservar aislamiento de contadores acumulados y deltas. Si no hay match de
capacidades estándar, el resultado es seguro: no se fabrica telemetría y no hay
fallback arbitrario.

Battery permanece como manejo compartido dentro de `BleDataSourceImpl` en Phase
A, fuera del contrato de adapters.

## Boundary

```text
BLE transport/service discovery
→ adapter resolver
→ protocol adapter
→ parser
→ TelemetrySnapshot
→ TelemetryAggregator
→ RideSessionController
```

## Non-Goals

- No ampliar discovery.
- No implementar adapter H9.
- No implementar adapters vendor/proprietary.
- No implementar adapter genérico Nordic UART.
- No escribir comandos propietarios hacia dispositivos.
- No extraer un `BleTransport` grande.
- No cambiar semántica de `TelemetrySnapshot`, `TelemetryAggregator` ni
  `RideSessionController`.

## Regla Futura

Los adapters vendor se modelan por protocolo/familia, no automáticamente por
modelo comercial de dispositivo y no meramente por transporte como Nordic UART.
Un dispositivo que use Nordic UART no queda soportado hasta que exista evidencia
del protocolo de aplicación encima de ese transporte y una tarea propia lo
implemente.

## Consecuencias

Esta sección registra el resultado exacto de Phase A. Phase B cambia solo la
política de discovery y clasificación de compatibilidad; ver ADR-0009.

- `BleDataSourceImpl` queda menos acoplado a cada parser sin perder ownership de
  sesión BLE.
- La compatibilidad estándar mejora a nivel arquitectónico, pero no prueba por sí
  sola compatibilidad física por marca/modelo.
- `DISCOVERY_BROADENED = NO`.
- `VENDOR_ADAPTERS = NOT_IMPLEMENTED`.
- `H9_ADAPTER = NOT_IMPLEMENTED`.
- `H9_RUNTIME_HR = UNPROVEN`.
- `PHYSICAL_COMPATIBILITY_BY_BRAND_MODEL = NOT_GENERALLY_PROVEN`.
