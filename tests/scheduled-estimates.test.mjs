import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const calendarSource = readFileSync(new URL('../src/backend/04-calendar-jobs.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

function scheduledContext({ estimateTotals, estimateError } = {}) {
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
    ['service-calendar', { getEvents: () => [] }],
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
    squarecoilInstallHoursByJob_: (jobNums, forceRefresh) => {
      calls.push({ jobNums: [...jobNums], forceRefresh });
      if (estimateError) throw estimateError;
      return estimateTotals || new Map();
    },
  });
  vm.runInContext(calendarSource, context);
  return { context, calls };
}

test('scheduled jobs receive cached SquareCoil install totals in one batch', () => {
  const backend = scheduledContext({ estimateTotals: new Map([['260242', 102]]) });

  const result = backend.context.getJobs({ parameter: { from: '2026-11-03', to: '2026-11-03' } });

  assert.deepEqual(backend.calls, [{ jobNums: ['260242'], forceRefresh: false }]);
  assert.equal(result.jobs[0].estimated_install_hours, 102);
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
});
