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
  parseGitStatusPorcelainZ,
  getGitStatusPaths,
  checkWorktreeClean,
  checkNightGuardInstalled,
  runVerificationCommand,
  runAllVerificationCommands,
  resolveExitCode,
  isValidTargetHeadSha,
  resolveLocalHeadSha,
  checkTargetHead,
} from '../runner.mjs';
import { FIXTURE_BASE_SHA } from '../queue.mjs';
import { isValidActivePolicy } from '../../../.claude/hooks/night-guard.mjs';
import { resolveCheckpointPath, readCheckpointForResume, createCheckpoint, writeCheckpointAtomic } from '../checkpoint.mjs';

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

test('parseArgs reads --target-head', () => {
  const result = parseArgs(['--queue', 'foo.json', '--execute-green', '--target-head', 'a'.repeat(40)]);
  assert.equal(result.targetHeadSha, 'a'.repeat(40));
});

test('parseArgs: targetHeadSha defaults to null when --target-head is omitted', () => {
  const result = parseArgs(['--queue', 'foo.json', '--execute-green']);
  assert.equal(result.targetHeadSha, null);
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
// isValidTargetHeadSha / resolveLocalHeadSha / checkTargetHead
// (NIGHT-V1-D-R1 sections 6-9)
// ---------------------------------------------------------------------------

test('isValidTargetHeadSha: a well-formed 40-char hex SHA -> true', () => {
  assert.equal(isValidTargetHeadSha('a'.repeat(40)), true);
  assert.equal(isValidTargetHeadSha('0123456789abcdef0123456789ABCDEF01234567'), true);
});

test('isValidTargetHeadSha: too short -> false', () => {
  assert.equal(isValidTargetHeadSha('a'.repeat(39)), false);
});

test('isValidTargetHeadSha: too long -> false', () => {
  assert.equal(isValidTargetHeadSha('a'.repeat(41)), false);
});

test('isValidTargetHeadSha: non-hex characters -> false', () => {
  assert.equal(isValidTargetHeadSha('g'.repeat(40)), false);
});

test('isValidTargetHeadSha: null/undefined/non-string -> false', () => {
  assert.equal(isValidTargetHeadSha(null), false);
  assert.equal(isValidTargetHeadSha(undefined), false);
  assert.equal(isValidTargetHeadSha(40), false);
});

test('resolveLocalHeadSha: invokes git with argv array (-C repoRoot rev-parse HEAD), shell:false', () => {
  let captured = null;
  resolveLocalHeadSha({
    repoRoot: '/fake/repo',
    spawnSyncFn: (command, args, options) => {
      captured = { command, args, options };
      return { status: 0, stdout: `${'a'.repeat(40)}\n` };
    },
  });
  assert.equal(captured.command, 'git');
  assert.deepEqual(captured.args, ['-C', '/fake/repo', 'rev-parse', 'HEAD']);
  assert.equal(captured.options.shell, false);
});

test('resolveLocalHeadSha: trims and lowercases the resolved SHA', () => {
  const sha = resolveLocalHeadSha({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 0, stdout: `  ${'A'.repeat(40)}  \n` }) });
  assert.equal(sha, 'a'.repeat(40));
});

test('resolveLocalHeadSha: git command failure -> null (fail closed)', () => {
  const sha = resolveLocalHeadSha({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 128, stdout: '' }) });
  assert.equal(sha, null);
});

test('resolveLocalHeadSha: malformed output -> null', () => {
  const sha = resolveLocalHeadSha({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 0, stdout: 'not-a-sha\n' }) });
  assert.equal(sha, null);
});

test('checkTargetHead: matching SHA (case-insensitive) -> matched true', () => {
  const result = checkTargetHead({
    repoRoot: '/fake/repo',
    expectedTargetHeadSha: 'A'.repeat(40),
    spawnSyncFn: () => ({ status: 0, stdout: `${'a'.repeat(40)}\n` }),
  });
  assert.deepEqual(result, { matched: true, reason: 'OK', actual: 'a'.repeat(40) });
});

test('checkTargetHead: mismatched SHA -> matched false, reason MISMATCH', () => {
  const result = checkTargetHead({
    repoRoot: '/fake/repo',
    expectedTargetHeadSha: 'b'.repeat(40),
    spawnSyncFn: () => ({ status: 0, stdout: `${'a'.repeat(40)}\n` }),
  });
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'MISMATCH');
  assert.equal(result.actual, 'a'.repeat(40));
});

test('checkTargetHead: git rev-parse failure -> matched false, reason UNRESOLVED', () => {
  const result = checkTargetHead({
    repoRoot: '/fake/repo',
    expectedTargetHeadSha: 'a'.repeat(40),
    spawnSyncFn: () => ({ status: 128, stdout: '' }),
  });
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'UNRESOLVED');
  assert.equal(result.actual, null);
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
    max_retries: 3,
    // NIGHT-V1-D section 13: a real GREEN task needs at least one
    // verification command — NODE_VERSION is a harmless default here since
    // most tests inject a fake runAllVerificationCommandsFn anyway.
    verification_commands: [{ family: 'NODE_VERSION' }],
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

// NIGHT-V1-D: the "everything upstream of the child is fine" defaults for
// the four new pre/post-spawn gates — worktree clean, Night Guard
// installed, both post-execution scope checks authorized (empty diff).
// Individual tests override exactly the one gate they mean to exercise.
function passingGateFakes() {
  return {
    checkWorktreeCleanFn: () => ({ clean: true, reason: 'OK' }),
    checkNightGuardInstalledFn: () => ({ installed: true, reason: 'OK' }),
    getGitStatusPathsFn: () => ({ ok: true, paths: [] }),
    runAllVerificationCommandsFn: () => ({ allPass: true, results: [{ pass: true, family: 'NODE_VERSION', errorFamily: null }] }),
    // Phase 1B: auditAndCertifyGreenTaskResult (reached on the real PASS
    // path) resolves headSha via resolveLocalHeadShaFn — faked here too, for
    // the same reason every other gate above is faked: this file's own
    // invariant is that REAL_CLAUDE_AGENT_RUNS contributed by it is always
    // 0, which requires zero real subprocess spawns of ANY kind against the
    // fake '/fake/repo' repoRoot, not just the ones that existed before this
    // wiring landed.
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  };
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
    ...passingGateFakes(),
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

test('executeControlledGreenTask: checkpoint reaches RETRY after a fake child failure (nonzero exit), with budget remaining', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, checkpointFilePath });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 1);
  const result = await resultPromise;
  assert.equal(result.status, 'RETRY');
  assert.equal(result.execStatus, 'NONZERO_EXIT');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'RETRY');
  assert.equal(finalCheckpoint.last_error_family, 'TASK_NONZERO_EXIT');
  assert.equal(finalCheckpoint.attempt, 1, 'attempt increments by exactly one retry cycle (was 0, budget max_retries=3)');
});

