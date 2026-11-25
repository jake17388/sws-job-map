// ── Fleetio daily AM/PM truck inspections ───────────────────────────────────
const FLEETIO_EMAIL_QUERY = 'from:notifications@fleetio.com subject:"[Report] Fleetio Daily Report" has:attachment newer_than:30d';
const FLEETIO_GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const FLEETIO_AM_INDEX = 14;
const FLEETIO_PM_INDEX = 15;
const FLEETIO_CREW_NAMES = Object.freeze([
  'Johnny', 'Eli', 'Jerry', 'Jonathan', 'Randy', 'Jake', 'Caden',
]);

function normalizeFleetioHeader_(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function fleetioDateKey_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s|T|$)/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return '';
}

function fleetioCrewName_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return FLEETIO_CREW_NAMES.find(name => {
    const normalized = name.toLowerCase();
    return text === normalized || text.startsWith(`${normalized} `);
  }) || '';
}

function parseFleetioInspectionRows_(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    const empty = new Map();
    empty.reportedDates = new Set();
    return empty;
  }
  const requiredHeaders = ['Date', 'Inspection Form', 'User'].map(normalizeFleetioHeader_);
  const headerRowIndex = rows.findIndex(row => {
    const candidate = (row || []).map(normalizeFleetioHeader_);
    return requiredHeaders.every(header => candidate.includes(header));
  });
  if (headerRowIndex === -1) {
    throw new Error('Fleetio CSV is missing Date, Inspection Form, or User');
  }
  const headers = rows[headerRowIndex].map(normalizeFleetioHeader_);
  const dateIndex = headers.indexOf(normalizeFleetioHeader_('Date'));
  const formIndex = headers.indexOf(normalizeFleetioHeader_('Inspection Form'));
  const userIndex = headers.indexOf(normalizeFleetioHeader_('User'));
  const inspections = new Map();
  const reportedDates = new Set();

  rows.slice(headerRowIndex + 1).forEach(row => {
    const dateKey = fleetioDateKey_(row[dateIndex]);
    const crewName = fleetioCrewName_(row[userIndex]);
    const form = String(row[formIndex] || '').trim().toLowerCase();
    if (!dateKey || !crewName || !['am truck', 'pm truck'].includes(form)) return;
    reportedDates.add(dateKey);
    const key = `${crewName}|${dateKey}`;
    const flags = inspections.get(key) || { am: false, pm: false };
    if (form === 'am truck') flags.am = true;
    if (form === 'pm truck') flags.pm = true;
    inspections.set(key, flags);
  });
  inspections.reportedDates = reportedDates;
  return inspections;
}

function mergeFleetioInspectionReports_(reports) {
  const merged = new Map();
  const reportedDates = new Set();
  (reports || []).forEach(rows => {
    const parsed = parseFleetioInspectionRows_(rows);
    parsed.reportedDates.forEach(dateKey => reportedDates.add(dateKey));
    parsed.forEach((flags, key) => {
      const current = merged.get(key) || { am: false, pm: false };
      merged.set(key, {
        am: current.am || flags.am,
        pm: current.pm || flags.pm,
      });
    });
  });
  merged.reportedDates = reportedDates;
  return merged;
}

function planKpiFleetioInspectionSync_(existingRows, inspections, reportedDates, columnIndexes) {
  const indexes = columnIndexes || {};
  const dateIndex = indexes.date == null ? 1 : indexes.date;
  const crewIndex = indexes.crew == null ? 2 : indexes.crew;
  const amIndex = indexes.am == null ? FLEETIO_AM_INDEX : indexes.am;
  const pmIndex = indexes.pm == null ? FLEETIO_PM_INDEX : indexes.pm;
  let updated = 0;
  const matched = new Set();
  const values = (existingRows || []).map(row => {
    const dateKey = fleetioDateKey_(row[dateIndex]);
    const crewName = String(row[crewIndex] || '').trim();
    const existingAm = row[amIndex];
    const existingPm = row[pmIndex];
    if (!dateKey || !reportedDates.has(dateKey)) return [existingAm, existingPm];
    const key = `${crewName}|${dateKey}`;
    const flags = inspections.get(key) || { am: false, pm: false };
    if (inspections.has(key)) matched.add(key);
    if (existingAm !== flags.am || existingPm !== flags.pm) updated += 1;
    return [flags.am, flags.pm];
  });
  return { values, updated, matchedCrewDates: matched.size };
}

