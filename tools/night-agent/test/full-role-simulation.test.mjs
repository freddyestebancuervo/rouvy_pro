// Korixa — Common Agent Protocol (Task 5, 2026-08-23): FULL SYSTEM
// SIMULATION. Proves, through realistic synthetic execution against the
// REAL Task 1-4 primitives (never reimplemented here), that
// NIGHT -> A -> B -> C -> HUMAN_GATE and its adversarial/recovery paths
// behave correctly end-to-end.
//
// This file is a SIMULATION HARNESS, not a duplicate implementation: every
// scenario below calls task-orchestrator.mjs / task-lock.mjs /
// role-protocol.mjs / role-capabilities.mjs / protocol-state.mjs /
// queue.mjs functions directly. If a scenario's real primitive behaves
// unexpectedly, that is a Task 1-4 FINDING for Task 6 to remediate -- this
// file must never "fix" that behavior by weakening its own assertion.
//
// Per Task 5's own brief: assertions test the EXACT expected result, never
// merely "did not throw". No hand-typed object is ever treated as trusted
// evidence merely because its shape looks correct.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as orch from '../task-orchestrator.mjs';
import * as lockMod from '../task-lock.mjs';
import * as roleProto from '../role-protocol.mjs';
import { evaluateRoleCapability, CAPABILITIES, HUMAN_GATE_ONLY_CAPABILITIES } from '../role-capabilities.mjs';
import { ROLES, HUMAN_GATE_TYPES, resolveProtocolStatePath } from '../protocol-state.mjs';
import { validateSchema, findPathConflicts, findCycle } from '../queue.mjs';
import { buildFinalPrMetadataBlock } from '../pr-metadata-gate.mjs';

// T-F1.2 P1-2 remediation note: this whole file exercises the ORCHESTRATION
// state machine against synthetic repoRoot paths and synthetic SHAs -- by
// design, none of these scenarios touch .github/workflows/** or any real
// filesystem/Git state. The real deriveChangedFilesFromGit now REQUIRES a
// real, resolvable Git repository for every workflow-change decision; this
// explicit, visible test-only override tells the orchestrator that none of
// this file's synthetic tasks touch any file at all, which is true for all
// of them. See task-orchestrator.mjs's own header comment on
// __installTestGitChangesetProvider for why this seam exists and why it can
// never leak into real production use.
orch.__installTestGitChangesetProvider(() => ({ ok: true, files: [] }));

function fakeRepo() {
  return `/fake/repo-${randomUUID()}`;
}
const BASE_SHA = 'a'.repeat(40);
const HEAD_1 = 'b'.repeat(40);
const HEAD_2 = 'c'.repeat(40);
const HEAD_3 = 'd'.repeat(40);
const SIM_PR_NUMBER = 90001;

/**
 * Build a genuine, well-formed synthetic PR snapshot (Task 6) -- the exact
 * shape `recordFinalPrMetadataVerification` expects an externally-fetched
 * GitHub PR to have. `p0..p3` default to the counts already recorded on
 * `state.findings` when omitted, so callers rarely need to pass them.
 */
function buildSyntheticPrSnapshot({ prNumber = SIM_PR_NUMBER, baseSha, headSha, bAuditResult, cCertification, ciHeadSha, ciStatus = '4/4 SUCCESS', p0 = 0, p1 = 0, p2 = 0, p3 = 0 }) {
  const block = buildFinalPrMetadataBlock({
    task: '6/7', baseSha, headSha, bAuditResult, cCertification, ciHeadSha, ciStatus, p0, p1, p2, p3,
  });
  const bodyText = `## Simulated PR\n\nSynthetic Task 5/6 simulation body.\n\n${block}\n`;
  return { state: 'OPEN', isDraft: true, merged: false, prNumber, bodyText };
}

// ---------------------------------------------------------------------------
// SECTION 6 -- REQUIRED PRIMARY HAPPY-PATH SIMULATION
// ---------------------------------------------------------------------------

