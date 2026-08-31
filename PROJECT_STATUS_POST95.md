# Korixa — Evidencia Operativa POST-95

> **Documento separado del snapshot histórico PR #1 → #95.** `PROJECT_STATUS_CURRENT.md` conserva el corte reconciliado en PR #95. Este archivo registra únicamente hechos posteriores a ese corte y no reescribe retrospectivamente el historial anterior.
>
> **Nota de supersesión (2026-08-31, sin alterar el texto original de este documento):** la afirmación de §5 de que `0001_init.sql` "requiere crear `pgcrypto` si falta" describía correctamente el código real a la fecha de este snapshot (~2026-08-26). Esa dependencia dejó de existir con PR #104 (`fix(db): remove unnecessary pgcrypto migration dependency`, 2026-08-28): `CREATE EXTENSION pgcrypto` fue eliminada de `0001_init.sql`; `gen_random_uuid()` (la única función que la motivaba) es una capacidad núcleo de PostgreSQL 16, sin ninguna extensión. `PGCRYPTO_CURRENT_BLOCKER = NO`. Ver `PROJECT_STATUS_POST106.md` para el detalle completo.

## Identidad del bloque

```text
DATE_LOCAL = 2026-08-25
BASELINE_CUTOFF = PR #95
BASELINE_SHA = 72b15fe5e4e6dc59be595b4f685cbe75f148eee2
DOCUMENTARY_BASELINE_MERGED_BY = PR #97
DOCUMENTARY_BASELINE_MERGE_SHA = 37dfd2ec05234b2b2fb48578b86e868c6803244c
POST95_START = PR #96
T-F1.2 = EN_PROGRESO
```

## 1. PR #96 — corrección del contrato booleano de la inspección DB

PR #96 (`fix(ci): preserve boolean contract for Production DB inspection`) corrigió una incompatibilidad de tipos en el caller de la inspección de Production.

El run real #7 (`32907181757`) había alcanzado correctamente el guard manual, la preparación del hash de migraciones, la construcción/publicación del artefacto Production y la reverificación de identidad del build. Sin embargo, el reusable de inspección no podía instanciarse porque `needs.guard.outputs.inspection_authorized` llega desde `$GITHUB_OUTPUT` como string mientras el reusable declara el input como `type: boolean`.

La corrección fue explícita en el límite del caller:

```yaml
inspection_authorized: ${{ fromJSON(needs.guard.outputs.inspection_authorized) }}
```

Además se añadió la regresión `tools/night-agent/test/production-db-inspection-caller-types.test.mjs`, que exige conservar el input reusable como boolean y prohíbe pasar directamente el job output string.

```text
PR_96 = MERGED
PR_96_HEAD = 4fd63e240059d596f1205ce3cdb247fb85e67339
PR_96_MERGE_SHA = 21d52328297d0cf8eca003d0a24deda9f2e8cfdf
PR_96_CHANGED_FILES = 2
PR_96_PRODUCTION_MUTATIONS = 0
PR_96_EVIDENCE = PROVEN_BY_CODE + PROVEN_BY_CI
```

El CI post-merge de PR #96 (`32911752185`) terminó `SUCCESS` sobre el merge SHA exacto.

## 2. Preflight live de metadatos Production

Después de PR #96 se despachó el workflow manual `Backend — Production read-only metadata preflight` sobre `main=21d52328297d0cf8eca003d0a24deda9f2e8cfdf`.

Run:

```text
GITHUB_RUN = 32913572256
EVENT = workflow_dispatch
RESULT = SUCCESS
HEAD_SHA = 21d52328297d0cf8eca003d0a24deda9f2e8cfdf
```

El run validó el guard de ref/SHA/intención y completó las comprobaciones live de solo lectura: estado y postura de IP privada de Cloud SQL, existencia de la base esperada, estado de la service account runtime, números de versiones ENABLED del secreto sin leer payload, Artifact Registry y existencia del inspector Job.

```text
LIVE_METADATA_PREFLIGHT = PASS
SECRET_PAYLOAD_READ = NO
DB_MUTATION = NO
IAM_MUTATION = NO
NETWORK_MUTATION = NO
EVIDENCE = PROVEN_BY_LIVE_READ_ONLY
```

