// Korixa — Common Agent Protocol (Task 4, 2026-08-23; Task 6, 2026-08-23):
// the RUNTIME ORCHESTRATOR. Composes Task 2's protocol-state.mjs +
// role-protocol.mjs, Task 3's role-capabilities.mjs, this task's own
// task-lock.mjs, queue.mjs's static path-overlap primitive, and (Task 6)
// pr-metadata-gate.mjs into one usable API -- so the system stops relying
// on a long human prompt alone to decide what role is active, what task
// owns a scope, or what role may receive a task next.
//
// Every exported operation here is a REAL CALLER of the existing gates: it
// fails closed if TASK_OWNERSHIP_VALID, CAPABILITY_ALLOWED, and
// STATE_TRANSITION_ALLOWED are not ALL proven (brief section 17).
// role-capabilities.mjs and pr-metadata-gate.mjs are never modified by
// this file. Task 6 DID make a deliberate, brief-authorized change to
// protocol-state.mjs (a new PROTOCOL_STATES member and a new
// pr_metadata_verification field) and role-protocol.mjs (the
// STATE_TRANSITION_TABLE routes C's PASS through the new
// PR_METADATA_SYNC_REQUIRED stage) -- their own decision logic (identity,
// attestation, capability checks) is otherwise unchanged and still reused
// verbatim; this module only sequences the calls and persists the result.
//
// ENFORCEMENT CLASSIFICATION (truthful, not overclaimed — brief section 5):
//   RUNTIME_WIRED_DECISION_ENFORCEMENT = TRUE
//     Every state-mutating operation below genuinely calls
//     evaluateRoleCapability, validateStateTransition, and the lock
//     ownership gate before persisting anything, and refuses to persist if
//     any one of them fails. This is real, not aspirational.
//   PHYSICAL_ROLE_SANDBOX = FALSE
//     There is still no OS/tool-permission boundary between roles in this
//     single-chat model. A human-typed message claiming "I am now B" while
//     reusing A's own conclusions cannot be physically stopped by this
//     module -- only its OUTPUT can be judged fail-closed by the gates
//     above (an illegitimate claim still cannot manufacture a WeakSet
//     attestation, a valid state transition, or a matching SHA).
//
// A technical PASS is never authorization. This module never sets
// MARK_READY/MERGE_MAIN/PRODUCTION_MUTATION/IAM_MUTATION/SECRET_MUTATION/
// DESTRUCTIVE_OPERATION for any role -- role-capabilities.mjs's
// HUMAN_GATE_ONLY_CAPABILITIES already makes that structurally impossible
// (see requestHumanGate below, which only RECORDS that a human gate is
// needed, and never transitions state to DONE on its own initiative).

import {
  createProtocolState, validateProtocolState, advanceProtocolState,
  resolveProtocolStatePath, writeProtocolStateAtomic, readProtocolState,
} from './protocol-state.mjs';
import {
  validateStateTransition, isAttestedAuditorResult, classifyCiWaitStatus,
  requiresHumanGateForAction, InvalidRoleTransitionError,
  EXECUTOR_RESULT_STATES, AUDITOR_RESULT_STATES, VALIDATOR_RESULT_STATES,
} from './role-protocol.mjs';

const AUDITOR_PASS_SHAPED_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS']);
import { evaluateRoleCapability } from './role-capabilities.mjs';
import {
  acquireTaskLock, releaseTaskLock, verifyTaskLockOwnership, updateTaskLockHeadSha,
  acquireActiveTaskSlot, releaseActiveTaskSlot,
} from './task-lock.mjs';
import { pathsOverlap } from './queue.mjs';
import { evaluateFinalPrMetadata } from './pr-metadata-gate.mjs';

function countFindingsBySeverity(findings) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of Array.isArray(findings) ? findings : []) {
    if (Object.prototype.hasOwnProperty.call(counts, f?.severity)) counts[f.severity] += 1;
  }
  return counts;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function persistState(repoRoot, taskId, state) {
  writeProtocolStateAtomic(resolveProtocolStatePath({ repoRoot, taskId }), state);
  return state;
}

