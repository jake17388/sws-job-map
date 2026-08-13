import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(html, /id="refresh-btn"[^>]+onclick="refreshAll\(\)"/,
  'Refresh button should use the refreshAll UI controller');
assert.match(html, /async function refreshAll\(\)/,
  'refreshAll should coordinate loading and user-visible status');
assert.match(html, /Connection error[^`'"<]*/,
  'Refresh failures should be visible instead of leaving the cached label unchanged');

console.log('refresh UI contract passed');
