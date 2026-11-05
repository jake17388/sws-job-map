import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const backendSource = readFileSync(new URL('../src/backend/05-unscheduled-jobs.js', import.meta.url), 'utf8');
const squarecoilSource = readFileSync(new URL('../src/backend/11-squarecoil-estimates.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

function backendContext({ rows, estimateTotals, estimateError, driveEstimates } = {}) {
  const calls = [];
  const context = vm.createContext({
    console,
    CREW_NAMES: [],
    SHEET_ID: 'jobs-sheet',
    UNSCHEDULED_SHEET_GID: 0,
    normalizeCrew: values => values,
    normalizeStoredTruckAssignments_: () => ({}),
    estimateDriveHoursByAddress_: jobs => {
      assert.equal(jobs[0].address, '1150 N Dobson Rd');
      return driveEstimates || new Map();
    },
    recommendedInstallDays_: hours => hours > 10 ? 2 : hours > 0 ? 1 : null,
    squarecoilInstallHoursByJob_: (jobNums, forceRefresh, cacheOnly) => {
      calls.push({ jobNums: [...jobNums], forceRefresh, cacheOnly });
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
    estimateTotals: new Map([['260242', 10], ['261170', 0]]),
    driveEstimates: new Map([
      ['1150 n dobson rd', 2.1],
      ['1660 s val vista dr', 1.4],
    ]),
  });

  const result = backend.context.getUnsched();

  assert.deepEqual(backend.calls, [{
    jobNums: ['260242', '261170'],
    forceRefresh: false,
    cacheOnly: true,
  }]);
  assert.equal(result.jobs[0].estimated_install_hours, 10);
  assert.equal(result.jobs[0].estimated_drive_hours, 2.1);
  assert.equal(result.jobs[0].recommended_install_days, 1);
  assert.equal(result.jobs[1].estimated_install_hours, 0);
  assert.equal(result.jobs[1].estimated_drive_hours, 1.4);
  assert.equal(result.jobs[1].recommended_install_days, null);
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
  assert.match(frontendSource, /Drive round trip:/);
  assert.match(frontendSource, /Recommended:/);
  assert.doesNotMatch(frontendSource, /Recommended \(1 installer\):/);
  assert.match(frontendSource, /estimated_install_hours/);
});

test('SquareCoil batch requests retry sequentially when the session is rejected', () => {
  const batchResponse = {
    getResponseCode: () => 200,
    getContentText: () => '<form action="login.php"><input name="username"></form>',
  };
  const authenticatedResponse = {
    getResponseCode: () => 200,
    getContentText: () => '<a href="project_estimates.php?id=261170&estimateid=23304">261170-03</a>',
  };
  const sequentialRequests = [];
  const context = vm.createContext({
    console,
    Map,
    Set,
    UrlFetchApp: {
      fetchAll: () => [batchResponse],
      fetch: (url, options) => {
        sequentialRequests.push({ url, options });
        return authenticatedResponse;
      },
    },
  });
  vm.runInContext(squarecoilSource, context);

  const responses = context.squarecoilEstimateGetBatch_(['project_estimates.php?id=261170'], 'session=abc');

  assert.match(responses[0].getContentText(), /estimateid=23304/);
  assert.equal(sequentialRequests.length, 1);
  assert.match(sequentialRequests[0].url, /project_estimates\.php\?id=261170$/);
  assert.equal(sequentialRequests[0].options.headers.Cookie, 'session=abc');
});

test('cache-only SquareCoil reads use the durable last-known estimate without network access', () => {
  const fetches = [];
  const stored = JSON.stringify({ hours: 102, updatedAt: '2026-11-03T12:00:00.000Z' });
  const context = vm.createContext({
    console,
    Map,
    Set,
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => key === 'SQUARECOIL_INSTALL_HOURS_V1_260242' ? stored : '',
      }),
    },
    UrlFetchApp: { fetch: (...args) => fetches.push(args) },
  });
  vm.runInContext(squarecoilSource, context);

  const totals = context.squarecoilInstallHoursByJob_(['260242'], false, true);

  assert.equal(totals.get('260242'), 102);
  assert.equal(fetches.length, 0);
});

test('resolved SquareCoil estimates are written to the durable last-known store', () => {
  const stored = new Map();
  const context = vm.createContext({
    console,
    Map,
    Set,
    PropertiesService: {
      getScriptProperties: () => ({
        setProperty: (key, value) => stored.set(key, value),
      }),
    },
  });
  vm.runInContext(squarecoilSource, context);

  context.squarecoilEstimateWriteStored_('260242', 37.5);

  const record = JSON.parse(stored.get('SQUARECOIL_INSTALL_HOURS_V1_260242'));
  assert.equal(record.hours, 37.5);
  assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
