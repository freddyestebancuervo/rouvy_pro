// Korixa — STRUCTURAL_JOB_EXECUTION_MODEL_GATE (T-F1.2 Point 5H).
//
// WHY THIS EXISTS: the first authorized real Production DB read-only
// inspection dispatch (production-db-readonly-inspection.yml) was rejected
// by GitHub with HTTP 422 *before creating a workflow run* — two jobs
// (`prepare-inspection-inputs`, `verify-build-output`) declared `steps:`
// without the `runs-on:` GitHub Actions requires for that execution model.
// Every check this project ran before dispatch — generic YAML syntax
// parsing (js-yaml), Role B's adversarial audit, Role C's certification,
// and CI itself — validated that the file was well-formed YAML and safe by
// construction, but none of them checked GitHub Actions' own job-level
// execution-model rules. Real dispatch caught what static analysis missed
// (the same class of gap this program has hit before with real Production
// dogfooding). This module closes exactly that gap, and no more.
//
// SCOPE, HONESTLY STATED: this is NOT a full GitHub Actions schema
// validator (no actionlint, no JSON-Schema-against-the-official-workflow-
// schema). It validates exactly one invariant: a job using the STEP_JOB
// execution model (has `steps:`) must declare `runs-on:`; a job using the
// REUSABLE_WORKFLOW_CALL_JOB execution model (top-level `uses:`, no
// `steps:`) must NOT be required to have `runs-on:` — and must not
// ambiguously declare both models at once. Nothing else about workflow
// correctness is checked here.
//
// NO NEW DEPENDENCY: tools/night-agent has no npm dependencies (Node
// built-ins only — see its own README). A full YAML parser is not needed
// for this narrow, well-defined question, so this module is a small,
// deterministic, indentation-aware line scanner instead of a generic YAML
// parser. It intentionally only recognizes the two-space indentation
// convention this repository's own workflow files already use
// consistently (`jobs:` at column 0, job names at column 2, job-level keys
// at column 4) — it is not a general-purpose YAML tool.

/**
 * @param {string} content raw workflow file text
 * @returns {Array<{jobName: string, hasSteps: boolean, hasRunsOn: boolean, hasTopLevelUses: boolean}>}
 */
export function extractJobFacts(content) {
  const lines = content.split(/\r\n|\n/);

  const jobsIndex = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsIndex === -1) return [];

  const jobHeaderPattern = /^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/;
  const jobBodyKeyPattern = /^ {4}(steps|runs-on|uses):/;

  const jobs = [];
  let current = null;

  for (let i = jobsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;

    const headerMatch = line.match(jobHeaderPattern);
    if (headerMatch) {
      current = { jobName: headerMatch[1], hasSteps: false, hasRunsOn: false, hasTopLevelUses: false };
      jobs.push(current);
      continue;
    }

    // A line at indentation 0 or 2 that is NOT a job header means the
    // `jobs:` section has ended (e.g. no such key exists today in this
    // repo's workflows, since `jobs:` is always last, but fail safe rather
    // than mis-scope a later top-level section as job bodies).
    const indentMatch = line.match(/^( *)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    if (indent <= 2 && !headerMatch) {
      current = null;
      continue;
    }

    if (!current) continue;

    const bodyMatch = line.match(jobBodyKeyPattern);
    if (bodyMatch) {
      if (bodyMatch[1] === 'steps') current.hasSteps = true;
      if (bodyMatch[1] === 'runs-on') current.hasRunsOn = true;
      if (bodyMatch[1] === 'uses') current.hasTopLevelUses = true;
    }
  }

  return jobs;
}

/**
 * @param {{jobName: string, hasSteps: boolean, hasRunsOn: boolean, hasTopLevelUses: boolean}} facts
 * @returns {'STEP_JOB' | 'REUSABLE_WORKFLOW_CALL_JOB' | 'AMBIGUOUS' | 'UNKNOWN'}
 */
export function classifyJobExecutionModel(facts) {
  if (facts.hasSteps && facts.hasTopLevelUses) return 'AMBIGUOUS';
  if (facts.hasSteps) return 'STEP_JOB';
  if (facts.hasTopLevelUses) return 'REUSABLE_WORKFLOW_CALL_JOB';
  return 'UNKNOWN';
}

/**
 * Validates the one invariant this gate exists for. Never mutates, never
 * reads outside the given content.
 * @param {string} content raw workflow file text
 * @returns {{ valid: boolean, jobs: Array<{jobName: string, model: string}>, violations: Array<{jobName: string, reason: string}> }}
 */
export function validateJobExecutionModel(content) {
  const facts = extractJobFacts(content);
  const violations = [];
  const jobs = [];

  for (const f of facts) {
    const model = classifyJobExecutionModel(f);
    jobs.push({ jobName: f.jobName, model });

    if (model === 'STEP_JOB' && !f.hasRunsOn) {
      violations.push({ jobName: f.jobName, reason: 'STEP_JOB_MISSING_RUNS_ON' });
    }
    if (model === 'AMBIGUOUS') {
      violations.push({ jobName: f.jobName, reason: 'JOB_DECLARES_BOTH_STEPS_AND_TOP_LEVEL_USES' });
    }
    if (model === 'UNKNOWN') {
      violations.push({ jobName: f.jobName, reason: 'JOB_HAS_NEITHER_STEPS_NOR_TOP_LEVEL_USES' });
    }
    // REUSABLE_WORKFLOW_CALL_JOB is never required to have runs-on, and is
    // never flagged merely for lacking it — that is the exact false-
    // positive this gate must not produce.
  }

  return { valid: violations.length === 0, jobs, violations };
}
