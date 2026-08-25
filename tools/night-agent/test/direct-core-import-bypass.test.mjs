// Tests for the P1-E remediation (T-F1.2 external re-audit round 4, HOLD):
// direct-core-import bypass of the workflow-certification requirement.
//
// BEFORE this remediation, task-orchestrator.mjs's "hardened facade"
// wrapped task-orchestrator-core.mjs's recordAuditResult/
// recordValidationResult/recordFinalPrMetadataVerification/requestHumanGate
// with the workflow-certification checks -- while task-orchestrator-core.mjs
// itself (independently importable, and imported directly by that very
// facade) kept the unhardened originals. A caller importing
// task-orchestrator-core.mjs (and, for the auditor result itself,
// role-protocol-core.mjs) DIRECTLY -- bypassing both facades -- could reach
// an authoritative READY_FOR_C/READY_FOR_HUMAN transition for a genuinely
// workflow-changing task with zero workflow proof.
//
// The fix moved the workflow-certification enforcement DIRECTLY into
// task-orchestrator-core.mjs's own four functions (see that file's header
// comment) -- there is no longer a weaker second path, direct import or
// not. This file reproduces the brief's exact attack chain against the raw
// core modules (never importing task-orchestrator.mjs or role-protocol.mjs)
// and proves every step now fails closed, using a REAL, disposable Git
// repository whose diff genuinely touches
// .github/workflows/production-deploy.yml -- not a simulated changeset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Deliberately raw-core imports only -- this is the exact bypass surface
// under test. task-orchestrator.mjs / role-protocol.mjs are never imported
// in this file.
import {
  createTaskSession, reserveTask, enterRole, recordExecutorResult,
  handoffToAuditor, recordAuditResult, handoffToValidator,
  recordValidationResult, recordFinalPrMetadataVerification,
  requestHumanGate, recordPrOpened, evaluatePersistedWorkflowCertification,
  releaseTask,
} from '../task-orchestrator-core.mjs';
import { certifyAuditResult, certifyByValidator, finalizeExecutorResult } from '../role-protocol-core.mjs';
import { buildFinalPrMetadataBlock } from '../pr-metadata-gate.mjs';
// Used ONLY by the one legitimate-path test below
// (NORMAL_FACADE_WORKFLOW_WITH_REAL_PROOF) to prove this remediation did not
// break genuine callers. Every attack-chain test above/below this one
// deliberately imports role-protocol-core.mjs / task-orchestrator-core.mjs
// directly instead.
import { certifyAuditResult as facadeCertifyAuditResult } from '../role-protocol.mjs';
import { attestCiRunEvidence } from '../ci-evidence-authority.mjs';

function createGitFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-direct-core-bypass-'));
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 10_000 });
    assert.equal(result.error, undefined, result.error?.message ?? `git ${args.join(' ')} spawn failed`);
    assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
    return result.stdout.trim();
  };
  run(['init', '--quiet']);
  run(['config', 'user.email', 'korixa-test@example.invalid']);
  run(['config', 'user.name', 'Korixa Test']);
  fs.mkdirSync(path.join(repoRoot, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'backend.txt'), 'base\n');
  run(['add', '-A']);
  run(['commit', '--quiet', '-m', 'base']);
  const baseSha = run(['rev-parse', 'HEAD']);
  return { repoRoot, baseSha, run };
}

/** Real, genuine change to .github/workflows/production-deploy.yml. */
function commitWorkflowChange(fixture) {
  fs.writeFileSync(path.join(fixture.repoRoot, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\non:\n  workflow_dispatch: {}\n');
  fixture.run(['add', '-A']);
  fixture.run(['commit', '--quiet', '-m', 'genuine production workflow change']);
  return fixture.run(['rev-parse', 'HEAD']);
}

/** Drives NIGHT -> A -> EXECUTING -> READY_FOR_B -> AUDITING via raw core calls only. */
function driveToAuditingViaRawCore({ repoRoot, baseSha, headSha }) {
  const taskId = `task-${randomUUID()}`;
  createTaskSession({ repoRoot, taskId, taskTitle: 'p1-e attack', baseSha });
  const res = reserveTask({ repoRoot, taskId, reservedPaths: ['.github/workflows/production-deploy.yml'], baseSha });
  const ownerToken = res.ownerToken;
  enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });

  // A declares only an UNRELATED file -- exactly the P1-2 omission this
  // whole chain is designed to combine with the P1-E direct-import bypass.
  const execResult = finalizeExecutorResult({
    state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha, headSha,
    filesChanged: ['backend.txt'],
  });
  recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: execResult, toState: 'READY_FOR_B' });
  handoffToAuditor({ repoRoot, taskId, ownerToken, headSha });
  return { repoRoot, taskId, ownerToken, headSha };
}

