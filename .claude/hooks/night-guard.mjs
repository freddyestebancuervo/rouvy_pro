#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Korixa Night Agent — PreToolUse guard (NIGHT-V1-A-R3 hardened model).
//
// Dormant (no-op, exit 0, no output) unless KORIXA_NIGHT_MODE=1 in the
// environment of the process that launched Claude Code — see CLAUDE.md and
// .claude/overnight/SAFETY.md.
//
// SECURITY MODEL — DEFAULT_DENY ALLOWLIST (R1), now covering DELEGATED
// EXECUTION (R3): This guard does NOT try to enumerate every possible
// dangerous command. It enumerates a small, closed set of KNOWN-SAFE
// command shapes; anything not an exact match — unknown commands, ambiguous
// quoting, shell indirection, chaining, redirection, or a Bash command that
// itself delegates execution to a Git hook / attribute filter / npm-or-
// build-tool script (SAFE_OUTER_COMMAND != SAFE_EXECUTION_TREE, see
// SAFETY.md) — is denied. There is no "no deny pattern matched -> allow"
// path anywhere in this file, for Bash or for file-mutating tools:
//
//   for Bash (tool_name === "Bash"):
//     1. malformed/empty input                 -> DENY
//     2. any command chaining/piping/           -> DENY (one simple command
//        backgrounding operator                    per call only)
//     3. shell indirection / substitution /
//        redirection / backslash escaping       -> DENY (cannot be safely
//                                                  classified)
//     4. quoting that cannot be tokenized
//        unambiguously (unbalanced, or a quote
//        concatenated against adjacent text)     -> DENY
//     5. matches a known-SAFE command shape      -> ALLOW (a 3-entry
//                                                  allowlist as of R3 — see
//                                                  SAFE_MATCHERS below)
//     6. known-dangerous command family          -> DENY (explicit, for a
//                                                  clearer audit reason)
//     7. anything else                           -> DENY (UNCLASSIFIABLE_COMMAND)
//
//   for a file-mutating tool (Write, Edit, NotebookEdit — the current
//   built-in tool names per code.claude.com/docs/en/tools-reference.md):
//     always DENY (NIGHT_FILE_MUTATION_NOT_YET_SCOPED) — no task-scoped
//     enforcement exists yet anywhere in this codebase.
//
//   for any other tool_name: DENY (UNCLASSIFIABLE_COMMAND) — an unexpected
//   tool reaching this guard fails closed rather than passing through.
//
// Stdin/stdout/exit-code contract follows the official Claude Code
// PreToolUse hook schema (code.claude.com/docs/en/hooks.md, re-verified for
// R3): stdin is a JSON object with at least {session_id, cwd,
// hook_event_name, tool_name, tool_input}. To block, this hook exits with
// code 2 — the documented unconditional-block mechanism, which overrides
// any JSON "allow" — and writes the reason to BOTH channels the docs
// describe as read on exit 2: a structured JSON "reason" on stdout (read
// first) and the same generic reason on stderr (the documented fallback if
// the JSON is absent/invalid). To allow, it exits 0 with no output, leaving
// the normal permission flow untouched.
//
// The classification logic is exported as pure functions so tests can
// evaluate it directly as data, without spawning a subprocess or executing
// any real command.

// ---------------------------------------------------------------------------
// Known-dangerous command families — checked before the safe allowlist
// purely to produce a clearer denial reason. Removing this block would not
// weaken security: anything it catches is already outside the allowlist and
// would be denied as UNCLASSIFIABLE_COMMAND regardless.
// ---------------------------------------------------------------------------

const DANGEROUS_FIRST_TOKENS = new Set([
  'rm', 'rmdir', 'del', 'remove-item',
  'python', 'python3', 'perl', 'ruby', 'php', 'java',
  'ssh', 'scp', 'rsync',
  'docker', 'kubectl', 'terraform',
  'psql', 'mysql', 'mysqld', 'redis-cli',
  'gcloud', 'firebase', 'gh',
  'curl', 'wget',
  'claude',
  'powershell', 'cmd', 'bash', 'sh',
  // R3: delegated/repo-controlled execution — reconfirmed DENY (section
  // 15-18). Checked only after SAFE_MATCHERS (which still allows the exact
  // shape "node --version"), so adding the bare program name here does not
  // reintroduce the R2 "git branch" shadowing bug.
  'node', 'npm', 'npx', 'flutter', 'dart', 'gradle', 'gradlew', 'mvn', 'make', 'cmake',
]);

