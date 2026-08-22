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

## NIGHT-V1-B: controlled GREEN execution — task-scoped Write/Edit/Read

R1-R4 built a purely DEFENSIVE foundation: every file-touching tool was
denied unconditionally, because nothing in the codebase could tell "an edit
inside this task's declared scope" from "an edit anywhere." B adds that
missing piece — an **ACTIVE POLICY** file, and task-scoped enforcement in
the guard — without enabling any real autonomous execution yet.

**The active policy.** A future controller (`tools/night-agent/runner.mjs`,
not yet wired to spawn anything real) would write a small JSON file
*outside* the repository (`os.tmpdir()`, a random/unpredictable name) with
exactly these fields: `version`, `task_id`, `repo_root`, `base_sha`,
`read_paths`, `allowed_paths`, `created_at`, `nonce`. No secrets, no
credentials, no prompt text. The child process is told where it is via two
environment variables: `KORIXA_NIGHT_MODE=1` and
`KORIXA_NIGHT_POLICY_FILE=<absolute path>`. The guard
(`isValidActivePolicy` in `night-guard.mjs`) rejects a policy with even one
unexpected field outright — a smuggled-in credential fails validation, it
is never silently ignored and passed through.

**Write / Edit**: denied unless a valid active policy is present AND the
target resolves to a path inside the repo, is not a critical control-plane
path, is within the policy's `allowed_paths`, has no symlink/junction
escape, and passes filesystem realpath containment — see
`tools/night-agent/path-safety.mjs`'s `isSafeWriteTarget`. No policy at all
(the R1-R4 default) still denies everything, exactly as before.

**Read**: same shape, checked against `read_paths` via `isSafeReadTarget`,
which additionally requires the target to already exist.

**Glob / Grep**: denied unless an EXPLICIT path is given (an omitted path
is never treated as "search everywhere") and that path is within
`read_paths`.

**NotebookEdit**: denied unconditionally in V1-B, regardless of any policy
— notebooks are out of scope.

**Critical control-plane paths** (`.claude/**`, `tools/night-agent/**`,
`.github/workflows/**`, `.git/**`, `.gitattributes`, `.gitmodules`,
`package.json`, `package-lock.json`, `pubspec.yaml`, `pubspec.lock`) are
never writable by an autonomous task, even if a task's `allowed_paths`
would accidentally cover them — `tools/night-agent/queue.mjs`'s schema
validation rejects such a task before it could ever run, and the guard
checks the same rule independently as a second barrier.

**Realpath containment and symlink/junction safety**
(`tools/night-agent/path-safety.mjs`): a lexical path check alone cannot
see a symlink or Windows junction redirecting a path outside the repo.
`hasUnsafeSymlinkComponent` walks the existing path components looking for
one, and `realpathContainment` independently confirms the target's (or its
nearest existing ancestor's) real filesystem path resolves inside the
repo's real path — two independent barriers, either of which alone would
catch `repo/backend/link -> outside` where `link` is a symlink/junction.

**Path canonicalization tightened further**: the R4 trailing-slash
exception (`backend/`, kept only because `TASK_QUEUE.example.json` used
it) is retired — the fixture was migrated to `backend/**` in this same
block, so there is now exactly one canonical form. Windows reserved device
names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, with or
without an extension) are rejected as path segments.

**Tool surface for a future autonomous child**: `Bash` is deliberately
absent from the restricted tool set
(`tools/night-agent/executor.mjs`'s `RESTRICTED_AUTONOMOUS_TOOLS` = `Read`,
`Glob`, `Grep`, `Write`, `Edit`) — not merely denied by the guard, but never
even offered to the child via the confirmed current `--tools` CLI flag
(which restricts actual tool *availability*, unlike `--allowedTools`, which
only pre-approves). Without a shell, the child cannot invoke
`git`/`npm`/`flutter`/`gcloud`/`gh`/any script regardless of what the guard
would otherwise classify. `--permission-mode dontAsk` denies anything not
pre-approved without prompting; `--dangerously-skip-permissions` (and any
`bypassPermissions` mode value) is scanned for and rejected in every
generated argv before it would ever be spawned
(`assertSafeArgvOrThrow`).

