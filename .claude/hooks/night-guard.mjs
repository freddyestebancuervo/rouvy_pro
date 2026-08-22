#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { isSafeWriteTarget, isSafeReadTarget, toRepoRelativePath } from '../../tools/night-agent/path-safety.mjs';

// Korixa Night Agent — PreToolUse guard (NIGHT-V1-B task-scoped model).
//
// Dormant (no-op, exit 0, no output) unless KORIXA_NIGHT_MODE=1 in the
// environment of the process that launched Claude Code — see CLAUDE.md and
// .claude/overnight/SAFETY.md.
//
// SECURITY MODEL — DEFAULT_DENY ALLOWLIST (R1), covering DELEGATED
// EXECUTION (R3) and now TASK-SCOPED FILE ACCESS (B): This guard does NOT
// try to enumerate every possible dangerous command. For Bash it enumerates
// a small, closed set of KNOWN-SAFE command shapes; for file-touching tools
// it enforces a per-task ACTIVE POLICY (allowed_paths/read_paths) rather
// than a fixed allowlist. There is no "no deny condition matched -> allow"
// path anywhere in this file:
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
//                                                  allowlist — see
//                                                  SAFE_MATCHERS below)
//     6. known-dangerous command family          -> DENY (explicit, for a
//                                                  clearer audit reason)
//     7. anything else                           -> DENY (UNCLASSIFIABLE_COMMAND)
//
//   for Write / Edit (B): DENY unless a valid ACTIVE POLICY is present
//     (see loadActivePolicy below) AND the target path resolves inside the
//     repo, is not a critical control-plane path, is within the policy's
//     allowed_paths, has no symlink/junction escape, and passes realpath
//     containment (tools/night-agent/path-safety.mjs's isSafeWriteTarget).
//
//   for Read (B): same shape, checked against the policy's read_paths via
//     isSafeReadTarget — the target must also already exist.
//
//   for Glob / Grep (B): DENY unless a valid active policy is present AND
//     an explicit path is given (an omitted path is always denied) AND
//     that path is within read_paths via isSafeReadTarget.
//
//   for NotebookEdit: always DENY (NIGHT_NOTEBOOK_EDIT_NOT_SUPPORTED) —
//     out of scope for V1-B regardless of any policy.
//
//   for any other tool_name (PowerShell, Monitor, Agent, MCP tools, or
//   anything not yet named): DENY (NIGHT_TOOL_NOT_YET_SCOPED) — a closed
//   policy, not an enumeration; a brand-new future tool is denied by the
//   same rule with no code change required.
//
// Stdin/exit-code contract follows the official Claude Code PreToolUse hook
// schema (code.claude.com/docs/en/hooks.md): stdin is a JSON object with at
// least {session_id, cwd, hook_event_name, tool_name, tool_input}. To
// block, this hook exits with code 2 — the documented unconditional-block
// mechanism — and writes ONLY a generic, fixed reason to stderr (B: the
// JSON-stdout channel used in R1-R4 is dropped; see denyAndExit below for
// the reasoning — blocking has never depended on it, and this matches the
// exact pattern shown in the official docs' own exit-2 example). To allow,
// it exits 0 with no output, leaving the normal permission flow untouched.
//
// The classification logic is exported as pure functions so tests can
// evaluate it directly as data, without spawning a subprocess, touching the
// filesystem beyond what a caller explicitly passes in, or executing any
// real command.

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

// R4: GIT_REV_PARSE's ref grammar, re-audited per section 14 — a closed,
// explicit shape rather than a generic character-class regex. "HEAD" with
// 0-4 carets, or a 7-40 char hex SHA, are the only refs this project
// actually needs (git rev-parse HEAD / HEAD^ / a commit's own SHA — see
// this repo's own audit workflow in earlier NIGHT-V1-A blocks). No flags
// at all: R1-R3's flag allowlist (-1, --oneline, --stat, --short, --check,
// --name-only) was inherited from a matcher that used to also cover
// log/show, and none of it is needed for rev-parse specifically — removing
// it, rather than auditing each flag for rev-parse relevance, closes any
// doubt about a "-"-prefixed token slipping through a generic pattern.
const GIT_REV_PARSE_SAFE_REF = /^HEAD(\^{1,4})?$/;
const GIT_REV_PARSE_SAFE_SHA = /^[0-9a-f]{7,40}$/i;

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
//
// R4: GIT_REV_PARSE's own grammar was additionally hardened — no flags,
// only "HEAD" with 0-4 carets or a 7-40 char hex SHA (see the
// GIT_REV_PARSE_SAFE_REF/SAFE_SHA constants below) — and evaluate() now
// registers via a single settings.json catch-all matcher ("*") rather than
// naming Bash/Write/Edit/NotebookEdit individually, so any tool this guard
// has never heard of is denied by the same ANY_NON_BASH_TOOL_DENIED rule,
// not merely the ones enumerated so far.
// ---------------------------------------------------------------------------

