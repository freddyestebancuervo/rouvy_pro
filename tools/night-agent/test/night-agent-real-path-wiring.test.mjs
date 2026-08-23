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
// SECTION A2 (Phase 1B-R1, independent-audit finding P1-1) — the audit gate
// must genuinely RE-DERIVE its verdict from raw facts, never simply trust
// its own verification/scopePaths/task inputs. Each test here reproduces,
// against the REAL (unfaked) auditAndCertifyGreenTaskResult, one of the
// exact bypasses the independent audit constructed live (B1-B4) plus the
// separately-reported P2-5 (headSha unresolved) finding.
// =============================================================================

test('WIRING-20 (regression for audit finding B1/P1-1): verification.allPass=false with zero real pass results -> the real audit gate HOLDs, never certifies PASS', () => {
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: { allPass: false, results: [{ pass: false, family: 'NODE_VERSION', errorFamily: 'VERIFICATION_FAILED' }] },
    scopePaths: [],
    runRedTeamPhaseFn: runRedTeamPhase,
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.equal(audit.finalState, 'HOLD', 'the real audit gate must independently re-verify verification.allPass, not trust it');
});

test('WIRING-21 (regression for audit finding B2/P1-1): an empty verification.results array (nothing actually verified) -> the real audit gate HOLDs', () => {
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: { allPass: true, results: [] }, // vacuously "all pass" over zero commands
    scopePaths: [],
    runRedTeamPhaseFn: runRedTeamPhase,
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => 'b'.repeat(40),
  });
  assert.equal(audit.finalState, 'HOLD', 'a vacuous "all pass over zero commands" must not certify PASS');
});

test('WIRING-22 (regression for audit finding B3/P1-1): scopePaths containing a path-traversal or absolute entry -> the real audit gate HOLDs', () => {
  for (const suspiciousPaths of [['../../../etc/passwd'], ['C:/Windows/System32/config/SAM'], ['/etc/shadow'], [42], ['']]) {
    const audit = auditAndCertifyGreenTaskResult({
      task: policyTaskFixture(),
      attempt: 0,
      baseSha: 'a'.repeat(40),
      repoRoot: '/fake/repo',
      spawnSyncFn: countingSpawnSyncFn(),
      verification: cleanVerification(),
      scopePaths: suspiciousPaths,
      runRedTeamPhaseFn: runRedTeamPhase,
      finalizeExecutorResultFn: (input) => input,
      certifyIndependentAuditResultFn: certifyIndependentAuditResult,
      resolveLocalHeadShaFn: () => 'b'.repeat(40),
    });
    assert.equal(audit.finalState, 'HOLD', `scopePaths=${JSON.stringify(suspiciousPaths)} must not certify PASS`);
  }
});

test('WIRING-23 (regression for audit finding P2-5): an unresolved headSha (git rev-parse HEAD failed) -> the real audit gate HOLDs, never certifies PASS with headSha:null', () => {
  const audit = auditAndCertifyGreenTaskResult({
    task: policyTaskFixture(),
    attempt: 0,
    baseSha: 'a'.repeat(40),
    repoRoot: '/fake/repo',
    spawnSyncFn: countingSpawnSyncFn(),
    verification: cleanVerification(),
    scopePaths: [],
    runRedTeamPhaseFn: runRedTeamPhase,
    finalizeExecutorResultFn: (input) => input,
    certifyIndependentAuditResultFn: certifyIndependentAuditResult,
    resolveLocalHeadShaFn: () => null, // the real resolveLocalHeadSha's documented failure return
  });
  assert.equal(audit.finalState, 'HOLD');
});

