# tools/night-agent

Local tooling for the Korixa Night Agent. See `CLAUDE.md` and
`.claude/overnight/` (POLICY.md, SAFETY.md, GIT_POLICY.md) for the full
contract this code implements. This directory has no npm dependencies —
Node built-ins only.

## Status

```
EXECUTION_ENGINE = DISABLED_IN_V1_A
CLAUDE_AGENT_RUNS_IN_V1_C = 0
REAL_AUTONOMOUS_EXECUTION_READY = NO
```

Nothing in this directory spawns `claude` for real, pushes, opens a PR, or
mutates any file outside of an active-policy-scoped Write/Edit that a
*human-supervised* session performs (see "Relationship to the guard"
below). `git add`/`git commit`/`git push` are denied entirely in Night
Mode — there is no controlled Git writer, so any commit still goes through
a human or an explicitly authorized supervised block, never autonomously.
`--execute-green` is gated by a TRIPLE execution lock as of NIGHT-V1-C (CLI
flag + `KORIXA_NIGHT_EXECUTION=1` + `KORIXA_NIGHT_REAL_SPAWN=1`) — the real
controlled-execution pipeline (`executeControlledGreenTask`) is wired end to
end, but no code path in this codebase ever sets `KORIXA_NIGHT_REAL_SPAWN`,
so a real spawn is never reached in a real invocation. See
`.claude/overnight/SAFETY.md`'s "NIGHT-V1-C" section for the full rationale.

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
- **`executor.mjs`** — builds the exact `claude` CLI argv for a restricted,
  non-interactive child: `-p <prompt> --tools Read,Glob,Grep,Write,Edit
  --allowedTools Read Glob Grep Write Edit --permission-mode dontAsk
  --max-turns N` (NIGHT-V1-C added `--allowedTools`; both flags were
  re-confirmed against current official docs — `--tools` restricts actual
  tool *availability* as one comma-joined value, `--allowedTools`
  pre-approves as separate argv tokens per tool name, its own documented
  convention). `assertSafeArgvOrThrow` scans every generated argv for a
  permission-bypass flag AND requires `--allowedTools` to express exactly
  the same set as `--tools` before it would ever be spawned, and
  `runControlledChild` runs a spawned child under a watchdog (hard timeout +
  inactivity timeout). Nothing in this file, or anywhere else in this
  directory, spawns a real `claude` process — `spawnFn` is always
  dependency-injected in tests.
- **`runner.mjs`** — the CLI entrypoint. Reads a queue file and runs one of:
  - `--validate` — schema/cycle/path-conflict checks only.
  - `--dry-run` (default) — validation, plus a printed execution plan
    (which task would run next); nothing is executed or changed.
  - `--plan-execution` (NIGHT-V1-B) — validation, then the concrete
    execution plan for the next GREEN task (policy summary, restricted
    tool surface, timeouts, retry budget) — no secrets, no real policy
    file created, no Claude spawned.
  - `--execute-green` — `runExecuteGreen` checks the double gate (CLI flag +
    `KORIXA_NIGHT_EXECUTION=1`), then remote-main drift and stale-checkpoint
    state, before ever calling `executeTaskFn`. NIGHT-V1-C wires the REAL
    `executeControlledGreenTask` as that function (no longer the permanent
    `stubExecuteTaskFn`), but `executeControlledGreenTask` itself is gated
    FIRST by a further triple execution lock (CLI flag +
    `KORIXA_NIGHT_EXECUTION=1` + `KORIXA_NIGHT_REAL_SPAWN=1`) — nothing in
    this codebase's real path ever sets the third variable, so every real
    invocation still resolves to `HOLD_REAL_EXECUTION_LOCKED` before any
    policy/checkpoint/spawn side effect.
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

There is still no controlled Git writer — `git add`/`git commit` remain
denied entirely in Night Mode (delegated-execution risk via Git hooks/
attribute filters, unchanged since R3). NIGHT-V1-C wires a real controlled-
execution sandbox (`executeControlledGreenTask`: temporary active policy ->
checkpoint `RUNNING` -> `runControlledChild` -> checkpoint final state ->
policy cleanup), but its own triple execution lock means no real invocation
in this codebase ever reaches a real spawn — see `.claude/overnight/
SAFETY.md`'s "NIGHT-V1-C" section. A future, separately-authorized change
would be the one to actually set `KORIXA_NIGHT_REAL_SPAWN=1` from a real
controller: `EXECUTION_ENGINE = DISABLED_IN_V1_A`, `CLAUDE_AGENT_RUNS = 0`.