function findFleetioCsvPart_(part) {
  if (!part) return null;
  const filename = String(part.filename || '');
  const contentType = String(part.mimeType || '');
  if ((/\.csv$/i.test(filename) || /(?:^|\/)csv$/i.test(contentType)) && part.body) return part;
  for (const child of (part.parts || [])) {
    const found = findFleetioCsvPart_(child);
    if (found) return found;
  }
  return null;
}

function fleetioCsvAttachments_() {
  const query = encodeURIComponent(FLEETIO_EMAIL_QUERY);
  const listing = gmailReadOnlyApiGet_(`messages?q=${query}&maxResults=10`);
  const attachments = [];
  for (const summary of (listing.messages || [])) {
    const messageId = String(summary.id || '');
    if (!messageId) continue;
    const message = gmailReadOnlyApiGet_(`messages/${encodeURIComponent(messageId)}?format=full`);
    const part = findFleetioCsvPart_(message.payload);
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
      String(part.filename || 'Fleetio Daily Report.csv'),
    );
    attachments.push({ messageId, attachment });
  }
  return attachments;
}

function syncFleetioInspectionMap_(inspections, reportedDates) {
  return withKpiWriteLease_(() => writeKpiFleetioInspections_(inspections, reportedDates));
}

function writeKpiFleetioInspections_(inspections, reportedDates) {
  const sheet = getKpiReportSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < KPI_FIRST_DATA_ROW) {
    return { success: true, updated: 0, matched_crew_dates: 0 };
  }
  const columns = kpiReportColumnMap_(sheet, [
    'Date',
    'Crew member',
    'Fleetio AM',
    'Fleetio PM',
  ]);
  const rowCount = lastRow - KPI_FIRST_DATA_ROW + 1;
  const readColumnCount = Math.max(...Object.values(columns));
  const existingRows = sheet
    .getRange(KPI_FIRST_DATA_ROW, 1, rowCount, readColumnCount)
    .getValues();
  const plan = planKpiFleetioInspectionSync_(existingRows, inspections, reportedDates, {
    date: columns.Date - 1,
    crew: columns['Crew member'] - 1,
    am: columns['Fleetio AM'] - 1,
    pm: columns['Fleetio PM'] - 1,
  });
  if (plan.updated) {
    sheet.getRange(KPI_FIRST_DATA_ROW, columns['Fleetio AM'], rowCount, 1)
      .setValues(plan.values.map(row => [row[0]]));
    sheet.getRange(KPI_FIRST_DATA_ROW, columns['Fleetio PM'], rowCount, 1)
      .setValues(plan.values.map(row => [row[1]]));
  }
  return {
    success: true,
    updated: plan.updated,
    matched_crew_dates: plan.matchedCrewDates,
  };
}

function syncFleetioInspectionRows_(rows) {
  const parsed = parseFleetioInspectionRows_(rows);
  return syncFleetioInspectionMap_(parsed, parsed.reportedDates);
}

function syncFleetioInspectionsFromEmail_() {
  const found = fleetioCsvAttachments_();
  if (!found.length) {
    return { success: true, updated: 0, matched_crew_dates: 0, report_found: false };
  }
  const reports = found
    .slice()
    .reverse()
    .map(item => Utilities.parseCsv(item.attachment.getDataAsString()));
  const inspections = mergeFleetioInspectionReports_(reports);
  const result = syncFleetioInspectionMap_(inspections, inspections.reportedDates);
  result.report_found = true;
  result.source_message_id = found[0].messageId;
  result.source_message_ids = found.map(item => item.messageId);
  return result;
}

// Run once from the Apps Script editor after deployment to grant Gmail read access
// and immediately import the newest Fleetio CSV attachment.
function authorizeAndSyncFleetioInspections() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [FLEETIO_GMAIL_READONLY_SCOPE]);
  return syncFleetioInspectionsFromEmail_();
}