test('S6: happy path NIGHT -> A -> B -> C -> READY_FOR_HUMAN, via real orchestrator + role-protocol calls', () => {
  const repoRoot = fakeRepo();
  const taskId = `s6-${randomUUID()}`;

  // NIGHT -- Task 7 hotfix: prNumber=null at creation (a real PR cannot
  // exist before this point); bound later via recordPrOpened, once a real
  // HEAD exists, matching the system's own real chronology.
  const created = orch.createTaskSession({ repoRoot, taskId, taskTitle: 'Simulated happy path', baseSha: BASE_SHA, riskClass: 'GREEN', branch: 'feat/sim-happy-path' });
  assert.equal(created.ok, true);
  assert.equal(created.state.pr_number, null);
  const reserved = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/sim-fixture.mjs'], baseSha: BASE_SHA });
  assert.equal(reserved.ok, true);
  const ownerToken = reserved.ownerToken;
  assert.equal(typeof ownerToken, 'string');

  const p1 = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  assert.equal(p1.ok, true);
  assert.equal(p1.state.state, 'PLANNING');
  const p2 = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  assert.equal(p2.ok, true);

  // A
  const p3 = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  assert.equal(p3.ok, true);
  assert.equal(p3.state.active_role, 'A');
  const execResult = roleProto.finalizeExecutorResult({
    state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1,
    filesChanged: ['tools/night-agent/sim-fixture.mjs'], tests: { run: 3, pass: 3, fail: 0 },
  });
  assert.throws(() => roleProto.finalizeExecutorResult({ state: 'FINAL_PASS', executorRole: 'A', headSha: HEAD_1 }), roleProto.SelfCertificationForbiddenError, 'A must not be able to produce FINAL_PASS');
  const recExec = orch.recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: execResult, toState: 'READY_FOR_B' });
  assert.equal(recExec.ok, true);
  assert.equal(recExec.state.state, 'READY_FOR_B');
  assert.equal(recExec.state.head_sha, HEAD_1);

  // The Draft PR is created only NOW, after a real HEAD exists -- NIGHT binds identity:
  const bind = orch.recordPrOpened({
    repoRoot, taskId, ownerToken,
    prSnapshot: { prNumber: SIM_PR_NUMBER, state: 'OPEN', isDraft: true, merged: false, headSha: HEAD_1, baseSha: BASE_SHA, headRef: 'feat/sim-happy-path', baseRef: 'main' },
  });
  assert.equal(bind.ok, true);
  assert.equal(bind.state.pr_number, SIM_PR_NUMBER);

  // A -> B handoff
  const handoffB = orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  assert.equal(handoffB.ok, true);
  assert.equal(handoffB.state.state, 'AUDITING');

  // B -- TRUST_PREVIOUS_CONCLUSIONS = FALSE: independently re-derive, not trust A's claim
  const liveState = orch.getTaskState({ repoRoot, taskId });
  assert.equal(liveState.task_id, taskId);
  assert.equal(liveState.head_sha, HEAD_1);
  assert.equal(liveState.executor_result.state, 'IMPLEMENTED_AND_VALIDATED'); // B reads A's claim as a CLAIM, not truth
  const auditResult = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  assert.equal(roleProto.isAttestedAuditorResult(auditResult), true);
  const recAudit = orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: auditResult, toState: 'READY_FOR_C' });
  assert.equal(recAudit.ok, true);
  assert.equal(recAudit.state.state, 'READY_FOR_C');

  // B -> C handoff
  const handoffC = orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  assert.equal(handoffC.ok, true);
  assert.equal(handoffC.state.state, 'VALIDATING');

  // C -- independently re-verifies HEAD/attestation/CI, not trust B's prose
  const validatorResult = roleProto.certifyByValidator({
    executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1,
    attestedAuditorResult: auditResult, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS',
  });
  assert.equal(validatorResult.finalState, 'PASS');
  assert.equal(validatorResult.reason, 'CERTIFIED');
  const recVal = orch.recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult, toState: 'PR_METADATA_SYNC_REQUIRED' });
  assert.equal(recVal.ok, true);
  assert.equal(recVal.state.state, 'PR_METADATA_SYNC_REQUIRED');

  // Task 6: C_PASS does not directly imply READY_FOR_HUMAN -- MARK_READY must
  // be denied until the final PR metadata gate genuinely passes.
  const gateTooEarly = orch.requestHumanGate({ repoRoot, taskId, ownerToken, actionType: 'MARK_READY' });
  assert.equal(gateTooEarly.ok, false);
  assert.equal(gateTooEarly.reason, 'PR_METADATA_VERIFICATION_MISSING');

  const snapshot = buildSyntheticPrSnapshot({ baseSha: BASE_SHA, headSha: HEAD_1, bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: HEAD_1 });
  const metaResult = orch.recordFinalPrMetadataVerification({ repoRoot, taskId, ownerToken, prNumber: SIM_PR_NUMBER, prSnapshot: snapshot, ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });
  assert.equal(metaResult.ok, true);
  assert.equal(metaResult.verified, true);
  assert.equal(metaResult.state.state, 'READY_FOR_HUMAN');
  assert.notEqual(metaResult.state.pr_metadata_verification, null);
  assert.equal(metaResult.state.pr_metadata_verification.head_sha, HEAD_1);

  // STOP before any real human-gated action.
  const gate = orch.requestHumanGate({ repoRoot, taskId, ownerToken, actionType: 'MARK_READY', prSnapshot: snapshot });
  assert.equal(gate.ok, true);
  assert.equal(gate.humanGateRequired, true);
  assert.equal(gate.actionExecuted, false);
  const finalState = orch.getTaskState({ repoRoot, taskId });
  assert.equal(finalState.state, 'READY_FOR_HUMAN'); // never silently advances to DONE/merged
  assert.notEqual(finalState.state, 'DONE');

  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 7 -- REMEDIATION LOOP: B HOLD -> A -> B (delta only) -> C
// ---------------------------------------------------------------------------

