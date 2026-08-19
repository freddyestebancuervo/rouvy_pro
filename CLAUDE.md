# Korixa (rouvy_pro) — Project Agent Contract

Repository: `freddyestebancuervo/rouvy_pro` (backend package name `ridepro-backend`,
product/infra naming `korixa-*` — a rebrand in progress; see
`docs/audits/AUDITORIA_FINAL/` for context before assuming either name is
canonical in a given file).

## Source of truth

- `PROJECT_STATUS.md` (repo root) is the single source of truth for project
  status. Never duplicate its content elsewhere — reference it by path.
- Read `docs/audits/AUDITORIA_FINAL/` when architectural context is relevant.
- Remote `main` truth comes from `git ls-remote origin refs/heads/main` or the
  GitHub API — **never** from local `origin/main`, which is routinely stale in
  this working copy and must not be treated as current.

## Non-negotiable invariants

- Never modify the dirty original Windows root (`/c/proyectos/rouvy_proZIP/rouvy_pro`)
  beyond read-only inspection unless a task explicitly targets it. Real work
  happens in isolated `git worktree` checkouts on dedicated branches.
- Secrets (keys, tokens, passwords, connection strings) must never be printed,
  echoed, logged, or committed. Read them only into memory or restrictive
  temp files, and delete those temp files when done.
- Production mutations (Cloud Run, Cloud SQL, Redis, Secret Manager, IAM, WIF,
  API enablement, database migrations, Artifact Registry publication) require
  an explicit, separately authorized block — never inferred, never bundled
  into unrelated work.
- Destructive Git actions (`push --force`, `reset --hard`, `clean -fd`,
  deleting branches/PRs, merging) require explicit authorization for that
  exact action, every time.
- Every meaningful change needs real evidence: tests actually run, diffs
  actually reviewed. Never claim a gate is satisfied ("PASS") without having
  actually satisfied it.
- Prefer `TASK_HOLD` (stop and report) over unsafe improvisation. Escalate to
  `SESSION_HALT` only for global safety/integrity problems, not routine
  blockers.

## Night Mode

Night Mode is an **opt-in, environment-gated** operating mode for autonomous
task execution, active **only** when the shell that launched this session has
`KORIXA_NIGHT_MODE=1` set. A normal daytime interactive session must behave
exactly as it always has — the presence of this file does not, by itself,
change any behavior.

When `KORIXA_NIGHT_MODE=1`, also read, in order:

1. `.claude/overnight/SAFETY.md` — what is denied by default (RED operations).
2. `.claude/overnight/POLICY.md` — state machine, risk levels, retry/hold rules.
3. `.claude/overnight/GIT_POLICY.md` — branch/commit rules for autonomous work.
4. `.claude/overnight/TASK_QUEUE.example.json` — the task contract shape.

A `PreToolUse` hook (`.claude/hooks/night-guard.mjs`) is registered at all
times but is only restrictive when `KORIXA_NIGHT_MODE=1`; it is a dormant
no-op otherwise.
