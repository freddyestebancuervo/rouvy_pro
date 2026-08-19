# Korixa Night Agent — Safety Contract (RED / denied by default)

Applies only when `KORIXA_NIGHT_MODE=1`. This file, together with
`.claude/hooks/night-guard.mjs`, defines what the Night Agent must **never**
do without a separate, explicit, human-issued authorization for that exact
action — the same discipline already used for every Production block in this
repository's history.

Night V1 must **fail closed**: when in doubt, deny.

## Denied by default (RED)

**Git / GitHub**
- Direct write to `main`.
- `git push` to `main`/`master` (any push to `main` at all).
- Force push (`--force`, `-f`, `--force-with-lease`).
- Branch deletion.
- PR merge, PR close.
- Release/tag publication (unless explicitly authorized elsewhere).
- `git reset --hard`.
- `git clean` in any destructive variant (`-f`, `-fd`, `-fdx`, `-xffd`, …).

**Repository integrity**
- Mutating the original (dirty) Windows root.
- `rm -rf` and equivalents outside an explicitly scoped, authorized path.

**Production / GCP**
- Cloud Run deploy, service creation/update/deletion, traffic mutation.
- Cloud SQL instance mutation (patch/delete) or any database migration
  against a Production database.
- Redis/Memorystore mutation.
- Secret Manager **payload** mutation (creating/adding/destroying versions).
- IAM policy mutation (project, service account, or resource level).
- Firebase Production deploy.
- Any GCP resource deletion.
- Billing mutation.
- DNS/domain mutation.
- Destructive SQL of any kind (`DROP`, `TRUNCATE`, unguarded `DELETE`, …).

**Credentials**
- Printing/echoing a secret or key.
- Committing a credential file.
- `--dangerously-skip-permissions` (or any equivalent permission-bypass flag).

**Guard evasion**
- Shell indirection designed to route around the guard (`bash -c "..."`,
  `sh -c "..."`, `eval ...`, `curl ... | sh`, `wget ... | bash`, chaining a
  denied command behind a benign one with `&&`/`;`/`|`, etc.). The guard
  treats these as a classification problem, not a whitelist problem: if a
  command cannot be confidently classified as safe, it is denied as
  `UNCLASSIFIABLE_COMMAND` — see `.claude/hooks/night-guard.mjs`.

## Unlock path

None of the above is unlocked by this file. A future version may explicitly
document a narrower, separately authorized `YELLOW` unlock (e.g. push to
`agent/night/*` + Draft PR creation) — that unlock does not exist yet, and
`RED` items are never unlocked by a policy file alone; they require the same
per-action human authorization every other Production change in this
repository has always required.
