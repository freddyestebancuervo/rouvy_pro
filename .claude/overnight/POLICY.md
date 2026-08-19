# Korixa Night Agent — Policy (V1)

Applies only when `KORIXA_NIGHT_MODE=1`. See `CLAUDE.md` for the entry point.

## State machine

Each task moves through a subset of these states:

```
READY -> RUNNING -> PASS
                  -> RETRY -> RUNNING (up to MAX_RETRIES_PER_FAILURE)
                  -> HOLD
                  -> BLOCKED   (hard dependency not satisfied)
                  -> SKIPPED   (explicitly skipped, e.g. by risk gate)

Any state -> SESSION_HALT   (global safety/integrity problem only)
```

- `READY`: eligible to start (dependencies satisfied, risk executable).
- `RUNNING`: actively being worked by Builder/Auditor.
- `PASS`: Auditor independently confirmed the task's acceptance criteria.
- `RETRY`: a correction cycle after a failure that has not yet exhausted budget.
- `HOLD`: cannot safely proceed; requires human input. **Preferred outcome**
  over unsafe improvisation.
- `BLOCKED`: a hard dependency failed or is unresolved; this task cannot run
  at all until that changes.
- `SKIPPED`: intentionally not executed (e.g. risk level not unlocked in V1).
- `SESSION_HALT`: reserved for global corruption/risk — stop the entire
  session, not just one task. This is rare and must be justified.

## Dependency types

- `HARD_DEPENDENCY`: if the depended-on task does not reach `PASS`, this task
  becomes `BLOCKED` and must not run.
- `SOFT_DEPENDENCY`: if the depended-on task fails, record a degradation note
  and optionally `HOLD` this task, but independent work must continue — a
  soft dependency failure never blocks unrelated tasks.
- `INDEPENDENT`: no dependency; always eligible to run on its own schedule.

## Retry budget

- `MAX_RETRIES_PER_FAILURE = 3`
- After the **same material failure** (same root cause, not a new distinct
  failure) survives 3 correction cycles, the task moves to `HOLD` and the
  runner must stop looping on it. Do not silently keep retrying past budget.

## Polling discipline

- `NO_INFINITE_POLLING = YES` — no `while true`, no "watch forever", no
  unbounded sleep loops, anywhere in Night Agent code or task execution.
- `MAX_POLL_ATTEMPTS = 20`
- `DEFAULT_POLL_INTERVAL_SECONDS <= 15`
- `DEFAULT_MAX_WAIT_SECONDS = 300`
- A task's queue contract may declare a smaller or larger explicit bound via
  its own fields; absent that, the defaults above apply.

## Risk levels

- `GREEN` — safe, reversible, local-only. **The only level executable in V1.**
- `YELLOW` — remote-but-non-Production mutations (push to an `agent/night/*`
  branch, Draft PR creation, CI monitoring). Documented for future versions;
  in V1 any `YELLOW` task is automatically `HOLD`. `YELLOW_EXECUTION_ENABLED = NO`.
- `RED` — anything touching `main`, Production infrastructure, secrets, IAM,
  or any destructive/irreversible action. Automatic `HOLD` / policy denial in
  every version until an explicit, separately authorized unlock exists (none
  does today). See `SAFETY.md` for the exhaustive deny list.

## Efficiency rules

- Do not repeat an identical read-only command unless state could plausibly
  have changed since the last call.
- Do not poll faster than useful (see polling discipline above).
- Do not rerun an entire test suite after every small edit — use the
  smallest relevant check first, and run the full set of task-required
  checks exactly once from the final state before declaring `PASS`.
- Do not spend an entire session solving one non-critical `HOLD` when
  independent, `READY` work exists — advance laterally instead.

## GREEN operations (conceptual, future runner capability)

Reading the repo, searching files, editing within a task's declared
`allowed_paths`, creating/running bounded tests, running static analysis,
building locally, inspecting `git diff`/`status`/`log`, creating local
commits on the task's dedicated night branch, fixing failing tests within
retry budget, generating local reports, and creating temporary files only
under approved runtime/temp paths.

A task's `allowed_paths` is the only source of truth for what it may write —
there is no generic "edit anything" permission, ever.
