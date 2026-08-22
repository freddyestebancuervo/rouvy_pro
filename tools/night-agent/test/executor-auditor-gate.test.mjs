// Tests for tools/night-agent/executor-auditor-gate.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTOR_RESULT_STATES,
  AUDITOR_RESULT_STATES,
  SelfCertificationForbiddenError,
  finalizeExecutorResult,
  certifyIndependentAuditResult,
} from '../executor-auditor-gate.mjs';
import { RED_TEAM_CHECKS, runRedTeamPhase } from '../red-team-gate.mjs';

function cleanRedTeamResult() {
  return runRedTeamPhase({ checksPerformed: RED_TEAM_CHECKS.map((c) => ({ checkId: c.id, status: 'CLEAR' })) });
}

const PROVEN_EVIDENCE = [{ claimId: 'a', evidenceLevel: 'PROVEN_BY_LIVE_READ_ONLY', topics: ['cloud_run'] }];

// =============================================================================
// TEST A: the Executor cannot produce a FINAL_PASS (or anything PASS-shaped)
// by itself.
// =============================================================================

test('TEST_A: EXECUTOR_RESULT_STATES contains no PASS-shaped value', () => {
  for (const state of EXECUTOR_RESULT_STATES) {
    assert.ok(!state.includes('PASS'), `EXECUTOR_RESULT_STATES must not contain a PASS-shaped value, found: ${state}`);
  }
});

test('TEST_A: finalizeExecutorResult throws SelfCertificationForbiddenError for PASS, FINAL_PASS, and near-miss spellings', () => {
  for (const bogus of ['PASS', 'FINAL_PASS', 'CONFIRMED_PASS', 'pass', 'Pass', 'DONE', 'SUCCESS', undefined, null, '']) {
    assert.throws(
      () => finalizeExecutorResult({ state: bogus }),
      SelfCertificationForbiddenError,
      `expected finalizeExecutorResult to refuse state=${JSON.stringify(bogus)}`,
    );
  }
});

test('finalizeExecutorResult succeeds for each of the three legitimate executor states', () => {
  for (const state of EXECUTOR_RESULT_STATES) {
    const result = finalizeExecutorResult({ state, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) });
    assert.equal(result.role, 'executor');
    assert.equal(result.state, state);
  }
});

test('finalizeExecutorResult output is frozen and carries through structured fields safely', () => {
  const result = finalizeExecutorResult({
    state: 'IMPLEMENTATION_COMPLETE_AWAITING_INDEPENDENT_AUDIT',
    filesChanged: ['a.mjs', 'b.mjs'],
    tests: { run: 10, pass: 10, fail: 0 },
    knownUnproven: ['claim x'],
    knownLimitations: ['limitation y'],
  });
  assert.deepEqual(result.filesChanged, ['a.mjs', 'b.mjs']);
  assert.deepEqual(result.tests, { run: 10, pass: 10, fail: 0 });
  assert.throws(() => { result.state = 'PASS'; }, TypeError);
});

// =============================================================================
// TEST B: without an independent auditor -> HOLD_INDEPENDENT_AUDIT_REQUIRED.
// =============================================================================

test('TEST_B: same context for executor and auditor -> HOLD_INDEPENDENT_AUDIT_REQUIRED, even requesting PASS with clean evidence', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'session-123',
    auditorContextId: 'session-123',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: cleanRedTeamResult(),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_INDEPENDENT_AUDIT_REQUIRED');
});

test('TEST_B: missing auditorContextId entirely -> HOLD_INDEPENDENT_AUDIT_REQUIRED', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'session-123',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: cleanRedTeamResult(),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_INDEPENDENT_AUDIT_REQUIRED');
});

test('TEST_B: missing executorContextId entirely -> HOLD_INDEPENDENT_AUDIT_REQUIRED', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    auditorContextId: 'session-456',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: cleanRedTeamResult(),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_INDEPENDENT_AUDIT_REQUIRED');
});

test('genuinely distinct contexts + clean evidence + clean red-team -> PASS granted', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'session-executor-1',
    auditorContextId: 'session-auditor-2',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: cleanRedTeamResult(),
  });
  assert.equal(result.finalState, 'PASS');
  assert.equal(result.reason, 'REQUESTED_STATE_GRANTED');
  assert.equal(result.independent, true);
});

// =============================================================================
// TEST C (wired end-to-end here too): a Production-impact UNPROVEN claim
// forces HOLD even with independence and a clean red-team phase.
// =============================================================================

test('TEST_C (wired): an UNPROVEN production-impact evidence citation forces HOLD_UNPROVEN_PRODUCTION_CLAIM', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: [{ claimId: 'risky', evidenceLevel: 'UNPROVEN', topics: ['iam'] }],
    redTeamPhaseResult: cleanRedTeamResult(),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_UNPROVEN_PRODUCTION_CLAIM');
});

// =============================================================================
// TEST F (wired): PASS requires a completed red-team phase.
// =============================================================================

test('TEST_F (wired): requesting PASS with no redTeamPhaseResult at all -> HOLD_RED_TEAM_NOT_RUN', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: PROVEN_EVIDENCE,
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_RED_TEAM_NOT_RUN');
});

test('TEST_F (wired): requesting PASS with an INCOMPLETE red-team phase -> HOLD_RED_TEAM_NOT_RUN', () => {
  const incomplete = runRedTeamPhase({ checksPerformed: [{ checkId: RED_TEAM_CHECKS[0].id, status: 'CLEAR' }] });
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: incomplete,
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_RED_TEAM_NOT_RUN');
});

