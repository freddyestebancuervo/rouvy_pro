// Korixa — Common Agent Protocol (Task 4, 2026-08-23): the LOCK MODEL.
//
// Locks here are NOT for running A/B/C in parallel -- this repository's
// single-chat model has exactly one active role at a time, always (see
// task-orchestrator.mjs). They exist to prevent: double activation of the
// same task, two tasks reserving overlapping writable scopes, stale
// resumed work acting as if it still owns a task, releasing another
// task's reservation, and a second task starting its own NIGHT/A/B/C
// sequence while one is already in flight in this chat.
//
// Persistence follows checkpoint.mjs's own proven pattern exactly:
// temp-file-then-rename (atomic), closed field set (ALLOWED fields only),
// deterministic hash-derived path OUTSIDE the repository, and a read path
// that NEVER throws and treats absent/corrupt identically as "no trusted
// state" -- but, unlike checkpoint.mjs (whose reader collapses
// absent/corrupt to the same `null`), every read here that finds a
// present-but-invalid file is surfaced distinctly as `HOLD_LOCK_RECOVERY_
// REQUIRED` to its caller, never silently treated as "no lock" (which
// would let a caller wrongly conclude a scope is free) and never
// auto-repaired or overwritten (no destructive cleanup — brief section 6).
//
// Ownership is proven by an opaque, non-guessable token (crypto.randomBytes),
// generated fresh at acquisition time and required, verbatim, to release.
// This is a LOCAL, in-process/in-chat safety net against accidental
// double-invocation, not a network authentication boundary -- ownership
// comparison is plain string equality, matching this codebase's existing
// exact-identity idiom (role-protocol.mjs's `identitiesAreIndependent`),
// not a timing-safe compare (no external attacker model applies here).
//
// Never auto-steals a lock because a timestamp "looks old" -- there is no
// expiry logic anywhere in this file. A lock is released only by an exact
// owner_token match; there is deliberately no force-release/steal API.

import {
  writeFileSync, renameSync, readFileSync, existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isRepoRelativePath, pathsOverlap } from './queue.mjs';

export const LOCK_STATES = Object.freeze(['ACTIVE', 'RELEASED']);

const TASK_LOCK_FIELDS = new Set([
  'task_id', 'owner_token', 'reserved_paths', 'base_sha', 'head_sha',
  'acquired_at', 'updated_at', 'lock_state',
]);

const ACTIVE_SLOT_FIELDS = new Set([
  'task_id', 'owner_token', 'acquired_at', 'updated_at', 'lock_state',
]);

const LOCK_DIR_NAME = 'korixa-task-orchestrator-locks';
const ACTIVE_SLOT_FILE_NAME = 'active-task-slot.json';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isValidReservedPaths(v) {
  return Array.isArray(v) && v.length > 0 && v.every((p) => isNonEmptyString(p) && isRepoRelativePath(p));
}

// ---------------------------------------------------------------------------
// Deterministic paths -- same reasoning as checkpoint.mjs's
// resolveCheckpointPath: only a SHA-256 hash of the (repoRoot, taskId) pair
// ever touches the filesystem path, so an unusual task id can never
// influence directory structure.
// ---------------------------------------------------------------------------

export function resolveTaskLockDir({ repoRoot, tmpDirFn = tmpdir }) {
  const normalizedRoot = path.resolve(repoRoot).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const hash = createHash('sha256').update(normalizedRoot, 'utf8').digest('hex');
  return path.join(tmpDirFn(), LOCK_DIR_NAME, hash);
}

export function resolveTaskLockPath({ repoRoot, taskId, tmpDirFn = tmpdir }) {
  const dir = resolveTaskLockDir({ repoRoot, tmpDirFn });
  const idHash = createHash('sha256').update(String(taskId), 'utf8').digest('hex');
  return path.join(dir, `${idHash}.json`);
}

function resolveActiveSlotPath({ repoRoot, tmpDirFn = tmpdir }) {
  return path.join(resolveTaskLockDir({ repoRoot, tmpDirFn }), ACTIVE_SLOT_FILE_NAME);
}

// ---------------------------------------------------------------------------
// Generic atomic read/write, parameterized by a closed-schema validator --
// shared by both the per-task scope lock and the single active-task-slot
// record below (same trust properties, different field sets).
// ---------------------------------------------------------------------------

function readLockFile(filePath, validate) {
  if (!existsSync(filePath)) return { status: 'ABSENT' };
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { status: 'INVALID' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'INVALID' };
  }
  return validate(parsed) ? { status: 'VALID', record: parsed } : { status: 'INVALID' };
}

function writeLockFileAtomic(filePath, record, validate) {
  if (!validate(record)) {
    throw new Error('writeLockFileAtomic: record failed its own schema validator -- refusing to write a malformed lock');
  }
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
  return filePath;
}

