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
// TRUST BOUNDARY — `redTeamPhaseResult` (Phase 1B, Section 4/8, CLOSED for
// this half): this module now requires `redTeamPhaseResult` to be an object
// identity that was really returned by a real `red-team-gate.mjs`
// `runRedTeamPhase()` call in this process — see `isAttestedRedTeamPhaseResult`
// (imported from red-team-gate.mjs, itself a module-private, unexported
// WeakSet keyed on object identity, mirroring evidence-policy.mjs's own
// `TRUSTED_EVIDENCE_REGISTRY` pattern exactly as this revision's prior audit
// required). A hand-fabricated `{completed:true, blocking:false, ...}`
// object — even one that is a byte-for-byte, deep-cloned copy of a genuine
// result — fails the identity check and is rejected with
// `HOLD_RED_TEAM_RESULT_NOT_ATTESTED`, indistinguishable in effect from
// never having run the red-team phase at all.
//
// TRUST BOUNDARY — `evidenceCitations[]` (REMAINS PARTIALLY OPEN, by
// necessity, not oversight): each citation's `evidenceLevel` (e.g.
// `PROVEN_BY_LIVE_READ_ONLY`) is still trusted by the CALLER's say-so as
// input to classifyClaimSet — this module has no way to independently verify
// that a claim string was really observed live rather than hand-typed,
// because unlike a red-team verdict (which this module's own dependency,
// red-team-gate.mjs, can itself produce and brand) an evidence citation's
// truth is a fact about the outside world that only a real attestation
// (evidence-policy.mjs's `attestRemoteMainEvidence` /
// `attestFilesystemEvidence` / `attestLocalRuntimeEvidence` /
// `attestRemoteRuntimeEvidence`, or an equivalent) can establish, and that is
// deliberately a separate module's job (see claim-taxonomy.mjs's own header:
// "the two modules can be wired together by a future caller"). The mitigation
// that IS in place: the real wiring (`runner.mjs`'s
// `auditAndCertifyGreenTaskResult`) never lets the spawned Executor child
// supply its own evidenceCitations — every citation passed to this module
// from the real execution path is built by the deterministic, non-LLM
// verification pipeline itself, directly from values it already computed
// (verification-command pass/fail, scope-check pass/fail), never from
// free text the child could have authored. A caller who bypasses that real
// wiring and invokes this module directly with hand-typed citations is not
// protected by this module alone — exactly as documented here.

import { classifyClaimSet } from './claim-taxonomy.mjs';
import { isAttestedRedTeamPhaseResult } from './red-team-gate.mjs';

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
  'HOLD_RED_TEAM_RESULT_NOT_ATTESTED',
  'HOLD_RED_TEAM_BLOCKING_FINDING',
  'HOLD_UNPROVEN_PRODUCTION_CLAIM',
]);

