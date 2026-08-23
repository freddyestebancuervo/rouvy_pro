#!/usr/bin/env node
// Korixa Night Agent — V1/V1-B runner.
//
// EXECUTION_ENGINE = DISABLED_IN_V1_A. NIGHT-V1-C wired the real controlled-
// execution pipeline end to end — TASK -> temporary ACTIVE POLICY ->
// CHECKPOINT RUNNING -> CONTROLLED EXECUTOR -> RESULT -> CHECKPOINT FINAL ->
// POLICY CLEANUP (see executeControlledGreenTask below). NIGHT-V1-D adds the
// remaining pre-spawn safety gates (task-worktree-clean, Night-Guard-
// installed, verification-commands-present), a real post-child pipeline
// (post-scope check #1 -> verification_commands -> post-scope check #2 ->
// only THEN checkpoint PASS — CHILD_EXIT_0 != TASK_PASS), a deterministic,
// persistent, recoverable checkpoint path (resolveCheckpointPath in
// checkpoint.mjs, keyed by repoRoot+task.id, outside the repo), and
// truthful CLI telemetry/exit codes. A THIRD gate on top of the double gate
// (section 10's "triple execution lock": CLI flag + KORIXA_NIGHT_EXECUTION=1
// + a further KORIXA_NIGHT_REAL_SPAWN=1) still guards the actual spawn.
// Nothing in this codebase's real CLI path ever sets KORIXA_NIGHT_REAL_SPAWN
// — so every real `--execute-green` invocation still resolves to
// HOLD_REAL_EXECUTION_LOCKED before any policy/checkpoint/spawn ever
// happens. CLAUDE_AGENT_RUNS stays 0 for every real invocation in this
// version; the wiring itself is proven reachable only via tests that pass
// the triple lock's gate values directly, always paired with an injected
// fake spawnFn.
//
// Modes (default: dry-run):
//   --validate            Validate queue schema/cycles/path-conflicts only.
//   --dry-run             Validate, then print the GREEN execution plan
//                          (which task would run next, in what order) —
//                          without running or changing anything.
//   --plan-execution       Validate, select the next GREEN task, and print
//                          its concrete execution plan (policy summary,
//                          restricted tool surface, timeouts, retry
//                          budget) — never spawns Claude, never creates a
//                          real policy file.
//   --execute-green        Gated by the triple execution lock (CLI flag +
//                          KORIXA_NIGHT_EXECUTION=1 + KORIXA_NIGHT_REAL_SPAWN=1,
//                          section 10). No code path in this version ever
//                          satisfies all three simultaneously in a real
//                          invocation — see above. Exit code and
//                          REAL_CHILD_SPAWN telemetry now reflect the real
//                          outcome (0/PASS-only vs non-zero, 1 only if a
//                          spawn was actually attempted) rather than a
//                          hardcoded constant.
//   --self-test            Run this file's own internal fixture: hardcoded
//                          in-memory queue objects, no filesystem/network.
//
// Usage:
//   node tools/night-agent/runner.mjs --queue <path> [--validate|--dry-run|--plan-execution]
//   node tools/night-agent/runner.mjs --queue <path> --execute-green
//   node tools/night-agent/runner.mjs --self-test

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  validateSchema,
  findCycle,
  findPathConflicts,
  selectNextGreenTask,
  classifyExecutability,
  FIXTURE_BASE_SHA,
  VALID_VERIFICATION_FAMILIES,
} from './queue.mjs';
import { RESTRICTED_AUTONOMOUS_TOOLS, buildClaudeArgv, runControlledChild } from './executor.mjs';
import {
  createCheckpoint,
  advanceCheckpoint,
  writeCheckpointAtomic,
  resolveCheckpointPath,
  readCheckpointForResume,
  resolveCheckpointRecoveryDecision,
} from './checkpoint.mjs';
import { isRepoRelativePath, isPathWithinScope } from './path-safety.mjs';
import { notifySlackBestEffort } from './notify.mjs';
import { evaluateCommandSafety } from './command-safety.mjs';
import { RED_TEAM_CHECKS, runRedTeamPhase } from './red-team-gate.mjs';
import { finalizeExecutorResult, certifyIndependentAuditResult } from './executor-auditor-gate.mjs';

// Best-effort notification call-site wrapper: defense-in-depth on top of
// notifySlackBestEffort's own try/catch. A notification (or a test's
// injected fake) throwing must NEVER propagate into caller control flow —
// it can never affect a checkpoint, outcome.result, or an exit code.
function safeNotify(notifySlackFn, params) {
  try {
    notifySlackFn(params);
  } catch {
    // best-effort, non-authoritative: never propagate.
  }
}

/**
 * @param {string[]} argv
 * @returns {{queuePath: string|null, mode: 'validate'|'dry-run'|'self-test'|'plan-execution'|'execute-green', targetHeadSha: string|null}}
 */
export function parseArgs(argv) {
  let queuePath = null;
  let mode = 'dry-run'; // default per NIGHT-V1-A contract
  let targetHeadSha = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--queue') {
      queuePath = argv[i + 1] ?? null;
      i++;
    } else if (arg === '--validate') {
      mode = 'validate';
    } else if (arg === '--dry-run') {
      mode = 'dry-run';
    } else if (arg === '--self-test') {
      mode = 'self-test';
    } else if (arg === '--plan-execution') {
      mode = 'plan-execution';
    } else if (arg === '--execute-green') {
      mode = 'execute-green';
    } else if (arg === '--target-head') {
      // NIGHT-V1-D-R1 section 6: the operator-supplied SHA the real
      // execution worktree MUST be exactly at. Never inferred from `git
      // rev-parse HEAD` — that would auto-authorize whatever the worktree
      // happens to be on, defeating the entire point of the gate.
      targetHeadSha = argv[i + 1] ?? null;
      i++;
    }
  }
  return { queuePath, mode, targetHeadSha };
}

/**
 * Run schema/cycle/path-conflict validation against a parsed queue object.
 * Pure — no I/O.
 * @param {any} queue
 * @returns {{ok: boolean, report: string[]}}
 */
export function runValidation(queue) {
  const report = [];
  const schemaResult = validateSchema(queue);
  if (!schemaResult.valid) {
    for (const err of schemaResult.errors) report.push(`SCHEMA_ERROR: ${err}`);
    return { ok: false, report };
  }
  report.push('SCHEMA: valid');

  const cycle = findCycle(queue.tasks);
  if (cycle) {
    report.push(`CYCLE_ERROR: dependency cycle detected: ${cycle.join(' -> ')}`);
    return { ok: false, report };
  }
  report.push('CYCLES: none');

  const conflicts = findPathConflicts(queue.tasks);
  if (conflicts.length > 0) {
    for (const c of conflicts) {
      report.push(`PATH_CONFLICT: "${c.path}" claimed by both "${c.a}" and "${c.b}"`);
    }
    return { ok: false, report };
  }
  report.push('PATH_CONFLICTS: none');

  return { ok: true, report };
}

/**
 * Build the dry-run execution plan: for every task, its executability
 * classification, plus which task would run next if execution were
 * enabled (it is not, in V1). Pure — no I/O, no mutation, no Claude call.
 * @param {any} queue
 * @returns {string[]}
 */
export function buildDryRunPlan(queue) {
  const lines = [];
  for (const task of queue.tasks) {
    const { executable, reason } = classifyExecutability(task, queue.tasks);
    lines.push(`TASK ${task.id} [${task.risk}] executable=${executable} — ${reason}`);
  }
  const next = selectNextGreenTask(queue.tasks);
  lines.push(
    next
      ? `NEXT_GREEN_TASK = ${next.id} (would run here if EXECUTION_ENGINE were enabled; it is not in V1)`
      : 'NEXT_GREEN_TASK = none (no eligible GREEN/READY task)',
  );
  lines.push('EXECUTION_ENGINE = DISABLED_IN_V1_A — no task was actually run.');
  return lines;
}

/**
 * Build the concrete execution-plan preview for a selected GREEN task
 * (section 34): policy summary, restricted tool surface, timeouts, retry
 * budget — no secrets, and no real policy file is ever created by this
 * function. Pure — no I/O.
 * @param {any} task
 * @returns {string[]}
 */
export function buildExecutionPlanSummary(task) {
  return [
    `SELECTED_TASK = ${task.id}`,
    `POLICY_ALLOWED_PATHS = ${JSON.stringify(task.allowed_paths)}`,
    `POLICY_READ_PATHS = ${JSON.stringify(task.read_paths)}`,
    `TOOL_SURFACE = ${RESTRICTED_AUTONOMOUS_TOOLS.join(',')}`,
    `TIMEOUT_SECONDS = ${task.timeout_seconds}`,
    `MAX_RETRIES = ${task.max_retries}`,
    `MAX_TURNS = ${task.max_turns}`,
    'EXECUTE_GREEN_LOCK = requires --execute-green AND KORIXA_NIGHT_EXECUTION=1 AND KORIXA_NIGHT_REAL_SPAWN=1 simultaneously (triple lock); any two alone are insufficient',
    'REAL_CHILD_SPAWN = 0 (the real controlled-execution pipeline is wired, but no code path in this version ever sets KORIXA_NIGHT_REAL_SPAWN=1)',
  ];
}

/**
 * Section 23's remote-main stale-SHA gate, as a pure comparison. The
 * FIXTURE_BASE_SHA sentinel is exempt (a synthetic fixture queue is never
 * meant to be compared against a real remote).
 * @param {string} queueBaseSha
 * @param {string|null} remoteMainSha
 * @returns {{drifted: boolean, reason: string}}
 */
