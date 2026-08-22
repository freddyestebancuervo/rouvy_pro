// Korixa Night Agent — task queue library.
//
// Pure functions only: no Claude invocation, no file mutation, no network,
// no child_process. Everything here takes a parsed queue object (matching
// .claude/overnight/TASK_QUEUE.example.json's schema) and returns data.
// Safe to unit test directly with node:test.
//
// NIGHT-V1-B: path-safety rules (canonical validation, case-folded overlap,
// critical-path detection) moved to tools/night-agent/path-safety.mjs, the
// single source of truth also used by night-guard.mjs — see path-safety.mjs
// for the full rationale. Re-exported here for backward compatibility with
// existing imports (`isRepoRelativePath`/`pathsOverlap` from this module).

import {
  isRepoRelativePath,
  pathsOverlap,
  isPathWithinScope,
  isCriticalControlPlanePath,
} from './path-safety.mjs';

export { isRepoRelativePath, pathsOverlap };

// Canonical task states (NIGHT-V1-A-R1): the only states any task may ever
// be in. `DONE` and `IN_PROGRESS` are retired — they never appear here or
// in any queue file. A HARD_DEPENDENCY is satisfied only by the dependency
// reaching `PASS`, never any other terminal-looking state.
export const CANONICAL_STATES = [
  'READY',
  'RUNNING',
  'PASS',
  'RETRY',
  'HOLD',
  'BLOCKED',
  'SKIPPED',
  'SESSION_HALT',
];

const VALID_STATUSES = new Set(CANONICAL_STATES);
const VALID_RISKS = new Set(['GREEN', 'YELLOW', 'RED']);
const VALID_DEPENDENCY_TYPES = new Set(['INDEPENDENT', 'HARD_DEPENDENCY', 'SOFT_DEPENDENCY']);
const VALID_ON_FAILURE = new Set(['RETRY_THEN_HOLD', 'HOLD', 'SESSION_HALT']);
const VALID_SESSION_MODES = new Set(['dry-run']); // the only mode V1 knows

const MAX_RETRIES_CEILING = 3;
const MAX_SESSION_MINUTES_CEILING = 480; // POLICY.md V1 hard ceiling
const MAX_TURNS_CEILING = 40; // NIGHT-V1-B: conservative ceiling — see POLICY.md

// NIGHT-V1-B: the closed set of verification-command "families" a task may
// request. Never a raw shell string — the controller maps a family (plus,
// where relevant, a task-scoped target path) to a safe argv array itself
// (see executor.mjs). This mirrors the guard's own tiny safe-command
// surface deliberately: verification must never be a wider capability than
// what a supervised session's own guard would allow.
export const VALID_VERIFICATION_FAMILIES = new Set(['NODE_TEST', 'NODE_VERSION', 'PWD']);

// TASK_QUEUE.example.json intentionally ships a synthetic, obviously-fake
// base_sha so the fixture can never be mistaken for a real commit to build
// from. This exact sentinel is the one documented exception to "base_sha
// must be a real 40-hex SHA" — see .claude/overnight/TASK_QUEUE.example.json.
export const FIXTURE_BASE_SHA = '0000000000000000000000000000000000FIXT';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isValidBaseSha(value) {
  return typeof value === 'string' && (/^[0-9a-f]{40}$/i.test(value) || value === FIXTURE_BASE_SHA);
}

function isValidPathArray(value) {
  return Array.isArray(value) && value.every((p) => typeof p === 'string');
}

/**
 * Validate one verification_commands entry against the closed family
 * allowlist (section 24). NODE_TEST requires a `target` that is both a
 * canonical repo-relative path and contained within the task's own
 * allowed_paths/read_paths — a task cannot request verification of a path
 * outside its own declared scope.
 * @param {any} vc
 * @param {any} task
 * @returns {boolean}
 */
function isValidVerificationCommand(vc, task) {
  if (vc === null || typeof vc !== 'object') return false;
  if (!VALID_VERIFICATION_FAMILIES.has(vc.family)) return false;
  if (vc.family === 'NODE_TEST') {
    if (!isNonEmptyString(vc.target)) return false;
    if (!isRepoRelativePath(vc.target)) return false;
    const scope = [...(Array.isArray(task.allowed_paths) ? task.allowed_paths : []), ...(Array.isArray(task.read_paths) ? task.read_paths : [])];
    if (!isPathWithinScope(vc.target, scope)) return false;
    return Object.keys(vc).every((k) => k === 'family' || k === 'target');
  }
  // NODE_VERSION / PWD take no target — no ambiguity to smuggle a path through.
  return Object.keys(vc).every((k) => k === 'family');
}

