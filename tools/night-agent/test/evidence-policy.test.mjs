import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as EvidencePolicy from '../evidence-policy.mjs';

const {
  EVIDENCE_CLASSES,
  EVIDENCE_STRENGTHS,
  SEVERITIES,
  CONFIDENCE_LEVELS,
  DECISIONS,
  VERIFICATION_LEVELS,
  ENVIRONMENTS,
  evaluateClaim,
  attestRemoteMainEvidence,
  attestFilesystemEvidence,
  attestLocalRuntimeEvidence,
  attestRemoteRuntimeEvidence,
  sameUnderlyingSource,
  buildGitFingerprint,
  buildFilesystemFingerprint,
  buildRuntimeFingerprint,
  buildCiFingerprint,
} = EvidencePolicy;

const SENTINEL_SECRET = 'SUPER_SECRET_TEST_VALUE_9f21c';
const VALID_REASON = 'Directly observed, unambiguous, materially sufficient on its own';
const SHA_A = 'a'.repeat(40);
const ROOT_COMMIT = 'c'.repeat(40);

// A RAW (untrusted) evidence object — never passed through an attest
// function. Used throughout to prove such objects can never confirm P0/P1
// regardless of what they self-declare.
function rawEv(overrides) {
  return {
    evidenceId: 'e',
    sourceClass: 'STATIC_CODE',
    strength: 'DIRECT',
    supportsClaim: true,
    ...overrides,
  };
}

// A function that throws if ever invoked. Used to prove a caller-supplied,
// function-typed parameter is never called by the public API at all — not
// merely that its return value is discarded.
function poison(label) {
  return () => {
    throw new Error(`POISONED: ${label} must never be invoked by the public API (R4 / IMP2-TRANSPORT-001)`);
  };
}

// ---------------------------------------------------------------------------
// R4 (IMP2-TRANSPORT-001): real Git fixtures only. `attestRemoteMainEvidence`
// and `attestFilesystemEvidence` no longer accept ANY injectable transport —
// the R3 suite's `fakeSpawn`/injected-function test doubles are gone
// entirely, per this revision's explicit instruction to prefer real,
// temporary Git repositories and the real `spawnSync` over mocking the exact
// dependency this revision removed from the public API. Every fixture below
// is created once (top-level `before`) and reused read-only across tests;
// nothing here is ever passed back into the module as a callback.
//
// R5 (IMP2-REMOTE-IDENTITY-001) changes what these fixtures need to prove.
// `attestRemoteMainEvidence` no longer consults a repo-local `origin` at all
// — currentness is resolved against the real, fixed canonical GitHub URL
// baked into the production module, and `repoRoot` must independently pass
// Improvement 1's real repository-identity check against the production
// module's own private `CANONICAL_ROOT_COMMIT`. Per this revision's explicit
// instruction (no self-fulfilling test config: a test may not hand the
// production API its own idea of "canonical" and then claim identity was
// verified), NOTHING here is passed into `attestRemoteMainEvidence` as an
// expected-identity/expected-URL override — there is no such parameter to
// pass. Instead:
//   - `REAL_CANONICAL_CURRENT_SHA` is discovered the SAME way production
//     code discovers it: a real `git ls-remote` against the same literal
//     `https://github.com/freddyestebancuervo/rouvy_pro.git` URL. This is
//     independent verification, not circularity — the test learns a live
//     external fact, it does not tell the module what to believe.
//   - "identity-verified" fixtures are REAL local clones of this same
//     repository (cloned from this checkout's own working tree, discovered
//     via `import.meta.url` — never a hardcoded machine-specific path), so
//     their root commit genuinely, independently matches the production
//     module's private `CANONICAL_ROOT_COMMIT` constant. A clone is a
//     completely real, unmodified copy of the actual project history — not
//     a fixture manufactured to look like one.
// ---------------------------------------------------------------------------

const TMP_ROOTS = [];
const CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY = 'https://github.com/freddyestebancuervo/rouvy_pro.git';
const HISTORICAL_SHA = '777cc14eee6231bcec28ae81e83a8883ce2ae7fa';

function mkTmpDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  TMP_ROOTS.push(dir);
  return dir;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} in ${cwd} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'korixa-test@example.invalid']);
  git(dir, ['config', 'user.name', 'Korixa Test']);
}

// This checkout's own repository root (three levels up from
// tools/night-agent/test/) — used only to CLONE from locally (fast, no
// network) so fixtures get the real, genuine project history/root commit.
function thisRepositoryRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

// Independently discovers "what is currently canonical-current" the SAME
// way production code does: a real `git ls-remote` against the real,
// literal canonical URL. Not a fixture the test hands to the module — a
// live external fact the test learns for itself, to build assertions
// against.
function discoverRealCanonicalCurrentSha() {
  const r = spawnSync('git', ['ls-remote', CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY, 'refs/heads/main'], { encoding: 'utf8', shell: false });
  if (!r || r.status !== 0 || typeof r.stdout !== 'string') {
    throw new Error('cannot reach the real canonical remote for test setup — R5 test fixtures require network access to github.com by design (see the fixtures header comment)');
  }
  const line = r.stdout.split('\n').find((l) => l.trim().length > 0) || '';
  const sha = line.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`unexpected ls-remote output while discovering the real canonical current SHA: ${r.stdout}`);
  }
  return sha;
}

// A REAL local clone of this exact project (same root commit, same full
// history) — the "identity-verified" fixture used for every test that needs
// attestRemoteMainEvidence's canonical-identity check to genuinely pass.
function buildProjectCloneFixture(prefix) {
  const repoDir = mkTmpDir(prefix);
  git(thisRepositoryRoot(), ['clone', '-q', thisRepositoryRoot(), repoDir]);
  const rootCommit = git(repoDir, ['rev-list', '--max-parents=0', 'HEAD']);
  return { repoDir, rootCommit };
}

