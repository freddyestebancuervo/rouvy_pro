// Tests for tools/night-agent/ci-evidence-authority.mjs (T-F1.2 P1-A
// remediation: CI-evidence provenance laundering).
//
// Two layers are tested separately, matching the module's own gatherer/
// attestor split:
//
//  - gatherCiRunEvidence (the GATHERER): its execFileSyncFn seam is an
//    explicit, directly-tested mechanism -- exactly like source-of-truth.mjs's
//    gatherRemoteMainEvidence({spawnSyncFn}). Injecting a fake TRANSPORT here
//    (a stand-in for `gh api ...`'s stdout) is legitimate testing of the
//    MECHANISM's own parsing/verification logic; it is NOT the P1-A flaw,
//    which was a caller-suppliable CONCLUSION object trusted with zero
//    observation. The required ATTACK_CI_1..10 cases + a positive control
//    live here.
//
//  - attestCiRunEvidence (the ATTESTOR, the only function production code
//    may call): accepts NO override of any kind -- these tests call it with
//    ZERO injected transport, so gatherCiRunEvidence really runs the real
//    `gh` CLI against the REAL repository (freddyestebancuervo/rouvy_pro).
//    The positive-control SHAs below are real, already-merged commits with
//    real, completed, successful CI runs (verified independently via
//    `gh api repos/freddyestebancuervo/rouvy_pro/actions/runs` /
//    `.../jobs` before being hardcoded here) -- this mirrors the existing,
//    already-audited precedent in evidence-policy.test.mjs, whose
//    attestRemoteMainEvidence positive-path tests likewise hit the real
//    `https://github.com/freddyestebancuervo/rouvy_pro.git` remote over
//    real network. No helper here fabricates a conclusion; every genuine
//    result comes from the true authoritative frontier.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gatherCiRunEvidence,
  attestCiRunEvidence,
  isAttestedCiRunEvidence,
} from '../ci-evidence-authority.mjs';

// P1-C REMEDIATION note: REQUIRED_CI_JOB_NAME/REQUIRED_CI_WORKFLOW_NAME are no
// longer exported by the module under test (see its header comment -- a
// caller, including this test file, must never be able to influence the
// attestor's canonical policy, even by importing the "real" constant and
// handing it back). These are independent literal duplicates, used only to
// build realistic GATHERER-level transport fixtures (the gatherer's own
// execFileSyncFn seam is a legitimate, directly-tested mechanism -- see the
// module header). They are never passed to attestCiRunEvidence.
const REQUIRED_CI_JOB_NAME = 'Night Agent — security + test';
const REQUIRED_CI_WORKFLOW_NAME = 'CI';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

// Real, already-merged commits with real, completed, successful "CI"
// (event=push) runs whose "Night Agent — security + test" job succeeded --
// independently verified via `gh api` before this revision was written.
const REAL_PASS_SHA_1 = '2e909e18579108928ff0728323d570491795fbee';
const REAL_PASS_SHA_2 = '78a8c2dc2f4a414eee09b83c6596b5e69f630430';
// This project's real, immutable root commit (reused from evidence-policy.mjs)
// -- it predates CI entirely, so it genuinely has zero matching workflow runs.
const REAL_NO_CI_SHA = '7b5a2386c4b0b1b2cdc35a42c32fdbbf3f8816aa';

function jsonExec(response) {
  return () => JSON.stringify(response);
}

function sequencedExec(responses) {
  let i = 0;
  return () => {
    const r = responses[i];
    i += 1;
    if (typeof r === 'function') return r();
    return JSON.stringify(r);
  };
}

const RUNS_ONE_MATCH = {
  workflow_runs: [
    { id: 111, name: REQUIRED_CI_WORKFLOW_NAME, head_sha: VALID_SHA, event: 'push', status: 'completed', conclusion: 'success' },
  ],
};
const JOBS_REQUIRED_SUCCESS = {
  jobs: [{ name: REQUIRED_CI_JOB_NAME, status: 'completed', conclusion: 'success' }],
};

