// Tests for the P1-B remediation (T-F1.2 external re-audit round 2, HOLD):
// task-orchestrator.mjs's public, module-level override of the Git-changeset
// authority (__installTestGitChangesetProvider / __clearTestGitChangesetProvider)
// has been deleted outright. "That the name contains '__installTest' is NOT
// a security boundary" -- a public export is a public export, regardless of
// its name. deriveChangedFilesFromGit (git-changeset.mjs) now runs
// unconditionally inside task-orchestrator.mjs, with no override parameter
// of any name accepted anywhere in that module.
//
// This file proves, mechanically:
//  1. the override exports are genuinely gone from the public module surface;
//  2. the real authority (deriveChangedFilesFromGit, via
//     evaluatePersistedWorkflowCertification) correctly detects every
//     required change class using a REAL, disposable Git repository -- add,
//     modify, delete, rename-out-of .github/workflows/, rename-into
//     .github/workflows/;
//  3. an unresolvable SHA fails closed (HOLD), never silently "no change";
//  4. an omission attack (A declares a false, workflow-free changeset while
//     the real Git diff proves otherwise) is still caught mechanically --
//     already covered in depth by workflow-role-enforcement.test.mjs's
//     required P1-2 regression; reproduced here at the git-changeset.mjs
//     layer directly for completeness.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import * as taskOrchestrator from '../task-orchestrator.mjs';
import { evaluatePersistedWorkflowCertification } from '../task-orchestrator.mjs';
import { deriveChangedFilesFromGit } from '../git-changeset.mjs';

function createFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-changeset-authority-'));
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
  fs.mkdirSync(path.join(repoRoot, 'backend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'backend', 'src', 'main.ts'), 'export const x = 1;\n');
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

// ---------------------------------------------------------------------------
// 1. Public-export absence.
// ---------------------------------------------------------------------------

test('P1-B CHECK 1: __installTestGitChangesetProvider is not exported from task-orchestrator.mjs', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(taskOrchestrator, '__installTestGitChangesetProvider'), false);
  assert.equal(typeof taskOrchestrator.__installTestGitChangesetProvider, 'undefined');
});

test('P1-B CHECK 2: __clearTestGitChangesetProvider is not exported from task-orchestrator.mjs', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(taskOrchestrator, '__clearTestGitChangesetProvider'), false);
  assert.equal(typeof taskOrchestrator.__clearTestGitChangesetProvider, 'undefined');
});

test('P1-B CHECK 3: no exported function on task-orchestrator.mjs accepts a deriveChangedFilesFromGitFn-shaped override and has it honored', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    }, 'add a workflow file for real');

    const poison = () => ({ ok: true, files: [] }); // if honored, would hide the real workflow change
    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: [] },
      { repoRoot: fixture.repoRoot, deriveChangedFilesFromGitFn: poison, changesetProvider: poison, gitProvider: poison, sourceOverride: poison, testProvider: poison },
    );
    // The real authority must still detect the workflow change regardless of
    // any similarly-named parameter a caller might try.
    assert.equal(decision.context.workflowChanged, true, 'a caller-supplied override parameter of any name must have zero effect');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Real Git detection: added / modified / deleted / renamed-from / renamed-to.
// ---------------------------------------------------------------------------

