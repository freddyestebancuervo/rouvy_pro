#!/usr/bin/env node
// Korixa Night Agent — V1/V1-B runner.
//
// EXECUTION_ENGINE = DISABLED_IN_V1_A. NIGHT-V1-C wires the real controlled-
// execution pipeline end to end — TASK -> temporary ACTIVE POLICY ->
// CHECKPOINT RUNNING -> CONTROLLED EXECUTOR -> RESULT -> CHECKPOINT FINAL ->
// POLICY CLEANUP (see executeControlledGreenTask below) — but a THIRD,
// separate gate on top of the existing double gate (section 10's "triple
// execution lock": CLI flag + KORIXA_NIGHT_EXECUTION=1 + a further
// KORIXA_NIGHT_REAL_SPAWN=1) still guards the actual spawn. Nothing in this
// codebase's real CLI path ever sets KORIXA_NIGHT_REAL_SPAWN — so every real
// `--execute-green` invocation in NIGHT-V1-C still resolves to
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
//                          invocation — see above.
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
} from './queue.mjs';
import { RESTRICTED_AUTONOMOUS_TOOLS, buildClaudeArgv, runControlledChild } from './executor.mjs';
import { createCheckpoint, advanceCheckpoint, writeCheckpointAtomic, resolveResumeState } from './checkpoint.mjs';

/**
 * @param {string[]} argv
 * @returns {{queuePath: string|null, mode: 'validate'|'dry-run'|'self-test'|'plan-execution'|'execute-green'}}
 */
export function parseArgs(argv) {
  let queuePath = null;
  let mode = 'dry-run'; // default per NIGHT-V1-A contract
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
    }
  }
  return { queuePath, mode };
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

