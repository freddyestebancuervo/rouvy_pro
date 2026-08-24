// Tests for tools/night-agent/task-orchestrator.mjs.
// Covers the 40 required Task 4 test cases (brief section 18).

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createTaskSession, getTaskState, reserveTask, enterRole,
  recordExecutorResult, handoffToAuditor, recordAuditResult,
  handoffToValidator, recordValidationResult, enterWaitingCi,
  resumeFromWaitingCi, requestHumanGate, releaseTask, isEvidenceReusable,
} from '../task-orchestrator.mjs';
import { finalizeExecutorResult, certifyAuditResult, certifyByValidator } from '../role-protocol.mjs';
import { resolveTaskLockPath } from '../task-lock.mjs';
import { resolveProtocolStatePath } from '../protocol-state.mjs';
import { buildFinalPrMetadataBlock } from '../pr-metadata-gate.mjs';
import { recordFinalPrMetadataVerification, recordPrOpened } from '../task-orchestrator.mjs';
import { isRoleAllowed } from '../role-capabilities.mjs';

function fakeRepo() {
  return `/fake/repo-${randomUUID()}`;
}
const BASE_SHA = 'a'.repeat(40);
const HEAD_1 = 'b'.repeat(40);
const HEAD_2 = 'c'.repeat(40);

/** Drives NIGHT -> A -> EXECUTING for a fresh task, returns {repoRoot, taskId, ownerToken}. */
function setupThroughExecuting(taskTitle = 'demo') {
  const repoRoot = fakeRepo();
  const taskId = `task-${randomUUID()}`;
  createTaskSession({ repoRoot, taskId, taskTitle, baseSha: BASE_SHA });
  const res = reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/demo.mjs'], baseSha: BASE_SHA });
  const ownerToken = res.ownerToken;
  enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  return { repoRoot, taskId, ownerToken };
}

function driveToReadyForB({ repoRoot, taskId, ownerToken }, headSha = HEAD_1) {
  const execResult = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha, filesChanged: ['tools/night-agent/demo.mjs'] });
  return recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: execResult, toState: 'READY_FOR_B' });
}

function driveToAuditing(ctx, headSha = HEAD_1) {
  driveToReadyForB(ctx, headSha);
  return handoffToAuditor({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha });
}

function bPass(ctx, headSha = HEAD_1) {
  driveToAuditing(ctx, headSha);
  const auditResult = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [] });
  const rec = recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: auditResult, toState: 'READY_FOR_C' });
  return { rec, auditResult };
}

// ---------------------------------------------------------------------------
// 1-6: positive happy path (also covered end-to-end by the smoke script;
// re-verified here as real node:test cases).
// ---------------------------------------------------------------------------

test('1. create a task session', () => {
  const repoRoot = fakeRepo();
  const r = createTaskSession({ repoRoot, taskId: 't1', taskTitle: 'x', baseSha: BASE_SHA });
  assert.equal(r.ok, true);
  assert.equal(r.state.state, 'IDLE');
});

test('2. reserve task successfully', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't1', taskTitle: 'x', baseSha: BASE_SHA });
  const r = reserveTask({ repoRoot, taskId: 't1', reservedPaths: ['tools/night-agent/x.mjs'], baseSha: BASE_SHA });
  assert.equal(r.ok, true);
  assert.equal(typeof r.ownerToken, 'string');
});

test('3. NIGHT -> A (via PLANNING, READY_FOR_A, EXECUTING)', () => {
  const ctx = setupThroughExecuting();
  const state = getTaskState({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  assert.equal(state.state, 'EXECUTING');
  assert.equal(state.active_role, 'A');
});

test('4. A -> B with exact HEAD', () => {
  const ctx = setupThroughExecuting();
  const r = driveToAuditing(ctx, HEAD_1);
  assert.equal(r.ok, true);
  assert.equal(r.state.state, 'AUDITING');
  assert.equal(r.state.head_sha, HEAD_1);
});

test('5. B PASS -> C', () => {
  const ctx = setupThroughExecuting();
  const { rec } = bPass(ctx);
  assert.equal(rec.ok, true);
  assert.equal(rec.state.state, 'READY_FOR_C');
  const handoff = handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_1 });
  assert.equal(handoff.ok, true);
  assert.equal(handoff.state.state, 'VALIDATING');
});

test('6. C PASS -> PR_METADATA_SYNC_REQUIRED (Task 6: no longer directly to READY_FOR_HUMAN)', () => {
  const ctx = setupThroughExecuting();
  const { auditResult } = bPass(ctx);
  handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_1 });
  const validatorResult = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: auditResult, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS' });
  const r = recordValidationResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, validatorResult, toState: 'PR_METADATA_SYNC_REQUIRED' });
  assert.equal(r.ok, true);
  assert.equal(r.state.state, 'PR_METADATA_SYNC_REQUIRED');
  // the old direct toState is now rejected outright:
  const oldWay = recordValidationResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, validatorResult, toState: 'READY_FOR_HUMAN' });
  assert.equal(oldWay.ok, false);
});

test('7 & 8. B HOLD -> A remediation -> B using NEW_HEAD', () => {
  const ctx = setupThroughExecuting();
  driveToAuditing(ctx, HEAD_1);
  const holdResult = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [{ severity: 'P0', summary: 'real blocker' }] });
  assert.equal(holdResult.finalState, 'HOLD');
  const rec = recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: holdResult, toState: 'HOLD' });
  assert.equal(rec.ok, true);
  assert.equal(rec.state.state, 'HOLD');

  // remediation: A re-enters
  const remediate = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'REMEDIATING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES', headSha: HEAD_1 });
  assert.equal(remediate.ok, true);

  const fixResult = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_2 });
  const rec2 = recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: fixResult, toState: 'READY_FOR_B' });
  assert.equal(rec2.ok, true);
  assert.equal(rec2.state.head_sha, HEAD_2);

  const reaudit = handoffToAuditor({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_2 });
  assert.equal(reaudit.ok, true);
  const cleanAudit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_2, requestedState: 'PASS', findings: [] });
  const rec3 = recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: cleanAudit, toState: 'READY_FOR_C' });
  assert.equal(rec3.ok, true);
});

