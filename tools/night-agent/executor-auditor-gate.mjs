// Korixa Night Agent — Executor <> Independent Auditor Certification Gate
// (NIGHT_HARDENING_1, 2026-08-22).
//
// This project already follows this rule BY HAND, consistently, across every
// T-F1.2 KORIXA_* task in this repo's real history: the actor that
// implements a change never gets to certify it as finally correct — a
// separate, independent, adversarial pass always has to run first (see e.g.
// PR68/PR70/PR72's "implement -> independent re-audit -> precheck -> merge"
// cycle). `.claude/agents/night-builder.md` / `night-auditor.md` already
// state this as PROMPT discipline (night-builder.md: "Never declares final
// PASS ... that word is reserved for the Auditor's independent judgment").
//
// This module makes it a fact a caller cannot route around by simply writing
// the word PASS in the right place, regardless of which persona/prompt/agent
// invoked it:
//
//   - finalizeExecutorResult can NEVER return anything PASS-shaped. Its
//     output domain (EXECUTOR_RESULT_STATES) structurally excludes PASS; a
//     caller who asks for anything outside that domain gets a thrown
//     SelfCertificationForbiddenError, not a silently-substituted safe
//     value — the misuse must be loud, not quietly corrected.
//
//   - certifyIndependentAuditResult is the ONLY function in this codebase
//     capable of returning a PASS-shaped result, and it refuses to unless
//     ALL of the following independently hold:
//       1. the caller can show a genuinely distinct auditor identity
//          (auditorContextId !== executorContextId, both non-empty) --
//          otherwise HOLD_INDEPENDENT_AUDIT_REQUIRED;
//       2. a completed, non-blocking red-team phase result is attached (see
//          red-team-gate.mjs's runRedTeamPhase) -- otherwise
//          HOLD_RED_TEAM_NOT_RUN / HOLD_RED_TEAM_BLOCKING_FINDING;
//       3. every evidence citation offered for the claim classifies as
//          PROCEED under claim-taxonomy.mjs's fail-closed
//          UNPROVEN+production-impact rule -- otherwise
//          HOLD_UNPROVEN_PRODUCTION_CLAIM.
//     The function's parameter list has no field for "the executor's own
//     conclusion" or "a free-text summary" at all -- there is structurally
//     nothing for such text to attach itself to, so it cannot influence the
//     outcome no matter what a caller names the field it tries to pass.
//
// Neither function performs any I/O, spawns any process, or touches the
// filesystem/network — this is pure decision logic over caller-supplied
// data, exactly like evidence-policy.mjs's own evaluateClaimCore. Wiring
// these functions into the real runner.mjs execution path is explicitly OUT
// OF SCOPE for this revision (NIGHT_HARDENING_1) — see this revision's own
// task framing ("Fase 6 — No aumentar autonomía todavía"); these are tested,
// standalone gates ready for a future, separately-authorized wiring task.
//
// DISCLOSED TRUST BOUNDARY (flagged by this revision's own independent
// audit, not yet closed — deliberately, see below): `redTeamPhaseResult` and
// each `evidenceCitations[]` entry are trusted by SHAPE alone. Nothing in
// this module verifies that a `{completed: true, blocking: false, ...}`
// object actually came from a real `runRedTeamPhase()` call, or that a
// `PROVEN_BY_LIVE_READ_ONLY` evidence citation actually came from a real
// observation rather than being hand-typed by whatever caller invokes this
// function. This project's own `evidence-policy.mjs` established the
// correct answer to exactly this class of risk — a WeakSet-branded,
// unforgeable `TRUSTED_EVIDENCE_REGISTRY` that only real attestation
// functions can populate — and this module deliberately does NOT reuse or
// reimplement that machinery here, because nothing calls this module yet
// (see "OUT OF SCOPE" above): there is no live path today for a caller to
// exploit shape-only trust, since no caller exists. This is safe to leave
// disclosed-but-open for a not-yet-wired module and unsafe to leave open
// once a real wiring task hands these functions real, potentially
// LLM-authored input — closing this gap (via the same WeakSet-branding
// pattern, or an equivalent) MUST be part of that future wiring task, not
// assumed already covered by this module's current test suite.

