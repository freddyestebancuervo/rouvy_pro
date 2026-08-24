// Tests for tools/night-agent/role-protocol.mjs.
//
// Named adversarial cases are drawn directly from Task 2's own "TEST
// STRATEGY" section: A self-certification, A->C skip, HEAD drift after B's
// audit, Production+UNPROVEN, malformed shared state/handoff, unknown
// command classification, CI-SHA mismatch, blocking-finding-forces-HOLD,
// and WAITING_CI never becoming SUCCESS.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VALID_ROLE_TRANSITIONS,
  InvalidRoleTransitionError,
  SelfCertificationForbiddenError,
  validateRoleTransition,
  validateStateTransition,
  EXECUTOR_RESULT_STATES,
  finalizeExecutorResult,
  validateHandoffEnvelope,
  buildHandoffEnvelope,
  AUDITOR_RESULT_STATES,
  certifyAuditResult,
  isAttestedAuditorResult,
  VALIDATOR_RESULT_STATES,
  certifyByValidator,
  classifyAuditorResultTrust,
  classifyCiWaitStatus,
  evaluateCommandRiskGate,
  requiresHumanGateForAction,
} from '../role-protocol.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

// =============================================================================
// Role transitions
// =============================================================================

test('VALID_ROLE_TRANSITIONS is exactly the closed table the flow requires', () => {
  assert.deepEqual({ ...VALID_ROLE_TRANSITIONS }, {
    NIGHT: ['A'],
    A: ['B'],
    B: ['A', 'C'],
    C: ['HUMAN_GATE'],
  });
});

test('NIGHT -> A, A -> B, B -> A, B -> C are all valid', () => {
  assert.doesNotThrow(() => validateRoleTransition({ fromRole: 'NIGHT', toRole: 'A' }));
  assert.doesNotThrow(() => validateRoleTransition({ fromRole: 'A', toRole: 'B' }));
  assert.doesNotThrow(() => validateRoleTransition({ fromRole: 'B', toRole: 'A' }));
  assert.doesNotThrow(() => validateRoleTransition({ fromRole: 'B', toRole: 'C' }));
  assert.doesNotThrow(() => validateRoleTransition({ fromRole: 'C', toRole: 'HUMAN_GATE' }));
});

test('TEST STRATEGY: A -> C directly without B is INVALID', () => {
  assert.throws(() => validateRoleTransition({ fromRole: 'A', toRole: 'C' }), InvalidRoleTransitionError);
});

test('NIGHT -> B/C, C -> A/B, and any transition from an unknown role are all rejected', () => {
  assert.throws(() => validateRoleTransition({ fromRole: 'NIGHT', toRole: 'B' }), InvalidRoleTransitionError);
  assert.throws(() => validateRoleTransition({ fromRole: 'NIGHT', toRole: 'C' }), InvalidRoleTransitionError);
  assert.throws(() => validateRoleTransition({ fromRole: 'C', toRole: 'A' }), InvalidRoleTransitionError);
  assert.throws(() => validateRoleTransition({ fromRole: 'C', toRole: 'B' }), InvalidRoleTransitionError);
  assert.throws(() => validateRoleTransition({ fromRole: 'D', toRole: 'A' }), InvalidRoleTransitionError);
});

test('state transitions: only the declared (state, role) pairs are valid', () => {
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'IDLE', toState: 'PLANNING', actingRole: 'NIGHT' }));
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'AUDITING', toState: 'HOLD', actingRole: 'B' }));
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'HOLD', toState: 'REMEDIATING', actingRole: 'A' }));
  // Task 6: C's PASS lands on PR_METADATA_SYNC_REQUIRED, not directly on
  // READY_FOR_HUMAN -- see the dedicated PR_METADATA_SYNC_REQUIRED tests below.
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'VALIDATING', toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'C' }));
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'PR_METADATA_SYNC_REQUIRED', toState: 'READY_FOR_HUMAN', actingRole: 'C' }));
});

test('state transition attempted by the wrong role is rejected', () => {
  assert.throws(() => validateStateTransition({ fromState: 'AUDITING', toState: 'HOLD', actingRole: 'A' }), InvalidRoleTransitionError);
  assert.throws(() => validateStateTransition({ fromState: 'VALIDATING', toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'B' }), InvalidRoleTransitionError);
  assert.throws(() => validateStateTransition({ fromState: 'PR_METADATA_SYNC_REQUIRED', toState: 'READY_FOR_HUMAN', actingRole: 'B' }), InvalidRoleTransitionError);
});

