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

test('calendar crew parsing recognizes known names even when a separator is missing', () => {
  const context = backendContext();

  assert.deepEqual(
    Array.from(context.crewFromCalendarTitle_('(Eli/Johnny/RandyCaden) 261498 Mission Manor')),
    ['Johnny', 'Eli', 'Randy', 'Caden'],
  );
});

test('multi-day install events expand to one unchecked row per date and crew member', () => {
  const context = backendContext();
  const seeds = context.buildKpiSeedRows_(
    [job({ addr: '1150 N Dobson Rd, Chandler, AZ 85224' })],
    new Map([['123456', 42]]),
  );

  assert.equal(seeds.length, 4);
  assert.deepEqual(Array.from(seeds, seed => seed.key), [
    'event-1|2026-11-02|Johnny',
    'event-1|2026-11-02|Eli',
    'event-1|2026-11-03|Johnny',
    'event-1|2026-11-03|Eli',
  ]);
  assert.equal(seeds[0].values[0], 'Monday');
  assert.equal(seeds[0].values[1] instanceof Date, true);
  assert.equal(seeds[0].values[1].toISOString(), '2026-11-02T12:00:00.000Z');
  assert.equal(context.kpiSheetDateSerial_(seeds[0].values[1]), 46328);
  assert.equal(seeds[0].values[2], 'Johnny');
  assert.equal(seeds[0].values[3], '123456');
  assert.equal(seeds[0].values[4], 'Monument Sign');
  assert.equal(seeds[0].values[5], '2022 Crane');
  assert.equal(seeds[0].values[7], '');
  assert.equal(seeds[0].values[8], 42);
  assert.equal(seeds[0].values[9], '');
  assert.equal(seeds[0].values[10], '');
  assert.equal(seeds[0].values[11], '');
  assert.equal(seeds[0].values[12], '');
  assert.equal(seeds[0].values[13], false);
  assert.equal(seeds[0].values[14], false);
  assert.equal(seeds[0].values[15], false);
  assert.equal(seeds[0].values[31], 'event-1|2026-11-02|Johnny');
});

test('saving a Job Map truck assignment updates the matching KPI truck cell immediately', () => {
  const row = Array(32).fill('');
  row[1] = new Date(2026, 10, 10, 12);
  row[2] = 'Johnny';
  row[5] = '';
  row[31] = 'event-1|2026-11-10|Johnny';
  const sheet = {
    getLastRow: () => 2,
    getRange(rowNumber, column, rowCount, columnCount) {
      if (rowNumber === 2 && column === 1 && rowCount === 1 && columnCount === 32) {
        return { getValues: () => [[...row]] };
      }
      if (rowNumber === 2 && column === 6 && rowCount === 1 && columnCount === 1) {
        return { setValue(value) { row[5] = value; } };
      }
      throw new Error(`Unexpected range: ${rowNumber},${column},${rowCount},${columnCount}`);
    },
  };
  const context = backendContext({
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => sheet }),
    },
  });
  context.getKpiSheet_ = () => sheet;
  const event = {
    getId: () => 'event-1',
    getTitle: () => '(Johnny) 123456 Monument Sign',
    getStartTime: () => new Date(2026, 10, 10),
    getEndTime: () => new Date(2026, 10, 11),
  };

  const result = context.syncKpiTruckAssignmentsForCalendarUpdates_([{
    calendarId: context.calendarIdForJobType_('install'),
    event,
    assignments: { Johnny: 'crane-1' },
  }]);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, rows_updated: 1 });
  assert.equal(row[5], '2022 Crane');
});

test('scheduled assignment saves invoke the immediate KPI truck sync', () => {
  assert.match(calendarSource, /syncKpiTruckAssignmentsForCalendarUpdates_\(updates\)/);
});

