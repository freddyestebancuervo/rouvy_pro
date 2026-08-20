import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseArgs,
  runValidation,
  buildDryRunPlan,
  buildExecutionPlanSummary,
  checkRemoteMainDrift,
  isExecuteGreenUnlocked,
  isTripleExecutionLockSatisfied,
  checkPostExecutionScope,
  runExecuteGreen,
  buildActivePolicy,
  createTemporaryActivePolicy,
  removeTemporaryActivePolicy,
  buildControlledChildEnv,
  executeControlledGreenTask,
} from '../runner.mjs';
import { FIXTURE_BASE_SHA } from '../queue.mjs';
import { isValidActivePolicy } from '../../../.claude/hooks/night-guard.mjs';

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'korixa-night-runner-c-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

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
// isTripleExecutionLockSatisfied (NIGHT-V1-C section 10): 0/3, 1/3, 2/3 of
// the three gates must all stay locked; only the exact 3/3 combination
// unlocks.
// ---------------------------------------------------------------------------

test('isTripleExecutionLockSatisfied: 0/3 gates -> locked', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: false, executionEnvValue: undefined, realSpawnEnvValue: undefined }),
    false,
  );
});

test('isTripleExecutionLockSatisfied: 1/3 gates (flag only) -> locked', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: true, executionEnvValue: undefined, realSpawnEnvValue: undefined }),
    false,
  );
});

test('isTripleExecutionLockSatisfied: 1/3 gates (KORIXA_NIGHT_REAL_SPAWN only) -> locked', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: false, executionEnvValue: undefined, realSpawnEnvValue: '1' }),
    false,
  );
});

test('isTripleExecutionLockSatisfied: 2/3 gates (double gate satisfied, KORIXA_NIGHT_REAL_SPAWN missing) -> locked', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: true, executionEnvValue: '1', realSpawnEnvValue: undefined }),
    false,
  );
});

test('isTripleExecutionLockSatisfied: 2/3 gates (flag + REAL_SPAWN, KORIXA_NIGHT_EXECUTION missing) -> locked', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: true, executionEnvValue: undefined, realSpawnEnvValue: '1' }),
    false,
  );
});

test('isTripleExecutionLockSatisfied: 3/3 gates -> unlocked (only in this exact combination)', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: true, executionEnvValue: '1', realSpawnEnvValue: '1' }),
    true,
  );
});

test('isTripleExecutionLockSatisfied: a REAL_SPAWN value other than the literal "1" stays locked', () => {
  assert.equal(
    isTripleExecutionLockSatisfied({ flagPresent: true, executionEnvValue: '1', realSpawnEnvValue: 'true' }),
    false,
  );
});

// ---------------------------------------------------------------------------
// buildActivePolicy / createTemporaryActivePolicy / removeTemporaryActivePolicy
// (NIGHT-V1-C section 8): the temporary ACTIVE POLICY lifecycle.
// ---------------------------------------------------------------------------

function policyTaskFixture(overrides = {}) {
  return {
    id: 'task-a',
    read_paths: ['examples/fixture-only.test.mjs'],
    allowed_paths: ['examples/fixture-only.test.mjs'],
    max_turns: 10,
    ...overrides,
  };
}

test('buildActivePolicy produces exactly the 8 fields isValidActivePolicy requires, nothing else', () => {
  const policy = buildActivePolicy({
    task: policyTaskFixture(),
    repoRoot: '/fake/repo',
    baseSha: 'a'.repeat(40),
    nowFn: () => '2026-01-01T00:00:00.000Z',
    nonceFn: () => 'fixed-nonce-for-test',
  });
  assert.deepEqual(Object.keys(policy).sort(), [
    'allowed_paths', 'base_sha', 'created_at', 'nonce', 'read_paths', 'repo_root', 'task_id', 'version',
  ]);
  assert.equal(isValidActivePolicy(policy), true);
});

test('buildActivePolicy never includes a prompt, secret, or token field', () => {
  const policy = buildActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40) });
  assert.equal('prompt' in policy, false);
  assert.equal('secret' in policy, false);
  assert.equal('token' in policy, false);
});