test('Task 6: VALIDATING can no longer move directly to READY_FOR_HUMAN -- C_PASS must not directly imply HUMAN_GATE_READY', () => {
  assert.throws(() => validateStateTransition({ fromState: 'VALIDATING', toState: 'READY_FOR_HUMAN', actingRole: 'C' }), InvalidRoleTransitionError);
});

test('Task 6: a metadata problem at PR_METADATA_SYNC_REQUIRED routes to the ordinary HOLD state, same recovery path as any other HOLD', () => {
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'PR_METADATA_SYNC_REQUIRED', toState: 'HOLD', actingRole: 'C' }));
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'HOLD', toState: 'REMEDIATING', actingRole: 'A' }));
});

test('Task 6 Remediation Round 1 (P2-02): READY_FOR_HUMAN -> PR_METADATA_SYNC_REQUIRED is a NIGHT-only recovery move (body-drift re-verification), never C/A/B', () => {
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'NIGHT' }));
  assert.throws(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'C' }), InvalidRoleTransitionError);
  assert.throws(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'A' }), InvalidRoleTransitionError);
  assert.throws(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'B' }), InvalidRoleTransitionError);
  // this recovery move never reaches EXECUTING/AUDITING/REMEDIATING directly -- it is metadata-only:
  assert.throws(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'EXECUTING', actingRole: 'NIGHT' }), InvalidRoleTransitionError);
  assert.throws(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'REMEDIATING', actingRole: 'NIGHT' }), InvalidRoleTransitionError);
});

test('a state transition not present in the table at all is rejected (e.g. IDLE -> DONE)', () => {
  assert.throws(() => validateStateTransition({ fromState: 'IDLE', toState: 'DONE', actingRole: 'NIGHT' }), InvalidRoleTransitionError);
});

test('READY_FOR_HUMAN never transitions anywhere except DONE, and only NIGHT may record it -- no role can reach DONE except through this recorded path', () => {
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'DONE', actingRole: 'NIGHT' }));
  assert.throws(() => validateStateTransition({ fromState: 'READY_FOR_HUMAN', toState: 'DONE', actingRole: 'C' }), InvalidRoleTransitionError);
});

// =============================================================================
// TEST STRATEGY: A attempts self-certification -> rejected
// =============================================================================

test('EXECUTOR_RESULT_STATES structurally excludes anything PASS/FINAL/certified-shaped', () => {
  assert.deepEqual([...EXECUTOR_RESULT_STATES], ['IMPLEMENTED_AND_VALIDATED', 'HOLD', 'FAIL']);
  for (const forbidden of ['FINAL_PASS', 'AUDIT_PASS', 'SAFE_TO_MERGE', 'PASS', 'CERTIFIED']) {
    assert.equal(EXECUTOR_RESULT_STATES.includes(forbidden), false);
  }
});

test('A attempting self-certification (any PASS-shaped state) throws SelfCertificationForbiddenError', () => {
  for (const attempt of ['FINAL_PASS', 'AUDIT_PASS', 'SAFE_TO_MERGE', 'PASS']) {
    assert.throws(
      () => finalizeExecutorResult({ state: attempt, executorRole: 'A', baseSha: SHA_A, headSha: SHA_B }),
      SelfCertificationForbiddenError,
    );
  }
});

test('A finalizing with a legitimate state returns a frozen, well-shaped result', () => {
  const result = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: SHA_A, headSha: SHA_B, filesChanged: ['x.mjs'], tests: { run: 5, pass: 5, fail: 0 } });
  assert.equal(result.state, 'IMPLEMENTED_AND_VALIDATED');
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.state = 'PASS'; }, TypeError);
});

// =============================================================================
// Handoff envelope
// =============================================================================

test('a well-formed handoff envelope validates and round-trips through buildHandoffEnvelope', () => {
  const envelope = buildHandoffEnvelope({
    taskId: 't1', from: 'A', to: 'B', baseSha: SHA_A, headSha: SHA_B,
    filesChanged: ['x.mjs'], testSummary: '10/10 pass', ciStatus: 'SUCCESS',
    riskSurfaces: ['ci.yml'], productionImpact: false, knownFindings: [], nextAction: 'audit the delta',
  });
  assert.deepEqual(validateHandoffEnvelope(envelope), { valid: true, reason: null });
});

