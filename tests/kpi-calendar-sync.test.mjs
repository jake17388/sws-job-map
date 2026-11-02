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
  assert.equal(seeds[0].values[0] instanceof Date, true);
  assert.equal(seeds[0].values[0].getHours(), 12);
  assert.equal(seeds[0].values[1], 'Johnny');
  assert.equal(seeds[0].values[2], '123456');
  assert.equal(seeds[0].values[3], 'Monument Sign');
  assert.equal(seeds[0].values[4], '2022 Crane');
  assert.equal(seeds[0].values[6], 42);
  assert.equal(seeds[0].values[9], '');
  assert.equal(seeds[0].values[10], false);
  assert.equal(seeds[0].values[26], 'event-1|2026-11-02|Johnny');
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

test('new KPI rows receive the calculated drive estimate in column H', () => {
  const context = backendContext();
  const estimates = new Map([['1150 n dobson rd, chandler, az 85224', 2.1]]);
  const seeds = context.buildKpiSeedRows_([
    job({ addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], estimates);
  assert.equal(seeds[0].values[7], 2.1);
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

test('sync planning is idempotent and preserves entered KPI results', () => {
  const context = backendContext();
  const existing = Array(26).fill('');
  existing[0] = new Date(2026, 10, 2);
  existing[1] = 'Johnny';
  existing[2] = '123456';
  existing[3] = 'Monument Sign';
  existing[4] = '2022 Crane';
  existing[6] = 90;
  existing[7] = 2.1;
  existing[8] = 4.5;
  existing[9] = 3.75;
  existing[10] = true;
  existing[11] = 'Waiting on electrical';
  existing[26] = 'event-1|2026-11-02|Johnny';

  const estimates = new Map([['1150 n dobson rd, chandler, az 85224', 2.1]]);
  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], [existing], estimates, new Map([['123456', 42]]));

  assert.equal(plan.rowsToAppend.length, 1);
  assert.equal(plan.rowsToAppend[0][1], 'Eli');
  assert.equal(plan.rowsToUpdate.length, 1);
  assert.equal(plan.rowsToDriveUpdate.length, 0);
  assert.deepEqual(Array.from(plan.rowsToJobHoursUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 42 },
  ]);
  assert.equal(plan.rowsToUpdate[0].values[0].getHours(), 12);
  assert.equal(plan.rowsToAppend[0][6], 42);
  assert.equal(plan.rowsToAppend[0][7], 2.1);
  assert.equal(existing[8], 4.5);
  assert.equal(existing[9], 3.75);
  assert.equal(existing[10], true);
  assert.equal(existing[11], 'Waiting on electrical');
});

test('sync planning fills a blank drive estimate without overwriting other KPI fields', () => {
  const context = backendContext();
  const existing = Array(26).fill('');
  existing[0] = new Date(2026, 10, 2, 12);
  existing[1] = 'Johnny';
  existing[2] = '123456';
  existing[3] = 'Monument Sign';
  existing[4] = '2022 Crane';
  existing[8] = 4.5;
  existing[10] = false;
  existing[26] = 'event-1|2026-11-02|Johnny';
  const estimates = new Map([['1150 n dobson rd, chandler, az 85224', 2.1]]);

  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', crew: ['Johnny'], addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], [existing], estimates, new Map());

  assert.deepEqual(Array.from(plan.rowsToDriveUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 2.1 },
  ]);
  assert.equal(existing[8], 4.5);
  assert.equal(existing[10], false);
});

test('job-hour backfill repeats each Squarecoil total on every matching KPI row', () => {
  const context = backendContext();
  const rows = [
    ['', '', '260242', '', '', '', ''],
    ['', '', '260242', '', '', '', ''],
    ['', '', '999999', '', '', '', 7],
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

test('scheduled jobs sync to the Sheet without KPI entry controls', () => {
  assert.match(frontendSource, /action:\s*'syncInstallKpi'/);
  assert.doesNotMatch(frontendHtml, /id="kpi-entry-panel"/);
  assert.doesNotMatch(frontendSource, /function openKpiEntry\(/);
  assert.doesNotMatch(frontendSource, /action:\s*'getKpiEntry'/);
  assert.doesNotMatch(frontendSource, /action:\s*'saveKpiEntry'/);
  assert.doesNotMatch(frontendSource, />Daily KPI</);
});
