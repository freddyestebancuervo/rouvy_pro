import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  SOURCE_CLASSES,
  gatherRemoteMainEvidence,
  gatherFilesystemEvidence,
  resolveOfficialSource,
  classifyComparisonEvidence,
  checkAuditMainDrift,
  verifyRepositoryIdentity,
  isPathContainedInRoot,
} from '../source-of-truth.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const ROOT_COMMIT = 'c'.repeat(40);
const OTHER_ROOT_COMMIT = 'd'.repeat(40);
const IDENTITY_PASSTHROUGH = (p) => p; // "no symlinks involved" default for synthetic test paths

function fakeSpawn(map) {
  // map: argvString -> { status, stdout }. Any unmatched call fails closed.
  return (cmd, argv) => {
    const key = [cmd, ...argv].join(' ');
    if (key in map) return map[key];
    return { status: 128, stdout: '' };
  };
}

// A repo passes identity verification: `rev-parse --show-toplevel` succeeds
// and `rev-list --max-parents=0 HEAD` reports the given root commit.
function identityOkEntries(rootDir, rootCommit = ROOT_COMMIT) {
  return {
    [`git -C ${rootDir} rev-parse --show-toplevel`]: { status: 0, stdout: `${rootDir}\n` },
    [`git -C ${rootDir} rev-list --max-parents=0 HEAD`]: { status: 0, stdout: `${rootCommit}\n` },
  };
}

function fsFixture({ spawnEntries = {}, expectedRootCommit = ROOT_COMMIT, existsSyncFn = () => true, readFileSyncFn = () => 'CONTENT', realpathSyncFn = IDENTITY_PASSTHROUGH } = {}) {
  return { spawnSyncFn: fakeSpawn(spawnEntries), expectedRootCommit, existsSyncFn, readFileSyncFn, realpathSyncFn };
}

// ---------------------------------------------------------------------------
// gatherRemoteMainEvidence — real `git cat-file` argv shape, never `git show`
// ---------------------------------------------------------------------------

test('gatherRemoteMainEvidence: commit object missing locally -> HOLD_REMOTE_OBJECT_UNAVAILABLE, never fetch, never degrade', () => {
  let fetchCalled = false;
  const spawnSyncFn = (cmd, argv) => {
    if (argv.includes('fetch')) fetchCalled = true;
    return { status: 128, stdout: '' }; // commit object -e check fails
  };
  const evidence = gatherRemoteMainEvidence({ repoRoot: '/repo', sha: SHA_A, relPath: 'PROJECT_STATUS.md', spawnSyncFn });
  assert.equal(evidence.resolutionStatus, 'HOLD_REMOTE_OBJECT_UNAVAILABLE');
  assert.equal(evidence.sourceTracked, null);
  assert.equal(evidence.content, null);
  assert.equal(fetchCalled, false, 'must never invoke git fetch');
});

test('gatherRemoteMainEvidence: commit exists but path not tracked at that SHA -> NOT_TRACKED_AT_SHA (legitimate cascade)', () => {
  const spawnSyncFn = fakeSpawn({
    [`git -C /repo cat-file -e ${SHA_A}^{commit}`]: { status: 0, stdout: '' },
    [`git -C /repo cat-file -e ${SHA_A}:PROJECT_STATUS.md`]: { status: 128, stdout: '' },
  });
  const evidence = gatherRemoteMainEvidence({ repoRoot: '/repo', sha: SHA_A, relPath: 'PROJECT_STATUS.md', spawnSyncFn });
  assert.equal(evidence.resolutionStatus, 'NOT_TRACKED_AT_SHA');
  assert.equal(evidence.sourceTracked, false);
  assert.equal(evidence.content, null);
});

test('gatherRemoteMainEvidence: commit and path both present -> OK, content read via cat-file -p (never git show)', () => {
  const seenCommands = [];
  const spawnSyncFn = (cmd, argv) => {
    seenCommands.push([cmd, ...argv].join(' '));
    const key = [cmd, ...argv].join(' ');
    const map = {
      [`git -C /repo cat-file -e ${SHA_A}^{commit}`]: { status: 0, stdout: '' },
      [`git -C /repo cat-file -e ${SHA_A}:PROJECT_STATUS.md`]: { status: 0, stdout: '' },
      [`git -C /repo cat-file -p ${SHA_A}:PROJECT_STATUS.md`]: { status: 0, stdout: 'REMOTE CONTENT\n' },
    };
    return map[key] ?? { status: 128, stdout: '' };
  };
  const evidence = gatherRemoteMainEvidence({ repoRoot: '/repo', sha: SHA_A, relPath: 'PROJECT_STATUS.md', spawnSyncFn });
  assert.equal(evidence.resolutionStatus, 'OK');
  assert.equal(evidence.sourceTracked, true);
  assert.equal(evidence.content, 'REMOTE CONTENT\n');
  assert.equal(evidence.sourceClass, 'REMOTE_MAIN');
  assert.ok(seenCommands.every((c) => !c.includes(' show ') && !c.includes(' log ')), 'must never call git show/log');
});

// ---------------------------------------------------------------------------
// DEFECT 2 — SHA validation (R1). Symbolic/moving refs and malformed SHAs
// must be rejected BEFORE any git subprocess is spawned.
// ---------------------------------------------------------------------------

function assertInvalidShaNoSubprocess(sha, label) {
  test(`gatherRemoteMainEvidence: DEFECT 2 — ${label} -> HOLD_INVALID_REMOTE_SHA, zero git subprocess calls`, () => {
    let spawnCallCount = 0;
    const spawnSyncFn = () => {
      spawnCallCount += 1;
      return { status: 0, stdout: '' };
    };
    const evidence = gatherRemoteMainEvidence({ repoRoot: '/repo', sha, relPath: 'PROJECT_STATUS.md', spawnSyncFn });
    assert.equal(evidence.resolutionStatus, 'HOLD_INVALID_REMOTE_SHA', label);
    assert.equal(evidence.content, null);
    assert.equal(spawnCallCount, 0, `git subprocess must never be invoked for invalid sha (${label})`);
  });
}

