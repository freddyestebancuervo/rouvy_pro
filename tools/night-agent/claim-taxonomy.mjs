// Korixa Night Agent — Claim Evidence Taxonomy + Production-Impact Fail-Closed
// Rule (NIGHT_HARDENING_1, Executor<>Auditor separation work, 2026-08-22).
//
// Every material claim a Night Agent report makes about infrastructure,
// security, or external system behavior must carry an explicit evidence
// classification. This is the same five-value taxonomy this project has
// already used BY HAND, consistently, across every T-F1.2 KORIXA_* audit
// report in this repo's real history (PR68/PR70/PR72's independent-audit
// reports): PROVEN_BY_CODE, PROVEN_BY_OFFICIAL_DOCS, PROVEN_BY_LIVE_READ_ONLY,
// PROVEN_BY_NONPROD_TEST, UNPROVEN. This module makes that discipline a code-
// enforced fact instead of a convention a report author has to remember.
//
// This module is DELIBERATELY separate from evidence-policy.mjs's own
// (finer-grained, sourceClass x strength x verificationLevel) attestation
// engine — that engine solves a different problem (independently confirming
// one CONCRETE git/filesystem/runtime fact via unforgeable, WeakSet-branded
// attestation). This module solves the narrower, report-level problem this
// task requires: given a claim's evidence level (however it was obtained)
// plus which infrastructure topics/environment it concerns, decide whether
// it is safe to let a result stand as PASS or must force HOLD. Reusing
// evidence-policy.mjs's attestation machinery here would be scope creep this
// task explicitly does not ask for; the two modules can be wired together by
// a future caller (e.g. `verificationLevel: 'REMOTE_RUNTIME'` maps onto
// `PROVEN_BY_LIVE_READ_ONLY`) without either module depending on the other.
//
// FAIL-CLOSED RULE (the actual point of this module): a claim whose evidence
// level is UNPROVEN — or is not one of the four recognized PROVEN_BY_*
// values, which is ALWAYS coerced to UNPROVEN, never silently accepted — AND
// which touches any topic in PRODUCTION_IMPACT_TOPICS is automatically HOLD.
// There is no parameter, flag, or free-text field anywhere in this module
// that can override that outcome; the only way to change it is to supply
// genuinely stronger evidence.

// ---------------------------------------------------------------------------
// Closed vocabulary — exactly these five, nothing else. A caller-supplied
// value outside this set is never coerced INTO a proven class (only ever
// coerced to UNPROVEN, the weakest value) — see normalizeEvidenceLevel.
// ---------------------------------------------------------------------------

export const CLAIM_EVIDENCE_LEVELS = Object.freeze([
  'PROVEN_BY_CODE',
  'PROVEN_BY_OFFICIAL_DOCS',
  'PROVEN_BY_LIVE_READ_ONLY',
  'PROVEN_BY_NONPROD_TEST',
  'UNPROVEN',
]);

const PROVEN_LEVELS = Object.freeze(CLAIM_EVIDENCE_LEVELS.filter((l) => l !== 'UNPROVEN'));

// Closed vocabulary for `environment` — mirrors evidence-policy.mjs's own
// ENVIRONMENTS enum (Development/Staging/Production) so the two modules stay
// conceptually compatible even though they are not wired together yet.
export const CLAIM_ENVIRONMENTS = Object.freeze(['Development', 'Staging', 'Production']);

// Fixed, closed list of infrastructure/security topics whose UNPROVEN claims
// must fail closed to HOLD. Deliberately a closed enum, not free text — a
// caller cannot invent a new topic string and have it silently ignored, nor
// invent one and have it silently treated as production-relevant when it
// isn't; only these exact values are recognized as production-impact topics
// (see normalizeTopics — anything else is dropped, never guessed at).
export const PRODUCTION_IMPACT_TOPICS = Object.freeze([
  'production',
  'traffic',
  'rollback',
  'iam',
  'secrets',
  'migrations',
  'cloud_run',
  'cloud_sql',
  'artifact_registry',
  'firebase_production',
  'identity',
  'wif',
  'deployments',
  'persistent_data',
  'irreversible_operations',
]);

const PRODUCTION_IMPACT_TOPIC_SET = new Set(PRODUCTION_IMPACT_TOPICS);

// ---------------------------------------------------------------------------
// Normalization — always fails closed. An unrecognized evidenceLevel is
// NEVER promoted to a PROVEN_* value; an unrecognized topic is simply
// dropped (never fabricated as a match against PRODUCTION_IMPACT_TOPICS).
// ---------------------------------------------------------------------------

export function normalizeEvidenceLevel(rawValue) {
  return CLAIM_EVIDENCE_LEVELS.includes(rawValue) ? rawValue : 'UNPROVEN';
}

