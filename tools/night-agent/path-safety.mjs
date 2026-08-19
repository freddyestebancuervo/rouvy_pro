// Korixa Night Agent — centralized path-safety module (NIGHT-V1-B).
//
// Single source of truth for every path-safety rule the Night Agent
// depends on: lexical canonicalization, Windows-safe comparison, critical
// control-plane detection, task-scope containment, filesystem realpath
// containment, and symlink/junction detection. `tools/night-agent/
// queue.mjs` (schema validation) and `.claude/hooks/night-guard.mjs`
// (task-scoped Write/Edit/Read enforcement) both import from here rather
// than each keeping their own copy — per NIGHT-V1-B section 9, duplicating
// these rules between the runner and the guard is exactly the kind of
// drift that lets a validated policy and an actually-enforced boundary
// silently diverge.
//
// Node built-ins only. No file mutation anywhere in this module — the
// filesystem functions below (`realpathContainment`,
// `hasUnsafeSymlinkComponent`) only ever read (`realpathSync`, `lstatSync`,
// `existsSync`), never write.

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Windows reserved device names (section 8). Case-insensitive, and the
// reserved check applies to the name before the FIRST '.' in a segment —
// "CON", "con.txt", and "Con.tar.gz" are all reserved for the same reason
// Windows itself treats them as device names regardless of extension.
// ---------------------------------------------------------------------------

const WINDOWS_RESERVED_BASENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function isWindowsReservedSegment(segment) {
  const base = segment.split('.')[0].toUpperCase();
  return WINDOWS_RESERVED_BASENAMES.has(base);
}

/**
 * Lexical canonical-path validation. A value passing this check has EXACTLY
 * one valid string representation for its scope — no alias form (leading
 * "./", "//", "/./", trailing slash, trailing dot/space in a segment,
 * backslash, colon, control characters, Windows reserved device names) is
 * accepted. REJECT rather than normalize: a future writer must never see a
 * different (unvalidated) spelling than the one policy was checked
 * against — see NIGHT-V1-B section 15-17.
 *
 * NIGHT-V1-B section 7: unlike R4, there is NO trailing-slash exception —
 * TASK_QUEUE.example.json was migrated away from "backend/"-style entries
 * in this same block specifically so this function could close that gap.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRepoRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value !== value.trim()) return false; // leading/trailing whitespace rejected
  if (value.includes('\\')) return false; // no Windows separators
  if (value.includes('\0')) return false; // NUL-like
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) return false; // ASCII control characters
  if (value.includes(':')) return false; // colon — Windows drive-letter/ADS alias risk
  if (value.startsWith('/')) return false; // POSIX absolute
  if (value.endsWith('/')) return false; // NIGHT-V1-B: no trailing-slash exception (was R4-only)
  if (value.includes('..')) return false; // any traversal segment, conservatively (also rejects a bare "..")
  if (value === '.') return false; // exact "." is not a valid scope

  // Recognized global wildcards short-circuit here — no segments to validate.
  if (value === '*' || value === '**' || value === '**/*') return true;

  let body = value;
  if (value.includes('*')) {
    // Only a single recognized trailing "/**"/"/*" glob suffix is accepted
    // (with no further "*" elsewhere) — anything more complex cannot be
    // proven disjoint from another scope by the conservative exact/prefix/
    // global model in pathsOverlap, so it is rejected here instead of
    // silently risking a false "no conflict".
    const isSimpleTrailingGlob =
      (value.endsWith('/**') && !value.slice(0, -3).includes('*')) ||
      (value.endsWith('/*') && !value.slice(0, -2).includes('*'));
    if (!isSimpleTrailingGlob) return false;
    body = value.endsWith('/**') ? value.slice(0, -3) : value.slice(0, -2);
  }

  if (body.length === 0) return false; // e.g. "/**", "/*" alone

  for (const segment of body.split('/')) {
    if (segment === '') return false; // double slash ("backend//src")
    if (segment === '.') return false; // "." segment ("./backend", "backend/./src")
    if (segment === '..') return false; // redundant with the substring check above, explicit for clarity
    if (/\s$/.test(segment)) return false; // Windows trailing-space alias risk
    if (/\.$/.test(segment)) return false; // Windows trailing-dot alias risk
    if (isWindowsReservedSegment(segment)) return false; // CON, NUL, COM1, etc.
  }

  return true;
}

