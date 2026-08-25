// Korixa — hardened facade for the runtime task orchestrator.
//
// Historical orchestration remains unchanged in task-orchestrator-core.mjs.
// This facade makes workflow-schema evidence non-optional in the REAL task
// lifecycle.
//
// P1-2 REMEDIATION (T-F1.2 external audit, HOLD): workflow-change detection
// used to derive from persisted state.files_changed, which is populated
// exclusively from executorResult.filesChanged -- A's own self-declared
// list (task-orchestrator-core.mjs). A task that genuinely modified
// .github/workflows/production-deploy.yml but declared only, say,
// backend/src/main.ts would never even be CLASSIFIED as a workflow change,
// silently bypassing every P1-1 protection below it. Workflow-change
// classification now derives exclusively from a real `git diff --name-status
// BASE_SHA..HEAD_SHA` (git-changeset.mjs) against the real repository.
// executorResult.filesChanged / state.files_changed remain available as
// informational data on the persisted state, but are never consulted for
// this security-relevant decision again. If Git cannot determine the
// changeset (missing repoRoot, unresolvable SHAs, command failure), the
// result is UNPROVEN -> HOLD, exactly as an unproven workflow-schema
// evidence gate already is -- never silently treated as "no change".
//
// P1-B REMEDIATION (T-F1.2 external re-audit, HOLD): the previous revision
// of this facade exposed __installTestGitChangesetProvider /
// __clearTestGitChangesetProvider, a public, module-level override that let
// ANY caller substitute the entire Git-changeset authority. The audit's
// finding stands regardless of the export's name: "that the name contains
// '__installTest' is NOT a security boundary" -- a public export is a public
// export. That override has been deleted outright. deriveChangedFilesFromGit
// (git-changeset.mjs) now runs unconditionally, with no override parameter
// of any name accepted anywhere in this module. The two pre-existing test
// files that relied on the override (task-orchestrator.test.mjs,
// full-role-simulation.test.mjs) were retrofitted to use real, disposable
// Git repositories (test/support/git-orchestration-fixture.mjs, a test-only
// module never imported by any runtime file) instead of overriding
// production authority.

export * from './task-orchestrator-core.mjs';

import {
  getTaskState as coreGetTaskState,
  recordAuditResult as coreRecordAuditResult,
  recordValidationResult as coreRecordValidationResult,
  recordFinalPrMetadataVerification as coreRecordFinalPrMetadataVerification,
  requestHumanGate as coreRequestHumanGate,
} from './task-orchestrator-core.mjs';
import { classifyWorkflowChangeContext } from './workflow-certification-gate.mjs';
import { deriveChangedFilesFromGit } from './git-changeset.mjs';
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

/**
 * @param {object} state persisted protocol state (or null)
 * @param {{repoRoot?: string}} [options]
 */
function inspectTaskWorkflowContext(state, { repoRoot } = {}) {
  if (state === null || typeof state !== 'object') {
    return { valid: false, workflowChanged: null, productionWorkflowChanged: null, workflowFiles: [] };
  }

  const changeset = deriveChangedFilesFromGit({ repoRoot, baseSha: state.base_sha, headSha: state.head_sha });
  if (!changeset.ok) {
    return {
      valid: false,
      workflowChanged: null,
      productionWorkflowChanged: null,
      workflowFiles: [],
      reason: 'GIT_CHANGESET_UNDETERMINED',
      gitChangesetReason: changeset.reason,
    };
  }

  return classifyWorkflowChangeContext(changeset.files);
}

function resultHasCurrentWorkflowProof(result, state, { repoRoot } = {}) {
  const changeset = deriveChangedFilesFromGit({ repoRoot, baseSha: state?.base_sha, headSha: state?.head_sha });
  if (!changeset.ok) return false;
  return isPersistedWorkflowGateProven({
    gate: result?.workflowGate,
    filesChanged: changeset.files,
    headSha: state?.head_sha,
  });
}

/**
 * Public/pure-ish inspection helper used by tests and by the two final gates.
 * It never mutates state. `repoRoot` is required to derive the real,
 * mechanical changeset (P1-2) -- without it, Git cannot run and the result
 * is UNPROVEN -> HOLD, never silently treated as "no workflow change".
 */
export function evaluatePersistedWorkflowCertification(state, { repoRoot } = {}) {
  const context = inspectTaskWorkflowContext(state, { repoRoot });
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

  const auditorProven = resultHasCurrentWorkflowProof(state?.auditor_result, state, { repoRoot });
  const validatorProven = resultHasCurrentWorkflowProof(state?.validator_result, state, { repoRoot });
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
 * rejected whenever the REAL Git changeset (P1-2) proves .github/workflows/**
 * changed. HOLD results remain recordable so the system can persist the
 * blocker.
 */
export function recordAuditResult(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const context = inspectTaskWorkflowContext(state, { repoRoot: args?.repoRoot });
  const isPass = AUDITOR_PASS_SHAPED_STATES.includes(args?.auditorResult?.finalState);

  if (context.valid && context.workflowChanged && isPass) {
    if (!resultHasCurrentWorkflowProof(args?.auditorResult, state, { repoRoot: args?.repoRoot })) {
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
 * object, workflow-changing tasks (per the real Git changeset, P1-2) require
 * a live workflow-aware C result and a persisted same-HEAD workflowGate
 * before C PASS can be recorded.
 */
export function recordValidationResult(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const context = inspectTaskWorkflowContext(state, { repoRoot: args?.repoRoot });
  const isPass = args?.validatorResult?.finalState === 'PASS';

  if (context.valid && context.workflowChanged && isPass) {
    if (!isWorkflowAwareValidatorResult(args?.validatorResult)) {
      return { ok: false, reason: 'HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED', detail: 'validator PASS is not a live workflow-aware C result' };
    }
    if (!resultHasCurrentWorkflowProof(args?.validatorResult, state, { repoRoot: args?.repoRoot })) {
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
 * persisted workflow proof on the current HEAD (per the real Git changeset,
 * P1-2). This makes the workflow gate a real prerequisite to reaching the
 * Human Gate, not merely a CI log line.
 */
export function recordFinalPrMetadataVerification(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const decision = evaluatePersistedWorkflowCertification(state, { repoRoot: args?.repoRoot });
  if (decision.required && !decision.proven) {
    return { ok: false, reason: decision.reason, detail: 'workflow schema evidence is not sufficient to enter READY_FOR_HUMAN' };
  }
  return coreRecordFinalPrMetadataVerification(args);
}

/** Defense in depth at the final human-action request boundary. */
export function requestHumanGate(args) {
  const state = coreGetTaskState({ repoRoot: args?.repoRoot, taskId: args?.taskId });
  const decision = evaluatePersistedWorkflowCertification(state, { repoRoot: args?.repoRoot });
  if (decision.required && !decision.proven) {
    return { ok: false, reason: decision.reason, detail: 'Human Gate denied: workflow schema evidence is missing, stale, or unproven' };
  }
  return coreRequestHumanGate(args);
}