function normalizeEnvironment(rawValue) {
  return CLAIM_ENVIRONMENTS.includes(rawValue) ? rawValue : null;
}

export function normalizeTopics(rawTopics) {
  if (!Array.isArray(rawTopics)) return [];
  const seen = new Set();
  for (const t of rawTopics) {
    if (typeof t === 'string' && PRODUCTION_IMPACT_TOPIC_SET.has(t)) seen.add(t);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// TEST-E-CLASS RULE: PROVEN_BY_NONPROD_TEST literally means "observed in a
// disposable Development/Staging lab" — it is a structural contradiction for
// the SAME claim to also declare environment: 'Production'. Rather than
// silently letting that combination pass (which would let a nonprod
// observation quietly stand in for a Production one), the combination itself
// is treated as invalid evidence and coerced to UNPROVEN. This is the only
// evidenceLevel/environment pair this module treats as mutually exclusive;
// every other combination (including UNPROVEN + Production, or
// PROVEN_BY_LIVE_READ_ONLY + Production) is a normal, valid claim shape.
// ---------------------------------------------------------------------------

function resolveEffectiveEvidenceLevel(evidenceLevel, environment) {
  if (evidenceLevel === 'PROVEN_BY_NONPROD_TEST' && environment === 'Production') {
    return { effective: 'UNPROVEN', invalidCombo: true };
  }
  return { effective: evidenceLevel, invalidCombo: false };
}

// ---------------------------------------------------------------------------
// classifyClaim — the core, pure decision function. No I/O, no clock, no
// hidden state; identical input always produces identical output.
// ---------------------------------------------------------------------------

/**
 * @param {object} claim
 * @param {string} claim.claimId - caller-chosen identifier, for reporting only.
 * @param {string} [claim.text] - human-readable statement, for reporting only. Never inspected/parsed by this function.
 * @param {string} claim.evidenceLevel - one of CLAIM_EVIDENCE_LEVELS (unrecognized -> UNPROVEN).
 * @param {string} [claim.environment] - one of CLAIM_ENVIRONMENTS or omitted.
 * @param {string[]} [claim.topics] - subset of PRODUCTION_IMPACT_TOPICS this claim concerns.
 */
export function classifyClaim(claim) {
  const claimId = typeof claim?.claimId === 'string' && claim.claimId.length > 0 ? claim.claimId : null;
  const declaredEvidenceLevel = claim?.evidenceLevel;
  const normalizedEvidenceLevel = normalizeEvidenceLevel(declaredEvidenceLevel);
  const environment = normalizeEnvironment(claim?.environment);
  const { effective: effectiveEvidenceLevel, invalidCombo } = resolveEffectiveEvidenceLevel(normalizedEvidenceLevel, environment);
  const matchedTopics = normalizeTopics(claim?.topics);
  const touchesProductionImpact = matchedTopics.length > 0;

  const evidenceLevelWasInvalid = !CLAIM_EVIDENCE_LEVELS.includes(declaredEvidenceLevel);

  let decision = 'PROCEED';
  let holdReason = null;
  if (effectiveEvidenceLevel === 'UNPROVEN' && touchesProductionImpact) {
    decision = 'HOLD';
    holdReason = invalidCombo ? 'nonprod_test_cannot_certify_production' : 'unproven_claim_with_production_impact';
  }

  return Object.freeze({
    claimId,
    declaredEvidenceLevel: declaredEvidenceLevel ?? null,
    evidenceLevel: effectiveEvidenceLevel,
    evidenceLevelWasInvalid,
    invalidEvidenceEnvironmentCombo: invalidCombo,
    environment,
    matchedTopics,
    touchesProductionImpact,
    decision,
    holdReason,
  });
}

/**
 * Applies classifyClaim across a set of claims and aggregates the outcome.
 * A single HOLD-ing claim forces the whole set to HOLD — there is no partial
 * credit and no way for a majority of PROCEED claims to outvote one HOLD.
 */
export function classifyClaimSet(claims) {
  const list = Array.isArray(claims) ? claims : [];
  const results = list.map((c) => classifyClaim(c));
  const holds = results.filter((r) => r.decision === 'HOLD');
  return Object.freeze({
    results,
    anyHold: holds.length > 0,
    holdReasons: holds.map((r) => ({ claimId: r.claimId, holdReason: r.holdReason })),
  });
}

// ---------------------------------------------------------------------------
// isProvenLevel — small helper so callers never have to hand-roll
// `level !== 'UNPROVEN'`, which is easy to get backwards. Exported mainly so
// tests (and future callers) have one canonical way to ask "is this actually
// proven, by any of the four recognized means".
// ---------------------------------------------------------------------------

export function isProvenLevel(evidenceLevel) {
  return PROVEN_LEVELS.includes(evidenceLevel);
}
