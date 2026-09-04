# Korixa — MVP FinOps and Portability Policy (Z1)

## Decision boundary

- `KORIXA_MVP_COST_POLICY = FAIL_CLOSED_ON_COST`
- `PORTABILITY_REQUIRED = YES`
- `FINAL_PRODUCTION_DB_PROVIDER_DECIDED = NO` (Task 20 remains paused; this document does not decide it)
- This document is repository policy only — it creates no cloud resource, mutates no infrastructure, and does not itself close any backlog item.

## A. Cost objectives

| Environment | Target |
|---|---|
| Local Development | $0 |
| Remote Development | $0 or near-zero |
| Staging | $0 or near-zero |
| 10-user MVP | $0 or practically $0 |

"Practically $0" means: within the free tier of every provider in use, with no fixed always-on compute or storage tier that bills regardless of traffic, unless a specific, owner-approved, demonstrated need overrides that default.

## B. User cost gates

| Milestone | Required action |
|---|---|
| 10 users | Mandatory FinOps acceptance — the cost model must be re-validated against real usage before this milestone is considered closed |
| 50 users | Measure actual infrastructure consumption against the model in this document |
| 100 users | Measure + project forward to the next milestone |
| 500 users | Full FinOps review — re-evaluate every architectural decision in this document, not just the numbers |
| 1000 users | Apply a K-COST cost-per-active-user policy (to be defined at that milestone, using real data this document cannot yet have) |

No milestone is skipped. Reaching one triggers its own review before scaling further.

## C. Fail-closed cost policy

```
NO_AUTO_PAID_UPGRADE = TRUE
NO_UNBOUNDED_AUTOSCALING = TRUE
NO_MANAGED_REDIS_MVP = TRUE
NO_NEW_CLOUD_SQL_STAGING = TRUE
PORTABILITY_REQUIRED = TRUE
CAPACITY_INCREASE_REQUIRES_HUMAN_GATE = TRUE
```

Each of these is a standing constraint, not a one-time decision:

- **NO_AUTO_PAID_UPGRADE**: no provider is used in a configuration that can silently convert a free tier into a billed one (e.g., a Postgres provider whose free tier auto-upgrades on a usage threshold without an explicit action). Where a provider cannot guarantee this (some usage-based models have no hard ceiling), that provider must be selected with awareness of the gap, and it becomes an item for D8-style monitoring, not a reason to avoid documenting the risk.
- **NO_UNBOUNDED_AUTOSCALING**: every Cloud Run service in Development/Staging/early-MVP scope must have an explicit `max_instances` ceiling. Unbounded (`max_instances` unset to a high default) is never acceptable for these environments.
- **NO_MANAGED_REDIS_MVP**: see Z2 — the in-memory throttler is sufficient while `max_instances=1`.
- **NO_NEW_CLOUD_SQL_STAGING**: Staging must not provision a new Cloud SQL instance; a scale-to-zero-capable, provider-neutral Postgres is used instead (see §D).
- **PORTABILITY_REQUIRED**: see §E.
- **CAPACITY_INCREASE_REQUIRES_HUMAN_GATE**: raising any bound documented in this policy (Cloud Run `max_instances`, introducing managed Redis, provisioning Cloud SQL for Staging, etc.) requires its own explicit, separate Human Gate — never a side effect of an unrelated change.

## D. Target architecture

**Local Development**
```
Flutter → NestJS local → PostgreSQL Docker → memory throttler
```

**Remote Development**
```
Flutter → Cloud Run (scale-to-zero, max_instances=1) → provider-neutral/free PostgreSQL → memory throttler
```

**Staging**
```
Flutter (staging flavor) → Cloud Run (min=0, max=1) → provider-neutral/free PostgreSQL → memory throttler → Firebase Auth + Firestore
```
No managed Redis. No Cloud SQL for Staging. Firebase Storage deferred (§F of the T-F1.3 provider-neutral contract; no active consumer exists).

**Early MVP**
```
Cloud Run (bounded scaling) → provider-neutral PostgreSQL → Firebase (minimum required services only) → managed Redis absent until horizontal scaling is technically justified
```

