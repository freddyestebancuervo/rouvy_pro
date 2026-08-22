// Real-fixture-only tests for tools/night-agent/notify.mjs. No mocks of
// the module under test itself — real function calls, real (injected,
// never actually executed) spawnSync fakes, real closed-allowlist
// verification. No test in this file ever invokes the real `gh` CLI or
// makes any real network/Slack call.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { notifySlackBestEffort, buildNotificationMessage, NOTIFICATION_LABELS } from '../notify.mjs';

function neverCalledSpawnSyncFn() {
  throw new Error('spawnSyncFn must never be called for this scenario');
}

function recordingSpawnSyncFn(calls, { status = 0, error = undefined } = {}) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status, error, stdout: '', stderr: '' };
  };
}

// =============================================================================
// Disabled-by-default gate (KORIXA_NIGHT_SLACK_NOTIFY)
// =============================================================================

test('DISABLED_BY_DEFAULT: envValue omitted -> zero subprocess calls, attempted=false', () => {
  const result = notifySlackBestEffort({ label: 'START', fields: { taskId: 'x' }, spawnSyncFn: neverCalledSpawnSyncFn });
  assert.equal(result.attempted, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'DISABLED');
});

test('DISABLED: envValue explicitly "0" -> zero subprocess calls', () => {
  const result = notifySlackBestEffort({ label: 'START', envValue: '0', spawnSyncFn: neverCalledSpawnSyncFn });
  assert.equal(result.attempted, false);
});

test('DISABLED: envValue "true" (not the exact string "1") -> zero subprocess calls', () => {
  const result = notifySlackBestEffort({ label: 'START', envValue: 'true', spawnSyncFn: neverCalledSpawnSyncFn });
  assert.equal(result.attempted, false);
});

test('DISABLED: envValue undefined explicitly passed -> zero subprocess calls', () => {
  const result = notifySlackBestEffort({ label: 'START', envValue: undefined, spawnSyncFn: neverCalledSpawnSyncFn });
  assert.equal(result.attempted, false);
});

test('CLI_DEFAULT_SAFETY: notifySlackBestEffort() with no arguments at all does not throw and does not attempt', () => {
  const result = notifySlackBestEffort();
  assert.equal(result.attempted, false);
  assert.equal(result.reason, 'DISABLED');
});

// =============================================================================
// Enabled path — real (injected) spawnSyncFn behavior
// =============================================================================

