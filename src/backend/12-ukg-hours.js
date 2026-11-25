// ── UKG daily clocked hours ──────────────────────────────────────────────────
const UKG_HOURS_EMAIL_QUERY = 'subject:"Install Daily Hours Export" has:attachment newer_than:30d';
const UKG_GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const UKG_KPI_CLOCKED_HOURS_INDEX = 11;
const UKG_INSTALL_CREW_BY_EMPLOYEE_ID = Object.freeze({
  '46': 'Johnny',
  '131': 'Eli',
  '251': 'Jerry',
  '230': 'Jonathan',
  '270': 'Randy',
  '284': 'Jake',
  '294': 'Caden',
});

function normalizeUkgHeader_(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseUkgHoursNumber_(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!text || text === '-') return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function ukgDateKey_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return '';
}

function parseUkgDailyHoursRows_(rows) {
  if (!Array.isArray(rows) || !rows.length) return new Map();
  const requiredHeaders = [
    'Employee Id',
    'Date',
    'Regular Hours',
    'Overtime Hours',
    'Double Time Hours',
  ].map(normalizeUkgHeader_);
  const headerRowIndex = rows.findIndex(row => {
    const candidate = (row || []).map(normalizeUkgHeader_);
    return requiredHeaders.every(header => candidate.includes(header));
  });
  if (headerRowIndex === -1) {
    throw new Error('UKG CSV is missing Employee Id, Date, Regular, Overtime, or Double Time hours');
  }
  const headers = rows[headerRowIndex].map(normalizeUkgHeader_);
  const indexOf = name => headers.indexOf(normalizeUkgHeader_(name));
  const employeeIndex = indexOf('Employee Id');
  const dateIndex = indexOf('Date');
  const regularIndex = indexOf('Regular Hours');
  const overtimeIndex = indexOf('Overtime Hours');
  const doubleTimeIndex = indexOf('Double Time Hours');

  const hoursByEmployeeDate = new Map();
  rows.slice(headerRowIndex + 1).forEach(row => {
    const employeeId = String(row[employeeIndex] == null ? '' : row[employeeIndex]).trim();
    const dateKey = ukgDateKey_(row[dateIndex]);
    if (!employeeId || !dateKey) return;
    const total = parseUkgHoursNumber_(row[regularIndex])
      + parseUkgHoursNumber_(row[overtimeIndex])
      + parseUkgHoursNumber_(row[doubleTimeIndex]);
    const key = `${employeeId}|${dateKey}`;
    const next = (hoursByEmployeeDate.get(key) || 0) + total;
    hoursByEmployeeDate.set(key, Math.round(next * 100) / 100);
  });
  return hoursByEmployeeDate;
}

function mergeUkgDailyHoursReports_(reports) {
  const merged = new Map();
  (reports || []).forEach(rows => {
    parseUkgDailyHoursRows_(rows).forEach((hours, key) => merged.set(key, hours));
  });
  return merged;
}

function planKpiClockedHoursSync_(existingRows, hoursByEmployeeDate, columnIndexes) {
  const indexes = columnIndexes || {};
  const dateIndex = indexes.date == null ? 1 : indexes.date;
  const crewIndex = indexes.crew == null ? 2 : indexes.crew;
  const clockedHoursIndex = indexes.clockedHours == null
    ? UKG_KPI_CLOCKED_HOURS_INDEX
    : indexes.clockedHours;
  const employeeIdByCrew = Object.entries(UKG_INSTALL_CREW_BY_EMPLOYEE_ID)
    .reduce((result, entry) => {
      result[entry[1]] = entry[0];
      return result;
    }, {});
  let updated = 0;
  const matched = new Set();
  const values = (existingRows || []).map(row => {
    const dateKey = ukgDateKey_(row[dateIndex]);
    const employeeId = employeeIdByCrew[String(row[crewIndex] || '').trim()];
    const key = employeeId && dateKey ? `${employeeId}|${dateKey}` : '';
    const existing = row[clockedHoursIndex];
    if (!key || !hoursByEmployeeDate.has(key)) return [existing];
    matched.add(key);
    const next = hoursByEmployeeDate.get(key);
    if (Number(existing) !== next || existing === '' || existing == null) updated += 1;
    return [next];
  });
  return { values, updated, matchedCrewDates: matched.size };
}

