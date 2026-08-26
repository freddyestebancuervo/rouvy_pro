# Korixa — Estado Operativo Vigente

> **Snapshot de reconciliación con corte estricto en PR #95 — 2026-08-25.** Este archivo complementa `PROJECT_STATUS.md` sin convertir entradas históricas punto-en-el-tiempo en estado actual. Los hechos posteriores a PR #95 se documentan en un bloque POST-95 separado y no se mezclan retroactivamente en este corte.

## Identidad del snapshot

```text
DATE = 2026-08-25
SCOPE = PR #1 -> PR #95
SCOPE_CUTOFF = PR #95
MAIN_SHA_AT_CUTOFF = 72b15fe5e4e6dc59be595b4f685cbe75f148eee2
LAST_MERGED_PR_WITHIN_SCOPE = #95
POST_MERGE_CI_RUN = 32889573787
POST_MERGE_CI = 4/4 SUCCESS
```

El snapshot documental anterior fue PR #91, basado en `main=d6b7d65755bfc6c44d9403e417cad585e13fe4c7` y con estado operativo hasta PR #90. Desde ese punto hasta el corte #95, la cadena real de `main` fue:

```text
PR #91 -> d6b7d65755bfc6c44d9403e417cad585e13fe4c7
PR #92 -> a368792ef362b38e5baab62bf1dc2788d0541667
PR #94 -> 6fefc0f86100767f2cfb7ebc1f529f486fe9510e
PR #93 -> d01ac282c8b343854f2d7ba07dd2306d832616b5
PR #95 -> 72b15fe5e4e6dc59be595b4f685cbe75f148eee2
```

> La numeración de PR no coincide con el orden de merge: #94 fue fusionado antes de #93. La secuencia anterior sigue los padres reales de `main`, no el número del PR.

## Cambios reconciliados después del snapshot de PR #91

### PR #92 — T-F2.5: dependencias muertas

**Estado: `CERRADA`.** Se eliminaron de `pubspec.yaml` las 9 dependencias directas declaradas muertas por el Backlog Maestro:

- `logger`
- `injectable`
- `injectable_generator`
- `riverpod_generator`
- `riverpod_annotation`
- `freezed`
- `freezed_annotation`
- `json_serializable`
- `json_annotation`

El diff final quedó limitado a `pubspec.yaml` y `pubspec.lock`. La reconciliación del lockfile evitó downgrades/upgrades no relacionados; `json_annotation` puede permanecer transitivamente cuando otra dependencia la requiera. Merge `a368792ef362b38e5baab62bf1dc2788d0541667`; CI post-merge `32877066872` = SUCCESS.

```text
T-F2.5 = CERRADA
DIRECT_DEAD_DEPENDENCIES_REMOVED = 9/9
PRODUCTION_MUTATIONS = 0
```

### PR #94 — T-F2.4: eliminar `ride_sessions`

**Estado: `CERRADA` a nivel de código/migración.** Se añadió `backend/migrations/0007_drop_unused_ride_sessions.sql` con `DROP TABLE IF EXISTS ride_sessions;` deliberadamente **sin `CASCADE`**, y un bloque Down que reconstruye el esquema original. El inspector read-only fue actualizado para modelar las 7 migraciones y reconocer que `0007` elimina la tabla, sus columnas y sus índices. Merge `6fefc0f86100767f2cfb7ebc1f529f486fe9510e`; CI post-merge `32881414655` = 4/4 SUCCESS, incluido `Backend — migración + e2e (C2)` contra PostgreSQL efímero.

```text
T-F2.4 = CERRADA
MIGRATION_0007_PRESENT = YES
CASCADE = NO
PRODUCTION_MIGRATION_EXECUTED = NO
```

Que `0007` esté en `main` no autoriza ejecutarla contra Production.

### PR #93 — Night Agent: defensa contra `git replace`

**Estado: `CERRADO`.** Se cerró la deuda P3 heredada de PR #88: las 7 invocaciones directas a Git en `tools/night-agent/incremental-audit.mjs` usan `--no-replace-objects`, evitando que un `git replace` local pueda ocultar un cambio real durante una decisión de auditoría incremental. Se añadió una regresión con un repositorio Git desechable y un ataque real de replacement object. Merge `d01ac282c8b343854f2d7ba07dd2306d832616b5`; CI post-merge `32884952568` = 4/4 SUCCESS.

```text
NIGHT_AGENT_GIT_REPLACE_HARDENING = CLOSED
DIRECT_GIT_CALLS_GUARDED = 7/7
PRODUCTION_MUTATIONS = 0
```

## T-F1.2 — Production CD