const SAFE_MATCHERS = [
  { id: 'PWD', test: (t) => t.length === 1 && t[0].raw === 'pwd' },
  { id: 'NODE_VERSION', test: (t) => t.length === 2 && t[0].raw === 'node' && t[1].raw === '--version' },
  {
    id: 'GIT_REV_PARSE',
    // Plumbing only: parses/resolves a revision locally. No documented
    // pager, hook, filter, textconv, or credential-helper involvement,
    // unlike log/show/status/diff/branch/ls-remote (all removed above).
    // R4: exactly one ref argument, matched against the closed grammar
    // above — no flags, no branch/remote-ref names (e.g. "origin/main",
    // allowed through R1-R3, is now denied: intentional tightening, not a
    // bug — see SAFETY.md's "R4: git rev-parse hardening" section).
    test: (t) => {
      if (t.length !== 3) return false;
      if (t[0]?.raw !== 'git' || t[1]?.raw !== 'rev-parse') return false;
      const ref = t[2];
      if (ref.quoted) return false;
      return GIT_REV_PARSE_SAFE_REF.test(ref.raw) || GIT_REV_PARSE_SAFE_SHA.test(ref.raw);
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

// NIGHT-V1-B: the ACTIVE POLICY field set (section 13). Exactly these
// fields, nothing else — a policy file with a stray field (e.g. a
// smuggled-in credential) fails validation outright. Loaded from
// KORIXA_NIGHT_POLICY_FILE (an absolute path, set by the controller — see
// tools/night-agent/runner.mjs), never from a hardcoded location.
const POLICY_ALLOWED_FIELDS = new Set([
  'version', 'task_id', 'repo_root', 'base_sha', 'read_paths', 'allowed_paths', 'created_at', 'nonce',
]);

/**
 * Validate an active-policy object's structural shape. Pure — takes an
 * already-parsed object, never touches the filesystem.
 * @param {any} policy
 * @returns {boolean}
 */
export function isValidActivePolicy(policy) {
  if (policy === null || typeof policy !== 'object') return false;
  const keys = Object.keys(policy);
  if (keys.length !== POLICY_ALLOWED_FIELDS.size) return false;
  if (!keys.every((k) => POLICY_ALLOWED_FIELDS.has(k))) return false;
  if (policy.version !== 1) return false;
  if (typeof policy.task_id !== 'string' || policy.task_id.length === 0) return false;
  if (typeof policy.repo_root !== 'string' || policy.repo_root.length === 0) return false;
  if (typeof policy.base_sha !== 'string' || policy.base_sha.length === 0) return false;
  if (!Array.isArray(policy.read_paths) || !policy.read_paths.every((p) => typeof p === 'string')) return false;
  if (!Array.isArray(policy.allowed_paths) || !policy.allowed_paths.every((p) => typeof p === 'string')) return false;
  if (typeof policy.created_at !== 'string' || policy.created_at.length === 0) return false;
  if (typeof policy.nonce !== 'string' || policy.nonce.length === 0) return false;
  return true;
}

// NotebookEdit is out of scope entirely in V1-B (section 14) — denied with
// its own reason for a clearer audit message, distinct from the generic
// catch-all. Kept as its own check (not folded into the catch-all) purely
// for that clarity; the security outcome is identical either way.
const NOTEBOOK_EDIT_TOOL_NAME = 'NotebookEdit';

function denyResult(family, detail) {
  return { active: true, decision: 'deny', reason: `${family}: ${detail}`, family };
}

function allowResult(family, detail) {
  return { active: true, decision: 'allow', reason: `${family}: ${detail}`, family };
}

/**
 * Task-scoped Write/Edit evaluation (section 13-14): denies unless a valid
 * active policy is present and the resolved target passes every
 * path-safety.mjs gate (canonical form, not critical, within
 * allowed_paths, no symlink escape, realpath-contained).
 * @param {any} hookInput
 * @param {object|null} policy
 * @returns {{decision: 'allow'|'deny', reason: string, family: string}}
 */
function evaluateFileMutation(hookInput, policy) {
  if (!policy) {
    return denyResult('NIGHT_FILE_MUTATION_NOT_YET_SCOPED', 'no valid active policy present for this Night Mode session');
  }
  const filePath = hookInput.tool_input && hookInput.tool_input.file_path;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return denyResult('NIGHT_FILE_MUTATION_DENIED', 'missing or invalid file_path');
  }
  const relPath = toRepoRelativePath(policy.repo_root, filePath);
  if (relPath === null || relPath.length === 0) {
    return denyResult('NIGHT_FILE_MUTATION_DENIED', 'target does not resolve to a path inside the repo root');
  }
  const result = isSafeWriteTarget({ repoRoot: policy.repo_root, targetRelPath: relPath, allowedPaths: policy.allowed_paths });
  if (!result.safe) {
    return denyResult('NIGHT_FILE_MUTATION_DENIED', result.reason);
  }
  return allowResult('NIGHT_FILE_MUTATION_ALLOWED', 'target is within the active policy allowed_paths and passed every path-safety gate');
}

/**
 * Task-scoped Read evaluation (section 14): same shape as file mutation,
 * checked against read_paths via isSafeReadTarget (which also requires the
 * target to already exist).
 * @param {any} hookInput
 * @param {object|null} policy
 * @returns {{decision: 'allow'|'deny', reason: string, family: string}}
 */
function evaluateRead(hookInput, policy) {
  if (!policy) {
    return denyResult('NIGHT_READ_NOT_YET_SCOPED', 'no valid active policy present for this Night Mode session');
  }
  const filePath = hookInput.tool_input && hookInput.tool_input.file_path;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return denyResult('NIGHT_READ_DENIED', 'missing or invalid file_path');
  }
  const relPath = toRepoRelativePath(policy.repo_root, filePath);
  if (relPath === null || relPath.length === 0) {
    return denyResult('NIGHT_READ_DENIED', 'target does not resolve to a path inside the repo root');
  }
  const result = isSafeReadTarget({ repoRoot: policy.repo_root, targetRelPath: relPath, readPaths: policy.read_paths });
  if (!result.safe) {
    return denyResult('NIGHT_READ_DENIED', result.reason);
  }
  return allowResult('NIGHT_READ_ALLOWED', 'target is within the active policy read_paths and passed every path-safety gate');
}

/**
 * Task-scoped Glob/Grep evaluation (section 14): requires an EXPLICIT path
 * in tool_input — an omitted path is always denied, never treated as
 * "search everywhere." The current exact tool_input field name for
 * Glob/Grep's path argument was not independently re-verified in this
 * block; `path` is used as the conventional/most-likely name. If the real
 * field name differs, this degrades to always-deny for that tool (still
 * safe — a false negative on functionality, never a false positive on
 * safety) rather than guessing at an unverified schema.
 * @param {any} hookInput
 * @param {object|null} policy
 * @returns {{decision: 'allow'|'deny', reason: string, family: string}}
 */
function evaluateGlobGrep(hookInput, policy) {
  if (!policy) {
    return denyResult('NIGHT_READ_NOT_YET_SCOPED', 'no valid active policy present for this Night Mode session');
  }
  const targetPath = hookInput.tool_input && hookInput.tool_input.path;
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return denyResult('NIGHT_GLOB_GREP_PATH_REQUIRED', 'an explicit path within read_paths is required; an omitted path is always denied');
  }
  const relPath = toRepoRelativePath(policy.repo_root, targetPath);
  if (relPath === null || relPath.length === 0) {
    return denyResult('NIGHT_GLOB_GREP_DENIED', 'path does not resolve to a location inside the repo root');
  }
  const result = isSafeReadTarget({ repoRoot: policy.repo_root, targetRelPath: relPath, readPaths: policy.read_paths });
  if (!result.safe) {
    return denyResult('NIGHT_GLOB_GREP_DENIED', result.reason);
  }
  return allowResult('NIGHT_GLOB_GREP_ALLOWED', 'path is within the active policy read_paths and passed every path-safety gate');
}