function gmailReadOnlyApiGet_(path) {
  const response = UrlFetchApp.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Gmail read-only API failed (${status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function findUkgCsvPart_(part) {
  if (!part) return null;
  const filename = String(part.filename || '');
  const contentType = String(part.mimeType || '');
  if ((/\.csv$/i.test(filename) || /(?:^|\/)csv$/i.test(contentType)) && part.body) return part;
  for (const child of (part.parts || [])) {
    const found = findUkgCsvPart_(child);
    if (found) return found;
  }
  return null;
}

function ukgCsvAttachments_() {
  const query = encodeURIComponent(UKG_HOURS_EMAIL_QUERY);
  const listing = gmailReadOnlyApiGet_(`messages?q=${query}&maxResults=10`);
  const attachments = [];
  for (const summary of (listing.messages || [])) {
    const messageId = String(summary.id || '');
    if (!messageId) continue;
    const message = gmailReadOnlyApiGet_(`messages/${encodeURIComponent(messageId)}?format=full`);
    const part = findUkgCsvPart_(message.payload);
    if (!part) continue;
    let data = part.body.data || '';
    if (!data && part.body.attachmentId) {
      const attachmentId = encodeURIComponent(part.body.attachmentId);
      data = gmailReadOnlyApiGet_(`messages/${encodeURIComponent(messageId)}/attachments/${attachmentId}`).data || '';
    }
    if (!data) continue;
    const bytes = Utilities.base64DecodeWebSafe(data);
    const attachment = Utilities.newBlob(
      bytes,
      String(part.mimeType || 'text/csv'),
      String(part.filename || 'Install Daily Hours Export.csv'),
    );
    attachments.push({ messageId, attachment });
  }
  return attachments;
}

function newestUkgCsvAttachment_() {
  return ukgCsvAttachments_()[0] || null;
}

function syncUkgDailyHoursMap_(hoursByEmployeeDate) {
  return withKpiWriteLease_(() => writeKpiClockedHours_(hoursByEmployeeDate));
}

function writeKpiClockedHours_(hoursByEmployeeDate) {
  const sheet = getKpiReportSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) {
    return { success: true, updated: 0, matched_crew_dates: 0 };
  }
  const columns = kpiReportColumnMap_(sheet, [
    'Date',
    'Crew member',
    'Total Clocked Hours (Day)',
  ]);
  const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
  const readColumnCount = Math.max(...Object.values(columns));
  const existingRows = sheet
    .getRange(KPI_FIRST_DATA_ROW, 1, rowCount, readColumnCount)
    .getValues();
  const plan = planKpiClockedHoursSync_(existingRows, hoursByEmployeeDate, {
    date: columns.Date - 1,
    crew: columns['Crew member'] - 1,
    clockedHours: columns['Total Clocked Hours (Day)'] - 1,
  });
  if (plan.updated) {
    sheet.getRange(KPI_FIRST_DATA_ROW, columns['Total Clocked Hours (Day)'], rowCount, 1)
      .setValues(plan.values);
  }
  return {
    success: true,
    updated: plan.updated,
    matched_crew_dates: plan.matchedCrewDates,
  };
}

function syncUkgDailyHoursRows_(rows) {
  return syncUkgDailyHoursMap_(parseUkgDailyHoursRows_(rows));
}

function syncUkgDailyHoursFromEmail_() {
  const found = ukgCsvAttachments_();
  if (!found.length) {
    return { success: true, updated: 0, matched_crew_dates: 0, report_found: false };
  }
  const reports = found
    .slice()
    .reverse()
    .map(item => Utilities.parseCsv(item.attachment.getDataAsString()));
  const result = syncUkgDailyHoursMap_(mergeUkgDailyHoursReports_(reports));
  result.report_found = true;
  result.source_message_id = found[0].messageId;
  result.source_message_ids = found.map(item => item.messageId);
  return result;
}

// Run from the Apps Script editor after first deployment to grant Gmail read access
// and immediately import the newest scheduled UKG CSV attachment.
function authorizeAndSyncUkgDailyHours() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [UKG_GMAIL_READONLY_SCOPE]);
  return syncUkgDailyHoursFromEmail_();
}