test('buildActivePolicy uses an unpredictable nonce by default (crypto.randomBytes, not a fixed/guessable value)', () => {
  const policy1 = buildActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40) });
  const policy2 = buildActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40) });
  assert.notEqual(policy1.nonce, policy2.nonce);
  assert.equal(policy1.nonce.length >= 16, true);
});

test('createTemporaryActivePolicy writes the policy file OUTSIDE the repo, under tmpDirFn(), with an unpredictable filename', (t) => {
  const outsideDir = tempDir(t); // a synthetic "outside the repo" directory, never the repo itself
  const { policyPath, policy } = createTemporaryActivePolicy({
    task: policyTaskFixture(),
    repoRoot: '/fake/repo',
    baseSha: 'a'.repeat(40),
    tmpDirFn: () => outsideDir,
  });
  t.after(() => removeTemporaryActivePolicy(policyPath));
  assert.equal(existsSync(policyPath), true);
  assert.equal(path.dirname(policyPath), outsideDir);
  assert.notEqual(path.basename(policyPath), 'policy.json', 'filename must not be a fixed/predictable name');
  const onDisk = JSON.parse(readFileSync(policyPath, 'utf8'));
  assert.deepEqual(onDisk, policy);
  assert.equal(isValidActivePolicy(onDisk), true);
});

test('createTemporaryActivePolicy leaves no leftover temp file behind (atomic write-then-rename)', (t) => {
  const outsideDir = tempDir(t);
  const { policyPath } = createTemporaryActivePolicy({
    task: policyTaskFixture(),
    repoRoot: '/fake/repo',
    baseSha: 'a'.repeat(40),
    tmpDirFn: () => outsideDir,
  });
  t.after(() => removeTemporaryActivePolicy(policyPath));
  assert.deepEqual(readdirSync(outsideDir), [path.basename(policyPath)]);
});

test('createTemporaryActivePolicy: two calls never collide on the same filename', (t) => {
  const outsideDir = tempDir(t);
  const a = createTemporaryActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40), tmpDirFn: () => outsideDir });
  const b = createTemporaryActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40), tmpDirFn: () => outsideDir });
  t.after(() => {
    removeTemporaryActivePolicy(a.policyPath);
    removeTemporaryActivePolicy(b.policyPath);
  });
  assert.notEqual(a.policyPath, b.policyPath);
});

test('removeTemporaryActivePolicy deletes the file; POLICY_FILE_EXISTS = NO afterward', (t) => {
  const outsideDir = tempDir(t);
  const { policyPath } = createTemporaryActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40), tmpDirFn: () => outsideDir });
  assert.equal(existsSync(policyPath), true);
  removeTemporaryActivePolicy(policyPath);
  assert.equal(existsSync(policyPath), false);
});

test('removeTemporaryActivePolicy on an already-removed file does not throw (best-effort cleanup)', (t) => {
  const outsideDir = tempDir(t);
  const { policyPath } = createTemporaryActivePolicy({ task: policyTaskFixture(), repoRoot: '/fake/repo', baseSha: 'a'.repeat(40), tmpDirFn: () => outsideDir });
  removeTemporaryActivePolicy(policyPath);
  assert.doesNotThrow(() => removeTemporaryActivePolicy(policyPath));
});

// ---------------------------------------------------------------------------
// buildControlledChildEnv (NIGHT-V1-C section 8)
// ---------------------------------------------------------------------------

test('buildControlledChildEnv sets KORIXA_NIGHT_MODE=1 and KORIXA_NIGHT_POLICY_FILE to the absolute policy path', () => {
  const env = buildControlledChildEnv({ baseEnv: { PATH: '/usr/bin' }, policyFilePath: '/tmp/policy-abc.json' });
  assert.equal(env.KORIXA_NIGHT_MODE, '1');
  assert.equal(env.KORIXA_NIGHT_POLICY_FILE, '/tmp/policy-abc.json');
  assert.equal(env.PATH, '/usr/bin', 'the base environment must still be present');
});

// ---------------------------------------------------------------------------
// executeControlledGreenTask (NIGHT-V1-C sections 9-14): the real
// TASK -> POLICY -> CHECKPOINT RUNNING -> EXECUTOR -> RESULT -> CHECKPOINT
// FINAL -> POLICY CLEANUP pipeline. Every test here injects a fake spawnFn
// (via makeFakeChild) — REAL_CLAUDE_AGENT_RUNS contributed by this file is
// always 0, even in the "3/3 unlocked" tests, which prove the wiring is
// reachable without ever spawning anything real.
// ---------------------------------------------------------------------------

