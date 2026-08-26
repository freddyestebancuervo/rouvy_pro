# Arquitectura — guía de vigencia documental

> **Reconciliación secuencial, corte autoritativo PR #95.** Los documentos incorporados por PR #7 fueron preparados como arquitectura/auditoría punto-en-el-tiempo alrededor del 2026-07-24. Conservan valor histórico y de decisión, pero sus frases de “estado actual”, “hoy”, conteos y pendientes no deben interpretarse automáticamente como estado operativo vigente.

## Cómo leer esta carpeta

- `01_SYSTEM_ARCHITECTURE.md` es un **snapshot histórico de arquitectura + arquitectura objetivo**. Sus secciones de “estado actual” reflejan el repositorio previo a la integración v0.5.0 y quedaron parcialmente superadas incluso antes del merge de PR #7.
- Los ADR conservan la decisión tomada y su contexto original. Cuando una decisión fue ejecutada después, debe separarse la **decisión histórica** de su **estado de ejecución vigente**.
- Para estado operativo vigente se debe consultar `PROJECT_STATUS_CURRENT.md` junto con evidencia GitHub exacta. `PROJECT_STATUS.md` se conserva como historial append-only.

## Supersesiones ya demostradas en el recorrido #1 → #9

### Autenticación — `ADR-0003`

El snapshot de `01_SYSTEM_ARCHITECTURE.md` y el texto original de `ADR-0003` dicen que Firebase Auth y NestJS/PostgreSQL estaban completamente desconectados y que no existía un puente Firebase → backend. Esa afirmación quedó superada por PR #4, que implementó `POST /auth/firebase/exchange`, añadió `firebase_uid` mediante la migración `0005_users_firebase_uid.sql` y verificación server-side con Firebase Admin. PR #5 endureció concurrencia, rate limiting y manejo de saturación del mismo flujo.

`ADR-0003` conserva su contenido original, pero ahora incluye una nota explícita de reconciliación para que sus frases históricas no se lean como estado vigente.

### Contenedorización y Development

Las afirmaciones históricas de `01_SYSTEM_ARCHITECTURE.md` que describen ausencia de contenedorización o ausencia de backend cloud deben leerse según su fecha. PR #3 añadió/validó `backend/Dockerfile`; PR #4 conserva evidencia de un despliegue real de **Development**. Ninguno de esos hechos acredita por sí solo un despliegue real de Production.

### Conteos y migraciones

Los conteos de módulos, tests y migraciones dentro de `01_SYSTEM_ARCHITECTURE.md` son evidencia de 2026-07-24, no inventario vigente al corte PR #95. Por ejemplo, el documento enumera cuatro migraciones; PR #4 añadió la migración `0005` antes de que PR #7 fuera fusionado.

### Wearables Web — `T-F0.1`

`docs/tasks/TF0_1_ANALISIS_Y_DISENO.md` es un documento histórico de análisis/diseño y por eso termina diciendo que la implementación quedaba a la espera de aprobación. Esa frase describe correctamente el momento en que fue escrito, pero quedó superada por PR #9 (`0582e4933ef9f1e5ab0fce8f18197c6ffb2c7614`): `HealthPlatformGatewayImpl.checkAvailability()` pasó a cortar el flujo Web antes de evaluar `dart:io Platform`, con regresión automatizada para `checkAvailability()`, `requestPermissions()` y `checkPermissionStatus()`.

PR #9 acredita la implementación y el CI automatizado del cambio. No se usa por sí solo como prueba de una interacción manual en navegador real; esa validación es evidencia separada y posterior. El hallazgo adicional documentado en la sección 12 del análisis (`HealthPackageAdapter._isIOS`) tampoco se da por resuelto por PR #9, porque quedó explícitamente fuera de su alcance.

## Documentos preservados sin reescritura

Los archivos bajo `docs/audits/AUDITORIA_FINAL/` se preservan como evidencia histórica punto-en-el-tiempo, tal como declara el propio PR #7. `docs/tasks/TF0_1_ANALISIS_Y_DISENO.md` también conserva su alcance original de análisis/diseño y no se convierte retrospectivamente en documento de implementación/cierre; su supersesión de ejecución queda registrada en esta guía y en la reconciliación secuencial.

`RIDEPRO_DEVELOPMENT_PROTOCOL.md` se conserva en esta etapa del recorrido: su evolución de gobernanza depende de PR posteriores que se reconciliarán cuando corresponda en el orden secuencial #1 → #95. Esta guía no adelanta esos cierres.

## Regla de reconciliación

```text
HISTORICAL_FACT = PRESERVE
CURRENT_STATE_CLAIM_SUPERSEDED_BY_AUDITED_PR = MARK_AS_SUPERSEDED
LATER_PR_STATE = DEFER_UNTIL_ITS_PR_IS_AUDITED
PROJECT_STATUS.md = DO_NOT_REWRITE
PRODUCTION_MUTATIONS = 0
```
