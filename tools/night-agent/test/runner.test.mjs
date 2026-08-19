import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, runValidation, buildDryRunPlan } from '../runner.mjs';

const RUNNER_PATH = fileURLToPath(new URL('../runner.mjs', import.meta.url));
const EXAMPLE_QUEUE_PATH = fileURLToPath(
  new URL('../../../.claude/overnight/TASK_QUEUE.example.json', import.meta.url),
);

function minimalQueue(overrides = {}) {
  return {
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
    tasks: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs defaults to dry-run mode with no queue', () => {
  const result = parseArgs([]);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.queuePath, null);
});

test('parseArgs reads --queue and --validate', () => {
  const result = parseArgs(['--queue', 'foo.json', '--validate']);
  assert.equal(result.queuePath, 'foo.json');
  assert.equal(result.mode, 'validate');
});

test('parseArgs reads --self-test', () => {
  const result = parseArgs(['--self-test']);
  assert.equal(result.mode, 'self-test');
});

// ---------------------------------------------------------------------------
// runValidation / buildDryRunPlan (pure, in-process)
// ---------------------------------------------------------------------------

test('runValidation passes on an empty-but-schema-valid queue', () => {
  const result = runValidation(minimalQueue());
  assert.equal(result.ok, true);
});

test('runValidation fails on a schema error and stops before cycle/path checks', () => {
  const result = runValidation({ schema_version: 2, session: {}, tasks: [] });
  assert.equal(result.ok, false);
  assert.ok(result.report.some((l) => l.startsWith('SCHEMA_ERROR')));
});

test('buildDryRunPlan reports EXECUTION_ENGINE = DISABLED_IN_V1_A and never mutates the input', () => {
  const queue = minimalQueue({
    tasks: [
      {
        id: 'a',
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
      },
    ],
  });
  const before = JSON.stringify(queue);
  const plan = buildDryRunPlan(queue);
  assert.equal(JSON.stringify(queue), before, 'buildDryRunPlan must not mutate its input');
  assert.ok(plan.some((l) => l.includes('EXECUTION_ENGINE = DISABLED_IN_V1_A')));
  assert.ok(plan.some((l) => l.includes('NEXT_GREEN_TASK = a')));
});

// ---------------------------------------------------------------------------
// CLI subprocess smoke tests. These invoke the real entrypoint (`node
// runner.mjs ...`) to prove the stdin/stdout/exit-code contract works end
// to end, using only safe, read-only inputs (--self-test and the committed
// example queue). No dangerous command is ever constructed here.
// ---------------------------------------------------------------------------

test('CLI: --self-test exits 0 and prints SELF_TEST_RESULT = PASS', () => {
  const output = execFileSync('node', [RUNNER_PATH, '--self-test'], { encoding: 'utf8' });
  assert.ok(output.includes('SELF_TEST_RESULT = PASS'));
});

test('CLI: --queue <example> --validate exits 0 and prints VALIDATION_RESULT = PASS', () => {
  const output = execFileSync(
    'node',
    [RUNNER_PATH, '--queue', EXAMPLE_QUEUE_PATH, '--validate'],
    { encoding: 'utf8' },
  );
  assert.ok(output.includes('VALIDATION_RESULT = PASS'));
  assert.ok(!output.includes('NEXT_GREEN_TASK'), '--validate must not print the dry-run plan');
});

test('CLI: --queue <example> --dry-run exits 0, validates, and prints the plan without executing anything', () => {
  const output = execFileSync(
    'node',
    [RUNNER_PATH, '--queue', EXAMPLE_QUEUE_PATH, '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.ok(output.includes('VALIDATION_RESULT = PASS'));
  assert.ok(output.includes('NEXT_GREEN_TASK = task-green-independent-001'));
  assert.ok(output.includes('EXECUTION_ENGINE = DISABLED_IN_V1_A'));
});

test('CLI: missing --queue in --validate mode exits non-zero', () => {
  assert.throws(() => {
    execFileSync('node', [RUNNER_PATH, '--validate'], { encoding: 'utf8' });
  });
});
