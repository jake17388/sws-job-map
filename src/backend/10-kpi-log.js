// ── Install KPI log ──────────────────────────────────────────────────────────
const KPI_HEADER_ROW = 1;
const KPI_FIRST_DATA_ROW = 2;
const KPI_COLUMN_COUNT = 32;
const KPI_CREW_SIZE_COLUMN = 8;
const KPI_TOTAL_JOB_HOURS_COLUMN = 9;
const KPI_DAY_ALLOCATION_COLUMN = 10;
const KPI_ESTIMATED_PROJECT_HOURS_COLUMN = 11;
const KPI_TOTAL_CLOCKED_HOURS_COLUMN = 12;
const KPI_ACTUAL_PROJECT_HOURS_COLUMN = 13;
const KPI_FLEETIO_AM_COLUMN = 15;
const KPI_FLEETIO_PM_COLUMN = 16;
const KPI_FILTER_COLUMN_COUNT = KPI_COLUMN_COUNT;
const KPI_LEGACY_KEY_COLUMN = 30;
const KPI_KEY_COLUMN = 32;
const KPI_KEY_HEADER = 'Calendar KPI Key';
const KPI_TABLE_NAME = 'InstallLogTable';
const KPI_SYNC_STATUS_SHEET_NAME = 'Sync Status';
const KPI_METRICS_SHEET_NAME = 'Install Metrics';
const KPI_METRICS_DRIVE_COLUMN = 13;
const KPI_METRICS_FIRST_DATA_ROW = 5;
const KPI_SYNC_STATUS_CONNECTIONS = Object.freeze([
  'Install Calendar',
  'UKG Hours',
  'Fleetio',
]);
const KPI_HOUR_HEADERS = [
  'Total Estimated Job Hours',
  'Day Allocation %',
  'Estimated Project Hours (Day)',
  'Total Clocked Hours (Day)',
  'Actual Project Work Hours',
];

