import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isRepoRelativePath,
  pathsOverlap,
  isPathWithinScope,
  isCriticalControlPlanePath,
  realpathContainment,
  hasUnsafeSymlinkComponent,
  isSafeWriteTarget,
  isSafeReadTarget,
} from '../path-safety.mjs';

// NOTE: this file exercises real filesystem behavior (realpathContainment,
// hasUnsafeSymlinkComponent) against a fully SYNTHETIC repo built fresh
// under the OS temp directory for each test that needs one (see
// makeSyntheticRepo() below) — never against the real repository, this
// worktree, the A worktree, or root. Each test removes only the exact temp
// directory it created, in `t.after`.

// ---------------------------------------------------------------------------
// isRepoRelativePath — canonicalization (sections 15-20).
// ---------------------------------------------------------------------------

test('isRepoRelativePath rejects a leading "./" alias', () => {
  assert.equal(isRepoRelativePath('./backend'), false);
});

test('isRepoRelativePath rejects a double-slash alias', () => {
  assert.equal(isRepoRelativePath('backend//src'), false);
});

test('isRepoRelativePath rejects a "/./ " dot-segment alias', () => {
  assert.equal(isRepoRelativePath('backend/./src'), false);
});

test('isRepoRelativePath rejects a trailing slash unconditionally (no R4-era exception)', () => {
  assert.equal(isRepoRelativePath('backend/'), false);
});

test('isRepoRelativePath rejects a Windows backslash separator', () => {
  assert.equal(isRepoRelativePath('backend\\src'), false);
});

test('isRepoRelativePath accepts ordinary canonical paths and recognized globs', () => {
  assert.equal(isRepoRelativePath('backend'), true);
  assert.equal(isRepoRelativePath('backend/src/main.ts'), true);
  assert.equal(isRepoRelativePath('tools/night-agent/**'), true);
  assert.equal(isRepoRelativePath('*'), true);
  assert.equal(isRepoRelativePath('**'), true);
  assert.equal(isRepoRelativePath('**/*'), true);
});

// ---------------------------------------------------------------------------
// Windows reserved device names (section 8, 20).
// ---------------------------------------------------------------------------

const WINDOWS_RESERVED_DENY = ['CON', 'con.txt', 'backend/NUL', 'backend/aux.json', 'COM1.log', 'foo/Lpt9.txt', 'PRN', 'prn', 'LPT1', 'COM9'];
for (const p of WINDOWS_RESERVED_DENY) {
  test(`isRepoRelativePath rejects Windows reserved device name: ${p}`, () => {
    assert.equal(isRepoRelativePath(p), false);
  });
}

test('isRepoRelativePath does not falsely reject ordinary names that merely contain a reserved substring', () => {
  // "console.test.mjs" contains "CON" as a substring but its first
  // dot-delimited segment is "console", not "CON" — must remain valid.
  assert.equal(isRepoRelativePath('console.test.mjs'), true);
  assert.equal(isRepoRelativePath('backend/auxiliary.ts'), true);
});

// ---------------------------------------------------------------------------
// Critical control-plane paths (section 12).
// ---------------------------------------------------------------------------

const CRITICAL_PATHS = [
  '.claude/settings.json',
  '.claude/hooks/night-guard.mjs',
  'tools/night-agent/queue.mjs',
  'tools/night-agent/test/queue.test.mjs',
  '.github/workflows/ci.yml',
  '.git/config',
  '.gitattributes',
  '.gitmodules',
  'package.json',
  'package-lock.json',
  'pubspec.yaml',
  'pubspec.lock',
];
for (const p of CRITICAL_PATHS) {
  test(`isCriticalControlPlanePath denies: ${p}`, () => {
    assert.equal(isCriticalControlPlanePath(p), true);
  });
}

test('isCriticalControlPlanePath does not flag ordinary repo paths', () => {
  assert.equal(isCriticalControlPlanePath('backend/src/main.ts'), false);
  assert.equal(isCriticalControlPlanePath('examples/fixture-only.test.mjs'), false);
});

