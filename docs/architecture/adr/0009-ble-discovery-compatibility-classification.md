# ADR-0009: BLE Discovery And Compatibility Classification

- **Fecha:** 2026-09-10
- **Estado:** Aceptado y fusionado en `main` por PR #140 (`5827f10c2a47f49cadbae45d7d0cbc93e9269445`)
- **Tarea:** `T-NEW.4` — Device Adapter Phase B, broad discovery + compatibility classification

## Contexto

Phase A introdujo `BleDeviceAdapter` y un resolver estándar determinista para
FTMS, Cycling Power, CSC y Heart Rate, pero el escaneo seguía filtrado por los
cuatro servicios deportivos estándar. Eso impedía ver dispositivos BLE que no
anuncian esos servicios, incluidos dispositivos propietarios o no estándar.

Ver un dispositivo no equivale a soportarlo. Phase B separa explícitamente
visibilidad, tipo funcional y compatibilidad probada.

## Decisión

El escaneo BLE deja de exigir `withServices` con los UUID deportivos estándar.
`SportDeviceType.unknown` es un resultado válido de scan y se conserva en la
lista. La deduplicación sigue siendo estable por device ID.

La compatibilidad se expone en dominio con `BleDeviceCompatibilityStatus`:

- `discovered`: dispositivo observado; no hay evidencia GATT suficiente todavía.
- `standardCompatible`: GATT demostró servicio+característica compatible con un
  adapter estándar implementado.
- `korixaCompatible`: reservado para un futuro adapter Korixa/vendor basado en
  protocolo/familia implementado.
- `korixaVerified`: reservado para compatibilidad con evidencia física explícita.
- `unsupported`: GATT completó y ningún adapter del build actual coincide.

`SportDeviceType` permanece separado: describe el tipo funcional aparente
(`smartTrainer`, `powerMeter`, etc.), no el nivel de soporte de Korixa.

## Reglas

- Scan nuevo: `discovered`.
- Advertising estándar por sí solo no prueba `standardCompatible`.
- GATT exitoso + adapter estándar: `standardCompatible`.
- GATT exitoso + cero adapters: `unsupported` del build actual, no hardware
  permanentemente incompatible.
- Fallo de conexión o GATT: conservar `discovered` y usar el estado/error de
  conexión existente.
- Multi-standard: sigue resolviendo adapters en prioridad estable de Phase A y
  mantiene un único estado `standardCompatible` para el dispositivo.

## Non-Goals

- No implementar H9.
- No implementar adapters vendor/proprietary.
- No implementar adapter genérico Nordic UART.
- No escribir RX ni comandos propietarios.
- No inferir compatibilidad desde nombre, fabricante, MAC/UUID o advertising.
- No cambiar `TelemetrySnapshot`, `TelemetryMetricState`, `TelemetrySourceKind`,
  `TelemetryAggregator` ni `RideSessionController`.
- No rediseñar UI; los badges/labels quedan para una tarea visual separada.

## Consecuencias

- Dispositivos BLE no estándar pueden aparecer como `discovered`.
- Dispositivos propietarios como un H9 pueden volverse visibles, pero sin adapter
  propietario deben clasificarse como `unsupported` después de GATT exitoso.
- `unsupported` significa no soportado por el build actual con las capacidades
  descubiertas, nunca una declaración permanente sobre el hardware.
- `DISCOVERY_BROADENED = YES`.
- `VENDOR_ADAPTERS_IMPLEMENTED = NO`.
- `GENERIC_NORDIC_UART_ADAPTER = NO`.
- `H9_ADAPTER_IMPLEMENTED = NO`.
- `H9_RUNTIME_HR = UNPROVEN`.
- `PHYSICAL_BROAD_DISCOVERY = UNPROVEN`.
- `PHYSICAL_COMPATIBILITY_BY_BRAND_MODEL = NOT_GENERALLY_PROVEN`.
