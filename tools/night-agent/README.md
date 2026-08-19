# tools/night-agent

Local tooling for the Korixa Night Agent. See `CLAUDE.md` and
`.claude/overnight/` (POLICY.md, SAFETY.md, GIT_POLICY.md) for the full
contract this code implements. This directory has no npm dependencies —
Node built-ins only.

## Status

```
EXECUTION_ENGINE = DISABLED_IN_V1_A
CLAUDE_AGENT_RUNS_IN_V1_B = 0
REAL_AUTONOMOUS_EXECUTION_READY = NO
```

Nothing in this directory spawns `claude` for real, pushes, opens a PR, or
mutates any file outside of an active-policy-scoped Write/Edit that a
*human-supervised* session performs (see "Relationship to the guard"
below). `git add`/`git commit`/`git push` are denied entirely in Night
Mode — there is no controlled Git writer, so any commit still goes through
a human or an explicitly authorized supervised block, never autonomously.
`--execute-green` (NIGHT-V1-B) is a real, double-gated code path, but its
actual execution step is a permanent stub in this codebase today — see
`runner.mjs`'s `stubExecuteTaskFn`.

## Files

- **`queue.mjs`** — pure functions over a parsed task-queue object (see
  `.claude/overnight/TASK_QUEUE.example.json` for the schema): structural
  validation, dependency-cycle detection, `allowed_paths` conflict
  detection, GREEN-task selection, and per-task executability
  classification. No file I/O, no `child_process`, no Claude invocation —
  safe to unit test directly. Path-safety rules themselves live in
  `path-safety.mjs` (imported and re-exported here for backward
  compatibility) rather than being duplicated.
- **`path-safety.mjs`** (NIGHT-V1-B) — the single source of truth for every
  path-safety rule the Night Agent depends on: canonical lexical path
  validation (no `./`, `//`, `/./`, trailing slash, Windows reserved device
  names, ASCII control characters, …), Windows case-insensitive comparison,
  critical control-plane path detection, task-scope containment, and real
  filesystem realpath/symlink-junction containment checks. Both
  `queue.mjs` and `.claude/hooks/night-guard.mjs` import from here.
- **`checkpoint.mjs`** (NIGHT-V1-B) — atomic (write-temp-then-rename) task
  checkpointing with a fixed, secret-free field set, and the stale-session
  resume policy: a checkpoint claiming `RUNNING` is never assumed to still
  be running after a restart with no live process reference.
- **`executor.mjs`** (NIGHT-V1-B) — builds the exact `claude` CLI argv for a
  restricted, non-interactive child (`--tools Read,Glob,Grep,Write,Edit
  --permission-mode dontAsk --max-turns N`, confirmed against current
  official docs — `--tools` restricts actual tool *availability*, unlike
  `--allowedTools`, which only pre-approves), scans every generated argv for
  a permission-bypass flag before it would ever be spawned, and runs a
  spawned child under a watchdog (hard timeout + inactivity timeout).
  Nothing in this file, or anywhere else in this directory, spawns a real
  `claude` process — `spawnFn` is always dependency-injected in tests.
- **`runner.mjs`** — the CLI entrypoint. Reads a queue file and runs one of:
  - `--validate` — schema/cycle/path-conflict checks only.
  - `--dry-run` (default) — validation, plus a printed execution plan
    (which task would run next); nothing is executed or changed.
  - `--plan-execution` (NIGHT-V1-B) — validation, then the concrete
    execution plan for the next GREEN task (policy summary, restricted
    tool surface, timeouts, retry budget) — no secrets, no real policy
    file created, no Claude spawned.
  - `--execute-green` (NIGHT-V1-B) — double-gated by BOTH the CLI flag AND
    `KORIXA_NIGHT_EXECUTION=1`; even when unlocked, checks remote-main
    drift and stale-checkpoint state before ever reaching the (permanently
    stubbed) execution step — see `runExecuteGreen`/`stubExecuteTaskFn`.
  - `--self-test` — runs against a hardcoded in-memory fixture, touching no
    files on disk at all.
- **`test/`** — `node:test` suites for the guard, the queue library,
  path-safety, checkpoint, executor, and the runner's CLI surface.

## Usage

```
node tools/night-agent/runner.mjs --self-test
node tools/night-agent/runner.mjs --queue .claude/overnight/TASK_QUEUE.example.json --validate
node tools/night-agent/runner.mjs --queue .claude/overnight/TASK_QUEUE.example.json --dry-run
node tools/night-agent/runner.mjs --queue .claude/overnight/TASK_QUEUE.example.json --plan-execution
node --test tools/night-agent/test/*.test.mjs
```

## Relationship to the guard (B: task-scoped Write/Edit/Read via an active policy)

`.claude/hooks/night-guard.mjs` is registered as a **single catch-all**
`PreToolUse` hook entry in `.claude/settings.json` — `"matcher": "*"`,
confirmed current official syntax for "every tool" — invoked via the exec
form (`"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/
night-guard.mjs"]`, no shell involved). The guard is dormant for every tool
unless `KORIXA_NIGHT_MODE=1` is set in the environment that launched Claude
Code.

The guard is a **default-deny allowlist**, not a deny-pattern blocklist.
For Bash: a command is allowed only if it matches one of exactly three
known-safe shapes — `pwd`, `node --version`, and `git rev-parse <ref>`
(`<ref>` restricted to `HEAD` with 0-4 carets or a 7-40 char hex SHA — no
flags). For `Write`/`Edit`: allowed only if a valid **active policy** (see
`path-safety.mjs` above) is present AND the target passes every
path-safety gate against that policy's `allowed_paths`. For `Read`: same
shape, checked against `read_paths`, requiring the target to exist. For
`Glob`/`Grep`: allowed only with an explicit path within `read_paths` — an
omitted path is always denied. `NotebookEdit` is denied unconditionally.
For any other tool — not an enumerated list, a closed rule — the guard
denies with `NIGHT_TOOL_NOT_YET_SCOPED`. See `.claude/overnight/SAFETY.md`'s
"Guard model", "R3: delegated execution", "R4: tool-surface catch-all and
path canonicalization", and "NIGHT-V1-B: controlled GREEN execution"
sections for the full rationale.

There is still no controlled Git writer and no controlled execution
sandbox — `git add`/`git commit` remain denied entirely in Night Mode
(delegated-execution risk via Git hooks/attribute filters, unchanged since
R3), and `--execute-green`'s actual execution step is a permanent stub
(`stubExecuteTaskFn`) regardless of whether its double gate is satisfied.
Task-scoped Write/Edit/Read enforcement now exists, but nothing in this
codebase today actually drives it from a real autonomous session — that
remains a distinct, future, separately-authorized change:
`EXECUTION_ENGINE = DISABLED_IN_V1_A`, `CLAUDE_AGENT_RUNS = 0`.
