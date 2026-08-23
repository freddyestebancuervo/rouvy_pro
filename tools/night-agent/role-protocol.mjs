// Korixa — Common Agent Protocol (Task 2, 2026-08-23): role/state machine,
// handoff contract, evidence binding, and human-gate rules for the
// NIGHT -> A -> B -> (A remediation loop) -> C -> HUMAN_GATE flow.
//
// This is the SAME discipline this repository's own recent history (PR
// #73's three independent audit rounds; PR #74's Night->A->B->C sequence)
// already followed by hand, in a single chat, across explicit role
// switches — made into code so future tasks don't have to re-derive it
// from first principles or from a long, easy-to-drift-from prose
// instruction each time.
//
// SINGLE-CHAT MODEL: unlike `executor.mjs`/`night-guard.mjs` (which govern
// an actually-separate, actually-sandboxed spawned child process), every
// role here (NIGHT/A/B/C) is the SAME agent, in the SAME chat, at
// different times. There is no OS-level process boundary between them.
// Isolation here is deliberately LOGICAL, not physical: explicit role
// labels, a closed transition table, unforgeable (WeakSet-branded, exactly
// evidence-policy.mjs's/red-team-gate.mjs's own pattern) binding of an
// audit result to the exact HEAD_SHA it was produced against, and
// structurally-closed output domains (an Executor-shaped result literally
// cannot contain a PASS-shaped value; there is no field for it). What this
// module CANNOT do — and says so explicitly, per this task's own
// instruction to document rather than pretend — is stop a human-typed
// message in this same chat from claiming "I am now B" while quietly
// reusing A's own conclusions; the mitigation is procedural (TRUST_* reset
// rules below), the same way a courtroom's "the judge is not the
// defendant's lawyer" is a role discipline, not a physical wall.

import { classifyClaimSet } from './claim-taxonomy.mjs';
import { evaluateCommandSafety } from './command-safety.mjs';
import { ROLES, PROTOCOL_STATES, HUMAN_GATE_TYPES } from './protocol-state.mjs';

export class InvalidRoleTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidRoleTransitionError';
  }
}

export class SelfCertificationForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelfCertificationForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Role transitions — a closed table, not a convention. NIGHT hands off only
// to A. A hands off only to B — NEVER directly to C (the brief's own named
// invalid example: "A -> C directly without B = INVALID"). B can send work
// BACK to A (remediation) or FORWARD to C, never directly to a human-gate
// action itself. C's only forward destination is the human gate; C can
// never transition to DONE/Ready/merge on its own.
// ---------------------------------------------------------------------------

export const VALID_ROLE_TRANSITIONS = Object.freeze({
  NIGHT: Object.freeze(['A']),
  A: Object.freeze(['B']),
  B: Object.freeze(['A', 'C']),
  C: Object.freeze(['HUMAN_GATE']),
});

/**
 * @param {object} params
 * @param {string} params.fromRole one of ROLES
 * @param {string} params.toRole one of ROLES, or 'HUMAN_GATE'
 * @returns {{valid: true}}
 * @throws {InvalidRoleTransitionError} on any transition not in VALID_ROLE_TRANSITIONS
 */
