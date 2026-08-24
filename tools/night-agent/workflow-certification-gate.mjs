// Korixa Night Agent — workflow certification evidence gate.
//
// Purpose: turn GitHub Actions validation from a generic CI fact into a
// fail-closed, HEAD-bound contract that B and C can require explicitly.
// This module does not run actionlint itself; actionlint-gate.mjs and
// workflow-structure-gate.mjs produce the mechanical CI evidence. This
// module decides whether that evidence is sufficient to certify a task.

export const WORKFLOW_VALIDATION_PASS = 'PASS';
export const WORKFLOW_VALIDATION_EVIDENCE_LEVELS = Object.freeze([
  'PROVEN_BY_CODE',
  'UNPROVEN',
]);

const WORKFLOW_PATH_RE = /^\.github\/workflows\/.+\.ya?ml$/i;
const PRODUCTION_HINT_RE = /(^|[-_.])production([-_.]|$)/i;
const EVIDENCE_KEYS = Object.freeze([
  'headSha',
  'workflowSchemaValidation',
  'actionlintValidation',
]);

function frozen(obj) {
  return Object.freeze(obj);
}

export function isGithubActionsWorkflowPath(file) {
  return typeof file === 'string' && WORKFLOW_PATH_RE.test(file);
}

export function isProductionWorkflowPath(file) {
  if (!isGithubActionsWorkflowPath(file)) return false;
  const basename = file.slice(file.lastIndexOf('/') + 1).replace(/\.ya?ml$/i, '');
  return PRODUCTION_HINT_RE.test(basename);
}

export function classifyWorkflowChangeContext(filesChanged) {
  if (!Array.isArray(filesChanged) || !filesChanged.every((p) => typeof p === 'string' && p.length > 0)) {
    return frozen({
      valid: false,
      workflowChanged: null,
      productionWorkflowChanged: null,
      workflowFiles: frozen([]),
      reason: 'WORKFLOW_CHANGE_CONTEXT_UNPROVEN',
    });
  }

  const workflowFiles = filesChanged.filter(isGithubActionsWorkflowPath);
  return frozen({
    valid: true,
    workflowChanged: workflowFiles.length > 0,
    productionWorkflowChanged: workflowFiles.some(isProductionWorkflowPath),
    workflowFiles: frozen([...workflowFiles]),
    reason: null,
  });
}

function validateEvidenceShape(evidence) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const keys = Object.keys(evidence).sort();
  const expected = [...EVIDENCE_KEYS].sort();
  if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i])) return false;
  return typeof evidence.headSha === 'string' && evidence.headSha.length > 0
    && typeof evidence.workflowSchemaValidation === 'string'
    && typeof evidence.actionlintValidation === 'string';
}

/**
 * Evaluate whether schema/semantic validation is proven for the exact HEAD.
 *
 * For any workflow change, both layers are mandatory:
 *   WORKFLOW_SCHEMA_VALIDATION = PASS
 *   ACTIONLINT_VALIDATION = PASS
 * and both must be bound to the current HEAD via evidence.headSha.
 *
 * Production rule: when a changed workflow is Production-capable and proof
 * is absent/malformed/stale/failing, evidenceLevel is explicitly UNPROVEN
 * and the decision is HOLD. This is the machine form of Korixa's existing
 * "Production + UNPROVEN = HOLD" rule.
 */
export function evaluateWorkflowValidationRequirement({
  filesChanged,
  headSha,
  workflowValidation,
} = {}) {
  const context = classifyWorkflowChangeContext(filesChanged);
  const canonicalHead = typeof headSha === 'string' && headSha.length > 0 ? headSha : null;

  const base = {
    headSha: canonicalHead,
    workflowFiles: context.workflowFiles,
  };

  if (!context.valid) {
    return frozen({
      ...base,
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN',
      evidenceLevel: 'UNPROVEN',
      workflowChanged: null,
      productionWorkflowChanged: null,
    });
  }

  if (!context.workflowChanged) {
    return frozen({
      ...base,
      required: false,
      proven: true,
      decision: 'PROCEED',
      reason: 'NO_WORKFLOW_CHANGE',
      evidenceLevel: 'PROVEN_BY_CODE',
      workflowChanged: false,
      productionWorkflowChanged: false,
    });
  }

  const productionHoldReason = context.productionWorkflowChanged
    ? 'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA'
    : 'HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED';

  if (!canonicalHead || !validateEvidenceShape(workflowValidation)) {
    return frozen({
      ...base,
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: productionHoldReason,
      evidenceLevel: 'UNPROVEN',
      workflowChanged: true,
      productionWorkflowChanged: context.productionWorkflowChanged,
    });
  }

  if (workflowValidation.headSha !== canonicalHead) {
    return frozen({
      ...base,
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: 'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH',
      evidenceLevel: 'UNPROVEN',
      workflowChanged: true,
      productionWorkflowChanged: context.productionWorkflowChanged,
    });
  }

  if (
    workflowValidation.workflowSchemaValidation !== WORKFLOW_VALIDATION_PASS
    || workflowValidation.actionlintValidation !== WORKFLOW_VALIDATION_PASS
  ) {
    return frozen({
      ...base,
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: productionHoldReason,
      evidenceLevel: 'UNPROVEN',
      workflowChanged: true,
      productionWorkflowChanged: context.productionWorkflowChanged,
    });
  }

  return frozen({
    ...base,
    required: true,
    proven: true,
    decision: 'PROCEED',
    reason: 'WORKFLOW_SCHEMA_VALIDATION_PROVEN',
    evidenceLevel: 'PROVEN_BY_CODE',
    workflowChanged: true,
    productionWorkflowChanged: context.productionWorkflowChanged,
  });
}
