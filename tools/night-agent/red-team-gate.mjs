// Korixa Night Agent — Mandatory Red-Team Gate (NIGHT_HARDENING_1, 2026-08-22).
//
// No result equivalent to a final PASS may be issued until an adversarial
// review has actually run and its verdict is recorded. This module makes
// "did the red-team phase run" a checkable fact (a complete, explicit verdict
// per required check — see RED_TEAM_CHECKS) rather than a step someone might
// have skipped silently. It does not itself decide PASS/HOLD for a whole
// session — see executor-auditor-gate.mjs's certifyIndependentAuditResult,
// which refuses to grant a PASS-shaped result without a *completed,
// non-blocking* runRedTeamPhase() result.
//
// Three of the sixteen required checks are automated by a real, if
// deliberately narrow, static scanner (scanGithubActionsWorkflowText) —
// these three are exactly the class of defect this project has already found
// and fixed for real, more than once, in this repo's own history (see
// _backend-db-readonly-inspection-production.yml's P1-8 remediation:
// `execution_status=failed` + `::error::` with no `exit 1`, closed in commit
// 46aaa3e). The remaining checks require a human/agent to record an explicit
// verdict — this module cannot honestly claim to fully automate detecting
// "is this IAM grant too broad" or "is this rollback pointed at the right
// revision" via regex, and pretending otherwise would be worse than not
// automating them at all. What it CAN and does guarantee is that none of the
// sixteen can be silently skipped: an incomplete checklist is not a passing
// one.
//
// classifyCommandFailure is the second half of this module: the concrete,
// permanent regression fix for KORIXA's own recurring class of error —
// "a command failed, therefore I know WHY it failed" — see its own header
// comment below for the exact incident this closes.

// ---------------------------------------------------------------------------
// The sixteen required adversarial checks (FASE 4, items 1-16). Closed list —
// exactly these IDs, nothing else recognized.
// ---------------------------------------------------------------------------

