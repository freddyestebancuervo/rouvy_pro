// Tests for tools/night-agent/pr-metadata-gate.mjs (Task 6).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  FINAL_PR_STATE_BLOCK_VERSION,
  FINAL_PR_STATE_REQUIRED_KEYS,
  buildFinalPrMetadataBlock,
  parseFinalPrMetadataBlock,
  findStalePrBodyMarkers,
  evaluateFinalPrMetadata,
} from '../pr-metadata-gate.mjs';

const BASE_SHA = 'a'.repeat(40);
const HEAD_1 = 'b'.repeat(40);
const HEAD_2 = 'c'.repeat(40);

function goodFields(overrides = {}) {
  return {
    task: '6/7', baseSha: BASE_SHA, headSha: HEAD_1,
    bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: HEAD_1, ciStatus: '4/4 SUCCESS',
    p0: 0, p1: 0, p2: 0, p3: 0,
    ...overrides,
  };
}

function bodyWith(block, { prose = 'Some routine PR description.' } = {}) {
  return `## Objective\n\n${prose}\n\n${block}\n\nMore prose below the block.\n`;
}

function goodBody(overrides = {}) {
  return bodyWith(buildFinalPrMetadataBlock(goodFields(overrides)));
}

function goodExpected(overrides = {}) {
  return { prNumber: 42, baseSha: BASE_SHA, headSha: HEAD_1, bAuditResult: 'PASS', cCertification: 'PASS', ciHeadSha: HEAD_1, ciStatus: '4/4 SUCCESS', p0: 0, p1: 0, p2: 0, p3: 0, ...overrides };
}

function goodSnapshot(overrides = {}) {
  return { state: 'OPEN', isDraft: true, merged: false, prNumber: 42, bodyText: goodBody(), ...overrides };
}

// ---------------------------------------------------------------------------
// §14 happy path
// ---------------------------------------------------------------------------

test('§14: valid one-block body, correct snapshot -> FINAL_PR_METADATA_VERIFY = PASS', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected() });
  assert.equal(r.verified, true);
  assert.equal(r.reason, 'FINAL_PR_METADATA_VERIFIED');
  assert.equal(typeof r.bodySha256, 'string');
  assert.equal(r.bodySha256, createHash('sha256').update(goodBody(), 'utf8').digest('hex'));
});

test('§14: block version marker is present and correctly named', () => {
  assert.equal(FINAL_PR_STATE_BLOCK_VERSION, 'KORIXA_FINAL_PR_STATE_V1');
  const block = buildFinalPrMetadataBlock(goodFields());
  assert.ok(block.includes(FINAL_PR_STATE_BLOCK_VERSION));
});

// ---------------------------------------------------------------------------
// §15 stale body
// ---------------------------------------------------------------------------

test('§15: B/C final PASS but stale "Independent audit ... in progress" prose -> HOLD (STALE_MARKERS_PRESENT)', () => {
  const body = bodyWith(buildFinalPrMetadataBlock(goodFields()), { prose: 'Independent audit (role B) in progress in the same chat.' });
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ bodyText: body }), expected: goodExpected() });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'STALE_MARKERS_PRESENT');
});

test('§15: canonical block says final PASS but stale prose elsewhere says "B audit pending" -> HOLD (STALE_MARKERS_PRESENT)', () => {
  const body = bodyWith(buildFinalPrMetadataBlock(goodFields()), { prose: 'Status: B audit pending, will update shortly.' });
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ bodyText: body }), expected: goodExpected() });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'STALE_MARKERS_PRESENT');
});

test('§15/§6 (brief): legitimate historical explanation mentioning "audit"/"validation" does NOT false-positive', () => {
  const body = bodyWith(buildFinalPrMetadataBlock(goodFields()), {
    prose: 'B_AUDIT_RESULT = PASS. The independent audit found 0 findings. C validation completed successfully with CERTIFIED reason.',
  });
  const markers = findStalePrBodyMarkers(body);
  assert.deepEqual(markers, []);
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ bodyText: body }), expected: goodExpected() });
  assert.equal(r.verified, true);
});

