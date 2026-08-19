import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  runValidation,
  buildDryRunPlan,
  buildExecutionPlanSummary,
  checkRemoteMainDrift,
  isExecuteGreenUnlocked,
  checkPostExecutionScope,
  runExecuteGreen,
} from '../runner.mjs';
import { FIXTURE_BASE_SHA } from '../queue.mjs';

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

test('parseArgs reads --plan-execution', () => {
  const result = parseArgs(['--queue', 'foo.json', '--plan-execution']);
  assert.equal(result.mode, 'plan-execution');
});

test('parseArgs reads --execute-green', () => {
  const result = parseArgs(['--queue', 'foo.json', '--execute-green']);
  assert.equal(result.mode, 'execute-green');
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
        enabled: true, // NIGHT-V1-B: explicit per-task GREEN-execution gate
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
// R1 hardening regression: the retired DONE/IN_PROGRESS states and a
// max_retries above the ceiling must fail validation through runValidation,
// proving queue.mjs's stricter schema is actually wired into the runner's
// gate, not just tested in isolation.
// ---------------------------------------------------------------------------

test('runValidation rejects a task using the retired DONE status', () => {
  const queue = minimalQueue({
    tasks: [
      {
        id: 'a', title: 't', objective: 'o', risk: 'GREEN', status: 'DONE',
        dependency_type: 'INDEPENDENT', depends_on: [], allowed_paths: ['x'],
        forbidden_paths: [], required_checks: [], max_retries: 1,
        timeout_seconds: 10, on_failure: 'HOLD',
      },
    ],
  });
  const result = runValidation(queue);
  assert.equal(result.ok, false);
});

test('runValidation rejects max_retries above the R1 ceiling of 3', () => {
  const queue = minimalQueue({
    tasks: [
      {
        id: 'a', title: 't', objective: 'o', risk: 'GREEN', status: 'READY',
        dependency_type: 'INDEPENDENT', depends_on: [], allowed_paths: ['x'],
        forbidden_paths: [], required_checks: [], max_retries: 5,
        timeout_seconds: 10, on_failure: 'HOLD',
      },
    ],
  });
  const result = runValidation(queue);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// buildExecutionPlanSummary (section 34): policy summary, tool surface,
// timeouts, retry budget — no secrets.
// ---------------------------------------------------------------------------

function greenTaskFixture(overrides = {}) {
  return {
    id: 'task-a',
    title: 't',
    objective: 'o',
    risk: 'GREEN',
    status: 'READY',
    enabled: true,
    dependency_type: 'INDEPENDENT',
    depends_on: [],
    allowed_paths: ['examples/fixture-only.test.mjs'],
    read_paths: ['examples/fixture-only.test.mjs'],
    forbidden_paths: [],
    required_checks: [],
    verification_commands: [],
    max_retries: 2,
    max_turns: 10,
    timeout_seconds: 90,
    on_failure: 'HOLD',
    ...overrides,
  };
}

test('buildExecutionPlanSummary reports the selected task, policy paths, tool surface, timeouts, and retry budget', () => {
  const lines = buildExecutionPlanSummary(greenTaskFixture());
  assert.ok(lines.some((l) => l.includes('SELECTED_TASK = task-a')));
  assert.ok(lines.some((l) => l.includes('POLICY_ALLOWED_PATHS')));
  assert.ok(lines.some((l) => l.includes('POLICY_READ_PATHS')));
  assert.ok(lines.some((l) => l.includes('TOOL_SURFACE = Read,Glob,Grep,Write,Edit')));
  assert.ok(lines.some((l) => l.includes('TIMEOUT_SECONDS = 90')));
  assert.ok(lines.some((l) => l.includes('MAX_RETRIES = 2')));
  assert.ok(lines.some((l) => l.includes('MAX_TURNS = 10')));
  assert.ok(lines.some((l) => l.includes('REAL_CHILD_SPAWN = 0')));
});

test('buildExecutionPlanSummary never includes a secret-shaped fixture value even if smuggled into the task object', () => {
  const secretFixture = 'SUPER_SECRET_TOKEN_abc123XYZ';
  const task = greenTaskFixture({ objective: secretFixture });
  const lines = buildExecutionPlanSummary(task);
  assert.ok(!lines.join('\n').includes(secretFixture));
});

// ---------------------------------------------------------------------------
// checkRemoteMainDrift (section 23)
// ---------------------------------------------------------------------------

test('checkRemoteMainDrift: matching SHAs -> not drifted', () => {
  const sha = 'a'.repeat(40);
  assert.equal(checkRemoteMainDrift(sha, sha).drifted, false);
});

test('checkRemoteMainDrift: mismatched SHAs -> drifted', () => {
  assert.equal(checkRemoteMainDrift('a'.repeat(40), 'b'.repeat(40)).drifted, true);
});

test('checkRemoteMainDrift: unresolved remote (null) -> drifted (fail closed)', () => {
  assert.equal(checkRemoteMainDrift('a'.repeat(40), null).drifted, true);
});

test('checkRemoteMainDrift: the fixture base_sha sentinel is exempt from the drift check', () => {
  assert.equal(checkRemoteMainDrift(FIXTURE_BASE_SHA, 'anything-or-nothing').drifted, false);
});

// ---------------------------------------------------------------------------
// isExecuteGreenUnlocked (section 35): the double gate.
// ---------------------------------------------------------------------------

test('isExecuteGreenUnlocked: flag without env -> locked', () => {
  assert.equal(isExecuteGreenUnlocked({ flagPresent: true, envValue: undefined }), false);
});

test('isExecuteGreenUnlocked: env without flag -> locked', () => {
  assert.equal(isExecuteGreenUnlocked({ flagPresent: false, envValue: '1' }), false);
});

test('isExecuteGreenUnlocked: neither present -> locked', () => {
  assert.equal(isExecuteGreenUnlocked({ flagPresent: false, envValue: undefined }), false);
});

test('isExecuteGreenUnlocked: both present -> unlocked (only in this exact combination)', () => {
  assert.equal(isExecuteGreenUnlocked({ flagPresent: true, envValue: '1' }), true);
});

test('isExecuteGreenUnlocked: an env value other than the literal "1" stays locked', () => {
  assert.equal(isExecuteGreenUnlocked({ flagPresent: true, envValue: 'true' }), false);
  assert.equal(isExecuteGreenUnlocked({ flagPresent: true, envValue: 'yes' }), false);
});

// ---------------------------------------------------------------------------
// checkPostExecutionScope (section 26)
// ---------------------------------------------------------------------------

test('checkPostExecutionScope: all modified paths within allowed_paths -> ok', () => {
  const result = checkPostExecutionScope(['src/a.ts', 'src/sub/b.ts'], ['src/**']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unauthorized, []);
});

test('checkPostExecutionScope: a modified path outside allowed_paths -> not ok, listed', () => {
  const result = checkPostExecutionScope(['src/a.ts', '.claude/settings.json'], ['src/**']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unauthorized, ['.claude/settings.json']);
});

test('checkPostExecutionScope: lists every violation, not just the first', () => {
  const result = checkPostExecutionScope(['a.ts', 'b.ts', 'c.ts'], ['src/**']);
  assert.equal(result.unauthorized.length, 3);
});

// ---------------------------------------------------------------------------
// runExecuteGreen (sections 19-23, 35): orchestration with fully
// dependency-injected resolveRemoteMainShaFn/checkpointLookupFn/
// executeTaskFn. Proves the gate/validation/selection/drift-check sequence
// is correctly wired AND that the default executeTaskFn (used unless a
// test explicitly injects a fake) never spawns anything.
// ---------------------------------------------------------------------------

function executableQueueFixture(overrides = {}) {
  return {
    schema_version: 1,
    session: {
      session_id: 's',
      mode: 'dry-run',
      base_sha: 'a'.repeat(40),
      branch_prefix: 'agent/night/x',
      max_session_minutes: 60,
      max_total_tasks: 1,
      max_consecutive_holds: 1,
    },
    tasks: [greenTaskFixture()],
    ...overrides,
  };
}

test('runExecuteGreen: flag without env -> HOLD_DOUBLE_GATE_NOT_SATISFIED, no task selected', async () => {
  const outcome = await runExecuteGreen({ queue: executableQueueFixture(), flagPresent: true, envValue: undefined });
  assert.equal(outcome.result, 'HOLD_DOUBLE_GATE_NOT_SATISFIED');
  assert.equal(outcome.taskId, null);
});

test('runExecuteGreen: both gates satisfied but queue fails validation -> HOLD_VALIDATION_FAILED', async () => {
  const outcome = await runExecuteGreen({
    queue: { schema_version: 2, session: {}, tasks: [] },
    flagPresent: true,
    envValue: '1',
  });
  assert.equal(outcome.result, 'HOLD_VALIDATION_FAILED');
});

test('runExecuteGreen: no eligible GREEN task -> HOLD_NO_ELIGIBLE_TASK', async () => {
  const queue = executableQueueFixture({ tasks: [greenTaskFixture({ enabled: false })] });
  const outcome = await runExecuteGreen({ queue, flagPresent: true, envValue: '1' });
  assert.equal(outcome.result, 'HOLD_NO_ELIGIBLE_TASK');
});

test('runExecuteGreen: remote main drift -> HOLD_REMOTE_MAIN_DRIFT, checked BEFORE any execution step', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    resolveRemoteMainShaFn: () => 'b'.repeat(40), // deliberately mismatched vs session.base_sha = 'a'.repeat(40)
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_REMOTE_MAIN_DRIFT');
  assert.equal(executeCalled, false, 'execution must never be reached when remote main has drifted');
});

test('runExecuteGreen: a stale RUNNING checkpoint (no controlled child evidence) -> HOLD_STALE_SESSION, never resumed silently', async () => {
  let executeCalled = false;
  const staleCheckpoint = { task_id: 'task-a', state: 'RUNNING', attempt: 1, base_sha: 'a'.repeat(40), started_at: 'x', updated_at: 'x', last_progress_at: 'x', last_error_family: null };
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => staleCheckpoint,
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_STALE_SESSION');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: every gate passes -> the execution step IS reached (with an injected fake), proving the orchestration is correctly wired', async () => {
  let executeCalledWithTaskId = null;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    executeTaskFn: async (task) => {
      executeCalledWithTaskId = task.id;
      return { status: 'FAKE_EXECUTED_FOR_TEST_ONLY' };
    },
  });
  assert.equal(executeCalledWithTaskId, 'task-a');
  assert.equal(outcome.result, 'FAKE_EXECUTED_FOR_TEST_ONLY');
});

test('runExecuteGreen: with the DEFAULT executeTaskFn (no injection), every gate passing still never spawns anything real', async () => {
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    // executeTaskFn intentionally omitted — exercises the real default.
  });
  assert.equal(outcome.result, 'HOLD_NOT_IMPLEMENTED_IN_V1_B');
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

test('CLI: --queue <example> --plan-execution exits 0 and prints the concrete execution plan for the next GREEN task', () => {
  const output = execFileSync(
    'node',
    [RUNNER_PATH, '--queue', EXAMPLE_QUEUE_PATH, '--plan-execution'],
    { encoding: 'utf8' },
  );
  assert.ok(output.includes('VALIDATION_RESULT = PASS'));
  assert.ok(output.includes('SELECTED_TASK = task-green-independent-001'));
  assert.ok(output.includes('TOOL_SURFACE = Read,Glob,Grep,Write,Edit'));
  assert.ok(output.includes('REAL_CHILD_SPAWN = 0'));
});

test('CLI: --queue <example> --execute-green without KORIXA_NIGHT_EXECUTION exits non-zero with HOLD_DOUBLE_GATE_NOT_SATISFIED', () => {
  const env = { ...process.env };
  delete env.KORIXA_NIGHT_EXECUTION;
  let output = '';
  try {
    execFileSync('node', [RUNNER_PATH, '--queue', EXAMPLE_QUEUE_PATH, '--execute-green'], { encoding: 'utf8', env });
  } catch (err) {
    output = err.stdout ?? '';
  }
  assert.ok(output.includes('EXECUTE_GREEN_RESULT = HOLD_DOUBLE_GATE_NOT_SATISFIED'));
  assert.ok(output.includes('REAL_CHILD_SPAWN = 0'));
});

test('CLI: --queue <example> --execute-green WITH KORIXA_NIGHT_EXECUTION=1 still never spawns a real Claude process (real subprocess proof)', () => {
  const env = { ...process.env, KORIXA_NIGHT_EXECUTION: '1' };
  let output = '';
  try {
    execFileSync('node', [RUNNER_PATH, '--queue', EXAMPLE_QUEUE_PATH, '--execute-green'], { encoding: 'utf8', env });
  } catch (err) {
    output = err.stdout ?? '';
  }
  // The example fixture's base_sha is the documented FIXTURE_BASE_SHA
  // sentinel, exempt from the remote-main drift check, so this reaches the
  // (always-stubbed) execution step — and still spawns nothing real.
  assert.ok(output.includes('EXECUTE_GREEN_RESULT = HOLD_NOT_IMPLEMENTED_IN_V1_B'));
  assert.ok(output.includes('TASK = task-green-independent-001'));
  assert.ok(output.includes('REAL_CHILD_SPAWN = 0'));
});