export function checkRemoteMainDrift(queueBaseSha, remoteMainSha) {
  if (queueBaseSha === FIXTURE_BASE_SHA) {
    return { drifted: false, reason: 'fixture base_sha sentinel — drift check not applicable' };
  }
  if (typeof remoteMainSha !== 'string' || remoteMainSha.length === 0) {
    return { drifted: true, reason: 'could not resolve remote main — treated as drift (fail closed)' };
  }
  if (queueBaseSha !== remoteMainSha) {
    return { drifted: true, reason: `remote main (${remoteMainSha}) does not match the queue's session.base_sha (${queueBaseSha})` };
  }
  return { drifted: false, reason: 'remote main matches the queue session.base_sha' };
}

/**
 * Resolve `origin/main`'s CURRENT remote SHA via a real `git ls-remote`
 * call — never the local `origin/main` tracking ref, which can be stale.
 * argv array, no shell. Returns null if the command fails or the output
 * cannot be parsed (the caller treats null as drift — fail closed).
 * @param {{spawnSyncFn?: typeof spawnSync}} [params]
 * @returns {string|null}
 */
export function resolveRemoteMainSha({ spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8', shell: false });
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') return null;
  const match = result.stdout.match(/^([0-9a-f]{40})\s+refs\/heads\/main/m);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// NIGHT-V1-D-R1 section 5-9: the TARGET HEAD gate. REMOTE_MAIN and
// TARGET_HEAD are two distinct invariants — a clean worktree does not by
// itself prove it is sitting at the commit the operator actually authorized
// for this execution. `queue.session.base_sha` keeps its existing meaning
// (the remote-main-frozen SHA, feeding ONLY checkRemoteMainDrift, unchanged
// from NIGHT-V1-A onward) — targetHeadSha is a SEPARATE value, supplied
// explicitly by the operator via `--target-head`, that the real local
// worktree HEAD must match exactly before policy/checkpoint/spawn.
// ---------------------------------------------------------------------------

const FULL_GIT_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidTargetHeadSha(value) {
  return typeof value === 'string' && FULL_GIT_SHA_PATTERN.test(value);
}

/**
 * Resolve the REAL current local HEAD of `repoRoot` via a real `git -C
 * <repoRoot> rev-parse HEAD` call — argv array, `shell: false`, no shell
 * string. Returns null if Git fails or the output is not a well-formed
 * 40-char SHA (the caller treats null as unresolved — fail closed, never
 * silently accepted as a match).
 * @param {{repoRoot: string, spawnSyncFn?: typeof spawnSync}} params
 * @returns {string|null}
 */
export function resolveLocalHeadSha({ repoRoot, spawnSyncFn = spawnSync }) {
  const result = spawnSyncFn('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', shell: false });
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') return null;
  const sha = result.stdout.trim().toLowerCase();
  return FULL_GIT_SHA_PATTERN.test(sha) ? sha : null;
}

/**
 * Compare `repoRoot`'s real, freshly-resolved local HEAD against the
 * operator-supplied `expectedTargetHeadSha` (already format-validated by
 * the caller). Never infers the "expected" value from the worktree itself
 * — that would auto-authorize whatever the worktree happens to be on.
 * @param {{repoRoot: string, expectedTargetHeadSha: string, spawnSyncFn?: typeof spawnSync}} params
 * @returns {{matched: boolean, reason: 'OK'|'MISMATCH'|'UNRESOLVED', actual: string|null}}
 */
export function checkTargetHead({ repoRoot, expectedTargetHeadSha, spawnSyncFn = spawnSync }) {
  const actual = resolveLocalHeadSha({ repoRoot, spawnSyncFn });
  if (actual === null) {
    return { matched: false, reason: 'UNRESOLVED', actual: null };
  }
  const expected = expectedTargetHeadSha.toLowerCase();
  return actual === expected ? { matched: true, reason: 'OK', actual } : { matched: false, reason: 'MISMATCH', actual };
}

/**
 * Section 35's double gate: `--execute-green` must be BOTH present on the
 * command line AND paired with `KORIXA_NIGHT_EXECUTION=1` in the
 * environment. Either alone is insufficient — this is deliberate, so a
 * queue run in the wrong environment (or an env var left set from a prior
 * session) can never alone trigger execution.
 * @param {{flagPresent: boolean, envValue: string|undefined}} params
 * @returns {boolean}
 */
export function isExecuteGreenUnlocked({ flagPresent, envValue }) {
  return flagPresent === true && envValue === '1';
}

/**
 * NIGHT-V1-D section 21: the CLI exit-code mapping — 0 ONLY for an actual
 * TASK PASS, non-zero for every RETRY/HOLD/gate-locked/validation-failure
 * outcome. Pure, so this exact mapping is directly testable without ever
 * spawning a real `claude` process (section 21: "NO ejecutar real Claude
 * para probarlo").
 * @param {string} result runExecuteGreen's `result` field
 * @returns {number}
 */
export function resolveExitCode(result) {
  return result === 'PASS' ? 0 : 1;
}

/**
 * Section 26's post-execution scope checker: every path a (hypothetical)
 * execution actually touched must belong to the task's allowed_paths.
 * Pure — takes a list of modified paths as data (never inspects the
 * filesystem itself); a real future caller would supply this from a `git
 * diff --name-only` or similar. Finds ALL violations rather than stopping
 * at the first, so a HOLD report can list everything unauthorized at once.
 * @param {string[]} modifiedPaths
 * @param {string[]} allowedPaths
 * @returns {{ok: boolean, unauthorized: string[]}}
 */
export function checkPostExecutionScope(modifiedPaths, allowedPaths) {
  const unauthorized = [];
  for (const modifiedPath of modifiedPaths) {
    const covered = allowedPaths.some((entry) => {
      if (entry === '*' || entry === '**' || entry === '**/*') return true;
      if (entry.endsWith('/**')) return modifiedPath === entry.slice(0, -3) || modifiedPath.startsWith(`${entry.slice(0, -3)}/`);
      if (entry.endsWith('/*')) return modifiedPath === entry.slice(0, -2) || modifiedPath.startsWith(`${entry.slice(0, -2)}/`);
      return modifiedPath === entry;
    });
    if (!covered) unauthorized.push(modifiedPath);
  }
  return { ok: unauthorized.length === 0, unauthorized };
}

// ---------------------------------------------------------------------------
// NIGHT-V1-D section 6/14: trusted-controller Git status, via a real
// `git status --porcelain=v1 -z --untracked-files=all` (argv array, no
// shell) — machine-safe (`-z`, NUL-separated) so paths containing spaces or
// other unusual characters are parsed correctly, not split on whitespace.
// ---------------------------------------------------------------------------

/**
 * Parse `git status --porcelain=v1 -z` stdout into a flat list of
 * repo-relative paths. Each entry is `XY<space>PATH`, NUL-terminated; a
 * rename/copy entry (`X`/`Y` starting with `R`/`C`) is followed by a SECOND
 * NUL-terminated field (the original path), which this function consumes
 * and discards — only the resulting (current) path is reported, since that
 * is what `checkPostExecutionScope` needs to classify against
 * `allowed_paths`.
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseGitStatusPorcelainZ(stdout) {
  const paths = [];
  const fields = stdout.split('\0');
  let i = 0;
  while (i < fields.length) {
    const entry = fields[i];
    if (entry.length === 0) {
      i++;
      continue;
    }
    const statusCode = entry.slice(0, 2);
    const entryPath = entry.slice(3);
    paths.push(entryPath);
    i++;
    if (statusCode[0] === 'R' || statusCode[0] === 'C') {
      i++; // consume the original-path field that follows a rename/copy
    }
  }
  return paths;
}

/**
 * Run the real, trusted-controller `git status` and return the parsed
 * paths, or `{ok: false}` if the command itself failed (the caller must
 * fail closed — never treat "could not verify" as "clean"/"authorized").
 * @param {{repoRoot: string, spawnSyncFn?: typeof spawnSync}} params
 * @returns {{ok: boolean, paths: string[]|null}}
 */
export function getGitStatusPaths({ repoRoot, spawnSyncFn = spawnSync }) {
  const result = spawnSyncFn('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    return { ok: false, paths: null };
  }
  return { ok: true, paths: parseGitStatusPorcelainZ(result.stdout) };
}

/**
 * NIGHT-V1-D section 6: the task worktree must be clean BEFORE policy
 * creation, checkpoint RUNNING, or any spawn — tracked modifications,
 * deletions, untracked files, and renames/copies all count as dirty (any
 * non-empty `git status` output at all). Never cleaned, reset, or stashed
 * by this function or any caller — evidence of pre-existing state is always
 * preserved.
 * @param {{repoRoot: string, spawnSyncFn?: typeof spawnSync}} params
 * @returns {{clean: boolean, reason: string, paths?: string[]}}
 */
export function checkWorktreeClean({ repoRoot, spawnSyncFn = spawnSync }) {
  const { ok, paths } = getGitStatusPaths({ repoRoot, spawnSyncFn });
  if (!ok) return { clean: false, reason: 'GIT_STATUS_FAILED' };
  return paths.length === 0 ? { clean: true, reason: 'OK' } : { clean: false, reason: 'DIRTY', paths };
}

// ---------------------------------------------------------------------------
// NIGHT-V1-D section 7: the Night Guard installation preflight. Read-only —
// never modifies `.claude/settings.json` or the guard file. Rejects
// anything short of a structurally well-formed PreToolUse hook registration
// that actually points at this project's `night-guard.mjs`.
// ---------------------------------------------------------------------------

/**
 * @param {{repoRoot: string, existsSyncFn?: typeof existsSync, readFileSyncFn?: typeof readFileSync}} params
 * @returns {{installed: boolean, reason: string}}
 */
export function checkNightGuardInstalled({ repoRoot, existsSyncFn = existsSync, readFileSyncFn = readFileSync }) {
  const settingsPath = path.join(repoRoot, '.claude', 'settings.json');
  const guardPath = path.join(repoRoot, '.claude', 'hooks', 'night-guard.mjs');

  if (!existsSyncFn(settingsPath)) return { installed: false, reason: 'SETTINGS_MISSING' };
  if (!existsSyncFn(guardPath)) return { installed: false, reason: 'GUARD_FILE_MISSING' };

  let raw;
  try {
    raw = readFileSyncFn(settingsPath, 'utf8');
  } catch {
    return { installed: false, reason: 'SETTINGS_UNREADABLE' };
  }
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    return { installed: false, reason: 'SETTINGS_INVALID_JSON' };
  }

  const preToolUse = settings?.hooks?.PreToolUse;
  if (!Array.isArray(preToolUse) || preToolUse.length === 0) {
    return { installed: false, reason: 'PRETOOLUSE_MISSING' };
  }

  const registersGuard = preToolUse.some((entry) => {
    const entryHooks = entry?.hooks;
    if (!Array.isArray(entryHooks)) return false;
    return entryHooks.some((hook) => {
      if (!hook || hook.type !== 'command') return false;
      if (Array.isArray(hook.args) && hook.args.some((a) => typeof a === 'string' && a.replace(/\\/g, '/').endsWith('.claude/hooks/night-guard.mjs'))) {
        return true;
      }
      // Tolerate the alternate single shell-string `command` registration
      // form documented in SAFETY.md, without accepting a bare filename
      // match outside a well-formed command-type hook entry.
      return typeof hook.command === 'string' && hook.command.replace(/\\/g, '/').includes('night-guard.mjs');
    });
  });

  if (!registersGuard) return { installed: false, reason: 'GUARD_NOT_REGISTERED' };

  return { installed: true, reason: 'OK' };
}

