// ── UKG daily clocked hours ──────────────────────────────────────────────────
const UKG_HOURS_EMAIL_QUERY = 'subject:"Install Daily Hours Export" has:attachment newer_than:30d';
const UKG_KPI_CLOCKED_HOURS_INDEX = 11;
const UKG_INSTALL_CREW_BY_EMPLOYEE_ID = Object.freeze({
  '46': 'Johnny',
  '131': 'Eli',
  '251': 'Jerry',
  '230': 'Jonathan',
  '270': 'Randy',
  '284': 'Jake',
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
  const headers = rows[0].map(normalizeUkgHeader_);
  const indexOf = name => headers.indexOf(normalizeUkgHeader_(name));
  const employeeIndex = indexOf('Employee Id');
  const dateIndex = indexOf('Date');
  const regularIndex = indexOf('Regular Hours');
  const overtimeIndex = indexOf('Overtime Hours');
  const doubleTimeIndex = indexOf('Double Time Hours');
  if ([employeeIndex, dateIndex, regularIndex, overtimeIndex, doubleTimeIndex].includes(-1)) {
    throw new Error('UKG CSV is missing Employee Id, Date, Regular, Overtime, or Double Time hours');
  }

  const hoursByEmployeeDate = new Map();
  rows.slice(1).forEach(row => {
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

function planKpiClockedHoursSync_(existingRows, hoursByEmployeeDate) {
  const employeeIdByCrew = Object.entries(UKG_INSTALL_CREW_BY_EMPLOYEE_ID)
    .reduce((result, entry) => {
      result[entry[1]] = entry[0];
      return result;
    }, {});
  let updated = 0;
  const matched = new Set();
  const values = (existingRows || []).map(row => {
    const dateKey = ukgDateKey_(row[1]);
    const employeeId = employeeIdByCrew[String(row[2] || '').trim()];
    const key = employeeId && dateKey ? `${employeeId}|${dateKey}` : '';
    const existing = row[UKG_KPI_CLOCKED_HOURS_INDEX];
    if (!key || !hoursByEmployeeDate.has(key)) return [existing];
    matched.add(key);
    const next = hoursByEmployeeDate.get(key);
    if (Number(existing) !== next || existing === '' || existing == null) updated += 1;
    return [next];
  });
  return { values, updated, matchedCrewDates: matched.size };
}

function newestUkgCsvAttachment_() {
  const messages = GmailApp.search(UKG_HOURS_EMAIL_QUERY, 0, 10)
    .reduce((all, thread) => all.concat(thread.getMessages()), [])
    .sort((left, right) => right.getDate().getTime() - left.getDate().getTime());
  for (const message of messages) {
    const attachment = message.getAttachments({ includeInlineImages: false, includeAttachments: true })
      .find(candidate => /\.csv$/i.test(candidate.getName())
        || /(?:^|\/)csv$/i.test(candidate.getContentType()));
    if (attachment) return { messageId: message.getId(), attachment };
  }
  return null;
}

function syncUkgDailyHoursRows_(rows) {
  const hoursByEmployeeDate = parseUkgDailyHoursRows_(rows);
  const sheet = getKpiSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) {
    return { success: true, updated: 0, matched_crew_dates: 0 };
  }
  const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
  const existingRows = sheet
    .getRange(KPI_FIRST_DATA_ROW, 1, rowCount, KPI_TOTAL_CLOCKED_HOURS_COLUMN)
    .getValues();
  const plan = planKpiClockedHoursSync_(existingRows, hoursByEmployeeDate);
  if (plan.updated) {
    sheet.getRange(KPI_FIRST_DATA_ROW, KPI_TOTAL_CLOCKED_HOURS_COLUMN, rowCount, 1)
      .setValues(plan.values);
  }
  return {
    success: true,
    updated: plan.updated,
    matched_crew_dates: plan.matchedCrewDates,
  };
}

function syncUkgDailyHoursFromEmail_() {
  const found = newestUkgCsvAttachment_();
  if (!found) {
    return { success: true, updated: 0, matched_crew_dates: 0, report_found: false };
  }
  const rows = Utilities.parseCsv(found.attachment.getDataAsString());
  const result = syncUkgDailyHoursRows_(rows);
  result.report_found = true;
  result.source_message_id = found.messageId;
  return result;
}

// Run from the Apps Script editor after first deployment to grant Gmail read access
// and immediately import the newest scheduled UKG CSV attachment.
function authorizeAndSyncUkgDailyHours() {
  return syncUkgDailyHoursFromEmail_();
}
