#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Korixa Night Agent — PreToolUse guard (NIGHT-V1-A-R1 hardened model).
//
// Dormant (no-op, exit 0, no output) unless KORIXA_NIGHT_MODE=1 in the
// environment of the process that launched Claude Code — see CLAUDE.md and
// .claude/overnight/SAFETY.md.
//
// SECURITY MODEL — DEFAULT_DENY ALLOWLIST (R1):
// This guard does NOT try to enumerate every possible dangerous command. It
// enumerates a small, closed set of KNOWN-SAFE command shapes; anything not
// an exact match — unknown commands, ambiguous quoting, shell indirection,
// chaining, redirection — is denied as UNCLASSIFIABLE_COMMAND. There is no
// "no deny pattern matched -> allow" path anywhere in this file.
//
//   1. malformed/empty input                 -> DENY
//   2. any command chaining/piping operator   -> DENY (V1 supports only a
//                                                single simple command)
//   3. shell indirection / substitution /
//      redirection / backslash escaping       -> DENY (cannot be safely
//                                                classified)
//   4. quoting that cannot be tokenized
//      unambiguously (unbalanced, or a quote
//      concatenated against adjacent text)     -> DENY
//   5. known-dangerous command family          -> DENY (explicit, for a
//                                                clearer audit reason)
//   6. matches a known-SAFE command shape      -> ALLOW
//   7. anything else                           -> DENY (UNCLASSIFIABLE_COMMAND)
//
// Stdin/stdout contract follows the official Claude Code PreToolUse hook
// schema (code.claude.com/docs/en/hooks.md): stdin is a JSON object with at
// least {session_id, cwd, hook_event_name, tool_name, tool_input}; for Bash,
// tool_input.command is the shell command string. To block, this hook exits
// with code 2 (the documented unconditional-block exit code, which
// overrides any JSON "allow") and also writes a structured JSON reason to
// stdout for auditability. To allow, it exits 0 with no output, leaving the
// normal permission flow untouched.
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
  'python', 'python3', 'perl', 'ruby', 'php',
  'ssh', 'scp', 'rsync',
  'docker', 'kubectl', 'terraform',
  'psql', 'mysql', 'mysqld', 'redis-cli',
  'gcloud', 'firebase', 'gh',
  'curl', 'wget',
  'claude',
  'powershell', 'cmd', 'bash', 'sh',
]);

