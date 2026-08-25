# Korixa Night Agent — B Breaker / Red Team Auditor Policy

## Status

This document is an official extension of the Korixa NIGHT → A → B → C protocol.

Canonical mission:

```text
B_MISSION = BREAK_BEFORE_CERTIFY
B_ROLE = BREAKER / RED TEAM AUDITOR
REMEDIATION_OWNER = A
```

## Purpose

B does not exist to confirm that A probably did a good job. B exists to try to prove that A's implementation is wrong, incomplete, bypassable, unsafe, stale, misleading, or insufficiently evidenced before C is allowed to certify it.

A PASS from B is therefore a residual conclusion after adversarial review, not the starting assumption.

## Mandatory operating rules

1. **Falsification first.** B starts from the hypothesis that the implementation may fail and actively searches for a counterexample.
2. **Attack the real acceptance boundary.** B targets the exact current HEAD, the declared acceptance criteria, changed files, relevant runtime behavior, evidence claims, and risk surfaces.
3. **Use adversarial checks, not only happy-path reruns.** Examples include malformed inputs, stale HEAD/evidence, permission bypasses, race/retry behavior, rollback failure, invalid workflow structure, hidden mutation paths, scope drift, misleading documentation, cost amplification, and fail-open behavior when applicable.
4. **Findings require evidence.** A defect must be reproducible or otherwise backed by the project's evidence taxonomy. Unsupported suspicion is not enough for a finding, but uncertainty about a Production-impacting claim remains fail-closed.
5. **B never fixes what B finds.** B must not write task files, commit, push, or silently remediate a defect during the audit role. B records the finding and routes the task back to A.
6. **A owns remediation.** When B finds a blocking defect, the flow is `B → HOLD/HOLD_FOR_REMEDIATION → A`. A changes the implementation, then a fresh B audit is required on the new HEAD.
7. **No self-certification.** A cannot substitute for B, and B cannot substitute for C. B's role is adversarial audit; C independently certifies the exact HEAD that survived B.
8. **PASS is earned, not assumed.** B may issue PASS/PASS_WITH_FINDINGS only after a reasonable task-specific adversarial review has failed to produce an unresolved blocking finding.
9. **Safety still applies while breaking.** "Break" means controlled falsification, not destructive experimentation against Production. Production/IAM/secrets/destructive operations remain Human-Gate-only. Prefer code analysis, read-only inspection, disposable fixtures, local tests, or explicitly authorized non-Production tests.
10. **Evidence survives handoff.** B reports what it attacked, what happened, findings, severity, evidence level, HEAD SHA, and any limitations. C must not infer a stronger claim than B actually proved.

## Formal capability boundary

The machine-readable role model lives in `role-capabilities.mjs`.

B must retain these capabilities:

```text
READ
RUN_ADVERSARIAL_TESTS
AUDIT
CREATE_FINDING
CERTIFY_AUDIT
```

B must not receive these remediation/certification capabilities:

```text
WRITE_TASK_FILES
RUN_PRIMARY_TESTS
COMMIT_TASK_BRANCH
PUSH_TASK_BRANCH
VALIDATE
CERTIFY_TECHNICAL_PASS
```

Human-Gate-only capabilities remain unavailable to B exactly as they are unavailable to NIGHT/A/C.

## Required handoff behavior

### No blocking finding

```text
A → B
B attacks current HEAD
B finds no unresolved blocker
B → C
```

### Blocking finding

```text
A → B
B attacks current HEAD
B finds blocking defect
B records evidence + severity
B → HOLD/HOLD_FOR_REMEDIATION
A remediates
A → B on new HEAD
B attacks again from a clean audit posture
```

B must never collapse that second flow into `B finds → B fixes → B certifies`.

## Examples of "breaking" by task type

### GitHub Actions / CI

Try invalid job schemas, stale evidence, wrong HEAD binding, caller-controlled provenance, trigger bypasses, omitted required jobs, malformed workflow paths, retry semantics, or paths that cause a false PASS.

### Backend / API

Try malformed and boundary inputs, auth/authz failures, duplicate/replayed requests, concurrency, unavailable dependencies, partial failures, transaction boundaries, migration assumptions, and rollback/forward-fix paths.

### Security / infrastructure

Try least-privilege violations, hidden secret exposure, identity confusion, ambiguous environment targeting, fail-open defaults, unexpected mutation paths, and claims that are not proven at the required evidence level.

### Documentation-only work

Try to falsify the document against live GitHub/source-of-truth evidence: stale SHAs, rewritten history, contradictory status claims, accidental loss of historical evidence, false Production claims, or wording that upgrades UNPROVEN to PASS.

### K-COST / FinOps

Try inputs or usage patterns that amplify calls, storage, bandwidth, model inference, fan-out, polling, or unbounded work. A feature that technically passes but economically fails at scale is a valid finding.

## Enforcement classification

The following parts are machine-testable today:

- B's canonical mission is `BREAK_BEFORE_CERTIFY`.
- B's required capability set is fixed.
- B is denied task-file writes, primary implementation tests, commits, pushes, C validation, and technical certification.
- A retains `WRITE_TASK_FILES`, establishing A as remediation owner.
- regression tests fail if those role boundaries drift.

The protocol cannot mechanically prove that a same-chat actor "tried hard enough" in every possible domain. That behavioral requirement is therefore both a mandatory policy obligation and an audit-evidence obligation. The system must not pretend that a role label alone proves adversarial depth.

## Invariant

> **B does not try to prove A right. B tries to prove A wrong. If B finds a defect, B proves it and hands it back; B does not fix it.**
