# Korixa — Evidencia Operativa POST-98 (PR #97 → PR #102)

> **Documento separado, sucesor de `PROJECT_STATUS_POST95.md`.** `PROJECT_STATUS_CURRENT.md` conserva el corte reconciliado en PR #95 y no se reescribe. `PROJECT_STATUS_POST95.md` conserva su corte original (PR #96 + evidencia live posterior a #96) y tampoco se reescribe. Este archivo registra únicamente hechos posteriores a ese corte, hasta PR #102 inclusive.

## Identidad del snapshot

```text
DATE = 2026-08-28
SCOPE = PR #97 -> PR #102
BASELINE_DOCUMENT = PROJECT_STATUS_POST95.md
BASELINE_CUTOFF = PR #96 + evidencia live post-96
MAIN_SHA_AT_THIS_CUTOFF = cffa17b82de1c76a799e3194890ff4bc8a525fa6
LAST_MERGED_PR_WITHIN_SCOPE = #102
T_F1_2_OVERALL = IN_PROGRESS
T_F1_2_PORTABLE_CONTRACT = COMPLETED
```

La cadena real de `main` en este rango (por padres de merge, no por número de PR):

```text
PR #96  -> 21d52328297d0cf8eca003d0a24deda9f2e8cfdf
PR #97  -> 37dfd2ec05234b2b2fb48578b86e868c6803244c
PR #98  -> abd9cc2... (docs: record POST-95 Production evidence)
PR #99  -> (docs: fix stale D2 and changelog references)
PR #100 -> (ci(backend): enforce lint and typecheck in required CI)
PR #101 -> cdf6688... (fix(security): sanitize QA credentials and historical audit claims)
PR #102 -> cffa17b82de1c76a799e3194890ff4bc8a525fa6 (ci(production): add portable database contract guards)
```

---

## COMPLETADO en este rango