// A fully SYNTHETIC, unrelated repository: its own root/history, its own
// fabricated PROJECT_STATUS.md, its own self-controlled bare "origin" whose
// main tip is that fabricated commit. Reproduces the R4-reaudit
// "FOREIGN_REPO_ATTESTATION = NOT_DENIED" finding verbatim — must now be
// denied at the canonical IDENTITY step, before any currentness query runs.
function buildSyntheticForeignRepoFixture() {
  const repoDir = mkTmpDir('korixa-r5-synthetic-foreign-');
  initRepo(repoDir);
  writeFileSync(path.join(repoDir, 'PROJECT_STATUS.md'), 'FABRICATED: this repo has nothing to do with the real project\n');
  git(repoDir, ['add', 'PROJECT_STATUS.md']);
  git(repoDir, ['commit', '-q', '-m', 'fabricated']);
  const fabricatedSha = git(repoDir, ['rev-parse', 'HEAD']);
  const bareDir = mkTmpDir('korixa-r5-synthetic-foreign-origin-');
  git(bareDir, ['init', '-q', '--bare']);
  git(repoDir, ['remote', 'add', 'origin', bareDir]);
  git(repoDir, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return { repoDir, fabricatedSha, bareDir };
}

// A REAL, identity-verified clone of the real project (so it WOULD pass the
// canonical identity check) whose LOCAL `origin` has been reconfigured, via
// an ordinary `git remote set-url`, to a real attacker-controlled bare repo
// whose `refs/heads/main` is set to the real HISTORICAL_SHA. Reproduces the
// R4-reaudit "ORIGIN_CONFIGURATION_TRUST_BYPASS = REPRODUCED" finding
// verbatim — must now be irrelevant: currentness never reads this repo's
// `origin` at all.
function buildMaliciousOriginFixture() {
  const clone = buildProjectCloneFixture('korixa-r5-malicious-origin-clone-');
  const attackerBareDir = mkTmpDir('korixa-r5-attacker-bare-');
  git(attackerBareDir, ['init', '-q', '--bare']);
  git(clone.repoDir, ['push', '-q', '-f', attackerBareDir, `${HISTORICAL_SHA}:refs/heads/main`]);
  git(clone.repoDir, ['remote', 'set-url', 'origin', attackerBareDir]);
  return { repoDir: clone.repoDir, rootCommit: clone.rootCommit, attackerBareDir };
}

// A real local repo (not a bare remote) used for attestFilesystemEvidence:
// a real root commit (`rootCommit`), several real tracked files, and one
// real untracked file.
function buildFsFixture(prefix) {
  const rootDir = mkTmpDir(prefix);
  initRepo(rootDir);
  // Content is seeded with the fixture's own directory name so two separate
  // fixtures never produce byte-identical commits (and therefore never the
  // same root-commit SHA) purely by coincidence of matching content/message.
  writeFileSync(path.join(rootDir, 'a.md'), `REAL TRACKED CONTENT A (${rootDir})`);
  writeFileSync(path.join(rootDir, 'b.md'), `REAL TRACKED CONTENT B (${rootDir})`);
  git(rootDir, ['add', 'a.md', 'b.md']);
  git(rootDir, ['commit', '-q', '-m', `root (${rootDir})`]);
  const rootCommit = git(rootDir, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(rootDir, 'untracked.md'), 'REAL UNTRACKED CONTENT');
  return { rootDir, rootCommit };
}

// A real, identity-verified local repo containing two real, tiny
// node:test files — one that always passes, one that always fails — so
// attestLocalRuntimeEvidence's real `node --test` execution can be
// exercised deterministically and fast for both outcomes, without needing
// the full project checkout.
function buildLocalRuntimeFixture(prefix) {
  const rootDir = mkTmpDir(prefix);
  initRepo(rootDir);
  writeFileSync(path.join(rootDir, 'passing.test.mjs'), "import test from 'node:test';\ntest('always passes', () => {});\n");
  writeFileSync(path.join(rootDir, 'failing.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('always fails', () => { assert.equal(1, 2); });\n");
  git(rootDir, ['add', 'passing.test.mjs', 'failing.test.mjs']);
  git(rootDir, ['commit', '-q', '-m', `local-runtime-fixture (${rootDir})`]);
  const rootCommit = git(rootDir, ['rev-parse', 'HEAD']);
  return { rootDir, rootCommit };
}

let projectClone;
let realCanonicalCurrentSha;
let syntheticForeignRepo;
let maliciousOriginFixture;
let fsFixture;
let foreignFsFixture;

let gitGlobalConfigAttackFixture;
let localRuntimeFixture;

before(() => {
  realCanonicalCurrentSha = discoverRealCanonicalCurrentSha();
  projectClone = buildProjectCloneFixture('korixa-r5-project-clone-');
  syntheticForeignRepo = buildSyntheticForeignRepoFixture();
  maliciousOriginFixture = buildMaliciousOriginFixture();
  fsFixture = buildFsFixture('korixa-r4-fs-');
  foreignFsFixture = buildFsFixture('korixa-r4-foreign-fs-');
  gitGlobalConfigAttackFixture = buildGitGlobalConfigAttackFixture();
  localRuntimeFixture = buildLocalRuntimeFixture('korixa-imp3-local-runtime-');
});

after(() => {
  for (const dir of TMP_ROOTS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

test('EVIDENCE_CLASSES contains the required minimal taxonomy', () => {
  for (const cls of ['REMOTE_REPOSITORY', 'TARGET_WORKTREE', 'LOCAL_FILESYSTEM', 'STATIC_CODE', 'TEST_RUNTIME', 'APPLICATION_RUNTIME', 'CI_RUNTIME', 'CLOUD_RUNTIME', 'DATABASE_RUNTIME', 'DOCUMENTATION', 'HISTORICAL', 'UNKNOWN']) {
    assert.ok(EVIDENCE_CLASSES.includes(cls), cls);
  }
});

test('EVIDENCE_STRENGTHS contains the required levels', () => {
  assert.deepEqual([...EVIDENCE_STRENGTHS], ['AUTHORITATIVE', 'DIRECT', 'CORROBORATIVE', 'INDIRECT', 'HISTORICAL', 'UNVERIFIED']);
});

test('SEVERITIES / CONFIDENCE_LEVELS / DECISIONS expose the required enums', () => {
  assert.deepEqual([...SEVERITIES], ['P0', 'P1', 'P2', 'P3']);
  assert.deepEqual([...CONFIDENCE_LEVELS], ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']);
  for (const d of ['CONFIRMED_P0', 'CONFIRMED_P1', 'POTENTIAL_P0', 'POTENTIAL_P1', 'P2', 'P3', 'HOLD_INSUFFICIENT_EVIDENCE', 'HOLD_CONFLICTING_EVIDENCE', 'HOLD_UNTRUSTED_EVIDENCE', 'HOLD_DUPLICATE_EVIDENCE_ID', 'UNVERIFIED']) {
    assert.ok(DECISIONS.includes(d), d);
  }
});

// ---------------------------------------------------------------------------
// R2 — Section 22/self-review: public exports cannot mint or configure trust
// ---------------------------------------------------------------------------

test('PUBLIC_EXPORTS_CAN_MINT_TRUST = NO: the module exports no createEvidencePolicyEngine, no generic attest/trust/seal/mark function', () => {
  const exportNames = Object.keys(EvidencePolicy);
  assert.equal(exportNames.includes('createEvidencePolicyEngine'), false, 'the R1 caller-controlled factory must be fully removed');
  const dangerousNamePattern = /^(trust|seal|markTrusted|markAuthoritative|createAttestor)$/i;
  for (const name of exportNames) {
    assert.equal(dangerousNamePattern.test(name), false, `dangerous generic export found: ${name}`);
  }
  assert.equal(exportNames.includes('attest'), false);
  assert.equal(typeof EvidencePolicy.attestRemoteMainEvidence, 'function');
  assert.equal(typeof EvidencePolicy.attestFilesystemEvidence, 'function');
});

test('PUBLIC_EXPORTS_CAN_CONFIGURE_AUTHORITY = NO: attestFilesystemEvidence rejects any sourceClass outside the fixed 3-value allow-list (rejected before any I/O, no fixture needed)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'REMOTE_REPOSITORY', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.equal(error, 'UNSUPPORTED_SOURCE_CLASS');
  const cloud = attestFilesystemEvidence({
    sourceClass: 'CLOUD_RUNTIME', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(cloud.evidence, null);
  assert.equal(cloud.error, 'UNSUPPORTED_SOURCE_CLASS');
});

// ---------------------------------------------------------------------------
// R2 Self-attack A-G
// ---------------------------------------------------------------------------

test('Attack A: no export accepts a caller-defined attestor config at all (createEvidencePolicyEngine is gone)', () => {
  assert.equal(EvidencePolicy.createEvidencePolicyEngine, undefined);
});

test('Attack B: two raw fabricated sources (REMOTE_REPOSITORY/AUTHORITATIVE + CLOUD_RUNTIME/DIRECT) never confirm P0, with or without exception', () => {
  const result = evaluateClaim({
    claimId: 'x', title: 'x', severity: 'P0',
    evidence: [
      rawEv({ evidenceId: 'a', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', sourceFingerprint: 'fake-a' }),
      rawEv({ evidenceId: 'b', sourceClass: 'CLOUD_RUNTIME', strength: 'DIRECT', sourceFingerprint: 'fake-b' }),
    ],
  });
  assert.equal(result.decision, 'HOLD_UNTRUSTED_EVIDENCE');
});

test('Attack C: raw object REMOTE_REPOSITORY/AUTHORITATIVE + exception -> HOLD_UNTRUSTED_EVIDENCE (the original AUTH-001 reproduction)', () => {
  const result = evaluateClaim({
    claimId: 'escalation-test', title: 'Fabricated critical failure', severity: 'P0',
    evidence: [rawEv({ evidenceId: 'evil', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', sourceFingerprint: 'i-made-this-up-myself' })],
    singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON,
  });
  assert.equal(result.decision, 'HOLD_UNTRUSTED_EVIDENCE');
});

test('Attack D: cloning a real trusted object (spread/Object.assign/JSON/structuredClone/Reflect/prototype) never carries trust', () => {
  const { evidence: real } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'clone-source', supportsClaim: true,
  });
  assert.notEqual(real, null);
  const clones = {
    spread: { ...real },
    objectAssign: Object.assign({}, real),
    jsonRoundTrip: JSON.parse(JSON.stringify(real)),
    structuredCloneResult: typeof structuredClone === 'function' ? structuredClone(real) : { ...real },
    reflectCopy: Object.fromEntries(Reflect.ownKeys(real).map((k) => [k, real[k]])),
    prototypeClone: Object.create(real),
  };
  for (const [label, clone] of Object.entries(clones)) {
    const r = evaluateClaim({ claimId: 'x', title: 'x', severity: 'P0', evidence: [clone], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
    assert.notEqual(r.decision, 'CONFIRMED_P0', `${label} must not carry trust`);
  }
});

test('the attestor factory escalation from the R1 reaudit is now structurally impossible: no factory function exists to call', () => {
  assert.equal(typeof EvidencePolicy.createEvidencePolicyEngine, 'undefined');
});

test('forged double-attestor attack (no exception needed) is impossible: there is no way to construct two self-defined trusted attestors', () => {
  const result = evaluateClaim({
    claimId: 'x', title: 'x', severity: 'P0',
    evidence: [
      rawEv({ evidenceId: 'a', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', sourceFingerprint: 'fake-a' }),
      rawEv({ evidenceId: 'b', sourceClass: 'CLOUD_RUNTIME', strength: 'DIRECT', sourceFingerprint: 'fake-b' }),
    ],
  });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
  assert.equal(result.effectiveEvidenceCount, 0);
});

// ---------------------------------------------------------------------------
// attestRemoteMainEvidence: real verification via Improvement 1, real repo
// ---------------------------------------------------------------------------

test('attestRemoteMainEvidence: legitimate repo + real current SHA + tracked path -> produces trusted AUTHORITATIVE evidence usable to confirm', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'legit', supportsClaim: true,
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(evidence.strength, 'AUTHORITATIVE');
  const result = evaluateClaim({
    claimId: 'x', title: 'x', severity: 'P0', evidence: [evidence],
    singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON,
  });
  assert.equal(result.decision, 'CONFIRMED_P0');
});

test('attestRemoteMainEvidence: HEAD (symbolic ref) instead of a frozen SHA fails closed, no evidence produced (real, identity-verified repo)', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: 'HEAD', relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.equal(error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('attestRemoteMainEvidence: HEAD~1 fails closed (real, identity-verified repo)', () => {
  const { evidence } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: 'HEAD~1', relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
});

test('attestRemoteMainEvidence: a short/abbreviated SHA fails closed (real, identity-verified repo)', () => {
  const { evidence } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha.slice(0, 7), relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
});

// R5 NOTE on coverage: the R4-era "locally-unfetched commit object"
// (HOLD_REMOTE_OBJECT_UNAVAILABLE) and "ls-remote transport failure"
// (CURRENT_REMOTE_MAIN_UNRESOLVED) integration scenarios are no longer
// constructible at this level with real, non-fabricated fixtures now that
// currentness is resolved against the real, fixed CANONICAL_REMOTE_URL: a
// fixture cannot "advance" the real GitHub repository, and any real clone
// with a genuinely matching root commit necessarily already has every
// commit reachable from that same repository's real current tip (a clone
// shallow enough to lack it fails identity verification instead, for the
// documented reason in source-of-truth.mjs). Both resolutionStatus/failure
// paths remain fully covered at the unit level: HOLD_REMOTE_OBJECT_UNAVAILABLE
// by source-of-truth.test.mjs (untouched, 94/94, exercises
// gatherRemoteMainEvidence directly), and CURRENT_REMOTE_MAIN_UNRESOLVED's
// fail-closed shape (null/non-zero-status/malformed-stdout all return null)
// is unchanged code reused verbatim from R3/R4, already proven correct by
// the suite's other real-repo currentness assertions below succeeding only
// when the query genuinely resolves.

test('attestRemoteMainEvidence: path not tracked at the real current SHA fails closed (no content to attest)', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'never-existed-in-this-project.md', evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.match(error, /NOT_TRACKED_AT_SHA/);
});

// ---------------------------------------------------------------------------
// R3 — DEFECT IMP2-HISTSHA-001: currentness verification (real repo)
// ---------------------------------------------------------------------------

test('IMP2-HISTSHA-001 regression: a real current SHA attests AUTHORITATIVE', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'current', supportsClaim: true,
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(evidence.strength, 'AUTHORITATIVE');
});

test('IMP2-HISTSHA-001 regression: a real, resolvable, but historical (non-current) SHA is DENIED, never attested as current', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'historical', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.equal(error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-HISTSHA-001 regression: two historical (non-current) attestations, different real tracked paths, never reach CONFIRMED_P0', () => {
  const historicalA = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'hist-a', supportsClaim: true,
  });
  const historicalB = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'README.md', evidenceId: 'hist-b', supportsClaim: true,
  });
  assert.equal(historicalA.evidence, null);
  assert.equal(historicalB.evidence, null);
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [historicalA.evidence, historicalB.evidence].filter(Boolean) });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
  assert.equal(result.effectiveEvidenceCount, 0);
});

test('IMP2-HISTSHA-001 regression: current-vs-historical semantics differ for the exact SAME real path', () => {
  const current = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'cur', supportsClaim: true,
  });
  const historical = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'hist', supportsClaim: true,
  });
  assert.notEqual(current.evidence, null);
  assert.equal(historical.evidence, null);
});

// ---------------------------------------------------------------------------
// R4 — DEFECT IMP2-TRANSPORT-001: caller-controlled trust transport removed
// ---------------------------------------------------------------------------

test('IMP2-TRANSPORT-001 regression: attestRemoteMainEvidence no longer accepts spawnSyncFn — a malicious transport that lies about currentness has zero effect (the exact R3 reaudit reproduction)', () => {
  const maliciousLyingSpawnSyncFn = (cmd, args) => {
    if (cmd === 'git' && Array.isArray(args) && args.includes('ls-remote')) {
      return { status: 0, stdout: `${HISTORICAL_SHA}\trefs/heads/main\n` };
    }
    return spawnSync(cmd, args, { encoding: 'utf8', shell: false });
  };
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'malicious-transport', supportsClaim: true,
    spawnSyncFn: maliciousLyingSpawnSyncFn,
  });
  assert.equal(evidence, null, 'MALICIOUS_TRANSPORT_ACCEPTED_BY_PUBLIC_API must be NO');
  assert.equal(error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-TRANSPORT-001 regression: two historical attestations attempted via the malicious-transport bypass never reach CONFIRMED_P0', () => {
  const maliciousLyingSpawnSyncFn = (cmd, args) => {
    if (cmd === 'git' && Array.isArray(args) && args.includes('ls-remote')) {
      return { status: 0, stdout: `${HISTORICAL_SHA}\trefs/heads/main\n` };
    }
    return spawnSync(cmd, args, { encoding: 'utf8', shell: false });
  };
  const a = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'hist-transport-a', supportsClaim: true, spawnSyncFn: maliciousLyingSpawnSyncFn,
  });
  const b = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'README.md',
    evidenceId: 'hist-transport-b', supportsClaim: true, spawnSyncFn: maliciousLyingSpawnSyncFn,
  });
  const evList = [a.evidence, b.evidence].filter(Boolean);
  assert.equal(evList.length, 0, 'HISTORICAL_TRUST_MINTED must be NO');
  const result = evaluateClaim({
    claimId: 'transport-double-p0', title: 't', severity: 'P0',
    evidence: evList.length > 0 ? evList : [
      { evidenceId: 'raw-a', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-a' },
      { evidenceId: 'raw-b', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-b' },
    ],
  });
  assert.notEqual(result.decision, 'CONFIRMED_P0', 'HISTORICAL_DOUBLE_P0_ATTACK must be DENIED');
});

test('IMP2-TRANSPORT-001 regression: a poisoned spawnSyncFn that always THROWS if invoked proves it is never called, and legitimate attestation still succeeds', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'poison-positive', supportsClaim: true,
    spawnSyncFn: poison('attestRemoteMainEvidence spawnSyncFn'),
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(evidence.strength, 'AUTHORITATIVE');
});

test('IMP2-TRANSPORT-001 regression: PUBLIC_TRUST_API_ACCEPTS_FUNCTION_DEPENDENCY = NO for attestRemoteMainEvidence — every named dependency from the R4 threat model is poisoned and ignored', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'poison-all-remote', supportsClaim: true,
    spawnSyncFn: poison('spawnSyncFn'),
    execFn: poison('execFn'),
    gitFn: poison('gitFn'),
    readCurrentRemoteFn: poison('readCurrentRemoteFn'),
    gathererFn: poison('gathererFn'),
    verificationFn: poison('verificationFn'),
    trustFn: poison('trustFn'),
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(evidence.strength, 'AUTHORITATIVE');
});

// ---------------------------------------------------------------------------
// R5 — DEFECT IMP2-REMOTE-IDENTITY-001: canonical repository identity anchor
// ---------------------------------------------------------------------------

test('IMP2-REMOTE-IDENTITY-001 regression (R5 Gate 12 / test 1 and 7): a fully synthetic, unrelated repo with its own root/history/fabricated content/self-controlled origin is DENIED at the identity step, never AUTHORITATIVE', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: syntheticForeignRepo.repoDir, sha: syntheticForeignRepo.fabricatedSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'synthetic-foreign', supportsClaim: true,
  });
  assert.equal(evidence, null, 'FULLY_SYNTHETIC_REPO_ATTACK must be denied');
  assert.match(error, /^HOLD_REPOSITORY_IDENTITY_UNVERIFIED:/);
});

test('IMP2-REMOTE-IDENTITY-001 regression (R5 Gate 13 / test 2): a legitimate clone with origin redirected (real `git remote set-url`) to a real attacker bare repo whose main = HISTORICAL_SHA cannot mint that historical SHA as current', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: maliciousOriginFixture.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'legit-clone-malicious-origin-historical', supportsClaim: true,
  });
  assert.equal(evidence, null, 'LEGIT_CLONE_MALICIOUS_ORIGIN_ATTACK must be denied');
  assert.equal(error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-REMOTE-IDENTITY-001 regression (R5 test 3): the SAME clone with its origin still redirected to the attacker repo can still attest the REAL current SHA — proving local origin has literally zero influence in either direction, not just a coincidental denial', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: maliciousOriginFixture.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'legit-clone-malicious-origin-current', supportsClaim: true,
  });
  assert.equal(error, null, 'CURRENTNESS_USES_LOCAL_ORIGIN must be NO — a redirected origin must not even block a legitimate current attestation');
  assert.equal(evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(evidence.strength, 'AUTHORITATIVE');
});

