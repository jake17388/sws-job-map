import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Dropbox settings are admin-only and expose all connection states', () => {
  assert.match(html, /id="dropbox-settings-section"/);
  assert.match(html, /Not configured/);
  assert.match(html, /Not connected/);
  assert.match(html, /Connected/);
  assert.match(html, /function isAdmin\(\)/);
  assert.match(html, /DROPBOX[\s\S]*isAdmin\(\)/i);
});

test('viewer controls are read-only and private endpoints are lazy', () => {
  assert.match(html, /auth\.role\s*===\s*['"]admin['"]/);
  assert.match(html, /function applyRoleVisibility\(\)/);
  assert.match(html, /getInstallAnalysis/);
  assert.match(html, /getProductionFile/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*(analysis|production|dropbox)/i);
});

test('install analysis renders every required state and report label', () => {
  for (const text of [
    'Analyzing Production File',
    'No Production File Available',
    'Retry Analysis',
    'Recommended Equipment',
    'Individual Letters',
    'Lettersets',
    'Installation Requirements',
    'ACM', 'RPC', 'FCO', 'EMC', 'S/F', 'D/S', 'D/F', 'Wireway', 'Raceway',
  ]) assert.match(html, new RegExp(text.replace('/', '\\/'), 'i'), `missing UI label: ${text}`);
});

test('private PDF object URLs are revoked on close and sign out', () => {
  assert.match(html, /URL\.createObjectURL/);
  assert.match(html, /URL\.revokeObjectURL/);
  assert.match(html, /function closeProductionFile/);
});

test('untrusted server and model text uses a shared escaping helper', () => {
  assert.match(html, /function escapeHtml\(/);
  assert.match(html, /escapeHtml\(job\.title\)/);
  assert.match(html, /escapeHtml\([^)]*(file|analysis|requirement|notes)/i);
});