import { classifyClaimSet } from './claim-taxonomy.mjs';

// ---------------------------------------------------------------------------
// Executor side.
// ---------------------------------------------------------------------------

export class SelfCertificationForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelfCertificationForbiddenError';
  }
}

// Deliberately excludes anything PASS-shaped. This is the entire mechanism:
// an Executor result can only ever be one of these three values.
export const EXECUTOR_RESULT_STATES = Object.freeze([
  'IMPLEMENTATION_COMPLETE_AWAITING_INDEPENDENT_AUDIT',
  'HOLD',
  'FAIL',
]);

/**
 * @param {object} input
 * @param {string} input.state - must be one of EXECUTOR_RESULT_STATES.
 * @param {string} [input.baseSha]
 * @param {string} [input.headSha]
 * @param {string[]} [input.filesChanged]
 * @param {{run: number, pass: number, fail: number}} [input.tests]
 * @param {string[]} [input.knownUnproven]
 * @param {string[]} [input.knownLimitations]
 */
export function finalizeExecutorResult(input) {
  const state = input?.state;
  if (!EXECUTOR_RESULT_STATES.includes(state)) {
    throw new SelfCertificationForbiddenError(
      `Executor attempted to finalize with state ${JSON.stringify(state)}, which is not in EXECUTOR_RESULT_STATES `
      + `(${EXECUTOR_RESULT_STATES.join(', ')}). The Executor can never produce a final PASS-shaped result for its `
      + 'own work -- only an independent auditor can, via certifyIndependentAuditResult.',
    );
  }

  return Object.freeze({
    role: 'executor',
    state,
    baseSha: typeof input?.baseSha === 'string' ? input.baseSha : null,
    headSha: typeof input?.headSha === 'string' ? input.headSha : null,
    filesChanged: Array.isArray(input?.filesChanged) ? Object.freeze([...input.filesChanged]) : Object.freeze([]),
    tests: input?.tests && typeof input.tests === 'object'
      ? Object.freeze({ run: Number(input.tests.run) || 0, pass: Number(input.tests.pass) || 0, fail: Number(input.tests.fail) || 0 })
      : Object.freeze({ run: 0, pass: 0, fail: 0 }),
    knownUnproven: Array.isArray(input?.knownUnproven) ? Object.freeze([...input.knownUnproven]) : Object.freeze([]),
    knownLimitations: Array.isArray(input?.knownLimitations) ? Object.freeze([...input.knownLimitations]) : Object.freeze([]),
  });
}

// ---------------------------------------------------------------------------
// Auditor side.
// ---------------------------------------------------------------------------

export const AUDITOR_RESULT_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS', 'HOLD', 'RETRY', 'FAIL']);
const PASS_SHAPED_STATES = Object.freeze(['PASS', 'PASS_WITH_FINDINGS']);

// Every possible forcing reason this function can produce, for tests/callers
// to assert against by name rather than by string-matching prose.
export const AUDIT_HOLD_REASONS = Object.freeze([
  'INVALID_REQUESTED_STATE',
  'HOLD_INDEPENDENT_AUDIT_REQUIRED',
  'HOLD_INVALID_EVIDENCE_CITATIONS_SHAPE',
  'HOLD_RED_TEAM_NOT_RUN',
  'HOLD_RED_TEAM_BLOCKING_FINDING',
  'HOLD_UNPROVEN_PRODUCTION_CLAIM',
]);

