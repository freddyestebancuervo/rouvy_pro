// Korixa Night Agent — Phase 1B integration tests: SECURE REAL-PATH WIRING
// (2026-08-22).
//
// Every test in this file proves a property about the REAL, wired
// executeControlledGreenTask / auditAndCertifyGreenTaskResult path in
// runner.mjs — not about claim-taxonomy.mjs / red-team-gate.mjs /
// executor-auditor-gate.mjs / command-safety.mjs in isolation (those already
// have their own exhaustive unit suites). Every external operation is
// dependency-injected with a fake — no real child process, no real network
// call, no real git subprocess against a real repository is ever made by
// this file. `KORIXA_NIGHT_REAL_SPAWN` is never set, referenced, or read
// anywhere in this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executeControlledGreenTask,
  runVerificationCommand,
  runAllVerificationCommands,
  auditAndCertifyGreenTaskResult,
} from '../runner.mjs';
import { resolveCheckpointRecoveryDecision } from '../checkpoint.mjs';
import { RED_TEAM_CHECKS, runRedTeamPhase, isAttestedRedTeamPhaseResult } from '../red-team-gate.mjs';
import { certifyIndependentAuditResult } from '../executor-auditor-gate.mjs';
import { evaluateCommandSafety } from '../command-safety.mjs';

const RUNNER_SRC_PATH = fileURLToPath(new URL('../runner.mjs', import.meta.url));

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'korixa-night-wiring-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function policyTaskFixture(overrides = {}) {
  return {
    id: 'task-a',
    read_paths: ['examples/fixture-only.test.mjs'],
    allowed_paths: ['examples/fixture-only.test.mjs'],
    max_turns: 10,
    max_retries: 3,
    verification_commands: [{ family: 'NODE_VERSION' }],
    ...overrides,
  };
}

function fullyUnlockedGates() {
  return { flagPresent: true, executionEnvValue: '1', realSpawnEnvValue: '1' };
}

// A count of how many times spawnSyncFn was really invoked — every full
// lifecycle test below asserts this stays 0, proving zero real external
// actions (Section 12).
function countingSpawnSyncFn() {
  const fn = () => { fn.calls += 1; throw new Error('spawnSyncFn must never be called in this simulation'); };
  fn.calls = 0;
  return fn;
}