// ---------------------------------------------------------------------------
// isPathWithinScope (task-scope containment).
// ---------------------------------------------------------------------------

test('isPathWithinScope: target within a glob-prefix scope', () => {
  assert.equal(isPathWithinScope('examples/fixture/a.txt', ['examples/fixture/**']), true);
});

test('isPathWithinScope: target outside every scope entry', () => {
  assert.equal(isPathWithinScope('backend/a.txt', ['examples/fixture/**']), false);
});

test('isPathWithinScope: empty scope list never contains anything', () => {
  assert.equal(isPathWithinScope('examples/fixture/a.txt', []), false);
});

// ---------------------------------------------------------------------------
// pathsOverlap — case-folding + bare-directory ancestor (carried forward).
// ---------------------------------------------------------------------------

test('pathsOverlap: Windows case-insensitive conflict detection', () => {
  assert.equal(pathsOverlap('Backend', 'backend/src/main.ts'), true);
});

test('pathsOverlap: bare-directory ancestor still works from path-safety.mjs', () => {
  assert.equal(pathsOverlap('backend', 'backend/src/main.ts'), true);
  assert.equal(pathsOverlap('backend', 'backend2/src/main.ts'), false);
});

// ---------------------------------------------------------------------------
// Real filesystem tests: realpathContainment / hasUnsafeSymlinkComponent /
// isSafeWriteTarget / isSafeReadTarget.
//
// RECOVERY NOTE: these were originally fixtured under this real repo's own
// tools/night-agent/test/ directory, which is itself a critical
// control-plane path (section 12) — every "allow" case incorrectly denied
// with CRITICAL_CONTROL_PLANE_PATH. The fix is NOT to weaken
// isCriticalControlPlanePath or special-case "test" paths; it is to stop
// testing against the real repository at all. Every fixture below is a
// fully synthetic "repo" built fresh under the OS temp directory
// (os.tmpdir()/mkdtemp) — never touching the real repo, this worktree, the
// A worktree, or root. Each test removes only the exact temp directory it
// created, in `t.after`.
// ---------------------------------------------------------------------------

/**
 * Build a synthetic {tempRoot, repoRoot, outsideRoot} triple: a throwaway
 * directory tree completely outside the real repository, used as the
 * `repoRoot` argument to the functions under test. Callers register
 * `t.after(() => rmSync(tempRoot, ...))` to clean up.
 */
function makeSyntheticRepo() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'korixa-night-path-safety-'));
  const repoRoot = path.join(tempRoot, 'repo');
  const outsideRoot = path.join(tempRoot, 'outside');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  return { tempRoot, repoRoot, outsideRoot };
}

test('realpathContainment: an existing target inside a synthetic repo is contained', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'src', 'inside.txt'), 'inside');

  const result = realpathContainment(repoRoot, 'src/inside.txt');
  assert.equal(result.contained, true);
});

test('realpathContainment: a new (not-yet-existing) target under an existing directory is contained via its nearest ancestor', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'src'), { recursive: true });

  const result = realpathContainment(repoRoot, 'src/does-not-exist-yet.txt');
  assert.equal(result.contained, true);
});

test('hasUnsafeSymlinkComponent: false when no component is a symlink/junction', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'src', 'plain.txt'), 'plain');

  assert.equal(hasUnsafeSymlinkComponent(repoRoot, 'src/plain.txt'), false);
});

