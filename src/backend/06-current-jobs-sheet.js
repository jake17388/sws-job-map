// ── Current Jobs sheet ────────────────────────────────────────────────────────
function refreshCurrentJobs() {
  const start = new Date();
  const end = new Date(start); end.setDate(end.getDate() + 60);

  const installJobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', start, end);
  const allJobs = [
    ...installJobs,
    ...fetchCalendarEvents(SERVICE_CAL_ID, 'Service', start, end),
    ...fetchCalendarEvents(EXCAV_CAL_ID,   'Excavation', start, end),
  ];
  allJobs.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

  try {
    syncInstallJobsToKpi_(installJobs);
  } catch (e) {
    Logger.log('Install KPI sync failed during Current Jobs refresh: ' + e.message);
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Current Jobs');
  if (!sheet) return;

  sheet.getRange(1, 1, 1, 5).setValues([[
    'Job Number', 'Job Name', 'Date', 'Type', 'Assigned Trucks',
  ]]);

  // Clear existing data rows, keep header
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 5).clearContent();

  if (allJobs.length === 0) return;

  // Build rows array for a single batch write (much faster than appendRow loop)
  const tz = Session.getScriptTimeZone();
  const rows = allJobs.filter(job => job.num).map(job => {
    const p = job.start.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2], 12);
    let dateStr;
    if (job.start === job.end) {
      dateStr = Utilities.formatDate(d, tz, 'MMM d, yyyy');
    } else {
      const ep = job.end.split('-');
      const de = new Date(+ep[0], +ep[1] - 1, +ep[2], 12);
      dateStr = Utilities.formatDate(d, tz, 'MMM d') + ' – ' +
                Utilities.formatDate(de, tz, 'MMM d, yyyy');
    }
    return [
      job.num || '',
      job.title,
      dateStr,
      job.type,
      truckAssignmentSummary_(job.crew, job.truck_assignments),
    ];
  });

  sheet.getRange(2, 1, rows.length, 5).setValues(rows);
}
