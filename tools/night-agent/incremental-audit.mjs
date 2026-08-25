// Korixa Night Agent — incremental auditing (Improvement 5/5).
//
// Answers, precisely: what changed, from what trusted baseline, which
// components can be affected (transitively), which verifications must
// re-run, which prior evidence remains reusable, and — the operating
// principle this entire module exists to enforce — when incremental
// auditing is NOT sufficient and must escalate to a full audit instead of
// silently reusing something it cannot actually justify.
//
// INCREMENTAL != LESS_SECURE. Every optimization this module offers is an
// OPT-IN reduction of work, never an opt-out of a security guarantee: the
// default, on any uncertainty, is FULL_REQUIRED — never PASS.
//
// This module deliberately does NOT invent a second source of trust
// authority. Repository/commit identity verification reuses Improvement
// 1's own `verifyRepositoryIdentity` unmodified; Remote Main drift reuses
// Improvement 2's own `checkAuditMainDrift` unmodified; the "trust is
// object-identity-branded, never self-assertable by a raw caller object"
// pattern reuses Improvement 2's `TRUSTED_EVIDENCE_REGISTRY` idiom
// (private module-level `WeakSet`); the persisted-manifest atomic-write/
// closed-schema/validate/ABSENT-INVALID-VALID pattern reuses Improvement
// 4's `checkpoint.mjs` technique exactly (same temp-file-then-rename
// mechanism, same three-way read result). A caller can never construct an
// object like `{ decision: 'INCREMENTAL', trusted: true }` and have this
// module treat it as authoritative — every trust boundary here requires a
// REAL check (a real git commit resolution, a real repository-identity
// verification, a real atomic file this module itself wrote) to have
// actually happened first.
//
// Node built-ins + this project's own existing modules only.

import { spawnSync } from 'node:child_process';
import {
  readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyRepositoryIdentity, checkAuditMainDrift } from './source-of-truth.mjs';
import { isRepoRelativePath } from './path-safety.mjs';

export { checkAuditMainDrift };

// A schema/policy version for both the decision logic and the persisted
// manifest format. Bumping this is itself an AUDIT_POLICY_CHANGE (section
// 13/14) — any manifest written under an older version is structurally
// rejected by `resolveManifestReuse` below, never silently accepted.
//
// Bumped 1 -> 2 by IMP5-SCOPE-BOUNDARY-001's remediation: the canonical
// scope model changed (git-pathspec scoping removed; classification-based
// CANONICAL_SECURITY_ROOTS added; SECURITY_HOOK/HOOK_REGISTRATION
// components added). A manifest computed under version 1's vulnerable
// scoping could have recorded `decision: 'INCREMENTAL'` for a real change
// that touched `.claude/hooks/night-guard.mjs`/`.claude/settings.json` —
// such a manifest must never be treated as current just because its
// baseline/current SHA still happen to match; the policy that PRODUCED it
// is no longer trusted, independent of SHA matching.
//
// Bumped 2 -> 3 by IMP5-MANIFEST-TOCTOU-001's remediation:
// `resolveManifestReuse` previously trusted a persisted manifest's
// `reuse_allowed`/`decision` fields as long as `baseline_sha`/`current_sha`
// (both derived from COMMITTED git state) matched — it never re-observed
// the actual, current working-tree state, so a security-critical file
// (`.claude/hooks/night-guard.mjs`, `.claude/settings.json`, or anything
// under `tools/night-agent/`) mutated UNCOMMITTED after the manifest was
// written, with HEAD unchanged, was silently invisible to reuse and
// `resolveManifestReuse` returned `reusable: true`. `resolveManifestReuse`
// now always re-runs a fresh `decideIncrementalAudit` (the same, single,
// authoritative decision function — no second policy is invented) before
// permitting reuse, so live repository state always wins over a cached
// manifest. A manifest computed under version 2's vulnerable reuse
// contract must never be treated as current merely because SHAs match —
// the policy that PRODUCED and CONSUMED it is no longer trusted.
export const AUDIT_POLICY_VERSION = 3;

const FROZEN_SHA_PATTERN = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------
// IMP5-SCOPE-BOUNDARY-001 REMEDIATION: the canonical security scope. This
// list is a MODULE-OWNED, PRIVATE constant — never a function parameter,
// never caller-suppliable in any form. It was independently re-audited
// (not assumed) against the real repository: every actual runtime security
// dependency Night Agent has, beyond its own `tools/night-agent/` source
// tree, was traced by hand:
//   - `.claude/hooks/night-guard.mjs` is the real PreToolUse enforcement
//     hook `runner.mjs`'s controlled-execution pipeline depends on — it
//     directly imports `isSafeWriteTarget`/`isSafeReadTarget` from this
//     module's own `path-safety.mjs`, and this project's own test suite
//     (`tools/night-agent/test/night-guard.test.mjs`) already treats it as
//     part of the same system, just relocated because Claude Code's own
//     hook-discovery convention requires hooks to live under
//     `.claude/hooks/`.
//   - `.claude/settings.json` is read at runtime by `runner.mjs`'s
//     `checkNightGuardInstalled` — the preflight gate that verifies the
//     guard is actually wired up as a PreToolUse hook BEFORE any
//     policy/checkpoint/spawn ever runs. A change here can silently
//     un-register or redirect the guard.
// No other file outside `tools/night-agent/` was found, by the same
// process, to be read or executed by any Night Agent production code path
// (confirmed: `.claude/agents/*.md` are Claude Code subagent persona
// definitions Claude Code itself reads, never referenced by any
// `tools/night-agent/*.mjs`; `.claude/overnight/*.md`/`TASK_QUEUE.example
// .json` are human documentation whose VALUES were manually copied into
// hardcoded constants already inside `tools/night-agent/queue.mjs` — never
// read at runtime; this repository has no root `package.json`/lockfile/
// `.nvmrc`/`.gitattributes`/`.gitmodules` at all). If a FUTURE change to
// `tools/night-agent/**` introduces a new external dependency, that change
// is itself inside the canonical scope and is caught by ordinary
// SECURITY_CRITICAL_CHANGE escalation before it could ever benefit from
// stale incremental reuse (section 10's requirement).
// ---------------------------------------------------------------------------