## 3. Run #8 — el contrato booleano ya funciona y la inspección alcanza Production

El siguiente dispatch de la inspección DB fue el run `32913902787`, sobre el SHA de PR #96.

Este run demuestra que la corrección de PR #96 sí cruzó el límite que antes fallaba: el reusable recibió `inspection_authorized=true` como boolean real y llegó hasta la ejecución del Cloud Run Job.

La cadena que pasó antes del fallo final fue:

```text
GUARD = PASS
MIGRATION_SET_PREPARATION = PASS
PRODUCTION_ARTIFACT_BUILD_PUBLISH = PASS
BUILD_OUTPUT_IDENTITY = PASS
SOURCE_FRESHNESS = PASS
MIGRATION_SET_HASH = PASS
WIF_DEPLOYER_AUTH = PASS
ARTIFACT_PROVENANCE = PASS
CLOUD_SQL_PRECHECK = PASS
RUNTIME_SA_PRECHECK = PASS
SECRET_VERSION_PRECHECK = PASS
CLOUD_RUN_INSPECTOR_JOB_DEPLOY_UPDATE = PASS
CLOUD_RUN_INSPECTOR_EXECUTION = FAILED
GITHUB_RUN_RESULT = FAILURE
```

Evidencia de identidad del intento:

```text
SOURCE_SHA = 21d52328297d0cf8eca003d0a24deda9f2e8cfdf
IMMUTABLE_ARTIFACT = southamerica-east1-docker.pkg.dev/ridepro-dbafe/korixa-backend/api@sha256:e2a2331dee5953b8ef73091af115e3c9ce2a3a33191a760f0d6e3e669d3810f7
MIGRATION_SET_HASH = b7bdd257c37958c0febdb8840fee3e8c02fdf96ae5e26606d6572a723c5dd053
DATABASE_SECRET_VERSION = 2
FAILED_EXECUTION = korixa-production-db-readonly-inspector-rk5qm
```

### Mutaciones reales de infraestructura del run #8

Aunque la consulta SQL objetivo es read-only, el workflow completo de inspección no es “cero mutación” a nivel infraestructura. Antes de ejecutar el inspector:

- publicó un artefacto inmutable en Artifact Registry;
- creó/actualizó la definición del Cloud Run Job `korixa-production-db-readonly-inspector`.

No se ejecutó una migración ni se modificó el esquema/datos de PostgreSQL por esos pasos.

```text
ARTIFACT_REGISTRY_MUTATION = YES
CLOUD_RUN_JOB_DEFINITION_MUTATION = YES
DATABASE_SCHEMA_MUTATION = NO
DATABASE_DATA_MUTATION = NO
IAM_MUTATION = NO
NETWORK_MUTATION = NO
```

## 4. Inspección live posterior — ejecución exitosa del inspector

Después del run #8 se obtuvo evidencia live adicional mediante la ejecución `korixa-production-db-readonly-inspector-7t8ks` del mismo inspector de Production. La ejecución terminó correctamente (`succeededCount=1`, condición `Completed=True`) alrededor de `2026-08-26 01:10:12 UTC`.

**Importante:** que el Cloud Run Job haya terminado correctamente prueba que el inspector se ejecutó; no significa que el estado de la base haya sido aprobado. La disposición autoritativa es el JSON emitido por el inspector.

La inspección confirmó:

```text
PGMIGRATIONS_EXISTS = false
MIGRATION_TRACKING = TRACKED_AND_CONSISTENT
APPLIED_MIGRATIONS = 0
PENDING_MIGRATIONS = 7
PENDING_SET = 0001_init ... 0007_drop_unused_ride_sessions
PHYSICAL_SCHEMA = MATCHES_APPLIED
EXPECTED_PRESENT = []
EXPECTED_MISSING = []
UNEXPECTED_OBJECTS = []
OBJECT_OWNERS = []
PGCRYPTO_PRESENT = false
RUNTIME_CREDENTIAL_MAPPING = MATCHES_EXPECTED
RUNTIME_DB_ROLE = korixa_runtime
```