test('executeControlledGreenTask: a child failure with retry budget exhausted -> HOLD, not RETRY', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    task: policyTaskFixture({ max_retries: 1 }),
    attempt: 0, // nextAttempt = 1, which is >= maxRetries(1) -> HOLD
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 1);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
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
  assert.equal(result.status, 'RETRY');
  assert.equal(result.execStatus, 'TIMEOUT');
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
  assert.equal(result.status, 'HOLD');
  assert.equal(result.execStatus, 'ERROR');
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after a spawn error');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
  assert.equal(finalCheckpoint.last_error_family, 'SPAWN_ERROR');
  assert.equal(finalCheckpoint.attempt, 0, 'a spawn ERROR is not budget-checked — attempt is not consumed as a retry');
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
// parseGitStatusPorcelainZ / getGitStatusPaths (NIGHT-V1-D section 6/14)
// ---------------------------------------------------------------------------

test('parseGitStatusPorcelainZ: a modified tracked file', () => {
  const stdout = ' M src/a.ts\0';
  assert.deepEqual(parseGitStatusPorcelainZ(stdout), ['src/a.ts']);
});

test('parseGitStatusPorcelainZ: an untracked file ("??")', () => {
  const stdout = '?? new-file.txt\0';
  assert.deepEqual(parseGitStatusPorcelainZ(stdout), ['new-file.txt']);
});

test('parseGitStatusPorcelainZ: a deleted file (" D")', () => {
  const stdout = ' D removed.ts\0';
  assert.deepEqual(parseGitStatusPorcelainZ(stdout), ['removed.ts']);
});

test('parseGitStatusPorcelainZ: a path containing spaces is not split incorrectly', () => {
  const stdout = ' M path with spaces/file.ts\0';
  assert.deepEqual(parseGitStatusPorcelainZ(stdout), ['path with spaces/file.ts']);
});

test('parseGitStatusPorcelainZ: a rename consumes both the new and original NUL-terminated fields, reporting only the new path', () => {
  const stdout = 'R  new-name.ts\0old-name.ts\0 M other.ts\0';
  assert.deepEqual(parseGitStatusPorcelainZ(stdout), ['new-name.ts', 'other.ts']);
});

test('parseGitStatusPorcelainZ: empty stdout -> no paths (clean)', () => {
  assert.deepEqual(parseGitStatusPorcelainZ(''), []);
});

test('parseGitStatusPorcelainZ: multiple entries', () => {
  const stdout = ' M a.ts\0?? b.ts\0 D c.ts\0';
  assert.deepEqual(parseGitStatusPorcelainZ(stdout), ['a.ts', 'b.ts', 'c.ts']);
});

test('getGitStatusPaths: invokes git with argv array, shell:false, and the machine-safe porcelain flags', () => {
  let captured = null;
  getGitStatusPaths({
    repoRoot: '/fake/repo',
    spawnSyncFn: (command, args, options) => {
      captured = { command, args, options };
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(captured.command, 'git');
  assert.deepEqual(captured.args, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.cwd, '/fake/repo');
});

test('getGitStatusPaths: a failing git command -> ok:false, paths:null (fail closed)', () => {
  const result = getGitStatusPaths({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 1, stdout: '' }) });
  assert.deepEqual(result, { ok: false, paths: null });
});

// ---------------------------------------------------------------------------
// checkWorktreeClean (NIGHT-V1-D section 6/27.A)
// ---------------------------------------------------------------------------

test('checkWorktreeClean: no output -> clean', () => {
  const result = checkWorktreeClean({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 0, stdout: '' }) });
  assert.equal(result.clean, true);
});

test('checkWorktreeClean: a tracked modification -> dirty', () => {
  const result = checkWorktreeClean({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 0, stdout: ' M a.ts\0' }) });
  assert.equal(result.clean, false);
  assert.equal(result.reason, 'DIRTY');
});

test('checkWorktreeClean: an untracked file -> dirty', () => {
  const result = checkWorktreeClean({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 0, stdout: '?? new.txt\0' }) });
  assert.equal(result.clean, false);
});

test('checkWorktreeClean: a deletion -> dirty', () => {
  const result = checkWorktreeClean({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 0, stdout: ' D gone.ts\0' }) });
  assert.equal(result.clean, false);
});

test('checkWorktreeClean: git command failure -> dirty (fail closed, never treated as clean)', () => {
  const result = checkWorktreeClean({ repoRoot: '/fake/repo', spawnSyncFn: () => ({ status: 1, stdout: '' }) });
  assert.equal(result.clean, false);
  assert.equal(result.reason, 'GIT_STATUS_FAILED');
});

test('executeControlledGreenTask: A DIRTY task worktree -> HOLD_DIRTY_WORKTREE, no policy, no checkpoint, no spawn', async (t) => {
  const dir = tempDir(t);
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  let spawnCalled = false;
  const result = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, {
      tmpDirFn: () => dir,
      checkpointFilePath,
      checkWorktreeCleanFn: () => ({ clean: false, reason: 'DIRTY', paths: ['unexpected.txt'] }),
    }),
    spawnFn: () => {
      spawnCalled = true;
      return makeFakeChild();
    },
  });
  assert.equal(result.status, 'HOLD_DIRTY_WORKTREE');
  assert.equal(result.realChildSpawn, false);
  assert.equal(spawnCalled, false);
  assert.equal(existsSync(checkpointFilePath), false);
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-')), []);
});

