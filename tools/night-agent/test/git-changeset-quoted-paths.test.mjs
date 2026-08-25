// Tests for the P1-D remediation (T-F1.2 external re-audit round 3, HOLD):
// git-changeset.mjs's authoritative changeset derivation used to parse
// `git diff --name-status` output by splitting on newline then tab. Git's
// DEFAULT behavior (core.quotePath=true) C-quotes "unusual" filenames --
// Unicode, spaces, tabs, quotes, embedded newlines -- into a double-quoted,
// octal-escaped string (independently reproduced: a real
// `.github/workflows/producción.yml` change came back as
// `"...producci\303\263n.yml"`, which no longer starts with the literal
// `.github/workflows/` prefix the classifier requires). A real workflow
// change with an unusual filename could therefore silently bypass every
// downstream gate. Fixed by using `git diff --name-status -z`, which makes
// Git emit raw, unquoted, NUL-delimited records regardless of
// core.quotePath -- see git-changeset.mjs's own header comment.
//
// This file uses REAL, disposable Git repositories and REAL filesystem
// paths -- not simulated diff output -- for every scenario the underlying
// OS/filesystem actually permits. Where this specific machine's filesystem
// rejects a character outright (Windows: literal quote/tab/newline bytes
// cannot even be written as a real filename -- confirmed empirically before
// writing this file), the corresponding test is explicitly skipped via
// `t.skip(...)` rather than faked, silently omitted, or asserted against
// synthetic diff text.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { deriveChangedFilesFromGit } from '../git-changeset.mjs';
import { evaluatePersistedWorkflowCertification } from '../task-orchestrator.mjs';

function createFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-quoted-path-'));
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 10_000 });
    assert.equal(result.error, undefined, result.error?.message ?? `git ${args.join(' ')} spawn failed`);
    assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
    return result.stdout.trim();
  };
  run(['init', '--quiet']);
  run(['config', 'user.email', 'korixa-test@example.invalid']);
  run(['config', 'user.name', 'Korixa Test']);
  fs.mkdirSync(path.join(repoRoot, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'backend.txt'), 'base\n');
  run(['add', '-A']);
  run(['commit', '--quiet', '-m', 'base']);
  const baseSha = run(['rev-parse', 'HEAD']);
  return { repoRoot, baseSha, run };
}

function commit(fixture, mutate, message) {
  mutate(fixture.repoRoot);
  fixture.run(['add', '-A']);
  fixture.run(['commit', '--quiet', '-m', message]);
  return fixture.run(['rev-parse', 'HEAD']);
}

/** Returns null if this filesystem cannot even create a file with this name (checked for real, not assumed). */
function tryCreate(repoRoot, relPath, content) {
  try {
    const full = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return true;
  } catch {
    return false;
  }
}