/**
 * Reduce a path/glob entry to a comparable scope: an exact leaf path, a
 * directory prefix (from a trailing `/**` or `/*`), or a global wildcard.
 * Comparison is case-folded (Windows runs a case-insensitive filesystem) —
 * internal to this function only; callers that need to report a path back
 * to a human always use the original, unmodified string, never this
 * lowercased form.
 * @param {string} rawValue
 * @returns {{type: 'exact'|'prefix'|'global', value?: string}}
 */
function pathScope(rawValue) {
  const value = rawValue.toLowerCase();
  if (value === '*' || value === '**' || value === '**/*') return { type: 'global' };
  if (value.endsWith('/**')) return { type: 'prefix', value: value.slice(0, -3) };
  if (value.endsWith('/*')) return { type: 'prefix', value: value.slice(0, -2) };
  return { type: 'exact', value };
}

/**
 * Conservatively decide whether two path/glob entries could ever address
 * the same file: exact equality, one being an ancestor directory of the
 * other (respecting the "/" segment boundary), or either being a GLOBAL
 * wildcard. False positive (over-cautious) is acceptable; false negative
 * is not.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function pathsOverlap(a, b) {
  const sa = pathScope(a);
  const sb = pathScope(b);

  if (sa.type === 'global' || sb.type === 'global') return true;

  if (sa.type === 'exact' && sb.type === 'exact') {
    return sa.value === sb.value || sa.value.startsWith(`${sb.value}/`) || sb.value.startsWith(`${sa.value}/`);
  }
  if (sa.type === 'prefix' && sb.type === 'prefix') {
    return (
      sa.value === sb.value ||
      sa.value.startsWith(`${sb.value}/`) ||
      sb.value.startsWith(`${sa.value}/`)
    );
  }
  const [exact, prefix] = sa.type === 'exact' ? [sa, sb] : [sb, sa];
  return exact.value === prefix.value || exact.value.startsWith(`${prefix.value}/`);
}

/**
 * Is `targetRelPath` (a single concrete path, not itself a glob) contained
 * by `scopeEntry` (an exact path, a "/**"/"/*" prefix, or a global
 * wildcard)? Unlike `pathsOverlap` (symmetric — "could these ever be the
 * same file"), this is directional containment: scope must cover target,
 * not the reverse. Case-folded, same as pathsOverlap.
 * @param {string} targetRelPath
 * @param {string} scopeEntry
 * @returns {boolean}
 */
function isContainedInSingleScope(targetRelPath, scopeEntry) {
  const scope = pathScope(scopeEntry);
  const target = targetRelPath.toLowerCase();
  if (scope.type === 'global') return true;
  if (scope.type === 'exact') return target === scope.value;
  return target === scope.value || target.startsWith(`${scope.value}/`);
}

/**
 * Is `targetRelPath` within ANY entry of `scopeEntries` (a task's
 * `allowed_paths` or `read_paths`)?
 * @param {string} targetRelPath
 * @param {string[]} scopeEntries
 * @returns {boolean}
 */
export function isPathWithinScope(targetRelPath, scopeEntries) {
  if (!Array.isArray(scopeEntries) || scopeEntries.length === 0) return false;
  return scopeEntries.some((entry) => typeof entry === 'string' && isContainedInSingleScope(targetRelPath, entry));
}

