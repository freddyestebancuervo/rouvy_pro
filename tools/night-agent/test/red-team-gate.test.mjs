// Tests for tools/night-agent/red-team-gate.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RED_TEAM_CHECKS,
  runRedTeamPhase,
  classifyCommandFailure,
  scanGithubActionsWorkflowText,
} from '../red-team-gate.mjs';

function clearChecklist(overrides = {}) {
  return RED_TEAM_CHECKS.map((c) => ({ checkId: c.id, status: overrides[c.id] ?? 'CLEAR' }));
}

// =============================================================================
// TEST F: no red-team phase run -> HOLD_RED_TEAM_NOT_RUN (checked here at the
// runRedTeamPhase level; executor-auditor-gate.test.mjs checks the full wire-up).
// =============================================================================

test('TEST_F: an empty checklist is not a completed red-team phase', () => {
  const result = runRedTeamPhase({ checksPerformed: [] });
  assert.equal(result.completed, false);
  assert.equal(result.blocking, true);
  assert.equal(result.reason, 'INCOMPLETE_CHECKLIST');
  assert.equal(result.missingCheckIds.length, RED_TEAM_CHECKS.length);
});

test('a checklist missing even one of the sixteen required checks is incomplete', () => {
  const partial = clearChecklist().slice(0, RED_TEAM_CHECKS.length - 1);
  const result = runRedTeamPhase({ checksPerformed: partial });
  assert.equal(result.completed, false);
  assert.equal(result.missingCheckIds.length, 1);
});

test('an entry with an unrecognized checkId or status is invalid and blocks completion', () => {
  const bad = [...clearChecklist(), { checkId: 'NOT_A_REAL_CHECK', status: 'CLEAR' }];
  const result = runRedTeamPhase({ checksPerformed: bad });
  assert.equal(result.completed, false);
  assert.equal(result.reason, 'INVALID_CHECK_ENTRY');
});

test('a fully clear checklist across all sixteen checks -> completed=true, blocking=false', () => {
  const result = runRedTeamPhase({ checksPerformed: clearChecklist() });
  assert.equal(result.completed, true);
  assert.equal(result.blocking, false);
  assert.equal(result.reason, 'CLEAR');
});

// =============================================================================
// TEST I: a blocking adversarial finding forces HOLD even though every other
// check is green.
// =============================================================================

test('TEST_I: one FINDING with no severity (defaults to blocking) among fifteen CLEAR checks -> blocking=true', () => {
  const checks = clearChecklist({ WRONG_SHA_USED: 'FINDING' });
  const result = runRedTeamPhase({ checksPerformed: checks });
  assert.equal(result.completed, true);
  assert.equal(result.blocking, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].checkId, 'WRONG_SHA_USED');
});

test('a FINDING explicitly downgraded to P2 is recorded but does not block', () => {
  const checks = RED_TEAM_CHECKS.map((c) => (
    c.id === 'DANGEROUS_DEFAULT' ? { checkId: c.id, status: 'FINDING', severity: 'P2', detail: 'minor' } : { checkId: c.id, status: 'CLEAR' }
  ));
  const result = runRedTeamPhase({ checksPerformed: checks });
  assert.equal(result.completed, true);
  assert.equal(result.blocking, false);
  assert.equal(result.reason, 'NONBLOCKING_FINDINGS_ONLY');
});

test('a FINDING explicitly marked P0 blocks', () => {
  const checks = clearChecklist({ UNGATED_IRREVERSIBLE_MUTATION: 'FINDING' });
  const idx = checks.findIndex((c) => c.checkId === 'UNGATED_IRREVERSIBLE_MUTATION');
  checks[idx] = { checkId: 'UNGATED_IRREVERSIBLE_MUTATION', status: 'FINDING', severity: 'P0' };
  const result = runRedTeamPhase({ checksPerformed: checks });
  assert.equal(result.blocking, true);
});

