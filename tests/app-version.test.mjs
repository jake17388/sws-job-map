import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const versionFile = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8'));
const appVersion = html.match(/const APP_VERSION = '([^']+)'/)?.[1];

assert.ok(appVersion, 'index.html must declare APP_VERSION');
assert.equal(appVersion, versionFile.version,
  'APP_VERSION and version.json must match so the update banner clears after deployment');

console.log('app version contract passed');
