# tools/night-agent

Local tooling for the Korixa Night Agent. See `CLAUDE.md` and
`.claude/overnight/` (POLICY.md, SAFETY.md, GIT_POLICY.md) for the full
contract this code implements. This directory has no npm dependencies —
Node built-ins only.

## Status

```
EXECUTION_ENGINE = DISABLED_IN_V1_A
```

Nothing in this directory spawns `claude`, pushes, opens a PR, or mutates
any file outside of `git add`/`git commit` performed by a human or by an
explicitly authorized block. `runner.mjs` is validate/dry-run only. A real
execution engine is a distinct, future, separately-authorized change
(`NIGHT-V1-B` and beyond) — its addition should not require rewriting
`queue.mjs` or the shape of `runner.mjs`'s modes, only adding a new one.

## Files

- **`queue.mjs`** — pure functions over a parsed task-queue object (see
  `.claude/overnight/TASK_QUEUE.example.json` for the schema): structural
  validation, dependency-cycle detection, `allowed_paths` conflict
  detection, GREEN-task selection, and per-task executability
  classification. No file I/O, no `child_process`, no Claude invocation —
  safe to unit test directly.
- **`runner.mjs`** — the CLI entrypoint. Reads a queue file and runs one of:
  - `--validate` — schema/cycle/path-conflict checks only.
  - `--dry-run` (default) — validation, plus a printed execution plan
    (which task would run next); nothing is executed or changed.
  - `--self-test` — runs against a hardcoded in-memory fixture, touching no
    files on disk at all.
- **`test/`** — `node:test` suites for the guard, the queue library, and
  the runner's CLI surface.

## Usage

```
node tools/night-agent/runner.mjs --self-test
node tools/night-agent/runner.mjs --queue .claude/overnight/TASK_QUEUE.example.json --validate
node tools/night-agent/runner.mjs --queue .claude/overnight/TASK_QUEUE.example.json --dry-run
node --test tools/night-agent/test/*.test.mjs
```

## Relationship to the guard (R1: default-deny allowlist)

`.claude/hooks/night-guard.mjs` is registered as a `PreToolUse` hook in
`.claude/settings.json` (referenced via the official `${CLAUDE_PROJECT_DIR}`
placeholder, so it resolves the same regardless of the shell's current
working directory) and is dormant unless `KORIXA_NIGHT_MODE=1` is set in the
environment that launched Claude Code.

As of R1, the guard is a **default-deny allowlist**, not a deny-pattern
blocklist: a Bash command is allowed only if it matches one of a small,
closed set of known-safe shapes (read-only Git, local test/static-analysis
commands, and `git add`/`git commit -m "<message>"`); everything else is
denied as `UNCLASSIFIABLE_COMMAND`. See `.claude/overnight/SAFETY.md`'s
"Guard model" section for the full rationale.

`git add`/`git commit` are allowed by the guard globally, as primitives —
the guard has no notion of any individual task's `allowed_paths`/
`forbidden_paths`, so it cannot tell "a commit inside this task's declared
scope" from "a commit anywhere." Enforcing per-task path scope is the
queue/runner layer's job (and, once it exists, the Auditor's), not the
guard's — and neither exists yet as an execution engine:
`EXECUTION_ENGINE = DISABLED_IN_V1_A`. The guard being permissive about
these two primitives is not the same as autonomous commits being enabled.