// ---------------------------------------------------------------------------
// checkNightGuardInstalled (NIGHT-V1-D section 7/27.B)
// ---------------------------------------------------------------------------

function fakeFs({ files = {}, invalidJsonPaths = [] } = {}) {
  return {
    existsSyncFn: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSyncFn: (p) => {
      if (invalidJsonPaths.includes(p)) return 'not-json{{{';
      return files[p];
    },
  };
}

test('checkNightGuardInstalled: missing .claude/settings.json -> HOLD (SETTINGS_MISSING)', () => {
  const result = checkNightGuardInstalled({
    repoRoot: '/repo',
    ...fakeFs({ files: { [path.join('/repo', '.claude', 'hooks', 'night-guard.mjs')]: 'x' } }),
  });
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'SETTINGS_MISSING');
});

test('checkNightGuardInstalled: invalid settings JSON -> HOLD (SETTINGS_INVALID_JSON)', () => {
  const settingsPath = path.join('/repo', '.claude', 'settings.json');
  const guardPath = path.join('/repo', '.claude', 'hooks', 'night-guard.mjs');
  const result = checkNightGuardInstalled({
    repoRoot: '/repo',
    ...fakeFs({ files: { [settingsPath]: '', [guardPath]: 'x' }, invalidJsonPaths: [settingsPath] }),
  });
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'SETTINGS_INVALID_JSON');
});

test('checkNightGuardInstalled: missing night-guard.mjs -> HOLD (GUARD_FILE_MISSING)', () => {
  const settingsPath = path.join('/repo', '.claude', 'settings.json');
  const result = checkNightGuardInstalled({
    repoRoot: '/repo',
    ...fakeFs({ files: { [settingsPath]: JSON.stringify({ hooks: { PreToolUse: [] } }) } }),
  });
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'GUARD_FILE_MISSING');
});

test('checkNightGuardInstalled: settings present but PreToolUse missing/empty -> HOLD (PRETOOLUSE_MISSING)', () => {
  const settingsPath = path.join('/repo', '.claude', 'settings.json');
  const guardPath = path.join('/repo', '.claude', 'hooks', 'night-guard.mjs');
  const result = checkNightGuardInstalled({
    repoRoot: '/repo',
    ...fakeFs({ files: { [settingsPath]: JSON.stringify({ hooks: {} }), [guardPath]: 'x' } }),
  });
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'PRETOOLUSE_MISSING');
});

test('checkNightGuardInstalled: PreToolUse present but does not register night-guard.mjs -> HOLD (GUARD_NOT_REGISTERED)', () => {
  const settingsPath = path.join('/repo', '.claude', 'settings.json');
  const guardPath = path.join('/repo', '.claude', 'hooks', 'night-guard.mjs');
  const result = checkNightGuardInstalled({
    repoRoot: '/repo',
    ...fakeFs({
      files: {
        [settingsPath]: JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node', args: ['some-other-script.mjs'] }] }] } }),
        [guardPath]: 'x',
      },
    }),
  });
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'GUARD_NOT_REGISTERED');
});

test('checkNightGuardInstalled: correct registration (exec form, args pointing at night-guard.mjs) -> PASS preflight', () => {
  const settingsPath = path.join('/repo', '.claude', 'settings.json');
  const guardPath = path.join('/repo', '.claude', 'hooks', 'night-guard.mjs');
  const result = checkNightGuardInstalled({
    repoRoot: '/repo',
    ...fakeFs({
      files: {
        [settingsPath]: JSON.stringify({
          hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/night-guard.mjs'] }] }] },
        }),
        [guardPath]: 'x',
      },
    }),
  });
  assert.deepEqual(result, { installed: true, reason: 'OK' });
});

test('checkNightGuardInstalled: this repository\'s OWN real .claude/settings.json and night-guard.mjs pass the preflight (real filesystem, no fakes)', () => {
  // repoRoot here is the D worktree itself — .claude/hooks/night-guard.mjs
  // and .claude/settings.json are both out of D's authorized file scope
  // (unmodified), so this proves the preflight against the actual files a
  // real invocation would see.
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const result = checkNightGuardInstalled({ repoRoot });
  assert.deepEqual(result, { installed: true, reason: 'OK' });
});

test('executeControlledGreenTask: Night Guard NOT installed -> HOLD_NIGHT_GUARD_NOT_INSTALLED, no policy, no checkpoint, no spawn', async (t) => {
  const dir = tempDir(t);
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  let spawnCalled = false;
  const result = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, {
      tmpDirFn: () => dir,
      checkpointFilePath,
      checkNightGuardInstalledFn: () => ({ installed: false, reason: 'GUARD_NOT_REGISTERED' }),
    }),
    spawnFn: () => {
      spawnCalled = true;
      return makeFakeChild();
    },
  });
  assert.equal(result.status, 'HOLD_NIGHT_GUARD_NOT_INSTALLED');
  assert.equal(result.realChildSpawn, false);
  assert.equal(spawnCalled, false);
  assert.equal(existsSync(checkpointFilePath), false);
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-')), []);
});

// ---------------------------------------------------------------------------
// runVerificationCommand / runAllVerificationCommands (NIGHT-V1-D section
// 11-12/27.D): reuses queue.mjs's ALREADY-CLOSED VALID_VERIFICATION_FAMILIES
// exactly — no new family invented.
// ---------------------------------------------------------------------------

test('runVerificationCommand: NODE_VERSION runs argv ["node","--version"], shell:false, cwd:repoRoot', () => {
  let captured = null;
  const result = runVerificationCommand(
    { family: 'NODE_VERSION' },
    {
      repoRoot: '/fake/repo',
      task: policyTaskFixture(),
      spawnSyncFn: (command, args, options) => {
        captured = { command, args, options };
        return { status: 0, stdout: 'v20.0.0' };
      },
    },
  );
  assert.equal(result.pass, true);
  assert.equal(captured.command, 'node');
  assert.deepEqual(captured.args, ['--version']);
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.cwd, '/fake/repo');
});

