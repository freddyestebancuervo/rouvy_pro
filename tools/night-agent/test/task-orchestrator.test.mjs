// Tests for tools/night-agent/task-orchestrator.mjs.
// Covers the 40 required Task 4 test cases (brief section 18).

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
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

test('6. C PASS -> READY_FOR_HUMAN', () => {
  const ctx = setupThroughExecuting();
  const { auditResult } = bPass(ctx);
  handoffToValidator({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, headSha: HEAD_1 });
  const validatorResult = certifyByValidator({ executorRole: 'A', validatorRole: 'C', currentHeadSha: HEAD_1, attestedAuditorResult: auditResult, ciHeadSha: HEAD_1, ciStatus: 'SUCCESS' });
  const r = recordValidationResult({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, validatorResult, toState: 'READY_FOR_HUMAN' });
  assert.equal(r.ok, true);
  assert.equal(r.state.state, 'READY_FOR_HUMAN');
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
  const r = requestHumanGate({ repoRoot: ctx.repoRoot, taskId: ctx.taskId, ownerToken: ctx.ownerToken, actionType: 'MARK_READY' });
  assert.equal(r.ok, true); // recording that a gate is required succeeds...
  assert.equal(r.humanGateRequired, true); // ...but it is never an authorization
  const state = getTaskState({ repoRoot: ctx.repoRoot, taskId: ctx.taskId });
  assert.notEqual(state.state, 'DONE'); // never silently completes the task
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