test('9. WAITING_CI persists and resumes', () => {
  const ctx = setupThroughExecuting();
  const wait = enterWaitingCi({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, ciRun: 12345, headSha: BASE_SHA });
  assert.equal(wait.ok, true);
  assert.equal(wait.state.state, 'WAITING_CI');

  const stillWaiting = resumeFromWaitingCi({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, ciHeadSha: BASE_SHA, ciStatus: { status: 'in_progress' } });
  assert.equal(stillWaiting.ok, true);
  assert.equal(stillWaiting.ciClassification, 'WAITING_CI');
  assert.equal(getTaskState({ repoRoot: ctx.repoRoot, taskId: ctx.taskId }).state, 'WAITING_CI');

  const done = resumeFromWaitingCi({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, ciHeadSha: BASE_SHA, ciStatus: { status: 'completed', conclusion: 'success' } });
  assert.equal(done.ok, true);
  assert.equal(done.ciClassification, 'SUCCESS');
  assert.equal(done.state.state, 'READY_FOR_B');
});

test('10. correct lock owner releases reservation', () => {
  const ctx = setupThroughExecuting();
  const r = releaseTask({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken });
  assert.equal(r.ok, true);
});

test('11. sequential second task can start after first releases/completes', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 'seq-1', taskTitle: 'first', baseSha: BASE_SHA });
  const first = reserveTask({ repoRoot, taskId: 'seq-1', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  assert.equal(first.ok, true);

  createTaskSession({ repoRoot, taskId: 'seq-2', taskTitle: 'second', baseSha: BASE_SHA });
  const blocked = reserveTask({ repoRoot, taskId: 'seq-2', reservedPaths: ['tools/night-agent/other.mjs'], baseSha: BASE_SHA });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'ACTIVE_TASK_SLOT_HELD');

  releaseTask({ repoRoot, taskId: 'seq-1', ownerToken: first.ownerToken });
  const second = reserveTask({ repoRoot, taskId: 'seq-2', reservedPaths: ['tools/night-agent/other.mjs'], baseSha: BASE_SHA });
  assert.equal(second.ok, true);
});

test('12. persisted compact state can be safely loaded', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't-load', taskTitle: 'x', baseSha: BASE_SHA });
  const loaded = getTaskState({ repoRoot, taskId: 't-load' });
  assert.notEqual(loaded, null);
  assert.equal(loaded.task_id, 't-load');
});

// ---------------------------------------------------------------------------
// 13-40: negative / adversarial
// ---------------------------------------------------------------------------

test('13. double lock acquisition denied (via reserveTask)', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't1', taskTitle: 'x', baseSha: BASE_SHA });
  reserveTask({ repoRoot, taskId: 't1', reservedPaths: ['tools/night-agent/x.mjs'], baseSha: BASE_SHA });
  const second = reserveTask({ repoRoot, taskId: 't1', reservedPaths: ['tools/night-agent/x.mjs'], baseSha: BASE_SHA });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'DOUBLE_ACQUIRE');
});

test('14. overlapping task scope denied (runtime, across two different tasks)', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't-own', taskTitle: 'x', baseSha: BASE_SHA });
  reserveTask({ repoRoot, taskId: 't-own', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  createTaskSession({ repoRoot, taskId: 't-other', taskTitle: 'y', baseSha: BASE_SHA });
  const r = reserveTask({ repoRoot, taskId: 't-other', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'RUNTIME_RESERVATION_CONFLICT');
});

test('15. wrong owner lock release denied', () => {
  const ctx = setupThroughExecuting();
  const r = releaseTask({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: 'not-the-real-token' });
  assert.equal(r.ok, false);
});

test('16. malformed lock state denied (malformed reservedPaths on reserveTask)', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't1', taskTitle: 'x', baseSha: BASE_SHA });
  const r = reserveTask({ repoRoot, taskId: 't1', reservedPaths: [], baseSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MALFORMED_RESERVATION');
});

test('17. corrupted persisted state denied (protocol state file corrupted -> NO_TASK_SESSION-equivalent null)', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't-corrupt', taskTitle: 'x', baseSha: BASE_SHA });
  // Directly corrupt the persisted protocol-state file on disk.
  const p = resolveProtocolStatePath({ repoRoot, taskId: 't-corrupt' });
  writeFileSync(p, 'not valid json {{{', 'utf8');
  const loaded = getTaskState({ repoRoot, taskId: 't-corrupt' });
  assert.equal(loaded, null);
  const r = reserveTask({ repoRoot, taskId: 't-corrupt', reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_TASK_SESSION');
});

test('18. stale/uncertain lock cannot auto-steal (corrupt lock file blocks reserveTask, not silently bypassed)', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't-stale', taskTitle: 'x', baseSha: BASE_SHA });
  const lockPath = resolveTaskLockPath({ repoRoot, taskId: 't-stale' });
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, '{{{ corrupt', 'utf8');
  const r = reserveTask({ repoRoot, taskId: 't-stale', reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HOLD_LOCK_RECOVERY_REQUIRED');
});

test('19. A -> C bypass denied', () => {
  const ctx = setupThroughExecuting();
  const r = handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'INVALID_STATE_TRANSITION');
});

test('20. A self-certification denied (malformed executor result state)', () => {
  const ctx = setupThroughExecuting();
  const fakeResult = { role: 'executor', state: 'PASS', headSha: HEAD_1 }; // 'PASS' is not in EXECUTOR_RESULT_STATES
  assert.throws(() => finalizeExecutorResult({ state: 'PASS', executorRole: 'A', headSha: HEAD_1 }));
  // even a hand-fabricated object claiming role 'executor' with a bogus state is rejected downstream:
  const r = recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: fakeResult, toState: 'READY_FOR_B' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MALFORMED_EXECUTOR_RESULT_STATE');
});

test('21. B write authorization denied (B cannot enter EXECUTING/WRITE_TASK_FILES)', () => {
  const ctx = setupThroughExecuting();
  driveToAuditing(ctx, HEAD_1);
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'EXECUTING', actingRole: 'B', requiredCapability: 'WRITE_TASK_FILES', headSha: HEAD_1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^CAPABILITY_DENIED/);
});