test('runVerificationCommand: PWD never spawns anything — a direct filesystem check', () => {
  let spawnCalled = false;
  const result = runVerificationCommand(
    { family: 'PWD' },
    {
      repoRoot: '/fake/repo',
      task: policyTaskFixture(),
      spawnSyncFn: () => {
        spawnCalled = true;
        return { status: 0 };
      },
      existsSyncFn: () => true,
    },
  );
  assert.equal(result.pass, true);
  assert.equal(spawnCalled, false);
});

test('runVerificationCommand: NODE_TEST runs argv ["node","--test",target], target within task scope', () => {
  let captured = null;
  const task = policyTaskFixture({ allowed_paths: ['examples/a.test.mjs'], read_paths: ['examples/a.test.mjs'] });
  const result = runVerificationCommand(
    { family: 'NODE_TEST', target: 'examples/a.test.mjs' },
    {
      repoRoot: '/fake/repo',
      task,
      spawnSyncFn: (command, args, options) => {
        captured = { command, args, options };
        return { status: 0 };
      },
    },
  );
  assert.equal(result.pass, true);
  assert.deepEqual(captured.args, ['--test', 'examples/a.test.mjs']);
  assert.equal(captured.options.shell, false);
});

test('runVerificationCommand: NODE_TEST with a target OUTSIDE the task\'s own scope -> FAIL, never spawned', () => {
  let spawnCalled = false;
  const task = policyTaskFixture({ allowed_paths: ['examples/a.test.mjs'], read_paths: ['examples/a.test.mjs'] });
  const result = runVerificationCommand(
    { family: 'NODE_TEST', target: 'backend/secret.test.mjs' },
    {
      repoRoot: '/fake/repo',
      task,
      spawnSyncFn: () => {
        spawnCalled = true;
        return { status: 0 };
      },
    },
  );
  assert.equal(result.pass, false);
  assert.equal(result.errorFamily, 'VERIFICATION_TARGET_OUT_OF_SCOPE');
  assert.equal(spawnCalled, false);
});

test('runVerificationCommand: a nonzero exit code -> FAIL, family VERIFICATION_FAILED', () => {
  const result = runVerificationCommand(
    { family: 'NODE_VERSION' },
    { repoRoot: '/fake/repo', task: policyTaskFixture(), spawnSyncFn: () => ({ status: 1 }) },
  );
  assert.equal(result.pass, false);
  assert.equal(result.errorFamily, 'VERIFICATION_FAILED');
});

test('runVerificationCommand: an unknown/unrecognized family -> FAIL, never spawned (defense in depth beyond schema validation)', () => {
  let spawnCalled = false;
  const result = runVerificationCommand(
    { family: 'RM_RF_EVERYTHING' },
    {
      repoRoot: '/fake/repo',
      task: policyTaskFixture(),
      spawnSyncFn: () => {
        spawnCalled = true;
        return { status: 0 };
      },
    },
  );
  assert.equal(result.pass, false);
  assert.equal(result.errorFamily, 'UNKNOWN_VERIFICATION_FAMILY');
  assert.equal(spawnCalled, false);
});

test('runAllVerificationCommands: stops at the first failure, does not run later commands', () => {
  let secondCalled = false;
  const task = policyTaskFixture({ verification_commands: [{ family: 'NODE_VERSION' }, { family: 'PWD' }] });
  let callCount = 0;
  const result = runAllVerificationCommands(task, {
    repoRoot: '/fake/repo',
    spawnSyncFn: () => {
      callCount++;
      if (callCount === 2) secondCalled = true;
      return { status: 1 }; // first command fails
    },
    existsSyncFn: () => true,
  });
  assert.equal(result.allPass, false);
  assert.equal(callCount, 1);
  assert.equal(secondCalled, false);
});

test('runAllVerificationCommands: all pass when every command passes', () => {
  const task = policyTaskFixture({ verification_commands: [{ family: 'NODE_VERSION' }, { family: 'PWD' }] });
  const result = runAllVerificationCommands(task, {
    repoRoot: '/fake/repo',
    spawnSyncFn: () => ({ status: 0 }),
    existsSyncFn: () => true,
  });
  assert.equal(result.allPass, true);
  assert.equal(result.results.length, 2);
});

// ---------------------------------------------------------------------------
// executeControlledGreenTask: verification/scope integration (27.D/E/F/G)
// ---------------------------------------------------------------------------

test('executeControlledGreenTask: EMPTY verification_commands -> HOLD_NO_VERIFICATION_COMMANDS, no policy/checkpoint/spawn', async (t) => {
  const dir = tempDir(t);
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  let spawnCalled = false;
  const result = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, {
      tmpDirFn: () => dir,
      checkpointFilePath,
      task: policyTaskFixture({ verification_commands: [] }),
    }),
    spawnFn: () => {
      spawnCalled = true;
      return makeFakeChild();
    },
  });
  assert.equal(result.status, 'HOLD_NO_VERIFICATION_COMMANDS');
  assert.equal(result.realChildSpawn, false);
  assert.equal(spawnCalled, false);
  assert.equal(existsSync(checkpointFilePath), false);
});

test('executeControlledGreenTask: child success + verification FAIL -> NEVER PASS (RETRY, budget remaining)', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    runAllVerificationCommandsFn: () => ({ allPass: false, results: [{ pass: false, family: 'NODE_VERSION', errorFamily: 'VERIFICATION_FAILED' }] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'RETRY');
  assert.notEqual(result.status, 'PASS');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'RETRY');
  assert.equal(finalCheckpoint.last_error_family, 'VERIFICATION_FAILED');
});

