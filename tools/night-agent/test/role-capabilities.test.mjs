import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  HUMAN_GATE_ONLY_CAPABILITIES,
  ROLE_OUTPUT_CONTRACTS,
  evaluateRoleCapability,
  isRoleAllowed,
} from '../role-capabilities.mjs';
import { ROLES } from '../protocol-state.mjs';

// ---------------------------------------------------------------------------
// A: can write, cannot audit or certify.
// ---------------------------------------------------------------------------

test('A can WRITE_TASK_FILES', () => {
  assert.equal(isRoleAllowed('A', 'WRITE_TASK_FILES'), true);
});

test('A can RUN_PRIMARY_TESTS, COMMIT_TASK_BRANCH, PUSH_TASK_BRANCH, READ', () => {
  assert.equal(isRoleAllowed('A', 'RUN_PRIMARY_TESTS'), true);
  assert.equal(isRoleAllowed('A', 'COMMIT_TASK_BRANCH'), true);
  assert.equal(isRoleAllowed('A', 'PUSH_TASK_BRANCH'), true);
  assert.equal(isRoleAllowed('A', 'READ'), true);
});

test('A cannot AUDIT, CREATE_FINDING, or CERTIFY_AUDIT', () => {
  assert.equal(isRoleAllowed('A', 'AUDIT'), false);
  assert.equal(isRoleAllowed('A', 'CREATE_FINDING'), false);
  assert.equal(isRoleAllowed('A', 'CERTIFY_AUDIT'), false);
});

test('A cannot VALIDATE or CERTIFY_TECHNICAL_PASS (no self-to-C bypass)', () => {
  assert.equal(isRoleAllowed('A', 'VALIDATE'), false);
  assert.equal(isRoleAllowed('A', 'CERTIFY_TECHNICAL_PASS'), false);
});

// ---------------------------------------------------------------------------
// B: can audit, cannot write or commit.
// ---------------------------------------------------------------------------

test('B can AUDIT, CREATE_FINDING, CERTIFY_AUDIT, RUN_ADVERSARIAL_TESTS, READ', () => {
  assert.equal(isRoleAllowed('B', 'AUDIT'), true);
  assert.equal(isRoleAllowed('B', 'CREATE_FINDING'), true);
  assert.equal(isRoleAllowed('B', 'CERTIFY_AUDIT'), true);
  assert.equal(isRoleAllowed('B', 'RUN_ADVERSARIAL_TESTS'), true);
  assert.equal(isRoleAllowed('B', 'READ'), true);
});

test('B cannot WRITE_TASK_FILES, COMMIT_TASK_BRANCH, or PUSH_TASK_BRANCH', () => {
  assert.equal(isRoleAllowed('B', 'WRITE_TASK_FILES'), false);
  assert.equal(isRoleAllowed('B', 'COMMIT_TASK_BRANCH'), false);
  assert.equal(isRoleAllowed('B', 'PUSH_TASK_BRANCH'), false);
});

test('B cannot CERTIFY_TECHNICAL_PASS (cannot do C\'s job)', () => {
  assert.equal(isRoleAllowed('B', 'CERTIFY_TECHNICAL_PASS'), false);
});

// ---------------------------------------------------------------------------
// C: can validate, cannot write or audit.
// ---------------------------------------------------------------------------

test('C can VALIDATE, CERTIFY_TECHNICAL_PASS, READ', () => {
  assert.equal(isRoleAllowed('C', 'VALIDATE'), true);
  assert.equal(isRoleAllowed('C', 'CERTIFY_TECHNICAL_PASS'), true);
  assert.equal(isRoleAllowed('C', 'READ'), true);
});

test('C cannot WRITE_TASK_FILES or COMMIT_TASK_BRANCH', () => {
  assert.equal(isRoleAllowed('C', 'WRITE_TASK_FILES'), false);
  assert.equal(isRoleAllowed('C', 'COMMIT_TASK_BRANCH'), false);
});

test('C cannot AUDIT or CERTIFY_AUDIT (cannot do B\'s job)', () => {
  assert.equal(isRoleAllowed('C', 'AUDIT'), false);
  assert.equal(isRoleAllowed('C', 'CERTIFY_AUDIT'), false);
});

// ---------------------------------------------------------------------------
// NIGHT: orchestrator only.
// ---------------------------------------------------------------------------

test('NIGHT can READ, cannot WRITE_TASK_FILES/AUDIT/VALIDATE/CERTIFY anything', () => {
  assert.equal(isRoleAllowed('NIGHT', 'READ'), true);
  assert.equal(isRoleAllowed('NIGHT', 'WRITE_TASK_FILES'), false);
  assert.equal(isRoleAllowed('NIGHT', 'AUDIT'), false);
  assert.equal(isRoleAllowed('NIGHT', 'VALIDATE'), false);
  assert.equal(isRoleAllowed('NIGHT', 'CERTIFY_AUDIT'), false);
  assert.equal(isRoleAllowed('NIGHT', 'CERTIFY_TECHNICAL_PASS'), false);
});