test('project hours use editable day allocations and no drive-time deduction', () => {
  const context = backendContext();

  assert.equal(
    context.kpiCrewSizeFormulaR1C1_(),
    '=IF(OR(RC[-3]="",RC[-6]=""),"",COUNTIFS(C5,RC[-3],C2,RC[-6]))',
  );
  assert.equal(
    context.kpiEstimatedProjectHoursFormulaR1C1_(),
    '=IF(OR(RC[-2]="",RC[-7]="",RC[-9]="",RC[-3]=""),"",ROUND(MAX(0,RC[-2]/COUNTUNIQUEIFS(C2,C4,RC[-7])/RC[-3]),2))',
  );
  assert.equal(
    context.kpiDayAllocationFormulaR1C1_(),
    '=IF(OR(RC[-7]="",RC[-8]=""),"",1/COUNTIFS(C3,RC[-7],C2,RC[-8]))',
  );
  assert.equal(
    context.kpiActualProjectHoursFormulaR1C1_(),
    '=IF(OR(RC[-1]="",RC[-3]=""),"",ROUND(RC[-1]*RC[-3],2))',
  );
  assert.match(kpiSource, /setKpiEstimatedProjectHourFormulas_\(sheet/);
});

test('day allocation defaults only blank rows and preserves manual percentages', () => {
  const context = backendContext();
  const values = [[''], [0.6], ['']];
  const formulas = new Map();
  let numberFormat = '';
  const sheet = {
    getRange(row, column, rowCount = 1, columnCount = 1) {
      if (row === 2 && column === 10 && rowCount === 3 && columnCount === 1) {
        return {
          getValues: () => values,
          setNumberFormat(format) { numberFormat = format; return this; },
        };
      }
      if (column === 10 && rowCount === 1 && columnCount === 1) {
        return { setFormulaR1C1(formula) { formulas.set(row, formula); } };
      }
      throw new Error(`Unexpected range: ${row},${column},${rowCount},${columnCount}`);
    },
  };

  context.setKpiDayAllocationFormulas_(sheet, 2, 3);

  assert.deepEqual(Array.from(formulas.keys()), [2, 4]);
  assert.equal(formulas.get(2), context.kpiDayAllocationFormulaR1C1_());
  assert.equal(values[1][0], 0.6);
  assert.equal(numberFormat, '0.00%');
});

test('events without crew do not create KPI rows', () => {
  const context = backendContext();
  assert.deepEqual(Array.from(context.buildKpiSeedRows_([job({ crew: [] })])), []);
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

test('the Install Log starts with its native table header in row one', () => {
  assert.match(kpiSource, /const KPI_HEADER_ROW = 1;/);
  assert.match(kpiSource, /const KPI_FIRST_DATA_ROW = 2;/);
});

test('the KPI sync migrates the live sheet to a Day column exactly once', () => {
  const context = backendContext();
  let header = 'Date';
  let insertedAt = null;
  let dayValues = null;
  const dates = [new Date(2026, 10, 2, 12), '', new Date(2026, 10, 8, 12)];
  const sheet = {
    getLastRow: () => 4,
    insertColumnBefore(column) { insertedAt = column; },
    getRange(row, column, rowCount, columnCount) {
      if (row === 1 && column === 1) {
        return {
          getValue: () => header,
          setValue(value) { header = value; },
        };
      }
      if (row === 2 && column === 2 && rowCount === 3 && columnCount === 1) {
        return { getValues: () => dates.map(value => [value]) };
      }
      if (row === 2 && column === 1 && rowCount === 3 && columnCount === 1) {
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

test('the KPI sync replaces drive hours with editable day allocation exactly once', () => {
  const context = backendContext();
  let headers = [
    'Est. Total Job hrs',
    'Est. drive (hr)',
    'Est. work (hr)',
    'Act. work (hr)',
    'Work Completed on Schedule',
  ];
  let insertions = 0;
  let allocationValues = [[2.1], [0.8]];
  let allocationFormat = '';
  const sheet = {
    getLastRow: () => 3,
    insertColumnBefore(column) {
      assert.equal(column, 12);
      insertions += 1;
      headers.splice(3, 0, '');
    },
    getRange(row, column, rowCount, columnCount) {
      if (row === 1 && column === 9 && rowCount === 1 && columnCount === 5) {
        return {
          getValues: () => [headers.slice(0, 5)],
          setValues(values) { headers = Array.from(values[0]); },
        };
      }
      if (row === 2 && column === 10 && rowCount === 2 && columnCount === 1) {
        return {
          clearContent() { allocationValues = [[''], ['']]; return this; },
          setNumberFormat(format) { allocationFormat = format; return this; },
          getValues: () => allocationValues,
          setFormulaR1C1() { return this; },
        };
      }
      throw new Error(`Unexpected range: ${row},${column},${rowCount},${columnCount}`);
    },
  };

  context.ensureKpiHoursColumns_(sheet);
  context.ensureKpiHoursColumns_(sheet);

  assert.equal(insertions, 1);
  assert.deepEqual(headers, [
    'Total Estimated Job Hours',
    'Day Allocation %',
    'Estimated Project Hours (Day)',
    'Total Clocked Hours (Day)',
    'Actual Project Work Hours',
  ]);
  assert.deepEqual(allocationValues, [[''], ['']]);
  assert.equal(allocationFormat, '0.00%');
});

test('the KPI sync removes the obsolete Install Metrics drive-hours column', () => {
  const context = backendContext();
  let deletedColumn = null;
  const sheet = {
    getRange(row, column, rowCount, columnCount) {
      assert.deepEqual([row, column, rowCount, columnCount], [1, 13, 5, 1]);
      return { getValues: () => [[''], [''], [''], [''], ['Est. Drie hours']] };
    },
    deleteColumn(column) { deletedColumn = column; },
  };

  assert.equal(context.removeInstallMetricsDriveColumn_(sheet), true);
  assert.equal(deletedColumn, 13);
});

test('the KPI sync inserts the Crew Size column exactly once', () => {
  const context = backendContext();
  let header = 'Total Estimated Job Hours';
  let insertions = 0;
  const sheet = {
    getLastRow: () => 1,
    insertColumnBefore(column) { assert.equal(column, 8); insertions += 1; },
    getRange(row, column) {
      assert.equal(row, 1);
      assert.equal(column, 8);
      return {
        getValue: () => header,
        setValue(value) { header = value; },
      };
    },
  };

  context.ensureKpiCrewSizeColumn_(sheet);
  context.ensureKpiCrewSizeColumn_(sheet);

  assert.equal(insertions, 1);
  assert.equal(header, 'Crew Size');
});

test('the KPI log filter includes the hidden calendar key so row data sorts together', () => {
  const context = backendContext();
  let filter = null;
  let created = 0;
  const sheet = {
    getFilter: () => filter,
    getMaxRows: () => 1018,
    getRange(row, column, rowCount, columnCount) {
      assert.equal(row, 1);
      assert.equal(column, 1);
      assert.equal(rowCount, 1018);
      assert.equal(columnCount, 32);
      return {
        createFilter() {
          created += 1;
          filter = {};
        },
      };
    },
  };

  assert.equal(context.ensureKpiFilter_(sheet), true);
  assert.equal(context.ensureKpiFilter_(sheet), false);
  assert.equal(created, 1);
});

test('the KPI table resize request covers row one through the live last row', () => {
  const context = backendContext();
  const request = context.buildKpiTableResizeRequest_('install-log-table', 1604393046, 247);

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    updateTable: {
      table: {
        tableId: 'install-log-table',
        range: {
          sheetId: 1604393046,
          startRowIndex: 0,
          endRowIndex: 247,
          startColumnIndex: 0,
          endColumnIndex: 32,
        },
      },
      fields: 'range',
    },
  });
  assert.match(kpiSource, /resizeKpiNativeTable_\(sheet\);/);
});

test('calendar synchronization records a visible status row', () => {
  const writes = [];
  const numberFormats = [];
  const statusSheet = {
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValue: () => '',
        setValues(values) {
          writes.push({ row, column, rowCount, columnCount, values });
          return this;
        },
        setFontWeight() { return this; },
        setNumberFormat(format) {
          numberFormats.push({ row, column, rowCount, columnCount, format });
          return this;
        },
        setFrozenRows() { return this; },
      };
    },
    setFrozenRows() {},
    autoResizeColumns() {},
  };
  const spreadsheet = {
    getSheetByName: () => null,
    insertSheet: name => {
      assert.equal(name, 'Sync Status');
      return statusSheet;
    },
  };
  const context = backendContext({
    SpreadsheetApp: { openById: () => spreadsheet },
  });

  context.recordInstallKpiSyncStatus_('Install Calendar', {
    success: true,
    created: 2,
    filled: 3,
    removed: 4,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].values)), [
    ['Connection', 'Status', 'Last run', 'Details'],
    ['Install Calendar', '', '', ''],
    ['UKG Hours', '', '', ''],
    ['Fleetio', '', '', ''],
  ]);
  assert.equal(writes[1].row, 2);
  assert.equal(writes[1].column, 2);
  assert.equal(writes[1].values[0][0], 'OK');
  assert.equal(writes[1].values[0][1] instanceof Date, true);
  assert.equal(writes[1].values[0][2], 'Created 2; updated 3; removed 4');
  assert.deepEqual(numberFormats, [{
    row: 2,
    column: 3,
    rowCount: 3,
    columnCount: 1,
    format: 'm/d/yyyy h:mm:ss AM/PM',
  }]);
});

test('the KPI filter fallback preserves criteria and expands through the live last row', () => {
  const context = backendContext();
  const currentFilter = {
    range: {
      sheetId: 1604393046,
      startRowIndex: 0,
      endRowIndex: 247,
      startColumnIndex: 0,
      endColumnIndex: 30,
    },
    sortSpecs: [{ dimensionIndex: 1, sortOrder: 'ASCENDING' }],
    filterSpecs: [{ columnIndex: 1, filterCriteria: { hiddenValues: ['11/02/26'] } }],
  };
  const request = context.buildKpiFilterResizeRequest_(1604393046, 250, currentFilter);

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    setBasicFilter: {
      filter: {
        range: {
          sheetId: 1604393046,
          startRowIndex: 0,
          endRowIndex: 250,
          startColumnIndex: 0,
          endColumnIndex: 32,
        },
        sortSpecs: [{ dimensionIndex: 1, sortOrder: 'ASCENDING' }],
        filterSpecs: [{ columnIndex: 1, filterCriteria: { hiddenValues: ['11/02/26'] } }],
      },
    },
  });
});

