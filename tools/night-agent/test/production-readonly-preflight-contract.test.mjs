import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORKFLOW_PATH = fileURLToPath(
  new URL('../../../.github/workflows/production-readonly-preflight.yml', import.meta.url),
);

function executableSource(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

test('T-F1.2 Production preflight is manual-only and bound to exact main', () => {
  const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(source, /^  (push|pull_request|schedule|workflow_run):/m);
  assert.match(source, /\[ "\$REF" = "refs\/heads\/main" \]/);
  assert.match(source, /PREFLIGHT_PRODUCTION_READONLY/);
  assert.match(source, /REMOTE_MAIN_SHA=.*gh api/);
  assert.match(source, /environment: production/);
});

test('T-F1.2 Production preflight exposes only read-only cloud operations', () => {
  const source = executableSource(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

  const forbidden = [
    /gcloud\s+run\s+(?:jobs\s+)?(?:deploy|execute|delete|update)\b/i,
    /gcloud\s+sql\s+(?:instances|databases|users)\s+(?:create|delete|patch|update)\b/i,
    /gcloud\s+secrets\s+(?:create|delete|add-iam-policy-binding|remove-iam-policy-binding)\b/i,
    /gcloud\s+secrets\s+versions\s+(?:access|add|destroy|disable|enable)\b/i,
    /gcloud\s+projects\s+(?:add-iam-policy-binding|remove-iam-policy-binding)\b/i,
    /gcloud\s+iam\s+service-accounts\s+(?:create|delete|add-iam-policy-binding|remove-iam-policy-binding)\b/i,
    /docker\s+(?:build|push)\b/i,
    /npm\s+run\s+migrate(?::up)?\b/i,
    /psql\b/i,
    /--set-secrets\b/i,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `read-only preflight contains forbidden mutation-capable command: ${pattern}`);
  }

  assert.match(source, /gcloud sql instances describe/);
  assert.match(source, /gcloud sql databases list/);
  assert.match(source, /gcloud iam service-accounts describe/);
  assert.match(source, /gcloud secrets versions list/);
  assert.match(source, /gcloud artifacts docker images list/);
  assert.match(source, /gcloud run jobs describe/);
  assert.doesNotMatch(source, /gcloud secrets versions access/);
});

test('T-F1.2 Production preflight cannot silently consume a stale artifact tag', () => {
  const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  assert.match(source, /Current main SHA tag already exists in Production Artifact Registry/);
  assert.match(source, /\[ "\$MATCH_COUNT" = "0" \]/);
  assert.match(source, /CURRENT_MAIN_ARTIFACT_TAG_UNUSED=YES/);
});

test('T-F1.2 Production preflight contract file lives in repository root expected by CI', () => {
  assert.equal(fs.existsSync(REPO_ROOT), true);
  assert.equal(fs.existsSync(WORKFLOW_PATH), true);
});