const GIT_DANGEROUS_SECOND_TOKENS = new Set([
  'push', 'reset', 'clean', 'checkout', 'switch', 'branch', 'tag',
  'update-ref', 'symbolic-ref', 'fetch', 'rm', 'merge', 'rebase',
  'cherry-pick', 'revert', 'stash',
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
 * @returns {{raw: string, quoted: boolean, content?: string}[]|null}
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
      tokens.push({ raw: command.slice(i, j), quoted: true, content });
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

function isRepoRelativePathToken(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\\')) return false;
  if (value.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.startsWith('/')) return false;
  if (value.includes('..')) return false;
  return true;
}

function isSafeTestPath(value) {
  return (
    isRepoRelativePathToken(value) &&
    /^tools\/night-agent\/test\/([A-Za-z0-9_-]+\.test\.mjs|\*\.test\.mjs)$/.test(value)
  );
}

function isSafeAddPath(value) {
  return isRepoRelativePathToken(value) && !value.startsWith('-');
}

const GIT_REF_FLAG_TOKENS = new Set(['-1', '--oneline', '--stat', '--short', '--check', '--name-only']);
const GIT_REF_TOKEN_PATTERN = /^[A-Za-z0-9._/^~-]{1,200}$/;

// ---------------------------------------------------------------------------
// Known-SAFE command shapes — the entire allowlist. A command is ALLOWed if
// and only if it matches one of these exactly. Nothing else is ever
// allowed, regardless of how harmless it looks.
// ---------------------------------------------------------------------------

const SAFE_MATCHERS = [
  { id: 'PWD', test: (t) => t.length === 1 && t[0].raw === 'pwd' },
  {
    id: 'GIT_STATUS',
    test: (t) =>
      (t.length === 2 && t[0].raw === 'git' && t[1].raw === 'status') ||
      (t.length === 3 && t[0].raw === 'git' && t[1].raw === 'status' && t[2].raw === '--short'),
  },
  {
    id: 'GIT_DIFF',
    test: (t) =>
      t[0]?.raw === 'git' &&
      t[1]?.raw === 'diff' &&
      (t.length === 2 || (t.length === 3 && ['--check', '--stat', '--name-only'].includes(t[2].raw))),
  },
  {
    id: 'GIT_LOG_SHOW_REVPARSE',
    test: (t) => {
      if (t[0]?.raw !== 'git') return false;
      if (!['log', 'show', 'rev-parse'].includes(t[1]?.raw)) return false;
      if (t.length < 3) return false; // bare "git log"/"git show" with no ref is ambiguous scope — require an explicit arg
      return t.slice(2).every(
        (tok) =>
          !tok.quoted &&
          (GIT_REF_FLAG_TOKENS.has(tok.raw) || (!tok.raw.startsWith('-') && GIT_REF_TOKEN_PATTERN.test(tok.raw))),
      );
    },
  },
  {
    id: 'GIT_BRANCH_SHOW_CURRENT',
    test: (t) => t.length === 3 && t[0].raw === 'git' && t[1].raw === 'branch' && t[2].raw === '--show-current',
  },
  {
    id: 'GIT_LS_REMOTE',
    test: (t) =>
      t.length === 4 &&
      t[0].raw === 'git' &&
      t[1].raw === 'ls-remote' &&
      t[2].raw === 'origin' &&
      !t[3].quoted &&
      /^refs\/heads\/[A-Za-z0-9._/-]+$/.test(t[3].raw),
  },
  { id: 'NODE_VERSION', test: (t) => t.length === 2 && t[0].raw === 'node' && t[1].raw === '--version' },
  {
    id: 'NODE_TEST',
    test: (t) => t.length === 3 && t[0].raw === 'node' && t[1].raw === '--test' && !t[2].quoted && isSafeTestPath(t[2].raw),
  },
  { id: 'FLUTTER_ANALYZE', test: (t) => t.length === 2 && t[0].raw === 'flutter' && t[1].raw === 'analyze' },
  { id: 'FLUTTER_TEST', test: (t) => t.length === 2 && t[0].raw === 'flutter' && t[1].raw === 'test' },
  { id: 'NPM_TEST', test: (t) => t.length === 2 && t[0].raw === 'npm' && t[1].raw === 'test' },
  { id: 'NPM_RUN_BUILD', test: (t) => t.length === 3 && t[0].raw === 'npm' && t[1].raw === 'run' && t[2].raw === 'build' },
  {
    id: 'GIT_ADD',
    // Global primitive only — the guard has no notion of a task's
    // allowed_paths. Fine-grained path-scope enforcement is the
    // runner/queue/auditor's job (see tools/night-agent/README.md), not
    // this hook's. Autonomous execution remains DISABLED in V1 regardless.
    test: (t) => t.length >= 3 && t[0].raw === 'git' && t[1].raw === 'add' && t.slice(2).every((tok) => !tok.quoted && isSafeAddPath(tok.raw)),
  },
  {
    id: 'GIT_COMMIT_M',
    test: (t) =>
      t.length === 4 &&
      t[0].raw === 'git' &&
      t[1].raw === 'commit' &&
      t[2].raw === '-m' &&
      t[3].quoted &&
      typeof t[3].content === 'string' &&
      t[3].content.length > 0,
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

  // Chaining/piping/newlines are checked on the RAW string, before any
  // whitespace collapsing, so a literal newline (a second command on its
  // own line) is never lost. V1 supports only a single simple command per
  // Bash tool call — this closes the entire "hide a second command behind
  // a benign first one" bypass class in one conservative rule.
  if (/\n|&&|\|\||;|\|/.test(command)) {
    return {
      decision: 'deny',
      reason: 'UNCLASSIFIABLE_COMMAND: command chaining/piping (&&, ||, ;, |, or a newline) is not supported by the Night Guard in V1 — one simple command per call only',
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

  // The safe allowlist is checked FIRST and is authoritative: it is a
  // small, precise, closed set of exact command shapes, so a match here is
  // never in doubt. "Known-dangerous" below is only ever consulted for
  // commands that did NOT match the allowlist, purely to produce a more
  // specific denial reason than generic UNCLASSIFIABLE_COMMAND — e.g. so
  // "git branch --show-current" (an explicit safe shape) is never shadowed
  // by the broader "git branch ... is dangerous" family that exists to
  // catch `git branch -D`.
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

  if (hookInput.tool_name !== 'Bash') {
    // Only Bash is in scope for this guard (matcher: "Bash" in settings.json).
    // Any other tool_name reaching this code is unexpected; fail closed.
    return {
      active: true,
      decision: 'deny',
      reason: `UNCLASSIFIABLE_COMMAND: unexpected tool_name "${String(hookInput.tool_name)}" for a Bash-matched hook`,
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
  // Exit code 2 is the documented unconditional PreToolUse block — it
  // overrides any JSON "allow" and is the most robust of the supported
  // mechanisms (code.claude.com/docs/en/hooks.md). The JSON on stdout is
  // additional structured detail for auditability, not the sole signal.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
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