test('S7: B HOLD -> A remediation (OLD_HEAD..NEW_HEAD) -> B re-audit -> C PASS', () => {
  const repoRoot = fakeRepo();
  const taskId = `s7-${randomUUID()}`;
  orch.createTaskSession({ repoRoot, taskId, taskTitle: 'Simulated remediation loop', baseSha: BASE_SHA, branch: 'feat/sim-remediation' });
  const reserved = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/sim-remediation.mjs'], baseSha: BASE_SHA });
  const ownerToken = reserved.ownerToken;
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });

  const exec1 = roleProto.finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  orch.recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: exec1, toState: 'READY_FOR_B' });
  // Draft PR created only now, after a real HEAD exists:
  const bind = orch.recordPrOpened({
    repoRoot, taskId, ownerToken,
    prSnapshot: { prNumber: SIM_PR_NUMBER, state: 'OPEN', isDraft: true, merged: false, headSha: HEAD_1, baseSha: BASE_SHA, headRef: 'feat/sim-remediation', baseRef: 'main' },
  });
  assert.equal(bind.ok, true);
  orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });

  // B discovers a synthetic blocking finding.
  const holdResult = roleProto.certifyAuditResult({
    executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS',
    findings: [{ id: 'sim-finding-1', severity: 'P0', summary: 'synthetic blocking finding for Task 5 simulation' }],
  });
  assert.equal(holdResult.finalState, 'HOLD');
  assert.equal(holdResult.reason, 'HOLD_BLOCKING_FINDING');
  const recHold = orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: holdResult, toState: 'HOLD' });
  assert.equal(recHold.ok, true);
  assert.equal(recHold.state.state, 'HOLD');

  // B -> A (remediation)
  const remediate = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'REMEDIATING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES', headSha: HEAD_1 });
  assert.equal(remediate.ok, true);
  assert.equal(remediate.state.state, 'REMEDIATING');

  // A performs synthetic remediation only -- produces NEW_HEAD.
  const OLD_HEAD = HEAD_1;
  const NEW_HEAD = HEAD_2;
  const exec2 = roleProto.finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: NEW_HEAD, filesChanged: ['tools/night-agent/sim-remediation.mjs'] });
  const recExec2 = orch.recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: exec2, toState: 'READY_FOR_B' });
  assert.equal(recExec2.ok, true);
  assert.equal(recExec2.state.head_sha, NEW_HEAD);
  assert.equal(recExec2.state.previous_head_sha, OLD_HEAD);

  // A -> B re-audit, bound to NEW_HEAD (delta-only, not the whole original scope)
  const rehandoff = orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: NEW_HEAD });
  assert.equal(rehandoff.ok, true);
  // proves the audit is bound to the delta head, not stale OLD_HEAD:
  const staleAttempt = orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: OLD_HEAD });
  assert.equal(staleAttempt.ok, false, 'auditing against the stale OLD_HEAD after remediation must be rejected');

  const cleanAudit = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: NEW_HEAD, requestedState: 'PASS', findings: [] });
  assert.equal(cleanAudit.finalState, 'PASS');
  const recCleanAudit = orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: cleanAudit, toState: 'READY_FOR_C' });
  assert.equal(recCleanAudit.ok, true);

  orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: NEW_HEAD });
  const validatorResult = roleProto.certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: NEW_HEAD, attestedAuditorResult: cleanAudit, ciHeadSha: NEW_HEAD, ciStatus: 'SUCCESS' });
  assert.equal(validatorResult.finalState, 'PASS');
  const recVal = orch.recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult, toState: 'PR_METADATA_SYNC_REQUIRED' });
  assert.equal(recVal.ok, true);
  assert.equal(recVal.state.state, 'PR_METADATA_SYNC_REQUIRED');
  assert.equal(recVal.state.head_sha, NEW_HEAD);

  // Task 6: final metadata gate, bound to NEW_HEAD (a snapshot still
  // claiming OLD_HEAD in its canonical block must be rejected).
  const staleSnapshot = buildSyntheticPrSnapshot({ baseSha: BASE_SHA, headSha: OLD_HEAD, bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: OLD_HEAD });
  const staleMeta = orch.recordFinalPrMetadataVerification({ repoRoot, taskId, ownerToken, prNumber: SIM_PR_NUMBER, prSnapshot: staleSnapshot, ciHeadSha: NEW_HEAD, ciStatusLabel: '4/4 SUCCESS' });
  assert.equal(staleMeta.ok, true);
  assert.equal(staleMeta.verified, false, 'a PR body still claiming the OLD_HEAD after remediation must fail the metadata gate');
  assert.equal(staleMeta.state.state, 'HOLD');

  // recover: the underlying B/C work was genuinely fine -- only the PR BODY
  // TEXT was stale -- so NIGHT routes this HOLD directly to READY_FOR_B
  // (skipping A), exactly Task 2's own established attestation-recovery
  // pattern (see S15), reused here for a metadata-only staleness cause.
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_B', actingRole: 'NIGHT', requiredCapability: 'READ', headSha: NEW_HEAD });
  orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: NEW_HEAD });
  const reaudit = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: NEW_HEAD, requestedState: 'PASS', findings: [] });
  orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: reaudit, toState: 'READY_FOR_C' });
  orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: NEW_HEAD });
  const revalidation = roleProto.certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: NEW_HEAD, attestedAuditorResult: reaudit, ciHeadSha: NEW_HEAD, ciStatus: 'SUCCESS' });
  orch.recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult: revalidation, toState: 'PR_METADATA_SYNC_REQUIRED' });

  const correctSnapshot = buildSyntheticPrSnapshot({ baseSha: BASE_SHA, headSha: NEW_HEAD, bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: NEW_HEAD });
  const finalMeta = orch.recordFinalPrMetadataVerification({ repoRoot, taskId, ownerToken, prNumber: SIM_PR_NUMBER, prSnapshot: correctSnapshot, ciHeadSha: NEW_HEAD, ciStatusLabel: '4/4 SUCCESS' });
  assert.equal(finalMeta.ok, true);
  assert.equal(finalMeta.verified, true);
  assert.equal(finalMeta.state.state, 'READY_FOR_HUMAN');
  assert.equal(finalMeta.state.head_sha, NEW_HEAD);

  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 8 -- WAITING_CI SIMULATION (3 cases, no polling)
// ---------------------------------------------------------------------------

function setupToWaitingCi(repoRoot, taskId, headSha = BASE_SHA) {
  orch.createTaskSession({ repoRoot, taskId, taskTitle: 'sim-ci', baseSha: BASE_SHA });
  const reserved = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/sim-ci.mjs'], baseSha: BASE_SHA });
  const ownerToken = reserved.ownerToken;
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  const wait = orch.enterWaitingCi({ repoRoot, taskId, ownerToken, ciRun: 999, headSha });
  assert.equal(wait.ok, true);
  assert.equal(wait.state.state, 'WAITING_CI');
  return ownerToken;
}