test('TEST STRATEGY: malformed shared state / handoff -> HOLD-shaped rejection', () => {
  assert.equal(validateHandoffEnvelope(null).valid, false);
  assert.equal(validateHandoffEnvelope('a string').valid, false);
  assert.equal(validateHandoffEnvelope([]).valid, false);
  assert.equal(validateHandoffEnvelope({ taskId: 't1', from: 'A', to: 'B', baseSha: SHA_A, headSha: SHA_B, extraField: 'smuggled' }).reason, 'HANDOFF_UNEXPECTED_FIELD');
  assert.equal(validateHandoffEnvelope({ from: 'A', to: 'B', baseSha: SHA_A, headSha: SHA_B }).reason, 'HANDOFF_MISSING_TASK_ID');
  assert.equal(validateHandoffEnvelope({ taskId: 't1', from: 'D', to: 'B', baseSha: SHA_A, headSha: SHA_B }).reason, 'HANDOFF_INVALID_FROM');
  assert.equal(validateHandoffEnvelope({ taskId: 't1', from: 'A', to: 'B', baseSha: '', headSha: SHA_B }).reason, 'HANDOFF_MISSING_BASE_SHA');
  assert.equal(validateHandoffEnvelope({ taskId: 't1', from: 'A', to: 'B', baseSha: SHA_A, headSha: SHA_B, filesChanged: 'not-an-array' }).reason, 'HANDOFF_MALFORMED_FILES_CHANGED');
});

test('a handoff envelope encoding an invalid role transition (e.g. A -> C) is rejected even if otherwise well-formed', () => {
  const result = validateHandoffEnvelope({ taskId: 't1', from: 'A', to: 'C', baseSha: SHA_A, headSha: SHA_B });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HANDOFF_INVALID_ROLE_TRANSITION');
});

test('validateHandoffEnvelope rejects a from/to mismatch against the expected transition', () => {
  const envelope = buildHandoffEnvelope({ taskId: 't1', from: 'A', to: 'B', baseSha: SHA_A, headSha: SHA_B });
  assert.equal(validateHandoffEnvelope(envelope, { expectedFrom: 'B', expectedTo: 'C' }).valid, false);
});

// =============================================================================
// B — auditor: independence, blocking findings, attestation
// =============================================================================

test('AUDITOR_RESULT_STATES matches the brief exactly', () => {
  assert.deepEqual([...AUDITOR_RESULT_STATES], ['PASS', 'PASS_WITH_FINDINGS', 'HOLD', 'HOLD_FOR_REMEDIATION']);
});

test('a genuinely independent B (different normalized identity from A) with no blocking findings and clean evidence -> PASS, attested', () => {
  const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [], evidence: [] });
  assert.equal(result.finalState, 'PASS');
  assert.equal(result.independent, true);
  assert.equal(isAttestedAuditorResult(result), true);
});

test('B sharing (a trivial variant of) A\'s identity -> HOLD_INDEPENDENT_AUDIT_REQUIRED, never PASS', () => {
  for (const auditorRole of ['A', 'a', ' A ', 'A\t']) {
    const result = certifyAuditResult({ executorRole: 'A', auditorRole, headSha: SHA_B, requestedState: 'PASS', findings: [] });
    assert.equal(result.finalState, 'HOLD');
    assert.equal(result.reason, 'HOLD_INDEPENDENT_AUDIT_REQUIRED');
  }
});

// Regression for B audit Round 1, P0 EXECUTOR_AUDITOR_SEPARATION: invisible/
// zero-width/bidi/formatting Unicode characters appended to a role string
// used to defeat the old fuzzy `.trim().replace(/\s+/g,' ')` normalizer --
// reproduced live with 'A​'. The fix requires EXACT canonical
// membership (ROLES = ['NIGHT','A','B','C']), so every one of these must
// now simply fail to be recognized as ANY valid identity at all (never
// silently treated as "independent from A", never treated as "equal to
// A" either -- just rejected).
test('regression (P0): zero-width and other invisible/formatting Unicode characters appended to a role string never produce a valid, independent identity', () => {
  const invisibleSuffixes = [
    '​', // zero-width space
    '‌', // zero-width non-joiner
    '‍', // zero-width joiner
    '⁠', // word joiner
    '﻿', // BOM / zero-width no-break space
  ];
  for (const suffix of invisibleSuffixes) {
    const auditorRole = `A${suffix}`;
    const result = certifyAuditResult({ executorRole: 'A', auditorRole, headSha: SHA_B, requestedState: 'PASS', findings: [] });
    assert.equal(result.finalState, 'HOLD', `auditorRole="A"+${JSON.stringify(suffix)} must not certify PASS`);
    assert.equal(result.reason, 'HOLD_INDEPENDENT_AUDIT_REQUIRED', `auditorRole="A"+${JSON.stringify(suffix)} must be treated as not-a-valid-identity, not as independent`);
    assert.equal(result.independent, false);
  }
});

