// Korixa — Common Agent Protocol (Task 3, 2026-08-23): the CAPABILITY
// MODEL. Formalizes what each canonical role (NIGHT/A/B/C) may attempt to
// DO -- a closed, testable ACTION vocabulary -- separately from
// `role-protocol.mjs`'s STATE/TRANSITION vocabulary (which governs how a
// task moves between PROTOCOL_STATES). Deliberately a small, focused module
// rather than an extension of the already-substantial (658-line)
// role-protocol.mjs: "which actions can this role attempt" and "which
// state moves are legal" are different questions with different callers
// (a future Task 4 locking/queue system needs the former without needing
// the full state machine), and Task 2's own primitives are REUSED here
// (ROLES, imported, never re-declared) rather than duplicated.
//
// SCOPE: this module answers exactly one question --
// "is <role> permitted to attempt <capability>?" -- fail-closed, via a
// closed ALLOWLIST (never a blacklist; see command-safety.mjs's own R4->R5
// blacklist->whitelist rewrite, the precedent this project already learned
// from). It does NOT decide whether an attempt SUCCEEDS (that is
// role-protocol.mjs's job: certifyAuditResult/certifyByValidator/
// finalizeExecutorResult/evaluateCommandRiskGate) and it does NOT implement
// any locking/reservation/queue system (explicitly out of scope for Task 3
// -- see Task 4).
//
// MACHINE-ENFORCEMENT CLASSIFICATION (same three tiers as
// COMMON_AGENT_PROTOCOL.md): every function here is MACHINE_ENFORCED_PRIMITIVE
// (correct, if invoked) but NOT RUNTIME_WIRED_ENFORCEMENT (nothing in this
// repository's real execution path currently calls this module -- exactly
// Task 2's own, still-accurate disclosure). "B cannot mutate while
// auditing" remains PROCEDURAL_ENFORCED_BY_POLICY for the same reason
// documented in role-protocol.mjs: no OS/tool-permission boundary exists
// between roles in the single-chat model.

import { ROLES } from './protocol-state.mjs';
import {
  EXECUTOR_RESULT_STATES,
  AUDITOR_RESULT_STATES,
  VALIDATOR_RESULT_STATES,
} from './role-protocol.mjs';

// ---------------------------------------------------------------------------
// Closed capability vocabulary -- exactly the names given in Task 3's own
// brief (no renaming; a future reader diffing against the brief should find
// an exact match).
// ---------------------------------------------------------------------------

export const CAPABILITIES = Object.freeze([
  'READ',
  'WRITE_TASK_FILES',
  'RUN_PRIMARY_TESTS',
  'RUN_ADVERSARIAL_TESTS',
  'COMMIT_TASK_BRANCH',
  'PUSH_TASK_BRANCH',
  'AUDIT',
  'CREATE_FINDING',
  'CERTIFY_AUDIT',
  'VALIDATE',
  'CERTIFY_TECHNICAL_PASS',
  'MARK_READY',
  'MERGE_MAIN',
  'PRODUCTION_MUTATION',
  'IAM_MUTATION',
  'SECRET_MUTATION',
  'DESTRUCTIVE_OPERATION',
]);

// These six can NEVER be granted to any role by this module, unconditionally
// -- not even NIGHT. A technical PASS from C is never equivalent to human
// authorization (Task 3's own stated invariant); the only path to any of
// these six is a human, outside this protocol, outside this chat. Modeling
// this as "never present in ANY role's allowlist" (rather than "present but
// then vetoed by a special-case check") is the deliberate choice: there is
// structurally no field, in no role's entry, that could ever be edited to
// grant one of these, mirroring finalizeExecutorResult's own "no field
// exists for the executor's own conclusion" pattern in role-protocol.mjs.
export const HUMAN_GATE_ONLY_CAPABILITIES = Object.freeze([
  'MARK_READY',
  'MERGE_MAIN',
  'PRODUCTION_MUTATION',
  'IAM_MUTATION',
  'SECRET_MUTATION',
  'DESTRUCTIVE_OPERATION',
]);

// ---------------------------------------------------------------------------
// The closed allowlist itself -- a Map, not a plain object, so that an
// attacker- or bug-supplied role string can never reach the JS prototype
// chain (no `ROLE_CAPABILITIES.__proto__`/`.constructor` surface exists on
// a Map the way it would on `{}`). Every entry is a frozen array; the Map
// itself is never mutated after this module loads.
//
// Design (per the invariants Task 3 requires be IMPOSSIBLE at this layer):
//  - NIGHT is the orchestrator only: it plans and hands off, it never
//    executes, audits, or validates task content itself. READ only.
//  - A (Executor) may read, write task files, run ITS OWN primary tests,
//    and commit/push the task branch -- but has no path to AUDIT,
//    CERTIFY_AUDIT, VALIDATE, or CERTIFY_TECHNICAL_PASS: those verbs simply
//    do not appear in A's row.
//  - B (Auditor) may read, run adversarial tests, audit, create findings,
//    and certify an audit result -- but has no path to WRITE_TASK_FILES,
//    COMMIT_TASK_BRANCH, PUSH_TASK_BRANCH, VALIDATE, or
//    CERTIFY_TECHNICAL_PASS.
//  - C (Validator) may read, validate, and certify a technical pass -- but
//    has no path to WRITE_TASK_FILES, AUDIT, CERTIFY_AUDIT,
//    COMMIT_TASK_BRANCH, or PUSH_TASK_BRANCH.
//  - No role's row contains any HUMAN_GATE_ONLY_CAPABILITIES value -- see
//    evaluateRoleCapability below, which also refuses those six
//    unconditionally before ever consulting a role's row, so even a future
//    editing mistake that accidentally added one to a row could not grant
//    it.
// ---------------------------------------------------------------------------