function fullyUnlockedGates() {
  return { flagPresent: true, executionEnvValue: '1', realSpawnEnvValue: '1' };
}

function executeTaskFixtureArgs(t, overrides = {}) {
  const dir = tempDir(t);
  return {
    task: policyTaskFixture(),
    repoRoot: '/fake/repo',
    baseSha: 'a'.repeat(40),
    prompt: 'do the fixture task',
    timeoutMs: 5000,
    inactivityTimeoutMs: 5000,
    checkpointFilePath: path.join(dir, 'checkpoint.json'),
    tmpDirFn: () => dir,
    ...fullyUnlockedGates(),
    ...overrides,
  };
}

test('executeControlledGreenTask: 0/3 triple-lock gates -> HOLD_REAL_EXECUTION_LOCKED, zero side effects', async (t) => {
  const dir = tempDir(t);
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  let spawnCalled = false;
  const result = await executeControlledGreenTask({
    task: policyTaskFixture(),
    repoRoot: '/fake/repo',
    baseSha: 'a'.repeat(40),
    flagPresent: false,
    executionEnvValue: undefined,
    realSpawnEnvValue: undefined,
    prompt: 'x',
    timeoutMs: 5000,
    inactivityTimeoutMs: 5000,
    checkpointFilePath,
    tmpDirFn: () => dir,
    spawnFn: () => {
      spawnCalled = true;
      return makeFakeChild();
    },
  });
  assert.equal(result.status, 'HOLD_REAL_EXECUTION_LOCKED');
  assert.equal(spawnCalled, false);
  assert.equal(existsSync(checkpointFilePath), false, 'no checkpoint should ever be written when the triple lock is not satisfied');
  assert.deepEqual(readdirSync(dir), [], 'no policy file should ever be created when the triple lock is not satisfied');
});

test('executeControlledGreenTask: 1/3 triple-lock gates -> HOLD_REAL_EXECUTION_LOCKED', async (t) => {
  const dir = tempDir(t);
  const result = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, { flagPresent: true, executionEnvValue: undefined, realSpawnEnvValue: undefined, tmpDirFn: () => dir }),
  });
  assert.equal(result.status, 'HOLD_REAL_EXECUTION_LOCKED');
  assert.deepEqual(readdirSync(dir), []);
});

test('executeControlledGreenTask: 2/3 triple-lock gates (KORIXA_NIGHT_REAL_SPAWN missing) -> HOLD_REAL_EXECUTION_LOCKED', async (t) => {
  const dir = tempDir(t);
  const result = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, { flagPresent: true, executionEnvValue: '1', realSpawnEnvValue: undefined, tmpDirFn: () => dir }),
  });
  assert.equal(result.status, 'HOLD_REAL_EXECUTION_LOCKED');
  assert.deepEqual(readdirSync(dir), []);
});

test('executeControlledGreenTask: 3/3 triple-lock gates with a FAKE executor -> the execution path IS reached', async (t) => {
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t);
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'PASS');
  assert.equal(result.checkpointState, 'PASS');
});

test('executeControlledGreenTask: real spawn count is 0 even when the execution path is reached (spawnFn is always the injected fake)', async (t) => {
  const child = makeFakeChild();
  let spawnCallCount = 0;
  const args = executeTaskFixtureArgs(t);
  const resultPromise = executeControlledGreenTask({
    ...args,
    spawnFn: (...spawnArgs) => {
      spawnCallCount++;
      return child;
    },
  });
  child.emit('close', 0);
  await resultPromise;
  assert.equal(spawnCallCount, 1, 'the fake spawnFn was invoked exactly once — never node:child_process\'s real spawn');
});