// =============================================================================
// TEST G + REGRESIÓN OBLIGATORIA: classifyCommandFailure.
// =============================================================================

test('TEST_G: a nonzero exit code with no positiveEvidence NEVER classifies as RESOURCE_DOES_NOT_EXIST', () => {
  for (const exitCode of [1, 2, 127, 255]) {
    for (const stderr of ['', 'some random error text', 'ERROR: something broke']) {
      const result = classifyCommandFailure({ exitCode, stderr });
      assert.notEqual(result.classification, 'RESOURCE_DOES_NOT_EXIST', `exitCode=${exitCode} stderr=${stderr}`);
      assert.equal(result.evidenceLevel, 'UNPROVEN');
    }
  }
});

test('TEST_G: distinguishes auth/permission, network, malformed-request, and unknown failures', () => {
  assert.equal(classifyCommandFailure({ exitCode: 1, stderr: 'PERMISSION_DENIED: caller lacks role' }).classification, 'AUTH_PERMISSION_FAILURE');
  assert.equal(classifyCommandFailure({ exitCode: 1, stderr: 'Error: connect ECONNREFUSED 127.0.0.1:443' }).classification, 'NETWORK_FAILURE');
  assert.equal(classifyCommandFailure({ exitCode: 1, stderr: 'ERROR: (gcloud) INVALID_ARGUMENT: bad request' }).classification, 'MALFORMED_REQUEST');
  assert.equal(classifyCommandFailure({ exitCode: 1, stderr: 'a completely unrelated failure message' }).classification, 'UNKNOWN_OTHER_FAILURE');
});

test('REGRESIÓN OBLIGATORIA: the exact KORIXA anti-pattern -- describe fails, service concluded absent -- is refused', () => {
  // Simulates: `gcloud run services describe X` failed with a transient/auth
  // error. The caller must NOT be able to conclude RESOURCE_DOES_NOT_EXIST
  // from this alone, no matter how the failure looks.
  const describeFailure = classifyCommandFailure({ exitCode: 1, stderr: 'ERROR: (gcloud.run.services.describe) NOT_FOUND: Service not found.' });
  assert.notEqual(describeFailure.classification, 'RESOURCE_DOES_NOT_EXIST');
});

test('positiveEvidence of the correct shape is the ONLY way to reach RESOURCE_DOES_NOT_EXIST', () => {
  const result = classifyCommandFailure({ positiveEvidence: { type: 'EXPLICIT_STRUCTURED_ABSENCE', detail: 'services list --filter returned zero exact matches' } });
  assert.equal(result.classification, 'RESOURCE_DOES_NOT_EXIST');
  assert.equal(result.evidenceLevel, 'PROVEN_BY_LIVE_READ_ONLY');
});

test('a wrong-shaped positiveEvidence (not EXPLICIT_STRUCTURED_ABSENCE) does not grant RESOURCE_DOES_NOT_EXIST', () => {
  const result = classifyCommandFailure({ exitCode: 1, stderr: 'boom', positiveEvidence: { type: 'I_JUST_THINK_SO' } });
  assert.notEqual(result.classification, 'RESOURCE_DOES_NOT_EXIST');
});

test('exitCode 0 / omitted with no positiveEvidence -> UNKNOWN_OTHER_FAILURE, never a guessed state', () => {
  assert.equal(classifyCommandFailure({ exitCode: 0 }).classification, 'UNKNOWN_OTHER_FAILURE');
  assert.equal(classifyCommandFailure({}).classification, 'UNKNOWN_OTHER_FAILURE');
});

// =============================================================================
// scanGithubActionsWorkflowText -- real static scanner.
// =============================================================================