test('regression (P0): only EXACT canonical role strings are ever accepted as an identity -- unrecognized values are simply invalid, not fuzzily coerced', () => {
  for (const bogus of ['NIGHT ', ' A', 'b', 'D', 'agent-a', '__proto__', 'constructor', '', 'A;B', 'null']) {
    const result = certifyAuditResult({ executorRole: 'A', auditorRole: bogus, headSha: SHA_B, requestedState: 'PASS', findings: [] });
    assert.equal(result.finalState, 'HOLD', `auditorRole=${JSON.stringify(bogus)} must never certify PASS`);
    assert.equal(result.reason, 'HOLD_INDEPENDENT_AUDIT_REQUIRED');
  }
});

test('a genuinely distinct pair of canonical roles is still, correctly, independent -- the fix does not break the legitimate case', () => {
  const pairs = [['NIGHT', 'A'], ['A', 'B'], ['B', 'C'], ['A', 'C']];
  for (const [executorRole, auditorRole] of pairs) {
    const result = certifyAuditResult({ executorRole, auditorRole, headSha: SHA_B, requestedState: 'PASS', findings: [] });
    assert.equal(result.independent, true, `${executorRole} vs ${auditorRole} must be independent`);
  }
});

test('TEST STRATEGY: a blocking finding forces HOLD even when requestedState is PASS', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS',
    findings: [{ id: 'F1', severity: 'P0', summary: 'real bypass found' }],
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_BLOCKING_FINDING');
});

test('a P0/P1 finding is blocking by default even if `blocking` is omitted -- omission never means non-blocking', () => {
  const p0 = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity: 'P0', summary: 'x' }] });
  const p1 = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity: 'P1', summary: 'x' }] });
  assert.equal(p0.reason, 'HOLD_BLOCKING_FINDING');
  assert.equal(p1.reason, 'HOLD_BLOCKING_FINDING');
});

test('a P2 finding only blocks when explicitly marked blocking:true; a P3 never blocks on its own', () => {
  const p2NonBlocking = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity: 'P2', summary: 'x' }] });
  const p2Blocking = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity: 'P2', summary: 'x', blocking: true }] });
  const p3 = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS_WITH_FINDINGS', findings: [{ severity: 'P3', summary: 'x' }] });
  assert.equal(p2NonBlocking.finalState, 'PASS');
  assert.equal(p2Blocking.reason, 'HOLD_BLOCKING_FINDING');
  assert.equal(p3.finalState, 'PASS_WITH_FINDINGS');
});

test('malformed findings shape (present but not an array) -> HOLD, never silently coerced to empty', () => {
  const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: 'not-an-array' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_MALFORMED_FINDINGS_SHAPE');
});

// Regression for B audit Round 1, P0 FINDINGS_SEMANTICS: any severity value
// outside the closed FINDING_SEVERITIES set used to silently fall through
// isFindingBlocking to "never blocks" -- reproduced live for 7 malformed
// variants, every one certifying PASS despite representing what was
// intended to be a real P0/P1. Every one of these must now HOLD instead.
test('regression (P0): any malformed/unrecognized finding severity forces HOLD, never silently becomes non-blocking', () => {
  const malformedSeverities = ['p0', 'P0 ', ' P0', 'P1-space', 'P4', 'UNKNOWN', '', null, undefined, 42, {}, []];
  for (const severity of malformedSeverities) {
    const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity, summary: 'x' }] });
    assert.equal(result.finalState, 'HOLD', `severity=${JSON.stringify(severity)} must force HOLD, not PASS`);
    assert.equal(result.reason, 'HOLD_MALFORMED_FINDING_SEVERITY');
  }
});

test('regression (P0): a finding entirely missing the severity key also forces HOLD (undefined is not silently treated as P3)', () => {
  const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ summary: 'no severity key at all' }] });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_MALFORMED_FINDING_SEVERITY');
});

test('the 4 real, exact FINDING_SEVERITIES values still behave correctly after the fix: P0/P1 block, P2 blocks only if explicit, P3 never blocks', () => {
  const p0 = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity: 'P0', summary: 'x' }] });
  const p3 = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS_WITH_FINDINGS', findings: [{ severity: 'P3', summary: 'x' }] });
  assert.equal(p0.reason, 'HOLD_BLOCKING_FINDING');
  assert.equal(p3.finalState, 'PASS_WITH_FINDINGS');
});