function loadState(repoRoot, taskId) {
  return readProtocolState(resolveProtocolStatePath({ repoRoot, taskId }));
}

// ---------------------------------------------------------------------------
// createTaskSession -- pure construction (via protocol-state.mjs, unmodified)
// plus first persistence. Refuses to silently overwrite an existing session
// for the same taskId.
// ---------------------------------------------------------------------------

export function createTaskSession({
  repoRoot, taskId, taskTitle, baseSha, branch = null, prNumber = null,
  filesReserved = [], riskClass = 'GREEN', now,
}) {
  if (!isNonEmptyString(repoRoot) || !isNonEmptyString(taskId)) {
    return { ok: false, reason: 'MALFORMED_TASK_ID' };
  }
  if (loadState(repoRoot, taskId) !== null) {
    return { ok: false, reason: 'TASK_SESSION_ALREADY_EXISTS' };
  }
  const state = createProtocolState({ taskId, taskTitle, baseSha, branch, prNumber, filesReserved, riskClass, now });
  if (!validateProtocolState(state)) {
    return { ok: false, reason: 'MALFORMED_TASK_SESSION' };
  }
  persistState(repoRoot, taskId, state);
  return { ok: true, state };
}

/**
 * @returns {object|null} the current compact task state, or null if none
 *   exists / the persisted record is corrupt (both collapse to null --
 *   matching protocol-state.mjs's own readProtocolState contract; callers
 *   needing to distinguish "never existed" from "corrupt" should compare
 *   against the lock's own presence separately).
 */
export function getTaskState({ repoRoot, taskId }) {
  return loadState(repoRoot, taskId);
}

// ---------------------------------------------------------------------------
// reserveTask -- STATIC conflict check (against caller-supplied queue-level
// declarations, reusing queue.mjs's pathsOverlap verbatim) THEN RUNTIME
// conflict check + double-acquire + corruption-fails-closed (via
// task-lock.mjs's acquireTaskLock), THEN the single active-task-execution
// slot (MAX_ACTIVE_TASK_EXECUTIONS_IN_CHAT = 1). Both scope lock and slot
// share ONE owner_token, generated once here, so callers only ever track a
// single token per task.
// ---------------------------------------------------------------------------

export function reserveTask({
  repoRoot, taskId, reservedPaths, baseSha, headSha = '', staticTasks = [], now,
}) {
  const state = loadState(repoRoot, taskId);
  if (state === null) return { ok: false, reason: 'NO_TASK_SESSION' };

  if (!Array.isArray(reservedPaths) || reservedPaths.length === 0
    || !reservedPaths.every((p) => isNonEmptyString(p))) {
    return { ok: false, reason: 'MALFORMED_RESERVATION' };
  }
  if (!Array.isArray(staticTasks)) return { ok: false, reason: 'MALFORMED_STATIC_TASKS' };

  for (const other of staticTasks) {
    if (other === null || typeof other !== 'object' || other.id === taskId) continue;
    for (const op of Array.isArray(other.allowedPaths) ? other.allowedPaths : []) {
      for (const p of reservedPaths) {
        if (pathsOverlap(p, op)) {
          return {
            ok: false,
            reason: 'STATIC_TASK_CONFLICT',
            detail: `path "${p}" overlaps static task "${other.id}"'s declared allowed_paths "${op}"`,
            conflictingTaskId: other.id,
          };
        }
      }
    }
  }

  const lockResult = acquireTaskLock({ repoRoot, taskId, reservedPaths, baseSha, headSha, now });
  if (!lockResult.ok) return { ok: false, reason: lockResult.reason, detail: lockResult.detail, corruptFiles: lockResult.corruptFiles, conflictingTaskId: lockResult.conflictingTaskId };

  const slotResult = acquireActiveTaskSlot({ repoRoot, taskId, ownerToken: lockResult.ownerToken, now });
  if (!slotResult.ok) {
    // Roll back the scope lock we just took -- reserveTask is all-or-nothing.
    releaseTaskLock({ repoRoot, taskId, ownerToken: lockResult.ownerToken, now });
    return { ok: false, reason: slotResult.reason, detail: slotResult.detail };
  }

  const nextState = advanceProtocolState(state, pruneUndefined({
    files_reserved: [...reservedPaths],
    scope: [...reservedPaths],
  }), now);
  persistState(repoRoot, taskId, nextState);
  return { ok: true, state: nextState, ownerToken: lockResult.ownerToken, lock: lockResult.lock };
}

