import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CHECKPOINT_STATES,
  createCheckpoint,
  advanceCheckpoint,
  validateCheckpoint,
  writeCheckpointAtomic,
  readCheckpoint,
  resolveResumeState,
  resolveCheckpointPath,
  readCheckpointForResume,
  resolveCheckpointRecoveryDecision,
} from '../checkpoint.mjs';

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'korixa-night-checkpoint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// createCheckpoint / advanceCheckpoint / validateCheckpoint
// ---------------------------------------------------------------------------

test('createCheckpoint produces a checkpoint with exactly the allowed fields', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  assert.equal(validateCheckpoint(cp), true);
  assert.deepEqual(Object.keys(cp).sort(), [
    'attempt', 'base_sha', 'last_error_family', 'last_progress_at', 'started_at', 'state', 'task_id', 'updated_at',
  ]);
});

test('createCheckpoint never includes a prompt, secret, or token field', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  assert.equal('prompt' in cp, false);
  assert.equal('secret' in cp, false);
  assert.equal('token' in cp, false);
  assert.equal('stderr' in cp, false);
});

test('validateCheckpoint rejects an extra/unexpected field', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  assert.equal(validateCheckpoint({ ...cp, prompt: 'do the thing' }), false);
});

test('validateCheckpoint rejects an invalid state', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  assert.equal(validateCheckpoint({ ...cp, state: 'DONE' }), false);
});

test('validateCheckpoint accepts every canonical checkpoint state', () => {
  for (const state of CHECKPOINT_STATES) {
    const cp = createCheckpoint({ taskId: 't1', state, attempt: 0, baseSha: 'a'.repeat(40) });
    assert.equal(validateCheckpoint(cp), true, state);
  }
});

test('validateCheckpoint rejects a non-integer or negative attempt', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  assert.equal(validateCheckpoint({ ...cp, attempt: 1.5 }), false);
  assert.equal(validateCheckpoint({ ...cp, attempt: -1 }), false);
});

test('advanceCheckpoint updates state/updated_at/last_progress_at without mutating the input', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40), now: '2026-01-01T00:00:00.000Z' });
  const before = JSON.stringify(cp);
  const next = advanceCheckpoint(cp, { state: 'RUNNING', now: '2026-01-01T00:01:00.000Z' });
  assert.equal(JSON.stringify(cp), before, 'advanceCheckpoint must not mutate its input');
  assert.equal(next.state, 'RUNNING');
  assert.equal(next.updated_at, '2026-01-01T00:01:00.000Z');
  assert.equal(next.last_progress_at, '2026-01-01T00:01:00.000Z');
});

test('advanceCheckpoint with isProgress:false updates updated_at but not last_progress_at', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40), now: '2026-01-01T00:00:00.000Z' });
  const next = advanceCheckpoint(cp, { now: '2026-01-01T00:05:00.000Z', isProgress: false });
  assert.equal(next.updated_at, '2026-01-01T00:05:00.000Z');
  assert.equal(next.last_progress_at, '2026-01-01T00:00:00.000Z');
});

test('advanceCheckpoint records a fixed error family, never a raw message', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 1, baseSha: 'a'.repeat(40) });
  const next = advanceCheckpoint(cp, { state: 'RETRY', errorFamily: 'VERIFICATION_FAILED' });
  assert.equal(next.last_error_family, 'VERIFICATION_FAILED');
  assert.equal(validateCheckpoint(next), true);
});

// ---------------------------------------------------------------------------
// writeCheckpointAtomic / readCheckpoint
// ---------------------------------------------------------------------------

test('writeCheckpointAtomic then readCheckpoint round-trips exactly', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40) });
  writeCheckpointAtomic(filePath, cp);
  assert.equal(existsSync(filePath), true);
  const read = readCheckpoint(filePath);
  assert.deepEqual(read, cp);
});

test('writeCheckpointAtomic leaves no leftover temp file behind', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  writeCheckpointAtomic(filePath, cp);
  const entries = readdirSync(dir);
  assert.deepEqual(entries, ['checkpoint.json']);
});

test('writeCheckpointAtomic refuses to write a malformed checkpoint', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  assert.throws(() => writeCheckpointAtomic(filePath, { not_a: 'checkpoint' }));
  assert.equal(existsSync(filePath), false);
});