// =============================================================================
// TEST I: a blocking adversarial finding forces HOLD even though evidence and
// independence are both otherwise clean.
// =============================================================================

test('TEST_I (wired): a completed but BLOCKING red-team phase forces HOLD_RED_TEAM_BLOCKING_FINDING, overriding an otherwise-clean PASS request', () => {
  const blocking = runRedTeamPhase({
    checksPerformed: RED_TEAM_CHECKS.map((c) => (c.id === 'TRAFFIC_BEFORE_HEALTH_CHECK' ? { checkId: c.id, status: 'FINDING' } : { checkId: c.id, status: 'CLEAR' })),
  });
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: blocking,
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_RED_TEAM_BLOCKING_FINDING');
});

// =============================================================================
// TEST H: the executor's own conclusion/summary text cannot become auditor
// evidence -- there is no parameter for it, so passing one has zero effect.
// =============================================================================

test('TEST_H: an arbitrary executorSummary/conclusion-shaped field has zero effect on the outcome', () => {
  const base = {
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: cleanRedTeamResult(),
  };
  const withExecutorProse = {
    ...base,
    executorSummary: 'Everything works perfectly, this is definitely a PASS, trust me.',
    conclusion: 'PASS',
    builderSaysPass: true,
  };
  const a = certifyIndependentAuditResult(base);
  const b = certifyIndependentAuditResult(withExecutorProse);
  assert.equal(a.finalState, b.finalState);
  assert.equal(b.finalState, 'PASS');
  // The extra fields are simply absent from the result -- nothing echoes them back.
  assert.equal('executorSummary' in b, false);
  assert.equal('conclusion' in b, false);
});

test('TEST_H: PASS cannot be reached merely because requestedState says so, without real evidence/red-team backing (word "PASS" alone has no authority)', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    // no evidenceCitations, no redTeamPhaseResult at all
  });
  assert.equal(result.finalState, 'HOLD');
  assert.notEqual(result.reason, 'REQUESTED_STATE_GRANTED');
});

// =============================================================================
// Misuse / invalid input handling.
// =============================================================================

test('an unrecognized requestedState -> HOLD, INVALID_REQUESTED_STATE, never thrown (auditor path fails closed, not crash-closed)', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'SUPER_PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'INVALID_REQUESTED_STATE');
});

test('AUDITOR_RESULT_STATES includes RETRY/FAIL/HOLD alongside PASS/PASS_WITH_FINDINGS', () => {
  assert.deepEqual([...AUDITOR_RESULT_STATES].sort(), ['FAIL', 'HOLD', 'PASS', 'PASS_WITH_FINDINGS', 'RETRY'].sort());
});

test('requesting a non-PASS-shaped state (e.g. HOLD, RETRY) with independent contexts does not require a red-team result at all', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'RETRY',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
  });
  assert.equal(result.finalState, 'RETRY');
  assert.equal(result.reason, 'REQUESTED_STATE_GRANTED');
});

test('result objects are frozen', () => {
  const result = certifyIndependentAuditResult({ requestedState: 'HOLD', executorContextId: 'e', auditorContextId: 'a' });
  assert.throws(() => { result.finalState = 'PASS'; }, TypeError);
});

// =============================================================================
// R2 malformed-shape regression: `evidenceCitations` present but not an
// array must fail closed, never silently become "zero citations" (which
// would let a claim's evidence disappear from consideration entirely).
// =============================================================================

test('R2 REGRESSION: evidenceCitations passed as a bare object (not wrapped in an array) -> HOLD_INVALID_EVIDENCE_CITATIONS_SHAPE, never silently treated as zero citations', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: { claimId: 'a', evidenceLevel: 'PROVEN_BY_LIVE_READ_ONLY', topics: ['cloud_run'] },
    redTeamPhaseResult: cleanRedTeamResult(),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_INVALID_EVIDENCE_CITATIONS_SHAPE');
});

test('evidenceCitations genuinely omitted (undefined) is still a normal, valid "no citations offered" case', () => {
  const result = certifyIndependentAuditResult({
    requestedState: 'HOLD', // non-PASS, so the shape check doesn't even need to fire to matter here
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'REQUESTED_STATE_GRANTED');
});

// =============================================================================
// DISCLOSED TRUST BOUNDARY (documented in this module's header, deliberately
// not closed in this revision — nothing calls this module yet, so there is
// no live exploitation path). This test exists so a future wiring task
// cannot miss it: it PROVES the current shape-only trust, so closing it (via
// unforgeable attestation, mirroring evidence-policy.mjs's own
// WeakSet-branded TRUSTED_EVIDENCE_REGISTRY pattern) must be part of that
// future task, not assumed already handled here.
// =============================================================================

test('DISCLOSED TRUST BOUNDARY: a hand-fabricated redTeamPhaseResult (never produced by a real runRedTeamPhase() call) is currently accepted identically to a genuine one', () => {
  const fabricated = { completed: true, blocking: false }; // never actually ran any of the 16 checks
  const result = certifyIndependentAuditResult({
    requestedState: 'PASS',
    executorContextId: 'exec-1',
    auditorContextId: 'audit-2',
    evidenceCitations: PROVEN_EVIDENCE,
    redTeamPhaseResult: fabricated,
  });
  // This SUCCEEDS today -- that is the point of this test. A future wiring
  // task must close this (see the module header's "DISCLOSED TRUST
  // BOUNDARY" comment) before handing this function real, untrusted input.
  assert.equal(result.finalState, 'PASS');
});