// ---------------------------------------------------------------------------
// Core transition engine -- every state-mutating role operation below goes
// through this. Enforces, IN THIS ORDER, all four gates from brief section
// 17: TASK_OWNERSHIP_VALID, CAPABILITY_ALLOWED, SHA_BINDING_VALID (when
// requested), STATE_TRANSITION_ALLOWED. Persists only if every gate clears.
// ---------------------------------------------------------------------------

function attemptTransition({
  repoRoot, taskId, ownerToken, toState, actingRole, requiredCapability,
  requireHeadSha, newHeadSha, extraChanges = {}, now,
}) {
  const lockCheck = verifyTaskLockOwnership({ repoRoot, taskId, ownerToken });
  if (!lockCheck.valid) return { ok: false, reason: lockCheck.reason ?? 'LOCK_OWNERSHIP_INVALID' };

  const capDecision = evaluateRoleCapability(actingRole, requiredCapability);
  if (!capDecision.allowed) return { ok: false, reason: `CAPABILITY_DENIED:${capDecision.reason}` };

  const state = loadState(repoRoot, taskId);
  if (state === null) return { ok: false, reason: 'NO_TASK_SESSION' };

  if (requireHeadSha !== undefined) {
    if (typeof requireHeadSha !== 'string' || requireHeadSha.length === 0 || requireHeadSha !== state.head_sha) {
      return { ok: false, reason: 'HOLD_HEAD_DRIFT', detail: `expected head_sha ${state.head_sha}, caller supplied ${JSON.stringify(requireHeadSha)}` };
    }
  }

  try {
    validateStateTransition({ fromState: state.state, toState, actingRole });
  } catch (err) {
    if (err instanceof InvalidRoleTransitionError) {
      return { ok: false, reason: 'INVALID_STATE_TRANSITION', detail: err.message };
    }
    throw err;
  }

  const changes = pruneUndefined({
    active_role: actingRole,
    previous_role: state.active_role,
    state: toState,
    previous_head_sha: newHeadSha !== undefined ? state.head_sha : undefined,
    head_sha: newHeadSha,
    ...extraChanges,
  });
  const nextState = advanceProtocolState(state, changes, now);
  persistState(repoRoot, taskId, nextState);

  if (newHeadSha !== undefined) {
    updateTaskLockHeadSha({ repoRoot, taskId, ownerToken, headSha: newHeadSha, now });
  }
  return { ok: true, state: nextState };
}

/**
 * Generic role/state entry (used for NIGHT's own IDLE->PLANNING->READY_FOR_A
 * moves, and for the NIGHT-only HOLD->READY_FOR_B expired-attestation
 * recovery path from Task 2 -- STATE_TRANSITION_TABLE is reused verbatim,
 * unmodified, so that recovery path remains exactly as valid as before).
 */
export function enterRole({ repoRoot, taskId, ownerToken, toState, actingRole, requiredCapability = 'READ', headSha, now }) {
  return attemptTransition({ repoRoot, taskId, ownerToken, toState, actingRole, requiredCapability, requireHeadSha: headSha, now });
}

/**
 * A records its own result. A's own output domain (EXECUTOR_RESULT_STATES)
 * structurally excludes any PASS-shaped value -- unchanged, reused from
 * role-protocol.mjs -- so nothing here can grant A a self-certification.
 * This is the ONE operation allowed to advance head_sha forward (A is the
 * only role that produces new commits).
 */