// NIGHT-V1-C section 13: a single execution attempt's outcome maps to a
// checkpoint terminal state. PASS on real success; RETRY for outcomes a
// future attempt could plausibly resolve (the child ran but the task
// itself did not verify, or it was killed by a timeout); HOLD for a
// spawn-level ERROR (an infrastructure problem — a wrong/missing `claude`
// binary, a permission issue — that blindly retrying the same argv is
// unlikely to fix, matching POLICY.md's "HOLD is the preferred outcome over
// unsafe improvisation"). This is a single-attempt classification only — a
// multi-attempt retry-budget loop (attempt count vs max_retries) is a
// distinct, future orchestration concern, out of this block's 3 objectives.
function classifyCheckpointState(execStatus) {
  if (execStatus === 'PASS') return 'PASS';
  if (execStatus === 'ERROR') return 'HOLD';
  return 'RETRY'; // NONZERO_EXIT, TIMEOUT, INACTIVITY_TIMEOUT
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
 * NIGHT-V1-C section 9: the real controlled-execution function — TASK ->
 * ACTIVE POLICY (temporary) -> CHECKPOINT RUNNING -> CONTROLLED EXECUTOR ->
 * RESULT -> CHECKPOINT FINAL -> POLICY CLEANUP (always, via `finally`).
 *
 * Gated FIRST by the triple execution lock (section 10) — if not satisfied,
 * returns `HOLD_REAL_EXECUTION_LOCKED` immediately with ZERO side effects:
 * no policy file, no checkpoint write, no spawn attempt. Only when all
 * three gates are satisfied does this function do anything at all. Nothing
 * in this codebase's real CLI path ever sets KORIXA_NIGHT_REAL_SPAWN=1, so
 * REAL_CLAUDE_AGENT_RUNS stays 0 for every real invocation in NIGHT-V1-C;
 * tests prove the path past the lock is reachable by passing the three gate
 * values directly, always paired with an injected fake `spawnFn` — never a
 * real spawn.
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
 * @param {string} [params.checkpointFilePath]
 * @param {() => string} [params.nowFn]
 * @param {() => string} [params.nonceFn]
 * @param {() => string} [params.tmpDirFn]
 * @param {typeof writeFileSync} [params.writeFileSyncFn]
 * @param {typeof renameSync} [params.renameSyncFn]
 * @param {typeof existsSync} [params.existsSyncFn]
 * @param {typeof unlinkSync} [params.unlinkSyncFn]
 * @param {typeof writeCheckpointAtomic} [params.writeCheckpointFn]
 * @param {typeof buildClaudeArgv} [params.buildClaudeArgvFn]
 * @param {typeof runControlledChild} [params.runControlledChildFn]
 * @param {Function} [params.spawnFn] forwarded to runControlledChildFn; tests always inject a fake
 * @param {NodeJS.ProcessEnv} [params.baseEnv]
 * @returns {Promise<{status: string, checkpointState?: string}>}
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
  checkpointFilePath = path.join(tmpdir(), `korixa-night-checkpoint-${task?.id ?? 'unknown'}.json`),
  nowFn = () => new Date().toISOString(),
  nonceFn = () => randomBytes(16).toString('hex'),
  tmpDirFn = tmpdir,
  writeFileSyncFn = writeFileSync,
  renameSyncFn = renameSync,
  existsSyncFn = existsSync,
  unlinkSyncFn = unlinkSync,
  writeCheckpointFn = writeCheckpointAtomic,
  buildClaudeArgvFn = buildClaudeArgv,
  runControlledChildFn = runControlledChild,
  spawnFn,
  baseEnv = process.env,
}) {
  if (!isTripleExecutionLockSatisfied({ flagPresent, executionEnvValue, realSpawnEnvValue })) {
    return { status: 'HOLD_REAL_EXECUTION_LOCKED' };
  }
  if (
    !task ||
    typeof task.id !== 'string' ||
    task.id.length === 0 ||
    !Array.isArray(task.allowed_paths) ||
    !Array.isArray(task.read_paths) ||
    !Number.isInteger(task.max_turns) ||
    task.max_turns <= 0
  ) {
    return { status: 'HOLD_INVALID_TASK' };
  }

  let policyPath = null;
  try {
    const created = createTemporaryActivePolicy({ task, repoRoot, baseSha, tmpDirFn, nowFn, nonceFn, writeFileSyncFn, renameSyncFn });
    policyPath = created.policyPath;

    let checkpoint = createCheckpoint({ taskId: task.id, state: 'RUNNING', attempt: 1, baseSha, now: nowFn() });
    writeCheckpointFn(checkpointFilePath, checkpoint);

    const argvSpec = buildClaudeArgvFn({ prompt, maxTurns: task.max_turns });
    const env = buildControlledChildEnv({ baseEnv, policyFilePath: policyPath });

    const execResult = await runControlledChildFn({
      argvSpec,
      cwd: repoRoot,
      env,
      timeoutMs,
      inactivityTimeoutMs,
      spawnFn,
    });

    const finalState = classifyCheckpointState(execResult.status);
    checkpoint = advanceCheckpoint(checkpoint, { state: finalState, now: nowFn(), errorFamily: classifyErrorFamily(execResult.status) });
    writeCheckpointFn(checkpointFilePath, checkpoint);

    return { status: execResult.status, checkpointState: finalState };
  } finally {
    if (policyPath !== null) removeTemporaryActivePolicy(policyPath, { existsSyncFn, unlinkSyncFn });
  }
}

/**
 * Section 19-23's orchestration for `--execute-green`: check the double
 * gate, validate the queue, select the next GREEN task, check for a stale
 * checkpoint, check remote-main drift — all BEFORE any hypothetical
 * execution step. `executeTaskFn` is dependency-injected: the FUNCTION
 * default (`stubExecuteTaskFn`) never spawns anything and always returns
 * NOT_IMPLEMENTED, kept as a safe fallback for any caller that omits
 * `executeTaskFn`. NIGHT-V1-C: `main()`'s real CLI path no longer relies on
 * that implicit default — it always explicitly wires the real
 * `executeControlledGreenTask`, whose OWN triple-lock check (section 10) is
 * what actually keeps REAL_CHILD_SPAWN at 0 for every real invocation, not
 * merely this function's stub. Tests inject a fake `executeTaskFn` to prove
 * this orchestration correctly reaches the execution step when every gate
 * passes, without ever spawning a real process.
 * @param {object} params
 * @param {any} params.queue
 * @param {boolean} params.flagPresent
 * @param {string|undefined} params.envValue
 * @param {() => string|null} [params.resolveRemoteMainShaFn]
 * @param {(checkpoint: any) => {hasControlledChildEvidence: boolean}} [params.checkpointLookupFn] returns null if no checkpoint exists
 * @param {(task: any) => Promise<{status: string}>} [params.executeTaskFn]
 * @returns {Promise<{result: string, taskId: string|null}>}
 */
