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
    const truckAssignments = normalizeStoredTruckAssignments_(
      typeof event.getTag === 'function' ? event.getTag(TRUCK_ASSIGNMENTS_TAG) : '',
    );
    jobs.push({
      type, num: jobNum, title: cleanTitle || title,
      event_id: event.getId(),
      addr: cleanAddr,
      start: formatDate(startDate),
      end: formatDate(endDate),
      crew,
      truck_assignments: truckAssignments,
    });
  });
  return jobs;
}

function calendarIdForJobType_(type) {
  const calendars = {
    install: INSTALL_CAL_ID,
    service: SERVICE_CAL_ID,
    excavation: EXCAV_CAL_ID,
  };
  return calendars[String(type || '').toLowerCase()] || null;
}

function updateScheduledAssignments(data) {
  const lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(10000);
  try {
  const calendarId = calendarIdForJobType_(data.type);
  if (!calendarId || !data.event_id) return { success: false, error: 'Invalid calendar event' };
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return { success: false, error: 'Calendar not found' };
  const event = calendar.getEventById(String(data.event_id));
  if (!event) return { success: false, error: 'Calendar event not found' };
  const crewResult = requestedScheduleCrew_(data.crew);
  if (crewResult.error) return { success: false, error: crewResult.error };
  const crew = crewResult.crew;
  let requestedAssignments = data.truck_assignments;
  if (data.preserve_truck_assignments) {
    const stored = normalizeStoredTruckAssignments_(
      typeof event.getTag === 'function' ? event.getTag(TRUCK_ASSIGNMENTS_TAG) : '',
    );
    requestedAssignments = {};
    crew.forEach(name => {
      if (stored[name]) requestedAssignments[name] = stored[name];
    });
  }
  const assignmentResult = validateTruckAssignments_(requestedAssignments, crew);
  if (assignmentResult.error) return { success: false, error: assignmentResult.error };
  const baseTitle = event.getTitle().replace(/^\([^)]+\)\s*/, '').trim();
  const nextTitle = crew.length ? `(${crew.join('/')}) ${baseTitle}` : baseTitle;
  const previousTitle = event.getTitle();
  const previousTag = typeof event.getTag === 'function' ? event.getTag(TRUCK_ASSIGNMENTS_TAG) : '';
  try {
    event.setTitle(nextTitle);
    applyTruckAssignmentsTag_(event, assignmentResult.assignments);
  } catch (e) {
    try {
      event.setTitle(previousTitle);
      if (previousTag && typeof event.setTag === 'function') event.setTag(TRUCK_ASSIGNMENTS_TAG, previousTag);
      else if (!previousTag && typeof event.deleteTag === 'function') event.deleteTag(TRUCK_ASSIGNMENTS_TAG);
    } catch (rollbackError) {
      Logger.log('Scheduled assignment rollback failed: ' + rollbackError.message);
    }
    return { success: false, error: e.message };
  }
  return {
    success: true,
    crew,
    truck_assignments: assignmentResult.assignments,
    title: nextTitle,
  };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function updateScheduledCrew(data) {
  return updateScheduledAssignments({ ...data, preserve_truck_assignments: true });
}

// Run once from the Apps Script editor after adding Calendar write scope.
// Re-saving the exact same title forces Google's consent flow without making a
// visible event change. This function is intentionally not exposed by doPost.
function authorizeCalendarWrite() {
  const calendar = CalendarApp.getCalendarById(INSTALL_CAL_ID);
  if (!calendar) throw new Error('Install calendar not found');
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  const events = calendar.getEvents(start, end);
  if (!events.length) throw new Error('No install event available for authorization');
  const event = events.find(candidate => candidate.getGuestList().length === 0) || events[0];
  const existingTitle = event.getTitle();
  event.setTitle(existingTitle);
  return { success: true, event_id: event.getId() };
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