export function validateRoleTransition({ fromRole, toRole }) {
  if (!ROLES.includes(fromRole)) {
    throw new InvalidRoleTransitionError(`unknown fromRole ${JSON.stringify(fromRole)} -- not one of ${ROLES.join(', ')}`);
  }
  const allowed = VALID_ROLE_TRANSITIONS[fromRole] ?? [];
  if (!allowed.includes(toRole)) {
    throw new InvalidRoleTransitionError(
      `${fromRole} -> ${toRole} is not a valid role transition (allowed from ${fromRole}: ${allowed.join(', ') || '(none)'}). `
      + 'A cannot hand off directly to C; only B may forward to C, and only after a real audit.',
    );
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// State transitions — which PROTOCOL_STATE may move to which, and which
// role is authorized to make that specific move. A transition attempted by
// the wrong role, or not present in this table at all, is rejected.
// ---------------------------------------------------------------------------

const STATE_TRANSITION_TABLE = Object.freeze({
  IDLE: Object.freeze({ PLANNING: 'NIGHT' }),
  PLANNING: Object.freeze({ READY_FOR_A: 'NIGHT' }),
  READY_FOR_A: Object.freeze({ EXECUTING: 'A' }),
  EXECUTING: Object.freeze({ WAITING_CI: 'A', READY_FOR_B: 'A' }),
  WAITING_CI: Object.freeze({ READY_FOR_B: 'A', HOLD: 'A' }),
  READY_FOR_B: Object.freeze({ AUDITING: 'B' }),
  AUDITING: Object.freeze({ HOLD: 'B', READY_FOR_C: 'B' }),
  // Remediation (Task 2, B audit Round 1, P1 WEAKSET_RESTART_RECOVERY):
  // NIGHT may route a HOLD directly back to READY_FOR_B, skipping A --
  // added specifically for the attestation-expired recovery path (a
  // persisted audit result that lost its live WeakSet attestation across a
  // process boundary needs B to RE-attest it, not A to "fix" anything; A
  // did nothing wrong and has no remediation work to do). NIGHT decides
  // whether a HOLD needs A (REMEDIATING) or just a fresh B pass
  // (READY_FOR_B) based on the HOLD's own reason -- see
  // classifyAuditorResultTrust/HOLD_AUDIT_ATTESTATION_EXPIRED below.
  HOLD: Object.freeze({ REMEDIATING: 'A', READY_FOR_B: 'NIGHT' }),
  REMEDIATING: Object.freeze({ READY_FOR_B: 'A', WAITING_CI: 'A' }),
  READY_FOR_C: Object.freeze({ VALIDATING: 'C' }),
  VALIDATING: Object.freeze({ READY_FOR_HUMAN: 'C', HOLD: 'C' }),
  READY_FOR_HUMAN: Object.freeze({ DONE: 'NIGHT' }), // NIGHT records the outcome; the human action itself (Ready/merge) is never performed by any role in this table -- see requiresHumanGateForAction below, which has no bypass parameter at all.
});

/**
 * @param {object} params
 * @param {string} params.fromState one of PROTOCOL_STATES
 * @param {string} params.toState one of PROTOCOL_STATES
 * @param {string} params.actingRole one of ROLES
 * @returns {{valid: true}}
 * @throws {InvalidRoleTransitionError}
 */
export function validateStateTransition({ fromState, toState, actingRole }) {
  if (!PROTOCOL_STATES.includes(fromState) || !PROTOCOL_STATES.includes(toState)) {
    throw new InvalidRoleTransitionError(`unknown state in transition ${JSON.stringify(fromState)} -> ${JSON.stringify(toState)}`);
  }
  const allowedFrom = STATE_TRANSITION_TABLE[fromState] ?? {};
  const requiredRole = allowedFrom[toState];
  if (requiredRole === undefined) {
    throw new InvalidRoleTransitionError(`${fromState} -> ${toState} is not a valid state transition`);
  }
  if (requiredRole !== actingRole) {
    throw new InvalidRoleTransitionError(`${fromState} -> ${toState} may only be performed by role ${requiredRole}, not ${actingRole}`);
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Identity — CLOSED CANONICAL VOCABULARY, not fuzzy normalization.
//
// Remediation (Task 2, B audit Round 1, P0): the original design here
// mirrored executor-auditor-gate.mjs's trim+whitespace-collapse+case-fold
// rule -- appropriate THERE because that module's identities are free-form
// session/context strings (e.g. `night-agent-executor-child:${task.id}`)
// with no closed vocabulary to check against. THIS module's identities have
// no such excuse: `executorRole`/`auditorRole`/`validatorRole` are always
// meant to be exactly one of ROLES ('NIGHT'/'A'/'B'/'C'), a genuinely closed
// 4-value set. A fuzzy normalizer over an unbounded string space is
// structurally unable to enumerate every invisible/lookalike Unicode
// character it should strip -- reproduced live by the audit:
// `identitiesAreIndependent('A', 'A​')` (a zero-width space appended)
// returned true, letting the same actor certify itself. The fix is not to
// extend the strip-list (an endless, always-incomplete blacklist -- the
// exact lesson this project already learned the hard way in
// command-safety.mjs's own R4->R5 blacklist->whitelist rewrite); it is to
// require EXACT membership in the closed ROLES set. 'A​', 'A ', 'a',
// or any other byte-for-byte deviation from a real role string is simply
// not a valid identity at all -- not "normalized to A", not "independent
// from A", just rejected outright.
// ---------------------------------------------------------------------------

function isCanonicalRoleIdentity(rawId) {
  return typeof rawId === 'string' && ROLES.includes(rawId);
}

function identitiesAreIndependent(idA, idB) {
  if (!isCanonicalRoleIdentity(idA) || !isCanonicalRoleIdentity(idB)) return false;
  return idA !== idB;
}

// ---------------------------------------------------------------------------
// A — EXECUTOR. Structurally cannot produce anything PASS/FINAL/certified-
// shaped. Its output domain has no field for "the executor's own
// conclusion" beyond IMPLEMENTED_AND_VALIDATED / HOLD / FAIL -- exactly
// executor-auditor-gate.mjs's finalizeExecutorResult pattern, generalized
// to Task 2's 4-role vocabulary (IMPLEMENTED_AND_VALIDATED replaces
// IMPLEMENTATION_COMPLETE_AWAITING_INDEPENDENT_AUDIT as the max result A
// may ever declare).
// ---------------------------------------------------------------------------

export const EXECUTOR_RESULT_STATES = Object.freeze(['IMPLEMENTED_AND_VALIDATED', 'HOLD', 'FAIL']);

/**
 * @param {object} input
 * @param {string} input.state must be one of EXECUTOR_RESULT_STATES
 * @param {string} input.executorRole
 * @param {string} input.baseSha
 * @param {string} input.headSha
 * @param {string[]} [input.filesChanged]
 * @param {{run: number, pass: number, fail: number}} [input.tests]
 * @param {string[]} [input.knownLimitations]
 */
export function finalizeExecutorResult(input) {
  const state = input?.state;
  if (!EXECUTOR_RESULT_STATES.includes(state)) {
    throw new SelfCertificationForbiddenError(
      `Executor (A) attempted to finalize with state ${JSON.stringify(state)}, outside EXECUTOR_RESULT_STATES `
      + `(${EXECUTOR_RESULT_STATES.join(', ')}). A can never produce FINAL_PASS/AUDIT_PASS/SAFE_TO_MERGE for its own `
      + 'work -- only certifyAuditResult (B) and certifyByValidator (C) can move a task toward a human gate.',
    );
  }
  return Object.freeze({
    role: 'executor',
    executorRole: input?.executorRole ?? null,
    state,
    baseSha: typeof input?.baseSha === 'string' ? input.baseSha : null,
    headSha: typeof input?.headSha === 'string' ? input.headSha : null,
    filesChanged: Array.isArray(input?.filesChanged) ? Object.freeze([...input.filesChanged]) : Object.freeze([]),
    tests: input?.tests && typeof input.tests === 'object'
      ? Object.freeze({ run: Number(input.tests.run) || 0, pass: Number(input.tests.pass) || 0, fail: Number(input.tests.fail) || 0 })
      : Object.freeze({ run: 0, pass: 0, fail: 0 }),
    knownLimitations: Array.isArray(input?.knownLimitations) ? Object.freeze([...input.knownLimitations]) : Object.freeze([]),
  });
}

// ---------------------------------------------------------------------------
// Handoff envelope -- a compact, closed-field contract for every role
// transition (A->B, B->A, B->C). Malformed shape is rejected outright, not
// silently coerced -- exactly claim-taxonomy.mjs's own "present but wrong
// type is malformed, not empty" philosophy.
// ---------------------------------------------------------------------------

const HANDOFF_FIELDS = new Set([
  'taskId', 'from', 'to', 'baseSha', 'headSha', 'filesChanged', 'testSummary',
  'ciStatus', 'riskSurfaces', 'productionImpact', 'knownFindings', 'nextAction',
]);

/**
 * @param {object} raw
 * @returns {{valid: boolean, reason: string|null}}
 */
export function validateHandoffEnvelope(raw, { expectedFrom, expectedTo } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'HANDOFF_NOT_AN_OBJECT' };
  }
  const keys = Object.keys(raw);
  if (!keys.every((k) => HANDOFF_FIELDS.has(k))) {
    return { valid: false, reason: 'HANDOFF_UNEXPECTED_FIELD' };
  }
  if (typeof raw.taskId !== 'string' || raw.taskId.length === 0) return { valid: false, reason: 'HANDOFF_MISSING_TASK_ID' };
  if (!ROLES.includes(raw.from)) return { valid: false, reason: 'HANDOFF_INVALID_FROM' };
  if (raw.to !== 'HUMAN_GATE' && !ROLES.includes(raw.to)) return { valid: false, reason: 'HANDOFF_INVALID_TO' };
  if (typeof raw.baseSha !== 'string' || raw.baseSha.length === 0) return { valid: false, reason: 'HANDOFF_MISSING_BASE_SHA' };
  if (typeof raw.headSha !== 'string' || raw.headSha.length === 0) return { valid: false, reason: 'HANDOFF_MISSING_HEAD_SHA' };
  if (raw.filesChanged !== undefined && !Array.isArray(raw.filesChanged)) return { valid: false, reason: 'HANDOFF_MALFORMED_FILES_CHANGED' };
  if (raw.riskSurfaces !== undefined && !Array.isArray(raw.riskSurfaces)) return { valid: false, reason: 'HANDOFF_MALFORMED_RISK_SURFACES' };
  if (raw.knownFindings !== undefined && !Array.isArray(raw.knownFindings)) return { valid: false, reason: 'HANDOFF_MALFORMED_KNOWN_FINDINGS' };
  if (raw.productionImpact !== undefined && typeof raw.productionImpact !== 'boolean') return { valid: false, reason: 'HANDOFF_MALFORMED_PRODUCTION_IMPACT' };
  try {
    validateRoleTransition({ fromRole: raw.from, toRole: raw.to });
  } catch {
    return { valid: false, reason: 'HANDOFF_INVALID_ROLE_TRANSITION' };
  }
  if (expectedFrom !== undefined && raw.from !== expectedFrom) return { valid: false, reason: 'HANDOFF_FROM_MISMATCH' };
  if (expectedTo !== undefined && raw.to !== expectedTo) return { valid: false, reason: 'HANDOFF_TO_MISMATCH' };
  return { valid: true, reason: null };
}

/**
 * Build a well-formed handoff envelope. Pure convenience -- callers may
 * also construct the plain object directly, but going through this ensures
 * the field set stays exactly HANDOFF_FIELDS.
 */
export function buildHandoffEnvelope({
  taskId, from, to, baseSha, headSha, filesChanged = [], testSummary = null,
  ciStatus = null, riskSurfaces = [], productionImpact = false, knownFindings = [], nextAction = null,
}) {
  const envelope = {
    taskId, from, to, baseSha, headSha,
    filesChanged: [...filesChanged],
    testSummary,
    ciStatus,
    riskSurfaces: [...riskSurfaces],
    productionImpact,
    knownFindings: [...knownFindings],
    nextAction,
  };
  const { valid, reason } = validateHandoffEnvelope(envelope);
  if (!valid) {
    throw new Error(`buildHandoffEnvelope produced an invalid envelope: ${reason}`);
  }
  return Object.freeze(envelope);
}

// ---------------------------------------------------------------------------
// Unforgeable attestation of an auditor (B) result -- a module-private,
// unexported WeakSet, exactly evidence-policy.mjs's TRUSTED_EVIDENCE_REGISTRY
// / red-team-gate.mjs's TRUSTED_RED_TEAM_RESULT_REGISTRY pattern,
// reimplemented locally (not imported) so this module owns its own trust
// boundary independent of those already-hardened files. Membership means,
// unforgeably, "this exact object was really produced by a real call to
// certifyAuditResult in this process" -- never "this object happens to have
// the right shape."
// ---------------------------------------------------------------------------

const TRUSTED_AUDITOR_RESULT_REGISTRY = new WeakSet();

export function isAttestedAuditorResult(candidate) {
  return typeof candidate === 'object' && candidate !== null && TRUSTED_AUDITOR_RESULT_REGISTRY.has(candidate);
}

// ---------------------------------------------------------------------------
// B — AUDITOR. The only function able to grant a PASS-shaped auditor
// result. Findings must be explicit; a P0/P1 finding is blocking UNLESS
// explicitly and validly downgraded -- omission defaults to blocking,
// mirroring red-team-gate.mjs's own "unset severity on a finding defaults
// to blocking" philosophy (never "probably fine").
// ---------------------------------------------------------------------------

export const AUDITOR_RESULT_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS', 'HOLD', 'HOLD_FOR_REMEDIATION']);
const AUDITOR_PASS_SHAPED_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS']);
export const FINDING_SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

export const AUDIT_HOLD_REASONS = Object.freeze([
  'HOLD_INDEPENDENT_AUDIT_REQUIRED',
  'HOLD_BLOCKING_FINDING',
  'HOLD_MALFORMED_FINDINGS_SHAPE',
  'HOLD_MALFORMED_FINDING_SEVERITY',
  'HOLD_MALFORMED_EVIDENCE_SHAPE',
]);

// Remediation (Task 2, B audit Round 1, P0): `isFindingBlocking` used to
// fall through to `return false` (never blocking) for ANY severity value
// outside 'P0'/'P1'/'P2' -- which meant a typo ('p0', 'P1 '), an
// unrecognized value ('P4', 'UNKNOWN'), or a missing severity (null/
// undefined) all silently became non-blocking. Reproduced live by the
// audit across 7 malformed variants, every one certifying PASS. Fixed by
// making severity validity a precondition checked BEFORE blocking status
// is ever computed -- see the isValidFindingSeverity check in
// certifyAuditResult below, which forces HOLD_MALFORMED_FINDING_SEVERITY
// before isFindingBlocking is ever called on a malformed entry, exactly
// mirroring how HOLD_MALFORMED_FINDINGS_SHAPE already gates array-shape
// validity before iterating.
function isValidFindingSeverity(severity) {
  return FINDING_SEVERITIES.includes(severity);
}

function isFindingBlocking(finding) {
  const severity = finding?.severity;
  if (severity === 'P0' || severity === 'P1') {
    // A P0/P1 is blocking unless explicitly, validly marked blocking:false
    // AND that downgrade itself is not itself the thing being audited --
    // in practice this project has never downgraded a real P0/P1, but the
    // rule is here, fail-closed by default, rather than assumed.
    return finding.blocking !== false;
  }
  if (severity === 'P2') return finding?.blocking === true;
  return false; // P3 never blocks on its own; any other value is rejected
  // upstream by isValidFindingSeverity before this function is ever called.
}

/**
 * @param {object} input
 * @param {string} input.executorRole identity of the role whose work is under review
 * @param {string} input.auditorRole identity of THIS review — must differ from executorRole (normalized comparison)
 * @param {string} input.headSha the exact commit this audit was performed against
 * @param {string} input.requestedState one of AUDITOR_RESULT_STATES
 * @param {Array<{id?: string, severity: string, summary: string, blocking?: boolean}>} [input.findings]
 * @param {Array} [input.evidence] claim-taxonomy.mjs-shaped claims backing this decision
 */
export function certifyAuditResult(input) {
  const executorRole = input?.executorRole;
  const auditorRole = input?.auditorRole;
  const requestedState = input?.requestedState;
  const headSha = typeof input?.headSha === 'string' && input.headSha.length > 0 ? input.headSha : null;
  const rawFindings = input?.findings;
  const findingsShapeValid = rawFindings === undefined || Array.isArray(rawFindings);
  const findings = Array.isArray(rawFindings) ? rawFindings : [];
  // Remediation (Task 2, B audit Round 1, P1): `evidence` used to be
  // silently coerced to [] when present-but-malformed (a string, a number,
  // a bare object instead of an array), discarding it instead of forcing
  // HOLD -- inconsistent with `findings`' own already-correct handling just
  // above, and with this whole module's stated "malformed shape is
  // rejected outright, not silently coerced" philosophy. Now mirrors
  // findingsShapeValid exactly.
  const rawEvidence = input?.evidence;
  const evidenceShapeValid = rawEvidence === undefined || Array.isArray(rawEvidence);
  const evidenceClaims = Array.isArray(rawEvidence) ? rawEvidence : [];
  const evidenceResult = classifyClaimSet(evidenceClaims);

  const independent = identitiesAreIndependent(executorRole, auditorRole);
  const base = { role: 'auditor', executorRole, auditorRole, headSha, requestedState, independent, findings: Object.freeze([...findings]), evidence: evidenceResult };

  if (!independent) {
    return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_INDEPENDENT_AUDIT_REQUIRED' });
  }
  if (!AUDITOR_RESULT_STATES.includes(requestedState)) {
    return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'INVALID_REQUESTED_STATE' });
  }
  if (!headSha) {
    return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_MISSING_HEAD_SHA' });
  }

  if (AUDITOR_PASS_SHAPED_STATES.includes(requestedState)) {
    if (!findingsShapeValid) {
      return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_MALFORMED_FINDINGS_SHAPE' });
    }
    if (!evidenceShapeValid) {
      return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_MALFORMED_EVIDENCE_SHAPE' });
    }
    if (findings.some((f) => !isValidFindingSeverity(f?.severity))) {
      return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_MALFORMED_FINDING_SEVERITY' });
    }
    if (findings.some(isFindingBlocking)) {
      return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_BLOCKING_FINDING' });
    }
    if (evidenceResult.anyHold) {
      return buildAuditorResult({ ...base, finalState: 'HOLD', reason: 'HOLD_UNPROVEN_PRODUCTION_CLAIM' });
    }
  }

  return buildAuditorResult({ ...base, finalState: requestedState, reason: 'REQUESTED_STATE_GRANTED' });
}