test('ATTACK_CI_1: malformed headSha (not 40 lowercase hex) is rejected before any gh invocation', () => {
  const spy = { calls: 0 };
  const execFileSyncFn = () => { spy.calls += 1; return '{}'; };
  const result = gatherCiRunEvidence({ headSha: 'not-a-real-sha', execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_HEAD_SHA_INVALID');
  assert.equal(spy.calls, 0, 'gh must never be invoked for a structurally invalid headSha');
});

test('ATTACK_CI_2 (FABRICATED_CI_RUN_ATTACK / no matching run): zero runs for the requested head_sha -> HOLD, never silently PASS', () => {
  const execFileSyncFn = jsonExec({ workflow_runs: [] });
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_NO_MATCHING_RUN');
});

test('ATTACK_CI_3: more than one matching run for the same head_sha + workflow name fails closed on ambiguity, never picks one', () => {
  const execFileSyncFn = jsonExec({
    workflow_runs: [
      { id: 1, name: REQUIRED_CI_WORKFLOW_NAME, head_sha: VALID_SHA, event: 'push', status: 'completed', conclusion: 'success' },
      { id: 2, name: REQUIRED_CI_WORKFLOW_NAME, head_sha: VALID_SHA, event: 'pull_request', status: 'completed', conclusion: 'success' },
    ],
  });
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_AMBIGUOUS_RUN');
});

test('ATTACK_CI_4: run still in_progress (not completed) -> HOLD', () => {
  const execFileSyncFn = jsonExec({
    workflow_runs: [{ id: 1, name: REQUIRED_CI_WORKFLOW_NAME, head_sha: VALID_SHA, event: 'push', status: 'in_progress', conclusion: null }],
  });
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_RUN_NOT_COMPLETED');
});

test('ATTACK_CI_5: run completed with conclusion=failure -> HOLD, never treated as PASS', () => {
  const execFileSyncFn = jsonExec({
    workflow_runs: [{ id: 1, name: REQUIRED_CI_WORKFLOW_NAME, head_sha: VALID_SHA, event: 'push', status: 'completed', conclusion: 'failure' }],
  });
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_RUN_NOT_SUCCESS');
});

test('ATTACK_CI_6 (CI_HEAD_REUSE_ATTACK): a run genuinely associated with a DIFFERENT commit cannot be reused as proof for the requested headSha', () => {
  // The GitHub API's own head_sha field on the run object is re-verified
  // rather than trusted just because it was returned in response to a
  // `head_sha=` filtered query -- a transport that lies (or a stale/replayed
  // response) is not enough.
  const execFileSyncFn = jsonExec({
    workflow_runs: [{ id: 1, name: REQUIRED_CI_WORKFLOW_NAME, head_sha: OTHER_SHA, event: 'push', status: 'completed', conclusion: 'success' }],
  });
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_NO_MATCHING_RUN');
});

test('ATTACK_CI_7 (CI_WRONG_WORKFLOW_ATTACK): a completed, successful run for the right commit but the WRONG workflow cannot substitute for CI', () => {
  const execFileSyncFn = jsonExec({
    workflow_runs: [{ id: 1, name: 'Post-merge CI locator', head_sha: VALID_SHA, event: 'workflow_run', status: 'completed', conclusion: 'success' }],
  });
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, requiredWorkflowName: REQUIRED_CI_WORKFLOW_NAME, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_NO_MATCHING_RUN');
});

test('ATTACK_CI_8 (OMITTED_WORKFLOW_ATTACK, job form): the required job is simply absent from the run\'s job list -> HOLD', () => {
  const execFileSyncFn = sequencedExec([RUNS_ONE_MATCH, { jobs: [{ name: 'Some Other Job', status: 'completed', conclusion: 'success' }] }]);
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_REQUIRED_JOB_NOT_FOUND');
});

test('ATTACK_CI_9: the required job exists but did not succeed -> HOLD, never proven from a partially-green run', () => {
  const execFileSyncFn = sequencedExec([RUNS_ONE_MATCH, { jobs: [{ name: REQUIRED_CI_JOB_NAME, status: 'completed', conclusion: 'failure' }] }]);
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_REQUIRED_JOB_NOT_SUCCESS');
});

test('ATTACK_CI_10: malformed/unparseable gh output (a hand-shaped or corrupted transport) fails closed rather than being partially trusted', () => {
  const badTransports = [
    () => 'not json',
    () => '{}',
    () => '{"workflow_runs": "not-an-array"}',
    () => { throw new Error('gh: command not found'); },
  ];
  for (const execFileSyncFn of badTransports) {
    const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
    assert.equal(result.ok, false);
    assert.ok(result.reason.startsWith('CI_EVIDENCE_'), `unexpected reason for malformed input: ${result.reason}`);
  }
});

test('ATTACK_CI positive control (gatherer mechanism): a fully realistic, self-consistent transport response is correctly recognized as proof', () => {
  const execFileSyncFn = sequencedExec([RUNS_ONE_MATCH, JOBS_REQUIRED_SUCCESS]);
  const result = gatherCiRunEvidence({ headSha: VALID_SHA, execFileSyncFn });
  assert.equal(result.ok, true);
  assert.equal(result.headSha, VALID_SHA);
  assert.equal(result.runId, 111);
  assert.equal(result.workflowName, REQUIRED_CI_WORKFLOW_NAME);
});

// ---------------------------------------------------------------------------
// Structural proof: the public API contains no caller-conclusion-minting
// function. There is no exported equivalent of
// mintTrustedEvidence(callerSuppliedCiObject) -- attestCiRunEvidence is the
// only mint path and it takes raw observation parameters only.
// ---------------------------------------------------------------------------
test('structural: attestCiRunEvidence accepts no ciRun/execFileSyncFn/gatherCiRunEvidenceFn override -- extra params are silently ignored, never trusted', () => {
  const poison = () => { throw new Error('POISONED TRANSPORT WAS INVOKED -- R4 VIOLATION'); };
  const result = attestCiRunEvidence({
    headSha: REAL_NO_CI_SHA,
    ciRun: { headSha: REAL_NO_CI_SHA, event: 'push', jobs: [{ name: REQUIRED_CI_JOB_NAME, conclusion: 'success' }] },
    execFileSyncFn: poison,
    gatherCiRunEvidenceFn: poison,
  });
  // The real, root commit genuinely has no CI runs -- if any override had
  // been honored, this would incorrectly PASS (or throw from the poison
  // function). Neither happens: the real gh lookup runs for real and finds
  // nothing, exactly as it would for any caller, override or not.
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_NO_MATCHING_RUN');
});

// ---------------------------------------------------------------------------
// P1-C REMEDIATION (T-F1.2 external re-audit round 3, HOLD): P1-A fixed the
// TRANSPORT (no caller-suppliable ciRun conclusion), but attestCiRunEvidence
// still read params.requiredJobName / params.requiredWorkflowName from its
// caller -- letting a caller redefine the POLICY of what counts as valid CI,
// even though the observation itself was now real. A caller supplying
// requiredWorkflowName: 'Attacker Workflow' / requiredJobName: 'Easy Green
// Job' could steer the attestor toward a run that never actually proves
// THIS project's real CI passed. Fixed: attestCiRunEvidence reads ONLY
// headSha from params; the canonical workflow/job identity is fixed,
// private, unexported policy. These tests prove it with real network calls
// against real, already-merged commits -- not simulated.
// ---------------------------------------------------------------------------

test('ATTESTOR_CALLER_CAN_OVERRIDE_REQUIRED_WORKFLOW = NO: a bogus requiredWorkflowName has zero effect on real attestation', () => {
  const result = attestCiRunEvidence({ headSha: REAL_PASS_SHA_1, requiredWorkflowName: 'Attacker Workflow' });
  // If the override had been honored, the gatherer would search for a run
  // named 'Attacker Workflow' for this commit -- which does not exist -- and
  // fail with CI_EVIDENCE_NO_MATCHING_RUN. It instead succeeds, bound to the
  // real canonical "CI" workflow, proving the override was never read.
  assert.equal(result.ok, true);
  assert.equal(result.evidence.headSha, REAL_PASS_SHA_1);
  assert.equal(isAttestedCiRunEvidence(result.evidence), true);
});

test('ATTESTOR_CALLER_CAN_OVERRIDE_REQUIRED_JOB = NO: a bogus requiredJobName has zero effect on real attestation', () => {
  const result = attestCiRunEvidence({ headSha: REAL_PASS_SHA_1, requiredJobName: 'Easy Green Job' });
  // If honored, the gatherer would search this run's real jobs for a job
  // literally named 'Easy Green Job' -- which does not exist -- and fail
  // with CI_EVIDENCE_REQUIRED_JOB_NOT_FOUND. It instead succeeds, bound to
  // the real canonical "Night Agent — security + test" job.
  assert.equal(result.ok, true);
  assert.equal(result.evidence.headSha, REAL_PASS_SHA_1);
  assert.equal(isAttestedCiRunEvidence(result.evidence), true);
});

test('P1-C ATTACK: every plausible alias for workflow/job policy override has zero effect (combined attack, real attestation)', () => {
  const attackParams = {
    headSha: REAL_PASS_SHA_1,
    requiredWorkflowName: 'Attacker Workflow',
    requiredJobName: 'Easy Green Job',
    workflowName: 'Attacker Workflow',
    jobName: 'Easy Green Job',
    requiredWorkflow: 'Attacker Workflow',
    requiredJob: 'Easy Green Job',
    ciWorkflowName: 'Attacker Workflow',
    ciJobName: 'Easy Green Job',
    policy: { workflow: 'Attacker Workflow', job: 'Easy Green Job' },
    config: { requiredWorkflowName: 'Attacker Workflow', requiredJobName: 'Easy Green Job' },
  };
  const result = attestCiRunEvidence(attackParams);
  assert.equal(result.ok, true, 'none of these aliases may influence the real, canonical attestation');
  assert.equal(result.evidence.headSha, REAL_PASS_SHA_1);
  assert.equal(isAttestedCiRunEvidence(result.evidence), true);
});

test('P1-C POSITIVE CONTROL: real canonical CI + real canonical Night Agent job + correct HEAD, with no override attempted, attests successfully', () => {
  const result = attestCiRunEvidence({ headSha: REAL_PASS_SHA_2 });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.headSha, REAL_PASS_SHA_2);
  assert.equal(result.evidence.workflowSchemaValidation, 'PASS');
  assert.equal(result.evidence.actionlintValidation, 'PASS');
  assert.equal(isAttestedCiRunEvidence(result.evidence), true);
});

// ---------------------------------------------------------------------------
// Attestor-level, real network. Mirrors evidence-policy.test.mjs's own
// already-audited precedent of testing attestRemoteMainEvidence against the
// real https://github.com/freddyestebancuervo/rouvy_pro.git remote.
// ---------------------------------------------------------------------------
test('attestCiRunEvidence REAL: a commit that predates CI entirely has zero matching runs -> HOLD (real gh call, real repository)', () => {
  const result = attestCiRunEvidence({ headSha: REAL_NO_CI_SHA });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CI_EVIDENCE_NO_MATCHING_RUN');
});

test('attestCiRunEvidence REAL POSITIVE: a real, merged commit with a real completed+successful required CI job mints genuine, attested evidence', () => {
  const result = attestCiRunEvidence({ headSha: REAL_PASS_SHA_1 });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.headSha, REAL_PASS_SHA_1);
  assert.equal(result.evidence.workflowSchemaValidation, 'PASS');
  assert.equal(result.evidence.actionlintValidation, 'PASS');
  assert.equal(isAttestedCiRunEvidence(result.evidence), true);

  // A shape-identical hand-built clone must NOT inherit authority.
  const cloned = { ...result.evidence };
  assert.equal(isAttestedCiRunEvidence(cloned), false);
  const roundTripped = JSON.parse(JSON.stringify(result.evidence));
  assert.equal(isAttestedCiRunEvidence(roundTripped), false);
});

test('attestCiRunEvidence REAL: two distinct real passing commits mint two distinct, mutually non-substitutable evidence objects', () => {
  const e1 = attestCiRunEvidence({ headSha: REAL_PASS_SHA_1 });
  const e2 = attestCiRunEvidence({ headSha: REAL_PASS_SHA_2 });
  assert.equal(e1.ok, true);
  assert.equal(e2.ok, true);
  assert.notEqual(e1.evidence.headSha, e2.evidence.headSha);
  assert.equal(isAttestedCiRunEvidence(e1.evidence), true);
  assert.equal(isAttestedCiRunEvidence(e2.evidence), true);
  assert.notEqual(e1.evidence, e2.evidence);
});
