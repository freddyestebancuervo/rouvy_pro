import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWorkflowChangeContext,
  evaluateWorkflowValidationRequirement,
  isGithubActionsWorkflowPath,
  isProductionWorkflowPath,
  isAttestedWorkflowValidationEvidence,
} from '../workflow-certification-gate.mjs';
import { attestCiRunEvidence } from '../ci-evidence-authority.mjs';

// T-F1.2 P1-A remediation: produceWorkflowValidationEvidenceFromCiRun (which
// took a caller-supplied `ciRun` object with zero independent observation)
// has been deleted. The ONLY way to obtain genuine, attested evidence is now
// ci-evidence-authority.mjs's attestCiRunEvidence, which performs its own
// real `gh api` observation and accepts no override. HEAD_1/HEAD_2 below are
// therefore real, already-merged commits with real, completed, successful
// "Night Agent — security + test" CI runs (independently verified via
// `gh api` before this revision was written) -- this file's genuine-evidence
// helper hits real network, mirroring the already-audited precedent in
// evidence-policy.test.mjs (attestRemoteMainEvidence's positive-path tests
// likewise hit the real GitHub remote). See ci-evidence-authority.test.mjs
// for the mechanism-level (gatherer) adversarial coverage of every failure
// mode; this file only exercises evaluateWorkflowValidationRequirement's own
// decision logic against genuine, real evidence.
const HEAD_1 = '2e909e18579108928ff0728323d570491795fbee';
const HEAD_2 = '78a8c2dc2f4a414eee09b83c6596b5e69f630430';

const evidenceCache = new Map();

/** Real, attested evidence for a real HEAD -- memoized to avoid redundant `gh` calls across tests for the same SHA. */
function realEvidence(headSha = HEAD_1) {
  if (!evidenceCache.has(headSha)) {
    const result = attestCiRunEvidence({ headSha });
    if (!result.ok) throw new Error(`realEvidence(${headSha}) failed: ${result.reason}`);
    evidenceCache.set(headSha, result.evidence);
  }
  return evidenceCache.get(headSha);
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

// T-F1.2 P1-A note: attestCiRunEvidence never mints FAIL-shaped evidence --
// on any failure mode it returns { ok: false, reason } with NO evidence
// object at all (see ci-evidence-authority.test.mjs's ATTACK_CI_1..10 for
// the full mechanism-level failure-mode coverage, and the P2-1
// CI_HEAD_REUSE_ATTACK/head-binding proof specifically). From this decision-
// logic file's point of view, "the required job did not succeed" and "no
// evidence at all" are the SAME observable state: workflowValidation is
// simply absent, already covered by 'workflow changed + evidence missing ->
// HOLD' above.
test('Production workflow changed + schema not proven (no evidence supplied) -> UNPROVEN -> HOLD', () => {
  const result = evaluateWorkflowValidationRequirement({
    filesChanged: ['.github/workflows/production-deploy.yml'],
    headSha: HEAD_1,
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
