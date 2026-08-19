#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Korixa Night Agent — PreToolUse guard.
//
// Dormant (no-op, exit 0, no output) unless KORIXA_NIGHT_MODE=1 in the
// environment of the process that launched Claude Code — see CLAUDE.md and
// .claude/overnight/SAFETY.md.
//
// Stdin/stdout contract follows the official Claude Code PreToolUse hook
// schema (hooks-guide.md): stdin is a JSON object with at least
// {session_id, cwd, hook_event_name, tool_name, tool_input}; for Bash,
// tool_input.command is the shell command string. This hook responds with
// exit 0 and, when it has an opinion, a JSON object on stdout:
//   {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//     "permissionDecision":"deny","permissionDecisionReason":"..."}}
// When dormant or when it has no opinion, it exits 0 with no stdout output,
// leaving the normal permission flow untouched.
//
// The classification logic is exported as pure functions so tests can
// evaluate it directly as data, without spawning a subprocess or executing
// any real command.

// ---------------------------------------------------------------------------
// Deny pattern families. Each entry is {id, pattern} where pattern is tested
// against a single, already-split command segment (see splitSegments below).
// Patterns are deliberately broad/conservative — false positives (denying a
// safe command) are acceptable; false negatives are not.
// ---------------------------------------------------------------------------

const DENY_FAMILIES = [
  { id: 'GIT_PUSH', pattern: /\bgit\s+push\b/i },
  { id: 'GIT_RESET_HARD', pattern: /\bgit\s+reset\b[^\n]*--hard\b/i },
  { id: 'GIT_CLEAN_DESTRUCTIVE', pattern: /\bgit\s+clean\b[^\n]*-[a-z]*[fx][a-z]*/i },
  { id: 'GIT_CHECKOUT_SWITCH_MAIN', pattern: /\bgit\s+(checkout|switch)\s+(-[^\s]+\s+)?(main|master)\b/i },
  { id: 'GH_PR_MERGE', pattern: /\bgh\s+pr\s+merge\b/i },
  { id: 'GH_PR_CLOSE', pattern: /\bgh\s+pr\s+close\b/i },
  { id: 'GH_RELEASE_CREATE', pattern: /\bgh\s+release\s+create\b/i },
  { id: 'GCLOUD_RUN_DEPLOY', pattern: /\bgcloud\s+run\s+(deploy|services\s+(update-traffic|delete|update))\b/i },
  { id: 'GCLOUD_SQL_MUTATION', pattern: /\bgcloud\s+sql\s+instances\s+(patch|delete|create)\b/i },
  { id: 'GCLOUD_REDIS_MUTATION', pattern: /\bgcloud\s+redis\s+instances\s+(update|delete|create)\b/i },
  { id: 'GCLOUD_SECRETS_MUTATION', pattern: /\bgcloud\s+secrets\s+(versions\s+(add|destroy)|delete|create)\b/i },
  { id: 'GCLOUD_IAM_MUTATION', pattern: /\bgcloud\s+(projects\s+add-iam-policy-binding|iam\s+service-accounts\s+add-iam-policy-binding)\b/i },
  { id: 'FIREBASE_DEPLOY', pattern: /\bfirebase\s+deploy\b/i },
  { id: 'RM_RF', pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\b/i },
  { id: 'PIPE_TO_SHELL', pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)\b/i },
  { id: 'CLAUDE_SKIP_PERMISSIONS', pattern: /\bclaude\b[^\n]*--dangerously-skip-permissions\b/i },
];

// Constructs that make a command unsafe to reason about at all: nested
// shell indirection or substitution that could hide any of the above behind
// an opaque string. Denied outright, regardless of visible content.
const INDIRECTION_PATTERNS = [
  { id: 'BASH_DASH_C', pattern: /\bbash\s+-c\b/i },
  { id: 'SH_DASH_C', pattern: /\bsh\s+-c\b/i },
  { id: 'EVAL', pattern: /(^|[\s;&|])eval\b/i },
  { id: 'POWERSHELL_COMMAND', pattern: /\bpowershell\b[^\n]*-command\b/i },
  { id: 'CMD_SLASH_C', pattern: /\bcmd\b[^\n]*\/c\b/i },
  { id: 'COMMAND_SUBSTITUTION', pattern: /\$\([^)]*\)|`[^`]*`/ },
];

/**
 * Split a raw shell command string into segments on the chaining operators
 * a command could use to hide a second, dangerous command behind a benign
 * first one (`&&`, `||`, `;`, `|`, and literal newlines). This is
 * intentionally conservative, not a full shell parser — see section 23/25
 * of the NIGHT-V1-A contract: fine-grained path enforcement lives in the
 * runner/queue/audit layer, not in shell-string matching.
 * @param {string} command
 * @returns {string[]}
 */
export function splitSegments(command) {
  return command
    .split(/\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Normalize a raw command string for matching: collapse repeated
 * whitespace (including across line breaks) so multi-line/extra-spaced
 * variants of a denied command still match.
 * @param {string} command
 * @returns {string}
 */
export function normalize(command) {
  return command.replace(/\s+/g, ' ').trim();
}

/**
 * Classify a single Bash command string.
 * @param {unknown} command
 * @returns {{decision: 'allow'|'deny', reason: string, family: string|null}}
 */
export function classifyCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { decision: 'deny', reason: 'UNCLASSIFIABLE_COMMAND: empty or non-string command', family: 'UNCLASSIFIABLE_COMMAND' };
  }

  const whole = normalize(command);

  for (const { id, pattern } of INDIRECTION_PATTERNS) {
    if (pattern.test(whole)) {
      return {
        decision: 'deny',
        reason: `UNCLASSIFIABLE_COMMAND: contains shell indirection/substitution (${id}) that cannot be safely classified`,
        family: 'UNCLASSIFIABLE_COMMAND',
      };
    }
  }

  // Matched against the whole normalized command, not per-segment: some
  // deny patterns (e.g. PIPE_TO_SHELL) span a chain operator (`curl ... |
  // bash`) on purpose, so splitting first would hide them in a segment
  // that no longer contains the piped-to program.
  for (const { id, pattern } of DENY_FAMILIES) {
    if (pattern.test(whole)) {
      return {
        decision: 'deny',
        reason: `denied by Night Agent safety policy: matched ${id}`,
        family: id,
      };
    }
  }

  return { decision: 'allow', reason: 'no denial pattern matched', family: null };
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
// Hook process entrypoint (stdin/stdout wiring). Only runs when this file is
// executed directly, not when imported by tests.
// ---------------------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const nightModeActive = process.env.KORIXA_NIGHT_MODE === '1';

  if (!nightModeActive) {
    // Dormant: no decision, no output, exit 0. Daytime sessions are
    // completely unaffected by this hook's presence.
    process.exit(0);
  }

  let hookInput;
  try {
    const raw = await readStdin();
    hookInput = JSON.parse(raw);
  } catch {
    // Fail closed: cannot even parse the hook input while Night Mode is
    // active — never fail open on malformed JSON.
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'UNCLASSIFIABLE_COMMAND: guard could not parse hook input JSON while Night Mode is active',
        },
      }),
    );
    process.exit(0);
    return;
  }

  const result = evaluate(hookInput, true);

  if (result.decision === 'deny') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      }),
    );
    process.exit(0);
    return;
  }

  // Allow: no decision emitted, normal permission flow proceeds.
  process.exit(0);
}

// Only run when invoked as a script (not when imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
