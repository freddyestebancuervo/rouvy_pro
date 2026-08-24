import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  certifyAuditResult,
  certifyByValidator,
  isAttestedAuditorResult,
} from '../role-protocol.mjs';
import { evaluatePersistedWorkflowCertification } from '../task-orchestrator.mjs';
import { produceWorkflowValidationEvidenceFromCiRun } from '../workflow-certification-gate.mjs';

const HEAD_1 = 'a'.repeat(40);
const HEAD_2 = 'b'.repeat(40);
const PROD_FILES = ['.github/workflows/production-deploy.yml'];
const CI_FILES = ['.github/workflows/ci.yml'];
const REQUIRED_JOB = 'Night Agent — security + test';

// GENUINE evidence, minted by the real function -- see workflow-certification-
// gate.test.mjs for the adversarial proof that a hand-built object of this
// exact shape (the historical `passEvidence()` pattern this remediation
// removes) is rejected.
function realEvidence(headSha = HEAD_1, conclusion = 'success') {
  return produceWorkflowValidationEvidenceFromCiRun({
    headSha,
    ciRun: { headSha, event: 'push', jobs: [{ name: REQUIRED_JOB, conclusion }] },
  });
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
    workflowValidation: realEvidence(HEAD_1),
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH');
});

// P1-1 required adversarial case: B must HOLD on a hand-built manual object.
test('P1-1 ATTACK: B cannot be fooled by a manual {PASS, PASS, HEAD} object', () => {
  const fabricated = { headSha: HEAD_1, workflowSchemaValidation: 'PASS', actionlintValidation: 'PASS' };
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: fabricated,
  });
  assert.equal(result.finalState, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('B: workflow change + both validators PASS on same HEAD => PASS', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: realEvidence(),
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
    workflowValidation: realEvidence(),
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

// P1-1 required adversarial case: C must HOLD on a hand-built manual object,
// even when B's own result was a genuine PASS.
test('P1-1 ATTACK: C cannot be fooled by a manual {PASS, PASS, HEAD} object even after real B PASS', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: realEvidence(),
  });
  assert.equal(b.finalState, 'PASS');

  const fabricated = { headSha: HEAD_1, workflowSchemaValidation: 'PASS', actionlintValidation: 'PASS' };
  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: b, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
    filesChanged: PROD_FILES,
    workflowValidation: fabricated,
  });
  assert.equal(c.finalState, 'HOLD');
  assert.equal(c.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('P1-1 ATTACK: a spread-copy of B\'s own authentic evidence does not gain C authority', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: PROD_FILES,
    workflowValidation: realEvidence(),
  });
  const cloned = { ...realEvidence() }; // spread-copy of a genuine evidence object -- must not inherit authority
  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: b, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
    filesChanged: PROD_FILES,
    workflowValidation: cloned,
  });
  assert.equal(c.finalState, 'HOLD');
  assert.equal(c.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('C: B PASS cannot launder stale schema evidence from a different HEAD', () => {
  const b = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
    filesChanged: CI_FILES,
    workflowValidation: realEvidence(),
  });

  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_2,
    attestedAuditorResult: b, ciHeadSha: HEAD_2, ciStatus: 'SUCCESS',
    filesChanged: CI_FILES,
    workflowValidation: realEvidence(HEAD_1),
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
    workflowValidation: realEvidence(),
  });
  const c = certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: b, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
    filesChanged: PROD_FILES,
    workflowValidation: realEvidence(),
  });

  assert.equal(c.finalState, 'PASS');
  assert.equal(c.reason, 'CERTIFIED');
  assert.equal(c.workflowGate.proven, true);
  assert.equal(c.workflowGate.headSha, HEAD_1);
});

test('legacy low-level non-context call remains compatible; runtime facade owns omission defense', () => {
  const result = certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1,
    requestedState: 'PASS', findings: [], evidence: [],
  });
  assert.equal(result.finalState, 'PASS');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'workflowGate'), false);
});

// ---------------------------------------------------------------------------
// P1-2 — real Git fixture. evaluatePersistedWorkflowCertification now
// requires repoRoot and derives the changeset mechanically; state.files_changed
// (A's own claim) is exercised here as informational-only, deliberately
// WRONG, to prove it no longer has any authority over the decision.
// ---------------------------------------------------------------------------

function createGitFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-workflow-gate-git-'));
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 10_000 });
    assert.equal(result.error, undefined, result.error?.message ?? `git ${args.join(' ')} spawn failed`);
    assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
    return result.stdout.trim();
  };

  run(['init']);
  run(['config', 'user.email', 'korixa-test@example.invalid']);
  run(['config', 'user.name', 'Korixa Test']);

  fs.mkdirSync(path.join(repoRoot, 'backend', 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'backend', 'src', 'main.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(repoRoot, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\non:\n  workflow_dispatch: {}\n');
  run(['add', '-A']);
  run(['commit', '-m', 'base']);
  const baseSha = run(['rev-parse', 'HEAD']);

  return { repoRoot, baseSha, run };
}

