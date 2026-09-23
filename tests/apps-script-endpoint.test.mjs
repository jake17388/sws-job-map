import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploymentId = 'AKfycbwPSjnRVmTW0Azok6kY992-o4pdYacmaNkDYBk3XVihRMa32rLdwKdFKGoQbZHuGh6H';
const files = [
  '../src/frontend/app.js',
  '../surecam-sync/sync.mjs',
  '../.github/workflows/deploy.yml',
];

for (const file of files) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, new RegExp(deploymentId), `${file} must target the active Apps Script deployment`);
}