const CANONICAL_SECURITY_ROOTS = Object.freeze([
  'tools/night-agent',
  '.claude/hooks/night-guard.mjs',
  '.claude/settings.json',
]);

function isWithinCanonicalScope(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  const normalized = relPath.replace(/\\/g, '/');
  return CANONICAL_SECURITY_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

// ---------------------------------------------------------------------------
// Component classification — closed set. OUT_OF_SCOPE is the only
// component this module ever silently disregards (a real, demonstrably
// unrelated change elsewhere in the repository — section 7/22, so a
// Night-Agent-specific incremental audit retains real value rather than
// becoming FULL_REQUIRED for every unrelated product edit). UNKNOWN means
// "inside the canonical scope but not classifiable" and always escalates
// (see `decideIncrementalAudit`) — this module never silently ignores a
// path it cannot classify THAT IS WITHIN scope.
// ---------------------------------------------------------------------------

export const COMPONENT_CLASSES = Object.freeze([
  'AUDIT_ENGINE', 'SOURCE_TRUTH', 'EVIDENCE_POLICY', 'RECOVERY', 'EXECUTION',
  'QUEUE', 'PATH_SAFETY', 'SECURITY_HOOK', 'HOOK_REGISTRATION',
  'TESTS', 'DOCS', 'FIXTURES', 'UNKNOWN', 'OUT_OF_SCOPE',
]);

// Every component EXCEPT TESTS/DOCS/FIXTURES/UNKNOWN/OUT_OF_SCOPE is
// security-critical — a change there can never be silently treated as
// "just an optimization opportunity" (section 9). SECURITY_HOOK and
// HOOK_REGISTRATION — both OUTSIDE tools/night-agent/ — are included here
// on the exact same footing as the in-tree components (section 8).
const SECURITY_CRITICAL_COMPONENTS = new Set([
  'AUDIT_ENGINE', 'SOURCE_TRUTH', 'EVIDENCE_POLICY', 'RECOVERY', 'EXECUTION', 'QUEUE', 'PATH_SAFETY',
  'SECURITY_HOOK', 'HOOK_REGISTRATION',
]);

const FILE_CLASS_MAP = Object.freeze({
  'tools/night-agent/incremental-audit.mjs': 'AUDIT_ENGINE',
  'tools/night-agent/source-of-truth.mjs': 'SOURCE_TRUTH',
  'tools/night-agent/evidence-policy.mjs': 'EVIDENCE_POLICY',
  'tools/night-agent/checkpoint.mjs': 'RECOVERY',
  'tools/night-agent/executor.mjs': 'EXECUTION',
  'tools/night-agent/runner.mjs': 'EXECUTION',
  'tools/night-agent/queue.mjs': 'QUEUE',
  'tools/night-agent/path-safety.mjs': 'PATH_SAFETY',
  '.claude/hooks/night-guard.mjs': 'SECURITY_HOOK',
  '.claude/settings.json': 'HOOK_REGISTRATION',
});

/**
 * Classify a repo-relative path into a component class. Derived from this
 * project's REAL, current file layout (`FILE_CLASS_MAP` above enumerates
 * the actual production modules AND the actual external security
 * dependencies — see `CANONICAL_SECURITY_ROOTS` above), not an abstract/
 * assumed taxonomy. A path outside every canonical root is OUT_OF_SCOPE —
 * demonstrably not this audit's concern, by module-owned policy, never by
 * a caller-suppliable pathspec. A path INSIDE scope that isn't otherwise
 * recognized — including a real file this map simply hasn't been updated
 * for yet — classifies as UNKNOWN, which `decideIncrementalAudit` always
 * escalates.
 * @param {string} relPath
 * @returns {string} one of COMPONENT_CLASSES
 */
export function classifyFile(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return 'UNKNOWN';
  const normalized = relPath.replace(/\\/g, '/');
  if (FILE_CLASS_MAP[normalized]) return FILE_CLASS_MAP[normalized];
  if (!isWithinCanonicalScope(normalized)) return 'OUT_OF_SCOPE';
  if (normalized.startsWith('tools/night-agent/test/')) return 'TESTS';
  if (normalized.startsWith('tools/night-agent/') && /\.md$/i.test(normalized)) return 'DOCS';
  if (/\/fixtures?\//i.test(normalized)) return 'FIXTURES';
  return 'UNKNOWN';
}

// The minimum test set a change to each component requires — derived by
// actually reading each real test file's own imports (evidence-policy.test
// .mjs imports evidence-policy.mjs; checkpoint.test.mjs imports checkpoint
// .mjs; executor.test.mjs and runner.test.mjs both import executor.mjs
// since runner.mjs's own controlled-execution path calls into it;
// queue.test.mjs and runner.test.mjs both import queue.mjs; path-safety
// .test.mjs and night-guard.test.mjs both import path-safety.mjs, and
// queue.mjs itself re-exports from path-safety.mjs so queue.test.mjs is
// included too) — not an assumed/invented mapping.
const COMPONENT_TEST_MAP = Object.freeze({
  AUDIT_ENGINE: Object.freeze(['tools/night-agent/test/incremental-audit.test.mjs']),
  SOURCE_TRUTH: Object.freeze(['tools/night-agent/test/source-of-truth.test.mjs']),
  EVIDENCE_POLICY: Object.freeze(['tools/night-agent/test/evidence-policy.test.mjs']),
  RECOVERY: Object.freeze(['tools/night-agent/test/checkpoint.test.mjs', 'tools/night-agent/test/executor.test.mjs', 'tools/night-agent/test/runner.test.mjs']),
  EXECUTION: Object.freeze(['tools/night-agent/test/executor.test.mjs', 'tools/night-agent/test/runner.test.mjs']),
  QUEUE: Object.freeze(['tools/night-agent/test/queue.test.mjs', 'tools/night-agent/test/runner.test.mjs']),
  PATH_SAFETY: Object.freeze(['tools/night-agent/test/path-safety.test.mjs', 'tools/night-agent/test/night-guard.test.mjs', 'tools/night-agent/test/queue.test.mjs']),
  // SECURITY_HOOK/HOOK_REGISTRATION: night-guard.mjs's own dedicated suite,
  // plus runner.test.mjs (which exercises checkNightGuardInstalled's real
  // read of .claude/settings.json).
  SECURITY_HOOK: Object.freeze(['tools/night-agent/test/night-guard.test.mjs', 'tools/night-agent/test/runner.test.mjs']),
  HOOK_REGISTRATION: Object.freeze(['tools/night-agent/test/runner.test.mjs']),
  TESTS: Object.freeze([]),
  DOCS: Object.freeze([]),
  FIXTURES: Object.freeze([]),
  UNKNOWN: Object.freeze([]),
  OUT_OF_SCOPE: Object.freeze([]),
});

// ---------------------------------------------------------------------------
// Real static dependency graph — a relative-import scanner, not a compiler.
// Builds the REVERSE graph (file -> the files that import it) because
// transitive IMPACT flows opposite to import direction: if C changes,
// everything that (transitively) imports C is affected, however many hops
// away.
// ---------------------------------------------------------------------------

const RELATIVE_IMPORT_RE = /(?:^|[\s;])import\s+(?:[\s\S]*?\bfrom\s+)?['"](\.\.?\/[^'"]+)['"]/g;

function extractRelativeImports(absPath, { readFileSyncFn, existsSyncFn }) {
  if (!existsSyncFn(absPath)) return [];
  let content;
  try {
    content = readFileSyncFn(absPath, 'utf8');
  } catch {
    return [];
  }
  const imports = new Set();
  const re = new RegExp(RELATIVE_IMPORT_RE);
  let m = re.exec(content);
  while (m !== null) {
    imports.add(m[1]);
    m = re.exec(content);
  }
  return [...imports];
}

/**
 * Build the reverse dependency graph for every real `.mjs` file directly
 * under `nightAgentDir` (never test files — those are LEAVES, they import
 * production code but nothing imports them back).
 * @param {object} params
 * @param {string} params.nightAgentDir
 * @param {typeof readdirSync} [params.readdirSyncFn]
 * @param {typeof readFileSync} [params.readFileSyncFn]
 * @param {typeof existsSync} [params.existsSyncFn]
 * @returns {Map<string, Set<string>>} basename -> Set of basenames that directly import it
 */
export function buildReverseDependencyGraph({
  nightAgentDir, readdirSyncFn = readdirSync, readFileSyncFn = readFileSync, existsSyncFn = existsSync,
}) {
  const entries = readdirSyncFn(nightAgentDir).filter((f) => f.endsWith('.mjs'));
  const reverse = new Map(entries.map((f) => [f, new Set()]));
  for (const file of entries) {
    const abs = path.join(nightAgentDir, file);
    const imports = extractRelativeImports(abs, { readFileSyncFn, existsSyncFn });
    for (const imp of imports) {
      const resolved = path.basename(imp);
      if (reverse.has(resolved)) {
        reverse.get(resolved).add(file);
      }
    }
  }
  return reverse;
}

/**
 * Transitive closure over the reverse dependency graph: every file
 * directly or indirectly affected by a change to any file in
 * `changedBaseNames`.
 * @param {string[]} changedBaseNames
 * @param {Map<string, Set<string>>} reverseGraph
 * @returns {Set<string>}
 */
export function computeTransitiveImpact(changedBaseNames, reverseGraph) {
  const affected = new Set(changedBaseNames);
  let frontier = [...changedBaseNames];
  while (frontier.length > 0) {
    const next = [];
    for (const f of frontier) {
      for (const dependent of reverseGraph.get(f) ?? []) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          next.push(dependent);
        }
      }
    }
    frontier = next;
  }
  return affected;
}

