// Tests for the P1-F remediation (T-F1.2 external re-audit round 5, HOLD):
// Git replacement objects (`git replace`, refs/replace/<sha>) can alter
// which OBJECT a given SHA resolves to for essentially every plumbing and
// porcelain Git command -- including `git diff` -- while the textual
// BASE_SHA/HEAD_SHA on the command line stay unchanged. Reproduced
// independently before fixing: a real commit genuinely adding
// .github/workflows/production-deploy.yml, replaced with a commit sharing
// BASE's tree, made `git diff --name-status -z --no-renames BASE..HEAD`
// return an EMPTY diff (exit 0) for that exact same HEAD_SHA --
// files=[] -> workflowChanged=false, while the real object genuinely
// contains the change. `git --no-replace-objects diff ...` restores correct
// detection. This file uses REAL `git replace` operations against REAL,
// disposable Git repositories -- not simulated.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { deriveChangedFilesFromGit } from '../git-changeset.mjs';
import { evaluatePersistedWorkflowCertification } from '../task-orchestrator-core.mjs';
import { certifyAuditResult } from '../role-protocol-core.mjs';
import { recordAuditResult, createTaskSession, reserveTask, enterRole, recordExecutorResult, handoffToAuditor } from '../task-orchestrator-core.mjs';
import { finalizeExecutorResult } from '../role-protocol-core.mjs';
import { randomUUID } from 'node:crypto';

function createFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-git-replace-'));
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

/**
 * Creates a real `git replace` for `targetSha`, pointing it at a fabricated
 * commit object sharing `treeOfSha`'s tree (so plain Git resolution of
 * `targetSha` "sees" `treeOfSha`'s content instead of its own real content).
 * Returns the replacement object's own SHA.
 */
function createReplacement(fixture, { targetSha, treeOfSha, parentSha }) {
  const tree = fixture.run(['rev-parse', `${treeOfSha}^{tree}`]);
  const replacement = fixture.run(['commit-tree', tree, '-p', parentSha, '-m', 'replacement object']);
  fixture.run(['replace', targetSha, replacement]);
  return replacement;
}

