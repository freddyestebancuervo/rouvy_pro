import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWorkflowChangeContext,
  evaluateWorkflowValidationRequirement,
  isGithubActionsWorkflowPath,
  isProductionWorkflowPath,
  produceWorkflowValidationEvidenceFromCiRun,
  isAttestedWorkflowValidationEvidence,
} from '../workflow-certification-gate.mjs';

const HEAD_1 = '1'.repeat(40);
const HEAD_2 = '2'.repeat(40);
const REQUIRED_JOB = 'Night Agent — security + test';

// GENUINE evidence: the only legitimate way to produce it is to run the real
// minting function against a real (here, simulated but structurally real)
// CI run summary. This replaces the historical `passEvidence()` helper,
// which returned a bare object literal -- exactly the P1-1 fabrication this
// remediation closes. See workflow-role-enforcement.test.mjs for the
// adversarial proof that a hand-built object of this exact shape is REJECTED.
function realEvidence(headSha = HEAD_1, conclusion = 'success') {
  return produceWorkflowValidationEvidenceFromCiRun({
    headSha,
    ciRun: { headSha, event: 'push', jobs: [{ name: REQUIRED_JOB, conclusion }] },
  });
}

test('workflow path classifier recognizes only .github/workflows YAML files', () => {
  assert.equal(isGithubActionsWorkflowPath('.github/workflows/ci.yml'), true);
  assert.equal(isGithubActionsWorkflowPath('.github/workflows/reusable.yaml'), true);
  assert.equal(isGithubActionsWorkflowPath('docs/workflows/ci.yml'), false);
  assert.equal(isGithubActionsWorkflowPath('.github/workflows/readme.md'), false);
});

test('Production workflow classifier recognizes the real Korixa naming shape', () => {
  assert.equal(isProductionWorkflowPath('.github/workflows/production-deploy.yml'), true);
  assert.equal(isProductionWorkflowPath('.github/workflows/_backend-deploy-cloud-run-production.yml'), true);
  assert.equal(isProductionWorkflowPath('.github/workflows/ci.yml'), false);
});

test('malformed/unknown filesChanged context fails closed instead of assuming no workflow change', () => {
  for (const filesChanged of [undefined, null, 'x', {}, [null], ['']]) {
    const result = classifyWorkflowChangeContext(filesChanged);
    assert.equal(result.valid, false);
    const gate = evaluateWorkflowValidationRequirement({ filesChanged, headSha: HEAD_1 });
    assert.equal(gate.decision, 'HOLD');
    assert.equal(gate.evidenceLevel, 'UNPROVEN');
    assert.equal(gate.reason, 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN');
  }
});

test('non-workflow changes do not require GitHub Actions schema evidence', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['backend/src/main.ts'],
    headSha: HEAD_1,
  });
  assert.equal(result.required, false);
  assert.equal(result.proven, true);
  assert.equal(result.decision, 'PROCEED');
});

test('workflow changed + evidence missing -> HOLD', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
  });
  assert.equal(result.required, true);
  assert.equal(result.proven, false);
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED');
  assert.equal(result.evidenceLevel, 'UNPROVEN');
});

// ---------------------------------------------------------------------------
// P1-1 — REQUIRED ADVERSARIAL TESTS (T-F1.2 external audit remediation)
// ---------------------------------------------------------------------------

test('P1-1 ATTACK: a hand-built manual {PASS, PASS, HEAD} object cannot prove the gate', () => {
  const fabricated = { headSha: HEAD_1, workflowSchemaValidation: 'PASS', actionlintValidation: 'PASS' };
  assert.equal(isAttestedWorkflowValidationEvidence(fabricated), false);

  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
    workflowValidation: fabricated,
  });
  assert.equal(result.proven, false);
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('P1-1 ATTACK: a JSON round-trip of authentic evidence does not inherit authority', () => {
  const authentic = realEvidence();
  const roundTripped = JSON.parse(JSON.stringify(authentic));
  assert.equal(isAttestedWorkflowValidationEvidence(roundTripped), false);

  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
    workflowValidation: roundTripped,
  });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('P1-1 ATTACK: a spread-copy clone of authentic evidence does not inherit authority', () => {
  const authentic = realEvidence();
  const cloned = { ...authentic };
  assert.equal(isAttestedWorkflowValidationEvidence(cloned), false);

  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
    workflowValidation: cloned,
  });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('P1-1 ATTACK: authentic evidence genuinely bound to HEAD_1 is HOLD when reused for HEAD_2', () => {
  const evidenceForHead1 = realEvidence(HEAD_1);
  assert.equal(isAttestedWorkflowValidationEvidence(evidenceForHead1), true, 'sanity: this object IS attested');

  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_2,
    workflowValidation: evidenceForHead1,
  });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH');
});

