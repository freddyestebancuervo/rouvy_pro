// Korixa Night Agent — controlled Claude child executor (NIGHT-V1-B).
//
// Builds the exact `claude` CLI argv array for a restricted, non-
// interactive child (NEVER a shell string), scans it to guarantee the
// absence of any permission-bypass flag, and spawns it with `shell: false`
// under a watchdog (hard timeout + inactivity timeout).
//
// The CLI contract below (--tools restricts actual tool AVAILABILITY,
// unlike --allowedTools which only pre-approves; --permission-mode dontAsk
// denies anything not pre-approved without prompting; --dangerously-skip-
// permissions is the exact current bypass flag name) was confirmed against
// current official docs (code.claude.com/docs/en/cli-reference.md,
// headless.md) as part of this block's own mandatory research step, not
// invented or assumed from memory.
//
// NIGHT-V1-C: both --tools AND --allowedTools now express the identical
// restricted 5-tool set, re-confirmed against current docs as part of THIS
// block's own research step. The two flags do not share an argv shape:
// --tools takes one comma-joined value (its documented convention), while
// --allowedTools takes each tool name as its own separate argv token (its
// documented convention — official examples show `--allowedTools "Read"
// "Bash(git log *)"`, never a comma-joined single string). Encoding the
// same set in each flag's own native syntax is not a workaround for any
// doc drift — nothing was renamed or changed; --tools restricts actual
// tool AVAILABILITY (defense layer 1), --allowedTools pre-approves so
// --permission-mode dontAsk never blocks on a tool the child is already
// restricted to (defense layer 2) — belt-and-suspenders, not redundancy.
//
// NIGHT-V1-B does not spawn a real `claude` process anywhere — see
// runner.mjs's --execute-green double-gate. `spawnFn` here is always
// dependency-injected in tests (a synthetic fake), and defaults to
// node:child_process's real `spawn` only for the (currently unreachable in
// this block) real path.

import { spawn as nodeSpawn } from 'node:child_process';

// The restricted built-in tool set for the autonomous child (section 17,
// 11): Read/Glob/Grep so it can inspect its own task scope, Write/Edit so
// it can make the GREEN edit. Bash is deliberately absent — the child has
// no shell at all, so it cannot invoke git/npm/flutter/gcloud/gh/any
// script regardless of what the guard would otherwise classify (section
// 16). Also absent: Agent, PowerShell, Monitor, WebFetch, WebSearch,
// NotebookEdit, and any MCP tool.
export const RESTRICTED_AUTONOMOUS_TOOLS = Object.freeze(['Read', 'Glob', 'Grep', 'Write', 'Edit']);

// The exact current bypass-flag strings (section 18) — scanned for and
// rejected in every generated argv, never merely omitted by construction.
const DANGEROUS_FLAG_SUBSTRINGS = ['--dangerously-skip-permissions', 'bypassPermissions'];

/**
 * Build the exact CLI argv for a restricted, headless `claude` invocation.
 * Never a shell string — always {command, args}, meant to be spawned with
 * `shell: false` so no shell ever re-interprets any part of it (including
 * the prompt text itself).
 * @param {object} params
 * @param {string} params.prompt
 * @param {number} params.maxTurns
 * @param {string[]} [params.restrictedTools]
 * @returns {{command: string, args: string[]}}
 */
export function buildClaudeArgv({ prompt, maxTurns, restrictedTools = RESTRICTED_AUTONOMOUS_TOOLS }) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('buildClaudeArgv: prompt must be a non-empty string');
  }
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    throw new Error('buildClaudeArgv: maxTurns must be a positive integer');
  }
  if (!Array.isArray(restrictedTools) || restrictedTools.length === 0) {
    throw new Error('buildClaudeArgv: restrictedTools must be a non-empty array');
  }
  if (restrictedTools.includes('Bash')) {
    throw new Error('buildClaudeArgv: Bash must never be included in the autonomous child tool surface');
  }

  const args = [
    '-p',
    prompt,
    '--tools',
    restrictedTools.join(','),
    '--allowedTools',
    ...restrictedTools,
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    String(maxTurns),
  ];
  return { command: 'claude', args };
}

/**
 * Collect the argv tokens following `flagName` up to (but not including) the
 * next `--`-prefixed token or the end of the array. Returns null if
 * `flagName` is not present at all. Used to read a flag's own contiguous
 * value span without assuming a fixed length (--allowedTools takes one
 * token per tool name, not a single joined value).
 * @param {string[]} args
 * @param {string} flagName
 * @returns {string[]|null}
 */
function collectFlagTokens(args, flagName) {
  const idx = args.indexOf(flagName);
  if (idx === -1) return null;
  const values = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (typeof args[i] === 'string' && args[i].startsWith('--')) break;
    values.push(args[i]);
  }
  return values;
}

/**
 * True if any element of `args` contains a known permission-bypass flag.
 * @param {string[]} args
 * @returns {boolean}
 */
export function containsDangerousBypassFlag(args) {
  return args.some((a) => typeof a === 'string' && DANGEROUS_FLAG_SUBSTRINGS.some((d) => a.includes(d)));
}

