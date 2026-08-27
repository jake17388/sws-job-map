import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Johnny uses orange as his crew color', () => {
  assert.match(html, /CREW_COLORS\s*=\s*\{[^}]*Johnny:\s*['"]#F97316['"]/);
});

test('viewer controls are read-only', () => {
  assert.match(html, /auth\.role\s*===\s*['"]admin['"]/);
  assert.match(html, /function applyRoleVisibility\(\)/);
});

test('Dropbox and install analysis controls are retired from the client', () => {
  assert.doesNotMatch(html, /dropbox/i);
  assert.doesNotMatch(html, /install.analysis/i);
  assert.doesNotMatch(html, /production.file/i);
});

test('untrusted server text uses a shared escaping helper', () => {
  assert.match(html, /function escapeHtml\(/);
  assert.match(html, /escapeHtml\(job\.title\)/);
});
