import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('../src/backend/01-config.js', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const unscheduledSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const frontendHtml = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

const INSTALL_CAL_ID_FOR_TEST = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SERVICE_CAL_ID_FOR_TEST = 'summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com';
const EXCAV_CAL_ID_FOR_TEST = 'c_86ccbe589549562e734ff696a2cebbefc071fe607283d4a7cac31c0c36d1155c@group.calendar.google.com';

const rosterFixture = [
  { id: 'big-crane', displayName: 'Big Crane', surecamDeviceId: 'device-big', active: true },
  { id: 'flatbed', displayName: 'Flatbed', surecamDeviceId: 'device-flat', active: true },
  { id: 'small-crane', displayName: 'Small Crane', surecamDeviceId: 'device-small', active: true },
  { id: '2019-bucket', displayName: '2019 Bucket', surecamDeviceId: 'device-2019', active: true },
  { id: 'retired-bucket', displayName: 'Retired Bucket', surecamDeviceId: 'device-old', active: false },
];

function assignmentContext(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  vm.runInContext(
    `const VEHICLE_ROSTER = ${JSON.stringify(rosterFixture)};\n${configSource}\n${calendarSource}\n${unscheduledSource}`,
    context,
  );
  return context;
}

test('a shared roster file is the single vehicle catalog source', () => {
  const rosterUrl = new URL('../config/vehicle-roster.json', import.meta.url);
  assert.equal(existsSync(rosterUrl), true);
  const roster = JSON.parse(readFileSync(rosterUrl, 'utf8'));
  assert.ok(roster.length > 0);
  assert.ok(roster.every(vehicle => vehicle.id && vehicle.displayName && vehicle.surecamDeviceId));
  assert.equal(new Set(roster.map(vehicle => vehicle.id)).size, roster.length);
});

test('the vehicle catalog matches the complete active truck list', () => {
  const roster = JSON.parse(readFileSync(new URL('../config/vehicle-roster.json', import.meta.url), 'utf8'));
  assert.deepEqual(roster.map(vehicle => vehicle.displayName), [
    '2016 Flatbed',
    '2018 Altec Crane',
    '2019 Single Bucket',
    '2022 Altec Crane',
    '2023 Single Bucket',
    '2025 Double Bucket',
    '2026 Flatbed',
  ]);
  assert.ok(roster.every(vehicle => vehicle.active === true));
});

test('vehicle roster changes trigger the Apps Script deployment workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /config\/vehicle-roster\.json/);
});

test('truck validation permits shared and separate trucks while preserving crew order', () => {
  const context = assignmentContext();
  const result = context.validateTruckAssignments_({
    Jerry: 'flatbed',
    Eli: 'big-crane',
    Johnny: 'big-crane',
  }, ['Jerry', 'Johnny', 'Eli']);

  assert.equal(result.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.assignments)), {
    Johnny: 'big-crane',
    Eli: 'big-crane',
    Jerry: 'flatbed',
  });
});

test('truck validation rejects unknown, inactive, and non-crew assignments', () => {
  const context = assignmentContext();
  for (const [assignments, crew, message] of [
    [{ Intruder: 'flatbed' }, ['Johnny'], 'Unknown crew member'],
    [{ Johnny: 'missing-truck' }, ['Johnny'], 'Unknown truck'],
    [{ Johnny: 'retired-bucket' }, ['Johnny'], 'not active'],
    [{ Eli: 'flatbed' }, ['Johnny'], 'not assigned to this job'],
  ]) {
    const result = context.validateTruckAssignments_(assignments, crew);
    assert.match(result.error, new RegExp(message, 'i'));
  }
});

test('stored truck metadata is tolerant and retains known retired assignments', () => {
  const context = assignmentContext();
  assert.deepEqual(JSON.parse(JSON.stringify(context.normalizeStoredTruckAssignments_('{bad json'))), {});
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.normalizeStoredTruckAssignments_(JSON.stringify({ Johnny: 'retired-bucket' })) )),
    { Johnny: 'retired-bucket' },
  );
});

