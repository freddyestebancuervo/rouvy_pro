// Korixa Night Agent — Source of Truth Hierarchy (Improvement 1/5).
//
// Structurally prevents a class of audit error: confusing a local, dirty,
// untracked, or historical copy of a file with the OFFICIAL, versioned
// state of the project. This module implements and enforces the frozen
// priority order:
//
//   REMOTE_MAIN > TARGET_WORKTREE > LOCAL_ROOT > HISTORICAL_DOCUMENTATION
//
// The incident this module exists to prevent: a night audit read a local,
// untracked PROJECT_STATUS.md and treated it as authoritative, even though
// a newer, tracked version existed on `main`. `resolveOfficialSource`
// below makes that outcome structurally impossible — it never inspects
// file CONTENT (a date string inside a file has zero authority), only
// `sourceClass`, and REMOTE_MAIN always wins whenever it is present.
//
// Git reads use PURE PLUMBING only (`git cat-file`) — never `git show` or
// `git log`, which R3's delegated-execution audit confirmed can invoke
// `core.pager`/`textconv`. `git cat-file -e <sha>^{commit}` and
// `git cat-file -e/-p <sha>:<path>` are the same commands already
// established elsewhere in this project (audit-patch export blocks,
// checkTargetHead) as safe, hook/filter/pager-free plumbing.
//
// R1 SECURITY CORRECTION (this revision): an independent audit found three
// real, reproduced defects in the original version of this module — path
// traversal in the filesystem gatherer, acceptance of symbolic/moving refs
// where a frozen SHA was required, and no defense against a caller
// presenting an unrelated Git repository as evidence. All three are fixed
// below via explicit, fail-closed gates (see each gate's comment for the
// exact defect it closes). Nothing here is generic hardening for its own
// sake — every gate maps to one reproduced finding.
//
// Node built-ins only. `shell: false` everywhere; no fetch/checkout/reset/
// clean/commit/branch/worktree call is ever made by this module — it is
// read-only, end to end.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isRepoRelativePath } from './path-safety.mjs';

export const SOURCE_CLASSES = Object.freeze(['REMOTE_MAIN', 'TARGET_WORKTREE', 'LOCAL_ROOT', 'HISTORICAL', 'RUNTIME', 'UNKNOWN']);

// The frozen priority order. REMOTE_MAIN always wins when present — this
// array's order IS the security-relevant invariant of this entire module.
const PRIORITY_ORDER = Object.freeze(['REMOTE_MAIN', 'TARGET_WORKTREE', 'LOCAL_ROOT', 'HISTORICAL']);

// A "frozen" identifier (a REMOTE_MAIN sha, or an expected root-commit
// identity) must be exactly 40 lowercase hex characters — canonical form
// only, no shorthand, no case-folding performed on the caller's behalf.
// Deliberately a LOCAL, stricter policy than runner.mjs's
// FULL_GIT_SHA_PATTERN (which is case-insensitive, for a different
// purpose — comparing an operator-supplied --target-head against a
// resolved `git rev-parse HEAD`): this module's contract is narrower by
// design, so it is not reused from there.
const FROZEN_SHA_PATTERN = /^[0-9a-f]{40}$/;

