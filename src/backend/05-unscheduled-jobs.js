// ── Unscheduled jobs ──────────────────────────────────────────────────────────
function normalizeJobNumber_(value) {
  const normalized = String(value == null ? '' : value).trim();
  return /^\d{5,6}$/.test(normalized) ? normalized : null;
}

function normalizeUnscheduledCrew_(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(/[\/,&]/);
  const normalized = normalizeCrew(values.map(name => String(name).trim()).filter(Boolean));
  return normalized.filter((name, index) => CREW_NAMES.includes(name) && normalized.indexOf(name) === index);
}

function getUnscheduledSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  const sheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === UNSCHEDULED_SHEET_GID);
  if (!sheet) throw new Error('Unscheduled jobs sheet (gid 0) was not found');
  return sheet;
}

function ensureUnscheduledCrewHeader_(sheet) {
  const header = sheet.getRange(1, 7);
  if (!header.getValue()) header.setValue('Crew');
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
    crew: normalizeUnscheduledCrew_(row[6]),
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
    ensureUnscheduledCrewHeader_(sheet);
    const id = Date.now();
    sheet.appendRow([
      jobNum, data.title, data.address,
      new Date().toISOString(), id, data.added_by || 'Unknown',
      normalizeUnscheduledCrew_(data.crew).join('/'),
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
    ensureUnscheduledCrewHeader_(sheet);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][4]) === String(data.id)) {
        sheet.getRange(i + 1, 1).setValue(jobNum);
        sheet.getRange(i + 1, 2).setValue(data.title);
        sheet.getRange(i + 1, 3).setValue(data.address);
        sheet.getRange(i + 1, 7).setValue(normalizeUnscheduledCrew_(data.crew).join('/'));
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

function parseScheduleDate_(value, label) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { error: `Invalid ${label} date` };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { error: `Invalid ${label} date` };
  }
  return { date };
}

function requestedScheduleCrew_(value) {
  if (!value) return { crew: [] };
  const requested = Array.isArray(value) ? value : String(value).split(/[\/,&]/);
  const cleaned = requested.map(name => String(name).trim()).filter(Boolean);
  const unknown = cleaned.find(name => !CREW_NAMES.some(known => known.toLowerCase() === name.toLowerCase()));
  if (unknown) return { error: `Unknown crew member: ${unknown}` };
  return { crew: normalizeUnscheduledCrew_(cleaned) };
}

function scheduleReceiptKey_(id) {
  return `SCHEDULED_UNSCHED_${String(id)}`;
}

function scheduleUnsched(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const id = String(data.id == null ? '' : data.id).trim();
    if (!id) return { success: false, error: 'Invalid job identity' };
    if (data.calendar !== 'install') return { success: false, error: 'Invalid target calendar' };

    const properties = PropertiesService.getScriptProperties();
    const receiptKey = scheduleReceiptKey_(id);
    const savedReceipt = properties.getProperty(receiptKey);
    if (savedReceipt) {
      const receipt = JSON.parse(savedReceipt);
      const cleanup = removeScheduledRow_(id);
      if (!cleanup.success) {
        return { ...receipt, success: false, partial: true, error: `Calendar event exists, but unscheduled cleanup failed: ${cleanup.error}` };
      }
      return { ...receipt, success: true, duplicate: true };
    }

    const sheet = getUnscheduledSheet_();
    const rows = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][4]) === id) { rowIndex = i; break; }
    }
    if (rowIndex < 0) return { success: false, error: 'Unscheduled job not found' };

    const row = rows[rowIndex];
    const jobNum = normalizeJobNumber_(row[0]);
    const title = String(row[1] == null ? '' : row[1]).trim();
    const address = String(row[2] == null ? '' : row[2]).trim();
    if (!jobNum || !title || !address) return { success: false, error: 'Stored job details are invalid' };
    if (normalizeJobNumber_(data.job_num) !== jobNum ||
        String(data.title == null ? '' : data.title).trim() !== title ||
        String(data.address == null ? '' : data.address).trim() !== address) {
      return { success: false, error: 'Job details changed; refresh and try again' };
    }

    const startResult = parseScheduleDate_(data.start_date, 'start');
    if (startResult.error) return { success: false, error: startResult.error };
    const endResult = parseScheduleDate_(data.end_date || data.start_date, 'end');
    if (endResult.error) return { success: false, error: endResult.error };
    if (endResult.date < startResult.date) return { success: false, error: 'End date cannot be before start date' };
    const crewResult = requestedScheduleCrew_(data.crew);
    if (crewResult.error) return { success: false, error: crewResult.error };

    const calendar = CalendarApp.getCalendarById(INSTALL_CAL_ID);
    if (!calendar) return { success: false, error: 'Install calendar not found' };
    const exclusiveEnd = new Date(endResult.date);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    const eventTitle = `${crewResult.crew.length ? `(${crewResult.crew.join('/')}) ` : ''}${jobNum} ${title}`;
    const event = calendar.createAllDayEvent(eventTitle, startResult.date, exclusiveEnd, { location: address });
    const receipt = {
      event_id: event.getId(),
      type: 'install',
      title: eventTitle,
      crew: crewResult.crew,
      start: formatDate(startResult.date),
      end: formatDate(endResult.date),
    };
    properties.setProperty(receiptKey, JSON.stringify(receipt));

    try {
      sheet.deleteRow(rowIndex + 1);
    } catch (cleanupError) {
      return { ...receipt, success: false, partial: true, error: `Calendar event created, but unscheduled cleanup failed: ${cleanupError.message}` };
    }
    return { ...receipt, success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

function removeScheduledRow_(id) {
  try {
    const sheet = getUnscheduledSheet_();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][4]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: true, alreadyRemoved: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