function passingGateFakes() {
  return {
    checkWorktreeCleanFn: () => ({ clean: true, reason: 'OK' }),
    checkNightGuardInstalledFn: () => ({ installed: true, reason: 'OK' }),
    getGitStatusPathsFn: () => ({ ok: true, paths: [] }),
    runAllVerificationCommandsFn: () => ({ allPass: true, results: [{ pass: true, family: 'NODE_VERSION', errorFamily: null }] }),
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
    spawnSyncFn: countingSpawnSyncFn(),
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

function cleanVerification() {
  return { allPass: true, results: [{ pass: true, family: 'NODE_VERSION', errorFamily: null }] };
}

// =============================================================================
// SECTION A — auditAndCertifyGreenTaskResult: genuine independence, real
// attestation, real evidence citations.
// =============================================================================

test('WIRING-1: the real audit gate uses structurally distinct executor/auditor identities for any task id or attempt number', () => {
  for (const taskId of ['task-a', 'night-agent-deterministic-verification-pipeline', '', 'attempt-0']) {
    for (const attempt of [0, 1, 2]) {
      const audit = auditAndCertifyGreenTaskResult({
        task: policyTaskFixture({ id: taskId || 'task-a' }),
        attempt,
        baseSha: 'a'.repeat(40),
        repoRoot: '/fake/repo',
        spawnSyncFn: countingSpawnSyncFn(),
        verification: cleanVerification(),
        scopePaths: [],
        runRedTeamPhaseFn: runRedTeamPhase,
        finalizeExecutorResultFn: (input) => input,
        certifyIndependentAuditResultFn: certifyIndependentAuditResult,
        resolveLocalHeadShaFn: () => 'b'.repeat(40),
      });
      assert.equal(audit.auditResult.independent, true, `task id ${JSON.stringify(taskId)} attempt ${attempt} must still be independent`);
    }
  }
});

test('WIRING-2: a genuinely independent auditor is reached in the real path -> PASS, with a real, attested redTeamPhaseResult and no fabricated shape', () => {
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: cleanVerification(),
    scopePaths: ['examples/fixture-only.test.mjs'],
    runRedTeamPhaseFn: runRedTeamPhase,
    finalizeExecutorResultFn: (input) => ({ role: 'executor', ...input }),
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.equal(audit.finalState, 'PASS');
  assert.equal(audit.auditResult.independent, true);
  assert.equal(isAttestedRedTeamPhaseResult(audit.redTeamResult), true);
  assert.equal(audit.redTeamResult.completed, true);
  assert.equal(audit.redTeamResult.blocking, false);
  // None of the real path's evidence citations claim a production-impact
  // topic — an honest reflection of this path never touching production.
  for (const claim of audit.auditResult.evidence.results) {
    assert.equal(claim.touchesProductionImpact, false);
  }
});

test('WIRING-3: PASS-before-red-team is structurally impossible in the real wiring -- the red-team result is computed and threaded in as an argument, never requested after the fact', () => {
  const callOrder = [];
  const spyRedTeam = (input) => { callOrder.push('red-team'); return runRedTeamPhase(input); };
  const spyCertify = (input) => {
    callOrder.push('certify');
    assert.equal(input.redTeamPhaseResult.completed, true, 'certify must already have a completed red-team result by the time it is called');
    return certifyIndependentAuditResult(input);
  };
  auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: cleanVerification(),
    scopePaths: [],
    runRedTeamPhaseFn: spyRedTeam,
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: spyCertify,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.deepEqual(callOrder, ['red-team', 'certify']);
});

test('WIRING-4: a hand-fabricated (non-attested) redTeamPhaseResult injected via a malicious runRedTeamPhaseFn -> the real certifyIndependentAuditResult rejects it, HOLD', () => {
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: cleanVerification(),
    scopePaths: [],
    runRedTeamPhaseFn: () => ({ completed: true, blocking: false }), // never really ran runRedTeamPhase
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.equal(audit.finalState, 'HOLD');
  assert.equal(audit.auditResult.reason, 'HOLD_RED_TEAM_RESULT_NOT_ATTESTED');
});

test('WIRING-5: a blocking red-team finding (a real, attested runRedTeamPhase result) forces HOLD in the real wiring', () => {
  const blockingRedTeam = (_input) => runRedTeamPhase({
    checksPerformed: RED_TEAM_CHECKS.map((c) => (c.id === 'IAM_TOO_BROAD' ? { checkId: c.id, status: 'FINDING', severity: 'P0' } : { checkId: c.id, status: 'CLEAR' })),
  });
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: cleanVerification(),
    scopePaths: [],
    runRedTeamPhaseFn: blockingRedTeam,
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.equal(audit.finalState, 'HOLD');
  assert.equal(audit.auditResult.reason, 'HOLD_RED_TEAM_BLOCKING_FINDING');
});

test('WIRING-6: a missing/incomplete red-team checklist (real runRedTeamPhase call, deliberately incomplete input) -> HOLD, never PASS', () => {
  const incompleteRedTeam = () => runRedTeamPhase({ checksPerformed: [{ checkId: RED_TEAM_CHECKS[0].id, status: 'CLEAR' }] });
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: cleanVerification(),
    scopePaths: [],
    runRedTeamPhaseFn: incompleteRedTeam,
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.equal(audit.finalState, 'HOLD');
  assert.equal(audit.auditResult.reason, 'HOLD_RED_TEAM_NOT_RUN');
});

// =============================================================================
// SECTION B — command-safety.mjs wired into runVerificationCommand (Section
// 6/7): CLASSIFY -> AUTHORIZE -> EXECUTE, never execute-then-classify.
// =============================================================================

test('WIRING-7: an UNKNOWN-classified command is NEVER spawned (NOT_EXECUTED) and the verification result is COMMAND_SAFETY_UNAUTHORIZED', () => {
  const spawnSyncFn = countingSpawnSyncFn();
  const result = runVerificationCommand({ family: 'NODE_VERSION' }, {
    repoRoot: '/fake/repo',
    task: policyTaskFixture(),
    spawnSyncFn,
    evaluateCommandSafetyFn: () => ({ commandSafetyClass: 'UNKNOWN', authorized: false }),
  });
  assert.equal(spawnSyncFn.calls, 0, 'an UNKNOWN command must never reach spawnSyncFn');
  assert.equal(result.pass, false);
  assert.equal(result.errorFamily, 'COMMAND_SAFETY_UNAUTHORIZED');
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
});

test('WIRING-8: a DESTRUCTIVE-classified command is NEVER spawned, even with explicitAuthorizationGranted-shaped input ignored by the fake', () => {
  const spawnSyncFn = countingSpawnSyncFn();
  const result = runVerificationCommand({ family: 'NODE_TEST', target: 'examples/fixture-only.test.mjs' }, {
    repoRoot: '/fake/repo',
    task: policyTaskFixture(),
    spawnSyncFn,
    evaluateCommandSafetyFn: () => ({ commandSafetyClass: 'DESTRUCTIVE', authorized: false }),
  });
  assert.equal(spawnSyncFn.calls, 0);
  assert.equal(result.pass, false);
  assert.equal(result.commandSafetyClass, 'DESTRUCTIVE');
});

test('WIRING-9: a PRODUCTION_MUTATION-classified command is NEVER spawned (Section 7: PRODUCTION_MUTATION defaults to HOLD during this phase)', () => {
  const spawnSyncFn = countingSpawnSyncFn();
  const result = runVerificationCommand({ family: 'NODE_VERSION' }, {
    repoRoot: '/fake/repo',
    task: policyTaskFixture(),
    spawnSyncFn,
    evaluateCommandSafetyFn: () => ({ commandSafetyClass: 'PRODUCTION_MUTATION', authorized: false }),
  });
  assert.equal(spawnSyncFn.calls, 0);
  assert.equal(result.pass, false);
  assert.equal(result.commandSafetyClass, 'PRODUCTION_MUTATION');
});

test('WIRING-10: a genuinely safe command (real evaluateCommandSafety, not a fake) IS permitted through to spawnSyncFn -- the wiring does not break the legitimate path', () => {
  let spawnCalls = 0;
  const spawnSyncFn = (command, args) => {
    spawnCalls += 1;
    assert.equal(command, 'node');
    assert.deepEqual(args, ['--version']);
    return { status: 0, stdout: 'v20.0.0', error: null };
  };
  const result = runVerificationCommand({ family: 'NODE_VERSION' }, {
    repoRoot: '/fake/repo',
    task: policyTaskFixture(),
    spawnSyncFn,
    evaluateCommandSafetyFn: evaluateCommandSafety, // the REAL classifier, not a fake
  });
  assert.equal(spawnCalls, 1, 'a real READ_ONLY-classified command must still reach spawnSyncFn exactly once');
  assert.equal(result.pass, true);
  assert.equal(result.commandSafetyClass, 'READ_ONLY');
});

test('WIRING-11: end-to-end -- a command-safety refusal inside executeControlledGreenTask is unconditional HOLD, never RETRY, even with retry budget remaining', async (t) => {
  const args = executeTaskFixtureArgs(t, {
    task: policyTaskFixture({ max_retries: 5 }), // plenty of retry budget
    runAllVerificationCommandsFn: (task, params) => runAllVerificationCommands(task, {
      ...params,
      evaluateCommandSafetyFn: () => ({ commandSafetyClass: 'UNKNOWN', authorized: false }),
    }),
  });
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD', 'a policy violation must never be retried, regardless of remaining budget');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
  assert.equal(finalCheckpoint.attempt, 0, 'attempt must not be consumed as a retry for a policy violation');
});

// =============================================================================
// SECTION C — full end-to-end simulated lifecycles (Section 12): all
// external operations faked, zero real spawns.
// =============================================================================

test('WIRING-12: full valid simulated lifecycle -> PASS, checkpoint PASS on disk, independent+attested audit, zero real spawnSyncFn calls', async (t) => {
  const args = executeTaskFixtureArgs(t);
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'PASS');
  assert.equal(result.auditResult.finalState, 'PASS');
  assert.equal(result.auditResult.independent, true);
  assert.equal(args.spawnSyncFn.calls, 0, 'zero real subprocess spawns anywhere in a fully faked lifecycle');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'PASS');
});

