import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateJobExecutionModel, classifyJobExecutionModel, extractJobFacts } from '../workflow-job-model-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

// ---------------------------------------------------------------------------
// VALID CASE 1 — job with steps + runs-on -> PASS
// ---------------------------------------------------------------------------
test('VALID CASE 1: a step-based job declaring runs-on passes', () => {
  const fixture = `jobs:\n  guard:\n    runs-on: ubuntu-latest\n    permissions: {}\n    steps:\n      - run: echo hi\n`;
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.jobs[0].model, 'STEP_JOB');
});

// ---------------------------------------------------------------------------
// INVALID CASE — job with steps but no runs-on -> FAIL
// ---------------------------------------------------------------------------
test('INVALID CASE: a step-based job missing runs-on fails closed', () => {
  const fixture = `jobs:\n  prepare-inspection-inputs:\n    needs: guard\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n`;
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].jobName, 'prepare-inspection-inputs');
  assert.equal(result.violations[0].reason, 'STEP_JOB_MISSING_RUNS_ON');
});

// ---------------------------------------------------------------------------
// VALID CASE 2 — job with top-level uses calling a reusable workflow and
// no runs-on -> PASS (must NOT be falsely rejected for lacking runs-on)
// ---------------------------------------------------------------------------
test('VALID CASE 2: a reusable-workflow-call job without runs-on is never flagged', () => {
  const fixture = `jobs:\n  build-production-artifact:\n    needs: [guard]\n    permissions:\n      contents: read\n      id-token: write\n    uses: ./.github/workflows/_backend-build-publish-production.yml\n    with:\n      operation: build-publish\n`;
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.jobs[0].model, 'REUSABLE_WORKFLOW_CALL_JOB');
});

test('a job declaring both steps and top-level uses is ambiguous, not silently accepted', () => {
  const fixture = `jobs:\n  weird:\n    uses: ./.github/workflows/x.yml\n    steps:\n      - run: echo hi\n`;
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].reason, 'JOB_DECLARES_BOTH_STEPS_AND_TOP_LEVEL_USES');
});

test('a job with neither steps nor top-level uses is flagged, not silently ignored', () => {
  const fixture = `jobs:\n  empty:\n    needs: guard\n`;
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].reason, 'JOB_HAS_NEITHER_STEPS_NOR_TOP_LEVEL_USES');
});

test('multiple jobs are each classified and validated independently', () => {
  const fixture = [
    'jobs:',
    '  guard:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo a',
    '  broken:',
    '    steps:',
    '      - run: echo b',
    '  caller:',
    '    uses: ./.github/workflows/x.yml',
  ].join('\n');
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.jobs.length, 3);
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].jobName, 'broken');
});

// ---------------------------------------------------------------------------
// FALSE-POSITIVE RESISTANCE — the gate must not be fooled by text that
// merely CONTAINS "runs-on:"/"steps:"/"uses:" outside the correct
// indentation/position (e.g. inside a shell script body, a comment, or a
// job's `name:` string), since a naive substring/regex-without-indentation
// check would produce exactly this kind of false PASS.
// ---------------------------------------------------------------------------
test('a run: script body merely mentioning "runs-on:" as text does not count as the real key', () => {
  const fixture = [
    'jobs:',
    '  broken:',
    '    steps:',
    '      - name: Print a misleading string',
    '        run: |',
    '          echo "runs-on: ubuntu-latest"',
    '          echo "steps: fake"',
  ].join('\n');
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, false, 'the embedded text must not be mistaken for a real runs-on: key');
  assert.equal(result.violations[0].jobName, 'broken');
});

test('a comment line containing "steps:"/"runs-on:" text is ignored', () => {
  const fixture = [
    'jobs:',
    '  guard: # this job has steps: and runs-on: in its own comment',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo hi',
  ].join('\n');
  const result = validateJobExecutionModel(fixture);
  assert.equal(result.valid, true);
});

test('extractJobFacts and classifyJobExecutionModel are independently usable', () => {
  const fixture = `jobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  const facts = extractJobFacts(fixture);
  assert.equal(facts.length, 1);
  assert.equal(classifyJobExecutionModel(facts[0]), 'STEP_JOB');
});

test('a file with no jobs: section returns an empty, valid result rather than throwing', () => {
  const result = validateJobExecutionModel('name: not a real workflow\non: push\n');
  assert.deepEqual(result.jobs, []);
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// REAL_WORKFLOW_STRUCTURAL_VALIDATION — the actual fixed
// production-db-readonly-inspection.yml must pass, proving the fix (not a
// synthetic fixture) is genuinely correct.
// ---------------------------------------------------------------------------
test('REAL: the fixed production-db-readonly-inspection.yml passes the gate', () => {
  const content = readFileSync(path.join(WORKFLOWS_DIR, 'production-db-readonly-inspection.yml'), 'utf8');
  const result = validateJobExecutionModel(content);
  assert.equal(result.valid, true, `expected no violations, got: ${JSON.stringify(result.violations)}`);
  const byName = Object.fromEntries(result.jobs.map((j) => [j.jobName, j.model]));
  assert.equal(byName.guard, 'STEP_JOB');
  assert.equal(byName['prepare-inspection-inputs'], 'STEP_JOB');
  assert.equal(byName['build-production-artifact'], 'REUSABLE_WORKFLOW_CALL_JOB');
  assert.equal(byName['verify-build-output'], 'STEP_JOB');
  assert.equal(byName['inspect-production-db'], 'REUSABLE_WORKFLOW_CALL_JOB');
});

// ---------------------------------------------------------------------------
// SAME_CLASS_DEFECTS_FOUND_AFTER_FIX — scan every real workflow file in the
// repository, proving no other existing file already carries this exact
// class of defect. This is the regression guard actually doing its job
// against real content, not only synthetic fixtures.
// ---------------------------------------------------------------------------
test('REAL: every workflow file in .github/workflows/ passes the job-execution-model gate', () => {
  const entries = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(entries.length > 0, 'expected at least one real workflow file to scan');

  const failures = [];
  for (const entry of entries) {
    const content = readFileSync(path.join(WORKFLOWS_DIR, entry), 'utf8');
    const result = validateJobExecutionModel(content);
    if (!result.valid) failures.push({ file: entry, violations: result.violations });
  }

  assert.deepEqual(failures, [], `same-class defects found: ${JSON.stringify(failures, null, 2)}`);
});