**Operational constraint on the memory throttler (all of the above)**: in-memory rate-limit state is process-local. It is correct and safe only as long as `max_instances=1` — a second concurrently-running instance would maintain its own independent counters, silently weakening the rate limit (not a security hole, since the limit would still apply per-instance, but the *effective* combined limit across instances would be higher than intended). Cloud Run's own `max_instances` setting bounds the *steady-state* instance count but does **not** mathematically guarantee that a second instance can never exist even briefly — Cloud Run can transiently run more than the configured maximum during a deployment rollout or a rapid scale event. This is why this design is classified as **an MVP operational constraint, not a permanent Production architecture**: it is an accepted, documented trade-off for a low-traffic, cost-sensitive stage, not a claim that the limit is absolute. **If `max_instances` is ever raised above 1 for Staging or any later environment, distributed throttling (managed Redis) must be reassessed and reintroduced before that change, not after.**

## E. Portability policy

| Component | Lock-in risk | Strategy |
|---|---|---|
| PostgreSQL | **LOW** (target, and already true today) | Plain `postgres://` DSN, `pg.Pool`, standard DDL only, no provider-specific extensions — verified in T-F1.3 Phase 21A/21B. Any provider (Cloud SQL, Neon, Supabase, self-hosted) is a drop-in swap of `DATABASE_URL`. |
| Backend hosting | **LOW-MEDIUM** | Container-portable: a standard Docker image with no Cloud-Run-specific code in the application itself. Only the deploy *workflow* is platform-specific; the application would run unmodified on any container platform. |
| Redis | **LOW** | Optional by design (§C), and `REDIS_URL`-compatible when used — any Redis-wire-protocol-compatible service works without code change. |
| Storage | N/A today (deferred, no active consumer) | When a real consumer is designed, a provider abstraction must be introduced at that point — never couple business logic directly to a specific storage vendor's SDK beyond the minimum needed. |
| Firebase Auth | **HIGH** | Deeply integrated (Admin SDK + client SDK); migrating away would require re-issuing credentials for every user. Blast radius is already isolated: the backend's own JWT layer (not Firebase ID tokens directly) is the actual API authorization mechanism — Firebase's role is limited to the login step. |
| Firestore | **MEDIUM** | Used for a narrow slice of data (ride sessions) rather than as the primary datastore (Postgres is). Deliberately avoid expanding Firestore's footprint into data that belongs in Postgres, to keep this risk from growing. |

## F. Production boundary

These $0 / near-zero requirements apply to **Development, Staging, and early MVP only**. They are explicitly not a mandate to run Production on the cheapest possible configuration:

- Production reliability must **not** be compromised merely to remain free.
- Any future paid infrastructure for Production requires a demonstrated need, an explicit cost model, and an owner Human Gate — the same discipline already used throughout this engagement, never a default assumption either way.
- Nothing in this document authorizes or blocks any Production architecture decision — those remain governed by their own, separate process (Task 20/T-F1.2, and the still-deferred final PostgreSQL provider decision).

## G. Current FinOps state (as of this document, certified — not invoice-proven)

- **Production Memorystore Redis (`korixa-production-redis`)**: DELETED (Z0A, 2026-09-03). Proven zero active consumers before deletion (no Cloud Run/Compute/GKE/App Engine/Cloud Functions existed anywhere in the project). Data was rate-limit-state only, non-durable, trivially recreatable.
- **Production Cloud SQL (`korixa-production-postgres`)**: STOPPED, not deleted (Z0B, 2026-09-03) — `activationPolicy=NEVER`. Tier, storage, backups, and PITR all remain unchanged and intact; only compute billing stops. Fully reversible in minutes via `activationPolicy=ALWAYS`.
- **Estimated Production fixed compute savings**: approximately US$83-93/month combined from Z0A + Z0B, estimated from GCP public list pricing — **not invoice-proven**, no billing/Cost Table access was available to confirm actual billed amounts.
- **Production Cloud SQL storage/backups remain** and continue to accrue a small residual cost (~$1-2/month estimated) while stopped.
- **Development Cloud SQL** (`ridepro-backend-dev-pg`) remains running as-is — its replacement with a scale-to-zero-capable Postgres provider is a separate, later migration (tracked outside this document, pending its own proof-of-concept and Human Gate).
- **Task 20** (T-F1.2, Production DB role hardening) remains **PAUSED** — untouched by this document and by the Z0/Z1/Z2 work.