function isValidFrozenSha(value) {
  return typeof value === 'string' && FROZEN_SHA_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// DEFECT 1 fix — path traversal containment. Neither gatherer below may
// touch the filesystem or run a path-dependent Git command until BOTH
// gates pass. Gate A rejects anything lexically unsafe (`..`, backslashes,
// colons, absolute paths, control chars, Windows-reserved names — the full
// policy already centralized in path-safety.mjs). Gate B then resolves the
// path for real and proves strict containment — never a naive
// `startsWith(root)` string check, which "C:\repo-evil".startsWith("C:\repo")
// would defeat; and `candidate === root` is deliberately rejected too, since
// the root directory itself is never a valid FILE target.
// ---------------------------------------------------------------------------

export function isPathContainedInRoot(root, candidate) {
  if (candidate === root) return false;
  return candidate.startsWith(root + path.sep);
}

// ---------------------------------------------------------------------------
// DEFECT 1 fix, continued — symlink/junction escape defense (Gate C). Gate
// A/B are purely lexical (`path.resolve` never touches the filesystem), so
// a symlink or Windows junction whose target lands outside `root` would
// pass them undetected. Gate C re-resolves both `root` and `candidate` to
// their real, symlink-free filesystem locations and re-applies the same
// containment rule — only for targets that physically exist (nothing to
// resolve otherwise).
// ---------------------------------------------------------------------------

function checkRealpathContainment({ root, candidate, realpathSyncFn }) {
  let realRoot;
  let realCandidate;
  try {
    realRoot = realpathSyncFn(root);
  } catch {
    return { safe: false, status: 'HOLD_SYMLINK_ESCAPE_UNRESOLVED' };
  }
  try {
    realCandidate = realpathSyncFn(candidate);
  } catch {
    return { safe: false, status: 'HOLD_SYMLINK_ESCAPE_UNRESOLVED' };
  }
  if (!isPathContainedInRoot(realRoot, realCandidate)) {
    return { safe: false, status: 'HOLD_SYMLINK_ESCAPE_DETECTED' };
  }
  return { safe: true, status: 'OK' };
}

// ---------------------------------------------------------------------------
// DEFECT 3 fix — repository identity verification. A `rootDir` is not
// trustworthy just because a caller labeled it TARGET_WORKTREE/LOCAL_ROOT;
// an entirely unrelated Git repository (or a non-Git directory) handed in
// by mistake or by a bug elsewhere must never silently participate in an
// official-source decision. The expected identity (`expectedRootCommit`)
// MUST come from the caller's own trusted context — this function never
// derives it from `rootDir` itself, which is exactly the thing being
// verified. The root commit (`git rev-list --max-parents=0 HEAD`) is used
// as the stable identity marker because it is shared by every worktree and
// branch of the SAME repository, while an unrelated repository's history
// has a different (effectively unique) root. Known limitation: a shallow
// clone's apparent root commit is the shallow boundary, not the true repo
// root — out of scope for this correction, since every worktree this
// module runs against today is a full local clone.
// ---------------------------------------------------------------------------

/**
 * @param {{rootDir: string, expectedRootCommit: string, spawnSyncFn?: typeof spawnSync}} params
 * @returns {{verified: boolean, reason: string}}
 */
export function verifyRepositoryIdentity({ rootDir, expectedRootCommit, spawnSyncFn = spawnSync }) {
  if (!isValidFrozenSha(expectedRootCommit)) {
    return { verified: false, reason: 'MISSING_OR_INVALID_EXPECTED_IDENTITY' };
  }

  const toplevel = spawnSyncFn('git', ['-C', rootDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', shell: false });
  if (!toplevel || toplevel.status !== 0) {
    return { verified: false, reason: 'NOT_A_GIT_REPOSITORY' };
  }

  const rootCommits = spawnSyncFn('git', ['-C', rootDir, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8', shell: false });
  if (!rootCommits || rootCommits.status !== 0 || typeof rootCommits.stdout !== 'string') {
    return { verified: false, reason: 'IDENTITY_RESOLUTION_FAILED' };
  }

  const actualRootCommits = rootCommits.stdout.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (actualRootCommits.length === 0) {
    return { verified: false, reason: 'IDENTITY_RESOLUTION_FAILED' };
  }
  if (!actualRootCommits.includes(expectedRootCommit.toLowerCase())) {
    return { verified: false, reason: 'IDENTITY_MISMATCH' };
  }

  return { verified: true, reason: 'OK' };
}

// ---------------------------------------------------------------------------
// Evidence gatherers — real Git/filesystem reads (all `shell: false`, argv
// arrays). Each returns the SAME evidence shape regardless of source class,
// so `resolveOfficialSource` never needs to know how the evidence was
// collected.
// ---------------------------------------------------------------------------

function commitObjectExists({ repoRoot, sha, spawnSyncFn }) {
  const result = spawnSyncFn('git', ['-C', repoRoot, 'cat-file', '-e', `${sha}^{commit}`], { encoding: 'utf8', shell: false });
  return !!(result && result.status === 0);
}

/**
 * Read a file's content and tracked-state at an EXACT frozen commit SHA,
 * via `git cat-file` only — never `git show`/`git log` (pager/textconv
 * risk, per R3).
 *
 * DEFECT 2 fix: `sha` is validated as a canonical 40-lowercase-hex string
 * BEFORE any subprocess is spawned — `HEAD`, `HEAD~1`, a branch name, a tag,
 * an abbreviated SHA, or any other symbolic/moving reference is rejected as
 * `HOLD_INVALID_REMOTE_SHA` without ever invoking Git. This is deliberately
 * distinct from `HOLD_REMOTE_OBJECT_UNAVAILABLE`: the former means the
 * identifier itself does not meet the frozen-SHA contract; the latter means
 * it does, but the commit object is not available in this local clone.
 *
 * DEFECT 1 fix: `relPath` is validated with the same Gate A
 * (`isRepoRelativePath`) as the filesystem gatherer before it is ever
 * interpolated into a `<sha>:<path>` Git revspec argument.
 *
 * Beyond those two gates, this function distinguishes two different kinds
 * of "no content" outcomes, which callers must NEVER conflate:
 *
 *   1. The commit object itself is not available in this local clone
 *      (`resolutionStatus: 'HOLD_REMOTE_OBJECT_UNAVAILABLE'`) — this means
 *      we cannot know whether the path is tracked at that SHA at all. This
 *      module NEVER runs `git fetch` to resolve it, and
 *      `resolveOfficialSource` below refuses to resolve ANYTHING for this
 *      path when this happens — it must never silently fall through to a
 *      lower-priority source class.
 *   2. The commit exists locally but the path is legitimately not tracked
 *      at that SHA (`resolutionStatus: 'NOT_TRACKED_AT_SHA'`) — this is a
 *      conclusive, trustworthy "absent on remote", and IS allowed to fall
 *      through to lower-priority sources.
 * @param {{repoRoot: string, sha: string, relPath: string, spawnSyncFn?: typeof spawnSync}} params
 * @returns {object} evidence
 */
export function gatherRemoteMainEvidence({ repoRoot, sha, relPath, spawnSyncFn = spawnSync }) {
  const base = { sourceClass: 'REMOTE_MAIN', sourceSha: sha, sourcePath: relPath, sourceDirty: false, sourceUntracked: false };

  if (!isValidFrozenSha(sha)) {
    return { ...base, sourceTracked: null, content: null, resolutionStatus: 'HOLD_INVALID_REMOTE_SHA' };
  }
  if (!isRepoRelativePath(relPath)) {
    return { ...base, sourceTracked: null, content: null, resolutionStatus: 'HOLD_INVALID_REPO_RELATIVE_PATH' };
  }

  if (!commitObjectExists({ repoRoot, sha, spawnSyncFn })) {
    return { ...base, sourceTracked: null, content: null, resolutionStatus: 'HOLD_REMOTE_OBJECT_UNAVAILABLE' };
  }

  const existsResult = spawnSyncFn('git', ['-C', repoRoot, 'cat-file', '-e', `${sha}:${relPath}`], { encoding: 'utf8', shell: false });
  const tracked = !!(existsResult && existsResult.status === 0);
  if (!tracked) {
    return { ...base, sourceTracked: false, content: null, resolutionStatus: 'NOT_TRACKED_AT_SHA' };
  }

  const contentResult = spawnSyncFn('git', ['-C', repoRoot, 'cat-file', '-p', `${sha}:${relPath}`], { encoding: 'utf8', shell: false });
  const content = contentResult && contentResult.status === 0 && typeof contentResult.stdout === 'string' ? contentResult.stdout : null;
  return { ...base, sourceTracked: true, content, resolutionStatus: content !== null ? 'OK' : 'READ_ERROR' };
}

function isTrackedAtHead({ repoRoot, relPath, spawnSyncFn }) {
  const result = spawnSyncFn('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', '--', relPath], { encoding: 'utf8', shell: false });
  return !!(result && result.status === 0);
}

// `git diff --quiet` is documented plumbing (exit 0 = no differences, 1 =
// differences) — no pager, no textconv triggered by `--quiet`.
function isDirtyRelativeToHead({ repoRoot, relPath, spawnSyncFn }) {
  const result = spawnSyncFn('git', ['-C', repoRoot, 'diff', '--quiet', '--', relPath], { encoding: 'utf8', shell: false });
  if (!result) return null;
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  return null; // ambiguous — never assert "clean" in this case
}

/**
 * Read a file's real filesystem/Git state under an arbitrary working
 * directory (a target worktree, the dirty Windows root, or a historical
 * document's directory). Used for TARGET_WORKTREE, LOCAL_ROOT, and
 * HISTORICAL evidence alike — they differ only in the `sourceClass` label
 * and, structurally, their position in PRIORITY_ORDER, never in how the
 * evidence itself is gathered.
 *
 * R1 SECURITY CORRECTION — four gates run, IN ORDER, before any
 * `existsSync`/`readFileSync`/path-dependent Git command:
 *   Gate A — `relPath` must be a well-formed repo-relative path
 *            (`isRepoRelativePath`, from `path-safety.mjs`).
 *   Gate B — the resolved `candidate` path must be strictly, lexically
 *            contained inside the resolved `root` (DEFECT 1).
 *   Gate D — `rootDir` must verify as the expected repository, via
 *            `verifyRepositoryIdentity` against a caller-supplied,
 *            trusted `expectedRootCommit` (DEFECT 3). Omitting
 *            `expectedRootCommit` fails closed — it is never treated as
 *            "skip the check".
 *   Gate C — (after confirming the target physically exists) its REAL,
 *            symlink-resolved location must also be contained inside
 *            root's real location (DEFECT 1, symlink/junction variant).
 * @param {object} params
 * @param {'TARGET_WORKTREE'|'LOCAL_ROOT'|'HISTORICAL'} params.sourceClass
 * @param {string} params.rootDir
 * @param {string} params.relPath
 * @param {string} params.expectedRootCommit trusted, caller-supplied 40-lowercase-hex root-commit identity of the expected repository
 * @param {typeof spawnSync} [params.spawnSyncFn]
 * @param {typeof existsSync} [params.existsSyncFn]
 * @param {typeof readFileSync} [params.readFileSyncFn]
 * @param {typeof realpathSync} [params.realpathSyncFn]
 * @returns {object} evidence
 */
export function gatherFilesystemEvidence({
  sourceClass,
  rootDir,
  relPath,
  expectedRootCommit,
  spawnSyncFn = spawnSync,
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
  realpathSyncFn = realpathSync,
}) {
  const base = { sourceClass, sourcePath: relPath, sourceTracked: false, sourceDirty: false, sourceUntracked: false, content: null };

  // Gate A (DEFECT 1).
  if (!isRepoRelativePath(relPath)) {
    return { ...base, resolutionStatus: 'HOLD_INVALID_REPO_RELATIVE_PATH' };
  }

  const root = path.resolve(rootDir);
  const candidate = path.resolve(rootDir, relPath);

  // Gate B (DEFECT 1) — real containment, not a naive prefix string check.
  if (!isPathContainedInRoot(root, candidate)) {
    return { ...base, resolutionStatus: 'HOLD_PATH_ESCAPES_ROOT' };
  }

  // Gate D (DEFECT 3) — never derives the expected identity from rootDir
  // itself. Uses the caller's original `rootDir` string (not the resolved
  // `root`) for the git subprocess call, matching how every other git
  // invocation in this module addresses a working directory.
  const identity = verifyRepositoryIdentity({ rootDir, expectedRootCommit, spawnSyncFn });
  if (!identity.verified) {
    return { ...base, resolutionStatus: 'HOLD_REPOSITORY_IDENTITY_UNVERIFIED' };
  }

  const physicallyExists = existsSyncFn(candidate);
  if (!physicallyExists) {
    return { ...base, resolutionStatus: 'ABSENT' };
  }

  // Gate C (DEFECT 1, symlink/junction variant) — only meaningful once we
  // know the target exists.
  const realpathCheck = checkRealpathContainment({ root, candidate, realpathSyncFn });
  if (!realpathCheck.safe) {
    return { ...base, resolutionStatus: realpathCheck.status };
  }

  const tracked = isTrackedAtHead({ repoRoot: rootDir, relPath, spawnSyncFn });
  const dirty = tracked ? isDirtyRelativeToHead({ repoRoot: rootDir, relPath, spawnSyncFn }) === true : false;
  const untracked = !tracked;

  let content = null;
  try {
    content = readFileSyncFn(candidate, 'utf8');
  } catch {
    content = null;
  }

  return {
    sourceClass,
    sourcePath: relPath,
    sourceTracked: tracked,
    sourceDirty: dirty,
    sourceUntracked: untracked,
    content,
    resolutionStatus: content !== null ? 'OK' : 'READ_ERROR',
  };
}

// ---------------------------------------------------------------------------
// The core resolver — pure, no I/O. Takes already-gathered evidence and
// applies the frozen priority order. This is the ONLY function that decides
// what counts as "official" anywhere in the Night Agent; every rule in this
// module funnels through it.
// ---------------------------------------------------------------------------

// REMOTE_MAIN is the trust anchor of the entire hierarchy: if its evidence
// carries any of these statuses, we do not actually know REMOTE_MAIN's true
// state (an invalid identifier, an invalid path, or an unresolvable commit
// object), so the WHOLE resolution refuses to proceed — it must never
// silently cascade to a lower-priority class just because the anchor itself
// was unreadable. This is deliberately broader than the original
// (pre-R1) single-status check.
const REMOTE_MAIN_FAIL_CLOSED_STATUSES = new Set([
  'HOLD_REMOTE_OBJECT_UNAVAILABLE',
  'HOLD_INVALID_REMOTE_SHA',
  'HOLD_INVALID_REPO_RELATIVE_PATH',
]);

/**
 * @param {object[]} evidenceList evidence objects from the gatherers above (or synthetic, for tests)
 * @returns {{officialSource: object|null, comparisonEvidence: object[], reason: string}}
 */
export function resolveOfficialSource(evidenceList) {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    return { officialSource: null, comparisonEvidence: [], reason: 'NO_EVIDENCE' };
  }

  // Fail closed on ambiguous duplicate evidence for the same source class
  // (e.g. two different worktrees both offered as "the" TARGET_WORKTREE) —
  // never silently pick one candidate over another.
  const classCounts = new Map();
  for (const e of evidenceList) {
    if (!e || !e.sourceClass) continue;
    classCounts.set(e.sourceClass, (classCounts.get(e.sourceClass) ?? 0) + 1);
  }
  for (const [cls, count] of classCounts) {
    if (count > 1) {
      return { officialSource: null, comparisonEvidence: [], reason: `AMBIGUOUS_MULTIPLE_SOURCES_FOR_CLASS:${cls}` };
    }
  }

  // The central fail-closed rule (DEFECT 2 broadens this beyond the single
  // original status — see REMOTE_MAIN_FAIL_CLOSED_STATUSES above): never
  // silently degrade to LOCAL_ROOT (or any other class) just because
  // REMOTE_MAIN evidence was unavailable or untrustworthy.
  const remoteMainEvidence = evidenceList.find((e) => e && e.sourceClass === 'REMOTE_MAIN');
  if (remoteMainEvidence && REMOTE_MAIN_FAIL_CLOSED_STATUSES.has(remoteMainEvidence.resolutionStatus)) {
    return { officialSource: null, comparisonEvidence: [], reason: remoteMainEvidence.resolutionStatus };
  }

  // Only evidence with real string content (empty string counts — a real
  // empty file is still a real file) participates in priority resolution.
  // Every Gate-failure branch in the gatherers above leaves `content: null`,
  // so anything that failed Gate A/B/C/D is automatically excluded here —
  // it can never win by cascading, only legitimately-absent evidence can.
  const present = evidenceList.filter((e) => e && typeof e.content === 'string');
  if (present.length === 0) {
    return { officialSource: null, comparisonEvidence: [], reason: 'FILE_ABSENT_EVERYWHERE' };
  }

  for (const cls of PRIORITY_ORDER) {
    const match = present.find((e) => e.sourceClass === cls);
    if (match) {
      const comparisonEvidence = present.filter((e) => e !== match).map((e) => ({ ...e, role: 'COMPARISON_EVIDENCE_ONLY' }));
      return { officialSource: { ...match, role: 'OFFICIAL' }, comparisonEvidence, reason: `RESOLVED_BY_PRIORITY:${cls}` };
    }
  }

  return { officialSource: null, comparisonEvidence: present, reason: 'NO_RECOGNIZED_SOURCE_CLASS_PRESENT' };
}

/**
 * Label every piece of comparison evidence in a resolution with WHY it is
 * not official and confirm, explicitly, that it can never override the
 * official source. Pure, derived entirely from `resolveOfficialSource`'s
 * own output — never re-inspects file content to decide a label.
 * @param {{officialSource: object|null, comparisonEvidence: object[]}} resolution
 * @returns {object[]}
 */
export function classifyComparisonEvidence(resolution) {
  if (!resolution || !resolution.officialSource) return [];
  return resolution.comparisonEvidence.map((e) => {
    let classification;
    if (e.sourceClass === 'REMOTE_MAIN') {
      // Can only appear as comparison evidence if a HIGHER-priority class
      // does not exist — REMOTE_MAIN is priority 1, so this branch is
      // unreachable by construction, kept only for exhaustiveness.
      classification = 'OFFICIAL_CANDIDATE_BUT_SUPERSEDED';
    } else if (e.sourceClass === 'TARGET_WORKTREE') {
      classification = 'CANDIDATE_NOT_YET_INTEGRATED';
    } else if (e.sourceClass === 'LOCAL_ROOT') {
      classification = e.sourceUntracked ? 'STALE_LOCAL_COPY_UNTRACKED' : e.sourceDirty ? 'STALE_LOCAL_COPY_DIRTY' : 'STALE_LOCAL_COPY';
    } else if (e.sourceClass === 'HISTORICAL') {
      classification = e.content === resolution.officialSource.content ? 'HISTORICAL_CONFIRMED' : 'HISTORICAL_SUPERSEDED';
    } else {
      classification = 'COMPARISON_EVIDENCE_ONLY';
    }
    return { ...e, classification, canOverrideOfficial: false };
  });
}

// ---------------------------------------------------------------------------
// Audit-level SHA consistency — never mix evidence gathered under two
// different frozen `main` SHAs within one audit.
// ---------------------------------------------------------------------------

/**
 * @param {{frozenSha: string, currentRemoteMainSha: string|null}} params
 * @returns {{drifted: boolean, result: 'OK'|'HOLD_MAIN_DRIFT', reason: string}}
 */
export function checkAuditMainDrift({ frozenSha, currentRemoteMainSha }) {
  if (typeof currentRemoteMainSha !== 'string' || currentRemoteMainSha.length === 0) {
    return { drifted: true, result: 'HOLD_MAIN_DRIFT', reason: 'UNRESOLVED_CURRENT_REMOTE_MAIN' };
  }
  if (frozenSha !== currentRemoteMainSha) {
    return { drifted: true, result: 'HOLD_MAIN_DRIFT', reason: `frozen=${frozenSha} current=${currentRemoteMainSha}` };
  }
  return { drifted: false, result: 'OK', reason: 'MATCH' };
}