test('P1-B CHECK 4 (added): a workflow file added for real is detected as a workflow change', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'new-workflow.yml'), 'name: New\n');
    }, 'add workflow');
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/new-workflow.yml'));

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: headSha, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-B CHECK 5 (modified): an existing workflow file genuinely modified is detected', () => {
  const fixture = createFixture();
  const v1 = commit(fixture, (root) => {
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
  }, 'add ci.yml');
  try {
    const v2 = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
    }, 'modify ci.yml');
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: v1, headSha: v2 });
    assert.equal(changeset.ok, true);
    assert.deepEqual([...changeset.files], ['.github/workflows/ci.yml']);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-B CHECK 6 (deleted): a workflow file genuinely deleted is detected as a workflow change', () => {
  const fixture = createFixture();
  const v1 = commit(fixture, (root) => {
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'obsolete.yml'), 'name: Obsolete\n');
  }, 'add obsolete.yml');
  try {
    const v2 = commit(fixture, (root) => {
      fs.rmSync(path.join(root, '.github', 'workflows', 'obsolete.yml'));
    }, 'delete obsolete.yml');
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: v1, headSha: v2 });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/obsolete.yml'));

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: v1, head_sha: v2, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true, 'deleting a workflow file is still a workflow change requiring proof');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-B CHECK 7 (renamed-from): a file moved OUT of .github/workflows/ is detected via its deletion there', () => {
  const fixture = createFixture();
  const v1 = commit(fixture, (root) => {
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'moved-out.yml'), 'name: MovedOut\n');
  }, 'add moved-out.yml inside workflows/');
  try {
    const v2 = commit(fixture, (root) => {
      const from = path.join(root, '.github', 'workflows', 'moved-out.yml');
      const to = path.join(root, 'moved-out.yml.bak');
      fs.renameSync(from, to);
    }, 'move workflow file out of .github/workflows/');
    // --no-renames (git-changeset.mjs's deliberate choice) reports this as a
    // delete of the old path + an add of the new one, not a single R100 line.
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: v1, headSha: v2 });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/moved-out.yml'), 'the vacated workflow path must still be reported');

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: v1, head_sha: v2, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-B CHECK 8 (renamed-to): a file moved INTO .github/workflows/ is detected via its new path', () => {
  const fixture = createFixture();
  const v1 = commit(fixture, (root) => {
    fs.writeFileSync(path.join(root, 'draft-workflow.yml.bak'), 'name: Draft\n');
  }, 'add a non-workflow-path draft file');
  try {
    const v2 = commit(fixture, (root) => {
      const from = path.join(root, 'draft-workflow.yml.bak');
      const to = path.join(root, '.github', 'workflows', 'draft-workflow.yml');
      fs.renameSync(from, to);
    }, 'promote draft into .github/workflows/');
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: v1, headSha: v2 });
    assert.equal(changeset.ok, true);
    assert.ok(changeset.files.includes('.github/workflows/draft-workflow.yml'), 'the newly-created workflow path must be reported');

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: v1, head_sha: v2, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.context.workflowChanged, true);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Unresolved SHA -> HOLD.
// ---------------------------------------------------------------------------

test('P1-B CHECK 9 (GIT_UNRESOLVED_ATTACK, headSha): a syntactically-valid but nonexistent headSha fails closed, never "no change"', () => {
  const fixture = createFixture();
  try {
    const nonexistent = 'f'.repeat(40);
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: fixture.baseSha, headSha: nonexistent });
    assert.equal(changeset.ok, false);
    assert.equal(changeset.reason, 'GIT_CHANGESET_COMMAND_FAILED');

    const decision = evaluatePersistedWorkflowCertification(
      { base_sha: fixture.baseSha, head_sha: nonexistent, files_changed: [] },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(decision.decision, 'HOLD');
    assert.equal(decision.reason, 'HOLD_WORKFLOW_CHANGE_CONTEXT_UNPROVEN');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('P1-B CHECK 10 (GIT_UNRESOLVED_ATTACK, baseSha): a syntactically-valid but nonexistent baseSha fails closed, never "no change"', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    }, 'add ci.yml');
    const nonexistentBase = 'e'.repeat(40);
    const changeset = deriveChangedFilesFromGit({ repoRoot: fixture.repoRoot, baseSha: nonexistentBase, headSha });
    assert.equal(changeset.ok, false);
    assert.equal(changeset.reason, 'GIT_CHANGESET_COMMAND_FAILED');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Omission attack (reproduced here directly; see workflow-role-
//    enforcement.test.mjs's required P1-2 regression for the B/C-level proof).
// ---------------------------------------------------------------------------

test('P1-B CHECK 11 (OMITTED_WORKFLOW_ATTACK): A declares an empty/unrelated changeset while genuinely modifying a workflow file -> real Git still catches it', () => {
  const fixture = createFixture();
  try {
    const headSha = commit(fixture, (root) => {
      fs.writeFileSync(path.join(root, '.github', 'workflows', 'production-deploy.yml'), 'name: production-deploy\n# real change\n');
      fs.writeFileSync(path.join(root, 'backend', 'src', 'main.ts'), 'export const x = 2;\n');
    }, 'A declares only backend/src/main.ts');

    const falseDeclaration = ['backend/src/main.ts'];
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
    assert.equal(decision.context.workflowChanged, true, 'A\'s false declaration must have zero authority over the real Git-derived changeset');
    assert.ok(decision.context.workflowFiles.includes('.github/workflows/production-deploy.yml'));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});
