# Fase 4.1 — Corrección de concurrencia en Firebase Exchange (CERRADA)

**Estado: cerrada formalmente.** Corrección de la race condition documentada en
`docs/audits/AUDITORIA_FINAL/fase_4/06_HALLAZGO_RACE_CONDITION_EXCHANGE.md`
(`AuthService.exchangeFirebaseToken` / `UsersRepository.upsertByFirebaseUid`),
validada con evidencia real: unit tests, e2e local (x6 repeticiones), y
finalmente contra Cloud Run + Cloud SQL reales en `ridepro-development`.
Auditoría final de cierre en [06_CIERRE_FORMAL.md](06_CIERRE_FORMAL.md).

## Índice

1. [Preflight y diff final](01_PREFLIGHT_Y_DIFF.md)
2. [Imagen y despliegue](02_IMAGEN_Y_DESPLIEGUE.md)
3. [Pruebas de concurrencia real (Casos A–D)](03_PRUEBAS_CONCURRENCIA_REAL.md)
4. [Verificación PostgreSQL y auditoría de logs](04_VERIFICACION_POSTGRESQL_Y_LOGS.md)
5. [Limpieza, rollback y riesgos pendientes](05_LIMPIEZA_Y_RIESGOS.md)
6. [**Cierre formal y auditoría final**](06_CIERRE_FORMAL.md) — diffs exactos, re-verificación completa, tabla de puertas de calidad, veredictos explícitos

Evidencia cruda sanitizada: [`evidencia/`](evidencia/).

## Veredictos explícitos (ver detalle y evidencia en el documento 6)

| Veredicto | Estado |
|---|---|
| Corrección de la race condition de identidad | ✅ **APROBADA** |
| Capacidad con 8 concurrentes | ✅ **VALIDADA** |
| Capacidad con 20 concurrentes | ❌ **NO APROBADA** — bloqueada por el pool de Postgres (`DATABASE_POOL_MAX=10`, sin configurar), no por la corrección |
| Pool de PostgreSQL y rate limit (20/15min) | ⏳ **PENDIENTES para Fase 4.2** |

## Resultado en una línea

| Ítem | Resultado |
|---|---|
| Causa raíz | Confirmada: 2 ventanas de carrera reales en `upsertByFirebaseUid` (INSERT y el pre-chequeo `findByEmail`), cerradas con re-consulta por `firebase_uid`, sin ON CONFLICT, sin locks en memoria |
| Único archivo de producción modificado | `backend/src/modules/users/users.repository.ts` (180 líneas de diff, 2 cambios aprobados explícitamente) |
| Archivos de test nuevos | 4 (`users.repository.spec.ts` + 3 e2e de concurrencia) |
| Validación local (re-confirmada en el cierre) | **104/104 unit, 0 lint, build limpio, 85/85 e2e**, 0 archivos `*.e2e-spec.*` en `dist/` |
| Imagen | `dev-20260728-005941`, digest `sha256:cb6390995eb955e091c300bcb6cf10aaa9092570bf11e6b12d8db266335d2d37`, publicada una sola vez, `:dev` intacto |
| Despliegue | `ridepro-backend-dev-00007-llf`, Ready=True, config previa conservada (`FIREBASE_CHECK_REVOKED=true` incluido), sin cambios desde entonces |
| Caso A (20 concurrentes, usuario nuevo) | **0 errores de identidad/23505** — 13/20 500 por agotamiento del pool (hallazgo de capacidad separado, no el bug de esta fase) |
| Caso B (8 concurrentes, usuario existente) | 8/8 éxito, mismo `sub`, sin duplicados |
| Caso C (2 usuarios × 4 concurrentes) | 8/8 éxito, identidades separadas correctamente, sin contaminación cruzada |
| Caso D (conflicto real de email) | 2/2 → `409 FIREBASE_EMAIL_CONFLICT`, nunca éxito ni 500, sin vinculación automática (incl. `firebase_uid=null`) |
| PostgreSQL | 1 fila + 1 `user_roles` por identidad, 0 huérfanos, 0 sobrescrituras |
| Logs | 0 `23505` expuesto, 0 secretos/tokens detectados, status reconciliados 1:1 con lo observado del lado cliente |
| Limpieza (re-verificada en el cierre) | 4 usuarios originales + cuenta QA intactos, 2 usuarios Firebase (baseline previo, sin cuentas de prueba), 0 datos remanentes, 0 contenedores/proxies de prueba, 0 archivos sensibles en scratchpad |

## Hallazgos de capacidad — separados del bug de esta fase, para Fase 4.2

1. **Pool de PostgreSQL**: `DATABASE_POOL_MAX` nunca se configuró en
   `ridepro-backend-dev` (usa el default de código, `10`). Con 20 exchanges
   genuinamente concurrentes, las conexiones que no logran un slot del pool
   en 5s fallan con `timeout exceeded when trying to connect` — **no** con
   `23505` ni con ningún síntoma de la race condition de identidad.
   Confirmado con logs sanitizados: 0 coincidencias de `23505`/`duplicate
   key` en toda la ventana. No se modificó el pool de producción en esta
   fase (restricción explícita).
2. **Rate limit de 20/15min por IP** en `/auth/firebase/exchange`: correcto
   y deseado como control anti-abuso, pero limita cuánta prueba de carga
   real se puede ejecutar de corrido — documentado como comportamiento
   esperado, no como bug.

## Restricciones respetadas (Partes 1, 2 y cierre)

Sin tocar Flutter, sin tocar Producción, sin modificar IAM, sin actualizar
NestJS/dependencias, sin `git add/commit/push`, sin cambiar pool/escalado/
concurrencia/rate-limit de Cloud Run, sin nuevos despliegues en este cierre.
