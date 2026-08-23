// Tests for tools/night-agent/command-safety.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMAND_SAFETY_CLASSES,
  TARGET_ENVIRONMENTS,
  classifyCommandSafety,
  isStandingAuthorized,
  evaluateCommandSafety,
} from '../command-safety.mjs';

test('COMMAND_SAFETY_CLASSES is exactly the six required classes', () => {
  assert.deepEqual(COMMAND_SAFETY_CLASSES, [
    'READ_ONLY', 'LOCAL_MUTATION', 'REMOTE_NONPROD_MUTATION', 'PRODUCTION_MUTATION', 'DESTRUCTIVE', 'UNKNOWN',
  ]);
});

// =============================================================================
// READ_ONLY allowlist -- Section 10's explicit list.
// =============================================================================

test('every Section-10-listed read-only command classifies as READ_ONLY', () => {
  for (const command of [
    'git status', 'git diff', 'git log', 'git show', 'git fetch',
    'gh pr view 73', 'gh pr checks 73', 'gh run view 12345', 'gh api repos/x/y/pulls/1',
  ]) {
    const result = classifyCommandSafety({ command });
    assert.equal(result.commandSafetyClass, 'READ_ONLY', `expected READ_ONLY for: ${command}`);
  }
});

test('a gcloud describe/list/get-iam-policy call with no mutation verb present is READ_ONLY', () => {
  assert.equal(classifyCommandSafety({ command: 'gcloud run services describe x --project=y' }).commandSafetyClass, 'READ_ONLY');
  assert.equal(classifyCommandSafety({ command: 'gcloud run services list --project=y' }).commandSafetyClass, 'READ_ONLY');
  assert.equal(classifyCommandSafety({ command: 'gcloud projects get-iam-policy y' }).commandSafetyClass, 'READ_ONLY');
});

test('a gcloud command containing BOTH a read verb and a mutation verb is never READ_ONLY', () => {
  const result = classifyCommandSafety({ command: 'gcloud run services describe x && gcloud run deploy x', targetEnvironment: 'Development' });
  assert.notEqual(result.commandSafetyClass, 'READ_ONLY');
});

// =============================================================================
// TEST G: unknown command classification fails closed.
// =============================================================================

test('TEST_G: an empty or non-string command is UNKNOWN, never guessed safe', () => {
  assert.equal(classifyCommandSafety({ command: '' }).commandSafetyClass, 'UNKNOWN');
  assert.equal(classifyCommandSafety({ command: undefined }).commandSafetyClass, 'UNKNOWN');
  assert.equal(classifyCommandSafety({}).commandSafetyClass, 'UNKNOWN');
  assert.equal(classifyCommandSafety({ command: 42 }).commandSafetyClass, 'UNKNOWN');
});

test('TEST_G / FASE 7 REGRESSION: "deploy and verify" with no declared target environment is UNKNOWN, never assumed safe', () => {
  const result = classifyCommandSafety({ command: 'deploy and verify' });
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
  assert.equal(result.reason, 'mutation_verb_without_declared_target_environment');
});

test('a completely unrecognized command (no known verb at all) is UNKNOWN', () => {
  const result = classifyCommandSafety({ command: 'frobnicate the whatsit' });
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
  assert.equal(result.reason, 'no_recognized_pattern');
});

test('TEST_G: UNKNOWN is never authorized, even with explicitAuthorizationGranted:true', () => {
  const result = evaluateCommandSafety({ command: 'deploy and verify', explicitAuthorizationGranted: true });
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
  assert.equal(result.authorized, false);
});

test('a mutation-verb command with an UNRECOGNIZED targetEnvironment string is UNKNOWN, not silently accepted', () => {
  const result = classifyCommandSafety({ command: 'gcloud run deploy svc', targetEnvironment: 'prod' }); // wrong case
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
});

// =============================================================================
// TEST H: destructive/sensitive commands require proper authorization.
// =============================================================================

test('TEST_H: DESTRUCTIVE patterns are recognized regardless of declared target, including Development', () => {
  for (const command of [
    'rm -rf /tmp/whatever', 'git push --force origin feat/x', 'git reset --hard HEAD~1', 'git clean -fd',
    'git branch -D some-branch', 'DROP TABLE users;', 'DELETE FROM users;', 'gcloud sql instances delete x',
    'gcloud run services delete x', 'gcloud compute instances delete x',
  ]) {
    const result = classifyCommandSafety({ command, targetEnvironment: 'Development' });
    assert.equal(result.commandSafetyClass, 'DESTRUCTIVE', `expected DESTRUCTIVE for: ${command}`);
  }
});

test('TEST_H: DESTRUCTIVE requires EXPLICIT authorization -- standing authorization never applies, even for a caller\'s own branch', () => {
  const result = evaluateCommandSafety({ command: 'git push --force origin feat/x', currentBranchName: 'feat/x' });
  assert.equal(result.commandSafetyClass, 'DESTRUCTIVE');
  assert.equal(result.standingAuthorized, false);
  assert.equal(result.authorized, false);
});

test('TEST_H: DESTRUCTIVE becomes authorized ONLY with explicitAuthorizationGranted:true', () => {
  const result = evaluateCommandSafety({ command: 'rm -rf /tmp/x', explicitAuthorizationGranted: true });
  assert.equal(result.authorized, true);
});

