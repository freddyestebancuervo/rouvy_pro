# 5. Prueba básica de rendimiento (Cloud Run real, Development)

Evidencia cruda: [`evidencia/perf_report.json`](evidencia/perf_report.json),
[`evidencia/coldstart_logs_safe.json`](evidencia/coldstart_logs_safe.json).

Todas las pruebas corrieron contra `https://ridepro-backend-dev-1020003121433.southamerica-east1.run.app/v1`
real (no local, no mock). Config del servicio: `minScale` no fijado (0, scale-to-zero
habilitado), `maxScale=2`, `containerConcurrency=80`.

## Latencia — cliente a Cloud Run (incluye ida y vuelta real por internet)

| Endpoint | Modo | n | OK | Errores | avg | p95 | min | max |
|---|---|---|---|---|---|---|---|---|
| `GET /v1/health` | secuencial | 30 | 30 | 0 | 541.6 ms | 482.9 ms | 187.6 ms | 8275.3 ms* |
| `GET /v1/health` | concurrente (20) | 20 | 20 | 0 | 429.6 ms | 526.0 ms | 218.4 ms | 548.7 ms |
| `POST /v1/auth/firebase/exchange` | concurrente (10), mismo usuario | 10 | **7** | **3** | 1079.7 ms | 1123.3 ms | 1069.5 ms | 1123.3 ms |
| `GET /v1/users/me` | secuencial | 30 | 30 | 0 | 272.8 ms | 308.2 ms | 203.7 ms | 316.2 ms |
| `GET /v1/users/me` | concurrente (20) | 20 | 20 | 0 | 446.6 ms | 602.3 ms | 228.5 ms | 603.3 ms |
| `POST /v1/auth/refresh` | cadena secuencial (15, rotación single-use) | 15 | 15 | 0 | 293.5 ms | 335.8 ms | 228.5 ms | 335.8 ms |

\* El `max=8275.3ms` de la primera corrida secuencial de `/v1/health` corresponde
al primer request de la corrida (la instancia venía de estar inactiva unos
minutos) — es la señal de un scale-up real, coherente con la medición dedicada
de cold start de abajo.

**Hallazgo real, no oculto**: 3 de 10 llamadas concurrentes idénticas a
`POST /v1/auth/firebase/exchange` (mismo usuario, primera vez que existe)
devolvieron **500**. Root-cause completo, con evidencia de logs saneada, en
[06_HALLAZGO_RACE_CONDITION_EXCHANGE.md](06_HALLAZGO_RACE_CONDITION_EXCHANGE.md).
Las pruebas de concurrencia sobre `/v1/health` y `/v1/users/me` (endpoints
puramente de lectura) no mostraron ningún error.

## Concurrencia sobre el mismo refresh token (control de seguridad, no bug)

5 llamadas concurrentes a `POST /v1/auth/refresh` con el **mismo** refresh
token (single-use por diseño): **1 éxito (200), 4 rechazos (401
`REFRESH_TOKEN_INVALID_OR_REUSED`)** — comportamiento esperado y correcto de
la protección anti-replay ya implementada (`RefreshTokensRepository.rotate`),
no un problema de rendimiento.

## Cold start (medido de forma determinística, no esperando scale-to-zero)

Con `minScale` en 0, esperar un scale-to-zero real no es determinístico en una
ventana corta de sesión. Se forzó una revisión nueva (mismo digest de imagen,
sin cambios de código) y se midió el arranque real de un contenedor nuevo
desde los logs estructurados de Cloud Run (mismo camino de código que un
scale-up real desde cero):

| Evento | Timestamp | Delta desde el anterior |
|---|---|---|
| `Starting new instance` (Cloud Run) | 17:30:00.564 | — |
| `NestFactory` empieza a bootstrapear | 17:30:05.218 | +4.65 s (pull/extract de imagen + arranque del proceso Node) |
| `Nest application successfully started` | 17:30:06.205 | +0.99 s (bootstrap de todos los módulos) |
| `STARTUP HTTP probe succeeded` | 17:30:08.805 | +2.60 s (reintentos del probe con backoff) |

**Cold start total (instancia nueva → primer health check exitoso): ~8.24 s.**
Con instancias ya calientes, `/v1/health` responde en 200–550 ms (ver tabla de
arriba) — la diferencia de ~7.5 s es enteramente atribuible al arranque en
frío (pull de imagen + Node + bootstrap de Nest + conexión al pool de
Postgres), no a lógica de negocio.

## Limpieza

Usuario Firebase de prueba dedicado a esta prueba y su fila en Postgres,
eliminados al finalizar (mismo patrón que en las demás pruebas de esta fase).
El marcador de entorno usado para forzar la revisión de cold start
(`PERF_COLDSTART_MARKER`) fue removido del servicio inmediatamente después.