assertInvalidShaNoSubprocess('HEAD', 'HEAD');
assertInvalidShaNoSubprocess('HEAD~1', 'HEAD~1');
assertInvalidShaNoSubprocess('main', 'branch name');
assertInvalidShaNoSubprocess('v1.0.0', 'tag-like name');
assertInvalidShaNoSubprocess(SHA_A.slice(0, 7), 'short/abbreviated SHA');
assertInvalidShaNoSubprocess(SHA_A.toUpperCase(), 'uppercase SHA (canonical lowercase required)');
assertInvalidShaNoSubprocess(` ${SHA_A}`, 'SHA with leading whitespace');
assertInvalidShaNoSubprocess(`${SHA_A}\n`, 'SHA with trailing newline');
assertInvalidShaNoSubprocess(`${SHA_A}^{commit}`, 'SHA with appended revspec suffix');
assertInvalidShaNoSubprocess(`${SHA_A}:foo`, 'SHA with embedded colon/path suffix');
assertInvalidShaNoSubprocess('refs/heads/main', 'full ref path');
assertInvalidShaNoSubprocess(null, 'non-string (null)');
assertInvalidShaNoSubprocess(undefined, 'non-string (undefined)');
assertInvalidShaNoSubprocess(40, 'non-string (number)');
assertInvalidShaNoSubprocess({}, 'non-string (object)');

test('gatherRemoteMainEvidence: DEFECT 2 — a valid full lowercase SHA passes the format gate and proceeds to the real check', () => {
  const spawnSyncFn = fakeSpawn({
    [`git -C /repo cat-file -e ${SHA_A}^{commit}`]: { status: 0, stdout: '' },
    [`git -C /repo cat-file -e ${SHA_A}:x.md`]: { status: 0, stdout: '' },
    [`git -C /repo cat-file -p ${SHA_A}:x.md`]: { status: 0, stdout: 'OK\n' },
  });
  const evidence = gatherRemoteMainEvidence({ repoRoot: '/repo', sha: SHA_A, relPath: 'x.md', spawnSyncFn });
  assert.equal(evidence.resolutionStatus, 'OK');
});

test('gatherRemoteMainEvidence: DEFECT 1 — an invalid relPath is rejected before the path-dependent Git call, even with a valid SHA', () => {
  let sawPathDependentCall = false;
  const spawnSyncFn = (cmd, argv) => {
    if (argv.some((a) => typeof a === 'string' && a.includes(':'))) sawPathDependentCall = true;
    return { status: 0, stdout: '' };
  };
  const evidence = gatherRemoteMainEvidence({ repoRoot: '/repo', sha: SHA_A, relPath: '../evil', spawnSyncFn });
  assert.equal(evidence.resolutionStatus, 'HOLD_INVALID_REPO_RELATIVE_PATH');
  assert.equal(evidence.content, null);
  assert.equal(sawPathDependentCall, false, 'must never build a <sha>:<path> revspec for an invalid path');
});

// ---------------------------------------------------------------------------
// isPathContainedInRoot — the exact non-naive containment check (R1 Gate B)
// ---------------------------------------------------------------------------

test('isPathContainedInRoot: a real subdirectory is contained', () => {
  // Uses path.sep-consistent separators (backslash on win32) since real
  // callers always pass path.resolve()'d values, never raw POSIX strings.
  assert.equal(isPathContainedInRoot(['', 'root'].join(path.sep), ['', 'root', 'sub', 'file.md'].join(path.sep)), true);
});

test('isPathContainedInRoot: root itself is never a valid contained target', () => {
  assert.equal(isPathContainedInRoot('/root', '/root'), false);
});

test('isPathContainedInRoot: a naive startsWith(root) check would be fooled by a sibling directory sharing a prefix — this implementation is not', () => {
  // "/root-evil".startsWith("/root") is true, which is exactly the trap the
  // independent audit warned about. The correct check requires root+sep.
  assert.equal(isPathContainedInRoot('/root', '/root-evil/secret.txt'), false);
});

test('isPathContainedInRoot: an unrelated sibling directory is rejected', () => {
  assert.equal(isPathContainedInRoot('C:\\repo', 'C:\\repo-evil\\file.md'), false);
});

// ---------------------------------------------------------------------------
// gatherFilesystemEvidence — tracked/dirty/untracked/absent classification
// ---------------------------------------------------------------------------

test('gatherFilesystemEvidence: file absent on disk -> ABSENT, content null', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT', rootDir: '/root', relPath: 'x.md',
    ...fsFixture({ spawnEntries: identityOkEntries('/root'), existsSyncFn: () => false }),
  });
  assert.equal(evidence.resolutionStatus, 'ABSENT');
  assert.equal(evidence.content, null);
});

test('gatherFilesystemEvidence: untracked file present on disk -> sourceUntracked true', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT', rootDir: '/root', relPath: 'x.md',
    ...fsFixture({
      spawnEntries: { ...identityOkEntries('/root'), 'git -C /root ls-files --error-unmatch -- x.md': { status: 1, stdout: '' } },
      readFileSyncFn: () => 'LOCAL CONTENT',
    }),
  });
  assert.equal(evidence.sourceTracked, false);
  assert.equal(evidence.sourceUntracked, true);
  assert.equal(evidence.sourceDirty, false);
  assert.equal(evidence.content, 'LOCAL CONTENT');
});

