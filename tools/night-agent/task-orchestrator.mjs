// Korixa — hardened facade for the runtime task orchestrator.
//
// Historical orchestration remains unchanged in task-orchestrator-core.mjs.
// This facade makes workflow-schema evidence non-optional in the REAL task
// lifecycle by deriving workflow changes from persisted state.files_changed,
// not from a caller's optional claim.

export * from './task-orchestrator-core.mjs';

import {
  getTaskState as coreGetTaskState,
  recordAuditResult as coreRecordAuditResult,
  recordValidationResult as coreRecordValidationResult,
  recordFinalPrMetadataVerification as coreRecordFinalPrMetadataVerification,
  requestHumanGate as coreRequestHumanGate,
} from './task-orchestrator-core.mjs';
import { classifyWorkflowChangeContext } from './workflow-certification-gate.mjs';
import {
  isPersistedWorkflowGateProven,
  isWorkflowAwareValidatorResult,
} from './role-protocol.mjs';

const AUDITOR_PASS_SHAPED_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS']);

function workflowHoldReason(context) {
  return context?.productionWorkflowChanged
    ? 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA'
    : 'HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED';
}

function inspectTaskWorkflowContext(state) {
  if (state === null || typeof state !== 'object') {
    return { valid: false, workflowChanged: null, productionWorkflowChanged: null, workflowFiles: [] };
  }
  return classifyWorkflowChangeContext(state.files_changed);
}

function resultHasCurrentWorkflowProof(result, state) {
  return isPersistedWorkflowGateProven({
    gate: result?.workflowGate,
    filesChanged: state?.files_changed,
    headSha: state?.head_sha,
  });
}

/**
 * Public/pure-ish inspection helper used by tests and by the two final gates.
 * It never mutates state.
 */
export function evaluatePersistedWorkflowCertification(state) {
  const context = inspectTaskWorkflowContext(state);
  if (!context.valid) {
    return {
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN',
      context,
    };
  }
  if (!context.workflowChanged) {
    return { required: false, proven: true, decision: 'PROCEED', reason: 'NO_WORKFLOW_CHANGE', context };
  }

  const auditorProven = resultHasCurrentWorkflowProof(state?.auditor_result, state);
  const validatorProven = resultHasCurrentWorkflowProof(state?.validator_result, state);
  if (!auditorProven || !validatorProven) {
    return {
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: workflowHoldReason(context),
      context,
      auditorProven,
      validatorProven,
    };
  }

  return {
    required: true,
    proven: true,
    decision: 'PROCEED',
    reason: 'WORKFLOW_SCHEMA_VALIDATION_PROVEN',
    context,
    auditorProven: true,
    validatorProven: true,
  };
}

/**
 * Runtime B enforcement. A legacy/core PASS object with no workflowGate is
 * rejected whenever persisted task state proves .github/workflows/** changed.
 * HOLD results remain recordable so the system can persist the blocker.
 */
export function recordAuditResult(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const context = inspectTaskWorkflowContext(state);
  const isPass = AUDITOR_PASS_SHAPED_STATES.includes(args?.auditorResult?.finalState);

  if (context.valid && context.workflowChanged && isPass) {
    if (!resultHasCurrentWorkflowProof(args?.auditorResult, state)) {
      return { ok: false, reason: workflowHoldReason(context), detail: 'B PASS cannot be recorded: same-HEAD WORKFLOW_SCHEMA_VALIDATION + ACTIONLINT validation is not proven' };
    }
  }
  if (!context.valid && isPass) {
    return { ok: false, reason: 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN' };
  }

  return coreRecordAuditResult(args);
}

/**
 * Runtime C enforcement. Even if a caller fabricates a PASS-shaped validator
 * object, workflow-changing tasks require a live workflow-aware C result and
 * a persisted same-HEAD workflowGate before C PASS can be recorded.
 */
export function recordValidationResult(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const context = inspectTaskWorkflowContext(state);
  const isPass = args?.validatorResult?.finalState === 'PASS';

  if (context.valid && context.workflowChanged && isPass) {
    if (!isWorkflowAwareValidatorResult(args?.validatorResult)) {
      return { ok: false, reason: 'HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED', detail: 'validator PASS is not a live workflow-aware C result' };
    }
    if (!resultHasCurrentWorkflowProof(args?.validatorResult, state)) {
      return { ok: false, reason: workflowHoldReason(context), detail: 'C PASS cannot be recorded: same-HEAD workflow validation proof is missing/stale' };
    }
  }
  if (!context.valid && isPass) {
    return { ok: false, reason: 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN' };
  }

  return coreRecordValidationResult(args);
}

/**
 * Prevent PR_METADATA_SYNC_REQUIRED -> READY_FOR_HUMAN unless BOTH B and C
 * persisted workflow proof on the current HEAD. This makes the workflow gate
 * a real prerequisite to reaching the Human Gate, not merely a CI log line.
 */
export function recordFinalPrMetadataVerification(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const decision = evaluatePersistedWorkflowCertification(state);
  if (decision.required && !decision.proven) {
    return { ok: false, reason: decision.reason, detail: 'workflow schema evidence is not sufficient to enter READY_FOR_HUMAN' };
  }
  return coreRecordFinalPrMetadataVerification(args);
}

/** Defense in depth at the final human-action request boundary. */
export function requestHumanGate(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const decision = evaluatePersistedWorkflowCertification(state);
  if (decision.required && !decision.proven) {
    return { ok: false, reason: decision.reason, detail: 'Human Gate denied: workflow schema evidence is missing, stale, or unproven' };
  }
  return coreRequestHumanGate(args);
}