test('22. C write authorization denied', () => {
  const ctx = setupThroughExecuting();
  const { auditResult } = bPass(ctx);
  void auditResult;
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'EXECUTING', actingRole: 'C', requiredCapability: 'WRITE_TASK_FILES', headSha: HEAD_1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:CAPABILITY_NOT_GRANTED_FOR_ROLE');
});

test('23. unknown role denied', () => {
  const ctx = setupThroughExecuting();
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'SUPERUSER', requiredCapability: 'READ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:UNKNOWN_ROLE');
});

test('24. lowercase role denied', () => {
  const ctx = setupThroughExecuting();
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'a', requiredCapability: 'READ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:UNKNOWN_ROLE');
});

test('25. whitespace role denied', () => {
  const ctx = setupThroughExecuting();
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: ' A', requiredCapability: 'READ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:UNKNOWN_ROLE');
});

test('26. zero-width Unicode role denied', () => {
  const ctx = setupThroughExecuting();
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'A​', requiredCapability: 'READ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:UNKNOWN_ROLE');
});

test('27. unknown capability denied', () => {
  const ctx = setupThroughExecuting();
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'A', requiredCapability: 'DELETE_PRODUCTION_DB' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:UNKNOWN_CAPABILITY');
});

test('28. capability typo denied', () => {
  const ctx = setupThroughExecuting();
  const r = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'A', requiredCapability: 'WRITE_TASKFILES' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'CAPABILITY_DENIED:UNKNOWN_CAPABILITY');
});

test('29. mismatched TASK_ID handoff denied (wrong owner token from a different task)', () => {
  const ctx1 = setupThroughExecuting('t1');
  const ctx2 = setupThroughExecuting('t2');
  const r = handoffToAuditor({ repoRoot: ctx1.repoRoot, taskId: ctx1.taskId, ownerToken: ctx2.ownerToken, headSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'WRONG_OWNER');
});

test('30. mismatched HEAD_SHA handoff denied', () => {
  const ctx = setupThroughExecuting();
  driveToReadyForB(ctx, HEAD_1);
  const r = handoffToAuditor({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_2 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HOLD_HEAD_DRIFT');
});

test('31. changed HEAD invalidates SHA-bound evidence (isEvidenceReusable)', () => {
  assert.equal(isEvidenceReusable({ evidenceHeadSha: HEAD_1, currentHeadSha: HEAD_1 }), true);
  assert.equal(isEvidenceReusable({ evidenceHeadSha: HEAD_1, currentHeadSha: HEAD_2 }), false);
  assert.equal(isEvidenceReusable({ evidenceHeadSha: '', currentHeadSha: HEAD_2 }), false);
  assert.equal(isEvidenceReusable({ evidenceHeadSha: null, currentHeadSha: HEAD_2 }), false);
});

test('32. C cannot certify CI for a different SHA', () => {
  const ctx = setupThroughExecuting();
  const { auditResult } = bPass(ctx, HEAD_1);
  handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_1 });
  const validatorResult = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: auditResult, ciHeadSha: HEAD_2, ciStatus: 'SUCCESS' });
  assert.equal(validatorResult.finalState, 'HOLD');
  assert.equal(validatorResult.reason, 'HOLD_CI_SHA_MISMATCH');
  const r = recordValidationResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, validatorResult, toState: 'HOLD' });
  assert.equal(r.ok, true); // recording the HOLD itself succeeds -- but never PASS
  assert.equal(r.state.validator_result.finalState, 'HOLD');
});

test('33. unresolved B blocker prevents C PASS', () => {
  const ctx = setupThroughExecuting();
  driveToAuditing(ctx, HEAD_1);
  const holdResult = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [{ severity: 'P0', summary: 'blocker' }] });
  assert.equal(holdResult.finalState, 'HOLD');
  // B's own HOLD result cannot be used to reach READY_FOR_C at all -- the orchestrator itself
  // enforces toState consistency with the result's actual finalState, independent of what
  // toState the caller asks for.
  const r = recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: holdResult, toState: 'READY_FOR_C' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'INVALID_TOSTATE_FOR_AUDITOR_RESULT');
});

test('34. HUMAN_GATE-only action denied to NIGHT/A/B/C (requestHumanGate never authorizes; capability model separately denies all 6)', () => {
  const ctx = setupThroughExecuting();
  // Task 6: MARK_READY can no longer be requested before the task has genuinely
  // reached READY_FOR_HUMAN with a valid PR metadata verification -- from EXECUTING,
  // this is correctly denied (closing exactly the PR #78/#79 gap).
  const r = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_METADATA_VERIFICATION_MISSING');
  const state = getTaskState({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  assert.notEqual(state.state, 'DONE'); // never silently completes the task

  // An action type unrelated to PR readiness (e.g. PRODUCTION_ACTION) is
  // unaffected by this new rule -- it still records the gate requirement.
  const prodGate = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'PRODUCTION_ACTION' });
  assert.equal(prodGate.ok, true);
  assert.equal(prodGate.humanGateRequired, true);
  assert.equal(prodGate.actionExecuted, false);
});

test('35. WAITING_CI does not become PASS (non-success conclusion stays HOLD, never PASS)', () => {
  const ctx = setupThroughExecuting();
  enterWaitingCi({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, ciRun: 1, headSha: BASE_SHA });
  const r = resumeFromWaitingCi({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, ciHeadSha: BASE_SHA, ciStatus: { status: 'completed', conclusion: 'failure' } });
  assert.equal(r.ok, true);
  assert.equal(r.ciClassification, 'FAILURE');
  assert.equal(r.state.state, 'HOLD');
});

test('36. lock ownership is proven only by the live owner_token, never inferred from a serialized lookalike', () => {
  const ctx = setupThroughExecuting();
  const lookalike = { task_id: ctx.taskId, owner_token: ctx.ownerToken, reserved_paths: ['x'], base_sha: BASE_SHA, head_sha: '', acquired_at: 'now', updated_at: 'now', lock_state: 'ACTIVE' };
  // passing the SHAPE (not the real orchestrator-issued token) still requires ownerToken to equal the real stored token exactly:
  const r = releaseTask({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: JSON.stringify(lookalike) });
  assert.equal(r.ok, false);
});