// ---------------------------------------------------------------------------
// NIGHT-V1-D section 11-12: the trusted verification runner. Reuses
// `queue.mjs`'s ALREADY-CLOSED `VALID_VERIFICATION_FAMILIES` set exactly —
// no new family, no raw shell string, ever. argv array, `shell: false`, a
// bounded `timeout` (spawnSync) so a hung verification target cannot hang
// the controller forever. Every result is PASS/FAIL plus a generic error
// family — raw stdout/stderr is captured only transiently in this
// function's own local scope and is NEVER returned or persisted anywhere
// (never written to a checkpoint).
// ---------------------------------------------------------------------------

const DEFAULT_VERIFICATION_TIMEOUT_MS = 60000;

/**
 * @param {any} vc a single verification_commands entry
 * @param {{repoRoot: string, task: any, spawnSyncFn?: typeof spawnSync, existsSyncFn?: typeof existsSync, timeoutMs?: number}} params
 * @returns {{pass: boolean, family: string, errorFamily: string|null}}
 */
export function runVerificationCommand(vc, { repoRoot, task, spawnSyncFn = spawnSync, existsSyncFn = existsSync, timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS, evaluateCommandSafetyFn = evaluateCommandSafety }) {
  if (!vc || !VALID_VERIFICATION_FAMILIES.has(vc.family)) {
    return { pass: false, family: vc?.family ?? null, errorFamily: 'UNKNOWN_VERIFICATION_FAMILY' };
  }

  if (vc.family === 'PWD') {
    // No spawn needed — `pwd` has no portable, shell-free equivalent
    // executable on every platform this project runs on; the family's
    // intent (confirm the working directory is real) is satisfied by a
    // direct filesystem check instead of an unreliable subprocess.
    return existsSyncFn(repoRoot)
      ? { pass: true, family: vc.family, errorFamily: null }
      : { pass: false, family: vc.family, errorFamily: 'VERIFICATION_TARGET_MISSING' };
  }

  if (vc.family === 'NODE_TEST') {
    const scope = [...(Array.isArray(task.allowed_paths) ? task.allowed_paths : []), ...(Array.isArray(task.read_paths) ? task.read_paths : [])];
    if (!isRepoRelativePath(vc.target) || !isPathWithinScope(vc.target, scope)) {
      return { pass: false, family: vc.family, errorFamily: 'VERIFICATION_TARGET_OUT_OF_SCOPE' };
    }
  }

  const { command, args } = vc.family === 'NODE_VERSION' ? { command: 'node', args: ['--version'] } : { command: 'node', args: ['--test', vc.target] };

  // Phase 1B, Section 6: command-safety.mjs is now the mandatory gate
  // immediately before the one real spawn in this function -- strict order
  // RECEIVE -> CLASSIFY -> AUTHORIZE -> EXECUTE, never execute-then-classify.
  // `targetEnvironment: 'Local'` is correct and honest here (not a stand-in
  // for "trust it"): every command this function can ever construct comes
  // from the closed, schema-validated NODE_TEST/NODE_VERSION family set
  // (queue.mjs's VALID_VERIFICATION_FAMILIES), runs with cwd:repoRoot, and
  // never targets a remote/Production resource -- there is no path through
  // this function that could honestly claim a different targetEnvironment.
  // An UNAUTHORIZED verdict (UNKNOWN, or any class this policy does not
  // grant standing authorization to) means the command is NEVER executed --
  // `errorFamily: 'COMMAND_SAFETY_UNAUTHORIZED'` is treated as an
  // unconditional HOLD by executeControlledGreenTask, never RETRY (see its
  // own comment on UNAUTHORIZED_SCOPE for why retrying a policy violation,
  // rather than a flaky failure, is never appropriate).
  const commandSafety = evaluateCommandSafetyFn({
    command: [command, ...args].join(' '),
    targetEnvironment: 'Local',
    currentBranchName: null,
    explicitAuthorizationGranted: false,
  });
  if (!commandSafety.authorized) {
    return { pass: false, family: vc.family, errorFamily: 'COMMAND_SAFETY_UNAUTHORIZED', commandSafetyClass: commandSafety.commandSafetyClass };
  }

  const result = spawnSyncFn(command, args, { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: timeoutMs });
  if (!result || result.error || result.status !== 0) {
    return { pass: false, family: vc.family, errorFamily: 'VERIFICATION_FAILED' };
  }
  return { pass: true, family: vc.family, errorFamily: null, commandSafetyClass: commandSafety.commandSafetyClass };
}

/**
 * Run every `verification_commands` entry in order, stopping at the FIRST
 * failure (no point running further checks once one has already failed —
 * the task cannot PASS regardless).
 * @param {any} task
 * @param {{repoRoot: string, spawnSyncFn?: typeof spawnSync, existsSyncFn?: typeof existsSync, timeoutMs?: number}} params
 * @returns {{allPass: boolean, results: {pass: boolean, family: string, errorFamily: string|null}[]}}
 */
export function runAllVerificationCommands(task, params) {
  const results = [];
  for (const vc of task.verification_commands) {
    const r = runVerificationCommand(vc, { ...params, task });
    results.push(r);
    if (!r.pass) return { allPass: false, results };
  }
  return { allPass: true, results };
}

/**
 * NIGHT-V1-C section 10's triple execution lock: real Claude execution
 * requires ALL THREE simultaneously — the existing double gate (CLI flag +
 * KORIXA_NIGHT_EXECUTION=1) PLUS a third, separate KORIXA_NIGHT_REAL_SPAWN=1
 * environment variable. Checked independently INSIDE executeControlledGreenTask
 * itself (not only by whatever gated the call to it), so the lock protects
 * even a future caller that invokes that function directly, bypassing
 * runExecuteGreen's own double gate — defense in depth, the same principle
 * as assertSafeArgvOrThrow being re-checked immediately before every spawn
 * rather than trusted from an earlier call site. During NIGHT-V1-C, nothing
 * in this codebase ever sets KORIXA_NIGHT_REAL_SPAWN=1, so this always
 * resolves to false for any real invocation — REAL_CLAUDE_AGENT_RUNS stays 0
 * as an enforced gate outcome, not merely a stub default.
 * @param {{flagPresent: boolean, executionEnvValue: string|undefined, realSpawnEnvValue: string|undefined}} params
 * @returns {boolean}
 */
export function isTripleExecutionLockSatisfied({ flagPresent, executionEnvValue, realSpawnEnvValue }) {
  return isExecuteGreenUnlocked({ flagPresent, envValue: executionEnvValue }) && realSpawnEnvValue === '1';
}

/**
 * NIGHT-V1-C section 8: build the exact ACTIVE POLICY object — precisely
 * the 8 fields `.claude/hooks/night-guard.mjs`'s `isValidActivePolicy`
 * requires, nothing else. No prompt, secret, or token field exists to leak.
 * Pure — does not touch the filesystem. `nonceFn` must be unpredictable
 * (crypto.randomBytes by default, never Math.random) — the nonce's only
 * purpose is to make the policy file's identity non-guessable, so it must
 * not itself be guessable.
 * @param {object} params
 * @param {any} params.task
 * @param {string} params.repoRoot
 * @param {string} params.baseSha
 * @param {() => string} [params.nowFn]
 * @param {() => string} [params.nonceFn]
 * @returns {object}
 */
export function buildActivePolicy({ task, repoRoot, baseSha, nowFn = () => new Date().toISOString(), nonceFn = () => randomBytes(16).toString('hex') }) {
  return {
    version: 1,
    task_id: task.id,
    repo_root: repoRoot,
    base_sha: baseSha,
    read_paths: task.read_paths,
    allowed_paths: task.allowed_paths,
    created_at: nowFn(),
    nonce: nonceFn(),
  };
}