test('scheduled jobs read truck assignments from a private Calendar tag', () => {
  const event = {
    getTitle: () => '(Johnny/Eli) 123456 Monument Sign',
    getLocation: () => '100 Main St',
    getStartTime: () => new Date(2026, 9, 5),
    getEndTime: () => new Date(2026, 9, 6),
    getId: () => 'event-1',
    getTag: key => key === 'sws_truck_assignments_v1'
      ? JSON.stringify({ Johnny: 'big-crane', Eli: 'big-crane' })
      : null,
  };
  const context = assignmentContext({ CalendarApp: { getCalendarById: () => ({ getEvents: () => [event] }) } });

  const jobs = context.fetchCalendarEvents('calendar-1', 'install', new Date(), new Date());
  assert.deepEqual(JSON.parse(JSON.stringify(jobs[0].truck_assignments)), {
    Johnny: 'big-crane',
    Eli: 'big-crane',
  });
});

test('all-day calendar dates use the all-day date in the script timezone', () => {
  const formatCalls = [];
  const event = {
    getTitle: () => '(Jerry) 261572 Snowflake Junior High School - Service',
    getLocation: () => '1380 Main St',
    isAllDayEvent: () => true,
    getAllDayStartDate: () => new Date('2026-11-06T00:00:00.000Z'),
    getAllDayEndDate: () => new Date('2026-11-07T00:00:00.000Z'),
    getStartTime: () => new Date('2026-11-06T00:00:00.000Z'),
    getEndTime: () => new Date('2026-11-07T00:00:00.000Z'),
    getId: () => 'event-jerry',
    getTag: () => null,
  };
  const calendar = {
    getTimeZone: () => 'America/Phoenix',
    getEvents: () => [event],
  };
  const context = assignmentContext({
    CalendarApp: { getCalendarById: () => calendar },
    Utilities: {
      formatDate(date, timeZone, pattern) {
        formatCalls.push({ date: date.toISOString(), timeZone, pattern });
        return date.toISOString().startsWith('2026-11-06') ? '2026-11-06' : '2026-11-07';
      },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
  });

  const jobs = context.fetchCalendarEvents('calendar-1', 'install', new Date(), new Date());

  assert.equal(jobs[0].start, '2026-11-06');
  assert.equal(jobs[0].end, '2026-11-06');
  assert.deepEqual(formatCalls.map(call => [call.timeZone, call.pattern]), [
    ['UTC', 'yyyy-MM-dd'],
    ['UTC', 'yyyy-MM-dd'],
  ]);
});

test('job loading fills existing daily truck assignments onto every same-day job', () => {
  function event(id, title, assignments = {}) {
    return {
      getTitle: () => title,
      getLocation: () => '100 Main St',
      getStartTime: () => new Date(2026, 9, 5),
      getEndTime: () => new Date(2026, 9, 6),
      getId: () => id,
      getTag: key => key === 'sws_truck_assignments_v1' && Object.keys(assignments).length
        ? JSON.stringify(assignments)
        : null,
    };
  }

  const assigned = event('assigned', '(Eli) 123456 Main Job', { Eli: 'small-crane' });
  const sameDay = event('same-day', '(Eli/Jerry) 123457 Second Job');
  const calendars = new Map([
    [INSTALL_CAL_ID_FOR_TEST, { getEvents: () => [assigned] }],
    [SERVICE_CAL_ID_FOR_TEST, { getEvents: () => [sameDay] }],
    [EXCAV_CAL_ID_FOR_TEST, { getEvents: () => [] }],
  ]);
  const context = assignmentContext({
    CalendarApp: { getCalendarById: id => calendars.get(id) || null },
  });

  const jobs = context.getJobs({ parameter: { from: '2026-10-05', to: '2026-10-05' } }).jobs;
  const loaded = jobs.find(job => job.event_id === 'same-day');

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.truck_assignments)), {
    Eli: 'small-crane',
  });
});