// NIGHT_HARDENING_2-R3: normalizes an identity string for the sole purpose
// of the independence COMPARISON -- trims leading/trailing whitespace,
// collapses internal runs of whitespace to a single space, and case-folds.
// Deliberately narrow: this does not attempt to catch every conceivable way
// two identity strings could denote "the same actor" (that is an identity-
// management problem this module cannot solve), only the specific class of
// "simple ambiguous name variation" this task calls out — trivial
// casing/whitespace cosmetics a caller could otherwise use to make one
// identity look like two.
function normalizeContextIdentity(rawId) {
  if (typeof rawId !== 'string') return null;
  const normalized = rawId.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * @param {object} input
 * @param {string} input.requestedState - one of AUDITOR_RESULT_STATES.
 * @param {string} input.executorContextId - identity of the session/context that produced the work under review.
 * @param {string} input.auditorContextId - identity of THIS review's session/context. Must differ from executorContextId (compared case/whitespace-insensitively — see normalizeContextIdentity).
 * @param {Array} [input.evidenceCitations] - claim-taxonomy.mjs claim objects backing this decision.
 * @param {object} [input.redTeamPhaseResult] - the return value of red-team-gate.mjs's runRedTeamPhase.
 * @param {Array} [input.findings] - free-form findings list, carried through for reporting only; never itself a source of authority.
 */
export function certifyIndependentAuditResult(input) {
  const requestedState = input?.requestedState;
  const executorContextId = typeof input?.executorContextId === 'string' && input.executorContextId.length > 0 ? input.executorContextId : null;
  const auditorContextId = typeof input?.auditorContextId === 'string' && input.auditorContextId.length > 0 ? input.auditorContextId : null;
  // NIGHT_HARDENING_2-R3: identity independence must not be evadable by a
  // "simple ambiguous name variation" (trailing/leading whitespace, case,
  // internal whitespace collapsing) -- raw strict equality alone lets
  // 'session-1' and 'Session-1 ' pass as "distinct" when they plausibly name
  // the same actor. Both raw values are still reported for transparency, but
  // the actual independence DECISION is made on the normalized form.
  const executorContextIdNormalized = normalizeContextIdentity(executorContextId);
  const auditorContextIdNormalized = normalizeContextIdentity(auditorContextId);
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
  const independent = Boolean(executorContextIdNormalized && auditorContextIdNormalized && executorContextIdNormalized !== auditorContextIdNormalized);
  const base = { requestedState, executorContextId, auditorContextId, independent, claimSet, redTeamPhaseResult, findings };

  if (!AUDITOR_RESULT_STATES.includes(requestedState)) {
    return buildResult({ ...base, finalState: 'HOLD', reason: 'INVALID_REQUESTED_STATE' });
  }

  if (!independent) {
    return buildResult({ ...base, finalState: 'HOLD', reason: 'HOLD_INDEPENDENT_AUDIT_REQUIRED' });
  }

  if (PASS_SHAPED_STATES.includes(requestedState)) {
    if (!evidenceCitationsShapeValid) {
      return buildResult({ ...base, finalState: 'HOLD', reason: 'HOLD_INVALID_EVIDENCE_CITATIONS_SHAPE' });
    }
    if (!redTeamPhaseResult || redTeamPhaseResult.completed !== true) {
      return buildResult({ ...base, finalState: 'HOLD', reason: 'HOLD_RED_TEAM_NOT_RUN' });
    }
    // Phase 1B, Section 4/8: shape alone (even `completed:true, blocking:
    // false` copied verbatim from a real result) is no longer sufficient --
    // the object identity itself must have been really returned by a real
    // runRedTeamPhase() call. A hand-fabricated or deep-cloned lookalike is
    // rejected here, before its `blocking`/findings fields are ever trusted.
    if (!isAttestedRedTeamPhaseResult(redTeamPhaseResult)) {
      return buildResult({ ...base, finalState: 'HOLD', reason: 'HOLD_RED_TEAM_RESULT_NOT_ATTESTED' });
    }
    if (redTeamPhaseResult.blocking === true) {
      return buildResult({ ...base, finalState: 'HOLD', reason: 'HOLD_RED_TEAM_BLOCKING_FINDING' });
    }
    if (claimSet.anyHold) {
      return buildResult({ ...base, finalState: 'HOLD', reason: 'HOLD_UNPROVEN_PRODUCTION_CLAIM' });
    }
  }

  return buildResult({ ...base, finalState: requestedState, reason: 'REQUESTED_STATE_GRANTED' });
}

function buildResult({ finalState, reason, requestedState, executorContextId, auditorContextId, independent, claimSet, redTeamPhaseResult, findings }) {
  return Object.freeze({
    role: 'independent_auditor',
    requestedState: requestedState ?? null,
    finalState,
    reason,
    independent,
    executorContextId,
    auditorContextId,
    evidence: claimSet,
    redTeamPhaseResult: redTeamPhaseResult ?? null,
    findings,
  });
}
