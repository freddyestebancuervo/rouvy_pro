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
  //
  // -z (P1-D REMEDIATION, T-F1.2 external re-audit round 3, HOLD): without
  // -z, git C-quotes "unusual" filenames (Unicode, spaces, tabs, quotes,
  // embedded newlines) into a double-quoted, octal-escaped string (e.g.
  // `"...producci\303\263n.yml"`), which no longer starts with the literal
  // `.github/workflows/` prefix isGithubActionsWorkflowPath requires --
  // reproduced independently: a real Unicode-named workflow change was
  // silently exempted from every downstream gate. -z makes git emit
  // NUL-delimited, byte-exact, unquoted paths instead -- with --no-renames,
  // every record is exactly <status>\0<path>\0. NUL cannot appear in a real
  // filename on any filesystem this process runs on, so it is an
  // unambiguous delimiter for every one of those "unusual" bytes, including
  // ones a quoting/unquoting parser could still get wrong. This is a command
  // flag, not repository config -- deliberately not relying on
  // core.quotePath=false (a config value this module never touches) as the
  // only defense.
  const result = spawnSyncFn(
    'git',
    ['diff', '--name-status', '-z', '--no-renames', `${baseSha}..${headSha}`],
    { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );

  if (result?.error) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_COMMAND_FAILED', detail: result.error.message };
  }
  if (typeof result?.status !== 'number' || result.status !== 0) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_COMMAND_FAILED', detail: result?.stderr ?? `exit status ${result?.status}` };
  }

  const tokens = (result.stdout ?? '').split('\0');
  // A well-formed -z stream always ends with a trailing NUL, which yields
  // exactly one empty trailing element from split('\0'); drop only that one
  // placeholder -- never blindly filter every empty string, or a genuinely
  // malformed/truncated stream (two adjacent NULs, a missing final record)
  // would silently pass the parity check below instead of failing closed.
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') {
    tokens.pop();
  }

  if (tokens.length % 2 !== 0) {
    return { ok: false, files: null, reason: 'GIT_CHANGESET_UNPARSEABLE_OUTPUT', detail: 'odd token count in NUL-delimited output' };
  }

  const files = new Set();
  for (let i = 0; i < tokens.length; i += 2) {
    const status = tokens[i];
    const filePath = tokens[i + 1];
    // status codes: A (added), M (modified), D (deleted), T (type change).
    // Malformed/unexpected tokens fail closed rather than being silently
    // skipped -- an unparseable record could hide a real change.
    if (typeof status !== 'string' || status.length === 0 || typeof filePath !== 'string' || filePath.length === 0) {
      return { ok: false, files: null, reason: 'GIT_CHANGESET_UNPARSEABLE_OUTPUT', detail: `token index ${i}` };
    }
    files.add(filePath);
  }

  return { ok: true, files: Object.freeze([...files]), reason: null };
}
