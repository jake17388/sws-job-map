const SHEET_ID = '1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU';
 
const INSTALL_CAL_ID = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SERVICE_CAL_ID = 'summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com';
const EXCAV_CAL_ID   = 'c_86ccbe589549562e734ff696a2cebbefc071fe607283d4a7cac31c0c36d1155c@group.calendar.google.com';
 
const SKIP_KEYWORDS = ['no install','hunter out','johnny out','randy off','jake out','eli out','maintenance','crane service','2018 crane','mother\'s day','memorial day'];

const CREW_NAMES = ['Johnny', 'Jonathan', 'Randy', 'Eli', 'Jerry', 'Jake'];
function normalizeCrew(names) {
  return names.map(n => {
    const match = CREW_NAMES.find(k => k.toLowerCase() === n.toLowerCase());
    return match || n;
  });
}
 
function doGet(e) {
  const action = e.parameter.action;
 
  if (action === 'getJobs') {
    return ContentService.createTextOutput(JSON.stringify(getJobs(e)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'getUnsched') {
    return ContentService.createTextOutput(JSON.stringify(getUnsched()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'exportSchedule') {
    return ContentService.createTextOutput(JSON.stringify(exportSchedule()))
      .setMimeType(ContentService.MimeType.JSON);
  }
 
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SWS Job Map')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
 
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.action === 'addUnsched') {
    return ContentService.createTextOutput(JSON.stringify(addUnsched(data)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (data.action === 'removeUnsched') {
    return ContentService.createTextOutput(JSON.stringify(removeUnsched(data.id)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (data.action === 'updateUnsched') {
    return ContentService.createTextOutput(JSON.stringify(updateUnsched(data)))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
 
// ── Calendar jobs ─────────────────────────────────────────────────────────────
function getJobs(e) {
  const params = (e && e.parameter) || {};
  const now = new Date();
  let start, end;
  if (params.from) {
    const p = params.from.split('-');
    start = new Date(+p[0], +p[1] - 1, +p[2]);
  } else {
    start = new Date(now); start.setDate(start.getDate() - 7);
  }
  if (params.to) {
    const p = params.to.split('-');
    end = new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 59);
  } else {
    end = new Date(now); end.setDate(end.getDate() + 60);
  }
  const installJobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', start, end);
  const serviceJobs = fetchCalendarEvents(SERVICE_CAL_ID, 'service', start, end);
  const excavJobs   = fetchCalendarEvents(EXCAV_CAL_ID,   'excavation', start, end);
  return { jobs: [...installJobs, ...serviceJobs, ...excavJobs], timestamp: new Date().toISOString(), fetchedFrom: formatDate(start), fetchedTo: formatDate(end) };
}
 
function fetchCalendarEvents(calId, type, start, end) {
  const cal = CalendarApp.getCalendarById(calId);
  if (!cal) return [];
  const events = cal.getEvents(start, end);
  const jobs = [];
  events.forEach(event => {
    const title = event.getTitle().trim();
    const location = event.getLocation() ? event.getLocation().trim() : '';
    if (!location) return;
    const titleLower = title.toLowerCase();
    if (SKIP_KEYWORDS.some(k => titleLower.includes(k))) return;
    const numMatch = title.match(/\b(\d{5,6})\b/);
    const jobNum = numMatch ? numMatch[1] : '';
    const crewMatch = title.match(/^\(([^)]+)\)/);
    const crew = crewMatch
      ? normalizeCrew(crewMatch[1].split(/[\/,&]/).map(n => n.trim()).filter(n => n))
      : [];
    let cleanTitle = title
      .replace(/^\([^)]+\)\s*/, '')
      .replace(/\b\d{5,6}\b\s*[-–]?\s*/, '')
      .replace(/^\s*[-–]\s*/, '')
      .trim();
    const cleanAddr = location.replace(/\s*\|\s*/g, ', ').replace(/\s+/g, ' ').trim();
    const startDate = event.getStartTime();
    const endDate = new Date(event.getEndTime());
    endDate.setDate(endDate.getDate() - 1);
    jobs.push({
      type, num: jobNum, title: cleanTitle || title,
      addr: cleanAddr,
      start: formatDate(startDate),
      end: formatDate(endDate),
      crew,
    });
  });
  return jobs;
}
 
function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
 
// ── Unscheduled jobs ──────────────────────────────────────────────────────────
function getUnsched() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { jobs: [] };
  const jobs = data.slice(1).map(row => ({
    id: String(row[4] || ''),
    job_num: row[0],
    title: row[1],
    address: row[2],
    added: row[3],
    added_by: row[5] || '',
  })).filter(j => j.job_num);
  return { jobs };
}
 
function addUnsched(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const id = Date.now();
    sheet.appendRow([
      data.job_num, data.title, data.address,
      new Date().toISOString(), id, data.added_by || 'Unknown',
    ]);
    return { success: true, id };
  } catch(e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}
 
function removeUnsched(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][4]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Row not found' };
  } catch(e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

function updateUnsched(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][4]) === String(data.id)) {
        sheet.getRange(i + 1, 1).setValue(data.job_num);
        sheet.getRange(i + 1, 2).setValue(data.title);
        sheet.getRange(i + 1, 3).setValue(data.address);
        return { success: true };
      }
    }
    return { success: false, error: 'Row not found' };
  } catch(e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}
// ── Schedule export ───────────────────────────────────────────────────────────
function exportSchedule() {
  try {
    const start = new Date();
    const end = new Date(start); end.setDate(end.getDate() + 60);

    const allJobs = [
      ...fetchCalendarEvents(INSTALL_CAL_ID, 'Install', start, end),
      ...fetchCalendarEvents(SERVICE_CAL_ID, 'Service', start, end),
      ...fetchCalendarEvents(EXCAV_CAL_ID,   'Excavation', start, end),
    ];
    allJobs.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('Schedule Export');
    if (!sheet) sheet = ss.insertSheet('Schedule Export');
    else sheet.clearContents();

    // Header row
    sheet.appendRow(['Job Number', 'Job Name', 'Date', 'Type', 'Checked']);
    const hdr = sheet.getRange(1, 1, 1, 5);
    hdr.setFontWeight('bold').setBackground('#1a4a8a').setFontColor('#ffffff');

    // Data rows
    allJobs.forEach(job => {
      const parts = job.start.split('-');
      const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      const dateStr = job.start === job.end
        ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy')
        : (function() {
            const ep = job.end.split('-');
            const de = new Date(+ep[0], +ep[1] - 1, +ep[2]);
            return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d') + ' – ' +
                   Utilities.formatDate(de, Session.getScriptTimeZone(), 'MMM d, yyyy');
          })();
      sheet.appendRow([job.num || '', job.title, dateStr, job.type, '']);
    });

    // Column widths & frozen header
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 280);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 100);
    sheet.setColumnWidth(5, 90);
    sheet.setFrozenRows(1);

    return { success: true, url: ss.getUrl() + '#gid=' + sheet.getSheetId() };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