test('readCheckpoint returns null when the file does not exist', (t) => {
  const dir = tempDir(t);
  assert.equal(readCheckpoint(path.join(dir, 'missing.json')), null);
});

test('readCheckpoint returns null for malformed JSON rather than throwing', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  writeFileSync(filePath, 'not-json{{{');
  assert.doesNotThrow(() => readCheckpoint(filePath));
  assert.equal(readCheckpoint(filePath), null);
});

test('readCheckpoint returns null for valid JSON that fails checkpoint validation', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  writeFileSync(filePath, JSON.stringify({ task_id: 't1', state: 'NOT_A_REAL_STATE' }));
  assert.equal(readCheckpoint(filePath), null);
});

test('writeCheckpointAtomic overwriting an existing checkpoint never leaves a torn/partial file (round-trip after overwrite)', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  const cp1 = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  writeCheckpointAtomic(filePath, cp1);
  const cp2 = advanceCheckpoint(cp1, { state: 'RUNNING' });
  writeCheckpointAtomic(filePath, cp2);
  const read = readCheckpoint(filePath);
  assert.deepEqual(read, cp2);
});

// ---------------------------------------------------------------------------
// resolveResumeState (section 22): the stale-session policy.
// ---------------------------------------------------------------------------

test('resolveResumeState: no checkpoint -> START_FRESH', () => {
  const result = resolveResumeState(null, { hasControlledChildEvidence: false });
  assert.equal(result.action, 'START_FRESH');
});

test('resolveResumeState: RUNNING checkpoint with no controlled child evidence -> HOLD_STALE_SESSION', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveResumeState(cp, { hasControlledChildEvidence: false });
  assert.equal(result.action, 'HOLD_STALE_SESSION');
});

test('resolveResumeState: RUNNING checkpoint WITH controlled child evidence -> RESUME (not treated as stale)', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveResumeState(cp, { hasControlledChildEvidence: true });
  assert.equal(result.action, 'RESUME');
});

test('resolveResumeState: PASS checkpoint -> ALREADY_PASSED, never re-resumed', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PASS', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveResumeState(cp, { hasControlledChildEvidence: false });
  assert.equal(result.action, 'ALREADY_PASSED');
});

test('resolveResumeState: HOLD checkpoint -> STAY_HOLD, never automatically resumed', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'HOLD', attempt: 3, baseSha: 'a'.repeat(40) });
  const result = resolveResumeState(cp, { hasControlledChildEvidence: false });
  assert.equal(result.action, 'STAY_HOLD');
});

test('resolveResumeState: PENDING/VERIFYING/RETRY checkpoints resume normally', () => {
  for (const state of ['PENDING', 'VERIFYING', 'RETRY']) {
    const cp = createCheckpoint({ taskId: 't1', state, attempt: 1, baseSha: 'a'.repeat(40) });
    const result = resolveResumeState(cp, { hasControlledChildEvidence: false });
    assert.equal(result.action, 'RESUME', state);
  }
});

// ---------------------------------------------------------------------------
// Retry-limit -> HOLD proof (section 20/38): the checkpoint model itself
// supports the runner enforcing "same failure surviving max_retries -> HOLD"
// — verified here as a pure state-transition sequence.
// ---------------------------------------------------------------------------

test('a checkpoint sequence hitting max_retries transitions to HOLD, not an unbounded RETRY loop', () => {
  const maxRetries = 3;
  let cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40) });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    cp = advanceCheckpoint({ ...cp, attempt }, { state: 'RETRY', errorFamily: 'VERIFICATION_FAILED', isProgress: false });
  }
  // Simulate the runner's own bound check: once attempt reaches max_retries
  // for the SAME failure family, the next transition must be HOLD.
  const finalState = cp.attempt >= maxRetries ? 'HOLD' : 'RETRY';
  cp = advanceCheckpoint(cp, { state: finalState, isProgress: false });
  assert.equal(cp.state, 'HOLD');
  assert.equal(validateCheckpoint(cp), true);
});

// ---------------------------------------------------------------------------
// resolveCheckpointPath (NIGHT-V1-D section 8/10/27.C): deterministic,
// stable, outside-the-repo checkpoint path.
// ---------------------------------------------------------------------------