/**
 * NIGHT-V1-C section 8: create a temporary active-policy file OUTSIDE the
 * repository, under `tmpDirFn()` (os.tmpdir() by default), with an
 * unpredictable filename (crypto.randomBytes, never Math.random or a
 * task-id-derived name alone). Written atomically — a uniquely-named temp
 * file in the same directory, then `renameSyncFn` over the final path — so
 * a concurrent reader (the guard) can never observe a partially written
 * policy, mirroring checkpoint.mjs's own writeCheckpointAtomic pattern.
 * @param {object} params
 * @param {any} params.task
 * @param {string} params.repoRoot
 * @param {string} params.baseSha
 * @param {() => string} [params.tmpDirFn]
 * @param {() => string} [params.nowFn]
 * @param {() => string} [params.nonceFn]
 * @param {typeof writeFileSync} [params.writeFileSyncFn]
 * @param {typeof renameSync} [params.renameSyncFn]
 * @returns {{policyPath: string, policy: object}}
 */
export function createTemporaryActivePolicy({
  task,
  repoRoot,
  baseSha,
  tmpDirFn = tmpdir,
  nowFn = () => new Date().toISOString(),
  nonceFn = () => randomBytes(16).toString('hex'),
  writeFileSyncFn = writeFileSync,
  renameSyncFn = renameSync,
}) {
  const policy = buildActivePolicy({ task, repoRoot, baseSha, nowFn, nonceFn });
  const fileName = `korixa-night-policy-${randomBytes(16).toString('hex')}.json`;
  const finalPath = path.join(tmpDirFn(), fileName);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSyncFn(tmpPath, JSON.stringify(policy, null, 2), 'utf8');
  renameSyncFn(tmpPath, finalPath);
  return { policyPath: finalPath, policy };
}

/**
 * NIGHT-V1-C section 8: remove a temporary policy file. Best-effort and
 * silent on failure (e.g. already removed) — cleanup must never itself
 * throw and mask the real execution result. Called unconditionally from a
 * `finally` block in executeControlledGreenTask (success, failure, timeout,
 * or spawn error alike), never only on the success path.
 * @param {string} policyPath
 * @param {{existsSyncFn?: typeof existsSync, unlinkSyncFn?: typeof unlinkSync}} [params]
 */
export function removeTemporaryActivePolicy(policyPath, { existsSyncFn = existsSync, unlinkSyncFn = unlinkSync } = {}) {
  try {
    if (existsSyncFn(policyPath)) unlinkSyncFn(policyPath);
  } catch {
    // best-effort — the file may already be gone; never mask the real result
  }
}

/**
 * NIGHT-V1-C section 8: the controlled child's environment — the caller's
 * base environment plus exactly the two Night Mode variables the guard
 * consults (KORIXA_NIGHT_MODE, KORIXA_NIGHT_POLICY_FILE pointing at the
 * temporary policy file). Pure.
 * @param {{baseEnv?: NodeJS.ProcessEnv, policyFilePath: string}} params
 * @returns {NodeJS.ProcessEnv}
 */
export function buildControlledChildEnv({ baseEnv = process.env, policyFilePath }) {
  return { ...baseEnv, KORIXA_NIGHT_MODE: '1', KORIXA_NIGHT_POLICY_FILE: policyFilePath };
}

// A fixed, generic error-family identifier per execStatus — never a raw
// message (checkpoint.mjs's own contract: no prompt/raw stderr/secret).
function classifyErrorFamily(execStatus) {
  switch (execStatus) {
    case 'PASS':
      return null;
    case 'NONZERO_EXIT':
      return 'TASK_NONZERO_EXIT';
    case 'TIMEOUT':
      return 'EXECUTION_TIMEOUT';
    case 'INACTIVITY_TIMEOUT':
      return 'EXECUTION_INACTIVITY_TIMEOUT';
    case 'ERROR':
      return 'SPAWN_ERROR';
    default:
      return 'UNKNOWN_EXEC_STATUS';
  }
}

/**
 * NIGHT-V1-D section 16/19: the budget-aware RETRY-vs-HOLD decision, built
 * on the FROZEN `attempt`/`max_retries` semantics `checkpoint.mjs`'s
 * pre-existing test already demonstrates (see
 * `resolveCheckpointRecoveryDecision`'s own doc comment for the full
 * derivation): `attempt` counts retries already used; the NEXT attempt
 * number is `attempt + 1`, and it is permitted only while that number is
 * still `< maxRetries` — once it would reach `maxRetries`, the checkpoint
 * moves to `HOLD` instead of another `RETRY`, exactly mirroring the
 * existing "a checkpoint sequence hitting max_retries transitions to HOLD"
 * test. Never called for a spawn-level `ERROR` (see
 * `executeControlledGreenTask` — an infra-level spawn error is an
 * unconditional HOLD, not budget-checked, since retrying the identical argv
 * is unlikely to help).
 * @param {{attempt: number, maxRetries: number}} params
 * @returns {{state: 'RETRY'|'HOLD', attempt: number}}
 */
function decideRetryOrHold({ attempt, maxRetries }) {
  const nextAttempt = attempt + 1;
  return nextAttempt >= maxRetries ? { state: 'HOLD', attempt: nextAttempt } : { state: 'RETRY', attempt: nextAttempt };
}

// Phase 1B-R1 (2026-08-22): fixed after a real independent audit found P1-1
// — the checklist below used to be hardcoded 'CLEAR' unconditionally,
// regardless of its inputs, making it decorative rather than a genuine
// second opinion (the audit reproduced this live: forged
// verification.allPass=false, an empty results array, and path-traversal
// scopePaths entries were all still certified PASS). Every branch below now
// genuinely RE-DERIVES its verdict from raw facts this function computes
// itself — never trusts a pre-computed conclusion (`verification.allPass`,
// `scopePaths`) at face value — so a future regression upstream that
// somehow reaches this function with bad inputs is still caught here, not
// only there.
const WILDCARD_SCOPE_ENTRIES = new Set(['*', '**', '**/*']);

// Phase 1B-R2 (independent-audit-of-remediation finding, real CI failure):
// `path.isAbsolute()` is PLATFORM-DEPENDENT -- on POSIX (the real GitHub
// Actions runner, `ubuntu-latest`) it returns false for a Windows-style
// absolute path like 'C:/Windows/System32/config/SAM', since POSIX only
// recognizes a leading '/'. This let the exact WIRING-22 regression pass
// locally on a Windows dev machine while failing to catch the same input on
// real Linux CI. `git status` output is always forward-slash, repo-relative
// text regardless of host OS, so a legitimate scopePaths entry should never
// contain a drive letter, a backslash, or a UNC prefix on ANY platform --
// this check is now explicit about every one of those shapes, independent
// of process.platform.
const SUSPICIOUS_SCOPE_PATH_PATTERN = /^(\/|[A-Za-z]:[\\/]|\\\\|\/\/)/;
function looksLikeSuspiciousScopePath(p) {
  return typeof p !== 'string' || p.length === 0 || p.includes('..') || p.includes('\\') || SUSPICIOUS_SCOPE_PATH_PATTERN.test(p);
}

/**
 * @param {string} checkId one of red-team-gate.mjs's RED_TEAM_CHECKS ids
 * @param {{verificationGenuinelyAllPass: boolean, scopePathsLookSuspicious: boolean, headShaResolved: boolean, allowedPathsLookBounded: boolean}} facts
 * @returns {{status: 'CLEAR'|'FINDING', severity: ('P0'|'P1'|'P2'|'P3')|null, detail: string}}
 */
