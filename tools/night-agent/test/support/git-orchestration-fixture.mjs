// Korixa Night Agent — test-only real Git fixture for orchestration-state-
// machine tests (T-F1.2 P1-B remediation).
//
// WHY THIS EXISTS: task-orchestrator.mjs no longer accepts any override of
// its Git-changeset authority (deriveChangedFilesFromGit runs
// unconditionally for every workflow-context decision -- see that module's
// header comment). full-role-simulation.test.mjs and task-orchestrator.test
// .mjs predate that hardening and exercise ORCHESTRATION semantics against
// synthetic repoRoot paths / synthetic SHAs that never existed as real Git
// objects. Making those calls succeed now requires a REAL, resolvable Git
// repository and REAL commit SHAs -- there is no other way to reach
// deriveChangedFilesFromGit's success path, by design (that is the entire
// point of the P1-B fix).
//
// This module is never imported by any runtime file (only by tests), and it
// grants no authority of its own: it does not stub, wrap, or override
// deriveChangedFilesFromGit or any other production function. It simply
// creates real, on-disk Git repositories via real `git` subprocess calls so
// that the REAL authoritative code path has real data to observe.
//
// DETERMINISM: every fixture repo commits the same fixed content
// (FIXTURE_COMMIT_COUNT commits touching only a single non-workflow file,
// with GIT_AUTHOR_DATE/GIT_COMMITTER_DATE/name/email pinned via environment
// variables) so every independently-created fixture directory yields the
// IDENTICAL sequence of commit SHAs -- Git hashes are computed from
// tree/parent/author/committer/timestamp/message content, never from the
// containing directory's path. This lets test files declare a fixed set of
// named SHA constants (BASE_SHA, HEAD_1, ...) once, then call
// createOrchestrationFixtureRepo() fresh in every test for full isolation
// (no shared repoRoot, no cross-test lock/active-slot interference) while
// still guaranteeing those constants resolve inside each fresh repo.
//
// None of these commits ever touch .github/workflows/**, so every task
// built on top of a fixture repo is correctly classified by the real
// workflow-certification gate as NOT a workflow change -- exactly the
// property every pre-existing scenario in these two test files already
// assumed.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIXTURE_COMMIT_COUNT = 4; // BASE_SHA, HEAD_1, HEAD_2, HEAD_3
const FIXTURE_FILE_NAME = 'orchestration-fixture.txt';

const FIXTURE_GIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'korixa-night-agent-tests',
  GIT_AUTHOR_EMAIL: 'korixa-night-agent-tests@example.invalid',
  GIT_COMMITTER_NAME: 'korixa-night-agent-tests',
  GIT_COMMITTER_EMAIL: 'korixa-night-agent-tests@example.invalid',
  GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    env: { ...process.env, ...FIXTURE_GIT_ENV },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`orchestration fixture: git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

/**
 * Creates one fresh, isolated, real Git repository with a deterministic
 * FIXTURE_COMMIT_COUNT-commit linear history touching only
 * FIXTURE_FILE_NAME. Returns `{ repoRoot, shas }`, where `shas[i]` is the
 * real commit SHA at step `i` (shas[0] is the first commit).
 */
export function createOrchestrationFixtureRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'korixa-orch-fixture-'));
  runGit(repoRoot, ['init', '--quiet']);
  const shas = [];
  for (let i = 0; i < FIXTURE_COMMIT_COUNT; i += 1) {
    writeFileSync(path.join(repoRoot, FIXTURE_FILE_NAME), `fixture line ${i}\n`);
    runGit(repoRoot, ['add', FIXTURE_FILE_NAME]);
    runGit(repoRoot, ['commit', '--quiet', '-m', `deterministic orchestration fixture commit ${i}`]);
    shas.push(runGit(repoRoot, ['rev-parse', 'HEAD']));
  }
  return { repoRoot, shas: Object.freeze(shas) };
}

// A reference fixture built once at module load, purely to expose fixed,
// named SHA constants to importing test files. Every later
// createOrchestrationFixtureRepo() call reproduces the identical SHAs (see
// DETERMINISM above) inside its own fresh, independent directory.
const REFERENCE_FIXTURE = createOrchestrationFixtureRepo();

export const FIXTURE_BASE_SHA = REFERENCE_FIXTURE.shas[0];
export const FIXTURE_HEAD_1 = REFERENCE_FIXTURE.shas[1];
export const FIXTURE_HEAD_2 = REFERENCE_FIXTURE.shas[2];
export const FIXTURE_HEAD_3 = REFERENCE_FIXTURE.shas[3];

/** Returns just a fresh fixture repoRoot (string), matching the historical `fakeRepo()` call signature used across these test files. */
export function fakeRepo() {
  return createOrchestrationFixtureRepo().repoRoot;
}