function buildAuditorResult({ role, executorRole, auditorRole, headSha, requestedState, independent, findings, evidence, finalState, reason }) {
  const result = Object.freeze({
    role, executorRole, auditorRole, headSha, requestedState, independent, findings, evidence, finalState, reason,
  });
  // Attest ANY outcome (HOLD included) -- C needs to be able to trust a
  // genuine HOLD/HOLD_FOR_REMEDIATION result too (e.g. to confirm a blocker
  // is real and not fabricated in either direction), not only a PASS.
  TRUSTED_AUDITOR_RESULT_REGISTRY.add(result);
  return result;
}

// ---------------------------------------------------------------------------
// C — VALIDATOR. The only function able to certify a task ready for the
// human gate. Requires: a genuinely attested (not hand-fabricated) auditor
// result; that result's own headSha to equal the CURRENT head (HEAD drift
// since B's audit => HOLD); CI evidence bound to that SAME exact head
// (evidence from a different SHA is rejected, never substituted); the
// auditor's own finalState to itself be PASS-shaped (an unresolved blocker
// can never be certified around); and validatorRole independent of
// executorRole.
// ---------------------------------------------------------------------------

export const VALIDATOR_RESULT_STATES = Object.freeze(['PASS', 'HOLD']);

export const VALIDATION_HOLD_REASONS = Object.freeze([
  'HOLD_INDEPENDENT_VALIDATION_REQUIRED',
  'HOLD_AUDIT_RESULT_NOT_ATTESTED',
  'HOLD_AUDIT_ATTESTATION_EXPIRED',
  'HOLD_HEAD_DRIFT_SINCE_AUDIT',
  'HOLD_CI_SHA_MISMATCH',
  'HOLD_CI_NOT_SUCCESS',
  'HOLD_UNRESOLVED_BLOCKER',
]);