test('S8-A: WAITING_CI resumes -> READY_FOR_B when CI completed SUCCESS on the SAME head', () => {
  const repoRoot = fakeRepo();
  const taskId = `s8a-${randomUUID()}`;
  const ownerToken = setupToWaitingCi(repoRoot, taskId, BASE_SHA);

  // persisted, single-process-lifetime state -- simulate a later resume by re-reading it fresh
  const persisted = orch.getTaskState({ repoRoot, taskId });
  assert.equal(persisted.state, 'WAITING_CI');
  assert.equal(persisted.task_id, taskId);

  const ownershipCheck = lockMod.verifyTaskLockOwnership({ repoRoot, taskId, ownerToken });
  assert.equal(ownershipCheck.valid, true, 'resume must re-verify ownership, not assume it');

  const resumed = orch.resumeFromWaitingCi({ repoRoot, taskId, ownerToken, ciHeadSha: BASE_SHA, ciStatus: { status: 'completed', conclusion: 'success' } });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.ciClassification, 'SUCCESS');
  assert.equal(resumed.state.state, 'READY_FOR_B');
  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

test('S8-B: WAITING_CI resume with CI success on a DIFFERENT head -> fail-closed HOLD_HEAD_DRIFT (not silently accepted)', () => {
  const repoRoot = fakeRepo();
  const taskId = `s8b-${randomUUID()}`;
  const ownerToken = setupToWaitingCi(repoRoot, taskId, BASE_SHA);

  const resumed = orch.resumeFromWaitingCi({ repoRoot, taskId, ownerToken, ciHeadSha: HEAD_2, ciStatus: { status: 'completed', conclusion: 'success' } });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.reason, 'HOLD_HEAD_DRIFT');
  const state = orch.getTaskState({ repoRoot, taskId });
  assert.equal(state.state, 'WAITING_CI', 'a SHA-mismatched CI success must never move the task out of WAITING_CI');
  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

test('S8-C: WAITING_CI resume with CI still pending -> stays WAITING_CI, single check, no loop', () => {
  const repoRoot = fakeRepo();
  const taskId = `s8c-${randomUUID()}`;
  const ownerToken = setupToWaitingCi(repoRoot, taskId, BASE_SHA);

  const resumed = orch.resumeFromWaitingCi({ repoRoot, taskId, ownerToken, ciHeadSha: BASE_SHA, ciStatus: { status: 'in_progress' } });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.ciClassification, 'WAITING_CI');
  assert.equal(resumed.state.state, 'WAITING_CI');
  // the function itself contains no loop/timer -- verified structurally: resumeFromWaitingCi
  // returns synchronously with a single classification, confirmed by this call itself
  // returning immediately with a decision rather than blocking.
  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 9 -- LOCK / MULTI-TASK SIMULATION (5 scenarios)
// ---------------------------------------------------------------------------

test('S9: full lock/multi-task scenario set (Alpha/Beta)', () => {
  const repoRoot = fakeRepo();
  orch.createTaskSession({ repoRoot, taskId: 'alpha', taskTitle: 'Alpha', baseSha: BASE_SHA });
  orch.createTaskSession({ repoRoot, taskId: 'beta', taskTitle: 'Beta', baseSha: BASE_SHA });

  // Scenario 1: Alpha reserves scope A; Beta tries an OVERLAPPING scope -> DENY.
  const alpha = orch.reserveTask({ repoRoot, taskId: 'alpha', reservedPaths: ['tools/night-agent/shared-scope.mjs'], baseSha: BASE_SHA });
  assert.equal(alpha.ok, true);
  const betaOverlap = orch.reserveTask({ repoRoot, taskId: 'beta', reservedPaths: ['tools/night-agent/shared-scope.mjs'], baseSha: BASE_SHA });
  assert.equal(betaOverlap.ok, false);
  assert.ok(betaOverlap.reason === 'RUNTIME_RESERVATION_CONFLICT' || betaOverlap.reason === 'ACTIVE_TASK_SLOT_HELD');

  // Scenario 2: Beta tries to become active (non-overlapping scope) while Alpha holds the single active-task slot -> DENY.
  const betaNonOverlap = orch.reserveTask({ repoRoot, taskId: 'beta', reservedPaths: ['tools/night-agent/beta-only-scope.mjs'], baseSha: BASE_SHA });
  assert.equal(betaNonOverlap.ok, false);
  assert.equal(betaNonOverlap.reason, 'ACTIVE_TASK_SLOT_HELD');

  // Scenario 3: wrong ownership token tries to release Alpha -> DENY.
  const wrongRelease = orch.releaseTask({ repoRoot, taskId: 'alpha', ownerToken: 'not-alphas-real-token' });
  assert.equal(wrongRelease.ok, false);
  const stillOwned = lockMod.verifyTaskLockOwnership({ repoRoot, taskId: 'alpha', ownerToken: alpha.ownerToken });
  assert.equal(stillOwned.valid, true, 'a failed wrong-owner release attempt must not have disturbed the real lock');

  // Scenario 4: correct owner releases Alpha after completion -> SUCCESS.
  const correctRelease = orch.releaseTask({ repoRoot, taskId: 'alpha', ownerToken: alpha.ownerToken });
  assert.equal(correctRelease.ok, true);

  // Scenario 5: after Alpha is released, Beta may become the next active task -> SUCCESS.
  const betaAfter = orch.reserveTask({ repoRoot, taskId: 'beta', reservedPaths: ['tools/night-agent/beta-only-scope.mjs'], baseSha: BASE_SHA });
  assert.equal(betaAfter.ok, true);
  orch.releaseTask({ repoRoot, taskId: 'beta', ownerToken: betaAfter.ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 10 -- HUMAN-GATE SIMULATION: all 6 HUMAN_GATE_ONLY_CAPABILITIES x
// all 4 roles must fail closed, unconditionally.
// ---------------------------------------------------------------------------

test('S10: HUMAN_GATE-only capabilities are denied to every role, every combination (24 checks)', () => {
  let checked = 0;
  for (const role of ROLES) {
    for (const capability of HUMAN_GATE_ONLY_CAPABILITIES) {
      const decision = evaluateRoleCapability(role, capability);
      assert.equal(decision.allowed, false, `${role} must never be granted ${capability}`);
      assert.equal(decision.humanGateRequired, true);
      checked += 1;
    }
  }
  assert.equal(checked, ROLES.length * HUMAN_GATE_ONLY_CAPABILITIES.length);
  assert.equal(ROLES.length, 4);
  assert.equal(HUMAN_GATE_ONLY_CAPABILITIES.length, 6);
});

test('S10-b: C PASS never implies READY/MERGE/PRODUCTION authorization -- requestHumanGate only records, never executes; Task 6 additionally requires a genuine PR metadata verification for MARK_READY/MERGE specifically', () => {
  const repoRoot = fakeRepo();
  const taskId = `s10b-${randomUUID()}`;
  orch.createTaskSession({ repoRoot, taskId, taskTitle: 'x', baseSha: BASE_SHA });
  const reserved = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/s10b.mjs'], baseSha: BASE_SHA });
  const ownerToken = reserved.ownerToken;

  // Not PR-readiness actions: still succeed unconditionally, from ANY state --
  // PR body sync is unrelated to Production/IAM/secret/destructive gates.
  for (const actionType of ['PRODUCTION_ACTION', 'IAM_OR_SECRET_ACTION', 'DESTRUCTIVE_ACTION', 'UNKNOWN_COMMAND_CLASS']) {
    const r = orch.requestHumanGate({ repoRoot, taskId, ownerToken, actionType });
    assert.equal(r.ok, true);
    assert.equal(r.humanGateRequired, true, `${actionType} must always require a human gate`);
    assert.equal(r.actionExecuted, false);
    const state = orch.getTaskState({ repoRoot, taskId });
    assert.notEqual(state.state, 'DONE');
  }

  // PR-readiness actions: denied while the task has not genuinely reached
  // READY_FOR_HUMAN with a valid metadata verification (still in IDLE here).
  for (const actionType of ['MARK_READY', 'MERGE']) {
    const r = orch.requestHumanGate({ repoRoot, taskId, ownerToken, actionType });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'PR_METADATA_VERIFICATION_MISSING');
  }

  const bogus = orch.requestHumanGate({ repoRoot, taskId, ownerToken, actionType: 'SOMETHING_NOT_IN_THE_CLOSED_SET' });
  assert.equal(bogus.ok, false);
  assert.equal(bogus.reason, 'UNKNOWN_ACTION_TYPE');
  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 11 -- ROLE-BYPASS ATTACKS
// ---------------------------------------------------------------------------

test('S11: role-bypass attack matrix', () => {
  const repoRoot = fakeRepo();
  const taskId = `s11-${randomUUID()}`;
  orch.createTaskSession({ repoRoot, taskId, taskTitle: 'x', baseSha: BASE_SHA });
  const reserved = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/s11.mjs'], baseSha: BASE_SHA });
  const ownerToken = reserved.ownerToken;
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });

  // A -> C directly
  assert.equal(orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: BASE_SHA }).ok, false);
  // A -> HUMAN_GATE directly: no such capability exists for A to invoke a human-gated action itself
  assert.equal(evaluateRoleCapability('A', 'MARK_READY').allowed, false);
  // A self-certification (via role-protocol's own domain, and via role-capabilities)
  assert.throws(() => roleProto.finalizeExecutorResult({ state: 'AUDIT_PASS', executorRole: 'A' }), roleProto.SelfCertificationForbiddenError);
  assert.equal(evaluateRoleCapability('A', 'CERTIFY_AUDIT').allowed, false);
  assert.equal(evaluateRoleCapability('A', 'CERTIFY_TECHNICAL_PASS').allowed, false);

  const exec1 = roleProto.finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  orch.recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: exec1, toState: 'READY_FOR_B' });
  orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });

  // B -> WRITE_TASK_FILES / COMMIT_TASK_BRANCH / CERTIFY_TECHNICAL_PASS / MERGE
  assert.equal(evaluateRoleCapability('B', 'WRITE_TASK_FILES').allowed, false);
  assert.equal(evaluateRoleCapability('B', 'COMMIT_TASK_BRANCH').allowed, false);
  assert.equal(evaluateRoleCapability('B', 'CERTIFY_TECHNICAL_PASS').allowed, false);
  assert.equal(evaluateRoleCapability('B', 'MERGE_MAIN').allowed, false);
  const bEnterExecuting = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'B', requiredCapability: 'WRITE_TASK_FILES', headSha: HEAD_1 });
  assert.equal(bEnterExecuting.ok, false);

  const passAudit = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: passAudit, toState: 'READY_FOR_C' });
  orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });

  // C -> WRITE_TASK_FILES / COMMIT_TASK_BRANCH / CERTIFY_AUDIT / MERGE
  assert.equal(evaluateRoleCapability('C', 'WRITE_TASK_FILES').allowed, false);
  assert.equal(evaluateRoleCapability('C', 'COMMIT_TASK_BRANCH').allowed, false);
  assert.equal(evaluateRoleCapability('C', 'CERTIFY_AUDIT').allowed, false);
  assert.equal(evaluateRoleCapability('C', 'MERGE_MAIN').allowed, false);
  const cEnterAuditing = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'AUDITING', actingRole: 'C', requiredCapability: 'AUDIT', headSha: HEAD_1 });
  assert.equal(cEnterAuditing.ok, false);

  // NIGHT -> task file mutation / MERGE
  assert.equal(evaluateRoleCapability('NIGHT', 'WRITE_TASK_FILES').allowed, false);
  assert.equal(evaluateRoleCapability('NIGHT', 'MERGE_MAIN').allowed, false);

  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 12 -- IDENTITY ADVERSARIAL TESTS
