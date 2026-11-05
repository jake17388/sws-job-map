import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

function scheduledContext({ estimateTotals, estimateError, driveEstimates, includeNonInstall = false } = {}) {
  const calls = [];
  const event = {
    getTitle: () => '(Johnny) 260242 Seton Catholic Gym',
    getLocation: () => '1150 N Dobson Rd',
    getStartTime: () => new Date(2026, 10, 3),
    getEndTime: () => new Date(2026, 10, 4),
    getId: () => 'event-1',
    getTag: () => null,
  };
  const calendars = new Map([
    ['install-calendar', { getEvents: () => [event] }],
    ['service-calendar', { getEvents: () => includeNonInstall ? [{
      ...event,
      getTitle: () => '261999 Service Call',
      getId: () => 'event-2',
    }] : [] }],
    ['excavation-calendar', { getEvents: () => [] }],
  ]);
  const context = vm.createContext({
    console,
    INSTALL_CAL_ID: 'install-calendar',
    SERVICE_CAL_ID: 'service-calendar',
    EXCAV_CAL_ID: 'excavation-calendar',
    TRUCK_ASSIGNMENTS_TAG: 'sws_truck_assignments_v1',
    SKIP_KEYWORDS: [],
    CREW_NAMES: ['Johnny'],
    CalendarApp: { getCalendarById: id => calendars.get(id) || null },
    formatDate: date => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-'),
    normalizeCrew: values => values,
    normalizeStoredTruckAssignments_: () => ({}),
    estimateDriveHoursByAddress_: jobs => {
      assert.equal(jobs[0].addr, '1150 N Dobson Rd');
      return driveEstimates || new Map();
    },
    recommendedInstallDays_: hours => hours > 10 ? 2 : hours > 0 ? 1 : null,
    squarecoilInstallHoursByJob_: (jobNums, forceRefresh, cacheOnly) => {
      calls.push({ jobNums: [...jobNums], forceRefresh, cacheOnly });
      if (estimateError) throw estimateError;
      return estimateTotals || new Map();
    },
  });
  vm.runInContext(calendarSource, context);
  return { context, calls };
}

test('scheduled install jobs receive cached SquareCoil totals without looking up other job types', () => {
  const backend = scheduledContext({
    estimateTotals: new Map([['260242', 10]]),
    driveEstimates: new Map([['1150 n dobson rd', 2.1]]),
    includeNonInstall: true,
  });

  const result = backend.context.getJobs({ parameter: { from: '2026-11-03', to: '2026-11-03' } });

  assert.deepEqual(backend.calls, [{ jobNums: ['260242'], forceRefresh: false, cacheOnly: true }]);
  assert.equal(result.jobs[0].estimated_install_hours, 10);
  assert.equal(result.jobs[0].estimated_drive_hours, 2.1);
  assert.equal(result.jobs[0].recommended_install_days, 1);
  assert.equal(result.jobs[1].estimated_install_hours, null);
});

test('SquareCoil failures leave scheduled jobs available with an unknown estimate', () => {
  const backend = scheduledContext({ estimateError: new Error('SquareCoil unavailable') });

  const result = backend.context.getJobs({ parameter: { from: '2026-11-03', to: '2026-11-03' } });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].estimated_install_hours, null);
});

test('scheduled list rows and map cards display estimated install hours', () => {
  assert.match(frontendSource, /function scheduledCardHTML\(job\)[\s\S]*estimatedInstallHoursHTML\(job\)[\s\S]*function estimatedInstallHoursHTML/);
  assert.match(frontendSource, /id="item-sched-\$\{idx\}"[\s\S]*estimatedInstallHoursHTML\(job\)[\s\S]*list\.innerHTML/);
  assert.match(frontendSource, /Drive round trip:/);
  assert.match(frontendSource, /Recommended:/);
  assert.doesNotMatch(frontendSource, /Recommended \(1 installer\):/);
});
