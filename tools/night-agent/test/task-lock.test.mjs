// Tests for tools/night-agent/task-lock.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  LOCK_STATES,
  resolveTaskLockDir,
  resolveTaskLockPath,
  validateTaskLock,
  listActiveTaskLocks,
  acquireTaskLock,
  releaseTaskLock,
  verifyTaskLockOwnership,
  updateTaskLockHeadSha,
  acquireActiveTaskSlot,
  releaseActiveTaskSlot,
  verifyActiveTaskSlotOwnership,
} from '../task-lock.mjs';

function fakeRepo() {
  return `/fake/repo-${randomUUID()}`;
}

const BASE_SHA = 'a'.repeat(40);

test('LOCK_STATES is exactly ACTIVE/RELEASED', () => {
  assert.deepEqual([...LOCK_STATES], ['ACTIVE', 'RELEASED']);
});

test('resolveTaskLockPath is deterministic per (repoRoot, taskId) and lives outside the repo', () => {
  const repoRoot = fakeRepo();
  const p1 = resolveTaskLockPath({ repoRoot, taskId: 't1' });
  const p2 = resolveTaskLockPath({ repoRoot, taskId: 't1' });
  const p3 = resolveTaskLockPath({ repoRoot, taskId: 't2' });
  assert.equal(p1, p2);
  assert.notEqual(p1, p3);
  assert.ok(!p1.includes(repoRoot));
  assert.ok(!p1.includes('t1'));
});

test('acquire then release: happy path', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-happy';
  const acq = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['tools/night-agent/x.mjs'], baseSha: BASE_SHA });
  assert.equal(acq.ok, true);
  assert.equal(acq.lock.lock_state, 'ACTIVE');
  assert.equal(typeof acq.ownerToken, 'string');
  assert.ok(acq.ownerToken.length >= 32);

  const rel = releaseTaskLock({ repoRoot, taskId, ownerToken: acq.ownerToken });
  assert.equal(rel.ok, true);
  assert.equal(rel.lock.lock_state, 'RELEASED');
});

test('double acquisition of the same task is denied', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-double';
  const first = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(first.ok, true);
  const second = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'DOUBLE_ACQUIRE');
});

test('overlapping runtime reservation between two DIFFERENT tasks is denied', () => {
  const repoRoot = fakeRepo();
  const t1 = acquireTaskLock({ repoRoot, taskId: 'owner-task', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  assert.equal(t1.ok, true);
  const t2 = acquireTaskLock({ repoRoot, taskId: 'other-task', reservedPaths: ['tools/night-agent/shared.mjs'], baseSha: BASE_SHA });
  assert.equal(t2.ok, false);
  assert.equal(t2.reason, 'RUNTIME_RESERVATION_CONFLICT');
  assert.equal(t2.conflictingTaskId, 'owner-task');
});

test('non-overlapping reservations for two different tasks both succeed', () => {
  const repoRoot = fakeRepo();
  const t1 = acquireTaskLock({ repoRoot, taskId: 'task-a', reservedPaths: ['tools/night-agent/a.mjs'], baseSha: BASE_SHA });
  const t2 = acquireTaskLock({ repoRoot, taskId: 'task-b', reservedPaths: ['tools/night-agent/b.mjs'], baseSha: BASE_SHA });
  assert.equal(t1.ok, true);
  assert.equal(t2.ok, true);
});

test('a released lock can be re-acquired (fresh owner token, sequential second task)', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-sequential';
  const first = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  releaseTaskLock({ repoRoot, taskId, ownerToken: first.ownerToken });
  const second = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(second.ok, true);
  assert.notEqual(second.ownerToken, first.ownerToken);
});

test('release with wrong owner token is denied', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-wrong-owner';
  const acq = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  const rel = releaseTaskLock({ repoRoot, taskId, ownerToken: 'not-the-real-token' });
  assert.equal(rel.ok, false);
  assert.equal(rel.reason, 'WRONG_OWNER');
  // confirm the lock is still ACTIVE afterward, unaffected by the failed attempt
  const check = verifyTaskLockOwnership({ repoRoot, taskId, ownerToken: acq.ownerToken });
  assert.equal(check.valid, true);
});

