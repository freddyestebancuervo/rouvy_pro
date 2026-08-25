// Korixa Night Agent — authoritative CI-run evidence gatherer/attestor
// (T-F1.2 P1-A remediation).
//
// WHY THIS EXISTS: workflow-certification-gate.mjs's
// produceWorkflowValidationEvidenceFromCiRun accepted a caller-supplied
// `ciRun` object ({headSha, event, jobs}) with NO independent observation of
// its own. The prior remediation's WeakSet (ATTESTED_WORKFLOW_VALIDATION_
// EVIDENCE) protected the minted RESULT's identity, but nothing stopped a
// caller from fabricating the ciRun INPUT that got minted -- CI-evidence
// provenance laundering. This module closes that gap by making CI
// observation itself mechanical and non-delegable, reusing the exact
// gatherer/attestor split this codebase already established and hardened in
// evidence-policy.mjs / source-of-truth.mjs:
//
//   - a GATHERER (gatherCiRunEvidence) takes RAW MATERIAL (headSha,
//     requiredJobName, requiredWorkflowName) and internally invokes the REAL
//     external tool (the GitHub CLI, `gh api ...`) via an injectable-but-
//     real-by-default execFileSyncFn used only to test the MECHANISM, never
//     to fake conclusions -- exactly like source-of-truth.mjs's
//     gatherRemoteMainEvidence({repoRoot, sha, relPath, spawnSyncFn}).
//
//   - an ATTESTOR (attestCiRunEvidence) wraps the gatherer and mints
//     unforgeable-by-shape, WeakSet-registered evidence ONLY after every
//     fail-closed gate below has genuinely passed. Per the R4 discipline
//     evidence-policy.mjs already documents for attestRemoteMainEvidence:
//     the attestor accepts NO executable-dependency override of any kind. If
//     a caller supplies execFileSyncFn (or any similarly-named parameter) on
//     attestCiRunEvidence's params, it is simply never read.
//
// The public API deliberately contains no function equivalent to
// mintTrustedEvidence(callerSuppliedCiObject) -- attestCiRunEvidence is the
// ONLY way to mint CI evidence, and it always performs its own live
// observation. Every ambiguity (no matching run, more than one matching run,
// wrong workflow, missing/failed required job, run or job not yet
// completed) fails closed.

import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Canonical trust anchor. Private, module-level, never exported, never a
// function parameter anywhere in this file, never derived from repoRoot/cwd/
// environment a caller could point elsewhere. Reused verbatim from
// evidence-policy.mjs's own CANONICAL_REPOSITORY_OWNER/NAME rather than
// re-derived, so both modules agree on the same repository identity.
// ---------------------------------------------------------------------------
const CANONICAL_REPOSITORY_OWNER = 'freddyestebancuervo';
const CANONICAL_REPOSITORY_NAME = 'rouvy_pro';
const CANONICAL_REPO_SLUG = `${CANONICAL_REPOSITORY_OWNER}/${CANONICAL_REPOSITORY_NAME}`;

// This project's real CI workflow identity (.github/workflows/ci.yml):
// top-level `name: CI`, required job `name: Night Agent — security + test`.
export const REQUIRED_CI_WORKFLOW_NAME = 'CI';
export const REQUIRED_CI_JOB_NAME = 'Night Agent — security + test';

const FULL_SHA_RE = /^[0-9a-f]{40}$/;

function isValidHeadSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value);
}

function defaultExecFileSync(command, args, options) {
  return execFileSync(command, args, options);
}

function frozen(obj) {
  return Object.freeze({ ...obj });
}

// ---------------------------------------------------------------------------
// Unforgeable-by-shape attestation. Same pattern as role-protocol-core.mjs's
// TRUSTED_AUDITOR_RESULT_REGISTRY, evidence-policy.mjs's
// TRUSTED_EVIDENCE_REGISTRY, and this codebase's own prior
// ATTESTED_WORKFLOW_VALIDATION_EVIDENCE (workflow-certification-gate.mjs):
// a module-private WeakSet keyed by object IDENTITY, never by shape. A hand-
// built object, a JSON round-trip, or a spread-copy of authentic evidence is
// shape-identical yet fails isAttestedCiRunEvidence.
// ---------------------------------------------------------------------------
const ATTESTED_CI_RUN_EVIDENCE = new WeakSet();

export function isAttestedCiRunEvidence(candidate) {
  return typeof candidate === 'object' && candidate !== null && ATTESTED_CI_RUN_EVIDENCE.has(candidate);
}

function mintCiRunEvidence(fields) {
  const evidence = frozen(fields);
  ATTESTED_CI_RUN_EVIDENCE.add(evidence);
  return evidence;
}