// ---------------------------------------------------------------------------
// Per-task scope lock: TASK_ID, OWNER (opaque token), RESERVED_PATHS,
// BASE_SHA, HEAD_SHA, ACQUIRED_AT, LOCK_STATE (brief section 6).
// ---------------------------------------------------------------------------

export function validateTaskLock(lock) {
  if (lock === null || typeof lock !== 'object') return false;
  const keys = Object.keys(lock);
  if (keys.length !== TASK_LOCK_FIELDS.size) return false;
  if (!keys.every((k) => TASK_LOCK_FIELDS.has(k))) return false;
  if (!isNonEmptyString(lock.task_id)) return false;
  if (!isNonEmptyString(lock.owner_token)) return false;
  if (!isValidReservedPaths(lock.reserved_paths)) return false;
  if (!isNonEmptyString(lock.base_sha)) return false;
  if (typeof lock.head_sha !== 'string') return false;
  if (!isNonEmptyString(lock.acquired_at)) return false;
  if (!isNonEmptyString(lock.updated_at)) return false;
  if (!LOCK_STATES.includes(lock.lock_state)) return false;
  return true;
}

/**
 * List every ACTIVE per-task lock under this repoRoot, EXCLUDING excludeTaskId
 * if given. Fails closed on ambiguity: if ANY lock file on disk is present
 * but corrupt, this returns `{status:'RECOVERY_REQUIRED', corruptFiles}`
 * rather than silently skipping it -- a corrupt file could be hiding a real
 * active reservation, so its absence from the returned list must never be
 * read as proof no conflict exists.
 * @returns {{status:'OK', locks: object[]}|{status:'RECOVERY_REQUIRED', corruptFiles: string[]}}
 */
export function listActiveTaskLocks({ repoRoot, tmpDirFn = tmpdir, excludeTaskId = null }) {
  const dir = resolveTaskLockDir({ repoRoot, tmpDirFn });
  if (!existsSync(dir)) return { status: 'OK', locks: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== ACTIVE_SLOT_FILE_NAME && !f.startsWith('.'));
  const locks = [];
  const corruptFiles = [];
  for (const f of files) {
    const result = readLockFile(path.join(dir, f), validateTaskLock);
    if (result.status === 'INVALID') { corruptFiles.push(f); continue; }
    if (result.status === 'ABSENT') continue; // race: deleted between readdir and read -- not corruption
    if (result.record.lock_state !== 'ACTIVE') continue;
    if (excludeTaskId !== null && result.record.task_id === excludeTaskId) continue;
    locks.push(result.record);
  }
  if (corruptFiles.length > 0) return { status: 'RECOVERY_REQUIRED', corruptFiles };
  return { status: 'OK', locks };
}

/**
 * Acquire an ACTIVE scope lock for taskId. Fails closed on: malformed
 * input, an existing corrupt lock file for this task, a double-acquire
 * (existing ACTIVE lock for the same task), a runtime reservation conflict
 * (an overlapping path already held ACTIVE by a DIFFERENT task), or
 * uncertainty about any OTHER task's lock state (a corrupt sibling file).
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.taskId
 * @param {string[]} params.reservedPaths non-empty, repo-relative
 * @param {string} params.baseSha
 * @param {string} [params.headSha]
 * @param {string} [params.ownerToken] inject a pre-generated token (used by
 *   the orchestrator to share one token across the scope lock and the
 *   active-task slot); a fresh one is generated if omitted
 * @returns {{ok:true, lock:object, ownerToken:string}|{ok:false, reason:string, detail?:string}}
 */
