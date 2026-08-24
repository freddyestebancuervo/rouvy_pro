// Korixa Night Agent — authoritative Git changeset derivation (T-F1.2, P1-2
// remediation).
//
// WHY THIS EXISTS: state.files_changed was populated exclusively from
// executorResult.filesChanged -- A's own self-declared list. A task that
// genuinely modified .github/workflows/production-deploy.yml but declared
// only backend/src/main.ts would never trigger the workflow certification
// gate at all, silently bypassing every P1-1 protection. This module is the
// ONLY mechanically-authoritative source of "which files actually changed":
// a real `git diff --name-status` between the task's real BASE_SHA and
// HEAD_SHA. A's own declaration is never trusted for this classification --
// see task-orchestrator.mjs's use of this module.

import { spawnSync } from 'node:child_process';

const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * @param {{repoRoot: string, baseSha: string, headSha: string, spawnSyncFn?: Function}} params
 * @returns {{ok: true, files: readonly string[], reason: null} | {ok: false, files: null, reason: string, detail?: string}}
 */
export function deriveChangedFilesFromGit({ repoRoot, baseSha, headSha, spawnSyncFn = spawnSync } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_REPO_ROOT_REQUIRED' };
  }
  if (typeof baseSha !== 'string' || !FULL_SHA_RE.test(baseSha)) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_BASE_SHA_INVALID' };
  }
  if (typeof headSha !== 'string' || !FULL_SHA_RE.test(headSha)) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_HEAD_SHA_INVALID' };
  }
  if (typeof spawnSyncFn !== 'function') {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_SPAWN_UNAVAILABLE' };
  }

  // --no-renames: a rename is reported as an explicit delete of the old path
  // plus an add of the new path, rather than a single `R100 old new` line.
  // This is deliberate, not a simplification that loses information -- it
  // means a workflow file renamed TO or FROM .github/workflows/ is captured
  // as a real, individually-classifiable path change on either side, with no
  // separate rename-record parsing branch that could itself be a source of
  // divergent/incomplete detection.
  const result = spawnSyncFn(
    'git',
    ['diff', '--name-status', '--no-renames', `${baseSha}..${headSha}`],
    { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );

  if (result?.error) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_COMMAND_FAILED', detail: result.error.message };
  }
  if (typeof result?.status !== 'number' || result.status !== 0) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_COMMAND_FAILED', detail: result?.stderr ?? `exit status ${result?.status}` };
  }

  const lines = (result.stdout ?? '').split('\n').filter((l) => l.trim().length > 0);
  const files = new Set();
  for (const line of lines) {
    const parts = line.split('\t');
    // status codes: A (added), M (modified), D (deleted), T (type change).
    // Malformed/unexpected lines fail closed rather than being silently
    // skipped -- an unparseable line could hide a real change.
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return { ok: false, files: null, reason: 'GIT_CHANGESET_UNPARSEABLE_OUTPUT', detail: line };
    }
    files.add(parts[1]);
  }

  return { ok: true, files: Object.freeze([...files]), reason: null };
}