test('release of a lock that was never acquired is denied (NO_LOCK_FOUND)', () => {
  const repoRoot = fakeRepo();
  const rel = releaseTaskLock({ repoRoot, taskId: 'never-acquired', ownerToken: 'x'.repeat(64) });
  assert.equal(rel.ok, false);
  assert.equal(rel.reason, 'NO_LOCK_FOUND');
});

test('releasing an already-released lock is denied (NOT_ACTIVE)', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-already-released';
  const acq = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  releaseTaskLock({ repoRoot, taskId, ownerToken: acq.ownerToken });
  const second = releaseTaskLock({ repoRoot, taskId, ownerToken: acq.ownerToken });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'NOT_ACTIVE');
});

test('malformed reservation (empty array, non-string entries, non-repo-relative path) denied', () => {
  const repoRoot = fakeRepo();
  assert.equal(acquireTaskLock({ repoRoot, taskId: 't1', reservedPaths: [], baseSha: BASE_SHA }).ok, false);
  assert.equal(acquireTaskLock({ repoRoot, taskId: 't2', reservedPaths: [42], baseSha: BASE_SHA }).ok, false);
  assert.equal(acquireTaskLock({ repoRoot, taskId: 't3', reservedPaths: ['../../etc/passwd'], baseSha: BASE_SHA }).ok, false);
  assert.equal(acquireTaskLock({ repoRoot, taskId: 't4', reservedPaths: 'not-an-array', baseSha: BASE_SHA }).ok, false);
});

test('malformed task id / base sha denied', () => {
  const repoRoot = fakeRepo();
  assert.equal(acquireTaskLock({ repoRoot, taskId: '', reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA }).reason, 'MALFORMED_TASK_ID');
  assert.equal(acquireTaskLock({ repoRoot, taskId: null, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA }).reason, 'MALFORMED_TASK_ID');
  assert.equal(acquireTaskLock({ repoRoot, taskId: 't1', reservedPaths: ['a/x.mjs'], baseSha: '' }).reason, 'MALFORMED_BASE_SHA');
});

test('corrupted persisted lock file for the SAME task -> HOLD_LOCK_RECOVERY_REQUIRED, never silently overwritten', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-corrupt-self';
  const filePath = resolveTaskLockPath({ repoRoot, taskId });
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, '{ this is not valid JSON', 'utf8');

  const acq = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(acq.ok, false);
  assert.equal(acq.reason, 'HOLD_LOCK_RECOVERY_REQUIRED');

  const rel = releaseTaskLock({ repoRoot, taskId, ownerToken: 'anything' });
  assert.equal(rel.ok, false);
  assert.equal(rel.reason, 'HOLD_LOCK_RECOVERY_REQUIRED');
});

test('corrupted lock file belonging to a DIFFERENT task blocks a new acquisition too (cannot prove absence of conflict)', () => {
  const repoRoot = fakeRepo();
  const dir = resolveTaskLockDir({ repoRoot });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'deadbeef.json'), '{"not":"a valid lock shape"}', 'utf8');

  const acq = acquireTaskLock({ repoRoot, taskId: 'fresh-task', reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(acq.ok, false);
  assert.equal(acq.reason, 'HOLD_LOCK_RECOVERY_REQUIRED');
});

test('no auto-steal: an ACTIVE lock with an old acquired_at timestamp is still ACTIVE and still requires the real owner token', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-stale-timestamp';
  const acq = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA, now: '2000-01-01T00:00:00.000Z' });
  assert.equal(acq.ok, true);
  const stealAttempt = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA, now: '2030-01-01T00:00:00.000Z' });
  assert.equal(stealAttempt.ok, false);
  assert.equal(stealAttempt.reason, 'DOUBLE_ACQUIRE');
});