// ---------------------------------------------------------------------------

test('S12: malformed role identities all fail closed, no normalization', () => {
  const malformedRoles = ['a', ' A', 'A ', 'A​', 'Ｂ', null, undefined, {}, [], 'NIGHT2', 'unknown-role', '__proto__', 'constructor'];
  for (const role of malformedRoles) {
    const decision = evaluateRoleCapability(role, 'READ');
    assert.equal(decision.allowed, false, `role ${JSON.stringify(role)} must be denied`);
    assert.equal(decision.reason, 'UNKNOWN_ROLE');
  }
});

test('S12-b: malformed capability names all fail closed', () => {
  const malformedCaps = ['read', 'Read', ' READ', 'READ ', 'WRITE_TASKFILES', 'CERTIFY_AUDITS', null, undefined, {}, [], 42];
  for (const capability of malformedCaps) {
    const decision = evaluateRoleCapability('A', capability);
    assert.equal(decision.allowed, false, `capability ${JSON.stringify(capability)} must be denied`);
    assert.equal(decision.reason, 'UNKNOWN_CAPABILITY');
  }
});

// ---------------------------------------------------------------------------
// SECTION 13 -- HANDOFF ATTACKS
// ---------------------------------------------------------------------------

test('S13: handoff attack matrix', () => {
  const repoRoot = fakeRepo();
  const taskIdReal = `s13-real-${randomUUID()}`;
  const taskIdOther = `s13-other-${randomUUID()}`;
  orch.createTaskSession({ repoRoot, taskId: taskIdReal, taskTitle: 'real', baseSha: BASE_SHA });
  orch.createTaskSession({ repoRoot, taskId: taskIdOther, taskTitle: 'other', baseSha: BASE_SHA });
  const realRes = orch.reserveTask({ repoRoot, taskId: taskIdReal, reservedPaths: ['tools/night-agent/s13-real.mjs'], baseSha: BASE_SHA });
  const ownerToken = realRes.ownerToken;
  orch.enterRole({ repoRoot, taskId: taskIdReal, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId: taskIdReal, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId: taskIdReal, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  const exec1 = roleProto.finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  orch.recordExecutorResult({ repoRoot, taskId: taskIdReal, ownerToken, executorResult: exec1, toState: 'READY_FOR_B' });

  // wrong TASK_ID: the real ownerToken does not match taskIdOther's (nonexistent) lock
  assert.equal(orch.handoffToAuditor({ repoRoot, taskId: taskIdOther, ownerToken, headSha: HEAD_1 }).ok, false);
  // wrong HEAD_SHA (stale)
  assert.equal(orch.handoffToAuditor({ repoRoot, taskId: taskIdReal, ownerToken, headSha: BASE_SHA }).ok, false);
  // handoff from a role that is not the required acting role for this transition
  assert.equal(orch.enterRole({ repoRoot, taskId: taskIdReal, ownerToken, toState: 'AUDITING', actingRole: 'C', requiredCapability: 'AUDIT', headSha: HEAD_1 }).ok, false);

  // real handoff
  const realHandoff = orch.handoffToAuditor({ repoRoot, taskId: taskIdReal, ownerToken, headSha: HEAD_1 });
  assert.equal(realHandoff.ok, true);

  // fabricated B result (hand-typed, PASS-shaped, but never produced by certifyAuditResult)
  const fabricated = { role: 'auditor', executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', independent: true, findings: [], evidence: { results: [], anyHold: false, holdReasons: [] }, finalState: 'PASS', reason: 'REQUESTED_STATE_GRANTED' };
  assert.equal(roleProto.isAttestedAuditorResult(fabricated), false);
  const fabricatedAttempt = orch.recordAuditResult({ repoRoot, taskId: taskIdReal, ownerToken, auditorResult: fabricated, toState: 'READY_FOR_C' });
  assert.equal(fabricatedAttempt.ok, false);
  assert.equal(fabricatedAttempt.reason, 'UNATTESTED_AUDITOR_RESULT');

  // serialized lookalike (real result JSON round-tripped -- loses WeakSet identity)
  const real = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  const serializedLookalike = JSON.parse(JSON.stringify(real));
  assert.equal(roleProto.isAttestedAuditorResult(serializedLookalike), false);
  const lookalikeAttempt = orch.recordAuditResult({ repoRoot, taskId: taskIdReal, ownerToken, auditorResult: serializedLookalike, toState: 'READY_FOR_C' });
  assert.equal(lookalikeAttempt.ok, false);
  assert.equal(lookalikeAttempt.reason, 'UNATTESTED_AUDITOR_RESULT');

  // missing required field / extra unexpected field on a handoff envelope (role-protocol.mjs's own contract)
  const envelopeMissingField = { taskId: taskIdReal, from: 'A', to: 'B', baseSha: BASE_SHA }; // missing headSha
  assert.equal(roleProto.validateHandoffEnvelope(envelopeMissingField).valid, false);
  const envelopeExtraField = { taskId: taskIdReal, from: 'A', to: 'B', baseSha: BASE_SHA, headSha: HEAD_1, SMUGGLED_FIELD: 'x' };
  assert.equal(roleProto.validateHandoffEnvelope(envelopeExtraField).valid, false);

  // the REAL result, recorded correctly, must succeed (proves the rejections above weren't just "everything fails")
  const recReal = orch.recordAuditResult({ repoRoot, taskId: taskIdReal, ownerToken, auditorResult: real, toState: 'READY_FOR_C' });
  assert.equal(recReal.ok, true);

  orch.releaseTask({ repoRoot, taskId: taskIdReal, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 14 -- EVIDENCE / SHA SIMULATION
// ---------------------------------------------------------------------------

test('S14: evidence bound to HEAD_1 is not reusable as proof for HEAD_2; same-SHA reuse remains valid', () => {
  assert.equal(orch.isEvidenceReusable({ evidenceHeadSha: HEAD_1, currentHeadSha: HEAD_2 }), false);
  assert.equal(orch.isEvidenceReusable({ evidenceHeadSha: HEAD_1, currentHeadSha: HEAD_1 }), true);
  assert.equal(orch.isEvidenceReusable({ evidenceHeadSha: '', currentHeadSha: HEAD_1 }), false);
  assert.equal(orch.isEvidenceReusable({ evidenceHeadSha: HEAD_1, currentHeadSha: '' }), false);
  assert.equal(orch.isEvidenceReusable({ evidenceHeadSha: null, currentHeadSha: null }), false);
});

// ---------------------------------------------------------------------------
// SECTION 15 -- AUDIT-ATTESTATION EXPIRY RECOVERY
// ---------------------------------------------------------------------------

test('S15: attestation-expired recovery -- persisted-lookalike B result is refused by C, NIGHT routes HOLD->READY_FOR_B, genuine re-attestation then succeeds', () => {
  const repoRoot = fakeRepo();
  const taskId = `s15-${randomUUID()}`;
  orch.createTaskSession({ repoRoot, taskId, taskTitle: 'x', baseSha: BASE_SHA, branch: 'feat/sim-s15' });
  const reserved = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/s15.mjs'], baseSha: BASE_SHA });
  const ownerToken = reserved.ownerToken;
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  const exec1 = roleProto.finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  orch.recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: exec1, toState: 'READY_FOR_B' });
  const bind = orch.recordPrOpened({
    repoRoot, taskId, ownerToken,
    prSnapshot: { prNumber: SIM_PR_NUMBER, state: 'OPEN', isDraft: true, merged: false, headSha: HEAD_1, baseSha: BASE_SHA, headRef: 'feat/sim-s15', baseRef: 'main' },
  });
  assert.equal(bind.ok, true);
  orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });

  // A legitimate B result is produced (live, attested) and RECORDED FOR REAL
  // -- the real flow: B's PASS genuinely moves the task to READY_FOR_C, and
  // the task then genuinely hands off to C (VALIDATING). This is the
  // faithful precondition for an attestation-expiry scenario: C is the one
  // who ends up looking at a non-live copy, not a role that skipped ahead.
  const legitimateResult = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  assert.equal(roleProto.isAttestedAuditorResult(legitimateResult), true);
  const recLegit = orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: legitimateResult, toState: 'READY_FOR_C' });
  assert.equal(recLegit.ok, true);
  const handoffLegit = orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  assert.equal(handoffLegit.ok, true);

  // Simulate the process-boundary loss of live WeakSet attestation using the
  // SYSTEM'S OWN real persistence mechanism: protocol-state.mjs's
  // readProtocolState always JSON.parses the file on disk, so re-reading the
  // task's own persisted state (exactly what a resumed chat/process would
  // do) naturally yields a auditor_result object with a NEW identity --
  // shape-identical, but never the live one certifyAuditResult returned.
  const reloadedState = orch.getTaskState({ repoRoot, taskId });
  const reloadedAfterProcessBoundary = reloadedState.auditor_result;
  assert.notEqual(reloadedAfterProcessBoundary, legitimateResult, 'the reloaded object must be a distinct identity from the live one');
  assert.equal(roleProto.isAttestedAuditorResult(reloadedAfterProcessBoundary), false);
  const trust = roleProto.classifyAuditorResultTrust(reloadedAfterProcessBoundary);
  assert.equal(trust, 'PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION');

  // C does NOT pass on this reloaded object -- classification is HOLD_AUDIT_ATTESTATION_EXPIRED.
  const cAttempt = roleProto.certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: reloadedAfterProcessBoundary, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS' });
  assert.equal(cAttempt.finalState, 'HOLD');
  assert.equal(cAttempt.reason, 'HOLD_AUDIT_ATTESTATION_EXPIRED');
  const orchAttempt = orch.recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult: cAttempt, toState: 'HOLD' });
  assert.equal(orchAttempt.ok, true); // recording the HOLD itself is fine (VALIDATING -> HOLD is a legal C move)
  assert.equal(orch.getTaskState({ repoRoot, taskId }).state, 'HOLD');

  // recovery: NIGHT (only NIGHT) routes HOLD -> READY_FOR_B directly, skipping A.
  const wrongRoleRecovery = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_B', actingRole: 'A', requiredCapability: 'READ', headSha: HEAD_1 });
  assert.equal(wrongRoleRecovery.ok, false, 'only NIGHT may perform this specific HOLD->READY_FOR_B recovery transition');
  const recovery = orch.enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_B', actingRole: 'NIGHT', requiredCapability: 'READ', headSha: HEAD_1 });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.state.state, 'READY_FOR_B');

  // B genuinely re-observes and re-attests (a REAL call, not a persisted reuse).
  const handoffAgain = orch.handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  assert.equal(handoffAgain.ok, true);
  const freshAttestation = roleProto.certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  assert.equal(roleProto.isAttestedAuditorResult(freshAttestation), true);
  const recFresh = orch.recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: freshAttestation, toState: 'READY_FOR_C' });
  assert.equal(recFresh.ok, true);

  // C may now pass, only after the fresh, real attestation.
  orch.handoffToValidator({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  const finalCPass = roleProto.certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: freshAttestation, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS' });
  assert.equal(finalCPass.finalState, 'PASS');
  const recFinal = orch.recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult: finalCPass, toState: 'PR_METADATA_SYNC_REQUIRED' });
  assert.equal(recFinal.ok, true);
  assert.equal(recFinal.state.state, 'PR_METADATA_SYNC_REQUIRED');

  // Task 6: a technical C PASS still isn't READY_FOR_HUMAN until the final
  // PR metadata gate genuinely passes too -- both attestation recovery
  // (Task 2) and metadata sync (Task 6) must hold for the task to reach it.
  const snapshot = buildSyntheticPrSnapshot({ baseSha: BASE_SHA, headSha: HEAD_1, bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: HEAD_1 });
  const metaResult = orch.recordFinalPrMetadataVerification({ repoRoot, taskId, ownerToken, prNumber: SIM_PR_NUMBER, prSnapshot: snapshot, ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });
  assert.equal(metaResult.ok, true);
  assert.equal(metaResult.verified, true);
  assert.equal(metaResult.state.state, 'READY_FOR_HUMAN');

  orch.releaseTask({ repoRoot, taskId, ownerToken });
});