test('ENABLED: envValue="1" with a successful fake gh call -> attempted=true, ok=true', () => {
  const calls = [];
  const result = notifySlackBestEffort({
    label: 'START', envValue: '1', fields: { taskId: 't1', attempt: 1 }, spawnSyncFn: recordingSpawnSyncFn(calls, { status: 0 }),
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test('AUTHORIZED_WORKFLOW_ONLY: the spawned command is exactly gh workflow run night-agent-slack-bridge.yml --ref main -f message=... -- never any other gh subcommand, never a direct webhook call', () => {
  const calls = [];
  notifySlackBestEffort({ label: 'CHECKPOINT', envValue: '1', fields: { taskId: 't1', state: 'VERIFYING' }, spawnSyncFn: recordingSpawnSyncFn(calls, { status: 0 }) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 4), ['workflow', 'run', 'night-agent-slack-bridge.yml', '--ref']);
  assert.equal(calls[0].args[4], 'main');
  assert.equal(calls[0].args[5], '-f');
  assert.ok(calls[0].args[6].startsWith('message='));
  assert.equal(calls[0].opts.shell, false, 'must never use a shell -- message content must never be shell-interpreted');
});

test('FAILURE_ABSORBED: a non-zero gh exit status is absorbed -- ok=false, no throw', () => {
  const result = notifySlackBestEffort({ label: 'BLOCKED', envValue: '1', spawnSyncFn: recordingSpawnSyncFn([], { status: 1 }) });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
});

test('FAILURE_ABSORBED: spawnSyncFn result carrying a timeout/ETIMEDOUT-shaped error is absorbed -- ok=false, no throw', () => {
  const result = notifySlackBestEffort({
    label: 'END', envValue: '1', spawnSyncFn: recordingSpawnSyncFn([], { status: null, error: new Error('ETIMEDOUT') }),
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
});

test('FAILURE_ABSORBED: spawnSyncFn itself throwing (e.g. gh not installed, ENOENT) is caught -- never propagates', () => {
  assert.doesNotThrow(() => {
    const result = notifySlackBestEffort({
      label: 'END', envValue: '1', spawnSyncFn: () => { throw new Error('ENOENT: gh not found'); },
    });
    assert.equal(result.attempted, true);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'SPAWN_THREW');
  });
});

test('TIMEOUT_CONFIGURED: a short, explicit timeout is passed through to spawnSyncFn options', () => {
  const calls = [];
  notifySlackBestEffort({ label: 'START', envValue: '1', timeoutMs: 2000, spawnSyncFn: recordingSpawnSyncFn(calls, { status: 0 }) });
  assert.equal(calls[0].opts.timeout, 2000);
});

// =============================================================================
// Message construction — closed allowlist
// =============================================================================

test('ALLOWLIST: only allowlisted fields ever appear in the built message', () => {
  const msg = buildNotificationMessage('START', {
    taskId: 'abc123', state: 'RUNNING', attempt: 2, timestamp: '2026-08-22T00:00:00Z', realChildSpawn: 1, exitCodeFamily: 0,
  });
  assert.ok(msg.includes('taskId=abc123'));
  assert.ok(msg.includes('state=RUNNING'));
  assert.ok(msg.includes('attempt=2'));
  assert.ok(msg.includes('timestamp=2026-08-22T00:00:00Z'));
  assert.ok(msg.includes('realChildSpawn=1'));
  assert.ok(msg.includes('exitCodeFamily=0'));
});

test('ALLOWLIST: a forbidden field (stdout) is silently dropped, never appears in the message', () => {
  const msg = buildNotificationMessage('END', { taskId: 't', stdout: 'SECRET_LEAKED_CONTENT_SHOULD_NOT_APPEAR' });
  assert.ok(!msg.includes('SECRET_LEAKED_CONTENT_SHOULD_NOT_APPEAR'));
  assert.ok(!msg.includes('stdout'));
});

test('ALLOWLIST: forbidden fields (prompt, objective, envVars, webhookUrl, token, secret, filePath) are all silently dropped', () => {
  const msg = buildNotificationMessage('BLOCKED', {
    taskId: 't',
    prompt: 'do something secret',
    objective: 'sensitive task description',
    envVars: { SECRET: 'value' },
    webhookUrl: 'https://hooks.slack.com/services/FAKE/FAKE/FAKE',
    token: 'gho_faketoken1234567890',
    secret: 'super-secret-value',
    filePath: 'C:/Users/someone/.ssh/id_rsa',
  });
  for (const forbidden of ['prompt', 'objective', 'envVars', 'webhookUrl', 'token', 'secret', 'filePath', 'hooks.slack.com', 'gho_faketoken', 'id_rsa']) {
    assert.ok(!msg.includes(forbidden), `forbidden content "${forbidden}" leaked into message: ${msg}`);
  }
});

test('ALLOWLIST: a full raw object dumped via a non-allowlisted key never leaks through JSON.stringify-shaped content', () => {
  const msg = buildNotificationMessage('END', { taskId: 't', internalState: { KORIXA_NIGHT_POLICY_FILE: '/tmp/secret-policy.json', raw: 'everything' } });
  assert.ok(!msg.includes('KORIXA_NIGHT_POLICY_FILE'));
  assert.ok(!msg.includes('secret-policy'));
});

test('ALLOWLIST: undefined/null allowlisted fields are omitted entirely, not printed as "undefined"/"null"', () => {
  const msg = buildNotificationMessage('START', { taskId: 't1', state: undefined, attempt: null });
  assert.ok(msg.includes('taskId=t1'));
  assert.ok(!msg.includes('state=undefined'));
  assert.ok(!msg.includes('attempt=null'));
});

test('LABEL_VALIDATION: an unknown label throws inside buildNotificationMessage directly', () => {
  assert.throws(() => buildNotificationMessage('NOT_A_REAL_LABEL', {}));
});

test('LABEL_VALIDATION: notifySlackBestEffort absorbs an unknown-label failure -- never throws to the caller', () => {
  assert.doesNotThrow(() => {
    const result = notifySlackBestEffort({ label: 'NOT_A_REAL_LABEL', envValue: '1', spawnSyncFn: neverCalledSpawnSyncFn });
    assert.equal(result.attempted, false);
    assert.equal(result.reason, 'BUILD_MESSAGE_FAILED');
  });
});

test('NOTIFICATION_LABELS is the closed set START/CHECKPOINT/BLOCKED/END', () => {
  assert.deepEqual(NOTIFICATION_LABELS, ['START', 'CHECKPOINT', 'BLOCKED', 'END']);
});

test('no field named "fields" itself (or any other non-allowlisted structural key) leaks through', () => {
  const msg = buildNotificationMessage('CHECKPOINT', { taskId: 't', __proto__: { polluted: true }, constructor: 'x' });
  assert.ok(!msg.includes('polluted'));
  assert.ok(!msg.includes('constructor=x'));
});
