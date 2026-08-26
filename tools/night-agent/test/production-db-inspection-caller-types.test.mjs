import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const caller = readFileSync(
  new URL('../../../.github/workflows/production-db-readonly-inspection.yml', import.meta.url),
  'utf8',
);
const reusable = readFileSync(
  new URL('../../../.github/workflows/_backend-db-readonly-inspection-production.yml', import.meta.url),
  'utf8',
);

test('Production DB inspection caller passes authorization as a real boolean', () => {
  assert.match(
    reusable,
    /inspection_authorized:[\s\S]*?type:\s*boolean/,
    'the reusable contract must keep inspection_authorized typed as boolean',
  );

  assert.match(
    caller,
    /inspection_authorized:\s*\$\{\{\s*fromJSON\(needs\.guard\.outputs\.inspection_authorized\)\s*\}\}/,
    'job output strings must be explicitly converted before calling the boolean input',
  );

  assert.doesNotMatch(
    caller,
    /inspection_authorized:\s*\$\{\{\s*needs\.guard\.outputs\.inspection_authorized\s*\}\}/,
    'raw job-output strings must never be passed directly to the boolean reusable input',
  );
});
