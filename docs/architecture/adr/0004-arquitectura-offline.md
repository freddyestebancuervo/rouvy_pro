# ADR-0004: Arquitectura offline (contrato general, más allá de Firestore)

- **Fecha:** 2026-07-24
- **Estado:** Aceptado el contrato; implementación diferida (ver plan de transición).

## Contexto

`docs/OFFLINE_FIRST.md` documenta un offline-first robusto **pero acoplado a Firestore**: `persistenceEnabled: true` resuelve caché de lectura y cola de escritura para `users`/`ride_sessions` "gratis", vía el SDK nativo. Ese mecanismo **no existe para nada que hable con el backend NestJS** (Workouts, Equipment) — hoy, si el dispositivo está offline, cualquier operación contra `/v1/workouts` simplemente falla (`DioException` de conexión, mapeado a `NetworkFailure` en `AppErrorHandler`, sin reintento ni cola).

`docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 7.3 ya proponía, sin implementar, una cola genérica (`pending_writes` local + reintentos con backoff) para este caso. Esta auditoría (sección 9 de `01_SYSTEM_ARCHITECTURE.md`) formaliza ese contrato con más detalle, sin implementarlo todavía.

## Decisión

1. **Firestore sigue resolviendo su propio offline-first de forma nativa** — no se toca, no se reemplaza por una cola genérica (sería reinventar algo que el SDK ya da sin costo).
2. **Para todo dato que vive en PostgreSQL/NestJS**, se define el contrato `SyncQueue` (ver sección 9 del documento de arquitectura) como la interfaz que cualquier repositorio de un módulo nuevo debe implementar si necesita funcionar offline — **no se construye el motor completo todavía**, solo se fija el contrato para que los endpoints nuevos (empezando por Workouts/Equipment si se prioriza) se diseñen ya pensando en él.
3. **Idempotencia como requisito de diseño desde ya** para cualquier endpoint de escritura nuevo en NestJS — aceptar un `id` generado en el cliente y tratarlo como clave de deduplicación — aunque la cola que lo consuma todavía no exista. Es más barato diseñar el endpoint idempotente desde el principio que migrarlo después con clientes ya en uso.
4. **Resolución de conflictos**: mismo criterio ya validado para Firestore (last-write-wins a nivel de recurso completo para editable, append-only sin conflicto para histórico) — no se diseña un mecanismo de merge de campos individuales sin evidencia de que algún dato lo necesite.

## Alternativas descartadas

1. **Construir el motor de sincronización completo ahora** (tabla `pending_writes`, `ConnectivityWorker`, UI de estado). Descartada para esta tarea: no hay todavía un consumidor real en producción que dependa de que Workouts funcione offline (el flujo de auth con cuenta QA, ADR-0003, ya es un bloqueante previo más urgente) — construirlo ahora sería infraestructura ociosa, mismo criterio anti-sobreingeniería aplicado en ADR-0001.
2. **Replicar Firestore para Workouts/Equipment** (es decir, escribir estos datos también en Firestore para heredar su offline-first gratis). Descartada — contradice directamente ADR-0002 (una sola fuente de verdad) y reintroduce el patrón de duplicación ya detectado como riesgo (`ride_sessions` en dos lugares).
3. **Ignorar el caso offline para Workouts indefinidamente** (dejar que simplemente falle sin reintento). Descartada como destino final — es aceptable como estado transitorio actual, pero no escala a un producto real de ciclismo, donde la conectividad en ruta es explícitamente pobre (es el caso de uso central de la app).

## Consecuencias

- Cualquier PR que agregue un endpoint de escritura a un módulo NestJS nuevo debe justificar por qué NO acepta un idempotency key, no al revés — cambia la carga de la prueba.
- `FirestoreSyncService`/`ConnectivitySyncBanner` quedan como el patrón de referencia de UI a replicar (mismo banner, mismo `SyncStatus`) cuando exista un `BackendSyncService` real — evita que el usuario vea dos mecanismos de "sincronizando" distintos en la misma app.
- El backoff exponencial ya usado en reconexión BLE y reconexión de wearables se reutiliza para la futura cola de sync — tercera aplicación del mismo patrón, no uno nuevo.

## Riesgos

- **Diseñar un contrato sin implementación real corre el riesgo de no anticipar un caso real** que solo aparece al construirlo. Mitigación: el contrato (`SyncQueue`, sección 9) se mantiene deliberadamente pequeño (`enqueue`/`pending`/`markCompleted`/`markFailed`/`statusStream`) para minimizar la superficie que podría estar mal diseñada sin evidencia.
- **Ningún endpoint de NestJS acepta hoy un idempotency key** — si se prioriza T2 (puente de auth) antes que T4 (idempotencia) del plan de transición, se corre el riesgo de construir más superficie de escritura sin este requisito y tener que migrarla después. Se señala explícitamente en el plan de transición como P1, sin bloquear a T2.
