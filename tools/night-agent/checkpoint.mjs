// Korixa Night Agent — checkpoint module (NIGHT-V1-B).
//
// Atomic task-progress checkpointing: write-temp-then-rename, a fixed
// field set with no secret-bearing content, and a resume policy that
// refuses to assume a "RUNNING" checkpoint from a prior process is still
// alive — see resolveResumeState below (section 22).
//
// Node built-ins only.

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const CHECKPOINT_STATES = ['PENDING', 'RUNNING', 'VERIFYING', 'PASS', 'RETRY', 'HOLD'];

// The exact, closed field set a checkpoint may ever contain (section 21).
// No prompt text, no secret, no token, no raw stderr — anything not in
// this set is a validation failure, not silently dropped or passed through.
const ALLOWED_FIELDS = new Set([
  'task_id',
  'state',
  'attempt',
  'base_sha',
  'started_at',
  'updated_at',
  'last_progress_at',
  'last_error_family',
]);

/**
 * Build a fresh checkpoint object for a task about to start (or restart) an
 * attempt. Pure — does not touch the filesystem.
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.state one of CHECKPOINT_STATES
 * @param {number} params.attempt
 * @param {string} params.baseSha
 * @param {string} [params.now] ISO timestamp override, for deterministic tests
 * @returns {object}
 */
export function createCheckpoint({ taskId, state, attempt, baseSha, now }) {
  const timestamp = now ?? new Date().toISOString();
  return {
    task_id: taskId,
    state,
    attempt,
    base_sha: baseSha,
    started_at: timestamp,
    updated_at: timestamp,
    last_progress_at: timestamp,
    last_error_family: null,
  };
}

/**
 * Derive a new checkpoint reflecting a state transition, refreshing
 * `updated_at` (and `last_progress_at`, unless the transition itself is
 * not progress) without mutating the input. `errorFamily` must be a short,
 * fixed, generic identifier (e.g. "VERIFICATION_FAILED") — never a raw
 * error message, which could contain a path, a stderr fragment, or worse.
 * @param {object} checkpoint
 * @param {{state?: string, now?: string, isProgress?: boolean, errorFamily?: string|null}} changes
 * @returns {object}
 */
export function advanceCheckpoint(checkpoint, { state, now, isProgress = true, errorFamily = null } = {}) {
  const timestamp = now ?? new Date().toISOString();
  return {
    ...checkpoint,
    state: state ?? checkpoint.state,
    updated_at: timestamp,
    last_progress_at: isProgress ? timestamp : checkpoint.last_progress_at,
    last_error_family: errorFamily,
  };
}

/**
 * Validate a checkpoint's structural shape: exactly the allowed fields,
 * each of the correct type. Rejects anything else outright — a checkpoint
 * with an unexpected field (e.g. a stray "prompt" or "secret" key) fails
 * validation rather than being silently accepted with that field ignored.
 * @param {any} cp
 * @returns {boolean}
 */
export function validateCheckpoint(cp) {
  if (cp === null || typeof cp !== 'object') return false;
  const keys = Object.keys(cp);
  if (keys.length !== ALLOWED_FIELDS.size) return false;
  if (!keys.every((k) => ALLOWED_FIELDS.has(k))) return false;
  if (typeof cp.task_id !== 'string' || cp.task_id.length === 0) return false;
  if (!CHECKPOINT_STATES.includes(cp.state)) return false;
  if (!Number.isInteger(cp.attempt) || cp.attempt < 0) return false;
  if (typeof cp.base_sha !== 'string' || cp.base_sha.length === 0) return false;
  if (typeof cp.started_at !== 'string') return false;
  if (typeof cp.updated_at !== 'string') return false;
  if (typeof cp.last_progress_at !== 'string') return false;
  if (cp.last_error_family !== null && typeof cp.last_error_family !== 'string') return false;
  return true;
}

/**
 * Write a checkpoint atomically: serialize to a uniquely-named temp file in
 * the SAME directory as the target, then rename over the target.
 * `fs.renameSync` is atomic when source and destination share a filesystem
 * (true here by construction), so a reader can never observe a partially
 * written checkpoint.
 * @param {string} filePath
 * @param {object} checkpoint
 * @returns {string} filePath
 */