// Regression for B audit Round 1, P1 EVIDENCE_FAIL_CLOSED: `evidence`
// present-but-malformed used to be silently coerced to [] instead of
// forcing HOLD, inconsistent with `findings`' own already-correct handling
// in the very same function.
test('regression (P1): malformed evidence shape (present but not an array) -> HOLD, never silently coerced to empty', () => {
  for (const malformed of ['not-an-array', 42, { claimId: 'a', evidenceLevel: 'PROVEN_BY_CODE' } /* bare object, not wrapped in [] */]) {
    const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [], evidence: malformed });
    assert.equal(result.finalState, 'HOLD', `evidence=${JSON.stringify(malformed)} must force HOLD, not silently become []`);
    assert.equal(result.reason, 'HOLD_MALFORMED_EVIDENCE_SHAPE');
  }
});

test('evidence genuinely omitted (undefined) remains a normal, valid "no evidence offered" case, not malformed', () => {
  const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [] });
  assert.equal(result.finalState, 'PASS');
});

// =============================================================================
// Regression for B audit Round 1, P1 WEAKSET_RESTART_RECOVERY.
// =============================================================================

test('classifyAuditorResultTrust distinguishes LIVE_ATTESTATION / PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION / UNRECOGNIZED', () => {
  const genuine = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [] });
  // JSON round-trip simulates exactly what protocol-state.mjs's own
  // persistence does across a real process boundary -- a brand-new object,
  // never in the live WeakSet, regardless of which process created it.
  const roundTripped = JSON.parse(JSON.stringify(genuine));
  assert.equal(classifyAuditorResultTrust(genuine), 'LIVE_ATTESTATION');
  assert.equal(classifyAuditorResultTrust(roundTripped), 'PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION');
  assert.equal(classifyAuditorResultTrust({ totally: 'unrelated' }), 'UNRECOGNIZED');
  assert.equal(classifyAuditorResultTrust(null), 'UNRECOGNIZED');
});

test('SECURITY: a round-tripped (or hand-fabricated) result can NEVER directly pass C, regardless of shape-plausibility -- persistence is never automatically trusted', () => {
  const genuine = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [] });
  const roundTripped = JSON.parse(JSON.stringify(genuine));
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: roundTripped, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_AUDIT_ATTESTATION_EXPIRED');
});

test('OPERABILITY: HOLD(attestation-expired) -> NIGHT routes directly to READY_FOR_B (skipping A, which has no remediation to do) -> B re-attests for real -> C then certifies', () => {
  const genuine = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [] });
  const roundTripped = JSON.parse(JSON.stringify(genuine));
  const expired = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: roundTripped, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(expired.reason, 'HOLD_AUDIT_ATTESTATION_EXPIRED');

  // NIGHT may route this specific HOLD directly to READY_FOR_B -- a real,
  // valid state transition, distinct from the A-remediation path (which
  // also remains valid, for genuine remediation HOLDs).
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'HOLD', toState: 'READY_FOR_B', actingRole: 'NIGHT' }));
  assert.doesNotThrow(() => validateStateTransition({ fromState: 'HOLD', toState: 'REMEDIATING', actingRole: 'A' }));
  assert.throws(() => validateStateTransition({ fromState: 'HOLD', toState: 'READY_FOR_B', actingRole: 'A' }), InvalidRoleTransitionError, 'only NIGHT may make this specific routing decision, not A');

  // B re-attests FOR REAL: a fresh, live call, observing the current
  // actual head -- never a resurrection of the stale object.
  const reattested = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [] });
  assert.equal(isAttestedAuditorResult(reattested), true);

  const finalValidation = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: reattested, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(finalValidation.finalState, 'PASS');
});

// =============================================================================
// Regression for B audit Round 1, P2 B_C_MUTATION_ENFORCEMENT.
// =============================================================================

test('evaluateCommandRiskGate: B/C are role-authorized for READ_ONLY commands', () => {
  for (const activeRole of ['B', 'C']) {
    const result = evaluateCommandRiskGate({ command: 'git status', targetEnvironment: 'Local', activeRole });
    assert.equal(result.commandSafetyClass, 'READ_ONLY');
    assert.equal(result.roleAuthorized, true);
  }
});

