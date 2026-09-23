import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('../src/backend/01-config.js', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const unscheduledSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const frontendHtml = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

function makeBackend({ createError = null, deleteError = null } = {}) {
  const rows = [[
    'Job #', 'Job Name', 'Address', 'Added', 'ID', 'Added By', 'Crew',
  ], [
    '123456', 'Monument Sign', '100 Main St, Phoenix, AZ', '2026-09-20', 'row-1', 'Jake Banks', 'Johnny/Randy',
  ]];
  const properties = new Map();
  const created = [];
  const sheet = {
    getDataRange: () => ({ getValues: () => rows.map(row => [...row]) }),
    deleteRow(index) {
      if (deleteError) throw new Error(deleteError);
      rows.splice(index - 1, 1);
    },
  };
  const context = {
    console,
    Date,
    SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getSheetId: () => 0, ...sheet }] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
      }),
    },
    CalendarApp: {
      getCalendarById: id => id ? ({
        createAllDayEvent(title, start, end, options) {
          if (createError) throw new Error(createError);
          const event = { title, start, end, options, id: 'calendar-event-1' };
          created.push(event);
          return { getId: () => event.id };
        },
      }) : null,
    },
  };
  vm.createContext(context);
  vm.runInContext(`${configSource}\n${calendarSource}\n${unscheduledSource}`, context);
  return { context, rows, properties, created };
}

function validRequest(overrides = {}) {
  return {
    id: 'row-1',
    job_num: '123456',
    title: 'Monument Sign',
    address: '100 Main St, Phoenix, AZ',
    start_date: '2026-10-05',
    end_date: '2026-10-05',
    crew: [],
    calendar: 'install',
    ...overrides,
  };
}

test('single-day scheduling creates a parser-compatible all-day install event and removes the row', () => {
  const backend = makeBackend();
  const result = backend.context.scheduleUnsched(validRequest());

  assert.equal(result.success, true);
  assert.equal(backend.created.length, 1);
  assert.equal(backend.created[0].title, '123456 Monument Sign');
  assert.equal(backend.created[0].options.location, '100 Main St, Phoenix, AZ');
  assert.equal(backend.created[0].start.getFullYear(), 2026);
  assert.equal(backend.created[0].start.getMonth(), 9);
  assert.equal(backend.created[0].start.getDate(), 5);
  assert.equal(backend.created[0].end.getDate(), 6);
  assert.equal(backend.rows.length, 1);
});

test('multi-day scheduling preserves crew order and converts the inclusive end date to exclusive', () => {
  const backend = makeBackend();
  const result = backend.context.scheduleUnsched(validRequest({
    end_date: '2026-10-08',
    crew: ['Randy', 'Johnny'],
  }));

  assert.equal(result.title, '(Randy/Johnny) 123456 Monument Sign');
  assert.deepEqual(Array.from(result.crew), ['Randy', 'Johnny']);
  assert.equal(backend.created[0].end.getFullYear(), 2026);
  assert.equal(backend.created[0].end.getMonth(), 9);
  assert.equal(backend.created[0].end.getDate(), 9);
});

test('scheduling rejects unknown crew, invalid dates, identity changes, and non-install targets', () => {
  for (const [request, error] of [
    [validRequest({ crew: ['Johnny', 'Intruder'] }), 'Unknown crew member'],
    [validRequest({ start_date: '2026-10-09', end_date: '2026-10-08' }), 'End date'],
    [validRequest({ start_date: '2026-02-30' }), 'Invalid start date'],
    [validRequest({ title: 'Changed in browser' }), 'Job details changed'],
    [validRequest({ calendar: 'service' }), 'Invalid target calendar'],
  ]) {
    const backend = makeBackend();
    const result = backend.context.scheduleUnsched(request);
    assert.equal(result.success, false);
    assert.match(result.error, new RegExp(error));
    assert.equal(backend.created.length, 0);
    assert.equal(backend.rows.length, 2);
  }
});

test('Calendar failure leaves the Sheet row intact', () => {
  const backend = makeBackend({ createError: 'Calendar unavailable' });
  const result = backend.context.scheduleUnsched(validRequest());
  assert.equal(result.success, false);
  assert.match(result.error, /Calendar unavailable/);
  assert.equal(backend.rows.length, 2);
  assert.equal(backend.properties.size, 0);
});

test('cleanup failure returns a durable partial result and retry does not duplicate the event', () => {
  const backend = makeBackend({ deleteError: 'Sheet unavailable' });
  const first = backend.context.scheduleUnsched(validRequest({ crew: ['Johnny'] }));
  const second = backend.context.scheduleUnsched(validRequest({ crew: ['Johnny'] }));

  assert.equal(first.success, false);
  assert.equal(first.partial, true);
  assert.equal(first.event_id, 'calendar-event-1');
  assert.equal(second.partial, true);
  assert.equal(backend.created.length, 1);
  assert.equal(backend.properties.size, 1);
  assert.equal(backend.rows.length, 2);
});

test('the admin-only scheduling route does not trust a browser role', () => {
  assert.match(routingSource, /data\.action === 'scheduleUnsched'/);
  assert.match(routingSource, /if \(!isAdmin_\(actor\)\) return json\(\{ error: 'forbidden' \}\)/);
  assert.doesNotMatch(routingSource, /data\.role/);
});

test('the scheduling modal exposes dates, optional crew, saving state, and the complete request payload', () => {
  assert.match(frontendHtml, /id="schedule-unscheduled-panel"/);
  assert.match(frontendHtml, /id="schedule-start-date"[^>]+type="date"/);
  assert.match(frontendHtml, /id="schedule-end-date"[^>]+type="date"/);
  assert.match(frontendHtml, /id="schedule-crew-btns"/);
  assert.match(frontendHtml, /id="schedule-unscheduled-status"/);
  assert.match(frontendSource, /function openUnscheduledScheduler\(id\)/);
  assert.match(frontendSource, /action:\s*'scheduleUnsched'/);
  assert.match(frontendSource, /job_num:\s*job\.job_num/);
  assert.match(frontendSource, /start_date:\s*startDate/);
  assert.match(frontendSource, /end_date:\s*endDate/);
  assert.match(frontendSource, /calendar:\s*'install'/);
  assert.match(frontendSource, /scheduleButton\.disabled = true/);
  assert.match(frontendSource, /Promise\.all\(\[loadJobs\(\), loadUnscheduled\(\)\]\)/);
});

test('unscheduled cards and list rows open the scheduler for admins', () => {
  assert.match(frontendSource, /openUnscheduledScheduler\('\$\{escapeHtml\(job\.id\)\}'\)/);
});
