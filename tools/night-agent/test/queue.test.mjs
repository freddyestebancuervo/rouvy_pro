import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validateSchema,
  findCycle,
  findPathConflicts,
  selectNextGreenTask,
  classifyExecutability,
} from '../queue.mjs';

const EXAMPLE_QUEUE_PATH = fileURLToPath(
  new URL('../../../.claude/overnight/TASK_QUEUE.example.json', import.meta.url),
);

function loadExampleQueue() {
  return JSON.parse(readFileSync(EXAMPLE_QUEUE_PATH, 'utf8'));
}

function minimalTask(overrides = {}) {
  return {
    id: 'task-a',
    title: 't',
    objective: 'o',
    risk: 'GREEN',
    status: 'READY',
    dependency_type: 'INDEPENDENT',
    depends_on: [],
    allowed_paths: [],
    forbidden_paths: [],
    required_checks: [],
    max_retries: 1,
    timeout_seconds: 10,
    on_failure: 'HOLD',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The repo's own fixture must validate cleanly — this is also a regression
// guard against accidentally corrupting the example queue file.
// ---------------------------------------------------------------------------

test('the committed TASK_QUEUE.example.json is schema-valid', () => {
  const queue = loadExampleQueue();
  const result = validateSchema(queue);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('the committed TASK_QUEUE.example.json has no dependency cycle', () => {
  const queue = loadExampleQueue();
  assert.equal(findCycle(queue.tasks), null);
});

test('the committed TASK_QUEUE.example.json has no allowed_paths conflicts across distinct example tasks', () => {
  const queue = loadExampleQueue();
  assert.deepEqual(findPathConflicts(queue.tasks), []);
});

test('the committed TASK_QUEUE.example.json selects task-green-independent-001 as the next GREEN task', () => {
  const queue = loadExampleQueue();
  const next = selectNextGreenTask(queue.tasks);
  assert.equal(next?.id, 'task-green-independent-001');
});

test('YELLOW and RED example tasks are never returned as the next GREEN task, regardless of status', () => {
  const queue = loadExampleQueue();
  // Force everything to READY to prove risk (not status) is what excludes them.
  const forced = queue.tasks.map((t) => ({ ...t, status: 'READY' }));
  const next = selectNextGreenTask(forced);
  assert.notEqual(next?.risk, 'YELLOW');
  assert.notEqual(next?.risk, 'RED');
});

// ---------------------------------------------------------------------------
// validateSchema
// ---------------------------------------------------------------------------

test('validateSchema rejects a non-object', () => {
  assert.equal(validateSchema(null).valid, false);
  assert.equal(validateSchema('nope').valid, false);
});

test('validateSchema rejects wrong schema_version', () => {
  const queue = { schema_version: 2, session: {}, tasks: [] };
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('schema_version')));
});

test('validateSchema rejects duplicate task ids', () => {
  const queue = {
    schema_version: 1,
    session: {
      session_id: 's',
      mode: 'dry-run',
      base_sha: '0'.repeat(40),
      branch_prefix: 'agent/night/x',
      max_session_minutes: 1,
      max_total_tasks: 1,
      max_consecutive_holds: 1,
    },
    tasks: [minimalTask({ id: 'dup' }), minimalTask({ id: 'dup' })],
  };
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate task id')));
});

test('validateSchema rejects a depends_on referencing an unknown task id', () => {
  const queue = {
    schema_version: 1,
    session: {
      session_id: 's',
      mode: 'dry-run',
      base_sha: '0'.repeat(40),
      branch_prefix: 'agent/night/x',
      max_session_minutes: 1,
      max_total_tasks: 1,
      max_consecutive_holds: 1,
    },
    tasks: [minimalTask({ id: 'a', depends_on: ['ghost'] })],
  };
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('unknown task id')));
});