test('P1-D CHECK 1 (UNICODE_WORKFLOW_ATTACK): a workflow file with a real Unicode name is detected as a workflow change', () => {
  const fixture = createFixture();
  try {
    const workflowRel = '.github/workflows/producción.yml';
    assert.ok(tryCreate(fixture.repoRoot, workflowRel, 'name: producción\n'), 'sanity: this filesystem must support the Unicode filename for the test to be meaningful');
    const headSha = commit(fixture, () => {}, 'add unicode workflow');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel), `expected ${workflowRel} in ${JSON.stringify(changeset.files)}`);

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 2 (SPACE_WORKFLOW_ATTACK): a workflow filename containing a space is detected', () => {
  const fixture = createFixture();
  try {
    const workflowRel = '.github/workflows/my workflow.yml';
    assert.ok(tryCreate(fixture.repoRoot, workflowRel, 'name: spaced\n'));
    const headSha = commit(fixture, () => {}, 'add spaced workflow');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel));

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 3 (QUOTE_WORKFLOW_ATTACK): a workflow filename containing a literal double quote, if this filesystem permits it', (t) => {
  const fixture = createFixture();
  try {
    const workflowRel = '.github/workflows/weird"name.yml';
    if (!tryCreate(fixture.repoRoot, workflowRel, 'name: quoted\n')) {
      t.skip('this filesystem does not permit a literal double-quote character in a filename');
      return;
    }
    const headSha = commit(fixture, () => {}, 'add quote-named workflow');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 4 (TAB_WORKFLOW_ATTACK): a workflow filename containing a literal TAB, if this filesystem permits it, is detected safely', (t) => {
  const fixture = createFixture();
  try {
    const workflowRel = '.github/workflows/weird\tname.yml';
    if (!tryCreate(fixture.repoRoot, workflowRel, 'name: tabbed\n')) {
      t.skip('this filesystem does not permit a literal TAB character in a filename');
      return;
    }
    const headSha = commit(fixture, () => {}, 'add tab-named workflow');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 5 (NEWLINE_WORKFLOW_ATTACK): a workflow filename containing a literal newline, if this filesystem permits it, is detected safely', (t) => {
  const fixture = createFixture();
  try {
    const workflowRel = '.github/workflows/weird\nname.yml';
    if (!tryCreate(fixture.repoRoot, workflowRel, 'name: newlined\n')) {
      t.skip('this filesystem does not permit a literal newline character in a filename');
      return;
    }
    const headSha = commit(fixture, () => {}, 'add newline-named workflow');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 6 (UNICODE_RENAME_FROM_ATTACK): a Unicode workflow file moved OUT of .github/workflows/ is detected via its vacated path', () => {
  const fixture = createFixture();
  const workflowRel = '.github/workflows/moviólejos.yml';
  assert.ok(tryCreate(fixture.repoRoot, workflowRel, 'name: moved\n'));
  const v1 = commit(fixture, () => {}, 'add unicode workflow');
  try {
    const v2 = commit(fixture, (root) => {
      fs.renameSync(path.join(root, workflowRel), path.join(root, 'moviólejos.yml.bak'));
    }, 'move unicode workflow out of .github/workflows/');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: v1, headSha: v2 });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel), `expected vacated ${workflowRel} in ${JSON.stringify(changeset.files)}`);

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: v1, head_sha: v2, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 7 (UNICODE_RENAME_TO_ATTACK): a Unicode file moved INTO .github/workflows/ is detected via its new path', () => {
  const fixture = createFixture();
  assert.ok(tryCreate(fixture.repoRoot, 'borrador-ción.yml.bak', 'name: draft\n'));
  const v1 = commit(fixture, () => {}, 'add draft unicode file outside workflows/');
  const workflowRel = '.github/workflows/borrador-ción.yml';
  try {
    const v2 = commit(fixture, (root) => {
      fs.renameSync(path.join(root, 'borrador-ción.yml.bak'), path.join(root, workflowRel));
    }, 'promote unicode draft into .github/workflows/');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: v1, headSha: v2 });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes(workflowRel), `expected new ${workflowRel} in ${JSON.stringify(changeset.files)}`);

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: v1, head_sha: v2, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 8 (ordinary ASCII paths): plain ASCII filenames behave exactly as before -z was introduced', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
      fs.writeFileSync(path.join(root, 'backend.txt'), 'v2\n');
    }, 'ordinary ascii change');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.deepEqual([...changeset.files].sort(), ['.github/workflows/ci.yml', 'backend.txt']);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 9 (malformed NUL transport): an odd token count / stray NUL fails closed, never silently "no change"', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    }, 'add ci.yml');

    // A transport that returns a malformed (odd-length) NUL-delimited stream
    // -- e.g. a status code with no matching path, simulating truncation --
    // must never be silently treated as zero changes.
    const poisonSpawnSyncFn = () => ({ status: 0, stdout: 'A\0', stderr: '', error: undefined });
    const changeset = deriveChangedFilesFromGit({
      repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha,
      spawnSyncFn: poisonSpawnSyncFn,
    });
    assert.equal(changeset.ok, false);
    assert.equal(changeset.reason, 'GIT_CHANGESET_UNPARSEABLE_OUTPUT');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-D CHECK 10 (omission + Unicode combined): A declares an unrelated changeset while a Unicode-named workflow genuinely changed -> HOLD', () => {
  const fixture = createFixture();
  try {
    const workflowRel = '.github/workflows/despliegue-producción.yml';
    const headSha = commit(fixture, (root) => {
      assert.ok(tryCreate(root, workflowRel, 'name: despliegue-producción\n'));
      fs.writeFileSync(path.join(root, 'backend.txt'), 'v2\n');
    }, 'A declares only backend.txt');

    const falseDeclaration = ['backend.txt'];
    const decision = evaluatePersistedWorkflowCertification(
      {
        base_sha: fixture.baseSha,
        head_sha: headSha,
        files_changed: falseDeclaration,
        auditor_result: { finalState: 'PASS' },
        validator_result: { finalState: 'PASS' },
      },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.decision, 'HOLD');
    assert.equal(decision.context.workflowChanged, true, 'the real Unicode-named workflow change must still be detected despite A\'s false declaration');
    assert.ok(decision.context.workflowFiles.includes(workflowRel));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});
