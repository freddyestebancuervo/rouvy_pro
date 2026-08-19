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
of known-**safe** command shapes; a command is allowed **only** if it
matches one of those shapes exactly. Everything else — unknown commands,
ambiguous quoting, shell indirection, chaining, redirection, or (as of R3)
a command that delegates execution to something the guard cannot see — is
denied as `UNCLASSIFIABLE_COMMAND`. There is no code path in the guard that
returns "allow" because "no deny pattern matched"; see
`.claude/hooks/night-guard.mjs`'s header comment for the exact decision
order.

A practical consequence: `gcloud`, `firebase`, and `gh` are denied
**entirely** in V1 — including harmless-looking read-only invocations like
`gcloud config list` or `gh repo view` — rather than maintaining a partial
list of "which subcommands are dangerous." The same applies to `docker`,
`kubectl`, `terraform`, and every database client (`psql`, `mysql`,
`redis-cli`): V1 has no legitimate need to invoke any of them, so their
total absence from the allowlist *is* the safety boundary, not an attempt to
distinguish a safe invocation from a dangerous one.

**As of R4, the allowlist is exactly three command shapes**: `pwd`,
`node --version`, and `git rev-parse <ref>` (`<ref>` restricted to `HEAD`
with 0-4 carets, or a 7-40 char hex SHA — see "R4: tool-surface and path
canonicalization" below). `git add`/`git commit` (R1/R2 primitives) are
gone entirely — see "R3: delegated execution" below. There is no
controlled Git writer yet, autonomous or otherwise:
`EXECUTION_ENGINE = DISABLED_IN_V1_A`.

## R4: tool-surface catch-all and path canonicalization

A fourth independent audit found the guard's *reach* was incomplete even
though its Bash logic was sound: `.claude/settings.json` only registered
the guard for `Bash` and `Write|Edit|NotebookEdit` — any other tool
(`PowerShell`, `Monitor`, `Agent`, or a name that doesn't exist yet) would
never invoke the hook at all, so `evaluate()`'s fail-closed handling for an
"unexpected" `tool_name` was unreachable dead code for those tools, not a
real protection.

**Tool-surface catch-all.** Current official docs (`code.claude.com/docs/
en/hooks.md`) confirm a `matcher` of `"*"` (also `""` or an omitted field)
matches every tool. `.claude/settings.json` now registers exactly **one**
`PreToolUse` entry with `"matcher": "*"`, invoking the guard for anything
Claude Code can call. `evaluate()`'s policy for a non-Bash `tool_name` is a
closed rule, not an enumeration: **any tool that isn't `"Bash"` is denied**
(`NIGHT_TOOL_NOT_YET_SCOPED`), whether or not the guard has ever heard its
name. `Write`/`Edit`/`NotebookEdit` keep a more specific reason
(`NIGHT_FILE_MUTATION_NOT_YET_SCOPED`) purely for a clearer audit message —
removing that naming would not change the security outcome, since the
catch-all denies them regardless. Current command-execution-capable tools
beyond Bash — `PowerShell` (executes PowerShell commands), `Monitor` (runs
a script and streams its output), `Agent` (spawns a subagent that inherits
tool access, including Bash/PowerShell) — were confirmed present in
current docs and are denied by this same rule.

**Hook invocation form.** `.claude/settings.json` now uses the confirmed
current split `command`+`args` exec form (`"command": "node", "args":
["${CLAUDE_PROJECT_DIR}/.claude/hooks/night-guard.mjs"]`) rather than a
single shell-string command — per current docs, this spawns the executable
directly with no shell involved, so `${CLAUDE_PROJECT_DIR}` is substituted
as a plain string argument rather than being subject to any shell
re-interpretation.

**Exit-2 contract remains channel-redundant, not JSON-dependent.** R4 does
not change `denyAndExit`: it already writes both a structured JSON reason
to stdout and a generic reason to stderr on every deny, and blocking itself
is driven by the exit code alone (`2`), never by whether JSON was written
or parsed successfully. This already satisfies "blocking must not depend
on JSON stdout" — removing the JSON channel would only make the *reason*
(not the block) potentially less informative in one specific fallback path
documented for malformed JSON, so it was kept rather than stripped.

**`git rev-parse` hardening.** R1-R3 accepted any ref-shaped token matching
a broad character class (letters, digits, `._/^~-`), which — while not
independently found to be exploitable, since a leading `-` was already
excluded from that branch — was more permissive than the project actually
needs. R4 replaced it with a closed grammar: `HEAD` with 0-4 carets, or a
7-40 character hex SHA, no flags at all. Branch/remote-ref names (e.g.
`origin/main`, previously allowed) are intentionally no longer matched —
tightening, not a regression.

**Path canonicalization.** `isRepoRelativePath` (`tools/night-agent/
queue.mjs`) now rejects every non-canonical alias for a scope: a leading
`./`, an internal `//`, a `/./` segment, embedded whitespace, a trailing
dot in a segment, a colon, ASCII control characters, and the bare strings
`.`/`..`. The one deliberate exception is a trailing slash (`backend/`):
`TASK_QUEUE.example.json` (outside R4's authorized file scope) already
uses this form in `forbidden_paths`, and migrating that fixture is not
authorized in this block — rejecting it here would have required
`HOLD_SCOPE_EXPANSION` on the whole block for one cosmetic form, so it
remains an accepted directory-prefix form pending a future block that is
authorized to touch the fixture.

**Windows case-insensitive conflict detection.** `pathsOverlap` now
lowercases both sides before comparing (internal to the comparison only —
`findPathConflicts` still reports the original, unmodified casing), so
`"Backend"` and `"backend/src/main.ts"` are treated as a potential
conflict. False positive across platforms is acceptable; a false negative
on the Windows filesystem this project actually runs on is not.

## R3: delegated execution — a third independent audit's core finding

A third audit identified a deeper boundary than R1/R2 addressed:
**SAFE_OUTER_COMMAND != SAFE_EXECUTION_TREE**. A Bash command can look
completely inert to the guard while the program it invokes runs something
else entirely — a Git hook, a `.gitattributes` filter, a pager/textconv/
fsmonitor/credential-helper program, or repository-controlled script code.
Official documentation was consulted directly for every claim below (not
memory); citations are the exact mechanism names so they can be
independently re-checked.

- **`git commit`**: can invoke `pre-commit`, `commit-msg`, and
  `prepare-commit-msg` hooks (per `git-scm.com/docs/githooks`). The first
  two are skipped by `--no-verify`; `prepare-commit-msg` explicitly is
  **not** — R3 does not implement a controlled Git writer around this, so
  `git commit` is denied entirely rather than relying on a flag that
  doesn't cover every hook.
- **`git add`**: can invoke a `.gitattributes`-declared `filter.<driver>.
  clean` (or `.process`) command during check-in (per
  `git-scm.com/docs/gitattributes`) — R2's path-token character grammar
  made the *path* safe, but never addressed that the file's *content* can
  still be piped through an external filter program. `git add` is denied
  entirely.
- **`git status`**: can invoke an external `core.fsmonitor=<hook-command>`
  program.
- **`git diff` / `git log` / `git show`**: `git log`/`show` (and `diff`) are
  explicitly named by Git's attribute docs as running `textconv` external
  converters; `git diff` additionally honors `GIT_EXTERNAL_DIFF`. All three
  also route through `core.pager`.
- **`git branch --show-current`**: pager involvement could not be confirmed
  *excluded* from official docs within this audit's time budget —
  unconfirmed safety is treated as `DENY` per this project's explicit bias
  (`.claude/hooks/night-guard.mjs`'s R3 header comment has the full
  per-matcher accounting).
- **`git ls-remote`**: contacts a remote and can invoke an external
  `credential.helper` program.
- **`node --test`, `npm test`, `npm run <script>`, `flutter analyze`,
  `flutter test`, `dart test`/`run`**: each executes repository-controlled
  code (a test file's own JavaScript/Dart, or an npm `scripts` entry —
  which `docs.npmjs.com` describes plainly as an arbitrary shell command)
  with no sandbox around it. None of these are shell-structural problems;
  each is a delegated-execution problem R3 has no answer for yet.

**What survived**: `git rev-parse <ref>` (pure local plumbing — no
documented hook/filter/pager/textconv/credential-helper involvement) and
`node --version` (prints a version string, no repository-controlled input).
Both plus `pwd` are the entire R3 allowlist. A future version may reinstate
a narrower form of some of the above once a real controlled-execution
sandbox or controlled Git writer exists — neither does today.

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

**Claude built-in file-mutating tools (R3)**
- `Write`, `Edit`, `NotebookEdit` — the current built-in tool names per
  `code.claude.com/docs/en/tools-reference.md` — are denied unconditionally
  in Night Mode, with the fixed generic reason
  `NIGHT_FILE_MUTATION_NOT_YET_SCOPED`. The guard is registered for these
  tools via a `Write|Edit|NotebookEdit` matcher in `.claude/settings.json`
  (current supported pipe-separated multi-tool matcher syntax), alongside
  the existing `Bash` matcher. Neither the file_path nor the content/edit
  payload is ever read or echoed in the denial reason. This exists because
  a Bash-only guard leaves these tools completely unguarded — until a
  task's `allowed_paths` can actually be enforced against a real edit,
  Night Mode has no basis to allow any file mutation at all.

**Future control-plane sensitive paths (documented, not yet enforced)**
- `.claude/**`, Git hook/`core.hooksPath` configuration, `.gitattributes`,
  `.gitmodules`, `package.json`/`package-lock.json`,
  `pubspec.yaml`/`pubspec.lock`, and any workflow/config file capable of
  changing execution behavior are flagged here as paths a future task-scope
  engine must treat specially. R3 does not build that engine. The policy
  requirement going forward: any task whose `allowed_paths` would touch one
  of these must `HOLD` until an explicit future gate defines how such tasks
  are reviewed — this is not automatically enforced by any code yet, only
  documented as a requirement.

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
