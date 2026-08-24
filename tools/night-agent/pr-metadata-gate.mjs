// Korixa — Common Agent Protocol (Task 6, 2026-08-23): FINAL PR METADATA
// GATE.
//
// WHY THIS EXISTS: real, recurring evidence from PR #78 and PR #79 -- both
// reached final B/C validation while their Draft PR bodies still carried
// stale intermediate text ("Independent audit in progress", "pending
// independent B audit", "Not to be merged in this session"). The
// underlying implementation was correct in both cases; the PR METADATA
// simply lagged behind the real, already-certified task state, because
// nothing machine-enforced ever checked the two against each other before
// the task was declared ready for a human. This module is that check.
//
// SCOPE: pure functions only. No GitHub network calls, no `gh` invocation,
// no file I/O. The runtime decision layer (task-orchestrator.mjs) is
// responsible for obtaining a real PR snapshot (state/isDraft/merged/
// prNumber/bodyText) externally and passing it in; this module only
// decides, deterministically, whether that snapshot is trustworthy
// evidence that the task is genuinely, currently ready for a human gate.
//
// CLOSED, STRICT PARSING: the canonical block below is the ONLY source of
// machine-truth this module trusts inside a PR body -- never free
// natural-language prose. Duplicate blocks, duplicate keys, missing keys,
// unknown keys, and malformed critical values (non-hex SHAs, out-of-domain
// enum values) are all REJECTED, never coerced or best-effort-parsed. No
// trim-based identity relaxation is applied to protocol VALUES (a SHA with
// stray embedded whitespace is simply not a match, not "close enough").

import { createHash } from 'node:crypto';
import { AUDITOR_RESULT_STATES, VALIDATOR_RESULT_STATES } from './role-protocol.mjs';

// ---------------------------------------------------------------------------
// Canonical machine-readable block.
// ---------------------------------------------------------------------------

export const FINAL_PR_STATE_BLOCK_VERSION = 'KORIXA_FINAL_PR_STATE_V1';
const BLOCK_START_LITERAL = `<!-- ${FINAL_PR_STATE_BLOCK_VERSION}`;
const BLOCK_END_LITERAL = '-->';

// The closed key set the block MUST contain -- exactly these, no more, no
// fewer. PR_NUMBER is deliberately NOT one of them: PR identity is
// established structurally by the caller having fetched a specific PR's
// snapshot (see evaluateFinalPrMetadata's own separate prNumber check),
// not by a redundant, spoofable in-body claim.
export const FINAL_PR_STATE_REQUIRED_KEYS = Object.freeze([
  'TASK', 'BASE_SHA', 'HEAD_SHA', 'B_AUDIT_RESULT', 'C_CERTIFICATION',
  'CI_HEAD_SHA', 'CI_STATUS', 'P0', 'P1', 'P2', 'P3', 'FINAL_STATE',
]);

// The only FINAL_STATE value valid inside a block awaiting verification --
// C writes this BEFORE the gate below has run; a block claiming any other
// value (e.g. a hand-typed "READY_FOR_HUMAN") is malformed by construction,
// since only this module's own evaluateFinalPrMetadata may ever grant that.
const VALID_BLOCK_FINAL_STATES = Object.freeze(['PR_METADATA_SYNC_REQUIRED']);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const TASK_LABEL_PATTERN = /^\d+\/\d+$/;
const CI_STATUS_PATTERN = /^\d+\/\d+ SUCCESS$/;
const NON_NEGATIVE_INT_PATTERN = /^\d+$/;

/**
 * Build the canonical block's exact text (HTML-comment-wrapped). Throws on
 * any invalid field -- this function is used by A/the orchestrator to
 * produce a genuinely well-formed block; it must never itself emit
 * something parseFinalPrMetadataBlock would reject.
 * @param {object} fields
 * @param {string} fields.task e.g. "6/7"
 * @param {string} fields.baseSha
 * @param {string} fields.headSha
 * @param {'PASS'|'PASS_WITH_FINDINGS'|'HOLD'|'HOLD_FOR_REMEDIATION'} fields.bAuditResult
 * @param {'PASS'|'HOLD'} fields.cCertification
 * @param {string} fields.ciHeadSha
 * @param {string} fields.ciStatus e.g. "4/4 SUCCESS"
 * @param {number} fields.p0
 * @param {number} fields.p1
 * @param {number} fields.p2
 * @param {number} fields.p3
 * @returns {string}
 */
