# Korixa Night Agent — Safety Contract (RED / denied by default)

Applies only when `KORIXA_NIGHT_MODE=1`. This file, together with
`.claude/hooks/night-guard.mjs`, defines what the Night Agent must **never**
do without a separate, explicit, human-issued authorization for that exact
action — the same discipline already used for every Production block in this
repository's history.

Night V1 must **fail closed**: when in doubt, deny.

## Guard model (R1): DEFAULT_DENY allowlist, not a deny-pattern blocklist

`night-guard.mjs` does not try to enumerate every possible dangerous
command — that list is infinite. Instead it enumerates a small, closed set
of known-**safe** command shapes (read-only Git, local test/static-analysis
commands, and the local commit primitives `git add`/`git commit -m`); a
command is allowed **only** if it matches one of those shapes exactly.
Everything else — unknown commands, ambiguous quoting, shell indirection,
chaining, redirection — is denied as `UNCLASSIFIABLE_COMMAND`. There is no
code path in the guard that returns "allow" because "no deny pattern
matched"; see `.claude/hooks/night-guard.mjs`'s header comment for the exact
decision order.

A practical consequence: `gcloud`, `firebase`, and `gh` are denied
**entirely** in V1 — including harmless-looking read-only invocations like
`gcloud config list` or `gh repo view` — rather than maintaining a partial
list of "which subcommands are dangerous." The same applies to `docker`,
`kubectl`, `terraform`, and every database client (`psql`, `mysql`,
`redis-cli`): V1 has no legitimate need to invoke any of them, so their
total absence from the allowlist *is* the safety boundary, not an attempt to
distinguish a safe invocation from a dangerous one.

`git add`/`git commit -m "<message>"` are permitted by the guard as global
primitives, but the guard has **no concept of a task's `allowed_paths`** —
it cannot tell "a commit inside this task's declared scope" from "a commit
anywhere in the repo." That fine-grained enforcement is the runner/queue/
Auditor's job (see `tools/night-agent/README.md`), not this hook's, and it
does not exist yet: `EXECUTION_ENGINE = DISABLED_IN_V1_A`. These primitives
being guard-permitted is not the same as autonomous commits being enabled.

## R2 closures: a bare `&`, `git add` expansion, commit-message expansion, global wildcards

A second independent audit found four gaps in the R1 model, all closed here:

- **A lone `&`** (POSIX background/sequence — `git add foo & git push origin
  main` runs both) was not in R1's chain-operator check, which only matched
  the two-character `&&`. The check is now a single character-class test
  for `&`, `;`, `|`, or a newline anywhere in the raw command — a bare `&`
  is exactly as disqualifying as `&&`.
- **`git add`** path tokens are now restricted to a closed character grammar
  (`[A-Za-z0-9._/-]` only, plus explicit rejection of the literal tokens
  `.` and `..`) — no `*`, `?`, `[`, `]`, `{`, `}`, `$`, `!`, `~`, or any
  other shell/glob metacharacter is accepted in a path token, and
  `-A`/`--all`/`-u` (or any flag at all) are rejected outright. `git add .`
  is deliberately denied: it stages far more than any task's declared
  scope should ever need.
- **`git commit -m`** now accepts only a **single-quoted** literal message
  (`git commit -m 'fix: ...'`) — double-quoted messages are denied
  unconditionally, regardless of content, because double quotes permit
  shell variable/command expansion (`"$SECRET"`, `` "$(cat file)" ``,
  `` "`whoami`" ``) in every shell this could plausibly run under. The
  message content itself is further restricted to a narrow safe character
  set (letters, digits, spaces, and `: - _ . / ( ) [ ]`), so even a
  single-quoted message containing `${SECRET}`-style text is still denied.
