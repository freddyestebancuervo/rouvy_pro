// Korixa Night Agent — workflow certification evidence gate.
//
// Purpose: turn GitHub Actions validation from a generic CI fact into a
// fail-closed, HEAD-bound contract that B and C can require explicitly.
// This module does not run actionlint itself; actionlint-gate.mjs and
// workflow-structure-gate.mjs produce the mechanical CI evidence. This
// module decides whether that evidence is sufficient to certify a task.
//
// P1-1 REMEDIATION (T-F1.2 external audit, HOLD): a plain object literal
// {headSha, workflowSchemaValidation: 'PASS', actionlintValidation: 'PASS'}
// used to satisfy evaluateWorkflowValidationRequirement by SHAPE alone --
// any caller could fabricate one by hand, and this codebase's own tests did
// exactly that (see the historical `passEvidence()` helper this remediation
// removes). Evidence now additionally requires LIVE, unforgeable
// attestation: a private WeakSet keyed by object IDENTITY, never shape --
// the exact same pattern role-protocol-core.mjs already uses for
// TRUSTED_AUDITOR_RESULT_REGISTRY. Only produceWorkflowValidationEvidenceFromCiRun
// (below) can mint a member of that set. A hand-built object, a
// JSON-round-tripped clone, or a `{...authentic}` spread copy is
// byte-identical in shape yet fails isAttestedWorkflowValidationEvidence,
// because none of them are the SAME object the minting function returned.

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

// ---------------------------------------------------------------------------
// P1-1 remediation — unforgeable evidence attestation. See module header.
// ---------------------------------------------------------------------------

const ATTESTED_WORKFLOW_VALIDATION_EVIDENCE = new WeakSet();

/** @returns {boolean} true only for the exact object a mint function below returned -- never for a shape-identical copy. */
export function isAttestedWorkflowValidationEvidence(candidate) {
  return typeof candidate === 'object' && candidate !== null && ATTESTED_WORKFLOW_VALIDATION_EVIDENCE.has(candidate);
}

function mintEvidence(fields) {
  const evidence = frozen({ ...fields });
  ATTESTED_WORKFLOW_VALIDATION_EVIDENCE.add(evidence);
  return evidence;
}

const REQUIRED_CI_JOB_NAME = 'Night Agent — security + test';

/**
 * The ONLY legitimate way to produce workflow validation evidence for real
 * B/C certification. Takes a real, already-fetched GitHub Actions CI run
 * summary (the caller must have independently run something equivalent to
 * `gh run view <id> --json headSha,event,jobs` -- this function performs no
 * network/process I/O of its own, staying consistent with this module's pure
 * contract) and mechanically decides whether it proves both the workflow
 * structure gate and the pinned actionlint layer passed for the exact HEAD.
 *
 * P2-1 (CI HEAD vs merge SHA remediation): `ciRun.headSha` is GitHub's own
 * `run.head_sha` API field -- the commit this run is officially associated
 * with (PR_HEAD_SHA). This is NOT the same claim as "the runner's working
 * tree contained only that commit's tree in isolation": this repository's
 * ci.yml uses `actions/checkout` with no explicit `ref:`, so a
 * `pull_request`-event run's default checkout is GitHub's own temporary
 * merge of PR_HEAD_SHA with the base branch (an ephemeral tree, never a real
 * commit in this repository's history) -- standard GitHub Actions behavior,
 * intentionally NOT changed by this remediation. This function does not
 * claim more certainty than that binding actually provides: it records
 * exactly which event produced the evidence (`ciEvent`) rather than
 * asserting "CI ran on exact HEAD" unconditionally. Callers that require the
 * strongest binding (e.g. the final PR-metadata/human-gate path) should
 * prefer `ciRun.event === 'push'` evidence -- post-merge, where `head_sha`
 * genuinely is the exact tested commit -- over pull_request-event evidence.
 */
export function produceWorkflowValidationEvidenceFromCiRun({
  headSha,
  ciRun,
  requiredJobName = REQUIRED_CI_JOB_NAME,
} = {}) {
  if (typeof headSha !== 'string' || headSha.length === 0) {
    throw new TypeError('produceWorkflowValidationEvidenceFromCiRun requires a non-empty headSha');
  }
  if (ciRun === null || typeof ciRun !== 'object' || Array.isArray(ciRun)) {
    throw new TypeError('produceWorkflowValidationEvidenceFromCiRun requires a real ciRun object ({ headSha, event, jobs })');
  }
  const { headSha: ciHeadSha, event: ciEvent, jobs } = ciRun;
  if (typeof ciHeadSha !== 'string' || ciHeadSha.length === 0) {
    throw new TypeError('ciRun.headSha is required (GitHub run.head_sha -- PR_HEAD_SHA)');
  }
  if (typeof ciEvent !== 'string' || ciEvent.length === 0) {
    throw new TypeError('ciRun.event is required (e.g. "push" or "pull_request") -- see P2-1 header note');
  }
  if (!Array.isArray(jobs)) {
    throw new TypeError('ciRun.jobs must be a real array of { name, conclusion }');
  }

  // Fail closed on mismatch rather than minting evidence for the wrong
  // subject -- this is the same discipline this whole program already
  // applies everywhere else CI evidence is bound to a task's real HEAD.
  if (ciHeadSha !== headSha) {
    return mintEvidence({ headSha, workflowSchemaValidation: 'FAIL', actionlintValidation: 'FAIL' });
  }

  const requiredJob = jobs.find((j) => j && j.name === requiredJobName);
  const jobPassed = requiredJob?.conclusion === 'success';

  // Both validators run inside the same `node --test tools/night-agent/
  // test/*.test.mjs` invocation as part of this one required CI job (see
  // workflow-structure-gate.test.mjs and actionlint-negative-regression.
  // test.mjs) -- a single node:test process fails non-zero, and therefore
  // this CI job's own conclusion becomes 'failure', if EITHER validator's
  // assertions fail. The job's real conclusion is mechanical proof of both.
  const validation = jobPassed ? WORKFLOW_VALIDATION_PASS : 'FAIL';
  return mintEvidence({
    headSha,
    workflowSchemaValidation: validation,
    actionlintValidation: validation,
  });
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

  // P1-1: shape alone is never sufficient. Only an object actually MINTED by
  // produceWorkflowValidationEvidenceFromCiRun can carry authority here --
  // see this module's header and isAttestedWorkflowValidationEvidence.
  if (!isAttestedWorkflowValidationEvidence(workflowValidation)) {
    return frozen({
      ...base,
      required: true,
      proven: false,
      decision: 'HOLD',
      reason: 'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED',
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