Interpretación: Production está físicamente limpia/vacía respecto del conjunto de migraciones de Korixa; las 7 migraciones permanecen pendientes y el tracking es consistente con cero aplicadas.

## 5. Bloqueo actual — modelo de privilegios DB

El inspector no aprobó la precondición de migraciones. Su resultado fue:

```text
DB_ROLE_MODEL = OBVIOUS_VIOLATION
PRODUCTION_SCHEMA_STATE = HOLD_ROLE_PRIVILEGE_ESCALATION
FINAL_DISPOSITION = HOLD_ROLE_PRIVILEGE_ESCALATION
```

Findings exactos:

```text
korixa_app: CREATEROLE inesperado
korixa_app: CREATEDB inesperado
```

Además, la evidencia live confirmó una membresía directa:

```text
MEMBER_ROLE = korixa_app
GRANTED_ROLE = cloudsqlsuperuser
```

Precisión de seguridad: no se documenta `CREATEROLE`/`CREATEDB` como privilegios de objeto “heredados” de esa membresía. Son **capability flags del propio rol `korixa_app`** y están activos; esos flags son los que disparan el `HOLD`. La membresía directa en `cloudsqlsuperuser` es una evidencia adicional de elevación que debe ser tratada por separado.

Privilegios observados:

```text
korixa_app.can_connect = true
korixa_app.can_schema_usage = true
korixa_app.can_schema_create = true
korixa_runtime.can_connect = true
korixa_runtime.can_schema_usage = true
korixa_runtime.can_schema_create = false
DATABASE_OWNER = cloudsqlsuperuser
PUBLIC_SCHEMA_OWNER = pg_database_owner
```

Ninguna de las migraciones `0001` a `0007` necesita `CREATEROLE` ni `CREATEDB`. `0001_init.sql` sí requiere crear `pgcrypto` si falta; antes de reducir privilegios debe probarse el permiso mínimo efectivo necesario para instalar esa extensión y ejecutar el resto del conjunto de migraciones.

También queda por demostrar que, después de crear las tablas con el rol de migración, `korixa_runtime` reciba únicamente los privilegios DML/secuencias necesarios. No se debe asumir que estos grants existen si no están demostrados por migraciones/código o prueba no-Production.

## 6. Estado operativo POST-95

```text
PR_96_BOOLEAN_CONTRACT_FIX = CLOSED
LIVE_METADATA_PREFLIGHT = PASS
LIVE_DB_INSPECTION_REACHABILITY = PROVEN
MIGRATION_TRACKING = CONSISTENT_0_OF_7_APPLIED
PHYSICAL_SCHEMA = CLEAN_FOR_0_APPLIED
RUNTIME_CREDENTIAL = korixa_runtime / MATCHES_EXPECTED
MIGRATION_ROLE = korixa_app
ROLE_PRIVILEGE_MODEL = HOLD
MIGRATION_PRECONDITION_PROVEN = NO
REAL_CLOUD_RUN_PRODUCTION_BACKEND_DEPLOY = NO
T-F1.2 = EN_PROGRESO
```

## 7. Próximo gate seguro

Antes de ejecutar migraciones en Production debe existir evidencia de mínimo privilegio para `korixa_app` y de permisos runtime posteriores a las migraciones.

```text
NEXT_STEP = PROVE_MINIMUM_DB_PRIVILEGES_BEFORE_HARDENING
REMOVE_CLOUDSQLSUPERUSER = NOT_EXECUTED_IN_THIS_DOCUMENTARY_TASK
ALTER_ROLE_CAPABILITIES = NOT_EXECUTED_IN_THIS_DOCUMENTARY_TASK
RUN_PRODUCTION_MIGRATIONS = NOT_AUTHORIZED
PRODUCTION_BACKEND_DEPLOY = NOT_AUTHORIZED
```

Este documento no autoriza IAM, cambios destructivos, migraciones, hardening de roles ni deploy de Production. Cada operación sensible conserva su Human Gate separado.