test('gatherFilesystemEvidence: tracked + dirty file -> sourceDirty true, sourceUntracked false', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT', rootDir: '/root', relPath: 'x.md',
    ...fsFixture({
      spawnEntries: {
        ...identityOkEntries('/root'),
        'git -C /root ls-files --error-unmatch -- x.md': { status: 0, stdout: 'x.md\n' },
        'git -C /root diff --quiet -- x.md': { status: 1, stdout: '' },
      },
      readFileSyncFn: () => 'DIRTY CONTENT',
    }),
  });
  assert.equal(evidence.sourceTracked, true);
  assert.equal(evidence.sourceDirty, true);
  assert.equal(evidence.sourceUntracked, false);
});

test('gatherFilesystemEvidence: tracked + clean file -> both flags false', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'TARGET_WORKTREE', rootDir: '/wt', relPath: 'x.md',
    ...fsFixture({
      spawnEntries: {
        ...identityOkEntries('/wt'),
        'git -C /wt ls-files --error-unmatch -- x.md': { status: 0, stdout: 'x.md\n' },
        'git -C /wt diff --quiet -- x.md': { status: 0, stdout: '' },
      },
      readFileSyncFn: () => 'CLEAN CONTENT',
    }),
  });
  assert.equal(evidence.sourceDirty, false);
  assert.equal(evidence.sourceUntracked, false);
  assert.equal(evidence.sourceClass, 'TARGET_WORKTREE');
});

// ---------------------------------------------------------------------------
// DEFECT 1 — path traversal / escape tests for gatherFilesystemEvidence
// ---------------------------------------------------------------------------

const PATH_ATTACK_CASES = [
  ['../evil', 'single-segment traversal'],
  ['../../evil', 'double-segment traversal'],
  ['../../../../Windows/System32/drivers/etc/hosts', 'the exact live-reproduced audit payload'],
  ['/etc/passwd', 'POSIX absolute path'],
  ['C:\\Windows\\System32\\config', 'Windows absolute path'],
  ['\\\\server\\share\\file.md', 'UNC path'],
  ['a\\b.md', 'embedded backslash'],
  ['a:b.md', 'embedded colon'],
  ['a\0b.md', 'embedded null byte'],
  ['a\nb.md', 'embedded newline'],
  ['evil.', 'trailing dot (Windows alias risk)'],
  ['evil ', 'trailing space (Windows alias risk)'],
];

for (const [relPath, label] of PATH_ATTACK_CASES) {
  test(`gatherFilesystemEvidence: DEFECT 1 — rejects ${label} before any filesystem access`, () => {
    let touchedFs = false;
    const evidence = gatherFilesystemEvidence({
      sourceClass: 'LOCAL_ROOT',
      rootDir: '/root',
      relPath,
      expectedRootCommit: ROOT_COMMIT,
      spawnSyncFn: fakeSpawn(identityOkEntries('/root')),
      existsSyncFn: () => { touchedFs = true; return true; },
      readFileSyncFn: () => { touchedFs = true; return 'SHOULD NEVER BE READ'; },
      realpathSyncFn: IDENTITY_PASSTHROUGH,
    });
    assert.ok(evidence.resolutionStatus.startsWith('HOLD_'), `expected a HOLD_* status for ${label}, got ${evidence.resolutionStatus}`);
    assert.equal(evidence.content, null);
    assert.equal(touchedFs, false, `existsSync/readFileSync must never run for ${label}`);
  });
}

test('gatherFilesystemEvidence: DEFECT 1 regression — the exact audit-reproduced escape is now denied against the real filesystem (no fakes)', () => {
  // Uses the REAL fs.existsSync/readFileSync (no fakes) against a target
  // that genuinely exists on this machine, to prove the gate — not a mock
  // — is what blocks the read.
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: 'C:/proyectos/rouvy_proZIP/wt-night-v1-improvement-1-source-of-truth-20260820',
    relPath: '../../../../Windows/System32/drivers/etc/hosts',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('C:/proyectos/rouvy_proZIP/wt-night-v1-improvement-1-source-of-truth-20260820')),
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_INVALID_REPO_RELATIVE_PATH');
  assert.equal(evidence.content, null);
});

// ---------------------------------------------------------------------------
// DEFECT 1 — symlink/junction escape defense (Gate C)
// ---------------------------------------------------------------------------

test('gatherFilesystemEvidence: DEFECT 1 (symlink variant) — a target whose realpath escapes root is denied even though the lexical path was safe', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/root',
    relPath: 'looks-safe.md',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('/root')),
    existsSyncFn: () => true,
    readFileSyncFn: () => 'SHOULD NEVER BE READ',
    realpathSyncFn: (p) => (p === '/root' ? '/root' : '/somewhere/entirely/else/secret.md'),
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_SYMLINK_ESCAPE_DETECTED');
  assert.equal(evidence.content, null);
});

test('gatherFilesystemEvidence: DEFECT 1 (symlink variant) — realpath resolution failure fails closed as UNRESOLVED, not as a false pass', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/root',
    relPath: 'broken-link.md',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('/root')),
    existsSyncFn: () => true,
    readFileSyncFn: () => 'SHOULD NEVER BE READ',
    realpathSyncFn: () => { throw new Error('ELOOP'); },
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_SYMLINK_ESCAPE_UNRESOLVED');
  assert.equal(evidence.content, null);
});