// Real filesystem escape proof (section 9/11's mandatory case):
// repo/backend/link -> outside, then repo/backend/link/file.ts must DENY,
// caught by BOTH independent barriers. Windows denies plain `symlink`
// creation without elevated privileges in most environments, but a
// directory `junction` does not require that — used here specifically so
// this proof runs for real rather than being skipped. If junction creation
// itself is denied by the platform, the test records
// SKIP_PLATFORM_CAPABILITY for the creation step only (never a false
// PASS); realpathContainment's logic is independently covered by the two
// "contained" tests above regardless.
test('symlink/junction escape: repo/backend/link -> outside, repo/backend/link/file.ts is denied by BOTH hasUnsafeSymlinkComponent and realpathContainment', (t) => {
  const { tempRoot, repoRoot, outsideRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'backend'), { recursive: true });
  writeFileSync(path.join(outsideRoot, 'file.ts'), 'outside content');
  const linkPath = path.join(repoRoot, 'backend', 'link');

  let created = true;
  try {
    symlinkSync(outsideRoot, linkPath, 'junction');
  } catch (err) {
    created = false;
    t.diagnostic(`SKIP_PLATFORM_CAPABILITY: junction creation denied by platform (${err.code}) — symlink/junction escape could not be exercised for real in this environment`);
  }

  if (!created) return; // platform capability genuinely unavailable — not a test failure

  const targetRel = 'backend/link/file.ts';
  assert.equal(hasUnsafeSymlinkComponent(repoRoot, targetRel), true, 'symlink/junction barrier');
  const containment = realpathContainment(repoRoot, targetRel);
  assert.equal(containment.contained, false, 'realpath containment barrier (independent second gate)');
});

// ---------------------------------------------------------------------------
// isSafeWriteTarget / isSafeReadTarget — the combined gates the guard uses.
// Synthetic repos throughout — see makeSyntheticRepo() above.
// ---------------------------------------------------------------------------

test('isSafeWriteTarget: allows a target inside allowed_paths, inside a synthetic repo, not critical', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'src'), { recursive: true });

  const result = isSafeWriteTarget({
    repoRoot,
    targetRelPath: 'src/example.ts',
    allowedPaths: ['src/**'],
  });
  assert.equal(result.safe, true);
  assert.equal(isCriticalControlPlanePath('src/example.ts'), false);
});

test('isSafeWriteTarget: denies a target outside allowed_paths', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const result = isSafeWriteTarget({
    repoRoot,
    targetRelPath: 'other/main.ts',
    allowedPaths: ['src/**'],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'OUTSIDE_ALLOWED_PATHS');
});

test('isSafeWriteTarget: denies a critical control-plane path even if allowed_paths would cover it', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const result = isSafeWriteTarget({
    repoRoot,
    targetRelPath: '.claude/settings.json',
    allowedPaths: ['.claude/**'],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'CRITICAL_CONTROL_PLANE_PATH');
});

test('isSafeWriteTarget: denies a non-canonical path even if it would otherwise be in scope', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const result = isSafeWriteTarget({
    repoRoot,
    targetRelPath: './src/example.ts',
    allowedPaths: ['src/**'],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'NON_CANONICAL_PATH');
});

test('isSafeReadTarget: allows an existing target inside read_paths', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'docs', 'readme.txt'), 'x');

  const result = isSafeReadTarget({
    repoRoot,
    targetRelPath: 'docs/readme.txt',
    readPaths: ['docs/**'],
  });
  assert.equal(result.safe, true);
});

test('isSafeReadTarget: denies a target that does not exist', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const result = isSafeReadTarget({
    repoRoot,
    targetRelPath: 'docs/definitely-does-not-exist.txt',
    readPaths: ['docs/**'],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'TARGET_DOES_NOT_EXIST');
});

test('isSafeReadTarget: denies a target outside read_paths even if it exists (denial is by scope, not by critical-path)', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'public'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'public', 'file.txt'), 'x');

  const result = isSafeReadTarget({
    repoRoot,
    targetRelPath: 'public/file.txt',
    readPaths: ['docs/**'],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'OUTSIDE_READ_PATHS');
  assert.equal(isCriticalControlPlanePath('public/file.txt'), false, 'the denial above must be scope-based, not critical-path-based');
});

test('isSafeReadTarget: denies a critical control-plane path even if it exists and read_paths would cover it', (t) => {
  const { tempRoot, repoRoot } = makeSyntheticRepo();
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  mkdirSync(path.join(repoRoot, 'tools', 'night-agent'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'tools', 'night-agent', 'queue.mjs'), 'x');

  const result = isSafeReadTarget({
    repoRoot,
    targetRelPath: 'tools/night-agent/queue.mjs',
    readPaths: ['tools/night-agent/**'],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'CRITICAL_CONTROL_PLANE_PATH');
});