test('detects the real, historical KORIXA P1-8 defect shape: ::error:: with no exit', () => {
  const yaml = [
    'jobs:',
    '  wait-execution:',
    '    steps:',
    '      - name: Capturar el resultado',
    '        run: |',
    '          if [ "$SUCCEEDED_COUNT" = "1" ]; then',
    '            echo "ok"',
    '          else',
    '            echo "::error::execution failed"',
    '          fi',
  ].join('\n');
  const result = scanGithubActionsWorkflowText(yaml);
  assert.ok(result.findings.some((f) => f.checkId === 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT'));
});

test('does NOT flag ::error:: when an exit 1 follows in the same block (the fixed shape)', () => {
  const yaml = [
    '      - run: |',
    '          echo "::error::execution failed"',
    '          exit 1',
  ].join('\n');
  const result = scanGithubActionsWorkflowText(yaml);
  assert.equal(result.findings.filter((f) => f.checkId === 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT').length, 0);
});

// R2 SECURITY CORRECTION regression: an independent audit reproduced this
// live -- an unguarded `::error::` in one bare `- run:` step was masked by
// an unrelated `exit 1` belonging to a DIFFERENT, later step, because the
// step-boundary regex only recognized `- name:`/`- uses:`, not `- run:`.
test('R2 REGRESSION: an ::error:: in one bare "- run:" step is NOT masked by an unrelated exit in a different step', () => {
  const yaml = [
    '      - run: |',
    '          echo "::error::execution failed, see logs"',
    '      - run: |',
    '          some-other-unrelated-command || exit 1',
  ].join('\n');
  const result = scanGithubActionsWorkflowText(yaml);
  assert.ok(
    result.findings.some((f) => f.checkId === 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT'),
    'expected the first step\'s unguarded ::error:: to be flagged despite the second, unrelated step\'s exit 1',
  );
});

test('a bare "- run:" step IS recognized as a step boundary (does not merely fix the false negative by over-widening the window)', () => {
  const yaml = [
    '      - run: |',
    '          echo "::error::first step failed"',
    '      - run: |',
    '          echo "second step, unrelated"',
    '          exit 1',
  ].join('\n');
  const result = scanGithubActionsWorkflowText(yaml);
  const flaggedLines = result.findings.filter((f) => f.checkId === 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT').map((f) => f.line);
  assert.deepEqual(flaggedLines, [2]);
});

// R2 SECURITY CORRECTION regression: a commented-out "exit" must never count
// as a real one.
test('R2 REGRESSION: a commented-out "exit 1" does not clear a real, unguarded ::error:: finding', () => {
  const yaml = [
    '      - run: |',
    '          echo "::error::execution failed"',
    '          # TODO: exit 1 once this is safe',
  ].join('\n');
  const result = scanGithubActionsWorkflowText(yaml);
  assert.ok(result.findings.some((f) => f.checkId === 'GH_ACTIONS_ERROR_ANNOTATION_WITHOUT_EXIT'));
});

test('detects continue-on-error: true', () => {
  const yaml = 'steps:\n  - run: might-fail.sh\n    continue-on-error: true\n';
  const result = scanGithubActionsWorkflowText(yaml);
  assert.ok(result.findings.some((f) => f.checkId === 'CONTINUE_ON_ERROR_HIDES_FAILURE'));
});

test('detects the ambiguous command-or-assume-state anti-pattern', () => {
  const yaml = [
    '      - run: |',
    '          if ! gcloud run services describe "$SERVICE" --project=x; then',
    '            SERVICE_DOES_NOT_EXIST=true',
    '          fi',
  ].join('\n');
  const result = scanGithubActionsWorkflowText(yaml);
  assert.ok(result.findings.some((f) => f.checkId === 'COMMAND_OR_ASSUME_STATE'));
});

test('a clean workflow with no anti-patterns produces zero findings', () => {
  const yaml = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - run: npm ci',
    '      - run: npm run build',
    '      - run: npm test',
  ].join('\n');
  assert.deepEqual(scanGithubActionsWorkflowText(yaml).findings, []);
});

test('empty/non-string input never throws and returns zero findings', () => {
  assert.deepEqual(scanGithubActionsWorkflowText('').findings, []);
  assert.deepEqual(scanGithubActionsWorkflowText(undefined).findings, []);
});