test('executeControlledGreenTask: child success + verification FAIL + budget exhausted -> HOLD', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    task: policyTaskFixture({ max_retries: 1 }),
    attempt: 0,
    runAllVerificationCommandsFn: () => ({ allPass: false, results: [] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
});

test('executeControlledGreenTask: an UNAUTHORIZED changed file (post-scope check #1) -> HOLD, unconditionally, verification never runs', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  let verificationCalled = false;
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    getGitStatusPathsFn: () => ({ ok: true, paths: ['backend/unauthorized.ts'] }),
    runAllVerificationCommandsFn: () => {
      verificationCalled = true;
      return { allPass: true, results: [] };
    },
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
  assert.deepEqual(result.unauthorizedPaths, ['backend/unauthorized.ts']);
  assert.equal(verificationCalled, false, 'POST-SCOPE CHECK #1 must block BEFORE verification_commands ever runs');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
  assert.equal(finalCheckpoint.last_error_family, 'UNAUTHORIZED_SCOPE');
});

test('executeControlledGreenTask: an untracked UNAUTHORIZED file -> HOLD (the same scope-check mechanism, "??" status)', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    getGitStatusPathsFn: () => ({ ok: true, paths: ['backend/new-untracked-file.ts'] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
  assert.deepEqual(result.unauthorizedPaths, ['backend/new-untracked-file.ts']);
});

test('executeControlledGreenTask: a DELETED unauthorized path -> HOLD (checkPostExecutionScope treats any unauthorized path identically regardless of change type)', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    getGitStatusPathsFn: () => ({ ok: true, paths: ['backend/deleted-file.ts'] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
});

test('executeControlledGreenTask: an ALLOWED changed file -> post-scope PASSES, execution proceeds to PASS', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    task: policyTaskFixture({ allowed_paths: ['examples/fixture-only.test.mjs'] }),
    getGitStatusPathsFn: () => ({ ok: true, paths: ['examples/fixture-only.test.mjs'] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'PASS');
});

test('executeControlledGreenTask: the SECOND post-scope check (after verification) also independently blocks, even when the FIRST was clean', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  let scopeCallCount = 0;
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    getGitStatusPathsFn: () => {
      scopeCallCount++;
      // Clean on the FIRST call (before verification), unauthorized on the SECOND (after).
      return scopeCallCount === 1 ? { ok: true, paths: [] } : { ok: true, paths: ['backend/introduced-during-verification.ts'] };
    },
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(scopeCallCount, 2, 'both post-scope checks must run — the second one is a real, independent check, not a no-op');
  assert.equal(result.status, 'HOLD');
  assert.deepEqual(result.unauthorizedPaths, ['backend/introduced-during-verification.ts']);
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
});

test('executeControlledGreenTask: policy is removed after a VERIFICATION FAILURE', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    runAllVerificationCommandsFn: () => ({ allPass: false, results: [] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after a verification failure');
});

test('executeControlledGreenTask: policy is removed after an UNAUTHORIZED SCOPE HOLD', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    getGitStatusPathsFn: () => ({ ok: true, paths: ['backend/unauthorized.ts'] }),
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;
  const remainingPolicyFiles = readdirSync(dir).filter((f) => f.startsWith('korixa-night-policy-'));
  assert.deepEqual(remainingPolicyFiles, [], 'POLICY_FILE_EXISTS must be NO after an unauthorized-scope HOLD');
});

// ---------------------------------------------------------------------------
// Telemetry: realChildSpawn (NIGHT-V1-D section 20/27.G)
// ---------------------------------------------------------------------------

test('executeControlledGreenTask: realChildSpawn is FALSE for every gate blocked BEFORE a spawn is attempted', async (t) => {
  const dir = tempDir(t);
  const lockedResult = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, { tmpDirFn: () => dir, realSpawnEnvValue: undefined }),
  });
  assert.equal(lockedResult.realChildSpawn, false);

  const dirtyResult = await executeControlledGreenTask({
    ...executeTaskFixtureArgs(t, { tmpDirFn: () => dir, checkWorktreeCleanFn: () => ({ clean: false, reason: 'DIRTY' }) }),
  });
  assert.equal(dirtyResult.realChildSpawn, false);
});

test('executeControlledGreenTask: realChildSpawn is TRUE once a spawn is actually attempted, regardless of the eventual outcome', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 1); // failure — realChildSpawn must still be true
  const result = await resultPromise;
  assert.equal(result.realChildSpawn, true);
});

// ---------------------------------------------------------------------------
// resolveExitCode (NIGHT-V1-D section 21/27.H) — no real Claude spawn needed
// to prove the exit-code mapping.
// ---------------------------------------------------------------------------

test('resolveExitCode: PASS -> 0', () => {
  assert.equal(resolveExitCode('PASS'), 0);
});

test('resolveExitCode: RETRY -> non-zero', () => {
  assert.equal(resolveExitCode('RETRY'), 1);
});

test('resolveExitCode: HOLD -> non-zero', () => {
  assert.equal(resolveExitCode('HOLD'), 1);
});

test('resolveExitCode: every gate-locked/validation-failure family -> non-zero', () => {
  for (const result of [
    'HOLD_DOUBLE_GATE_NOT_SATISFIED',
    'HOLD_REAL_EXECUTION_LOCKED',
    'HOLD_VALIDATION_FAILED',
    'HOLD_NO_ELIGIBLE_TASK',
    'HOLD_DIRTY_WORKTREE',
    'HOLD_NIGHT_GUARD_NOT_INSTALLED',
    'HOLD_NO_VERIFICATION_COMMANDS',
    'HOLD_REMOTE_MAIN_DRIFT',
    'HOLD_STALE_SESSION',
    'HOLD_ALREADY_COMPLETED',
    'HOLD_EXISTING_HOLD',
    'HOLD_RETRY_EXHAUSTED',
    'HOLD_INVALID_CHECKPOINT',
    'HOLD_NOT_IMPLEMENTED_IN_V1_B',
  ]) {
    assert.equal(resolveExitCode(result), 1, result);
  }
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

// NIGHT-V1-D-R1: a valid, matching target-head fixture — remote-main-frozen
// (session.base_sha = 'a'.repeat(40)) and target-head are DELIBERATELY
// different SHAs here, proving both gates can PASS simultaneously with
// distinct values (section 15, test #10).
const PASSING_TARGET_HEAD_SHA = 'b'.repeat(40);
function passingTargetHeadFakes() {
  return {
    targetHeadSha: PASSING_TARGET_HEAD_SHA,
    checkTargetHeadFn: () => ({ matched: true, reason: 'OK', actual: PASSING_TARGET_HEAD_SHA }),
  };
}

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
    realSpawnEnvValue: '1',
  });
  assert.equal(outcome.result, 'HOLD_VALIDATION_FAILED');
});