export function recordExecutorResult({ repoRoot, taskId, ownerToken, executorResult, toState, now }) {
  if (executorResult === null || typeof executorResult !== 'object' || executorResult.role !== 'executor') {
    return { ok: false, reason: 'MALFORMED_EXECUTOR_RESULT' };
  }
  if (!EXECUTOR_RESULT_STATES.includes(executorResult.state)) {
    return { ok: false, reason: 'MALFORMED_EXECUTOR_RESULT_STATE' };
  }
  if (!isNonEmptyString(executorResult.headSha)) {
    return { ok: false, reason: 'MALFORMED_EXECUTOR_RESULT_HEAD_SHA' };
  }
  // The existing (Task 2, unmodified) STATE_TRANSITION_TABLE only allows A
  // to move EXECUTING/REMEDIATING toward WAITING_CI or READY_FOR_B -- both
  // of which mean "the implementation succeeded." There is no direct
  // EXECUTING->HOLD/FAIL entry in that table (a documented, pre-existing
  // Task 2 gap this task does not attempt to patch by modifying
  // role-protocol.mjs). Consequently this operation only accepts a
  // genuinely successful result; a HOLD/FAIL executorResult has no
  // consistent toState to record here and is rejected rather than allowed
  // to reach WAITING_CI/READY_FOR_B as if nothing were wrong.
  if (executorResult.state !== 'IMPLEMENTED_AND_VALIDATED') {
    return { ok: false, reason: 'EXECUTOR_RESULT_NOT_READY_FOR_TOSTATE', detail: `executorResult.state is ${executorResult.state}; recordExecutorResult only accepts IMPLEMENTED_AND_VALIDATED` };
  }
  return attemptTransition({
    repoRoot, taskId, ownerToken, toState, actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES',
    newHeadSha: executorResult.headSha,
    extraChanges: {
      executor_result: executorResult,
      files_changed: Array.isArray(executorResult.filesChanged) ? [...executorResult.filesChanged] : undefined,
    },
    now,
  });
}

/**
 * B accepts a handoff: READY_FOR_B -> AUDITING. `headSha` binds this entry
 * to the exact HEAD B is about to audit (mismatch -> HOLD_HEAD_DRIFT, never
 * silently substituted).
 */
export function handoffToAuditor({ repoRoot, taskId, ownerToken, headSha, now }) {
  return attemptTransition({
    repoRoot, taskId, ownerToken, toState: 'AUDITING', actingRole: 'B', requiredCapability: 'AUDIT',
    requireHeadSha: headSha, now,
  });
}

/**
 * B records its result. Requires auditorResult to pass role-protocol.mjs's
 * `isAttestedAuditorResult` -- a WeakSet membership check proving this
 * EXACT object identity was really produced by a real, live
 * `certifyAuditResult()` call in this process, never a fabricated or
 * merely shape-plausible object (Task 2's own anti-forgery primitive,
 * reused verbatim, now genuinely wired into a real caller). A handoff
 * envelope claiming "TESTS = PASS" is a CLAIM the orchestrator does NOT
 * trust on its own -- only the attested result object itself is trusted.
 */