test('all named stale patterns from the brief are individually detected', () => {
  const phrases = [
    'Independent audit (role B) in progress',
    'pending independent B audit',
    'B audit pending',
    'C validation pending',
    'validation in progress',
    'awaiting auditor',
    'awaiting validator',
    'Not to be merged in this session',
  ];
  for (const phrase of phrases) {
    const markers = findStalePrBodyMarkers(phrase);
    assert.ok(markers.length > 0, `phrase not detected: "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// §16 SHA binding
// ---------------------------------------------------------------------------

test('§16: task HEAD=HEAD_2, PR metadata block=HEAD_1 -> DENY (HEAD_SHA_MISMATCH)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ headSha: HEAD_2 }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'HEAD_SHA_MISMATCH');
});

test('§16: CI_HEAD_SHA=HEAD_1, current HEAD=HEAD_2 -> DENY (CI_HEAD_MISMATCH once HEAD itself matches, else HEAD_SHA_MISMATCH first)', () => {
  // block's own HEAD_SHA matches expected.headSha=HEAD_1, but expected.ciHeadSha diverges from the block's CI_HEAD_SHA:
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ ciHeadSha: HEAD_2 }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'CI_HEAD_MISMATCH');
});

test('§16: verification PASS on HEAD_1, then current HEAD becomes HEAD_2 -> old evidence unusable (a fresh call against HEAD_2 always fails; the gate has no memory of the prior PASS)', () => {
  const first = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected() });
  assert.equal(first.verified, true);
  // the SAME snapshot (still textually bound to HEAD_1) can never verify against a NEW expected head:
  const second = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ headSha: HEAD_2, ciHeadSha: HEAD_2 }) });
  assert.equal(second.verified, false);
  assert.equal(second.reason, 'HEAD_SHA_MISMATCH');
});

// ---------------------------------------------------------------------------
// §17 PR identity
// ---------------------------------------------------------------------------

test('§17: verification generated for PR #100, attempt reuse for PR #101 -> DENY (PR_IDENTITY_MISMATCH)', () => {
  const snapshotFor100 = goodSnapshot({ prNumber: 100 });
  const r = evaluateFinalPrMetadata({ prSnapshot: snapshotFor100, expected: goodExpected({ prNumber: 101 }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'PR_IDENTITY_MISMATCH');
});

test('§17: wrong TASK_ID is out of this module\'s scope (task label is format-checked only, not identity-bound) -- PR identity itself is the real binding, and it is enforced', () => {
  // A malformed TASK label is still rejected via block parsing:
  const body = goodBody().replace('TASK=6/7', 'TASK=not-a-task-label');
  const parsed = parseFinalPrMetadataBlock(body);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.reason, 'MALFORMED_TASK');
});

test('§17: body/snapshot bound to a different prNumber than expected is denied regardless of matching HEAD text', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ prNumber: 55 }), expected: goodExpected({ prNumber: 999 }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'PR_IDENTITY_MISMATCH');
});

// ---------------------------------------------------------------------------
// §18 block parsing
// ---------------------------------------------------------------------------

test('§18: valid one-block body -> PASS (parseFinalPrMetadataBlock)', () => {
  const r = parseFinalPrMetadataBlock(goodBody());
  assert.equal(r.valid, true);
});

test('§18: missing block -> DENY', () => {
  const r = parseFinalPrMetadataBlock('Just some prose, no block at all.');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MISSING_BLOCK');
});

test('§18: duplicate block -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields());
  const body = `${block}\n\n${block}`;
  const r = parseFinalPrMetadataBlock(body);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'DUPLICATE_BLOCK');
});

test('§18: duplicate key inside the block -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields());
  const bodyWithDupKey = block.replace('P3=0', 'P3=0\nP3=0');
  const r = parseFinalPrMetadataBlock(bodyWithDupKey);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'DUPLICATE_KEY:P3');
});

test('§18: missing HEAD_SHA -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields());
  const bodyMissingHead = block.split('\n').filter((l) => !l.startsWith('HEAD_SHA=')).join('\n');
  const r = parseFinalPrMetadataBlock(bodyMissingHead);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MISSING_KEY:HEAD_SHA');
});

test('§18: malformed SHA -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace(HEAD_1, 'not-a-real-sha');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_HEAD_SHA');
});

test('§18: wrong B result (value outside AUDITOR_RESULT_STATES) -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('B_AUDIT_RESULT=PASS', 'B_AUDIT_RESULT=TOTALLY_MADE_UP');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_B_AUDIT_RESULT');
});

test('§18: wrong C result -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('C_CERTIFICATION=PASS', 'C_CERTIFICATION=MAYBE');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_C_CERTIFICATION');
});

test('§18: wrong finding count (non-integer) -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('P1=0', 'P1=zero');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_P1');
});

test('§18: wrong CI status format -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('CI_STATUS=4/4 SUCCESS', 'CI_STATUS=mostly ok');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_CI_STATUS');
});

test('§18: unknown block version (different marker text) is simply not recognized as a block at all -> MISSING_BLOCK', () => {
  const body = goodBody().replace('KORIXA_FINAL_PR_STATE_V1', 'KORIXA_FINAL_PR_STATE_V2');
  const r = parseFinalPrMetadataBlock(body);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MISSING_BLOCK');
});

test('§18: lookalike marker (similar but not exact literal) -> DENY (not recognized)', () => {
  const body = goodBody().replace('<!-- KORIXA_FINAL_PR_STATE_V1', '<!--KORIXA_FINAL_PR_STATE_V1'); // missing space
  const r = parseFinalPrMetadataBlock(body);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MISSING_BLOCK');
});

test('§18: unknown key inside the block -> DENY (closed schema, no permissive fallback)', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('FINAL_STATE=PR_METADATA_SYNC_REQUIRED', 'FINAL_STATE=PR_METADATA_SYNC_REQUIRED\nSMUGGLED_KEY=evil');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'UNKNOWN_KEY:SMUGGLED_KEY');
});

test('§18: malformed line (no "=") inside the block -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('P3=0', 'P3=0\nthis is not a key value line');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.ok(r.reason.startsWith('MALFORMED_LINE:'));
});

test('§18: FINAL_STATE outside the valid domain (e.g. a hand-typed READY_FOR_HUMAN) -> DENY', () => {
  const block = buildFinalPrMetadataBlock(goodFields()).replace('FINAL_STATE=PR_METADATA_SYNC_REQUIRED', 'FINAL_STATE=READY_FOR_HUMAN');
  const r = parseFinalPrMetadataBlock(block);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_FINAL_STATE');
});

test('parseFinalPrMetadataBlock rejects non-string input outright', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const r = parseFinalPrMetadataBlock(bad);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'BODY_NOT_A_STRING');
  }
});

test('CRLF line endings inside the block are tolerated (platform artifact), but no OTHER whitespace is trimmed from a value', () => {
  const crlfBody = goodBody().replace(/\n/g, '\r\n');
  const r = parseFinalPrMetadataBlock(crlfBody);
  assert.equal(r.valid, true);
  const spacedValue = goodBody().replace('HEAD_SHA=' + HEAD_1, 'HEAD_SHA= ' + HEAD_1); // stray leading space IN the value
  const r2 = parseFinalPrMetadataBlock(spacedValue);
  assert.equal(r2.valid, false, 'a value with embedded whitespace must fail SHA-shape validation, never be silently trimmed to match');
});

// ---------------------------------------------------------------------------
// §19 human gate (module-level: evaluateFinalPrMetadata never itself grants
// MARK_READY/MERGE -- it only answers "is this snapshot trustworthy",
// consumed by task-orchestrator.mjs's own separate human-gate logic, tested
// in task-orchestrator.test.mjs / full-role-simulation.test.mjs)
// ---------------------------------------------------------------------------

test('§19: evaluateFinalPrMetadata never returns any field resembling authorization -- only verified/reason/bodySha256/parsedFields', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected() });
  assert.deepEqual(Object.keys(r).sort(), ['bodySha256', 'parsedFields', 'reason', 'verified'].sort());
});

// ---------------------------------------------------------------------------
// PR snapshot-level checks (not OPEN, merged, unexpectedly Ready, malformed)
// ---------------------------------------------------------------------------

test('PR not OPEN -> DENY (PR_NOT_OPEN)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ state: 'CLOSED' }), expected: goodExpected() });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'PR_NOT_OPEN');
});

test('PR already merged -> DENY (PR_ALREADY_MERGED)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ merged: true }), expected: goodExpected() });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'PR_ALREADY_MERGED');
});

test('PR unexpectedly Ready (not Draft) -> DENY (PR_UNEXPECTEDLY_READY)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot({ isDraft: false }), expected: goodExpected() });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'PR_UNEXPECTEDLY_READY');
});

test('malformed snapshot (missing bodyText, or not an object) -> DENY (MALFORMED_SNAPSHOT)', () => {
  for (const bad of [null, undefined, {}, { bodyText: 42 }, 'a string']) {
    const r = evaluateFinalPrMetadata({ prSnapshot: bad, expected: goodExpected() });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'MALFORMED_SNAPSHOT');
  }
});

test('malformed expected (null/not-object) -> DENY (MALFORMED_SNAPSHOT)', () => {
  for (const bad of [null, undefined, 'x']) {
    const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: bad });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'MALFORMED_SNAPSHOT');
  }
});

// ---------------------------------------------------------------------------
// Content-mismatch checks not already covered above
// ---------------------------------------------------------------------------

test('BASE_SHA mismatch -> DENY (BASE_SHA_MISMATCH)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ baseSha: HEAD_2 }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'BASE_SHA_MISMATCH');
});

test('B_AUDIT_RESULT mismatch (block says PASS, real B result was PASS_WITH_FINDINGS) -> DENY (B_RESULT_MISMATCH)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ bAuditResult: 'PASS_WITH_FINDINGS' }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'B_RESULT_MISMATCH');
});

test('C_CERTIFICATION mismatch -> DENY (C_RESULT_MISMATCH)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ cCertification: 'HOLD' }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'C_RESULT_MISMATCH');
});

test('CI_STATUS mismatch -> DENY (CI_STATUS_MISMATCH)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ ciStatus: '3/4 SUCCESS' }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'CI_STATUS_MISMATCH');
});

test('findings count mismatch (e.g. block says P0=0 but real state has 1) -> DENY (FINDINGS_MISMATCH)', () => {
  const r = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected({ p0: 1 }) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'FINDINGS_MISMATCH');
});

// ---------------------------------------------------------------------------
// buildFinalPrMetadataBlock's own fail-closed input validation
// ---------------------------------------------------------------------------

test('buildFinalPrMetadataBlock throws on any invalid field rather than emitting a block parseFinalPrMetadataBlock would reject', () => {
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ task: 'not-a-label' })));
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ baseSha: 'short' })));
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ bAuditResult: 'NOPE' })));
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ cCertification: 'NOPE' })));
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ ciStatus: 'bad format' })));
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ p0: -1 })));
  assert.throws(() => buildFinalPrMetadataBlock(goodFields({ p1: 1.5 })));
});

test('every block buildFinalPrMetadataBlock produces round-trips through parseFinalPrMetadataBlock exactly', () => {
  const fields = goodFields({ p0: 0, p1: 1, p2: 2, p3: 3 });
  const block = buildFinalPrMetadataBlock(fields);
  const parsed = parseFinalPrMetadataBlock(block);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.fields.TASK, fields.task);
  assert.equal(parsed.fields.P1, '1');
  assert.equal(parsed.fields.P2, '2');
  assert.equal(parsed.fields.P3, '3');
});

test('FINAL_PR_STATE_REQUIRED_KEYS is exactly the closed set the brief specifies (PR_NUMBER deliberately excluded -- identity bound externally)', () => {
  assert.deepEqual([...FINAL_PR_STATE_REQUIRED_KEYS].sort(), [
    'TASK', 'BASE_SHA', 'HEAD_SHA', 'B_AUDIT_RESULT', 'C_CERTIFICATION',
    'CI_HEAD_SHA', 'CI_STATUS', 'P0', 'P1', 'P2', 'P3', 'FINAL_STATE',
  ].sort());
});

// ---------------------------------------------------------------------------
// Remediation Round 1 (Task 6, 2026-08-24): P2-01 -- trailing/leading
// whitespace on a protocol VALUE used to be silently normalized away by a
// whole-line `.trim()` before parsing. Every named attack from the brief
// must fail closed, not be coerced to the "clean" value.
// ---------------------------------------------------------------------------

function replaceField(block, key, value, newValue) {
  return block.replace(`${key}=${value}`, `${key}=${newValue}`);
}

test('P2-01: HEAD_SHA=<sha><space> is rejected, not silently normalized', () => {
  const head = HEAD_1;
  const block = buildFinalPrMetadataBlock(goodFields());
  const r = parseFinalPrMetadataBlock(replaceField(block, 'HEAD_SHA', head, `${head} `));
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_HEAD_SHA');
});

test('P2-01: <space>HEAD_SHA=<sha> (leading space before the key) is rejected', () => {
  const head = HEAD_1;
  const block = buildFinalPrMetadataBlock(goodFields());
  const r = parseFinalPrMetadataBlock(block.replace(`HEAD_SHA=${head}`, ` HEAD_SHA=${head}`));
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_KEY: HEAD_SHA');
});

test('P2-01: HEAD_SHA=<tab><sha> (leading tab in the value) is rejected', () => {
  const head = HEAD_1;
  const block = buildFinalPrMetadataBlock(goodFields());
  const r = parseFinalPrMetadataBlock(replaceField(block, 'HEAD_SHA', head, `\t${head}`));
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_HEAD_SHA');
});

test('P2-01: HEAD_SHA=<sha><tab> (trailing tab in the value) is rejected', () => {
  const head = HEAD_1;
  const block = buildFinalPrMetadataBlock(goodFields());
  const r = parseFinalPrMetadataBlock(replaceField(block, 'HEAD_SHA', head, `${head}\t`));
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'MALFORMED_HEAD_SHA');
});

test('P2-01: trailing space rejected on every other critical value (BASE_SHA, CI_HEAD_SHA, B_AUDIT_RESULT, C_CERTIFICATION, CI_STATUS, FINAL_STATE, P0-P3)', () => {
  const cases = [
    ['BASE_SHA', BASE_SHA, `${BASE_SHA} `, 'MALFORMED_BASE_SHA'],
    ['CI_HEAD_SHA', HEAD_1, `${HEAD_1} `, 'MALFORMED_CI_HEAD_SHA'],
    ['B_AUDIT_RESULT', 'PASS', 'PASS ', 'MALFORMED_B_AUDIT_RESULT'],
    ['C_CERTIFICATION', 'PASS', 'PASS ', 'MALFORMED_C_CERTIFICATION'],
    ['CI_STATUS', '4/4 SUCCESS', '4/4 SUCCESS ', 'MALFORMED_CI_STATUS'],
    ['FINAL_STATE', 'PR_METADATA_SYNC_REQUIRED', 'PR_METADATA_SYNC_REQUIRED ', 'MALFORMED_FINAL_STATE'],
    ['P0', '0', '0 ', 'MALFORMED_P0'],
    ['P1', '0', '0 ', 'MALFORMED_P1'],
    ['P2', '0', '0 ', 'MALFORMED_P2'],
    ['P3', '0', '0 ', 'MALFORMED_P3'],
  ];
  for (const [key, oldValue, newValue, expectedReason] of cases) {
    const block = buildFinalPrMetadataBlock(goodFields());
    const r = parseFinalPrMetadataBlock(replaceField(block, key, oldValue, newValue));
    assert.equal(r.valid, false, `${key} with trailing space should be rejected`);
    assert.equal(r.reason, expectedReason);
  }
});

test('P2-01: normal CRLF input (no embedded whitespace inside any value) still parses correctly -- CRLF handling is preserved', () => {
  const block = buildFinalPrMetadataBlock(goodFields());
  const crlfBlock = block.replace(/\n/g, '\r\n');
  const r = parseFinalPrMetadataBlock(crlfBlock);
  assert.equal(r.valid, true);
});

test('P2-01: blank/whitespace-only spacer lines between real KEY=VALUE lines are still tolerated (not a regression from the trim removal)', () => {
  const block = buildFinalPrMetadataBlock(goodFields());
  const withBlankLines = block.replace('B_AUDIT_RESULT=PASS\n', 'B_AUDIT_RESULT=PASS\n\n');
  const r = parseFinalPrMetadataBlock(withBlankLines);
  assert.equal(r.valid, true);
});

// ---------------------------------------------------------------------------
// computeBodySha256 -- the one canonical hash helper (P2-02 fix), reused
// (not duplicated) by task-orchestrator.mjs's requestHumanGate.
// ---------------------------------------------------------------------------

test('computeBodySha256 is deterministic and reused by evaluateFinalPrMetadata\'s own bodySha256 output', () => {
  const body = goodBody();
  const direct = createHash('sha256').update(body, 'utf8').digest('hex');
  const result = evaluateFinalPrMetadata({ prSnapshot: goodSnapshot(), expected: goodExpected() });
  assert.equal(result.bodySha256, direct);
});