test('executeControlledGreenTask: policy is created OUTSIDE the repo (under tmpDirFn), with the exact required fields', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  // The policy file must exist WHILE the fake child is "running" (before it closes).
  await new Promise((resolve) => setImmediate(resolve));
  const entriesDuring = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.equal(entriesDuring.length, 1, 'exactly one policy file must exist during execution');
  const policyOnDisk = JSON.parse(readFileSync(path.join(dir, entriesDuring[0]), 'utf8'));
  assert.equal(isValidActivePolicy(policyOnDisk), true);
  assert.equal(policyOnDisk.task_id, 'task-a');
  assert.equal(policyOnDisk.repo_root, '/fake/repo');
  assert.equal(policyOnDisk.base_sha, 'a'.repeat(40));
  assert.deepEqual(policyOnDisk.allowed_paths, ['examples/fixture-only.test.mjs']);
  assert.deepEqual(policyOnDisk.read_paths, ['examples/fixture-only.test.mjs']);

  child.emit('close', 0);
  await resultPromise;
});

test('executeControlledGreenTask: the fake child env contains KORIXA_NIGHT_MODE=1 and KORIXA_NIGHT_POLICY_FILE=<the temp absolute policy path>', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  let capturedEnv = null;
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir });
  const resultPromise = executeControlledGreenTask({
    ...args,
    spawnFn: (command, spawnArgs, options) => {
      capturedEnv = options.env;
      return child;
    },
  });
  child.emit('close', 0);
  await resultPromise;
  assert.equal(capturedEnv.KORIXA_NIGHT_MODE, '1');
  assert.equal(typeof capturedEnv.KORIXA_NIGHT_POLICY_FILE, 'string');
  assert.equal(path.isAbsolute(capturedEnv.KORIXA_NIGHT_POLICY_FILE), true);
  assert.equal(path.dirname(capturedEnv.KORIXA_NIGHT_POLICY_FILE), dir);
});

test('executeControlledGreenTask: checkpoint is RUNNING before the fake execution resolves', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, checkpointFilePath });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });

  await new Promise((resolve) => setImmediate(resolve));
  const duringCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(duringCheckpoint.state, 'RUNNING');
  assert.equal(duringCheckpoint.task_id, 'task-a');

  child.emit('close', 0);
  await resultPromise;
});

test('executeControlledGreenTask: checkpoint reaches a terminal state (PASS) after successful fake execution', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, checkpointFilePath });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'PASS');
  assert.equal(finalCheckpoint.last_error_family, null);
});

test('executeControlledGreenTask: checkpoint reaches RETRY after a fake child failure (nonzero exit)', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, checkpointFilePath });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 1);
  const result = await resultPromise;
  assert.equal(result.status, 'NONZERO_EXIT');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'RETRY');
  assert.equal(finalCheckpoint.last_error_family, 'TASK_NONZERO_EXIT');
});

// ---------------------------------------------------------------------------
// Policy cleanup — section 14's four required scenarios. Every one must
// leave POLICY_FILE_EXISTS = NO afterward.
// ---------------------------------------------------------------------------

test('executeControlledGreenTask: policy is removed after SUCCESSFUL fake execution', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after a successful execution');
});

test('executeControlledGreenTask: policy is removed after a fake CHILD FAILURE (nonzero exit)', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 1);
  await resultPromise;
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after a child failure');
});

test('executeControlledGreenTask: policy is removed after a fake TIMEOUT', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, timeoutMs: 30, inactivityTimeoutMs: 5000 });
  const result = await executeControlledGreenTask({ ...args, spawnFn: () => child });
  assert.equal(result.status, 'TIMEOUT');
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after a timeout');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'RETRY');
  assert.equal(finalCheckpoint.last_error_family, 'EXECUTION_TIMEOUT');
});

test('executeControlledGreenTask: policy is removed after a fake SPAWN ERROR', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('error', new Error('ENOENT: fake spawn error for test'));
  const result = await resultPromise;
  assert.equal(result.status, 'ERROR');
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after a spawn error');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
  assert.equal(finalCheckpoint.last_error_family, 'SPAWN_ERROR');
});

