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
      event_id: event.getId(),
      addr: cleanAddr,
      start: formatDate(startDate),
      end: formatDate(endDate),
      crew,
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

function updateScheduledCrew(data) {
  const calendarId = calendarIdForJobType_(data.type);
  if (!calendarId || !data.event_id) return { success: false, error: 'Invalid calendar event' };
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return { success: false, error: 'Calendar not found' };
  const event = calendar.getEventById(String(data.event_id));
  if (!event) return { success: false, error: 'Calendar event not found' };
  const crew = normalizeUnscheduledCrew_(data.crew);
  const baseTitle = event.getTitle().replace(/^\([^)]+\)\s*/, '').trim();
  const nextTitle = crew.length ? `(${crew.join('/')}) ${baseTitle}` : baseTitle;
  event.setTitle(nextTitle);
  return { success: true, crew, title: nextTitle };
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
