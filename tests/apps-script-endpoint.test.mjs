import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploymentId = 'AKfycbwbVJqFkNCzb9QS2HU950x0164bPS3DNDjehotGbjTV_WDc8lC6G7PXXfvfVizVVvml';
const files = [
  '../src/frontend/app.js',
  '../surecam-sync/sync.mjs',
  '../.github/workflows/deploy.yml',
];

for (const file of files) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, new RegExp(deploymentId), `${file} must target the active Apps Script deployment`);
}
