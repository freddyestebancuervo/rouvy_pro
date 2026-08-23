# Common Agent Protocol (Task 2, 2026-08-23)

A single-chat, four-role coordination protocol for `NIGHT` (orchestrator),
`A` (executor), `B` (independent adversarial auditor), and `C` (validator/
certifier). Codifies, as tested code, the same discipline this repository's
own recent history (PR #73's three independent audit rounds; PR #74's
Night→A→B→C sequence) already followed by hand, across explicit role
switches in one conversation — so future tasks don't have to re-derive it
from a long prose instruction each time.

**Code**: `tools/night-agent/protocol-state.mjs` (shared-state schema +
atomic persistence) and `tools/night-agent/role-protocol.mjs` (role/state
machine, handoff contract, evidence binding, human gates). **Tests**:
`tools/night-agent/test/protocol-state.test.mjs`,
`tools/night-agent/test/role-protocol.test.mjs` (58 tests).

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
  identity is genuinely independent (normalized-distinct) from the executor
  identity, no finding is blocking (a P0/P1 blocks by default even if
  `blocking` is omitted — never assumed non-blocking by silence), and every
  evidence claim clears `claim-taxonomy.mjs`'s existing
  UNPROVEN+production-impact fail-closed rule. Every result — PASS **or**
  HOLD — is attested into a module-private `WeakSet` so C can trust it was
  genuinely produced, not hand-typed.
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

| Rule | Enforced by |
|---|---|
| Executor ≠ Auditor | `certifyAuditResult`'s normalized-identity independence check |
| Invalid role transitions (e.g. `A → C`) | `VALID_ROLE_TRANSITIONS` / `validateRoleTransition` — closed table, not a blocklist |
| Invalid state transitions / wrong acting role | `STATE_TRANSITION_TABLE` / `validateStateTransition` |
| B's result HEAD-bound | WeakSet attestation (`certifyAuditResult` → `TRUSTED_AUDITOR_RESULT_REGISTRY`) |
| C's certification HEAD-bound | `certifyByValidator`'s `attestedAuditorResult.headSha === currentHeadSha` check |
| Production + UNPROVEN ⇒ HOLD | reused verbatim from `claim-taxonomy.mjs`'s `classifyClaimSet` |
| UNKNOWN risk ⇒ safe handling | reused verbatim from `command-safety.mjs`'s `evaluateCommandSafety` (`UNKNOWN` never `authorized`) |
| Missing mandatory evidence ⇒ HOLD | `certifyAuditResult` requires a resolvable `headSha`; malformed `findings`/evidence shape ⇒ HOLD, never coerced to empty |
| CI SHA mismatch ⇒ reject | `certifyByValidator`'s `ciHeadSha !== currentHeadSha` check |
| Handoff malformed ⇒ reject | `validateHandoffEnvelope` — closed field set, typed, and itself re-validates the encoded role transition |
| A cannot FINAL_PASS | `EXECUTOR_RESULT_STATES` structurally excludes every PASS-shaped value |
| C cannot certify an unresolved blocker | `certifyByValidator`'s `attestedAuditorResult.finalState` check |
| `WAITING_CI` state | `classifyCiWaitStatus` — `completed` is the only path to a terminal verdict |
| Human gate for sensitive action | `requiresHumanGateForAction` — no bypass parameter exists in its signature |

**"B cannot mutate while auditing" is NOT machine-enforced, by design, and
documented as such** (see `role-protocol.mjs`'s own closing comment): there
is no OS-level or tool-permission boundary between roles in this
single-chat model, unlike `night-guard.mjs`'s real `PreToolUse` hook, which
sits between an actually-separate, actually-sandboxed spawned child process
and its tool calls. Building an equivalent hook scoped to "is the active
role currently B" would mean hooking the operator's own interactive
session — a materially more invasive mechanism, and out of this task's
scope. The mitigation in place is procedural (role discipline, the same
`TRUST_PREVIOUS_CONCLUSIONS = FALSE` reset this whole repository's history
already practiced by hand) plus the structural fact that even a
role-discipline violation cannot certify a real HOLD-worthy fact away —
every finding/evidence claim still funnels through the same fail-closed
gates regardless of who nominally "is" B at the time.

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
