import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ROLE_MISSIONS,
  BREAKER_MISSION,
  BREAKER_REMEDIATION_OWNER,
  BREAKER_REQUIRED_CAPABILITIES,
  BREAKER_FORBIDDEN_CAPABILITIES,
  ROLE_OUTPUT_CONTRACTS,
  getRoleMission,
  isRoleAllowed,
  evaluateBreakerRoleContract,
} from '../role-capabilities.mjs';

const policy = readFileSync(new URL('../BREAKER_POLICY.md', import.meta.url), 'utf8');

test('B has one canonical protocol mission: BREAK_BEFORE_CERTIFY', () => {
  assert.equal(BREAKER_MISSION, 'BREAK_BEFORE_CERTIFY');
  assert.equal(ROLE_MISSIONS.B, 'BREAK_BEFORE_CERTIFY');
  assert.equal(getRoleMission('B'), 'BREAK_BEFORE_CERTIFY');
  assert.equal(ROLE_OUTPUT_CONTRACTS.B.mission, 'BREAK_BEFORE_CERTIFY');
});

test('unknown/fuzzy role names do not receive a mission', () => {
  for (const role of ['b', ' B ', 'Breaker', '', null, undefined]) {
    assert.equal(getRoleMission(role), null);
  }
});

test('B is granted every capability needed to break and report', () => {
  assert.deepEqual([...BREAKER_REQUIRED_CAPABILITIES], [
    'READ',
    'RUN_ADVERSARIAL_TESTS',
    'AUDIT',
    'CREATE_FINDING',
    'CERTIFY_AUDIT',
  ]);

  for (const capability of BREAKER_REQUIRED_CAPABILITIES) {
    assert.equal(isRoleAllowed('B', capability), true, `B must retain ${capability}`);
  }
});

test('B cannot remediate, commit, push, or substitute for C', () => {
  assert.deepEqual([...BREAKER_FORBIDDEN_CAPABILITIES], [
    'WRITE_TASK_FILES',
    'RUN_PRIMARY_TESTS',
    'COMMIT_TASK_BRANCH',
    'PUSH_TASK_BRANCH',
    'VALIDATE',
    'CERTIFY_TECHNICAL_PASS',
  ]);

  for (const capability of BREAKER_FORBIDDEN_CAPABILITIES) {
    assert.equal(isRoleAllowed('B', capability), false, `B must not receive ${capability}`);
  }
});

test('A, not B, owns remediation writes', () => {
  assert.equal(BREAKER_REMEDIATION_OWNER, 'A');
  assert.equal(ROLE_OUTPUT_CONTRACTS.B.remediationOwner, 'A');
  assert.equal(isRoleAllowed('A', 'WRITE_TASK_FILES'), true);
  assert.equal(isRoleAllowed('B', 'WRITE_TASK_FILES'), false);
});

test('breaker contract evaluates PASS only while all formal boundaries hold', () => {
  const result = evaluateBreakerRoleContract();
  assert.deepEqual(result, {
    valid: true,
    mission: 'BREAK_BEFORE_CERTIFY',
    remediationOwner: 'A',
    requiredCapabilitiesGranted: true,
    forbiddenCapabilitiesDenied: true,
    remediationOwnedByA: true,
    missionCanonical: true,
  });
  assert.equal(Object.isFrozen(result), true);
});

test('canonical breaker policy states falsification-first and no self-remediation', () => {
  assert.match(policy, /B_MISSION = BREAK_BEFORE_CERTIFY/);
  assert.match(policy, /B does not exist to confirm that A probably did a good job/);
  assert.match(policy, /B never fixes what B finds/);
  assert.match(policy, /A owns remediation/);
  assert.match(policy, /B → HOLD\/HOLD_FOR_REMEDIATION → A/);
  assert.match(policy, /Production\/IAM\/secrets\/destructive operations remain Human-Gate-only/);
});

test('formal role mission objects are immutable regression anchors', () => {
  assert.equal(Object.isFrozen(ROLE_MISSIONS), true);
  assert.equal(Object.isFrozen(BREAKER_REQUIRED_CAPABILITIES), true);
  assert.equal(Object.isFrozen(BREAKER_FORBIDDEN_CAPABILITIES), true);
});