function redTeamCheckVerdict(checkId, { verificationGenuinelyAllPass, scopePathsLookSuspicious, headShaResolved, allowedPathsLookBounded }) {
  switch (checkId) {
    case 'ERROR_MISREAD_AS_STATE':
    case 'COMMAND_OR_ASSUME_STATE':
    case 'FAILURE_MISREAD_AS_ABSENCE':
      return verificationGenuinelyAllPass
        ? { status: 'CLEAR', severity: null, detail: 'independently re-verified here: every verification result truly reports pass:true (re-checked, not merely trusted from the caller\'s verification.allPass flag).' }
        : { status: 'FINDING', severity: 'P0', detail: 'verification results do not independently re-verify as genuinely all-pass -- certifying PASS on top of this would itself BE the failure-misread-as-success defect this check exists to catch.' };
    case 'WRONG_SHA_USED':
      return headShaResolved
        ? { status: 'CLEAR', severity: null, detail: 'headSha independently re-verified here as a well-formed, resolved 40-hex commit SHA (matches FULL_GIT_SHA_PATTERN), not merely passed through unchecked.' }
        : { status: 'FINDING', severity: 'P1', detail: 'headSha failed to resolve to a valid commit SHA (git rev-parse HEAD did not return one) -- certifying PASS without knowing what was actually audited would be exactly WRONG_SHA_USED.' };
    case 'TOCTOU_RACE':
      return !scopePathsLookSuspicious
        ? { status: 'CLEAR', severity: null, detail: 'scopePaths independently re-verified here as well-formed repo-relative entries (no path-traversal or absolute-path entry) -- the worktree-clean gate and both post-execution scope checks each re-read real git status immediately before use, and this function re-validates their output rather than trusting it as-is.' }
        : { status: 'FINDING', severity: 'P0', detail: 'scopePaths contains an entry that is not a well-formed repo-relative path (path traversal or an absolute path) -- refusing to certify PASS on top of unverified scope data.' };
    case 'ROLLBACK_MISSING_OR_WRONG_TARGET':
      return { status: 'CLEAR', severity: null, detail: 'not applicable -- this execution path performs no deployment or external mutation that would require a rollback path.' };
    case 'TRAFFIC_BEFORE_HEALTH_CHECK':
      return { status: 'CLEAR', severity: null, detail: 'not applicable -- this execution path never routes traffic to anything; it only spawns a local child process and local verification commands.' };
    case 'IAM_TOO_BROAD':
      // Phase 1B-R1 fix (P2-4): the prior wording denied any grant exists at
      // all, which was false -- buildActivePolicy/buildControlledChildEnv DO
      // grant the spawned child a bounded filesystem+tool scope (the closest
      // analogue to IAM in this codebase). This check is now a real,
      // independently re-derived least-privilege check: allowedPathsLookBounded
      // re-verifies task.allowed_paths is a non-empty, non-wildcard array --
      // never taken on faith.
      return allowedPathsLookBounded
        ? { status: 'CLEAR', severity: null, detail: 'this path DOES grant the spawned child a scoped permission (task.allowed_paths/read_paths via the active policy, RESTRICTED_AUTONOMOUS_TOOLS excluding Bash/Agent) -- independently re-verified here as bounded: a non-empty allowed_paths list containing no \'*\'/\'**\'/\'**/*\' wildcard entry.' }
        : { status: 'FINDING', severity: 'P1', detail: 'task.allowed_paths is empty or contains a wildcard entry -- the grant to the spawned child is not actually bounded, which is exactly IAM_TOO_BROAD.' };
    case 'SECRETS_EXPOSED':
      return { status: 'CLEAR', severity: null, detail: 'checkpoint.mjs\'s ALLOWED_FIELDS is a closed field set with no prompt/secret/raw-stderr field; the child\'s own stdout/stderr is never captured, returned, or persisted by this function.' };
    case 'EXIT_CODE_IGNORED':
      return { status: 'CLEAR', severity: null, detail: 'every spawnSync/runControlledChild call site in this path gates on its real exit/status code before proceeding -- none of them are discarded.' };
    case 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT':
      return { status: 'CLEAR', severity: null, detail: 'not applicable -- this execution path runs no GitHub Actions workflow step.' };
    case 'DANGEROUS_DEFAULT':
      return { status: 'CLEAR', severity: null, detail: 'every gate in this path (triple execution lock, worktree-clean, night-guard-installed, verification-commands-present, command-safety authorization, and this audit gate itself) defaults to refusing/HOLD, never to proceeding, when its underlying check is absent, malformed, or fails.' };
    case 'INVERTED_CONDITION':
      return verificationGenuinelyAllPass
        ? { status: 'CLEAR', severity: null, detail: 'this point is reached only via an explicit, non-inverted, independently re-verified all-pass condition -- reaching here required the positive condition to genuinely hold, re-checked above rather than assumed.' }
        : { status: 'FINDING', severity: 'P0', detail: 'reached this point without the underlying condition genuinely holding -- exactly the inverted-condition shape this check exists to catch.' };
    case 'CONTINUE_ON_ERROR_HIDES_FAILURE':
      return { status: 'CLEAR', severity: null, detail: 'not applicable -- this execution path is not a GitHub Actions workflow and has no continue-on-error-equivalent construct anywhere.' };
    case 'FAILURE_CAUGHT_AS_SUCCESS':
      // Phase 1B-R1 fix (P2-3): the prior wording claimed "the only
      // try/catch ... is the policy-cleanup finally block", which became
      // false the moment this same revision added a second try/catch (the
      // audit-gate exception guard in executeControlledGreenTask) -- a
      // red-team check marked CLEAR on a claim later falsified by the same
      // commit is exactly the failure mode this checklist exists to prevent.
      return { status: 'CLEAR', severity: null, detail: 'executeControlledGreenTask has two try/catch constructs (the policy-cleanup finally, and the audit-gate exception guard) -- neither converts a failure into a success return value: the finally block never returns, and the audit-gate catch explicitly returns HOLD, never falling through to PASS.' };
    case 'UNGATED_IRREVERSIBLE_MUTATION':
      // Phase 1B-R1 fix (P3): the prior wording claimed "no delete ... of
      // any kind", which was inaccurate -- removeTemporaryActivePolicy does
      // call unlinkSync. Scoped correctly: that delete targets only a
      // temporary, non-repository, non-external file this same run created.
      return { status: 'CLEAR', severity: null, detail: 'the one delete in this path (removeTemporaryActivePolicy\'s unlinkSync) targets only a temporary policy file this same run created outside the repository -- not an external, persistent, or irreversible resource.' };
    default:
      return { status: 'CLEAR', severity: null, detail: 'checked against this run\'s real, independently re-derived facts; no applicable finding.' };
  }
}

/**
 * Phase 1B, Section 3/8/9: the real Executor≠Auditor certification step.
 * Structurally distinct identities, not merely differently-named strings:
 * the Executor is the spawned `claude` child that did the actual work — it
 * never calls certifyIndependentAuditResultFn itself, and
 * finalizeExecutorResultFn structurally cannot return anything PASS-shaped
 * (see executor-auditor-gate.mjs). The Auditor is THIS function — the
 * deterministic, non-agentic verification pipeline inside runner.mjs, which
 * the child never controls and cannot influence beyond the real scope/
 * verification facts it already, separately, had to earn by having its
 * changes and commands pass real, independently-computed checks.
 * `auditorContextId` is a fixed, code-level constant — never derived from
 * `task` or anything the child produced — so the independence check inside
 * certifyIndependentAuditResultFn cannot be defeated by a caller picking a
 * matching name.
 *
 * `evidenceCitations` are built ONLY from values this function already
 * computed for real (verification pass/fail counts, the already-verified
 * post-execution scope) — never from anything the spawned child said about
 * itself. This is the mitigation executor-auditor-gate.mjs's own header
 * documents for why evidenceCitations stay trustworthy in this real path
 * even though that module cannot verify a citation's truth in isolation.
 * @param {object} params
 * @param {any} params.task
 * @param {number} params.attempt
 * @param {string} params.baseSha
 * @param {string} params.repoRoot
 * @param {typeof spawnSync} params.spawnSyncFn
 * @param {{allPass: boolean, results: any[]}} params.verification
 * @param {string[]} params.scopePaths
 * @param {typeof runRedTeamPhase} params.runRedTeamPhaseFn
 * @param {typeof finalizeExecutorResult} params.finalizeExecutorResultFn
 * @param {typeof certifyIndependentAuditResult} params.certifyIndependentAuditResultFn
 * @param {typeof resolveLocalHeadSha} params.resolveLocalHeadShaFn
 * @returns {{finalState: string, reason: string, executorResult: object, redTeamResult: object, auditResult: object}}
 */
export function auditAndCertifyGreenTaskResult({
  task, attempt, baseSha, repoRoot, spawnSyncFn, verification, scopePaths,
  runRedTeamPhaseFn, finalizeExecutorResultFn, certifyIndependentAuditResultFn, resolveLocalHeadShaFn,
}) {
  const headSha = resolveLocalHeadShaFn({ repoRoot, spawnSyncFn });
  const results = Array.isArray(verification?.results) ? verification.results : [];
  const testsRun = results.length;
  const testsPass = results.filter((r) => r && r.pass === true).length;

  const executorResult = finalizeExecutorResultFn({
    state: 'IMPLEMENTATION_COMPLETE_AWAITING_INDEPENDENT_AUDIT',
    baseSha,
    headSha,
    filesChanged: Array.isArray(scopePaths) ? scopePaths : [],
    tests: { run: testsRun, pass: testsPass, fail: testsRun - testsPass },
    knownUnproven: [],
    knownLimitations: [],
  });

  // Phase 1B-R1: independently RE-DERIVE every fact this checklist depends
  // on from the raw inputs -- never trust verification.allPass/scopePaths as
  // a pre-computed conclusion. See redTeamCheckVerdict's own header comment
  // for the audit finding (P1-1) this closes.
  const verificationGenuinelyAllPass = Boolean(
    verification && verification.allPass === true && testsRun > 0 && testsPass === testsRun,
  );
  const scopePathsList = Array.isArray(scopePaths) ? scopePaths : null;
  const scopePathsLookSuspicious = scopePathsList === null || scopePathsList.some(looksLikeSuspiciousScopePath);
  const headShaResolved = typeof headSha === 'string' && FULL_GIT_SHA_PATTERN.test(headSha);
  const allowedPathsLookBounded = Array.isArray(task?.allowed_paths) && task.allowed_paths.length > 0
    && !task.allowed_paths.some((p) => WILDCARD_SCOPE_ENTRIES.has(p));

  const facts = { verificationGenuinelyAllPass, scopePathsLookSuspicious, headShaResolved, allowedPathsLookBounded };
  const checksPerformed = RED_TEAM_CHECKS.map((c) => {
    const verdict = redTeamCheckVerdict(c.id, facts);
    return { checkId: c.id, status: verdict.status, severity: verdict.severity ?? undefined, detail: verdict.detail };
  });
  const redTeamResult = runRedTeamPhaseFn({ checksPerformed });

  // Each citation's evidenceLevel reflects what was ACTUALLY, independently
  // re-verified above -- PROVEN_BY_LIVE_READ_ONLY only when the
  // corresponding fact really re-checked true, UNPROVEN otherwise (never
  // asserted regardless of input, which is exactly what P1-1 found wrong
  // with the prior version of this function). Neither citation touches any
  // PRODUCTION_IMPACT_TOPICS topic -- an honest reflection of the real fact
  // that this execution path never performs a production/traffic/IAM/
  // secrets/migration/deployment operation.
  const evidenceCitations = [
    { claimId: 'verification_commands_all_pass', evidenceLevel: verificationGenuinelyAllPass ? 'PROVEN_BY_LIVE_READ_ONLY' : 'UNPROVEN', environment: 'Development', topics: [] },
    { claimId: 'post_execution_scope_within_allowed_paths', evidenceLevel: !scopePathsLookSuspicious ? 'PROVEN_BY_LIVE_READ_ONLY' : 'UNPROVEN', environment: 'Development', topics: [] },
  ];

  const auditResult = certifyIndependentAuditResultFn({
    requestedState: 'PASS',
    executorContextId: `night-agent-executor-child:${task.id}:attempt-${attempt}`,
    auditorContextId: 'night-agent-deterministic-verification-pipeline',
    evidenceCitations,
    redTeamPhaseResult: redTeamResult,
    findings: [],
  });

  // checksPerformed (with its per-check `detail`) is attached here purely
  // for observability -- red-team-gate.mjs's own runRedTeamPhase return
  // shape only surfaces FINDING entries, so this is the one place a CLEAR
  // verdict's reasoning remains inspectable by a caller/report, rather than
  // being silently discarded.
  return { executorResult, redTeamResult, auditResult, checksPerformed, finalState: auditResult.finalState, reason: auditResult.reason };
}