function ensureInstallKpiSyncStatusSheet_() {
  const spreadsheet = SpreadsheetApp.openById(KPI_SHEET_ID);
  let sheet = spreadsheet.getSheetByName(KPI_SYNC_STATUS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(KPI_SYNC_STATUS_SHEET_NAME);
  if (String(sheet.getRange(1, 1).getValue() || '') !== 'Connection') {
    sheet.getRange(1, 1, 4, 4).setValues([
      ['Connection', 'Status', 'Last run', 'Details'],
      ['Install Calendar', '', '', ''],
      ['UKG Hours', '', '', ''],
      ['Fleetio', '', '', ''],
    ]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.getRange(2, 3, 3, 1).setNumberFormat('m/d/yyyy h:mm:ss AM/PM');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 4);
  }
  return sheet;
}

function installKpiSyncStatusDetails_(connection, result) {
  if (!result || result.success === false) return String(result && result.error || 'Unknown error');
  if (connection === 'Install Calendar') {
    return `Created ${Number(result.created || 0)}; updated ${Number(result.filled || 0)}; removed ${Number(result.removed || 0)}`;
  }
  const reportFound = result.report_found === false ? 'No' : 'Yes';
  return `Updated ${Number(result.updated || 0)}; matched ${Number(result.matched_crew_dates || 0)}; report found ${reportFound}`;
}

function recordInstallKpiSyncStatus_(connection, result) {
  const rowIndex = KPI_SYNC_STATUS_CONNECTIONS.indexOf(String(connection));
  if (rowIndex === -1) return;
  const status = result && result.success !== false ? 'OK' : 'ERROR';
  ensureInstallKpiSyncStatusSheet_()
    .getRange(rowIndex + 2, 2, 1, 3)
    .setValues([[status, new Date(), installKpiSyncStatusDetails_(connection, result)]]);
}

function getKpiSheet_() {
  const spreadsheet = SpreadsheetApp.openById(KPI_SHEET_ID);
  const sheet = spreadsheet.getSheetByName(KPI_SHEET_NAME);
  if (!sheet) throw new Error(`KPI sheet not found: ${KPI_SHEET_NAME}`);
  removeInstallMetricsDriveColumn_(spreadsheet.getSheetByName(KPI_METRICS_SHEET_NAME));
  ensureKpiDayColumn_(sheet);
  ensureKpiCrewSizeColumn_(sheet);
  ensureKpiHoursColumns_(sheet);
  ensureKpiFleetioColumns_(sheet);
  ensureKpiFilter_(sheet);
  return sheet;
}

function getKpiReportSheet_() {
  const spreadsheet = SpreadsheetApp.openById(KPI_SHEET_ID);
  const sheet = spreadsheet.getSheetByName(KPI_SHEET_NAME);
  if (!sheet) throw new Error(`KPI sheet not found: ${KPI_SHEET_NAME}`);
  return sheet;
}

function kpiReportColumnMap_(sheet, requiredHeaders) {
  const headers = sheet
    .getRange(KPI_HEADER_ROW, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(value => String(value || '').trim().toLowerCase());
  return (requiredHeaders || []).reduce((columns, header) => {
    const normalized = String(header || '').trim().toLowerCase();
    const matches = headers
      .map((value, index) => (value === normalized ? index + 1 : 0))
      .filter(Boolean);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one KPI column named "${header}"; found ${matches.length}`);
    }
    columns[header] = matches[0];
    return columns;
  }, {});
}

function removeInstallMetricsDriveColumn_(sheet) {
  if (!sheet) return false;
  const values = sheet.getRange(1, KPI_METRICS_DRIVE_COLUMN, 5, 1).getValues();
  const hasDriveHeader = values.some(row => (
    /^Est\.?\s+(?:drive|drie)(?:\s+\(hr\)|\s+hours?)?$/i.test(String(row[0] || '').trim())
  ));
  const hasWorkHeader = values.some(row => (
    /^Est\.?\s+work(?:\s+\(hr\)|\s+hours?)?$/i.test(String(row[0] || '').trim())
  ));
  if (!hasDriveHeader && !hasWorkHeader) return false;
  if (hasDriveHeader) sheet.deleteColumn(KPI_METRICS_DRIVE_COLUMN);
  const rowCount = Math.max(0, sheet.getLastRow() - KPI_METRICS_FIRST_DATA_ROW + 1);
  if (rowCount) {
    sheet.getRange(KPI_METRICS_FIRST_DATA_ROW, KPI_METRICS_DRIVE_COLUMN, rowCount, 1)
      .setFormulaR1C1(installMetricsWorkHoursFormulaR1C1_())
      .setNumberFormat('0.0');
  }
  return hasDriveHeader;
}

function installMetricsWorkHoursFormulaR1C1_() {
  return '=IF(RC[-12]="","",SUMIFS(\'Install Log\'!R2C13:R2291C13,\'Install Log\'!R2C3:R2291C3,RC[-12],\'Install Log\'!R2C2:R2291C2,">="&IF(R2C2="",0,R2C2),\'Install Log\'!R2C2:R2291C2,"<="&IF(R2C5="",2958465,R2C5)))';
}

function ensureKpiFleetioColumns_(sheet) {
  const headerRange = sheet.getRange(KPI_HEADER_ROW, KPI_FLEETIO_AM_COLUMN, 1, 2);
  const headers = headerRange.getValues()[0].map(value => String(value || '').trim());
  if (headers[0] === 'Fleetio AM' && headers[1] === 'Fleetio PM') return false;
  if (headers[0] !== 'Late Departure (After 6:30)') {
    throw new Error(`Unexpected KPI column O: ${headers[0] || '(blank)'}`);
  }

  sheet.insertColumnsBefore(KPI_FLEETIO_AM_COLUMN, 2);
  const maxRows = sheet.getMaxRows();
  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.CopyPasteType) {
    const source = sheet.getRange(KPI_HEADER_ROW, KPI_FLEETIO_AM_COLUMN + 2, maxRows, 2);
    const destination = sheet.getRange(KPI_HEADER_ROW, KPI_FLEETIO_AM_COLUMN, maxRows, 2);
    source.copyTo(destination, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  sheet.getRange(KPI_HEADER_ROW, KPI_FLEETIO_AM_COLUMN, 1, 2)
    .setValues([['Fleetio AM', 'Fleetio PM']]);
  const lastRow = sheet.getLastRow();
  if (lastRow >= KPI_FIRST_DATA_ROW) {
    sheet.getRange(KPI_FIRST_DATA_ROW, KPI_FLEETIO_AM_COLUMN, lastRow - KPI_FIRST_DATA_ROW + 1, 2)
      .insertCheckboxes()
      .setValue(false);
  }
  return true;
}

function ensureKpiFilter_(sheet) {
  if (sheet.getFilter()) return false;
  const rowCount = Math.max(1, sheet.getMaxRows() - KPI_HEADER_ROW + 1);
  sheet.getRange(KPI_HEADER_ROW, 1, rowCount, KPI_FILTER_COLUMN_COUNT).createFilter();
  return true;
}

function buildKpiTableResizeRequest_(tableId, sheetId, lastRow) {
  return {
    updateTable: {
      table: {
        tableId,
        range: {
          sheetId,
          startRowIndex: KPI_HEADER_ROW - 1,
          endRowIndex: Math.max(KPI_HEADER_ROW, lastRow),
          startColumnIndex: 0,
          endColumnIndex: KPI_COLUMN_COUNT,
        },
      },
      fields: 'range',
    },
  };
}

function buildKpiFilterResizeRequest_(sheetId, lastRow, currentFilter) {
  const filter = {
    range: {
      sheetId,
      startRowIndex: KPI_HEADER_ROW - 1,
      endRowIndex: Math.max(KPI_HEADER_ROW, lastRow),
      startColumnIndex: 0,
      endColumnIndex: KPI_COLUMN_COUNT,
    },
  };
  if (currentFilter && currentFilter.sortSpecs) filter.sortSpecs = currentFilter.sortSpecs;
  if (currentFilter && currentFilter.filterSpecs) filter.filterSpecs = currentFilter.filterSpecs;
  else if (currentFilter && currentFilter.criteria) filter.criteria = currentFilter.criteria;
  return { setBasicFilter: { filter } };
}

function kpiSheetsApiRequest_(url, options) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    ...options,
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Google Sheets API failed (${status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function resizeKpiNativeTable_(sheet) {
  if (typeof UrlFetchApp === 'undefined' || typeof ScriptApp === 'undefined') return false;
  const sheetId = sheet.getSheetId();
  const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(KPI_SHEET_ID)}`
    + '?fields=sheets(properties(sheetId),basicFilter,tables(tableId,name,range))';
  const metadata = kpiSheetsApiRequest_(metadataUrl);
  const sheetMetadata = (metadata.sheets || [])
    .find(candidate => Number(candidate && candidate.properties && candidate.properties.sheetId) === Number(sheetId));
  const table = (sheetMetadata && sheetMetadata.tables || [])
    .find(candidate => candidate && candidate.name === KPI_TABLE_NAME);
  const lastRow = Math.max(KPI_HEADER_ROW, sheet.getLastRow());
  const range = table && table.range || sheetMetadata && sheetMetadata.basicFilter && sheetMetadata.basicFilter.range || {};
  if (range.startRowIndex === KPI_HEADER_ROW - 1
    && range.endRowIndex === lastRow
    && range.startColumnIndex === 0
    && range.endColumnIndex === KPI_COLUMN_COUNT) {
    return false;
  }

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(KPI_SHEET_ID)}:batchUpdate`;
  const request = table && table.tableId
    ? buildKpiTableResizeRequest_(table.tableId, sheetId, lastRow)
    : buildKpiFilterResizeRequest_(sheetId, lastRow, sheetMetadata && sheetMetadata.basicFilter);
  if (!table && !(sheetMetadata && sheetMetadata.basicFilter)) return false;
  kpiSheetsApiRequest_(batchUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      requests: [request],
    }),
  });
  return true;
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
  const hadDriveHours = /drive/i.test(headers[1]);
  const alreadyMigrated = headers[3] === KPI_HOUR_HEADERS[3];
  if (!alreadyMigrated) {
    if (!/^Act\. work(?: \(hr\))?$/i.test(headers[3])) {
      throw new Error(`Unexpected KPI hours column K: ${headers[3] || '(blank)'}`);
    }
    sheet.insertColumnBefore(KPI_TOTAL_CLOCKED_HOURS_COLUMN);
  }
  sheet.getRange(KPI_HEADER_ROW, KPI_TOTAL_JOB_HOURS_COLUMN, 1, KPI_HOUR_HEADERS.length)
    .setValues([KPI_HOUR_HEADERS]);

  if (hadDriveHours && sheet.getLastRow() >= KPI_FIRST_DATA_ROW) {
    const rowCount = sheet.getLastRow() - KPI_FIRST_DATA_ROW + 1;
    sheet.getRange(KPI_FIRST_DATA_ROW, KPI_DAY_ALLOCATION_COLUMN, rowCount, 1)
      .clearContent()
      .setNumberFormat('0.00%');
  }
  if (!alreadyMigrated || hadDriveHours) backfillKpiHourColumns_(sheet);
  return !alreadyMigrated || hadDriveHours;
}

function ensureKpiCrewSizeColumn_(sheet) {
  const header = String(sheet.getRange(KPI_HEADER_ROW, KPI_CREW_SIZE_COLUMN).getValue() || '').trim();
  if (header === 'Crew Size') return false;
  if (!/^(?:Est\. Total Job hrs|Total Estimated Job Hours)$/i.test(header)) {
    throw new Error(`Unexpected KPI column H: ${header || '(blank)'}`);
  }
  sheet.insertColumnBefore(KPI_CREW_SIZE_COLUMN);
  sheet.getRange(KPI_HEADER_ROW, KPI_CREW_SIZE_COLUMN).setValue('Crew Size');
  const lastRow = sheet.getLastRow();
  if (lastRow >= KPI_FIRST_DATA_ROW) {
    setKpiCrewSizeFormulas_(sheet, KPI_FIRST_DATA_ROW, lastRow - KPI_FIRST_DATA_ROW + 1);
  }
  return true;
}

function kpiCrewSizeFormulaR1C1_() {
  return '=IF(OR(RC[-3]="",RC[-6]=""),"",COUNTIFS(C5,RC[-3],C2,RC[-6]))';
}

function setKpiCrewSizeFormulas_(sheet, startRow, rowCount) {
  if (!rowCount) return;
  sheet.getRange(startRow, KPI_CREW_SIZE_COLUMN, rowCount, 1)
    .setFormulaR1C1(kpiCrewSizeFormulaR1C1_());
}

function kpiEstimatedProjectHoursFormulaR1C1_() {
  return '=IF(OR(RC[-2]="",RC[-7]="",RC[-9]="",RC[-3]=""),"",ROUND(MAX(0,RC[-2]/COUNTUNIQUEIFS(C2,C4,RC[-7])/RC[-3]),2))';
}

function setKpiEstimatedProjectHourFormulas_(sheet, startRow, rowCount) {
  if (!rowCount) return;
  sheet.getRange(startRow, KPI_ESTIMATED_PROJECT_HOURS_COLUMN, rowCount, 1)
    .setFormulaR1C1(kpiEstimatedProjectHoursFormulaR1C1_());
}

function kpiDayAllocationFormulaR1C1_() {
  return '=IF(OR(RC[-7]="",RC[-8]=""),"",1/COUNTIFS(C3,RC[-7],C2,RC[-8]))';
}

function setKpiDayAllocationFormulas_(sheet, startRow, rowCount) {
  if (!rowCount) return;
  const range = sheet.getRange(startRow, KPI_DAY_ALLOCATION_COLUMN, rowCount, 1);
  const values = range.getValues();
  const formulas = typeof range.getFormulasR1C1 === 'function'
    ? range.getFormulasR1C1()
    : values.map(() => ['']);
  range
    .setFormulaR1C1(kpiDayAllocationFormulaR1C1_())
    .setNumberFormat('0.00%');
  values.forEach((row, index) => {
    if (formulas[index][0] || row[0] === '' || row[0] == null) return;
    sheet.getRange(startRow + index, KPI_DAY_ALLOCATION_COLUMN)
      .setValue(row[0]);
  });
}

function kpiActualProjectHoursFormulaR1C1_() {
  return '=IF(OR(RC[-1]="",RC[-3]=""),"",ROUND(RC[-1]*RC[-3],2))';
}

function backfillKpiHourColumns_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) return;
  const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
  setKpiDayAllocationFormulas_(sheet, KPI_FIRST_DATA_ROW, rowCount);
  setKpiEstimatedProjectHourFormulas_(sheet, KPI_FIRST_DATA_ROW, rowCount);

  const actualRange = sheet.getRange(KPI_FIRST_DATA_ROW, KPI_ACTUAL_PROJECT_HOURS_COLUMN, rowCount, 1);
  const actualValues = actualRange.getValues();
  const actualFormulas = typeof actualRange.getFormulasR1C1 === 'function'
    ? actualRange.getFormulasR1C1()
    : actualValues.map(() => ['']);
  actualRange.setFormulaR1C1(kpiActualProjectHoursFormulaR1C1_());
  actualValues.forEach((row, index) => {
    const existingFormula = actualFormulas[index][0];
    const existingValue = row[0];
    if (existingFormula || existingValue === '' || existingValue == null) return;
    const cell = sheet.getRange(KPI_FIRST_DATA_ROW + index, KPI_ACTUAL_PROJECT_HOURS_COLUMN);
    cell.setValue(existingValue);
  });
}

function vehicleNameForKpi_(vehicleId) {
  const id = String(vehicleId || '').trim();
  if (!id) return '';
  const vehicle = vehicleRoster_().find(candidate => String(candidate.id) === id);
  return vehicle ? String(vehicle.displayName) : '';
}

function kpiDateKeysForCalendarEvent_(event) {
  const range = calendarEventRange_(event);
  if (!range) return [];
  const cursor = new Date(
    range.start.getFullYear(),
    range.start.getMonth(),
    range.start.getDate(),
    12,
  );
  const dates = [];
  while (cursor < range.end && dates.length < 366) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function syncKpiTruckAssignmentsForCalendarUpdates_(updates) {
  const desiredTruckByKey = new Map();
  (updates || []).forEach(update => {
    if (!update || String(update.calendarId || '') !== String(INSTALL_CAL_ID)) return;
    const event = update.event;
    const eventId = event && typeof event.getId === 'function' ? String(event.getId()) : '';
    if (!eventId) return;
    const crew = crewFromCalendarTitle_(event.getTitle());
    const dates = kpiDateKeysForCalendarEvent_(event);
    crew.forEach(name => {
      const truckName = vehicleNameForKpi_((update.assignments || {})[name]);
      dates.forEach(date => desiredTruckByKey.set(kpiKey_(eventId, date, name), truckName));
    });
  });
  if (!desiredTruckByKey.size) return { success: true, rows_updated: 0 };

  const sheet = getKpiSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) return { success: true, rows_updated: 0 };
  const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
  const rows = sheet.getRange(KPI_FIRST_DATA_ROW, 1, rowCount, KPI_COLUMN_COUNT).getValues();
  let rowsUpdated = 0;
  rows.forEach((row, index) => {
    const key = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
    if (!desiredTruckByKey.has(key)) return;
    const desiredTruck = desiredTruckByKey.get(key);
    if (String((row || [])[5] || '') === desiredTruck) return;
    sheet.getRange(KPI_FIRST_DATA_ROW + index, 6, 1, 1).setValue(desiredTruck);
    rowsUpdated += 1;
  });
  return { success: true, rows_updated: rowsUpdated };
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

function kpiSheetDateSerial_(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return value;
  const epoch = Date.UTC(1899, 11, 30);
  const date = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  return Math.round((date - epoch) / 86400000);
}

function kpiWritableRow_(values) {
  const writable = (values || []).slice();
  if (writable.length > 1) writable[1] = kpiSheetDateSerial_(writable[1]);
  return writable;
}

function buildKpiSeedRows_(jobs, jobHoursByNumber) {
  const seeds = [];
  (jobs || []).forEach(job => {
    if (String(job.type || '').toLowerCase() !== 'install' || !job.event_id) return;
    const crew = normalizeUnscheduledCrew_(job.crew);
    if (!crew.length) return;
    const workDates = inclusiveDateStrings_(job.start, job.end);
    workDates.forEach(workDate => {
      crew.forEach(crewMember => {
        const key = kpiKey_(job.event_id, workDate, crewMember);
        const values = Array(KPI_COLUMN_COUNT).fill('');
        const [year, month, day] = workDate.split('-').map(Number);
        // A fixed UTC midday keeps the written serial on the intended date in
        // both the Phoenix script and Los Angeles spreadsheet time zones.
        const sheetDate = new Date(Date.UTC(year, month - 1, day, 12));
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
        values[13] = false;
        values[KPI_FLEETIO_AM_COLUMN - 1] = false;
        values[KPI_FLEETIO_PM_COLUMN - 1] = false;
        values[KPI_KEY_COLUMN - 1] = key;
        seeds.push({ key, values });
      });
    });
  });
  return seeds;
}

function kpiRowDate_(row) {
  const value = (row || [])[1];
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const key = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
  const parts = key.split('|');
  if (parts.length < 3) return null;
  const result = parseScheduleDate_(parts[parts.length - 2], 'KPI row');
  return result.error ? null : result.date;
}

function kpiRowIsInReconcileWindow_(row, options) {
  const start = options && options.reconcileStart;
  const end = options && options.reconcileEnd;
  if (!(start instanceof Date) || !(end instanceof Date)) return false;
  const date = kpiRowDate_(row);
  return !!date && date >= start && date <= end;
}

function kpiKeyMatchesRow_(key, row) {
  const parts = String(key || '').trim().split('|');
  if (parts.length < 3) return false;
  const dateValue = (row || [])[1];
  const date = dateValue instanceof Date && Number.isFinite(dateValue.getTime())
    ? formatDate(dateValue)
    : String(dateValue || '').trim();
  const crewMember = String((row || [])[2] || '').trim();
  return parts[parts.length - 2] === date && parts[parts.length - 1] === crewMember;
}

function kpiFallbackKeyForRow_(row) {
  const dateValue = (row || [])[1];
  const date = dateValue instanceof Date && Number.isFinite(dateValue.getTime())
    ? formatDate(dateValue)
    : String(dateValue || '').trim();
  const crewMember = String((row || [])[2] || '').trim();
  const jobNumber = String((row || [])[3] || '').trim();
  if (!date || !crewMember || !jobNumber) return '';
  return `${date}|${crewMember}|${jobNumber}`;
}

function kpiRowLooksCalendarManaged_(row) {
  const crewMember = String((row || [])[2] || '').trim();
  const jobNumber = String((row || [])[3] || '').trim();
  return CREW_NAMES.includes(crewMember) && /^\d{5,6}$/.test(jobNumber);
}

function kpiRowPreservationScore_(row) {
  let score = 0;
  for (let column = KPI_DAY_ALLOCATION_COLUMN - 1;
    column < KPI_LEGACY_KEY_COLUMN - 1;
    column += 1) {
    const value = (row || [])[column];
    if (value === true) score += 2;
    else if (value !== false && value != null && String(value).trim() !== '') score += 1;
  }
  return score;
}

function planKpiSync_(jobs, existingRows, jobHoursByNumber, options) {
  const rowsByKey = new Map();
  const rowsByFallbackKey = new Map();
  (existingRows || []).forEach((row, index) => {
    const canonicalKey = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
    const legacyKey = String((row || [])[KPI_LEGACY_KEY_COLUMN - 1] || '').trim();
    const key = kpiKeyMatchesRow_(canonicalKey, row)
      ? canonicalKey
      : (kpiKeyMatchesRow_(legacyKey, row) ? legacyKey : '');
    const candidate = { index, row, key, canonicalKey, legacyKey };
    if (key) {
      if (!rowsByKey.has(key)) rowsByKey.set(key, []);
      rowsByKey.get(key).push(candidate);
    }
    const fallbackKey = kpiFallbackKeyForRow_(row);
    if (fallbackKey) {
      if (!rowsByFallbackKey.has(fallbackKey)) rowsByFallbackKey.set(fallbackKey, []);
      rowsByFallbackKey.get(fallbackKey).push(candidate);
    }
  });
  const rowsToAppend = [];
  const rowsToUpdate = [];
  const rowsToJobHoursUpdate = [];
  const rowsToKeyUpdate = [];
  const seeds = buildKpiSeedRows_(jobs, jobHoursByNumber);
  const desiredKeys = new Set(seeds.map(seed => seed.key));
  const seedsByFallbackKey = new Map();
  seeds.forEach(seed => {
    const fallbackKey = kpiFallbackKeyForRow_(seed.values);
    if (!seedsByFallbackKey.has(fallbackKey)) seedsByFallbackKey.set(fallbackKey, []);
    seedsByFallbackKey.get(fallbackKey).push(seed);
  });
  const claimedRowIndexes = new Set();
  const duplicateRowIndexes = new Set();
  seeds.forEach(seed => {
    const fallbackKey = kpiFallbackKeyForRow_(seed.values);
    const fallbackIsUnambiguous = (seedsByFallbackKey.get(fallbackKey) || []).length === 1;
    const candidatesByIndex = new Map();
    (rowsByKey.get(seed.key) || []).forEach(candidate => candidatesByIndex.set(candidate.index, candidate));
    if (fallbackIsUnambiguous) {
      (rowsByFallbackKey.get(fallbackKey) || []).forEach(candidate => {
        if (!claimedRowIndexes.has(candidate.index)) candidatesByIndex.set(candidate.index, candidate);
      });
    }
    const candidates = Array.from(candidatesByIndex.values())
      .filter(candidate => !claimedRowIndexes.has(candidate.index))
      .sort((left, right) => kpiRowPreservationScore_(right.row) - kpiRowPreservationScore_(left.row));
    const existing = candidates[0];
    if (!existing) {
      rowsToAppend.push(seed.values);
      return;
    }
    claimedRowIndexes.add(existing.index);
    candidates.slice(1).forEach(candidate => duplicateRowIndexes.add(candidate.index));
    if (existing.canonicalKey !== seed.key || kpiKeyMatchesRow_(existing.legacyKey, existing.row)) {
      rowsToKeyUpdate.push({
        index: existing.index,
        key: seed.key,
        clearLegacy: kpiKeyMatchesRow_(existing.legacyKey, existing.row),
      });
    }
    const scheduleValues = seed.values.slice(0, 6);
    const changed = scheduleValues.some((value, column) => {
      const current = existing.row[column];
      if (value instanceof Date) {
        return !(current instanceof Date) || formatDate(current) !== formatDate(value);
      }
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
  });
  const rowIndexesToDelete = new Set();
  (existingRows || []).forEach((row, index) => {
    if (!kpiRowIsInReconcileWindow_(row, options)) return;
    if (duplicateRowIndexes.has(index)) {
      rowIndexesToDelete.add(index);
      return;
    }
    const canonicalKey = String((row || [])[KPI_KEY_COLUMN - 1] || '').trim();
    const legacyKey = String((row || [])[KPI_LEGACY_KEY_COLUMN - 1] || '').trim();
    const key = kpiKeyMatchesRow_(canonicalKey, row)
      ? canonicalKey
      : (kpiKeyMatchesRow_(legacyKey, row) ? legacyKey : '');
    const fallbackKey = kpiFallbackKeyForRow_(row);
    const staleKeyedRow = key && !desiredKeys.has(key);
    const staleKeylessRow = !key
      && kpiRowLooksCalendarManaged_(row)
      && !seedsByFallbackKey.has(fallbackKey);
    if (!claimedRowIndexes.has(index) && (staleKeyedRow || staleKeylessRow)) {
      rowIndexesToDelete.add(index);
    }
  });
  return {
    rowsToAppend,
    rowsToUpdate,
    rowsToJobHoursUpdate,
    rowsToKeyUpdate,
    rowIndexesToDelete: Array.from(rowIndexesToDelete).sort((left, right) => left - right),
  };
}

function planKpiJobHoursBackfill_(existingRows, jobHoursByNumber) {
  let updated = 0;
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
  return { values, updated };
}

function syncInstallJobsToKpi_(jobs, options) {
  const lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(10000);
  try {
    const sheet = getKpiSheet_();
    ensureKpiKeyColumn_(sheet);
    const skipEstimates = !!(options && options.skipEstimates);
    let jobHoursByNumber = new Map();
    if (!skipEstimates) {
      try {
        jobHoursByNumber = squarecoilInstallHoursByJob_(
          Array.from(new Set((jobs || []).map(job => String(job && job.num || '')).filter(Boolean)))
        );
      } catch (error) {
        if (typeof Logger !== 'undefined') Logger.log(`Squarecoil install hours failed: ${error.message}`);
      }
    }
    const lastRow = Math.max(sheet.getLastRow(), KPI_HEADER_ROW);
    const existingRows = lastRow >= KPI_FIRST_DATA_ROW
      ? sheet.getRange(KPI_FIRST_DATA_ROW, 1, lastRow - KPI_FIRST_DATA_ROW + 1, KPI_COLUMN_COUNT).getValues()
      : [];
    const plan = planKpiSync_(jobs, existingRows, jobHoursByNumber, options);
    plan.rowsToUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, 1, 1, 6)
        .setValues([kpiWritableRow_(update.values)]);
    });
    plan.rowsToJobHoursUpdate.forEach(update => {
      sheet.getRange(KPI_FIRST_DATA_ROW + update.index, KPI_TOTAL_JOB_HOURS_COLUMN).setValue(update.value);
    });
    plan.rowsToKeyUpdate.forEach(update => {
      const rowNumber = KPI_FIRST_DATA_ROW + update.index;
      sheet.getRange(rowNumber, KPI_KEY_COLUMN).setValue(update.key);
      if (update.clearLegacy) sheet.getRange(rowNumber, KPI_LEGACY_KEY_COLUMN).setValue('');
    });
    plan.rowIndexesToDelete
      .slice()
      .sort((left, right) => right - left)
      .forEach(index => sheet.deleteRow(KPI_FIRST_DATA_ROW + index));
    if (plan.rowsToAppend.length) {
      const appendRow = Math.max(sheet.getLastRow(), KPI_HEADER_ROW) + 1;
      sheet.getRange(appendRow, 1, plan.rowsToAppend.length, KPI_COLUMN_COUNT)
        .setValues(plan.rowsToAppend.map(kpiWritableRow_));
      sheet.getRange(appendRow, KPI_FLEETIO_AM_COLUMN, plan.rowsToAppend.length, 2)
        .insertCheckboxes()
        .setValue(false);
      sheet.getRange(appendRow, KPI_ACTUAL_PROJECT_HOURS_COLUMN, plan.rowsToAppend.length, 1)
        .setFormulaR1C1(kpiActualProjectHoursFormulaR1C1_());
    }
    const formulaRowCount = Math.max(0, sheet.getLastRow() - KPI_FIRST_DATA_ROW + 1);
    setKpiCrewSizeFormulas_(sheet, KPI_FIRST_DATA_ROW, formulaRowCount);
    setKpiDayAllocationFormulas_(sheet, KPI_FIRST_DATA_ROW, formulaRowCount);
    setKpiEstimatedProjectHourFormulas_(sheet, KPI_FIRST_DATA_ROW, formulaRowCount);
    resizeKpiNativeTable_(sheet);
    return {
      success: true,
      created: plan.rowsToAppend.length,
      removed: plan.rowIndexesToDelete.length,
      filled: plan.rowsToUpdate.length,
      estimated_job_hours_filled: plan.rowsToJobHoursUpdate.length,
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
      setKpiCrewSizeFormulas_(sheet, KPI_FIRST_DATA_ROW, plan.values.length);
      setKpiDayAllocationFormulas_(sheet, KPI_FIRST_DATA_ROW, plan.values.length);
      setKpiEstimatedProjectHourFormulas_(sheet, KPI_FIRST_DATA_ROW, plan.values.length);
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
  return syncInstallJobsToKpi_(jobs, {
    reconcileStart: fromResult.date,
    reconcileEnd: end,
  });
}
