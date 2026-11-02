import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

test('a stale base URL automatically navigates to the deployed version URL once', () => {
  assert.match(source, /if \(!manual && requestedVersion !== data\.version\) applyUpdate\(data\.version\)/);
});

test('the update URL uses the deployed app version instead of a disposable timestamp', () => {
  assert.match(source, /function applyUpdate\(version\)/);
  assert.match(source, /url\.searchParams\.set\('v', version \|\| availableAppVersion \|\| APP_VERSION\)/);
  assert.doesNotMatch(source, /searchParams\.set\('v', Date\.now\(\)\)/);
});

test('a current versioned load refreshes the canonical cache and restores the regular URL', () => {
  assert.match(source, /function normalizeVersionedAppUrl_\(\)/);
  assert.match(source, /fetch\(canonical\.toString\(\), \{ cache: 'reload', credentials: 'same-origin' \}\)/);
  assert.match(source, /window\.history\.replaceState\(null, '', canonical\.toString\(\)\)/);
  assert.match(source, /normalizeVersionedAppUrl_\(\);/);
});
