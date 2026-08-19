#!/usr/bin/env node
// Korixa Night Agent — V1 runner.
//
// EXECUTION_ENGINE = DISABLED_IN_V1_A. This runner only validates a queue
// file and, at most, prints what it WOULD do. It never spawns `claude`,
// never mutates any file, and never runs a task's required_checks for real.
// A future version (post V1-A) can add real execution as a new mode without
// rewriting this file's structure — see tools/night-agent/README.md.
//
// Modes (default: dry-run):
//   --validate            Validate queue schema/cycles/path-conflicts only.
//   --dry-run             Validate, then print the GREEN execution plan
//                          (which task would run next, in what order) —
//                          without running or changing anything.
//   --self-test           Run this file's own internal fixture: hardcoded
//                          in-memory queue objects, no filesystem/network.
//
// Usage:
//   node tools/night-agent/runner.mjs --queue <path> [--validate|--dry-run]
//   node tools/night-agent/runner.mjs --self-test

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  validateSchema,
  findCycle,
  findPathConflicts,
  selectNextGreenTask,
  classifyExecutability,
} from './queue.mjs';

/**
 * @param {string[]} argv
 * @returns {{queuePath: string|null, mode: 'validate'|'dry-run'|'self-test'}}
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
        dependency_type: 'INDEPENDENT',
        depends_on: [],
        allowed_paths: ['tools/night-agent/test/example-fixture-only.test.mjs'],
        forbidden_paths: [],
        required_checks: [],
        max_retries: 1,
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
    console.error('ERROR: --queue <path> is required for --validate/--dry-run mode.');
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

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