test('evaluateCommandRiskGate: B/C are role-DENIED for any mutation class, even one command-safety.mjs itself would otherwise authorize', () => {
  const cases = [
    { activeRole: 'B', command: 'git add x.mjs', targetEnvironment: 'Local' }, // LOCAL_MUTATION
    { activeRole: 'C', command: 'git add x.mjs', targetEnvironment: 'Local' },
    { activeRole: 'B', command: 'gh pr create --draft --title x', targetEnvironment: 'Development' }, // REMOTE_NONPROD_MUTATION-shaped
    { activeRole: 'C', command: 'git reset --hard', targetEnvironment: 'Local' }, // DESTRUCTIVE
    { activeRole: 'B', command: 'some-unrecognized-tool --flag', targetEnvironment: 'Local' }, // UNKNOWN
    { activeRole: 'C', command: 'some-unrecognized-tool --flag', targetEnvironment: 'Local' },
  ];
  for (const c of cases) {
    const result = evaluateCommandRiskGate(c);
    assert.notEqual(result.commandSafetyClass, 'READ_ONLY', `test setup sanity: ${c.command} was expected to be a mutation/unknown class`);
    assert.equal(result.roleAuthorized, false, `${c.activeRole} + ${c.command} must be role-denied`);
  }
});

test('evaluateCommandRiskGate: A, NIGHT, and an unspecified activeRole are completely unaffected by the role gate -- roleAuthorized is always true, deferring to evaluation.authorized', () => {
  for (const activeRole of ['A', 'NIGHT', undefined]) {
    const readOnly = evaluateCommandRiskGate({ command: 'git status', targetEnvironment: 'Local', activeRole });
    const mutation = evaluateCommandRiskGate({ command: 'git add x.mjs', targetEnvironment: 'Local', activeRole });
    assert.equal(readOnly.roleAuthorized, true);
    assert.equal(mutation.roleAuthorized, true, `activeRole=${activeRole} must not be role-denied for a mutation -- only B/C are`);
  }
});

test('evaluateCommandRiskGate never touches evaluation.authorized (command-safety.mjs\'s own, pre-existing, already-audited field) -- A\'s existing use of this function is unaffected', () => {
  const withRole = evaluateCommandRiskGate({ command: 'git status', targetEnvironment: 'Local', activeRole: 'B' });
  const withoutRole = evaluateCommandRiskGate({ command: 'git status', targetEnvironment: 'Local' });
  assert.equal(withRole.authorized, withoutRole.authorized);
  const mutWithRole = evaluateCommandRiskGate({ command: 'git add x.mjs', targetEnvironment: 'Local', activeRole: 'C' });
  const mutWithoutRole = evaluateCommandRiskGate({ command: 'git add x.mjs', targetEnvironment: 'Local' });
  assert.equal(mutWithRole.authorized, mutWithoutRole.authorized, 'evaluation.authorized itself must be identical regardless of activeRole -- only the new roleAuthorized field differs');
});

test('TEST STRATEGY: Production claim = UNPROVEN -> HOLD via the reused claim-taxonomy evidence gate', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [],
    evidence: [{ claimId: 'prod-deploy-safe', evidenceLevel: 'UNPROVEN', topics: ['production'] }],
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_UNPROVEN_PRODUCTION_CLAIM');
});

test('a HOLD-shaped requestedState (HOLD, HOLD_FOR_REMEDIATION) does not require clean findings/evidence, and is itself attested', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'HOLD_FOR_REMEDIATION',
    findings: [{ severity: 'P1', summary: 'real bug' }],
  });
  assert.equal(result.finalState, 'HOLD_FOR_REMEDIATION');
  assert.equal(isAttestedAuditorResult(result), true, 'a genuine HOLD result must also be attested, so C can trust it is real, not fabricated in either direction');
});

test('a missing/invalid headSha on the audit request -> HOLD, never certified against an unknown commit', () => {
  const result = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: '', requestedState: 'PASS' });
  assert.equal(result.finalState, 'HOLD');
});

// =============================================================================
// C — validator: attestation binding, HEAD drift, CI SHA binding, blockers
// =============================================================================

function realPassAudit(headSha = SHA_B) {
  return certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [] });
}

test('VALIDATOR_RESULT_STATES matches the brief exactly', () => {
  assert.deepEqual([...VALIDATOR_RESULT_STATES], ['PASS', 'HOLD']);
});

test('a genuine PASS audit result, current HEAD matching, matching CI SUCCESS -> C certifies PASS', () => {
  const audit = realPassAudit(SHA_B);
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: audit, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'PASS');
});

test('TEST BRIEF: a hand-fabricated auditor result (never produced by certifyAuditResult) is rejected, even if shape-identical to a real one -- classified as attestation-expired (shape-plausible), since a spread copy of a genuine result IS shape-plausible', () => {
  const audit = realPassAudit(SHA_B);
  const fabricated = { ...audit }; // spread copy -- same fields, different object identity
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: fabricated, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_AUDIT_ATTESTATION_EXPIRED');
});

