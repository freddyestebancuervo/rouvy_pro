import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWorkflowChangeContext,
  evaluateWorkflowValidationRequirement,
  isGithubActionsWorkflowPath,
  isProductionWorkflowPath,
} from '../workflow-certification-gate.mjs';

const HEAD_1 = '1'.repeat(40);
const HEAD_2 = '2'.repeat(40);

function passEvidence(headSha = HEAD_1) {
  return {
    headSha,
    workflowSchemaValidation: 'PASS',
    actionlintValidation: 'PASS',
  };
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

test('Production workflow changed + schema not proven -> UNPROVEN -> HOLD', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/production-deploy.yml'],
    headSha: HEAD_1,
    workflowValidation: {
      headSha: HEAD_1,
      workflowSchemaValidation: 'FAIL',
      actionlintValidation: 'PASS',
    },
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
    workflowValidation: passEvidence(HEAD_1),
  });
  assert.equal(result.proven, false);
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH');
});

test('both mechanical layers must PASS; one PASS is not enough', () => {
  for (const workflowValidation of [
    { headSha: HEAD_1, workflowSchemaValidation: 'PASS', actionlintValidation: 'FAIL' },
    { headSha: HEAD_1, workflowSchemaValidation: 'FAIL', actionlintValidation: 'PASS' },
  ]) {
    const result = evaluateWorkflowValidationRequirement({
      filesChanged: ['.github/workflows/ci.yml'],
      headSha: HEAD_1,
      workflowValidation,
    });
    assert.equal(result.proven, false);
    assert.equal(result.decision, 'HOLD');
    assert.equal(result.evidenceLevel, 'UNPROVEN');
  }
});

test('workflow changed + same-HEAD schema PASS + actionlint PASS -> PROCEED', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/ci.yml'],
    headSha: HEAD_1,
    workflowValidation: passEvidence(),
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
    workflowValidation: passEvidence(),
  });
  assert.equal(result.productionWorkflowChanged, true);
  assert.equal(result.proven, true);
  assert.equal(result.evidenceLevel, 'PROVEN_BY_CODE');
  assert.equal(result.decision, 'PROCEED');
});

test('evidence schema is closed: extra fields or malformed status cannot smuggle a PASS', () => {
  const extraField = { ...passEvidence(), trusted: true };
  const malformed = { ...passEvidence(), actionlintValidation: true };
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