/**
 * Evaluate a full PreToolUse hook input object per the official schema.
 * Pure function — no I/O, no process access — so it can be unit tested
 * directly. `nightModeActive` and `activePolicy` are passed in explicitly
 * rather than read from `process.env`/the filesystem here, so tests do not
 * need to fork a process or create real policy files to exercise every
 * branch. `activePolicy` must already be the parsed-and-validated policy
 * object (or `null` if none is present/valid) — see loadActivePolicy below
 * for the real (I/O-performing) loader used by main().
 * @param {any} hookInput
 * @param {boolean} nightModeActive
 * @param {object|null} [activePolicy]
 * @returns {{active: boolean, decision: 'allow'|'deny'|null, reason: string|null, family: string|null}}
 */
export function evaluate(hookInput, nightModeActive, activePolicy = null) {
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

  const toolName = hookInput.tool_name;

  if (toolName === 'Bash') {
    const command = hookInput.tool_input && hookInput.tool_input.command;
    const result = classifyCommand(command);
    return { active: true, decision: result.decision, reason: result.reason, family: result.family };
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    return { active: true, ...evaluateFileMutation(hookInput, activePolicy) };
  }

  if (toolName === 'Read') {
    return { active: true, ...evaluateRead(hookInput, activePolicy) };
  }

  if (toolName === 'Glob' || toolName === 'Grep') {
    return { active: true, ...evaluateGlobGrep(hookInput, activePolicy) };
  }

  if (toolName === NOTEBOOK_EDIT_TOOL_NAME) {
    return { active: true, ...denyResult('NIGHT_NOTEBOOK_EDIT_NOT_SUPPORTED', 'NotebookEdit is out of scope for Night Mode in V1-B') };
  }

  // ANY_NON_BASH_TOOL_DENIED: everything not explicitly handled above
  // (PowerShell, Monitor, Agent, WebFetch, WebSearch, any MCP tool, or any
  // tool this guard has never heard of) is denied by this single closed
  // rule — never by matching a specific dangerous name. A brand-new future
  // tool is denied automatically, with no code change required.
  return {
    active: true,
    decision: 'deny',
    reason: 'NIGHT_TOOL_NOT_YET_SCOPED: only Bash, Write, Edit, Read, Glob, and Grep are evaluated for possible allow in Night Mode; every other tool is denied',
    family: 'NIGHT_TOOL_NOT_YET_SCOPED',
  };
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

/**
 * Load and validate the active policy from KORIXA_NIGHT_POLICY_FILE (an
 * absolute path set by the controller). Returns null on any failure —
 * missing env var, missing/unreadable file, malformed JSON, or a policy
 * that fails isValidActivePolicy — all treated identically by callers (no
 * policy to trust), never as a partial/best-effort read. The only I/O in
 * this file that reads a policy; evaluate() itself stays pure.
 * @returns {object|null}
 */
function loadActivePolicy() {
  const policyFile = process.env.KORIXA_NIGHT_POLICY_FILE;
  if (typeof policyFile !== 'string' || policyFile.length === 0) return null;
  let raw;
  try {
    raw = readFileSync(policyFile, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidActivePolicy(parsed) ? parsed : null;
}

function denyAndExit(reason) {
  // NIGHT-V1-B section 27: exit code 2 is the documented unconditional
  // PreToolUse block, and blocking has never depended on JSON stdout being
  // present or parsed — only the exit code itself. R1-R4 additionally wrote
  // a structured JSON reason to stdout (also a documented, valid channel);
  // B drops that channel and writes ONLY the generic reason to stderr,
  // matching the exact pattern shown in the official docs' own exit-2
  // example. This is a simplification, not a correction of something that
  // was wrong — both forms remain valid per current docs — chosen so the
  // security-relevant contract (EXIT_CODE_2 + STDERR) never has any
  // dependency on stdout content at all.
  //
  // `reason` is ALWAYS a fixed, generic, pre-written string identifying the
  // decision family (e.g. "UNCLASSIFIABLE_COMMAND: ...") — never the raw
  // command text, never tool_input (file_path/content/etc.), and never a
  // dynamic `err.message` (section 28) — any of those could contain a
  // secret (a token in an env var reference, a connection string, a
  // credential path, or file content). No caller of this function passes
  // it anything but a fixed string.
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

    // Only Write/Edit/Read/Glob/Grep actually consult the policy; loading
    // it unconditionally here (rather than per-tool inside evaluate) keeps
    // evaluate() itself pure and I/O-free, per its own doc comment.
    const activePolicy = loadActivePolicy();

    const result = evaluate(hookInput, true, activePolicy);
    if (result.decision === 'deny') {
      denyAndExit(result.reason);
      return;
    }

    // Allow: no decision emitted, normal permission flow proceeds.
    process.exit(0);
  } catch {
    // section 28: never include err.message (or any dynamic content) in
    // hook output — it could contain a path, a stderr fragment, or worse.
    // The exception is intentionally not bound to a variable here, so
    // there is nothing dynamic available to leak even by mistake.
    denyAndExit('INTERNAL_GUARD_ERROR: an unexpected internal error occurred — failing closed');
  }
}

// Only run when invoked as a script (not when imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
