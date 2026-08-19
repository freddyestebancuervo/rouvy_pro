// Korixa Night Agent — task queue library.
//
// Pure functions only: no Claude invocation, no file mutation, no network,
// no child_process, no filesystem resolution. Everything here takes a
// parsed queue object (matching .claude/overnight/TASK_QUEUE.example.json's
// schema) and returns data. Safe to unit test directly with node:test.

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

/**
 * A path is repo-relative-safe if it cannot escape the repository root and
 * cannot address an absolute filesystem location. This is a pure string
 * check — it never touches the filesystem — used to keep `allowed_paths`/
 * `forbidden_paths` entries from smuggling in a write target outside the
 * repo.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRepoRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\\')) return false; // no Windows separators
  if (value.includes('\0')) return false; // NUL-like
  if (/^[A-Za-z]:/.test(value)) return false; // drive-letter absolute
  if (value.startsWith('/')) return false; // POSIX absolute
  if (value.includes('..')) return false; // any traversal segment, conservatively
  if (value.includes('*')) {
    // Only the recognized glob shapes (see pathScope below) are accepted:
    // the bare global wildcards, or a single trailing "/**"/"/*" segment
    // with no further "*" elsewhere. Anything more complex (e.g.
    // "backend/**/secret/*.json") cannot be proven disjoint from another
    // scope by the conservative exact/prefix/global model in pathsOverlap,
    // so it is rejected here rather than silently risking a false
    // "no conflict" — a queue that needs a glob this complex fails
    // validation instead.
    const isGlobal = value === '*' || value === '**' || value === '**/*';
    const isSimpleTrailingGlob =
      (value.endsWith('/**') && !value.slice(0, -3).includes('*')) ||
      (value.endsWith('/*') && !value.slice(0, -2).includes('*'));
    if (!isGlobal && !isSimpleTrailingGlob) return false;
  }
  return true;
}

/**
 * Reduce a path/glob entry to a comparable scope: an exact leaf path, or a
 * directory prefix (from a trailing `/**`, `/*`, `/`, or bare `*`). Used by
 * pathsOverlap to detect ancestor/glob containment, not just string
 * equality.
 * @param {string} value
 * @returns {{type: 'exact'|'prefix'|'global', value?: string}}
 */
function pathScope(value) {
  // "*", "**", and "**/*" address every repo-relative path — treat them as
  // a distinct GLOBAL scope rather than falling through to the prefix
  // branch below, where they would otherwise reduce to an empty-string
  // prefix that (incorrectly) overlaps nothing.
  if (value === '*' || value === '**' || value === '**/*') return { type: 'global' };
  if (value.endsWith('/**')) return { type: 'prefix', value: value.slice(0, -3) };
  if (value.endsWith('/*')) return { type: 'prefix', value: value.slice(0, -2) };
  if (value.endsWith('/')) return { type: 'prefix', value: value.slice(0, -1) };
  if (value.endsWith('*')) return { type: 'prefix', value: value.slice(0, -1) };
  return { type: 'exact', value };
}

/**
 * Conservatively decide whether two path/glob entries could ever address
 * the same file: exact equality, one being an ancestor directory (via glob
 * or trailing slash) of the other, or either being a GLOBAL wildcard (a
 * bare "*", "**", or "**" + "/*") that by definition overlaps every path. When two
 * complex globs cannot be proven disjoint, this errs toward reporting a
 * conflict — false positive (over-cautious) is acceptable here; false
 * negative is not. Anything more complex than exact/prefix/global (e.g. a
 * mid-string wildcard) is rejected earlier, at schema validation, by
 * isRepoRelativePath — it never reaches this function.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function pathsOverlap(a, b) {
  const sa = pathScope(a);
  const sb = pathScope(b);

  if (sa.type === 'global' || sb.type === 'global') return true;

  if (sa.type === 'exact' && sb.type === 'exact') {
    return sa.value === sb.value;
  }
  if (sa.type === 'prefix' && sb.type === 'prefix') {
    return (
      sa.value === sb.value ||
      sa.value.startsWith(`${sb.value}/`) ||
      sb.value.startsWith(`${sa.value}/`)
    );
  }
  const [exact, prefix] = sa.type === 'exact' ? [sa, sb] : [sb, sa];
  return exact.value === prefix.value || exact.value.startsWith(`${prefix.value}/`);
}

/**
 * Validate the structural shape of a parsed queue object. Strict: every
 * field required by the NIGHT-V1-A-R1 contract is checked, not just the
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

    if (!Array.isArray(task.allowed_paths) || !task.allowed_paths.every((p) => typeof p === 'string')) {
      errors.push(`${where}.allowed_paths must be an array of strings`);
    } else {
      for (const p of task.allowed_paths) {
        if (!isRepoRelativePath(p)) errors.push(`${where}.allowed_paths contains an unsafe path: "${p}"`);
      }
    }
    if (!Array.isArray(task.forbidden_paths) || !task.forbidden_paths.every((p) => typeof p === 'string')) {
      errors.push(`${where}.forbidden_paths must be an array of strings`);
    } else {
      for (const p of task.forbidden_paths) {
        if (!isRepoRelativePath(p)) errors.push(`${where}.forbidden_paths contains an unsafe path: "${p}"`);
      }
    }
    if (
      Array.isArray(task.allowed_paths) &&
      Array.isArray(task.forbidden_paths) &&
      task.allowed_paths.every((p) => typeof p === 'string') &&
      task.forbidden_paths.every((p) => typeof p === 'string')
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
      Array.isArray(task.allowed_paths) &&
      task.allowed_paths.length === 0
    ) {
      errors.push(`${where} ("${task.id}") is GREEN and READY but has an empty allowed_paths — no writable scope`);
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
 * GREEN, status READY, and (for HARD_DEPENDENCY tasks) every dependency
 * already at the canonical terminal-success state PASS. YELLOW/RED tasks
 * are never returned, regardless of status — V1 has no execution path for
 * them at all (YELLOW_EXECUTION_ENABLED = NO).
 * @param {any[]} tasks
 * @returns {any|null}
 */
export function selectNextGreenTask(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    if (task.risk !== 'GREEN') continue;
    if (task.status !== 'READY') continue;
    if (task.dependency_type === 'HARD_DEPENDENCY') {
      const unmet = (task.depends_on ?? []).some((depId) => byId.get(depId)?.status !== 'PASS');
      if (unmet) continue;
    }
    return task;
  }
  return null;
}

/**
 * Classify a task's executability under V1's policy. GREEN tasks with met
 * dependencies are EXECUTABLE; everything else (YELLOW, RED, blocked GREEN)
 * is NOT_EXECUTABLE, with a reason. A HARD_DEPENDENCY is met only when the
 * depended-on task's status is PASS.
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
    const unmet = (task.depends_on ?? []).filter((depId) => byId.get(depId)?.status !== 'PASS');
    if (unmet.length > 0) {
      return { executable: false, reason: `unmet hard dependencies (require status PASS): ${unmet.join(', ')}` };
    }
  }
  return { executable: true, reason: 'GREEN, READY, and all dependencies satisfied.' };
}