export const RED_TEAM_CHECKS = Object.freeze([
  { id: 'ERROR_MISREAD_AS_STATE', description: 'A command/step error was converted into a specific concrete state conclusion instead of "unknown".' },
  { id: 'COMMAND_OR_ASSUME_STATE', description: 'Any `command || assume_specific_state` pattern (or shell equivalent) that treats a failed command as proof of a particular outcome.' },
  { id: 'FAILURE_MISREAD_AS_ABSENCE', description: '"Command failed" was confused with "the resource does not exist".' },
  { id: 'WRONG_SHA_USED', description: 'The wrong commit SHA (stale/branch-head-race/uncomputed) could be deployed, migrated, or otherwise acted upon.' },
  { id: 'TOCTOU_RACE', description: 'A time-of-check/time-of-use race exists between validation and the action it gates.' },
  { id: 'ROLLBACK_MISSING_OR_WRONG_TARGET', description: 'No rollback path exists, or it targets the wrong revision/resource.' },
  { id: 'TRAFFIC_BEFORE_HEALTH_CHECK', description: 'Traffic/requests could be routed to a target before its health is actually confirmed.' },
  { id: 'IAM_TOO_BROAD', description: 'A grant, role, or scope is wider than the task actually needs.' },
  { id: 'SECRETS_EXPOSED', description: 'A secret value could be logged, echoed, or otherwise exposed.' },
  { id: 'EXIT_CODE_IGNORED', description: 'A command\'s real exit/return code is discarded instead of gating subsequent steps.' },
  { id: 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT', description: 'A GitHub Actions step prints `::error::` but never exits non-zero, so the step (and job) can still report success.' },
  { id: 'DANGEROUS_DEFAULT', description: 'A default value is unsafe (e.g. a mutation defaults to enabled, a scope defaults to broad).' },
  { id: 'INVERTED_CONDITION', description: 'A conditional\'s sense is backwards (e.g. `if healthy` where the branch actually handles the unhealthy case).' },
  { id: 'CONTINUE_ON_ERROR_HIDES_FAILURE', description: '`continue-on-error` (or an equivalent) is used somewhere it can hide a real failure from the overall result.' },
  { id: 'FAILURE_CAUGHT_AS_SUCCESS', description: 'An exception/rejection/non-zero result is caught and treated as a success path.' },
  { id: 'UNGATED_IRREVERSIBLE_MUTATION', description: 'An irreversible action (delete, force-push, traffic-100%, secret rotation, etc.) can run without an explicit safety gate.' },
]);

const RED_TEAM_CHECK_IDS = Object.freeze(RED_TEAM_CHECKS.map((c) => c.id));
const RED_TEAM_CHECK_ID_SET = new Set(RED_TEAM_CHECK_IDS);

const CHECK_STATUSES = Object.freeze(['CLEAR', 'FINDING']);

// ---------------------------------------------------------------------------
// runRedTeamPhase — requires a COMPLETE, explicit verdict for every one of
// the sixteen checks. Missing even one means the phase did not run (fails
// closed to `completed: false`), never "assume the rest were fine".
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {Array<{checkId: string, status: 'CLEAR'|'FINDING', detail?: string, severity?: 'P0'|'P1'|'P2'|'P3'}>} input.checksPerformed
 */
export function runRedTeamPhase(input) {
  const checksPerformed = Array.isArray(input?.checksPerformed) ? input.checksPerformed : [];

  const byId = new Map();
  const invalidEntries = [];
  for (const entry of checksPerformed) {
    const checkId = entry?.checkId;
    const status = entry?.status;
    if (!RED_TEAM_CHECK_ID_SET.has(checkId) || !CHECK_STATUSES.includes(status)) {
      invalidEntries.push(entry);
      continue;
    }
    // Last valid entry for a given checkId wins; duplicates are not an error
    // (a caller may legitimately re-run a single check), but every entry
    // must independently be well-formed.
    byId.set(checkId, { checkId, status, detail: typeof entry?.detail === 'string' ? entry.detail : null, severity: ['P0', 'P1', 'P2', 'P3'].includes(entry?.severity) ? entry.severity : null });
  }

  const missingCheckIds = RED_TEAM_CHECK_IDS.filter((id) => !byId.has(id));

  if (invalidEntries.length > 0 || missingCheckIds.length > 0) {
    return Object.freeze({
      completed: false,
      blocking: true, // an incomplete red-team phase is treated as blocking by default -- never "probably fine"
      reason: invalidEntries.length > 0 ? 'INVALID_CHECK_ENTRY' : 'INCOMPLETE_CHECKLIST',
      missingCheckIds,
      invalidEntries: Object.freeze(invalidEntries),
      findings: Object.freeze([]),
    });
  }

  const findings = [...byId.values()].filter((c) => c.status === 'FINDING');
  // A FINDING is blocking unless it was explicitly downgraded to P2/P3 — an
  // unset/unrecognized severity on a FINDING defaults to blocking (fail
  // closed: silence about severity is never treated as "minor").
  const blocking = findings.some((f) => f.severity !== 'P2' && f.severity !== 'P3');

  return Object.freeze({
    completed: true,
    blocking,
    reason: blocking ? 'BLOCKING_FINDING' : (findings.length > 0 ? 'NONBLOCKING_FINDINGS_ONLY' : 'CLEAR'),
    missingCheckIds: Object.freeze([]),
    invalidEntries: Object.freeze([]),
    findings: Object.freeze(findings),
  });
}

// ---------------------------------------------------------------------------
// classifyCommandFailure — permanent fix for KORIXA's own recurring defect
// class: treating "a command failed/exited non-zero" as proof of a specific
// concrete state (most often "the resource does not exist"). This exact
// pattern was found and fixed for real in this repo's history — e.g.
// `_backend-deploy-cloud-run-production.yml`'s P0-1 remediation, which
// replaced `if ! gcloud run services describe ...; then SERVICE_DOES_NOT_
// EXIST=true; fi` (wrong: a describe call also fails on permission errors,
// auth expiry, transient network/API errors, wrong project, or malformed
// input — none of which mean "does not exist") with a `services list
// --filter` call whose STRUCTURED, EXPLICIT zero-result JSON is the only
// admissible proof of absence.
//
// The one invariant this function enforces structurally, not just by
// documentation: RESOURCE_DOES_NOT_EXIST is reachable ONLY via `positiveEvidence`
// of the correct shape. There is no code path — no exit code, no stderr
// text, no combination of inputs — that reaches RESOURCE_DOES_NOT_EXIST
// through the failure-classification branches below. A caller that only has
// a failed command and its stderr can never get anything stronger than
// UNKNOWN_OTHER_FAILURE (or one of the three narrower still-not-a-state
// classes) out of this function.
// ---------------------------------------------------------------------------

export const COMMAND_FAILURE_CLASSES = Object.freeze([
  'RESOURCE_DOES_NOT_EXIST',
  'AUTH_PERMISSION_FAILURE',
  'NETWORK_FAILURE',
  'MALFORMED_REQUEST',
  'UNKNOWN_OTHER_FAILURE',
]);

const AUTH_PATTERNS = [/permission.?denied/i, /unauthorized/i, /forbidden/i, /authentication/i, /PERMISSION_DENIED/, /invalid_grant/i, /access.?denied/i, /not authorized/i];
const NETWORK_PATTERNS = [/ETIMEDOUT/, /ECONNREFUSED/, /ENOTFOUND/, /EAI_AGAIN/, /network is unreachable/i, /could not resolve host/i, /connection reset/i, /getaddrinfo/i];
const MALFORMED_PATTERNS = [/invalid.{0,20}argument/i, /INVALID_ARGUMENT/, /bad request/i, /malformed/i, /unrecognized (arguments|flag)/i, /unexpected argument/i];

/**
 * @param {object} input
 * @param {number} [input.exitCode]
 * @param {string} [input.stderr]
 * @param {{type: 'EXPLICIT_STRUCTURED_ABSENCE', detail?: string}} [input.positiveEvidence] -
 *   the ONLY parameter that can ever yield RESOURCE_DOES_NOT_EXIST. Must
 *   represent a SUCCESSFUL, structured query (e.g. a `list --filter`
 *   call that itself exited 0 and returned a well-formed, explicitly
 *   parsed empty result set) — never derived from the failing command
 *   itself.
 */
export function classifyCommandFailure(input) {
  const positiveEvidence = input?.positiveEvidence;
  if (positiveEvidence && positiveEvidence.type === 'EXPLICIT_STRUCTURED_ABSENCE') {
    return Object.freeze({ classification: 'RESOURCE_DOES_NOT_EXIST', evidenceLevel: 'PROVEN_BY_LIVE_READ_ONLY', basis: 'explicit_structured_absence' });
  }

  const exitCode = input?.exitCode;
  if (exitCode === 0 || exitCode === undefined || exitCode === null) {
    // Nothing actually failed (or the caller didn't say anything failed) and
    // there was no positive evidence either -- there is nothing to classify
    // as a failure at all. Fail closed rather than guessing what the caller
    // meant.
    return Object.freeze({ classification: 'UNKNOWN_OTHER_FAILURE', evidenceLevel: 'UNPROVEN', basis: 'no_failure_and_no_positive_evidence' });
  }

  const text = typeof input?.stderr === 'string' ? input.stderr : '';
  if (AUTH_PATTERNS.some((p) => p.test(text))) {
    return Object.freeze({ classification: 'AUTH_PERMISSION_FAILURE', evidenceLevel: 'UNPROVEN', basis: 'stderr_pattern_match' });
  }
  if (NETWORK_PATTERNS.some((p) => p.test(text))) {
    return Object.freeze({ classification: 'NETWORK_FAILURE', evidenceLevel: 'UNPROVEN', basis: 'stderr_pattern_match' });
  }
  if (MALFORMED_PATTERNS.some((p) => p.test(text))) {
    return Object.freeze({ classification: 'MALFORMED_REQUEST', evidenceLevel: 'UNPROVEN', basis: 'stderr_pattern_match' });
  }
  return Object.freeze({ classification: 'UNKNOWN_OTHER_FAILURE', evidenceLevel: 'UNPROVEN', basis: 'no_pattern_matched' });
}

// ---------------------------------------------------------------------------
// scanGithubActionsWorkflowText — a real, narrow, line-based static scanner
// (deliberately not a full YAML/shell parser) automating exactly the three
// checks this project has already proven, in its own history, are both
// mechanically detectable and real (not hypothetical): GH_ACTIONS_ERROR_
// ANNOTATION_WITHOUT_EXIT, CONTINUE_ON_ERROR_HIDES_FAILURE, and
// COMMAND_OR_ASSUME_STATE. Read-only: takes workflow YAML as a string,
// returns findings; never opens, executes, or mutates anything itself. A
// caller is expected to `fs.readFileSync` the workflow file and pass its
// text in.
// ---------------------------------------------------------------------------

const ERROR_ANNOTATION_PATTERN = /::error::/;
const EXIT_NONZERO_PATTERN = /\bexit\s+([1-9]\d*|\$[A-Za-z_][A-Za-z0-9_]*)\b/;
const CONTINUE_ON_ERROR_PATTERN = /continue-on-error:\s*true/i;
// `if ! <cmd>; then <VAR>=true` (or `=1`/`="true"`) with no further
// disambiguation on the same logical line -- the exact KORIXA anti-pattern.
const AMBIGUOUS_FAILURE_PATTERN = /if\s*!\s*\S+.*;\s*then\b/i;
const STATE_ASSUMPTION_PATTERN = /\b([A-Z][A-Z0-9_]*)\s*=\s*(true|1|"true")\b/;

export function scanGithubActionsWorkflowText(yamlText) {
  const text = typeof yamlText === 'string' ? yamlText : '';
  const lines = text.split('\n');
  const findings = [];

  // --- continue-on-error ---
  lines.forEach((line, idx) => {
    if (CONTINUE_ON_ERROR_PATTERN.test(line)) {
      findings.push({ checkId: 'CONTINUE_ON_ERROR_HIDES_FAILURE', line: idx + 1, snippet: line.trim() });
    }
  });

  // --- ::error:: without a following exit (looked for within the same
  // `run:` block -- approximated here as "within the next 15 lines and
  // before the next step boundary", which is generous enough to avoid false
  // positives on multi-line scripts while still catching the real pattern
  // this project has hit twice).
  //
  // NIGHT_HARDENING_1-R2 SECURITY CORRECTION (this revision) closes a real
  // false negative an independent audit of R1 reproduced live: the step-
  // boundary regex only recognized `- name:`/`- uses:` as the start of a new
  // step, not a bare `- run:` (a perfectly ordinary, common GitHub Actions
  // shape — used even in this module's own test fixtures). An unguarded
  // `::error::` followed by an UNRELATED, different step's `exit 1` was
  // silently treated as "the exit follows", missing the exact P1-8-shaped
  // defect this scanner exists to catch. Fixed by also recognizing `- run:`
  // as a step boundary. Also closes a second, related false negative: the
  // exit-pattern check matched inside `#`-comment lines (e.g. `# TODO: exit
  // 1 once this is safe`), letting a commented-out, non-executing "exit"
  // silently clear a real finding — comment lines are now skipped entirely
  // for this check.
  // ---------------------------------------------------------------------------
  lines.forEach((line, idx) => {
    if (!ERROR_ANNOTATION_PATTERN.test(line)) return;
    const windowEnd = Math.min(lines.length, idx + 16);
    let sawExit = false;
    for (let j = idx; j < windowEnd; j += 1) {
      if (/^\s*-\s*(name:|uses:|run:)/.test(lines[j]) && j > idx) break; // next step started
      if (/^\s*#/.test(lines[j])) continue; // a comment line never counts as a real exit
      if (EXIT_NONZERO_PATTERN.test(lines[j])) { sawExit = true; break; }
    }
    if (!sawExit) {
      findings.push({ checkId: 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT', line: idx + 1, snippet: line.trim() });
    }
  });

  // --- ambiguous command-failure -> assumed state ---
  lines.forEach((line, idx) => {
    if (!AMBIGUOUS_FAILURE_PATTERN.test(line)) return;
    const windowEnd = Math.min(lines.length, idx + 6);
    for (let j = idx; j < windowEnd; j += 1) {
      if (STATE_ASSUMPTION_PATTERN.test(lines[j])) {
        findings.push({ checkId: 'COMMAND_OR_ASSUME_STATE', line: idx + 1, snippet: line.trim() });
        break;
      }
    }
  });

  return Object.freeze({ findings: Object.freeze(findings) });
}