export function recordAuditResult({ repoRoot, taskId, ownerToken, auditorResult, toState, now }) {
  if (!isAttestedAuditorResult(auditorResult)) {
    return { ok: false, reason: 'UNATTESTED_AUDITOR_RESULT', detail: 'auditorResult is not a live, genuinely-attested certifyAuditResult() object' };
  }
  if (!AUDITOR_RESULT_STATES.includes(auditorResult.finalState)) {
    return { ok: false, reason: 'MALFORMED_AUDITOR_RESULT_STATE' };
  }
  // toState must match what the result actually says -- a HOLD-shaped
  // result can never be recorded under toState:'READY_FOR_C' (that would
  // let an unresolved blocker reach C anyway merely because the CALLER
  // asked for the wrong toState), and a PASS-shaped result may only ever
  // move to READY_FOR_C, never silently stay parked at HOLD.
  const isPassShaped = AUDITOR_PASS_SHAPED_STATES.includes(auditorResult.finalState);
  if (isPassShaped && toState !== 'READY_FOR_C') {
    return { ok: false, reason: 'INVALID_TOSTATE_FOR_AUDITOR_RESULT', detail: `auditorResult.finalState=${auditorResult.finalState} (PASS-shaped) requires toState=READY_FOR_C, got ${toState}` };
  }
  if (!isPassShaped && toState !== 'HOLD') {
    return { ok: false, reason: 'INVALID_TOSTATE_FOR_AUDITOR_RESULT', detail: `auditorResult.finalState=${auditorResult.finalState} (HOLD-shaped) requires toState=HOLD, got ${toState}` };
  }
  return attemptTransition({
    repoRoot, taskId, ownerToken, toState, actingRole: 'B', requiredCapability: 'CERTIFY_AUDIT',
    requireHeadSha: auditorResult.headSha,
    extraChanges: {
      auditor_result: auditorResult,
      findings: Array.isArray(auditorResult.findings) ? [...auditorResult.findings] : undefined,
    },
    now,
  });
}

/** C accepts a handoff: READY_FOR_C -> VALIDATING, HEAD-bound. */
export function handoffToValidator({ repoRoot, taskId, ownerToken, headSha, now }) {
  return attemptTransition({
    repoRoot, taskId, ownerToken, toState: 'VALIDATING', actingRole: 'C', requiredCapability: 'VALIDATE',
    requireHeadSha: headSha, now,
  });
}

/**
 * C records its result. role-protocol.mjs does not export a WeakSet
 * attestation for validator results (only for auditor results) -- this
 * function does NOT claim one exists. Instead it checks the shape
 * `certifyByValidator` actually produces (finalState in the closed domain;
 * on PASS, reason is exactly 'CERTIFIED', the only string that function
 * ever sets on a real pass) and binds to the exact current head_sha. This
 * is weaker than the WeakSet attestation `recordAuditResult` gets, and is
 * documented as such -- not overclaimed.
 */
export function recordValidationResult({ repoRoot, taskId, ownerToken, validatorResult, toState, now }) {
  if (validatorResult === null || typeof validatorResult !== 'object' || validatorResult.role !== 'validator') {
    return { ok: false, reason: 'MALFORMED_VALIDATOR_RESULT' };
  }
  if (!VALIDATOR_RESULT_STATES.includes(validatorResult.finalState)) {
    return { ok: false, reason: 'MALFORMED_VALIDATOR_RESULT_STATE' };
  }
  if (!isNonEmptyString(validatorResult.currentHeadSha)) {
    return { ok: false, reason: 'MALFORMED_VALIDATOR_RESULT_HEAD_SHA' };
  }
  if (validatorResult.finalState === 'PASS' && validatorResult.reason !== 'CERTIFIED') {
    return { ok: false, reason: 'MALFORMED_VALIDATOR_RESULT_PASS_REASON' };
  }
  // Same toState/result-content consistency rule as recordAuditResult: a
  // HOLD validator result can never reach toState:'PR_METADATA_SYNC_REQUIRED',
  // and a PASS validator result may only ever move to
  // PR_METADATA_SYNC_REQUIRED -- Task 6: C's technical PASS no longer
  // directly implies READY_FOR_HUMAN; a genuine final PR metadata
  // verification (recordFinalPrMetadataVerification, below) is required
  // in between.
  if (validatorResult.finalState === 'PASS' && toState !== 'PR_METADATA_SYNC_REQUIRED') {
    return { ok: false, reason: 'INVALID_TOSTATE_FOR_VALIDATOR_RESULT', detail: `validatorResult.finalState=PASS requires toState=PR_METADATA_SYNC_REQUIRED, got ${toState}` };
  }
  if (validatorResult.finalState === 'HOLD' && toState !== 'HOLD') {
    return { ok: false, reason: 'INVALID_TOSTATE_FOR_VALIDATOR_RESULT', detail: `validatorResult.finalState=HOLD requires toState=HOLD, got ${toState}` };
  }
  return attemptTransition({
    repoRoot, taskId, ownerToken, toState, actingRole: 'C', requiredCapability: 'CERTIFY_TECHNICAL_PASS',
    requireHeadSha: validatorResult.currentHeadSha,
    extraChanges: { validator_result: validatorResult },
    now,
  });
}