// ---------------------------------------------------------------------------
// Remediation (Task 2, B audit Round 1, P1 WEAKSET_RESTART_RECOVERY):
//
// SECURITY INVARIANT (unchanged, deliberately): serialized/persisted JSON
// is NEVER automatically trusted. `isAttestedAuditorResult` still means,
// unforgeably, "this exact object identity was really produced by a real
// certifyAuditResult() call IN THIS LIVE PROCESS" -- a fabricated object,
// a spread-copy, and a JSON round-trip of a genuine result are ALL
// rejected identically by `certifyByValidator`, on purpose. This
// remediation adds a RECOVERY PATH on top of that invariant; it does not
// weaken it. There is no `attest(serializedObject)` function anywhere in
// this module, and there must never be one -- see COMMON_AGENT_PROTOCOL.md.
//
// OPERABILITY GAP THIS CLOSES: the audit reproduced, across two real
// separate Node processes, that a LEGITIMATE B result -- genuinely
// produced, genuinely persisted via protocol-state.mjs's own atomic-write
// mechanism -- loses its live WeakSet attestation the moment the process
// that produced it exits. Before this fix, `certifyByValidator` reported
// `HOLD_AUDIT_RESULT_NOT_ATTESTED` for this case, INDISTINGUISHABLE from
// outright fabrication, with no path forward. `classifyAuditorResultTrust`
// below distinguishes "this looks like it MIGHT be a legitimate result
// that lost its live attestation" (shape-plausible: has the exact field
// set/types buildAuditorResult always sets) from "this is not even
// shape-plausible" (definitely not a real result, live or persisted) --
// this classification NEVER grants trust by itself; it only gives NIGHT/C
// an ACTIONABLE reason to route back to B for a fresh, REAL re-audit
// (`READY_FOR_B`, now a valid transition NIGHT may make directly from
// HOLD -- see STATE_TRANSITION_TABLE above), rather than a dead end. The
// re-audit IS `certifyAuditResult` called again, for real, by B, observing
// the CURRENT actual head and CURRENT actual findings/evidence -- exactly
// what "re-attestation" means; no separate re-attestation function exists
// because none is needed; the existing certifyAuditResult already does
// this correctly whenever a caller (B) genuinely re-invokes it.
// ---------------------------------------------------------------------------