/**
 * @param {object} input
 * @param {string} input.requestedState - one of AUDITOR_RESULT_STATES.
 * @param {string} input.executorContextId - identity of the session/context that produced the work under review.
 * @param {string} input.auditorContextId - identity of THIS review's session/context. Must differ from executorContextId.
 * @param {Array} [input.evidenceCitations] - claim-taxonomy.mjs claim objects backing this decision.
 * @param {object} [input.redTeamPhaseResult] - the return value of red-team-gate.mjs's runRedTeamPhase.
 * @param {Array} [input.findings] - free-form findings list, carried through for reporting only; never itself a source of authority.
 */
export function certifyIndependentAuditResult(input) {
  const requestedState = input?.requestedState;
  const executorContextId = typeof input?.executorContextId === 'string' && input.executorContextId.length > 0 ? input.executorContextId : null;
  const auditorContextId = typeof input?.auditorContextId === 'string' && input.auditorContextId.length > 0 ? input.auditorContextId : null;
  // NIGHT_HARDENING_1-R2: `evidenceCitations` PRESENT but not an array (e.g.
  // a single citation object passed bare instead of wrapped in `[...]`) is a
  // malformed input shape, not "zero citations" -- silently coercing it to
  // [] would let a claim's evidence disappear entirely from consideration
  // and PASS trivially with nothing to check. Genuinely absent/undefined
  // `evidenceCitations` remains a normal, valid "no citations offered" case.
  const rawEvidenceCitations = input?.evidenceCitations;
  const evidenceCitationsShapeValid = rawEvidenceCitations === undefined || Array.isArray(rawEvidenceCitations);
  const evidenceCitations = Array.isArray(rawEvidenceCitations) ? rawEvidenceCitations : [];
  const redTeamPhaseResult = input?.redTeamPhaseResult;
  const findings = Array.isArray(input?.findings) ? Object.freeze([...input.findings]) : Object.freeze([]);

  const claimSet = classifyClaimSet(evidenceCitations);

  // Evaluated in this fixed order; the FIRST forcing condition to trigger
  // wins and its reason is reported -- but note independence (2) is checked
  // before anything else that depends on the request even being PASS-shaped,
  // because a self-audited HOLD is *also* not a real independent audit and
  // callers should not be able to hide that behind an otherwise-conservative
  // requestedState.
  if (!AUDITOR_RESULT_STATES.includes(requestedState)) {
    return buildResult({ finalState: 'HOLD', reason: 'INVALID_REQUESTED_STATE', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
  }

  if (!executorContextId || !auditorContextId || auditorContextId === executorContextId) {
    return buildResult({ finalState: 'HOLD', reason: 'HOLD_INDEPENDENT_AUDIT_REQUIRED', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
  }

  if (PASS_SHAPED_STATES.includes(requestedState)) {
    if (!evidenceCitationsShapeValid) {
      return buildResult({ finalState: 'HOLD', reason: 'HOLD_INVALID_EVIDENCE_CITATIONS_SHAPE', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
    }
    if (!redTeamPhaseResult || redTeamPhaseResult.completed !== true) {
      return buildResult({ finalState: 'HOLD', reason: 'HOLD_RED_TEAM_NOT_RUN', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
    }
    if (redTeamPhaseResult.blocking === true) {
      return buildResult({ finalState: 'HOLD', reason: 'HOLD_RED_TEAM_BLOCKING_FINDING', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
    }
    if (claimSet.anyHold) {
      return buildResult({ finalState: 'HOLD', reason: 'HOLD_UNPROVEN_PRODUCTION_CLAIM', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
    }
  }

  return buildResult({ finalState: requestedState, reason: 'REQUESTED_STATE_GRANTED', requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings });
}

function buildResult({ finalState, reason, requestedState, executorContextId, auditorContextId, claimSet, redTeamPhaseResult, findings }) {
  return Object.freeze({
    role: 'independent_auditor',
    requestedState: requestedState ?? null,
    finalState,
    reason,
    independent: Boolean(executorContextId && auditorContextId && executorContextId !== auditorContextId),
    executorContextId,
    auditorContextId,
    evidence: claimSet,
    redTeamPhaseResult: redTeamPhaseResult ?? null,
    findings,
  });
}