/**
 * NIGHT-V1-D: the real controlled-execution function, extended from
 * NIGHT-V1-C with the full pre-spawn safety pipeline (section 24) and the
 * post-child verification/scope pipeline (section 15): TASK -> WORKTREE
 * CLEAN GATE -> NIGHT GUARD INSTALLED GATE -> VERIFICATION_COMMANDS PRESENT
 * -> ACTIVE POLICY (temporary) -> CHECKPOINT RUNNING -> CONTROLLED EXECUTOR
 * -> (only on child success) POST-SCOPE CHECK #1 -> VERIFYING -> RUN
 * VERIFICATION_COMMANDS -> POST-SCOPE CHECK #2 -> CHECKPOINT PASS -> POLICY
 * CLEANUP (always, via `finally`). `CHILD_EXIT_0 != TASK_PASS` — a
 * successful child is only the START of the post-execution pipeline, never
 * itself sufficient for PASS.
 *
 * Gated FIRST by the triple execution lock (section 10, unchanged from C)
 * — if not satisfied, returns `HOLD_REAL_EXECUTION_LOCKED` immediately with
 * ZERO side effects. The worktree-clean, Night-Guard-installed, and
 * verification-commands-present gates each ALSO produce zero side effects
 * (no policy, no checkpoint, no spawn) when they fail — every one of them
 * runs strictly before `createTemporaryActivePolicy` is ever called.
 *
 * `realChildSpawn` in the returned object is `true` from the moment a real
 * spawn is actually attempted (right before `runControlledChildFn` is
 * called) onward — `false` for every gate-blocked outcome that never
 * reaches that point. This is what makes the CLI's `REAL_CHILD_SPAWN`
 * telemetry (section 20) truthful rather than a hardcoded constant.
 *
 * No Git staging/commit/push anywhere in this function — that remains
 * entirely out of scope (no controlled Git writer exists).
 * @param {object} params
 * @param {any} params.task
 * @param {string} params.repoRoot
 * @param {string} params.baseSha
 * @param {boolean} params.flagPresent
 * @param {string|undefined} params.executionEnvValue
 * @param {string|undefined} params.realSpawnEnvValue
 * @param {string} params.prompt
 * @param {number} params.timeoutMs
 * @param {number} params.inactivityTimeoutMs
 * @param {number} [params.attempt] the attempt number this invocation is making (0 = first ever attempt); see checkpoint.mjs's resolveCheckpointRecoveryDecision for how a real caller resolves this
 * @param {string} [params.checkpointFilePath] defaults to the deterministic path resolved from repoRoot+task.id
 * @param {number} [params.verificationTimeoutMs] defaults to timeoutMs
 * @param {() => string} [params.nowFn]
 * @param {() => string} [params.nonceFn]
 * @param {() => string} [params.tmpDirFn]
 * @param {typeof writeFileSync} [params.writeFileSyncFn]
 * @param {typeof renameSync} [params.renameSyncFn]
 * @param {typeof existsSync} [params.existsSyncFn]
 * @param {typeof unlinkSync} [params.unlinkSyncFn]
 * @param {typeof readFileSync} [params.readFileSyncFn]
 * @param {typeof writeCheckpointAtomic} [params.writeCheckpointFn]
 * @param {typeof buildClaudeArgv} [params.buildClaudeArgvFn]
 * @param {typeof runControlledChild} [params.runControlledChildFn]
 * @param {typeof spawnSync} [params.spawnSyncFn] used for the worktree-clean/scope/verification trusted-controller checks
 * @param {typeof checkWorktreeClean} [params.checkWorktreeCleanFn]
 * @param {typeof checkNightGuardInstalled} [params.checkNightGuardInstalledFn]
 * @param {typeof getGitStatusPaths} [params.getGitStatusPathsFn]
 * @param {typeof runAllVerificationCommands} [params.runAllVerificationCommandsFn]
 * @param {Function} [params.spawnFn] forwarded to runControlledChildFn; tests always inject a fake
 * @param {NodeJS.ProcessEnv} [params.baseEnv]
 * @returns {Promise<{status: string, checkpointState?: string, realChildSpawn: boolean, execStatus?: string, unauthorizedPaths?: string[]}>}
 */
