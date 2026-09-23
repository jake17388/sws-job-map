import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const frontendHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const backendSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');

test('the unscheduled form offers optional crew buttons', () => {
  assert.match(frontendHtml, /Crew \(optional\)/);
  assert.match(frontendHtml, /id="unscheduled-crew-btns"/);
  assert.match(frontendSource, /function toggleUnscheduledCrew\(name\)/);
});

test('new and edited unscheduled jobs send optional crew assignments', () => {
  assert.match(frontendSource, /crew:\s*getSelectedUnscheduledCrew\(\)/);
  assert.match(frontendSource, /setUnscheduledCrew\(job\.crew\s*\|\|\s*\[\]\)/);
  assert.match(frontendSource, /setUnscheduledCrew\(\[\]\)/);
});

test('the backend reads and stores crew in the seventh sheet column', () => {
  assert.match(backendSource, /crew:\s*normalizeUnscheduledCrew_\(row\[6\]\)/);
  assert.match(backendSource, /normalizeUnscheduledCrew_\(data\.crew\)\.join\('\/'\)/);
  assert.match(backendSource, /getRange\(i \+ 1, 7\)\.setValue/);
});

test('crew normalization accepts an empty assignment and filters unknown names', () => {
  assert.match(backendSource, /function normalizeUnscheduledCrew_\(value\)/);
  assert.match(backendSource, /if \(!value\) return \[\];/);
  assert.match(backendSource, /CREW_NAMES\.includes\(name\)/);
});