export function acquireTaskLock({
  repoRoot, taskId, reservedPaths, baseSha, headSha = '', ownerToken, now, tmpDirFn = tmpdir, randomBytesFn = randomBytes,
}) {
  if (!isNonEmptyString(taskId)) return { ok: false, reason: 'MALFORMED_TASK_ID' };
  if (!isValidReservedPaths(reservedPaths)) return { ok: false, reason: 'MALFORMED_RESERVATION' };
  if (!isNonEmptyString(baseSha)) return { ok: false, reason: 'MALFORMED_BASE_SHA' };
  if (typeof headSha !== 'string') return { ok: false, reason: 'MALFORMED_HEAD_SHA' };

  const filePath = resolveTaskLockPath({ repoRoot, taskId, tmpDirFn });
  const existing = readLockFile(filePath, validateTaskLock);
  if (existing.status === 'INVALID') {
    return { ok: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED', detail: `existing lock file for task "${taskId}" is present but corrupt -- refusing to overwrite or infer state` };
  }
  if (existing.status === 'VALID' && existing.record.lock_state === 'ACTIVE') {
    return { ok: false, reason: 'DOUBLE_ACQUIRE', detail: `task "${taskId}" already has an ACTIVE lock` };
  }

  const others = listActiveTaskLocks({ repoRoot, tmpDirFn, excludeTaskId: taskId });
  if (others.status === 'RECOVERY_REQUIRED') {
    return { ok: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED', detail: 'one or more OTHER task lock files are corrupt -- cannot prove absence of a conflicting reservation', corruptFiles: others.corruptFiles };
  }
  for (const other of others.locks) {
    for (const p of reservedPaths) {
      for (const op of other.reserved_paths) {
        if (pathsOverlap(p, op)) {
          return {
            ok: false,
            reason: 'RUNTIME_RESERVATION_CONFLICT',
            detail: `path "${p}" overlaps task "${other.task_id}"'s active reservation "${op}"`,
            conflictingTaskId: other.task_id,
          };
        }
      }
    }
  }

  const timestamp = now ?? new Date().toISOString();
  const token = isNonEmptyString(ownerToken) ? ownerToken : randomBytesFn(32).toString('hex');
  const lock = {
    task_id: taskId,
    owner_token: token,
    reserved_paths: [...reservedPaths],
    base_sha: baseSha,
    head_sha: headSha,
    acquired_at: timestamp,
    updated_at: timestamp,
    lock_state: 'ACTIVE',
  };
  writeLockFileAtomic(filePath, lock, validateTaskLock);
  return { ok: true, lock, ownerToken: token };
}

/**
 * Release a scope lock. Requires an EXACT owner_token match -- wrong owner,
 * missing lock, non-ACTIVE lock, or a corrupt lock file are all denied,
 * never silently treated as "already released."
 */
export function releaseTaskLock({ repoRoot, taskId, ownerToken, now, tmpDirFn = tmpdir }) {
  if (!isNonEmptyString(taskId)) return { ok: false, reason: 'MALFORMED_TASK_ID' };
  if (!isNonEmptyString(ownerToken)) return { ok: false, reason: 'MALFORMED_OWNER_TOKEN' };
  const filePath = resolveTaskLockPath({ repoRoot, taskId, tmpDirFn });
  const existing = readLockFile(filePath, validateTaskLock);
  if (existing.status === 'ABSENT') return { ok: false, reason: 'NO_LOCK_FOUND' };
  if (existing.status === 'INVALID') return { ok: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED', detail: `lock file for task "${taskId}" is present but corrupt -- refusing to release or infer state` };
  const lock = existing.record;
  if (lock.lock_state !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE' };
  if (lock.owner_token !== ownerToken) return { ok: false, reason: 'WRONG_OWNER' };
  const timestamp = now ?? new Date().toISOString();
  const released = { ...lock, lock_state: 'RELEASED', updated_at: timestamp };
  writeLockFileAtomic(filePath, released, validateTaskLock);
  return { ok: true, lock: released };
}

/**
 * Verify (without mutating) that ownerToken is the current, live, ACTIVE
 * owner of taskId's scope lock. This is the TASK_OWNERSHIP_VALID gate the
 * orchestrator consults before every state-mutating operation.
 */
export function verifyTaskLockOwnership({ repoRoot, taskId, ownerToken, tmpDirFn = tmpdir }) {
  if (!isNonEmptyString(taskId) || !isNonEmptyString(ownerToken)) return { valid: false, reason: 'MALFORMED_INPUT' };
  const filePath = resolveTaskLockPath({ repoRoot, taskId, tmpDirFn });
  const existing = readLockFile(filePath, validateTaskLock);
  if (existing.status === 'ABSENT') return { valid: false, reason: 'NO_LOCK_FOUND' };
  if (existing.status === 'INVALID') return { valid: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED' };
  if (existing.record.lock_state !== 'ACTIVE') return { valid: false, reason: 'NOT_ACTIVE' };
  if (existing.record.owner_token !== ownerToken) return { valid: false, reason: 'WRONG_OWNER' };
  return { valid: true, lock: existing.record };
}

/**
 * Update the bound head_sha on an already-owned ACTIVE lock (called by the
 * orchestrator after A records a new HEAD). Still requires exact ownership
 * proof -- this is not a bypass of the release/acquire ownership rules.
 */
export function updateTaskLockHeadSha({ repoRoot, taskId, ownerToken, headSha, now, tmpDirFn = tmpdir }) {
  const check = verifyTaskLockOwnership({ repoRoot, taskId, ownerToken, tmpDirFn });
  if (!check.valid) return { ok: false, reason: check.reason };
  if (typeof headSha !== 'string' || headSha.length === 0) return { ok: false, reason: 'MALFORMED_HEAD_SHA' };
  const timestamp = now ?? new Date().toISOString();
  const updated = { ...check.lock, head_sha: headSha, updated_at: timestamp };
  writeLockFileAtomic(resolveTaskLockPath({ repoRoot, taskId, tmpDirFn }), updated, validateTaskLock);
  return { ok: true, lock: updated };
}

// ---------------------------------------------------------------------------
// Single global "active task slot" -- makes MAX_ACTIVE_TASK_EXECUTIONS_IN_
// CHAT = 1 a real, code-checked property (not only a procedural norm this
// session happens to follow): at most one task may hold this slot at a
// time, repoRoot-wide, regardless of whether its reserved paths overlap
// anything else. A second task's reservation attempt is denied while any
// other task holds it. Same trust properties as the per-task lock above
// (corrupt = HOLD_LOCK_RECOVERY_REQUIRED, exact-owner-token release only,
// no expiry/auto-steal).
// ---------------------------------------------------------------------------

function validateActiveSlot(record) {
  if (record === null || typeof record !== 'object') return false;
  const keys = Object.keys(record);
  if (keys.length !== ACTIVE_SLOT_FIELDS.size) return false;
  if (!keys.every((k) => ACTIVE_SLOT_FIELDS.has(k))) return false;
  if (!isNonEmptyString(record.task_id)) return false;
  if (!isNonEmptyString(record.owner_token)) return false;
  if (!isNonEmptyString(record.acquired_at)) return false;
  if (!isNonEmptyString(record.updated_at)) return false;
  if (!LOCK_STATES.includes(record.lock_state)) return false;
  return true;
}

export function acquireActiveTaskSlot({ repoRoot, taskId, ownerToken, now, tmpDirFn = tmpdir, randomBytesFn = randomBytes }) {
  if (!isNonEmptyString(taskId)) return { ok: false, reason: 'MALFORMED_TASK_ID' };
  const filePath = resolveActiveSlotPath({ repoRoot, tmpDirFn });
  const existing = readLockFile(filePath, validateActiveSlot);
  if (existing.status === 'INVALID') {
    return { ok: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED', detail: 'active-task-slot file is present but corrupt -- refusing to overwrite or infer state' };
  }
  if (existing.status === 'VALID' && existing.record.lock_state === 'ACTIVE' && existing.record.task_id !== taskId) {
    return { ok: false, reason: 'ACTIVE_TASK_SLOT_HELD', detail: `task "${existing.record.task_id}" currently holds the single active-task-execution slot in this chat` };
  }
  if (existing.status === 'VALID' && existing.record.lock_state === 'ACTIVE' && existing.record.task_id === taskId) {
    return { ok: false, reason: 'DOUBLE_ACQUIRE' };
  }
  const timestamp = now ?? new Date().toISOString();
  const token = isNonEmptyString(ownerToken) ? ownerToken : randomBytesFn(32).toString('hex');
  const record = { task_id: taskId, owner_token: token, acquired_at: timestamp, updated_at: timestamp, lock_state: 'ACTIVE' };
  writeLockFileAtomic(filePath, record, validateActiveSlot);
  return { ok: true, record, ownerToken: token };
}

export function releaseActiveTaskSlot({ repoRoot, taskId, ownerToken, now, tmpDirFn = tmpdir }) {
  if (!isNonEmptyString(taskId) || !isNonEmptyString(ownerToken)) return { ok: false, reason: 'MALFORMED_INPUT' };
  const filePath = resolveActiveSlotPath({ repoRoot, tmpDirFn });
  const existing = readLockFile(filePath, validateActiveSlot);
  if (existing.status === 'ABSENT') return { ok: false, reason: 'NO_LOCK_FOUND' };
  if (existing.status === 'INVALID') return { ok: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED' };
  const record = existing.record;
  if (record.lock_state !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE' };
  if (record.task_id !== taskId || record.owner_token !== ownerToken) return { ok: false, reason: 'WRONG_OWNER' };
  const timestamp = now ?? new Date().toISOString();
  const released = { ...record, lock_state: 'RELEASED', updated_at: timestamp };
  writeLockFileAtomic(filePath, released, validateActiveSlot);
  return { ok: true, record: released };
}

export function verifyActiveTaskSlotOwnership({ repoRoot, taskId, ownerToken, tmpDirFn = tmpdir }) {
  if (!isNonEmptyString(taskId) || !isNonEmptyString(ownerToken)) return { valid: false, reason: 'MALFORMED_INPUT' };
  const filePath = resolveActiveSlotPath({ repoRoot, tmpDirFn });
  const existing = readLockFile(filePath, validateActiveSlot);
  if (existing.status === 'ABSENT') return { valid: false, reason: 'NO_LOCK_FOUND' };
  if (existing.status === 'INVALID') return { valid: false, reason: 'HOLD_LOCK_RECOVERY_REQUIRED' };
  if (existing.record.lock_state !== 'ACTIVE') return { valid: false, reason: 'NOT_ACTIVE' };
  if (existing.record.task_id !== taskId || existing.record.owner_token !== ownerToken) return { valid: false, reason: 'WRONG_OWNER' };
  return { valid: true, record: existing.record };
}