export function writeCheckpointAtomic(filePath, checkpoint) {
  if (!validateCheckpoint(checkpoint)) {
    throw new Error('writeCheckpointAtomic: checkpoint failed validateCheckpoint — refusing to write a malformed checkpoint');
  }
  const dir = path.dirname(filePath);
  // NIGHT-V1-D: the deterministic checkpoint directory (see
  // resolveCheckpointPath below) does not exist until the first real write
  // — creating it here, in the WRITE path only, keeps every READ path
  // (readCheckpoint, readCheckpointForResume) from ever creating a
  // directory or file as a side effect of a lookup.
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
  return filePath;
}

/**
 * Read and validate a checkpoint file. Returns null if the file is absent,
 * unreadable, not valid JSON, or fails `validateCheckpoint` — every one of
 * those cases is treated identically by the caller (no checkpoint to trust),
 * never as a partial/best-effort read.
 * @param {string} filePath
 * @returns {object|null}
 */
export function readCheckpoint(filePath) {
  if (!existsSync(filePath)) return null;
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateCheckpoint(parsed) ? parsed : null;
}

/**
 * Section 22's resume policy: a checkpoint is data about the PAST, never
 * proof about the PRESENT. In particular, a checkpoint claiming `RUNNING`
 * says nothing about whether that child process is still alive after a
 * runner restart — the runner has no in-memory reference to it anymore, so
 * "the same task, still running" can never be assumed. `hasControlledChildEvidence`
 * must come from the CURRENT process's own live state (e.g. a child handle
 * this exact invocation is holding), never reconstructed from the
 * checkpoint file itself.
 * @param {object|null} checkpoint
 * @param {{hasControlledChildEvidence: boolean}} params
 * @returns {{action: 'START_FRESH'|'HOLD_STALE_SESSION'|'ALREADY_PASSED'|'STAY_HOLD'|'RESUME', reason: string}}
 */
export function resolveResumeState(checkpoint, { hasControlledChildEvidence }) {
  if (checkpoint === null) {
    return { action: 'START_FRESH', reason: 'NO_CHECKPOINT: no valid prior checkpoint found' };
  }
  if (checkpoint.state === 'RUNNING' && !hasControlledChildEvidence) {
    return {
      action: 'HOLD_STALE_SESSION',
      reason: 'checkpoint claims RUNNING but no demonstrable controlled child process exists for this invocation — never assume a prior run is still active or that it silently finished',
    };
  }
  if (checkpoint.state === 'PASS') {
    return { action: 'ALREADY_PASSED', reason: 'checkpoint already reached PASS — nothing to resume' };
  }
  if (checkpoint.state === 'HOLD') {
    return { action: 'STAY_HOLD', reason: 'checkpoint is already HOLD — requires human input, not automatic resume' };
  }
  return { action: 'RESUME', reason: `resuming from checkpoint state ${checkpoint.state}` };
}

// ---------------------------------------------------------------------------
// NIGHT-V1-D: a deterministic, persistent, recoverable checkpoint path — so
// a real CLI invocation can find a PRIOR run's checkpoint after the process
// that wrote it has exited, without any in-memory dependency injection.
// ---------------------------------------------------------------------------

const CHECKPOINT_DIR_NAME = 'korixa-night-agent-checkpoints';

/**
 * Resolve the deterministic, stable path a checkpoint for this exact
 * (repoRoot, taskId) pair always lives at — same repoRoot/task -> same
 * path, a different task or a different repo -> a different path. Pure
 * string computation: no filesystem access, so calling this alone (a
 * "read"/lookup) never creates a directory or file — only
 * `writeCheckpointAtomic` (above) does, and only at the moment of an actual
 * write. The path itself never embeds a task-controlled string directly
 * (only a SHA-256 hash of it) so a task id containing unusual characters
 * can never influence the checkpoint directory's structure.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.taskId
 * @param {() => string} [params.tmpDirFn]
 * @returns {string}
 */
export function resolveCheckpointPath({ repoRoot, taskId, tmpDirFn = tmpdir }) {
  const normalizedRoot = path.resolve(repoRoot).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const key = `${normalizedRoot}::${taskId}`;
  const hash = createHash('sha256').update(key, 'utf8').digest('hex');
  return path.join(tmpDirFn(), CHECKPOINT_DIR_NAME, `${hash}.json`);
}

