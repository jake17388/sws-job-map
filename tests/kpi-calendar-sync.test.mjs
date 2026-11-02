import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('../src/backend/01-config.js', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const unscheduledSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const kpiSource = readFileSync(new URL('../src/backend/10-kpi-log.js', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const currentJobsSource = readFileSync(new URL('../src/backend/06-current-jobs-sheet.js', import.meta.url), 'utf8');
const frontendHtml = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

const roster = [
  { id: 'crane-1', displayName: '2022 Crane', active: true },
  { id: 'flatbed-1', displayName: '2026 Flatbed', active: true },
];

function backendContext() {
  const context = vm.createContext({ console, Date });
  vm.runInContext(
    `const VEHICLE_ROSTER = ${JSON.stringify(roster)};\n${configSource}\n${calendarSource}\n${unscheduledSource}\n${kpiSource}`,
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

test('multi-day install events expand to one pending row per date and crew member', () => {
  const context = backendContext();
  const seeds = context.buildKpiSeedRows_([job()]);

  assert.equal(seeds.length, 4);
  assert.deepEqual(seeds.map(seed => seed.key), [
    'event-1|2026-11-02|Johnny',
    'event-1|2026-11-02|Eli',
    'event-1|2026-11-03|Johnny',
    'event-1|2026-11-03|Eli',
  ]);
  assert.equal(seeds[0].values[0] instanceof Date, true);
  assert.equal(seeds[0].values[1], 'Johnny');
  assert.equal(seeds[0].values[2], '123456');
  assert.equal(seeds[0].values[3], 'Monument Sign');
  assert.equal(seeds[0].values[4], '2022 Crane');
  assert.equal(seeds[0].values[9], 'Pending');
  assert.equal(seeds[0].values[25], 'event-1|2026-11-02|Johnny');
});

test('events without crew do not create KPI rows', () => {
  const context = backendContext();
  assert.deepEqual(Array.from(context.buildKpiSeedRows_([job({ crew: [] })])), []);
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
  existing[7] = 4.5;
  existing[8] = 'Install cabinet';
  existing[9] = 'Partial';
  existing[10] = 'Waiting on electrical';
  existing[25] = 'event-1|2026-11-02|Johnny';

  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02' }),
  ], [existing]);

  assert.equal(plan.rowsToAppend.length, 1);
  assert.equal(plan.rowsToAppend[0][1], 'Eli');
  assert.equal(plan.rowsToUpdate.length, 0);
  assert.equal(existing[6], 90);
  assert.equal(existing[9], 'Partial');
  assert.equal(existing[10], 'Waiting on electrical');
});

test('KPI entry validation accepts sheet statuses and non-negative estimates', () => {
  const context = backendContext();
  const valid = context.validateKpiEntry_({
    event_id: 'event-1', work_date: '2026-11-02', crew_member: 'Johnny',
    estimated_drive_minutes: '90', estimated_work_hours: '4.5',
    expected_work: 'Install cabinet', completion_status: 'Partial', notes: 'Waiting on electrical',
  });

  assert.equal(valid.error, undefined);
  assert.equal(valid.value.estimated_drive_minutes, 90);
  assert.equal(valid.value.estimated_work_hours, 4.5);

  for (const [overrides, message] of [
    [{ completion_status: 'Maybe' }, 'completion status'],
    [{ estimated_drive_minutes: '-1' }, 'drive minutes'],
    [{ estimated_work_hours: '-0.5' }, 'work hours'],
    [{ crew_member: 'Unknown' }, 'crew member'],
  ]) {
    const result = context.validateKpiEntry_({ ...valid.value, ...overrides });
    assert.match(result.error, new RegExp(message, 'i'));
  }
});

test('KPI sync and entry routes remain admin-only', () => {
  for (const action of ['syncInstallKpi', 'getKpiEntry', 'saveKpiEntry']) {
    assert.match(routingSource, new RegExp(`data\\.action === '${action}'`));
  }
  assert.doesNotMatch(routingSource, /data\.role/);
});

test('the daily Current Jobs refresh also seeds KPI rows', () => {
  assert.match(currentJobsSource, /syncInstallJobsToKpi_\(installJobs\)/);
});

test('scheduled install cards expose the KPI editor and automatic sync', () => {
  assert.match(frontendHtml, /id="kpi-entry-panel"/);
  assert.match(frontendHtml, /id="kpi-work-date"/);
  assert.match(frontendHtml, /id="kpi-crew-member"/);
  assert.match(frontendHtml, /id="kpi-completion-status"/);
  assert.match(frontendSource, /function openKpiEntry\(index\)/);
  assert.match(frontendSource, /action:\s*'syncInstallKpi'/);
  assert.match(frontendSource, /action:\s*'getKpiEntry'/);
  assert.match(frontendSource, /action:\s*'saveKpiEntry'/);
  assert.match(frontendSource, /Daily KPI/);
});