// ---------------------------------------------------------------------------
// GATHERER — raw mechanism. Real by default (`gh api ...`); execFileSyncFn is
// an explicit, directly-tested seam for THIS function's own unit tests only
// (mirrors gatherRemoteMainEvidence's spawnSyncFn) — attestCiRunEvidence
// below never forwards a caller-supplied override into this parameter.
// ---------------------------------------------------------------------------
export function gatherCiRunEvidence({
  headSha,
  requiredJobName = REQUIRED_CI_JOB_NAME,
  requiredWorkflowName = REQUIRED_CI_WORKFLOW_NAME,
  execFileSyncFn = defaultExecFileSync,
} = {}) {
  if (!isValidHeadSha(headSha)) {
    return { ok: false, reason: 'CI_EVIDENCE_HEAD_SHA_INVALID' };
  }
  if (typeof requiredJobName !== 'string' || requiredJobName.length === 0) {
    return { ok: false, reason: 'CI_EVIDENCE_REQUIRED_JOB_MISSING' };
  }
  if (typeof requiredWorkflowName !== 'string' || requiredWorkflowName.length === 0) {
    return { ok: false, reason: 'CI_EVIDENCE_REQUIRED_WORKFLOW_MISSING' };
  }
  if (typeof execFileSyncFn !== 'function') {
    return { ok: false, reason: 'CI_EVIDENCE_EXEC_UNAVAILABLE' };
  }

  let runsRaw;
  try {
    runsRaw = execFileSyncFn(
      'gh',
      ['api', `repos/${CANONICAL_REPO_SLUG}/actions/runs`, '-X', 'GET', '-f', `head_sha=${headSha}`, '-f', 'per_page=30'],
      { encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    return { ok: false, reason: 'CI_EVIDENCE_RUN_LOOKUP_FAILED', detail: err?.message ?? String(err) };
  }

  let runsParsed;
  try {
    runsParsed = JSON.parse(runsRaw);
  } catch {
    return { ok: false, reason: 'CI_EVIDENCE_RUN_LOOKUP_UNPARSEABLE' };
  }

  const runs = Array.isArray(runsParsed?.workflow_runs) ? runsParsed.workflow_runs : null;
  if (runs === null) {
    return { ok: false, reason: 'CI_EVIDENCE_RUN_LOOKUP_MALFORMED' };
  }

  // Fail closed on ambiguity: exactly one run for this exact head_sha (the
  // API is asked to filter by it, but the response's own head_sha field is
  // re-verified rather than trusted -- CI_HEAD_REUSE_ATTACK defense) whose
  // workflow name matches the CI workflow we require, never any workflow.
  const matches = runs.filter((run) => run?.head_sha === headSha && run?.name === requiredWorkflowName);
  if (matches.length === 0) {
    return { ok: false, reason: 'CI_EVIDENCE_NO_MATCHING_RUN' };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'CI_EVIDENCE_AMBIGUOUS_RUN' };
  }

  const run = matches[0];
  if (run.status !== 'completed') {
    return { ok: false, reason: 'CI_EVIDENCE_RUN_NOT_COMPLETED' };
  }
  if (run.conclusion !== 'success') {
    return { ok: false, reason: 'CI_EVIDENCE_RUN_NOT_SUCCESS' };
  }
  if (typeof run.id !== 'number' || !Number.isFinite(run.id)) {
    return { ok: false, reason: 'CI_EVIDENCE_RUN_ID_MISSING' };
  }

  let jobsRaw;
  try {
    jobsRaw = execFileSyncFn(
      'gh',
      ['api', `repos/${CANONICAL_REPO_SLUG}/actions/runs/${run.id}/jobs`],
      { encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    return { ok: false, reason: 'CI_EVIDENCE_JOBS_LOOKUP_FAILED', detail: err?.message ?? String(err) };
  }

  let jobsParsed;
  try {
    jobsParsed = JSON.parse(jobsRaw);
  } catch {
    return { ok: false, reason: 'CI_EVIDENCE_JOBS_UNPARSEABLE' };
  }

  const jobs = Array.isArray(jobsParsed?.jobs) ? jobsParsed.jobs : null;
  if (jobs === null) {
    return { ok: false, reason: 'CI_EVIDENCE_JOBS_MALFORMED' };
  }

  const matchingJobs = jobs.filter((job) => job?.name === requiredJobName);
  if (matchingJobs.length === 0) {
    return { ok: false, reason: 'CI_EVIDENCE_REQUIRED_JOB_NOT_FOUND' };
  }
  if (matchingJobs.length > 1) {
    return { ok: false, reason: 'CI_EVIDENCE_AMBIGUOUS_JOB' };
  }

  const job = matchingJobs[0];
  if (job.status !== 'completed') {
    return { ok: false, reason: 'CI_EVIDENCE_REQUIRED_JOB_NOT_COMPLETED' };
  }
  if (job.conclusion !== 'success') {
    return { ok: false, reason: 'CI_EVIDENCE_REQUIRED_JOB_NOT_SUCCESS' };
  }

  return {
    ok: true,
    headSha,
    runId: run.id,
    workflowName: run.name,
    event: run.event,
    requiredJobName,
  };
}

// ---------------------------------------------------------------------------
// ATTESTOR — the ONLY function production code may call to mint CI evidence.
// R4 discipline: this function's parameter object accepts ONLY observation
// data (headSha, requiredJobName, requiredWorkflowName). No execFileSyncFn,
// gatherCiRunEvidenceFn, or any similarly-named executable-dependency
// override is ever read here, even if present on the caller's params object
// -- it is silently ignored, exactly as evidence-policy.mjs's
// attestRemoteMainEvidence never forwards a caller-supplied spawnSyncFn.
// ---------------------------------------------------------------------------
export function attestCiRunEvidence(params = {}) {
  const headSha = params?.headSha;
  const requiredJobName = typeof params?.requiredJobName === 'string' ? params.requiredJobName : REQUIRED_CI_JOB_NAME;
  const requiredWorkflowName = typeof params?.requiredWorkflowName === 'string' ? params.requiredWorkflowName : REQUIRED_CI_WORKFLOW_NAME;

  const gathered = gatherCiRunEvidence({ headSha, requiredJobName, requiredWorkflowName });
  if (!gathered.ok) {
    return { ok: false, reason: gathered.reason, detail: gathered.detail };
  }

  const evidence = mintCiRunEvidence({
    headSha: gathered.headSha,
    workflowSchemaValidation: 'PASS',
    actionlintValidation: 'PASS',
    ciRunId: gathered.runId,
    ciWorkflowName: gathered.workflowName,
    ciEvent: gathered.event,
  });

  return { ok: true, evidence };
}