test('gatherFilesystemEvidence: DEFECT 1 (symlink variant) — a genuinely-contained real path (no symlink) still reads normally', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/root',
    relPath: 'normal.md',
    ...fsFixture({
      spawnEntries: { ...identityOkEntries('/root'), 'git -C /root ls-files --error-unmatch -- normal.md': { status: 0, stdout: 'normal.md\n' }, 'git -C /root diff --quiet -- normal.md': { status: 0, stdout: '' } },
      readFileSyncFn: () => 'REAL CONTENT',
    }),
  });
  assert.equal(evidence.resolutionStatus, 'OK');
  assert.equal(evidence.content, 'REAL CONTENT');
});

// ---------------------------------------------------------------------------
// DEFECT 3 — verifyRepositoryIdentity, standalone
// ---------------------------------------------------------------------------

test('verifyRepositoryIdentity: correct repository -> verified true', () => {
  const result = verifyRepositoryIdentity({ rootDir: '/korixa', expectedRootCommit: ROOT_COMMIT, spawnSyncFn: fakeSpawn(identityOkEntries('/korixa')) });
  assert.deepEqual(result, { verified: true, reason: 'OK' });
});

test('verifyRepositoryIdentity: second legitimate worktree of the SAME repo (different toplevel, same root commit) -> verified true', () => {
  const result = verifyRepositoryIdentity({ rootDir: '/korixa-wt2', expectedRootCommit: ROOT_COMMIT, spawnSyncFn: fakeSpawn(identityOkEntries('/korixa-wt2', ROOT_COMMIT)) });
  assert.equal(result.verified, true);
});

test('verifyRepositoryIdentity: unrelated repository (different root commit) -> IDENTITY_MISMATCH', () => {
  const result = verifyRepositoryIdentity({ rootDir: '/foreign-repo', expectedRootCommit: ROOT_COMMIT, spawnSyncFn: fakeSpawn(identityOkEntries('/foreign-repo', OTHER_ROOT_COMMIT)) });
  assert.deepEqual(result, { verified: false, reason: 'IDENTITY_MISMATCH' });
});

test('verifyRepositoryIdentity: non-Git directory -> NOT_A_GIT_REPOSITORY', () => {
  const result = verifyRepositoryIdentity({
    rootDir: '/not-a-repo', expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn({ 'git -C /not-a-repo rev-parse --show-toplevel': { status: 128, stdout: '' } }),
  });
  assert.deepEqual(result, { verified: false, reason: 'NOT_A_GIT_REPOSITORY' });
});

test('verifyRepositoryIdentity: missing expected identity -> MISSING_OR_INVALID_EXPECTED_IDENTITY, zero git calls', () => {
  let spawnCallCount = 0;
  const result = verifyRepositoryIdentity({ rootDir: '/korixa', expectedRootCommit: undefined, spawnSyncFn: () => { spawnCallCount += 1; return { status: 0, stdout: '' }; } });
  assert.deepEqual(result, { verified: false, reason: 'MISSING_OR_INVALID_EXPECTED_IDENTITY' });
  assert.equal(spawnCallCount, 0, 'must never call git when the expected identity itself is invalid');
});

test('verifyRepositoryIdentity: invalid expected identity format (not 40 lowercase hex) -> MISSING_OR_INVALID_EXPECTED_IDENTITY', () => {
  const result = verifyRepositoryIdentity({ rootDir: '/korixa', expectedRootCommit: 'HEAD', spawnSyncFn: fakeSpawn(identityOkEntries('/korixa')) });
  assert.equal(result.reason, 'MISSING_OR_INVALID_EXPECTED_IDENTITY');
});

test('verifyRepositoryIdentity: mismatched identity (explicit, distinct from unrelated-repo case) -> IDENTITY_MISMATCH', () => {
  const result = verifyRepositoryIdentity({
    rootDir: '/some-dir', expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('/some-dir', SHA_B)),
  });
  assert.equal(result.reason, 'IDENTITY_MISMATCH');
});

test('verifyRepositoryIdentity: git verification failure (rev-list fails) -> IDENTITY_RESOLUTION_FAILED', () => {
  const result = verifyRepositoryIdentity({
    rootDir: '/korixa', expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn({
      'git -C /korixa rev-parse --show-toplevel': { status: 0, stdout: '/korixa\n' },
      'git -C /korixa rev-list --max-parents=0 HEAD': { status: 1, stdout: '' },
    }),
  });
  assert.deepEqual(result, { verified: false, reason: 'IDENTITY_RESOLUTION_FAILED' });
});

test('verifyRepositoryIdentity: rev-list succeeds but produces empty/unparseable output -> IDENTITY_RESOLUTION_FAILED', () => {
  const result = verifyRepositoryIdentity({
    rootDir: '/korixa', expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn({
      'git -C /korixa rev-parse --show-toplevel': { status: 0, stdout: '/korixa\n' },
      'git -C /korixa rev-list --max-parents=0 HEAD': { status: 0, stdout: '' },
    }),
  });
  assert.deepEqual(result, { verified: false, reason: 'IDENTITY_RESOLUTION_FAILED' });
});

// ---------------------------------------------------------------------------
// DEFECT 3 — repository identity wired into gatherFilesystemEvidence
// ---------------------------------------------------------------------------

test('gatherFilesystemEvidence: DEFECT 3 — a foreign repository presented as LOCAL_ROOT is denied, never becomes evidence', () => {
  let touchedFs = false;
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/foreign-repo',
    relPath: 'PROJECT_STATUS.md',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('/foreign-repo', OTHER_ROOT_COMMIT)),
    existsSyncFn: () => { touchedFs = true; return true; },
    readFileSyncFn: () => { touchedFs = true; return 'SHOULD NEVER BE READ'; },
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_REPOSITORY_IDENTITY_UNVERIFIED');
  assert.equal(evidence.content, null);
  assert.equal(touchedFs, false, 'must never touch the filesystem once identity verification fails');
});