/**
 * @param {unknown} candidate
 * @returns {boolean} true only for a plain object carrying the exact field
 *   shape buildAuditorResult always sets — NEVER a trust signal by itself,
 *   only used to distinguish "plausibly a persisted, once-legitimate
 *   result" from "not even shape-plausible" for routing purposes.
 */
function looksLikeAuditorResultShape(candidate) {
  return candidate !== null && typeof candidate === 'object'
    && candidate.role === 'auditor'
    && typeof candidate.headSha === 'string' && candidate.headSha.length > 0
    && AUDITOR_RESULT_STATES.includes(candidate.finalState)
    && Array.isArray(candidate.findings);
}

/**
 * @param {unknown} candidate
 * @returns {'LIVE_ATTESTATION'|'PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION'|'UNRECOGNIZED'}
 */
export function classifyAuditorResultTrust(candidate) {
  if (isAttestedAuditorResult(candidate)) return 'LIVE_ATTESTATION';
  if (looksLikeAuditorResultShape(candidate)) return 'PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION';
  return 'UNRECOGNIZED';
}

/**
 * @param {object} input
 * @param {string} input.executorRole
 * @param {string} input.validatorRole
 * @param {string} input.currentHeadSha the CURRENT canonical HEAD, observed by C itself (e.g. via `git rev-parse`/`gh pr view`), never taken on faith from a report
 * @param {object} input.attestedAuditorResult the object certifyAuditResult returned -- must pass isAttestedAuditorResult
 * @param {string|null} [input.ciHeadSha] the head SHA the CI evidence C observed actually belongs to
 * @param {'SUCCESS'|'FAILURE'|'WAITING_CI'|null} [input.ciStatus]
 */