test('GIT_REPLACE_WORKFLOW_ATTACK: without the remediation, plain Git semantics genuinely hide the workflow change (sanity check the attack is real)', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\n');
    }, 'genuinely add production workflow');

    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    // Plain `git diff` (no --no-replace-objects) against the SAME textual
    // SHAs now returns an EMPTY diff -- this is the vulnerability, proven
    // directly against real Git, independent of this module's own code.
    const plainDiff = spawnSync('git', ['diff', '--name-status', '-z', '--no-renames', `${fixture.baseSha}..${headSha}`], { cwd: fixture.repoRoot, encoding: 'utf8', shell: false });
    assert.equal(plainDiff.status, 0);
    assert.equal(plainDiff.stdout, '', 'sanity: plain Git semantics must genuinely be fooled by the replacement for this test to mean anything');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('GIT_REPLACE_WORKFLOW_ATTACK: the REMEDIATED deriveChangedFilesFromGit still detects the real workflow change despite the replacement', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\n');
    }, 'genuinely add production workflow');

    // Step 3: prove the remediated function detects it BEFORE any replacement exists.
    const before = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(before.ok, true);
    assert.ok(before.files.includes('.github/workflows/production-deploy.yml'));

    // Step 4: create the real replacement.
    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    // Step 6-7: the remediated function MUST STILL return the real file.
    const after = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(after.ok, true);
    assert.ok(after.files.includes('.github/workflows/production-deploy.yml'), `expected the real workflow change despite the replacement, got ${JSON.stringify(after.files)}`);

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('GIT_REPLACE_HEAD_ATTACK: a replacement specifically on HEAD (hiding an added workflow file) is ignored', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci-extra.yml'), 'name: extra\n');
    }, 'add ci-extra.yml');
    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/ci-extra.yml'));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('GIT_REPLACE_BASE_ATTACK: a replacement specifically on BASE (making BASE look identical to HEAD) is ignored', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci-extra2.yml'), 'name: extra2\n');
    }, 'add ci-extra2.yml');

    // Replace BASE with an object whose TREE equals HEAD's tree -- if
    // replacement lookup applied to BASE too, the diff would collapse to
    // empty from this side as well.
    createReplacement(fixture, { targetSha: fixture.baseSha, treeOfSha: headSha, parentSha: fixture.baseSha });

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/ci-extra2.yml'), `expected the real change despite a BASE-side replacement, got ${JSON.stringify(changeset.files)}`);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('replacement refs present but entirely UNRELATED to this BASE/HEAD pair do not interfere', () => {
  const fixture = createFixture();
  try {
    // An unrelated commit, replaced with yet another unrelated commit --
    // this replacement has nothing to do with the BASE/HEAD pair under test.
    const unrelatedA = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, 'unrelated-a.txt'), 'a\n');
    }, 'unrelated A');
    const unrelatedB = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, 'unrelated-b.txt'), 'b\n');
    }, 'unrelated B');
    createReplacement(fixture, { targetSha: unrelatedA, treeOfSha: unrelatedB, parentSha: unrelatedB });

    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci-extra3.yml'), 'name: extra3\n');
    }, 'add ci-extra3.yml');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: unrelatedB, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/ci-extra3.yml'));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('positive control: no replacement refs at all -- ordinary detection is unaffected by this remediation', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci-plain.yml'), 'name: plain\n');
    }, 'add ci-plain.yml, no replacements involved');
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.deepEqual([...changeset.files], ['.github/workflows/ci-plain.yml']);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('Unicode workflow file is still detected in the presence of an unrelated replacement ref (P1-D regression, combined)', () => {
  const fixture = createFixture();
  try {
    const decoy = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, 'decoy.txt'), 'x\n');
    }, 'decoy commit');
    createReplacement(fixture, { targetSha: decoy, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'producción.yml'), 'name: x\n');
    }, 'add unicode workflow');

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/producción.yml'));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('malformed NUL transport remains fail-closed in the presence of a real replacement ref (does not silently mask the parity check)', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    }, 'add ci.yml');
    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    const poisonSpawnSyncFn = () => ({ status: 0, stdout: 'A\0', stderr: '', error: undefined });
    const changeset = deriveChangedFilesFromGit({
      repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha, spawnSyncFn: poisonSpawnSyncFn,
    });
    assert.equal(changeset.ok, false);
    assert.equal(changeset.reason, 'GIT_CHANGESET_UNPARSEABLE_OUTPUT');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('omitted filesChanged declaration remains HOLD in the presence of a real replacement ref (P1-2 regression, combined)', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\n');
      fs.writeFileSync(path.join(root, 'backend.txt'), 'v2\n');
    }, 'A declares only backend.txt');
    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    const decision = evaluatePersistedWorkflowCertification(
      {
        base_sha: fixture.baseSha, head_sha: headSha, files_changed: ['backend.txt'],
        auditor_result: { finalState: 'PASS' }, validator_result: { finalState: 'PASS' },
      },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.decision, 'HOLD');
    assert.equal(decision.context.workflowChanged, true, 'the real workflow change must still be detected despite the replacement AND A\'s omission');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-E direct-core-import chain remains HOLD in the presence of a real replacement ref (combined regression)', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\n');
    }, 'genuine production workflow change, real diff would show it');
    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    const taskId = `task-${randomUUID()}`;
    createTaskSession({ repoRoot: fixture.repoRoot, taskId, taskTitle: 'p1-f + p1-e combined', baseSha: fixture.baseSha });
    const res = reserveTask({ repoRoot: fixture.repoRoot, taskId, reservedPaths: ['.github/workflows/production-deploy.yml'], baseSha: fixture.baseSha });
    const ownerToken = res.ownerToken;
    enterRole({ repoRoot: fixture.repoRoot, taskId, ownerToken, toState: 'PLANNING', actingRole: 'NIGHT' });
    enterRole({ repoRoot: fixture.repoRoot, taskId, ownerToken, toState: 'READY_FOR_A', actingRole: 'NIGHT' });
    enterRole({ repoRoot: fixture.repoRoot, taskId, ownerToken, toState: 'EXECUTING', actingRole: 'A', requiredCapability: 'WRITE_TASK_FILES' });
    const execResult = finalizeExecutorResult({ state: 'IMPLEMENTED_AND_VALIDATED', executorRole: 'A', baseSha: fixture.baseSha, headSha, filesChanged: ['backend.txt'] });
    recordExecutorResult({ repoRoot: fixture.repoRoot, taskId, ownerToken, executorResult: execResult, toState: 'READY_FOR_B' });
    handoffToAuditor({ repoRoot: fixture.repoRoot, taskId, ownerToken, headSha });

    const rawAuditorPass = certifyAuditResult({ executorRole: 'A', auditorRole: 'B', headSha, requestedState: 'PASS', findings: [] });
    const recordResult = recordAuditResult({ repoRoot: fixture.repoRoot, taskId, ownerToken, auditorResult: rawAuditorPass, toState: 'READY_FOR_C' });

    assert.equal(recordResult.ok, false, 'a real replacement ref must not defeat the direct-core workflow-gate enforcement either');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('GIT_REPLACE_ENV_ATTACK: an inherited GIT_REPLACE_REF_BASE pointing at an attacker-controlled namespace has no effect', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci-envattack.yml'), 'name: envattack\n');
    }, 'add ci-envattack.yml');
    createReplacement(fixture, { targetSha: headSha, treeOfSha: fixture.baseSha, parentSha: fixture.baseSha });

    // Simulate a hostile/odd caller environment that already set
    // GIT_REPLACE_REF_BASE and left a stale GIT_NO_REPLACE_OBJECTS=0 (an
    // explicit falsy-looking string some tooling might set) -- the
    // remediation must not simply inherit whatever the caller's process
    // environment happened to contain.
    const spawnSyncFn = (command, args, options) => {
      const pollutedEnv = { ...options.env, GIT_REPLACE_REF_BASE: 'refs/replace-attacker/', GIT_NO_REPLACE_OBJECTS: '0' };
      // The remediation's OWN env construction must already have set these
      // correctly BEFORE this seam is reached; this wrapper simulates a
      // caller/environment that tries to override them on the way in by
      // asserting the module's own values win when spawnSyncFn is the real one.
      assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1', 'the module must set GIT_NO_REPLACE_OBJECTS=1 itself, not merely inherit it');
      assert.equal(Object.prototype.hasOwnProperty.call(options.env, 'GIT_REPLACE_REF_BASE'), false, 'the module must strip any inherited GIT_REPLACE_REF_BASE, not merely inherit it');
      return spawnSync(command, args, { ...options, env: pollutedEnv });
    };

    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha, spawnSyncFn });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/ci-envattack.yml'), 'the real change must still be detected: the --no-replace-objects command-line flag wins regardless of env');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});
