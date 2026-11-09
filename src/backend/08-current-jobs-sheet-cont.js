// ── Current Jobs sheet ────────────────────────────────────────────────────────
const INSTALL_KPI_HISTORY_START = '2026-11-01';

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

function currentJobEstimateContext_() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  const installJobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', start, end);
  const unscheduledJobs = typeof getUnscheduledJobs_ === 'function' ? getUnscheduledJobs_() : [];
  const jobNums = Array.from(new Set(installJobs.map(job => job.num)
    .concat(unscheduledJobs.map(job => job.job_num))
    .map(value => String(value || '').trim())
    .filter(value => /^\d{5,6}$/.test(value))));
  return { installJobs, jobNums };
}

function installKpiCalendarContext_() {
  const [year, month, day] = INSTALL_KPI_HISTORY_START.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date();
  end.setDate(end.getDate() + 60);
  end.setHours(23, 59, 59, 999);
  const installJobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', start, end);
  const unscheduledJobs = typeof getUnscheduledJobs_ === 'function' ? getUnscheduledJobs_() : [];
  const jobNums = Array.from(new Set(installJobs.map(job => job.num)
    .concat(unscheduledJobs.map(job => job.job_num))
    .map(value => String(value || '').trim())
    .filter(value => /^\d{5,6}$/.test(value))));
  return { start, end, installJobs, jobNums };
}

function refreshJobMapEstimatedHours_() {
  if (!isSquarecoilEstimateConfigured_()) {
    return { success: false, error: 'Squarecoil credentials are not configured' };
  }
  const current = currentJobEstimateContext_();
  const totals = squarecoilInstallHoursByJob_(current.jobNums, true);
  return {
    success: true,
    jobs_requested: current.jobNums.length,
    jobs_resolved: totals.size,
  };
}

// Reconcile the complete Install Log history and the next 60 calendar days.
function refreshInstallKpiFromCalendar_() {
  const current = installKpiCalendarContext_();
  try {
    squarecoilInstallHoursByJob_(current.jobNums, false);
  } catch (error) {
    Logger.log('Squarecoil estimate refresh failed during KPI sync: ' + error.message);
  }
  const result = syncInstallJobsToKpi_(current.installJobs, {
    reconcileStart: current.start,
    reconcileEnd: current.end,
  });
  try {
    result.ukg_hours = syncUkgDailyHoursFromEmail_();
  } catch (error) {
    Logger.log('UKG daily hours import failed during KPI sync: ' + error.message);
    result.ukg_hours = { success: false, error: error.message };
  }
  return result;
}

function handleInstallCalendarChange_() {
  return refreshInstallKpiFromCalendar_();
}

// Run once from the Apps Script editor to install event-driven sync plus an hourly fallback.
function setupInstallKpiSyncTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => [
      'refreshInstallKpiFromCalendar_',
      'handleInstallCalendarChange_',
    ].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('refreshInstallKpiFromCalendar_')
    .timeBased()
    .everyHours(1)
    .create();
  ScriptApp.newTrigger('handleInstallCalendarChange_')
    .forUserCalendar(INSTALL_CAL_ID)
    .onEventUpdated()
    .create();
  return refreshInstallKpiFromCalendar_();
}
