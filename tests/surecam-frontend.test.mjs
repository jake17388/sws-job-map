import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /VEHICLE_CACHE_KEY/,
  'frontend should persist the last-known vehicle snapshot locally');
assert.match(html, /readCache\(VEHICLE_CACHE_KEY/,
  'frontend should restore trucks before the backend request completes');
assert.match(html, /writeCache\(VEHICLE_CACHE_KEY/,
  'frontend should update its durable local vehicle snapshot after a successful fetch');

