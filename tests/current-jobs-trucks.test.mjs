import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const configSource = readFileSync(new URL('../src/backend/01-config.js', import.meta.url), 'utf8');
const currentJobsSource = readFileSync(new URL('../src/backend/06-current-jobs-sheet.js', import.meta.url), 'utf8');
const vehicleRoster = JSON.parse(readFileSync(new URL('../config/vehicle-roster.json', import.meta.url), 'utf8'));

test('Current Jobs replaces the old check columns with assigned truck details', () => {
  const writes = [];
  const clears = [];
  const sheet = {
    getLastRow: () => 3,
    getRange(row, column, rowCount, columnCount) {
      return {
        clearContent() { clears.push({ row, column, rowCount, columnCount }); },
        setValues(values) { writes.push({ row, column, rowCount, columnCount, values }); },
      };
    },
  };
  const jobs = [{
    num: '261452',
    title: 'Ferguson - Cottonwood',
    start: '2026-11-11',
    end: '2026-11-11',
    type: 'install',
    crew: ['Eli', 'Randy'],
    truck_assignments: {
      Eli: '2022-small-crane',
      Randy: '2022-small-crane',
    },
  }];
  const context = vm.createContext({
    console,
    Date,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Phoenix' },
    Utilities: {
      formatDate: date => date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix',
      }),
    },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
    fetchCalendarEvents: (calendarId, type) => type === 'install' ? jobs : [],
    syncInstallJobsToKpi_() {},
  });
  vm.runInContext(`const VEHICLE_ROSTER = ${JSON.stringify(vehicleRoster)};\n${configSource}\n${currentJobsSource}`, context);

  context.refreshCurrentJobs();

  assert.deepEqual(clears, [{ row: 2, column: 1, rowCount: 2, columnCount: 5 }]);
  assert.deepEqual(writes[0], {
    row: 1,
    column: 1,
    rowCount: 1,
    columnCount: 5,
    values: [['Job Number', 'Job Name', 'Date', 'Type', 'Assigned Trucks']],
  });
  assert.deepEqual(writes[1].values[0], [
    '261452',
    'Ferguson - Cottonwood',
    'Nov 11, 2026',
    'install',
    'Eli - 2022 Altec Crane; Randy - 2022 Altec Crane',
  ]);
});