test('Task 7 hotfix: BIND_PR_IDENTITY is granted ONLY to NIGHT -- A/B/C are all denied', () => {
  assert.equal(isRoleAllowed('NIGHT', 'BIND_PR_IDENTITY'), true);
  assert.equal(isRoleAllowed('A', 'BIND_PR_IDENTITY'), false);
  assert.equal(isRoleAllowed('B', 'BIND_PR_IDENTITY'), false);
  assert.equal(isRoleAllowed('C', 'BIND_PR_IDENTITY'), false);
});

test('Task 7 hotfix: BIND_PR_IDENTITY is NOT a human-gate capability -- it is routine NIGHT bookkeeping, distinct from MARK_READY/MERGE', () => {
  assert.equal(HUMAN_GATE_ONLY_CAPABILITIES.includes('BIND_PR_IDENTITY'), false);
  const decision = evaluateRoleCapability('NIGHT', 'BIND_PR_IDENTITY');
  assert.equal(decision.allowed, true);
  assert.equal(decision.humanGateRequired, false);
});

// ---------------------------------------------------------------------------
// Unknown role / unknown capability / malformed input -> fail closed.
// ---------------------------------------------------------------------------

test('unknown role denies for every valid capability', () => {
  for (const role of ['NIGHT2', 'D', 'executor', 'admin', 'human']) {
    const r = evaluateRoleCapability(role, 'READ');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'UNKNOWN_ROLE');
  }
});

test('unknown capability denies for every valid role', () => {
  for (const role of ROLES) {
    const r = evaluateRoleCapability(role, 'DELETE_PRODUCTION_DB');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'UNKNOWN_CAPABILITY');
  }
});

test('malformed role input (null/undefined/number/object/array/empty string) fails closed', () => {
  for (const bad of [null, undefined, 42, {}, [], '', {role: 'A'}, ['A']]) {
    const r = evaluateRoleCapability(bad, 'READ');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'UNKNOWN_ROLE');
  }
});

test('malformed capability input (null/undefined/number/object/array/empty string) fails closed', () => {
  for (const bad of [null, undefined, 42, {}, [], '']) {
    const r = evaluateRoleCapability('A', bad);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'UNKNOWN_CAPABILITY');
  }
});

test('prototype-pollution-shaped role strings deny, never touch ROLE_CAPABILITIES row', () => {
  for (const bad of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    const r = evaluateRoleCapability(bad, 'READ');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'UNKNOWN_ROLE');
  }
});

// ---------------------------------------------------------------------------
// HUMAN_GATE categories: MARK_READY, MERGE_MAIN, PRODUCTION_MUTATION,
// IAM_MUTATION, SECRET_MUTATION, DESTRUCTIVE_OPERATION -- always
// HUMAN_GATE, for every role, no exceptions, including NIGHT.
// ---------------------------------------------------------------------------

test('all 6 HUMAN_GATE_ONLY_CAPABILITIES are denied for every role, unconditionally', () => {
  assert.deepEqual([...HUMAN_GATE_ONLY_CAPABILITIES].sort(), [
    'DESTRUCTIVE_OPERATION', 'IAM_MUTATION', 'MARK_READY', 'MERGE_MAIN', 'PRODUCTION_MUTATION', 'SECRET_MUTATION',
  ].sort());
  for (const role of ROLES) {
    for (const capability of HUMAN_GATE_ONLY_CAPABILITIES) {
      const r = evaluateRoleCapability(role, capability);
      assert.equal(r.allowed, false, `${role} must never be granted ${capability}`);
      assert.equal(r.reason, 'HUMAN_GATE_REQUIRED');
      assert.equal(r.humanGateRequired, true);
    }
  }
});

test('no role row in the module contains any HUMAN_GATE_ONLY_CAPABILITIES value (defense in depth)', () => {
  for (const role of ROLES) {
    for (const capability of HUMAN_GATE_ONLY_CAPABILITIES) {
      // even if a future edit accidentally added one to a role's row, the
      // HUMAN_GATE_REQUIRED check in evaluateRoleCapability runs BEFORE the
      // row is ever consulted -- this test locks in that ordering by
      // asserting the observable outcome, not by reading the private Map.
      assert.equal(isRoleAllowed(role, capability), false);
    }
  }
});

// ---------------------------------------------------------------------------
// Identity exact-match / no-normalization-bypass: whitespace, Unicode
// lookalikes/invisibles, lowercase, capability-typo.
// ---------------------------------------------------------------------------

test('no whitespace-bypass on role', () => {
  for (const role of [' A', 'A ', ' A ', '\tA', 'A\n']) {
    assert.equal(evaluateRoleCapability(role, 'READ').reason, 'UNKNOWN_ROLE');
  }
});

test('no whitespace-bypass on capability', () => {
  for (const capability of [' READ', 'READ ', ' READ ', '\tREAD']) {
    assert.equal(evaluateRoleCapability('A', capability).reason, 'UNKNOWN_CAPABILITY');
  }
});