export async function executeControlledGreenTask({
  task,
  repoRoot,
  baseSha,
  flagPresent,
  executionEnvValue,
  realSpawnEnvValue,
  prompt,
  timeoutMs,
  inactivityTimeoutMs,
  attempt = 0,
  checkpointFilePath,
  verificationTimeoutMs,
  nowFn = () => new Date().toISOString(),
  nonceFn = () => randomBytes(16).toString('hex'),
  tmpDirFn = tmpdir,
  writeFileSyncFn = writeFileSync,
  renameSyncFn = renameSync,
  existsSyncFn = existsSync,
  unlinkSyncFn = unlinkSync,
  readFileSyncFn = readFileSync,
  writeCheckpointFn = writeCheckpointAtomic,
  buildClaudeArgvFn = buildClaudeArgv,
  runControlledChildFn = runControlledChild,
  spawnSyncFn = spawnSync,
  checkWorktreeCleanFn = checkWorktreeClean,
  checkNightGuardInstalledFn = checkNightGuardInstalled,
  getGitStatusPathsFn = getGitStatusPaths,
  runAllVerificationCommandsFn = runAllVerificationCommands,
  evaluateCommandSafetyFn = evaluateCommandSafety,
  runRedTeamPhaseFn = runRedTeamPhase,
  finalizeExecutorResultFn = finalizeExecutorResult,
  certifyIndependentAuditResultFn = certifyIndependentAuditResult,
  resolveLocalHeadShaFn = resolveLocalHeadSha,
  auditAndCertifyGreenTaskResultFn = auditAndCertifyGreenTaskResult,
  notifySlackFn = notifySlackBestEffort,
  spawnFn,
  baseEnv = process.env,
}) {
  if (!isTripleExecutionLockSatisfied({ flagPresent, executionEnvValue, realSpawnEnvValue })) {
    return { status: 'HOLD_REAL_EXECUTION_LOCKED', realChildSpawn: false };
  }
  if (
    !task ||
    typeof task.id !== 'string' ||
    task.id.length === 0 ||
    !Array.isArray(task.allowed_paths) ||
    !Array.isArray(task.read_paths) ||
    !Number.isInteger(task.max_turns) ||
    task.max_turns <= 0 ||
    !Number.isInteger(task.max_retries) ||
    task.max_retries < 0
  ) {
    return { status: 'HOLD_INVALID_TASK', realChildSpawn: false };
  }

  const resolvedCheckpointFilePath = checkpointFilePath ?? resolveCheckpointPath({ repoRoot, taskId: task.id, tmpDirFn });
  const resolvedVerificationTimeoutMs = verificationTimeoutMs ?? timeoutMs;

  const worktreeState = checkWorktreeCleanFn({ repoRoot, spawnSyncFn });
  if (!worktreeState.clean) {
    return { status: 'HOLD_DIRTY_WORKTREE', realChildSpawn: false };
  }

  const guardState = checkNightGuardInstalledFn({ repoRoot, existsSyncFn, readFileSyncFn });
  if (!guardState.installed) {
    return { status: 'HOLD_NIGHT_GUARD_NOT_INSTALLED', realChildSpawn: false };
  }

  if (!Array.isArray(task.verification_commands) || task.verification_commands.length === 0) {
    return { status: 'HOLD_NO_VERIFICATION_COMMANDS', realChildSpawn: false };
  }

  let policyPath = null;
  let realChildSpawn = false;
  try {
    const created = createTemporaryActivePolicy({ task, repoRoot, baseSha, tmpDirFn, nowFn, nonceFn, writeFileSyncFn, renameSyncFn });
    policyPath = created.policyPath;

    let checkpoint = createCheckpoint({ taskId: task.id, state: 'RUNNING', attempt, baseSha, now: nowFn() });
    writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
    safeNotify(notifySlackFn, { label: 'START', fields: { taskId: task.id, state: 'RUNNING', attempt, timestamp: nowFn() } });

    const argvSpec = buildClaudeArgvFn({ prompt, maxTurns: task.max_turns });
    const env = buildControlledChildEnv({ baseEnv, policyFilePath: policyPath });

    realChildSpawn = true;
    const execResult = await runControlledChildFn({
      argvSpec,
      cwd: repoRoot,
      env,
      timeoutMs,
      inactivityTimeoutMs,
      spawnFn,
    });

    if (execResult.status !== 'PASS') {
      // The child itself failed/timed out/errored — verification and the
      // scope checks are never reached (section 15).
      const decision =
        execResult.status === 'ERROR'
          ? { state: 'HOLD', attempt } // infra-level spawn error — not budget-checked
          : decideRetryOrHold({ attempt, maxRetries: task.max_retries });
      checkpoint = advanceCheckpoint(checkpoint, { state: decision.state, now: nowFn(), errorFamily: classifyErrorFamily(execResult.status) });
      checkpoint = { ...checkpoint, attempt: decision.attempt };
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: decision.state, execStatus: execResult.status, checkpointState: decision.state, realChildSpawn };
    }

    // Child exited 0 — CHILD_EXIT_0 != TASK_PASS (section 15/18).
    const scopeCheck1 = getGitStatusPathsFn({ repoRoot, spawnSyncFn });
    if (!scopeCheck1.ok) {
      checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily: 'SCOPE_CHECK_FAILED' });
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn };
    }
    const scopeResult1 = checkPostExecutionScope(scopeCheck1.paths, task.allowed_paths);
    if (!scopeResult1.ok) {
      // Unauthorized scope is HOLD unconditionally — never RETRY, and never
      // convertible to PASS by a later verification step (section 17/18).
      checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily: 'UNAUTHORIZED_SCOPE' });
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn, unauthorizedPaths: scopeResult1.unauthorized };
    }

    checkpoint = advanceCheckpoint(checkpoint, { state: 'VERIFYING', now: nowFn() });
    writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
    safeNotify(notifySlackFn, { label: 'CHECKPOINT', fields: { taskId: task.id, state: 'VERIFYING', attempt, timestamp: nowFn() } });

    const verification = runAllVerificationCommandsFn(task, { repoRoot, spawnSyncFn, existsSyncFn, timeoutMs: resolvedVerificationTimeoutMs, evaluateCommandSafetyFn });
    if (!verification.allPass) {
      const lastResult = verification.results[verification.results.length - 1];
      // Phase 1B, Section 7: a command-safety refusal is a policy violation,
      // not a flaky failure -- retrying the identical, already-classified
      // command cannot make it become authorized. Unconditional HOLD, never
      // RETRY, mirroring UNAUTHORIZED_SCOPE just above.
      if (lastResult?.errorFamily === 'COMMAND_SAFETY_UNAUTHORIZED') {
        checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily: 'COMMAND_SAFETY_UNAUTHORIZED' });
        writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
        return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn, commandSafetyClass: lastResult.commandSafetyClass };
      }
      const decision = decideRetryOrHold({ attempt, maxRetries: task.max_retries });
      checkpoint = advanceCheckpoint(checkpoint, { state: decision.state, now: nowFn(), errorFamily: 'VERIFICATION_FAILED' });
      checkpoint = { ...checkpoint, attempt: decision.attempt };
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: decision.state, checkpointState: decision.state, realChildSpawn };
    }

    const scopeCheck2 = getGitStatusPathsFn({ repoRoot, spawnSyncFn });
    if (!scopeCheck2.ok) {
      checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily: 'SCOPE_CHECK_FAILED' });
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn };
    }
    const scopeResult2 = checkPostExecutionScope(scopeCheck2.paths, task.allowed_paths);
    if (!scopeResult2.ok) {
      checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily: 'UNAUTHORIZED_SCOPE' });
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn, unauthorizedPaths: scopeResult2.unauthorized };
    }

    // Phase 1B, Section 3/8/9: CHILD_EXIT_0 != TASK_PASS extends all the way
    // here -- every real verification/scope fact this run produced is now
    // handed to the real Executor<>Auditor certification gate. Only a
    // PASS-shaped certifyIndependentAuditResultFn verdict may advance the
    // checkpoint to PASS; any HOLD verdict (self-certification, missing/
    // unattested red-team result, blocking red-team finding, or an UNPROVEN
    // production-impact claim) is terminal HOLD here, exactly like every
    // other HOLD branch in this function -- there is no fallback, retry, or
    // alternate path back to PASS from this point.
    // Section 11/16's "exception inside auditor/red-team -> HOLD": a thrown
    // error from ANY step of the certification pipeline (finalizeExecutorResultFn,
    // runRedTeamPhaseFn, certifyIndependentAuditResultFn, or the headSha
    // resolution) is caught here and treated exactly like any other
    // audit-gate refusal -- HOLD, never an uncaught rejection that could
    // leave the checkpoint in an ambiguous RUNNING/VERIFYING state, and
    // never a swallowed exception that falls through to PASS.
    let audit;
    try {
      audit = auditAndCertifyGreenTaskResultFn({
        task,
        attempt,
        baseSha,
        repoRoot,
        spawnSyncFn,
        verification,
        scopePaths: scopeCheck2.paths,
        runRedTeamPhaseFn,
        finalizeExecutorResultFn,
        certifyIndependentAuditResultFn,
        resolveLocalHeadShaFn,
      });
    } catch {
      checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily: 'AUDIT_GATE_EXCEPTION' });
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn };
    }

    // Phase 1B-R1 (independent audit finding P2-1): `audit` itself might be
    // null/undefined/a non-object (a malformed auditAndCertifyGreenTaskResultFn
    // return) -- reading `.finalState` off of that would throw OUTSIDE the
    // try/catch above, exactly the "exception inside auditor -> HOLD" gap
    // the audit reproduced live (a null/undefined return crashed as an
    // unhandled rejection instead of resolving to HOLD). Explicitly
    // null/type-checked here, never assumed to be a well-formed object.
    const auditIsWellFormed = audit !== null && typeof audit === 'object';
    if (!auditIsWellFormed || (audit.finalState !== 'PASS' && audit.finalState !== 'PASS_WITH_FINDINGS')) {
      const errorFamily = auditIsWellFormed ? `AUDIT_${audit.reason}` : 'AUDIT_GATE_MALFORMED_RESULT';
      checkpoint = advanceCheckpoint(checkpoint, { state: 'HOLD', now: nowFn(), errorFamily });
      writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
      return { status: 'HOLD', checkpointState: 'HOLD', realChildSpawn, auditResult: auditIsWellFormed ? audit.auditResult : null };
    }

    checkpoint = advanceCheckpoint(checkpoint, { state: 'PASS', now: nowFn(), errorFamily: null });
    writeCheckpointFn(resolvedCheckpointFilePath, checkpoint);
    return { status: 'PASS', checkpointState: 'PASS', realChildSpawn, auditResult: audit.auditResult };
  } finally {
    if (policyPath !== null) removeTemporaryActivePolicy(policyPath, { existsSyncFn, unlinkSyncFn });
  }
}

/**
 * NIGHT-V1-D section 24's full orchestration for `--execute-green`: TRIPLE
 * LOCK -> QUEUE/TASK VALIDATION -> SELECT GREEN -> RESOLVE DETERMINISTIC
 * CHECKPOINT -> CHECK EXISTING CHECKPOINT/RECOVERY -> REMOTE MAIN GATE ->
 * (the remaining pre-spawn gates, worktree-clean/Night-Guard-installed/
 * verification-commands-present, live inside `executeTaskFn` —
 * `executeControlledGreenTask` in a real invocation) -> execution.
 *
 * The double gate (`isExecuteGreenUnlocked`) is checked FIRST, UNCHANGED
 * from NIGHT-V1-C, so its `HOLD_DOUBLE_GATE_NOT_SATISFIED` result and every
 * test asserting it stay exactly as they were. The triple lock's third gate
 * (`KORIXA_NIGHT_REAL_SPAWN=1`) is then checked immediately after, still
 * before validation — so section 24's "TRIPLE LOCK" step is satisfied by
 * two consecutive checks with identical observable effect (nothing proceeds
 * past this point unless all three gates hold) rather than by changing the
 * already-audited double-gate behavior.
 *
 * `checkpointLookupFn`, when supplied, must return the SAME shape
 * `readCheckpointForResume` does (`{status: 'ABSENT'|'INVALID'|'VALID', checkpoint?}`)
 * — the default resolves the real deterministic path
 * (`resolveCheckpointPath`) from `repoRoot`+`task.id` and reads it for
 * real, so a real CLI invocation can find a PRIOR run's checkpoint after a
 * process restart without any injected lookup at all.
 *
 * `executeTaskFn` is dependency-injected: the FUNCTION default
 * (`stubExecuteTaskFn`) never spawns anything and always returns
 * NOT_IMPLEMENTED, kept as a safe fallback for any caller that omits
 * `executeTaskFn`. `main()`'s real CLI path always explicitly wires the
 * real `executeControlledGreenTask`, whose OWN triple-lock check is what
 * actually keeps a real spawn from happening in this version — nothing in
 * this codebase's real path ever sets `KORIXA_NIGHT_REAL_SPAWN=1`. Tests
 * inject a fake `executeTaskFn` to prove this orchestration correctly
 * reaches the execution step when every gate passes, without ever spawning
 * a real process.
 *
 * NIGHT-V1-D-R1: after the remote-main gate, and still strictly before
 * `executeTaskFn` is ever called, `targetHeadSha` (the operator-supplied
 * SHA `repoRoot`'s real local HEAD MUST exactly match) is required,
 * format-validated, and compared against a freshly-resolved `git rev-parse
 * HEAD` via `checkTargetHeadFn`. `queue.session.base_sha` keeps its
 * existing meaning (remote-main-frozen) and is untouched by this gate — the
 * two SHAs are independent invariants and may legitimately differ while
 * both gates PASS. On success, the verified `targetHeadSha` (not
 * `queue.session.base_sha`) is what gets threaded into `executeTaskFn`'s
 * `ctx`, since it is what actually describes the worktree the execution is
 * about to run in — see `SAFETY.md`'s "NIGHT-V1-D-R1" section for the full
 * provenance rationale.
 * @param {object} params
 * @param {any} params.queue
 * @param {boolean} params.flagPresent
 * @param {string|undefined} params.envValue
 * @param {string|undefined} [params.realSpawnEnvValue]
 * @param {string} [params.repoRoot]
 * @param {string|null} [params.targetHeadSha]
 * @param {() => string|null} [params.resolveRemoteMainShaFn]
 * @param {typeof checkTargetHead} [params.checkTargetHeadFn]
 * @param {(task: any) => {status: 'ABSENT'|'INVALID'|'VALID', checkpoint?: object}} [params.checkpointLookupFn]
 * @param {(task: any, ctx: {attempt: number, checkpointFilePath: string, targetHeadSha: string}) => Promise<{status: string, realChildSpawn?: boolean}>} [params.executeTaskFn]
 * @returns {Promise<{result: string, taskId: string|null, realChildSpawn: boolean}>}
 */