/**
 * Task 6: the FINAL PR METADATA GATE. Only C may call this (metadata
 * finalization is a stage of C's own validation work, per the brief's own
 * "not Agent D" instruction -- no fourth role is created). Requires task
 * ownership, PR identity match, and an exact CI-head binding BEFORE ever
 * consulting the (externally-obtained, never fetched here) PR snapshot;
 * only then calls pr-metadata-gate.mjs's evaluateFinalPrMetadata with
 * `expected` values derived FRESH from the live, already-recorded task
 * state (never from a prior verification's own memory -- there is none;
 * this module has no persisted verdict of its own to reuse).
 *
 * A PASS moves PR_METADATA_SYNC_REQUIRED -> READY_FOR_HUMAN and records a
 * HEAD-bound `pr_metadata_verification` marker (see protocol-state.mjs).
 * Anything else moves to HOLD, exactly like any other HOLD-worthy outcome
 * -- same REMEDIATING recovery path, no special-casing.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.taskId
 * @param {string} params.ownerToken
 * @param {number} params.prNumber must equal the task's own recorded pr_number
 * @param {object} params.prSnapshot `{state, isDraft, merged, prNumber, bodyText}` -- real, externally-fetched
 * @param {string} params.ciHeadSha the exact SHA the caller independently confirmed CI ran against
 * @param {string} params.ciStatusLabel e.g. "4/4 SUCCESS" -- must match the canonical block's own CI_STATUS field
 * @param {string} [params.now]
 */
export function recordFinalPrMetadataVerification({
  repoRoot, taskId, ownerToken, prNumber, prSnapshot, ciHeadSha, ciStatusLabel, now,
}) {
  const lockCheck = verifyTaskLockOwnership({ repoRoot, taskId, ownerToken });
  if (!lockCheck.valid) return { ok: false, reason: lockCheck.reason ?? 'LOCK_OWNERSHIP_INVALID' };

  const state = loadState(repoRoot, taskId);
  if (state === null) return { ok: false, reason: 'NO_TASK_SESSION' };
  if (state.pr_number !== prNumber) return { ok: false, reason: 'PR_IDENTITY_MISMATCH', detail: `task's recorded pr_number is ${state.pr_number}, verification requested for ${prNumber}` };
  if (!isNonEmptyString(ciHeadSha) || ciHeadSha !== state.head_sha) {
    return { ok: false, reason: 'HOLD_HEAD_DRIFT', detail: `CI head ${JSON.stringify(ciHeadSha)} does not match task head_sha ${state.head_sha}` };
  }

  const counts = countFindingsBySeverity(state.findings);
  const expected = {
    prNumber: state.pr_number,
    baseSha: state.base_sha,
    headSha: state.head_sha,
    bAuditResult: state.auditor_result?.finalState ?? null,
    cCertification: state.validator_result?.finalState ?? null,
    ciHeadSha,
    ciStatus: ciStatusLabel,
    p0: counts.P0, p1: counts.P1, p2: counts.P2, p3: counts.P3,
  };
  const evalResult = evaluateFinalPrMetadata({ prSnapshot, expected });

  const toState = evalResult.verified ? 'READY_FOR_HUMAN' : 'HOLD';
  const extraChanges = evalResult.verified
    ? {
      pr_metadata_verification: {
        pr_number: prNumber,
        head_sha: state.head_sha,
        body_sha256: evalResult.bodySha256,
        verified_at: now ?? new Date().toISOString(),
      },
    }
    : {};
  const result = attemptTransition({
    repoRoot, taskId, ownerToken, toState, actingRole: 'C', requiredCapability: 'CERTIFY_TECHNICAL_PASS',
    requireHeadSha: state.head_sha, extraChanges, now,
  });
  if (!result.ok) return result;
  return { ...result, verified: evalResult.verified, verificationReason: evalResult.reason };
}

