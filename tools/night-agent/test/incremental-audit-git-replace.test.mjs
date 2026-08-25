import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTrustedBaseline, computeChangeset } from '../incremental-audit.mjs';

function git(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
  });
  assert.equal(result.error, undefined, result.error?.message ?? `git ${args.join(' ')} spawn failed`);
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function createFixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'korixa-incremental-replace-'));
  git(repoRoot, ['init', '--quiet']);
  git(repoRoot, ['config', 'user.email', 'korixa-test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Korixa Test']);
  mkdirSync(path.join(repoRoot, 'tools', 'night-agent'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'tools', 'night-agent', 'source-of-truth.mjs'), 'export const SOURCE = 1;\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '--quiet', '-m', 'base']);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const rootCommit = git(repoRoot, ['rev-list', '--max-parents=0', 'HEAD']);
  return { repoRoot, baseSha, rootCommit };
}

function createReplacement(repoRoot, { targetSha, treeOfSha, parentSha }) {
  const tree = git(repoRoot, ['rev-parse', `${treeOfSha}^{tree}`]);
  const replacement = git(repoRoot, ['commit-tree', tree, '-p', parentSha, '-m', 'replacement object']);
  git(repoRoot, ['replace', targetSha, replacement]);
  return replacement;
}

test('incremental-audit has no direct Git invocation left without --no-replace-objects', () => {
  const source = readFileSync(new URL('../incremental-audit.mjs', import.meta.url), 'utf8');
  const directGitCallLines = source
    .split('\n')
    .filter((line) => /spawnSyncFn\(\s*["']git["']/.test(line));

  assert.equal(
    directGitCallLines.length,
    7,
    `expected exactly 7 direct Git calls in incremental-audit, got ${directGitCallLines.length}`,
  );

  for (const line of directGitCallLines) {
    assert.match(
      line,
      /spawnSyncFn\(\s*["']git["']\s*,\s*\[\s*["']--no-replace-objects["']/,
      `direct Git invocation is missing --no-replace-objects: ${line.trim()}`,
    );
  }
});

test('computeChangeset still detects a real security-scope change hidden from plain Git by git replace', () => {
  const fixture = createFixture();
  try {
    const { baseline, error } = createTrustedBaseline({
      repoRoot: fixture.repoRoot,
      sha: fixture.baseSha,
      expectedRootCommit: fixture.rootCommit,
    });
    assert.equal(error, null);
    assert.ok(baseline);

    writeFileSync(
      path.join(fixture.repoRoot, 'tools', 'night-agent', 'source-of-truth.mjs'),
      'export const SOURCE = 2;\n',
    );
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '--quiet', '-m', 'real security change']);
    const headSha = git(fixture.repoRoot, ['rev-parse', 'HEAD']);

    createReplacement(fixture.repoRoot, {
      targetSha: headSha,
      treeOfSha: fixture.baseSha,
      parentSha: fixture.baseSha,
    });

    const plainDiff = spawnSync(
      'git',
      ['diff', '--name-status', '-M', fixture.baseSha, headSha],
      { cwd: fixture.repoRoot, encoding: 'utf8', shell: false },
    );
    assert.equal(plainDiff.status, 0);
    assert.equal(plainDiff.stdout.trim(), '', 'sanity: plain Git must genuinely be fooled by the replacement');

    const { changeset, error: changesetError } = computeChangeset({
      baseline,
      repoRoot: fixture.repoRoot,
    });
    assert.equal(changesetError, null);
    assert.ok(changeset);
    assert.equal(changeset.currentSha, headSha);
    assert.ok(
      changeset.files.some((entry) => entry.path === 'tools/night-agent/source-of-truth.mjs'),
      `expected the real security change despite git replace, got ${JSON.stringify(changeset.files)}`,
    );
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});