export function certifyByValidator(input) {
  const executorRole = input?.executorRole;
  const validatorRole = input?.validatorRole;
  const currentHeadSha = typeof input?.currentHeadSha === 'string' && input.currentHeadSha.length > 0 ? input.currentHeadSha : null;
  const attestedAuditorResult = input?.attestedAuditorResult;
  const ciHeadSha = typeof input?.ciHeadSha === 'string' && input.ciHeadSha.length > 0 ? input.ciHeadSha : null;
  const ciStatus = input?.ciStatus ?? null;

  const independent = identitiesAreIndependent(executorRole, validatorRole);
  const base = { role: 'validator', executorRole, validatorRole, currentHeadSha, ciHeadSha, ciStatus, independent };

  if (!independent) {
    return { ...base, finalState: 'HOLD', reason: 'HOLD_INDEPENDENT_VALIDATION_REQUIRED' };
  }
  const trust = classifyAuditorResultTrust(attestedAuditorResult);
  if (trust !== 'LIVE_ATTESTATION') {
    // Same refusal either way -- PASS is never granted from anything short
    // of a real, live attestation -- but the reason differs so NIGHT/C has
    // an actionable signal: a shape-plausible-but-unattested result (most
    // likely a legitimately-persisted summary that crossed a process
    // boundary) should route back to B for a fresh re-audit
    // (HOLD -> READY_FOR_B, see STATE_TRANSITION_TABLE); something not even
    // shape-plausible is not a recovery case at all.
    const reason = trust === 'PERSISTED_AUDIT_SUMMARY_REQUIRES_REATTESTATION'
      ? 'HOLD_AUDIT_ATTESTATION_EXPIRED'
      : 'HOLD_AUDIT_RESULT_NOT_ATTESTED';
    return { ...base, finalState: 'HOLD', reason };
  }
  if (!currentHeadSha || attestedAuditorResult.headSha !== currentHeadSha) {
    return { ...base, finalState: 'HOLD', reason: 'HOLD_HEAD_DRIFT_SINCE_AUDIT' };
  }
  if (ciHeadSha !== currentHeadSha) {
    return { ...base, finalState: 'HOLD', reason: 'HOLD_CI_SHA_MISMATCH' };
  }
  if (ciStatus === 'WAITING_CI') {
    return { ...base, finalState: 'HOLD', reason: 'WAITING_CI' };
  }
  if (ciStatus !== 'SUCCESS') {
    return { ...base, finalState: 'HOLD', reason: 'HOLD_CI_NOT_SUCCESS' };
  }
  if (attestedAuditorResult.finalState !== 'PASS' && attestedAuditorResult.finalState !== 'PASS_WITH_FINDINGS') {
    return { ...base, finalState: 'HOLD', reason: 'HOLD_UNRESOLVED_BLOCKER' };
  }

  return { ...base, finalState: 'PASS', reason: 'CERTIFIED', auditorFinalState: attestedAuditorResult.finalState };
}

