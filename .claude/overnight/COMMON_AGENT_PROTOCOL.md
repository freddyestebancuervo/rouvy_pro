# Common Agent Protocol (Task 2, 2026-08-23; Task 3, 2026-08-23)

A single-chat, four-role coordination protocol for `NIGHT` (orchestrator),
`A` (executor), `B` (independent adversarial auditor), and `C` (validator/
certifier). Codifies, as tested code, the same discipline this repository's
own recent history (PR #73's three independent audit rounds; PR #74's
Night→A→B→C sequence) already followed by hand, across explicit role
switches in one conversation — so future tasks don't have to re-derive it
from a long prose instruction each time.

```
SINGLE_CHAT         = TRUE   -- one conversation, sequential role switches
SUBAGENTS_REQUIRED  = FALSE  -- no `Agent`/subagent ever simulates A/B/C
A = EXECUTOR   -- implements; can never self-certify (SelfCertificationForbiddenError)
B = AUDITOR    -- independently audits A's delta; the only role that can CERTIFY_AUDIT
C = VALIDATOR  -- independently validates B's attested result; the only role that can CERTIFY_TECHNICAL_PASS
```

**A technical PASS from C is never equivalent to human authorization.**
`requiresHumanGateForAction` (role-protocol.mjs) and
`HUMAN_GATE_ONLY_CAPABILITIES` (role-capabilities.mjs, Task 3) both apply
unconditionally, for every role including NIGHT — marking Ready, merging,
and any Production/IAM/secret/destructive action always require a human,
outside this protocol, outside this chat.

**Code**: `tools/night-agent/protocol-state.mjs` (shared-state schema +
atomic persistence), `tools/night-agent/role-protocol.mjs` (role/state
machine, handoff contract, evidence binding, human gates), and
`tools/night-agent/role-capabilities.mjs` (Task 3 — the CAPABILITY MODEL: a
closed, fail-closed `evaluateRoleCapability(role, capability)` answering
"may this role attempt this action", separate from role-protocol.mjs's
"is this state transition legal"). **Tests**:
`tools/night-agent/test/protocol-state.test.mjs`,
`tools/night-agent/test/role-protocol.test.mjs`,
`tools/night-agent/test/role-capabilities.test.mjs` (104 tests total).

**Status: MACHINE_ENFORCED_PRIMITIVE, not RUNTIME_WIRED_ENFORCEMENT.** These
are tested, correct functions a caller can invoke to get a real, fail-closed
decision — but nothing in this repository currently *requires* an agent to
invoke them while actually role-switching (there is no orchestrator file
this is wired into, unlike e.g. `command-safety.mjs`'s real wiring into
`runner.mjs`). An independent audit of this exact question (B, Round 1)
confirmed no repository evidence proves otherwise. This is Task 2's own
stated scope — wiring into a real runner is explicitly future work, not
overclaimed here as already done.

**Round 1 remediation (B audit → 2×P0, 2×P1, 1×P2, all fixed here):** a
zero-width-Unicode identity-collision self-certification bypass, a
malformed-finding-severity silent-non-blocking bypass, a malformed-evidence
silent-coercion inconsistency, a cross-process WeakSet-attestation
operability dead-end, and an underclaimed "cannot enforce B/C mutation"
limitation. See the sections below — each carries the exact finding it
closes in its own code comment (`grep -n "B audit Round 1"` in
`role-protocol.mjs` finds all five).

## Why two new files instead of reusing Task 1's modules directly

`claim-taxonomy.mjs` and `command-safety.mjs` are imported and used
**verbatim** — their taxonomies are already role-agnostic and match this
protocol's own requirements exactly (see `role-protocol.mjs`'s imports).
`executor-auditor-gate.mjs`'s 2-role (Executor≠Auditor) pattern and
`evidence-policy.mjs`/`red-team-gate.mjs`'s WeakSet-attestation pattern are
the direct conceptual ancestors of this protocol's `certifyAuditResult`/
`certifyByValidator` — but Task 2 needs a 4-role machine with SHA-bound
certification C never had a reason to need before, so the pattern is
**reimplemented locally**, not imported, so that changing one can never
silently change the other's already-independently-audited security
behavior. `checkpoint.mjs`'s atomic-write/closed-schema/fail-closed-read
pattern is the direct model for `protocol-state.mjs`'s persistence layer,
same reasoning. Zero existing Task 1 file was modified by this task.

