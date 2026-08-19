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
any file. As of R3, `git add`/`git commit` are also denied in Night Mode
(see below) — there is no controlled Git writer, so any commit still goes
through a human or an explicitly authorized supervised block, never
autonomously. `runner.mjs` is validate/dry-run only. A real execution
engine is a distinct, future, separately-authorized change (`NIGHT-V1-B`
and beyond) — its addition should not require rewriting `queue.mjs` or the
shape of `runner.mjs`'s modes, only adding a new one.

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

## Relationship to the guard (R4: catch-all tool surface, path-canonical)

`.claude/hooks/night-guard.mjs` is registered as a **single catch-all**
`PreToolUse` hook entry in `.claude/settings.json` — `"matcher": "*"`,
confirmed current official syntax for "every tool" — invoked via the exec
form (`"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/
night-guard.mjs"]`, no shell involved). Before R4 the guard was registered
per-tool (`Bash`, then separately `Write|Edit|NotebookEdit`); any tool not
named in one of those two matchers — `PowerShell`, `Monitor`, `Agent`, or
anything not yet named — would never have invoked the hook at all. The
guard is dormant for every tool unless `KORIXA_NIGHT_MODE=1` is set in the
environment that launched Claude Code.

The guard is a **default-deny allowlist**, not a deny-pattern blocklist.
For Bash: a command is allowed only if it matches one of a small, closed
set of known-safe shapes — as of R4, exactly three: `pwd`, `node --version`,
and `git rev-parse <ref>` (`<ref>` itself further restricted to `HEAD` with
0-4 carets or a 7-40 char hex SHA — no flags). Everything else is denied as
`UNCLASSIFIABLE_COMMAND`. For any tool that isn't `"Bash"` — not an
enumerated list, a closed rule — the guard denies with
`NIGHT_TOOL_NOT_YET_SCOPED` (or the more specific
`NIGHT_FILE_MUTATION_NOT_YET_SCOPED` for `Write`/`Edit`/`NotebookEdit`,
kept only for a clearer audit message; the security outcome doesn't depend
on that naming). See `.claude/overnight/SAFETY.md`'s "Guard model", "R3:
delegated execution", and "R4: tool-surface catch-all and path
canonicalization" sections for the full rationale — R1/R2's allowlist
(read-only Git, test runners, `git add`/`git commit`) shrank sharply in R3
because each of those commands can delegate execution to something the
guard cannot see (`SAFE_OUTER_COMMAND != SAFE_EXECUTION_TREE`), and R4
closed the remaining gaps: tools the guard was never registered for, and
non-canonical path aliases (`./backend`, `backend//src`, `backend/./src`,
Windows case aliases) that could let one written policy and one actually-
enforced scope silently diverge once a controlled writer exists.

There is no controlled Git writer and no controlled execution sandbox as of
R4 — `git add`/`git commit` are denied entirely in Night Mode, not merely
path-scoped, and no task-scoped enforcement exists for file-mutating tools
either. Enforcing per-task path scope, and building a safe way to actually
run tests/builds or make commits, are both distinct, future,
separately-authorized changes — neither exists yet:
`EXECUTION_ENGINE = DISABLED_IN_V1_A`.
