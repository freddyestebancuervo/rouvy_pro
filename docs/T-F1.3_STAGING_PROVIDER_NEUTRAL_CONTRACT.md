# T-F1.3 — Staging provider-neutral contract (Phase 21B)

## Decision boundary

- `STAGING_DB_PROVIDER_DECISION = DEFERRED`
- `FINAL_PRODUCTION_DB_PROVIDER_DECISION = DEFERRED`
- `D8_STAGING_POSTPONEMENT_UNRECONCILED = YES`
- `STAGING_MUTATIONS_ALLOWED = NO`

This document formalizes the provider-neutral portion of T-F1.3 ("Entorno de
staging real") only. It creates no cloud resource of any kind.

A prior owner decision (Documento 15 §D8, reconfirmed 2026-08-03 in
`docs/audits/AUDITORIA_FINAL/23_MATRIZ_FORMAL_ENTORNOS.md`, matrix row 16 and
MR5) deliberately postponed all Staging resource creation until Development
is fully complete. As of that same document's own 10-gate audit, Development
is not yet complete (Puertas B, E and H unmet). This postponement is **not**
resolved by this document — it is a separate, unrecociled owner decision.
Nothing in this file authorizes creating the Staging environment; it only
prepares the code/config/workflow layer so that, once D8 is reconciled and a
DB placement is chosen, the remaining work is mechanical rather than a
redesign.

## Backend staging contract (already implemented, verified here)

The backend's environment/DB/Redis/CORS layer was already provider-neutral
and staging-aware before this task — verified, not assumed:

- `BACKEND_ENVIRONMENT=staging` already fails closed if `REDIS_URL` is
  absent (`redis.config.ts`, `resolveThrottlerStrategy` — Development's
  in-memory throttler fallback is hard-restricted to
  `BACKEND_ENVIRONMENT=development` only, by exact string match; any other
  value, including `staging`, `production`, unset, or unknown, throws).
  Already covered by `redis.config.spec.ts` casos 4-7.
- `DATABASE_URL` is a plain `postgres://` DSN consumed by `pg.Pool` — no
  Cloud SQL, RDS, or any other provider is assumed anywhere in
  `database.config.ts`. Newly covered by `database.config.spec.ts` (this
  task — no spec existed for this file before).
- `MIGRATION_DATABASE_URL` is a structurally separate identity:
  `createDatabasePool()` never reads it (proven by a dedicated test in
  `database.config.spec.ts`).
- `FIREBASE_PROJECT_ID` is env-driven, never hardcoded — a staging value can
  be supplied once a real Firebase staging project exists, with zero code
  change.
- `CORS_ALLOWED_ORIGINS` is env-driven and fails closed (`origin: false`)
  when `NODE_ENV=production` (the value the built Docker image always
  carries, regardless of which GCP environment it's deployed to) and no
  allowlist is configured.

No code change was required for this section — it is documented here so the
staging contract is discoverable in one place, and so a future change to
this behavior must consciously update this document.

## Database portability contract

| Field | Value |
|---|---|
| `DATABASE_ENGINE` | PostgreSQL |
| `DATABASE_MAJOR_VERSION` | 16 (matches Development and Production; no migration uses a version-16-specific or extension-dependent feature) |
| `RUNTIME_DSN_ENV` | `DATABASE_URL` |
| `MIGRATION_DSN_ENV` | `MIGRATION_DATABASE_URL` |
| `RUNTIME_IDENTITY_DISTINCT_FROM_MIGRATION_IDENTITY` | REQUIRED — enforced structurally: `createDatabasePool()` only ever reads `DATABASE_URL` |
| `TLS_SUPPORTED` | YES — opt-in via `DATABASE_SSL=true` (`rejectUnauthorized:false`, the standard `pg` pattern for managed Postgres whose CA isn't in Node's default trust store) |
| `APPLICATION_CONNECTION_LAYER` | `pg.Pool` (no ORM, no external connection pooler) |
| `MIGRATION_ENGINE` | `node-pg-migrate` — all 7 existing migration files are portable, standard PostgreSQL DDL; `gen_random_uuid()` is PG13+ core, deliberately avoiding `CREATE EXTENSION` (which Cloud SQL restricts to `cloudsqlsuperuser`) |
| `EXTERNAL_POOLER_REQUIRED` | NO |
| `CURRENT_POOL_DEFAULT` | `DATABASE_POOL_MAX` defaults to 10 (`database.config.ts`), configurable via env var |
| `BACKUP_RESTORE_CAPABILITY_REQUIRED` | YES — see next section |
| `PROVIDER_SPECIFIC_CONTROL_PLANE` | ADAPTER / INFRASTRUCTURE LAYER ONLY — never in application code. Task 20/T-F1.2's ephemeral-hardener orchestration (WIF-authenticated Cloud Run Jobs, Cloud SQL Admin API role assignment) is Production-only infrastructure tooling, entirely outside this contract; Staging does not need it to have a functional database |

No provider is named as mandatory anywhere in this table.

## Backup / restore capability contract

Minimum capability requirements — not a provider implementation, and not a
choice of retention numbers (none of that is owner-approved yet):

- Automated backup support: REQUIRED, mechanism left to the eventual
  provider/adapter.
- Point-in-time recovery, or an explicitly documented equivalent capability:
  REQUIRED.
- A tested restore path: REQUIRED before Production ever depends on this
  contract — restoring a Staging database from backup must be exercised and
  verified at least once before T-F1.3 is declared closed.
- Backup data must be environment-scoped: a Staging backup must never
  contain, and must never be restorable into, Production. No Production data
  may be copied into Staging by default, ever, for any reason including
  convenience.
- Retention: must be configurable, not hardcoded into application code or
  this contract. Exact values are an infrastructure/provider decision, not
  decided here.
- Encryption in transit and at rest: REQUIRED (matches `TLS_SUPPORTED` above
  for transit; at-rest encryption is expected to be the provider's default,
  verified when the provider is selected).
- A restore validation procedure must exist and be exercised before T-F1.3
  closes — this is an acceptance-criterion-level gate, not optional
  documentation.

## Flutter staging entrypoint — blocked, contract documented

Phase 21A found `BACKEND_ENVIRONMENT` already staging-aware at the backend,
but no Flutter-side staging entry point. Investigation in this task
(Phase 21B) confirms why none was added now:

- `AppEnvironment` (`lib/core/config/app_environment.dart`) has no default
  constructor and requires `firebaseOptions: FirebaseOptions` as a
  non-nullable, required field.
- `environment_development.dart` satisfies this by importing the real,
  FlutterFire-generated `firebase_options_development.dart`.
- No `firebase_options_staging.dart` exists, and none was created — doing so
  by hand, or fabricating a Firebase project ID/app ID/API key/sender ID to
  make one compile, is explicitly forbidden.

Therefore:

```
STAGING_FLUTTER_ENTRYPOINT_IMPLEMENTED = NO (BLOCKED_BY_REAL_RESOURCE_ID)
STAGING_ENVIRONMENT_CONFIG_IMPLEMENTED = NO (BLOCKED_BY_REAL_RESOURCE_ID)
FAKE_FIREBASE_VALUES_INTRODUCED = NO
```

**Exact future contract**, so this becomes mechanical once a real Firebase
Staging project exists (Phase 21C, its own Human Gate):

1. `flutterfire configure` (or equivalent, run by whoever holds the real
   project credentials) generates `lib/firebase_options_staging.dart` —
   never hand-written.
2. `lib/core/config/environments/environment_staging.dart` is added,
   mirroring `environment_development.dart` exactly: imports the real
   generated file, sets `name: 'staging'`, and a real
   `stagingBackendUrl` pointing at the (then-existing) staging Cloud Run
   service.
3. `lib/main_staging.dart` is added, mirroring `main_development.dart`
   exactly: `Future<void> main() => bootstrapRideProApp(stagingEnvironment);`
4. `.firebaserc` gains a `"staging": "<real-project-id>"` entry — never a
   placeholder.

No part of this contract requires any change to `AppEnvironment`'s shape.

## Staging workflow architecture

`.github/workflows/backend-deploy-staging.yml` is added as a **mechanically
inert skeleton**:

- `workflow_dispatch` only, `permissions: contents: read` only (no OIDC
  token permission — there is no authentication step to use one).
- No `environment:` reference (the GitHub Environment `staging` does not
  exist; creating it is out of this task's scope).
- No `google-github-actions/auth` step, no `gcloud`/`docker`/`firebase`
  command anywhere in the file.
- Its only job always fails explicitly (`exit 1`) with a message naming the
  exact missing Human Gates (D8 reconciliation, Phase 21C/D/E resource
  provisioning).
- Contains zero identifiers — project ID, project number, WIF provider,
  service account, Cloud Run service name, Cloud SQL instance name — from
  either Production or Development. Verified by
  `backend/src/ops/staging-workflow-contract.spec.ts`, which checks this
  automatically against every known real identifier from both environments'
  actual workflows.

Dispatching this workflow today does nothing but fail with an explanatory
message — it cannot reach any cloud resource.

## Gates not executed by this document or this task

The following remain separate, future Human Gates:

- Reconciling D8 (does T-F1.3's own no-owner-authorization backlog entry
  supersede D8's Staging-postponement decision, or does D8 still control?).
- Creating any real resource: GCP/Firebase project, Cloud Run service,
  PostgreSQL instance/database, Redis instance, Secret Manager secrets, WIF
  provider, IAM bindings, VPC/network resources.
- Selecting the Staging PostgreSQL placement (reuse Development's Cloud SQL
  instance via a new logical database, vs. a separate managed Postgres
  provider) — see Phase 21A's Goal 7 analysis.
- Selecting the final Production PostgreSQL provider.
- Filling in this workflow skeleton with a real build/push/deploy job.
- Generating `firebase_options_staging.dart` and the Flutter entry
  point/environment files described above.