**Exit-2 contract simplified further**: `denyAndExit` now writes ONLY a
generic, fixed reason to stderr on deny — the R1-R4 structured-JSON-on-
stdout channel is dropped. Both forms remain valid per current official
docs (JSON-on-stdout is read and takes priority when present; stderr is
the documented fallback) — this is not a correction of something wrong,
just a simplification so the security-relevant contract
(`EXIT_CODE_2` + `STDERR`) never has any dependency on stdout content at
all, matching the exact pattern shown in the official docs' own exit-2
example. Internal exceptions no longer include `err.message` (or any other
dynamic content) in hook output, for the same reason a denial reason is
always a fixed string: an internal error's message could itself contain a
path, a stderr fragment, or worse.

**`--execute-green` remains a real, but permanently stubbed, code path.**
`tools/night-agent/runner.mjs`'s `runExecuteGreen` requires BOTH the
`--execute-green` CLI flag AND `KORIXA_NIGHT_EXECUTION=1` in the
environment — neither alone is sufficient. Even when both are satisfied,
the actual execution step (`executeTaskFn`) defaults to a stub that
returns `HOLD_NOT_IMPLEMENTED_IN_V1_B` and spawns nothing; a real
implementation is a distinct, future, separately-authorized change.
`CLAUDE_AGENT_RUNS = 0` for the entirety of this block.

**No autonomous Git writer.** `git add`/`git commit`/`git push` remain
denied in Night Mode exactly as R3 left them — B builds a SAFE EDIT ENGINE,
not a publication mechanism. Even a fully successful (hypothetical) GREEN
edit is never followed by an autonomous commit in this codebase today.

## NIGHT-V1-C: the controlled-execution pipeline is wired, but locked by a THIRD gate

B built task-scoped Write/Edit/Read enforcement in the guard but left
`--execute-green`'s actual execution step a permanent stub. C wires the real
pipeline — `executeControlledGreenTask` in `tools/night-agent/runner.mjs`:
TASK -> temporary ACTIVE POLICY -> CHECKPOINT `RUNNING` -> controlled
executor (`runControlledChild`) -> RESULT -> CHECKPOINT final state ->
POLICY CLEANUP (always, via `finally` — success, failure, timeout, or spawn
error alike) — but this is wiring, not an unlock. Nothing in this
repository's real CLI path can reach a live spawn.

**The triple execution lock.** Real execution now requires THREE
simultaneous conditions, not two: the `--execute-green` CLI flag, the
existing `KORIXA_NIGHT_EXECUTION=1` environment variable, AND a new, further
`KORIXA_NIGHT_REAL_SPAWN=1` environment variable
(`isTripleExecutionLockSatisfied`). This is checked FIRST, inside
`executeControlledGreenTask` itself — before creating a policy file, before
writing a checkpoint, before building any argv — so an unsatisfied lock
produces zero side effects, not merely "no spawn." No code path anywhere in
this codebase ever sets `KORIXA_NIGHT_REAL_SPAWN`; it exists only as a
manual, out-of-band switch a human would set explicitly and separately from
everything this repository's own code controls. `REAL_CLAUDE_AGENT_RUNS = 0`
for the entirety of NIGHT-V1-C, enforced by this gate, not merely
documented.

**`--allowedTools` added alongside `--tools`.** Current official docs were
re-confirmed for this block: `--tools` restricts actual tool *availability*
(one comma-joined value); `--allowedTools` pre-approves tool use (a
SEPARATE argv token per tool name — its own documented convention, not
comma-joined). `buildClaudeArgv` now emits both, expressing the identical
restricted 5-tool set (`Read`, `Glob`, `Grep`, `Write`, `Edit` — still no
`Bash`) in each flag's own native syntax. `assertSafeArgvOrThrow` — the
gate re-checked immediately before every spawn, regardless of how the argv
was built — now also requires `--allowedTools` to be present and to express
EXACTLY the same set as `--tools`; a diverging or missing `--allowedTools`
throws before any spawn, the same defense-in-depth principle as the
existing dangerous-bypass-flag scan.