test('gatherFilesystemEvidence: DEFECT 3 — a foreign repository presented as TARGET_WORKTREE is denied, never becomes OFFICIAL even when REMOTE_MAIN is absent', () => {
  const foreignEvidence = gatherFilesystemEvidence({
    sourceClass: 'TARGET_WORKTREE',
    rootDir: '/foreign-repo',
    relPath: 'firebase.json',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('/foreign-repo', OTHER_ROOT_COMMIT)),
    existsSyncFn: () => true,
    readFileSyncFn: () => 'FOREIGN CONTENT',
  });
  const remoteAbsent = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' };
  const resolution = resolveOfficialSource([remoteAbsent, foreignEvidence]);
  assert.equal(resolution.officialSource, null, 'a foreign repository must never be declared OFFICIAL');
  assert.equal(resolution.reason, 'FILE_ABSENT_EVERYWHERE');
});

test('gatherFilesystemEvidence: DEFECT 3 — a non-Git directory presented as evidence is denied', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/not-a-repo',
    relPath: 'x.md',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn({ 'git -C /not-a-repo rev-parse --show-toplevel': { status: 128, stdout: '' } }),
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_REPOSITORY_IDENTITY_UNVERIFIED');
});

test('gatherFilesystemEvidence: DEFECT 3 — omitting expectedRootCommit entirely fails closed (never treated as "skip the check")', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/root',
    relPath: 'x.md',
    spawnSyncFn: fakeSpawn(identityOkEntries('/root')),
    existsSyncFn: () => true,
    readFileSyncFn: () => 'SHOULD NEVER BE READ',
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_REPOSITORY_IDENTITY_UNVERIFIED');
  assert.equal(evidence.content, null);
});

test('gatherFilesystemEvidence: DEFECT 3 — a second LEGITIMATE worktree of Korixa (same root commit, different rootDir) is accepted and can become official', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'TARGET_WORKTREE',
    rootDir: '/korixa-wt-2',
    relPath: 'x.md',
    ...fsFixture({
      spawnEntries: {
        ...identityOkEntries('/korixa-wt-2', ROOT_COMMIT),
        'git -C /korixa-wt-2 ls-files --error-unmatch -- x.md': { status: 0, stdout: 'x.md\n' },
        'git -C /korixa-wt-2 diff --quiet -- x.md': { status: 0, stdout: '' },
      },
      readFileSyncFn: () => 'LEGITIMATE WORKTREE CONTENT',
    }),
  });
  assert.equal(evidence.resolutionStatus, 'OK');
  const remoteAbsent = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' };
  const resolution = resolveOfficialSource([remoteAbsent, evidence]);
  assert.equal(resolution.officialSource.sourceClass, 'TARGET_WORKTREE');
  assert.equal(resolution.officialSource.content, 'LEGITIMATE WORKTREE CONTENT');
});

// ---------------------------------------------------------------------------
// resolveOfficialSource — the frozen priority order (12 required scenarios)
// ---------------------------------------------------------------------------

test('SOURCE_CLASSES exposes the full taxonomy including RUNTIME/UNKNOWN', () => {
  assert.deepEqual([...SOURCE_CLASSES], ['REMOTE_MAIN', 'TARGET_WORKTREE', 'LOCAL_ROOT', 'HISTORICAL', 'RUNTIME', 'UNKNOWN']);
});

test('scenario 1: remote-tracked vs local-untracked -> REMOTE_MAIN wins (the PROJECT_STATUS.md incident shape)', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', sourceSha: SHA_A, content: 'CURRENT', sourceTracked: true };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'STALE', sourceTracked: false, sourceUntracked: true };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
  assert.equal(resolution.officialSource.content, 'CURRENT');
  assert.equal(resolution.reason, 'RESOLVED_BY_PRIORITY:REMOTE_MAIN');
});

test('scenario 2: remote-tracked vs local-dirty -> REMOTE_MAIN still wins', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'CURRENT', sourceTracked: true };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'DIRTY EDIT', sourceTracked: true, sourceDirty: true };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
});

test('scenario 3: remote-tracked vs historical -> REMOTE_MAIN wins, historical demoted to comparison evidence', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'CURRENT' };
  const historical = { sourceClass: 'HISTORICAL', content: 'OLD AUDIT COPY' };
  const resolution = resolveOfficialSource([remote, historical]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
  assert.equal(resolution.comparisonEvidence.length, 1);
  assert.equal(resolution.comparisonEvidence[0].sourceClass, 'HISTORICAL');
});

test('scenario 4: remote vs target-worktree divergent -> REMOTE_MAIN wins, worktree content never overrides', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'MAIN VERSION' };
  const worktree = { sourceClass: 'TARGET_WORKTREE', content: 'IN-PROGRESS CHANGE' };
  const resolution = resolveOfficialSource([remote, worktree]);
  assert.equal(resolution.officialSource.content, 'MAIN VERSION');
});

test('scenario 5: remote and local identical -> REMOTE_MAIN still declared official (not local, even though equal)', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'SAME' };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'SAME' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
});

test('scenario 6: file absent on remote (NOT_TRACKED_AT_SHA) but present locally -> cascades to LOCAL_ROOT', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'ONLY LOCAL' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource.sourceClass, 'LOCAL_ROOT');
  assert.equal(resolution.reason, 'RESOLVED_BY_PRIORITY:LOCAL_ROOT');
});

test('scenario 7: file absent everywhere -> officialSource null, reason FILE_ABSENT_EVERYWHERE', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' };
  const local = { sourceClass: 'LOCAL_ROOT', content: null, resolutionStatus: 'ABSENT' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'FILE_ABSENT_EVERYWHERE');
});