test('WIRING-24 (regression for audit finding P2-4): task.allowed_paths wildcarded (\'*\'/\'**\'/\'**/*\') -> the real audit gate HOLDs, IAM_TOO_BROAD genuinely fires', () => {
  for (const wildcard of ['*', '**', '**/*']) {
    const audit = auditAndCertifyGreenTaskResult({
      task: policyTaskFixture({ allowed_paths: [wildcard] }),
      attempt: 0,
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
    assert.equal(audit.finalState, 'HOLD', `allowed_paths=['${wildcard}'] must not certify PASS`);
  }
});

test('WIRING-25: with every fact genuinely true (real verification, real scope, real headSha, bounded allowed_paths), the real audit gate still certifies PASS -- the fix does not break the legitimate path', () => {
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
  assert.equal(audit.redTeamResult.blocking, false);
  assert.ok(Array.isArray(audit.checksPerformed) && audit.checksPerformed.length === RED_TEAM_CHECKS.length, 'checksPerformed with per-check detail must be observable on the returned object');
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

test('WIRING-15b (regression for audit finding P2-1): a null or undefined audit-gate return resolves to HOLD, never an unhandled rejection', async (t) => {
  for (const malformedReturn of [null, undefined]) {
    const args = executeTaskFixtureArgs(t, {
      auditAndCertifyGreenTaskResultFn: () => malformedReturn,
    });
    const child = makeFakeChild();
    const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
    child.emit('close', 0);
    // Must resolve, not reject -- a prior version of this code read
    // `.finalState` off the raw return OUTSIDE the try/catch guard, which
    // threw a real, reproduced TypeError here instead of resolving to HOLD.
    const result = await resultPromise;
    assert.equal(result.status, 'HOLD', `auditAndCertifyGreenTaskResultFn returning ${malformedReturn} must resolve to HOLD, not throw`);
    const finalCheckpoint = JSON.parse(readFileSync(args.checkpointFilePath, 'utf8'));
    assert.equal(finalCheckpoint.state, 'HOLD');
    assert.equal(finalCheckpoint.last_error_family, 'AUDIT_GATE_MALFORMED_RESULT');
  }
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

// Phase 1B-R1 (independent audit finding P2-2): a prior version of this test
// was a source-text regex (`/state:\s*'PASS'/g`) claimed to be "a regression
// guard against a second/alternate finalization path". The audit
// constructed 7 of 8 trivially-real syntax variants (double quotes, a
// template literal, a quoted key, variable indirection, string
// concatenation, shorthand property, a computed key) that would each add a
// second real PASS-write while leaving the regex's count at 1 -- so the
// guard did not survive even an ordinary Prettier reformat. Replaced with a
// BEHAVIORAL guard: run executeControlledGreenTask across every gate-failure
// scenario this file's own SECTION B/C tests already establish individually,
// using a SHARED checkpoint-write spy, and assert that a PASS checkpoint
// state is written if and only if every single gate passed AND the REAL
// (unfaked) audit gate genuinely certifies PASS -- this holds regardless of
// what JS syntax a future refactor uses to write the literal.
test('WIRING-18: a PASS checkpoint state is written if and only if every gate passed AND the real audit gate genuinely certifies PASS -- across every gate-failure scenario, never once elsewhere', async (t) => {
  const writtenStates = [];
  function recordingWriteCheckpointFn(filePath, checkpoint) {
    writtenStates.push(checkpoint.state);
  }

  async function runScenario(name, overrides) {
    const args = executeTaskFixtureArgs(t, { writeCheckpointFn: recordingWriteCheckpointFn, ...overrides });
    const child = makeFakeChild();
    const resultPromise = executeControlledGreenTask({ ...args, spawnFn: () => child });
    child.emit('close', 0);
    await resultPromise;
  }

  await runScenario('dirty worktree', { checkWorktreeCleanFn: () => ({ clean: false, reason: 'DIRTY' }) });
  await runScenario('guard not installed', { checkNightGuardInstalledFn: () => ({ installed: false, reason: 'NOT_INSTALLED' }) });
  await runScenario('verification fails ordinarily', { runAllVerificationCommandsFn: () => ({ allPass: false, results: [{ pass: false, family: 'NODE_VERSION', errorFamily: 'VERIFICATION_FAILED' }] }) });
  await runScenario('verification fails via command-safety', { runAllVerificationCommandsFn: () => ({ allPass: false, results: [{ pass: false, family: 'NODE_VERSION', errorFamily: 'COMMAND_SAFETY_UNAUTHORIZED', commandSafetyClass: 'UNKNOWN' }] }) });
  await runScenario('scope check #1 fails', { getGitStatusPathsFn: () => ({ ok: true, paths: ['backend/unauthorized.ts'] }) });
  await runScenario('scope check #2 fails', {
    getGitStatusPathsFn: (() => {
      let call = 0;
      return () => { call += 1; return call === 1 ? { ok: true, paths: [] } : { ok: true, paths: ['backend/unauthorized.ts'] }; };
    })(),
  });
  await runScenario('audit gate forced HOLD (all upstream gates genuinely pass)', {
    auditAndCertifyGreenTaskResultFn: () => ({ finalState: 'HOLD', reason: 'HOLD_FORCED_FOR_TEST', auditResult: {} }),
  });
  await runScenario('audit gate returns a malformed (null) result', {
    auditAndCertifyGreenTaskResultFn: () => null,
  });
  await runScenario('audit gate throws', {
    auditAndCertifyGreenTaskResultFn: () => { throw new Error('simulated crash'); },
  });
  // The only scenario where every gate is genuinely satisfied AND the audit
  // gate is the REAL, unfaked auditAndCertifyGreenTaskResult -- this is the
  // sole legitimate path to PASS.
  await runScenario('every gate genuinely passes, real (unfaked) audit gate', {});

  const passCount = writtenStates.filter((s) => s === 'PASS').length;
  assert.equal(passCount, 1, `expected exactly one PASS checkpoint write across all 10 scenarios, found ${passCount} (states written: ${writtenStates.join(', ')})`);
  assert.equal(writtenStates[writtenStates.length - 1], 'PASS', 'the PASS write must belong to the fully-legitimate final scenario, not an earlier failure scenario');
});

test('WIRING-19: KORIXA_NIGHT_REAL_SPAWN is never read from process.env anywhere in the newly-wired modules (command-safety.mjs, red-team-gate.mjs, executor-auditor-gate.mjs)', () => {
  const modulePaths = ['../command-safety.mjs', '../red-team-gate.mjs', '../executor-auditor-gate.mjs'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
  for (const p of modulePaths) {
    const src = readFileSync(p, 'utf8');
    assert.equal(src.includes('KORIXA_NIGHT_REAL_SPAWN'), false, `${p} must never reference the real-spawn lock directly -- only runner.mjs's own triple-lock check may`);
    assert.equal(src.includes('process.env'), false, `${p} must perform no environment reads at all -- pure decision logic only`);
  }
});
