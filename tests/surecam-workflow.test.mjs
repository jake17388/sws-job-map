import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/surecam-sync.yml', import.meta.url), 'utf8');

assert.match(workflow, /cron:\s*'\*\/15 \* \* \* \*'/,
  'SureCam sync must run often enough to provide live truck updates');
assert.match(workflow, /concurrency:/,
  'SureCam sync must prevent overlapping browser sessions');
