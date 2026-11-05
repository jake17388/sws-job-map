// ── Install KPI log ──────────────────────────────────────────────────────────
const KPI_HEADER_ROW = 3;
const KPI_FIRST_DATA_ROW = 4;
const KPI_COLUMN_COUNT = 29;
const KPI_TOTAL_JOB_HOURS_COLUMN = 8;
const KPI_DRIVE_HOURS_COLUMN = 9;
const KPI_ESTIMATED_PROJECT_HOURS_COLUMN = 10;
const KPI_TOTAL_CLOCKED_HOURS_COLUMN = 11;
const KPI_ACTUAL_PROJECT_HOURS_COLUMN = 12;
const KPI_KEY_COLUMN = 29;
const KPI_KEY_HEADER = 'Calendar KPI Key';
const KPI_HOUR_HEADERS = [
  'Total Estimated Job Hours',
  'Round-Trip Drive Hours',
  'Estimated Project Hours (Day)',
  'Total Clocked Hours (Day)',
  'Actual Project Work Hours',
];

function getKpiSheet_() {
  const spreadsheet = SpreadsheetApp.openById(KPI_SHEET_ID);
  const sheet = spreadsheet.getSheetByName(KPI_SHEET_NAME);
  if (!sheet) throw new Error(`KPI sheet not found: ${KPI_SHEET_NAME}`);
  ensureKpiDayColumn_(sheet);
  ensureKpiHoursColumns_(sheet);
  return sheet;
}

function ensureKpiKeyColumn_(sheet) {
  const header = sheet.getRange(KPI_HEADER_ROW, KPI_KEY_COLUMN);
  if (!header.getValue()) header.setValue(KPI_KEY_HEADER);
  if (typeof sheet.hideColumns === 'function') sheet.hideColumns(KPI_KEY_COLUMN);
}

function kpiKey_(eventId, workDate, crewMember) {
  return `${String(eventId || '').trim()}|${String(workDate || '').trim()}|${String(crewMember || '').trim()}`;
}

function dayNameForDate_(date) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

function ensureKpiDayColumn_(sheet) {
  const header = String(sheet.getRange(KPI_HEADER_ROW, 1).getValue() || '').trim();
  if (header === 'Day') return false;
  if (header !== 'Date') throw new Error(`Unexpected first KPI column: ${header || '(blank)'}`);

  sheet.insertColumnBefore(1);
  sheet.getRange(KPI_HEADER_ROW, 1).setValue('Day');
  const lastRow = sheet.getLastRow();
  if (lastRow >= KPI_FIRST_DATA_ROW) {
    const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
    const dates = sheet.getRange(KPI_FIRST_DATA_ROW, 2, rowCount, 1).getValues();
    const days = dates.map(row => [row[0] instanceof Date ? dayNameForDate_(row[0]) : '']);
    sheet.getRange(KPI_FIRST_DATA_ROW, 1, rowCount, 1).setValues(days);
  }
  return true;
}

function ensureKpiHoursColumns_(sheet) {
  const headerRange = sheet.getRange(KPI_HEADER_ROW, KPI_TOTAL_JOB_HOURS_COLUMN, 1, KPI_HOUR_HEADERS.length);
  const headers = headerRange.getValues()[0].map(value => String(value || '').trim());
  const alreadyMigrated = headers[3] === KPI_HOUR_HEADERS[3];
  if (!alreadyMigrated) {
    if (!/^Act\. work(?: \(hr\))?$/i.test(headers[3])) {
      throw new Error(`Unexpected KPI hours column K: ${headers[3] || '(blank)'}`);
    }
    sheet.insertColumnBefore(KPI_TOTAL_CLOCKED_HOURS_COLUMN);
  }
  sheet.getRange(KPI_HEADER_ROW, KPI_TOTAL_JOB_HOURS_COLUMN, 1, KPI_HOUR_HEADERS.length)
    .setValues([KPI_HOUR_HEADERS]);

  if (!alreadyMigrated) backfillKpiHourColumns_(sheet);
  return !alreadyMigrated;
}

