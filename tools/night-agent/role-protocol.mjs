// Korixa — hardened facade for the Common Agent Protocol.
//
// The original, already-audited implementation lives unchanged in
// role-protocol-core.mjs. This facade adds the T-F1.2 workflow-schema
// certification contract without rewriting that historical core.

export * from './role-protocol-core.mjs';

import {
  certifyAuditResult as coreCertifyAuditResult,
  certifyByValidator as coreCertifyByValidator,
  isAttestedAuditorResult as coreIsAttestedAuditorResult,
  classifyAuditorResultTrust as coreClassifyAuditorResultTrust,
  AUDIT_HOLD_REASONS as CORE_AUDIT_HOLD_REASONS,
  VALIDATION_HOLD_REASONS as CORE_VALIDATION_HOLD_REASONS,
} from './role-protocol-core.mjs';
import {
  classifyWorkflowChangeContext,
  evaluateWorkflowValidationRequirement,
} from './workflow-certification-gate.mjs';

const WORKFLOW_AUDITOR_RESULTS = new WeakSet();
const WORKFLOW_AUDITOR_UNDERLYING = new WeakMap();
const WORKFLOW_VALIDATOR_RESULTS = new WeakSet();
const PASS_SHAPED_AUDITOR_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS']);

const WORKFLOW_HOLD_REASONS = Object.freeze([
  'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN',
  'HOLD_WORKFLOW_SCHEMA_VALIDATION_REQUIRED',
  'HOLD_WORKFLOW_SCHEMA_EVIDENCE_HEAD_MISMATCH',
  'HOLD_UNPROVEN_PRODUCTION_WORKFLOW_SCHEMA',
  'HOLD_WORKFLOW_EVIDENCE_NOT_ATTESTED',
]);

export const AUDIT_HOLD_REASONS = Object.freeze([
  ...new Set([...CORE_AUDIT_HOLD_REASONS, ...WORKFLOW_HOLD_REASONS]),
]);

export const VALIDATION_HOLD_REASONS = Object.freeze([
  ...new Set([...CORE_VALIDATION_HOLD_REASONS, ...WORKFLOW_HOLD_REASONS]),
]);

function hasWorkflowContext(input) {
  return input !== null && typeof input === 'object'
    && (
      Object.prototype.hasOwnProperty.call(input, 'filesChanged')
      || Object.prototype.hasOwnProperty.call(input, 'workflowValidation')
    );
}

function wrapAuditorResult(coreResult, gate, { requestedState, reasonOverride } = {}) {
  const result = Object.freeze({
    ...coreResult,
    requestedState: requestedState ?? coreResult.requestedState,
    finalState: reasonOverride ? 'HOLD' : coreResult.finalState,
    reason: reasonOverride ?? coreResult.reason,
    workflowGate: gate,
  });
  WORKFLOW_AUDITOR_RESULTS.add(result);
  WORKFLOW_AUDITOR_UNDERLYING.set(result, coreResult);
  return result;
}

function wrapValidatorResult(coreResult, gate, reasonOverride = null) {
  const result = Object.freeze({
    ...coreResult,
    finalState: reasonOverride ? 'HOLD' : coreResult.finalState,
    reason: reasonOverride ?? coreResult.reason,
    workflowGate: gate,
  });
  WORKFLOW_VALIDATOR_RESULTS.add(result);
  return result;
}

/**
 * B hardening.
 *
 * When a real task supplies filesChanged/workflowValidation context, a
 * PASS-shaped B result is impossible unless both mechanical validation
 * layers are PASS on the exact same HEAD. Production workflow + missing or
 * stale proof is explicitly UNPROVEN -> HOLD.
 *
 * Calls with no workflow context at all delegate to the historical core for
 * backward-compatible low-level/unit-test use. The runtime orchestrator
 * facade separately refuses to record a workflow-changing task result that
 * lacks this workflowGate, eliminating omission as a real workflow bypass.
 */
