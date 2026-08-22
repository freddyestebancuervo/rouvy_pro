# Korixa Night Agent — Overnight Directory

This directory holds the policy, contracts, and (at runtime) local state for
the Korixa Night Agent — an environment-gated (`KORIXA_NIGHT_MODE=1`) mode
for bounded, auditable autonomous task execution.

## Files

| File | Purpose |
|---|---|
| `POLICY.md` | State machine, dependency types, retry/polling budgets, risk levels. |
| `SAFETY.md` | Exhaustive deny-by-default (`RED`) list. Read this first. |
| `GIT_POLICY.md` | Branch/commit rules for autonomous work. |
| `TASK_QUEUE.example.json` | Non-production fixture showing the task queue contract shape. |
| `REPORT_TEMPLATE.md` | Fields a session report must capture. |
| `runtime/` | Local-only runtime state (`state.json`, logs, reports). Never committed — see `.gitignore`. |

## Status (V1 — `NIGHT-V1-A`)

- Autonomous execution: **disabled**. The runner (`tools/night-agent/runner.mjs`)
  only supports `--validate` and `--dry-run`; it never spawns a `claude`
  process.
- Guard (`.claude/hooks/night-guard.mjs`): implemented, dormant outside
  `KORIXA_NIGHT_MODE=1`, fail-closed inside it.
- Queue validation (`tools/night-agent/queue.mjs`): implemented and tested.

See `tools/night-agent/README.md` for how to run the V1 tooling.

## What Night Mode is not (yet)

V1 does not push branches, open PRs, monitor CI, or run any `YELLOW`/`RED`
operation. Every mutation beyond a local commit on an isolated night branch
remains a manual, explicitly authorized action.