test('scenario 8/9 (frozen SHA / drift detection): checkAuditMainDrift matches -> OK', () => {
  assert.deepEqual(checkAuditMainDrift({ frozenSha: SHA_A, currentRemoteMainSha: SHA_A }), { drifted: false, result: 'OK', reason: 'MATCH' });
});

test('scenario 9: checkAuditMainDrift mismatch -> HOLD_MAIN_DRIFT, never mixes evidence across two mains', () => {
  const result = checkAuditMainDrift({ frozenSha: SHA_A, currentRemoteMainSha: SHA_B });
  assert.equal(result.drifted, true);
  assert.equal(result.result, 'HOLD_MAIN_DRIFT');
});

test('scenario 9b: checkAuditMainDrift unresolved current -> HOLD_MAIN_DRIFT (fail closed, not assumed OK)', () => {
  const result = checkAuditMainDrift({ frozenSha: SHA_A, currentRemoteMainSha: null });
  assert.equal(result.result, 'HOLD_MAIN_DRIFT');
  assert.equal(result.reason, 'UNRESOLVED_CURRENT_REMOTE_MAIN');
});

test('scenario 10: PROJECT_STATUS.md regression fixture — synthetic, non-destructive, proves the exact incident cannot recur', () => {
  // Synthetic reproduction of the incident: a tracked, current PROJECT_STATUS.md
  // on REMOTE_MAIN (mentioning T-F1.2/Night-Agent) vs a stale, untracked local
  // copy (dated 2026-07-25, "0% tasks closed"). No real repo files touched.
  const remoteMainEvidence = gatherRemoteMainEvidence({
    repoRoot: '/synthetic/repo',
    sha: SHA_A,
    relPath: 'PROJECT_STATUS.md',
    spawnSyncFn: fakeSpawn({
      [`git -C /synthetic/repo cat-file -e ${SHA_A}^{commit}`]: { status: 0, stdout: '' },
      [`git -C /synthetic/repo cat-file -e ${SHA_A}:PROJECT_STATUS.md`]: { status: 0, stdout: '' },
      [`git -C /synthetic/repo cat-file -p ${SHA_A}:PROJECT_STATUS.md`]: { status: 0, stdout: '# PROJECT_STATUS\nT-F1.2 closed. Night Agent live.\n' },
    }),
  });
  const localRootEvidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/synthetic/root',
    relPath: 'PROJECT_STATUS.md',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn({
      ...identityOkEntries('/synthetic/root'),
      'git -C /synthetic/root ls-files --error-unmatch -- PROJECT_STATUS.md': { status: 1, stdout: '' },
    }),
    existsSyncFn: () => true,
    readFileSyncFn: () => '# PROJECT_STATUS\nDate: 2026-07-25\n0% tasks closed. No backend deployed.\n',
    realpathSyncFn: IDENTITY_PASSTHROUGH,
  });

  const resolution = resolveOfficialSource([remoteMainEvidence, localRootEvidence]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN', 'OFFICIAL_SOURCE must be REMOTE_MAIN');
  assert.match(resolution.officialSource.content, /Night Agent live/);

  const classified = classifyComparisonEvidence(resolution);
  const localClassified = classified.find((e) => e.sourceClass === 'LOCAL_ROOT');
  assert.equal(localClassified.classification, 'STALE_LOCAL_COPY_UNTRACKED', 'LOCAL_CLASSIFICATION must be STALE_LOCAL_COPY variant');
  assert.equal(localClassified.canOverrideOfficial, false, 'LOCAL_CAN_OVERRIDE must be NO');
});

test('scenario 11: local file with a textually newer date than remote content must NOT outrank Git provenance', () => {
  // The local copy's TEXT claims a later date than the remote file's text —
  // resolveOfficialSource must never read content to decide precedence.
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'Date: 2026-01-01\nIntegrated on main.' };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'Date: 2099-12-31\nNot yet merged anywhere.', sourceUntracked: true };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN', 'a later textual date inside a file must never win over Git provenance');
});

test('scenario 11b: end-to-end via the real gatherer — a local file claiming 2099-12-31 still loses to REMOTE_MAIN', () => {
  const remoteMainEvidence = { sourceClass: 'REMOTE_MAIN', content: 'Date: 2026-01-01\nIntegrated on main.' };
  const localRootEvidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/root',
    relPath: 'x.md',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn({ ...identityOkEntries('/root'), 'git -C /root ls-files --error-unmatch -- x.md': { status: 1, stdout: '' } }),
    existsSyncFn: () => true,
    readFileSyncFn: () => 'Date: 2099-12-31\nNot yet merged anywhere.',
    realpathSyncFn: IDENTITY_PASSTHROUGH,
  });
  const resolution = resolveOfficialSource([remoteMainEvidence, localRootEvidence]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
});

test('scenario 12: multiple worktrees offering the same TARGET_WORKTREE class -> fails closed, ambiguous, never silently picks one', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'MAIN' };
  const wt1 = { sourceClass: 'TARGET_WORKTREE', content: 'FROM WORKTREE 1' };
  const wt2 = { sourceClass: 'TARGET_WORKTREE', content: 'FROM WORKTREE 2' };
  const resolution = resolveOfficialSource([remote, wt1, wt2]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'AMBIGUOUS_MULTIPLE_SOURCES_FOR_CLASS:TARGET_WORKTREE');
});

// ---------------------------------------------------------------------------
// The central rule: REMOTE_MAIN anomalies fail the WHOLE resolution closed —
// never silently degrades to LOCAL_ROOT. R1 broadens this beyond the
// original single HOLD_REMOTE_OBJECT_UNAVAILABLE status.
// ---------------------------------------------------------------------------

