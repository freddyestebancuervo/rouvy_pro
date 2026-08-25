import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runActionlintGate } from '../actionlint-gate.mjs';

// This is deliberately NOT committed under .github/workflows/: the test
// creates it only in an isolated temporary Git repository, proves actionlint
// rejects it for workflow semantics, then deletes it. Therefore the real
// repository stays dispatchable while the regression permanently proves the
// external semantic validator fails closed on a broken workflow.
test('negative regression: pinned actionlint rejects a deliberately invalid GitHub Actions workflow', { timeout: 120_000 }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-invalid-workflow-'));
  try {
    const gitInit = spawnSync('git', ['init'], {
      cwd: tempRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 10_000,
    });
    assert.equal(gitInit.error, undefined, gitInit.error?.message ?? 'git init spawn failed');
    assert.equal(gitInit.status, 0, gitInit.stderr || 'git init failed');

    const workflowsDir = path.join(tempRoot, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(path.join(workflowsDir, 'deliberately-invalid.yml'), `name: deliberately-invalid
on:
  workflow_dispatch:
jobs:
  broken:
    runs-on: ubuntu-latest
    needs: definitely_missing_job
    steps:
      - name: malformed expression
        run: echo "\${{ github.event. }}"
`, 'utf8');

    const result = await runActionlintGate({ repoRoot: tempRoot });

    if (process.env.GITHUB_ACTIONS === 'true') {
      assert.equal(result.status, 'FAIL', `expected actionlint to reject the invalid fixture, got ${JSON.stringify(result)}`);
      assert.equal(result.reason, 'ACTIONLINT_FINDINGS');
      assert.doesNotMatch(result.detail, /no project was found/i, 'fixture must reach workflow semantic validation, not fail repository discovery');
      assert.match(result.detail, /deliberately-invalid\.yml|needs|expression|property|syntax/i);
      return;
    }

    // The pinned external binary is intentionally CI-only. Local runs still
    // prove the contract mode rather than downloading/executing a CI binary.
    assert.equal(result.status, 'NOT_APPLICABLE_LOCAL');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
