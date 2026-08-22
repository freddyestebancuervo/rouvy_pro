// Korixa Night Agent — best-effort, non-authoritative Slack notifications.
//
// notifySlackBestEffort() NEVER touches the Slack webhook directly. It
// shells out to this repository's own existing, already-audited GitHub
// Actions workflow (.github/workflows/night-agent-slack-bridge.yml) via
// `gh workflow run`, which alone holds KORIXA_SLACK_WEBHOOK. This module
// never reads, references, or has any access to that secret.
//
// BEST-EFFORT and NON-AUTHORITATIVE by construction:
//   - every call is wrapped in try/catch;
//   - the underlying `gh` invocation carries a short timeout;
//   - the return value carries no meaning any caller should act on — it
//     exists only so tests can observe what was attempted.
// A Slack/GitHub failure (missing `gh`, no auth, network error, non-zero
// exit, timeout) can therefore never change outcome.result, a checkpoint
// state, an exit code, or any fail-closed decision — nothing in this
// module ever returns a value a caller branches on, and callers never
// await/depend on the result before proceeding.
//
// DISABLED BY DEFAULT — a fourth, independent, explicit opt-in gate
// (KORIXA_NIGHT_SLACK_NOTIFY=1), deliberately separate from the execution
// triple lock (KORIXA_NIGHT_EXECUTION / KORIXA_NIGHT_REAL_SPAWN) in
// runner.mjs, which this module never reads and never influences. Unset
// (the default in every existing test and in any CLI invocation that
// doesn't explicitly opt in), this function performs ZERO subprocess
// calls — it returns immediately. This is what keeps every existing CLI
// subprocess test in runner.test.mjs (self-test/validate/dry-run/
// execute-green) from ever invoking a real `gh workflow run` — those
// tests never set KORIXA_NIGHT_SLACK_NOTIFY, so this module stays fully
// inert for them, exactly as it was before this module existed.
//
// Message content is built EXCLUSIVELY from a closed field allowlist
// (mirrors checkpoint.mjs's own ALLOWED_FIELDS pattern) — never from a
// caller-supplied free-form string. A field not in ALLOWED_FIELDS is
// silently dropped, never included, so no caller can route child
// stdout/stderr, prompts/objectives, file contents/diffs, environment
// variables, tokens, secrets, the webhook URL, or a raw internal object
// into a message, even by mistake.

import { spawnSync } from 'node:child_process';

const SLACK_BRIDGE_WORKFLOW = 'night-agent-slack-bridge.yml';
const SLACK_BRIDGE_REF = 'main';
const DEFAULT_TIMEOUT_MS = 5000;

export const NOTIFICATION_LABELS = Object.freeze(['START', 'CHECKPOINT', 'BLOCKED', 'END']);

// The ONLY fields any notification message may ever be built from. Adding
// a field here is a deliberate, reviewed decision — this list is the
// single place that decides what can ever leave this process toward
// Slack.
const ALLOWED_FIELDS = Object.freeze([
  'taskId', 'state', 'result', 'errorFamily', 'attempt', 'timestamp', 'realChildSpawn', 'exitCodeFamily',
]);

/**
 * Build a message string using ONLY allowlisted fields. `label` is a fixed
 * literal the caller supplies (never derived from data) and must be one of
 * NOTIFICATION_LABELS.
 * @param {string} label
 * @param {Record<string, unknown>} [fields]
 * @returns {string}
 */
export function buildNotificationMessage(label, fields = {}) {
  if (!NOTIFICATION_LABELS.includes(label)) {
    throw new Error(`buildNotificationMessage: unknown label "${label}"`);
  }
  const parts = ['NIGHT AGENT', '|', label];
  if (fields && typeof fields === 'object') {
    for (const key of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined && fields[key] !== null) {
        parts.push(`| ${key}=${String(fields[key])}`);
      }
    }
  }
  return parts.join(' ');
}

/**
 * Best-effort, non-authoritative Slack notification. NEVER throws. NEVER
 * accesses the webhook directly. DISABLED unless KORIXA_NIGHT_SLACK_NOTIFY
 * (or the injected envValue) is exactly '1'.
 * @param {object} params
 * @param {string} params.label one of NOTIFICATION_LABELS
 * @param {Record<string, unknown>} [params.fields] allowlisted fields only — see ALLOWED_FIELDS
 * @param {typeof spawnSync} [params.spawnSyncFn]
 * @param {number} [params.timeoutMs]
 * @param {string|undefined} [params.envValue] defaults to process.env.KORIXA_NIGHT_SLACK_NOTIFY
 * @returns {{attempted: boolean, ok: boolean, reason?: string}} for test observation only — never meant to be branched on by callers
 */
export function notifySlackBestEffort({
  label,
  fields = {},
  spawnSyncFn = spawnSync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  envValue = process.env.KORIXA_NIGHT_SLACK_NOTIFY,
} = {}) {
  if (envValue !== '1') {
    return { attempted: false, ok: false, reason: 'DISABLED' };
  }
  let message;
  try {
    message = buildNotificationMessage(label, fields);
  } catch {
    return { attempted: false, ok: false, reason: 'BUILD_MESSAGE_FAILED' };
  }
  try {
    const result = spawnSyncFn(
      'gh',
      ['workflow', 'run', SLACK_BRIDGE_WORKFLOW, '--ref', SLACK_BRIDGE_REF, '-f', `message=${message}`],
      { timeout: timeoutMs, encoding: 'utf8', shell: false },
    );
    return { attempted: true, ok: Boolean(result && !result.error && result.status === 0) };
  } catch {
    return { attempted: true, ok: false, reason: 'SPAWN_THREW' };
  }
}