test('P1-1 POSITIVE: genuine evidence minted by the real validators for the correct HEAD => PASS', () => {
  const genuine = realEvidence(HEAD_1);
  assert.equal(isAttestedWorkflowValidationEvidence(genuine), true);

  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
    workflowValidation: genuine,
  });
  assert.equal(result.proven, true);
  assert.equal(result.decision, 'PROCEED');
  assert.equal(result.reason, 'WORKFLOW_SCHEMA_VALIDATION_PROVEN');
  assert.equal(result.evidenceLevel, 'PROVEN_BY_CODE');
});

test('produceWorkflowValidationEvidenceFromCiRun mints FAIL evidence (still attested) when the required job did not succeed', () => {
  const failed = realEvidence(HEAD_1, 'failure');
  assert.equal(isAttestedWorkflowValidationEvidence(failed), true, 'a FAIL result is still genuine, attested evidence -- it is not fabricated, it is proof of failure');
  assert.equal(failed.workflowSchemaValidation, 'FAIL');
  assert.equal(failed.actionlintValidation, 'FAIL');

  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/production-deploy.yml'],
    headSha: HEAD_1,
    workflowValidation: failed,
  });
  assert.equal(result.proven, false);
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA');
});

test('produceWorkflowValidationEvidenceFromCiRun mints FAIL evidence when ciRun.headSha does not match the requested headSha (P2-1 binding)', () => {
  const wrongSubject = produceWorkflowValidationEvidenceFromCiRun({
    headSha: HEAD_1,
    ciRun: { headSha: HEAD_2, event: 'push', jobs: [{ name: REQUIRED_JOB, conclusion: 'success' }] },
  });
  assert.equal(wrongSubject.headSha, HEAD_1);
  assert.equal(wrongSubject.workflowSchemaValidation, 'FAIL');
  assert.equal(isAttestedWorkflowValidationEvidence(wrongSubject), true, 'still real, attested evidence -- of a mismatch, never silently substituted');
});

test('produceWorkflowValidationEvidenceFromCiRun requires a real ciRun shape, not a caller-supplied verdict', () => {
  assert.throws(() => produceWorkflowValidationEvidenceFromCiRun({ headSha: HEAD_1 }));
  assert.throws(() => produceWorkflowValidationEvidenceFromCiRun({ headSha: HEAD_1, ciRun: { headSha: HEAD_1 } }));
  assert.throws(() => produceWorkflowValidationEvidenceFromCiRun({ headSha: HEAD_1, ciRun: { headSha: HEAD_1, event: 'push' } }));
});

test('Production workflow changed + schema not proven -> UNPROVEN -> HOLD', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/production-deploy.yml'],
    headSha: HEAD_1,
    workflowValidation: realEvidence(HEAD_1, 'failure'),
  });
  assert.equal(result.productionWorkflowChanged, true);
  assert.equal(result.proven, false);
  assert.equal(result.evidenceLevel, 'UNPROVEN');
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA');
});

test('workflow validation evidence from another HEAD is never reusable', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_2,
    workflowValidation: realEvidence(HEAD_1),
  });
  assert.equal(result.proven, false);
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH');
});

test('workflow changed + same-HEAD schema PASS + actionlint PASS -> PROCEED', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
    workflowValidation: realEvidence(),
  });
  assert.equal(result.required, true);
  assert.equal(result.proven, true);
  assert.equal(result.decision, 'PROCEED');
  assert.equal(result.reason, 'WORKFLOW_SCHEMA_VALIDATION_PROVEN');
  assert.equal(result.evidenceLevel, 'PROVEN_BY_CODE');
});

test('Production workflow with both layers proven on same HEAD is no longer UNPROVEN', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/_backend-db-readonly-inspection-production.yml'],
    headSha: HEAD_1,
    workflowValidation: realEvidence(),
  });
  assert.equal(result.productionWorkflowChanged, true);
  assert.equal(result.proven, true);
  assert.equal(result.evidenceLevel, 'PROVEN_BY_CODE');
  assert.equal(result.decision, 'PROCEED');
});

test('evidence schema is closed: extra fields or malformed status cannot smuggle a PASS', () => {
  const extraField = { ...realEvidence(), trusted: true };
  const malformed = { ...realEvidence(), actionlintValidation: true };
  for (const workflowValidation of [extraField, malformed]) {
    const result = evaluateWorkflowValidationRequirement({
      filesChanged: ['.github/workflows/ci.yml'],
      headSha: HEAD_1,
      workflowValidation,
    });
    assert.equal(result.proven, false);
    assert.equal(result.decision, 'HOLD');
  }
});
