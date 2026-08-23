// Korixa — Common Agent Protocol (Task 2, 2026-08-23): shared-state module.
//
// Formalizes, as a closed-schema, atomically-persisted record, the same
// discipline this repository's own recent history (PR #73's three
// independent audit rounds, PR #74's Night->A->B->C sequence) already
// followed BY HAND, in a single chat, across explicit role switches. This
// module is the persistence layer only; `role-protocol.mjs` is the
// decision/enforcement layer built on top of it.
//
// Deliberately modeled on `checkpoint.mjs`'s own proven pattern (atomic
// write-then-rename, closed field set rejecting anything unexpected,
// deterministic hash-derived path OUTSIDE the repo, a read path that never
// throws and never treats a corrupt/absent file as anything other than "no
// trusted state") rather than reimplementing it differently. Node built-ins
// only.

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Closed vocabularies.
// ---------------------------------------------------------------------------

// Matches queue.mjs's own (private, unexported) VALID_RISKS by convention.
// Deliberately NOT imported from queue.mjs -- reusing a 3-value enum is not
// worth adding a new export surface to an already-audited Task 1 module for.
export const RISK_CLASSES = Object.freeze(['GREEN', 'YELLOW', 'RED']);

export const ROLES = Object.freeze(['NIGHT', 'A', 'B', 'C']);

// The finite state model named explicitly in Task 2's own brief.
export const PROTOCOL_STATES = Object.freeze([
  'IDLE',
  'PLANNING',
  'READY_FOR_A',
  'EXECUTING',
  'WAITING_CI',
  'READY_FOR_B',
  'AUDITING',
  'HOLD',
  'REMEDIATING',
  'READY_FOR_C',
  'VALIDATING',
  'READY_FOR_HUMAN',
  'DONE',
]);

export const HUMAN_GATE_TYPES = Object.freeze([
  'MARK_READY',
  'MERGE',
  'PRODUCTION_ACTION',
  'IAM_OR_SECRET_ACTION',
  'DESTRUCTIVE_ACTION',
  'UNKNOWN_COMMAND_CLASS',
]);

// The exact, closed field set a shared-state record may ever contain — an
// unexpected field (e.g. a stray "prompt" or a raw log dump) is a validation
// failure, never silently accepted, exactly like checkpoint.mjs's own
// ALLOWED_FIELDS. EVIDENCE/FINDINGS are arrays of small reference objects
// (claimId/summary/sourceRef shaped) -- never raw command output or full
// logs; see role-protocol.mjs's evidence contract for the shape those
// entries must have.
const ALLOWED_FIELDS = new Set([
  'task_id',
  'task_title',
  'active_role',
  'previous_role',
  'next_allowed_role',
  'state',
  'base_sha',
  'head_sha',
  'previous_head_sha',
  'branch',
  'pr_number',
  'scope',
  'files_reserved',
  'files_changed',
  'risk_class',
  'production_impact',
  'executor',
  'auditor',
  'validator',
  'executor_result',
  'auditor_result',
  'validator_result',
  'evidence',
  'findings',
  'ci_run',
  'ci_head_sha',
  'ci_status',
  'head_drift',
  'base_drift',
  'human_gate_required',
  'human_gate_type',
  'next_action',
  'updated_at',
]);

/**
 * Build a fresh protocol-state record for a new Task 2-style task. Pure --
 * does not touch the filesystem.
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.taskTitle
 * @param {string} params.baseSha
 * @param {string} [params.branch]
 * @param {number|null} [params.prNumber]
 * @param {string[]} [params.filesReserved]
 * @param {string} [params.riskClass] one of RISK_CLASSES, default 'GREEN'
 * @param {string} [params.now] ISO timestamp override, for deterministic tests
 * @returns {object}
 */
export function createProtocolState({
  taskId, taskTitle, baseSha, branch = null, prNumber = null, filesReserved = [], riskClass = 'GREEN', now,
}) {
  const timestamp = now ?? new Date().toISOString();
  return Object.freeze({
    task_id: taskId,
    task_title: taskTitle,
    active_role: 'NIGHT',
    previous_role: null,
    next_allowed_role: 'A',
    state: 'IDLE',
    base_sha: baseSha,
    head_sha: baseSha,
    previous_head_sha: null,
    branch,
    pr_number: prNumber,
    scope: Object.freeze([...filesReserved]),
    files_reserved: Object.freeze([...filesReserved]),
    files_changed: Object.freeze([]),
    risk_class: RISK_CLASSES.includes(riskClass) ? riskClass : 'GREEN',
    production_impact: false,
    executor: null,
    auditor: null,
    validator: null,
    executor_result: null,
    auditor_result: null,
    validator_result: null,
    evidence: Object.freeze([]),
    findings: Object.freeze([]),
    ci_run: null,
    ci_head_sha: null,
    ci_status: null,
    head_drift: false,
    base_drift: false,
    human_gate_required: false,
    human_gate_type: null,
    next_action: null,
    updated_at: timestamp,
  });
}

