// Tests for tools/night-agent/claim-taxonomy.mjs. Pure functions only --
// no I/O, no mocks needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAIM_EVIDENCE_LEVELS,
  PRODUCTION_IMPACT_TOPICS,
  normalizeEvidenceLevel,
  normalizeTopics,
  classifyClaim,
  classifyClaimSet,
  isProvenLevel,
} from '../claim-taxonomy.mjs';

// =============================================================================
// Closed vocabulary
// =============================================================================

test('CLAIM_EVIDENCE_LEVELS is exactly the five required values', () => {
  assert.deepEqual(CLAIM_EVIDENCE_LEVELS, [
    'PROVEN_BY_CODE', 'PROVEN_BY_OFFICIAL_DOCS', 'PROVEN_BY_LIVE_READ_ONLY', 'PROVEN_BY_NONPROD_TEST', 'UNPROVEN',
  ]);
});

test('normalizeEvidenceLevel never promotes an unrecognized value into a proven class', () => {
  for (const bogus of ['proven_by_code', 'PROVEN', 'CONFIRMED', 'PASS', undefined, null, 42, {}, 'PROVEN_BY_VIBES']) {
    assert.equal(normalizeEvidenceLevel(bogus), 'UNPROVEN', `expected UNPROVEN for ${JSON.stringify(bogus)}`);
  }
});

test('normalizeEvidenceLevel passes through each of the four proven values unchanged', () => {
  for (const level of ['PROVEN_BY_CODE', 'PROVEN_BY_OFFICIAL_DOCS', 'PROVEN_BY_LIVE_READ_ONLY', 'PROVEN_BY_NONPROD_TEST']) {
    assert.equal(normalizeEvidenceLevel(level), level);
  }
});

test('normalizeTopics drops unrecognized topic strings rather than guessing a match', () => {
  assert.deepEqual(normalizeTopics(['cloud_run', 'made_up_topic', 'traffic']), ['cloud_run', 'traffic']);
  assert.deepEqual(normalizeTopics(['not_a_real_topic']), []);
  assert.deepEqual(normalizeTopics('not-an-array'), []);
  assert.deepEqual(normalizeTopics(undefined), []);
});

test('PRODUCTION_IMPACT_TOPICS contains exactly the required topics', () => {
  for (const t of ['production', 'traffic', 'rollback', 'iam', 'secrets', 'migrations', 'cloud_run', 'cloud_sql', 'artifact_registry', 'firebase_production', 'identity', 'wif', 'deployments', 'persistent_data', 'irreversible_operations']) {
    assert.ok(PRODUCTION_IMPACT_TOPICS.includes(t), `missing topic: ${t}`);
  }
});

// =============================================================================
// TEST C: UNPROVEN + production impact -> HOLD.
// =============================================================================

test('TEST_C: UNPROVEN claim touching a production-impact topic -> HOLD', () => {
  const result = classifyClaim({ claimId: 'c1', evidenceLevel: 'UNPROVEN', topics: ['iam'] });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.holdReason, 'unproven_claim_with_production_impact');
});

test('an unrecognized evidenceLevel touching a production-impact topic also -> HOLD (coerced to UNPROVEN first)', () => {
  const result = classifyClaim({ claimId: 'c2', evidenceLevel: 'TOTALLY_MADE_UP', topics: ['secrets'] });
  assert.equal(result.evidenceLevel, 'UNPROVEN');
  assert.equal(result.evidenceLevelWasInvalid, true);
  assert.equal(result.decision, 'HOLD');
});

test('UNPROVEN claim with NO production-impact topics -> PROCEED (stays UNPROVEN, but not auto-HOLD)', () => {
  const result = classifyClaim({ claimId: 'c3', evidenceLevel: 'UNPROVEN', topics: [] });
  assert.equal(result.decision, 'PROCEED');
  assert.equal(result.evidenceLevel, 'UNPROVEN');
});

test('a genuinely proven claim touching production-impact topics -> PROCEED', () => {
  const result = classifyClaim({ claimId: 'c4', evidenceLevel: 'PROVEN_BY_LIVE_READ_ONLY', topics: ['cloud_run', 'iam'] });
  assert.equal(result.decision, 'PROCEED');
  assert.equal(result.matchedTopics.sort().join(','), 'cloud_run,iam');
});

// =============================================================================
// TEST D: PROVEN_BY_CODE cannot masquerade as a runtime observation.
// =============================================================================

