// Korixa Night Agent — task queue library.
//
// Pure functions only: no Claude invocation, no file mutation, no network,
// no child_process. Everything here takes a parsed queue object (matching
// .claude/overnight/TASK_QUEUE.example.json's schema) and returns data.
// Safe to unit test directly with node:test.

const VALID_RISKS = new Set(['GREEN', 'YELLOW', 'RED']);
const VALID_DEPENDENCY_TYPES = new Set(['INDEPENDENT', 'HARD_DEPENDENCY', 'SOFT_DEPENDENCY']);
const VALID_STATUSES = new Set(['READY', 'BLOCKED', 'HOLD', 'IN_PROGRESS', 'DONE']);

/**
 * Validate the structural shape of a parsed queue object.
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
    for (const field of ['session_id', 'mode', 'base_sha', 'branch_prefix']) {
      if (typeof queue.session[field] !== 'string' || queue.session[field].length === 0) {
        errors.push(`session.${field} must be a non-empty string`);
      }
    }
    for (const field of ['max_session_minutes', 'max_total_tasks', 'max_consecutive_holds']) {
      if (typeof queue.session[field] !== 'number' || !Number.isFinite(queue.session[field])) {
        errors.push(`session.${field} must be a finite number`);
      }
    }
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
    if (typeof task.id !== 'string' || task.id.length === 0) {
      errors.push(`${where}.id must be a non-empty string`);
    } else if (seenIds.has(task.id)) {
      errors.push(`duplicate task id: "${task.id}"`);
    } else {
      seenIds.add(task.id);
    }
    if (!VALID_RISKS.has(task.risk)) {
      errors.push(`${where}.risk must be one of ${[...VALID_RISKS].join('|')}, got ${JSON.stringify(task.risk)}`);
    }
    if (!VALID_STATUSES.has(task.status)) {
      errors.push(`${where}.status must be one of ${[...VALID_STATUSES].join('|')}, got ${JSON.stringify(task.status)}`);
    }
    if (!VALID_DEPENDENCY_TYPES.has(task.dependency_type)) {
      errors.push(`${where}.dependency_type must be one of ${[...VALID_DEPENDENCY_TYPES].join('|')}, got ${JSON.stringify(task.dependency_type)}`);
    }
    if (!Array.isArray(task.depends_on)) {
      errors.push(`${where}.depends_on must be an array`);
    }
    if (!Array.isArray(task.allowed_paths)) {
      errors.push(`${where}.allowed_paths must be an array`);
    }
    if (!Array.isArray(task.forbidden_paths)) {
      errors.push(`${where}.forbidden_paths must be an array`);
    }
    if (!Array.isArray(task.required_checks)) {
      errors.push(`${where}.required_checks must be an array`);
    }
    if (typeof task.max_retries !== 'number' || task.max_retries < 0) {
      errors.push(`${where}.max_retries must be a non-negative number`);
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
 * Detect overlapping allowed_paths between distinct tasks, which risks two
 * tasks racing to change the same file. Returns pairs of conflicting task
 * ids, or an empty array if no conflicts.
 * @param {any[]} tasks
 * @returns {{a: string, b: string, path: string}[]}
 */
export function findPathConflicts(tasks) {
  const conflicts = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const aPaths = new Set(a.allowed_paths ?? []);
      for (const path of b.allowed_paths ?? []) {
        if (aPaths.has(path)) {
          conflicts.push({ a: a.id, b: b.id, path });
        }
      }
    }
  }
  return conflicts;
}

/**
 * Select the next task eligible for GREEN, dry-run-safe execution: risk
 * GREEN, status READY, and (for HARD_DEPENDENCY tasks) every dependency
 * already DONE. YELLOW/RED tasks are never returned, regardless of status —
 * V1 has no execution path for them at all (YELLOW_EXECUTION_ENABLED = NO).
 * @param {any[]} tasks
 * @returns {any|null}
 */
export function selectNextGreenTask(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    if (task.risk !== 'GREEN') continue;
    if (task.status !== 'READY') continue;
    if (task.dependency_type === 'HARD_DEPENDENCY') {
      const unmet = (task.depends_on ?? []).some((depId) => byId.get(depId)?.status !== 'DONE');
      if (unmet) continue;
    }
    return task;
  }
  return null;
}

/**
 * Classify a task's executability under V1's policy. GREEN tasks with met
 * dependencies are EXECUTABLE; everything else (YELLOW, RED, blocked GREEN)
 * is NOT_EXECUTABLE, with a reason.
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
  if (task.status !== 'READY') {
    return { executable: false, reason: `task status is ${task.status}, not READY.` };
  }
  if (task.dependency_type === 'HARD_DEPENDENCY') {
    const byId = new Map(allTasks.map((t) => [t.id, t]));
    const unmet = (task.depends_on ?? []).filter((depId) => byId.get(depId)?.status !== 'DONE');
    if (unmet.length > 0) {
      return { executable: false, reason: `unmet hard dependencies: ${unmet.join(', ')}` };
    }
  }
  return { executable: true, reason: 'GREEN, READY, and all dependencies satisfied.' };
}
