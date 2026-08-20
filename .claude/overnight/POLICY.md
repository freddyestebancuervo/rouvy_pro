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
- `tools/night-agent/queue.mjs`'s schema validation rejects any task with
  `max_retries > 3` outright — an out-of-budget queue contract fails
  validation rather than being silently clamped down to 3.

## Session budget ceiling

- `MAX_SESSION_MINUTES_CEILING = 480` (8 hours) — the hard upper bound V1
  will accept for a queue's `session.max_session_minutes`. A queue
  declaring more than this fails schema validation; it is not clamped.

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

Reading the repo within a task's declared `read_paths`, editing within its
declared `allowed_paths`, fixing failing tests within retry budget,
generating local reports, and creating temporary files only under approved
runtime/temp paths.

A task's `allowed_paths` is the only source of truth for what it may write —
there is no generic "edit anything" permission, ever. As of NIGHT-V1-B,
autonomous Git writes (`git add`/`git commit`/`git push`) are explicitly
NOT part of GREEN operations — see `SAFETY.md`'s "no autonomous Git writer"
note. A controlled Git writer is a distinct, future, separately-authorized
change.

## NIGHT-V1-B: task schema additions

A GREEN task's contract (`.claude/overnight/TASK_QUEUE.example.json`'s
schema, enforced by `tools/night-agent/queue.mjs`) was extended with:

- `enabled` (boolean, required on every task): an explicit per-task gate —
  `risk: GREEN` and `status: READY` alone are no longer sufficient for a
  task to be selected; `enabled` must also be `true`.
- `read_paths` (array, required): the task's read-only scope, independent
  of `allowed_paths` — a task may need to read more than it may write.
- `verification_commands` (array, may be empty): a closed set of
  verification "families" (`NODE_TEST`, `NODE_VERSION`, `PWD`) the
  controller can map to safe argv — never a raw shell string.
- `max_turns` (positive integer, ceiling 40): bounds a future Claude
  child's own turn count.

## NIGHT-V1-C/D: the triple execution lock

Real execution of `--execute-green` requires THREE simultaneous
conditions — the `--execute-green` CLI flag, `KORIXA_NIGHT_EXECUTION=1`,
and a further `KORIXA_NIGHT_REAL_SPAWN=1`. NIGHT-V1-D checks this at TWO
independent layers, defense in depth: `runExecuteGreen` itself checks it
(immediately after the existing double gate, before queue/task validation
even runs — section 24's "TRIPLE LOCK" is the very first pipeline step),
and `executeControlledGreenTask` re-checks it again via
`isTripleExecutionLockSatisfied` before creating any policy file, writing
any checkpoint, or attempting any spawn. Any two of the three alone resolve
to `HOLD_REAL_EXECUTION_LOCKED` with zero side effects at either layer. No
code path in this repository's real CLI invocation ever sets
`KORIXA_NIGHT_REAL_SPAWN` — see `SAFETY.md`'s "NIGHT-V1-D" section for the
full rationale.

## Checkpoint states (a SEPARATE, execution-attempt-level state machine)

`tools/night-agent/checkpoint.mjs` defines its own state set — `PENDING`,
`RUNNING`, `VERIFYING`, `PASS`, `RETRY`, `HOLD` — for tracking a single
execution *attempt* of a task. This is deliberately distinct from the
task-level state machine above (which has `BLOCKED`/`SKIPPED`/
`SESSION_HALT` instead of `PENDING`/`VERIFYING`): a task's queue state
describes its place in the overall queue; a checkpoint describes the
progress of one attempt at running it. A checkpoint claiming `RUNNING` is
never assumed to still be running after a runner restart with no live
reference to that process — it becomes `HOLD_STALE_SESSION` instead (see
`resolveResumeState`, and NIGHT-V1-D's `resolveCheckpointRecoveryDecision`,
which extends the same conservative treatment to `VERIFYING` and `PENDING`
too). Neither state machine silently maps onto the other.

## NIGHT-V1-D: persistent, recoverable checkpoints and the real pre-spawn pipeline

`checkpoint.mjs`'s `resolveCheckpointPath` gives every (repoRoot, task.id)
pair a deterministic, stable path OUTSIDE the repository (under
`os.tmpdir()/korixa-night-agent-checkpoints/`, keyed by a SHA-256 hash — the
raw repoRoot/task.id strings never appear in the path itself). A real CLI
invocation can therefore find a PRIOR run's checkpoint after a process
restart with no in-memory state at all. `resolveCheckpointRecoveryDecision`
maps whatever it finds (or doesn't) to one of: `START_FRESH` (attempt 0),
`RESUME_RETRY` (budget remains — reuses the checkpoint's own `attempt`,
already incremented when it was written), `HOLD_STALE_SESSION` (`RUNNING`/
`VERIFYING`/`PENDING`), `HOLD_ALREADY_COMPLETED` (`PASS`), `HOLD_EXISTING_HOLD`
(`HOLD`), `HOLD_RETRY_EXHAUSTED` (`RETRY` with `attempt >= max_retries`), or
`HOLD_INVALID_CHECKPOINT` (present but corrupt/malformed — never silently
treated as absent). This is the FROZEN, pre-existing `attempt`/`max_retries`
semantics `checkpoint.mjs`'s own retry-limit test already demonstrated —
NIGHT-V1-D makes it reusable across a process restart, it does not
reinterpret it.

`executeControlledGreenTask`'s pipeline (section 24) now runs, in order,
BEFORE any policy/checkpoint/spawn: the triple lock, task validity, a
task-worktree-clean gate (`checkWorktreeClean` — a real `git status
--porcelain=v1 -z --untracked-files=all`, argv array, `shell: false`), a
Night-Guard-installation preflight (`checkNightGuardInstalled` — confirms
`.claude/settings.json` exists, parses as JSON, and its `hooks.PreToolUse`
actually registers `night-guard.mjs`; also confirms the guard file itself
exists), and a verification-commands-present gate (`HOLD_NO_VERIFICATION_COMMANDS`
if empty — a real GREEN task must declare at least one verification).

`CHILD_EXIT_0 != TASK_PASS`. After a successful child, the pipeline is:
POST-SCOPE CHECK #1 (real `git status`, passed to the SAME
`checkPostExecutionScope` from NIGHT-V1-B/C, not duplicated) -> checkpoint
`VERIFYING` -> run every `verification_commands` entry via the trusted
verification runner (`runVerificationCommand`/`runAllVerificationCommands`
— reuses `queue.mjs`'s already-closed `VALID_VERIFICATION_FAMILIES` exactly,
argv array, `shell: false`, a bounded timeout, never a raw stdout/stderr
stored anywhere) -> POST-SCOPE CHECK #2 -> only THEN checkpoint `PASS`. An
unauthorized-scope finding at EITHER check is `HOLD` unconditionally — never
`RETRY`, and never converted to `PASS` by a later step, regardless of
remaining retry budget. A verification failure IS budget-checked (`RETRY` if
budget remains, `HOLD` once exhausted), using the same
`decideRetryOrHold`/`resolveCheckpointRecoveryDecision` semantics as a child
failure.

The CLI's `REAL_CHILD_SPAWN` telemetry and exit code are now truthful: 1
only if `runControlledChild` was actually invoked (regardless of the
eventual outcome), 0 for every gate-blocked HOLD; exit 0 only for an actual
`PASS`, non-zero for every `RETRY`/`HOLD`/gate-locked/validation-failure
outcome (`resolveExitCode`).