test('sync planning is idempotent and preserves entered KPI results', () => {
  const context = backendContext();
  const existing = Array(32).fill('');
  existing[0] = 'Monday';
  existing[1] = new Date(2026, 10, 2);
  existing[2] = 'Johnny';
  existing[3] = '123456';
  existing[4] = 'Monument Sign';
  existing[5] = '2022 Crane';
  existing[8] = 90;
  existing[9] = 0.6;
  existing[10] = 4.5;
  existing[11] = 8.25;
  existing[12] = 3.75;
  existing[13] = true;
  existing[14] = 'Waiting on electrical';
  existing[31] = 'event-1|2026-11-02|Johnny';

  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', addr: '1150 N Dobson Rd, Chandler, AZ 85224' }),
  ], [existing], new Map([['123456', 42]]));

  assert.equal(plan.rowsToAppend.length, 1);
  assert.equal(plan.rowsToAppend[0][2], 'Eli');
  assert.equal(plan.rowsToUpdate.length, 0);
  assert.equal(plan.rowsToAllocationUpdate, undefined);
  assert.equal(plan.rowsToEstimatedWorkUpdate, undefined);
  assert.deepEqual(Array.from(plan.rowsToJobHoursUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 42 },
  ]);
  assert.equal(plan.rowsToAppend[0][8], 42);
  assert.equal(plan.rowsToAppend[0][9], '');
  assert.equal(plan.rowsToAppend[0][10], '');
  assert.equal(existing[11], 8.25);
  assert.equal(existing[12], 3.75);
  assert.equal(existing[13], true);
  assert.equal(existing[14], 'Waiting on electrical');
});