export function buildFinalPrMetadataBlock(fields) {
  const {
    task, baseSha, headSha, bAuditResult, cCertification, ciHeadSha, ciStatus, p0, p1, p2, p3,
  } = fields ?? {};
  if (!TASK_LABEL_PATTERN.test(task ?? '')) throw new Error(`buildFinalPrMetadataBlock: invalid task label ${JSON.stringify(task)}`);
  if (!SHA_PATTERN.test(baseSha ?? '')) throw new Error('buildFinalPrMetadataBlock: invalid baseSha');
  if (!SHA_PATTERN.test(headSha ?? '')) throw new Error('buildFinalPrMetadataBlock: invalid headSha');
  if (!AUDITOR_RESULT_STATES.includes(bAuditResult)) throw new Error(`buildFinalPrMetadataBlock: invalid bAuditResult ${JSON.stringify(bAuditResult)}`);
  if (!VALIDATOR_RESULT_STATES.includes(cCertification)) throw new Error(`buildFinalPrMetadataBlock: invalid cCertification ${JSON.stringify(cCertification)}`);
  if (!SHA_PATTERN.test(ciHeadSha ?? '')) throw new Error('buildFinalPrMetadataBlock: invalid ciHeadSha');
  if (!CI_STATUS_PATTERN.test(ciStatus ?? '')) throw new Error(`buildFinalPrMetadataBlock: invalid ciStatus ${JSON.stringify(ciStatus)}`);
  for (const [name, value] of [['p0', p0], ['p1', p1], ['p2', p2], ['p3', p3]]) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`buildFinalPrMetadataBlock: invalid ${name} ${JSON.stringify(value)}`);
  }
  const lines = [
    BLOCK_START_LITERAL,
    `TASK=${task}`,
    `BASE_SHA=${baseSha}`,
    `HEAD_SHA=${headSha}`,
    `B_AUDIT_RESULT=${bAuditResult}`,
    `C_CERTIFICATION=${cCertification}`,
    `CI_HEAD_SHA=${ciHeadSha}`,
    `CI_STATUS=${ciStatus}`,
    `P0=${p0}`,
    `P1=${p1}`,
    `P2=${p2}`,
    `P3=${p3}`,
    'FINAL_STATE=PR_METADATA_SYNC_REQUIRED',
    BLOCK_END_LITERAL,
  ];
  return lines.join('\n');
}

/**
 * Strictly parse EXACTLY ONE canonical block out of a PR body. Fails
 * closed on: no block, more than one block, a line inside the block that
 * isn't a well-formed KEY=VALUE pair, a duplicate key, a missing required
 * key, an unknown key, or a critical value outside its closed domain.
 * @param {unknown} bodyText
 * @returns {{valid: true, fields: Record<string,string>} | {valid: false, reason: string}}
 */
