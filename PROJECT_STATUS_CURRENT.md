# Korixa — Estado Operativo Vigente

> **Fuente operativa de lectura rápida — 2026-08-25.** Este archivo complementa `PROJECT_STATUS.md` sin reescribir su historial append-only. Cuando exista contradicción con una afirmación histórica punto-en-el-tiempo, este snapshot debe leerse junto con la evidencia GitHub exacta indicada aquí. No cambia el estado de ninguna tarea por sí solo.

## Identidad del snapshot

```text
DATE = 2026-08-25
MAIN_SHA = 0ac1457ca0d58235f73c4ecd2db37c7058208673
LAST_MERGED_PR = #90
POST_MERGE_CI_RUN = 32848827876
POST_MERGE_CI = 4/4 SUCCESS
```

El `main` anterior a PR #90 era `caf4afbfbf70efc6306ee9bd83ff8f48feb0f599` (merge de PR #88). PR #90 fue fusionado de forma ordinaria y avanzó `main` a `0ac1457ca0d58235f73c4ecd2db37c7058208673`.

## T-F1.2 — Production CD

**Estado vigente: `EN PROGRESO`.** El criterio formal de aceptación — que un push a `main` despliegue automáticamente al entorno correspondiente sin pasos manuales — todavía no está cumplido.

- **PR #85 — fusionado.** Caller manual-only de deploy de Production (`workflow_dispatch`) con cadena `guard → build-production-artifact → verify-build-output → deploy-production-candidate`. No ejecutó un deploy real de Cloud Run Production.
- **PR #86 — fusionado.** Caller manual-only de inspección read-only de Production DB. No ejecutó la inspección durante el PR.
- **Incidente posterior a #86.** El primer dispatch autorizado de la inspección fue rechazado por GitHub antes de crear un run porque jobs normales con `steps:` carecían de `runs-on:`. Ningún job corrió; no hubo consulta DB, publicación de artefacto, deploy ni mutación de Production.
- **PR #87 — abierto/Draft, no fusionado.** Fix inicial acotado. Quedó técnicamente superado por el hardening sistémico de #88; este snapshot no lo cierra.
- **PR #88 — fusionado.** Endureció validación estructural de workflows/actionlint, evidencia ligada a HEAD y gates B/C/Human. Merge `caf4afbfbf70efc6306ee9bd83ff8f48feb0f599`; CI post-merge `32801653025` = 4/4 SUCCESS; locator `32801868448` = SUCCESS.

```text
T-F1.2 = EN_PROGRESO
MIGRATION_PRECONDITION_PROVEN = NO
REAL_CLOUD_RUN_PRODUCTION_DEPLOY = NO
PRODUCTION_CALLERS = MANUAL_WORKFLOW_DISPATCH
NEXT_TECHNICAL_STEP = READ_ONLY_DB_INSPECTION_PREFLIGHT
```

El próximo paso técnico sigue siendo un preflight estrictamente de solo lectura del workflow de inspección de Production DB sobre el `main` vigente. Un dispatch real de ese workflow es una operación de Production y requiere autorización humana separada.

## Night Agent — roles vigentes

El protocolo de coordinación queda formalmente:

```text
CHATGPT = STRATEGIC_COORDINATOR
NIGHT = OPERATIONAL_ORCHESTRATOR
A = BUILDER / EXECUTOR
B = BREAKER / RED TEAM AUDITOR
C = VALIDATOR / CERTIFIER
HUMAN = AUTHORITY_FOR_SENSITIVE_GATES
```

### B — Breaker / Red Team Auditor

PR #90 formalizó la misión canónica de B y fue fusionado a `main`.

```text
B_ROLE = BREAKER / RED TEAM AUDITOR
B_MISSION = BREAK_BEFORE_CERTIFY
REMEDIATION_OWNER = A
B_CAN_FIX_OWN_FINDINGS = NO
```

La política canónica está en `tools/night-agent/BREAKER_POLICY.md` y el contrato machine-readable en `tools/night-agent/role-capabilities.mjs`.

Regla central: B no intenta confirmar que A hizo un buen trabajo; intenta falsificarlo. Si encuentra un defecto, lo reproduce y documenta con evidencia, clasifica el finding y devuelve el trabajo a A. B no escribe archivos de tarea, no hace commit/push de la remediación y no sustituye a C.

Flujo bloqueante:

```text
A → B
B encuentra defecto bloqueante
B → HOLD / HOLD_FOR_REMEDIATION → A
A corrige sobre nuevo HEAD
A → B
B vuelve a atacar
B PASS → C
C certifica HEAD exacto
C → HUMAN_GATE
```

“Romper” significa falsificación controlada: análisis, pruebas adversariales, fixtures desechables y evidencia. Nunca significa experimentación destructiva contra Production.

### Evidencia PR #90

```text
PR = #90
FEATURE_HEAD = c4463ca5672a33b2590ccd1cc501c634b6df2787
PRE_MERGE_CI_RUN = 32847968486
PRE_MERGE_CI = 4/4 SUCCESS
MERGE_COMMIT = 0ac1457ca0d58235f73c4ecd2db37c7058208673
POST_MERGE_CI_RUN = 32848827876
POST_MERGE_CI = 4/4 SUCCESS
```

Los cuatro checks post-merge fueron `SUCCESS`:

1. Flutter — analyze + test
2. Firestore — reglas de seguridad (A3/A5)
3. Backend — migración + e2e (C2)
4. Night Agent — security + test

El job de Backend en CI usa entorno de pruebas; no constituye evidencia de que la precondición de migraciones de Production esté probada.

## Estado documental

- `tools/night-agent/BREAKER_POLICY.md` — **VIGENTE** y fusionado en #90.
- `README.md` — en esta sincronización se corrige el estado de Production para reflejar `T-F1.1=CERRADA`, `T-F1.2=EN PROGRESO` y `MIGRATION_PRECONDITION_PROVEN=NO`.
- `PROJECT_STATUS.md` — se conserva byte-intacto en esta sincronización para proteger su historial append-only; este archivo registra el snapshot operativo nuevo sin repetir el defecto de reescritura histórica detectado en PR #89.
- `PR #89` — permanece abierto/Draft y no se fusiona ni se cierra en esta tarea.
- `PR #81` — permanece como evidencia histórica del primer intento fallido del protocolo y no se modifica en esta tarea.

## Seguridad de esta sincronización

```text
CODE_CHANGED = NO
WORKFLOWS_CHANGED = NO
PRODUCTION_MUTATIONS = 0
IAM_MUTATIONS = 0
SECRET_MUTATIONS = 0
NETWORK_MUTATIONS = 0
READY = NOT_AUTHORIZED_BY_THIS_DOCUMENT
MERGE = NOT_AUTHORIZED_BY_THIS_DOCUMENT
```