/**
 * Defense-in-depth gate run on every argv immediately before it would ever
 * be spawned: no bypass flag, `--tools` present and excluding Bash,
 * `--allowedTools` present and expressing the EXACT same tool set as
 * `--tools` (NIGHT-V1-C — belt-and-suspenders: availability restriction AND
 * pre-approval must never diverge), `--permission-mode dontAsk` present.
 * Throws (never silently proceeds) on any violation.
 * @param {{command: string, args: string[]}} argvSpec
 * @returns {true}
 */
export function assertSafeArgvOrThrow(argvSpec) {
  if (!argvSpec || !Array.isArray(argvSpec.args)) {
    throw new Error('assertSafeArgvOrThrow: argvSpec.args must be an array');
  }
  if (containsDangerousBypassFlag(argvSpec.args)) {
    throw new Error('assertSafeArgvOrThrow: dangerous permission-bypass flag detected — refusing to spawn');
  }
  const toolsIndex = argvSpec.args.indexOf('--tools');
  if (toolsIndex === -1 || typeof argvSpec.args[toolsIndex + 1] !== 'string') {
    throw new Error('assertSafeArgvOrThrow: --tools restriction is required and was not found');
  }
  const toolsList = argvSpec.args[toolsIndex + 1].split(',');
  if (toolsList.includes('Bash')) {
    throw new Error('assertSafeArgvOrThrow: Bash must never appear in --tools for the autonomous child');
  }
  const allowedToolsValues = collectFlagTokens(argvSpec.args, '--allowedTools');
  if (allowedToolsValues === null || allowedToolsValues.length === 0) {
    throw new Error('assertSafeArgvOrThrow: --allowedTools restriction is required and was not found');
  }
  if (allowedToolsValues.includes('Bash')) {
    throw new Error('assertSafeArgvOrThrow: Bash must never appear in --allowedTools for the autonomous child');
  }
  const toolsSet = new Set(toolsList);
  const allowedToolsSet = new Set(allowedToolsValues);
  const setsEqual = toolsSet.size === allowedToolsSet.size && [...toolsSet].every((t) => allowedToolsSet.has(t));
  if (!setsEqual) {
    throw new Error('assertSafeArgvOrThrow: --allowedTools must express exactly the same tool set as --tools — availability and pre-approval must never diverge');
  }
  const permIndex = argvSpec.args.indexOf('--permission-mode');
  if (permIndex === -1 || argvSpec.args[permIndex + 1] !== 'dontAsk') {
    throw new Error('assertSafeArgvOrThrow: --permission-mode dontAsk is required');
  }
  return true;
}

/**
 * Spawn a controlled child under a watchdog: a hard total-duration timeout
 * and a separate inactivity timeout (no stdout/stderr activity for that
 * long), either of which kills the child and resolves with a classified
 * result rather than hanging. `spawnFn` is dependency-injected — tests
 * always pass a synthetic fake; the real `node:child_process.spawn` is the
 * default only for the (currently unreachable) real path. Always spawned
 * with `shell: false`.
 * @param {object} params
 * @param {{command: string, args: string[]}} params.argvSpec
 * @param {string} params.cwd
 * @param {NodeJS.ProcessEnv} params.env
 * @param {number} params.timeoutMs hard total-duration limit
 * @param {number} params.inactivityTimeoutMs
 * @param {typeof nodeSpawn} [params.spawnFn]
 * @returns {Promise<{status: 'PASS'|'NONZERO_EXIT'|'TIMEOUT'|'INACTIVITY_TIMEOUT'|'ERROR', exitCode: number|null, stdout: string, stderr: string, durationMs: number}>}
 */
export function runControlledChild({ argvSpec, cwd, env, timeoutMs, inactivityTimeoutMs, spawnFn = nodeSpawn }) {
  assertSafeArgvOrThrow(argvSpec);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('runControlledChild: timeoutMs must be a positive integer');
  if (!Number.isInteger(inactivityTimeoutMs) || inactivityTimeoutMs <= 0) throw new Error('runControlledChild: inactivityTimeoutMs must be a positive integer');

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawnFn(argvSpec.command, argvSpec.args, { cwd, env, shell: false });

    const hardTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // best-effort — the child may already be gone
      }
      finish({ status: 'TIMEOUT', exitCode: null });
    }, timeoutMs);

    const inactivityChecker = setInterval(() => {
      if (Date.now() - lastActivityAt >= inactivityTimeoutMs) {
        try {
          child.kill();
        } catch {
          // best-effort
        }
        finish({ status: 'INACTIVITY_TIMEOUT', exitCode: null });
      }
    }, Math.min(1000, inactivityTimeoutMs));

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearInterval(inactivityChecker);
      resolve({ ...result, stdout, stderr, durationMs: Date.now() - startedAt });
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      lastActivityAt = Date.now();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      lastActivityAt = Date.now();
    });
    child.on('error', () => finish({ status: 'ERROR', exitCode: null }));
    child.on('close', (code) => finish({ status: code === 0 ? 'PASS' : 'NONZERO_EXIT', exitCode: code }));
  });
}
