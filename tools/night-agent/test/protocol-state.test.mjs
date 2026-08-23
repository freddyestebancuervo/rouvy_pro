// Tests for tools/night-agent/protocol-state.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RISK_CLASSES,
  ROLES,
  PROTOCOL_STATES,
  createProtocolState,
  validateProtocolState,
  advanceProtocolState,
  resolveProtocolStatePath,
  writeProtocolStateAtomic,
  readProtocolState,
} from '../protocol-state.mjs';

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'korixa-protocol-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('createProtocolState produces a valid, freshly-IDLE record', () => {
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40) });
  assert.equal(validateProtocolState(s), true);
  assert.equal(s.state, 'IDLE');
  assert.equal(s.active_role, 'NIGHT');
  assert.equal(s.next_allowed_role, 'A');
  assert.equal(s.head_sha, s.base_sha, 'head starts equal to base for a fresh task');
});

test('validateProtocolState rejects an unexpected extra field (e.g. a smuggled raw log)', () => {
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40) });
  const withExtra = { ...s, raw_stdout_dump: 'lots of text' };
  assert.equal(validateProtocolState(withExtra), false);
});

test('validateProtocolState rejects a missing field', () => {
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40) });
  const { updated_at, ...missing } = s;
  assert.equal(validateProtocolState(missing), false);
});

test('validateProtocolState rejects an invalid role/state/risk value', () => {
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40) });
  assert.equal(validateProtocolState({ ...s, active_role: 'D' }), false);
  assert.equal(validateProtocolState({ ...s, state: 'DONE_WITH_TYPO' }), false);
  assert.equal(validateProtocolState({ ...s, risk_class: 'BLUE' }), false);
});

test('RISK_CLASSES/ROLES/PROTOCOL_STATES are exactly the closed vocabularies the brief specifies', () => {
  assert.deepEqual([...RISK_CLASSES], ['GREEN', 'YELLOW', 'RED']);
  assert.deepEqual([...ROLES], ['NIGHT', 'A', 'B', 'C']);
  assert.deepEqual([...PROTOCOL_STATES], [
    'IDLE', 'PLANNING', 'READY_FOR_A', 'EXECUTING', 'WAITING_CI', 'READY_FOR_B',
    'AUDITING', 'HOLD', 'REMEDIATING', 'READY_FOR_C', 'VALIDATING', 'READY_FOR_HUMAN', 'DONE',
  ]);
});

test('advanceProtocolState refreshes updated_at and applies changes without mutating the input', () => {
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40), now: '2026-01-01T00:00:00.000Z' });
  const next = advanceProtocolState(s, { state: 'PLANNING' }, '2026-01-01T00:05:00.000Z');
  assert.equal(next.state, 'PLANNING');
  assert.equal(next.updated_at, '2026-01-01T00:05:00.000Z');
  assert.equal(s.state, 'IDLE', 'original record must be unmutated');
});

test('advanceProtocolState refuses to produce a malformed record (fail closed, not silently accepted)', () => {
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40) });
  assert.throws(() => advanceProtocolState(s, { state: 'NOT_A_REAL_STATE' }), /validateProtocolState/);
});

test('resolveProtocolStatePath is deterministic per (repoRoot, taskId) and lives OUTSIDE the repo', () => {
  const p1 = resolveProtocolStatePath({ repoRoot: '/fake/repo', taskId: 't1' });
  const p2 = resolveProtocolStatePath({ repoRoot: '/fake/repo', taskId: 't1' });
  const p3 = resolveProtocolStatePath({ repoRoot: '/fake/repo', taskId: 't2' });
  assert.equal(p1, p2);
  assert.notEqual(p1, p3);
  assert.ok(p1.startsWith(tmpdir()) || path.isAbsolute(p1));
  assert.ok(!p1.includes('/fake/repo'), 'the task id/repoRoot must never appear verbatim in the path, only hashed');
});

test('writeProtocolStateAtomic writes atomically (temp-then-rename), leaving no leftover temp file', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'state.json');
  const s = createProtocolState({ taskId: 't1', taskTitle: 'demo', baseSha: 'a'.repeat(40) });
  writeProtocolStateAtomic(filePath, s);
  assert.deepEqual(readdirSync(dir), ['state.json']);
  const read = readProtocolState(filePath);
  assert.deepEqual(read, s);
});

test('writeProtocolStateAtomic refuses to write a malformed record', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'state.json');
  assert.throws(() => writeProtocolStateAtomic(filePath, { garbage: true }), /validateProtocolState/);
});

test('readProtocolState returns null for an absent file, never throws', (t) => {
  const dir = tempDir(t);
  assert.equal(readProtocolState(path.join(dir, 'does-not-exist.json')), null);
});

test('readProtocolState returns null for invalid JSON content (fail closed, not a partial read)', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'state.json');
  writeFileSync(filePath, '{ this is not valid json', 'utf8');
  assert.equal(readProtocolState(filePath), null);
});

test('readProtocolState returns null for well-formed JSON that fails schema validation', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'state.json');
  writeFileSync(filePath, JSON.stringify({ not: 'a real protocol state' }), 'utf8');
  assert.equal(readProtocolState(filePath), null);
});
