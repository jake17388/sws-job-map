// ── Install KPI log ──────────────────────────────────────────────────────────
const KPI_HEADER_ROW = 17;
const KPI_FIRST_DATA_ROW = 18;
const KPI_COLUMN_COUNT = 26;
const KPI_KEY_COLUMN = 26;
const KPI_KEY_HEADER = 'Calendar KPI Key';
const KPI_STATUSES = ['Yes', 'Partial', 'No', 'Pending'];

function getKpiSheet_() {
  const spreadsheet = SpreadsheetApp.openById(KPI_SHEET_ID);
  const sheet = spreadsheet.getSheetByName(KPI_SHEET_NAME);
  if (!sheet) throw new Error(`KPI sheet not found: ${KPI_SHEET_NAME}`);
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

function vehicleNameForKpi_(vehicleId) {
  const id = String(vehicleId || '').trim();
  if (!id) return '';
  const vehicle = vehicleRoster_().find(candidate => String(candidate.id) === id);
  return vehicle ? String(vehicle.displayName) : '';
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

function buildKpiSeedRows_(jobs) {
  const seeds = [];
  (jobs || []).forEach(job => {
    if (String(job.type || '').toLowerCase() !== 'install' || !job.event_id) return;
    const crew = normalizeUnscheduledCrew_(job.crew);
    if (!crew.length) return;
    inclusiveDateStrings_(job.start, job.end).forEach(workDate => {
      const dateResult = parseScheduleDate_(workDate, 'work');
      crew.forEach(crewMember => {
        const key = kpiKey_(job.event_id, workDate, crewMember);
        const values = Array(KPI_COLUMN_COUNT).fill('');
        values[0] = dateResult.date;
        values[1] = crewMember;
        values[2] = String(job.num || '');
        values[3] = String(job.title || '');
        values[4] = vehicleNameForKpi_((job.truck_assignments || {})[crewMember]);
        values[9] = 'Pending';
        values[KPI_KEY_COLUMN - 1] = key;
        seeds.push({ key, values });
      });
    });
  });
  return seeds;
}

function planKpiSync_(jobs, existingRows) {
  const rowsByKey = new Map();
  (existingRows || []).forEach((row, index) => {
    const key = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
    if (key && !rowsByKey.has(key)) rowsByKey.set(key, { index, row });
  });
  const rowsToAppend = [];
  const rowsToUpdate = [];
  buildKpiSeedRows_(jobs).forEach(seed => {
    const existing = rowsByKey.get(seed.key);
    if (!existing) {
      rowsToAppend.push(seed.values);
      rowsByKey.set(seed.key, { index: -1, row: seed.values });
      return;
    }
    const scheduleValues = existing.row.slice(0, 5);
    let changed = false;
    for (let column = 0; column < 5; column += 1) {
      if ((scheduleValues[column] === '' || scheduleValues[column] == null) && seed.values[column] !== '') {
        scheduleValues[column] = seed.values[column];
        changed = true;
      }
    }
    if (changed) rowsToUpdate.push({ index: existing.index, values: scheduleValues });
  });
  return { rowsToAppend, rowsToUpdate };
}

function syncInstallJobsToKpi_(jobs) {
  const lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(10000);
  try {
    const sheet = getKpiSheet_();
    ensureKpiKeyColumn_(sheet);
    const lastRow = Math.max(sheet.getLastRow(), KPI_HEADER_ROW);
    const existingRows = lastRow >= KPI_FIRST_DATA_ROW
      ? sheet.getRange(KPI_FIRST_DATA_ROW, 1, lastRow - KPI_FIRST_DATA_ROW + 1, KPI_COLUMN_COUNT).getValues()
      : [];
    const plan = planKpiSync_(jobs, existingRows);
    plan.rowsToUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, 1, 1, 5).setValues([update.values]);
    });
    if (plan.rowsToAppend.length) {
      sheet.getRange(lastRow + 1, 1, plan.rowsToAppend.length, KPI_COLUMN_COUNT)
        .setValues(plan.rowsToAppend);
    }
    return {
      success: true,
      created: plan.rowsToAppend.length,
      filled: plan.rowsToUpdate.length,
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

function findKpiEntryByKey_(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) return null;
  const rows = sheet.getRange(KPI_FIRST_DATA_ROW, 1, lastRow - KPI_FIRST_DATA_ROW + 1, KPI_COLUMN_COUNT).getValues();
  for (let index = 0; index < rows.length; index += 1) {
    if (String(rows[index][KPI_KEY_COLUMN - 1] || '') === key) {
      return { rowNumber: KPI_FIRST_DATA_ROW + index, values: rows[index] };
    }
  }
  return null;
}

function nonNegativeKpiNumber_(value, label) {
  if (value === '' || value == null) return { value: '' };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return { error: `${label} must be zero or greater` };
  return { value: parsed };
}

function validateKpiEntry_(data) {
  const eventId = String(data.event_id || '').trim();
  if (!eventId) return { error: 'Invalid calendar event' };
  const dateResult = parseScheduleDate_(data.work_date, 'work');
  if (dateResult.error) return { error: dateResult.error };
  const crewMember = String(data.crew_member || '').trim();
  if (!CREW_NAMES.includes(crewMember)) return { error: 'Invalid crew member' };
  const drive = nonNegativeKpiNumber_(data.estimated_drive_minutes, 'Estimated drive minutes');
  if (drive.error) return { error: drive.error };
  const work = nonNegativeKpiNumber_(data.estimated_work_hours, 'Estimated work hours');
  if (work.error) return { error: work.error };
  const completionStatus = String(data.completion_status || 'Pending').trim();
  if (!KPI_STATUSES.includes(completionStatus)) return { error: 'Invalid completion status' };
  const expectedWork = String(data.expected_work || '').trim();
  const notes = String(data.notes || '').trim();
  if (expectedWork.length > 2000) return { error: 'Expected work is too long' };
  if (notes.length > 4000) return { error: 'Notes are too long' };
  return {
    value: {
      event_id: eventId,
      work_date: formatDate(dateResult.date),
      crew_member: crewMember,
      estimated_drive_minutes: drive.value,
      estimated_work_hours: work.value,
      expected_work: expectedWork,
      completion_status: completionStatus,
      notes,
    },
  };
}

function getKpiEntry(data) {
  const validation = validateKpiEntry_({
    ...data,
    estimated_drive_minutes: '',
    estimated_work_hours: '',
    expected_work: '',
    completion_status: 'Pending',
    notes: '',
  });
  if (validation.error) return { success: false, error: validation.error };
  const value = validation.value;
  const entry = findKpiEntryByKey_(getKpiSheet_(), kpiKey_(value.event_id, value.work_date, value.crew_member));
  if (!entry) return { success: false, error: 'KPI row not found. Refresh the jobs and try again.' };
  return {
    success: true,
    entry: {
      estimated_drive_minutes: entry.values[6],
      estimated_work_hours: entry.values[7],
      expected_work: entry.values[8],
      completion_status: entry.values[9] || 'Pending',
      notes: entry.values[10],
    },
  };
}

function saveKpiEntry(data) {
  const validation = validateKpiEntry_(data);
  if (validation.error) return { success: false, error: validation.error };
  const lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(10000);
  try {
    const value = validation.value;
    const sheet = getKpiSheet_();
    const entry = findKpiEntryByKey_(sheet, kpiKey_(value.event_id, value.work_date, value.crew_member));
    if (!entry) return { success: false, error: 'KPI row not found. Refresh the jobs and try again.' };
    sheet.getRange(entry.rowNumber, 7, 1, 5).setValues([[
      value.estimated_drive_minutes,
      value.estimated_work_hours,
      value.expected_work,
      value.completion_status,
      value.notes,
    ]]);
    return { success: true, entry: value };
  } finally {
    if (lock) lock.releaseLock();
  }
}