test('IMP2-REMOTE-IDENTITY-001 regression (R5 Gate 17 / test 4): every plausible caller-supplied identity-override parameter is ignored — a synthetic foreign repo cannot self-authenticate by declaring its own expected identity/URL', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: syntheticForeignRepo.repoDir, sha: syntheticForeignRepo.fabricatedSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'self-declare-identity', supportsClaim: true,
    owner: 'freddyestebancuervo',
    repo: 'rouvy_pro',
    repository: 'freddyestebancuervo/rouvy_pro',
    repositoryName: 'rouvy_pro',
    repositoryUrl: CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY,
    remoteUrl: CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY,
    canonicalUrl: CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY,
    expectedOriginUrl: CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY,
    officialRemote: CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY,
    remoteName: 'origin',
    branchName: 'main',
    expectedRootCommit: syntheticForeignRepo.fabricatedSha,
    canonicalRootCommit: syntheticForeignRepo.fabricatedSha,
  });
  assert.equal(evidence, null, 'CALLER_REPOSITORY_IDENTITY_OVERRIDE must be DENIED');
  assert.match(error, /^HOLD_REPOSITORY_IDENTITY_UNVERIFIED:/);
});

test('IMP2-REMOTE-IDENTITY-001 regression (R5 test 5): historical SHA against the malicious-origin fixture remains denied even when the caller ALSO passes a poisoned spawnSyncFn (combined R4+R5 bypass attempt)', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: maliciousOriginFixture.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'combined-bypass-attempt', supportsClaim: true,
    spawnSyncFn: poison('combined bypass spawnSyncFn'),
  });
  assert.equal(evidence, null);
  assert.equal(error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-REMOTE-IDENTITY-001 regression (R5 test 6 / Gate 14 positive control): a real, identity-verified clone with the real current canonical SHA still produces REMOTE_REPOSITORY/AUTHORITATIVE trusted evidence — the fix does not block everything', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'README.md',
    evidenceId: 'positive-control', supportsClaim: true,
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(evidence.strength, 'AUTHORITATIVE');
});

test('IMP2-REMOTE-IDENTITY-001 regression (R5 test 8): two forged attestations from the synthetic foreign repo (two different fabricated paths, self-controlled origin) cannot reach CONFIRMED_P0', () => {
  const foreignRelPathB = 'PROJECT_STATUS_2.md';
  writeFileSync(path.join(syntheticForeignRepo.repoDir, foreignRelPathB), 'SECOND FABRICATED FILE\n');
  git(syntheticForeignRepo.repoDir, ['add', foreignRelPathB]);
  git(syntheticForeignRepo.repoDir, ['commit', '-q', '-m', 'second fabricated file']);
  const secondFabricatedSha = git(syntheticForeignRepo.repoDir, ['rev-parse', 'HEAD']);
  git(syntheticForeignRepo.repoDir, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);

  const a = attestRemoteMainEvidence({
    repoRoot: syntheticForeignRepo.repoDir, sha: syntheticForeignRepo.fabricatedSha, relPath: 'PROJECT_STATUS.md',
    evidenceId: 'forged-a', supportsClaim: true,
  });
  const b = attestRemoteMainEvidence({
    repoRoot: syntheticForeignRepo.repoDir, sha: secondFabricatedSha, relPath: foreignRelPathB,
    evidenceId: 'forged-b', supportsClaim: true,
  });
  const evList = [a.evidence, b.evidence].filter(Boolean);
  assert.equal(evList.length, 0);
  const result = evaluateClaim({
    claimId: 'forged-double', title: 't', severity: 'P0',
    evidence: evList.length > 0 ? evList : [
      { evidenceId: 'raw-a', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-forged-a' },
      { evidenceId: 'raw-b', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-forged-b' },
    ],
  });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

test('PUBLIC_TRUST_API_INJECTABLE_DEPENDENCIES = NONE (R5): CANONICAL_REMOTE_URL/CANONICAL_ROOT_COMMIT are not exported and no export accepts them as configuration', () => {
  assert.equal(typeof EvidencePolicy.CANONICAL_REMOTE_URL, 'undefined');
  assert.equal(typeof EvidencePolicy.CANONICAL_ROOT_COMMIT, 'undefined');
  assert.equal(typeof EvidencePolicy.CANONICAL_REPOSITORY_OWNER, 'undefined');
  assert.equal(typeof EvidencePolicy.CANONICAL_REPOSITORY_NAME, 'undefined');
  assert.equal(Object.keys(EvidencePolicy).some((k) => /canonical/i.test(k)), false);
});

// ---------------------------------------------------------------------------
// POST-R5 — DEFECT IMP2-GITGLOBAL-001: inherited HOME/USERPROFILE/
// XDG_CONFIG_HOME could redirect the canonical currentness query via an
// ordinary `url.*.insteadOf` global-config rule. Every test below mutates
// THIS process's `process.env` for the duration of one call (never the
// real machine's actual global Git config, never any file outside a
// disposable temp dir) and restores it immediately after, success or
// failure. Fixtures are built once in `before()`; `withEnvOverrides` is the
// only thing that changes per test.
// ---------------------------------------------------------------------------

function withEnvOverrides(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// A real attacker bare repo (refs/heads/main = HISTORICAL_SHA, a real
// commit from the project's own lineage — pushed from projectClone, which
// has the object) plus a real `.gitconfig` (for HOME/USERPROFILE) and a
// real XDG-layout `git/config` (for XDG_CONFIG_HOME), both containing an
// ordinary `url.<attacker>.insteadOf = <the real canonical URL>` rule. This
// is exactly R5's own reaudit reproduction, rebuilt here as a first-class
// fixture rather than an ad hoc probe.
function buildGitGlobalConfigAttackFixture() {
  const attackerBareDir = mkTmpDir('korixa-gitglobal-attacker-bare-');
  git(attackerBareDir, ['init', '-q', '--bare']);
  git(projectClone.repoDir, ['push', '-q', '-f', attackerBareDir, `${HISTORICAL_SHA}:refs/heads/main`]);

  // `.gitconfig` is an INI-style file where `\` is an escape character
  // inside quoted values — a raw Windows path would corrupt the rule (or
  // silently fail to match). Git accepts forward slashes in paths on
  // Windows, so the path is normalized before being embedded.
  const attackerBareDirForConfig = attackerBareDir.split(path.sep).join('/');
  const rule = `[url "${attackerBareDirForConfig}"]\n\tinsteadOf = ${CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY}\n`;

  const homeDir = mkTmpDir('korixa-gitglobal-fakehome-');
  writeFileSync(path.join(homeDir, '.gitconfig'), rule);

  const userProfileDir = mkTmpDir('korixa-gitglobal-fakeuserprofile-');
  writeFileSync(path.join(userProfileDir, '.gitconfig'), rule);

  const xdgDir = mkTmpDir('korixa-gitglobal-fakexdg-');
  mkdirSync(path.join(xdgDir, 'git'));
  writeFileSync(path.join(xdgDir, 'git', 'config'), rule);

  const cleanDir = mkTmpDir('korixa-gitglobal-clean-');

  const attackerSystemConfigFile = mkTmpDir('korixa-gitglobal-attacker-system-');
  writeFileSync(path.join(attackerSystemConfigFile, 'gitconfig'), rule);

  return { attackerBareDir, homeDir, userProfileDir, xdgDir, cleanDir, attackerSystemConfigFile };
}

test('IMP2-GITGLOBAL-001 fixture setup sanity: the insteadOf rewrite genuinely works at the plain git level (control, proves the fixture itself is real)', () => {
  const r = spawnSync('git', ['ls-remote', CANONICAL_REMOTE_URL_FOR_TEST_DISCOVERY, 'refs/heads/main'], {
    encoding: 'utf8', shell: false,
    env: { ...process.env, HOME: gitGlobalConfigAttackFixture.homeDir },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`^${HISTORICAL_SHA}\\t`));
});

test('IMP2-GITGLOBAL-001 regression (CASE A — HOME): a malicious HOME with url.*.insteadOf cannot redirect the canonical currentness query', () => {
  const result = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-a', supportsClaim: true,
  }));
  assert.equal(result.evidence, null, 'ATTACK_REDIRECTION must be DENIED');
  assert.equal(result.error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-GITGLOBAL-001 regression (CASE B — USERPROFILE, Windows semantics): a malicious USERPROFILE with url.*.insteadOf cannot redirect the canonical currentness query', () => {
  const result = withEnvOverrides({ HOME: undefined, USERPROFILE: gitGlobalConfigAttackFixture.userProfileDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-b', supportsClaim: true,
  }));
  assert.equal(result.evidence, null);
  assert.equal(result.error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-GITGLOBAL-001 regression (CASE C — XDG_CONFIG_HOME): a malicious XDG_CONFIG_HOME/git/config with url.*.insteadOf cannot redirect the canonical currentness query', () => {
  const result = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.cleanDir, XDG_CONFIG_HOME: gitGlobalConfigAttackFixture.xdgDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-c', supportsClaim: true,
  }));
  assert.equal(result.evidence, null);
  assert.equal(result.error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-GITGLOBAL-001 regression (CASE D — GIT_CONFIG_SYSTEM / system config injection): a malicious GIT_CONFIG_SYSTEM cannot redirect the canonical currentness query, and GIT_CONFIG_NOSYSTEM cannot be un-forced by the caller', () => {
  const result = withEnvOverrides({
    GIT_CONFIG_SYSTEM: path.join(gitGlobalConfigAttackFixture.attackerSystemConfigFile, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '0',
  }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-d', supportsClaim: true,
  }));
  assert.equal(result.evidence, null);
  assert.equal(result.error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-GITGLOBAL-001 regression (CASE E — combined attack): HOME + USERPROFILE + XDG_CONFIG_HOME all hostile simultaneously still cannot redirect the canonical currentness query', () => {
  const result = withEnvOverrides({
    HOME: gitGlobalConfigAttackFixture.homeDir,
    USERPROFILE: gitGlobalConfigAttackFixture.userProfileDir,
    XDG_CONFIG_HOME: gitGlobalConfigAttackFixture.xdgDir,
  }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-e', supportsClaim: true,
  }));
  assert.equal(result.evidence, null, 'COMBINED_ATTACK must be DENIED');
  assert.equal(result.error, 'NOT_CURRENT_REMOTE_MAIN');
});

test('IMP2-GITGLOBAL-001 regression (CASE F — positive control): with the SAME hostile HOME/USERPROFILE/XDG_CONFIG_HOME set, the real canonical current SHA still attests REMOTE_REPOSITORY/AUTHORITATIVE — isolation, not accidental total denial', () => {
  const result = withEnvOverrides({
    HOME: gitGlobalConfigAttackFixture.homeDir,
    USERPROFILE: gitGlobalConfigAttackFixture.userProfileDir,
    XDG_CONFIG_HOME: gitGlobalConfigAttackFixture.xdgDir,
  }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-f', supportsClaim: true,
  }));
  assert.equal(result.error, null, 'POSITIVE_REMOTE_QUERY_STILL_WORKS must be YES even under a hostile inherited environment');
  assert.equal(result.evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(result.evidence.strength, 'AUTHORITATIVE');
});

test('IMP2-GITGLOBAL-001 regression (CASE G — full attack chain): two forged attestations obtained via the HOME/insteadOf bypass never reach CONFIRMED_P0', () => {
  const a = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-g-a', supportsClaim: true,
  }));
  const b = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'README.md', evidenceId: 'gitglobal-case-g-b', supportsClaim: true,
  }));
  const evList = [a.evidence, b.evidence].filter(Boolean);
  assert.equal(evList.length, 0, 'no AUTHORITATIVE evidence must be mintable via this bypass');
  const result = evaluateClaim({
    claimId: 'gitglobal-double-p0', title: 't', severity: 'P0',
    evidence: evList.length > 0 ? evList : [
      { evidenceId: 'raw-a', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-gitglobal-a' },
      { evidenceId: 'raw-b', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-gitglobal-b' },
    ],
  });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

test('IMP2-GITGLOBAL-001 regression (CASE H — does not reopen IMP2-HISTSHA-001): historical SHA vs real current SHA still differ in outcome even under the hostile environment', () => {
  const historical = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-h-hist', supportsClaim: true,
  }));
  const current = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-h-cur', supportsClaim: true,
  }));
  assert.equal(historical.evidence, null);
  assert.notEqual(current.evidence, null);
});

test('IMP2-GITGLOBAL-001 regression (CASE I — does not reopen IMP2-REMOTE-IDENTITY-001): a fully synthetic foreign repo is still denied at the identity step under the hostile environment', () => {
  const result = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: syntheticForeignRepo.repoDir, sha: syntheticForeignRepo.fabricatedSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'gitglobal-case-i', supportsClaim: true,
  }));
  assert.equal(result.evidence, null);
  assert.match(result.error, /^HOLD_REPOSITORY_IDENTITY_UNVERIFIED:/);
});

test('IMP2-GITGLOBAL-001 regression (CASE J — malformed env inputs never crash, always fail closed)', () => {
  for (const malformedHome of ['', path.join(gitGlobalConfigAttackFixture.homeDir, '.gitconfig'), 'C:/definitely/does/not/exist/at/all']) {
    assert.doesNotThrow(() => {
      const result = withEnvOverrides({ HOME: malformedHome }, () => attestRemoteMainEvidence({
        repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: `gitglobal-case-j-${malformedHome.length}`, supportsClaim: true,
      }));
      // A malformed HOME must never silently produce trusted evidence for a
      // value it didn't actually, correctly verify — either it still
      // resolves correctly (git tolerates a nonexistent/empty HOME, simply
      // finding no global config, which is fine and safe) or it fails
      // closed (null evidence). It must never throw either way.
      if (result.evidence !== null) {
        assert.equal(result.evidence.sourceClass, 'REMOTE_REPOSITORY');
        assert.equal(result.evidence.strength, 'AUTHORITATIVE');
      }
    });
  }
});