test('a genuinely unrecognizable candidate (not even shape-plausible) is rejected with HOLD_AUDIT_RESULT_NOT_ATTESTED, distinct from the shape-plausible case above', () => {
  for (const bad of [null, undefined, {}, 'not an object', 42, { role: 'auditor' }, { role: 'auditor', headSha: SHA_B, finalState: 'PASS' /* missing findings array */ }]) {
    const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: bad, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
    assert.equal(result.finalState, 'HOLD');
    assert.equal(result.reason, 'HOLD_AUDIT_RESULT_NOT_ATTESTED', `expected NOT_ATTESTED (not ATTESTATION_EXPIRED) for ${JSON.stringify(bad)}`);
  }
});

test('TEST STRATEGY: B audit bound to HEAD1, current HEAD becomes HEAD2 -> C HOLD (head drift)', () => {
  const audit = realPassAudit(SHA_B);
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_C, attestedAuditorResult: audit, ciHeadSha: SHA_C, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_HEAD_DRIFT_SINCE_AUDIT');
});

test('TEST STRATEGY: CI evidence belongs to another SHA -> rejected, never substituted for the real head', () => {
  const audit = realPassAudit(SHA_B);
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: audit, ciHeadSha: SHA_C, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_CI_SHA_MISMATCH');
});

test('TEST STRATEGY: WAITING_CI -> HOLD with a distinct reason, never silently treated as SUCCESS', () => {
  const audit = realPassAudit(SHA_B);
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: audit, ciHeadSha: SHA_B, ciStatus: 'WAITING_CI' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'WAITING_CI');
});

test('CI FAILURE (completed but not success) -> HOLD_CI_NOT_SUCCESS', () => {
  const audit = realPassAudit(SHA_B);
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: audit, ciHeadSha: SHA_B, ciStatus: 'FAILURE' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_CI_NOT_SUCCESS');
});

test('TEST STRATEGY: blocking finding exists (B returned HOLD/HOLD_FOR_REMEDIATION) -> C HOLD_UNRESOLVED_BLOCKER, never certifies around it', () => {
  const audit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'HOLD_FOR_REMEDIATION', findings: [{ severity: 'P0', summary: 'x' }] });
  const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: audit, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_UNRESOLVED_BLOCKER');
});

