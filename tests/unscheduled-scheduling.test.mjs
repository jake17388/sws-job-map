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
const vehicleRoster = JSON.parse(readFileSync(new URL('../config/vehicle-roster.json', import.meta.url), 'utf8'));

const INSTALL_CAL_ID_FOR_TEST = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SERVICE_CAL_ID_FOR_TEST = 'summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com';

function makeBackend({ createError = null, deleteError = null, calendarEvents = {} } = {}) {
  const rows = [[
    'Job #', 'Job Name', 'Address', 'Added', 'ID', 'Added By', 'Crew',
  ], [
    '123456', 'Monument Sign', '100 Main St, Phoenix, AZ', '2026-09-20', 'row-1', 'Jake Banks', 'Johnny/Randy',
  ]];
  const properties = new Map();
  const created = [];
  const eventsByCalendar = new Map(Object.entries(calendarEvents));
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
        getEvents: () => eventsByCalendar.get(id) || [],
        getEventById: eventId => [...created, ...(eventsByCalendar.get(id) || [])]
          .find(event => String(event.getId()) === String(eventId)) || null,
        createAllDayEvent(title, start, end, options) {
          if (createError) throw new Error(createError);
          const tags = new Map();
          let currentTitle = title;
          const event = {
            title, start, end, options, id: 'calendar-event-1', tags,
            getId: () => 'calendar-event-1',
            getTitle: () => currentTitle,
            setTitle: value => { currentTitle = value; },
            getStartTime: () => start,
            getEndTime: () => end,
            getTag: key => tags.get(key) || null,
            setTag: (key, value) => tags.set(key, value),
            deleteTag: key => tags.delete(key),
          };
          created.push(event);
          const calendarJobs = eventsByCalendar.get(id) || [];
          calendarJobs.push(event);
          eventsByCalendar.set(id, calendarJobs);
          return event;
        },
      }) : null,
    },
  };
  vm.createContext(context);
  vm.runInContext(`const VEHICLE_ROSTER = ${JSON.stringify(vehicleRoster)};\n${configSource}\n${calendarSource}\n${unscheduledSource}`, context);
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

test('multi-day scheduling uses standard crew priority and converts the inclusive end date to exclusive', () => {
  const backend = makeBackend();
  const result = backend.context.scheduleUnsched(validRequest({
    end_date: '2026-10-08',
    crew: ['Randy', 'Jonathan', 'Jerry', 'Johnny', 'Eli'],
  }));

  assert.equal(result.title, '(Johnny/Eli/Jerry/Jonathan/Randy) 123456 Monument Sign');
  assert.deepEqual(Array.from(result.crew), ['Johnny', 'Eli', 'Jerry', 'Jonathan', 'Randy']);
  assert.equal(backend.created[0].end.getFullYear(), 2026);
  assert.equal(backend.created[0].end.getMonth(), 9);
  assert.equal(backend.created[0].end.getDate(), 9);
});

test('scheduling stores shared truck assignments as private Calendar metadata', () => {
  const backend = makeBackend();
  const result = backend.context.scheduleUnsched(validRequest({
    crew: ['Johnny', 'Eli'],
    truck_assignments: {
      Johnny: '2018-big-crane',
      Eli: '2018-big-crane',
    },
  }));

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(backend.created[0].tags.get('sws_truck_assignments_v1')), {
    Johnny: '2018-big-crane',
    Eli: '2018-big-crane',
  });
  assert.equal(backend.created[0].options.description, [
    'Truck Assignment:',
    '• Johnny - 2018 Altec Crane',
    '• Eli - 2018 Altec Crane',
  ].join('\n'));
});

test('scheduling propagates each crew truck to their other jobs on the same day', () => {
  function existingEvent(id, title, assignments = {}) {
    const tags = new Map();
    if (Object.keys(assignments).length) tags.set('sws_truck_assignments_v1', JSON.stringify(assignments));
    return {
      getId: () => id,
      getTitle: () => title,
      getStartTime: () => new Date(2026, 9, 5),
      getEndTime: () => new Date(2026, 9, 6),
      getTag: key => tags.get(key) || null,
      setTag: (key, value) => tags.set(key, value),
      deleteTag: key => tags.delete(key),
      tags,
    };
  }

  const eliJob = existingEvent('eli-job', '(Eli) 123457 Second Job', { Eli: '2016-flatbed' });
  const jerryJob = existingEvent('jerry-job', '(Jerry) 123458 Service Job');
  const backend = makeBackend({
    calendarEvents: {
      [INSTALL_CAL_ID_FOR_TEST]: [eliJob],
      [SERVICE_CAL_ID_FOR_TEST]: [jerryJob],
    },
  });

  const result = backend.context.scheduleUnsched(validRequest({
    crew: ['Eli', 'Jerry'],
    truck_assignments: {
      Eli: '2022-small-crane',
      Jerry: '2019-single-bucket',
    },
  }));

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(eliJob.tags.get('sws_truck_assignments_v1')), {
    Eli: '2022-small-crane',
  });
  assert.deepEqual(JSON.parse(jerryJob.tags.get('sws_truck_assignments_v1')), {
    Jerry: '2019-single-bucket',
  });
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

test('a retry after complete success returns the saved event without creating a duplicate', () => {
  const backend = makeBackend();
  const first = backend.context.scheduleUnsched(validRequest({ crew: ['Randy'] }));
  const second = backend.context.scheduleUnsched(validRequest({ crew: ['Randy'] }));

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.event_id, first.event_id);
  assert.equal(backend.created.length, 1);
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
  assert.match(frontendSource, /initScheduleCrewButtons\(\)/);
  assert.match(frontendSource, /Promise\.all\(\[loadJobs\(\), loadUnscheduled\(\)\]\)/);
});

test('unscheduled map cards offer scheduling to admins', () => {
  assert.match(
    frontendSource,
    /<button onclick="closeJobCard\(\);openUnscheduledScheduler\('\$\{escapeHtml\(job\.id\)\}'\)">Schedule<\/button>/,
  );
});