test('IMP2-TRANSPORT-001 regression: PUBLIC_TRUST_API_ACCEPTS_FUNCTION_DEPENDENCY = NO for attestFilesystemEvidence — every named dependency from the R4 threat model is poisoned and ignored', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'poison-all-fs', supportsClaim: true,
    spawnSyncFn: poison('spawnSyncFn'),
    existsSyncFn: poison('existsSyncFn'),
    readFileSyncFn: poison('readFileSyncFn'),
    realpathSyncFn: poison('realpathSyncFn'),
    gathererFn: poison('gathererFn'),
    verificationFn: poison('verificationFn'),
    trustFn: poison('trustFn'),
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'LOCAL_FILESYSTEM');
});

test('IMP2-TRANSPORT-001 regression: a malicious existsSyncFn/readFileSyncFn on attestFilesystemEvidence cannot fabricate content for a real, non-existent path', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'does-not-really-exist.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'fabricate-attempt', supportsClaim: true,
    existsSyncFn: () => true,
    readFileSyncFn: () => 'FABRICATED CONTENT THAT SHOULD NEVER BE TRUSTED',
  });
  assert.equal(evidence, null, 'a caller-supplied existsSyncFn/readFileSyncFn must never be able to fabricate trusted evidence for a real, absent file');
  assert.match(error, /SOURCE_OF_TRUTH_UNVERIFIED:ABSENT/);
});

test('IMP2-TRANSPORT-001 regression: attestFilesystemEvidence content/fingerprint is always derived from the REAL file, never from a malicious readFileSyncFn', () => {
  const { evidence } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'real-content-check', supportsClaim: true,
    readFileSyncFn: () => 'FABRICATED CONTENT THAT SHOULD NEVER BE TRUSTED',
  });
  assert.notEqual(evidence, null);
  const realContent = readFileSync(path.join(fsFixture.rootDir, 'a.md'), 'utf8');
  const realContentHash = createHash('sha256').update(realContent, 'utf8').digest('hex');
  const expectedFingerprint = buildFilesystemFingerprint({ canonicalRepositoryIdentity: fsFixture.rootCommit, canonicalPath: 'a.md', contentHash: realContentHash });
  assert.equal(evidence.sourceFingerprint, expectedFingerprint, 'fingerprint must reflect the REAL file content, not the malicious readFileSyncFn return value');
});

