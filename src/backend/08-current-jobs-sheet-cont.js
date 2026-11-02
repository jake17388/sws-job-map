// ── Current Jobs sheet ────────────────────────────────────────────────────────
// Run once from the Apps Script editor to schedule daily auto-refresh at 6 am.
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'refreshCurrentJobs')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshCurrentJobs')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  // Populate immediately so the sheet isn't empty after setup
  refreshCurrentJobs();
}

// Keep the Install Log aligned with the next 60 days of the install calendar.
function refreshInstallKpiFromCalendar_() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  const installJobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', start, end);
  return syncInstallJobsToKpi_(installJobs);
}

// Run once from the Apps Script editor to install the hourly KPI refresh.
function setupInstallKpiSyncTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'refreshInstallKpiFromCalendar_')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('refreshInstallKpiFromCalendar_')
    .timeBased()
    .everyHours(1)
    .create();
  return refreshInstallKpiFromCalendar_();
}
