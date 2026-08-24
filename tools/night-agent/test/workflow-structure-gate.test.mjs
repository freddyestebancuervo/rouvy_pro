// Regression tests for the GitHub Actions workflow-structure incident found
// after PRs #85/#86. The required Night Agent CI job runs every
// tools/night-agent/test/*.test.mjs file, so this test becomes a required
// merge gate without adding a new branch-protection context.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  inspectWorkflowStructure,
  validateWorkflowDirectory,
} from '../workflow-structure-gate.mjs';
import {
  buildActionlintArgs,
  runActionlintGate,
} from '../actionlint-gate.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('regression P1: a normal job with steps but no runs-on is rejected', () => {
  const source = `name: broken\non:\n  workflow_dispatch:\njobs:\n  guard:\n    permissions: {}\n    steps:\n      - run: echo broken\n`;
  const result = inspectWorkflowStructure(source, { file: 'broken.yml' });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'JOB_WITH_STEPS_MISSING_RUNS_ON');
  assert.equal(result.errors[0].jobId, 'guard');
});

test('normal job with steps + runs-on is accepted', () => {
  const source = `name: valid\non:\n  workflow_dispatch:\njobs:\n  guard:\n    runs-on: ubuntu-latest\n    permissions: {}\n    steps:\n      - run: echo ok\n`;
  const result = inspectWorkflowStructure(source, { file: 'valid.yml' });
  assert.deepEqual(result.errors, []);
});

test('quoted canonical job id is recognized and still subject to runs-on enforcement', () => {
  const source = `name: quoted\non:\n  workflow_dispatch:\njobs:\n  "guard":\n    steps:\n      - run: echo broken\n`;
  const result = inspectWorkflowStructure(source, { file: 'quoted.yml' });

  assert.equal(result.errors.some((e) => e.code === 'JOB_WITH_STEPS_MISSING_RUNS_ON' && e.jobId === 'guard'), true);
});

test('ambiguous job declaration fails closed instead of being silently ignored', () => {
  const source = `name: ambiguous\non:\n  workflow_dispatch:\njobs:\n  guard: &shared\n    steps:\n      - run: echo broken\n`;
  const result = inspectWorkflowStructure(source, { file: 'ambiguous.yml' });

  assert.equal(result.errors.some((e) => e.code === 'UNSUPPORTED_OR_MALFORMED_JOB_DECLARATION'), true);
});

test('duplicate job ids fail closed', () => {
  const source = `name: duplicate\non:\n  workflow_dispatch:\njobs:\n  guard:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo one\n  guard:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo two\n`;
  const result = inspectWorkflowStructure(source, { file: 'duplicate.yml' });

  assert.equal(result.errors.some((e) => e.code === 'DUPLICATE_JOB_ID'), true);
});

test('job with neither steps nor reusable uses fails closed', () => {
  const source = `name: empty-job\non:\n  workflow_dispatch:\njobs:\n  guard:\n    runs-on: ubuntu-latest\n    permissions: {}\n`;
  const result = inspectWorkflowStructure(source, { file: 'empty-job.yml' });

  assert.equal(result.errors.some((e) => e.code === 'JOB_MISSING_STEPS_OR_USES'), true);
});

test('reusable-workflow caller may use job-level uses without runs-on', () => {
  const source = `name: reusable\non:\n  workflow_dispatch:\njobs:\n  call-reusable:\n    permissions:\n      contents: read\n    uses: ./.github/workflows/_reusable.yml\n    with:\n      operation: test\n`;
  const result = inspectWorkflowStructure(source, { file: 'reusable.yml' });
  assert.deepEqual(result.errors, []);
});

test('reusable-workflow caller with uses + runs-on is rejected', () => {
  const source = `name: broken-reusable\non:\n  workflow_dispatch:\njobs:\n  call-reusable:\n    runs-on: ubuntu-latest\n    uses: ./.github/workflows/_reusable.yml\n`;
  const result = inspectWorkflowStructure(source, { file: 'broken-reusable.yml' });

  assert.equal(result.errors.some((e) => e.code === 'REUSABLE_CALLER_MUST_NOT_DECLARE_RUNS_ON'), true);
});

test('reusable-workflow caller with uses + steps is rejected', () => {
  const source = `name: broken-mixed\non:\n  workflow_dispatch:\njobs:\n  call-reusable:\n    uses: ./.github/workflows/_reusable.yml\n    steps:\n      - run: echo impossible\n`;
  const result = inspectWorkflowStructure(source, { file: 'broken-mixed.yml' });

  assert.equal(result.errors.some((e) => e.code === 'REUSABLE_CALLER_MUST_NOT_DECLARE_STEPS'), true);
});

test('required regression gate: every real repository workflow satisfies the enforced job invariants', () => {
  const result = validateWorkflowDirectory(REPO_ROOT);

  if (!result.valid) {
    const formatted = result.errors
      .map((e) => `${e.file}${e.line ? `:${e.line}` : ''} ${e.code}${e.jobId ? ` job=${e.jobId}` : ''}`)
      .join('\n');
    assert.fail(`WORKFLOW_SCHEMA_VALIDATION=FAIL\n${formatted}`);
  }

  console.log(`WORKFLOW_SCHEMA_VALIDATION=PASS files_checked=${result.filesChecked}`);
  assert.equal(result.valid, true);
  assert.ok(result.filesChecked > 0);
});

test('actionlint CLI contract is pinned and disables unrelated script-linter integrations', () => {
  const args = buildActionlintArgs();
  assert.deepEqual([...args], ['-no-color', '-shellcheck=', '-pyflakes=']);
  assert.equal(Object.isFrozen(args), true);
});

test('required CI second layer: pinned actionlint independently validates all GitHub Actions workflows', { timeout: 120_000 }, async () => {
  const result = await runActionlintGate({ repoRoot: REPO_ROOT });

  if (process.env.GITHUB_ACTIONS === 'true') {
    assert.equal(
      result.status,
      'PASS',
      `ACTIONLINT_VALIDATION=FAIL reason=${result.reason}\n${result.detail}`,
    );
    console.log(`ACTIONLINT_VALIDATION=PASS ${result.detail}`);
    return;
  }

  // Local developer runs keep the deterministic parser active and do not
  // download/execute a Linux CI artifact. This is a passing, explicit mode,
  // not a skipped test. The external layer is mandatory on GitHub Actions.
  assert.equal(result.status, 'NOT_APPLICABLE_LOCAL');
  console.log('ACTIONLINT_VALIDATION=NOT_APPLICABLE_LOCAL (CI layer remains mandatory)');
});
