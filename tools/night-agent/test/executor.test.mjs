import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  RESTRICTED_AUTONOMOUS_TOOLS,
  buildClaudeArgv,
  containsDangerousBypassFlag,
  assertSafeArgvOrThrow,
  runControlledChild,
} from '../executor.mjs';

// NOTE: this entire file uses a SYNTHETIC fake child process
// (makeFakeChild below) via dependency-injected `spawnFn` — it never spawns
// a real `claude` process, or any real process at all. CLAUDE_AGENT_RUNS
// contributed by this file is always 0.

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

// ---------------------------------------------------------------------------
// buildClaudeArgv
// ---------------------------------------------------------------------------

test('buildClaudeArgv builds the confirmed current CLI contract: -p, --tools, --allowedTools, --permission-mode dontAsk, --max-turns', () => {
  const { command, args } = buildClaudeArgv({ prompt: 'do the task', maxTurns: 5 });
  assert.equal(command, 'claude');
  assert.deepEqual(args, [
    '-p',
    'do the task',
    '--tools',
    RESTRICTED_AUTONOMOUS_TOOLS.join(','),
    '--allowedTools',
    ...RESTRICTED_AUTONOMOUS_TOOLS,
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    '5',
  ]);
});

// NIGHT-V1-C section 5-6: --allowedTools takes each tool name as its OWN
// argv token (confirmed against current official docs — its examples show
// `--allowedTools "Read" "Bash(git log *)"`, never a comma-joined string),
// unlike --tools which takes one comma-joined value. Both express the
// identical restricted set, just in each flag's own native syntax.
test('buildClaudeArgv encodes --allowedTools as separate tokens (not a comma-joined string), one per restricted tool', () => {
  const { args } = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });
  const idx = args.indexOf('--allowedTools');
  assert.ok(idx !== -1);
  assert.deepEqual(args.slice(idx + 1, idx + 1 + RESTRICTED_AUTONOMOUS_TOOLS.length), RESTRICTED_AUTONOMOUS_TOOLS);
  assert.equal(args[idx + 1 + RESTRICTED_AUTONOMOUS_TOOLS.length], '--permission-mode');
});

test('buildClaudeArgv default restricted tool set excludes Bash and every other command-execution-capable tool', () => {
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('Bash'), false);
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('Agent'), false);
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('PowerShell'), false);
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('Monitor'), false);
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('WebFetch'), false);
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('WebSearch'), false);
  assert.equal(RESTRICTED_AUTONOMOUS_TOOLS.includes('NotebookEdit'), false);
});

test('buildClaudeArgv rejects an empty/missing prompt', () => {
  assert.throws(() => buildClaudeArgv({ prompt: '', maxTurns: 5 }));
  assert.throws(() => buildClaudeArgv({ maxTurns: 5 }));
});

test('buildClaudeArgv rejects a non-positive or non-integer maxTurns', () => {
  assert.throws(() => buildClaudeArgv({ prompt: 'x', maxTurns: 0 }));
  assert.throws(() => buildClaudeArgv({ prompt: 'x', maxTurns: -1 }));
  assert.throws(() => buildClaudeArgv({ prompt: 'x', maxTurns: 1.5 }));
});

test('buildClaudeArgv refuses to include Bash even if the caller explicitly passes it in restrictedTools', () => {
  assert.throws(() => buildClaudeArgv({ prompt: 'x', maxTurns: 5, restrictedTools: ['Read', 'Bash'] }));
});

// ---------------------------------------------------------------------------
// containsDangerousBypassFlag / assertSafeArgvOrThrow
// ---------------------------------------------------------------------------

test('containsDangerousBypassFlag detects --dangerously-skip-permissions', () => {
  assert.equal(containsDangerousBypassFlag(['-p', 'x', '--dangerously-skip-permissions']), true);
});

test('containsDangerousBypassFlag detects a bypassPermissions mode value', () => {
  assert.equal(containsDangerousBypassFlag(['--permission-mode', 'bypassPermissions']), true);
});