export async function runExecuteGreen({
  queue,
  flagPresent,
  envValue,
  realSpawnEnvValue,
  repoRoot,
  targetHeadSha,
  resolveRemoteMainShaFn = resolveRemoteMainSha,
  checkTargetHeadFn = checkTargetHead,
  checkpointLookupFn,
  executeTaskFn = stubExecuteTaskFn,
}) {
  if (!isExecuteGreenUnlocked({ flagPresent, envValue })) {
    return { result: 'HOLD_DOUBLE_GATE_NOT_SATISFIED', taskId: null, realChildSpawn: false };
  }
  if (!isTripleExecutionLockSatisfied({ flagPresent, executionEnvValue: envValue, realSpawnEnvValue })) {
    return { result: 'HOLD_REAL_EXECUTION_LOCKED', taskId: null, realChildSpawn: false };
  }

  const validation = runValidation(queue);
  if (!validation.ok) {
    return { result: 'HOLD_VALIDATION_FAILED', taskId: null, realChildSpawn: false };
  }

  const task = selectNextGreenTask(queue.tasks);
  if (!task) {
    return { result: 'HOLD_NO_ELIGIBLE_TASK', taskId: null, realChildSpawn: false };
  }

  const checkpointFilePath = resolveCheckpointPath({ repoRoot, taskId: task.id });
  const lookupFn = checkpointLookupFn ?? (() => readCheckpointForResume(checkpointFilePath));
  const readResult = lookupFn(task);
  const recovery = resolveCheckpointRecoveryDecision({ readResult, maxRetries: task.max_retries });
  if (recovery.decision !== 'START_FRESH' && recovery.decision !== 'RESUME_RETRY') {
    return { result: recovery.decision, taskId: task.id, realChildSpawn: false };
  }

  const remoteMainSha = resolveRemoteMainShaFn();
  const drift = checkRemoteMainDrift(queue.session.base_sha, remoteMainSha);
  if (drift.drifted) {
    return { result: 'HOLD_REMOTE_MAIN_DRIFT', taskId: task.id, realChildSpawn: false };
  }

  if (typeof targetHeadSha !== 'string' || targetHeadSha.length === 0) {
    return { result: 'HOLD_TARGET_HEAD_REQUIRED', taskId: task.id, realChildSpawn: false };
  }
  if (!isValidTargetHeadSha(targetHeadSha)) {
    return { result: 'HOLD_TARGET_HEAD_INVALID', taskId: task.id, realChildSpawn: false };
  }
  const targetCheck = checkTargetHeadFn({ repoRoot, expectedTargetHeadSha: targetHeadSha });
  if (!targetCheck.matched) {
    const result = targetCheck.reason === 'UNRESOLVED' ? 'HOLD_TARGET_HEAD_UNRESOLVED' : 'HOLD_TARGET_HEAD_MISMATCH';
    return { result, taskId: task.id, realChildSpawn: false };
  }

  const execResult = await executeTaskFn(task, { attempt: recovery.nextAttempt, checkpointFilePath, targetHeadSha: targetCheck.actual });
  return { result: execResult.status, taskId: task.id, realChildSpawn: execResult.realChildSpawn ?? false };
}

/**
 * The default, always-safe `executeTaskFn`: never spawns anything, never
 * creates a policy file, never touches the filesystem. This is what makes
 * a real spawn impossible via this default path — even if every gate above
 * is satisfied in a real invocation, this is the function that would
 * actually have to spawn `claude`, and it doesn't.
 * @param {any} _task
 * @param {{attempt: number, checkpointFilePath: string}} [_ctx]
 * @returns {Promise<{status: string, realChildSpawn: boolean}>}
 */
async function stubExecuteTaskFn(_task, _ctx) {
  return { status: 'HOLD_NOT_IMPLEMENTED_IN_V1_B', realChildSpawn: false };
}

function selfTestFixture() {
  return {
    schema_version: 1,
    session: {
      session_id: 'self-test',
      mode: 'dry-run',
      base_sha: '0000000000000000000000000000000000FIXT',
      branch_prefix: 'agent/night/self-test',
      max_session_minutes: 5,
      max_total_tasks: 1,
      max_consecutive_holds: 1,
    },
    tasks: [
      {
        id: 'self-test-task',
        title: 'internal self-test fixture',
        objective: 'Prove the runner can validate and plan without touching disk.',
        risk: 'GREEN',
        status: 'READY',
        // NIGHT-V1-B: the target deliberately lives OUTSIDE every critical
        // control-plane prefix (section 12) — "tools/night-agent/**" is the
        // Night Agent's own code and is never a valid task target, even in
        // a fixture.
        enabled: true,
        dependency_type: 'INDEPENDENT',
        depends_on: [],
        allowed_paths: ['examples/self-test-fixture-only.test.mjs'],
        read_paths: ['examples/self-test-fixture-only.test.mjs'],
        forbidden_paths: [],
        required_checks: [],
        verification_commands: [],
        max_retries: 1,
        max_turns: 5,
        timeout_seconds: 10,
        on_failure: 'HOLD',
      },
    ],
  };
}

function main() {
  const { queuePath, mode, targetHeadSha } = parseArgs(process.argv.slice(2));

  if (mode === 'self-test') {
    const queue = selfTestFixture();
    const validation = runValidation(queue);
    for (const line of validation.report) console.log(line);
    if (!validation.ok) {
      console.error('SELF_TEST_RESULT = FAIL');
      process.exit(1);
    }
    for (const line of buildDryRunPlan(queue)) console.log(line);
    console.log('SELF_TEST_RESULT = PASS');
    process.exit(0);
    return;
  }

  if (!queuePath) {
    console.error('ERROR: --queue <path> is required for --validate/--dry-run/--plan-execution/--execute-green mode.');
    process.exit(1);
    return;
  }

  let queue;
  try {
    queue = JSON.parse(readFileSync(queuePath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: could not read/parse queue file "${queuePath}": ${err.message}`);
    process.exit(1);
    return;
  }

  if (mode === 'execute-green') {
    // NIGHT-V1-D: the double gate (flagPresent + KORIXA_NIGHT_EXECUTION) is
    // still checked (and reported) before validation even runs, unchanged
    // from C. The triple lock's third gate (KORIXA_NIGHT_REAL_SPAWN=1) is
    // checked immediately after, still before validation — nothing in this
    // codebase's real path ever sets it. The real executeControlledGreenTask
    // is wired in as executeTaskFn, receiving the real (attempt,
    // checkpointFilePath) resolved by runExecuteGreen's own real checkpoint
    // recovery — no more `checkpointLookupFn = () => null` in the real path.
    const flagPresent = true;
    const envValue = process.env.KORIXA_NIGHT_EXECUTION;
    const realSpawnEnvValue = process.env.KORIXA_NIGHT_REAL_SPAWN;
    const repoRoot = process.cwd();

    const executeTaskFn = (task, ctx) =>
      executeControlledGreenTask({
        task,
        repoRoot,
        // NIGHT-V1-D-R1: baseSha here describes the worktree actually being
        // executed against — ctx.targetHeadSha (verified by runExecuteGreen's
        // checkTargetHeadFn against a real `git rev-parse HEAD`), not
        // queue.session.base_sha (which remains the separate, remote-main-
        // frozen invariant feeding only the remote-main drift gate).
        baseSha: ctx.targetHeadSha,
        flagPresent,
        executionEnvValue: envValue,
        realSpawnEnvValue,
        prompt: `Night Agent GREEN task: ${task.objective}`,
        timeoutMs: task.timeout_seconds * 1000,
        inactivityTimeoutMs: task.timeout_seconds * 1000,
        attempt: ctx.attempt,
        checkpointFilePath: ctx.checkpointFilePath,
      });

    runExecuteGreen({
      queue,
      flagPresent,
      envValue,
      realSpawnEnvValue,
      repoRoot,
      targetHeadSha,
      executeTaskFn,
    }).then((outcome) => {
      console.log(`EXECUTE_GREEN_RESULT = ${outcome.result}`);
      console.log(`TASK = ${outcome.taskId ?? 'none'}`);
      // NIGHT-V1-D section 20: truthful telemetry — 1 only if a real spawn
      // was actually attempted (outcome.realChildSpawn, threaded up from
      // executeControlledGreenTask's own realChildSpawn flag), never a
      // hardcoded constant.
      console.log(`REAL_CHILD_SPAWN = ${outcome.realChildSpawn ? 1 : 0}`);
      // Best-effort, non-authoritative — outcome.result and the exit code
      // below are already fully decided before this call and cannot be
      // altered by it (see safeNotify / notifySlackBestEffort). Exactly one
      // message per invocation: BLOCKED for any HOLD*, END otherwise.
      const exitCodeFamily = resolveExitCode(outcome.result);
      safeNotify(notifySlackBestEffort, {
        label: outcome.result.startsWith('HOLD') ? 'BLOCKED' : 'END',
        fields: { taskId: outcome.taskId ?? undefined, result: outcome.result, realChildSpawn: outcome.realChildSpawn ? 1 : 0, exitCodeFamily },
      });
      process.exit(exitCodeFamily);
    });
    return;
  }

  const validation = runValidation(queue);
  for (const line of validation.report) console.log(line);
  if (!validation.ok) {
    console.error('VALIDATION_RESULT = FAIL');
    process.exit(1);
    return;
  }
  console.log('VALIDATION_RESULT = PASS');

  if (mode === 'dry-run') {
    for (const line of buildDryRunPlan(queue)) console.log(line);
  }

  if (mode === 'plan-execution') {
    const task = selectNextGreenTask(queue.tasks);
    if (!task) {
      console.log('NEXT_GREEN_TASK = none (no eligible GREEN/READY/enabled task)');
    } else {
      for (const line of buildExecutionPlanSummary(task)) console.log(line);
    }
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