test('TEST_H: PRODUCTION_MUTATION requires EXPLICIT authorization, standing never applies', () => {
  const withoutAuth = evaluateCommandSafety({ command: 'gcloud run deploy svc', targetEnvironment: 'Production' });
  assert.equal(withoutAuth.authorized, false);
  const withAuth = evaluateCommandSafety({ command: 'gcloud run deploy svc', targetEnvironment: 'Production', explicitAuthorizationGranted: true });
  assert.equal(withAuth.authorized, true);
});

// =============================================================================
// Target-aware mutation classification.
// =============================================================================

test('a mutation verb with an explicit Development/Staging target is REMOTE_NONPROD_MUTATION', () => {
  assert.equal(classifyCommandSafety({ command: 'gcloud run deploy svc', targetEnvironment: 'Development' }).commandSafetyClass, 'REMOTE_NONPROD_MUTATION');
  assert.equal(classifyCommandSafety({ command: 'gcloud run deploy svc', targetEnvironment: 'Staging' }).commandSafetyClass, 'REMOTE_NONPROD_MUTATION');
});

test('REMOTE_NONPROD_MUTATION (a real infra deploy, not a routine git/gh operation) is NOT standing-authorized -- needs an explicit per-task decision', () => {
  const result = evaluateCommandSafety({ command: 'gcloud run deploy svc', targetEnvironment: 'Development' });
  assert.equal(result.standingAuthorized, false);
  assert.equal(result.authorized, false);
});

test('a mutation verb with explicit Local target is LOCAL_MUTATION', () => {
  assert.equal(classifyCommandSafety({ command: 'apply local db fixture', targetEnvironment: 'Local' }).commandSafetyClass, 'LOCAL_MUTATION');
});

test('git add / git commit are always LOCAL_MUTATION regardless of any declared targetEnvironment', () => {
  assert.equal(classifyCommandSafety({ command: 'git add file.js' }).commandSafetyClass, 'LOCAL_MUTATION');
  assert.equal(classifyCommandSafety({ command: 'git commit -m "x"' }).commandSafetyClass, 'LOCAL_MUTATION');
  assert.equal(classifyCommandSafety({ command: 'git add file.js', targetEnvironment: 'Production' }).commandSafetyClass, 'LOCAL_MUTATION');
});

test('LOCAL_MUTATION is always standing-authorized', () => {
  const result = evaluateCommandSafety({ command: 'git commit -m "x"' });
  assert.equal(result.standingAuthorized, true);
  assert.equal(result.authorized, true);
});

// =============================================================================
// Own-branch GitHub operations (Section 10's pre-authorized routine work).
// =============================================================================

test('git push to the caller\'s OWN current branch is REMOTE_NONPROD_MUTATION and standing-authorized', () => {
  const result = evaluateCommandSafety({ command: 'git push origin feat/my-branch', currentBranchName: 'feat/my-branch' });
  assert.equal(result.commandSafetyClass, 'REMOTE_NONPROD_MUTATION');
  assert.equal(result.standingAuthorized, true);
  assert.equal(result.authorized, true);
});

test('git push -u origin <own branch> (the -u variant) is also recognized', () => {
  const result = evaluateCommandSafety({ command: 'git push -u origin feat/my-branch', currentBranchName: 'feat/my-branch' });
  assert.equal(result.standingAuthorized, true);
});

test('git push to main is NEVER standing-authorized, even if it were somehow the "current branch"', () => {
  const result = evaluateCommandSafety({ command: 'git push origin main', currentBranchName: 'main' });
  assert.notEqual(result.commandSafetyClass, 'REMOTE_NONPROD_MUTATION');
  assert.equal(result.authorized, false);
});

test('git push to a DIFFERENT branch than the caller\'s current branch is NOT standing-authorized (fails closed to UNKNOWN)', () => {
  const result = evaluateCommandSafety({ command: 'git push origin someone-elses-branch', currentBranchName: 'feat/my-branch' });
  assert.equal(result.commandSafetyClass, 'UNKNOWN');
  assert.equal(result.authorized, false);
});

test('git push with no currentBranchName supplied at all cannot be standing-authorized', () => {
  const result = evaluateCommandSafety({ command: 'git push origin feat/my-branch' });
  assert.equal(result.authorized, false);
});

test('"gh pr create --draft" and "gh pr edit" are standing-authorized regardless of branch', () => {
  assert.equal(evaluateCommandSafety({ command: 'gh pr create --draft --title x' }).authorized, true);
  assert.equal(evaluateCommandSafety({ command: 'gh pr edit 73 --body-file x.md' }).authorized, true);
});

// =============================================================================
// evaluateCommandSafety overall shape / determinism.
// =============================================================================

test('evaluateCommandSafety results are frozen', () => {
  const result = evaluateCommandSafety({ command: 'git status' });
  assert.throws(() => { result.authorized = false; }, TypeError);
});

test('TARGET_ENVIRONMENTS is exactly the four expected values', () => {
  assert.deepEqual(TARGET_ENVIRONMENTS, ['Local', 'Development', 'Staging', 'Production']);
});

test('isStandingAuthorized never returns true for PRODUCTION_MUTATION/DESTRUCTIVE/UNKNOWN regardless of command/branch shape', () => {
  for (const commandSafetyClass of ['PRODUCTION_MUTATION', 'DESTRUCTIVE', 'UNKNOWN']) {
    assert.equal(isStandingAuthorized({ commandSafetyClass, command: 'git push origin x', currentBranchName: 'x' }), false);
  }
});