test('runExecuteGreen: no eligible GREEN task -> HOLD_NO_ELIGIBLE_TASK', async () => {
  const queue = executableQueueFixture({ tasks: [greenTaskFixture({ enabled: false })] });
  const outcome = await runExecuteGreen({ queue, flagPresent: true, envValue: '1', realSpawnEnvValue: '1' });
  assert.equal(outcome.result, 'HOLD_NO_ELIGIBLE_TASK');
});

test('runExecuteGreen: remote main drift -> HOLD_REMOTE_MAIN_DRIFT, checked BEFORE any execution step', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
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
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'VALID', checkpoint: staleCheckpoint }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_STALE_SESSION');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: an ALREADY-PASS checkpoint -> HOLD_ALREADY_COMPLETED, never re-executed', async () => {
  let executeCalled = false;
  const passCheckpoint = { task_id: 'task-a', state: 'PASS', attempt: 0, base_sha: 'a'.repeat(40), started_at: 'x', updated_at: 'x', last_progress_at: 'x', last_error_family: null };
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'VALID', checkpoint: passCheckpoint }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_ALREADY_COMPLETED');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: an existing HOLD checkpoint -> HOLD_EXISTING_HOLD, never automatically resumed', async () => {
  let executeCalled = false;
  const holdCheckpoint = { task_id: 'task-a', state: 'HOLD', attempt: 2, base_sha: 'a'.repeat(40), started_at: 'x', updated_at: 'x', last_progress_at: 'x', last_error_family: 'VERIFICATION_FAILED' };
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'VALID', checkpoint: holdCheckpoint }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_EXISTING_HOLD');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: an exhausted RETRY checkpoint -> HOLD_RETRY_EXHAUSTED, never executed again', async () => {
  let executeCalled = false;
  const exhaustedCheckpoint = { task_id: 'task-a', state: 'RETRY', attempt: 2, base_sha: 'a'.repeat(40), started_at: 'x', updated_at: 'x', last_progress_at: 'x', last_error_family: 'VERIFICATION_FAILED' };
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture({ tasks: [greenTaskFixture({ max_retries: 2 })] }),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'VALID', checkpoint: exhaustedCheckpoint }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_RETRY_EXHAUSTED');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: a RETRY checkpoint with remaining budget -> executeTaskFn IS called, with the resumed attempt number', async () => {
  let receivedCtx = null;
  const retryCheckpoint = { task_id: 'task-a', state: 'RETRY', attempt: 1, base_sha: 'a'.repeat(40), started_at: 'x', updated_at: 'x', last_progress_at: 'x', last_error_family: 'TASK_NONZERO_EXIT' };
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture({ tasks: [greenTaskFixture({ max_retries: 3 })] }),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    ...passingTargetHeadFakes(),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'VALID', checkpoint: retryCheckpoint }),
    executeTaskFn: async (task, ctx) => {
      receivedCtx = ctx;
      return { status: 'FAKE_EXECUTED_FOR_TEST_ONLY' };
    },
  });
  assert.equal(outcome.result, 'FAKE_EXECUTED_FOR_TEST_ONLY');
  assert.equal(receivedCtx.attempt, 1);
  assert.equal(typeof receivedCtx.checkpointFilePath, 'string');
  assert.equal(receivedCtx.targetHeadSha, PASSING_TARGET_HEAD_SHA);
});

test('runExecuteGreen: a corrupt/invalid checkpoint -> HOLD_INVALID_CHECKPOINT, never silently ignored', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'INVALID' }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_INVALID_CHECKPOINT');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: every gate passes -> the execution step IS reached (with an injected fake), proving the orchestration is correctly wired', async () => {
  let executeCalledWithTaskId = null;
  let receivedCtx = null;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    ...passingTargetHeadFakes(),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async (task, ctx) => {
      executeCalledWithTaskId = task.id;
      receivedCtx = ctx;
      return { status: 'FAKE_EXECUTED_FOR_TEST_ONLY' };
    },
  });
  assert.equal(executeCalledWithTaskId, 'task-a');
  assert.equal(outcome.result, 'FAKE_EXECUTED_FOR_TEST_ONLY');
  assert.equal(receivedCtx.attempt, 0, 'a fresh (no prior checkpoint) execution starts at attempt 0');
  assert.equal(receivedCtx.targetHeadSha, PASSING_TARGET_HEAD_SHA);
});

test('runExecuteGreen: with the DEFAULT executeTaskFn (no injection), every gate passing still never spawns anything real', async () => {
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    ...passingTargetHeadFakes(),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    // executeTaskFn intentionally omitted — exercises the real default.
  });
  assert.equal(outcome.result, 'HOLD_NOT_IMPLEMENTED_IN_V1_B');
  assert.equal(outcome.realChildSpawn, false);
});

test('runExecuteGreen: outcome.realChildSpawn is threaded up from executeTaskFn\'s own realChildSpawn field', async () => {
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    ...passingTargetHeadFakes(),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => ({ status: 'PASS', realChildSpawn: true }),
  });
  assert.equal(outcome.realChildSpawn, true);
});

// ---------------------------------------------------------------------------
// NIGHT-V1-D-R1 sections 6-11: the TARGET HEAD gate, checked AFTER the
// remote-main gate and STRICTLY BEFORE executeTaskFn is ever called.
// ---------------------------------------------------------------------------