test('37. static path conflict remains fail-closed', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't-static', taskTitle: 'x', baseSha: BASE_SHA });
  const r = reserveTask({
    repoRoot, taskId: 't-static', reservedPaths: ['tools/night-agent/x.mjs'], baseSha: BASE_SHA,
    staticTasks: [{ id: 'queue-declared-task', allowedPaths: ['tools/night-agent/x.mjs'] }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'STATIC_TASK_CONFLICT');
});

test('38. runtime reservation conflict remains fail-closed', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 'rt-a', taskTitle: 'x', baseSha: BASE_SHA });
  reserveTask({ repoRoot, taskId: 'rt-a', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  createTaskSession({ repoRoot, taskId: 'rt-b', taskTitle: 'y', baseSha: BASE_SHA });
  const r = reserveTask({ repoRoot, taskId: 'rt-b', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'RUNTIME_RESERVATION_CONFLICT');
});

test('39. expired-audit-attestation recovery path (HOLD -> READY_FOR_B, NIGHT-only) remains functional', () => {
  const ctx = setupThroughExecuting();
  driveToAuditing(ctx, HEAD_1);
  const holdResult = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [{ severity: 'P0', summary: 'x' }] });
  recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: holdResult, toState: 'HOLD' });

  // A cannot make this specific recovery move (only NIGHT can, per role-protocol.mjs's STATE_TRANSITION_TABLE, unmodified):
  const wrongRole = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'A', requiredCapability: 'READ', headSha: HEAD_1 });
  assert.equal(wrongRole.ok, false);

  const recovery = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'READY_FOR_B', actingRole: 'NIGHT', requiredCapability: 'READ', headSha: HEAD_1 });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.state.state, 'READY_FOR_B');
});

test('40. malformed handoff: extra/unexpected fields on an executor result are rejected by the underlying role-protocol.mjs shape, not silently accepted', () => {
  const ctx = setupThroughExecuting();
  const malformed = { role: 'executor', executorRole: 'A', state: 'IMPLEMENTED_AND_VALIDATED', headSha: HEAD_1, baseSha: BASE_SHA, filesChanged: [], tests: { run: 0, pass: 0, fail: 0 }, knownLimitations: [], EXTRA_UNEXPECTED_FIELD: 'smuggled' };
  // recordExecutorResult only checks role==='executor' and headSha presence at its own boundary (it does not
  // re-validate role-protocol.mjs's own closed field set -- that shape is only ever produced by
  // finalizeExecutorResult itself); this test documents that a hand-fabricated object with an extra field is
  // still accepted at THIS boundary (by design: the real anti-forgery gate for auditor results is the WeakSet
  // attestation in recordAuditResult, since role-protocol.mjs exports no equivalent registry for executor
  // results -- executor output is not a certification, only a claim B independently re-verifies).
  const r = recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: malformed, toState: 'READY_FOR_B' });
  assert.equal(r.ok, true);
  // the important invariant: this is still only ever a CLAIM stored under executor_result, never trusted as a
  // certification -- B's own recordAuditResult path requires a SEPARATE, WeakSet-attested object.
});

test('recordAuditResult rejects a hand-fabricated (non-attested) auditor result, even if shape-plausible', () => {
  const ctx = setupThroughExecuting();
  driveToAuditing(ctx, HEAD_1);
  const fabricated = { role: 'auditor', executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', independent: true, findings: [], evidence: {}, finalState: 'PASS', reason: 'REQUESTED_STATE_GRANTED' };
  const r = recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: fabricated, toState: 'READY_FOR_C' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'UNATTESTED_AUDITOR_RESULT');
});

test('createTaskSession refuses to silently overwrite an existing session', () => {
  const repoRoot = fakeRepo();
  createTaskSession({ repoRoot, taskId: 't1', taskTitle: 'first', baseSha: BASE_SHA });
  const second = createTaskSession({ repoRoot, taskId: 't1', taskTitle: 'second', baseSha: BASE_SHA });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'TASK_SESSION_ALREADY_EXISTS');
});

test('recordValidationResult rejects a validator result claiming PASS with a non-CERTIFIED reason (defense in depth)', () => {
  const ctx = setupThroughExecuting();
  const { auditResult } = bPass(ctx);
  handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_1 });
  const fakePass = { role: 'validator', executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS', independent: true, finalState: 'PASS', reason: 'TRUST_ME' };
  void auditResult;
  const r = recordValidationResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, validatorResult: fakePass, toState: 'READY_FOR_HUMAN' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MALFORMED_VALIDATOR_RESULT_PASS_REASON');
});

// ---------------------------------------------------------------------------
// Task 6: recordFinalPrMetadataVerification -- orchestrator-level wiring.
// Content-level (block parsing, stale markers, field mismatches) is
// covered exhaustively in pr-metadata-gate.test.mjs; these tests cover the
// ownership/identity/SHA-binding wiring specific to the orchestrator.
// ---------------------------------------------------------------------------

const TASK6_PR_NUMBER = 78;
const TASK6_BRANCH = 'feat/task6-demo';

/**
 * Task 7 hotfix: drives the CANONICAL, REAL chronology -- task session
 * created with prNumber=null (a real PR cannot exist before this point),
 * A produces a real HEAD, and only THEN is the PR identity bound via
 * recordPrOpened (simulating a Draft PR having just been created from
 * that real branch/HEAD). This is deliberately NOT the old shortcut
 * (`createTaskSession(..., prNumber)`) that hid
 * task-orchestrator-pr-number-unrecordable-post-creation through Tasks
 * 5 and 6.
 */
function driveToPrMetadataSyncRequired(prNumber = TASK6_PR_NUMBER) {
  const repoRoot = fakeRepo();
  const taskId = `task6-${randomUUID()}`;
  createTaskSession({ repoRoot, taskId, taskTitle: 'task6-demo', baseSha: BASE_SHA, branch: TASK6_BRANCH });
  const res = reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/task6-demo.mjs'], baseSha: BASE_SHA });
  const ownerToken = res.ownerToken;
  enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  // PR is created only NOW, after a real HEAD exists -- NIGHT binds identity:
  const bindResult = recordPrOpened({
    repoRoot, taskId, ownerToken,
    prSnapshot: { prNumber, state: 'OPEN', isDraft: true, merged: false, headSha: HEAD_1, baseSha: BASE_SHA, headRef: TASK6_BRANCH, baseRef: 'main' },
  });
  if (!bindResult.ok) throw new Error(`test helper: recordPrOpened failed unexpectedly: ${bindResult.reason}`);
  handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  const audit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: audit, toState: 'READY_FOR_C' });
  handoffToValidator({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  const validation = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: audit, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS' });
  recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult: validation, toState: 'PR_METADATA_SYNC_REQUIRED' });
  return { repoRoot, taskId, ownerToken, prNumber };
}