function estimatedProjectHoursForDay_(totalJobHours, roundTripDriveHours, scheduledDays, assignedCrewCount) {
  if (totalJobHours === '' || totalJobHours == null || roundTripDriveHours === '' || roundTripDriveHours == null) {
    return '';
  }
  const total = Number(totalJobHours);
  const drive = Number(roundTripDriveHours);
  const days = Number(scheduledDays);
  const crewCount = assignedCrewCount == null ? 1 : Number(assignedCrewCount);
  if (!Number.isFinite(total) || !Number.isFinite(drive) || !Number.isFinite(days) || days <= 0
      || !Number.isFinite(crewCount) || crewCount <= 0) return '';
  return Math.round((Math.max(0, (total / days) - drive) / crewCount) * 100) / 100;
}

function kpiAssignmentStats_(rows) {
  const datesByJob = new Map();
  const crewByJobDate = new Map();
  (rows || []).forEach(row => {
    const jobNum = String((row || [])[3] || '').trim();
    const crewMember = String((row || [])[2] || '').trim();
    const key = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
    const workDate = key.split('|')[1];
    if (!jobNum || !workDate) return;
    if (!datesByJob.has(jobNum)) datesByJob.set(jobNum, new Set());
    datesByJob.get(jobNum).add(workDate);
    const jobDateKey = `${jobNum}|${workDate}`;
    if (!crewByJobDate.has(jobDateKey)) crewByJobDate.set(jobDateKey, new Set());
    if (crewMember) crewByJobDate.get(jobDateKey).add(crewMember);
  });
  return { datesByJob, crewByJobDate };
}

function assignmentCountsForKpiRow_(row, stats) {
  const jobNum = String((row || [])[3] || '').trim();
  const key = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
  const workDate = key.split('|')[1];
  return {
    scheduledDays: stats && stats.datesByJob.get(jobNum) && stats.datesByJob.get(jobNum).size || 1,
    assignedCrewCount: stats && stats.crewByJobDate.get(`${jobNum}|${workDate}`)
      && stats.crewByJobDate.get(`${jobNum}|${workDate}`).size || 1,
  };
}

function backfillKpiHourColumns_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) return;
  const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
  const rows = sheet.getRange(KPI_FIRST_DATA_ROW, 1, rowCount, KPI_COLUMN_COUNT).getValues();
  const stats = kpiAssignmentStats_(rows);
  const estimatedValues = rows.map(row => {
    const counts = assignmentCountsForKpiRow_(row, stats);
    return [estimatedProjectHoursForDay_(
      row[KPI_TOTAL_JOB_HOURS_COLUMN - 1],
      row[KPI_DRIVE_HOURS_COLUMN - 1],
      counts.scheduledDays,
      counts.assignedCrewCount,
    )];
  });
  sheet.getRange(KPI_FIRST_DATA_ROW, KPI_ESTIMATED_PROJECT_HOURS_COLUMN, rowCount, 1)
    .setValues(estimatedValues);

  const actualRange = sheet.getRange(KPI_FIRST_DATA_ROW, KPI_ACTUAL_PROJECT_HOURS_COLUMN, rowCount, 1);
  const actualValues = actualRange.getValues();
  const actualFormulas = typeof actualRange.getFormulasR1C1 === 'function'
    ? actualRange.getFormulasR1C1()
    : actualValues.map(() => ['']);
  const formula = '=IF(RC[-1]="","",MAX(0,RC[-1]-RC[-3]))';
  actualRange.setFormulaR1C1(formula);
  actualValues.forEach((row, index) => {
    const existingFormula = actualFormulas[index][0];
    const existingValue = row[0];
    if (!existingFormula && (existingValue === '' || existingValue == null)) return;
    const cell = sheet.getRange(KPI_FIRST_DATA_ROW + index, KPI_ACTUAL_PROJECT_HOURS_COLUMN);
    if (existingFormula) cell.setFormulaR1C1(existingFormula);
    else cell.setValue(existingValue);
  });
}

function vehicleNameForKpi_(vehicleId) {
  const id = String(vehicleId || '').trim();
  if (!id) return '';
  const vehicle = vehicleRoster_().find(candidate => String(candidate.id) === id);
  return vehicle ? String(vehicle.displayName) : '';
}