const ROLE_CAPABILITIES = new Map([
  ['NIGHT', Object.freeze(['READ'])],
  ['A', Object.freeze(['READ', 'WRITE_TASK_FILES', 'RUN_PRIMARY_TESTS', 'COMMIT_TASK_BRANCH', 'PUSH_TASK_BRANCH'])],
  ['B', Object.freeze(['READ', 'RUN_ADVERSARIAL_TESTS', 'AUDIT', 'CREATE_FINDING', 'CERTIFY_AUDIT'])],
  ['C', Object.freeze(['READ', 'VALIDATE', 'CERTIFY_TECHNICAL_PASS'])],
]);

function isKnownRole(role) {
  return typeof role === 'string' && ROLES.includes(role);
}

function isKnownCapability(capability) {
  return typeof capability === 'string' && CAPABILITIES.includes(capability);
}

/**
 * Fail-closed capability check. Never throws -- callers that only need a
 * boolean should use `isRoleAllowed`; this returns the full reasoning so a
 * caller (or a test) can distinguish WHY something was denied.
 *
 * Denial precedence (checked in this exact order, each one fail-closed on
 * its own):
 *   1. malformed/unknown role       -> UNKNOWN_ROLE
 *   2. malformed/unknown capability -> UNKNOWN_CAPABILITY
 *   3. capability is HUMAN_GATE-only -> HUMAN_GATE_REQUIRED (unconditional,
 *      regardless of role -- checked BEFORE consulting the role's row)
 *   4. capability not in this role's row -> CAPABILITY_NOT_GRANTED_FOR_ROLE
 *   5. otherwise -> CAPABILITY_GRANTED
 *
 * @param {unknown} role expected to be exactly one of ROLES
 * @param {unknown} capability expected to be exactly one of CAPABILITIES
 * @returns {{allowed: boolean, role: unknown, capability: unknown, reason: string, humanGateRequired: boolean}}
 */
export function evaluateRoleCapability(role, capability) {
  if (!isKnownRole(role)) {
    return { allowed: false, role, capability, reason: 'UNKNOWN_ROLE', humanGateRequired: false };
  }
  if (!isKnownCapability(capability)) {
    return { allowed: false, role, capability, reason: 'UNKNOWN_CAPABILITY', humanGateRequired: false };
  }
  if (HUMAN_GATE_ONLY_CAPABILITIES.includes(capability)) {
    return { allowed: false, role, capability, reason: 'HUMAN_GATE_REQUIRED', humanGateRequired: true };
  }
  const row = ROLE_CAPABILITIES.get(role) ?? [];
  if (!row.includes(capability)) {
    return { allowed: false, role, capability, reason: 'CAPABILITY_NOT_GRANTED_FOR_ROLE', humanGateRequired: false };
  }
  return { allowed: true, role, capability, reason: 'CAPABILITY_GRANTED', humanGateRequired: false };
}

/**
 * @param {unknown} role
 * @param {unknown} capability
 * @returns {boolean}
 */
export function isRoleAllowed(role, capability) {
  return evaluateRoleCapability(role, capability).allowed;
}

// ---------------------------------------------------------------------------
// Formal minimum output contracts for A/B/C -- made MORE EXPLICIT (per
// Task 3's own brief) as a named, importable, closed reference, rather than
// left implicit in role-protocol.mjs's object literals. These field lists
// are read directly off finalizeExecutorResult / buildAuditorResult /
// certifyByValidator's actual return shapes in role-protocol.mjs -- this is
// documentation-as-code (and a thing tests can assert against), not a
// reimplementation: no new logic decides these shapes, role-protocol.mjs
// still does.
// ---------------------------------------------------------------------------

export const ROLE_OUTPUT_CONTRACTS = Object.freeze({
  A: Object.freeze({
    producedBy: 'finalizeExecutorResult',
    requiredFields: Object.freeze(['role', 'executorRole', 'state', 'baseSha', 'headSha', 'filesChanged', 'tests', 'knownLimitations']),
    stateDomain: EXECUTOR_RESULT_STATES,
  }),
  B: Object.freeze({
    producedBy: 'certifyAuditResult',
    requiredFields: Object.freeze(['role', 'executorRole', 'auditorRole', 'headSha', 'requestedState', 'independent', 'findings', 'evidence', 'finalState', 'reason']),
    stateDomain: AUDITOR_RESULT_STATES,
  }),
  C: Object.freeze({
    producedBy: 'certifyByValidator',
    requiredFields: Object.freeze(['role', 'executorRole', 'validatorRole', 'currentHeadSha', 'ciHeadSha', 'ciStatus', 'independent', 'finalState', 'reason']),
    stateDomain: VALIDATOR_RESULT_STATES,
  }),
});
