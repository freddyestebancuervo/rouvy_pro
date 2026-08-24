// Korixa Night Agent — second-layer GitHub Actions validator.
//
// The in-repo workflow-structure-gate.mjs deterministically protects the
// exact missing-runs-on incident class without external dependencies. This
// module adds an independent parser/semantic validator (actionlint) in GitHub
// CI so the repository is not relying on its own parser alone.
//
// Supply-chain controls:
// - exact actionlint version pinned below;
// - exact Linux amd64 release artifact URL;
// - SHA-256 pinned to the digest published by that GitHub release asset;
// - downloaded bytes are NEVER executed before their digest matches;
// - extraction happens in an isolated temporary directory which is removed
//   in finally;
// - no Production/cloud credentials or mutations are involved.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ACTIONLINT_VERSION = '1.7.12';
export const ACTIONLINT_LINUX_AMD64_SHA256 = '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8';
export const ACTIONLINT_LINUX_AMD64_URL = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`;

function fail(reason, detail = '') {
  return Object.freeze({
    status: 'FAIL',
    reason,
    detail: typeof detail === 'string' ? detail.slice(0, 4000) : '',
  });
}

function pass(detail = '') {
  return Object.freeze({ status: 'PASS', reason: 'ACTIONLINT_VALIDATION_PASSED', detail });
}

function notApplicable(detail) {
  return Object.freeze({ status: 'NOT_APPLICABLE_LOCAL', reason: 'CI_ONLY_EXTERNAL_LAYER', detail });
}

/**
 * Run the independent actionlint layer.
 *
 * This external-download layer is intentionally CI-only. The deterministic
 * in-repo structure gate runs everywhere. GitHub-hosted CI is the authority
 * for this second layer because the release artifact is pinned specifically
 * for the Linux amd64 runner used by the required Night Agent job.
 */
export async function runActionlintGate({
  repoRoot = process.cwd(),
  githubActions = process.env.GITHUB_ACTIONS,
  platform = process.platform,
  arch = process.arch,
  fetchFn = globalThis.fetch,
  spawnSyncFn = spawnSync,
} = {}) {
  if (githubActions !== 'true') {
    return notApplicable('Pinned external actionlint layer runs only inside GitHub Actions; deterministic structure gate remains active locally.');
  }

  if (platform !== 'linux' || arch !== 'x64') {
    return fail('UNSUPPORTED_CI_RUNNER', `Expected linux/x64, got ${platform}/${arch}`);
  }

  if (typeof fetchFn !== 'function') return fail('FETCH_UNAVAILABLE');
  if (typeof spawnSyncFn !== 'function') return fail('SPAWN_UNAVAILABLE');

  let tempDir = null;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'korixa-actionlint-'));
    const archivePath = path.join(tempDir, 'actionlint.tar.gz');

    let response;
    try {
      response = await fetchFn(ACTIONLINT_LINUX_AMD64_URL, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': 'korixa-ci-actionlint-gate' },
      });
    } catch (error) {
      return fail('DOWNLOAD_FAILED', error instanceof Error ? error.message : String(error));
    }

    if (!response?.ok) return fail('DOWNLOAD_HTTP_FAILURE', `HTTP ${response?.status ?? 'unknown'}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== ACTIONLINT_LINUX_AMD64_SHA256) {
      return fail('CHECKSUM_MISMATCH', `expected=${ACTIONLINT_LINUX_AMD64_SHA256} actual=${actualSha256}`);
    }
    fs.writeFileSync(archivePath, bytes, { mode: 0o600 });

    const extract = spawnSyncFn('tar', ['-xzf', archivePath, '-C', tempDir, 'actionlint'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });
    if (extract?.error || extract?.status !== 0) {
      return fail('EXTRACTION_FAILED', extract?.error?.message ?? extract?.stderr ?? 'tar failed');
    }

    const binaryPath = path.join(tempDir, 'actionlint');
    fs.chmodSync(binaryPath, 0o700);

    const version = spawnSyncFn(binaryPath, ['-version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 10_000,
    });
    if (version?.error || version?.status !== 0) {
      return fail('VERSION_CHECK_FAILED', version?.error?.message ?? version?.stderr ?? 'version check failed');
    }
    const versionText = `${version.stdout ?? ''}${version.stderr ?? ''}`;
    if (!versionText.includes(ACTIONLINT_VERSION)) {
      return fail('VERSION_MISMATCH', versionText);
    }

    const lint = spawnSyncFn(binaryPath, ['-color', 'never'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (lint?.error) return fail('ACTIONLINT_EXECUTION_ERROR', lint.error.message);
    if (lint?.status !== 0) {
      return fail('ACTIONLINT_FINDINGS', `${lint?.stdout ?? ''}\n${lint?.stderr ?? ''}`);
    }

    return pass(versionText.trim());
  } catch (error) {
    return fail('UNEXPECTED_GATE_ERROR', error instanceof Error ? error.message : String(error));
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