## Task 3 — the capability model (`role-capabilities.mjs`)

Task 2 answers "which STATE moves are legal for which role" (`VALID_ROLE_TRANSITIONS`,
`STATE_TRANSITION_TABLE`). Task 3 answers a separate, narrower question:
"which ACTIONS may this role attempt at all" — a closed, testable
capability vocabulary (`CAPABILITIES`, 17 names) checked via
`evaluateRoleCapability(role, capability)` / `isRoleAllowed(role, capability)`,
fail-closed on unknown role, unknown capability, or any malformed input
(never throws; always returns `{allowed:false, reason:...}` on anything not
exactly a valid `ROLES`/`CAPABILITIES` string — no trim, no case-fold, no
Unicode normalization, exactly `role-protocol.mjs`'s own post-Round-1
exact-membership identity discipline, reused by design).

A closed **allowlist** (`ROLE_CAPABILITIES`, a `Map` — never a plain object,
so no prototype-chain surface exists for an attacker-controlled role
string), not a blacklist:

| Role | Capabilities |
|---|---|
| `NIGHT` | `READ` only — pure orchestrator, never executes/audits/validates |
| `A` | `READ`, `WRITE_TASK_FILES`, `RUN_PRIMARY_TESTS`, `COMMIT_TASK_BRANCH`, `PUSH_TASK_BRANCH` |
| `B` | `READ`, `RUN_ADVERSARIAL_TESTS`, `AUDIT`, `CREATE_FINDING`, `CERTIFY_AUDIT` |
| `C` | `READ`, `VALIDATE`, `CERTIFY_TECHNICAL_PASS` |

Six capabilities (`MARK_READY`, `MERGE_MAIN`, `PRODUCTION_MUTATION`,
`IAM_MUTATION`, `SECRET_MUTATION`, `DESTRUCTIVE_OPERATION`) are never in
*any* role's row and are refused unconditionally, before a role's row is
even consulted (`HUMAN_GATE_ONLY_CAPABILITIES`) — the invariant "no role
reaches these without a human gate" holds structurally, not by a
special-case veto that a future edit could accidentally weaken.

This closes every invariant Task 3 named as required-impossible:
`A→CERTIFY_AUDIT`/`CERTIFY_TECHNICAL_PASS`, `B→WRITE_TASK_FILES`/
`COMMIT_TASK_BRANCH`/`CERTIFY_TECHNICAL_PASS`, `C→WRITE_TASK_FILES`/
`CERTIFY_AUDIT`/`COMMIT_TASK_BRANCH` are all simply absent from the
relevant role's row — there is no code path that could grant them, not a
check that blocks them after the fact.

**Classification**: `MACHINE_ENFORCED_PRIMITIVE`, not
`RUNTIME_WIRED_ENFORCEMENT` — same disclosure as Task 2's own primitives;
nothing in this repository's real execution path currently calls
`role-capabilities.mjs`. "A role cannot physically attempt a denied
action" remains `PROCEDURAL_ENFORCED_BY_POLICY` for the same reason
documented below for role-protocol.mjs: no OS/tool-permission boundary
exists between roles in the single-chat model.

**Out of scope for Task 3** (named explicitly, deferred to Task 4): the
locks/queue/shared-task-orchestration system for concurrent multi-task
execution. `role-capabilities.mjs` answers "may this role attempt X",
never "is this role currently allowed to given what else is in flight".

## Flow

```
NIGHT → A → B ─┬─→ C → HUMAN_GATE
               └─(HOLD)→ A (remediation) → B (re-audit) → …
```

- `NIGHT` may coordinate, classify risk, assign the active role, detect
  drift/timeout, and place a task in `HOLD`. It may never act as executor
  and certify itself, override B/C findings, or bypass a human gate.
- `A` (executor) may implement, run primary validation, commit/push its own
  task branch. Its maximum result is `IMPLEMENTED_AND_VALIDATED` —
  `finalizeExecutorResult` structurally cannot return anything PASS-shaped
  (`FINAL_PASS`/`AUDIT_PASS`/`SAFE_TO_MERGE` are not in its output domain at
  all; requesting one throws `SelfCertificationForbiddenError`).