**Estado al corte PR #95: `EN PROGRESO`.** El criterio formal de aceptación — que un push a `main` despliegue automáticamente al entorno correspondiente sin pasos manuales — todavía no está cumplido.

Los callers de Production continúan controlados/manuales. No existe todavía un deploy real del backend de Production a Cloud Run y la precondición de migraciones no está probada.

### PR #95 — Production read-only metadata preflight

PR #95 implementó `.github/workflows/production-readonly-preflight.yml`, un workflow separado, `workflow_dispatch` only, para probar metadatos actuales de Production sin cruzar la frontera de mutación de la inspección DB.

El workflow exige:

- ref exacta `main` y verificación de frescura contra el `main` remoto;
- confirmación exacta `PREFLIGHT_PRODUCTION_READONLY`;
- `environment: production`;
- WIF hacia la identidad `korixa-production-deployer`;
- únicamente operaciones de lectura/describe/list.

Puede comprobar estado/private-IP de Cloud SQL, presencia de la DB esperada, estado de la service account runtime, números de versiones ENABLED del secreto sin leer payload, ausencia del tag inmutable del SHA en Artifact Registry y existencia del Job inspector. El contrato de regresión falla si se introducen clases de comandos capaces de mutar.

PR #95 **no ejecutó** el workflow contra Production durante el PR. Merge `72b15fe5e4e6dc59be595b4f685cbe75f148eee2`; CI post-merge `32889573787` = 4/4 SUCCESS.

```text
T-F1.2 = EN_PROGRESO
PRODUCTION_READONLY_PREFLIGHT_WORKFLOW = IMPLEMENTED
LIVE_PRODUCTION_PREFLIGHT_EXECUTED_BY_PR95 = NO
MIGRATION_PRECONDITION_PROVEN = NO
REAL_CLOUD_RUN_PRODUCTION_DEPLOY = NO
PRODUCTION_CALLERS = MANUAL_WORKFLOW_DISPATCH
NEXT_TECHNICAL_STEP_AT_PR95_CUTOFF = AUTHORIZED_LIVE_READONLY_PREFLIGHT_DISPATCH
```

Un dispatch real del preflight requiere autorización humana separada. La inspección DB real continúa siendo otro gate distinto.

## Night Agent — roles vigentes

El protocolo de coordinación permanece:

```text
CHATGPT = STRATEGIC_COORDINATOR
NIGHT = OPERATIONAL_ORCHESTRATOR
A = BUILDER / EXECUTOR
B = BREAKER / RED TEAM AUDITOR
C = VALIDATOR / CERTIFIER
HUMAN = AUTHORITY_FOR_SENSITIVE_GATES
```

La misión canónica de B, formalizada en PR #90, no cambia:

```text
B_ROLE = BREAKER / RED TEAM AUDITOR
B_MISSION = BREAK_BEFORE_CERTIFY
REMEDIATION_OWNER = A
B_CAN_FIX_OWN_FINDINGS = NO
```

PR #93 endurece el motor de auditoría incremental, pero no cambia estas responsabilidades.

## CI en el corte #95

El CI post-merge de PR #95, run `32889573787`, terminó `SUCCESS` en los cuatro checks requeridos:

1. Flutter — analyze + test
2. Firestore — reglas de seguridad (A3/A5)
3. Backend — migración + e2e (C2)
4. Night Agent — security + test

El job Backend usa PostgreSQL efímero de CI. Su éxito prueba las migraciones en ese entorno de test, **no** la precondición ni el estado de la base de datos real de Production.

## Estado documental del corte #95

```text
PR_92 = VERIFIED / DOCUMENTED
PR_93 = VERIFIED / DOCUMENTED
PR_94 = VERIFIED / DOCUMENTED
PR_95 = VERIFIED / DOCUMENTED
RECONCILIATION_1_TO_95 = COMPLETE_IN_THIS_SNAPSHOT
POST_95_FACTS_INCLUDED = NO
```

`PROJECT_STATUS.md` conserva su naturaleza histórica append-only. `README.md` debe leerse junto con este snapshot cuando alguna frase operativa anterior a PR #95 haya quedado superada.

## Seguridad de esta reconciliación

```text
CODE_CHANGED = NO
APPLICATION_LOGIC_CHANGED = NO
PRODUCTION_MUTATIONS = 0
IAM_MUTATIONS = 0
SECRET_MUTATIONS = 0
NETWORK_MUTATIONS = 0
READY = NOT_AUTHORIZED_BY_THIS_DOCUMENT
MERGE = NOT_AUTHORIZED_BY_THIS_DOCUMENT
```