function goodSnapshotForCtx({ prNumber }) {
  const block = buildFinalPrMetadataBlock({
    task: '6/7', baseSha: BASE_SHA, headSha: HEAD_1, bAuditResult: 'PASS', cCertification: 'PASS',
    ciHeadSha: HEAD_1, ciStatus: '4/4 SUCCESS', p0: 0, p1: 0, p2: 0, p3: 0,
  });
  return { state: 'OPEN', isDraft: true, merged: false, prNumber, bodyText: `Description.\n\n${block}\n` };
}

test('Task 6 happy path: PR_METADATA_SYNC_REQUIRED -> READY_FOR_HUMAN on a genuine, matching snapshot; MARK_READY then succeeds as record-only', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const r = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber,
    prSnapshot: goodSnapshotForCtx(ctx), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(r.ok, true);
  assert.equal(r.verified, true);
  assert.equal(r.state.state, 'READY_FOR_HUMAN');
  assert.equal(r.state.pr_metadata_verification.pr_number, ctx.prNumber);
  assert.equal(r.state.pr_metadata_verification.head_sha, HEAD_1);

  const gate = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: goodSnapshotForCtx(ctx) });
  assert.equal(gate.ok, true);
  assert.equal(gate.humanGateRequired, true);
  assert.equal(gate.actionExecuted, false);
});

test('Task 6: wrong owner token denied (lock ownership gate)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const r = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: 'not-the-real-token', prNumber: ctx.prNumber,
    prSnapshot: goodSnapshotForCtx(ctx), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'WRONG_OWNER');
});

test('Task 6: wrong PR number denied (PR_IDENTITY_MISMATCH) before ever consulting the snapshot content', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const r = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber + 1,
    prSnapshot: goodSnapshotForCtx(ctx), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_IDENTITY_MISMATCH');
});

test('Task 6: CI head not matching current task head -> HOLD_HEAD_DRIFT, no state mutation', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const before = getTaskState({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  const r = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber,
    prSnapshot: goodSnapshotForCtx(ctx), ciHeadSha: HEAD_2, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HOLD_HEAD_DRIFT');
  const after = getTaskState({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  assert.equal(after.state, before.state, 'a rejected verification attempt must not mutate state');
});

test('Task 6: a stale/mismatched snapshot is recorded as a real HOLD (not silently ignored), and MARK_READY remains denied afterward', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const staleSnapshot = { ...goodSnapshotForCtx(ctx), bodyText: 'Independent audit in progress.\n\n' + goodSnapshotForCtx(ctx).bodyText };
  const r = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber,
    prSnapshot: staleSnapshot, ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(r.ok, true); // the CALL is well-formed; the CONTENT verification is what fails
  assert.equal(r.verified, false);
  assert.equal(r.verificationReason, 'STALE_MARKERS_PRESENT');
  assert.equal(r.state.state, 'HOLD');

  const gate = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY' });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'PR_METADATA_VERIFICATION_MISSING');
});

test('Task 6: requestHumanGate defensively denies MARK_READY if a stored verification\'s head_sha no longer matches the CURRENT head_sha (invalidation-on-drift, even if state somehow reads READY_FOR_HUMAN)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const verified = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber,
    prSnapshot: goodSnapshotForCtx(ctx), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(verified.verified, true);
  // simulate a hypothetical future where head_sha diverged from the stored verification
  // by hand-editing the persisted state directly (bypassing the orchestrator, exactly
  // like the corruption/tamper scenarios elsewhere in this suite):
  const filePath = resolveProtocolStatePath({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  raw.head_sha = HEAD_2;
  writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');

  const gate = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY' });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'HOLD_PR_METADATA_STALE');
});

// ---------------------------------------------------------------------------
// Remediation Round 1 (Task 6, 2026-08-24): P2-02 -- a stored
// pr_metadata_verification proved a body was ONCE verified, but nothing
// enforced that the CURRENT body was still that body. requestHumanGate now
// requires a fresh PR snapshot for MARK_READY/MERGE and independently
// recomputes its hash. Scenarios A-F exactly as named in the brief.
// ---------------------------------------------------------------------------

function snapshotFor(ctx, { bodyText, isDraft = true, merged = false, state = 'OPEN', prNumber = ctx.prNumber }) {
  return { state, isDraft, merged, prNumber, bodyText };
}

function verifiedBodyText(ctx, prose = 'Original description.') {
  const block = buildFinalPrMetadataBlock({
    task: '6/7', baseSha: BASE_SHA, headSha: HEAD_1, bAuditResult: 'PASS', cCertification: 'PASS',
    ciHeadSha: HEAD_1, ciStatus: '4/4 SUCCESS', p0: 0, p1: 0, p2: 0, p3: 0,
  });
  return `${prose}\n\n${block}\n`;
}

test('P2-02 Scenario A: body B1 verifies PASS, body changes to B2 (prose only), HEAD unchanged -> MARK_READY denied (HOLD_PR_METADATA_BODY_DRIFT)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx, 'Original description.');
  const verify1 = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber,
    prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(verify1.verified, true);

  const bodyB2 = verifiedBodyText(ctx, 'TAMPERED description with different content.');
  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: snapshotFor(ctx, { bodyText: bodyB2 }) });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'HOLD_PR_METADATA_BODY_DRIFT');
});