// ---------------------------------------------------------------------------
// Trusted baseline — the same object-identity-branding pattern as
// Improvement 2's `TRUSTED_EVIDENCE_REGISTRY`. A caller supplies MATERIAL
// (repoRoot, sha, expectedRootCommit — the exact same identity anchor
// `verifyRepositoryIdentity` already requires), never the CONCLUSION
// (`trusted`). A plain object literal claiming `{ sha, trusted: true }` is
// never accepted anywhere downstream — only an object THIS function itself
// produced, after real verification, is ever treated as trusted.
// ---------------------------------------------------------------------------

const TRUSTED_BASELINE_REGISTRY = new WeakSet();

/**
 * The ONLY way to produce a trusted baseline. Real verification: `sha`
 * must be a canonical 40-lowercase-hex string that actually resolves to a
 * real commit object in `repoRoot`, AND `repoRoot` must verify (via
 * Improvement 1's own unmodified `verifyRepositoryIdentity`) as the
 * canonical repository identified by `expectedRootCommit` — a caller
 * cannot bind a baseline to a foreign/synthetic repository by pointing
 * `repoRoot` somewhere else, for the exact same reason Improvement 2's R5
 * closed IMP2-REMOTE-IDENTITY-001.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.sha
 * @param {string} params.expectedRootCommit
 * @param {number} [params.auditPolicyVersion]
 * @param {typeof spawnSync} [params.spawnSyncFn]
 * @returns {{baseline: object|null, error: string|null}}
 */