/**
 * Read a checkpoint file for the purpose of a resume/recovery decision,
 * distinguishing "no checkpoint at all" from "a checkpoint file exists but
 * is corrupt/invalid" — `readCheckpoint` above deliberately collapses both
 * to `null` (fine for its own simpler callers), but section 9's recovery
 * policy needs to tell them apart: absence means "safe to start fresh,"
 * while a present-but-invalid file must never be silently treated the same
 * way. Pure read — `existsSyncFn` is checked before any read attempt, so a
 * missing file never even reaches `readFileSyncFn`.
 * @param {string} filePath
 * @param {{existsSyncFn?: typeof existsSync, readFileSyncFn?: typeof readFileSync}} [params]
 * @returns {{status: 'ABSENT'} | {status: 'INVALID'} | {status: 'VALID', checkpoint: object}}
 */
export function readCheckpointForResume(filePath, { existsSyncFn = existsSync, readFileSyncFn = readFileSync } = {}) {
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
  if (!validateCheckpoint(parsed)) return { status: 'INVALID' };
  return { status: 'VALID', checkpoint: parsed };
}

/**
 * NIGHT-V1-D section 9's full recovery policy, built on top of
 * `readCheckpointForResume`'s three-way result and the FROZEN existing
 * `attempt`/`max_retries` semantics already demonstrated by this file's own
 * pre-existing test ("a checkpoint sequence hitting max_retries transitions
 * to HOLD"): `attempt` counts how many RETRY transitions have already
 * happened (0 for a checkpoint that has never yet been retried); a RETRY
 * checkpoint's `attempt` field is written as the count AFTER that
 * transition, and remains the correct number to reuse, unchanged, for the
 * next actual attempt (the increment already happened when the RETRY
 * checkpoint was written — resuming does not increment again). A retry is
 * permitted only while `checkpoint.attempt < maxRetries`; once
 * `attempt >= maxRetries`, no further attempt is permitted, matching the
 * pre-existing test exactly (this function does not reinterpret that
 * semantics, only makes it reusable across a process restart).
 *
 * `RUNNING`, `VERIFYING`, and `PENDING` are all treated identically
 * (`HOLD_STALE_SESSION`): each represents a prior attempt that was
 * interrupted mid-flight with no live evidence in THIS invocation that it
 * is still progressing, so none of them may ever be silently resumed or
 * assumed finished — the same conservative reasoning `resolveResumeState`
 * already applies to `RUNNING` alone, extended here to the two other
 * "in-progress" states this newer flow can also leave behind.
 * @param {object} params
 * @param {{status: 'ABSENT'} | {status: 'INVALID'} | {status: 'VALID', checkpoint: object}} params.readResult
 * @param {number} params.maxRetries
 * @returns {{decision: 'START_FRESH'|'RESUME_RETRY'|'HOLD_STALE_SESSION'|'HOLD_ALREADY_COMPLETED'|'HOLD_EXISTING_HOLD'|'HOLD_RETRY_EXHAUSTED'|'HOLD_INVALID_CHECKPOINT', nextAttempt: number|null}}
 */
export function resolveCheckpointRecoveryDecision({ readResult, maxRetries }) {
  if (readResult.status === 'ABSENT') {
    return { decision: 'START_FRESH', nextAttempt: 0 };
  }
  if (readResult.status === 'INVALID') {
    return { decision: 'HOLD_INVALID_CHECKPOINT', nextAttempt: null };
  }

  const cp = readResult.checkpoint;
  if (cp.state === 'RUNNING' || cp.state === 'VERIFYING' || cp.state === 'PENDING') {
    return { decision: 'HOLD_STALE_SESSION', nextAttempt: null };
  }
  if (cp.state === 'PASS') {
    return { decision: 'HOLD_ALREADY_COMPLETED', nextAttempt: null };
  }
  if (cp.state === 'HOLD') {
    return { decision: 'HOLD_EXISTING_HOLD', nextAttempt: null };
  }
  if (cp.state === 'RETRY') {
    if (cp.attempt >= maxRetries) {
      return { decision: 'HOLD_RETRY_EXHAUSTED', nextAttempt: null };
    }
    return { decision: 'RESUME_RETRY', nextAttempt: cp.attempt };
  }

  // Unreachable given CHECKPOINT_STATES' closed set plus validateCheckpoint
  // already having accepted this checkpoint — fail closed defensively
  // rather than falling through to an implicit allow.
  return { decision: 'HOLD_INVALID_CHECKPOINT', nextAttempt: null };
}