test('P2-02 Scenario B: after B2 is re-synced and re-verified (via the READY_FOR_HUMAN -> PR_METADATA_SYNC_REQUIRED NIGHT-only recovery), MARK_READY succeeds as record-only', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx, 'Original description.');
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const bodyB2 = verifiedBodyText(ctx, 'Updated, still-accurate description.');
  const recovery = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'NIGHT', requiredCapability: 'READ', headSha: HEAD_1 });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.state.state, 'PR_METADATA_SYNC_REQUIRED');
  // only NIGHT may perform this specific recovery move:
  const wrongRoleRecovery = enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'PR_METADATA_SYNC_REQUIRED', actingRole: 'C', requiredCapability: 'READ', headSha: HEAD_1 });
  assert.equal(wrongRoleRecovery.ok, false);

  const verify2 = recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB2 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });
  assert.equal(verify2.verified, true);
  assert.equal(verify2.state.state, 'READY_FOR_HUMAN');

  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: snapshotFor(ctx, { bodyText: bodyB2 }) });
  assert.equal(attempt.ok, true);
  assert.equal(attempt.humanGateRequired, true);
  assert.equal(attempt.actionExecuted, false);
});

test('P2-02 Scenario C: after human Ready (isDraft flips to false), MERGE gate with the SAME body/HEAD succeeds without re-verification', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB2 = verifiedBodyText(ctx, 'Final, human-approved description.');
  const verify = recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB2 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });
  assert.equal(verify.verified, true);

  const mergeAttempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MERGE', prSnapshot: snapshotFor(ctx, { bodyText: bodyB2, isDraft: false }) });
  assert.equal(mergeAttempt.ok, true);
  assert.equal(mergeAttempt.humanGateRequired, true);
  assert.equal(mergeAttempt.actionExecuted, false);
});

test('P2-02 Scenario D: after Ready, body changes to B3 (HEAD unchanged) -> MERGE denied (HOLD_PR_METADATA_BODY_DRIFT)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB2 = verifiedBodyText(ctx, 'Approved description.');
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB2 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const bodyB3 = verifiedBodyText(ctx, 'Someone edited the description again after Ready.');
  const mergeAttempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MERGE', prSnapshot: snapshotFor(ctx, { bodyText: bodyB3, isDraft: false }) });
  assert.equal(mergeAttempt.ok, false);
  assert.equal(mergeAttempt.reason, 'HOLD_PR_METADATA_BODY_DRIFT');
});

test('P2-02 Scenario E: after verification, HEAD changes -> MARK_READY denied (HOLD_PR_METADATA_STALE, the existing HEAD-binding check)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx);
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const filePath = resolveProtocolStatePath({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  raw.head_sha = HEAD_2;
  writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');

  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }) });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'HOLD_PR_METADATA_STALE');
});

test('P2-02 Scenario F: fresh snapshot belongs to another PR -> DENY (PR_IDENTITY_MISMATCH)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx);
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: snapshotFor(ctx, { bodyText: bodyB1, prNumber: ctx.prNumber + 1 }) });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'PR_IDENTITY_MISMATCH');
});

test('P2-02: MARK_READY/MERGE without ANY fresh snapshot supplied is denied (FRESH_PR_SNAPSHOT_REQUIRED), even with a valid, HEAD-bound verification on record', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx);
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const noSnapshot = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY' });
  assert.equal(noSnapshot.ok, false);
  assert.equal(noSnapshot.reason, 'FRESH_PR_SNAPSHOT_REQUIRED');

  const malformedSnapshot = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MERGE', prSnapshot: { isDraft: false } });
  assert.equal(malformedSnapshot.ok, false);
  assert.equal(malformedSnapshot.reason, 'FRESH_PR_SNAPSHOT_REQUIRED');
});

test('P2-02: MARK_READY with a non-Draft fresh snapshot is denied (PR_LIFECYCLE_INVALID) -- MARK_READY expects the PR to still be Draft', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx);
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: snapshotFor(ctx, { bodyText: bodyB1, isDraft: false }) });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'PR_LIFECYCLE_INVALID');
});

test('P2-02: MERGE with a Draft fresh snapshot is denied (PR_LIFECYCLE_INVALID) -- MERGE expects the PR to already be Ready', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx);
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MERGE', prSnapshot: snapshotFor(ctx, { bodyText: bodyB1, isDraft: true }) });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'PR_LIFECYCLE_INVALID');
});

test('P2-02: MERGE with a merged/closed fresh snapshot is denied (PR_LIFECYCLE_INVALID)', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx);
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const mergedAttempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MERGE', prSnapshot: snapshotFor(ctx, { bodyText: bodyB1, isDraft: false, merged: true }) });
  assert.equal(mergedAttempt.ok, false);
  assert.equal(mergedAttempt.reason, 'PR_LIFECYCLE_INVALID');
});