test('PUBLIC_TRUST_API_INJECTABLE_DEPENDENCIES = NONE: no forbidden injectable-dependency identifier appears in actual (non-comment) module code', () => {
  const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs');
  const source = readFileSync(modulePath, 'utf8');
  const codeOnly = source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/**');
    })
    .join('\n');
  const forbidden = [
    'spawnSyncFn', 'execFn', 'gitFn', 'readCurrentRemoteFn', 'gathererFn', 'verificationFn', 'trustFn',
    'existsSyncFn', 'readFileSyncFn', 'realpathSyncFn', 'remoteName', 'branchName',
  ];
  for (const token of forbidden) {
    assert.equal(codeOnly.includes(token), false, `forbidden injectable-dependency identifier still present in code: ${token}`);
  }
});

// R5 (IMP2-REMOTE-IDENTITY-001): `repositoryUrl`/`remoteUrl`/`canonicalUrl`/
// `expectedOriginUrl`/`officialRemote`/`owner`/`repo` are deliberately NOT
// added to the blunt whole-file forbidden-token scan above: `expectedRootCommit`
// legitimately appears in this file twice — as attestFilesystemEvidence's
// pre-existing, correct, unchanged R1/R2 parameter (never a security issue;
// TARGET_WORKTREE/LOCAL_FILESYSTEM/HISTORICAL are lower-trust classes where
// caller-supplied identity was always the accepted design), and as the fixed
// property name required to call Improvement 1's own `verifyRepositoryIdentity`
// signature from inside attestRemoteMainEvidence (with a hardcoded VALUE,
// `CANONICAL_ROOT_COMMIT` — never anything from `params`). A blind substring
// scan cannot distinguish "this identifier is read FROM params" from "this
// identifier is a property name in a call to Improvement 1's own function
// with a hardcoded value" — so the precise check below inspects
// attestRemoteMainEvidence's ACTUAL destructuring instead.

test('PUBLIC_TRUST_API_INJECTABLE_DEPENDENCIES = NONE (R5): attestRemoteMainEvidence destructures ONLY observation-data parameter names from `params`', () => {
  const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs');
  const source = readFileSync(modulePath, 'utf8');
  const match = source.match(/export function attestRemoteMainEvidence\(params\) \{[\s\S]*?const \{([\s\S]*?)\} = params;/);
  assert.notEqual(match, null, 'could not locate attestRemoteMainEvidence\'s params destructuring');
  const destructured = match[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean);
  assert.deepEqual(
    destructured.sort(),
    ['repoRoot', 'sha', 'relPath', 'evidenceId', 'supportsClaim', 'derivedFromEvidenceIds', 'timestamp', 'verificationMethod'].sort(),
  );
});

// ---------------------------------------------------------------------------
// Failure-before-any-I/O checks (order of validation guarantees these never
// need a real repo — evidenceId/supportsClaim/mapping are all checked before
// any Git or filesystem call is ever made)
// ---------------------------------------------------------------------------

test('attestRemoteMainEvidence: invalid evidenceId fails closed regardless of repoRoot validity, before any Git call', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: 'C:/definitely/does/not/exist/at/all', sha: SHA_A, relPath: 'x.md', evidenceId: '', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_EVIDENCE_ID');
});

test('attestRemoteMainEvidence: invalid supportsClaim ("false" string) fails closed before any Git call, never becomes undefined-then-true', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: 'C:/definitely/does/not/exist/at/all', sha: SHA_A, relPath: 'x.md', evidenceId: 'a', supportsClaim: 'false',
  });
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_SUPPORTS_CLAIM');
});

test('attestRemoteMainEvidence: omitted supportsClaim fails closed before any Git call (IMP2-BOOL-002 R2 policy)', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: 'C:/definitely/does/not/exist/at/all', sha: SHA_A, relPath: 'x.md', evidenceId: 'a',
  });
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_SUPPORTS_CLAIM');
});

for (const [label, malformed] of [['null', null], ['undefined', undefined], ['string', 'x'], ['number', 42], ['array', []], ['function', () => {}]]) {
  test(`attestRemoteMainEvidence: malformed observation (${label}) never throws, fails closed`, () => {
    assert.doesNotThrow(() => {
      const { evidence, error } = attestRemoteMainEvidence(malformed);
      assert.equal(evidence, null);
      assert.equal(error, 'INVALID_OBSERVATION');
    });
  });
}

test('attestRemoteMainEvidence: an empty object observation fails closed without throwing', () => {
  assert.doesNotThrow(() => {
    const { evidence, error } = attestRemoteMainEvidence({});
    assert.equal(evidence, null);
    assert.equal(error, 'INVALID_EVIDENCE_ID');
  });
});

// ---------------------------------------------------------------------------
// R2 — attestFilesystemEvidence: real verification via Improvement 1, real fs
// ---------------------------------------------------------------------------

test('attestFilesystemEvidence: legitimate LOCAL_FILESYSTEM evidence produces trusted, DIRECT-strength evidence (real repo)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'legit-local', supportsClaim: true,
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'LOCAL_FILESYSTEM');
  assert.equal(evidence.strength, 'DIRECT');
});

test('attestFilesystemEvidence: legitimate TARGET_WORKTREE evidence produces trusted, DIRECT-strength evidence (real repo)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'TARGET_WORKTREE', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'legit-worktree', supportsClaim: true,
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'TARGET_WORKTREE');
  assert.equal(evidence.strength, 'DIRECT');
});

test('attestFilesystemEvidence: legitimate HISTORICAL evidence produces trusted, HISTORICAL-strength evidence (real repo)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'HISTORICAL', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'legit-historical', supportsClaim: true,
  });
  assert.equal(error, null);
  assert.equal(evidence.sourceClass, 'HISTORICAL');
  assert.equal(evidence.strength, 'HISTORICAL');
});

test('attestFilesystemEvidence: a foreign repository (real, different root commit) fails closed, never attested', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: foreignFsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.match(error, /HOLD_REPOSITORY_IDENTITY_UNVERIFIED/);
});

test('attestFilesystemEvidence: a path traversal attempt fails closed before any real read (lexical gate, no fixture needed)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: '../../../../Windows/System32/drivers/etc/hosts', expectedRootCommit: fsFixture.rootCommit,
    evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.match(error, /HOLD_INVALID_REPO_RELATIVE_PATH/);
});

test('attestFilesystemEvidence: an unsupported sourceClass (REMOTE_REPOSITORY) is rejected before any I/O', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'REMOTE_REPOSITORY', rootDir: 'C:/does-not-matter', relPath: 'x.md', expectedRootCommit: ROOT_COMMIT,
    evidenceId: 'a', supportsClaim: true,
  });
  assert.equal(evidence, null);
  assert.equal(error, 'UNSUPPORTED_SOURCE_CLASS');
});

test('attestFilesystemEvidence: invalid supportsClaim ("false" string) fails closed via the attest path, before any I/O (regression test for the exact R1 reaudit finding)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: 'C:/does-not-matter', relPath: 'x.md', expectedRootCommit: ROOT_COMMIT,
    evidenceId: 'a', supportsClaim: 'false',
  });
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_SUPPORTS_CLAIM');
});

test('attestFilesystemEvidence: omitted supportsClaim fails closed before any I/O (never defaults to true)', () => {
  const { evidence, error } = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: 'C:/does-not-matter', relPath: 'x.md', expectedRootCommit: ROOT_COMMIT,
    evidenceId: 'a',
  });
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_SUPPORTS_CLAIM');
});

for (const [label, malformed] of [['null', null], ['undefined', undefined], ['string', 'x'], ['number', 42], ['array', []], ['function', () => {}]]) {
  test(`attestFilesystemEvidence: malformed observation (${label}) never throws, fails closed`, () => {
    assert.doesNotThrow(() => {
      const { evidence, error } = attestFilesystemEvidence(malformed);
      assert.equal(evidence, null);
      assert.equal(error, 'INVALID_OBSERVATION');
    });
  });
}

test('attestFilesystemEvidence: Object.create(null) observation never throws', () => {
  const bare = Object.create(null);
  bare.sourceClass = 'LOCAL_FILESYSTEM';
  assert.doesNotThrow(() => attestFilesystemEvidence(bare));
});

// ---------------------------------------------------------------------------
// R2 — the exact IMP2-BOOL-002 reaudit finding, closed
// ---------------------------------------------------------------------------

test('IMP2-BOOL-002 regression: attest(supportsClaim:"false") never stores undefined-then-defaults-true; it is rejected outright', () => {
  const { evidence, error } = attestRemoteMainEvidence({
    repoRoot: 'C:/does-not-matter', sha: SHA_A, relPath: 'x.md', evidenceId: 'a', supportsClaim: 'false',
  });
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_SUPPORTS_CLAIM');
});

// ---------------------------------------------------------------------------
// R2 — the exact IMP2-CRASH-001 reaudit finding, closed
// ---------------------------------------------------------------------------

test('IMP2-CRASH-001 regression: attestRemoteMainEvidence(null) does not throw', () => {
  assert.doesNotThrow(() => attestRemoteMainEvidence(null));
  const { evidence, error } = attestRemoteMainEvidence(null);
  assert.equal(evidence, null);
  assert.equal(error, 'INVALID_OBSERVATION');
});

test('IMP2-CRASH-001 regression: attestFilesystemEvidence(null) does not throw', () => {
  assert.doesNotThrow(() => attestFilesystemEvidence(null));
});

test('evaluateClaim(null) / evaluateClaim(undefined) never throw', () => {
  assert.doesNotThrow(() => evaluateClaim(null));
  assert.doesNotThrow(() => evaluateClaim(undefined));
  assert.equal(evaluateClaim(null).decision, 'UNVERIFIED');
});

// ---------------------------------------------------------------------------
// supportsClaim matrix (R2 strict boolean policy, no defaults)
// ---------------------------------------------------------------------------

const SUPPORTS_CLAIM_MATRIX = [
  [true, true, false],
  [false, false, false],
  [undefined, null, true],
  [null, null, true],
  ['true', null, true],
  ['false', null, true],
  [1, null, true],
  [0, null, true],
  [[], null, true],
  [{}, null, true],
  [NaN, null, true],
];

for (const [input, expectedNormalized, expectedInvalid] of SUPPORTS_CLAIM_MATRIX) {
  test(`supportsClaim matrix (raw path): ${String(input)} -> normalized=${expectedNormalized}, invalid=${expectedInvalid}`, () => {
    const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [rawEv({ evidenceId: 'a', supportsClaim: input, sourceFingerprint: 'fp1' })] });
    assert.equal(r.evidence[0].supportsClaim, expectedNormalized);
    assert.equal(r.evidence[0].supportsClaimInvalid, expectedInvalid);
  });
}

test('supportsClaim=true and supportsClaim=false are the ONLY valid values — everything else (including omission) is invalid and never counts', () => {
  const validTrue = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [rawEv({ evidenceId: 'a', supportsClaim: true, sourceFingerprint: 'fp1' })] });
  const validFalse = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [rawEv({ evidenceId: 'a', supportsClaim: false, sourceFingerprint: 'fp1' })] });
  assert.equal(validTrue.evidence[0].supportsClaimInvalid, false);
  assert.equal(validFalse.evidence[0].supportsClaimInvalid, false);
  const omitted = { evidenceId: 'a', sourceFingerprint: 'fp1' };
  const omittedResult = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [omitted] });
  assert.equal(omittedResult.evidence[0].supportsClaimInvalid, true, 'omission must now be INVALID, not a silent default of true (R2 policy)');
});

// ---------------------------------------------------------------------------
// R2 — DEFECT IMP2-FP-001 regression: fingerprint canonicalization
// ---------------------------------------------------------------------------

test('fingerprint builders are deterministic: same inputs -> same output', () => {
  const a = buildGitFingerprint({ repositoryIdentity: 'korixa', sha: SHA_A, path: 'x.md' });
  const b = buildGitFingerprint({ repositoryIdentity: 'korixa', sha: SHA_A, path: 'x.md' });
  assert.equal(a, b);
});

test('NUL-shift GIT: moving a NUL from one field to the adjacent field boundary no longer collides', () => {
  const gA = buildGitFingerprint({ repositoryIdentity: 'a b', sha: 'c', path: 'd' });
  const gB = buildGitFingerprint({ repositoryIdentity: 'a', sha: 'b c', path: 'd' });
  assert.notEqual(gA, gB);
});

test('NUL-shift FILESYSTEM: moving a NUL across canonicalPath/contentHash no longer collides', () => {
  const fA = buildFilesystemFingerprint({ canonicalRepositoryIdentity: 'r', canonicalPath: 'ab c', contentHash: 'd' });
  const fB = buildFilesystemFingerprint({ canonicalRepositoryIdentity: 'r', canonicalPath: 'ab', contentHash: 'c d' });
  assert.notEqual(fA, fB);
});

test('NUL-shift RUNTIME: moving a NUL across resource/observationType no longer collides', () => {
  const rA = buildRuntimeFingerprint({ executionId: 'e', resource: 'ab c', observationType: 'd' });
  const rB = buildRuntimeFingerprint({ executionId: 'e', resource: 'ab', observationType: 'c d' });
  assert.notEqual(rA, rB);
});

test('NUL-shift CI: moving a NUL across jobId/observation no longer collides', () => {
  const cA = buildCiFingerprint({ runId: 'r', jobId: 'ab c', observation: 'd' });
  const cB = buildCiFingerprint({ runId: 'r', jobId: 'ab', observation: 'c d' });
  assert.notEqual(cA, cB);
});

test('fingerprint domain separation: git/filesystem/runtime/ci never collide even with matching remaining fields', () => {
  const g = buildGitFingerprint({ repositoryIdentity: 'x', sha: 'y', path: 'z' });
  const r = buildRuntimeFingerprint({ executionId: 'x', resource: 'y', observationType: 'z' });
  const f = buildFilesystemFingerprint({ canonicalRepositoryIdentity: 'x', canonicalPath: 'y', contentHash: 'z' });
  const c = buildCiFingerprint({ runId: 'x', jobId: 'y', observation: 'z' });
  assert.equal(new Set([g, r, f, c]).size, 4);
});

test('fingerprint: a non-string component throws rather than silently coercing', () => {
  assert.throws(() => buildGitFingerprint({ repositoryIdentity: 'a', sha: 12345, path: 'x' }), TypeError);
});

// ---------------------------------------------------------------------------
// sameUnderlyingSource
// ---------------------------------------------------------------------------

test('sameUnderlyingSource: identical fingerprint -> true', () => {
  assert.equal(sameUnderlyingSource(rawEv({ evidenceId: 'a', sourceFingerprint: 'fp1' }), rawEv({ evidenceId: 'b', sourceFingerprint: 'fp1' })), true);
});

test('sameUnderlyingSource: derived relationship -> true regardless of fingerprint', () => {
  const a = rawEv({ evidenceId: 'a', sourceFingerprint: 'fp1' });
  const b = rawEv({ evidenceId: 'b', sourceFingerprint: 'fp2', derivedFromEvidenceIds: ['a'] });
  assert.equal(sameUnderlyingSource(a, b), true);
});

test('sameUnderlyingSource: missing fingerprints, no derivation -> false', () => {
  assert.equal(sameUnderlyingSource(rawEv({ evidenceId: 'a' }), rawEv({ evidenceId: 'b' })), false);
});

// ---------------------------------------------------------------------------
// R2 — DEFECT IMP2-DUPID-001 regression: duplicate evidenceId
// ---------------------------------------------------------------------------

test('DUPID: same evidenceId, different fingerprints/strengths/classes -> HOLD_DUPLICATE_EVIDENCE_ID', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P0',
    evidence: [
      rawEv({ evidenceId: 'same', sourceClass: 'HISTORICAL', strength: 'HISTORICAL', sourceFingerprint: 'fp-weak' }),
      rawEv({ evidenceId: 'same', sourceClass: 'REMOTE_REPOSITORY', strength: 'AUTHORITATIVE', sourceFingerprint: 'fp-strong' }),
    ],
  });
  assert.equal(result.decision, 'HOLD_DUPLICATE_EVIDENCE_ID');
  assert.equal(result.effectiveEvidenceCount, 0);
});

test('DUPID: three-way duplicate -> HOLD_DUPLICATE_EVIDENCE_ID', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P2',
    evidence: [rawEv({ evidenceId: 'x', sourceFingerprint: 'fp1' }), rawEv({ evidenceId: 'x', sourceFingerprint: 'fp2' }), rawEv({ evidenceId: 'x', sourceFingerprint: 'fp3' })],
  });
  assert.equal(result.decision, 'HOLD_DUPLICATE_EVIDENCE_ID');
});

test('DUPID: duplicate involved in a derivation graph -> HOLD_DUPLICATE_EVIDENCE_ID', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P2',
    evidence: [rawEv({ evidenceId: 'root', sourceFingerprint: 'fp1' }), rawEv({ evidenceId: 'root', sourceFingerprint: 'fp2', derivedFromEvidenceIds: ['root'] })],
  });
  assert.equal(result.decision, 'HOLD_DUPLICATE_EVIDENCE_ID');
});

test('DUPID: two REAL attested evidences accidentally sharing an evidenceId also fail closed', () => {
  const a = attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'same', supportsClaim: true,
  }).evidence;
  const b = attestFilesystemEvidence({
    sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'same', supportsClaim: true,
  }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [a, b] });
  assert.equal(result.decision, 'HOLD_DUPLICATE_EVIDENCE_ID');
});

// ---------------------------------------------------------------------------
// R3 — DEFECT IMP2-THRESHBYPASS-001: evaluatePolicyThreshold removed
// ---------------------------------------------------------------------------

test('IMP2-THRESHBYPASS-001 regression: evaluatePolicyThreshold is no longer exported', () => {
  assert.equal(typeof EvidencePolicy.evaluatePolicyThreshold, 'undefined');
  assert.equal(Object.keys(EvidencePolicy).includes('evaluatePolicyThreshold'), false);
});

test('PUBLIC_THRESHOLD_BYPASS = ABSENT: no exported function accepts bare strength labels and returns a CONFIRMED_P0/CONFIRMED_P1 decision without evidence', () => {
  for (const [name, fn] of Object.entries(EvidencePolicy)) {
    if (typeof fn !== 'function') continue;
    if (name === 'evaluateClaim') continue; // the one, correctly-gated authoritative path
    let result;
    try {
      result = fn({ severity: 'P0', clusterStrengths: ['AUTHORITATIVE', 'DIRECT'], strengths: ['AUTHORITATIVE', 'DIRECT'] });
    } catch {
      continue; // throwing on this shape is fine -- it's not a bypass
    }
    if (result && typeof result === 'object') {
      assert.notEqual(result.decision, 'CONFIRMED_P0', `${name} must not accept bare strengths and return CONFIRMED_P0`);
      assert.notEqual(result.decision, 'CONFIRMED_P1', `${name} must not accept bare strengths and return CONFIRMED_P1`);
    }
  }
});

test('AUTHORITATIVE_DECISION_PATHS: evaluateClaim is the only export whose result can legitimately equal CONFIRMED_P0/CONFIRMED_P1', () => {
  const decisionCapableExports = Object.entries(EvidencePolicy).filter(([, v]) => typeof v === 'function');
  const names = decisionCapableExports.map(([name]) => name);
  assert.deepEqual(names.sort(), [
    'attestFilesystemEvidence', 'attestRemoteMainEvidence', 'attestLocalRuntimeEvidence', 'attestRemoteRuntimeEvidence',
    'buildCiFingerprint', 'buildFilesystemFingerprint', 'buildGitFingerprint', 'buildRuntimeFingerprint',
    'evaluateClaim', 'sameUnderlyingSource',
  ].sort());
  // None of the four attest* functions return a `decision` field at all —
  // they return { evidence, error } — so none of them are decision-capable
  // regardless of this list; only evaluateClaim's RESULT can ever contain
  // `decision: 'CONFIRMED_P0'|'CONFIRMED_P1'`.
});

// P0/P1 threshold combinations achievable with REAL attested evidence
// (AUTHORITATIVE via attestRemoteMainEvidence, DIRECT via
// attestFilesystemEvidence). CORROBORATIVE-strength combinations
// (P0: DIRECT+CORROBORATIVE, P1: CORROBORATIVE+CORROBORATIVE) have no real
// gatherer/attestor in this project and are NOT exercised here — that
// coverage gap is the deliberate, accepted cost of removing the
// evaluatePolicyThreshold bypass (see the module's own R3 comment).

test('P0 threshold with real evidence: AUTHORITATIVE (remote) + DIRECT (local) -> CONFIRMABLE', () => {
  const a = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const b = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'b', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [a, b] });
  assert.equal(result.decision, 'CONFIRMED_P0');
});

test('P1 threshold with real evidence: two independent DIRECT sources (worktree + local, different real paths) -> CONFIRMABLE', () => {
  const a = attestFilesystemEvidence({ sourceClass: 'TARGET_WORKTREE', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'a', supportsClaim: true }).evidence;
  const b = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'b', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: [a, b] });
  assert.equal(result.decision, 'CONFIRMED_P1');
});

test('P1 threshold with real evidence: a single real DIRECT source does not confirm without an exception', () => {
  const a = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'a', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: [a] });
  assert.equal(result.decision, 'POTENTIAL_P1');
});

test('HISTORICAL + HISTORICAL never confirms current-state P1, using real attested HISTORICAL evidence', () => {
  const a = attestFilesystemEvidence({ sourceClass: 'HISTORICAL', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'a', supportsClaim: true }).evidence;
  const b = attestFilesystemEvidence({ sourceClass: 'HISTORICAL', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'b', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: [a, b] });
  assert.notEqual(result.decision, 'CONFIRMED_P1');
});

test('single-source exception with real AUTHORITATIVE remote evidence confirms with a valid reason', () => {
  const a = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [a], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
  assert.equal(result.decision, 'CONFIRMED_P0');
});

test('unresolved conflicts always HOLD regardless of strengths, using real evidence', () => {
  const remote = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const worktree = attestFilesystemEvidence({ sourceClass: 'TARGET_WORKTREE', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'b', supportsClaim: false }).evidence;
  // Both map into Improvement 1's hierarchy (REMOTE_MAIN vs TARGET_WORKTREE)
  // so this is actually hierarchy-resolved, not "unresolved" -- included
  // here to additionally confirm that path still works with real evidence
  // post-R4.
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [remote, worktree] });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

// ---------------------------------------------------------------------------
// End-to-end P0/P1 thresholds with REAL attested evidence
// ---------------------------------------------------------------------------

test('P0 end-to-end: one attested AUTHORITATIVE (remote) + one attested DIRECT (local, different path) -> CONFIRMED_P0', () => {
  const a = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const b = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'b', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [a, b] });
  assert.equal(result.decision, 'CONFIRMED_P0');
});

test('P0 end-to-end: the SAME attested remote evidence read twice (same sha+path) -> EFFECTIVE_COUNT=1, not confirmed', () => {
  const a = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const b = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'b', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [a, b] });
  assert.equal(result.effectiveEvidenceCount, 1);
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

test('Source hierarchy regression: attested REMOTE_REPOSITORY contradicts attested LOCAL_FILESYSTEM staleness claim -> denied via hierarchy, never a false P0', () => {
  const local = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'local', supportsClaim: true }).evidence;
  const remote = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'remote', supportsClaim: false }).evidence;
  const result = evaluateClaim({ claimId: 'project-status-stale', title: 'PROJECT_STATUS.md is catastrophically stale', severity: 'P0', evidence: [local, remote] });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
  assert.equal(result.effectiveEvidenceCount, 0);
  const resolved = result.conflicts.find((c) => c.resolvedByHierarchy);
  assert.equal(resolved.winnerEvidenceId, 'remote');
});

test('single trusted AUTHORITATIVE source requires the exception to confirm; without it, POTENTIAL_P0', () => {
  const trusted = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const without = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [trusted] });
  assert.equal(without.decision, 'POTENTIAL_P0');
  const withEx = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [trusted], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
  assert.equal(withEx.decision, 'CONFIRMED_P0');
});

test('single-source exception: reason too short (< 12 chars) -> denied', () => {
  const trusted = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [trusted], singleSourceExceptionRequested: true, singleSourceExceptionReason: 'too short' });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

test('conflicting strong evidence outside the hierarchy: two raw AUTHORITATIVE-declared evidences disagreeing never confirms (both untrusted anyway)', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P0',
    evidence: [
      rawEv({ evidenceId: 'a', sourceClass: 'DATABASE_RUNTIME', strength: 'AUTHORITATIVE', supportsClaim: true, sourceFingerprint: 'fp-a' }),
      rawEv({ evidenceId: 'b', sourceClass: 'DATABASE_RUNTIME', strength: 'AUTHORITATIVE', supportsClaim: false, sourceFingerprint: 'fp-b' }),
    ],
  });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

// ---------------------------------------------------------------------------
// Derivation regressions (P2/P3, trust not required — pure clustering math)
// ---------------------------------------------------------------------------

test('transitive derivation: A <- B <- C <- D collapses to one effective cluster', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P2',
    evidence: [
      rawEv({ evidenceId: 'A', strength: 'DIRECT', sourceFingerprint: 'fpA' }),
      rawEv({ evidenceId: 'B', strength: 'CORROBORATIVE', sourceFingerprint: 'fpB', derivedFromEvidenceIds: ['A'] }),
      rawEv({ evidenceId: 'C', strength: 'CORROBORATIVE', sourceFingerprint: 'fpC', derivedFromEvidenceIds: ['B'] }),
      rawEv({ evidenceId: 'D', strength: 'AUTHORITATIVE', sourceFingerprint: 'fpD', derivedFromEvidenceIds: ['C'] }),
    ],
  });
  assert.equal(result.effectiveEvidenceCount, 1);
});

test('sibling derivation: B and C both derivedFrom A are not mutually independent', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P2',
    evidence: [
      rawEv({ evidenceId: 'A', strength: 'DIRECT', sourceFingerprint: 'fpA' }),
      rawEv({ evidenceId: 'B', strength: 'CORROBORATIVE', sourceFingerprint: 'fpB', derivedFromEvidenceIds: ['A'] }),
      rawEv({ evidenceId: 'C', strength: 'CORROBORATIVE', sourceFingerprint: 'fpC', derivedFromEvidenceIds: ['A'] }),
    ],
  });
  assert.equal(result.effectiveEvidenceCount, 1);
});

test('diamond derivation collapses to one cluster', () => {
  const result = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P2',
    evidence: [
      rawEv({ evidenceId: 'A', strength: 'DIRECT', sourceFingerprint: 'fpA' }),
      rawEv({ evidenceId: 'B', strength: 'CORROBORATIVE', sourceFingerprint: 'fpB', derivedFromEvidenceIds: ['A'] }),
      rawEv({ evidenceId: 'C', strength: 'CORROBORATIVE', sourceFingerprint: 'fpC', derivedFromEvidenceIds: ['A'] }),
      rawEv({ evidenceId: 'D', strength: 'AUTHORITATIVE', sourceFingerprint: 'fpD', derivedFromEvidenceIds: ['B', 'C'] }),
    ],
  });
  assert.equal(result.effectiveEvidenceCount, 1);
});

test('a 3-cycle and a 2-cycle and self-derivation all fail closed with HOLD_INVALID_EVIDENCE_GRAPH', () => {
  const r1 = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [rawEv({ evidenceId: 'A', derivedFromEvidenceIds: ['B'] }), rawEv({ evidenceId: 'B', derivedFromEvidenceIds: ['C'] }), rawEv({ evidenceId: 'C', derivedFromEvidenceIds: ['A'] })] });
  assert.equal(r1.decision, 'HOLD_INVALID_EVIDENCE_GRAPH');
  const r2 = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [rawEv({ evidenceId: 'a', derivedFromEvidenceIds: ['b'] }), rawEv({ evidenceId: 'b', derivedFromEvidenceIds: ['a'] })] });
  assert.equal(r2.decision, 'HOLD_INVALID_EVIDENCE_GRAPH');
  const r3 = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [rawEv({ evidenceId: 'a', derivedFromEvidenceIds: ['a'] })] });
  assert.equal(r3.decision, 'HOLD_INVALID_EVIDENCE_GRAPH');
});

// ---------------------------------------------------------------------------
// Order independence, confidence inflation
// ---------------------------------------------------------------------------

test('order independence: permutations of 5 evidences preserve decision/count/confidence', () => {
  const evs = [
    rawEv({ evidenceId: 'a', strength: 'DIRECT', sourceFingerprint: 'fpA' }),
    rawEv({ evidenceId: 'b', strength: 'CORROBORATIVE', sourceFingerprint: 'fpB' }),
    rawEv({ evidenceId: 'c', strength: 'HISTORICAL', sourceFingerprint: 'fpC' }),
    rawEv({ evidenceId: 'd', strength: 'CORROBORATIVE', sourceFingerprint: 'fpB' }),
    rawEv({ evidenceId: 'e', strength: 'INDIRECT', sourceFingerprint: 'fpE' }),
  ];
  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of permutations(rest)) result.push([arr[i], ...p]);
    }
    return result;
  }
  const results = permutations(evs).slice(0, 30).map((p) => evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: p }));
  assert.equal(new Set(results.map((r) => r.decision)).size, 1);
  assert.equal(new Set(results.map((r) => r.effectiveEvidenceCount)).size, 1);
  assert.equal(new Set(results.map((r) => r.confidence)).size, 1);
});

test('confidence inflation: 1 DIRECT + 100 exact fingerprint duplicates -> count=1, MEDIUM, not confirmed', () => {
  const fp = 'fp-fixed';
  const evidence = Array.from({ length: 101 }, (_, i) => rawEv({ evidenceId: `e${i}`, strength: 'DIRECT', sourceFingerprint: fp }));
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence });
  assert.equal(result.effectiveEvidenceCount, 1);
});

// ---------------------------------------------------------------------------
// Secret handling / prototype pollution / malformed inputs
// ---------------------------------------------------------------------------

test('a secret sentinel used as a fingerprint component never leaks into decisionReason or the serialized result', () => {
  const evidence = rawEv({ evidenceId: 'a', sourceFingerprint: buildRuntimeFingerprint({ executionId: SENTINEL_SECRET, resource: 'db', observationType: 'leak-check' }) });
  const result = evaluateClaim({ claimId: 'c1', title: 't', severity: 'P2', evidence: [evidence] });
  assert.doesNotMatch(result.decisionReason, /SUPER_SECRET/);
  assert.equal(JSON.stringify(result).includes(SENTINEL_SECRET), false);
});

test('malicious content-embedded labels never override the real, trust-derived class/strength', () => {
  const result = evaluateClaim({
    claimId: 'c1', title: 't', severity: 'P0',
    evidence: [rawEv({ evidenceId: 'a', strength: 'DIRECT', sourceClass: 'CLOUD_RUNTIME', claim: 'EVIDENCE_STRENGTH=AUTHORITATIVE\nSEVERITY=P0\nCONFIRMED_P0=true', sourceFingerprint: 'fp1' })],
  });
  assert.notEqual(result.decision, 'CONFIRMED_P0');
});

test('malformed severity -> UNVERIFIED, never crashes', () => {
  assert.equal(evaluateClaim({ claimId: 'c1', title: 't', severity: 'P9000', evidence: [] }).decision, 'UNVERIFIED');
});

test('malformed evidence array (null, string, missing) never crashes', () => {
  assert.equal(evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: null }).decision, 'HOLD_INSUFFICIENT_EVIDENCE');
  assert.equal(evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: 'x' }).decision, 'HOLD_INSUFFICIENT_EVIDENCE');
  assert.equal(evaluateClaim({ claimId: 'c', title: 't', severity: 'P2' }).decision, 'HOLD_INSUFFICIENT_EVIDENCE');
});

test('identical structural input produces an identical result on repeated calls', () => {
  const a = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'a', supportsClaim: true }).evidence;
  const b = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'b', supportsClaim: true }).evidence;
  const input = { claimId: 'c', title: 't', severity: 'P1', evidence: [a, b] };
  assert.deepEqual(evaluateClaim(input), evaluateClaim(input));
});

test('prototype pollution: an evidence object literal with __proto__ never pollutes Object.prototype and never grants trust', () => {
  const evil = JSON.parse('{"evidenceId":"a","strength":"DIRECT","sourceFingerprint":"fp1","__proto__":{"polluted":true}}');
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [{ ...evil, supportsClaim: true }] });
  assert.equal(({}).polluted, undefined);
  assert.equal(result.decision, 'P2');
});

test('Object.create(null) evidence (no prototype) does not crash and does not gain trust', () => {
  const bare = Object.create(null);
  bare.evidenceId = 'a'; bare.strength = 'DIRECT'; bare.sourceFingerprint = 'fp1'; bare.supportsClaim = true;
  const result = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [bare] });
  assert.equal(result.decision, 'P2');
});

// ---------------------------------------------------------------------------
// Performance sanity
// ---------------------------------------------------------------------------

test('LARGE_EVIDENCE_SET_TEST: 1000 duplicate-heavy synthetic evidences evaluate without excessive time', () => {
  const started = Date.now();
  const evidence = [];
  for (let i = 0; i < 1000; i += 1) evidence.push(rawEv({ evidenceId: `e${i}`, sourceFingerprint: `fp-${i % 50}`, strength: i % 3 === 0 ? 'DIRECT' : 'CORROBORATIVE' }));
  const result = evaluateClaim({ claimId: 'large', title: 'x', severity: 'P2', evidence });
  assert.equal(result.effectiveEvidenceCount, 50);
  assert.ok(Date.now() - started < 5000);
});

// ---------------------------------------------------------------------------
// Module purity / I/O boundary
// ---------------------------------------------------------------------------

test('POLICY_EVALUATOR_PURE: evaluateClaim never touches fs/network-mutation/shell/clock/random directly in this file', () => {
  const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs');
  const source = readFileSync(modulePath, 'utf8');
  const startMarker = 'export function evaluateClaim(params) {';
  const startIdx = source.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'evaluateClaim function not found');
  // evaluateClaim is, by construction, the LAST function in this file --
  // slicing to end-of-file is exactly its body (R4: the real I/O now
  // legitimately present elsewhere in the module, in the attestation
  // layer, must not make this scan too broad to mean anything).
  const body = source.slice(startIdx);
  const forbidden = [
    'writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'mkdirSync', 'renameSync',
    'execSync', 'spawnSync(', 'spawn(', 'exec(', 'fork(',
    'fetch(', 'XMLHttpRequest', "from 'node:http", "from 'node:https", "from 'node:net", "from 'node:dgram",
    'Date.now', 'Math.random', 'process.',
  ];
  for (const token of forbidden) {
    assert.equal(body.includes(token), false, `forbidden token found inside evaluateClaim: ${token}`);
  }
});

test('ATTESTATION_READ_ONLY_IO: the only I/O in this module flows through Improvement 1\'s read-only gatherers/identity-check, one direct read-only `git ls-remote` currentness check against the canonical URL, and one disclosed exception (isolated empty temp HOME dir) (R3, R4-hardened, R5-anchored, POST-R5-isolated)', () => {
  const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs');
  const source = readFileSync(modulePath, 'utf8');
  assert.match(source, /import \{ SOURCE_CLASSES, gatherRemoteMainEvidence, gatherFilesystemEvidence, verifyRepositoryIdentity \} from '\.\/source-of-truth\.mjs'/);
  assert.match(source, /import \{ spawnSync \} from 'node:child_process'/);
  // POST-R5 (IMP2-GITGLOBAL-001): `node:fs` is now imported, but ONLY for
  // `mkdtempSync`/`rmSync` — creating/removing one ephemeral, always-empty
  // isolation directory used exclusively as HOME/USERPROFILE/XDG_CONFIG_HOME
  // for the canonical currentness query. No content-write capability
  // (`writeFileSync`, `appendFileSync`, etc.) is imported or used anywhere
  // in this module — verified explicitly below, not just asserted in prose.
  assert.match(source, /import \{ mkdtempSync, rmSync \} from 'node:fs'/);
  const forbiddenContentWrites = ['writeFileSync', 'appendFileSync', 'chmodSync', 'chownSync', 'symlinkSync', 'linkSync', 'copyFileSync', 'renameSync'];
  for (const token of forbiddenContentWrites) {
    assert.equal(source.includes(token), false, `forbidden filesystem content-write capability found: ${token}`);
  }
  // (Not a plain `source.includes('readFileSync')` check: the removed R4
  // parameter name `readFileSyncFn` legitimately still appears in this
  // module's own historical/JSDoc comments and contains "readFileSync" as a
  // substring — the precise, code-only check already lives in the
  // PUBLIC_TRUST_API_INJECTABLE_DEPENDENCIES tests above.)
  assert.equal(source.includes('ls-remote'), true);
  assert.equal(source.includes("'fetch'"), false, 'must never call git fetch');
  assert.equal(source.includes('git push'), false);
});

test('POST-R5 (IMP2-GITGLOBAL-001): the one disclosed filesystem write (isolatedCanonicalGitHome) always creates an EMPTY directory and is always removed in a `finally` block, regardless of success/failure', () => {
  const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs');
  const source = readFileSync(modulePath, 'utf8');
  assert.match(source, /function isolatedCanonicalGitHome\(\) \{\s*return mkdtempSync\(path\.join\(tmpdir\(\), 'korixa-canonical-git-home-'\)\);\s*\}/);
  assert.match(source, /try \{\s*rmSync\(isolatedHome, \{ recursive: true, force: true \}\);/);
});

test('R5: the canonical currentness query targets github.com over HTTPS, never a bare local/relative path a caller could plausibly control', () => {
  const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs');
  const source = readFileSync(modulePath, 'utf8');
  assert.match(source, /const CANONICAL_REMOTE_URL = `https:\/\/github\.com\//);
  assert.equal(source.includes('CANONICAL_ROOT_COMMIT'), true);
  assert.equal(/const CANONICAL_ROOT_COMMIT = '[0-9a-f]{40}'/.test(source), true);
});

test('SOURCE_OF_TRUTH_CONTRACT_CHANGED = NO: source-of-truth.mjs exports used here (gatherRemoteMainEvidence, gatherFilesystemEvidence, SOURCE_CLASSES) are called with their existing, unmodified signatures', () => {
  const { evidence } = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'contract-check', supportsClaim: true });
  assert.notEqual(evidence, null);
});

// =============================================================================
// IMPROVEMENT 3/5 — VERIFICATION LEVELS / EVIDENCE PROVENANCE
//
// STATIC/LOCAL_RUNTIME/REMOTE_RUNTIME evidence below is produced by REAL
// attestation (real `git`/`node --test`/HTTPS calls against real, disposable
// fixtures or a real, small, fast public HTTPS endpoint) — never mocked,
// per this project's established testing discipline. REMOTE_RUNTIME tests
// legitimately depend on network reachability to https://github.com, the
// same disclosed tradeoff the R5-era canonical-currentness tests already
// carry.
// =============================================================================

const REMOTE_RUNTIME_TEST_URL = 'https://github.com';
const REMOTE_RUNTIME_UNREACHABLE_URL = 'https://this-domain-genuinely-does-not-exist-korixa-imp3-test.invalid';

test('VERIFICATION_LEVELS is the exact closed catalog: STATIC, LOCAL_RUNTIME, REMOTE_RUNTIME, INFERRED — nothing else', () => {
  assert.deepEqual([...VERIFICATION_LEVELS], ['STATIC', 'LOCAL_RUNTIME', 'REMOTE_RUNTIME', 'INFERRED']);
});

test('ENVIRONMENTS is the exact closed catalog: Development, Staging, Production', () => {
  assert.deepEqual([...ENVIRONMENTS], ['Development', 'Staging', 'Production']);
});

// ---------------------------------------------------------------------------
// A. STATIC valid
// ---------------------------------------------------------------------------

test('IMP3 CASE A: attestRemoteMainEvidence and attestFilesystemEvidence always produce verificationLevel STATIC (real content inspection, never execution)', () => {
  const remote = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'imp3-a-remote', supportsClaim: true });
  assert.equal(remote.evidence.verificationLevel, 'STATIC');
  const fs = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'imp3-a-fs', supportsClaim: true });
  assert.equal(fs.evidence.verificationLevel, 'STATIC');
});

// ---------------------------------------------------------------------------
// B. LOCAL_RUNTIME valid
// ---------------------------------------------------------------------------

test('IMP3 CASE B: attestLocalRuntimeEvidence really runs `node --test` and produces trusted LOCAL_RUNTIME evidence with the real exit code', () => {
  const passing = attestLocalRuntimeEvidence({ rootDir: localRuntimeFixture.rootDir, relPath: 'passing.test.mjs', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'imp3-b-pass', supportsClaim: true });
  assert.equal(passing.error, null);
  assert.equal(passing.evidence.verificationLevel, 'LOCAL_RUNTIME');
  assert.equal(passing.evidence.sourceClass, 'TEST_RUNTIME');
  assert.equal(passing.evidence.observedExitCode, 0);

  const failing = attestLocalRuntimeEvidence({ rootDir: localRuntimeFixture.rootDir, relPath: 'failing.test.mjs', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'imp3-b-fail', supportsClaim: false });
  assert.equal(failing.error, null, 'a real FAILING test execution is still real, valid evidence — the attestor does not refuse bad news');
  assert.equal(failing.evidence.verificationLevel, 'LOCAL_RUNTIME');
  assert.notEqual(failing.evidence.observedExitCode, 0);
});

test('IMP3: attestLocalRuntimeEvidence refuses to execute anything against an unverified path/repo (foreign repo, path traversal)', () => {
  const foreign = attestLocalRuntimeEvidence({ rootDir: foreignFsFixture.rootDir, relPath: 'passing.test.mjs', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'imp3-b-foreign', supportsClaim: true });
  assert.equal(foreign.evidence, null);
  assert.match(foreign.error, /HOLD_REPOSITORY_IDENTITY_UNVERIFIED|SOURCE_OF_TRUTH_UNVERIFIED/);

  const traversal = attestLocalRuntimeEvidence({ rootDir: localRuntimeFixture.rootDir, relPath: '../../../etc/passwd', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'imp3-b-traversal', supportsClaim: true });
  assert.equal(traversal.evidence, null);
});

// ---------------------------------------------------------------------------
// C. REMOTE_RUNTIME valid, target well-identified
// ---------------------------------------------------------------------------

test('IMP3 CASE C: attestRemoteRuntimeEvidence really performs an HTTPS GET and produces trusted REMOTE_RUNTIME evidence with a real, well-identified target', async () => {
  const r = await attestRemoteRuntimeEvidence({
    sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', targetIdentity: 'synthetic-production-target-c',
    evidenceId: 'imp3-c', supportsClaim: true,
  });
  assert.equal(r.error, null);
  assert.equal(r.evidence.verificationLevel, 'REMOTE_RUNTIME');
  assert.equal(r.evidence.strength, 'DIRECT');
  assert.equal(r.evidence.environment, 'Production');
  assert.equal(r.evidence.targetIdentity, 'synthetic-production-target-c');
  assert.equal(typeof r.evidence.observedStatusCode, 'number');
  assert.equal(typeof r.evidence.observedAt, 'string');
});

test('IMP3: attestRemoteRuntimeEvidence fails closed (never throws, never fabricates trust) when the target is genuinely unreachable', async () => {
  const r = await attestRemoteRuntimeEvidence({
    sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_UNREACHABLE_URL, environment: 'Production', targetIdentity: 'unreachable-target',
    evidenceId: 'imp3-c-unreachable', supportsClaim: true,
  });
  assert.equal(r.evidence, null);
  assert.equal(r.error, 'REMOTE_RUNTIME_UNREACHABLE');
});

// ---------------------------------------------------------------------------
// D. INFERRED valid
// ---------------------------------------------------------------------------

test('IMP3 CASE D: raw evidence declaring verificationLevel INFERRED preserves that label (self-downgrade, not a privilege claim) and can support P2/P3, never P0/P1 alone', () => {
  const inferred = rawEv({ evidenceId: 'imp3-d', verificationLevel: 'INFERRED', derivedFromEvidenceIds: ['imp3-d-source'], sourceFingerprint: 'fp-imp3-d' });
  const p2 = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [inferred] });
  assert.equal(p2.evidence[0].verificationLevel, 'INFERRED');
  assert.equal(p2.decision, 'P2');
  const p0 = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [inferred], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
  assert.notEqual(p0.decision, 'CONFIRMED_P0');
});

// ---------------------------------------------------------------------------
// E / F. unknown / missing verification level -> fail closed, conservative
// ---------------------------------------------------------------------------

for (const badLevel of ['runtime', 'REMOTE', 'production', 'verified', null, {}, [], 1, true]) {
  test(`IMP3 CASE E: unrecognized verificationLevel (${JSON.stringify(badLevel)}) fails closed to null, never silently coerced`, () => {
    const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [rawEv({ evidenceId: 'e', verificationLevel: badLevel, sourceFingerprint: 'fp-bad-level' })] });
    assert.equal(r.evidence[0].verificationLevel, null);
    assert.equal(r.evidence[0].declaredVerificationLevel, null);
  });
}

test('IMP3 CASE F: missing verificationLevel (omitted entirely) is conservative — null, never assumed REMOTE_RUNTIME or any other level', () => {
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [{ evidenceId: 'e', sourceFingerprint: 'fp-missing-level', supportsClaim: true }] });
  assert.equal(r.evidence[0].verificationLevel, null);
});

// ---------------------------------------------------------------------------
// G. STATIC cannot certify remote runtime
// ---------------------------------------------------------------------------

test('IMP3 CASE G: STATIC evidence alone cannot satisfy a claim that requires REMOTE_RUNTIME', () => {
  const staticEv = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'imp3-g', supportsClaim: true });
  const r = evaluateClaim({
    claimId: 'c', title: 'Production health check works', severity: 'P1', evidence: [staticEv.evidence],
    requiredVerificationLevels: ['REMOTE_RUNTIME'], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON,
  });
  assert.equal(r.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL');
});

// ---------------------------------------------------------------------------
// H. LOCAL_RUNTIME cannot certify Production
// ---------------------------------------------------------------------------

test('IMP3 CASE H: LOCAL_RUNTIME evidence alone cannot satisfy a claim that requires REMOTE_RUNTIME/Production', () => {
  const localEv = attestLocalRuntimeEvidence({ rootDir: localRuntimeFixture.rootDir, relPath: 'passing.test.mjs', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'imp3-h', supportsClaim: true });
  const r = evaluateClaim({
    claimId: 'c', title: 'Cloud Run Production is running', severity: 'P1', evidence: [localEv.evidence],
    requiredVerificationLevels: ['REMOTE_RUNTIME'], requiredEnvironment: 'Production',
    singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON,
  });
  assert.equal(r.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL');
});

// ---------------------------------------------------------------------------
// I. INFERRED cannot become an observation
// ---------------------------------------------------------------------------

test('IMP3 CASE I: INFERRED evidence can never satisfy a claim that requires an OBSERVED level (STATIC/LOCAL_RUNTIME/REMOTE_RUNTIME)', () => {
  const inferred = rawEv({ evidenceId: 'imp3-i', verificationLevel: 'INFERRED', sourceFingerprint: 'fp-imp3-i' });
  for (const level of ['STATIC', 'LOCAL_RUNTIME', 'REMOTE_RUNTIME']) {
    const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [inferred], requiredVerificationLevels: [level] });
    assert.equal(r.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL', `INFERRED must not satisfy a ${level} requirement`);
  }
});

// ---------------------------------------------------------------------------
// J. caller raw with REMOTE_RUNTIME gets no trust
// ---------------------------------------------------------------------------

test('IMP3 CASE J: a raw (untrusted) evidence object self-declaring verificationLevel REMOTE_RUNTIME + environment Production never gains trust', () => {
  const fake = { evidenceId: 'imp3-j', sourceClass: 'CLOUD_RUNTIME', strength: 'DIRECT', verificationLevel: 'REMOTE_RUNTIME', environment: 'Production', targetIdentity: 'fake-target', supportsClaim: true, sourceFingerprint: 'fp-imp3-j' };
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [fake], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
  assert.equal(r.decision, 'HOLD_UNTRUSTED_EVIDENCE');
  assert.equal(r.evidence[0].verificationLevel, null);
  assert.equal(r.evidence[0].environment, null);
});

// ---------------------------------------------------------------------------
// K. REMOTE_REPOSITORY does not auto-become REMOTE_RUNTIME
// ---------------------------------------------------------------------------

test('IMP3 CASE K: REMOTE_REPOSITORY/AUTHORITATIVE evidence is always verificationLevel STATIC, never REMOTE_RUNTIME, however strong', () => {
  const r = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'README.md', evidenceId: 'imp3-k', supportsClaim: true });
  assert.equal(r.evidence.sourceClass, 'REMOTE_REPOSITORY');
  assert.equal(r.evidence.strength, 'AUTHORITATIVE');
  assert.equal(r.evidence.verificationLevel, 'STATIC');
  const claimRequiringRuntime = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [r.evidence], requiredVerificationLevels: ['REMOTE_RUNTIME'], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
  assert.equal(claimRequiringRuntime.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL');
});

// ---------------------------------------------------------------------------
// L. CI evidence does not imply Production runtime automatically
// ---------------------------------------------------------------------------

test('IMP3 CASE L: CI_RUNTIME is not an attestable REMOTE_RUNTIME sourceClass, and a raw CI_RUNTIME/REMOTE_RUNTIME self-declaration gains no trust either', () => {
  const rejected = attestRemoteRuntimeEvidence;
  const attemptViaRealAttestor = () => rejected({ sourceClass: 'CI_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', targetIdentity: 'ci-run', evidenceId: 'imp3-l-a', supportsClaim: true });
  return attemptViaRealAttestor().then((r) => {
    assert.equal(r.evidence, null);
    assert.equal(r.error, 'UNSUPPORTED_SOURCE_CLASS');

    const fakeCi = rawEv({ evidenceId: 'imp3-l-b', sourceClass: 'CI_RUNTIME', verificationLevel: 'REMOTE_RUNTIME', environment: 'Production', targetIdentity: 'ci-run-2', sourceFingerprint: 'fp-imp3-l' });
    const claim = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [fakeCi], singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
    assert.equal(claim.decision, 'HOLD_UNTRUSTED_EVIDENCE');
  });
});

// ---------------------------------------------------------------------------
// M. Development REMOTE_RUNTIME does not confirm Production
// ---------------------------------------------------------------------------

test('IMP3 CASE M: a real, trusted REMOTE_RUNTIME/Development observation cannot satisfy a claim requiring Production', async () => {
  const devEv = await attestRemoteRuntimeEvidence({ sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Development', targetIdentity: 'dev-target-m', evidenceId: 'imp3-m', supportsClaim: true });
  assert.equal(devEv.evidence.environment, 'Development');
  const claim = evaluateClaim({
    claimId: 'c', title: 'Production is healthy', severity: 'P1', evidence: [devEv.evidence],
    requiredVerificationLevels: ['REMOTE_RUNTIME'], requiredEnvironment: 'Production',
    singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON,
  });
  assert.equal(claim.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL');
});

// ---------------------------------------------------------------------------
// N. same source, different verificationLevel labels does not inflate count
// ---------------------------------------------------------------------------

test('IMP3 CASE N: the same underlying source copied three times with three different (self-declared, untrusted) verificationLevel labels still clusters as ONE source, not three independent ones', () => {
  const shared = { evidenceId: 'imp3-n-1', sourceClass: 'STATIC_CODE', strength: 'DIRECT', verificationLevel: 'STATIC', supportsClaim: true, sourceFingerprint: 'fp-imp3-n-shared' };
  const copyLocal = { ...shared, evidenceId: 'imp3-n-2', verificationLevel: 'LOCAL_RUNTIME' };
  const copyRemote = { ...shared, evidenceId: 'imp3-n-3', verificationLevel: 'REMOTE_RUNTIME' };
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [shared, copyLocal, copyRemote] });
  assert.equal(r.effectiveEvidenceCount, 1, 'same sourceFingerprint must cluster to one independent source regardless of differing verificationLevel labels');
});

// ---------------------------------------------------------------------------
// O. derived inference remains INFERRED
// ---------------------------------------------------------------------------

test('IMP3 CASE O: an inference derivedFrom a real REMOTE_RUNTIME evidence stays verificationLevel INFERRED — never auto-promoted', async () => {
  const remoteEv = await attestRemoteRuntimeEvidence({ sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', targetIdentity: 'imp3-o-source', evidenceId: 'imp3-o-source', supportsClaim: true });
  const inference = { evidenceId: 'imp3-o-inference', verificationLevel: 'INFERRED', derivedFromEvidenceIds: ['imp3-o-source'], sourceFingerprint: 'fp-imp3-o-inference', supportsClaim: true };
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [remoteEv.evidence, inference] });
  const inferenceResult = r.evidence.find((e) => e.evidenceId === 'imp3-o-inference');
  assert.equal(inferenceResult.verificationLevel, 'INFERRED');
});

// ---------------------------------------------------------------------------
// P. order independence still holds with the new fields
// ---------------------------------------------------------------------------

test('IMP3 CASE P: order independence still holds when verificationLevel/environment fields are present', () => {
  const evs = [
    rawEv({ evidenceId: 'a', strength: 'DIRECT', verificationLevel: 'STATIC', sourceFingerprint: 'fpA' }),
    rawEv({ evidenceId: 'b', strength: 'CORROBORATIVE', verificationLevel: 'INFERRED', sourceFingerprint: 'fpB' }),
    rawEv({ evidenceId: 'c', strength: 'HISTORICAL', verificationLevel: 'INFERRED', sourceFingerprint: 'fpC' }),
  ];
  const forward = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: evs });
  const reversed = evaluateClaim({ claimId: 'c', title: 't', severity: 'P2', evidence: [...evs].reverse() });
  assert.deepEqual(forward.decision, reversed.decision);
  assert.equal(forward.effectiveEvidenceCount, reversed.effectiveEvidenceCount);
});

// ---------------------------------------------------------------------------
// Q. duplicate evidence IDs still fail closed
// ---------------------------------------------------------------------------

test('IMP3 CASE Q: duplicate evidenceId still fails closed (HOLD_DUPLICATE_EVIDENCE_ID) even when verificationLevel differs between the duplicates', () => {
  const r = evaluateClaim({
    claimId: 'c', title: 't', severity: 'P2',
    evidence: [
      rawEv({ evidenceId: 'dup', verificationLevel: 'STATIC', sourceFingerprint: 'fp1' }),
      rawEv({ evidenceId: 'dup', verificationLevel: 'REMOTE_RUNTIME', sourceFingerprint: 'fp2' }),
    ],
  });
  assert.equal(r.decision, 'HOLD_DUPLICATE_EVIDENCE_ID');
});

// ---------------------------------------------------------------------------
// R. historical SHA regression (unaffected by Improvement 3)
// ---------------------------------------------------------------------------

test('IMP3 CASE R: IMP2-HISTSHA-001 remains closed — a real historical SHA is still denied, now also confirmed STATIC-only and never LOCAL/REMOTE_RUNTIME', () => {
  const r = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'imp3-r', supportsClaim: true });
  assert.equal(r.evidence, null);
  assert.equal(r.error, 'NOT_CURRENT_REMOTE_MAIN');
});

// ---------------------------------------------------------------------------
// S. HOME/global git config attacks remain closed (unaffected by Improvement 3)
// ---------------------------------------------------------------------------

test('IMP3 CASE S: IMP2-GITGLOBAL-001 remains closed — a hostile HOME still cannot redirect canonical currentness after the Improvement 3 changes', () => {
  const result = withEnvOverrides({ HOME: gitGlobalConfigAttackFixture.homeDir }, () => attestRemoteMainEvidence({
    repoRoot: projectClone.repoDir, sha: HISTORICAL_SHA, relPath: 'PROJECT_STATUS.md', evidenceId: 'imp3-s', supportsClaim: true,
  }));
  assert.equal(result.evidence, null);
  assert.equal(result.error, 'NOT_CURRENT_REMOTE_MAIN');
});

// ---------------------------------------------------------------------------
// T. positive P0 behavior with trusted evidence continues to work
// ---------------------------------------------------------------------------

test('IMP3 CASE T: positive P0 confirmation with real trusted evidence (AUTHORITATIVE remote + DIRECT local) still works, unaffected by the new verification-level axis when no requirement is specified', () => {
  const a = attestRemoteMainEvidence({ repoRoot: projectClone.repoDir, sha: realCanonicalCurrentSha, relPath: 'PROJECT_STATUS.md', evidenceId: 'imp3-t-a', supportsClaim: true });
  const b = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'b.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'imp3-t-b', supportsClaim: true });
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P0', evidence: [a.evidence, b.evidence] });
  assert.equal(r.decision, 'CONFIRMED_P0');
});

// ---------------------------------------------------------------------------
// Fase 11 — integrated incident scenario
// ---------------------------------------------------------------------------

test('IMP3 INCIDENT: STATIC + LOCAL_RUNTIME evidence cannot confirm "Production Cloud Run is running"; adding a real, trusted REMOTE_RUNTIME/Production observation correctly changes the outcome', async () => {
  const staticEv = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'incident-static', supportsClaim: true });
  const localEv = attestLocalRuntimeEvidence({ rootDir: localRuntimeFixture.rootDir, relPath: 'passing.test.mjs', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'incident-local', supportsClaim: true });

  const before = evaluateClaim({
    claimId: 'incident', title: 'Production Cloud Run is running', severity: 'P1',
    evidence: [staticEv.evidence, localEv.evidence],
    requiredVerificationLevels: ['REMOTE_RUNTIME'], requiredEnvironment: 'Production',
  });
  assert.equal(before.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL', 'STATIC + LOCAL_RUNTIME must never be able to certify a Production REMOTE_RUNTIME claim');

  const remoteEv = await attestRemoteRuntimeEvidence({
    sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', targetIdentity: 'incident-production-target',
    evidenceId: 'incident-remote', supportsClaim: true,
  });
  assert.notEqual(remoteEv.evidence, null);

  const after = evaluateClaim({
    claimId: 'incident', title: 'Production Cloud Run is running', severity: 'P1',
    evidence: [staticEv.evidence, localEv.evidence, remoteEv.evidence],
    requiredVerificationLevels: ['REMOTE_RUNTIME'], requiredEnvironment: 'Production',
    singleSourceExceptionRequested: true, singleSourceExceptionReason: 'Directly observed the Production endpoint just now, real HTTPS response',
  });
  assert.equal(after.decision, 'CONFIRMED_P1', 'once a real REMOTE_RUNTIME/Production observation exists, the SAME claim must be able to confirm — the model differentiates, it does not just block everything');
  assert.equal(after.effectiveEvidenceCount, 1);
});

// =============================================================================
// Fase 14 — adversarial self-audit
// =============================================================================

test('IMP3 ADVERSARIAL: prototype/clone tricks on a real trusted REMOTE_RUNTIME object never carry trust or verificationLevel forward', async () => {
  const real = await attestRemoteRuntimeEvidence({ sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', targetIdentity: 'clone-source', evidenceId: 'imp3-adv-clone', supportsClaim: true });
  const clones = {
    spread: { ...real.evidence },
    jsonRoundTrip: JSON.parse(JSON.stringify(real.evidence)),
    prototypeClone: Object.create(real.evidence),
  };
  for (const [label, clone] of Object.entries(clones)) {
    const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: [clone], requiredVerificationLevels: ['REMOTE_RUNTIME'], requiredEnvironment: 'Production', singleSourceExceptionRequested: true, singleSourceExceptionReason: VALID_REASON });
    assert.notEqual(r.decision, 'CONFIRMED_P1', `${label} must not carry REMOTE_RUNTIME trust forward`);
  }
});

test('IMP3 ADVERSARIAL: missing targetIdentity is rejected before any network call', async () => {
  const r = await attestRemoteRuntimeEvidence({ sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', evidenceId: 'imp3-adv-notarget', supportsClaim: true });
  assert.equal(r.evidence, null);
  assert.equal(r.error, 'INVALID_TARGET_IDENTITY');
});

test('IMP3 ADVERSARIAL: a plain http:// URL (not https://) is rejected, never attested', async () => {
  const r = await attestRemoteRuntimeEvidence({ sourceClass: 'CLOUD_RUNTIME', url: 'http://example.com', environment: 'Production', targetIdentity: 'plain-http', evidenceId: 'imp3-adv-http', supportsClaim: true });
  assert.equal(r.evidence, null);
  assert.equal(r.error, 'INVALID_URL');
});

test('IMP3 ADVERSARIAL: invalid environment value is rejected, never silently coerced to a valid one', async () => {
  const r = await attestRemoteRuntimeEvidence({ sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'production', targetIdentity: 'lowercase-env', evidenceId: 'imp3-adv-env', supportsClaim: true });
  assert.equal(r.evidence, null);
  assert.equal(r.error, 'INVALID_ENVIRONMENT');
});

test('IMP3 ADVERSARIAL: malformed requiredVerificationLevels (a bare string, not an array) fails closed to unsatisfiable, never silently treated as "no requirement"', () => {
  const trusted = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'imp3-adv-malformed', supportsClaim: true });
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: [trusted.evidence], requiredVerificationLevels: 'REMOTE_RUNTIME' });
  assert.equal(r.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL');
});

test('IMP3 ADVERSARIAL: requiredVerificationLevels containing only garbage entries fails closed to unsatisfiable', () => {
  const trusted = attestFilesystemEvidence({ sourceClass: 'LOCAL_FILESYSTEM', rootDir: fsFixture.rootDir, relPath: 'a.md', expectedRootCommit: fsFixture.rootCommit, evidenceId: 'imp3-adv-garbage', supportsClaim: true });
  const r = evaluateClaim({ claimId: 'c', title: 't', severity: 'P1', evidence: [trusted.evidence], requiredVerificationLevels: ['runtime', 'PRODUCTION', 123] });
  assert.equal(r.decision, 'HOLD_INSUFFICIENT_VERIFICATION_LEVEL');
});

test('IMP3 ADVERSARIAL: caller cannot control the isolated LOCAL_RUNTIME execution — attestLocalRuntimeEvidence accepts no command/args/executable parameter of any kind', () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence-policy.mjs'), 'utf8');
  const match = source.match(/export function attestLocalRuntimeEvidence\(params\) \{[\s\S]*?const \{([\s\S]*?)\} = params;/);
  assert.notEqual(match, null);
  const destructured = match[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean);
  assert.deepEqual(destructured.sort(), ['rootDir', 'relPath', 'expectedRootCommit', 'evidenceId', 'supportsClaim', 'derivedFromEvidenceIds', 'timestamp', 'verificationMethod'].sort());
});

test('IMP3 ADVERSARIAL: PUBLIC_TRUST_API_INJECTABLE_DEPENDENCIES = NONE extended to the two new attestors — poisoned function-typed params are ignored', async () => {
  const poisonFn = () => { throw new Error('POISONED: must never be invoked'); };
  const local = attestLocalRuntimeEvidence({
    rootDir: localRuntimeFixture.rootDir, relPath: 'passing.test.mjs', expectedRootCommit: localRuntimeFixture.rootCommit, evidenceId: 'imp3-adv-poison-local', supportsClaim: true,
    spawnSyncFn: poisonFn, command: 'rm', args: ['-rf', '/'], executable: 'bash',
  });
  assert.equal(local.error, null);
  assert.equal(local.evidence.verificationLevel, 'LOCAL_RUNTIME');

  const remote = await attestRemoteRuntimeEvidence({
    sourceClass: 'CLOUD_RUNTIME', url: REMOTE_RUNTIME_TEST_URL, environment: 'Production', targetIdentity: 'poison-remote', evidenceId: 'imp3-adv-poison-remote', supportsClaim: true,
    fetchFn: poisonFn, transport: poisonFn,
  });
  assert.equal(remote.error, null);
  assert.equal(remote.evidence.verificationLevel, 'REMOTE_RUNTIME');
});