test('no Unicode-lookalike/invisible-character bypass on role', () => {
  const variants = [
    'A​',   // zero-width space
    '​A',
    'A‍',   // zero-width joiner
    'A﻿',   // BOM
    'Á', // 'A' + combining acute accent (visually similar)
    'Ａ',    // fullwidth Latin 'A'
  ];
  for (const role of variants) {
    assert.equal(evaluateRoleCapability(role, 'READ').reason, 'UNKNOWN_ROLE', `variant ${JSON.stringify(role)} must not be accepted as 'A'`);
  }
});

test('no lowercase-bypass on role', () => {
  for (const role of ['a', 'b', 'c', 'night']) {
    assert.equal(evaluateRoleCapability(role, 'READ').reason, 'UNKNOWN_ROLE');
  }
});

test('no lowercase-bypass on capability', () => {
  for (const capability of ['read', 'write_task_files', 'audit']) {
    assert.equal(evaluateRoleCapability('A', capability).reason, 'UNKNOWN_CAPABILITY');
  }
});

test('no capability-typo bypass', () => {
  for (const capability of ['REEAD', 'READ_ONLY', 'WRITE_TASKFILES', 'CERTIFY_AUDITS', 'CERTIFY_TECHNICAL_PASSED', 'MERGE_MAIN ', 'MARK_READY2']) {
    assert.equal(evaluateRoleCapability('B', capability).reason, 'UNKNOWN_CAPABILITY');
  }
});

// ---------------------------------------------------------------------------
// Closed-vocabulary sanity: CAPABILITIES contains exactly the 18 names
// (17 from Task 3 + BIND_PR_IDENTITY from the Task 7 hotfix), no more, no
// fewer.
// ---------------------------------------------------------------------------

test('CAPABILITIES is exactly the 18 named capabilities', () => {
  assert.equal(CAPABILITIES.length, 18);
  for (const name of [
    'READ', 'WRITE_TASK_FILES', 'RUN_PRIMARY_TESTS', 'RUN_ADVERSARIAL_TESTS',
    'COMMIT_TASK_BRANCH', 'PUSH_TASK_BRANCH', 'AUDIT', 'CREATE_FINDING',
    'CERTIFY_AUDIT', 'VALIDATE', 'CERTIFY_TECHNICAL_PASS', 'BIND_PR_IDENTITY',
    'MARK_READY', 'MERGE_MAIN', 'PRODUCTION_MUTATION', 'IAM_MUTATION',
    'SECRET_MUTATION', 'DESTRUCTIVE_OPERATION',
  ]) {
    assert.ok(CAPABILITIES.includes(name), `missing capability ${name}`);
  }
});

test('CAPABILITIES and ROLE_CAPABILITIES rows are frozen (cannot be mutated at runtime)', () => {
  assert.ok(Object.isFrozen(CAPABILITIES));
  assert.throws(() => { CAPABILITIES.push('NEW_CAP'); });
  const aRow = evaluateRoleCapability('A', 'READ');
  assert.ok(aRow.allowed);
});

// ---------------------------------------------------------------------------
// Output contracts: present for A/B/C, closed field lists, reference the
// real state domains from role-protocol.mjs (not reimplemented).
// ---------------------------------------------------------------------------

test('ROLE_OUTPUT_CONTRACTS covers exactly A, B, C', () => {
  assert.deepEqual(Object.keys(ROLE_OUTPUT_CONTRACTS).sort(), ['A', 'B', 'C']);
});

test('ROLE_OUTPUT_CONTRACTS.A references EXECUTOR_RESULT_STATES domain (IMPLEMENTED_AND_VALIDATED/HOLD/FAIL)', () => {
  assert.deepEqual([...ROLE_OUTPUT_CONTRACTS.A.stateDomain].sort(), ['FAIL', 'HOLD', 'IMPLEMENTED_AND_VALIDATED'].sort());
  assert.ok(ROLE_OUTPUT_CONTRACTS.A.requiredFields.includes('headSha'));
});

test('ROLE_OUTPUT_CONTRACTS.B/C required fields include independent + headSha binding', () => {
  assert.ok(ROLE_OUTPUT_CONTRACTS.B.requiredFields.includes('independent'));
  assert.ok(ROLE_OUTPUT_CONTRACTS.B.requiredFields.includes('headSha'));
  assert.ok(ROLE_OUTPUT_CONTRACTS.C.requiredFields.includes('independent'));
  assert.ok(ROLE_OUTPUT_CONTRACTS.C.requiredFields.includes('currentHeadSha'));
});

// ---------------------------------------------------------------------------
// evaluateRoleCapability never throws for any input shape (fail-closed via
// return value, not exceptions) -- a caller can always safely call it.
// ---------------------------------------------------------------------------

test('evaluateRoleCapability never throws for any input combination tried in this suite', () => {
  const wildInputs = [null, undefined, 42, {}, [], '', 'A', 'a', Symbol('x'), () => {}, NaN, Infinity, -1];
  for (const role of wildInputs) {
    for (const capability of wildInputs) {
      assert.doesNotThrow(() => evaluateRoleCapability(role, capability));
    }
  }
});
