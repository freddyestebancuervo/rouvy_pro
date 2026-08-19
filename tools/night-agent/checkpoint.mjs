// Korixa Night Agent — checkpoint module (NIGHT-V1-B).
//
// Atomic task-progress checkpointing: write-temp-then-rename, a fixed
// field set with no secret-bearing content, and a resume policy that
// refuses to assume a "RUNNING" checkpoint from a prior process is still
// alive — see resolveResumeState below (section 22).
//
// Node built-ins only.

import { writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs';
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
