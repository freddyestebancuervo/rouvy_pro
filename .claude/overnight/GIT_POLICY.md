# Korixa Night Agent — Git Policy

Applies only when `KORIXA_NIGHT_MODE=1`.

## Root vs. worktree

- The original root (`/c/proyectos/rouvy_proZIP/rouvy_pro`) is **read-only**
  for Night Agent purposes. It is never checked out, reset, stashed, cleaned,
  or committed to by autonomous work.
- All Night Agent work happens in an isolated `git worktree` on a dedicated
  branch, created from an exact, explicitly frozen base SHA — never from
  local (potentially stale) `origin/main`.

## Branch naming

- Future autonomous task branches: `agent/night/<date>/<task-id>`
  (e.g. `agent/night/20260819/fix-flaky-test`).
- The `NIGHT-V1-A` bootstrap itself is an explicit, one-time exception to
  that pattern: `feat/night-v1-a-bootstrap-20260819`.

## Never

- Commit directly to `main`.
- Push `main`.
- Force push, to any branch.
- Reset a protected ref.
- Clean or stash the original root.

## Commit discipline

- Future night task commits must be small, task-scoped, and descriptively
  named after the task they implement.
- One task's commit must not silently absorb unrelated changes — if a diff
  contains files outside that task's declared `allowed_paths`, that is a
  policy violation, not something to "just include."

## V1 scope

`NIGHT-V1-A` creates exactly one local commit on
`feat/night-v1-a-bootstrap-20260819` and stops. No push, no PR, no merge —
those remain manual, explicitly authorized actions in every version until a
`YELLOW`/`RED` unlock is separately documented and authorized.