// ---------------------------------------------------------------------------
// SECTION 16 -- CORRUPTION / RECOVERY SIMULATION
// ---------------------------------------------------------------------------

test('S16: corrupt protocol state, task lock, and active-task slot all fail closed, never treated as safe-to-proceed', () => {
  // corrupt protocol state
  {
    const repoRoot = fakeRepo();
    const taskId = 'corrupt-protocol-state';
    orch.createTaskSession({ repoRoot, taskId, taskTitle: 'x', baseSha: BASE_SHA });
    const p = resolveProtocolStatePath({ repoRoot, taskId });
    writeFileSync(p, 'NOT VALID JSON {{{', 'utf8');
    assert.equal(orch.getTaskState({ repoRoot, taskId }), null);
    const r = orch.reserveTask({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'NO_TASK_SESSION');
  }
  // corrupt task lock (for the acquiring task itself)
  {
    const repoRoot = fakeRepo();
    const taskId = 'corrupt-task-lock';
    const lockPath = lockMod.resolveTaskLockPath({ repoRoot, taskId });
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, 'CORRUPT', 'utf8');
    const acq = lockMod.acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
    assert.equal(acq.ok, false);
    assert.equal(acq.reason, 'HOLD_LOCK_RECOVERY_REQUIRED');
  }
  // corrupt active-task slot
  {
    const repoRoot = fakeRepo();
    const dir = lockMod.resolveTaskLockDir({ repoRoot });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'active-task-slot.json'), 'CORRUPT', 'utf8');
    const acq = lockMod.acquireActiveTaskSlot({ repoRoot, taskId: 'any-task' });
    assert.equal(acq.ok, false);
    assert.equal(acq.reason, 'HOLD_LOCK_RECOVERY_REQUIRED');
  }
  // corrupt handoff data
  {
    const corruptEnvelope = 'not-even-an-object';
    assert.equal(roleProto.validateHandoffEnvelope(corruptEnvelope).valid, false);
  }
});