/**
 * Validate a protocol-state record's structural shape: exactly the allowed
 * fields, each of a plausible type. Rejects anything else outright.
 * @param {any} s
 * @returns {boolean}
 */
export function validateProtocolState(s) {
  if (s === null || typeof s !== 'object') return false;
  const keys = Object.keys(s);
  if (keys.length !== ALLOWED_FIELDS.size) return false;
  if (!keys.every((k) => ALLOWED_FIELDS.has(k))) return false;
  if (typeof s.task_id !== 'string' || s.task_id.length === 0) return false;
  if (!ROLES.includes(s.active_role)) return false;
  if (s.previous_role !== null && !ROLES.includes(s.previous_role)) return false;
  if (s.next_allowed_role !== null && !ROLES.includes(s.next_allowed_role)) return false;
  if (!PROTOCOL_STATES.includes(s.state)) return false;
  if (typeof s.base_sha !== 'string' || s.base_sha.length === 0) return false;
  if (typeof s.head_sha !== 'string' || s.head_sha.length === 0) return false;
  if (!Array.isArray(s.files_reserved) || !Array.isArray(s.files_changed) || !Array.isArray(s.scope)) return false;
  if (!RISK_CLASSES.includes(s.risk_class)) return false;
  if (typeof s.production_impact !== 'boolean') return false;
  if (!Array.isArray(s.evidence) || !Array.isArray(s.findings)) return false;
  if (typeof s.head_drift !== 'boolean' || typeof s.base_drift !== 'boolean') return false;
  if (typeof s.human_gate_required !== 'boolean') return false;
  if (s.human_gate_type !== null && !HUMAN_GATE_TYPES.includes(s.human_gate_type)) return false;
  if (typeof s.updated_at !== 'string') return false;
  return true;
}

/**
 * Derive a new state reflecting a transition, without mutating the input.
 * Pure -- callers decide WHETHER a transition is allowed (role-protocol.mjs);
 * this only computes the resulting record shape once a transition has
 * already been approved.
 * @param {object} state
 * @param {object} changes any subset of the closed field set, using the
 *   same lower_snake_case keys as the record itself
 * @param {string} [now]
 * @returns {object}
 */
export function advanceProtocolState(state, changes, now) {
  const timestamp = now ?? new Date().toISOString();
  const next = { ...state, ...changes, updated_at: timestamp };
  if (!validateProtocolState(next)) {
    throw new Error('advanceProtocolState: resulting state failed validateProtocolState -- refusing to produce a malformed record');
  }
  return Object.freeze(next);
}

// ---------------------------------------------------------------------------
// Atomic persistence -- identical pattern to checkpoint.mjs's own
// writeCheckpointAtomic/readCheckpoint: temp-file-then-rename in the same
// directory, deterministic hash-derived path OUTSIDE the repository, a read
// path that never throws and treats absent/corrupt/invalid identically as
// "no trusted state to resume from."
// ---------------------------------------------------------------------------

const PROTOCOL_STATE_DIR_NAME = 'korixa-common-agent-protocol-state';

/**
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.taskId
 * @param {() => string} [params.tmpDirFn]
 * @returns {string}
 */
export function resolveProtocolStatePath({ repoRoot, taskId, tmpDirFn = tmpdir }) {
  const hash = createHash('sha256').update(`${repoRoot}::${taskId}`).digest('hex');
  return path.join(tmpDirFn(), PROTOCOL_STATE_DIR_NAME, `${hash}.json`);
}

/**
 * @param {string} filePath
 * @param {object} state
 * @returns {string} filePath
 */
export function writeProtocolStateAtomic(filePath, state) {
  if (!validateProtocolState(state)) {
    throw new Error('writeProtocolStateAtomic: state failed validateProtocolState -- refusing to write a malformed record');
  }
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
  return filePath;
}

/**
 * @param {string} filePath
 * @returns {object|null}
 */
export function readProtocolState(filePath) {
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
  return validateProtocolState(parsed) ? parsed : null;
}