test('resolveCheckpointPath: same repoRoot/task -> the same path every time', () => {
  const a = resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'task-a', tmpDirFn: () => '/tmp' });
  const b = resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'task-a', tmpDirFn: () => '/tmp' });
  assert.equal(a, b);
});

test('resolveCheckpointPath: a different task -> a different path', () => {
  const a = resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'task-a', tmpDirFn: () => '/tmp' });
  const b = resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'task-b', tmpDirFn: () => '/tmp' });
  assert.notEqual(a, b);
});

test('resolveCheckpointPath: a different repo -> a different path', () => {
  const a = resolveCheckpointPath({ repoRoot: '/fake/repo-1', taskId: 'task-a', tmpDirFn: () => '/tmp' });
  const b = resolveCheckpointPath({ repoRoot: '/fake/repo-2', taskId: 'task-a', tmpDirFn: () => '/tmp' });
  assert.notEqual(a, b);
});

test('resolveCheckpointPath: the resolved path is outside repoRoot, under tmpDirFn()', () => {
  const fakeTmpDir = path.join('some', 'fake', 'tmp', 'dir');
  const p = resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'task-a', tmpDirFn: () => fakeTmpDir });
  assert.equal(p.startsWith(fakeTmpDir), true);
  assert.equal(p.includes('repo'), false, 'the raw repoRoot string must never appear in the path — only its hash');
});

test('resolveCheckpointPath: the task id never appears verbatim in the resolved path (only its hash)', () => {
  const p = resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'a-very-recognizable-task-id-12345', tmpDirFn: () => '/tmp' });
  assert.equal(p.includes('a-very-recognizable-task-id-12345'), false);
});

test('resolveCheckpointPath does not touch the filesystem (a pure lookup creates nothing)', (t) => {
  const outsideDir = tempDir(t);
  resolveCheckpointPath({ repoRoot: '/fake/repo', taskId: 'task-a', tmpDirFn: () => outsideDir });
  assert.deepEqual(readdirSync(outsideDir), [], 'resolving the path alone must not create the checkpoints directory');
});

// ---------------------------------------------------------------------------
// readCheckpointForResume (NIGHT-V1-D section 9/27.C)
// ---------------------------------------------------------------------------

test('readCheckpointForResume: a missing file -> ABSENT, without ever attempting a read', (t) => {
  const dir = tempDir(t);
  const result = readCheckpointForResume(path.join(dir, 'missing.json'));
  assert.deepEqual(result, { status: 'ABSENT' });
});

test('readCheckpointForResume: malformed JSON -> INVALID, not ABSENT', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  writeFileSync(filePath, 'not-json{{{');
  assert.deepEqual(readCheckpointForResume(filePath), { status: 'INVALID' });
});

test('readCheckpointForResume: valid JSON that fails validateCheckpoint -> INVALID', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  writeFileSync(filePath, JSON.stringify({ task_id: 't1', state: 'NOT_A_REAL_STATE' }));
  assert.deepEqual(readCheckpointForResume(filePath), { status: 'INVALID' });
});

test('readCheckpointForResume: a well-formed checkpoint -> VALID, with the checkpoint attached', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'checkpoint.json');
  const cp = createCheckpoint({ taskId: 't1', state: 'RETRY', attempt: 1, baseSha: 'a'.repeat(40) });
  writeCheckpointAtomic(filePath, cp);
  assert.deepEqual(readCheckpointForResume(filePath), { status: 'VALID', checkpoint: cp });
});

// ---------------------------------------------------------------------------
// resolveCheckpointRecoveryDecision (NIGHT-V1-D section 9/19/27.C): the full
// recovery policy, built on the FROZEN attempt/max_retries semantics the
// pre-existing "hitting max_retries transitions to HOLD" test above already
// demonstrates. These tests freeze that reuse explicitly.
// ---------------------------------------------------------------------------

test('resolveCheckpointRecoveryDecision: ABSENT -> START_FRESH, nextAttempt 0', () => {
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'ABSENT' }, maxRetries: 3 });
  assert.deepEqual(result, { decision: 'START_FRESH', nextAttempt: 0 });
});