// ---------------------------------------------------------------------------
// SECTION 17 -- STATIC VS RUNTIME CONFLICT (proven separately, at the source)
// ---------------------------------------------------------------------------

test('S17-A: STATIC conflict -- two queue task declarations with overlapping allowed_paths, proven directly at queue.mjs', () => {
  const syntheticQueue = {
    schema_version: 1,
    session: { session_id: 'sim-static-conflict', mode: 'dry-run', base_sha: '0000000000000000000000000000000000FIXT', branch_prefix: 'agent/night/sim', max_session_minutes: 60, max_total_tasks: 2, max_consecutive_holds: 2 },
    tasks: [
      {
        id: 'sim-task-A', title: 'sim A', objective: 'sim', risk: 'GREEN', status: 'READY', enabled: true,
        dependency_type: 'INDEPENDENT', depends_on: [],
        allowed_paths: ['examples/night-agent-fixture/shared.mjs'], read_paths: ['examples/night-agent-fixture/shared.mjs'], forbidden_paths: [],
        required_checks: ['node --test examples/night-agent-fixture/shared.mjs'],
        verification_commands: [{ family: 'NODE_TEST', target: 'examples/night-agent-fixture/shared.mjs' }],
        max_retries: 1, max_turns: 5, timeout_seconds: 60, on_failure: 'HOLD',
      },
      {
        id: 'sim-task-B', title: 'sim B', objective: 'sim', risk: 'GREEN', status: 'READY', enabled: true,
        dependency_type: 'INDEPENDENT', depends_on: [],
        allowed_paths: ['examples/night-agent-fixture/shared.mjs'], read_paths: ['examples/night-agent-fixture/shared.mjs'], forbidden_paths: [],
        required_checks: ['node --test examples/night-agent-fixture/shared.mjs'],
        verification_commands: [{ family: 'NODE_TEST', target: 'examples/night-agent-fixture/shared.mjs' }],
        max_retries: 1, max_turns: 5, timeout_seconds: 60, on_failure: 'HOLD',
      },
    ],
  };
  const schemaResult = validateSchema(syntheticQueue);
  assert.equal(schemaResult.valid, true, `synthetic queue fixture itself must be schema-valid: ${JSON.stringify(schemaResult.errors)}`);
  const conflicts = findPathConflicts(syntheticQueue.tasks);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a, 'sim-task-A');
  assert.equal(conflicts[0].b, 'sim-task-B');
  assert.equal(findCycle(syntheticQueue.tasks), null);
});

