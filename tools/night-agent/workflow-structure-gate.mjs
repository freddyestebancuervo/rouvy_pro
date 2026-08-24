// Korixa Night Agent — GitHub Actions workflow structure gate.
//
// Why this exists:
// PRs #85/#86 passed the existing A/B/C + CI process even though normal
// jobs containing `steps:` were missing the mandatory job-level `runs-on:`
// key. GitHub rejected the real workflow_dispatch before creating a run.
//
// This gate is intentionally small and deterministic. It does NOT pretend
// to replace GitHub's full server-side workflow validator. It enforces the
// exact structural invariants that caused the incident, across EVERY file
// in .github/workflows, and it runs inside the already-required
// "Night Agent — security + test" check via workflow-structure-gate.test.mjs.
// Therefore a future regression of this class makes required CI fail and C
// cannot certify the exact HEAD as PASS.
//
// Invariants enforced:
//  1. A normal job with `steps:` MUST have job-level `runs-on:`.
//  2. A reusable-workflow caller job with job-level `uses:` MUST NOT also
//     declare job-level `runs-on:`.
//  3. A reusable-workflow caller job with job-level `uses:` MUST NOT also
//     declare job-level `steps:`.
//
// Fail closed: malformed/ambiguous jobs are reported as errors; nothing is
// auto-fixed and no Production/remote mutation is ever performed here.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);

function isIgnorable(line) {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith('#');
}

/**
 * Inspect only job-level structure. This deliberately does not parse shell
 * bodies or expression contents, avoiding false positives from strings that
 * merely contain words such as "steps:" or "runs-on:".
 *
 * @param {string} source YAML source text
 * @param {{file?: string}} options
 * @returns {{file: string, jobs: Array, errors: Array}}
 */
export function inspectWorkflowStructure(source, { file = '<memory>' } = {}) {
  if (typeof source !== 'string') {
    return {
      file,
      jobs: [],
      errors: [{ code: 'WORKFLOW_SOURCE_NOT_STRING', file, line: null, jobId: null }],
    };
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let jobsLine = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (/^jobs:\s*(?:#.*)?$/.test(lines[i])) {
      jobsLine = i;
      break;
    }
  }

  if (jobsLine === -1) {
    return {
      file,
      jobs: [],
      errors: [{ code: 'WORKFLOW_MISSING_TOP_LEVEL_JOBS', file, line: null, jobId: null }],
    };
  }

  const jobs = [];
  let current = null;

  const finishCurrent = () => {
    if (current) jobs.push(current);
    current = null;
  };

  for (let i = jobsLine + 1; i < lines.length; i += 1) {
    const line = lines[i];

    // A new top-level key ends the jobs mapping.
    if (!isIgnorable(line) && /^\S/.test(line)) {
      finishCurrent();
      break;
    }

    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (jobMatch) {
      finishCurrent();
      current = {
        id: jobMatch[1],
        line: i + 1,
        fields: new Set(),
      };
      continue;
    }

    if (!current) continue;

    // Only direct children of the job (exactly four spaces) matter here.
    const fieldMatch = line.match(/^    ([A-Za-z0-9_-]+):(?:\s|$)/);
    if (fieldMatch) current.fields.add(fieldMatch[1]);
  }
  finishCurrent();

  const errors = [];
  for (const job of jobs) {
    const hasSteps = job.fields.has('steps');
    const hasRunsOn = job.fields.has('runs-on');
    const hasUses = job.fields.has('uses');

    if (hasSteps && !hasRunsOn) {
      errors.push({
        code: 'JOB_WITH_STEPS_MISSING_RUNS_ON',
        file,
        line: job.line,
        jobId: job.id,
      });
    }

    if (hasUses && hasRunsOn) {
      errors.push({
        code: 'REUSABLE_CALLER_MUST_NOT_DECLARE_RUNS_ON',
        file,
        line: job.line,
        jobId: job.id,
      });
    }

    if (hasUses && hasSteps) {
      errors.push({
        code: 'REUSABLE_CALLER_MUST_NOT_DECLARE_STEPS',
        file,
        line: job.line,
        jobId: job.id,
      });
    }
  }

  return {
    file,
    jobs: jobs.map((job) => ({
      id: job.id,
      line: job.line,
      fields: [...job.fields].sort(),
    })),
    errors,
  };
}

export function validateWorkflowDirectory(repoRoot = process.cwd()) {
  const workflowsDir = path.join(repoRoot, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir) || !fs.statSync(workflowsDir).isDirectory()) {
    return {
      valid: false,
      filesChecked: 0,
      errors: [{
        code: 'WORKFLOWS_DIRECTORY_MISSING',
        file: path.relative(repoRoot, workflowsDir) || '.github/workflows',
        line: null,
        jobId: null,
      }],
    };
  }

  const files = fs.readdirSync(workflowsDir)
    .filter((name) => WORKFLOW_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();

  if (files.length === 0) {
    return {
      valid: false,
      filesChecked: 0,
      errors: [{ code: 'NO_WORKFLOW_FILES_FOUND', file: '.github/workflows', line: null, jobId: null }],
    };
  }

  const errors = [];
  for (const name of files) {
    const absolutePath = path.join(workflowsDir, name);
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const result = inspectWorkflowStructure(source, { file: relativePath });
    errors.push(...result.errors);
  }

  return {
    valid: errors.length === 0,
    filesChecked: files.length,
    errors,
  };
}

function formatError(error) {
  const location = error.line ? `${error.file}:${error.line}` : error.file;
  const job = error.jobId ? ` job=${error.jobId}` : '';
  return `${location} ${error.code}${job}`;
}

function main() {
  const result = validateWorkflowDirectory(process.cwd());
  if (!result.valid) {
    console.error('WORKFLOW_SCHEMA_VALIDATION=FAIL');
    for (const error of result.errors) console.error(` - ${formatError(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`WORKFLOW_SCHEMA_VALIDATION=PASS files_checked=${result.filesChecked}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) main();