test('runExecuteGreen: --target-head missing -> HOLD_TARGET_HEAD_REQUIRED, executeTaskFn never called, realChildSpawn false', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha: null,
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_TARGET_HEAD_REQUIRED');
  assert.equal(outcome.realChildSpawn, false);
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: a malformed --target-head (not a 40-char SHA) -> HOLD_TARGET_HEAD_INVALID, executeTaskFn never called', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha: 'not-a-real-sha',
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_TARGET_HEAD_INVALID');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: target-head MISMATCH (expected != real local HEAD) -> HOLD_TARGET_HEAD_MISMATCH, executeTaskFn never called', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha: 'b'.repeat(40),
    checkTargetHeadFn: () => ({ matched: false, reason: 'MISMATCH', actual: 'c'.repeat(40) }),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_TARGET_HEAD_MISMATCH');
  assert.equal(outcome.realChildSpawn, false);
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: target-head UNRESOLVED (git rev-parse failed) -> HOLD_TARGET_HEAD_UNRESOLVED, executeTaskFn never called', async () => {
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha: 'b'.repeat(40),
    checkTargetHeadFn: () => ({ matched: false, reason: 'UNRESOLVED', actual: null }),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'SHOULD_NOT_HAPPEN' };
    },
  });
  assert.equal(outcome.result, 'HOLD_TARGET_HEAD_UNRESOLVED');
  assert.equal(executeCalled, false);
});

test('runExecuteGreen: an EXACT target-head match -> proceeds to executeTaskFn (the next gate), with the verified actual SHA in ctx', async () => {
  let receivedCtx = null;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    ...passingTargetHeadFakes(),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async (task, ctx) => {
      receivedCtx = ctx;
      return { status: 'FAKE_EXECUTED_FOR_TEST_ONLY' };
    },
  });
  assert.equal(outcome.result, 'FAKE_EXECUTED_FOR_TEST_ONLY');
  assert.equal(receivedCtx.targetHeadSha, PASSING_TARGET_HEAD_SHA);
});

test('runExecuteGreen: remote-main SHA and target-head SHA are legitimately DIFFERENT values, and both gates PASS simultaneously', async () => {
  const remoteMainSha = 'a'.repeat(40);
  const targetHeadSha = 'b'.repeat(40);
  assert.notEqual(remoteMainSha, targetHeadSha, 'the two SHAs used in this test must actually differ, or the test would not prove anything');
  let executeCalled = false;
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture({ session: { session_id: 's', mode: 'dry-run', base_sha: remoteMainSha, branch_prefix: 'agent/night/x', max_session_minutes: 60, max_total_tasks: 1, max_consecutive_holds: 1 } }),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha,
    checkTargetHeadFn: () => ({ matched: true, reason: 'OK', actual: targetHeadSha }),
    resolveRemoteMainShaFn: () => remoteMainSha, // matches queue.session.base_sha exactly -> remote-main gate PASS
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => {
      executeCalled = true;
      return { status: 'PASS', realChildSpawn: true };
    },
  });
  assert.equal(outcome.result, 'PASS');
  assert.equal(executeCalled, true, 'both the remote-main gate and the target-head gate passed, reaching execution');
});

test('runExecuteGreen: telemetry — a target-head mismatch reports realChildSpawn=false (never true)', async () => {
  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha: 'b'.repeat(40),
    checkTargetHeadFn: () => ({ matched: false, reason: 'MISMATCH', actual: 'c'.repeat(40) }),
    resolveRemoteMainShaFn: () => 'a'.repeat(40),
    checkpointLookupFn: () => ({ status: 'ABSENT' }),
    executeTaskFn: async () => ({ status: 'PASS', realChildSpawn: true }), // would report true, but must never be called
  });
  assert.equal(outcome.realChildSpawn, false);
  assert.equal(resolveExitCode(outcome.result), 1);
});

// ---------------------------------------------------------------------------
// NIGHT-V1-C/D: runExecuteGreen wired with the REAL executeControlledGreenTask
// (not a fake), proving section 12/24's ordering — remote-main drift blocks
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
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    resolveRemoteMainShaFn: () => 'b'.repeat(40), // mismatched vs session.base_sha = 'a'.repeat(40)
    executeTaskFn: (task, ctx) =>
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
        attempt: ctx.attempt,
        checkpointFilePath,
        tmpDirFn: () => dir,
        ...passingGateFakes(),
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