export function certifyAuditResult(input) {
  if (!hasWorkflowContext(input)) return coreCertifyAuditResult(input);

  const gate = evaluateWorkflowValidationRequirement({
    filesChanged: input?.filesChanged,
    headSha: input?.headSha,
    workflowValidation: input?.workflowValidation,
  });

  const requestedState = input?.requestedState;
  if (PASS_SHAPED_AUDITOR_STATES.includes(requestedState) && !gate.proven) {
    // Ask the historical core to mint a genuine attested HOLD object, then
    // wrap it with the more specific workflow reason. C can later unwrap the
    // original core object for all pre-existing trust checks.
    const coreHold = coreCertifyAuditResult({ ...input, requestedState: 'HOLD' });
    return wrapAuditorResult(coreHold, gate, { requestedState, reasonOverride: gate.reason });
  }

  const coreResult = coreCertifyAuditResult(input);
  return wrapAuditorResult(coreResult, gate);
}

export function isAttestedAuditorResult(candidate) {
  return WORKFLOW_AUDITOR_RESULTS.has(candidate) || coreIsAttestedAuditorResult(candidate);
}

export function classifyAuditorResultTrust(candidate) {
  if (WORKFLOW_AUDITOR_RESULTS.has(candidate)) return 'LIVE_ATTESTATION';
  return coreClassifyAuditorResultTrust(candidate);
}

/**
 * C hardening.
 *
 * C independently evaluates the same workflow requirement from its own
 * filesChanged + workflowValidation inputs. It does not trust B's PASS as
 * proof of schema validity. Therefore B can say PASS and C still returns
 * HOLD when C lacks same-HEAD schema/actionlint evidence.
 */
export function certifyByValidator(input) {
  if (!hasWorkflowContext(input)) return coreCertifyByValidator(input);

  const gate = evaluateWorkflowValidationRequirement({
    filesChanged: input?.filesChanged,
    headSha: input?.currentHeadSha,
    workflowValidation: input?.workflowValidation,
  });

  const suppliedAuditorResult = input?.attestedAuditorResult;
  const underlyingAuditorResult = WORKFLOW_AUDITOR_UNDERLYING.get(suppliedAuditorResult) ?? suppliedAuditorResult;
  const coreResult = coreCertifyByValidator({
    ...input,
    attestedAuditorResult: underlyingAuditorResult,
  });

  // Preserve all pre-existing validator denials first. The workflow gate is
  // an additional mandatory gate; it never launders an existing HOLD.
  if (coreResult.finalState !== 'PASS') return wrapValidatorResult(coreResult, gate);
  if (!gate.proven) return wrapValidatorResult(coreResult, gate, gate.reason);
  return wrapValidatorResult(coreResult, gate);
}

export function isWorkflowAwareValidatorResult(candidate) {
  return typeof candidate === 'object' && candidate !== null && WORKFLOW_VALIDATOR_RESULTS.has(candidate);
}

/**
 * Validate a persisted workflowGate summary against the task's CURRENT
 * filesChanged + HEAD. This is intentionally independent of WeakSet process
 * identity so C/metadata/Human Gate can re-check a JSON-persisted summary.
 */
export function isPersistedWorkflowGateProven({ gate, filesChanged, headSha } = {}) {
  const context = classifyWorkflowChangeContext(filesChanged);
  if (!context.valid) return false;
  if (!context.workflowChanged) return true;
  if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) return false;
  if (gate.required !== true || gate.proven !== true || gate.decision !== 'PROCEED') return false;
  if (gate.reason !== 'WORKFLOW_SCHEMA_VALIDATION_PROVEN') return false;
  if (gate.evidenceLevel !== 'PROVEN_BY_CODE') return false;
  if (gate.headSha !== headSha) return false;
  if (gate.workflowChanged !== true) return false;
  if (gate.productionWorkflowChanged !== context.productionWorkflowChanged) return false;
  if (!Array.isArray(gate.workflowFiles)) return false;
  if (gate.workflowFiles.length !== context.workflowFiles.length) return false;
  for (let i = 0; i < gate.workflowFiles.length; i += 1) {
    if (gate.workflowFiles[i] !== context.workflowFiles[i]) return false;
  }
  return true;
}