/**
 * Validate the structural shape of a parsed queue object. Strict: every
 * field required by the Night Agent contract is checked, not just the
 * fields a given task happens to use.
 * @param {any} queue
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateSchema(queue) {
  const errors = [];

  if (queue === null || typeof queue !== 'object') {
    return { valid: false, errors: ['queue must be a JSON object'] };
  }
  if (queue.schema_version !== 1) {
    errors.push(`schema_version must be 1, got ${JSON.stringify(queue.schema_version)}`);
  }

  if (!queue.session || typeof queue.session !== 'object') {
    errors.push('session must be an object');
  } else {
    const s = queue.session;
    if (!isNonEmptyString(s.session_id)) errors.push('session.session_id must be a non-empty string');
    if (!VALID_SESSION_MODES.has(s.mode)) {
      errors.push(`session.mode must be one of ${[...VALID_SESSION_MODES].join('|')}, got ${JSON.stringify(s.mode)}`);
    }
    if (!isValidBaseSha(s.base_sha)) {
      errors.push('session.base_sha must be a 40-hex SHA (or the documented fixture sentinel)');
    }
    if (!isNonEmptyString(s.branch_prefix)) errors.push('session.branch_prefix must be a non-empty string');
    if (!isPositiveInteger(s.max_session_minutes) || s.max_session_minutes > MAX_SESSION_MINUTES_CEILING) {
      errors.push(`session.max_session_minutes must be a positive integer <= ${MAX_SESSION_MINUTES_CEILING}`);
    }
    if (!isPositiveInteger(s.max_total_tasks)) errors.push('session.max_total_tasks must be a positive integer');
    if (!isPositiveInteger(s.max_consecutive_holds)) errors.push('session.max_consecutive_holds must be a positive integer');
  }

  if (!Array.isArray(queue.tasks)) {
    errors.push('tasks must be an array');
    return { valid: errors.length === 0, errors };
  }

  const seenIds = new Set();
  queue.tasks.forEach((task, index) => {
    const where = `tasks[${index}]`;
    if (task === null || typeof task !== 'object') {
      errors.push(`${where} must be an object`);
      return;
    }

    if (!isNonEmptyString(task.id)) {
      errors.push(`${where}.id must be a non-empty string`);
    } else if (seenIds.has(task.id)) {
      errors.push(`duplicate task id: "${task.id}"`);
    } else {
      seenIds.add(task.id);
    }
    if (!isNonEmptyString(task.title)) errors.push(`${where}.title must be a non-empty string`);
    if (!isNonEmptyString(task.objective)) errors.push(`${where}.objective must be a non-empty string`);

    if (!VALID_RISKS.has(task.risk)) {
      errors.push(`${where}.risk must be one of ${[...VALID_RISKS].join('|')}, got ${JSON.stringify(task.risk)}`);
    }
    if (!VALID_STATUSES.has(task.status)) {
      errors.push(`${where}.status must be one of ${CANONICAL_STATES.join('|')}, got ${JSON.stringify(task.status)}`);
    }
    if (!VALID_DEPENDENCY_TYPES.has(task.dependency_type)) {
      errors.push(`${where}.dependency_type must be one of ${[...VALID_DEPENDENCY_TYPES].join('|')}, got ${JSON.stringify(task.dependency_type)}`);
    }
    if (!VALID_ON_FAILURE.has(task.on_failure)) {
      errors.push(`${where}.on_failure must be one of ${[...VALID_ON_FAILURE].join('|')}, got ${JSON.stringify(task.on_failure)}`);
    }
    if (typeof task.enabled !== 'boolean') {
      errors.push(`${where}.enabled must be a boolean (NIGHT-V1-B: explicit per-task GREEN-execution gate)`);
    }

    if (!Array.isArray(task.depends_on) || !task.depends_on.every(isNonEmptyString)) {
      errors.push(`${where}.depends_on must be an array of non-empty strings`);
    } else {
      const dupCheck = new Set();
      for (const dep of task.depends_on) {
        if (dupCheck.has(dep)) errors.push(`${where} ("${task.id}") has a duplicate entry in depends_on: "${dep}"`);
        dupCheck.add(dep);
        if (isNonEmptyString(task.id) && dep === task.id) {
          errors.push(`${where} ("${task.id}") depends_on itself`);
        }
      }
      if (task.dependency_type === 'INDEPENDENT' && task.depends_on.length !== 0) {
        errors.push(`${where} ("${task.id}") is dependency_type INDEPENDENT but has non-empty depends_on`);
      }
      if (
        (task.dependency_type === 'HARD_DEPENDENCY' || task.dependency_type === 'SOFT_DEPENDENCY') &&
        task.depends_on.length === 0
      ) {
        errors.push(`${where} ("${task.id}") is dependency_type ${task.dependency_type} but depends_on is empty`);
      }
    }

    if (!isValidPathArray(task.allowed_paths)) {
      errors.push(`${where}.allowed_paths must be an array of strings`);
    } else {
      for (const p of task.allowed_paths) {
        if (!isRepoRelativePath(p)) errors.push(`${where}.allowed_paths contains an unsafe/non-canonical path: "${p}"`);
        else if (isCriticalControlPlanePath(p)) errors.push(`${where}.allowed_paths contains a critical control-plane path: "${p}" (section 12 — never writable by an autonomous task)`);
      }
    }
    if (!isValidPathArray(task.forbidden_paths)) {
      errors.push(`${where}.forbidden_paths must be an array of strings`);
    } else {
      for (const p of task.forbidden_paths) {
        if (!isRepoRelativePath(p)) errors.push(`${where}.forbidden_paths contains an unsafe/non-canonical path: "${p}"`);
      }
    }
    // NIGHT-V1-B: read_paths — a task's read-only scope, independent of (and
    // not necessarily a subset or superset of) allowed_paths. GREEN+READY
    // tasks must declare both a writable and a readable scope (section 5).
    if (!isValidPathArray(task.read_paths)) {
      errors.push(`${where}.read_paths must be an array of strings`);
    } else {
      for (const p of task.read_paths) {
        if (!isRepoRelativePath(p)) errors.push(`${where}.read_paths contains an unsafe/non-canonical path: "${p}"`);
        else if (isCriticalControlPlanePath(p)) errors.push(`${where}.read_paths contains a critical control-plane path: "${p}" (section 12)`);
      }
    }
    if (
      isValidPathArray(task.allowed_paths) &&
      isValidPathArray(task.forbidden_paths)
    ) {
      for (const ap of task.allowed_paths) {
        for (const fp of task.forbidden_paths) {
          if (pathsOverlap(ap, fp)) {
            errors.push(`${where} ("${task.id}") allowed_paths "${ap}" overlaps its own forbidden_paths "${fp}" — ambiguous task contract`);
          }
        }
      }
    }
    if (
      task.risk === 'GREEN' &&
      task.status === 'READY' &&
      task.enabled === true &&
      isValidPathArray(task.allowed_paths) &&
      task.allowed_paths.length === 0
    ) {
      errors.push(`${where} ("${task.id}") is GREEN, READY, and enabled but has an empty allowed_paths — no writable scope`);
    }
    if (
      task.risk === 'GREEN' &&
      task.status === 'READY' &&
      task.enabled === true &&
      isValidPathArray(task.read_paths) &&
      task.read_paths.length === 0
    ) {
      errors.push(`${where} ("${task.id}") is GREEN, READY, and enabled but has an empty read_paths — no readable scope`);
    }

    if (!Array.isArray(task.required_checks) || !task.required_checks.every(isNonEmptyString)) {
      errors.push(`${where}.required_checks must be an array of non-empty strings`);
    }
    if (!Number.isInteger(task.max_retries) || task.max_retries < 0 || task.max_retries > MAX_RETRIES_CEILING) {
      errors.push(`${where}.max_retries must be an integer between 0 and ${MAX_RETRIES_CEILING}`);
    }
    if (!isPositiveInteger(task.timeout_seconds)) {
      errors.push(`${where}.timeout_seconds must be a positive integer`);
    }
    // NIGHT-V1-B: max_turns — bounds a future Claude child's own turn count;
    // required for every task (not just GREEN) so the field is never
    // silently absent right when it starts mattering.
    if (!isPositiveInteger(task.max_turns) || task.max_turns > MAX_TURNS_CEILING) {
      errors.push(`${where}.max_turns must be a positive integer <= ${MAX_TURNS_CEILING}`);
    }
    // NIGHT-V1-B: verification_commands — closed family allowlist, never a
    // raw shell string. Optional (an empty array is valid) but each present
    // entry must be well-formed.
    if (!Array.isArray(task.verification_commands)) {
      errors.push(`${where}.verification_commands must be an array`);
    } else {
      task.verification_commands.forEach((vc, vcIndex) => {
        if (!isValidVerificationCommand(vc, task)) {
          errors.push(`${where}.verification_commands[${vcIndex}] is not a valid verification command (must be {family: one of ${[...VALID_VERIFICATION_FAMILIES].join('|')}} with no extra fields, plus a task-scoped "target" path when family is NODE_TEST)`);
        }
      });
    }
  });

  // depends_on must reference ids that actually exist.
  queue.tasks.forEach((task, index) => {
    if (!Array.isArray(task?.depends_on)) return;
    for (const dep of task.depends_on) {
      if (!seenIds.has(dep)) {
        errors.push(`tasks[${index}] ("${task.id}") depends_on unknown task id "${dep}"`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Detect a dependency cycle among tasks via depends_on. Returns the first
 * cycle found as an array of task ids, or null if the graph is acyclic.
 * @param {any[]} tasks
 * @returns {string[]|null}
 */
