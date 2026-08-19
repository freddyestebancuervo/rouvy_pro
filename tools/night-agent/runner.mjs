#!/usr/bin/env node
// Korixa Night Agent — V1/V1-B runner.
//
// EXECUTION_ENGINE = DISABLED_IN_V1_A, and real execution remains
// unimplemented in V1-B too — see runExecuteGreen's `executeTaskFn` default
// below. This runner validates a queue file, prints what it WOULD do
// (--dry-run), and (new in V1-B) previews the concrete execution plan for
// the next GREEN task (--plan-execution) — all without spawning `claude` or
// mutating any file. `--execute-green` exists as a real, double-gated code
// path (CLI flag AND KORIXA_NIGHT_EXECUTION=1, section 35) so its wiring —
// remote-main drift check, task selection, stale-checkpoint handling — is
// provably reachable and testable, but its actual task-execution step is a
// hard stub that never spawns a real child in this block, regardless of
// whether the double-gate is satisfied. CLAUDE_AGENT_RUNS stays 0.
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
//   --execute-green        Double-gated (CLI flag + KORIXA_NIGHT_EXECUTION
//                          env var). Even when unlocked, real execution is
//                          not implemented in V1-B — see above.
//   --self-test            Run this file's own internal fixture: hardcoded
//                          in-memory queue objects, no filesystem/network.
//
// Usage:
//   node tools/night-agent/runner.mjs --queue <path> [--validate|--dry-run|--plan-execution]
//   node tools/night-agent/runner.mjs --queue <path> --execute-green
//   node tools/night-agent/runner.mjs --self-test

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  validateSchema,
  findCycle,
  findPathConflicts,
  selectNextGreenTask,
  classifyExecutability,
  FIXTURE_BASE_SHA,
} from './queue.mjs';
import { RESTRICTED_AUTONOMOUS_TOOLS } from './executor.mjs';
import { resolveResumeState } from './checkpoint.mjs';

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
    'EXECUTE_GREEN_LOCK = requires --execute-green AND KORIXA_NIGHT_EXECUTION=1 simultaneously; neither alone is sufficient',
    'REAL_CHILD_SPAWN = 0 (not implemented in V1-B regardless of gate state)',
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
 * Section 19-23's orchestration for `--execute-green`: check the double
 * gate, validate the queue, select the next GREEN task, check for a stale
 * checkpoint, check remote-main drift — all BEFORE any hypothetical
 * execution step. `executeTaskFn` is dependency-injected: the default
 * (`stubExecuteTaskFn`) never spawns anything and always returns
 * NOT_IMPLEMENTED, so REAL_CHILD_SPAWN stays 0 by construction regardless
 * of how the gates resolve. Tests inject a fake `executeTaskFn` to prove
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
    // The double gate is checked (and reported) before validation even
    // runs, so an unlocked-gate failure never depends on queue content.
    runExecuteGreen({
      queue,
      flagPresent: true,
      envValue: process.env.KORIXA_NIGHT_EXECUTION,
    }).then((outcome) => {
      console.log(`EXECUTE_GREEN_RESULT = ${outcome.result}`);
      console.log(`TASK = ${outcome.taskId ?? 'none'}`);
      console.log('REAL_CHILD_SPAWN = 0');
      // Every possible outcome in V1-B is a HOLD/no-op of some kind — never
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