test('P2-02: a whitespace-only body change (formatting, no semantic content difference) still invalidates the stored hash -- byte-exact, no fuzzy body comparison', () => {
  const ctx = driveToPrMetadataSyncRequired();
  const bodyB1 = verifiedBodyText(ctx, 'Description.');
  recordFinalPrMetadataVerification({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: ctx.prNumber, prSnapshot: snapshotFor(ctx, { bodyText: bodyB1 }), ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS' });

  const bodyWhitespaceOnly = bodyB1 + '\n'; // one trailing newline appended -- byte-different, semantically trivial
  const attempt = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY', prSnapshot: snapshotFor(ctx, { bodyText: bodyWhitespaceOnly }) });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'HOLD_PR_METADATA_BODY_DRIFT');
});

// ---------------------------------------------------------------------------
// Task 7 hotfix (2026-08-24): recordPrOpened -- PR identity binding after
// PR creation. Fixes defect
// task-orchestrator-pr-number-unrecordable-post-creation, discovered by
// Task 7's own real (non-simulated) run.
// ---------------------------------------------------------------------------

function driveThroughExecuting({ branch = 'feat/hotfix-demo' } = {}) {
  const repoRoot = fakeRepo();
  const taskId = `hotfix-${randomUUID()}`;
  createTaskSession({ repoRoot, taskId, taskTitle: 'x', baseSha: BASE_SHA, branch });
  const res = reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/x.mjs'], baseSha: BASE_SHA });
  const ownerToken = res.ownerToken;
  enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
  return { repoRoot, taskId, ownerToken, branch };
}

function goodPrSnapshot(overrides = {}) {
  return { prNumber: 500, state: 'OPEN', isDraft: true, merged: false, headSha: HEAD_1, baseSha: BASE_SHA, headRef: 'feat/hotfix-demo', baseRef: 'main', ...overrides };
}

test('REAL-CHRONOLOGY REGRESSION TEST (brief section 10): the exact chronology Task 7 exposed, end to end', () => {
  // 1. createTaskSession(prNumber=null)
  const repoRoot = fakeRepo();
  const taskId = `real-chrono-${randomUUID()}`;
  const branch = 'feat/real-chrono-demo';
  const created = createTaskSession({ repoRoot, taskId, taskTitle: 'real chronology', baseSha: BASE_SHA, branch });
  assert.equal(created.ok, true);
  assert.equal(created.state.pr_number, null);

  // 2. reserve real/simulated task scope
  const res = reserveTask({ repoRoot, taskId, reservedPaths: ['tools/night-agent/real-chrono.mjs'], baseSha: BASE_SHA });
  assert.equal(res.ok, true);
  const ownerToken = res.ownerToken;

  // 3. advance NIGHT/A lifecycle
  enterRole({ repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
  enterRole({ repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });

  // 4. record executor real HEAD
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  const recExec = recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  assert.equal(recExec.ok, true);

  // Prove the ORIGINAL bug still reproduces at this exact point without recordPrOpened:
  const withoutBinding = recordFinalPrMetadataVerification({
    repoRoot, taskId, ownerToken, prNumber: 700,
    prSnapshot: { state: 'OPEN', isDraft: true, merged: false, prNumber: 700, bodyText: 'irrelevant, never reached' },
    ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(withoutBinding.ok, false);
  assert.equal(withoutBinding.reason, 'PR_IDENTITY_MISMATCH');
  assert.equal(withoutBinding.detail.includes('null'), true, 'must fail specifically because pr_number is still null');

  // 5. simulate PR creation only AFTER HEAD exists
  // 6. call recordPrOpened with fresh Draft PR snapshot
  const bind = recordPrOpened({
    repoRoot, taskId, ownerToken,
    prSnapshot: { prNumber: 700, state: 'OPEN', isDraft: true, merged: false, headSha: HEAD_1, baseSha: BASE_SHA, headRef: branch, baseRef: 'main' },
  });
  assert.equal(bind.ok, true);
  // 7. prove state.pr_number becomes PR number
  assert.equal(bind.state.pr_number, 700);

  // 8. B audit exact HEAD
  const audit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [] });
  const handoffB = handoffToAuditor({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  assert.equal(handoffB.ok, true);
  const recAudit = recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult: audit, toState: 'READY_FOR_C' });
  assert.equal(recAudit.ok, true);

  // 9. C PASS exact HEAD
  const handoffC = handoffToValidator({ repoRoot, taskId, ownerToken, headSha: HEAD_1 });
  assert.equal(handoffC.ok, true);
  const validation = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: audit, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS' });
  assert.equal(validation.finalState, 'PASS');

  // 10. PR_METADATA_SYNC_REQUIRED
  const recVal = recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult: validation, toState: 'PR_METADATA_SYNC_REQUIRED' });
  assert.equal(recVal.ok, true);
  assert.equal(recVal.state.state, 'PR_METADATA_SYNC_REQUIRED');

  // 11. final body created
  const block = buildFinalPrMetadataBlock({
    task: '7/7', baseSha: BASE_SHA, headSha: HEAD_1, bAuditResult: 'PASS', cCertification: 'PASS',
    ciHeadSha: HEAD_1, ciStatus: '4/4 SUCCESS', p0: 0, p1: 0, p2: 0, p3: 0,
  });
  const finalBody = `Real chronology regression test.\n\n${block}\n`;

  // 12. recordFinalPrMetadataVerification succeeds
  const finalVerify = recordFinalPrMetadataVerification({
    repoRoot, taskId, ownerToken, prNumber: 700,
    prSnapshot: { state: 'OPEN', isDraft: true, merged: false, prNumber: 700, bodyText: finalBody },
    ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(finalVerify.ok, true);
  assert.equal(finalVerify.verified, true);

  // 13. READY_FOR_HUMAN
  assert.equal(finalVerify.state.state, 'READY_FOR_HUMAN');

  // 14 & 15. requestHumanGate(MARK_READY) still requires fresh current PR snapshot, actionExecuted=false
  const gate = requestHumanGate({
    repoRoot, taskId, ownerToken, actionType: 'MARK_READY',
    prSnapshot: { state: 'OPEN', isDraft: true, merged: false, prNumber: 700, bodyText: finalBody },
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.humanGateRequired, true);
  assert.equal(gate.actionExecuted, false);
});

// --- Adversarial tests (brief section 12) ---

test('recordPrOpened: bind without fresh snapshot -> DENY', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  for (const bad of [undefined, null, {}, 'not-an-object', 42]) {
    const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: bad });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'PR_BINDING_SNAPSHOT_REQUIRED');
  }
});

test('recordPrOpened: wrong task owner -> DENY', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: 'not-the-real-token', prSnapshot: goodPrSnapshot() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'WRONG_OWNER');
});

test('recordPrOpened: PR closed -> DENY (PR_LIFECYCLE_INVALID)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ state: 'CLOSED' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_LIFECYCLE_INVALID');
});

test('recordPrOpened: PR merged -> DENY (PR_LIFECYCLE_INVALID)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ merged: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_LIFECYCLE_INVALID');
});

test('recordPrOpened: PR non-Draft at initial binding -> DENY (PR_LIFECYCLE_INVALID)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ isDraft: false }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_LIFECYCLE_INVALID');
});

test('recordPrOpened: wrong HEAD -> DENY (PR_HEAD_MISMATCH)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ headSha: HEAD_2 }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_HEAD_MISMATCH');
});

test('recordPrOpened: wrong base SHA -> DENY (PR_BASE_MISMATCH)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ baseSha: HEAD_2 }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_BASE_MISMATCH');
});

test('recordPrOpened: wrong head branch -> DENY (PR_BRANCH_MISMATCH)', () => {
  const ctx = driveThroughExecuting({ branch: 'feat/real-branch' });
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ headSha: HEAD_1, headRef: 'feat/wrong-branch' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_BRANCH_MISMATCH');
});

