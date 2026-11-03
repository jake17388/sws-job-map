import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const backendSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

function backendContext({ rows, estimateTotals, estimateError } = {}) {
  const calls = [];
  const context = vm.createContext({
    console,
    CREW_NAMES: [],
    SHEET_ID: 'jobs-sheet',
    UNSCHEDULED_SHEET_GID: 0,
    normalizeCrew: values => values,
    normalizeStoredTruckAssignments_: () => ({}),
    squarecoilInstallHoursByJob_: (jobNums, forceRefresh) => {
      calls.push({ jobNums: [...jobNums], forceRefresh });
      if (estimateError) throw estimateError;
      return estimateTotals || new Map();
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheets: () => [{
          getSheetId: () => 0,
          getDataRange: () => ({ getValues: () => rows || [['Job #']] }),
        }],
      }),
    },
  });
  vm.runInContext(backendSource, context);
  return { context, calls };
}

test('unscheduled jobs receive cached SquareCoil install totals in one batch', () => {
  const rows = [
    ['Job #', 'Job Name', 'Address', 'Added', 'ID', 'Added By', 'Crew', 'Truck Assignments'],
    ['260242', 'Seton Gym', '1150 N Dobson Rd', '', 'one', 'Jake', '', ''],
    ['261170', 'J Jill', '1660 S Val Vista Dr', '', 'two', 'Jake', '', ''],
  ];
  const backend = backendContext({
    rows,
    estimateTotals: new Map([['260242', 102], ['261170', 0]]),
  });

  const result = backend.context.getUnsched();

  assert.deepEqual(backend.calls, [{ jobNums: ['260242', '261170'], forceRefresh: false }]);
  assert.equal(result.jobs[0].estimated_install_hours, 102);
  assert.equal(result.jobs[1].estimated_install_hours, 0);
});

test('SquareCoil failures leave unscheduled jobs available with an unknown estimate', () => {
  const rows = [
    ['Job #', 'Job Name', 'Address', 'Added', 'ID', 'Added By', 'Crew', 'Truck Assignments'],
    ['260242', 'Seton Gym', '1150 N Dobson Rd', '', 'one', 'Jake', '', ''],
  ];
  const backend = backendContext({ rows, estimateError: new Error('SquareCoil unavailable') });

  const result = backend.context.getUnsched();

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].estimated_install_hours, null);
});

test('unscheduled list rows and map cards display estimated install hours', () => {
  assert.match(frontendSource, /function estimatedInstallHoursHTML\(job/);
  assert.match(frontendSource, /function unschedCardHTML\(job\)[\s\S]*estimatedInstallHoursHTML\(job/);
  assert.match(frontendSource, /id="item-unsched-\$\{i\}"[\s\S]*estimatedInstallHoursHTML\(job/);
  assert.match(frontendSource, /Est\. total job hrs:/);
  assert.match(frontendSource, /estimated_install_hours/);
});