- `B` (auditor) is read-only by default, distrusts A's own claims, reviews
  `BASE_SHA..HEAD_SHA` (or `OLD_HEAD..NEW_HEAD` after a small remediation —
  full re-audit only for P0/P1, a security-boundary change, or a
  Production-impacting change). `certifyAuditResult` is the only function
  able to grant a PASS-shaped auditor result, and only when the auditor
  identity is a genuinely distinct **canonical role identifier** from the
  executor identity — `executorRole`/`auditorRole` must each be an EXACT
  member of `ROLES` (`'NIGHT'|'A'|'B'|'C'`), not a fuzzily-normalized
  free-form string. (Round 1: the original design trim/case-folded
  free-form identities, mirroring `executor-auditor-gate.mjs`'s own rule —
  appropriate there, where identities are open-ended session strings, but
  wrong here, where the identity space is a genuinely closed 4-value
  vocabulary. A zero-width space appended to `'A'` defeated the fuzzy
  normalizer live; exact closed-set membership closes the whole class
  structurally, the same lesson `command-safety.mjs`'s own blacklist→
  whitelist rewrite already taught this project.) No finding may be
  blocking-and-unnoticed (a P0/P1 blocks by default even if `blocking` is
  omitted; any severity outside `FINDING_SEVERITIES` forces
  `HOLD_MALFORMED_FINDING_SEVERITY` rather than silently never blocking —
  Round 1 closed a live reproduction where a typo'd severity like `'p0'`
  certified PASS on what was meant to be a real P0). Malformed `findings`
  **or** `evidence` shape (present but not an array) forces HOLD rather than
  silently discarding the payload (Round 1: `evidence` used to be coerced
  to `[]`, inconsistent with `findings`' own already-correct handling).
  Every evidence claim clears `claim-taxonomy.mjs`'s existing
  UNPROVEN+production-impact fail-closed rule. Every result — PASS **or**
  HOLD — is attested into a module-private `WeakSet` so C can trust it was
  genuinely produced **in the same live process**, not hand-typed — see
  "Attestation vs. persistence" below for what happens once that process
  exits.
- `C` (validator) is read-only, lightweight, and does not redo A's or B's
  work. `certifyByValidator` is the only function able to certify a task
  ready for the human gate, and refuses unless: the auditor result is
  genuinely attested (not a shape-alike fabrication — `isAttestedAuditorResult`
  checks WeakSet membership, so even a byte-identical spread-copy fails);
  that result's own bound `headSha` equals the CURRENT head C itself
  observes (HEAD drift since the audit ⇒ `HOLD_HEAD_DRIFT_SINCE_AUDIT`); CI
  evidence is bound to that SAME exact head (`HOLD_CI_SHA_MISMATCH` if not,
  `WAITING_CI` — never silently treated as success — if CI hasn't finished);
  and the audit's own `finalState` is itself PASS-shaped
  (`HOLD_UNRESOLVED_BLOCKER` otherwise — C can never certify around an open
  blocker).
- **Final operator gate**: `requiresHumanGateForAction('MARK_READY'|'MERGE'|...)`
  is unconditionally `true` for every recognized action type, with **no**
  second parameter of any kind a caller could use to bypass it — even a
  clean C `PASS` never implies authorization to mark Ready or merge.

## Attestation vs. persistence (Round 1 P1 fix)

`WeakSet` attestation is **live-process-only, by design, and this is never
weakened**: a serialized/spread-copied/otherwise-reconstructed object is
never automatically trusted, no matter how closely it matches a real
result's shape. Round 1's audit reproduced, across two genuinely separate
Node processes, the direct consequence this created: a *legitimate* B
result — really produced, really persisted via `protocol-state.mjs`'s own
atomic-write mechanism (itself modeled on `checkpoint.mjs`'s
restart-recoverable pattern) — loses its live attestation the instant the
producing process exits, and `certifyByValidator` reported the same
`HOLD_AUDIT_RESULT_NOT_ATTESTED` for that case as for outright fabrication,
with no path forward.

The fix does not touch the security invariant — it adds a **named recovery
path** on top of it:

- `classifyAuditorResultTrust(candidate)` returns `'LIVE_ATTESTATION'`
  (real, trusted), `'PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION'`
  (shape-plausible — has every field a real result always has — but not
  live-attested; consistent with, never proof of, having crossed a process
  boundary), or `'UNRECOGNIZED'` (not even shape-plausible). This
  classification **never grants trust by itself** — it only gives `NIGHT`/`C`
  an actionable routing signal instead of a dead end.
- `certifyByValidator` reports the specific `HOLD_AUDIT_ATTESTATION_EXPIRED`
  reason for the shape-plausible case (vs. the generic
  `HOLD_AUDIT_RESULT_NOT_ATTESTED` for genuine garbage) — same refusal
  either way, more actionable reason.
- `STATE_TRANSITION_TABLE` now allows `NIGHT` to route a `HOLD` directly to
  `READY_FOR_B` (skipping `A`, which has no remediation work to do for an
  expired attestation) — the existing `A`-remediation path
  (`HOLD → REMEDIATING`) remains valid too, for genuine remediation HOLDs.
- **Re-attestation is not a new function** — it is `certifyAuditResult`
  called again, for real, by B, observing the *current* actual head and
  *current* actual findings/evidence. There is no `attest(serializedObject)`
  function anywhere in this module, and there must never be one: that would
  be exactly the "serialized JSON becomes automatically trusted" outcome
  this whole design refuses to allow. No home-grown cryptography/HMAC was
  introduced either — this project has no existing trust root such a
  scheme could anchor to, and inventing one was explicitly out of scope for
  this remediation.

Both properties are tested end-to-end in `role-protocol.test.mjs`:
**security** (a round-tripped or hand-fabricated result can never directly
pass `C`, regardless of shape-plausibility) and **operability** (the
explicit recovery path — expired → `NIGHT` routes to `READY_FOR_B` → B
re-attests for real → `C` then certifies — genuinely works).

## Consumption controls (formal part of the protocol, not just a norm)

- `NO_FULL_REPO_REAUDIT` by default: B reviews `BASE_SHA..HEAD_SHA`; after a
  small remediation, `OLD_HEAD..NEW_HEAD` (the HOLD→remediation→re-audit
  loop test in `role-protocol.test.mjs` demonstrates this against a fresh
  `headSha`, not the whole original scope).
- C never reruns A's or B's heavy work — `certifyByValidator` takes B's
  *already-attested* result and cross-checks SHA/CI binding only.
- `EVIDENCE`/`FINDINGS` in the shared state are compact reference objects
  (claim id, severity, one-line summary), never raw command output or full
  logs — enforced structurally by `protocol-state.mjs`'s closed field set,
  which has no field shaped for a large blob.
- `classifyCiWaitStatus` returns `WAITING_CI` for anything not `completed`,
  with **no** polling logic inside it — a pure classifier cannot itself
  prevent a caller from polling in a loop; that discipline is procedural
  (see "Not machine-enforced" below), the same way it was procedural
  throughout this repository's own PR #73/#74 history (a single `gh pr
  checks` read, or one bounded background wait, never a sleep loop).
- No subagents: this protocol assumes and requires the single-chat,
  role-switching model the brief specifies. Nothing in either module spawns
  a process, a subagent, or performs any I/O beyond the explicit
  read/write-state functions.

## Machine enforcement — what's covered, and what isn't (and why)

Three tiers, per B's Round 1 audit request to distinguish them explicitly
rather than calling everything "enforced": **MACHINE_ENFORCED_PRIMITIVE**
(a real function makes this decision correctly, if a caller invokes it),
**RUNTIME_WIRED_ENFORCEMENT** (something in the repository's real execution
path *always* invokes it — none of this task's rules reach this tier yet;
see "Status" at the top of this document), and **PROCEDURAL_ENFORCED_BY_POLICY**
(no function can enforce this; it is a documented discipline only).

| Rule | Tier | Enforced by |
|---|---|---|
| Executor ≠ Auditor | MACHINE_ENFORCED_PRIMITIVE | `certifyAuditResult`'s exact-canonical-role independence check (Round 1: closed the zero-width-Unicode bypass by requiring exact `ROLES` membership, not fuzzy normalization) |
| Invalid role transitions (e.g. `A → C`) | MACHINE_ENFORCED_PRIMITIVE | `VALID_ROLE_TRANSITIONS` / `validateRoleTransition` — closed table, not a blocklist |
| Invalid state transitions / wrong acting role | MACHINE_ENFORCED_PRIMITIVE | `STATE_TRANSITION_TABLE` / `validateStateTransition` |
| B's result HEAD-bound (live) | MACHINE_ENFORCED_PRIMITIVE | WeakSet attestation (`certifyAuditResult` → `TRUSTED_AUDITOR_RESULT_REGISTRY`); see "Attestation vs. persistence" for the live-process boundary and its named recovery path |
| C's certification HEAD-bound | MACHINE_ENFORCED_PRIMITIVE | `certifyByValidator`'s `attestedAuditorResult.headSha === currentHeadSha` check |
| Production + UNPROVEN ⇒ HOLD | MACHINE_ENFORCED_PRIMITIVE | reused verbatim from `claim-taxonomy.mjs`'s `classifyClaimSet` |
| UNKNOWN risk ⇒ safe handling | MACHINE_ENFORCED_PRIMITIVE | reused verbatim from `command-safety.mjs`'s `evaluateCommandSafety` (`UNKNOWN` never `authorized`) |
| Missing mandatory evidence ⇒ HOLD | MACHINE_ENFORCED_PRIMITIVE | `certifyAuditResult` requires a resolvable `headSha`; malformed `findings`/`evidence` shape ⇒ HOLD (both, symmetrically, since Round 1); any severity outside `FINDING_SEVERITIES` ⇒ `HOLD_MALFORMED_FINDING_SEVERITY` |
| CI SHA mismatch ⇒ reject | MACHINE_ENFORCED_PRIMITIVE | `certifyByValidator`'s `ciHeadSha !== currentHeadSha` check |
| Handoff malformed ⇒ reject | MACHINE_ENFORCED_PRIMITIVE | `validateHandoffEnvelope` — closed field set, typed, and itself re-validates the encoded role transition |
| A cannot FINAL_PASS | MACHINE_ENFORCED_PRIMITIVE | `EXECUTOR_RESULT_STATES` structurally excludes every PASS-shaped value |
| C cannot certify an unresolved blocker | MACHINE_ENFORCED_PRIMITIVE | `certifyByValidator`'s `attestedAuditorResult.finalState` check |
| `WAITING_CI` state | MACHINE_ENFORCED_PRIMITIVE | `classifyCiWaitStatus` — `completed` is the only path to a terminal verdict |
| Human gate for sensitive action | MACHINE_ENFORCED_PRIMITIVE | `requiresHumanGateForAction` — no bypass parameter exists in its signature |
| B/C cannot **authorize** a mutating command | MACHINE_ENFORCED_PRIMITIVE (protocol-decision layer only — see below) | `evaluateCommandRiskGate`'s `roleAuthorized` field, given `activeRole: 'B'\|'C'` |
| B/C cannot **physically execute** a mutating command | PROCEDURAL_ENFORCED_BY_POLICY | no OS/tool-permission boundary exists between roles in this single-chat model |

**Round 1 correction on B/C mutation**: the original design treated
"B cannot mutate while auditing" as entirely procedural, which conflated two
different claims. *Physically* blocking a Bash call would need an
OS/tool-level hook (like `night-guard.mjs`'s real `PreToolUse` hook around
an actually-separate spawned child) — genuinely out of scope; hooking the
operator's own interactive session is a materially more invasive mechanism
this task does not build. But a protocol-**decision**-layer check needed no
such hook: `evaluateCommandRiskGate` already computed a command's safety
class; adding one `activeRole` parameter and one branch (`activeRole ∈
{B,C} && commandSafetyClass !== 'READ_ONLY' ⇒ roleAuthorized: false`) was
exactly as practical as everything else in this module, reuses
`command-safety.mjs` verbatim (no duplicated parser/classifier), and never
touches `evaluation.authorized` (so `A`'s existing use of this function is
completely unaffected). This closes the *authorization* half; the
*physical-prevention* half remains — correctly — procedural, mitigated the
same way every other role-discipline gap here is: even a violation cannot
certify a real HOLD-worthy fact away, since every finding/evidence claim
still funnels through the same fail-closed gates regardless of who
nominally "is" B at the time.

## Not built, and why (staying inside what this task justifies)

- **Distributed file locking** across concurrent tasks. The brief explicitly
  asks for the *shape* of a future reservation record
  (`TASK_ID`/`OWNER`/`FILES_RESERVED`/`BASE_SHA`/`HEAD_SHA` — already present
  in `protocol-state.mjs`'s schema) without building concurrency machinery
  single-task sequential execution doesn't yet need. `FILES_RESERVED` is
  tracked in the shared state today; a conflict-detection function across
  multiple simultaneously-active task states is a distinct, future,
  separately-justified change.
- **New `.claude/agents/*.md` persona files.** The brief explicitly forbids
  subagents and multi-chat designs; a persona file implies a
  `subagent_type` invokable via the `Agent` tool, which is exactly the
  model this task is not building.