export function parseFinalPrMetadataBlock(bodyText) {
  if (typeof bodyText !== 'string') return { valid: false, reason: 'BODY_NOT_A_STRING' };
  const normalized = bodyText.replace(/\r\n/g, '\n'); // CRLF is a platform artifact, not semantic content (see this project's own established precedent) -- but no OTHER whitespace normalization is applied to values below.

  const startCount = normalized.split(BLOCK_START_LITERAL).length - 1;
  if (startCount === 0) return { valid: false, reason: 'MISSING_BLOCK' };
  if (startCount > 1) return { valid: false, reason: 'DUPLICATE_BLOCK' };

  const startIdx = normalized.indexOf(BLOCK_START_LITERAL);
  const afterStart = startIdx + BLOCK_START_LITERAL.length;
  const endIdx = normalized.indexOf(BLOCK_END_LITERAL, afterStart);
  if (endIdx === -1) return { valid: false, reason: 'UNTERMINATED_BLOCK' };
  const inner = normalized.slice(afterStart, endIdx);

  const rawLines = inner.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const fields = {};
  for (const line of rawLines) {
    const eq = line.indexOf('=');
    if (eq <= 0) return { valid: false, reason: `MALFORMED_LINE:${line}` };
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (!/^[A-Z0-9_]+$/.test(key)) return { valid: false, reason: `MALFORMED_KEY:${key}` };
    if (Object.prototype.hasOwnProperty.call(fields, key)) return { valid: false, reason: `DUPLICATE_KEY:${key}` };
    if (!FINAL_PR_STATE_REQUIRED_KEYS.includes(key)) return { valid: false, reason: `UNKNOWN_KEY:${key}` };
    fields[key] = value;
  }
  for (const required of FINAL_PR_STATE_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(fields, required)) return { valid: false, reason: `MISSING_KEY:${required}` };
  }

  if (!TASK_LABEL_PATTERN.test(fields.TASK)) return { valid: false, reason: 'MALFORMED_TASK' };
  if (!SHA_PATTERN.test(fields.BASE_SHA)) return { valid: false, reason: 'MALFORMED_BASE_SHA' };
  if (!SHA_PATTERN.test(fields.HEAD_SHA)) return { valid: false, reason: 'MALFORMED_HEAD_SHA' };
  if (!AUDITOR_RESULT_STATES.includes(fields.B_AUDIT_RESULT)) return { valid: false, reason: 'MALFORMED_B_AUDIT_RESULT' };
  if (!VALIDATOR_RESULT_STATES.includes(fields.C_CERTIFICATION)) return { valid: false, reason: 'MALFORMED_C_CERTIFICATION' };
  if (!SHA_PATTERN.test(fields.CI_HEAD_SHA)) return { valid: false, reason: 'MALFORMED_CI_HEAD_SHA' };
  if (!CI_STATUS_PATTERN.test(fields.CI_STATUS)) return { valid: false, reason: 'MALFORMED_CI_STATUS' };
  for (const key of ['P0', 'P1', 'P2', 'P3']) {
    if (!NON_NEGATIVE_INT_PATTERN.test(fields[key])) return { valid: false, reason: `MALFORMED_${key}` };
  }
  if (!VALID_BLOCK_FINAL_STATES.includes(fields.FINAL_STATE)) return { valid: false, reason: 'MALFORMED_FINAL_STATE' };

  return { valid: true, fields };
}

// ---------------------------------------------------------------------------
// Stale-marker detection -- narrow, testable phrase patterns for claims
// that would CONTRADICT a final, certified state. Deliberately NOT a bare
// "audit"/"validation" keyword match (that would false-positive on
// legitimate historical explanation, e.g. "the independent audit found 0
// findings" or "B audit result: PASS").
// ---------------------------------------------------------------------------

const STALE_MARKER_PATTERNS = Object.freeze([
  { id: 'AUDIT_IN_PROGRESS', re: /independent audit[^.\n]{0,60}\bin progress\b/i },
  { id: 'PENDING_B_AUDIT', re: /pending independent b audit/i },
  { id: 'B_AUDIT_PENDING', re: /\bb audit pending\b/i },
  { id: 'C_VALIDATION_PENDING', re: /\bc validation pending\b/i },
  { id: 'VALIDATION_IN_PROGRESS', re: /\bvalidation in progress\b/i },
  { id: 'AWAITING_AUDITOR', re: /\bawaiting auditor\b/i },
  { id: 'AWAITING_VALIDATOR', re: /\bawaiting validator\b/i },
  { id: 'NOT_TO_BE_MERGED_THIS_SESSION', re: /not to be merged in this session/i },
]);

/**
 * Scan PR body prose (with the canonical block itself stripped out, so the
 * block's own KEY=VALUE lines can never accidentally trip a stale-phrase
 * match) for known stale intermediate claims.
 * @param {unknown} bodyText
 * @returns {{id: string, index: number}[]}
 */
export function findStalePrBodyMarkers(bodyText) {
  if (typeof bodyText !== 'string') return [];
  const normalized = bodyText.replace(/\r\n/g, '\n');
  const startIdx = normalized.indexOf(BLOCK_START_LITERAL);
  const proseOnly = startIdx === -1
    ? normalized
    : normalized.slice(0, startIdx) + normalized.slice(normalized.indexOf(BLOCK_END_LITERAL, startIdx) + BLOCK_END_LITERAL.length);
  const found = [];
  for (const { id, re } of STALE_MARKER_PATTERNS) {
    const match = re.exec(proseOnly);
    if (match) found.push({ id, index: match.index });
  }
  return found;
}