test('containsDangerousBypassFlag is false for a normal safe argv', () => {
  const { args } = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });
  assert.equal(containsDangerousBypassFlag(args), false);
});

test('assertSafeArgvOrThrow passes for a well-formed argv built by buildClaudeArgv', () => {
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });
  assert.doesNotThrow(() => assertSafeArgvOrThrow(argvSpec));
});

test('assertSafeArgvOrThrow throws when a dangerous bypass flag is present', () => {
  assert.throws(() => assertSafeArgvOrThrow({ command: 'claude', args: ['-p', 'x', '--dangerously-skip-permissions'] }));
});

test('assertSafeArgvOrThrow throws when --tools is missing', () => {
  assert.throws(() => assertSafeArgvOrThrow({ command: 'claude', args: ['-p', 'x', '--permission-mode', 'dontAsk'] }));
});

test('assertSafeArgvOrThrow throws when Bash appears in the --tools value', () => {
  assert.throws(() =>
    assertSafeArgvOrThrow({ command: 'claude', args: ['-p', 'x', '--tools', 'Read,Bash', '--permission-mode', 'dontAsk'] }),
  );
});

test('assertSafeArgvOrThrow throws when --allowedTools is missing entirely', () => {
  assert.throws(() =>
    assertSafeArgvOrThrow({ command: 'claude', args: ['-p', 'x', '--tools', 'Read,Glob,Grep,Write,Edit', '--permission-mode', 'dontAsk'] }),
  );
});

test('assertSafeArgvOrThrow throws when Bash appears in the --allowedTools value', () => {
  assert.throws(() =>
    assertSafeArgvOrThrow({
      command: 'claude',
      args: ['-p', 'x', '--tools', 'Read,Glob,Grep,Write,Edit', '--allowedTools', 'Read', 'Bash', '--permission-mode', 'dontAsk'],
    }),
  );
});

test('assertSafeArgvOrThrow throws when --allowedTools expresses a DIFFERENT set than --tools', () => {
  assert.throws(() =>
    assertSafeArgvOrThrow({
      command: 'claude',
      args: ['-p', 'x', '--tools', 'Read,Glob,Grep,Write,Edit', '--allowedTools', 'Read', 'Glob', '--permission-mode', 'dontAsk'],
    }),
  );
});

test('assertSafeArgvOrThrow throws when --allowedTools is a subset of --tools (must be the exact same set, not merely no extra tools)', () => {
  assert.throws(() =>
    assertSafeArgvOrThrow({
      command: 'claude',
      args: ['-p', 'x', '--tools', 'Read,Glob,Grep,Write,Edit', '--allowedTools', 'Read', 'Glob', 'Grep', 'Write', '--permission-mode', 'dontAsk'],
    }),
  );
});

test('assertSafeArgvOrThrow passes when --allowedTools expresses the exact same set as --tools regardless of order', () => {
  assert.doesNotThrow(() =>
    assertSafeArgvOrThrow({
      command: 'claude',
      args: ['-p', 'x', '--tools', 'Read,Glob,Grep,Write,Edit', '--allowedTools', 'Edit', 'Write', 'Grep', 'Glob', 'Read', '--permission-mode', 'dontAsk'],
    }),
  );
});

test('assertSafeArgvOrThrow throws when --permission-mode is missing or not dontAsk', () => {
  assert.throws(() => assertSafeArgvOrThrow({ command: 'claude', args: ['-p', 'x', '--tools', 'Read'] }));
  assert.throws(() =>
    assertSafeArgvOrThrow({ command: 'claude', args: ['-p', 'x', '--tools', 'Read', '--permission-mode', 'acceptEdits'] }),
  );
});

// ---------------------------------------------------------------------------
// runControlledChild — synthetic fake child processes only, dependency-
// injected via spawnFn. Never a real spawn.
// ---------------------------------------------------------------------------

