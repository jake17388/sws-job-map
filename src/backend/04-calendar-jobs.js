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
  const jobs = attachScheduledEstimatedHours_(
    harmonizeLoadedDailyTruckAssignments_([...installJobs, ...serviceJobs, ...excavJobs]),
  );
  return { jobs, timestamp: new Date().toISOString(), fetchedFrom: formatDate(start), fetchedTo: formatDate(end) };
}

function attachScheduledEstimatedHours_(jobs) {
  const totals = new Map();
  if (typeof squarecoilInstallHoursByJob_ === 'function') {
    try {
      const resolved = squarecoilInstallHoursByJob_(jobs.map(job => job.num), false);
      resolved.forEach((hours, jobNum) => totals.set(String(jobNum), hours));
    } catch (error) {
      console.warn('Could not load SquareCoil estimates for scheduled jobs:', error.message);
    }
  }
  return jobs.map(job => ({
    ...job,
    estimated_install_hours: totals.has(String(job.num))
      ? totals.get(String(job.num))
      : null,
  }));
}

function jobDateKeys_(job) {
  const startMatch = String(job.start || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const endMatch = String(job.end || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!startMatch || !endMatch) return [];
  const current = new Date(+startMatch[1], +startMatch[2] - 1, +startMatch[3]);
  const end = new Date(+endMatch[1], +endMatch[2] - 1, +endMatch[3]);
  const dates = [];
  while (current <= end && dates.length < 366) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function harmonizeLoadedDailyTruckAssignments_(jobs) {
  const dailyAssignments = new Map();
  jobs.forEach(job => {
    const dates = jobDateKeys_(job);
    Object.entries(job.truck_assignments || {}).forEach(([name, vehicleId]) => {
      dates.forEach(date => {
        const key = `${date}|${name}`;
        if (!dailyAssignments.has(key)) dailyAssignments.set(key, new Set());
        dailyAssignments.get(key).add(vehicleId);
      });
    });
  });

  return jobs.map(job => {
    const dates = jobDateKeys_(job);
    const assignments = { ...(job.truck_assignments || {}) };
    (job.crew || []).forEach(name => {
      const dailyVehicleIds = new Set();
      dates.forEach(date => {
        const ids = dailyAssignments.get(`${date}|${name}`);
        if (ids) ids.forEach(vehicleId => dailyVehicleIds.add(vehicleId));
      });
      if (dailyVehicleIds.size === 1) assignments[name] = [...dailyVehicleIds][0];
    });
    return { ...job, truck_assignments: assignments };
  });
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

function scheduledJobCalendarIds_() {
  return [INSTALL_CAL_ID, SERVICE_CAL_ID, EXCAV_CAL_ID];
}

function crewFromCalendarTitle_(title) {
  const match = String(title || '').match(/^\(([^)]+)\)/);
  if (!match) return [];
  const normalized = normalizeCrew(match[1].split(/[\/,&]/).map(name => name.trim()).filter(Boolean));
  return CREW_NAMES.filter(name => normalized.includes(name));
}

function calendarEventRange_(event) {
  if (!event || typeof event.getStartTime !== 'function' || typeof event.getEndTime !== 'function') return null;
  const start = new Date(event.getStartTime());
  const end = new Date(event.getEndTime());
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { start, end };
}

function calendarEventsOverlap_(event, range) {
  const candidate = calendarEventRange_(event);
  return !!candidate && candidate.start < range.end && candidate.end > range.start;
}

function eventAssignmentUpdate_(event, assignments) {
  return {
    event,
    assignments,
    previousTag: typeof event.getTag === 'function' ? event.getTag(TRUCK_ASSIGNMENTS_TAG) || '' : '',
  };
}

function collectDailyTruckAssignmentUpdates_(sourceCalendarId, sourceEvent, sourceCrew, sourceAssignments) {
  const updates = [eventAssignmentUpdate_(sourceEvent, sourceAssignments)];
  const range = calendarEventRange_(sourceEvent);
  if (!range) return updates;

  const sourceId = typeof sourceEvent.getId === 'function' ? String(sourceEvent.getId()) : '';
  scheduledJobCalendarIds_().forEach(calendarId => {
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar || typeof calendar.getEvents !== 'function') return;
    calendar.getEvents(range.start, range.end).forEach(event => {
      const eventId = typeof event.getId === 'function' ? String(event.getId()) : '';
      if (calendarId === sourceCalendarId && sourceId && eventId === sourceId) return;
      if (!calendarEventsOverlap_(event, range)) return;
      const eventCrew = crewFromCalendarTitle_(event.getTitle());
      if (!eventCrew.length) return;

      const current = normalizeStoredTruckAssignments_(
        typeof event.getTag === 'function' ? event.getTag(TRUCK_ASSIGNMENTS_TAG) : '',
      );
      const next = { ...current };
      sourceCrew.forEach(name => {
        if (!eventCrew.includes(name)) return;
        if (sourceAssignments[name]) next[name] = sourceAssignments[name];
        else delete next[name];
      });
      if (serializeTruckAssignments_(next) !== serializeTruckAssignments_(current)) {
        updates.push(eventAssignmentUpdate_(event, next));
      }
    });
  });
  return updates;
}

function restoreTruckAssignmentTag_(update) {
  if (update.previousTag && typeof update.event.setTag === 'function') {
    update.event.setTag(TRUCK_ASSIGNMENTS_TAG, update.previousTag);
  } else if (!update.previousTag && typeof update.event.deleteTag === 'function') {
    update.event.deleteTag(TRUCK_ASSIGNMENTS_TAG);
  }
}

function applyTruckAssignmentUpdates_(updates) {
  const applied = [];
  try {
    updates.forEach(update => {
      applied.push(update);
      applyTruckAssignmentsTag_(update.event, update.assignments);
    });
  } catch (error) {
    applied.reverse().forEach(update => {
      try { restoreTruckAssignmentTag_(update); }
      catch (rollbackError) {
        if (typeof Logger !== 'undefined') Logger.log('Truck assignment rollback failed: ' + rollbackError.message);
      }
    });
    throw error;
  }
  return updates.length;
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
  let updatedEventCount = 0;
  try {
    const updates = collectDailyTruckAssignmentUpdates_(
      calendarId,
      event,
      crew,
      assignmentResult.assignments,
    );
    event.setTitle(nextTitle);
    updatedEventCount = applyTruckAssignmentUpdates_(updates);
  } catch (e) {
    try {
      event.setTitle(previousTitle);
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
    propagated_event_count: Math.max(0, updatedEventCount - 1),
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