test('WIRING-13: full HOLD lifecycle via an earlier gate (command-safety) -- the audit gate is never even reached', async (t) => {
  let auditGateCalled = false;
  const args = executeTaskFixtureArgs(t, {
    runAllVerificationCommandsFn: () => ({ allPass: false, results: [{ pass: false, family: 'NODE_VERSION', errorFamily: 'COMMAND_SAFETY_UNAUTHORIZED', commandSafetyClass: 'UNKNOWN' }] }),
    auditAndCertifyGreenTaskResultFn: () => { auditGateCalled = true; return { finalState: 'PASS', reason: 'SHOULD_NEVER_RUN', auditResult: {} }; },
  });
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
  assert.equal(auditGateCalled, false, 'a command-safety refusal must stop the pipeline before the audit gate is ever reached');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
});

test('WIRING-14: full HOLD lifecycle via the audit gate itself (a blocking red-team finding) -- checkpoint HOLD, never PASS', async (t) => {
  const args = executeTaskFixtureArgs(t, {
    auditAndCertifyGreenTaskResultFn: () => ({
      finalState: 'HOLD',
      reason: 'HOLD_RED_TEAM_BLOCKING_FINDING',
      auditResult: { role: 'independent_auditor', finalState: 'HOLD', reason: 'HOLD_RED_TEAM_BLOCKING_FINDING' },
    }),
  });
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
  assert.equal(result.checkpointState, 'HOLD');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
  assert.equal(finalCheckpoint.last_error_family, 'AUDIT_HOLD_RED_TEAM_BLOCKING_FINDING');
});