test('scheduled assignment updates save crew and trucks together', () => {
  let title = '(Johnny) 123456 Monument Sign';
  let description = 'Bring permit packet.';
  const tags = new Map();
  const event = {
    getTitle: () => title,
    setTitle: value => { title = value; },
    getDescription: () => description,
    setDescription: value => { description = value; },
    getTag: key => tags.get(key) || null,
    setTag: (key, value) => { tags.set(key, value); },
    deleteTag: key => { tags.delete(key); },
  };
  const context = assignmentContext({
    CalendarApp: { getCalendarById: () => ({ getEventById: () => event }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });

  const result = context.updateScheduledAssignments({
    type: 'install',
    event_id: 'event-1',
    crew: ['Johnny', 'Eli'],
    truck_assignments: { Johnny: 'big-crane', Eli: 'big-crane' },
  });

  assert.equal(result.success, true);
  assert.equal(title, '(Johnny/Eli) 123456 Monument Sign');
  assert.equal(description, [
    'Bring permit packet.',
    '',
    'Truck Assignment:',
    '• Johnny - Big Crane',
    '• Eli - Big Crane',
  ].join('\n'));
  assert.deepEqual(JSON.parse(tags.get('sws_truck_assignments_v1')), {
    Johnny: 'big-crane',
    Eli: 'big-crane',
  });
});

test('scheduled assignment updates propagate each crew truck to every overlapping job that day', () => {
  function event(id, title, startDay, assignments = {}) {
    let currentTitle = title;
    let description = '';
    const tags = new Map();
    if (Object.keys(assignments).length) {
      tags.set('sws_truck_assignments_v1', JSON.stringify(assignments));
    }
    return {
      id,
      tags,
      getId: () => id,
      getTitle: () => currentTitle,
      setTitle: value => { currentTitle = value; },
      getDescription: () => description,
      setDescription: value => { description = value; },
      getStartTime: () => new Date(2026, 9, startDay),
      getEndTime: () => new Date(2026, 9, startDay + 1),
      getTag: key => tags.get(key) || null,
      setTag: (key, value) => { tags.set(key, value); },
      deleteTag: key => { tags.delete(key); },
      description: () => description,
    };
  }

  const target = event('target', '(Eli/Jerry) 123456 Main Job', 5);
  const eliJob = event('eli-job', '(Eli) 123457 Second Job', 5, { Eli: 'flatbed' });
  const jerryJob = event('jerry-job', '(Jerry/Johnny) 123458 Service Job', 5, { Johnny: 'big-crane' });
  const nextDayJob = event('next-day', '(Eli) 123459 Tomorrow Job', 6);
  const calendars = new Map([
    [INSTALL_CAL_ID_FOR_TEST, {
      getEventById: id => id === 'target' ? target : null,
      getEvents: () => [target, eliJob],
    }],
    [SERVICE_CAL_ID_FOR_TEST, { getEvents: () => [jerryJob] }],
    [EXCAV_CAL_ID_FOR_TEST, { getEvents: () => [nextDayJob] }],
  ]);
  const context = assignmentContext({
    CalendarApp: { getCalendarById: id => calendars.get(id) || null },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });

  const result = context.updateScheduledAssignments({
    type: 'install',
    event_id: 'target',
    crew: ['Eli', 'Jerry'],
    truck_assignments: { Eli: 'small-crane', Jerry: '2019-bucket' },
  });

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(target.tags.get('sws_truck_assignments_v1')), {
    Eli: 'small-crane',
    Jerry: '2019-bucket',
  });
  assert.deepEqual(JSON.parse(eliJob.tags.get('sws_truck_assignments_v1')), {
    Eli: 'small-crane',
  });
  assert.deepEqual(JSON.parse(jerryJob.tags.get('sws_truck_assignments_v1')), {
    Jerry: '2019-bucket',
    Johnny: 'big-crane',
  });
  assert.equal(target.description(), [
    'Truck Assignment:',
    '• Eli - Small Crane',
    '• Jerry - 2019 Bucket',
  ].join('\n'));
  assert.equal(eliJob.description(), [
    'Truck Assignment:',
    '• Eli - Small Crane',
  ].join('\n'));
  assert.equal(jerryJob.description(), [
    'Truck Assignment:',
    '• Johnny - Big Crane',
    '• Jerry - 2019 Bucket',
  ].join('\n'));
  assert.equal(nextDayJob.tags.has('sws_truck_assignments_v1'), false);
});

test('unscheduled jobs reserve column eight for truck assignment JSON', () => {
  assert.match(unscheduledSource, /getRange\(1,\s*8\)/);
  assert.match(unscheduledSource, /setValue\(['"]Truck Assignments['"]\)/);
  assert.match(unscheduledSource, /truck_assignments:\s*normalizeStoredTruckAssignments_\(row\[7\]\)/);
  assert.match(unscheduledSource, /getRange\(i \+ 1,\s*8\)\.setValue/);
});

test('unscheduled jobs round-trip truck assignments through sheet column eight', () => {
  const rows = [['Job #', 'Job Name', 'Address', 'Added', 'ID', 'Added By', 'Crew', 'Truck Assignments']];
  const sheet = {
    getDataRange: () => ({ getValues: () => rows.map(row => [...row]) }),
    appendRow: row => rows.push([...row]),
    getRange(row, column) {
      return {
        getValue: () => rows[row - 1]?.[column - 1] || '',
        setValue(value) {
          while (rows.length < row) rows.push([]);
          rows[row - 1][column - 1] = value;
        },
      };
    },
  };
  const context = assignmentContext({
    SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getSheetId: () => 0, ...sheet }] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });

  const added = context.addUnsched({
    job_num: '123456', title: 'Monument Sign', address: '100 Main St', added_by: 'Jake',
    crew: ['Johnny', 'Eli'],
    truck_assignments: { Johnny: 'big-crane', Eli: 'big-crane' },
  });

  assert.equal(added.success, true);
  assert.deepEqual(JSON.parse(rows[1][7]), { Johnny: 'big-crane', Eli: 'big-crane' });
  const loaded = context.getUnsched();
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.jobs[0].truck_assignments)), {
    Johnny: 'big-crane',
    Eli: 'big-crane',
  });
});