test('fast calendar reconciliation skips slow estimate lookups', () => {
  let squarecoilLookups = 0;
  const context = backendContext();
  context.getKpiSheet_ = () => ({ getLastRow: () => 1 });
  context.ensureKpiKeyColumn_ = () => {};
  context.resizeKpiNativeTable_ = () => {};
  context.squarecoilInstallHoursByJob_ = () => {
    squarecoilLookups += 1;
    return new Map();
  };
  context.planKpiSync_ = () => ({
    rowsToAppend: [],
    rowsToUpdate: [],
    rowsToJobHoursUpdate: [],
    rowsToKeyUpdate: [],
    rowIndexesToDelete: [],
  });

  context.syncInstallJobsToKpi_([job()], { skipEstimates: true });

  assert.equal(squarecoilLookups, 0);
});

test('sync planning writes a legitimate zero-hour Squarecoil total into a blank cell', () => {
  const context = backendContext();
  const existing = Array(32).fill('');
  existing[0] = 'Monday';
  existing[1] = new Date(2026, 10, 2, 12);
  existing[2] = 'Johnny';
  existing[3] = '123456';
  existing[4] = 'Monument Sign';
  existing[5] = '2022 Crane';
  existing[13] = false;
  existing[31] = 'event-1|2026-11-02|Johnny';

  const plan = context.planKpiSync_([
    job({ start: '2026-11-02', end: '2026-11-02', crew: ['Johnny'] }),
  ], [existing], new Map([['123456', 0]]));

  assert.deepEqual(Array.from(plan.rowsToJobHoursUpdate, update => ({ index: update.index, value: update.value })), [
    { index: 0, value: 0 },
  ]);
});