// ---------------------------------------------------------------------------
// The core decision function.
// ---------------------------------------------------------------------------

export const PR_METADATA_HOLD_REASONS = Object.freeze([
  'MALFORMED_SNAPSHOT',
  'PR_NOT_OPEN',
  'PR_ALREADY_MERGED',
  'PR_UNEXPECTEDLY_READY',
  'PR_IDENTITY_MISMATCH',
  'STALE_MARKERS_PRESENT',
  'MISSING_BLOCK',
  'DUPLICATE_BLOCK',
  'MALFORMED_BLOCK',
  'BASE_SHA_MISMATCH',
  'HEAD_SHA_MISMATCH',
  'B_RESULT_MISMATCH',
  'C_RESULT_MISMATCH',
  'CI_HEAD_MISMATCH',
  'CI_STATUS_MISMATCH',
  'FINDINGS_MISMATCH',
]);

/**
 * @param {object} params
 * @param {object} params.prSnapshot externally-obtained, real PR state --
 *   never fetched by this module. `{state, isDraft, merged, prNumber, bodyText}`
 * @param {object} params.expected the CURRENT, real, already-recorded task
 *   facts to check the snapshot against -- caller derives these from live
 *   protocol state, never from a prior verification's own memory.
 * @returns {{verified: boolean, reason: string, bodySha256?: string, parsedFields?: object}}
 */
export function evaluateFinalPrMetadata({ prSnapshot, expected }) {
  if (prSnapshot === null || typeof prSnapshot !== 'object' || typeof prSnapshot.bodyText !== 'string') {
    return { verified: false, reason: 'MALFORMED_SNAPSHOT' };
  }
  if (expected === null || typeof expected !== 'object') {
    return { verified: false, reason: 'MALFORMED_SNAPSHOT' };
  }
  if (prSnapshot.state !== 'OPEN') return { verified: false, reason: 'PR_NOT_OPEN' };
  if (prSnapshot.merged === true) return { verified: false, reason: 'PR_ALREADY_MERGED' };
  if (prSnapshot.isDraft !== true) return { verified: false, reason: 'PR_UNEXPECTEDLY_READY' };
  if (prSnapshot.prNumber !== expected.prNumber) return { verified: false, reason: 'PR_IDENTITY_MISMATCH' };

  const staleMarkers = findStalePrBodyMarkers(prSnapshot.bodyText);
  if (staleMarkers.length > 0) return { verified: false, reason: 'STALE_MARKERS_PRESENT' };

  const parsed = parseFinalPrMetadataBlock(prSnapshot.bodyText);
  if (!parsed.valid) {
    if (parsed.reason === 'MISSING_BLOCK') return { verified: false, reason: 'MISSING_BLOCK' };
    if (parsed.reason === 'DUPLICATE_BLOCK') return { verified: false, reason: 'DUPLICATE_BLOCK' };
    return { verified: false, reason: 'MALFORMED_BLOCK' };
  }
  const f = parsed.fields;

  if (f.BASE_SHA !== expected.baseSha) return { verified: false, reason: 'BASE_SHA_MISMATCH' };
  if (f.HEAD_SHA !== expected.headSha) return { verified: false, reason: 'HEAD_SHA_MISMATCH' };
  if (f.B_AUDIT_RESULT !== expected.bAuditResult) return { verified: false, reason: 'B_RESULT_MISMATCH' };
  if (f.C_CERTIFICATION !== expected.cCertification) return { verified: false, reason: 'C_RESULT_MISMATCH' };
  if (f.CI_HEAD_SHA !== expected.ciHeadSha) return { verified: false, reason: 'CI_HEAD_MISMATCH' };
  if (f.CI_STATUS !== expected.ciStatus) return { verified: false, reason: 'CI_STATUS_MISMATCH' };
  for (const key of ['p0', 'p1', 'p2', 'p3']) {
    const blockKey = key.toUpperCase();
    if (Number(f[blockKey]) !== Number(expected[key])) return { verified: false, reason: 'FINDINGS_MISMATCH' };
  }

  const bodySha256 = createHash('sha256').update(prSnapshot.bodyText, 'utf8').digest('hex');
  return { verified: true, reason: 'FINAL_PR_METADATA_VERIFIED', bodySha256, parsedFields: f };
}