export function createTrustedBaseline({
  repoRoot, sha, expectedRootCommit, auditPolicyVersion = AUDIT_POLICY_VERSION, spawnSyncFn = spawnSync,
}) {
  if (!FROZEN_SHA_PATTERN.test(sha)) {
    return { baseline: null, error: 'INVALID_BASELINE_SHA' };
  }
  const identity = verifyRepositoryIdentity({ rootDir: repoRoot, expectedRootCommit, spawnSyncFn });
  if (!identity.verified) {
    return { baseline: null, error: `HOLD_REPOSITORY_IDENTITY_UNVERIFIED:${identity.reason}` };
  }
  const commitCheck = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'cat-file', '-e', `${sha}^{commit}`], { encoding: 'utf8', shell: false });
  if (!commitCheck || commitCheck.status !== 0) {
    return { baseline: null, error: 'BASELINE_SHA_NOT_RESOLVABLE' };
  }
  const baseline = Object.freeze({
    repoRoot, sha, auditPolicyVersion, verifiedAt: new Date().toISOString(),
  });
  TRUSTED_BASELINE_REGISTRY.add(baseline);
  return { baseline, error: null };
}

/**
 * True only for the EXACT object reference `createTrustedBaseline`
 * produced — copying every visible field (spread/Object.assign/JSON
 * round-trip/Object.create) produces a new reference absent from the
 * registry, exactly like `TRUSTED_EVIDENCE_REGISTRY`.
 * @param {any} candidate
 * @returns {boolean}
 */
export function isTrustedBaseline(candidate) {
  return TRUSTED_BASELINE_REGISTRY.has(candidate);
}

// ---------------------------------------------------------------------------
// Changeset — real Git state only, never mtime/size. Distinguishes
// MODIFIED/ADDED/DELETED/RENAMED (committed, since baseline.sha) from
// uncommitted/untracked (via `git status --porcelain`) — a relevant
// untracked file is never invisible to this computation.
// ---------------------------------------------------------------------------

/**
 * IMP5-SCOPE-BOUNDARY-001 REMEDIATION: this function no longer accepts any
 * caller-suppliable pathspec/scope parameter. It always computes the
 * changeset for the WHOLE repository, with no `-- pathspec` argument on
 * either git call — git itself is never asked to hide anything from this
 * query. Relevance filtering happens exclusively in `decideIncrementalAudit`
 * via `classifyFile`'s module-owned, non-caller-controlled
 * `CANONICAL_SECURITY_ROOTS` policy, applied AFTER this function returns
 * the complete, real picture — never before.
 * @param {object} params
 * @param {object} params.baseline must be `isTrustedBaseline`
 * @param {string} params.repoRoot
 * @param {typeof spawnSync} [params.spawnSyncFn]
 * @returns {{changeset: object|null, error: string|null}}
 */