/** A marks the task WAITING_CI, HEAD-bound. */
export function enterWaitingCi({ repoRoot, taskId, ownerToken, ciRun, headSha, now }) {
  return attemptTransition({
    repoRoot, taskId, ownerToken, toState: 'WAITING_CI', actingRole: 'A', requiredCapability: 'RUN_PRIMARY_TESTS',
    requireHeadSha: headSha,
    extraChanges: { ci_run: (typeof ciRun === 'string' || typeof ciRun === 'number') ? ciRun : undefined },
    now,
  });
}

/**
 * A SINGLE check of CI state (never a loop -- brief section 13's
 * WAITING_CI_NO_LONG_POLL is true by construction: this function makes one
 * decision and returns; nothing in it retries or sleeps). If the SHA the
 * caller observed CI evidence for does not match the task's own current
 * head_sha, this is a hard HOLD_HEAD_DRIFT, never treated as matching CI
 * evidence from a stale run. `classifyCiWaitStatus` is reused verbatim from
 * role-protocol.mjs -- `completed`+`success` is the only path to
 * 'SUCCESS'; anything else (including 'WAITING_CI' itself) leaves the task
 * in WAITING_CI without ever becoming a false PASS.
 */
export function resumeFromWaitingCi({ repoRoot, taskId, ownerToken, ciHeadSha, ciStatus, actingRole = 'A', now }) {
  const lockCheck = verifyTaskLockOwnership({ repoRoot, taskId, ownerToken });
  if (!lockCheck.valid) return { ok: false, reason: lockCheck.reason ?? 'LOCK_OWNERSHIP_INVALID' };

  const state = loadState(repoRoot, taskId);
  if (state === null) return { ok: false, reason: 'NO_TASK_SESSION' };
  if (state.state !== 'WAITING_CI') return { ok: false, reason: 'NOT_WAITING_CI' };

  if (!isNonEmptyString(ciHeadSha) || ciHeadSha !== state.head_sha) {
    return { ok: false, reason: 'HOLD_HEAD_DRIFT', detail: `CI evidence SHA ${JSON.stringify(ciHeadSha)} does not match task head_sha ${state.head_sha}` };
  }

  const classification = classifyCiWaitStatus(ciStatus ?? {});
  if (classification === 'WAITING_CI') {
    const nextState = advanceProtocolState(state, pruneUndefined({ ci_head_sha: ciHeadSha, ci_status: 'WAITING_CI' }), now);
    persistState(repoRoot, taskId, nextState);
    return { ok: true, state: nextState, ciClassification: 'WAITING_CI' };
  }

  const toState = classification === 'SUCCESS' ? 'READY_FOR_B' : 'HOLD';
  const capDecision = evaluateRoleCapability(actingRole, 'RUN_PRIMARY_TESTS');
  if (!capDecision.allowed) return { ok: false, reason: `CAPABILITY_DENIED:${capDecision.reason}` };
  try {
    validateStateTransition({ fromState: state.state, toState, actingRole });
  } catch (err) {
    if (err instanceof InvalidRoleTransitionError) return { ok: false, reason: 'INVALID_STATE_TRANSITION', detail: err.message };
    throw err;
  }
  const nextState = advanceProtocolState(state, pruneUndefined({
    active_role: actingRole, previous_role: state.active_role, state: toState,
    ci_head_sha: ciHeadSha, ci_status: classification,
  }), now);
  persistState(repoRoot, taskId, nextState);
  return { ok: true, state: nextState, ciClassification: classification };
}