// ---------------------------------------------------------------------------
// CI evidence classification. Pure -- takes a status/conclusion snapshot,
// returns a classification. The "no long polling" consumption rule is
// PROCEDURAL, not something a pure function can enforce: this function has
// no side effects and cannot stop a caller from calling it in a loop. What
// IT enforces is that a non-'completed' status is NEVER treated as
// 'SUCCESS' by omission -- the only way to reach 'SUCCESS' is an explicit
// completed+success snapshot.
// ---------------------------------------------------------------------------

export function classifyCiWaitStatus({ status, conclusion }) {
  if (status !== 'completed') return 'WAITING_CI';
  return conclusion === 'success' ? 'SUCCESS' : 'FAILURE';
}

// ---------------------------------------------------------------------------
// Command risk + human-gate rules. evaluateCommandSafety is REUSED
// verbatim, not reimplemented -- UNKNOWN/DESTRUCTIVE/PRODUCTION_MUTATION
// already can never become `authorized: true` under any input in that
// module; this function only adds the HUMAN_GATE_TYPE mapping on top.
//
// Remediation (Task 2, B audit Round 1, P2 B_C_MUTATION_ENFORCEMENT): the
// audit correctly distinguished two different claims that the original
// header comment conflated -- "cannot physically block a Bash call without
// an OS/tool-level hook" (true, genuinely out of scope) from "cannot even
// provide a protocol-DECISION-layer check" (false: a pure function
// combining ACTIVE_ROLE with the already-computed command classification
// is exactly as practical as everything else in this module). `roleAuthorized`
// below is that decision-layer check -- NOT a sandbox, NOT enforced by
// anything that could stop a caller from running a command anyway. It
// deliberately never touches `evaluation.authorized` (command-safety.mjs's
// own, unchanged meaning) so A's existing use of this function is
// completely unaffected by activeRole being absent/'A'/'NIGHT'.
// ---------------------------------------------------------------------------

