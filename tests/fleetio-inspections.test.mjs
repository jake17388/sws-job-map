import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

let fleetioSource = '';
try {
  fleetioSource = readFileSync(new URL('../src/backend/13-fleetio-inspections.js', import.meta.url), 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const triggerSource = readFileSync(
  new URL('../src/backend/08-current-jobs-sheet-cont.js', import.meta.url),
  'utf8',
);

function fleetioContext(globals = {}) {
  const context = vm.createContext({ console, Date, Map, Set, ...globals });
  vm.runInContext(fleetioSource, context);
  return context;
}

test('Fleetio rows map AM and PM inspections to KPI crew names and dates', () => {
  const context = fleetioContext();
  const inspections = context.parseFleetioInspectionRows_([
    ['Date', 'Inspection Form', 'Duration', 'Failed Items', 'Vehicle', 'User'],
    ['11/16/2026 12:59 PM', 'PM Truck', '0.00057', '', '2019 Single Bucket', 'Jerry Jumper'],
    ['11/16/2026 6:13 AM', 'AM Truck', '0.001866', '', '2019 Single Bucket', 'Jerry Jumper'],
    ['11/16/2026 4:48 AM', 'AM Truck', '0.000795', '', '2022 Altec Crane', 'Eli Ruiz'],
    ['11/16/2026 6:00 AM', 'Other Form', '', '', '2022 Altec Crane', 'Eli Ruiz'],
    ['bad date', 'PM Truck', '', '', '2025 Double Bucket', 'Johnny Martinez'],
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(Array.from(inspections.entries()))), [
    ['Jerry|2026-11-16', { am: true, pm: true }],
    ['Eli|2026-11-16', { am: true, pm: false }],
  ]);
});

test('Fleetio planning checks every matching KPI row and clears missing inspections for reported dates', () => {
  const context = fleetioContext();
  const rows = [
    ['Monday', new Date(2026, 10, 16), 'Jerry', '260101', '', '', '', '', '', '', '', '', '', false, false, false],
    ['Monday', new Date(2026, 10, 16), 'Jerry', '260102', '', '', '', '', '', '', '', '', '', true, false, false],
    ['Monday', new Date(2026, 10, 16), 'Eli', '260103', '', '', '', '', '', '', '', '', '', false, false, true],
    ['Monday', new Date(2026, 10, 16), 'Johnny', '260104', '', '', '', '', '', '', '', '', '', false, true, true],
    ['Tuesday', new Date(2026, 10, 17), 'Jerry', '260105', '', '', '', '', '', '', '', '', '', false, true, true],
  ];
  const inspections = new Map([
    ['Jerry|2026-11-16', { am: true, pm: true }],
    ['Eli|2026-11-16', { am: true, pm: false }],
  ]);

  const plan = context.planKpiFleetioInspectionSync_(rows, inspections, new Set(['2026-11-16']));

  assert.deepEqual(Array.from(plan.values, row => [...row]), [
    [true, true],
    [true, true],
    [true, false],
    [false, false],
    [true, true],
  ]);
  assert.equal(plan.updated, 4);
  assert.equal(plan.matchedCrewDates, 2);
});

test('hourly KPI refresh imports Fleetio inspections without blocking other syncs', () => {
  const calls = [];
  const context = vm.createContext({
    Date,
    INSTALL_CAL_ID: 'install-calendar',
    Logger: { log: message => calls.push(message) },
    fetchCalendarEvents: () => [{ num: '260101' }],
    getUnscheduledJobs_: () => [],
    squarecoilInstallHoursByJob_: () => new Map(),
    syncInstallJobsToKpi_: () => ({ success: true, created: 1 }),
    syncUkgDailyHoursFromEmail_: () => ({ success: true, updated: 2 }),
    syncFleetioInspectionsFromEmail_: () => ({ success: true, updated: 4 }),
  });
  vm.runInContext(triggerSource, context);

  const result = context.refreshInstallKpiFromCalendar_();

  assert.equal(result.created, 1);
  assert.deepEqual({ ...result.fleetio }, { success: true, updated: 4 });
});

test('recent Fleetio CSV attachments are read through the shared Gmail read-only API', () => {
  const requests = [];
  const responseByPath = new Map([
    ['messages/new-message?format=full', {
      payload: {
        parts: [{
          filename: 'Fleetio Daily Report_2026_11_17.csv',
          mimeType: 'text/csv',
          body: { attachmentId: 'csv-a' },
        }],
      },
    }],
    ['messages/new-message/attachments/csv-a', { data: 'Y3N2' }],
  ]);
  const context = fleetioContext({
    gmailReadOnlyApiGet_(path) {
      requests.push(path);
      if (path.startsWith('messages?q=')) {
        assert.match(decodeURIComponent(path), /Fleetio Daily Report/);
        return { messages: [{ id: 'new-message' }] };
      }
      const response = responseByPath.get(path);
      if (!response) throw new Error(`Unexpected path: ${path}`);
      return response;
    },
    Utilities: {
      base64DecodeWebSafe: value => [`decoded:${value}`],
      newBlob(bytes, contentType, name) {
        return { bytes, contentType, name };
      },
    },
  });

  const found = context.fleetioCsvAttachments_();

  assert.equal(found.length, 1);
  assert.equal(found[0].messageId, 'new-message');
  assert.equal(found[0].attachment.name, 'Fleetio Daily Report_2026_11_17.csv');
  assert.deepEqual(requests, [
    `messages?q=${encodeURIComponent('from:notifications@fleetio.com subject:"[Report] Fleetio Daily Report" has:attachment newer_than:30d')}&maxResults=10`,
    'messages/new-message?format=full',
    'messages/new-message/attachments/csv-a',
  ]);
});

test('the manual Fleetio setup requests only Gmail read access', () => {
  const requested = [];
  const context = fleetioContext({
    ScriptApp: {
      AuthMode: { FULL: 'FULL' },
      requireScopes: (mode, scopes) => requested.push({ mode, scopes: [...scopes] }),
    },
  });
  context.syncFleetioInspectionsFromEmail_ = () => ({ success: true, updated: 0 });

  const result = context.authorizeAndSyncFleetioInspections();

  assert.deepEqual({ ...result }, { success: true, updated: 0 });
  assert.deepEqual(requested, [{
    mode: 'FULL',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  }]);
});
