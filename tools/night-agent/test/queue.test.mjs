import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validateSchema,
  findCycle,
  findPathConflicts,
  selectNextGreenTask,
  classifyExecutability,
  isRepoRelativePath,
  pathsOverlap,
  CANONICAL_STATES,
  FIXTURE_BASE_SHA,
} from '../queue.mjs';

const EXAMPLE_QUEUE_PATH = fileURLToPath(
  new URL('../../../.claude/overnight/TASK_QUEUE.example.json', import.meta.url),
);

function loadExampleQueue() {
  return JSON.parse(readFileSync(EXAMPLE_QUEUE_PATH, 'utf8'));
}

function minimalSession(overrides = {}) {
  return {
    session_id: 's',
    mode: 'dry-run',
    base_sha: FIXTURE_BASE_SHA,
    branch_prefix: 'agent/night/x',
    max_session_minutes: 60,
    max_total_tasks: 1,
    max_consecutive_holds: 1,
    ...overrides,
  };
}

function minimalTask(overrides = {}) {
  // NIGHT-V1-B: the default allowed/read path deliberately lives OUTSIDE
  // every critical control-plane prefix (section 12) — "tools/night-agent/
  // test/..." would now itself be rejected as a critical path, since the
  // Night Agent's own code/tests are never a valid autonomous-task target.
  return {
    id: 'task-a',
    title: 't',
    objective: 'o',
    risk: 'GREEN',
    status: 'READY',
    enabled: true,
    dependency_type: 'INDEPENDENT',
    depends_on: [],
    allowed_paths: ['examples/fixture-only.test.mjs'],
    read_paths: ['examples/fixture-only.test.mjs'],
    forbidden_paths: [],
    required_checks: [],
    verification_commands: [],
    max_retries: 1,
    max_turns: 5,
    timeout_seconds: 10,
    on_failure: 'HOLD',
    ...overrides,
  };
}

function minimalQueue(taskOverridesList = [{}]) {
  return {
    schema_version: 1,
    session: minimalSession(),
    tasks: taskOverridesList.map((o) => minimalTask(o)),
  };
}

// ---------------------------------------------------------------------------
// The repo's own fixture must validate cleanly under the hardened schema —
// also a regression guard against accidentally corrupting the example file.
// ---------------------------------------------------------------------------