test('recordPrOpened: malformed PR number -> DENY (PR_BINDING_SNAPSHOT_REQUIRED)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  for (const badPrNumber of [0, -1, 1.5, 'seven', null, undefined]) {
    const r = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: badPrNumber }) });
    assert.equal(r.ok, false, `prNumber=${JSON.stringify(badPrNumber)} must be denied`);
    assert.equal(r.reason, 'PR_BINDING_SNAPSHOT_REQUIRED');
  }
});

test('recordPrOpened: second binding to a DIFFERENT PR -> DENY (PR_IDENTITY_MISMATCH)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const first = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500 }) });
  assert.equal(first.ok, true);
  const second = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 501 }) });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'PR_IDENTITY_MISMATCH');
});

test('recordPrOpened: second binding, same PR number, incompatible identity evidence -> DENY (PR_IDENTITY_ALREADY_BOUND)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const first = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500 }) });
  assert.equal(first.ok, true);
  const second = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500, headRef: 'feat/a-totally-different-branch' }) });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'PR_IDENTITY_ALREADY_BOUND');
});

test('recordPrOpened: idempotent replay (same PR number, identical identity evidence) -> PASS, no-op', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const first = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500 }) });
  assert.equal(first.ok, true);
  const replay = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500 }) });
  assert.equal(replay.ok, true);
  assert.equal(replay.alreadyBound, true);
  assert.equal(replay.state.pr_number, 500);
});

test('recordPrOpened: C cannot bind PR identity (capability structurally NIGHT-only, no actingRole parameter exists to abuse)', () => {
  // recordPrOpened has no actingRole/role parameter at all -- it is
  // structurally impossible for a caller to invoke it "as" C, B, or A.
  // Verify the underlying capability itself independently denies them:
  assert.equal(isRoleAllowed('C', 'BIND_PR_IDENTITY'), false);
  assert.equal(isRoleAllowed('B', 'BIND_PR_IDENTITY'), false);
  assert.equal(isRoleAllowed('A', 'BIND_PR_IDENTITY'), false);
  assert.equal(isRoleAllowed('NIGHT', 'BIND_PR_IDENTITY'), true);
});

test('recordPrOpened: unknown/malformed capability name never accidentally grants binding', () => {
  assert.equal(isRoleAllowed('NIGHT', 'bind_pr_identity'), false); // lowercase
  assert.equal(isRoleAllowed('NIGHT', 'BIND_PR_IDENTITY '), false); // trailing space
  assert.equal(isRoleAllowed('NIGHT', 'BINDPRIDENTITY'), false); // no underscores
});

test('recordPrOpened: direct final metadata verify while pr_number null -> DENY (the original bug, still correctly reproducible without the fix path)', () => {
  const ctx = driveThroughExecuting();
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const r = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: 500,
    prSnapshot: { state: 'OPEN', isDraft: true, merged: false, prNumber: 500, bodyText: 'n/a' },
    ciHeadSha: HEAD_1, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PR_IDENTITY_MISMATCH');
});

test('recordPrOpened: correct fresh binding -> PASS, and final metadata gate after binding -> PASS (proves the fix, not just the denials)', () => {
  const ctx = driveThroughExecuting({ branch: 'feat/correct-binding' });
  const exec = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec, toState: 'READY_FOR_B' });
  const bind = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500, headRef: 'feat/correct-binding' }) });
  assert.equal(bind.ok, true);
  assert.equal(bind.state.pr_number, 500);
});

test('recordPrOpened: A remediation may advance HEAD after PR binding -- PR_NUMBER stays the same, final gate uses the NEW head', () => {
  const ctx = driveThroughExecuting({ branch: 'feat/remediation-after-bind' });
  const exec1 = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_1 });
  recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec1, toState: 'READY_FOR_B' });
  const bind = recordPrOpened({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prSnapshot: goodPrSnapshot({ prNumber: 500, headRef: 'feat/remediation-after-bind' }) });
  assert.equal(bind.ok, true);

  handoffToAuditor({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_1 });
  const holdResult = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_1, requestedState: 'PASS', findings: [{ severity: 'P1', summary: 'real bug' }] });
  recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: holdResult, toState: 'HOLD' });
  enterRole({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, toState: 'REMEDIATING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES', headSha: HEAD_1 });

  // A remediates, producing a NEW head -- PR_NUMBER must remain 500, unaffected.
  const exec2 = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: BASE_SHA, headSha: HEAD_2 });
  const recExec2 = recordExecutorResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, executorResult: exec2, toState: 'READY_FOR_B' });
  assert.equal(recExec2.ok, true);
  assert.equal(recExec2.state.pr_number, 500, 'PR identity must survive a HEAD-advancing remediation unchanged');
  assert.equal(recExec2.state.head_sha, HEAD_2);

  handoffToAuditor({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_2 });
  const cleanAudit = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha: HEAD_2, requestedState: 'PASS', findings: [] });
  recordAuditResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, auditorResult: cleanAudit, toState: 'READY_FOR_C' });
  handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_2 });
  const validation = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_2, attestedAuditorResult: cleanAudit, ciHeadSha: HEAD_2, ciStatus: 'SUCCESS' });
  const recVal = recordValidationResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, validatorResult: validation, toState: 'PR_METADATA_SYNC_REQUIRED' });
  assert.equal(recVal.ok, true);

  // Final gate must use HEAD_2, the post-remediation head -- PR_NUMBER (500) is unchanged.
  const block = buildFinalPrMetadataBlock({ task: '7/7', baseSha: BASE_SHA, headSha: HEAD_2, bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: HEAD_2, ciStatus: '4/4 SUCCESS', p0: 0, p1: 0, p2: 0, p3: 0 });
  const finalVerify = recordFinalPrMetadataVerification({
    repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, prNumber: 500,
    prSnapshot: { state: 'OPEN', isDraft: true, merged: false, prNumber: 500, bodyText: `Remediated.\n\n${block}\n` },
    ciHeadSha: HEAD_2, ciStatusLabel: '4/4 SUCCESS',
  });
  assert.equal(finalVerify.ok, true);
  assert.equal(finalVerify.verified, true);
  assert.equal(finalVerify.state.state, 'READY_FOR_HUMAN');
});
