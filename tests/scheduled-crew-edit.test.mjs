import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const frontendHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../src/backend/01-config.js', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const unscheduledSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../appsscript.json', import.meta.url), 'utf8'));

test('the Apps Script manifest grants Calendar write access', () => {
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar'));
  assert.ok(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar.readonly'));
});

test('scheduled jobs expose a stable calendar event identifier', () => {
  assert.match(calendarSource, /event_id:\s*event\.getId\(\)/);
});

test('the backend updates only crew prefixes on allowed calendars', () => {
  assert.match(calendarSource, /function updateScheduledCrew\(data\)/);
  assert.match(calendarSource, /normalizeUnscheduledCrew_\(data\.crew\)/);
  assert.ok(calendarSource.includes("replace(/^\\([^)]+\\)\\s*/, '')"));
  assert.match(calendarSource, /event\.setTitle\(nextTitle\)/);
  assert.match(routingSource, /data\.action === 'updateScheduledCrew'/);
  assert.match(routingSource, /isAdmin_\(actor\)/);
});

test('an editor-only helper can authorize Calendar writes without changing a title', () => {
  assert.match(calendarSource, /function authorizeCalendarWrite\(\)/);
  assert.match(calendarSource, /const existingTitle = event\.getTitle\(\)/);
  assert.match(calendarSource, /event\.setTitle\(existingTitle\)/);
});

test('scheduled job cards provide an optional crew editor', () => {
  assert.match(frontendHtml, /id="scheduled-crew-panel"/);
  assert.match(frontendHtml, /id="scheduled-crew-btns"/);
  assert.match(frontendSource, /function openScheduledCrewEditor\(index\)/);
  assert.match(frontendSource, /function saveScheduledCrew\(\)/);
  assert.match(frontendSource, /action:\s*'updateScheduledCrew'/);
});

test('clearing all scheduled crew remains a valid save', () => {
  assert.match(frontendSource, /function getSelectedScheduledCrew\(\)/);
  assert.match(frontendSource, /crew:\s*getSelectedScheduledCrew\(\)/);
  assert.doesNotMatch(frontendSource, /Select at least one crew member/);
});

test('scheduled crew titles use the standard priority regardless of selection order', () => {
  let updatedTitle = '';
  const event = {
    getTitle: () => '(Jonathan/Eli) 123456 Monument Sign',
    setTitle: title => { updatedTitle = title; },
  };
  const context = {
    CalendarApp: {
      getCalendarById: () => ({ getEventById: () => event }),
    },
  };
  vm.createContext(context);
  vm.runInContext(`${configSource}\n${calendarSource}\n${unscheduledSource}`, context);

  const result = context.updateScheduledCrew({
    type: 'install',
    event_id: 'event-1',
    crew: ['Jonathan', 'Eli'],
  });

  assert.equal(updatedTitle, '(Eli/Jonathan) 123456 Monument Sign');
  assert.deepEqual(Array.from(result.crew), ['Eli', 'Jonathan']);
});

test('backend and frontend share the requested crew priority', () => {
  const priority = "['Johnny', 'Eli', 'Jerry', 'Jonathan', 'Randy', 'Jake']";
  assert.ok(configSource.includes(`const CREW_NAMES = ${priority}`));
  assert.ok(frontendSource.includes(`const CREW = ${priority}`));
});