test('the combined assignment route remains admin-only', () => {
  assert.match(routingSource, /data\.action === 'updateScheduledAssignments'/);
  assert.match(routingSource, /updateScheduledAssignments\(data\)/);
  assert.doesNotMatch(routingSource, /data\.role/);
});

test('all crew editing surfaces expose truck assignment controls', () => {
  assert.match(frontendHtml, /id="unscheduled-truck-assignments"/);
  assert.match(frontendHtml, /id="schedule-truck-assignments"/);
  assert.match(frontendHtml, /id="scheduled-truck-assignments"/);
  assert.match(frontendSource, /function renderTruckAssignmentRows\(/);
  assert.match(frontendSource, /action:\s*'updateScheduledAssignments'/);
  assert.match(frontendSource, /truck_assignments:\s*getUnscheduledTruckAssignments\(\)/);
  assert.match(frontendSource, /truck_assignments:\s*getScheduleTruckAssignments\(\)/);
  assert.match(frontendSource, /truck_assignments:\s*getScheduledTruckAssignments\(\)/);
});

test('job cards and lists include a truck assignment summary', () => {
  assert.match(frontendSource, /function truckAssignmentsHTML\(/);
  assert.match(frontendSource, /truckAssignmentsHTML\(job\.crew\s*\|\|\s*\[\],\s*job\.truck_assignments/);
});

test('the scheduled assignment editor reloads all jobs after daily propagation', () => {
  assert.match(frontendSource, /closeScheduledCrewEditor\(\);\s*return loadJobs\(\);/);
});
