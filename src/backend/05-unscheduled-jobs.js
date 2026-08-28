// ── Unscheduled jobs ──────────────────────────────────────────────────────────
function normalizeJobNumber_(value) {
  const normalized = String(value == null ? '' : value).trim();
  return /^\d{5,6}$/.test(normalized) ? normalized : null;
}

function getUnscheduledSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  const sheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === UNSCHEDULED_SHEET_GID);
  if (!sheet) throw new Error('Unscheduled jobs sheet (gid 0) was not found');
  return sheet;
}

function getUnsched() {
  const sheet = getUnscheduledSheet_();
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
    const jobNum = normalizeJobNumber_(data.job_num);
    if (!jobNum) return { success: false, error: 'Job number must be 5 or 6 digits' };
    const sheet = getUnscheduledSheet_();
    const id = Date.now();
    sheet.appendRow([
      jobNum, data.title, data.address,
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
    const sheet = getUnscheduledSheet_();
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
    const jobNum = normalizeJobNumber_(data.job_num);
    if (!jobNum) return { success: false, error: 'Job number must be 5 or 6 digits' };
    const sheet = getUnscheduledSheet_();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][4]) === String(data.id)) {
        sheet.getRange(i + 1, 1).setValue(jobNum);
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