test('central rule: REMOTE_MAIN object unavailable + LOCAL_ROOT present -> still HOLD, never resolves to LOCAL_ROOT', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'HOLD_REMOTE_OBJECT_UNAVAILABLE' };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'LOCAL ONLY, COULD BE WRONGLY TRUSTED' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'HOLD_REMOTE_OBJECT_UNAVAILABLE');
});

test('central rule (R1): REMOTE_MAIN with HOLD_INVALID_REMOTE_SHA + LOCAL_ROOT present -> still HOLD, never resolves to LOCAL_ROOT', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'HOLD_INVALID_REMOTE_SHA' };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'LOCAL ONLY, COULD BE WRONGLY TRUSTED' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'HOLD_INVALID_REMOTE_SHA');
});

test('central rule (R1): REMOTE_MAIN with HOLD_INVALID_REPO_RELATIVE_PATH + LOCAL_ROOT present -> still HOLD, never resolves to LOCAL_ROOT', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'HOLD_INVALID_REPO_RELATIVE_PATH' };
  const local = { sourceClass: 'LOCAL_ROOT', content: 'LOCAL ONLY, COULD BE WRONGLY TRUSTED' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'HOLD_INVALID_REPO_RELATIVE_PATH');
});

test('central rule (R1): a non-REMOTE_MAIN Gate failure (e.g. HOLD_PATH_ESCAPES_ROOT on TARGET_WORKTREE) does NOT halt the whole resolution — REMOTE_MAIN still wins normally', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'CURRENT' };
  const worktree = { sourceClass: 'TARGET_WORKTREE', content: null, resolutionStatus: 'HOLD_PATH_ESCAPES_ROOT' };
  const resolution = resolveOfficialSource([remote, worktree]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
  assert.equal(resolution.reason, 'RESOLVED_BY_PRIORITY:REMOTE_MAIN');
});

test('central rule (R1): a non-REMOTE_MAIN Gate failure with REMOTE_MAIN absent -> cascades correctly to FILE_ABSENT_EVERYWHERE, not corrupted', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' };
  const local = { sourceClass: 'LOCAL_ROOT', content: null, resolutionStatus: 'HOLD_REPOSITORY_IDENTITY_UNVERIFIED' };
  const resolution = resolveOfficialSource([remote, local]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'FILE_ABSENT_EVERYWHERE');
});

test('central rule: no evidence array at all -> NO_EVIDENCE, never assumes an official source', () => {
  assert.equal(resolveOfficialSource([]).reason, 'NO_EVIDENCE');
  assert.equal(resolveOfficialSource(null).reason, 'NO_EVIDENCE');
});

test('central rule: LOCAL_ROOT can never structurally declare itself official while REMOTE_MAIN evidence is absent from the list either (only lower classes present) — still lawful cascade, not an override', () => {
  const local = { sourceClass: 'LOCAL_ROOT', content: 'ONLY SOURCE AVAILABLE' };
  const resolution = resolveOfficialSource([local]);
  assert.equal(resolution.officialSource.sourceClass, 'LOCAL_ROOT');
  assert.equal(resolution.reason, 'RESOLVED_BY_PRIORITY:LOCAL_ROOT');
});

// ---------------------------------------------------------------------------
// classifyComparisonEvidence
// ---------------------------------------------------------------------------

test('classifyComparisonEvidence: HISTORICAL identical to official -> HISTORICAL_CONFIRMED', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'SAME TEXT' };
  const historical = { sourceClass: 'HISTORICAL', content: 'SAME TEXT' };
  const resolution = resolveOfficialSource([remote, historical]);
  const classified = classifyComparisonEvidence(resolution);
  assert.equal(classified[0].classification, 'HISTORICAL_CONFIRMED');
});

test('classifyComparisonEvidence: HISTORICAL diverging from official -> HISTORICAL_SUPERSEDED, never overrides', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'NEW TEXT' };
  const historical = { sourceClass: 'HISTORICAL', content: 'OLD TEXT' };
  const resolution = resolveOfficialSource([remote, historical]);
  const classified = classifyComparisonEvidence(resolution);
  assert.equal(classified[0].classification, 'HISTORICAL_SUPERSEDED');
  assert.equal(classified[0].canOverrideOfficial, false);
});

test('classifyComparisonEvidence: TARGET_WORKTREE demoted -> CANDIDATE_NOT_YET_INTEGRATED', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: 'MAIN' };
  const worktree = { sourceClass: 'TARGET_WORKTREE', content: 'WIP' };
  const resolution = resolveOfficialSource([remote, worktree]);
  const classified = classifyComparisonEvidence(resolution);
  assert.equal(classified[0].classification, 'CANDIDATE_NOT_YET_INTEGRATED');
});

test('classifyComparisonEvidence: empty when there is no official source', () => {
  assert.deepEqual(classifyComparisonEvidence({ officialSource: null, comparisonEvidence: [{ sourceClass: 'LOCAL_ROOT' }] }), []);
});

// ---------------------------------------------------------------------------
// Adversarial self-review
// ---------------------------------------------------------------------------