### PR #97 — sincronización documental hasta PR #95
Fusionó `PROJECT_STATUS_CURRENT.md` (el snapshot reconciliado PR #1→#95). Trabajo exclusivamente documental.

### PR #98 — evidencia operativa POST-95
Agregó `PROJECT_STATUS_POST95.md`, registrando la corrección del contrato booleano de PR #96, el preflight live de metadatos de Production (`32913572256`, `PASS`), la primera ejecución real que alcanzó el Cloud Run Job inspector (run `32913902787`, guard→precheck→publish→deploy del Job todos `PASS`, la ejecución del Job en sí `FAILED`), y una ejecución posterior exitosa del inspector (`korixa-production-db-readonly-inspector-7t8ks`, `succeededCount=1`) cuyo JSON de salida confirmó `MIGRATION_TRACKING=CONSISTENT_0_OF_7_APPLIED` y `PHYSICAL_SCHEMA=CLEAN`, pero cuya disposición final fue `HOLD_ROLE_PRIVILEGE_ESCALATION` — ver sección "Hallazgo preservado" más abajo. Trabajo exclusivamente documental; cero mutaciones de PR #98 en sí.

### PR #99 — correcciones documentales menores
`CHANGELOG.md`, `ROADMAP_M0_M1.md`, `VERIFICATION_GUIDE.md` — referencias obsoletas de D2 y del changelog corregidas. No toca el estado de `T-F1.2`.

### PR #100 — endurecimiento de CI (no Production)
`ci(backend): enforce lint and typecheck in required CI` — agrega verificación de lint/typecheck del backend como parte del job requerido existente. No es un cambio de infraestructura ni de Production.

### PR #101 — higiene de secretos
`fix(security): sanitize QA credentials and historical audit claims` — saneamiento de credenciales QA y correcciones de auditoría histórica. No toca `T-F1.2` ni Production.

### PR #102 — contrato portable de Production DB (`T_F1_2_PORTABLE_CONTRACT = COMPLETED`)
Agrega `docs/T-F1.2_PORTABLE_PRODUCTION_CD.md` (documento de referencia — ver enlace en `PROJECT_STATUS_CURRENT.md` y en `README.md`) y aplica en código/CI:

- el runtime usa exclusivamente `DATABASE_URL`; nunca `MIGRATION_DATABASE_URL`;
- ninguna migración de Production se autoriza todavía mediante los comandos genéricos existentes ni mediante un literal de entorno estático — ninguno de los dos puede probar un Human Gate por ejecución, identidad de destino, ni SHA de origen;
- validación de contrato (`backend/scripts/production-contract.js`, `validate-production-contract.js`) integrada al job de backend ya requerido en CI; reporta únicamente nombres de variable y booleanos, nunca cadenas de conexión ni valores de secreto;
- decisión de proveedor PostgreSQL (`Cloud SQL` actual vs. `Neon` en evaluación) explícitamente diferida a un Human Gate previo al lanzamiento.

```text
PR_102 = MERGED
PR_102_MERGE_SHA = cffa17b82de1c76a799e3194890ff4bc8a525fa6
PR_102_FILES_CHANGED = 7
PR_102_PRODUCTION_MUTATIONS = 0
PR_102_CHECKS_SUCCESSFUL = 5
```

**Corrección explícita respecto a los checks:** los 5 checks exitosos observados en el merge commit (`Flutter — analyze + test`, `Firestore — reglas de seguridad (A3/A5)`, `Backend — migración + e2e (C2)`, `Backend — docker build (sin push, sin GCP)`, `Night Agent — security + test`) **no son, todos, checks requeridos por branch protection**. Verificado en vivo contra la protección de rama actual de `main` (`PROVEN_BY_LIVE_READ_ONLY`, 2026-08-28):

```text
REQUIRED_STATUS_CHECKS_CURRENT = [
  "Flutter — analyze + test",
  "Firestore — reglas de seguridad (A3/A5)",
  "Backend — migración + e2e (C2)",
  "Night Agent — security + test"
]
REQUIRED_STATUS_CHECKS_COUNT = 4
"Backend — docker build (sin push, sin GCP)" = SUCCESSFUL_BUT_NOT_CURRENTLY_REQUIRED
```

---

## Hallazgo preservado sin revalidar — `ROLE_PRIVILEGE_MODEL`

`PROJECT_STATUS_POST95.md` §5 registró, con evidencia live fechada (~2026-08-26), que el rol de base de datos `korixa_app` tenía `CREATEROLE`/`CREATEDB` inesperados y membresía directa en `cloudsqlsuperuser`, con disposición `HOLD_ROLE_PRIVILEGE_ESCALATION`. Ese hallazgo **se preserva aquí sin modificarlo, sin repetirlo como si fuera nuevo, y sin volver a afirmarlo como estado actual**:

```text
ROLE_PRIVILEGE_MODEL = HOLD
ROLE_PRIVILEGE_MODEL_EVIDENCE_DATE = ~2026-08-26
ROLE_PRIVILEGE_MODEL_EVIDENCE_SOURCE = PROJECT_STATUS_POST95.md §5, inspección live real (run del inspector `korixa-production-db-readonly-inspector-7t8ks`)
CURRENT_REVALIDATION = REQUIRED
```

Ninguna acción registrada entre PR #97 y PR #102 tocó IAM, roles de base de datos, ni Cloud SQL de Production — no existe evidencia, ni a favor ni en contra, de que este hallazgo haya cambiado desde su fecha original. **No se afirma que `korixa_app` siga hoy sobre-privilegiado** — se afirma únicamente que el último estado *conocido y evidenciado* fue `HOLD`, y que ese estado requiere una nueva inspección live antes de tratarse como resuelto o como vigente.

---

## PENDIENTE (sin cambios de fondo en este rango, salvo lo ya indicado arriba)

```text
ROLE_PRIVILEGE_MODEL_REVALIDATION = REQUIRED
MINIMUM_EFFECTIVE_DB_PRIVILEGE_FOR_MIGRATIONS = NOT_PROVEN
DB_PROVIDER_DECISION = DEFERRED_TO_PRELAUNCH_GATE (CLOUD_SQL actual, NEON en evaluación)
SEPARATE_MIGRATION_JOB = NOT_DESIGNED
RUNTIME_IDENTITY_VS_MIGRATION_IDENTITY = NOT_SEPARATED_AT_EXECUTION_LEVEL
TARGET_AND_SOURCE_SHA_BINDING_FOR_MIGRATION = NOT_IMPLEMENTED
EXTERNAL_HUMAN_GATE_PER_MIGRATION_EXECUTION = NOT_IMPLEMENTED
REAL_PRODUCTION_MIGRATIONS_EXECUTED = NO (0/7 aplicadas, última evidencia PROJECT_STATUS_POST95.md)
REAL_CLOUD_RUN_PRODUCTION_BACKEND_DEPLOY = NO
CLOUD_SQL_AUTOMATED_BACKUPS = DISABLED (sin cambios desde su primer registro)
VPC_EGRESS_MODE_DECISION = PENDING (private-ranges-only vs all-traffic)
GITHUB_ENVIRONMENT_PRODUCTION_REQUIRED_REVIEWER = NOT_CONFIGURED
T_F1_2_ACCEPTANCE_CRITERION_MET = NO (push a main con deploy automático sin pasos manuales)
```

## Declaraciones explícitamente NO hechas por este documento

```text
T-F1.2 = COMPLETED        -> NO SE AFIRMA
PRODUCTION_READY = YES    -> NO SE AFIRMA
PRODUCTION_DEPLOYED = YES -> NO SE AFIRMA
PRODUCTION_MIGRATED = YES -> NO SE AFIRMA
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
HISTORICAL_DOCUMENTS_REWRITTEN = NO (PROJECT_STATUS.md, PROJECT_STATUS_CURRENT.md, PROJECT_STATUS_POST95.md conservan sus cortes originales, sin editar)
READY = NOT_AUTHORIZED_BY_THIS_DOCUMENT
MERGE = NOT_AUTHORIZED_BY_THIS_DOCUMENT
```
