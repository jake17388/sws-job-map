import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const frontend = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/frontend/style.css', import.meta.url), 'utf8');
const routing = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = frontend.indexOf(`function ${name}`);
  const end = frontend.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return frontend.slice(start, end);
}

test('sidebar job rows omit addresses while clicked job details retain them', () => {
  const list = functionSource('renderList', 'focusJob');
  const scheduledDetails = functionSource('scheduledCardHTML', 'estimatedInstallHoursHTML');
  const unscheduledDetails = functionSource('unschedCardHTML', 'buildScheduledMarker');

  assert.doesNotMatch(list, /class="job-addr"/);
  assert.doesNotMatch(list, /escapeHtml\(job\.(?:addr|address)\)/);
  assert.match(scheduledDetails, /escapeHtml\(job\.addr\)/);
  assert.match(unscheduledDetails, /escapeHtml\(job\.address\)/);
});

test('crew workload UI, client logic, styles, and backend route are removed', () => {
  assert.doesNotMatch(html, /workload|Crew workload/i);
  assert.doesNotMatch(frontend, /workload|getWorkloadEstimates/i);
  assert.doesNotMatch(styles, /workload/i);
  assert.doesNotMatch(routing, /getWorkloadEstimates/);
});