const AUDIT_VALIDATE_ROLES = Object.freeze(['B', 'C']);

export function evaluateCommandRiskGate(input) {
  const evaluation = evaluateCommandSafety(input);
  let humanGateType = null;
  if (evaluation.commandSafetyClass === 'PRODUCTION_MUTATION') humanGateType = 'PRODUCTION_ACTION';
  else if (evaluation.commandSafetyClass === 'DESTRUCTIVE') humanGateType = 'DESTRUCTIVE_ACTION';
  else if (evaluation.commandSafetyClass === 'UNKNOWN') humanGateType = 'UNKNOWN_COMMAND_CLASS';

  const activeRole = input?.activeRole ?? null;
  // While auditing/validating, B and C have no legitimate reason to mutate
  // anything, local or remote -- only READ_ONLY is role-authorized. NIGHT,
  // A, and an unspecified/absent activeRole are unaffected: this gate
  // simply has no opinion for them (roleAuthorized: true unconditionally),
  // deferring entirely to evaluation.authorized.
  const roleAuthorized = AUDIT_VALIDATE_ROLES.includes(activeRole)
    ? evaluation.commandSafetyClass === 'READ_ONLY'
    : true;

  return { ...evaluation, humanGateRequired: humanGateType !== null, humanGateType, activeRole, roleAuthorized };
}

// requiresHumanGateForAction: deliberately has NO parameter that could ever
// let a caller bypass this for MARK_READY/MERGE -- mirrors
// finalizeExecutorResult's "no field exists for the executor's own
// conclusion" principle. This is the code-level form of the brief's
// "FINAL OPERATOR GATE": even a certifyByValidator PASS never implies
// authorization for either action.
export function requiresHumanGateForAction(actionType) {
  if (!HUMAN_GATE_TYPES.includes(actionType)) {
    throw new Error(`requiresHumanGateForAction: unrecognized actionType ${JSON.stringify(actionType)}`);
  }
  // Every recognized action type in this closed enum requires a human gate,
  // unconditionally. There is no action type in HUMAN_GATE_TYPES that does
  // not.
  return true;
}

// ---------------------------------------------------------------------------
// Explicitly NOT machine-enforced, and why (per this task's own
// instruction: "if a rule cannot reasonably be machine-enforced, document
// exactly why"):
//
// "B cannot mutate while auditing" — there is no OS-level or tool-level
// permission boundary between roles in the single-chat model (unlike
// night-guard.mjs's DEFAULT_DENY hook, which really does sit between an
// autonomous CHILD PROCESS and its Bash/Write/Edit tool calls). Enforcing
// this mechanically here would require the SAME kind of PreToolUse hook
// night-guard.mjs uses, but scoped to "is the active role currently B" —
// which is out of this task's scope (it would mean hooking the operator's
// own interactive session, not an autonomous child, a materially different
// and much more invasive mechanism). The mitigation actually in place is
// procedural: certifyAuditResult/certifyByValidator require an
// INDEPENDENT, DIFFERENTLY-LABELED role to have produced the result being
// certified, and every finding/evidence claim funnels through
// classifyClaimSet's existing fail-closed rules — so even if role
// discipline were violated, a HOLD-worthy fact cannot be certified away
// by relabeling. Documented as a known, permanent limitation of the
// single-chat model, not silently assumed solved.
// ---------------------------------------------------------------------------