test('runControlledChild: successful close with exit code 0 resolves PASS with captured stdout', async () => {
  const child = makeFakeChild();
  const spawnFn = () => child;
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });

  const resultPromise = runControlledChild({ argvSpec, cwd: '/fake', env: {}, timeoutMs: 5000, inactivityTimeoutMs: 5000, spawnFn });
  child.stdout.emit('data', Buffer.from('hello'));
  child.emit('close', 0);
  const result = await resultPromise;

  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'hello');
});

test('runControlledChild: nonzero exit code resolves NONZERO_EXIT', async () => {
  const child = makeFakeChild();
  const spawnFn = () => child;
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });

  const resultPromise = runControlledChild({ argvSpec, cwd: '/fake', env: {}, timeoutMs: 5000, inactivityTimeoutMs: 5000, spawnFn });
  child.emit('close', 1);
  const result = await resultPromise;

  assert.equal(result.status, 'NONZERO_EXIT');
  assert.equal(result.exitCode, 1);
});

test('runControlledChild: a child that never closes is killed and classified TIMEOUT once the hard timeout elapses', async () => {
  const child = makeFakeChild();
  const spawnFn = () => child;
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });

  const result = await runControlledChild({ argvSpec, cwd: '/fake', env: {}, timeoutMs: 50, inactivityTimeoutMs: 5000, spawnFn });

  assert.equal(result.status, 'TIMEOUT');
  assert.equal(child.killed, true);
});

test('runControlledChild: a child with no activity is killed and classified INACTIVITY_TIMEOUT before the hard timeout', async () => {
  const child = makeFakeChild();
  const spawnFn = () => child;
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });

  const result = await runControlledChild({ argvSpec, cwd: '/fake', env: {}, timeoutMs: 10000, inactivityTimeoutMs: 50, spawnFn });

  assert.equal(result.status, 'INACTIVITY_TIMEOUT');
  assert.equal(child.killed, true);
});

test('runControlledChild: an "error" event resolves ERROR rather than hanging', async () => {
  const child = makeFakeChild();
  const spawnFn = () => child;
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });

  const resultPromise = runControlledChild({ argvSpec, cwd: '/fake', env: {}, timeoutMs: 5000, inactivityTimeoutMs: 5000, spawnFn });
  child.emit('error', new Error('ENOENT'));
  const result = await resultPromise;

  assert.equal(result.status, 'ERROR');
});

test('runControlledChild: spawnFn is invoked with shell:false and the exact argv command/args', async () => {
  const child = makeFakeChild();
  let capturedCommand;
  let capturedArgs;
  let capturedOptions;
  const spawnFn = (command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return child;
  };
  const argvSpec = buildClaudeArgv({ prompt: 'x', maxTurns: 5 });

  const resultPromise = runControlledChild({ argvSpec, cwd: '/fake/cwd', env: { FOO: 'bar' }, timeoutMs: 5000, inactivityTimeoutMs: 5000, spawnFn });
  child.emit('close', 0);
  await resultPromise;

  assert.equal(capturedCommand, 'claude');
  assert.deepEqual(capturedArgs, argvSpec.args);
  assert.equal(capturedOptions.shell, false);
  assert.equal(capturedOptions.cwd, '/fake/cwd');
  assert.deepEqual(capturedOptions.env, { FOO: 'bar' });
});

test('runControlledChild: a dangerous argv is rejected before spawnFn is ever called (spawnFn never invoked)', async () => {
  let spawnCalled = false;
  const spawnFn = () => {
    spawnCalled = true;
    return makeFakeChild();
  };
  const dangerousArgvSpec = { command: 'claude', args: ['-p', 'x', '--dangerously-skip-permissions'] };

  assert.throws(() =>
    runControlledChild({ argvSpec: dangerousArgvSpec, cwd: '/fake', env: {}, timeoutMs: 5000, inactivityTimeoutMs: 5000, spawnFn }),
  );
  assert.equal(spawnCalled, false, 'spawnFn must never be invoked for a dangerous argv — REAL_CHILD_SPAWN must stay 0 even on a rejected call');
});
