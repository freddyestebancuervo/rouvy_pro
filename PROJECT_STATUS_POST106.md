# Korixa — Evidencia Operativa POST-106 (PR #103 → PR #106)

> **Documento separado, sucesor de `PROJECT_STATUS_POST98.md`.** `PROJECT_STATUS_CURRENT.md` conserva el corte reconciliado en PR #95 y no se reescribe. `PROJECT_STATUS_POST95.md` conserva su corte original y no se reescribe (con una nota de supersesión agregada en 2026-08-31, ver ese archivo). `PROJECT_STATUS_POST98.md` conserva su corte original (PR #97 → #102) y tampoco se reescribe. Este archivo registra únicamente hechos posteriores a ese corte, hasta PR #106 inclusive.

## Identidad del snapshot

```text
DATE = 2026-08-31
SCOPE = PR #103 -> PR #106
BASELINE_DOCUMENT = PROJECT_STATUS_POST98.md
BASELINE_CUTOFF = PR #102
MAIN_SHA_AT_THIS_CUTOFF = 93dc07d53af843e4723af4c1208b379c4a83201b
LAST_MERGED_PR_WITHIN_SCOPE = #106
T_F1_2_OVERALL = IN_PROGRESS
PRODUCTION_READY = NO
```

La cadena real de `main` en este rango (por padres de merge, no por número de PR):

```text
PR #103 -> c7cdb49b14d6e22401c2470b9cf1471feaf946a1 (docs: sync T-F1.2 checkpoint through PR #102)
PR #104 -> 5bf59f46b4c4204c0592a34df5ce229c0e1cd008 (fix(db): remove unnecessary pgcrypto migration dependency)
PR #105 -> c4a803e57d1745b8e081bb17ae2069e69d466fab (feat(db): add fail-closed runtime privilege reconciler)
PR #106 -> 93dc07d53af843e4723af4c1208b379c4a83201b (fix(db): enforce least-privilege runtime model)
```

---

## COMPLETADO en este rango

### PR #103 — sincronización documental hasta PR #102
Trabajo exclusivamente documental — cierra la sincronización que este mismo linaje de documentos venía cargando (`PROJECT_STATUS_POST98.md`).

### PR #104 — eliminación de la dependencia de `pgcrypto`

Auditoría read-only previa (evidencia de código, no inferencia) confirmó que `pgcrypto` no tenía ningún uso funcional real en el repositorio más allá de `gen_random_uuid()`, y que esa función es núcleo de PostgreSQL desde la v13 (este proyecto apunta a PostgreSQL 16). Cambio mínimo aplicado:

```text
CREATE_EXTENSION_PGCRYPTO = REMOVED (backend/migrations/0001_init.sql)
GEN_RANDOM_UUID_CALLS = UNCHANGED (3/3 en 0001_init.sql; 7/7 en todas las migraciones)
PGCRYPTO_OTHER_DEPENDENCIES = NONE (verificado por búsqueda exhaustiva de código)
PGCRYPTO_CURRENT_BLOCKER = NO
```

Validado contra PostgreSQL 16 efímero/local (desechable, nunca Development/Production): migraciones 0001-0007 aplicadas desde cero, `pgcrypto` confirmada ausente en `pg_extension`, `gen_random_uuid()` probado con un `INSERT` real. 244/244 tests unitarios, typecheck y lint sin `--fix` en verde. Auditor B independiente: `PASS`. `PRODUCTION_MUTATIONS = 0`, `GCP_MUTATIONS = 0`.

**Esto NO reescribe evidencia histórica**: `PROJECT_STATUS_POST95.md` §5 seguía citando `pgcrypto` como requisito porque, a su fecha (~2026-08-26), lo era — ver la nota de supersesión agregada a ese archivo en esta misma fecha (2026-08-31), que aclara la fecha exacta del cambio sin alterar el texto original.

### PR #105 — reconciliador de privilegios de runtime (versión inicial)