test('executeControlledGreenTask: an invalid task (missing required fields) -> HOLD_INVALID_TASK, no policy/checkpoint created', async (t) => {
  const dir = tempDir(t);
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const result = await executeControlledGreenTask({
    task: { id: 'bad-task' }, // missing allowed_paths/read_paths/max_turns
    repoRoot: '/fake/repo',
    baseSha: 'a'.repeat(40),
    prompt: 'x',
    timeoutMs: 5000,
    inactivityTimeoutMs: 5000,
    checkpointFilePath,
    tmpDirFn: () => dir,
    ...fullyUnlockedGates(),
  });
  assert.equal(result.status, 'HOLD_INVALID_TASK');
  assert.equal(existsSync(checkpointFilePath), false);
  assert.deepEqual(readdirSync(dir), []);
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
// NIGHT-V1-C: runExecuteGreen wired with the REAL executeControlledGreenTask
// (not a fake), proving section 12's ordering — remote-main drift blocks
// BEFORE policy creation, BEFORE checkpoint RUNNING, and BEFORE any spawn —
// end to end through the real orchestration, not just at the unit level.
// ---------------------------------------------------------------------------

test('runExecuteGreen + real executeControlledGreenTask: remote main drift blocks BEFORE policy creation, checkpoint RUNNING, or spawn', async (t) => {
  const dir = tempDir(t);
  let spawnCalled = false;
  const checkpointFilePath = path.join(dir, 'checkpoint.json');

  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    resolveRemoteMainShaFn: () => 'b'.repeat(40), // mismatched vs session.base_sha = 'a'.repeat(40)
    executeTaskFn: (task) =>
      executeControlledGreenTask({
        task,
        repoRoot: '/fake/repo',
        baseSha: 'a'.repeat(40),
        flagPresent: true,
        executionEnvValue: '1',
        realSpawnEnvValue: '1', // triple lock fully satisfied — proves drift blocks earlier, not this gate
        prompt: 'x',
        timeoutMs: 5000,
        inactivityTimeoutMs: 5000,
        checkpointFilePath,
        tmpDirFn: () => dir,
        spawnFn: () => {
          spawnCalled = true;
          return makeFakeChild();
        },
      }),
  });

  assert.equal(outcome.result, 'HOLD_REMOTE_MAIN_DRIFT');
  assert.equal(spawnCalled, false, 'BEFORE spawn: drift must block before executeControlledGreenTask is ever called');
  assert.equal(existsSync(checkpointFilePath), false, 'BEFORE checkpoint RUNNING: no checkpoint may exist');
  assert.deepEqual(readdirSync(dir), [], 'BEFORE policy: no policy file may exist');
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

test('CLI: --queue <example> --execute-green WITH KORIXA_NIGHT_EXECUTION=1 (but WITHOUT KORIXA_NIGHT_REAL_SPAWN) still never spawns a real Claude process (real subprocess proof)', () => {
  const env = { ...process.env, KORIXA_NIGHT_EXECUTION: '1' };
  delete env.KORIXA_NIGHT_REAL_SPAWN;
  let output = '';
  try {
    execFileSync('node', [RUNNER_PATH, '--queue', EXAMPLE_QUEUE_PATH, '--execute-green'], { encoding: 'utf8', env });
  } catch (err) {
    output = err.stdout ?? '';
  }
  // The example fixture's base_sha is the documented FIXTURE_BASE_SHA
  // sentinel, exempt from the remote-main drift check, so this reaches the
  // real executeControlledGreenTask — whose OWN triple-lock check (section
  // 10) then blocks because KORIXA_NIGHT_REAL_SPAWN is not set. Still
  // spawns nothing real: 2/3 gates is never enough.
  assert.ok(output.includes('EXECUTE_GREEN_RESULT = HOLD_REAL_EXECUTION_LOCKED'));
  assert.ok(output.includes('TASK = task-green-independent-001'));
  assert.ok(output.includes('REAL_CHILD_SPAWN = 0'));
});

// NIGHT-V1-C section 15/23 explicitly PROHIBITS ever satisfying all three
// triple-lock gates through the real CLI path during this block — doing so
// would reach node:child_process's REAL spawn (main() injects no fake
// spawnFn), which is exactly the accidental-execution scenario section 10
// exists to prevent. No test in this file sets KORIXA_NIGHT_REAL_SPAWN=1
// alongside --execute-green and KORIXA_NIGHT_EXECUTION=1 against the real
// CLI entrypoint; the 3/3-unlocked path is proven reachable ONLY at the
// in-process level (see the executeControlledGreenTask tests above), always
// paired with an injected fake spawnFn.