test('C sharing a trivial identity variant of A is rejected regardless of everything else being clean', () => {
  const audit = realPassAudit(SHA_B);
  const result = certifyByValidator({ executorRole: 'A', validatorRole: ' a ', currentHeadSha: SHA_B, attestedAuditorResult: audit, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_INDEPENDENT_VALIDATION_REQUIRED');
});

test('a null/undefined attestedAuditorResult is rejected the same way a fabricated one is', () => {
  for (const bad of [null, undefined, {}, 'not an object', 42]) {
    const result = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: bad, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
    assert.equal(result.finalState, 'HOLD');
    assert.equal(result.reason, 'HOLD_AUDIT_RESULT_NOT_ATTESTED');
  }
});

// =============================================================================
// CI wait classification
// =============================================================================

test('classifyCiWaitStatus: not completed -> WAITING_CI regardless of conclusion', () => {
  assert.equal(classifyCiWaitStatus({ status: 'in_progress', conclusion: null }), 'WAITING_CI');
  assert.equal(classifyCiWaitStatus({ status: 'queued', conclusion: null }), 'WAITING_CI');
});

test('classifyCiWaitStatus: completed+success -> SUCCESS; completed+anything else -> FAILURE', () => {
  assert.equal(classifyCiWaitStatus({ status: 'completed', conclusion: 'success' }), 'SUCCESS');
  assert.equal(classifyCiWaitStatus({ status: 'completed', conclusion: 'failure' }), 'FAILURE');
  assert.equal(classifyCiWaitStatus({ status: 'completed', conclusion: 'cancelled' }), 'FAILURE');
  assert.equal(classifyCiWaitStatus({ status: 'completed', conclusion: null }), 'FAILURE');
});

// =============================================================================
// Command risk gate + human gates
// =============================================================================

test('TEST STRATEGY: unknown command classification -> no unsafe execution (never authorized), and a human-gate type is attached', () => {
  const result = evaluateCommandRiskGate({ command: 'some-tool --flag', targetEnvironment: 'Local' });
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
  assert.equal(result.authorized, false);
  assert.equal(result.humanGateRequired, true);
  assert.equal(result.humanGateType, 'UNKNOWN_COMMAND_CLASS');
});

test('a real read-only command is authorized and requires no human gate', () => {
  const result = evaluateCommandRiskGate({ command: 'git status', targetEnvironment: 'Local' });
  assert.equal(result.commandSafetyClass, 'READ_ONLY');
  assert.equal(result.authorized, true);
  assert.equal(result.humanGateRequired, false);
  assert.equal(result.humanGateType, null);
});

test('a destructive command is never authorized and always carries a human-gate type, regardless of explicitAuthorizationGranted for standing purposes', () => {
  const result = evaluateCommandRiskGate({ command: 'git reset --hard', targetEnvironment: 'Local' });
  assert.equal(result.commandSafetyClass, 'DESTRUCTIVE');
  assert.equal(result.humanGateRequired, true);
  assert.equal(result.humanGateType, 'DESTRUCTIVE_ACTION');
});

test('a production-mutation-shaped command carries the PRODUCTION_ACTION human-gate type', () => {
  const result = evaluateCommandRiskGate({ command: 'gcloud run deploy svc', targetEnvironment: 'Production' });
  assert.equal(result.commandSafetyClass, 'PRODUCTION_MUTATION');
  assert.equal(result.humanGateType, 'PRODUCTION_ACTION');
});

test('requiresHumanGateForAction is unconditionally true for every recognized action type, with no bypass parameter of any kind', () => {
  for (const actionType of ['MARK_READY', 'MERGE', 'PRODUCTION_ACTION', 'IAM_OR_SECRET_ACTION', 'DESTRUCTIVE_ACTION', 'UNKNOWN_COMMAND_CLASS']) {
    assert.equal(requiresHumanGateForAction(actionType), true);
  }
  assert.equal(requiresHumanGateForAction.length, 1, 'the function signature itself has no second parameter a caller could use to opt out');
});

test('requiresHumanGateForAction rejects an unrecognized action type rather than silently returning false', () => {
  assert.throws(() => requiresHumanGateForAction('SOMETHING_MADE_UP'));
});

// =============================================================================
// Full lifecycle: happy path end to end, and the HOLD -> remediation -> re-audit loop
// =============================================================================

test('full happy-path lifecycle: NIGHT -> A -> B -> C -> human gate, matching the real BASE_SHA/HEAD_SHA throughout', () => {
  validateRoleTransition({ fromRole: 'NIGHT', toRole: 'A' });
  const execResult = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: SHA_A, headSha: SHA_B });
  assert.equal(execResult.state, 'IMPLEMENTED_AND_VALIDATED');

  validateRoleTransition({ fromRole: 'A', toRole: 'B' });
  const auditResult = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [] });
  assert.equal(auditResult.finalState, 'PASS');

  validateRoleTransition({ fromRole: 'B', toRole: 'C' });
  const validation = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_B, attestedAuditorResult: auditResult, ciHeadSha: SHA_B, ciStatus: 'SUCCESS' });
  assert.equal(validation.finalState, 'PASS');

  assert.equal(requiresHumanGateForAction('MARK_READY'), true);
  assert.equal(requiresHumanGateForAction('MERGE'), true);
});

test('HOLD -> remediation -> re-audit loop: a blocking finding sends work back to A, and a clean re-audit against the NEW head then certifies', () => {
  const firstAudit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_B, requestedState: 'PASS', findings: [{ severity: 'P1', summary: 'real bug' }] });
  assert.equal(firstAudit.finalState, 'HOLD');
  validateRoleTransition({ fromRole: 'B', toRole: 'A' });

  // A remediates, producing a NEW head.
  const remediation = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: SHA_A, headSha: SHA_C });
  assert.equal(remediation.headSha, SHA_C);

  validateRoleTransition({ fromRole: 'A', toRole: 'B' });
  const secondAudit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: SHA_C, requestedState: 'PASS', findings: [] });
  assert.equal(secondAudit.finalState, 'PASS');

  validateRoleTransition({ fromRole: 'B', toRole: 'C' });
  const validation = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_C, attestedAuditorResult: secondAudit, ciHeadSha: SHA_C, ciStatus: 'SUCCESS' });
  assert.equal(validation.finalState, 'PASS');

  // The FIRST (HOLD) audit result must never certify against the new head --
  // it was bound to SHA_B, not SHA_C.
  const staleCertify = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: SHA_C, attestedAuditorResult: firstAudit, ciHeadSha: SHA_C, ciStatus: 'SUCCESS' });
  assert.equal(staleCertify.finalState, 'HOLD');
});