- **`pathsOverlap` global wildcards**: `tools/night-agent/queue.mjs`'s
  `pathsOverlap` now treats a bare `*`, `**`, or `**/*` as a distinct
  `GLOBAL` scope that overlaps every repo-relative path — R1's prefix-based
  model reduced these to an empty-string prefix, which incorrectly reported
  `pathsOverlap('*', 'foo.js')` as non-overlapping. A glob shape more
  complex than exact/prefix/global (e.g. a mid-string wildcard like
  `backend/**/secret/*.json`) is rejected at schema validation instead,
  since the conservative model cannot prove it disjoint from another scope.

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

**Production / GCP / external services — denied wholesale, not by subcommand**
- `gcloud` — every invocation, including read-only ones. This covers (not
  exhaustively, since it isn't needed to be) Cloud Run deploy/service
  mutation/traffic mutation, Cloud SQL instance mutation and Production
  migrations, Redis/Memorystore mutation, Secret Manager payload mutation,
  IAM policy mutation, resource deletion, billing, and DNS.
- `firebase` — every invocation, including `firebase deploy` and read-only
  `firebase projects:list`-style commands.
- `gh` — every invocation (PR merge/close, release creation, and read-only
  commands alike).
- `docker`, `kubectl`, `terraform` — every invocation.
- `psql`, `mysql`, `redis-cli` — every invocation. V1 never inspects SQL/
  command text to judge safety; the total absence of these clients is the
  boundary.
- Destructive SQL of any kind (`DROP`, `TRUNCATE`, unguarded `DELETE`, …) —
  moot in V1 since no DB client is reachable at all.

**Destructive filesystem**
- `rm`, `rmdir`, `del`, `Remove-Item`, and equivalents — denied entirely,
  not only when a `-rf`/`-Force`-looking flag is present. Night autonomous
  file editing (once it exists) must go through task-scoped editing tools,
  never shell deletion.

**Arbitrary interpreters / network fetch-and-run**
- `python`/`python3`/`perl`/`ruby`/`php` — every invocation.
- `curl`/`wget` — every invocation, not only the classic `| sh` / `| bash`
  pipe-to-shell pattern (a bare `curl https://...` is denied too).
- `ssh`/`scp`/`rsync` — every invocation.

**Credentials**
- Printing/echoing a secret or key.
- Committing a credential file.
- `claude` — every invocation from within a Night Mode Bash call (not just
  `--dangerously-skip-permissions`); this closes the whole family of
  permission-bypass flags by construction rather than enumerating them.

**Guard evasion**
- Any command chaining, piping, or backgrounding (`&`, `&&`, `||`, `;`,
  `|`, or a literal newline) — denied unconditionally in V1. The guard
  supports only one simple command per Bash tool call; this single rule
  closes the entire "hide a dangerous command behind a benign one" bypass
  class, including `curl ... | sh` / `wget ... | bash` and `git add foo &
  git push`, without needing a pipe-to-shell or ampersand special case.
- Shell indirection (`bash -c "..."`, `sh -c "..."`, `eval ...`,
  `powershell -Command`/`-EncodedCommand`, `cmd /c`), command substitution
  (`` $(...) ``, backticks), redirection (`<`, `>`), and any backslash
  escaping — all denied unconditionally, regardless of what they contain.
- Ambiguous or adversarial quoting (unbalanced quotes, a quote character
  concatenated directly against adjacent text, e.g. the `'g''i''t'` trick)
  — the guard denies rather than attempts to reassemble intent.
- The guard treats all of the above as a classification problem, not a
  blocklist problem: if a command cannot be confidently matched to a
  known-safe shape, it is denied as `UNCLASSIFIABLE_COMMAND` — see the
  "Guard model" section above and `.claude/hooks/night-guard.mjs`.

## Unlock path

None of the above is unlocked by this file. A future version may explicitly
document a narrower, separately authorized `YELLOW` unlock (e.g. push to
`agent/night/*` + Draft PR creation) — that unlock does not exist yet, and
`RED` items are never unlocked by a policy file alone; they require the same
per-action human authorization every other Production change in this
repository has always required.
