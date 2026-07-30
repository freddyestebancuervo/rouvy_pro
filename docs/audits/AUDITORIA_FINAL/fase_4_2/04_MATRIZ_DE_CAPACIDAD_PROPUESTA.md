# 4. Matriz de pruebas propuesta para Fase 4.2 Parte 2 (no ejecutada todavía)

Niveles escalonados: **1, 5, 8, 10, 15, 20, 30, 50** solicitudes concurrentes.
Cada nivel se prueba en 3 variantes de identidad (usuario nuevo, usuario
existente, varios usuarios distintos en paralelo — mismo criterio ya usado
en Fase 4.1 Casos A/B/C), siempre desde la misma IP de prueba.

| Nivel | Variante | Tasa de éxito esperada | p50/p95/p99 (objetivo, a medir) | Errores permitidos | Conexiones máx. esperadas | Comportamiento esperado ante saturación |
|---|---|---|---|---|---|---|
| 1 | nueva/existente/varios | 100% | a medir | 0 | ≤2 | N/A (sin saturación) |
| 5 | ídem | 100% | a medir | 0 | ≤5 | N/A |
| 8 | ídem | 100% | a medir | 0 | ≤8 (dentro del pool actual de 10) | N/A |
| 10 | ídem | 100% | a medir | 0 | ≤10 (límite exacto del pool actual) | Posible cola breve, sin error |
| 15 | ídem | ≥90% (objetivo, a validar) | a medir | 0 errores 500; `429`/`503` controlados permitidos si se excede capacidad | dependiente del `DATABASE_POOL_MAX` vigente en el momento de la prueba | Cola con espera, nunca error crudo |
| 20 | ídem | Repetición exacta del incidente de Fase 4.1 — objetivo: 0 errores 500 tras la mitigación elegida | a medir | 0 errores 500 | dependiente de la mitigación aplicada | `429`/`503` controlado si se excede, nunca `500` |
| 30 | ídem | a definir tras medir el nivel 20 | a medir | 0 errores 500 | dependiente | ídem |
| 50 | ídem | a definir — nivel de estrés, no necesariamente 100% | a medir | 0 errores 500; degradación controlada aceptable | dependiente | ídem — la saturación debe manifestarse como `429`/`503`, nunca como `500` ni timeout crudo |

**Ningún valor de "tasa de éxito esperada"/latencia para los niveles 15+ se
fija como número final en este documento** — son objetivos a validar
empíricamente, marcados explícitamente como pendientes de medición.

## Reglas obligatorias de la matriz (ya acordadas, aplicables cuando se ejecute)

1. Una prueba de saturación **no debe devolver errores crudos** (mensajes de
   `pg-pool`, stack traces, etc. expuestos al cliente) — el error controlado
   esperado es `429 RATE_LIMITED` o un `503` explícito de "servicio
   saturado", nunca un `500` genérico.
2. La saturación controlada debe producir `429` o `503`, **no `500`** — un
   `500` bajo carga sigue siendo un defecto a corregir, no un resultado
   aceptable de la prueba.
3. Ningún test puede crear identidades duplicadas — mismo criterio que Fase
   4.1 (verificado con consultas `SELECT` antes y después, nunca asumido).
4. Limpieza exacta por UUID — mismo patrón ya usado en Fase 4.1 (capturar
   los UUID exactos devueltos, borrar solo esos, verificar el borrado).
5. Cuentas Firebase y datos temporales deben eliminarse al finalizar cada
   nivel, no solo al final de toda la matriz — para no arrastrar estado
   entre niveles.
6. Logs y evidencia deben sanearse con la misma lista explícita de campos
   permitidos ya usada en Fase 4 y 4.1 (`timestamp`, `severity`, `status`,
   `method`, `route`, `revision`, `errorName`, `errorCode`, `message`
   redactado) — nunca campos crudos completos.

## Instrumentación pendiente (no existe todavía, identificada en esta fase)

Para poder llenar las columnas de latencia p50/p95/p99 y "conexiones
activas" con datos reales (no solo éxito/fallo agregado, que fue el único
dato capturado en Fase 4.1), la Parte 2 de Fase 4.2 necesitará:

- Medir la duración de cada request individual del lado del cliente de
  prueba (ya es trivial de agregar al script de prueba usado en Fase 4.1).
- Consultar `pg_stat_activity` (solo lectura) durante la ráfaga, no solo
  antes/después, para capturar el pico real de conexiones simultáneas.
- Confirmar el número de instancias de Cloud Run activas durante cada
  ráfaga (vía métricas de Cloud Monitoring o el campo `labels.instanceId` de
  los logs, esta vez sí conservado en el saneo si se decide que es seguro
  hacerlo — es un identificador interno de GCP, no un dato de usuario).

Nada de esto se ejecuta en este documento — queda como parte del alcance a
autorizar para Fase 4.2 Parte 2.