export function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(tasks.map((t) => [t.id, WHITE]));
  const stack = [];

  function visit(id) {
    color.set(id, GRAY);
    stack.push(id);
    const task = byId.get(id);
    for (const dep of task?.depends_on ?? []) {
      if (!byId.has(dep)) continue; // unknown deps are a schema error, not a cycle
      if (color.get(dep) === GRAY) {
        const cycleStart = stack.indexOf(dep);
        return [...stack.slice(cycleStart), dep];
      }
      if (color.get(dep) === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const task of tasks) {
    if (color.get(task.id) === WHITE) {
      const found = visit(task.id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Detect allowed_paths overlaps between distinct tasks — exact matches, and
 * ancestor/glob containment (e.g. "backend/**" vs "backend/src/main.ts").
 * When two complex globs cannot be proven disjoint, pathsOverlap already
 * errs toward reporting a conflict.
 * @param {any[]} tasks
 * @returns {{a: string, b: string, path: string, pathA: string, pathB: string}[]}
 */
export function findPathConflicts(tasks) {
  const conflicts = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      for (const pathA of a.allowed_paths ?? []) {
        for (const pathB of b.allowed_paths ?? []) {
          if (pathsOverlap(pathA, pathB)) {
            // `path` (= pathA) is kept alongside pathA/pathB for backward
            // compatibility with runner.mjs's report formatting, which is
            // out of scope for this change (see NIGHT-V1-A-R1 section 8).
            conflicts.push({ a: a.id, b: b.id, path: pathA, pathA, pathB });
          }
        }
      }
    }
  }
  return conflicts;
}

/**
 * Select the next task eligible for GREEN, dry-run-safe execution: risk
 * GREEN, status READY, explicitly `enabled: true`, and (for
 * HARD_DEPENDENCY tasks) every dependency already at the canonical
 * terminal-success state PASS. YELLOW/RED tasks are never returned,
 * regardless of status — V1 has no execution path for them at all
 * (YELLOW_EXECUTION_ENABLED = NO).
 * @param {any[]} tasks
 * @returns {any|null}
 */
export function selectNextGreenTask(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    if (task.risk !== 'GREEN') continue;
    if (task.status !== 'READY') continue;
    if (task.enabled !== true) continue;
    if (task.dependency_type === 'HARD_DEPENDENCY') {
      const unmet = (task.depends_on ?? []).some((depId) => byId.get(depId)?.status !== 'PASS');
      if (unmet) continue;
    }
    return task;
  }
  return null;
}

/**
 * Classify a task's executability under V1's policy. GREEN, enabled tasks
 * with met dependencies are EXECUTABLE; everything else (YELLOW, RED,
 * disabled, blocked GREEN) is NOT_EXECUTABLE, with a reason. A
 * HARD_DEPENDENCY is met only when the depended-on task's status is PASS.
 * @param {any} task
 * @param {any[]} allTasks
 * @returns {{executable: boolean, reason: string}}
 */
export function classifyExecutability(task, allTasks) {
  if (task.risk === 'RED') {
    return { executable: false, reason: 'RED operations are never executable by the Night Agent, in any version.' };
  }
  if (task.risk === 'YELLOW') {
    return { executable: false, reason: 'YELLOW_EXECUTION_ENABLED = NO in V1; YELLOW tasks are recorded but not run.' };
  }
  if (task.enabled !== true) {
    return { executable: false, reason: 'task.enabled is not true — explicit per-task gate required for GREEN execution.' };
  }
  if (task.status !== 'READY') {
    return { executable: false, reason: `task status is ${task.status}, not READY.` };
  }
  if (task.dependency_type === 'HARD_DEPENDENCY') {
    const byId = new Map(allTasks.map((t) => [t.id, t]));
    const unmet = (task.depends_on ?? []).filter((depId) => byId.get(depId)?.status !== 'PASS');
    if (unmet.length > 0) {
      return { executable: false, reason: `unmet hard dependencies (require status PASS): ${unmet.join(', ')}` };
    }
  }
  return { executable: true, reason: 'GREEN, enabled, READY, and all dependencies satisfied.' };
}
