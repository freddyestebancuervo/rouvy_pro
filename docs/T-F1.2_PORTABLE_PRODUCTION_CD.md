# T-F1.2 — Portable Production CD checkpoint

## Decision boundary

- `DB_PROVIDER_DECISION = DEFERRED_TO_PRELAUNCH_GATE`
- `CURRENT_PROVIDER = CLOUD_SQL`
- `ALTERNATIVE_UNDER_EVALUATION = NEON`
- `PRODUCTION_DB_MUTATIONS_ALLOWED = NO`

The backend remains standard NestJS + PostgreSQL (`pg` and
`node-pg-migrate`). Provider selection is deliberately outside this block.

## Portable contract completed here

- Runtime uses only `DATABASE_URL`; it must never receive
  `MIGRATION_DATABASE_URL`.
- A future Production migration process must use only
  `MIGRATION_DATABASE_URL`. This block deliberately adds no
  Production-specific executor. The pre-existing generic migration commands
  are not authorized for Production; neither they nor a static environment
  literal can prove a per-run Human Gate, target identity, or source SHA.
- Contract validation reports variable names and booleans only. It never
  reports connection strings or secret values.
- The existing image remains reproducible (`npm ci`, pinned lockfile), runs as
  a non-root user, exposes `/v1/health`, and is deployed by immutable digest.
- The existing Cloud Run workflow creates a no-traffic candidate, validates
  health before traffic, and has verified rollback for subsequent deploys.

## Gates not executed

The following remain separate Human Gates: reading secret payloads, running a
Production migration, selecting/changing the PostgreSQL provider, real
Production deployment, IAM, Billing, and any Cloud SQL lifecycle/configuration
change.

After the provider decision, the next implementation step is to design a
separate migration job that binds distinct runtime and migration identities,
proves its exact target and source SHA, and uses an externally enforced Human
Gate. This document does not authorize that work.

## Status update (2026-08-31, PR #103-106 — see `PROJECT_STATUS_POST106.md`)

The `MIGRATION_DATABASE_URL`/`DATABASE_URL` contract described above is now
enforced by `backend/src/ops/privilege-reconciler.ts` itself, not just by
`production-contract.js` — it aborts before connecting if `DATABASE_URL` is
present in its own process. The privilege-reconciler and read-only inspector
were also hardened with an explicit, deny-by-default runtime privilege
matrix, a fail-closed pre/post-grant drift gate, and automatic HOLD for
`cloudsqlsuperuser` membership (direct or transitive) and any privilege the
matrix does not authorize — all proven against ephemeral/local PostgreSQL 16,
never against Development or Production.

This is still tooling, not an applied remediation: the separate migration job
described in "Gates not executed" above **remains undesigned as a workflow**,
`korixa_app`'s real Cloud Sql privileges remain unrevalidated since
`PROJECT_STATUS_POST95.md`, and no Production migration has been executed.

## Local verification

From `backend/`:

```text
npm run test:production-contract
npm run build
```

The migration command is intentionally not part of local or CI validation: it
can mutate a database and therefore requires a separate Human Gate.