export function computeChangeset({ baseline, repoRoot, spawnSyncFn = spawnSync }) {
  if (!isTrustedBaseline(baseline)) {
    return { changeset: null, error: 'UNTRUSTED_BASELINE' };
  }
  const headResult = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', shell: false });
  if (!headResult || headResult.status !== 0 || typeof headResult.stdout !== 'string') {
    return { changeset: null, error: 'HEAD_UNRESOLVED' };
  }
  const currentSha = headResult.stdout.trim();

  const files = [];
  if (currentSha !== baseline.sha) {
    const diffResult = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'diff', '--name-status', '-M', baseline.sha, currentSha], { encoding: 'utf8', shell: false });
    if (!diffResult || diffResult.status !== 0 || typeof diffResult.stdout !== 'string') {
      return { changeset: null, error: 'DIFF_UNRESOLVED' };
    }
    for (const line of diffResult.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split('\t');
      const statusCode = parts[0];
      if (statusCode.startsWith('R')) {
        files.push({ path: parts[2], oldPath: parts[1], changeType: 'RENAMED' });
      } else if (statusCode === 'A') {
        files.push({ path: parts[1], oldPath: null, changeType: 'ADDED' });
      } else if (statusCode === 'D') {
        files.push({ path: parts[1], oldPath: null, changeType: 'DELETED' });
      } else {
        files.push({ path: parts[1], oldPath: null, changeType: 'MODIFIED' });
      }
    }
  }

  const statusResult = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8', shell: false });
  if (!statusResult || statusResult.status !== 0 || typeof statusResult.stdout !== 'string') {
    return { changeset: null, error: 'STATUS_UNRESOLVED' };
  }
  const untrackedFiles = [];
  const workingTreeChangedPaths = [];
  let dirty = false;
  for (const line of statusResult.stdout.split('\n').filter((l) => l.length > 0)) {
    const code = line.slice(0, 2);
    const filePath = line.slice(3).trim().replace(/^"|"$/g, '');
    if (code === '??') {
      untrackedFiles.push(filePath);
      dirty = true;
    } else {
      dirty = true;
      workingTreeChangedPaths.push(filePath);
      if (!files.some((f) => f.path === filePath)) {
        files.push({ path: filePath, oldPath: null, changeType: 'MODIFIED' });
      }
    }
  }

  return {
    changeset: {
      baselineSha: baseline.sha,
      currentSha,
      files,
      untrackedFiles,
      workingTreeChangedPaths,
      dirty,
      shaDrift: currentSha !== baseline.sha,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Test-weakening detection — conservative, textual, best-effort (section
// 12/28: "no need to build a full semantic JS diff analyzer"). Flags a
// DECREASE in test/assertion counts, or a NEWLY-introduced `.skip(`/
// `.only(`/`.todo(` marker that was not already present in the baseline
// version of the same file.
// ---------------------------------------------------------------------------

const SUSPICIOUS_NEW_PATTERNS = Object.freeze([/\.skip\s*\(/, /\.only\s*\(/, /\btest\.todo\s*\(/]);

/**
 * @param {{oldContent: string, newContent: string}} params
 * @returns {{weakened: boolean, reasons: string[]}}
 */
export function detectTestWeakening({ oldContent, newContent }) {
  const reasons = [];
  const countMatches = (text, re) => (text.match(re) || []).length;
  const oldTestCount = countMatches(oldContent, /\btest\s*\(/g);
  const newTestCount = countMatches(newContent, /\btest\s*\(/g);
  if (newTestCount < oldTestCount) reasons.push(`TEST_COUNT_DECREASED:${oldTestCount}->${newTestCount}`);
  const oldAssertCount = countMatches(oldContent, /\bassert\.\w+\(/g);
  const newAssertCount = countMatches(newContent, /\bassert\.\w+\(/g);
  if (newAssertCount < oldAssertCount) reasons.push(`ASSERTION_COUNT_DECREASED:${oldAssertCount}->${newAssertCount}`);
  for (const pattern of SUSPICIOUS_NEW_PATTERNS) {
    if (pattern.test(newContent) && !pattern.test(oldContent)) {
      reasons.push(`NEW_SUSPICIOUS_PATTERN:${pattern.source}`);
    }
  }
  return { weakened: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// The decision. Fails closed to FULL_REQUIRED on any uncertainty — never
// silently PASS/INCREMENTAL. Explainable: every field a caller needs to
// understand WHY is present, never an opaque boolean.
// ---------------------------------------------------------------------------

export const AUDIT_DECISIONS = Object.freeze(['INCREMENTAL', 'TARGETED', 'FULL_REQUIRED']);

function fullRequiredResult(baseline, escalationReasons) {
  return {
    baselineSha: (baseline && typeof baseline === 'object' && baseline.sha) || null,
    currentSha: null,
    changedFiles: [],
    affectedComponents: [],
    requiredTests: [],
    reuseAllowed: false,
    escalationReasons,
    decision: 'FULL_REQUIRED',
  };
}

/**
 * IMP5-SCOPE-BOUNDARY-001 REMEDIATION: no caller-suppliable scope
 * parameter of any kind. `computeChangeset` always sees the WHOLE
 * repository; relevance is decided here, exclusively via `classifyFile`'s
 * module-owned `CANONICAL_SECURITY_ROOTS` policy — a caller cannot narrow,
 * relocate, or exclude any part of the canonical security scope, because
 * there is no parameter through which to attempt it.
 * @param {object} params
 * @param {object} params.baseline must be `isTrustedBaseline`
 * @param {string} params.repoRoot
 * @param {typeof spawnSync} [params.spawnSyncFn]
 * @param {typeof readdirSync} [params.readdirSyncFn]
 * @param {typeof readFileSync} [params.readFileSyncFn]
 * @param {typeof existsSync} [params.existsSyncFn]
 * @returns {object} the explainable decision
 */
export function decideIncrementalAudit({
  baseline, repoRoot,
  spawnSyncFn = spawnSync, readdirSyncFn = readdirSync, readFileSyncFn = readFileSync, existsSyncFn = existsSync,
}) {
  if (!isTrustedBaseline(baseline)) {
    return fullRequiredResult(baseline, ['UNTRUSTED_BASELINE']);
  }

  const { changeset, error } = computeChangeset({ baseline, repoRoot, spawnSyncFn });
  if (changeset === null) {
    return fullRequiredResult(baseline, [`CHANGESET_UNAVAILABLE:${error}`]);
  }

  const escalationReasons = [];

  // Whole-repository view, exactly as git reported it — nothing hidden at
  // the query level. `isInScope` is the ONLY filter, and it is entirely
  // module-owned (see `classifyFile`/`CANONICAL_SECURITY_ROOTS`).
  const allRepoChangedPaths = [
    ...changeset.files.map((f) => f.path),
    ...changeset.files.filter((f) => f.oldPath).map((f) => f.oldPath),
    ...changeset.untrackedFiles,
  ];
  const isInScope = (p) => classifyFile(p) !== 'OUT_OF_SCOPE';
  const allChangedPaths = allRepoChangedPaths.filter(isInScope);

  // DIRTY_WORKTREE only escalates when the uncommitted/untracked state
  // itself touches something IN canonical scope — an unrelated dirty file
  // elsewhere in the repository must not destroy this tool's value
  // (section 7/22), but any in-scope dirt (including a NEW file the
  // classifier has never seen — UNKNOWN — which independently escalates
  // below) always does.
  const relevantDirty = [...changeset.workingTreeChangedPaths, ...changeset.untrackedFiles].some(isInScope);
  if (relevantDirty) escalationReasons.push('DIRTY_WORKTREE');

  const unsafePaths = allChangedPaths.filter((p) => !isRepoRelativePath(p));
  if (unsafePaths.length > 0) escalationReasons.push(`UNSAFE_PATH:${unsafePaths.join('|')}`);

  const directComponents = new Set(allChangedPaths.map((p) => classifyFile(p)));
  if (directComponents.has('UNKNOWN')) escalationReasons.push('UNKNOWN_FILE_CLASS');
  if ([...directComponents].some((c) => SECURITY_CRITICAL_COMPONENTS.has(c))) escalationReasons.push('SECURITY_CRITICAL_CHANGE');
  if (directComponents.has('AUDIT_ENGINE')) escalationReasons.push('AUDIT_ENGINE_SELF_CHANGE');

  const inScopeFiles = changeset.files.filter((f) => isInScope(f.path) || (f.oldPath && isInScope(f.oldPath)));
  if (inScopeFiles.some((f) => f.changeType === 'DELETED' && SECURITY_CRITICAL_COMPONENTS.has(classifyFile(f.path)))) {
    escalationReasons.push('SECURITY_FILE_DELETED');
  }
  if (inScopeFiles.some((f) => f.changeType === 'DELETED' && classifyFile(f.path) === 'TESTS')) {
    escalationReasons.push('TEST_FILE_DELETED');
  }
  if (inScopeFiles.some((f) => f.changeType === 'RENAMED'
    && (SECURITY_CRITICAL_COMPONENTS.has(classifyFile(f.path)) || SECURITY_CRITICAL_COMPONENTS.has(classifyFile(f.oldPath))))) {
    escalationReasons.push('SECURITY_FILE_RENAMED');
  }

  for (const f of inScopeFiles) {
    if (f.changeType === 'MODIFIED' && classifyFile(f.path) === 'TESTS' && changeset.shaDrift) {
      // only checkable for a real committed range (baseline.sha -> currentSha);
      // uncommitted-only modifications to a test file are still caught by
      // DIRTY_WORKTREE above.
      try {
        const oldShow = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'show', `${baseline.sha}:${f.path}`], { encoding: 'utf8', shell: false });
        const newShow = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'show', `${changeset.currentSha}:${f.path}`], { encoding: 'utf8', shell: false });
        if (oldShow && oldShow.status === 0 && newShow && newShow.status === 0) {
          const weaken = detectTestWeakening({ oldContent: oldShow.stdout, newContent: newShow.stdout });
          if (weaken.weakened) escalationReasons.push(`TEST_WEAKENING:${f.path}:${weaken.reasons.join(',')}`);
        }
      } catch {
        escalationReasons.push(`TEST_WEAKENING_CHECK_FAILED:${f.path}`);
      }
    }
  }

  let transitiveComponents = new Set(directComponents);
  try {
    // The dependency-graph scanner only walks the real .mjs production
    // files under tools/night-agent/ (CANONICAL_SECURITY_ROOTS[0]) — the
    // external security dependencies (SECURITY_HOOK/HOOK_REGISTRATION) are
    // covered directly by FILE_CLASS_MAP/isInScope instead, since they are
    // each a single, individually-tracked file, not a directory of
    // interdependent modules to graph.
    const nightAgentDir = path.join(repoRoot, CANONICAL_SECURITY_ROOTS[0]);
    const reverseGraph = buildReverseDependencyGraph({ nightAgentDir, readdirSyncFn, readFileSyncFn, existsSyncFn });
    const changedBaseNames = allChangedPaths.map((p) => path.basename(p)).filter((bn) => reverseGraph.has(bn));
    const transitiveFiles = computeTransitiveImpact(changedBaseNames, reverseGraph);
    for (const f of transitiveFiles) {
      transitiveComponents.add(classifyFile(`${CANONICAL_SECURITY_ROOTS[0]}/${f}`));
    }
  } catch {
    escalationReasons.push('DEPENDENCY_GRAPH_UNAVAILABLE');
    transitiveComponents = new Set([...directComponents, 'UNKNOWN']);
  }

  const requiredTestsSet = new Set();
  for (const c of transitiveComponents) {
    for (const t of COMPONENT_TEST_MAP[c] ?? []) requiredTestsSet.add(t);
  }
  for (const p of allChangedPaths) {
    if (classifyFile(p) === 'TESTS') requiredTestsSet.add(p);
  }

  let decision;
  if (escalationReasons.length > 0) {
    decision = 'FULL_REQUIRED';
  } else if (allChangedPaths.length === 0 || allChangedPaths.every((p) => classifyFile(p) === 'DOCS')) {
    decision = 'INCREMENTAL';
  } else {
    decision = 'TARGETED';
  }

  return {
    baselineSha: baseline.sha,
    currentSha: changeset.currentSha,
    changedFiles: allChangedPaths,
    affectedComponents: [...transitiveComponents],
    requiredTests: [...requiredTestsSet],
    reuseAllowed: decision !== 'FULL_REQUIRED',
    escalationReasons,
    decision,
  };
}

/**
 * Section 15/16: a decision computed against `decision.currentSha` becomes
 * stale the instant real HEAD moves past it — never reused once stale,
 * regardless of branch name (which this module never even reads for this
 * purpose).
 * @param {object} params
 * @param {object} params.decision
 * @param {string} params.repoRoot
 * @param {typeof spawnSync} [params.spawnSyncFn]
 * @returns {boolean} true if the decision must NOT be reused
 */
export function isDecisionStale({ decision, repoRoot, spawnSyncFn = spawnSync }) {
  if (!decision || typeof decision.currentSha !== 'string' || !FROZEN_SHA_PATTERN.test(decision.currentSha)) return true;
  const headResult = spawnSyncFn('git', ['--no-replace-objects', '-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', shell: false });
  if (!headResult || headResult.status !== 0 || typeof headResult.stdout !== 'string') return true;
  return headResult.stdout.trim() !== decision.currentSha;
}

// ---------------------------------------------------------------------------
// Persisted manifest — an OPTIMIZATION cache, never an authority. Same
// atomic write (temp-file-then-rename, same directory) and same
// ABSENT/INVALID/VALID three-way read distinction as
// `checkpoint.mjs`'s `writeCheckpointAtomic`/`readCheckpointForResume`
// (Improvement 4), reused here as the SAME technique rather than a new
// one. A closed 11-field schema — a caller-forged object claiming extra
// fields, or claiming `decision: 'PASS'` (not even a member of
// `AUDIT_DECISIONS`), fails `validateManifest` outright.
// ---------------------------------------------------------------------------

const MANIFEST_ALLOWED_FIELDS = new Set([
  'schema_version', 'repo_root', 'baseline_sha', 'current_sha',
  'decision', 'changed_files', 'affected_components', 'required_tests', 'escalation_reasons',
  'reuse_allowed', 'created_at',
]);

/**
 * @param {any} m
 * @returns {boolean}
 */
export function validateManifest(m) {
  if (m === null || typeof m !== 'object') return false;
  const keys = Object.keys(m);
  if (keys.length !== MANIFEST_ALLOWED_FIELDS.size) return false;
  if (!keys.every((k) => MANIFEST_ALLOWED_FIELDS.has(k))) return false;
  if (m.schema_version !== AUDIT_POLICY_VERSION) return false;
  if (typeof m.repo_root !== 'string' || m.repo_root.length === 0) return false;
  if (!FROZEN_SHA_PATTERN.test(m.baseline_sha)) return false;
  if (!FROZEN_SHA_PATTERN.test(m.current_sha)) return false;
  if (!AUDIT_DECISIONS.includes(m.decision)) return false;
  if (!Array.isArray(m.changed_files) || !m.changed_files.every((x) => typeof x === 'string')) return false;
  if (!Array.isArray(m.affected_components) || !m.affected_components.every((x) => typeof x === 'string')) return false;
  if (!Array.isArray(m.required_tests) || !m.required_tests.every((x) => typeof x === 'string')) return false;
  if (!Array.isArray(m.escalation_reasons) || !m.escalation_reasons.every((x) => typeof x === 'string')) return false;
  if (typeof m.reuse_allowed !== 'boolean') return false;
  if (typeof m.created_at !== 'string') return false;
  return true;
}

/**
 * Serialize an already-computed `decideIncrementalAudit` result into the
 * manifest's closed field set. Never accepts a caller-constructed
 * decision-shaped object directly — only the real return value of
 * `decideIncrementalAudit`.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {object} params.decision
 * @param {string} [params.now]
 * @returns {object}
 */
export function buildManifest({ repoRoot, decision, now }) {
  return {
    schema_version: AUDIT_POLICY_VERSION,
    repo_root: repoRoot,
    baseline_sha: decision.baselineSha,
    current_sha: decision.currentSha,
    decision: decision.decision,
    changed_files: decision.changedFiles,
    affected_components: decision.affectedComponents,
    required_tests: decision.requiredTests,
    escalation_reasons: decision.escalationReasons,
    reuse_allowed: decision.reuseAllowed,
    created_at: now ?? new Date().toISOString(),
  };
}

const MANIFEST_DIR_NAME = 'korixa-night-agent-incremental-audit';

/**
 * Deterministic, stable manifest path for (repoRoot) — same technique as
 * `checkpoint.mjs`'s `resolveCheckpointPath` (hash the identity, never
 * embed a raw caller-controlled string in the path itself). Pure string
 * computation — no filesystem access.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {() => string} [params.tmpDirFn]
 * @returns {string}
 */
export function resolveManifestPath({ repoRoot, tmpDirFn = tmpdir }) {
  const normalizedRoot = path.resolve(repoRoot).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const hash = createHash('sha256').update(normalizedRoot, 'utf8').digest('hex');
  return path.join(tmpDirFn(), MANIFEST_DIR_NAME, `${hash}.json`);
}

/**
 * @param {string} filePath
 * @param {object} manifest
 * @returns {string} filePath
 */
export function writeManifestAtomic(filePath, manifest) {
  if (!validateManifest(manifest)) {
    throw new Error('writeManifestAtomic: manifest failed validateManifest — refusing to write a malformed manifest');
  }
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
  return filePath;
}

/**
 * @param {string} filePath
 * @param {{existsSyncFn?: typeof existsSync, readFileSyncFn?: typeof readFileSync}} [params]
 * @returns {{status: 'ABSENT'}|{status: 'INVALID'}|{status: 'VALID', manifest: object}}
 */
export function readManifestForReuse(filePath, { existsSyncFn = existsSync, readFileSyncFn = readFileSync } = {}) {
  if (!existsSyncFn(filePath)) return { status: 'ABSENT' };
  let raw;
  try {
    raw = readFileSyncFn(filePath, 'utf8');
  } catch {
    return { status: 'INVALID' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'INVALID' };
  }
  return validateManifest(parsed) ? { status: 'VALID', manifest: parsed } : { status: 'INVALID' };
}

/**
 * AUDIT_CACHE_CAN_CREATE_AUTHORITY = NO: this function never answers "is
 * the code safe" — it answers "can THIS ALREADY-VALID manifest still
 * stand in for a fresh `decideIncrementalAudit` call, right now, for this
 * exact repo/baseline/HEAD/policy version, AND does the repository's
 * ACTUAL CURRENT state (not just its last-known committed SHA) still
 * agree with that." Any mismatch — wrong repo, wrong baseline SHA, wrong
 * current SHA (HEAD has moved — section 15/16), wrong policy version
 * (section 13/14 — the audit engine's own logic changed since this
 * manifest was written), a manifest that was itself `FULL_REQUIRED`
 * (nothing to reuse), a corrupt/forged/missing file, OR a live repository
 * state that a FRESH decision would no longer consider safe (IMP5-
 * MANIFEST-TOCTOU-001 — section below) — fails closed to "not reusable,"
 * never silently treated as a PASS.
 *
 * IMP5-MANIFEST-TOCTOU-001 REMEDIATION: matching `baseline_sha`/
 * `current_sha` (both derived from COMMITTED git state) is necessary but
 * NOT sufficient — a security-critical file can be mutated UNCOMMITTED
 * after the manifest was written without moving HEAD at all. This
 * function therefore always re-runs a genuinely fresh `decideIncrementalAudit`
 * (the SAME, single, authoritative decision — no second, cache-specific
 * policy is invented here) over the repository's live state immediately
 * before permitting reuse. LIVE REPOSITORY STATE always wins: if that
 * fresh decision would itself require `FULL_REQUIRED`, the manifest is
 * refused regardless of how perfectly its recorded SHAs match. The caller
 * cannot short-circuit this by asserting its own worktree/dirty/fingerprint
 * state — no such parameter exists; the module always observes Git and the
 * filesystem itself.
 * @param {object} params
 * @param {string} params.filePath
 * @param {string} params.repoRoot
 * @param {object} params.baseline must be `isTrustedBaseline`
 * @param {string} params.currentSha
 * @param {{existsSyncFn?: typeof existsSync, readFileSyncFn?: typeof readFileSync, spawnSyncFn?: typeof spawnSync, readdirSyncFn?: typeof readdirSync}} [params]
 * @returns {{reusable: boolean, manifest?: object, reason: string}}
 */
export function resolveManifestReuse({
  filePath, repoRoot, baseline, currentSha,
  existsSyncFn = existsSync, readFileSyncFn = readFileSync, spawnSyncFn = spawnSync, readdirSyncFn = readdirSync,
}) {
  if (!isTrustedBaseline(baseline)) return { reusable: false, reason: 'UNTRUSTED_BASELINE' };
  const readResult = readManifestForReuse(filePath, { existsSyncFn, readFileSyncFn });
  if (readResult.status !== 'VALID') return { reusable: false, reason: `MANIFEST_${readResult.status}` };
  const m = readResult.manifest;
  if (m.schema_version !== AUDIT_POLICY_VERSION) return { reusable: false, reason: 'MANIFEST_POLICY_VERSION_MISMATCH' };
  if (path.resolve(m.repo_root).toLowerCase() !== path.resolve(repoRoot).toLowerCase()) return { reusable: false, reason: 'MANIFEST_WRONG_REPO' };
  if (m.baseline_sha !== baseline.sha) return { reusable: false, reason: 'MANIFEST_WRONG_BASELINE_SHA' };
  if (m.current_sha !== currentSha) return { reusable: false, reason: 'MANIFEST_STALE_CURRENT_SHA' };
  if (!m.reuse_allowed || m.decision === 'FULL_REQUIRED') return { reusable: false, reason: 'MANIFEST_WAS_FULL_REQUIRED' };

  // Live revalidation (IMP5-MANIFEST-TOCTOU-001): everything above only
  // proves the manifest is internally consistent with the repo's last
  // known COMMITTED identity. It proves nothing about what is on disk
  // right now. Re-derive the decision from scratch, from real, current
  // Git/filesystem state, exactly as any first-time caller would.
  let freshDecision;
  try {
    freshDecision = decideIncrementalAudit({
      baseline, repoRoot, spawnSyncFn, readdirSyncFn, readFileSyncFn, existsSyncFn,
    });
  } catch {
    return { reusable: false, reason: 'LIVE_REVALIDATION_FAILED' };
  }
  if (!freshDecision || typeof freshDecision !== 'object' || !AUDIT_DECISIONS.includes(freshDecision.decision)) {
    return { reusable: false, reason: 'LIVE_REVALIDATION_FAILED' };
  }
  if (freshDecision.currentSha !== currentSha) {
    // HEAD itself moved between the caller resolving `currentSha` and this
    // live check running — the classic staleness case, caught again here
    // defense-in-depth.
    return { reusable: false, reason: 'LIVE_STATE_STALE_CURRENT_SHA' };
  }
  if (!freshDecision.reuseAllowed || freshDecision.decision === 'FULL_REQUIRED') {
    return {
      reusable: false,
      reason: `LIVE_STATE_REQUIRES_FULL:${freshDecision.escalationReasons.join(',') || 'UNSPECIFIED'}`,
    };
  }

  return { reusable: true, manifest: m, reason: 'MATCH' };
}