test('P1-2 REQUIRED REGRESSION: A modifies production-deploy.yml for real but declares only backend/src/main.ts => HOLD, detected mechanically by Git', () => {
  const { repoRoot, baseSha, run } = createGitFixture();
  try {
    // A genuinely modifies the Production workflow file...
    fs.writeFileSync(
      path.join(repoRoot, '.github', 'workflows', 'production-deploy.yml'),
      'name: production-deploy\non:\n  workflow_dispatch: {}\n# real change\n',
    );
    // ...and also touches an unrelated backend file...
    fs.writeFileSync(path.join(repoRoot, 'backend', 'src', 'main.ts'), 'export const x = 2;\n');
    run(['add', '-A']);
    run(['commit', '-m', 'A declares only backend/src/main.ts, but really changed the workflow too']);
    const headSha = run(['rev-parse', 'HEAD']);

    // A's own (false) declaration -- omits the real workflow change.
    const falseFilesChanged = ['backend/src/main.ts'];

    const decision = evaluatePersistedWorkflowCertification(
      {
        base_sha: baseSha,
        head_sha: headSha,
        files_changed: falseFilesChanged, // A's claim -- must have zero authority
        auditor_result: { finalState: 'PASS' },
        validator_result: { finalState: 'PASS' },
      },
      { repoRoot },
    );

    assert.equal(decision.decision, 'HOLD', 'the real Git-derived changeset must still detect the workflow change A omitted');
    assert.equal(decision.required, true);
    assert.equal(decision.proven, false);
    assert.equal(decision.context.workflowChanged, true, 'workflowChanged must be derived from Git, not from A\'s false declaration');
    assert.ok(decision.context.workflowFiles.includes('.github/workflows/production-deploy.yml'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('P1-2: an accurate files_changed declaration for a genuine non-workflow-only change still PROCEEDs', () => {
  const { repoRoot, baseSha, run } = createGitFixture();
  try {
    fs.writeFileSync(path.join(repoRoot, 'backend', 'src', 'main.ts'), 'export const x = 3;\n');
    run(['add', '-A']);
    run(['commit', '-m', 'genuine non-workflow change only']);
    const headSha = run(['rev-parse', 'HEAD']);

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: baseSha, head_sha: headSha, files_changed: ['backend/src/main.ts'] },
      { repoRoot },
    );
    assert.equal(decision.decision, 'PROCEED');
    assert.equal(decision.required, false);
    assert.equal(decision.context.workflowChanged, false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('P1-2: Git changeset genuinely proven + real attested B/C workflow proof on that exact HEAD => PROCEED', () => {
  const { repoRoot, baseSha, run } = createGitFixture();
  try {
    fs.writeFileSync(
      path.join(repoRoot, '.github', 'workflows', 'production-deploy.yml'),
      'name: production-deploy\non:\n  workflow_dispatch: {}\n# genuine real change\n',
    );
    run(['add', '-A']);
    run(['commit', '-m', 'genuine workflow change, accurately declared']);
    const headSha = run(['rev-parse', 'HEAD']);

    const b = certifyAuditResult({
      executorRole: 'A', auditorRole: 'B', headSha,
      requestedState: 'PASS', findings: [], evidence: [],
      filesChanged: PROD_FILES,
      workflowValidation: realEvidence(headSha),
    });
    const c = certifyByValidator({
      executorRole: 'A', validatorRole: 'C', currentHeadSha: headSha,
      attestedAuditorResult: b, ciHeadSha: headSha, ciStatus: 'SUCCESS',
      filesChanged: PROD_FILES,
      workflowValidation: realEvidence(headSha),
    });
    assert.equal(c.finalState, 'PASS');

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: baseSha, head_sha: headSha, files_changed: PROD_FILES, auditor_result: b, validator_result: c },
      { repoRoot },
    );
    assert.equal(decision.proven, true);
    assert.equal(decision.decision, 'PROCEED');
    assert.equal(decision.auditorProven, true);
    assert.equal(decision.validatorProven, true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('P1-2: Git cannot determine the changeset (missing repoRoot) => HOLD, never treated as "no change"', () => {
  const decision = evaluatePersistedWorkflowCertification(
    { base_sha: HEAD_1, head_sha: HEAD_2, files_changed: [] },
    {},
  );
  assert.equal(decision.decision, 'HOLD');
  assert.equal(decision.reason, 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN');
});
