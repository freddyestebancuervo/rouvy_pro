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
| 1000 users | Apply / revalidate the already-approved K-COST policy (below) with real data from actual usage at this milestone |

No milestone is skipped. Reaching one triggers its own review before scaling further.

### K-COST — cost per active user per month (owner-approved, defined now)

This is not deferred to the 1,000-user milestone — it is owner-approved policy today. What happens *at* the milestone is applying it against real measured data, never redefining it.

| Band | Threshold |
|---|---|
| `TARGET` | ≤ COP 1,000 per active user per month |
| `REVIEW_BAND` | COP 1,000-1,500 per active user per month — triggers an explicit architecture/cost review, not an automatic action |
| `REDESIGN` | > COP 1,500 per active user per month — triggers a mandatory redesign before further user growth is accepted |

`K-COST` is evaluated starting at the 1,000-user milestone (§B), using real, measured infrastructure spend divided by real active users for that period — never projected or estimated figures once real data exists.

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

- **NO_AUTO_PAID_UPGRADE**: for Development, Staging, and early MVP, a provider/configuration that can automatically generate paid usage after a free quota is exhausted is **not allowed by default**. Monitoring or billing alerts alone do **not** satisfy this requirement — an alert firing after spend has already started does not prevent the surprise bill this policy exists to avoid. An acceptable default configuration must have at least one of:
  - a hard spend cap enforced by the provider itself;
  - a free-only account/project tier that stops serving requests rather than billing once its quota is exhausted;
  - a provider-enforced usage ceiling (not merely a documented soft limit);
  - no payment method / no paid fallback on file, where the provider supports operating that way.

  If none of these is technically possible for a given provider, adopting it anyway requires its own separate, explicit Owner Human Gate — not a decision made inside this policy document or inside any implementation task — documenting: the exact residual billing risk, the maximum technically possible exposure if it can be determined, the safeguards actually in place, and the reason every hard-capped alternative was rejected. **No such exception is approved by this document.** This policy does not certify that any specific provider (Neon, Supabase, or otherwise) currently satisfies `NO_AUTO_PAID_UPGRADE` — that must be proven against the provider's actual account/tier behavior during the disposable proof-of-concept step (Phase Z3) before it is relied upon, not assumed from general reputation or marketing claims. Provider selection itself remains deferred (§Goal 5 of the prior FinOps audit, and this document does not change that).
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
