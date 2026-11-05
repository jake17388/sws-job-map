import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('../src/backend/01-config.js', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const unscheduledSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const kpiSource = readFileSync(new URL('../src/backend/10-kpi-log.js', import.meta.url), 'utf8');
let squarecoilSource = '';
try {
  squarecoilSource = readFileSync(new URL('../src/backend/11-squarecoil-estimates.js', import.meta.url), 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const routingSource = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const currentJobsSource = readFileSync(new URL('../src/backend/06-current-jobs-sheet.js', import.meta.url), 'utf8');
const triggerSource = readFileSync(new URL('../src/backend/08-current-jobs-sheet-cont.js', import.meta.url), 'utf8');
const frontendHtml = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

const roster = [
  { id: 'crane-1', displayName: '2022 Crane', active: true },
  { id: 'flatbed-1', displayName: '2026 Flatbed', active: true },
];

function backendContext(globals = {}) {
  const context = vm.createContext({ console, Date, ...globals });
  vm.runInContext(
    `const VEHICLE_ROSTER = ${JSON.stringify(roster)};\n${configSource}\n${calendarSource}\n${unscheduledSource}\n${kpiSource}\n${squarecoilSource}`,
    context,
  );
  return context;
}

function job(overrides = {}) {
  return {
    type: 'install',
    event_id: 'event-1',
    num: '123456',
    title: 'Monument Sign',
    start: '2026-11-02',
    end: '2026-11-03',
    crew: ['Johnny', 'Eli'],
    truck_assignments: { Johnny: 'crane-1', Eli: 'flatbed-1' },
    ...overrides,
  };
}

test('multi-day install events expand to one unchecked row per date and crew member', () => {
  const context = backendContext();
  const seeds = context.buildKpiSeedRows_([job()], new Map(), new Map([['123456', 42]]));

  assert.equal(seeds.length, 4);
  assert.deepEqual(Array.from(seeds, seed => seed.key), [
    'event-1|2026-11-02|Johnny',
    'event-1|2026-11-02|Eli',
    'event-1|2026-11-03|Johnny',
    'event-1|2026-11-03|Eli',
  ]);
  assert.equal(seeds[0].values[0], 'Monday');
  assert.equal(seeds[0].values[1] instanceof Date, true);
  assert.equal(seeds[0].values[1].getHours(), 12);
  assert.equal(seeds[0].values[2], 'Johnny');
  assert.equal(seeds[0].values[3], '123456');
  assert.equal(seeds[0].values[4], 'Monument Sign');
  assert.equal(seeds[0].values[5], '2022 Crane');
  assert.equal(seeds[0].values[7], 42);
  assert.equal(seeds[0].values[10], '');
  assert.equal(seeds[0].values[11], false);
  assert.equal(seeds[0].values[27], 'event-1|2026-11-02|Johnny');
});

test('events without crew do not create KPI rows', () => {
  const context = backendContext();
  assert.deepEqual(Array.from(context.buildKpiSeedRows_([job({ crew: [] })])), []);
});

test('drive estimates add five percent, include the return trip, and use decimal hours', () => {
  const context = backendContext();
  assert.equal(context.adjustedDriveHours_(3600), 2.1);
  assert.equal(context.adjustedDriveHours_(1810), 1.06);
  assert.equal(context.adjustedDriveHours_(0), '');
});

test('recommended install days allow one long first day then use nine-hour days', () => {
  const context = backendContext();
  assert.equal(context.recommendedInstallDays_(0), null);
  assert.equal(context.recommendedInstallDays_(8), 1);
  assert.equal(context.recommendedInstallDays_(10), 1);
  assert.equal(context.recommendedInstallDays_(10.01), 2);
  assert.equal(context.recommendedInstallDays_(18), 2);
  assert.equal(context.recommendedInstallDays_(18.01), 3);
});

test('calendar addresses are routed once per unique destination', () => {
  let requestCount = 0;
  const directions = {
    setOrigin(value) { assert.equal(value, '4049 E Presidio St, Mesa, AZ 85215'); return this; },
    setDestination(value) { assert.equal(value, '1150 N Dobson Rd, Chandler, AZ 85224'); return this; },
    setMode(value) { assert.equal(value, 'DRIVING'); return this; },
    getDirections() {
      requestCount += 1;
      return { routes: [{ legs: [{ duration: { value: 3600 } }] }] };
    },
  };
  const context = backendContext({
    Maps: {
      DirectionFinder: { Mode: { DRIVING: 'DRIVING' } },
      newDirectionFinder: () => directions,
    },
  });
  const estimates = context.estimateDriveHoursByAddress_([
    job({ addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
    job({ event_id: 'event-2', addr: ' 1150 N Dobson Rd,   Chandler, AZ 85224 ' }),
  ]);

  assert.equal(requestCount, 1);
  assert.equal(estimates.get('1150 n dobson rd, chandler, az 85224'), 2.1);
});

test('missing directions leave the drive estimate blank', () => {
  const context = backendContext({
    Maps: {
      DirectionFinder: { Mode: { DRIVING: 'DRIVING' } },
      newDirectionFinder: () => ({
        setOrigin() { return this; }, setDestination() { return this; }, setMode() { return this; },
        getDirections() { return { routes: [] }; },
      }),
    },
  });
  const estimates = context.estimateDriveHoursByAddress_([job({ addr: 'Unknown address' })]);
  assert.equal(estimates.get('unknown address'), '');
});

test('drive estimate cache failures do not interrupt routing', () => {
  const context = backendContext({
    CacheService: { getScriptCache: () => ({ get() { throw new Error('cache unavailable'); } }) },
    Maps: {
      DirectionFinder: { Mode: { DRIVING: 'DRIVING' } },
      newDirectionFinder: () => ({
        setOrigin() { return this; }, setDestination() { return this; }, setMode() { return this; },
        getDirections() { return { routes: [{ legs: [{ duration: { value: 3600 } }] }] }; },
      }),
    },
  });
  const estimates = context.estimateDriveHoursByAddress_([
    job({ addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ]);
  assert.equal(estimates.get('1150 n dobson rd, chandler, az 85224'), 2.1);
});

test('drive estimate cache keys include the entire normalized address', () => {
  const context = backendContext();
  const sharedPrefix = '123 very long destination '.repeat(12);
  assert.notEqual(
    context.driveEstimateCacheKey_(`${sharedPrefix}suite a`),
    context.driveEstimateCacheKey_(`${sharedPrefix}suite b`),
  );
  assert.match(context.driveEstimateCacheKey_('mesa'), /^install_drive_v2:/);
});

test('new KPI rows receive the calculated drive estimate in column I', () => {
  const context = backendContext();
  const estimates = new Map([['1150 n dobson rd, chandler, az 85224', 2.1]]);
  const seeds = context.buildKpiSeedRows_([
    job({ addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], estimates);
  assert.equal(seeds[0].values[8], 2.1);
});

test('Squarecoil estimate pages sum install labor and exclude project management', () => {
  const context = backendContext();
  const html = `
    <table>
      <tr><th>Description</th><th>Notes</th><th>Hours</th><th>Rate</th><th>Amount</th></tr>
      <tr><td>Project management</td><td></td><td>2</td><td></td><td></td></tr>
      <tr><td>Installation</td><td></td><td>12</td><td></td><td></td></tr>
      <tr><td>Install (2)</td><td></td><td>1.5</td><td></td><td></td></tr>
      <tr><td>Installation&nbsp; work truck</td><td></td><td>12</td><td></td><td></td></tr>
      <tr><td>Installation Bucket truck</td><td></td><td>12</td><td></td><td></td></tr>
      <tr><td>Installation Crane Truck</td><td></td><td>0</td><td></td><td></td></tr>
      <tr><td>Loading / Unloading</td><td></td><td>2</td><td></td><td></td></tr>
      <tr><td>Electrician</td><td></td><td>4</td><td></td><td></td></tr>
      <tr><td>Total</td><td></td><td>45.5</td><td></td><td></td></tr>
    </table>`;

  assert.equal(context.squarecoilInstallHoursFromEstimateHtml_(html), 39.5);
});

test('Squarecoil estimate list parsing returns unique estimate ids for the job', () => {
  const context = backendContext();
  const html = `
    <a href="project_estimates.php?id=260242&amp;estimateid=19811">260242-03</a>
    <a href='project_estimates.php?estimateid=19812&amp;id=260242'>260242-04</a>
    <a href="project_estimates.php?id=260242&amp;estimateid=19811">duplicate</a>
    <a href="project_estimates.php?id=999999&amp;estimateid=77">other job</a>`;

  assert.deepEqual(Array.from(context.squarecoilEstimateIdsFromHtml_(html, '260242')), ['19811', '19812']);
});

test('the split Install Log starts with its assignment section and row-three header', () => {
  assert.match(kpiSource, /const KPI_HEADER_ROW = 3;/);
  assert.match(kpiSource, /const KPI_FIRST_DATA_ROW = 4;/);
});

test('the KPI sync migrates the live sheet to a Day column exactly once', () => {
  const context = backendContext();
  let header = 'Date';
  let insertedAt = null;
  let dayValues = null;
  const dates = [new Date(2026, 10, 2, 12), '', new Date(2026, 10, 8, 12)];
  const sheet = {
    getLastRow: () => 6,
    insertColumnBefore(column) { insertedAt = column; },
    getRange(row, column, rowCount, columnCount) {
      if (row === 3 && column === 1) {
        return {
          getValue: () => header,
          setValue(value) { header = value; },
        };
      }
      if (row === 4 && column === 2 && rowCount === 3 && columnCount === 1) {
        return { getValues: () => dates.map(value => [value]) };
      }
      if (row === 4 && column === 1 && rowCount === 3 && columnCount === 1) {
        return { setValues(values) { dayValues = values; } };
      }
      throw new Error(`Unexpected range: ${row},${column},${rowCount},${columnCount}`);
    },
  };

  context.ensureKpiDayColumn_(sheet);
  context.ensureKpiDayColumn_(sheet);

  assert.equal(insertedAt, 1);
  assert.equal(header, 'Day');
  assert.deepEqual(Array.from(dayValues, row => row[0]), ['Monday', '', 'Sunday']);
});

test('sync planning is idempotent and preserves entered KPI results', () => {
  const context = backendContext();
  const existing = Array(28).fill('');
  existing[0] = 'Monday';
  existing[1] = new Date(2026, 10, 2);
  existing[2] = 'Johnny';
  existing[3] = '123456';
  existing[4] = 'Monument Sign';
  existing[5] = '2022 Crane';
  existing[7] = 90;
  existing[8] = 2.1;
  existing[9] = 4.5;
  existing[10] = 3.75;
  existing[11] = true;
  existing[12] = 'Waiting on electrical';
  existing[27] = 'event-1|2026-11-02|Johnny';

  const estimates = new Map([['1150 n dobson rd, chandler, az 85224', 2.1]]);
  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], [existing], estimates, new Map([['123456', 42]]));

  assert.equal(plan.rowsToAppend.length, 1);
  assert.equal(plan.rowsToAppend[0][2], 'Eli');
  assert.equal(plan.rowsToUpdate.length, 1);
  assert.equal(plan.rowsToDriveUpdate.length, 0);
  assert.deepEqual(Array.from(plan.rowsToJobHoursUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 42 },
  ]);
  assert.equal(plan.rowsToUpdate[0].values[0], 'Monday');
  assert.equal(plan.rowsToUpdate[0].values[1].getHours(), 12);
  assert.equal(plan.rowsToAppend[0][7], 42);
  assert.equal(plan.rowsToAppend[0][8], 2.1);
  assert.equal(existing[9], 4.5);
  assert.equal(existing[10], 3.75);
  assert.equal(existing[11], true);
  assert.equal(existing[12], 'Waiting on electrical');
});

test('sync planning fills a blank drive estimate without overwriting other KPI fields', () => {
  const context = backendContext();
  const existing = Array(28).fill('');
  existing[0] = 'Monday';
  existing[1] = new Date(2026, 10, 2, 12);
  existing[2] = 'Johnny';
  existing[3] = '123456';
  existing[4] = 'Monument Sign';
  existing[5] = '2022 Crane';
  existing[9] = 4.5;
  existing[11] = false;
  existing[27] = 'event-1|2026-11-02|Johnny';
  const estimates = new Map([['1150 n dobson rd, chandler, az 85224', 2.1]]);

  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', crew: ['Johnny'], addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], [existing], estimates, new Map());

  assert.deepEqual(Array.from(plan.rowsToDriveUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 2.1 },
  ]);
  assert.equal(existing[9], 4.5);
  assert.equal(existing[11], false);
});

test('sync planning writes a legitimate zero-hour Squarecoil total into a blank cell', () => {
  const context = backendContext();
  const existing = Array(28).fill('');
  existing[0] = 'Monday';
  existing[1] = new Date(2026, 10, 2, 12);
  existing[2] = 'Johnny';
  existing[3] = '123456';
  existing[4] = 'Monument Sign';
  existing[5] = '2022 Crane';
  existing[11] = false;
  existing[27] = 'event-1|2026-11-02|Johnny';

  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', crew: ['Johnny'] }),
  ], [existing], new Map(), new Map([['123456', 0]]));

  assert.deepEqual(Array.from(plan.rowsToJobHoursUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 0 },
  ]);
});

test('job-hour backfill repeats each Squarecoil total on every matching KPI row', () => {
  const context = backendContext();
  const rows = [
    ['', '', '', '260242', '', '', '', ''],
    ['', '', '', '260242', '', '', '', ''],
    ['', '', '', '999999', '', '', '', 7],
  ];
  const plan = context.planKpiJobHoursBackfill_(rows, new Map([['260242', 102]]));

  assert.deepEqual(Array.from(plan.values, row => row[0]), [102, 102, 7]);
  assert.equal(plan.updated, 2);
});

test('only the admin-only KPI sync route is exposed', () => {
  assert.match(routingSource, /data\.action === 'syncInstallKpi'/);
  assert.match(routingSource, /data\.action === 'refreshKpiJobTotals'/);
  assert.doesNotMatch(routingSource, /data\.action === 'getKpiEntry'/);
  assert.doesNotMatch(routingSource, /data\.action === 'saveKpiEntry'/);
  assert.doesNotMatch(kpiSource, /function getKpiEntry\(/);
  assert.doesNotMatch(kpiSource, /function saveKpiEntry\(/);
  assert.doesNotMatch(routingSource, /data\.role/);
});

test('the daily Current Jobs refresh also seeds KPI rows', () => {
  assert.match(currentJobsSource, /syncInstallJobsToKpi_\(installJobs\)/);
});

test('an hourly trigger keeps the KPI log current with the install calendar', () => {
  const deleted = [];
  const created = [];
  const synced = [];
  const estimateRefreshes = [];
  const triggers = [
    { getHandlerFunction: () => 'refreshInstallKpiFromCalendar_' },
    { getHandlerFunction: () => 'refreshCurrentJobs' },
  ];
  const context = vm.createContext({
    Date,
    INSTALL_CAL_ID: 'install-calendar',
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: trigger => deleted.push(trigger.getHandlerFunction()),
      newTrigger(handler) {
        const plan = { handler };
        created.push(plan);
        return {
          timeBased() { plan.timeBased = true; return this; },
          everyHours(hours) { plan.hours = hours; return this; },
          create() { plan.created = true; return this; },
        };
      },
    },
    fetchCalendarEvents(calendarId, type) {
      assert.equal(calendarId, 'install-calendar');
      assert.equal(type, 'install');
      return [job()];
    },
    getUnscheduledJobs_() {
      return [{ job_num: '654321' }];
    },
    squarecoilInstallHoursByJob_(jobNums, forceRefresh) {
      estimateRefreshes.push({ jobNums: [...jobNums], forceRefresh });
      return new Map();
    },
    syncInstallJobsToKpi_(jobs) {
      synced.push(jobs);
      return { success: true, created: jobs.length };
    },
  });
  vm.runInContext(triggerSource, context);

  const result = context.setupInstallKpiSyncTrigger();

  assert.deepEqual(deleted, ['refreshInstallKpiFromCalendar_']);
  assert.deepEqual(created, [{
    handler: 'refreshInstallKpiFromCalendar_',
    timeBased: true,
    hours: 1,
    created: true,
  }]);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].length, 1);
  assert.deepEqual(estimateRefreshes, [{
    jobNums: ['123456', '654321'],
    forceRefresh: false,
  }]);
  assert.equal(result.created, 1);
});

test('manual estimate refresh force-loads current scheduled and unscheduled job totals', () => {
  const estimateRefreshes = [];
  const context = vm.createContext({
    Date,
    INSTALL_CAL_ID: 'install-calendar',
    isSquarecoilEstimateConfigured_: () => true,
    fetchCalendarEvents: () => [job(), job({ num: '123456' })],
    getUnscheduledJobs_: () => [{ job_num: '654321' }, { job_num: 'bad' }],
    squarecoilInstallHoursByJob_(jobNums, forceRefresh) {
      estimateRefreshes.push({ jobNums: [...jobNums], forceRefresh });
      return new Map([['123456', 42], ['654321', 18]]);
    },
  });
  vm.runInContext(triggerSource, context);

  const result = context.refreshJobMapEstimatedHours_();

  assert.deepEqual(estimateRefreshes, [{
    jobNums: ['123456', '654321'],
    forceRefresh: true,
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: true,
    jobs_requested: 2,
    jobs_resolved: 2,
  });
});

test('scheduled jobs sync to the Sheet without KPI entry controls', () => {
  assert.doesNotMatch(frontendSource, /action:\s*'syncInstallKpi'/);
  assert.doesNotMatch(frontendHtml, /id="kpi-entry-panel"/);
  assert.doesNotMatch(frontendSource, /function openKpiEntry\(/);
  assert.doesNotMatch(frontendSource, /action:\s*'getKpiEntry'/);
  assert.doesNotMatch(frontendSource, /action:\s*'saveKpiEntry'/);
  assert.doesNotMatch(frontendSource, />Daily KPI</);
});