**The temporary active policy is now really created (when unlocked).**
`createTemporaryActivePolicy` writes it under `os.tmpdir()` (never inside
the repository) with an unpredictable filename (`crypto.randomBytes`, never
`Math.random` or a task-id-derived name alone), atomically (temp file in the
same directory, then `renameSync` over the final path — the same pattern
`checkpoint.mjs`'s `writeCheckpointAtomic` already uses). It is removed
unconditionally in a `finally` block — success, a nonzero-exit child
failure, a timeout, or a spawn error all lead to the same cleanup, proven by
one test per scenario, all using an injected fake child/spawn.

**No new architecture beyond wiring these three objectives.** No retry-
budget loop across multiple attempts (a single `executeControlledGreenTask`
call is one attempt only — mapping a raw execution outcome to a
multi-attempt retry decision remains a distinct, future concern), no
controlled Git writer, no publication path, no Production access. `git
add`/`git commit`/`git push` remain denied in Night Mode exactly as before.

## NIGHT-V1-D: pre-real-run safety closure

C wired the controlled-execution pipeline but left several gaps a real
first GREEN run would need closed. D closes exactly five, and only five —
no Git writer, no auto-commit/push, no PR automation, no multi-agent, no
scheduler, no Production/Cloud access, no new queue system, no new
`verification_commands` format, no new permission system:

**1. `verification_commands` now drive the real result.**
`runVerificationCommand`/`runAllVerificationCommands`
(`tools/night-agent/runner.mjs`) reuse `queue.mjs`'s ALREADY-CLOSED
`VALID_VERIFICATION_FAMILIES` (`NODE_TEST`, `NODE_VERSION`, `PWD`) exactly —
no new family. Each command is mapped to a safe argv array (never a raw
shell string), run with `shell: false`, cwd `repoRoot`, and a bounded
timeout. `NODE_TEST`'s target is re-verified (defense in depth, beyond
`queue.mjs`'s own schema-time check) against the task's own
`allowed_paths`/`read_paths` via `isRepoRelativePath`/`isPathWithinScope` —
a target outside the task's own scope fails closed
(`VERIFICATION_TARGET_OUT_OF_SCOPE`), never spawned. `PWD` is a direct
filesystem check (`existsSync(repoRoot)`), not a spawn — there is no
portable, shell-free `pwd` executable to invoke consistently across
platforms. Raw stdout/stderr from a verification command is captured only
transiently in local scope and is NEVER returned or persisted — only a
PASS/FAIL boolean and a fixed, generic error family.

**2. `checkPostExecutionScope` is now wired to REAL Git output.**
`getGitStatusPaths` runs a real `git status --porcelain=v1 -z
--untracked-files=all` (argv array, `shell: false`), and
`parseGitStatusPorcelainZ` parses the NUL-separated output correctly —
including paths containing spaces, and rename/copy entries' extra
NUL-terminated original-path field — without ever line-splitting on
whitespace. The resulting path list is passed to the SAME
`checkPostExecutionScope` function from NIGHT-V1-B/C, not duplicated. This
runs TWICE per successful child (before verification and after) — an
unauthorized finding at either point is `HOLD`, unconditionally, and the
unauthorized paths are reported in the result but never written into the
checkpoint (whose field set stays exactly as closed as ever).

**3. The checkpoint is now persistent and recoverable across a process
restart.** See `POLICY.md`'s "NIGHT-V1-D" section for
`resolveCheckpointPath`/`resolveCheckpointRecoveryDecision`'s full
semantics. The checkpoint directory (under `os.tmpdir()`, never inside the
repo) is created only at the moment of an actual WRITE
(`writeCheckpointAtomic`'s own `mkdirSync`) — a mere path resolution or read
lookup never creates anything.

**4. CLI telemetry and exit code are now truthful, not hardcoded.**
`REAL_CHILD_SPAWN` reflects `executeControlledGreenTask`'s own
`realChildSpawn` flag (`true` from the moment a spawn is actually
attempted, `false` for every gate-blocked outcome) rather than a fixed `0`
print statement. `resolveExitCode` maps `PASS` to exit `0` and every other
outcome — `RETRY`, `HOLD` (of any family), a validation failure, a
gate-locked result — to a non-zero exit, replacing the previous
unconditional `process.exit(1)`.

**5. A Night Guard installation preflight, before any real execution.**
`checkNightGuardInstalled` confirms — read-only, never modifying
`.claude/settings.json` or the guard file — that `.claude/settings.json`
exists and parses as valid JSON, that `.claude/hooks/night-guard.mjs`
exists, and that `settings.json`'s `hooks.PreToolUse` array structurally
registers a `command`-type hook whose `args` (or, tolerantly, a single
shell-string `command`) actually names `night-guard.mjs` — not merely that
the guard file happens to exist on disk somewhere. Any gap (`SETTINGS_MISSING`,
`SETTINGS_INVALID_JSON`, `GUARD_FILE_MISSING`, `PRETOOLUSE_MISSING`,
`GUARD_NOT_REGISTERED`) is `HOLD_NIGHT_GUARD_NOT_INSTALLED`, checked before
any policy/checkpoint/spawn.

**Also closed, as prerequisites for the above:** a task-worktree-clean gate
(`checkWorktreeClean`, the same real `git status` machinery as #2) —
tracked modifications, deletions, untracked files, and renames/copies all
count as dirty, and the worktree is never cleaned/reset/stashed by this
codebase, only read; a `verification_commands`-present requirement for any
task actually reaching real execution (`HOLD_NO_VERIFICATION_COMMANDS` if
empty — historical `--validate`/`--dry-run` fixtures that deliberately ship
no verification commands are unaffected, since this gate only applies to
the real `--execute-green` pipeline); and the budget-aware
`decideRetryOrHold` helper, which makes a child failure OR a verification
failure `RETRY` only while budget remains and `HOLD` once exhausted — an
unauthorized-scope finding is EXEMPT from this budget check and is always
`HOLD`, on the reasoning that "the same failure keeps recurring" (what a
retry budget exists to bound) does not apply to "an unexpected file was
touched," which needs human review regardless of how many retries remain.

**The triple execution lock is unchanged in substance, strengthened in
placement** — see `POLICY.md`'s "NIGHT-V1-C/D" section. `REAL_CLAUDE_AGENT_RUNS`
stays `0` for the entirety of NIGHT-V1-D: nothing in this block's own code
ever sets `KORIXA_NIGHT_REAL_SPAWN`, and every test exercising the "3/3
unlocked" path does so by passing the gate values directly to a function
call, always paired with an injected fake `spawnFn` — never against the
real CLI entrypoint.

## NIGHT-V1-D-R1: the explicit TARGET HEAD gate

D's clean-worktree gate proves the worktree has no uncommitted changes — it
does NOT prove the worktree is sitting at the commit an operator actually
authorized for this specific execution. A clean worktree on the WRONG
commit is still clean. R1 closes this gap with a REQUIRED, explicit
`--target-head <40-char-sha>` CLI argument (see `POLICY.md`'s
"NIGHT-V1-D-R1" section for the full provenance rationale) — never inferred
from the worktree's own `git rev-parse HEAD`, since that would silently
convert "whatever commit happens to be checked out" into "authorized."

`runExecuteGreen` requires the argument, validates its format
(`isValidTargetHeadSha` — exactly 40 hex characters, case-insensitive), and
compares it against a REAL, freshly-resolved `git -C <repoRoot> rev-parse
HEAD` (`resolveLocalHeadSha`, argv array, `shell: false`, via
`checkTargetHeadFn`/`checkTargetHead`). This happens immediately after the
remote-main gate and strictly before `executeTaskFn` is ever called — a
missing, malformed, mismatched, or unresolvable target head all produce
zero side effects: no policy file, no checkpoint write, no spawn attempt,
and the child's own worktree-clean gate is never even reached (proven by a
dedicated integration test using the REAL `executeControlledGreenTask` with
a spy on `checkWorktreeCleanFn`).

`REMOTE_MAIN_FROZEN` and `TARGET_HEAD` are independent invariants that may
legitimately hold different SHA values simultaneously — the remote-main
gate answers "has the authorized base moved since this queue was written,"
while the target-head gate answers "is THIS worktree, right now, at the
EXACT commit this specific execution was authorized against." Both must
PASS; neither substitutes for the other.

## Unlock path

None of the above is unlocked by this file. A future version may explicitly
document a narrower, separately authorized `YELLOW` unlock (e.g. push to
`agent/night/*` + Draft PR creation) — that unlock does not exist yet, and
`RED` items are never unlocked by a policy file alone; they require the same
per-action human authorization every other Production change in this
repository has always required.
