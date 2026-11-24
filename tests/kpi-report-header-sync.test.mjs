import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const kpiSource = readFileSync(
  new URL('../src/backend/10-kpi-log.js', import.meta.url),
  'utf8',
);
const ukgSource = readFileSync(
  new URL('../src/backend/12-ukg-hours.js', import.meta.url),
  'utf8',
);
const fleetioSource = readFileSync(
  new URL('../src/backend/13-fleetio-inspections.js', import.meta.url),
  'utf8',
);

const headers = [
  'Day',
  'Date',
  'Crew member',
  'Job number',
  'Job name',
  'Truck',
  'Trailer',
  'Crew Size',
  'Total Estimated Job Hours',
  'Estimated Days',
  'Day Allocation %',
  'Estimated Project Hours (Day)',
  'Total Clocked Hours (Day)',
  'Actual Project Work Hours',
  'Work Completed on Schedule',
  'Fleetio AM',
  'Fleetio PM',
  'Late Departure (After 6:30)',
];

function reportContext() {
  const rows = [
    headers,
    [
      'Monday', new Date(2026, 10, 23), 'Johnny', '260101', 'Example job', '', '', 2,
      16, 2, 0.5, 8, 7.5, 6, false, false, false, false,
    ],
  ];
  const writes = [];
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    getFilter: () => ({ getRange: () => null }),
    getRange(startRow, startColumn, rowCount = 1, columnCount = 1) {
      return {
        getValue: () => rows[startRow - 1]?.[startColumn - 1] ?? '',
        getValues: () => rows
          .slice(startRow - 1, startRow - 1 + rowCount)
          .map(row => row.slice(startColumn - 1, startColumn - 1 + columnCount)),
        setValues(values) {
          writes.push({ startRow, startColumn, values });
          values.forEach((row, rowOffset) => {
            row.forEach((value, columnOffset) => {
              rows[startRow - 1 + rowOffset][startColumn - 1 + columnOffset] = value;
            });
          });
          return this;
        },
      };
    },
  };
  const spreadsheet = {
    getSheetByName: name => (name === 'Install Log' ? sheet : null),
  };
  const context = vm.createContext({
    console,
    Date,
    Map,
    Set,
    KPI_SHEET_ID: 'kpi-sheet',
    KPI_SHEET_NAME: 'Install Log',
    SpreadsheetApp: { openById: () => spreadsheet },
  });
  vm.runInContext(kpiSource, context);
  vm.runInContext(ukgSource, context);
  vm.runInContext(fleetioSource, context);
  return { context, rows, writes };
}

test('UKG sync finds the clocked-hours column when Estimated Days is present', () => {
  const { context, rows, writes } = reportContext();

  const result = context.syncUkgDailyHoursMap_(new Map([
    ['46|2026-11-23', 9.25],
  ]));

  assert.equal(result.updated, 1);
  assert.equal(rows[1][headers.indexOf('Total Clocked Hours (Day)')], 9.25);
  assert.equal(writes.at(-1).startColumn, headers.indexOf('Total Clocked Hours (Day)') + 1);
});

test('Fleetio sync finds AM and PM columns when Estimated Days is present', () => {
  const { context, rows, writes } = reportContext();
  const inspections = new Map([
    ['Johnny|2026-11-23', { am: true, pm: true }],
  ]);

  const result = context.syncFleetioInspectionMap_(
    inspections,
    new Set(['2026-11-23']),
  );

  assert.equal(result.updated, 1);
  assert.equal(rows[1][headers.indexOf('Fleetio AM')], true);
  assert.equal(rows[1][headers.indexOf('Fleetio PM')], true);
  assert.deepEqual(
    writes.slice(-2).map(write => write.startColumn),
    [headers.indexOf('Fleetio AM') + 1, headers.indexOf('Fleetio PM') + 1],
  );
});