Reemplaza el modelo implícito ("lo que sea que el rol runtime ya tenga") por una matriz explícita, deny-by-default, derivada de una auditoría exhaustiva del código real de cada repositorio del backend (`UsersRepository`, `RefreshTokensRepository`, `EquipmentRepository`, `WorkoutsRepository`, `AuditLogRepository`):

```text
RUNTIME_PRIVILEGE_MATRIX = EXPLICIT (backend/src/ops/runtime-privilege-matrix.ts)
BROAD_RUNTIME_GRANTS = REMOVED (nunca "GRANT ... ON ALL TABLES")
ALTER_DEFAULT_PRIVILEGES_BROAD = REMOVED (Estrategia A: cero reglas de privilegio por defecto — una tabla futura no recibe acceso runtime automático, requiere entrada explícita en la matriz)
PGMIGRATIONS_RUNTIME_ACCESS = DENIED (estructural — pgmigrations nunca aparece en la matriz, más verificación activa antes/después de cada GRANT)
AUDIT_LOG_RUNTIME_MODEL = APPEND_ONLY (INSERT únicamente; SELECT/UPDATE/DELETE denegados)
```

Validado con PostgreSQL 16 efímero/local (roles `migration_test`/`runtime_test`, desechables). Independiente auditoría B posterior a la propia implementación encontró y corrigió, antes de entregar, una brecha real (`GRANT` puede degradar a `WARNING`-y-no-op en vez de error cuando el otorgante ya posee un privilegio solapado — el reconciliador ahora aborta también ante cualquier `NOTICE`/`WARNING` inesperado). En esta versión, el reconciliador todavía lee `DATABASE_URL` (más `RUNTIME_DB_ROLE`) como su contrato de conexión — ver PR #106 más abajo para la corrección de ese contrato. `PRODUCTION_MUTATIONS = 0`, `GCP_MUTATIONS = 0`.

### PR #106 — auditoría independiente y endurecimiento del modelo de privilegios (P1-1/P1-1A/P1-2/P1-3)

Una auditoría independiente sobre PR #105 encontró 3 hallazgos P1 reales, ninguno P0. Los tres quedaron remediados, re-verificados contra PostgreSQL 16 real (no solo mocks), y re-auditados dentro del mismo PR antes de entregar:

```text
RECONCILER_PRE_GRANT_DRIFT_GATE = IMPLEMENTED (P1-1 — cualquier privilegio EXCEDENTE ya presente, antes de otorgar nada, aborta cerrado; un privilegio requerido pero todavía no otorgado NO bloquea esta fase)
RECONCILER_POST_GRANT_EXACT_STATE_PROOF = IMPLEMENTED (P1-1 — después de ejecutar los GRANT, todavía dentro de la misma transacción, se exige estado EXACTO — ni falta ni sobra nada — antes de permitir `RECONCILED`; si no, ROLLBACK completo)
PGMIGRATIONS_ID_SEQ_RUNTIME_ACCESS = DENIED (P1-1A — mismo invariante que la tabla `pgmigrations`, extendido a su secuencia de tracking, ausente del hallazgo original)
UNEXPECTED_RUNTIME_PRIVILEGE_HOLD = IMPLEMENTED (P1-2 — el drift de secuencias ahora evalúa USAGE/SELECT/UPDATE como tres hallazgos separados y etiquetados, no un genérico que podía ocultar un SELECT/UPDATE extra en `audit_log_id_seq`)
CLOUDSQLSUPERUSER_DIRECT_HOLD = IMPLEMENTED (preexistente, conservado)
CLOUDSQLSUPERUSER_TRANSITIVE_HOLD = IMPLEMENTED (P1-3 — membresía vía un rol intermedio, `runtime -> intermediate_role -> cloudsqlsuperuser`, ahora se detecta mediante una CTE recursiva sobre `pg_auth_members`, no solo la arista directa)
RUNTIME_SCHEMA_CREATE_HOLD = IMPLEMENTED (preexistente, conservado)
UNEXPECTED_RUNTIME_ROLE_MEMBERSHIP_HOLD = IMPLEMENTED (nuevo — deny-by-default explícito, `EXPECTED_RUNTIME_ROLE_MEMBERSHIPS = []`, declarado por falta de evidencia de que el runtime necesite alguna, no inferido de una membresía histórica encontrada)
POSTGRES16_REAL_PRIVILEGE_TEST = IMPLEMENTED (39 tests e2e contra PostgreSQL 16 real, incluidos los escenarios adversariales F-I del hallazgo P1, más 2 adiciones de red-team propio: una tabla creada después de reconciliar no recibe acceso automático; un fallo genuino a mitad de transacción revierte por completo)
MIGRATION_ROLE_RUNTIME_ROLE_SEPARATED_IN_CI = PROVEN (roles `migration_test`/`runtime_test` reales, separados, en el mismo servicio Postgres 16 que ya usa el job "Backend — migración + e2e (C2)" — cero servicio nuevo)
MIGRATION_DATABASE_URL_RECONCILER_CONTRACT = PR_106 (el reconciliador de PR #105 leía `DATABASE_URL` + `RUNTIME_DB_ROLE`; PR #106 lo cambió a `MIGRATION_DATABASE_URL` + `RUNTIME_DB_ROLE`, coherente con `docs/T-F1.2_PORTABLE_PRODUCTION_CD.md` — y aborta cerrado si `DATABASE_URL` está presente en su propio proceso, sin depender únicamente de que un runner externo haya validado el contrato antes de invocarlo)
```