test('updateTaskLockHeadSha requires exact ownership and updates head_sha', () => {
  const repoRoot = fakeRepo();
  const taskId = 't-update-head';
  const acq = acquireTaskLock({ repoRoot, taskId, reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA, headSha: '' });
  const wrong = updateTaskLockHeadSha({ repoRoot, taskId, ownerToken: 'wrong', headSha: 'c'.repeat(40) });
  assert.equal(wrong.ok, false);
  const right = updateTaskLockHeadSha({ repoRoot, taskId, ownerToken: acq.ownerToken, headSha: 'c'.repeat(40) });
  assert.equal(right.ok, true);
  assert.equal(right.lock.head_sha, 'c'.repeat(40));
});

test('validateTaskLock rejects an extra/unexpected field and any missing field', () => {
  const repoRoot = fakeRepo();
  const acq = acquireTaskLock({ repoRoot, taskId: 't-schema', reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  assert.equal(validateTaskLock({ ...acq.lock, extra_field: 'nope' }), false);
  const { task_id, ...missingTaskId } = acq.lock;
  assert.equal(validateTaskLock(missingTaskId), false);
});

test('listActiveTaskLocks excludes the given taskId and only returns ACTIVE locks', () => {
  const repoRoot = fakeRepo();
  const a = acquireTaskLock({ repoRoot, taskId: 'list-a', reservedPaths: ['a/x.mjs'], baseSha: BASE_SHA });
  acquireTaskLock({ repoRoot, taskId: 'list-b', reservedPaths: ['b/x.mjs'], baseSha: BASE_SHA });
  const c = acquireTaskLock({ repoRoot, taskId: 'list-c', reservedPaths: ['c/x.mjs'], baseSha: BASE_SHA });
  releaseTaskLock({ repoRoot, taskId: 'list-c', ownerToken: c.ownerToken });

  const result = listActiveTaskLocks({ repoRoot, excludeTaskId: 'list-a' });
  assert.equal(result.status, 'OK');
  const ids = result.locks.map((l) => l.task_id).sort();
  assert.deepEqual(ids, ['list-b']); // list-a excluded, list-c released
  void a;
});

// --- Active task slot (MAX_ACTIVE_TASK_EXECUTIONS_IN_CHAT = 1) ---

test('active task slot: acquire, verify, release happy path', () => {
  const repoRoot = fakeRepo();
  const acq = acquireActiveTaskSlot({ repoRoot, taskId: 'slot-task' });
  assert.equal(acq.ok, true);
  const check = verifyActiveTaskSlotOwnership({ repoRoot, taskId: 'slot-task', ownerToken: acq.ownerToken });
  assert.equal(check.valid, true);
  const rel = releaseActiveTaskSlot({ repoRoot, taskId: 'slot-task', ownerToken: acq.ownerToken });
  assert.equal(rel.ok, true);
});

test('active task slot: a second, DIFFERENT task cannot acquire while the first holds it', () => {
  const repoRoot = fakeRepo();
  const first = acquireActiveTaskSlot({ repoRoot, taskId: 'slot-first' });
  assert.equal(first.ok, true);
  const second = acquireActiveTaskSlot({ repoRoot, taskId: 'slot-second' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'ACTIVE_TASK_SLOT_HELD');
});

test('active task slot: after release, a second (different) task CAN acquire it', () => {
  const repoRoot = fakeRepo();
  const first = acquireActiveTaskSlot({ repoRoot, taskId: 'slot-first' });
  releaseActiveTaskSlot({ repoRoot, taskId: 'slot-first', ownerToken: first.ownerToken });
  const second = acquireActiveTaskSlot({ repoRoot, taskId: 'slot-second' });
  assert.equal(second.ok, true);
});

test('active task slot: release with wrong owner or wrong task id denied', () => {
  const repoRoot = fakeRepo();
  const acq = acquireActiveTaskSlot({ repoRoot, taskId: 'slot-owner-check' });
  assert.equal(releaseActiveTaskSlot({ repoRoot, taskId: 'slot-owner-check', ownerToken: 'wrong' }).ok, false);
  assert.equal(releaseActiveTaskSlot({ repoRoot, taskId: 'different-task-id', ownerToken: acq.ownerToken }).ok, false);
});