test('the committed TASK_QUEUE.example.json is schema-valid under the hardened R1 schema', () => {
  const queue = loadExampleQueue();
  const result = validateSchema(queue);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('the committed TASK_QUEUE.example.json has no dependency cycle', () => {
  const queue = loadExampleQueue();
  assert.equal(findCycle(queue.tasks), null);
});

test('the committed TASK_QUEUE.example.json has no allowed_paths conflicts across distinct example tasks', () => {
  const queue = loadExampleQueue();
  assert.deepEqual(findPathConflicts(queue.tasks), []);
});

test('the committed TASK_QUEUE.example.json selects task-green-independent-001 as the next GREEN task', () => {
  const queue = loadExampleQueue();
  const next = selectNextGreenTask(queue.tasks);
  assert.equal(next?.id, 'task-green-independent-001');
});

test('the committed TASK_QUEUE.example.json never uses DONE or IN_PROGRESS as a task status', () => {
  const queue = loadExampleQueue();
  for (const task of queue.tasks) {
    assert.notEqual(task.status, 'DONE');
    assert.notEqual(task.status, 'IN_PROGRESS');
    assert.ok(CANONICAL_STATES.includes(task.status));
  }
});

test('YELLOW and RED example tasks are never returned as the next GREEN task, regardless of status', () => {
  const queue = loadExampleQueue();
  const forced = queue.tasks.map((t) => ({ ...t, status: 'READY' }));
  const next = selectNextGreenTask(forced);
  assert.notEqual(next?.risk, 'YELLOW');
  assert.notEqual(next?.risk, 'RED');
});

// ---------------------------------------------------------------------------
// CANONICAL_STATES / state-machine reconciliation (section 7/22)
// ---------------------------------------------------------------------------

test('CANONICAL_STATES is exactly the R1-unified set, no DONE, no IN_PROGRESS', () => {
  assert.deepEqual(CANONICAL_STATES, ['READY', 'RUNNING', 'PASS', 'RETRY', 'HOLD', 'BLOCKED', 'SKIPPED', 'SESSION_HALT']);
});

test('validateSchema rejects a task with the retired status DONE', () => {
  const queue = minimalQueue([{ status: 'DONE' }]);
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects a task with the retired status IN_PROGRESS', () => {
  const queue = minimalQueue([{ status: 'IN_PROGRESS' }]);
  assert.equal(validateSchema(queue).valid, false);
});

// ---------------------------------------------------------------------------
// HARD_DEPENDENCY success state = PASS (section 7/22/31)
// ---------------------------------------------------------------------------

test('selectNextGreenTask requires the dependency status to be exactly PASS, not any other terminal-looking state', () => {
  // "a" is deliberately not independently selectable here (RED) so any
  // selection result can only have come from "b" incorrectly treating a
  // non-PASS dependency status as satisfied.
  for (const depStatus of ['HOLD', 'BLOCKED', 'RETRY', 'RUNNING', 'SKIPPED', 'READY']) {
    const tasks = [
      minimalTask({ id: 'a', risk: 'RED', status: depStatus, dependency_type: 'INDEPENDENT', allowed_paths: [] }),
      minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'], status: 'READY', allowed_paths: ['tools/night-agent/test/fixture-only-b.test.mjs'] }),
    ];
    assert.equal(selectNextGreenTask(tasks), null, `dependency status ${depStatus} must not satisfy HARD_DEPENDENCY`);
  }
});

test('selectNextGreenTask returns a HARD_DEPENDENCY task once its dependency reaches PASS', () => {
  const tasks = [
    minimalTask({ id: 'a', status: 'PASS' }),
    minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'], status: 'READY', allowed_paths: ['tools/night-agent/test/fixture-only-b.test.mjs'] }),
  ];
  assert.equal(selectNextGreenTask(tasks)?.id, 'b');
});

test('classifyExecutability requires PASS (not DONE-like states) to satisfy a HARD_DEPENDENCY', () => {
  const dep = minimalTask({ id: 'a', status: 'HOLD' });
  const task = minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'] });
  const result = classifyExecutability(task, [dep, task]);
  assert.equal(result.executable, false);
  assert.match(result.reason, /PASS/);
});

// ---------------------------------------------------------------------------
// ADVANCE_LATERAL regression (section 31): independent work proceeds
// around a HOLD; dependent work correctly blocks.
// ---------------------------------------------------------------------------

test('advance-lateral: an independent READY GREEN task remains selectable while an unrelated task is HOLD', () => {
  const tasks = [
    minimalTask({ id: 'a', status: 'HOLD' }),
    minimalTask({ id: 'b', status: 'READY', dependency_type: 'INDEPENDENT', allowed_paths: ['tools/night-agent/test/fixture-only-b.test.mjs'] }),
  ];
  assert.equal(selectNextGreenTask(tasks)?.id, 'b');
});

test('advance-lateral: a task HARD-dependent on a HOLD task is not executable', () => {
  const tasks = [
    minimalTask({ id: 'a', status: 'HOLD' }),
    minimalTask({ id: 'c', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'], status: 'READY', allowed_paths: ['tools/night-agent/test/fixture-only-c.test.mjs'] }),
  ];
  const c = tasks[1];
  assert.equal(classifyExecutability(c, tasks).executable, false);
});

// ---------------------------------------------------------------------------
// validateSchema — required fields (section 23)
// ---------------------------------------------------------------------------

test('validateSchema rejects a non-object', () => {
  assert.equal(validateSchema(null).valid, false);
  assert.equal(validateSchema('nope').valid, false);
});

test('validateSchema rejects wrong schema_version', () => {
  const result = validateSchema({ schema_version: 2, session: minimalSession(), tasks: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('schema_version')));
});

test('validateSchema rejects an empty id/title/objective', () => {
  assert.equal(validateSchema(minimalQueue([{ id: '' }])).valid, false);
  assert.equal(validateSchema(minimalQueue([{ title: '' }])).valid, false);
  assert.equal(validateSchema(minimalQueue([{ objective: '' }])).valid, false);
});

test('validateSchema rejects duplicate task ids', () => {
  const queue = minimalQueue([{ id: 'dup' }, { id: 'dup' }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate task id')));
});

test('validateSchema rejects a depends_on referencing an unknown task id', () => {
  const queue = minimalQueue([{ dependency_type: 'HARD_DEPENDENCY', depends_on: ['ghost'] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('unknown task id')));
});

test('validateSchema rejects an invalid risk value', () => {
  assert.equal(validateSchema(minimalQueue([{ risk: 'BLUE' }])).valid, false);
});

test('validateSchema rejects an invalid on_failure value', () => {
  assert.equal(validateSchema(minimalQueue([{ on_failure: 'IGNORE' }])).valid, false);
});

test('validateSchema accepts every valid on_failure value', () => {
  for (const on_failure of ['RETRY_THEN_HOLD', 'HOLD', 'SESSION_HALT']) {
    assert.equal(validateSchema(minimalQueue([{ on_failure }])).valid, true, on_failure);
  }
});

test('validateSchema rejects required_checks containing an empty string', () => {
  assert.equal(validateSchema(minimalQueue([{ required_checks: [''] }])).valid, false);
});

// ---------------------------------------------------------------------------
// max_retries ceiling (section 30)
// ---------------------------------------------------------------------------

test('validateSchema accepts max_retries 0 through 3', () => {
  for (const max_retries of [0, 1, 2, 3]) {
    assert.equal(validateSchema(minimalQueue([{ max_retries }])).valid, true, String(max_retries));
  }
});

test('validateSchema rejects max_retries above the ceiling of 3, without silently clamping it', () => {
  const result = validateSchema(minimalQueue([{ max_retries: 4 }]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('max_retries')));
});

test('validateSchema rejects a negative max_retries', () => {
  assert.equal(validateSchema(minimalQueue([{ max_retries: -1 }])).valid, false);
});

test('validateSchema rejects a non-integer max_retries', () => {
  assert.equal(validateSchema(minimalQueue([{ max_retries: 1.5 }])).valid, false);
});

// ---------------------------------------------------------------------------
// timeout_seconds
// ---------------------------------------------------------------------------

test('validateSchema rejects a zero or negative timeout_seconds', () => {
  assert.equal(validateSchema(minimalQueue([{ timeout_seconds: 0 }])).valid, false);
  assert.equal(validateSchema(minimalQueue([{ timeout_seconds: -5 }])).valid, false);
});

// ---------------------------------------------------------------------------
// Session schema hardening (section 24)
// ---------------------------------------------------------------------------

test('validateSchema accepts the documented fixture base_sha sentinel', () => {
  const queue = minimalQueue();
  queue.session.base_sha = FIXTURE_BASE_SHA;
  assert.equal(validateSchema(queue).valid, true);
});

test('validateSchema accepts a real 40-hex base_sha', () => {
  const queue = minimalQueue();
  queue.session.base_sha = '6fd5ff023d767079d7a5a0e724161190971dab71';
  assert.equal(validateSchema(queue).valid, true);
});

test('validateSchema rejects a base_sha that is neither real hex nor the fixture sentinel', () => {
  const queue = minimalQueue();
  queue.session.base_sha = 'not-a-real-sha';
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects an unrecognized session.mode', () => {
  const queue = minimalQueue();
  queue.session.mode = 'autonomous';
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects max_session_minutes above the V1 ceiling of 480', () => {
  const queue = minimalQueue();
  queue.session.max_session_minutes = 481;
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema accepts max_session_minutes exactly at the V1 ceiling of 480', () => {
  const queue = minimalQueue();
  queue.session.max_session_minutes = 480;
  assert.equal(validateSchema(queue).valid, true);
});

test('validateSchema rejects NaN/Infinity/negative/zero/float session budget fields', () => {
  const badValues = [NaN, Infinity, -Infinity, -1, 0, 1.5];
  for (const bad of badValues) {
    const queue = minimalQueue();
    queue.session.max_session_minutes = bad;
    assert.equal(validateSchema(queue).valid, false, `max_session_minutes=${bad}`);

    const queue2 = minimalQueue();
    queue2.session.max_total_tasks = bad;
    assert.equal(validateSchema(queue2).valid, false, `max_total_tasks=${bad}`);

    const queue3 = minimalQueue();
    queue3.session.max_consecutive_holds = bad;
    assert.equal(validateSchema(queue3).valid, false, `max_consecutive_holds=${bad}`);
  }
});

// ---------------------------------------------------------------------------
// Path traversal / safety (section 26)
// ---------------------------------------------------------------------------

test('isRepoRelativePath accepts an ordinary relative path', () => {
  assert.equal(isRepoRelativePath('tools/night-agent/queue.mjs'), true);
});

test('isRepoRelativePath rejects a Windows absolute path', () => {
  assert.equal(isRepoRelativePath('C:\\Users\\foo\\bar.txt'), false);
});

test('isRepoRelativePath rejects a POSIX absolute path', () => {
  assert.equal(isRepoRelativePath('/etc/passwd'), false);
});

test('isRepoRelativePath rejects parent traversal', () => {
  assert.equal(isRepoRelativePath('../../etc/passwd'), false);
  assert.equal(isRepoRelativePath('tools/../../../etc/passwd'), false);
});

test('isRepoRelativePath rejects an empty string', () => {
  assert.equal(isRepoRelativePath(''), false);
});

test('isRepoRelativePath rejects a NUL byte', () => {
  assert.equal(isRepoRelativePath('foo\0bar'), false);
});

// ---------------------------------------------------------------------------
// R4 path canonicalization (independent audit finding B/C, sections 15-20,
// 22): reject every non-canonical alias for the same scope rather than
// silently normalizing it — a future controlled writer must never see a
// different (unvalidated) spelling than the one policy was checked
// against. Trailing slash ("backend/") is the one deliberate exception,
// kept because TASK_QUEUE.example.json (outside R4's file scope) already
// relies on it in forbidden_paths — see SAFETY.md.
// ---------------------------------------------------------------------------

test('isRepoRelativePath rejects a leading "./" alias', () => {
  assert.equal(isRepoRelativePath('./backend'), false);
});

test('isRepoRelativePath rejects a double-slash alias', () => {
  assert.equal(isRepoRelativePath('backend//src'), false);
});

test('isRepoRelativePath rejects a "/./ " dot-segment alias', () => {
  assert.equal(isRepoRelativePath('backend/./src'), false);
});

test('isRepoRelativePath rejects a "/../ " traversal alias mid-path', () => {
  assert.equal(isRepoRelativePath('backend/../src'), false);
});

// NIGHT-V1-B SECURITY TIGHTENING (section 7): R4 kept a deliberate
// trailing-slash exception because TASK_QUEUE.example.json depended on it
// and migrating the fixture was out of R4's scope. B's own scope
// explicitly authorizes — and requires — migrating that fixture (now using
// "backend/**" instead of "backend/"), so the exception is retired
// entirely: exactly one canonical form per scope, no exceptions. Renamed
// rather than deleted, per section 39/11's "no borrar tests" policy.
test('isRepoRelativePath rejects trailing slash — the R4 exception is retired now that the fixture no longer needs it', () => {
  assert.equal(isRepoRelativePath('backend/'), false);
});

test('isRepoRelativePath rejects a Windows backslash separator', () => {
  assert.equal(isRepoRelativePath('backend\\src'), false);
});

test('isRepoRelativePath rejects leading whitespace', () => {
  assert.equal(isRepoRelativePath(' backend'), false);
});

test('isRepoRelativePath rejects trailing whitespace', () => {
  assert.equal(isRepoRelativePath('backend '), false);
});

test('isRepoRelativePath rejects a trailing dot in a segment (Windows alias risk)', () => {
  assert.equal(isRepoRelativePath('backend.'), false);
});

test('isRepoRelativePath rejects a colon anywhere (Windows drive-letter/ADS alias risk)', () => {
  assert.equal(isRepoRelativePath('backend:stream'), false);
});

test('isRepoRelativePath rejects an ASCII control character', () => {
  assert.equal(isRepoRelativePath('backend\x01src'), false);
});

test('isRepoRelativePath rejects the exact strings "." and ".."', () => {
  assert.equal(isRepoRelativePath('.'), false);
  assert.equal(isRepoRelativePath('..'), false);
});

// Deterministic matrix form (section 20), each row independently named.
const PATH_CANONICALIZATION_MATRIX = [
  { path: './backend', expected: false },
  { path: 'backend//src', expected: false },
  { path: 'backend/./src', expected: false },
  { path: 'backend/../src', expected: false },
  { path: 'backend\\src', expected: false },
  { path: 'backend ', expected: false },
  { path: 'backend.', expected: false },
  { path: 'backend', expected: true },
  { path: 'backend/src/main.ts', expected: true },
  { path: '.claude/settings.json', expected: true },
  { path: 'tools/night-agent/**', expected: true },
  { path: 'tools/night-agent/*', expected: true },
  { path: '*', expected: true },
  { path: '**', expected: true },
  { path: '**/*', expected: true },
];
for (const { path, expected } of PATH_CANONICALIZATION_MATRIX) {
  test(`isRepoRelativePath(${JSON.stringify(path)}) === ${expected}`, () => {
    assert.equal(isRepoRelativePath(path), expected);
  });
}

test('validateSchema rejects a non-canonical "./backend" allowed_paths entry', () => {
  const queue = minimalQueue([{ allowed_paths: ['./backend'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects a non-canonical "backend//src" allowed_paths entry', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend//src'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects a non-canonical "backend/./src" allowed_paths entry', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend/./src'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

// ---------------------------------------------------------------------------
// R4 Windows case-folding (independent audit finding C, sections 18, 21,
// 23): the project runs on Windows, a case-insensitive filesystem — two
// scopes differing only in case must be treated as potentially the same
// path for conflict detection. False positive across platforms is
// acceptable; a false negative on Windows is not.
// ---------------------------------------------------------------------------

test('pathsOverlap: differing case is treated as a potential conflict (Windows case-insensitivity)', () => {
  assert.equal(pathsOverlap('Backend', 'backend/src/main.ts'), true);
});

test('pathsOverlap: differing case with an uppercase ancestor segment', () => {
  assert.equal(pathsOverlap('TOOLS/NIGHT-AGENT', 'tools/night-agent/x.mjs'), true);
});

test('pathsOverlap: differing case combined with a glob prefix', () => {
  assert.equal(pathsOverlap('backend/**', 'BACKEND/src/main.ts'), true);
});

test('pathsOverlap: case-folding does not create a false conflict between genuinely distinct names', () => {
  assert.equal(pathsOverlap('backend', 'backend2/src/main.ts'), false);
  assert.equal(pathsOverlap('foo.js', 'foo.js.map'), false);
});

test('findPathConflicts detects a cross-task Windows case alias conflict', () => {
  const tasks = [
    minimalTask({ id: 'a', allowed_paths: ['Backend'] }),
    minimalTask({ id: 'b', allowed_paths: ['backend/src/main.ts'] }),
  ];
  const conflicts = findPathConflicts(tasks);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a, 'a');
  assert.equal(conflicts[0].b, 'b');
  // Original casing is preserved in the report — case-folding is internal
  // to the comparison only, never applied to what gets reported.
  assert.equal(conflicts[0].pathA, 'Backend');
  assert.equal(conflicts[0].pathB, 'backend/src/main.ts');
});

test('validateSchema rejects an unsafe allowed_paths entry', () => {
  const queue = minimalQueue([{ allowed_paths: ['/etc/passwd'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects an unsafe forbidden_paths entry', () => {
  const queue = minimalQueue([{ forbidden_paths: ['../../secret'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

// ---------------------------------------------------------------------------
// Path conflict detection — ancestor/glob containment (section 27)
// ---------------------------------------------------------------------------

test('pathsOverlap: exact equality conflicts', () => {
  assert.equal(pathsOverlap('foo/bar.js', 'foo/bar.js'), true);
});

test('pathsOverlap: distinct exact paths do not conflict', () => {
  assert.equal(pathsOverlap('foo/bar.js', 'foo/baz.js'), false);
});

test('pathsOverlap: a glob prefix conflicts with a file underneath it', () => {
  assert.equal(pathsOverlap('backend/**', 'backend/src/main.ts'), true);
});

test('pathsOverlap: two overlapping glob prefixes conflict', () => {
  assert.equal(pathsOverlap('tools/night-agent/**', 'tools/night-agent/test/**'), true);
});

// NIGHT-V1-B SECURITY TIGHTENING (section 7): "foo/" is no longer a
// canonical scope at all (isRepoRelativePath now rejects every trailing
// slash unconditionally) — pathsOverlap's trailing-slash prefix branch was
// removed accordingly, so a bare "foo/" is now just an opaque exact string
// to this function. Rewritten to use the canonical directory-prefix form
// ("foo/**") instead, which is what any real queue entry must use.
test('pathsOverlap: a canonical glob-prefix directory conflicts with a file underneath it', () => {
  assert.equal(pathsOverlap('foo/**', 'foo/bar.js'), true);
});

test('pathsOverlap: sibling directories with a shared string prefix do not conflict', () => {
  assert.equal(pathsOverlap('foo/**', 'foobar/baz.js'), false);
});

// ---------------------------------------------------------------------------
// R3 bare-directory ancestor overlap (independent audit finding A, sections
// 6-9): two EXACT-looking scopes ("backend" and "backend/src/main.ts") were
// never checked for the ancestor relationship in R1/R2 — only the
// prefix/prefix and exact/prefix branches were. pathsOverlap('backend',
// 'backend/src/main.ts') incorrectly returned false. Fixed by giving the
// exact/exact branch the same segment-boundary ancestor check as the other
// branches (see pathsOverlap in queue.mjs).
// ---------------------------------------------------------------------------

test("pathsOverlap: bare directory 'backend' overlaps a file underneath it (the core R3 finding)", () => {
  assert.equal(pathsOverlap('backend', 'backend/src/main.ts'), true);
});

test("pathsOverlap: bare directory 'tools/night-agent' overlaps a nested test file", () => {
  assert.equal(pathsOverlap('tools/night-agent', 'tools/night-agent/test/x.test.mjs'), true);
});

test('pathsOverlap: single-segment bare directory overlaps its child', () => {
  assert.equal(pathsOverlap('a', 'a/b'), true);
});

test('pathsOverlap: the ancestor check is symmetric (order does not matter)', () => {
  assert.equal(pathsOverlap('a/b', 'a'), true);
});

test('pathsOverlap: a bare directory and its "/**" glob form overlap each other (already true, reconfirmed)', () => {
  assert.equal(pathsOverlap('backend/**', 'backend'), true);
  assert.equal(pathsOverlap('backend', 'backend/**'), true);
});

test('pathsOverlap: bare-directory ancestor check respects the "/" segment boundary — no false positive from a shared string prefix', () => {
  assert.equal(pathsOverlap('backend', 'backend2/file.ts'), false);
  assert.equal(pathsOverlap('foo.js', 'foo.js.map'), false);
});

// Deterministic matrix form of the same requirement (section 29), each row
// independently named for audit traceability.
const BARE_DIRECTORY_ANCESTOR_MATRIX = [
  { a: 'backend', b: 'backend/src/main.ts', expected: true },
  { a: 'backend', b: 'backend/test/x.ts', expected: true },
  { a: 'tools', b: 'tools/night-agent/x.mjs', expected: true },
  { a: 'a', b: 'a/b', expected: true },
  { a: 'a/b', b: 'a', expected: true },
  { a: 'foo', b: 'foobar/x', expected: false },
  { a: 'foo.js', b: 'foo.js.map', expected: false },
];
for (const { a, b, expected } of BARE_DIRECTORY_ANCESTOR_MATRIX) {
  test(`pathsOverlap('${a}', '${b}') === ${expected}`, () => {
    assert.equal(pathsOverlap(a, b), expected);
  });
}

test('findPathConflicts detects a bare-directory vs nested-file conflict across distinct tasks (section 9 cross-task requirement)', () => {
  const tasks = [
    minimalTask({ id: 'a', allowed_paths: ['backend'] }),
    minimalTask({ id: 'b', allowed_paths: ['backend/src/main.ts'] }),
  ];
  const conflicts = findPathConflicts(tasks);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a, 'a');
  assert.equal(conflicts[0].b, 'b');
});

test('validateSchema rejects a task whose bare-directory allowed_paths overlaps its own forbidden_paths (section 9 self-conflict requirement)', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend'], forbidden_paths: ['backend/secrets/key.json'] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('overlaps its own forbidden_paths')));
});

test('validateSchema rejects the same bare-directory self-conflict in reverse order (forbidden ancestor of allowed)', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend/secrets/key.json'], forbidden_paths: ['backend'] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
});

test('findPathConflicts detects ancestor/glob containment across distinct tasks', () => {
  const tasks = [
    minimalTask({ id: 'a', allowed_paths: ['backend/**'] }),
    minimalTask({ id: 'b', allowed_paths: ['backend/src/main.ts'] }),
  ];
  const conflicts = findPathConflicts(tasks);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a, 'a');
  assert.equal(conflicts[0].b, 'b');
});

test('findPathConflicts is empty for genuinely disjoint scopes', () => {
  const tasks = [
    minimalTask({ id: 'a', allowed_paths: ['backend/src/**'] }),
    minimalTask({ id: 'b', allowed_paths: ['tools/night-agent/**'] }),
  ];
  assert.deepEqual(findPathConflicts(tasks), []);
});

// ---------------------------------------------------------------------------
// R2 global wildcard semantics (section 13-15, 29-30): "*", "**", and
// "**/*" overlap every repo-relative path — independently confirmed audit
// finding that pathsOverlap('*', 'foo.js') was incorrectly false in R1.
// ---------------------------------------------------------------------------

test("pathsOverlap: a bare '*' overlaps any exact path", () => {
  assert.equal(pathsOverlap('*', 'foo.js'), true);
});

test("pathsOverlap: '**' overlaps any exact path", () => {
  assert.equal(pathsOverlap('**', 'foo.js'), true);
});

test("pathsOverlap: '**/*' overlaps any exact path", () => {
  assert.equal(pathsOverlap('**/*', 'foo.js'), true);
});

test("pathsOverlap: a bare '*' overlaps a nested exact path", () => {
  assert.equal(pathsOverlap('*', 'backend/src/a.ts'), true);
});

test("pathsOverlap: a global wildcard on either side overlaps a prefix scope", () => {
  assert.equal(pathsOverlap('backend/**', '*'), true);
});

test("pathsOverlap: two global wildcards overlap each other", () => {
  assert.equal(pathsOverlap('*', '**'), true);
});

test('pathsOverlap: two genuinely disjoint prefix scopes remain non-overlapping (global fix does not make everything conflict)', () => {
  assert.equal(pathsOverlap('backend/**', 'frontend/**'), false);
});

// ---------------------------------------------------------------------------
// R2 complex-glob fail-closed (section 30): a glob shape beyond
// exact/prefix/global (e.g. a mid-string wildcard) must be rejected at
// schema validation rather than silently treated as a literal exact path
// that could produce a false "no conflict".
// ---------------------------------------------------------------------------

test('isRepoRelativePath rejects a complex mid-string glob it cannot prove disjoint from another scope', () => {
  assert.equal(isRepoRelativePath('backend/**/secret/*.json'), false);
});

test('isRepoRelativePath accepts the recognized simple glob shapes', () => {
  assert.equal(isRepoRelativePath('backend/**'), true);
  assert.equal(isRepoRelativePath('backend/*'), true);
  assert.equal(isRepoRelativePath('*'), true);
  assert.equal(isRepoRelativePath('**'), true);
  assert.equal(isRepoRelativePath('**/*'), true);
});

test('validateSchema rejects an allowed_paths entry using an unrecognized complex glob', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend/**/secret/*.json'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

// ---------------------------------------------------------------------------
// allowed_paths / forbidden_paths self-conflict within one task (section 28)
// ---------------------------------------------------------------------------

test('validateSchema rejects a task whose allowed_paths overlaps its own forbidden_paths', () => {
  const queue = minimalQueue([
    { allowed_paths: ['backend/**'], forbidden_paths: ['backend/secrets/**'] },
  ]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('overlaps its own forbidden_paths')));
});

test('validateSchema accepts disjoint allowed_paths and forbidden_paths on the same task', () => {
  const queue = minimalQueue([
    { allowed_paths: ['backend/src/**'], forbidden_paths: ['backend/secrets/**'] },
  ]);
  assert.equal(validateSchema(queue).valid, true);
});

// R2 section 16: a global wildcard in forbidden_paths overlaps every
// allowed_paths entry, no matter how narrow — these must all fail
// validation, not just the literal-equality case from R1.
test('validateSchema rejects allowed_paths=["foo.js"] vs forbidden_paths=["*"]', () => {
  const queue = minimalQueue([{ allowed_paths: ['foo.js'], forbidden_paths: ['*'] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('overlaps its own forbidden_paths')));
});

test('validateSchema rejects allowed_paths=["backend/src/main.ts"] vs forbidden_paths=["**"]', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend/src/main.ts'], forbidden_paths: ['**'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema rejects allowed_paths=["backend/**"] vs forbidden_paths=["**/*"]', () => {
  const queue = minimalQueue([{ allowed_paths: ['backend/**'], forbidden_paths: ['**/*'] }]);
  assert.equal(validateSchema(queue).valid, false);
});

// ---------------------------------------------------------------------------
// Executable GREEN must have a writable scope (section 25)
// ---------------------------------------------------------------------------

test('validateSchema rejects a GREEN + READY task with empty allowed_paths', () => {
  const queue = minimalQueue([{ risk: 'GREEN', status: 'READY', allowed_paths: [] }]);
  assert.equal(validateSchema(queue).valid, false);
});

test('validateSchema accepts an empty allowed_paths on a non-READY GREEN task', () => {
  const queue = minimalQueue([{ risk: 'GREEN', status: 'BLOCKED', allowed_paths: [], dependency_type: 'HARD_DEPENDENCY', depends_on: ['ghost-but-unchecked-here'] }]);
  // Not asserting overall validity here (the unknown dependency is a
  // separate, expected error) — only that empty allowed_paths itself is
  // not flagged for a non-READY task.
  const result = validateSchema(queue);
  assert.ok(!result.errors.some((e) => e.includes('no writable scope')));
});

test('validateSchema accepts an empty allowed_paths on a YELLOW/RED fixture task', () => {
  const queue = minimalQueue([{ risk: 'YELLOW', status: 'HOLD', allowed_paths: [] }]);
  assert.equal(validateSchema(queue).valid, true);
  const queueRed = minimalQueue([{ risk: 'RED', status: 'HOLD', allowed_paths: [] }]);
  assert.equal(validateSchema(queueRed).valid, true);
});

// ---------------------------------------------------------------------------
// Dependency validation (section 29)
// ---------------------------------------------------------------------------

test('validateSchema rejects a task that depends on itself', () => {
  const queue = minimalQueue([{ id: 'a', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('depends_on itself')));
});

test('validateSchema rejects a duplicate entry within one task\'s depends_on', () => {
  const queue = {
    schema_version: 1,
    session: minimalSession(),
    tasks: [
      minimalTask({ id: 'a', dependency_type: 'INDEPENDENT', depends_on: [] }),
      minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a', 'a'], allowed_paths: ['tools/night-agent/test/fixture-only-b.test.mjs'] }),
    ],
  };
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate entry')));
});

test('validateSchema rejects INDEPENDENT with a non-empty depends_on', () => {
  const queue = minimalQueue([{ dependency_type: 'INDEPENDENT', depends_on: ['ghost'] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('INDEPENDENT')));
});

test('validateSchema rejects HARD_DEPENDENCY with an empty depends_on', () => {
  const queue = minimalQueue([{ dependency_type: 'HARD_DEPENDENCY', depends_on: [] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('HARD_DEPENDENCY')));
});

test('validateSchema rejects SOFT_DEPENDENCY with an empty depends_on', () => {
  const queue = minimalQueue([{ dependency_type: 'SOFT_DEPENDENCY', depends_on: [] }]);
  const result = validateSchema(queue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('SOFT_DEPENDENCY')));
});

// ---------------------------------------------------------------------------
// findCycle
// ---------------------------------------------------------------------------

test('findCycle returns null for an acyclic dependency graph', () => {
  const tasks = [
    minimalTask({ id: 'a', dependency_type: 'INDEPENDENT', depends_on: [] }),
    minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'] }),
    minimalTask({ id: 'c', dependency_type: 'HARD_DEPENDENCY', depends_on: ['b'] }),
  ];
  assert.equal(findCycle(tasks), null);
});

test('findCycle detects a direct two-node cycle', () => {
  const tasks = [
    minimalTask({ id: 'a', dependency_type: 'HARD_DEPENDENCY', depends_on: ['b'] }),
    minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'] }),
  ];
  const cycle = findCycle(tasks);
  assert.ok(cycle);
  assert.ok(cycle.includes('a'));
  assert.ok(cycle.includes('b'));
});

test('findCycle detects a longer indirect cycle', () => {
  const tasks = [
    minimalTask({ id: 'a', dependency_type: 'HARD_DEPENDENCY', depends_on: ['b'] }),
    minimalTask({ id: 'b', dependency_type: 'HARD_DEPENDENCY', depends_on: ['c'] }),
    minimalTask({ id: 'c', dependency_type: 'HARD_DEPENDENCY', depends_on: ['a'] }),
  ];
  assert.ok(findCycle(tasks));
});

// ---------------------------------------------------------------------------
// classifyExecutability
// ---------------------------------------------------------------------------

test('classifyExecutability marks RED as never executable regardless of status', () => {
  const task = minimalTask({ risk: 'RED', status: 'READY' });
  assert.equal(classifyExecutability(task, [task]).executable, false);
});

test('classifyExecutability marks YELLOW as not executable in V1 regardless of status', () => {
  const task = minimalTask({ risk: 'YELLOW', status: 'READY' });
  assert.equal(classifyExecutability(task, [task]).executable, false);
});

test('classifyExecutability marks a READY, dependency-free GREEN task as executable', () => {
  const task = minimalTask({ risk: 'GREEN', status: 'READY' });
  assert.equal(classifyExecutability(task, [task]).executable, true);
});