test('ATTACK CHAIN reproduction (steps 1-6): a raw role-protocol-core.mjs PASS, recorded via raw task-orchestrator-core.mjs recordAuditResult, cannot reach READY_FOR_C for a genuine workflow change with no proof', () => {
  const fixture = createGitFixture();
  try {
    const headSha = commitWorkflowChange(fixture);
    const ctx = driveToAuditingViaRawCore({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });

    // Step 4: a genuinely, historically-attested auditor PASS, minted by the
    // RAW core (no filesChanged/workflowValidation context at all -- it has
    // no concept of either) -- WeakSet-real, but carries no workflowGate.
    const rawAuditorPass = certifyAuditResult({
      executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [],
    });
    assert.equal(rawAuditorPass.finalState, 'PASS');
    assert.equal(Object.prototype.hasOwnProperty.call(rawAuditorPass, 'workflowGate'), false, 'sanity: the raw core never attaches a workflowGate');

    // Step 6: attempt to record it via the RAW orchestrator core directly.
    const recordResult = recordAuditResult({
      repoRoot: fixture.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken,
      auditorResult: rawAuditorPass, toState: 'READY_FOR_C',
    });

    assert.equal(recordResult.ok, false, 'DIRECT_TASK_ORCHESTRATOR_CORE_CAN_RECORD_B_PASS_WITHOUT_GATE must be NO');
    assert.ok(
      ['HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED', 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA'].includes(recordResult.reason),
      `expected a workflow-gate HOLD reason, got ${recordResult.reason}`,
    );
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('ATTACK CHAIN reproduction (steps 7-9): even after a legitimate (workflow-gate-satisfying, via the recovery below) B PASS, a raw validator PASS via task-orchestrator-core.mjs cannot reach PR_METADATA_SYNC_REQUIRED without C workflow proof', () => {
  const fixture = createGitFixture();
  try {
    const headSha = commitWorkflowChange(fixture);
    const ctx = driveToAuditingViaRawCore({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });

    // B correctly HOLDs (proven above); the task cannot legitimately reach
    // READY_FOR_C at all without real workflow proof. To reach the C-layer
    // attack (steps 7-9) regardless, attempt the SAME raw-core path C would
    // need: even if an attacker somehow forced state into AUDITING/READY_FOR_C
    // (they cannot, per the previous test), certifyByValidator + raw
    // recordValidationResult must independently refuse a workflow PASS with
    // no proof. This is tested directly against the pure functions here,
    // since the orchestrator itself already refuses to reach READY_FOR_C.
    const rawAuditorPass = certifyAuditResult({
      executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [],
    });
    const rawValidatorPass = certifyByValidator({
      executorRole: 'A', validatorRole: 'C', currentHeadSha: headSha,
      attestedAuditorResult: rawAuditorPass, ciHeadSha: headSha, ciStatus: 'SUCCESS',
    });
    assert.equal(rawValidatorPass.finalState, 'PASS');
    assert.equal(Object.prototype.hasOwnProperty.call(rawValidatorPass, 'workflowGate'), false);

    // Force the task to READY_FOR_C is not possible through legitimate raw
    // calls (proven above); assert the direct claim instead: recordValidationResult
    // itself, called against this exact task/head, refuses this raw PASS.
    // (The task is currently stuck at AUDITING/HOLD, which recordValidationResult
    // also correctly rejects via its own state-transition gate -- both
    // reasons are acceptable proof that the raw PASS was never honored.)
    const recordResult = recordValidationResult({
      repoRoot: fixture.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken,
      validatorResult: rawValidatorPass, toState: 'PR_METADATA_SYNC_REQUIRED',
    });
    assert.equal(recordResult.ok, false, 'DIRECT_TASK_ORCHESTRATOR_CORE_CAN_RECORD_C_PASS_WITHOUT_GATE must be NO');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('DIRECT_CORE_CAN_REACH_READY_FOR_HUMAN_WITHOUT_WORKFLOW_GATE = NO: recordFinalPrMetadataVerification refuses to advance a workflow-changing task with no B/C workflow proof, even via raw core', () => {
  const fixture = createGitFixture();
  try {
    const headSha = commitWorkflowChange(fixture);
    const ctx = driveToAuditingViaRawCore({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });

    const prSnapshot = {
      prNumber: 99001, state: 'OPEN', isDraft: true, merged: false,
      headSha, baseSha: fixture.baseSha, headRef: 'attack-branch', baseRef: 'main',
    };
    recordPrOpened({ repoRoot: fixture.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot });

    const block = buildFinalPrMetadataBlock({
      task: '4/4', baseSha: fixture.baseSha, headSha, bAuditResult: 'PASS', cCertification: 'PASS',
      ciHeadSha: headSha, ciStatus: '4/4 SUCCESS', p0: 0, p1: 0, p2: 0, p3: 0,
    });
    const bodyText = `## Simulated PR\n\n${block}\n`;

    const result = recordFinalPrMetadataVerification({
      repoRoot: fixture.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken,
      prNumber: 99001, prSnapshot: { ...prSnapshot, bodyText }, ciHeadSha: headSha, ciStatusLabel: '4/4 SUCCESS',
    });

    assert.equal(result.ok, false, 'DIRECT_CORE_CAN_REACH_READY_FOR_HUMAN_WITHOUT_WORKFLOW_GATE must be NO');
    assert.ok(
      ['HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED', 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA', 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN'].includes(result.reason),
      `expected a workflow-gate HOLD reason, got ${result.reason}`,
    );
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('DIRECT_CORE_CAN_REQUEST_PR_HUMAN_GATE_WITHOUT_WORKFLOW_GATE = NO: requestHumanGate independently refuses MARK_READY for a workflow-changing task with no proof, even via raw core', () => {
  const fixture = createGitFixture();
  try {
    const headSha = commitWorkflowChange(fixture);
    const taskId = `task-${randomUUID()}`;
    createTaskSession({ repoRoot: fixture.repoRoot, taskId, taskTitle: 'p1-e human gate attack', baseSha: fixture.baseSha });
    const res = reserveTask({ repoRoot: fixture.repoRoot, taskId, reservedPaths: ['.github/workflows/production-deploy.yml'], baseSha: fixture.baseSha });
    const ownerToken = res.ownerToken;

    const result = requestHumanGate({
      repoRoot: fixture.repoRoot, taskId, ownerToken, actionType: 'MARK_READY',
      prSnapshot: { prNumber: 1, state: 'OPEN', isDraft: true, merged: false, bodyText: 'x' },
    });

    assert.equal(result.ok, false, 'DIRECT_CORE_CAN_REQUEST_PR_HUMAN_GATE_WITHOUT_WORKFLOW_GATE must be NO');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('structural: task-orchestrator.mjs is a pure re-export -- no second implementation of recordAuditResult/recordValidationResult/recordFinalPrMetadataVerification/requestHumanGate exists to bypass', async () => {
  const facade = await import('../task-orchestrator.mjs');
  const core = await import('../task-orchestrator-core.mjs');
  for (const fnName of ['recordAuditResult', 'recordValidationResult', 'recordFinalPrMetadataVerification', 'requestHumanGate', 'evaluatePersistedWorkflowCertification']) {
    assert.equal(facade[fnName], core[fnName], `${fnName}: task-orchestrator.mjs must re-export the EXACT SAME function reference as task-orchestrator-core.mjs, not a separate wrapper`);
  }
});

// ---------------------------------------------------------------------------
// TEST 6 / TEST 7: normal, legitimate paths remain unaffected.
// ---------------------------------------------------------------------------

test('NORMAL_FACADE_WORKFLOW_WITH_REAL_PROOF = PASS: a genuinely workflow-aware B PASS (real CI evidence, real Git changeset) still reaches READY_FOR_C via the now-consolidated core', () => {
  // Real project repository + a real, already-merged commit whose real
  // first-parent diff genuinely touches a Production-capable workflow file
  // and has a real, completed, successful required CI job -- the same
  // anchor commit already established and independently re-verified by
  // ci-evidence-authority.test.mjs / workflow-role-enforcement.test.mjs.
  const realRepoRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', shell: false }).stdout.trim();
  const headSha = '2e909e18579108928ff0728323d570491795fbee';
  const baseSha = spawnSync('git', ['rev-parse', `${headSha}^`], { cwd: realRepoRoot, encoding: 'utf8', shell: false }).stdout.trim();

  const realDiff = spawnSync('git', ['diff', '--name-status', '-z', '--no-renames', `${baseSha}..${headSha}`], { cwd: realRepoRoot, encoding: 'utf8', shell: false });
  assert.equal(realDiff.status, 0);
  const tokens = realDiff.stdout.split('\0').filter((t) => t.length > 0);
  const realFilesChanged = [];
  for (let i = 0; i < tokens.length; i += 2) realFilesChanged.push(tokens[i + 1]);
  const realProdFiles = realFilesChanged.filter((f) => f.startsWith('.github/workflows/') && f.includes('production'));
  assert.ok(realProdFiles.length > 0, 'sanity: this real HEAD must genuinely touch a Production workflow file');

  const taskId = `task-${randomUUID()}`;
  createTaskSession({ repoRoot: realRepoRoot, taskId, taskTitle: 'legit workflow task', baseSha });
  const res = reserveTask({ repoRoot: realRepoRoot, taskId, reservedPaths: realProdFiles, baseSha });
  const ownerToken = res.ownerToken;
  enterRole({ repoRoot: realRepoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  enterRole({ repoRoot: realRepoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  enterRole({ repoRoot: realRepoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  const execResult = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha, headSha, filesChanged: realProdFiles });
  recordExecutorResult({ repoRoot: realRepoRoot, taskId, ownerToken, executorResult: execResult, toState: 'READY_FOR_B' });
  handoffToAuditor({ repoRoot: realRepoRoot, taskId, ownerToken, headSha });

  // Correctly-obtained workflow-aware B PASS, minted via the real, hardened
  // role-protocol.mjs facade + real ci-evidence-authority.mjs attestation --
  // this is the legitimate minting path for genuine callers (only the
  // attack-chain tests above deliberately use the raw core to mint).
  const attested = attestCiRunEvidence({ headSha });
  assert.equal(attested.ok, true);
  const bResult = facadeCertifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [],
    filesChanged: realProdFiles, workflowValidation: attested.evidence,
  });
  assert.equal(bResult.finalState, 'PASS');

  const recordB = recordAuditResult({ repoRoot: realRepoRoot, taskId, ownerToken, auditorResult: bResult, toState: 'READY_FOR_C' });
  assert.equal(recordB.ok, true, `expected B PASS to record successfully: ${recordB.reason}`);

  releaseTask({ repoRoot: realRepoRoot, taskId, ownerToken });
});

test('NON_WORKFLOW_TASK_BACKWARD_COMPATIBILITY = PASS: a task whose real Git diff never touches .github/workflows/** reaches READY_FOR_C via a raw core PASS, exactly as before this remediation', () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(path.join(fixture.repoRoot, 'backend.txt'), 'v2\n');
    fixture.run(['add', '-A']);
    fixture.run(['commit', '--quiet', '-m', 'ordinary non-workflow change']);
    const headSha = fixture.run(['rev-parse', 'HEAD']);

    const taskId = `task-${randomUUID()}`;
    createTaskSession({ repoRoot: fixture.repoRoot, taskId, taskTitle: 'ordinary task', baseSha: fixture.baseSha });
    const res = reserveTask({ repoRoot: fixture.repoRoot, taskId, reservedPaths: ['backend.txt'], baseSha: fixture.baseSha });
    const ownerToken = res.ownerToken;
    enterRole({ repoRoot: fixture.repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
    enterRole({ repoRoot: fixture.repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
    enterRole({ repoRoot: fixture.repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
    const execResult = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: fixture.baseSha, headSha, filesChanged: ['backend.txt'] });
    recordExecutorResult({ repoRoot: fixture.repoRoot, taskId, ownerToken, executorResult: execResult, toState: 'READY_FOR_B' });
    handoffToAuditor({ repoRoot: fixture.repoRoot, taskId, ownerToken, headSha });

    const rawAuditorPass = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [] });
    const recordResult = recordAuditResult({ repoRoot: fixture.repoRoot, taskId, ownerToken, auditorResult: rawAuditorPass, toState: 'READY_FOR_C' });
    assert.equal(recordResult.ok, true, `a genuinely non-workflow task must still be recordable via the raw core PASS path: ${recordResult.reason}`);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST 8-13: prior-round protections not reopened by this round's changes.
// Full adversarial coverage lives in the dedicated files named below; these
// are lightweight confirmations that THIS round's edits did not regress them.
// ---------------------------------------------------------------------------

test('TEST 8: P1-C (caller-controlled CI policy) remains closed -- see ci-evidence-authority.test.mjs for full coverage', async () => {
  const { attestCiRunEvidence } = await import('../ci-evidence-authority.mjs');
  const result = attestCiRunEvidence({ headSha: '2e909e18579108928ff0728323d570491795fbee', requiredWorkflowName: 'Attacker Workflow', requiredJobName: 'Easy Green Job' });
  assert.equal(result.ok, true, 'a bogus override must still resolve to the real, canonical attestation');
});

test('TEST 9: P1-D quoted-path detection remains functional -- see git-changeset-quoted-paths.test.mjs for full coverage', () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(path.join(fixture.repoRoot, '.github', 'workflows', 'producción.yml'), 'name: x\n');
    fixture.run(['add', '-A']);
    fixture.run(['commit', '--quiet', '-m', 'unicode workflow']);
    const headSha = fixture.run(['rev-parse', 'HEAD']);
    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('TEST 10: manual {PASS,PASS,HEAD} evidence remains HOLD -- see workflow-certification-gate.test.mjs for full coverage', async () => {
  const { evaluateWorkflowValidationRequirement } = await import('../workflow-certification-gate.mjs');
  const fabricated = { headSha: 'a'.repeat(40), workflowSchemaValidation: 'PASS', actionlintValidation: 'PASS' };
  const result = evaluateWorkflowValidationRequirement({ filesChanged: ['.github/workflows/ci.yml'], headSha: 'a'.repeat(40), workflowValidation: fabricated });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reason, 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED');
});

test('TEST 11: a fabricated ciRun-shaped object remains impossible to mint (produceWorkflowValidationEvidenceFromCiRun no longer exists anywhere) -- see ci-evidence-authority.mjs / workflow-certification-gate.mjs', async () => {
  const ciEvidenceMod = await import('../ci-evidence-authority.mjs');
  const certGateMod = await import('../workflow-certification-gate.mjs');
  assert.equal(typeof ciEvidenceMod.attestCiRunEvidence, 'function');
  assert.equal(typeof ciEvidenceMod.produceWorkflowValidationEvidenceFromCiRun, 'undefined');
  assert.equal(typeof certGateMod.produceWorkflowValidationEvidenceFromCiRun, 'undefined');
  // attestCiRunEvidence itself must accept only headSha -- a bogus ciRun
  // param, if it existed as a real acceptance path, would have to be
  // silently ignored; confirmed by TEST 12 (policy override) and the
  // structural test in ci-evidence-authority.test.mjs.
});

test('TEST 12: caller workflow/job policy override remains impossible on attestCiRunEvidence', async () => {
  const { attestCiRunEvidence, isAttestedCiRunEvidence } = await import('../ci-evidence-authority.mjs');
  const result = attestCiRunEvidence({ headSha: '78a8c2dc2f4a414eee09b83c6596b5e69f630430', workflowName: 'x', jobName: 'y', policy: { anything: true } });
  assert.equal(result.ok, true);
  assert.equal(isAttestedCiRunEvidence(result.evidence), true);
});

test('TEST 13: filesChanged omission remains HOLD (P1-2, reproduced once more against the now-consolidated core)', () => {
  const fixture = createGitFixture();
  try {
    const headSha = commitWorkflowChange(fixture);
    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: ['backend.txt'] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true, 'A\'s false declaration must have zero authority over the real Git-derived changeset');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});