test('S17-B: RUNTIME conflict -- an already-active reservation blocks a new overlapping one', () => {
  const repoRoot = fakeRepo();
  orch.createTaskSession({ repoRoot, taskId: 'runtime-holder', taskTitle: 'x', baseSha: BASE_SHA });
  orch.createTaskSession({ repoRoot, taskId: 'runtime-challenger', taskTitle: 'y', baseSha: BASE_SHA });
  const holder = orch.reserveTask({ repoRoot, taskId: 'runtime-holder', reservedPaths: ['tools/night-agent/runtime-shared.mjs'], baseSha: BASE_SHA });
  assert.equal(holder.ok, true);
  const challenger = orch.reserveTask({ repoRoot, taskId: 'runtime-challenger', reservedPaths: ['tools/night-agent/runtime-shared.mjs'], baseSha: BASE_SHA });
  assert.equal(challenger.ok, false);
  assert.equal(challenger.reason, 'RUNTIME_RESERVATION_CONFLICT');
});

// ---------------------------------------------------------------------------
// SECTION 18 -- REAL-SPAWN SAFETY CHECK (read-only, procedural)
// ---------------------------------------------------------------------------

test('S18: REAL_CLAUDE_CHILD_SPAWN_ENABLED = NO -- Task 5 does not set or reference KORIXA_NIGHT_REAL_SPAWN, and the triple execution lock files are untouched', () => {
  assert.equal(process.env.KORIXA_NIGHT_REAL_SPAWN, undefined, 'this simulation process must not have KORIXA_NIGHT_REAL_SPAWN set');
  const orchSrc = readFileSync(new URL('../task-orchestrator.mjs', import.meta.url), 'utf8');
  const lockSrc = readFileSync(new URL('../task-lock.mjs', import.meta.url), 'utf8');
  assert.ok(!orchSrc.includes('KORIXA_NIGHT_REAL_SPAWN'), 'task-orchestrator.mjs must not reference the real-spawn flag');
  assert.ok(!lockSrc.includes('KORIXA_NIGHT_REAL_SPAWN'), 'task-lock.mjs must not reference the real-spawn flag');
  assert.ok(!orchSrc.includes('child_process'), 'task-orchestrator.mjs must not spawn any child process');
  assert.ok(!lockSrc.includes('child_process'), 'task-lock.mjs must not spawn any child process');
});