function normalizeDriveAddress_(value) {
  return String(value || '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function adjustedDriveHours_(durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hours = (seconds / 3600) * INSTALL_TRUCK_DRIVE_FACTOR * INSTALL_ROUND_TRIP_FACTOR;
  return Math.round(hours * 100) / 100;
}

function driveEstimateCache_() {
  if (typeof CacheService === 'undefined') return null;
  try { return CacheService.getScriptCache(); }
  catch (error) { return null; }
}

function driveEstimateCacheKey_(normalizedAddress) {
  if (typeof Utilities !== 'undefined') {
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      normalizedAddress,
      Utilities.Charset.UTF_8,
    );
    const hex = digest
      .map(byte => ((byte + 256) % 256).toString(16).padStart(2, '0'))
      .join('');
    return `install_drive_v2:${hex}`;
  }
  let hash = 2166136261;
  for (let index = 0; index < normalizedAddress.length; index += 1) {
    hash ^= normalizedAddress.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `install_drive_v2:${normalizedAddress.length}:${(hash >>> 0).toString(16)}`;
}

function readDriveEstimateCache_(cache, key) {
  if (!cache) return null;
  try { return cache.get(key); }
  catch (error) { return null; }
}

function writeDriveEstimateCache_(cache, key, value) {
  if (!cache) return;
  try { cache.put(key, String(value), 21600); }
  catch (error) {
    if (typeof Logger !== 'undefined') Logger.log(`Drive estimate cache write failed: ${error.message}`);
  }
}

function routeDriveHours_(address) {
  if (typeof Maps === 'undefined') return '';
  const directions = Maps.newDirectionFinder()
    .setOrigin(INSTALL_SHOP_ADDRESS)
    .setDestination(address)
    .setMode(Maps.DirectionFinder.Mode.DRIVING)
    .getDirections();
  const legs = directions && directions.routes && directions.routes[0]
    ? directions.routes[0].legs || []
    : [];
  const seconds = legs.reduce((total, leg) => total + Number(leg && leg.duration && leg.duration.value || 0), 0);
  return adjustedDriveHours_(seconds);
}

function estimateDriveHoursByAddress_(jobs) {
  const estimates = new Map();
  const cache = driveEstimateCache_();
  (jobs || []).forEach(job => {
    const address = String(job && (job.addr || job.address) || '').replace(/\s+/g, ' ').trim();
    const normalizedAddress = normalizeDriveAddress_(address);
    if (!normalizedAddress || estimates.has(normalizedAddress)) return;
    const cacheKey = driveEstimateCacheKey_(normalizedAddress);
    const cached = readDriveEstimateCache_(cache, cacheKey);
    if (cached != null && cached !== '') {
      const cachedHours = Number(cached);
      if (Number.isFinite(cachedHours) && cachedHours > 0) {
        estimates.set(normalizedAddress, cachedHours);
        return;
      }
    }
    let hours = '';
    try {
      hours = routeDriveHours_(address);
      if (hours !== '') writeDriveEstimateCache_(cache, cacheKey, hours);
    } catch (error) {
      if (typeof Logger !== 'undefined') {
        Logger.log(`Drive estimate failed for ${address}: ${error.message}`);
      }
    }
    estimates.set(normalizedAddress, hours);
  });
  return estimates;
}

function inclusiveDateStrings_(startValue, endValue) {
  const startResult = parseScheduleDate_(startValue, 'start');
  const endResult = parseScheduleDate_(endValue || startValue, 'end');
  if (startResult.error || endResult.error || endResult.date < startResult.date) return [];
  const dates = [];
  const cursor = new Date(startResult.date);
  while (cursor <= endResult.date) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildKpiSeedRows_(jobs, driveHoursByAddress, jobHoursByNumber) {
  const seeds = [];
  const datesByJob = new Map();
  const crewByJobDate = new Map();
  (jobs || []).forEach(job => {
    if (String(job.type || '').toLowerCase() !== 'install' || !job.event_id) return;
    const jobNum = String(job.num || '');
    const crew = normalizeUnscheduledCrew_(job.crew);
    inclusiveDateStrings_(job.start, job.end).forEach(workDate => {
      if (!datesByJob.has(jobNum)) datesByJob.set(jobNum, new Set());
      datesByJob.get(jobNum).add(workDate);
      const jobDateKey = `${jobNum}|${workDate}`;
      if (!crewByJobDate.has(jobDateKey)) crewByJobDate.set(jobDateKey, new Set());
      crew.forEach(crewMember => crewByJobDate.get(jobDateKey).add(crewMember));
    });
  });
  (jobs || []).forEach(job => {
    if (String(job.type || '').toLowerCase() !== 'install' || !job.event_id) return;
    const crew = normalizeUnscheduledCrew_(job.crew);
    if (!crew.length) return;
    const workDates = inclusiveDateStrings_(job.start, job.end);
    workDates.forEach(workDate => {
      const dateResult = parseScheduleDate_(workDate, 'work');
      crew.forEach(crewMember => {
        const key = kpiKey_(job.event_id, workDate, crewMember);
        const values = Array(KPI_COLUMN_COUNT).fill('');
        const sheetDate = new Date(dateResult.date);
        // The Apps Script project uses Phoenix time while the KPI workbook uses
        // Los Angeles time. Midday keeps the calendar date stable in both zones.
        sheetDate.setHours(12, 0, 0, 0);
        values[0] = dayNameForDate_(sheetDate);
        values[1] = sheetDate;
        values[2] = crewMember;
        values[3] = String(job.num || '');
        values[4] = String(job.title || '');
        values[5] = vehicleNameForKpi_((job.truck_assignments || {})[crewMember]);
        const jobNum = String(job.num || '');
        const totalJobHours = jobHoursByNumber && typeof jobHoursByNumber.has === 'function'
          && jobHoursByNumber.has(jobNum)
          ? jobHoursByNumber.get(jobNum)
          : '';
        values[KPI_TOTAL_JOB_HOURS_COLUMN - 1] = totalJobHours;
        const driveEstimate = driveHoursByAddress && typeof driveHoursByAddress.get === 'function'
          ? driveHoursByAddress.get(normalizeDriveAddress_(job.addr))
          : '';
        values[KPI_DRIVE_HOURS_COLUMN - 1] = driveEstimate == null ? '' : driveEstimate;
        values[KPI_ESTIMATED_PROJECT_HOURS_COLUMN - 1] = estimatedProjectHoursForDay_(
          totalJobHours,
          driveEstimate,
          datesByJob.get(jobNum) && datesByJob.get(jobNum).size || workDates.length,
          crewByJobDate.get(`${jobNum}|${workDate}`) && crewByJobDate.get(`${jobNum}|${workDate}`).size || crew.length,
        );
        values[12] = false;
        values[KPI_KEY_COLUMN - 1] = key;
        seeds.push({
          key,
          values,
          scheduledDays: datesByJob.get(jobNum) && datesByJob.get(jobNum).size || workDates.length,
          assignedCrewCount: crewByJobDate.get(`${jobNum}|${workDate}`)
            && crewByJobDate.get(`${jobNum}|${workDate}`).size || crew.length,
        });
      });
    });
  });
  return seeds;
}

function planKpiSync_(jobs, existingRows, driveHoursByAddress, jobHoursByNumber) {
  const rowsByKey = new Map();
  (existingRows || []).forEach((row, index) => {
    const key = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
    if (key && !rowsByKey.has(key)) rowsByKey.set(key, { index, row });
  });
  const rowsToAppend = [];
  const rowsToUpdate = [];
  const rowsToJobHoursUpdate = [];
  const rowsToDriveUpdate = [];
  const rowsToEstimatedWorkUpdate = [];
  buildKpiSeedRows_(jobs, driveHoursByAddress, jobHoursByNumber).forEach(seed => {
    const existing = rowsByKey.get(seed.key);
    if (!existing) {
      rowsToAppend.push(seed.values);
      rowsByKey.set(seed.key, { index: -1, row: seed.values });
      return;
    }
    const scheduleValues = seed.values.slice(0, 6);
    const changed = scheduleValues.some((value, column) => {
      const current = existing.row[column];
      if (value instanceof Date) return !(current instanceof Date) || current.getTime() !== value.getTime();
      return String(current == null ? '' : current) !== String(value == null ? '' : value);
    });
    if (changed) rowsToUpdate.push({ index: existing.index, values: scheduleValues });
    const currentJobHours = existing.row[KPI_TOTAL_JOB_HOURS_COLUMN - 1];
    const estimatedJobHours = seed.values[KPI_TOTAL_JOB_HOURS_COLUMN - 1];
    if (estimatedJobHours !== ''
        && ((currentJobHours == null || String(currentJobHours).trim() === '')
          || Number(currentJobHours) !== Number(estimatedJobHours))) {
      rowsToJobHoursUpdate.push({ index: existing.index, value: estimatedJobHours });
    }
    const currentDrive = existing.row[KPI_DRIVE_HOURS_COLUMN - 1];
    const estimatedDrive = seed.values[KPI_DRIVE_HOURS_COLUMN - 1];
    if ((currentDrive == null || String(currentDrive).trim() === '') && estimatedDrive !== '') {
      rowsToDriveUpdate.push({ index: existing.index, value: estimatedDrive });
    }
    const currentEstimatedWork = existing.row[KPI_ESTIMATED_PROJECT_HOURS_COLUMN - 1];
    const effectiveTotal = estimatedJobHours !== '' ? estimatedJobHours : currentJobHours;
    const effectiveDrive = currentDrive == null || String(currentDrive).trim() === ''
      ? estimatedDrive
      : currentDrive;
    const estimatedWork = estimatedProjectHoursForDay_(
      effectiveTotal,
      effectiveDrive,
      seed.scheduledDays,
      seed.assignedCrewCount,
    );
    if (estimatedWork !== ''
        && ((currentEstimatedWork == null || String(currentEstimatedWork).trim() === '')
          || Number(currentEstimatedWork) !== Number(estimatedWork))) {
      rowsToEstimatedWorkUpdate.push({ index: existing.index, value: estimatedWork });
    }
  });
  return {
    rowsToAppend,
    rowsToUpdate,
    rowsToJobHoursUpdate,
    rowsToDriveUpdate,
    rowsToEstimatedWorkUpdate,
  };
}

function planKpiJobHoursBackfill_(existingRows, jobHoursByNumber) {
  let updated = 0;
  const stats = kpiAssignmentStats_(existingRows);
  const values = (existingRows || []).map(row => {
    const jobNum = String((row || [])[3] || '').trim();
    const current = (row || [])[KPI_TOTAL_JOB_HOURS_COLUMN - 1];
    if (!jobHoursByNumber || typeof jobHoursByNumber.has !== 'function' || !jobHoursByNumber.has(jobNum)) {
      return [current == null ? '' : current];
    }
    const total = jobHoursByNumber.get(jobNum);
    if (Number(current) !== Number(total) || current === '') updated += 1;
    return [total];
  });
  const estimatedWorkValues = (existingRows || []).map((row, index) => {
    const counts = assignmentCountsForKpiRow_(row, stats);
    return [estimatedProjectHoursForDay_(
      values[index][0],
      (row || [])[KPI_DRIVE_HOURS_COLUMN - 1],
      counts.scheduledDays,
      counts.assignedCrewCount,
    )];
  });
  return { values, estimatedWorkValues, updated };
}

function syncInstallJobsToKpi_(jobs) {
  const lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(10000);
  try {
    const sheet = getKpiSheet_();
    ensureKpiKeyColumn_(sheet);
    const driveHoursByAddress = estimateDriveHoursByAddress_(jobs);
    let jobHoursByNumber = new Map();
    try {
      jobHoursByNumber = squarecoilInstallHoursByJob_(
        Array.from(new Set((jobs || []).map(job => String(job && job.num || '')).filter(Boolean)))
      );
    } catch (error) {
      if (typeof Logger !== 'undefined') Logger.log(`Squarecoil install hours failed: ${error.message}`);
    }
    const lastRow = Math.max(sheet.getLastRow(), KPI_HEADER_ROW);
    const existingRows = lastRow >= KPI_FIRST_DATA_ROW
      ? sheet.getRange(KPI_FIRST_DATA_ROW, 1, lastRow - KPI_FIRST_DATA_ROW + 1, KPI_COLUMN_COUNT).getValues()
      : [];
    const plan = planKpiSync_(jobs, existingRows, driveHoursByAddress, jobHoursByNumber);
    plan.rowsToUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, 1, 1, 6).setValues([update.values]);
    });
    plan.rowsToJobHoursUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, KPI_TOTAL_JOB_HOURS_COLUMN).setValue(update.value);
    });
    plan.rowsToDriveUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, KPI_DRIVE_HOURS_COLUMN).setValue(update.value);
    });
    plan.rowsToEstimatedWorkUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, KPI_ESTIMATED_PROJECT_HOURS_COLUMN).setValue(update.value);
    });
    if (plan.rowsToAppend.length) {
      sheet.getRange(lastRow + 1, 1, plan.rowsToAppend.length, KPI_COLUMN_COUNT)
        .setValues(plan.rowsToAppend);
      sheet.getRange(lastRow + 1, KPI_ACTUAL_PROJECT_HOURS_COLUMN, plan.rowsToAppend.length, 1)
        .setFormulaR1C1('=IF(RC[-1]="","",MAX(0,RC[-1]-RC[-3]))');
    }
    return {
      success: true,
      created: plan.rowsToAppend.length,
      filled: plan.rowsToUpdate.length,
      estimated_job_hours_filled: plan.rowsToJobHoursUpdate.length,
      estimated_drive_filled: plan.rowsToDriveUpdate.length,
      estimated_project_hours_filled: plan.rowsToEstimatedWorkUpdate.length,
    };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function refreshKpiJobTotals() {
  if (!isSquarecoilEstimateConfigured_()) {
    return { success: false, error: 'Squarecoil credentials are not configured' };
  }
  const lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(10000);
  try {
    const sheet = getKpiSheet_();
    ensureKpiKeyColumn_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < KPI_FIRST_DATA_ROW) return { success: true, jobs: 0, rows_updated: 0 };
    const existingRows = sheet
      .getRange(KPI_FIRST_DATA_ROW, 1, lastRow - KPI_FIRST_DATA_ROW + 1, KPI_COLUMN_COUNT)
      .getValues();
    const jobNums = Array.from(new Set(existingRows
      .map(row => String(row[3] || '').trim())
      .filter(jobNum => /^\d{5,6}$/.test(jobNum))));
    const jobHoursByNumber = squarecoilInstallHoursByJob_(jobNums, true);
    const plan = planKpiJobHoursBackfill_(existingRows, jobHoursByNumber);
    if (plan.values.length) {
      sheet.getRange(KPI_FIRST_DATA_ROW, KPI_TOTAL_JOB_HOURS_COLUMN, plan.values.length, 1)
        .setValues(plan.values);
      sheet.getRange(KPI_FIRST_DATA_ROW, KPI_ESTIMATED_PROJECT_HOURS_COLUMN, plan.estimatedWorkValues.length, 1)
        .setValues(plan.estimatedWorkValues);
    }
    return {
      success: true,
      jobs: jobNums.length,
      jobs_resolved: jobHoursByNumber.size,
      rows_updated: plan.updated,
    };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function syncInstallCalendarToKpi(data) {
  const now = new Date();
  const fromResult = parseScheduleDate_(data.from || formatDate(now), 'from');
  const defaultTo = new Date(now);
  defaultTo.setDate(defaultTo.getDate() + 60);
  const toResult = parseScheduleDate_(data.to || formatDate(defaultTo), 'to');
  if (fromResult.error) return { success: false, error: fromResult.error };
  if (toResult.error) return { success: false, error: toResult.error };
  if (toResult.date < fromResult.date) return { success: false, error: 'To date cannot be before from date' };
  const end = new Date(toResult.date);
  end.setHours(23, 59, 59, 999);
  const jobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', fromResult.date, end);
  return syncInstallJobsToKpi_(jobs);
}
