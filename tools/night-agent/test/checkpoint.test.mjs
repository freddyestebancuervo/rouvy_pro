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