Modelo explícitamente `NO AUTO-REVOKE`: el reconciliador nunca revoca un privilegio inesperado que detecta — aborta cerrado y expone evidencia estructurada; cualquier remediación real queda para un Human Gate separado.

**Evidencia CI para el HEAD auditado de PR #106** (rama `fix/tf12-runtime-privilege-matrix-hardening-20260828`, run `303`, `SUCCESS`):

```text
PR_106_HEAD_AUDITED = 313c542c5060bab803ae602446450555e23cfc1f
PR_106_MERGE_COMMIT = 93dc07d53af843e4723af4c1208b379c4a83201b
CI_RUN_303_HEAD = 313c542c5060bab803ae602446450555e23cfc1f
UNIT_TESTS = 365/365 PASS
E2E_TESTS = 170/170 PASS
POSTGRES = 16
CI_RUN_303 = SUCCESS
```

`PR_106_HEAD_AUDITED` (el commit que CI realmente probó, `313c542c...`) es distinto de `PR_106_MERGE_COMMIT` (`93dc07d5...`, el commit de 2 padres que `git merge` creó al fusionar el PR a `main`) — GitHub Actions dispara el run sobre el HEAD del PR, no sobre el merge commit posterior.

`PRODUCTION_MUTATIONS = 0`, `GCP_MUTATIONS = 0`, `IAM_MUTATIONS = 0`, `SECRET_PAYLOAD_ACCESSED = NO` en todo este rango (PR #103-106).

---

## Hallazgo preservado sin revalidar — `ROLE_PRIVILEGE_MODEL`

`PROJECT_STATUS_POST95.md` §5 registró, con evidencia live fechada (~2026-08-26), que `korixa_app` tenía `CREATEROLE`/`CREATEDB` inesperados y membresía directa en `cloudsqlsuperuser`, disposición `HOLD_ROLE_PRIVILEGE_ESCALATION`. `PROJECT_STATUS_POST98.md` preservó ese hallazgo sin revalidarlo. **Este documento hace lo mismo — sin excepción nueva:**

```text
ROLE_PRIVILEGE_MODEL = HOLD (preservado, no revalidado en este rango)
ROLE_PRIVILEGE_MODEL_EVIDENCE_DATE = ~2026-08-26
CURRENT_REVALIDATION = REQUIRED
KORIXA_APP_REAL_PRIVILEGES = LAST_KNOWN_EXCESSIVE / REQUIRES_REVALIDATION
```

**Muy importante — no confundir tooling con remediación:** todo el trabajo de PR #104/#105/#106 construyó y probó, exhaustivamente contra PostgreSQL 16 NONPROD/efímero, el modelo y las herramientas (matriz explícita, reconciliador fail-closed, inspector con HOLD automático) que una futura remediación real usaría. **Ninguno de los tres PRs tocó `korixa_app`, Cloud SQL de Production, IAM, ni ejecutó una sola migración contra una base persistente.** El hallazgo de `korixa_app` sigue exactamente donde estaba: `HOLD`, sin revalidar.

```text
REAL_PRODUCTION_ROLE_REMEDIATION = NOT_EXECUTED
REAL_PRODUCTION_MIGRATIONS = 0
PRODUCTION_MIGRATION_EXECUTOR = NOT_IMPLEMENTED
PRODUCTION_RECONCILER_WIRING = NOT_IMPLEMENTED
```

---

## PENDIENTE (sin cambios de fondo en este rango, salvo lo ya indicado arriba)

```text
ROLE_PRIVILEGE_MODEL_REVALIDATION = REQUIRED
SEPARATE_MIGRATION_JOB = NOT_DESIGNED (diseño lógico discutido; cero workflow/job creado)
RUNTIME_IDENTITY_VS_MIGRATION_IDENTITY = NOT_SEPARATED_AT_EXECUTION_LEVEL (probado en NONPROD; no wireado a Production)
TARGET_AND_SOURCE_SHA_BINDING_FOR_MIGRATION = NOT_IMPLEMENTED
EXTERNAL_HUMAN_GATE_PER_MIGRATION_EXECUTION = NOT_IMPLEMENTED
REAL_PRODUCTION_MIGRATIONS_EXECUTED = NO (0/7 aplicadas, sin cambios desde PROJECT_STATUS_POST95.md)
REAL_CLOUD_RUN_PRODUCTION_BACKEND_DEPLOY = NO
BACKUPS_PITR_CURRENT_STATE = REQUIRES_REVALIDATION (última evidencia conocida: backups automáticos deshabilitados, sin cambios registrados desde entonces)
DB_PROVIDER_DECISION = DEFERRED (Cloud SQL actual, Neon en evaluación — sin cambios)
PRODUCTION_HUMAN_GATE = REQUIRED (para cualquier mutación real, sin excepción)
T_F1_2_ACCEPTANCE_CRITERION_MET = NO (push a main con deploy automático sin pasos manuales)
```

## Declaraciones explícitamente NO hechas por este documento

```text
T-F1.2 = COMPLETED           -> NO SE AFIRMA
PRODUCTION_READY = YES       -> NO SE AFIRMA
PRODUCTION_DEPLOYED = YES    -> NO SE AFIRMA
PRODUCTION_MIGRATED = YES    -> NO SE AFIRMA
KORIXA_APP_REMEDIATED = YES  -> NO SE AFIRMA
```

## Seguridad de esta reconciliación

```text
CODE_CHANGED_BY_THIS_DOCUMENT = NO
WORKFLOW_CHANGED_BY_THIS_DOCUMENT = NO
IAM_MUTATIONS = 0
BILLING_MUTATIONS = 0
CLOUD_SQL_MUTATIONS = 0
SECRET_MUTATIONS = 0
PRODUCTION_MUTATIONS = 0
HISTORICAL_DOCUMENTS_REWRITTEN = NO (PROJECT_STATUS.md, PROJECT_STATUS_CURRENT.md, PROJECT_STATUS_POST95.md, PROJECT_STATUS_POST98.md conservan sus textos originales — POST95/POST98 reciben únicamente una nota de supersesión agregada, sin alterar el texto preexistente)
READY = NOT_AUTHORIZED_BY_THIS_DOCUMENT
MERGE = NOT_AUTHORIZED_BY_THIS_DOCUMENT
```
