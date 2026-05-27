const SHEET_ID = '1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU';
 
const INSTALL_CAL_ID = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SERVICE_CAL_ID = 'summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com';
 
const SKIP_KEYWORDS = ['no install','hunter out','johnny out','randy off','jake out','eli out','maintenance','crane service','2018 crane','mother\'s day','memorial day'];
 
function doGet(e) {
  const action = e.parameter.action;
 
  if (action === 'getJobs') {
    return ContentService.createTextOutput(JSON.stringify(getJobs()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'getUnsched') {
    return ContentService.createTextOutput(JSON.stringify(getUnsched()))
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
}
 
// ── Calendar jobs ─────────────────────────────────────────────────────────────
function getJobs() {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 7);
  const end = new Date(now); end.setDate(end.getDate() + 60);
  const installJobs = fetchCalendarEvents(INSTALL_CAL_ID, 'install', start, end);
  const serviceJobs = fetchCalendarEvents(SERVICE_CAL_ID, 'service', start, end);
  return { jobs: [...installJobs, ...serviceJobs], timestamp: new Date().toISOString() };
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