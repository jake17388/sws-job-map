import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

let ukgSource = '';
try {
  ukgSource = readFileSync(new URL('../src/backend/12-ukg-hours.js', import.meta.url), 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const triggerSource = readFileSync(
  new URL('../src/backend/08-current-jobs-sheet-cont.js', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(readFileSync(new URL('../appsscript.json', import.meta.url), 'utf8'));

function ukgContext(globals = {}) {
  const context = vm.createContext({ console, Date, Map, ...globals });
  vm.runInContext(ukgSource, context);
  return context;
}

test('UKG rows total regular, overtime, and double-time hours only', () => {
  const context = ukgContext();
  const rows = [
    [
      'Employee Id', 'First Name', 'Last Name', 'Date', 'Double Time Hours',
      'Holiday Hours', 'Overtime Hours', 'PTO Hours', 'Regular Hours',
    ],
    ['46', 'John Vasquez', 'Martinez', '11/06/2026', '-', '-', '6.33', '2.00', '3.45'],
    ['131', 'Eliazim', 'Ruiz', '11/06/2026', '0.25', '-', '2.47', '-', '7.78'],
  ];

  const hours = context.parseUkgDailyHoursRows_(rows);

  assert.deepEqual(Array.from(hours.entries()), [
    ['46|2026-11-06', 9.78],
    ['131|2026-11-06', 10.5],
  ]);
});

test('clocked-hour planning repeats the daily total and preserves unrelated values', () => {
  const context = ukgContext();
  const rows = [
    ['Monday', new Date(2026, 10, 2), 'Johnny', '260101', '', '', '', '', '', '', '', 8.5],
    ['Monday', new Date(2026, 10, 2), 'Johnny', '260102', '', '', '', '', '', '', '', 8.5],
    ['Monday', new Date(2026, 10, 2), 'Eli', '260103', '', '', '', '', '', '', '', 9],
    ['Tuesday', new Date(2026, 10, 3), 'Johnny', '260104', '', '', '', '', '', '', '', 7.25],
  ];
  const hours = new Map([
    ['46|2026-11-02', 9.72],
    ['999|2026-11-02', 12],
  ]);

  const plan = context.planKpiClockedHoursSync_(rows, hours, 'America/Phoenix');

  assert.deepEqual(Array.from(plan.values, row => row[0]), [9.72, 9.72, 9, 7.25]);
  assert.equal(plan.updated, 2);
  assert.equal(plan.matchedCrewDates, 1);
});

test('the newest CSV attachment is selected from matching UKG messages', () => {
  const oldCsv = { getName: () => 'old.csv', getContentType: () => 'text/csv' };
  const newCsv = { getName: () => 'Install Daily Hours Export.csv', getContentType: () => 'text/csv' };
  const ignoredPdf = { getName: () => 'report.pdf', getContentType: () => 'application/pdf' };
  const context = ukgContext({
    GmailApp: {
      search(query, start, count) {
        assert.match(query, /Install Daily Hours Export/);
        assert.equal(start, 0);
        assert.equal(count, 10);
        return [{
          getMessages: () => [
            {
              getId: () => 'old-message',
              getDate: () => new Date('2026-11-08T12:00:00Z'),
              getAttachments: () => [oldCsv],
            },
            {
              getId: () => 'new-message',
              getDate: () => new Date('2026-11-09T12:00:00Z'),
              getAttachments: () => [ignoredPdf, newCsv],
            },
          ],
        }];
      },
    },
  });

  const found = context.newestUkgCsvAttachment_();

  assert.equal(found.messageId, 'new-message');
  assert.equal(found.attachment, newCsv);
});

test('hourly KPI refresh imports UKG hours without blocking calendar sync failures', () => {
  const calls = [];
  const context = vm.createContext({
    Date,
    INSTALL_CAL_ID: 'install-calendar',
    Logger: { log: message => calls.push(['log', message]) },
    fetchCalendarEvents: () => [{ num: '260101' }],
    getUnscheduledJobs_: () => [],
    squarecoilInstallHoursByJob_: () => new Map(),
    syncInstallJobsToKpi_: () => ({ success: true, created: 1 }),
    syncUkgDailyHoursFromEmail_: () => ({ success: true, updated: 4 }),
  });
  vm.runInContext(triggerSource, context);

  const result = context.refreshInstallKpiFromCalendar_();

  assert.equal(result.created, 1);
  assert.deepEqual({ ...result.ukg_hours }, { success: true, updated: 4 });
});

test('Apps Script has read-only Gmail access for scheduled report attachments', () => {
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/gmail.readonly'));
  assert.ok(!manifest.oauthScopes.includes('https://mail.google.com/'));
});