test('runExecuteGreen + real executeControlledGreenTask: a target-head MISMATCH blocks BEFORE the worktree-clean gate, policy creation, checkpoint RUNNING, or spawn (sections 6-9)', async (t) => {
  const dir = tempDir(t);
  let spawnCalled = false;
  let worktreeCleanCalled = false;
  const checkpointFilePath = path.join(dir, 'checkpoint.json');

  const outcome = await runExecuteGreen({
    queue: executableQueueFixture(),
    flagPresent: true,
    envValue: '1',
    realSpawnEnvValue: '1',
    repoRoot: '/fake/repo',
    targetHeadSha: 'b'.repeat(40),
    checkTargetHeadFn: () => ({ matched: false, reason: 'MISMATCH', actual: 'c'.repeat(40) }),
    resolveRemoteMainShaFn: () => 'a'.repeat(40), // matches session.base_sha exactly — remote-main gate PASSES; only target-head fails
    executeTaskFn: (task, ctx) =>
      executeControlledGreenTask({
        task,
        repoRoot: '/fake/repo',
        baseSha: ctx.targetHeadSha,
        flagPresent: true,
        executionEnvValue: '1',
        realSpawnEnvValue: '1', // triple lock fully satisfied — proves the target-head gate blocks earlier, not this one
        prompt: 'x',
        timeoutMs: 5000,
        inactivityTimeoutMs: 5000,
        attempt: ctx.attempt,
        checkpointFilePath,
        tmpDirFn: () => dir,
        ...passingGateFakes(),
        checkWorktreeCleanFn: () => {
          worktreeCleanCalled = true;
          return { clean: true, reason: 'OK' };
        },
        spawnFn: () => {
          spawnCalled = true;
          return makeFakeChild();
        },
      }),
  });

  assert.equal(outcome.result, 'HOLD_TARGET_HEAD_MISMATCH');
  assert.equal(worktreeCleanCalled, false, 'BEFORE clean-worktree gate: executeControlledGreenTask (the child path) must never even be invoked');
  assert.equal(spawnCalled, false, 'BEFORE spawn');
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
  // NIGHT-V1-D: runExecuteGreen's OWN triple-lock check (section 24 — the
  // triple lock gates EVERYTHING, even before queue/task validation) now
  // blocks this 2/3-gates case before task selection ever happens, so no
  // task id is reported. Still spawns nothing real: 2/3 gates is never
  // enough.
  assert.ok(output.includes('EXECUTE_GREEN_RESULT = HOLD_REAL_EXECUTION_LOCKED'));
  assert.ok(output.includes('TASK = none'));
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

// ---------------------------------------------------------------------------
// Slack notification wiring (best-effort, non-authoritative — see notify.mjs
// for the exhaustive absorption/allowlist unit coverage). These tests prove
// ONLY the wiring: the right label fires at the right moment with the right
// (allowlisted) fields, and a notification failure/throw NEVER changes a
// checkpoint state, outcome.result, or exit code. No test here ever lets
// KORIXA_NIGHT_SLACK_NOTIFY reach '1' against the real `notifySlackBestEffort`
// default in a real subprocess — every notify-enabled scenario below injects
// notifySlackFn directly (in-process), so no real `gh` call is ever possible.
// ---------------------------------------------------------------------------

function recordingNotifySlackFn(calls) {
  return (params) => {
    calls.push(params);
    return { attempted: false, ok: false, reason: 'TEST_STUB' };
  };
}

test('NOTIFY_WIRING: START fires exactly once, after the RUNNING checkpoint is on disk, before the child is spawned', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const calls = [];
  let spawnCalledAfterStartNotify = false;
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    notifySlackFn: (params) => {
      // At the moment START fires, the checkpoint must already be RUNNING on disk.
      const onDisk = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
      assert.equal(onDisk.state, 'RUNNING');
      calls.push(params);
    },
  });
  const resultPromise = executeControlledGreenTask({
    ...args,
    spawnFn: () => {
      spawnCalledAfterStartNotify = calls.length > 0;
      return child;
    },
  });
  child.emit('close', 0);
  await resultPromise;

  const startCalls = calls.filter((c) => c.label === 'START');
  assert.equal(startCalls.length, 1);
  assert.equal(spawnCalledAfterStartNotify, true, 'START must fire before the child is spawned');
});

test('NOTIFY_WIRING: START call carries only allowlisted fields (taskId, state, attempt, timestamp) -- never prompt/env/policy path', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const calls = [];
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, notifySlackFn: recordingNotifySlackFn(calls) });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;

  const startCall = calls.find((c) => c.label === 'START');
  assert.equal(startCall.fields.taskId, 'task-a');
  assert.equal(startCall.fields.state, 'RUNNING');
  assert.equal(typeof startCall.fields.attempt, 'number');
  assert.equal(typeof startCall.fields.timestamp, 'string');
  const fieldKeys = Object.keys(startCall.fields);
  for (const forbidden of ['prompt', 'env', 'policyPath', 'repoRoot', 'stdout', 'stderr']) {
    assert.ok(!fieldKeys.includes(forbidden), `forbidden field "${forbidden}" was passed to notifySlackFn`);
  }
});

test('NOTIFY_WIRING: CHECKPOINT (VERIFYING) fires exactly once, after the VERIFYING checkpoint is on disk, on the PASS path', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const calls = [];
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    notifySlackFn: (params) => {
      if (params.label === 'CHECKPOINT') {
        const onDisk = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
        assert.equal(onDisk.state, 'VERIFYING');
      }
      calls.push(params);
    },
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'PASS');

  const checkpointCalls = calls.filter((c) => c.label === 'CHECKPOINT');
  assert.equal(checkpointCalls.length, 1);
  assert.equal(checkpointCalls[0].fields.taskId, 'task-a');
  assert.equal(checkpointCalls[0].fields.state, 'VERIFYING');
});

test('NOTIFY_WIRING: exactly START + CHECKPOINT fire during a full PASS run -- no extra/duplicate in-function notifications', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const calls = [];
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, notifySlackFn: recordingNotifySlackFn(calls) });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;
  assert.deepEqual(calls.map((c) => c.label), ['START', 'CHECKPOINT']);
});

test('NOTIFY_FAILURE_NON_BLOCKING: a notifySlackFn that THROWS on every call does not change the checkpoint state or the PASS outcome', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    notifySlackFn: () => { throw new Error('simulated Slack/gh failure'); },
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'PASS', 'a throwing notifier must never prevent PASS');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'PASS');
});

test('NOTIFY_FAILURE_NON_BLOCKING: a notifySlackFn that THROWS on every call does not change the checkpoint state or the HOLD outcome (retry budget exhausted)', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  const args = executeTaskFixtureArgs(t, {
    tmpDirFn: () => dir,
    checkpointFilePath,
    task: policyTaskFixture({ max_retries: 1 }),
    attempt: 0,
    notifySlackFn: () => { throw new Error('simulated Slack/gh failure'); },
  });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 1);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD', 'a throwing notifier must never prevent the correct fail-closed HOLD');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
});

test('NOTIFY_FAILURE_NON_BLOCKING: the real (default) notifySlackBestEffort -- disabled by default, envValue unset -- never affects a real PASS run', async (t) => {
  const dir = tempDir(t);
  const child = makeFakeChild();
  const checkpointFilePath = path.join(dir, 'checkpoint.json');
  // No notifySlackFn override at all: exercises the REAL default
  // (notifySlackBestEffort imported from notify.mjs). Since
  // KORIXA_NIGHT_SLACK_NOTIFY is not set in this test process's env, this
  // must perform zero subprocess calls and the PASS outcome must be exactly
  // as if notification didn't exist.
  const args = executeTaskFixtureArgs(t, { tmpDirFn: () => dir, checkpointFilePath });
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'PASS');
  const finalCheckpoint = JSON.parse(readFileSync(checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'PASS');
});