test('calendar reconciliation removes stale crew assignments in the requested window', () => {
  const context = backendContext();
  const existing = [
    ['Friday', new Date(2026, 10, 6, 12), 'Jonathan', '261618', 'Discount Tire', '', '', '', '', '', '', 8.88],
    ['Friday', new Date(2026, 10, 6, 12), 'Eli', '261618', 'Discount Tire', '', '', '', '', '', '', 10.25],
    ['Monday', new Date(2026, 9, 26, 12), 'Jerry', 'old-job', 'Older job'],
    ['Friday', new Date(2026, 10, 6, 12), 'Manual', '', 'Manual row'],
  ].map(row => {
    const values = Array(32).fill('');
    row.forEach((value, index) => { values[index] = value; });
    return values;
  });
  existing[0][31] = 'event-1|2026-11-06|Jonathan';
  existing[1][31] = 'event-1|2026-11-06|Eli';
  existing[2][31] = 'old-event|2026-10-26|Jerry';

  const plan = context.planKpiSync_([
    job({
      start: '2026-11-06',
      end: '2026-11-06',
      crew: ['Randy', 'Eli'],
      truck_assignments: {},
    }),
  ], existing, new Map(), {
    reconcileStart: new Date(2026, 10, 1),
    reconcileEnd: new Date(2026, 10, 30, 23, 59, 59),
  });

  assert.deepEqual(Array.from(plan.rowIndexesToDelete), [0]);
  assert.deepEqual(Array.from(plan.rowsToAppend, row => row[2]), ['Randy']);
  assert.equal(plan.rowsToUpdate.length, 1);
  assert.equal(plan.rowsToUpdate[0].index, 1);
  assert.equal(existing[2][31], 'old-event|2026-10-26|Jerry');
  assert.equal(existing[3][31], '');
});

test('calendar reconciliation removes keyless stale schedule rows in the requested window', () => {
  const context = backendContext();
  const existing = [
    ['Friday', new Date(2026, 10, 20, 12), 'Caden', '260300', 'StorQuest'],
    ['Friday', new Date(2026, 10, 20, 12), 'Jonathan', '261710', 'Wrightson Ridge'],
    ['Friday', new Date(2026, 10, 20, 12), 'Eli', '261710', 'Wrightson Ridge'],
    ['Friday', new Date(2026, 10, 20, 12), 'Manual', '', 'Manual note'],
  ].map(row => {
    const values = Array(32).fill('');
    row.forEach((value, index) => { values[index] = value; });
    return values;
  });

  const plan = context.planKpiSync_([
    job({
      event_id: 'event-261710',
      start: '2026-11-20',
      end: '2026-11-20',
      crew: ['Eli'],
      num: '261710',
      title: 'Wrightson Ridge',
    }),
  ], existing, new Map(), {
    reconcileStart: new Date(2026, 10, 1),
    reconcileEnd: new Date(2026, 11, 31, 23, 59, 59),
  });

  assert.deepEqual(Array.from(plan.rowIndexesToDelete), [0, 1]);
  assert.deepEqual(Array.from(plan.rowsToKeyUpdate, update => ({
    index: update.index,
    key: update.key,
  })), [{ index: 2, key: 'event-261710|2026-11-20|Eli' }]);
});