// =============================================================================
// SECTION D — HOLD is terminal; no alternate finalization path (Section
// 9/10).
// =============================================================================

test('WIRING-15: a malformed audit-gate return (no real finalState) fails closed to HOLD, never PASS', async (t) => {
  const args = executeTaskFixtureArgs(t, {
    auditAndCertifyGreenTaskResultFn: () => ({}), // malformed: no finalState at all
  });
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.status, 'HOLD');
});

test('WIRING-16: an exception thrown inside the audit gate is caught and resolves to HOLD -- never an unhandled rejection, never PASS', async (t) => {
  const args = executeTaskFixtureArgs(t, {
    auditAndCertifyGreenTaskResultFn: () => { throw new Error('simulated auditor/red-team crash'); },
  });
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  const result = await resultPromise; // must not reject
  assert.equal(result.status, 'HOLD');
  const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  assert.equal(finalCheckpoint.state, 'HOLD');
  assert.equal(finalCheckpoint.last_error_family, 'AUDIT_GATE_EXCEPTION');
});

test('WIRING-17: a HOLD written by the audit gate, looked up again via the pre-existing checkpoint recovery logic, resolves to HOLD_EXISTING_HOLD -- never RESUME_RETRY or START_FRESH', async (t) => {
  const args = executeTaskFixtureArgs(t, {
    auditAndCertifyGreenTaskResultFn: () => ({ finalState: 'HOLD', reason: 'HOLD_UNPROVEN_PRODUCTION_CLAIM', auditResult: {} }),
  });
  const child = makeFakeChild();
  const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
  child.emit('close', 0);
  await resultPromise;
  const persisted = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
  const recovery = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: persisted }, maxRetries: persisted.attempt + 10 });
  assert.equal(recovery.decision, 'HOLD_EXISTING_HOLD');
  assert.notEqual(recovery.decision, 'RESUME_RETRY');
  assert.notEqual(recovery.decision, 'START_FRESH');
});

test('WIRING-18: exactly one code path in runner.mjs ever writes checkpoint state PASS -- a static regression guard against a second/alternate finalization path being added later', () => {
  const src = readFileSync(RUNNER_SRC_PATH, 'utf8');
  const passWrites = [...src.matchAll(/state:\s*'PASS'/g)];
  // Exactly one runtime PASS-state transition (the audited line inside
  // executeControlledGreenTask). If this ever grows to 2+, a second
  // finalization path has been introduced and must be re-audited before
  // this test is updated to match.
  assert.equal(passWrites.length, 1, `expected exactly one 'state: \\'PASS\\'' checkpoint write in runner.mjs, found ${passWrites.length}`);
});

test('WIRING-19: KORIXA_NIGHT_REAL_SPAWN is never read from process.env anywhere in the newly-wired modules (command-safety.mjs, red-team-gate.mjs, executor-auditor-gate.mjs)', () => {
  const modulePaths = ['../command-safety.mjs', '../red-team-gate.mjs', '../executor-auditor-gate.mjs'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
  for (const p of modulePaths) {
    const src = readFileSync(p, 'utf8');
    assert.equal(src.includes('KORIXA_NIGHT_REAL_SPAWN'), false, `${p} must never reference the real-spawn lock directly -- only runner.mjs's own triple-lock check may`);
    assert.equal(src.includes('process.env'), false, `${p} must perform no environment reads at all -- pure decision logic only`);
  }
});