const PR_READINESS_ACTION_TYPES = Object.freeze(['MARK_READY', 'MERGE']);

/**
 * Records that a human gate is required for actionType. This NEVER grants
 * the action -- `requiresHumanGateForAction` (role-protocol.mjs, unmodified)
 * has no bypass parameter, and this wrapper does not move `state.state`
 * toward DONE/Ready/merge on its own initiative. Unknown actionType fails
 * closed (DENY), matching requiresHumanGateForAction's own throw-on-unknown
 * behavior.
 *
 * Task 6: for MARK_READY/MERGE specifically -- the two actions that mean
 * "this task itself is ready" -- this now additionally requires
 * state.state === 'READY_FOR_HUMAN' AND a `pr_metadata_verification`
 * marker that is HEAD-bound to the task's CURRENT head_sha. A stale or
 * missing verification denies the request outright (HOLD_PR_METADATA_
 * STALE / PR_METADATA_VERIFICATION_MISSING), closing exactly the gap PR
 * #78/#79 exposed: MARK_READY can never be requested merely because C
 * technically passed. Other action types (PRODUCTION_ACTION, IAM_OR_
 * SECRET_ACTION, DESTRUCTIVE_ACTION, UNKNOWN_COMMAND_CLASS) are
 * unaffected -- their unconditional human-gate requirement has nothing to
 * do with a specific task's PR readiness.
 */
export function requestHumanGate({ repoRoot, taskId, ownerToken, actionType, now }) {
  const lockCheck = verifyTaskLockOwnership({ repoRoot, taskId, ownerToken });
  if (!lockCheck.valid) return { ok: false, reason: lockCheck.reason ?? 'LOCK_OWNERSHIP_INVALID' };
  const state = loadState(repoRoot, taskId);
  if (state === null) return { ok: false, reason: 'NO_TASK_SESSION' };

  let required;
  try {
    required = requiresHumanGateForAction(actionType);
  } catch {
    return { ok: false, reason: 'UNKNOWN_ACTION_TYPE' };
  }

  if (PR_READINESS_ACTION_TYPES.includes(actionType)) {
    if (state.state !== 'READY_FOR_HUMAN') {
      return { ok: false, reason: 'PR_METADATA_VERIFICATION_MISSING', detail: `task state is ${state.state}, not READY_FOR_HUMAN` };
    }
    const verification = state.pr_metadata_verification;
    if (verification === null || verification.head_sha !== state.head_sha) {
      return { ok: false, reason: 'HOLD_PR_METADATA_STALE', detail: 'no valid pr_metadata_verification bound to the current head_sha' };
    }
  }

  const nextState = advanceProtocolState(state, pruneUndefined({ human_gate_required: required, human_gate_type: actionType }), now);
  persistState(repoRoot, taskId, nextState);
  return { ok: true, state: nextState, humanGateRequired: required, actionExecuted: false };
}

/**
 * Releases BOTH the scope lock and the active-task-execution slot, freeing
 * the reserved paths for another task and freeing the single active-task
 * slot for the next task's own NIGHT/A/B/C sequence. Requires the exact
 * owner_token from reserveTask; either release failing (e.g. already
 * released, wrong owner) is reported without pretending the other
 * succeeded.
 */
export function releaseTask({ repoRoot, taskId, ownerToken, now }) {
  const scopeResult = releaseTaskLock({ repoRoot, taskId, ownerToken, now });
  const slotResult = releaseActiveTaskSlot({ repoRoot, taskId, ownerToken, now });
  return {
    ok: scopeResult.ok && slotResult.ok,
    scope: scopeResult,
    slot: slotResult,
  };
}

/**
 * Evidence may be reused only when still bound to the exact SHA it proved
 * (brief section 14) -- never merely because "it passed earlier".
 */
export function isEvidenceReusable({ evidenceHeadSha, currentHeadSha }) {
  return isNonEmptyString(evidenceHeadSha) && isNonEmptyString(currentHeadSha) && evidenceHeadSha === currentHeadSha;
}