const GIT_DANGEROUS_SECOND_TOKENS = new Set([
  'push', 'reset', 'clean', 'checkout', 'switch', 'branch', 'tag',
  'update-ref', 'symbolic-ref', 'fetch', 'rm', 'merge', 'rebase',
  'cherry-pick', 'revert', 'stash',
  // R3: git add/commit/status/diff/log/show/ls-remote were removed from
  // SAFE_MATCHERS (delegated execution via hooks/filters/pager/textconv/
  // credential-helper) — added here so their denial reason names the
  // specific finding instead of falling through to the generic
  // UNCLASSIFIABLE_COMMAND message.
  'add', 'commit', 'status', 'diff', 'log', 'show', 'ls-remote',
]);

// Constructs that make a command unsafe to reason about at all: shell
// indirection, command substitution, redirection, or backslash escaping
// that could hide arbitrary behavior behind an opaque or reinterpreted
// string. Denied outright, regardless of visible content. Conservatively
// broad on purpose (e.g. any `<`/`>`/`\` denies) — see SAFETY.md.
const INDIRECTION_PATTERNS = [
  { id: 'BASH_DASH_C', pattern: /\bbash\s+-c\b/i },
  { id: 'SH_DASH_C', pattern: /\bsh\s+-c\b/i },
  { id: 'EVAL', pattern: /(^|\s)eval\b/i },
  { id: 'POWERSHELL_COMMAND', pattern: /\bpowershell\b[^\n]*-(command|encodedcommand)\b/i },
  { id: 'CMD_SLASH_C', pattern: /\bcmd\b[^\n]*\/c\b/i },
  { id: 'COMMAND_SUBSTITUTION', pattern: /\$\(|`/ },
  { id: 'REDIRECTION', pattern: /[<>]/ },
  { id: 'BACKSLASH_ESCAPING', pattern: /\\/ },
];

/**
 * Normalize a raw command string for matching: collapse repeated
 * whitespace (spaces/tabs only — newlines are rejected earlier, before
 * this runs) so extra-spaced variants of a safe command still match.
 * @param {string} command
 * @returns {string}
 */
export function normalize(command) {
  return command.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Split a raw command into tokens, respecting single/double-quoted spans as
 * one token each. This is intentionally not a full shell parser — it exists
 * only to let the guard recognize the small set of known-safe command
 * shapes below. Returns null (unclassifiable) when the input cannot be
 * tokenized unambiguously: an unbalanced quote, a quote character appearing
 * mid-bare-token, or a quoted span immediately butting up against more
 * non-whitespace text (the classic `'g''i''t'` concatenation trick that
 * real shells merge into one token but that no simple scan can reliably
 * distinguish from something more anodyne).
 * @param {string} command
 * @returns {{raw: string, quoted: boolean, quoteChar?: string, content?: string}[]|null}
 */
export function tokenize(command) {
  const tokens = [];
  const n = command.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(command[i])) i++;
    if (i >= n) break;
    const startChar = command[i];
    if (startChar === '"' || startChar === "'") {
      const quote = startChar;
      let j = i + 1;
      let content = '';
      let closed = false;
      while (j < n) {
        if (command[j] === quote) {
          closed = true;
          j++;
          break;
        }
        content += command[j];
        j++;
      }
      if (!closed) return null; // unbalanced quote
      if (j < n && !/\s/.test(command[j])) return null; // quote-concatenation trick
      tokens.push({ raw: command.slice(i, j), quoted: true, quoteChar: quote, content });
      i = j;
    } else {
      let j = i;
      let sawQuote = false;
      while (j < n && !/\s/.test(command[j])) {
        if (command[j] === '"' || command[j] === "'") {
          sawQuote = true;
          break;
        }
        j++;
      }
      if (sawQuote) return null; // quote appearing mid-bare-token: ambiguous
      tokens.push({ raw: command.slice(i, j), quoted: false });
      i = j;
    }
  }
  return tokens;
}

const GIT_REF_FLAG_TOKENS = new Set(['-1', '--oneline', '--stat', '--short', '--check', '--name-only']);
const GIT_REF_TOKEN_PATTERN = /^[A-Za-z0-9._/^~-]{1,200}$/;

// ---------------------------------------------------------------------------
// Known-SAFE command shapes — the entire allowlist. A command is ALLOWed if
// and only if it matches one of these exactly. Nothing else is ever
// allowed, regardless of how harmless it looks.
//
// R3: this list shrank sharply from R2. A third independent audit raised
// DELEGATED_EXECUTION — a Bash command can look inert while the program it
// invokes runs something else entirely (a Git hook, an attribute filter, an
// npm/flutter/dart script, a test file's own code). SAFE_OUTER_COMMAND !=
// SAFE_EXECUTION_TREE. Every matcher below was individually re-justified
// against that standard (see SAFETY.md's "R3: delegated execution" section
// for the officially-sourced verdict on each one); anything that couldn't
// be shown safe was removed rather than kept on the strength of R1/R2's
// weaker "it's just Git/just a test runner" reasoning:
//   - GIT_ADD, GIT_COMMIT_M: removed — `git add` can invoke a
//     `.gitattributes` clean/smudge/process filter; `git commit` can invoke
//     pre-commit/commit-msg/prepare-commit-msg hooks (the last of which
//     even survives `--no-verify`). No controlled Git writer exists yet.
//   - NODE_TEST, FLUTTER_ANALYZE, FLUTTER_TEST, NPM_TEST, NPM_RUN_BUILD:
//     removed — each one runs repository-controlled code (a test file, a
//     build/lint script, or an npm `scripts` entry, which npm's own docs
//     describe as an arbitrary shell command) with no sandbox around it.
//   - GIT_STATUS, GIT_LS_REMOTE: removed — `git status` can invoke an
//     external `core.fsmonitor` hook command; `git ls-remote` contacts a
//     remote and can invoke an external `credential.helper` program.
//   - "git log"/"git show" (previously bundled with rev-parse): removed —
//     both are explicitly named by Git's own docs as running `textconv`
//     attribute-driven external converters, plus `core.pager`.
//   - GIT_BRANCH_SHOW_CURRENT: removed — pager involvement could not be
//     confirmed excluded from official docs within this audit; unconfirmed
//     safety is treated as DENY, per this block's explicit bias.
//   - "git rev-parse" (kept, see GIT_REV_PARSE below) and NODE_VERSION are
//     the only two commands taking a repo/programmatic input that survive,
//     specifically because official docs describe no hook/filter/pager/
//     credential-helper involvement for either.
// ---------------------------------------------------------------------------

const SAFE_MATCHERS = [
  { id: 'PWD', test: (t) => t.length === 1 && t[0].raw === 'pwd' },
  { id: 'NODE_VERSION', test: (t) => t.length === 2 && t[0].raw === 'node' && t[1].raw === '--version' },
  {
    id: 'GIT_REV_PARSE',
    // Plumbing only: parses/resolves a revision locally. No documented
    // pager, hook, filter, textconv, or credential-helper involvement,
    // unlike log/show/status/diff/branch/ls-remote (all removed above).
    test: (t) => {
      if (t[0]?.raw !== 'git' || t[1]?.raw !== 'rev-parse') return false;
      if (t.length < 3) return false; // bare "git rev-parse" with no ref is ambiguous scope — require an explicit arg
      return t.slice(2).every(
        (tok) =>
          !tok.quoted &&
          (GIT_REF_FLAG_TOKENS.has(tok.raw) || (!tok.raw.startsWith('-') && GIT_REF_TOKEN_PATTERN.test(tok.raw))),
      );
    },
  },
];

/**
 * Classify a single Bash command string under the DEFAULT_DENY allowlist
 * model. There is no branch in this function that returns "allow" except by
 * matching one of SAFE_MATCHERS exactly.
 * @param {unknown} command
 * @returns {{decision: 'allow'|'deny', reason: string, family: string|null}}
 */
export function classifyCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { decision: 'deny', reason: 'UNCLASSIFIABLE_COMMAND: empty or non-string command', family: 'UNCLASSIFIABLE_COMMAND' };
  }

  // Chaining/piping/backgrounding/newlines are checked on the RAW string,
  // before any whitespace collapsing, so a literal newline (a second
  // command on its own line) is never lost. V1 supports only a single
  // simple command per Bash tool call — this closes the entire "hide a
  // second command behind a benign first one" bypass class in one
  // conservative rule. This is a single character-class test, not a list
  // of two-character operator strings: a lone `&` (background/sequence in
  // POSIX shells — "git add foo & git push origin main" runs both) is just
  // as much a chain operator as `&&`, and checking for the character alone
  // catches both without needing separate cases (R2: the original `&&`-only
  // pattern let a bare `&` through — see SAFETY.md).
  if (/[\n&;|]/.test(command)) {
    return {
      decision: 'deny',
      reason: 'UNCLASSIFIABLE_COMMAND: command chaining/piping/backgrounding (&, &&, ||, ;, |, or a newline) is not supported by the Night Guard in V1 — one simple command per call only',
      family: 'UNCLASSIFIABLE_COMMAND',
    };
  }

  const whole = normalize(command);

  for (const { id, pattern } of INDIRECTION_PATTERNS) {
    if (pattern.test(whole)) {
      return {
        decision: 'deny',
        reason: `UNCLASSIFIABLE_COMMAND: contains shell indirection/redirection/escaping (${id}) that cannot be safely classified`,
        family: 'UNCLASSIFIABLE_COMMAND',
      };
    }
  }

  const tokens = tokenize(whole);
  if (!tokens || tokens.length === 0) {
    return {
      decision: 'deny',
      reason: 'UNCLASSIFIABLE_COMMAND: quoting could not be tokenized unambiguously',
      family: 'UNCLASSIFIABLE_COMMAND',
    };
  }

  // The safe allowlist is checked FIRST and is authoritative (section 21 of
  // the NIGHT-V1-A-R3 contract): shell structural hazards (chaining,
  // indirection, quoting ambiguity, all above) are eliminated before this
  // point, so a SAFE_MATCHERS match here is never in doubt. "Known-
  // dangerous" below is only ever consulted for commands that did NOT match
  // the allowlist, purely to produce a more specific denial reason than
  // generic UNCLASSIFIABLE_COMMAND — being a safe-matcher *candidate* never
  // lets a command skip the structural gates above it.
  for (const { id, test } of SAFE_MATCHERS) {
    if (test(tokens)) {
      return { decision: 'allow', reason: `matched known-safe command family ${id}`, family: id };
    }
  }

  const firstLower = tokens[0].quoted ? '' : tokens[0].raw.toLowerCase();
  if (DANGEROUS_FIRST_TOKENS.has(firstLower)) {
    return {
      decision: 'deny',
      reason: `KNOWN_DANGEROUS_COMMAND: "${firstLower}" is not permitted by the Night Guard allowlist`,
      family: 'KNOWN_DANGEROUS_COMMAND',
    };
  }
  if (firstLower === 'git' && !tokens[1]?.quoted && GIT_DANGEROUS_SECOND_TOKENS.has((tokens[1]?.raw ?? '').toLowerCase())) {
    return {
      decision: 'deny',
      reason: `KNOWN_DANGEROUS_COMMAND: "git ${tokens[1].raw}" mutates refs/history and is not permitted by the Night Guard allowlist`,
      family: 'KNOWN_DANGEROUS_COMMAND',
    };
  }

  return {
    decision: 'deny',
    reason: 'UNCLASSIFIABLE_COMMAND: command did not match any known-safe family in the Night Guard allowlist',
    family: 'UNCLASSIFIABLE_COMMAND',
  };
}

// Current built-in file-mutating tool names (R3), confirmed against
// code.claude.com/docs/en/tools-reference.md — not invented. All three are
// always denied in Night Mode: see evaluate() below.
const FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/**
 * Evaluate a full PreToolUse hook input object per the official schema.
 * Pure function — no I/O, no process access — so it can be unit tested
 * directly. `nightModeActive` is passed in explicitly rather than read from
 * `process.env` here, so tests do not need to fork a process to exercise
 * both dormant and active branches.
 * @param {any} hookInput
 * @param {boolean} nightModeActive
 * @returns {{active: boolean, decision: 'allow'|'deny'|null, reason: string|null, family: string|null}}
 */
export function evaluate(hookInput, nightModeActive) {
  if (!nightModeActive) {
    return { active: false, decision: null, reason: null, family: null };
  }

  if (
    hookInput === null ||
    typeof hookInput !== 'object' ||
    hookInput.hook_event_name !== 'PreToolUse'
  ) {
    return {
      active: true,
      decision: 'deny',
      reason: 'UNCLASSIFIABLE_COMMAND: malformed or unexpected hook input in Night Mode',
      family: 'UNCLASSIFIABLE_COMMAND',
    };
  }

  // R3: file-mutating built-in tools (confirmed current names, per
  // code.claude.com/docs/en/tools-reference.md) are always denied in Night
  // Mode — path-scoped enforcement (a task's allowed_paths) does not exist
  // yet anywhere in this codebase, so there is no way to tell "an edit
  // inside this task's declared scope" from "an edit anywhere." The reason
  // is a fixed, generic family string; tool_input (file_path, content,
  // notebook cell data, etc.) is never read or echoed here.
  if (FILE_MUTATING_TOOLS.has(hookInput.tool_name)) {
    return {
      active: true,
      decision: 'deny',
      reason: 'NIGHT_FILE_MUTATION_NOT_YET_SCOPED: file-mutating tools are denied in Night Mode until path-scoped enforcement exists',
      family: 'NIGHT_FILE_MUTATION_NOT_YET_SCOPED',
    };
  }

  if (hookInput.tool_name !== 'Bash') {
    // Any tool_name that is neither Bash nor a known file-mutating tool is
    // unexpected for this guard's registered matchers; fail closed rather
    // than silently allow an unrecognized tool through.
    return {
      active: true,
      decision: 'deny',
      reason: `UNCLASSIFIABLE_COMMAND: unexpected tool_name "${String(hookInput.tool_name)}" for this hook`,
      family: 'UNCLASSIFIABLE_COMMAND',
    };
  }

  const command = hookInput.tool_input && hookInput.tool_input.command;
  const result = classifyCommand(command);
  return { active: true, decision: result.decision, reason: result.reason, family: result.family };
}

// ---------------------------------------------------------------------------
// Hook process entrypoint (stdin/stdout/exit-code wiring). Only runs when
// this file is executed directly, not when imported by tests.
// ---------------------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function denyAndExit(reason) {
  // Exit code 2 is the documented unconditional PreToolUse block. R3
  // re-verified this directly against current code.claude.com/docs/en/
  // hooks.md text (not memory): "exit 2 blocks whether or not you print
  // JSON... Claude Code still reads any valid JSON output on stdout,"
  // and "the blocking message is the reason from your JSON's blocking
  // decision when it makes one, and your stderr text otherwise." So JSON
  // stdout IS read on exit 2 (first priority) with stderr as the documented
  // fallback — both channels are written here so the reason surfaces
  // either way. (A later, unverified claim asserted the opposite — that
  // stdout/JSON is ignored on exit 2 — but that contradicts the quoted
  // current docs, so it was not implemented; see SAFETY.md.)
  //
  // `reason` is ALWAYS a fixed, generic, pre-written string identifying the
  // decision family (e.g. "UNCLASSIFIABLE_COMMAND: ...") — never the raw
  // command text. The command itself may contain a secret (a token in an
  // env var reference, a connection string, a credential path); this
  // function has no caller that passes it one, and must never be given one.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.stderr.write(`NIGHT_GUARD_DENY: ${reason}\n`);
  process.exit(2);
}

async function main() {
  const nightModeActive = process.env.KORIXA_NIGHT_MODE === '1';

  if (!nightModeActive) {
    // Dormant: no decision, no output, exit 0. Daytime sessions are
    // completely unaffected by this hook's presence.
    process.exit(0);
    return;
  }

  // Fail closed around EVERYTHING while Night Mode is active — not just
  // JSON.parse. Any unexpected internal exception (a bug in this file, an
  // unforeseen input shape) must block the tool call, never silently let it
  // through via an uncaught exception producing a non-blocking exit code.
  try {
    let hookInput;
    try {
      const raw = await readStdin();
      hookInput = JSON.parse(raw);
    } catch {
      denyAndExit('UNCLASSIFIABLE_COMMAND: guard could not parse hook input JSON while Night Mode is active');
      return;
    }

    const result = evaluate(hookInput, true);
    if (result.decision === 'deny') {
      denyAndExit(result.reason);
      return;
    }

    // Allow: no decision emitted, normal permission flow proceeds.
    process.exit(0);
  } catch (err) {
    denyAndExit(`INTERNAL_GUARD_ERROR: ${err && err.message ? err.message : 'unknown error'} — failing closed`);
  }
}

// Only run when invoked as a script (not when imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