export async function runExecuteGreen({
  queue,
  flagPresent,
  envValue,
  resolveRemoteMainShaFn = resolveRemoteMainSha,
  checkpointLookupFn = () => null,
  executeTaskFn = stubExecuteTaskFn,
}) {
  if (!isExecuteGreenUnlocked({ flagPresent, envValue })) {
    return { result: 'HOLD_DOUBLE_GATE_NOT_SATISFIED', taskId: null };
  }

  const validation = runValidation(queue);
  if (!validation.ok) {
    return { result: 'HOLD_VALIDATION_FAILED', taskId: null };
  }

  const task = selectNextGreenTask(queue.tasks);
  if (!task) {
    return { result: 'HOLD_NO_ELIGIBLE_TASK', taskId: null };
  }

  const existingCheckpoint = checkpointLookupFn(task.id);
  const resume = resolveResumeState(existingCheckpoint, { hasControlledChildEvidence: false });
  if (resume.action === 'HOLD_STALE_SESSION') {
    return { result: 'HOLD_STALE_SESSION', taskId: task.id };
  }
  if (resume.action === 'ALREADY_PASSED') {
    return { result: 'ALREADY_PASSED', taskId: task.id };
  }
  if (resume.action === 'STAY_HOLD') {
    return { result: 'STAY_HOLD', taskId: task.id };
  }

  const remoteMainSha = resolveRemoteMainShaFn();
  const drift = checkRemoteMainDrift(queue.session.base_sha, remoteMainSha);
  if (drift.drifted) {
    return { result: 'HOLD_REMOTE_MAIN_DRIFT', taskId: task.id };
  }

  // Every gate passed. NIGHT-V1-B still does not implement real execution
  // (no policy file is created, no child is spawned) — see executeTaskFn's
  // default below.
  const execResult = await executeTaskFn(task);
  return { result: execResult.status, taskId: task.id };
}

/**
 * The default, always-safe `executeTaskFn`: never spawns anything, never
 * creates a policy file, never touches the filesystem. This is what makes
 * REAL_CHILD_SPAWN = 0 an invariant of this file rather than a promise —
 * even if every gate above is satisfied in a real invocation, this is the
 * function that would actually have to spawn `claude`, and it doesn't.
 * @param {any} _task
 * @returns {Promise<{status: string}>}
 */
async function stubExecuteTaskFn(_task) {
  return { status: 'HOLD_NOT_IMPLEMENTED_IN_V1_B' };
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
  const { queuePath, mode } = parseArgs(process.argv.slice(2));

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
    // NIGHT-V1-C: the double gate (flagPresent + KORIXA_NIGHT_EXECUTION) is
    // still checked (and reported) before validation even runs, so an
    // unlocked-gate failure never depends on queue content. The real
    // executeControlledGreenTask is now wired in (no longer the permanent
    // stub) as the executeTaskFn — but its own triple-lock check (section
    // 10) still requires KORIXA_NIGHT_REAL_SPAWN=1, which nothing in this
    // codebase's real path ever sets, so REAL_CHILD_SPAWN stays 0 here too.
    const flagPresent = true;
    const envValue = process.env.KORIXA_NIGHT_EXECUTION;
    const realSpawnEnvValue = process.env.KORIXA_NIGHT_REAL_SPAWN;
    const repoRoot = process.cwd();

    const executeTaskFn = (task) =>
      executeControlledGreenTask({
        task,
        repoRoot,
        baseSha: queue.session.base_sha,
        flagPresent,
        executionEnvValue: envValue,
        realSpawnEnvValue,
        prompt: `Night Agent GREEN task: ${task.objective}`,
        timeoutMs: task.timeout_seconds * 1000,
        inactivityTimeoutMs: task.timeout_seconds * 1000,
      });

    runExecuteGreen({
      queue,
      flagPresent,
      envValue,
      executeTaskFn,
    }).then((outcome) => {
      console.log(`EXECUTE_GREEN_RESULT = ${outcome.result}`);
      console.log(`TASK = ${outcome.taskId ?? 'none'}`);
      console.log('REAL_CHILD_SPAWN = 0');
      // Every possible outcome in V1-C is a HOLD/no-op of some kind — never
      // a successful autonomous execution — so this always exits non-zero,
      // signaling "nothing was executed" to any calling script.
      process.exit(1);
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
