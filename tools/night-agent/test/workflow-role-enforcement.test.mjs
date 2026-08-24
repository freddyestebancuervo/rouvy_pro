import test from 'node:test';
import assert from 'node:assert/strict';

import {
  certifyAuditResult,
  certifyByValidator,
  isAttestedAuditorResult,
} from '../role-protocol.mjs';
import { evaluatePersistedWorkflowCertification } from '../task-orchestrator.mjs';

const HEAD_1 = 'a'.repeat(40);
const HEAD_2 = 'b'.repeat(40);
const PROD_FILES = ['.github/workflows/production-deploy.yml'];
const CI_FILES = ['.github/workflows/ci.yml'];

function passEvidence(headSha = HEAD_1) {
  return {
    headSha,
    workflowSchemaValidation: 'PASS',
    actionlintValidation: 'PASS',
  };
}

test('B: Production workflow + no schema proof => UNPROVEN -> HOLD', () => {
  const result = certifyAuditResult({
    executorRole: 'A',
    auditorRole: 'B',
    headSha: HEAD_1,
    requestedState: 'PASS',
    findings: [],
    evidence: [],
    filesChanged: PROD_FILES,
  });

  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA');
  assert.equal(result.workflowGate.evidenceLevel, 'UNPROVEN');
  assert.equal(isAttestedAuditorResult(result), true);
});

test('B: workflow change + evidence from another HEAD => HOLD', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_2,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: CI_FILES,
    workflowValidation: passEvidence(HEAD_1),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH');
});

test('B: workflow change + both validators PASS on same HEAD => PASS', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: passEvidence(),
  });
  assert.equal(result.finalState, 'PASS');
  assert.equal(result.workflowGate.proven, true);
  assert.equal(result.workflowGate.evidenceLevel, 'PROVEN_BY_CODE');
  assert.equal(result.workflowGate.headSha, HEAD_1);
  assert.equal(isAttestedAuditorResult(result), true);
});

test('C: even with a valid B PASS, missing C workflow proof independently => HOLD', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: passEvidence(),
  });
  assert.equal(b.finalState, 'PASS');

  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: b, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
    filesChanged: PROD_FILES,
  });

  assert.equal(c.finalState, 'HOLD');
  assert.equal(c.reason, 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA');
  assert.equal(c.workflowGate.evidenceLevel, 'UNPROVEN');
});

test('C: B PASS cannot launder stale schema evidence from a different HEAD', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: CI_FILES,
    workflowValidation: passEvidence(),
  });

  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_2,
    attestedAuditorResult: b, ciHeadSha: HEAD_2, ciStatus: 'SUCCESS',
    filesChanged: CI_FILES,
    workflowValidation: passEvidence(HEAD_1),
  });

  assert.equal(c.finalState, 'HOLD');
  // Existing audit HEAD drift is allowed to win precedence over the new
  // workflow mismatch; either way C can never certify this stale chain.
  assert.ok(['HOLD_HEAD_DRIFT_SINCE_AUDIT', 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH'].includes(c.reason));
});

test('C: same-HEAD B PASS + CI SUCCESS + both workflow validators PASS => PASS', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: passEvidence(),
  });
  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: b, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
    filesChanged: PROD_FILES,
    workflowValidation: passEvidence(),
  });

  assert.equal(c.finalState, 'PASS');
  assert.equal(c.reason, 'CERTIFIED');
  assert.equal(c.workflowGate.proven, true);
  assert.equal(c.workflowGate.headSha, HEAD_1);
});

test('runtime/Human-Gate policy: persisted Production task with missing B/C proof => HOLD', () => {
  const decision = evaluatePersistedWorkflowCertification({
    files_changed: PROD_FILES,
    head_sha: HEAD_1,
    auditor_result: { finalState: 'PASS' },
    validator_result: { finalState: 'PASS' },
  });
  assert.equal(decision.decision, 'HOLD');
  assert.equal(decision.reason, 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA');
});

test('runtime/Human-Gate policy: persisted same-HEAD B+C workflow proof => PROCEED', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: passEvidence(),
  });
  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: b, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
    filesChanged: PROD_FILES,
    workflowValidation: passEvidence(),
  });

  const decision = evaluatePersistedWorkflowCertification({
    files_changed: PROD_FILES,
    head_sha: HEAD_1,
    auditor_result: b,
    validator_result: c,
  });
  assert.equal(decision.proven, true);
  assert.equal(decision.decision, 'PROCEED');
  assert.equal(decision.auditorProven, true);
  assert.equal(decision.validatorProven, true);
});

test('legacy low-level non-context call remains compatible; runtime facade owns omission defense', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
  });
  assert.equal(result.finalState, 'PASS');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'workflowGate'), false);
});