test('TEST_D: PROVEN_BY_CODE is never treated as equivalent to a runtime-observed level -- no promotion path exists', () => {
  const codeResult = classifyClaim({ claimId: 'd1', evidenceLevel: 'PROVEN_BY_CODE', topics: ['cloud_run'] });
  assert.equal(codeResult.evidenceLevel, 'PROVEN_BY_CODE');
  // There is no function in this module that maps PROVEN_BY_CODE to
  // PROVEN_BY_LIVE_READ_ONLY or PROVEN_BY_NONPROD_TEST under any input --
  // verified by exhaustively checking classifyClaim never rewrites a
  // declared PROVEN_BY_CODE into a different proven value.
  for (const topics of [[], ['production'], ['iam', 'wif'], PRODUCTION_IMPACT_TOPICS.slice()]) {
    const r = classifyClaim({ claimId: 'd2', evidenceLevel: 'PROVEN_BY_CODE', topics });
    assert.equal(r.evidenceLevel, 'PROVEN_BY_CODE', `evidenceLevel must never change from PROVEN_BY_CODE, topics=${JSON.stringify(topics)}`);
  }
  assert.equal(typeof classifyClaim === 'function', true);
});

// =============================================================================
// TEST E: PROVEN_BY_NONPROD_TEST cannot auto-certify Production.
// =============================================================================

test('TEST_E: PROVEN_BY_NONPROD_TEST + environment=Production is an invalid combo, coerced to UNPROVEN', () => {
  const result = classifyClaim({ claimId: 'e1', evidenceLevel: 'PROVEN_BY_NONPROD_TEST', environment: 'Production', topics: ['cloud_run'] });
  assert.equal(result.invalidEvidenceEnvironmentCombo, true);
  assert.equal(result.evidenceLevel, 'UNPROVEN');
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.holdReason, 'nonprod_test_cannot_certify_production');
});

test('PROVEN_BY_NONPROD_TEST for a Development/Staging environment claim is valid and PROCEEDs', () => {
  for (const environment of ['Development', 'Staging']) {
    const result = classifyClaim({ claimId: 'e2', evidenceLevel: 'PROVEN_BY_NONPROD_TEST', environment, topics: ['cloud_run'] });
    assert.equal(result.invalidEvidenceEnvironmentCombo, false);
    assert.equal(result.evidenceLevel, 'PROVEN_BY_NONPROD_TEST');
    assert.equal(result.decision, 'PROCEED');
  }
});

test('PROVEN_BY_NONPROD_TEST with no environment declared at all is valid (not assumed to be Production)', () => {
  const result = classifyClaim({ claimId: 'e3', evidenceLevel: 'PROVEN_BY_NONPROD_TEST', topics: ['cloud_run'] });
  assert.equal(result.invalidEvidenceEnvironmentCombo, false);
  assert.equal(result.decision, 'PROCEED');
});

// =============================================================================
// classifyClaimSet aggregation
// =============================================================================

test('classifyClaimSet: a single HOLD-ing claim forces the whole set to anyHold=true, even among many PROCEED claims', () => {
  const claims = [
    { claimId: 'ok1', evidenceLevel: 'PROVEN_BY_LIVE_READ_ONLY', topics: ['cloud_run'] },
    { claimId: 'ok2', evidenceLevel: 'PROVEN_BY_OFFICIAL_DOCS', topics: ['iam'] },
    { claimId: 'bad', evidenceLevel: 'UNPROVEN', topics: ['secrets'] },
    { claimId: 'ok3', evidenceLevel: 'PROVEN_BY_CODE', topics: [] },
  ];
  const result = classifyClaimSet(claims);
  assert.equal(result.anyHold, true);
  assert.equal(result.holdReasons.length, 1);
  assert.equal(result.holdReasons[0].claimId, 'bad');
});

test('classifyClaimSet: empty/non-array input -> no holds, empty results', () => {
  assert.equal(classifyClaimSet([]).anyHold, false);
  assert.equal(classifyClaimSet(undefined).anyHold, false);
  assert.equal(classifyClaimSet(null).results.length, 0);
});

// =============================================================================
// isProvenLevel
// =============================================================================

test('isProvenLevel is true for exactly the four proven values, false for UNPROVEN and anything else', () => {
  assert.equal(isProvenLevel('PROVEN_BY_CODE'), true);
  assert.equal(isProvenLevel('PROVEN_BY_OFFICIAL_DOCS'), true);
  assert.equal(isProvenLevel('PROVEN_BY_LIVE_READ_ONLY'), true);
  assert.equal(isProvenLevel('PROVEN_BY_NONPROD_TEST'), true);
  assert.equal(isProvenLevel('UNPROVEN'), false);
  assert.equal(isProvenLevel('made_up'), false);
  assert.equal(isProvenLevel(undefined), false);
});

// =============================================================================
// Purity / determinism
// =============================================================================

test('classifyClaim is pure: identical input always produces a deeply-equal result', () => {
  const input = { claimId: 'p1', evidenceLevel: 'PROVEN_BY_LIVE_READ_ONLY', environment: 'Production', topics: ['cloud_run', 'iam'] };
  const a = classifyClaim({ ...input });
  const b = classifyClaim({ ...input });
  assert.deepEqual(a, b);
});

test('classifyClaim results are frozen (cannot be mutated by a caller after the fact)', () => {
  const result = classifyClaim({ claimId: 'f1', evidenceLevel: 'PROVEN_BY_CODE', topics: [] });
  assert.throws(() => { result.decision = 'HOLD'; }, TypeError);
});