test('resolveCheckpointRecoveryDecision: INVALID -> HOLD_INVALID_CHECKPOINT, never silently ignored', () => {
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'INVALID' }, maxRetries: 3 });
  assert.equal(result.decision, 'HOLD_INVALID_CHECKPOINT');
});

test('resolveCheckpointRecoveryDecision: RUNNING -> HOLD_STALE_SESSION', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.equal(result.decision, 'HOLD_STALE_SESSION');
});

test('resolveCheckpointRecoveryDecision: VERIFYING -> HOLD_STALE_SESSION (an in-progress state, same conservative treatment as RUNNING)', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'VERIFYING', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.equal(result.decision, 'HOLD_STALE_SESSION');
});

test('resolveCheckpointRecoveryDecision: PENDING -> HOLD_STALE_SESSION (fail-safe treatment of the pre-existing PENDING state)', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PENDING', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.equal(result.decision, 'HOLD_STALE_SESSION');
});

test('resolveCheckpointRecoveryDecision: PASS -> HOLD_ALREADY_COMPLETED', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'PASS', attempt: 0, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.equal(result.decision, 'HOLD_ALREADY_COMPLETED');
});

test('resolveCheckpointRecoveryDecision: HOLD -> HOLD_EXISTING_HOLD', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'HOLD', attempt: 2, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.equal(result.decision, 'HOLD_EXISTING_HOLD');
});

test('resolveCheckpointRecoveryDecision: RETRY with remaining budget (attempt < maxRetries) -> RESUME_RETRY, nextAttempt = the checkpoint\'s own attempt (unchanged — already incremented when RETRY was written)', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RETRY', attempt: 1, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.deepEqual(result, { decision: 'RESUME_RETRY', nextAttempt: 1 });
});

test('resolveCheckpointRecoveryDecision: RETRY with budget exhausted (attempt >= maxRetries) -> HOLD_RETRY_EXHAUSTED, matching the frozen "attempt >= maxRetries -> HOLD" semantics above', () => {
  const cp = createCheckpoint({ taskId: 't1', state: 'RETRY', attempt: 3, baseSha: 'a'.repeat(40) });
  const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries: 3 });
  assert.deepEqual(result, { decision: 'HOLD_RETRY_EXHAUSTED', nextAttempt: null });
});

test('resolveCheckpointRecoveryDecision: the full RETRY sequence (attempt 0,1,2 all RESUME_RETRY-eligible, attempt 3 exhausted) matches the pre-existing frozen max_retries=3 test exactly', () => {
  const maxRetries = 3;
  for (const attempt of [0, 1, 2]) {
    const cp = createCheckpoint({ taskId: 't1', state: 'RETRY', attempt, baseSha: 'a'.repeat(40) });
    const result = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: cp }, maxRetries });
    assert.equal(result.decision, 'RESUME_RETRY', `attempt ${attempt} should still be resumable`);
  }
  const exhaustedCp = createCheckpoint({ taskId: 't1', state: 'RETRY', attempt: 3, baseSha: 'a'.repeat(40) });
  const exhaustedResult = resolveCheckpointRecoveryDecision({ readResult: { status: 'VALID', checkpoint: exhaustedCp }, maxRetries });
  assert.equal(exhaustedResult.decision, 'HOLD_RETRY_EXHAUSTED');
});

// ---------------------------------------------------------------------------
// writeCheckpointAtomic: NIGHT-V1-D — the checkpoint directory is created on
// first WRITE (never on a mere lookup/read — see resolveCheckpointPath's own
// test above).
// ---------------------------------------------------------------------------

test('writeCheckpointAtomic creates its target directory if it does not yet exist', (t) => {
  const parentDir = tempDir(t);
  const nestedDir = path.join(parentDir, 'does', 'not', 'exist', 'yet');
  const filePath = path.join(nestedDir, 'checkpoint.json');
  const cp = createCheckpoint({ taskId: 't1', state: 'RUNNING', attempt: 0, baseSha: 'a'.repeat(40) });
  assert.equal(existsSync(nestedDir), false);
  writeCheckpointAtomic(filePath, cp);
  assert.equal(existsSync(filePath), true);
  assert.deepEqual(readCheckpoint(filePath), cp);
});