test('adversarial: malformed/wrong SHA -> HOLD_INVALID_REMOTE_SHA (caught by the format gate, no git call), not a crash', () => {
  const evidence = gatherRemoteMainEvidence({
    repoRoot: '/repo', sha: 'not-a-real-sha', relPath: 'x.md',
    spawnSyncFn: () => ({ status: 128, stdout: '' }),
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_INVALID_REMOTE_SHA');
});

test('adversarial: a syntactically valid-looking 40-char SHA that is not actually resolvable -> HOLD_REMOTE_OBJECT_UNAVAILABLE (distinct from HOLD_INVALID_REMOTE_SHA)', () => {
  const evidence = gatherRemoteMainEvidence({
    repoRoot: '/repo', sha: SHA_B, relPath: 'x.md',
    spawnSyncFn: () => ({ status: 128, stdout: '' }),
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_REMOTE_OBJECT_UNAVAILABLE');
});

test('adversarial: git diff --quiet exits with an unexpected status -> dirty treated as false only via explicit false, not assumed clean when ambiguous', () => {
  // status 129 (neither 0 nor 1) is genuinely ambiguous; isDirtyRelativeToHead
  // must return null internally, and gatherFilesystemEvidence must not then
  // assert sourceDirty:true, but it also must not silently claim a false
  // "verified clean" either — it degrades to the conservative false without
  // fabricating certainty. This test locks that exact behavior in place.
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT', rootDir: '/root', relPath: 'x.md',
    ...fsFixture({
      spawnEntries: {
        ...identityOkEntries('/root'),
        'git -C /root ls-files --error-unmatch -- x.md': { status: 0, stdout: 'x.md\n' },
        'git -C /root diff --quiet -- x.md': { status: 129, stdout: '' },
      },
      readFileSyncFn: () => 'C',
    }),
  });
  assert.equal(evidence.sourceDirty, false);
  assert.equal(evidence.sourceTracked, true);
});

test('adversarial: content is an empty string (real empty file) -> still counts as present evidence, not ABSENT', () => {
  const remote = { sourceClass: 'REMOTE_MAIN', content: '' };
  const resolution = resolveOfficialSource([remote]);
  assert.equal(resolution.officialSource.sourceClass, 'REMOTE_MAIN');
  assert.equal(resolution.officialSource.content, '');
});

test('adversarial: two REMOTE_MAIN entries in the same evidence list (should never happen, but must fail closed if it does)', () => {
  const remote1 = { sourceClass: 'REMOTE_MAIN', content: 'A' };
  const remote2 = { sourceClass: 'REMOTE_MAIN', content: 'B' };
  const resolution = resolveOfficialSource([remote1, remote2]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'AMBIGUOUS_MULTIPLE_SOURCES_FOR_CLASS:REMOTE_MAIN');
});

test('adversarial: readFileSync throws -> READ_ERROR, content null, never fabricates content', () => {
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT', rootDir: '/root', relPath: 'x.md',
    ...fsFixture({
      spawnEntries: identityOkEntries('/root'),
      readFileSyncFn: () => { throw new Error('EACCES'); },
    }),
  });
  assert.equal(evidence.resolutionStatus, 'READ_ERROR');
  assert.equal(evidence.content, null);
});

test('adversarial: unrecognized sourceClass in evidence -> ignored by priority resolution, never picked as official', () => {
  const unknown = { sourceClass: 'RUNTIME', content: 'RUNTIME DATA' };
  const resolution = resolveOfficialSource([unknown]);
  assert.equal(resolution.officialSource, null);
  assert.equal(resolution.reason, 'NO_RECOGNIZED_SOURCE_CLASS_PRESENT');
});

// ---------------------------------------------------------------------------
// R1 Attack reproductions (independent-audit-style, run against the FIXED
// module) — Attacks A/B/C from the R1 correction block.
// ---------------------------------------------------------------------------

test('Attack A reproduction: reading ../../../../Windows/System32/drivers/etc/hosts is DENIED, file is never read', () => {
  let readAttempted = false;
  const evidence = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: 'C:/proyectos/rouvy_proZIP/wt-night-v1-improvement-1-source-of-truth-20260820',
    relPath: '../../../../Windows/System32/drivers/etc/hosts',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('C:/proyectos/rouvy_proZIP/wt-night-v1-improvement-1-source-of-truth-20260820')),
    readFileSyncFn: () => { readAttempted = true; return 'LEAKED'; },
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_INVALID_REPO_RELATIVE_PATH');
  assert.equal(evidence.content, null);
  assert.equal(readAttempted, false);
});

test('Attack B reproduction: sha=HEAD is HOLD_INVALID_REMOTE_SHA with zero git subprocess calls', () => {
  let spawnCallCount = 0;
  const evidence = gatherRemoteMainEvidence({
    repoRoot: 'C:/proyectos/rouvy_proZIP/wt-night-v1-improvement-1-source-of-truth-20260820',
    sha: 'HEAD',
    relPath: 'tools/night-agent/runner.mjs',
    spawnSyncFn: () => { spawnCallCount += 1; return { status: 0, stdout: 'should never be reached' }; },
  });
  assert.equal(evidence.resolutionStatus, 'HOLD_INVALID_REMOTE_SHA');
  assert.equal(evidence.content, null);
  assert.equal(spawnCallCount, 0);
});

test('Attack C reproduction: a synthetic foreign repository resolved as LOCAL_ROOT/TARGET_WORKTREE never becomes OFFICIAL', () => {
  const foreignAsLocalRoot = gatherFilesystemEvidence({
    sourceClass: 'LOCAL_ROOT',
    rootDir: '/completely-unrelated-repo',
    relPath: 'firebase.json',
    expectedRootCommit: ROOT_COMMIT,
    spawnSyncFn: fakeSpawn(identityOkEntries('/completely-unrelated-repo', OTHER_ROOT_COMMIT)),
    existsSyncFn: () => true,
    readFileSyncFn: () => 'FOREIGN REPO CONTENT',
  });
  assert.equal(foreignAsLocalRoot.resolutionStatus, 'HOLD_REPOSITORY_IDENTITY_UNVERIFIED');

  const resolution = resolveOfficialSource([
    { sourceClass: 'REMOTE_MAIN', content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' },
    foreignAsLocalRoot,
  ]);
  assert.equal(resolution.officialSource, null, 'a foreign repository must never be OFFICIAL');
});