test('calendar reconciliation adopts legacy-key duplicates and preserves the completed row', () => {
  const context = backendContext();
  const completed = Array(32).fill('');
  completed[0] = 'Thursday';
  completed[1] = new Date(2026, 10, 19, 12);
  completed[2] = 'Johnny';
  completed[3] = '261547';
  completed[4] = 'JLL, PDS- Global Luxury Phoenix Survey';
  completed[11] = 8.5;
  completed[12] = 7.46;
  completed[13] = true;
  completed[31] = 'unrelated-event|2026-11-20|Jerry';

  const blankDuplicate = Array(32).fill('');
  blankDuplicate[0] = 'Thursday';
  blankDuplicate[1] = new Date(2026, 10, 19, 12);
  blankDuplicate[2] = 'Johnny';
  blankDuplicate[3] = '261547';
  blankDuplicate[4] = 'JLL, PDS- Global Luxury Phoenix Survey';
  blankDuplicate[13] = false;
  blankDuplicate[29] = 'event-1|2026-11-19|Johnny';

  const plan = context.planKpiSync_([
    job({
      start: '2026-11-19',
      end: '2026-11-19',
      crew: ['Johnny'],
      num: '261547',
      title: 'JLL, PDS- Global Luxury Phoenix Survey',
    }),
  ], [completed, blankDuplicate], new Map(), {
    reconcileStart: new Date(2026, 10, 1),
    reconcileEnd: new Date(2026, 10, 30, 23, 59, 59),
  });

  assert.equal(plan.rowsToAppend.length, 0);
  assert.deepEqual(Array.from(plan.rowsToKeyUpdate, update => ({
    index: update.index,
    key: update.key,
  })), [{ index: 0, key: 'event-1|2026-11-19|Johnny' }]);
  assert.deepEqual(Array.from(plan.rowIndexesToDelete), [1]);
  assert.equal(completed[11], 8.5);
  assert.equal(completed[12], 7.46);
  assert.equal(completed[13], true);
});

test('job-hour backfill repeats each Squarecoil total on every matching KPI row', () => {
  const context = backendContext();
  const rows = [
    ['', '', '', '260242', '', '', '', '', ''],
    ['', '', '', '260242', '', '', '', '', ''],
    ['', '', '', '999999', '', '', '', '', 7],
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

test('calendar changes use a fast calendar-only sync with a five-minute fallback', () => {
  const deleted = [];
  const created = [];
  const synced = [];
  const estimateRefreshes = [];
  const ukgImports = [];
  const triggers = [
    { getHandlerFunction: () => 'refreshInstallKpiFromCalendar_' },
    { getHandlerFunction: () => 'refreshInstallKpiCalendar_' },
    { getHandlerFunction: () => 'refreshInstallKpiReports_' },
    { getHandlerFunction: () => 'handleInstallCalendarChange_' },
    { getHandlerFunction: () => 'refreshCurrentJobs' },
  ];
  const context = vm.createContext({
    Date,
    INSTALL_CAL_ID: 'install-calendar',
    Logger: { log() {} },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: trigger => deleted.push(trigger.getHandlerFunction()),
      newTrigger(handler) {
        const plan = { handler };
        created.push(plan);
        return {
          timeBased() { plan.timeBased = true; return this; },
          everyMinutes(minutes) { plan.minutes = minutes; return this; },
          everyHours(hours) { plan.hours = hours; return this; },
          forUserCalendar(calendarId) { plan.calendarId = calendarId; return this; },
          onEventUpdated() { plan.onEventUpdated = true; return this; },
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
    syncInstallJobsToKpi_(jobs, options) {
      synced.push({ jobs, options });
      return { success: true, created: jobs.length };
    },
    syncUkgDailyHoursFromEmail_() {
      ukgImports.push(true);
      return { success: true, updated: 2 };
    },
  });
  vm.runInContext(triggerSource, context);

  const result = context.setupInstallKpiSyncTrigger();

  assert.deepEqual(deleted, [
    'refreshInstallKpiFromCalendar_',
    'refreshInstallKpiCalendar_',
    'refreshInstallKpiReports_',
    'handleInstallCalendarChange_',
  ]);
  assert.deepEqual(created, [
    {
      handler: 'refreshInstallKpiCalendar_',
      timeBased: true,
      minutes: 5,
      created: true,
    },
    {
      handler: 'refreshInstallKpiReports_',
      timeBased: true,
      hours: 1,
      created: true,
    },
    {
      handler: 'handleInstallCalendarChange_',
      calendarId: 'install-calendar',
      onEventUpdated: true,
      created: true,
    },
  ]);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].jobs.length, 1);
  assert.equal(synced[0].options.reconcileStart.getFullYear(), 2026);
  assert.equal(synced[0].options.reconcileStart.getMonth(), 10);
  assert.equal(synced[0].options.reconcileStart.getDate(), 1);
  assert.ok(synced[0].options.reconcileEnd > synced[0].options.reconcileStart);
  assert.equal(synced[0].options.skipEstimates, true);
  assert.deepEqual(estimateRefreshes, []);
  assert.equal(result.created, 1);
  assert.equal(ukgImports.length, 0);
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
