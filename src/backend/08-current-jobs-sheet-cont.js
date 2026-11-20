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

function recordInstallKpiStatusSafely_(connection, result) {
  if (typeof recordInstallKpiSyncStatus_ !== 'function') return;
  try {
    recordInstallKpiSyncStatus_(connection, result);
  } catch (error) {
    Logger.log(`Could not record ${connection} sync status: ${error.message}`);
  }
}

// Reconcile the complete Install Log history and the next 60 calendar days.
// This path stays lean enough for event-driven and five-minute fallback syncs.
function refreshInstallKpiCalendar_() {
  try {
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
    recordInstallKpiStatusSafely_('Install Calendar', result);
    return result;
  } catch (error) {
    recordInstallKpiStatusSafely_('Install Calendar', { success: false, error: error.message });
    throw error;
  }
}

function refreshInstallKpiReports_() {
  const result = { success: true };
  try {
    result.ukg_hours = syncUkgDailyHoursFromEmail_();
    recordInstallKpiStatusSafely_('UKG Hours', result.ukg_hours);
  } catch (error) {
    Logger.log('UKG daily hours import failed during KPI sync: ' + error.message);
    result.ukg_hours = { success: false, error: error.message };
    recordInstallKpiStatusSafely_('UKG Hours', result.ukg_hours);
  }
  try {
    result.fleetio = syncFleetioInspectionsFromEmail_();
    recordInstallKpiStatusSafely_('Fleetio', result.fleetio);
  } catch (error) {
    Logger.log('Fleetio inspection import failed during KPI sync: ' + error.message);
    result.fleetio = { success: false, error: error.message };
    recordInstallKpiStatusSafely_('Fleetio', result.fleetio);
  }
  return result;
}

function refreshInstallKpiFromCalendar_() {
  const result = refreshInstallKpiCalendar_();
  const reports = refreshInstallKpiReports_();
  result.ukg_hours = reports.ukg_hours;
  result.fleetio = reports.fleetio;
  return result;
}

function handleInstallCalendarChange_() {
  return refreshInstallKpiCalendar_();
}

// Run once from the Apps Script editor to install event-driven sync, a fast
// calendar fallback, and independent hourly email-report imports.
function setupInstallKpiSyncTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => [
      'refreshInstallKpiFromCalendar_',
      'refreshInstallKpiCalendar_',
      'refreshInstallKpiReports_',
      'handleInstallCalendarChange_',
    ].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('refreshInstallKpiCalendar_')
    .timeBased()
    .everyMinutes(5)
    .create();
  ScriptApp.newTrigger('refreshInstallKpiReports_')
    .timeBased()
    .everyHours(1)
    .create();
  ScriptApp.newTrigger('handleInstallCalendarChange_')
    .forUserCalendar(INSTALL_CAL_ID)
    .onEventUpdated()
    .create();
  return refreshInstallKpiFromCalendar_();
}