// ---------------------------------------------------------------------------
// Critical control-plane paths (section 12): never writable by an
// autonomous GREEN task, even if a task's allowed_paths would otherwise
// cover them. Checked independently of, and in addition to, allowed_paths
// containment — queue validation rejects any task whose allowed_paths
// overlaps one of these (see queue.mjs), and the guard denies any Write/
// Edit target that matches one, belt-and-suspenders.
// ---------------------------------------------------------------------------

const CRITICAL_PREFIXES = ['.claude/', 'tools/night-agent/', '.github/workflows/', '.git/'];
const CRITICAL_EXACT = ['.gitattributes', '.gitmodules', 'package.json', 'package-lock.json', 'pubspec.yaml', 'pubspec.lock'];

/**
 * Is `relPath` (or does it fall under) a critical control-plane path?
 * @param {string} relPath
 * @returns {boolean}
 */
export function isCriticalControlPlanePath(relPath) {
  const lower = relPath.toLowerCase();
  if (CRITICAL_EXACT.includes(lower)) return true;
  return CRITICAL_PREFIXES.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Filesystem realpath containment (section 10) and symlink/junction safety
// (section 11). Read-only filesystem access — realpathSync/lstatSync/
// existsSync only, never a write.
// ---------------------------------------------------------------------------

/**
 * Confirm that `targetRelPath`, resolved against `repoRoot`, cannot escape
 * the repo via a symlink/junction or any other filesystem-level
 * indirection a lexical string check cannot see. For an existing target,
 * its own realpath must resolve inside the repo's realpath. For a target
 * that does not exist yet, the nearest EXISTING ancestor's realpath must.
 * Comparison is case-insensitive (Windows). If containment cannot be
 * demonstrated, the caller must deny.
 * @param {string} repoRoot absolute path to the repository root
 * @param {string} targetRelPath a value that has already passed isRepoRelativePath
 * @returns {{contained: boolean, reason: string}}
 */
export function realpathContainment(repoRoot, targetRelPath) {
  let repoRealRoot;
  try {
    repoRealRoot = realpathSync(repoRoot);
  } catch {
    return { contained: false, reason: 'REPO_ROOT_NOT_RESOLVABLE' };
  }

  const absTarget = path.resolve(repoRoot, targetRelPath);
  let current = absTarget;
  let realResolved;
  // Walk up until something along the path actually exists and resolves —
  // this covers both "target already exists" (loop body runs once) and
  // "target is new" (nearest existing ancestor, per section 10).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      realResolved = realpathSync(current);
      break;
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        return { contained: false, reason: 'REALPATH_RESOLUTION_ERROR' };
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return { contained: false, reason: 'NO_EXISTING_ANCESTOR_FOUND' };
      }
      current = parent;
    }
  }

  const normalizedRoot = repoRealRoot.toLowerCase();
  const normalizedResolved = realResolved.toLowerCase();
  const contained = normalizedResolved === normalizedRoot || normalizedResolved.startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`);
  return contained ? { contained: true, reason: 'OK' } : { contained: false, reason: 'OUTSIDE_REPO_REALPATH' };
}

/**
 * Walk the EXISTING components of `targetRelPath` (from repo root
 * downward) and report whether any of them is a symbolic link or junction.
 * Stops at the first non-existent component — nothing further along an
 * as-yet-uncreated path can be inspected, and realpathContainment (a
 * second, independent barrier) still governs that case.
 * @param {string} repoRoot absolute path to the repository root
 * @param {string} targetRelPath a value that has already passed isRepoRelativePath
 * @returns {boolean} true if an unsafe symlink/junction component was found
 */
export function hasUnsafeSymlinkComponent(repoRoot, targetRelPath) {
  const segments = targetRelPath.split('/').filter((s) => s.length > 0);
  let current = repoRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      break;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * The combined write/edit-target safety gate (section 10-12): lexical
 * canonical form, not a critical control-plane path, within the task's
 * allowed_paths, no symlink/junction escape, and filesystem realpath
 * containment. Every check is independent — any single failure denies.
 * @param {object} params
 * @param {string} params.repoRoot absolute path to the repository root
 * @param {string} params.targetRelPath
 * @param {string[]} params.allowedPaths
 * @returns {{safe: boolean, reason: string}}
 */
export function isSafeWriteTarget({ repoRoot, targetRelPath, allowedPaths }) {
  if (!isRepoRelativePath(targetRelPath)) return { safe: false, reason: 'NON_CANONICAL_PATH' };
  if (isCriticalControlPlanePath(targetRelPath)) return { safe: false, reason: 'CRITICAL_CONTROL_PLANE_PATH' };
  if (!isPathWithinScope(targetRelPath, allowedPaths)) return { safe: false, reason: 'OUTSIDE_ALLOWED_PATHS' };
  if (hasUnsafeSymlinkComponent(repoRoot, targetRelPath)) return { safe: false, reason: 'SYMLINK_JUNCTION_ESCAPE' };
  const containment = realpathContainment(repoRoot, targetRelPath);
  if (!containment.contained) return { safe: false, reason: `REALPATH_CONTAINMENT_FAILED:${containment.reason}` };
  return { safe: true, reason: 'OK' };
}

/**
 * The combined read-target safety gate (section 14): target must exist,
 * pass lexical validation, not be a critical control-plane path, be within
 * the task's read_paths, have no symlink/junction escape, and pass
 * realpath containment.
 * @param {object} params
 * @param {string} params.repoRoot absolute path to the repository root
 * @param {string} params.targetRelPath
 * @param {string[]} params.readPaths
 * @returns {{safe: boolean, reason: string}}
 */
export function isSafeReadTarget({ repoRoot, targetRelPath, readPaths }) {
  if (!isRepoRelativePath(targetRelPath)) return { safe: false, reason: 'NON_CANONICAL_PATH' };
  if (!existsSync(path.resolve(repoRoot, targetRelPath))) return { safe: false, reason: 'TARGET_DOES_NOT_EXIST' };
  if (isCriticalControlPlanePath(targetRelPath)) return { safe: false, reason: 'CRITICAL_CONTROL_PLANE_PATH' };
  if (!isPathWithinScope(targetRelPath, readPaths)) return { safe: false, reason: 'OUTSIDE_READ_PATHS' };
  if (hasUnsafeSymlinkComponent(repoRoot, targetRelPath)) return { safe: false, reason: 'SYMLINK_JUNCTION_ESCAPE' };
  const containment = realpathContainment(repoRoot, targetRelPath);
  if (!containment.contained) return { safe: false, reason: `REALPATH_CONTAINMENT_FAILED:${containment.reason}` };
  return { safe: true, reason: 'OK' };
}

/**
 * Convert a tool-supplied `file_path` (which may be absolute or already
 * repo-relative — the exact convention was not independently re-verified
 * for this specific PreToolUse field in NIGHT-V1-B, so both forms are
 * handled defensively rather than assuming one) into a canonical
 * repo-relative path. Returns `null` when the path is absolute but does
 * NOT resolve under `repoRoot` — clearly outside the repo — rather than
 * silently coercing it into something that looks relative. Pure string
 * manipulation; does not touch the filesystem or assume the path exists.
 * @param {string} repoRoot
 * @param {string} filePath
 * @returns {string|null}
 */
export function toRepoRelativePath(repoRoot, filePath) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return null;
  if (typeof filePath !== 'string' || filePath.length === 0) return null;

  const normalizedRoot = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedTarget = filePath.replace(/\\/g, '/');
  const rootLower = normalizedRoot.toLowerCase();
  const targetLower = normalizedTarget.toLowerCase();

  if (targetLower === rootLower) return ''; // the repo root itself — never a valid file target
  if (targetLower.startsWith(`${rootLower}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }

  const looksAbsolute = /^[A-Za-z]:/.test(normalizedTarget) || normalizedTarget.startsWith('/');
  if (looksAbsolute) return null; // absolute but outside repoRoot
  return normalizedTarget; // not absolute — treat as already repo-relative
}