test('validateSchema rejects an invalid risk value', () => {
  const queue = {
    schema_version: 1,
    session: {
      session_id: 's',
      mode: 'dry-run',
      base_sha: '0'.repeat(40),
      branch_prefix: 'agent/night/x',
      max_session_minutes: 1,
      max_total_tasks: 1,
      max_consecutive_holds: 1,
    },
    tasks: [minimalTask({ risk: 'BLUE' })],
  };
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// findCycle
// ---------------------------------------------------------------------------

test('findCycle returns null for an acyclic dependency graph', () => {
  const tasks = [
    minimalTask({ id: 'a', depends_on: [] }),
    minimalTask({ id: 'b', depends_on: ['a'] }),
    minimalTask({ id: 'c', depends_on: ['b'] }),
  ];
  assert.equal(findCycle(tasks), null);
});

test('findCycle detects a direct two-node cycle', () => {
  const tasks = [
    minimalTask({ id: 'a', depends_on: ['b'] }),
    minimalTask({ id: 'b', depends_on: ['a'] }),
  ];
  const cycle = findCycle(tasks);
  assert.ok(cycle);
  assert.ok(cycle.includes('a'));
  assert.ok(cycle.includes('b'));
});

test('findCycle detects a longer indirect cycle', () => {
  const tasks = [
    minimalTask({ id: 'a', depends_on: ['b'] }),
    minimalTask({ id: 'b', depends_on: ['c'] }),
    minimalTask({ id: 'c', depends_on: ['a'] }),
  ];
  assert.ok(findCycle(tasks));
});

test('findCycle ignores self-referential unknown ids (schema validation catches those separately)', () => {
  const tasks = [minimalTask({ id: 'a', depends_on: ['ghost'] })];
  assert.equal(findCycle(tasks), null);
});

// ---------------------------------------------------------------------------
// findPathConflicts
// ---------------------------------------------------------------------------

test('findPathConflicts is empty when no allowed_paths overlap', () => {
  const tasks = [
    minimalTask({ id: 'a', allowed_paths: ['x.mjs'] }),
    minimalTask({ id: 'b', allowed_paths: ['y.mjs'] }),
  ];
  assert.deepEqual(findPathConflicts(tasks), []);
});

test('findPathConflicts reports a shared path between two tasks', () => {
  const tasks = [
    minimalTask({ id: 'a', allowed_paths: ['shared.mjs'] }),
    minimalTask({ id: 'b', allowed_paths: ['shared.mjs'] }),
  ];
  const conflicts = findPathConflicts(tasks);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a, 'a');
  assert.equal(conflicts[0].b, 'b');
  assert.equal(conflicts[0].path, 'shared.mjs');
});

// ---------------------------------------------------------------------------
// selectNextGreenTask / classifyExecutability
// ---------------------------------------------------------------------------

test('selectNextGreenTask skips a HARD_DEPENDENCY task whose dependency is not DONE', () => {
  const tasks = [
    minimalTask({ id: 'a', status: 'BLOCKED' }),
    minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'] }),
  ];
  assert.equal(selectNextGreenTask(tasks), null);
});

test('selectNextGreenTask returns a HARD_DEPENDENCY task once its dependency is DONE', () => {
  const tasks = [
    minimalTask({ id: 'a', status: 'DONE' }),
    minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'], status: 'READY' }),
  ];
  assert.equal(selectNextGreenTask(tasks)?.id, 'b');
});

test('classifyExecutability marks RED as never executable regardless of status', () => {
  const task = minimalTask({ risk: 'RED', status: 'READY' });
  const result = classifyExecutability(task, [task]);
  assert.equal(result.executable, false);
});

test('classifyExecutability marks YELLOW as not executable in V1 regardless of status', () => {
  const task = minimalTask({ risk: 'YELLOW', status: 'READY' });
  const result = classifyExecutability(task, [task]);
  assert.equal(result.executable, false);
});

test('classifyExecutability marks a READY, dependency-free GREEN task as executable', () => {
  const task = minimalTask({ risk: 'GREEN', status: 'READY' });
  const result = classifyExecutability(task, [task]);
  assert.equal(result.executable, true);
});
