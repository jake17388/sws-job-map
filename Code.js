const SHEET_ID = '1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU';

const INSTALL_CAL_ID = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SERVICE_CAL_ID = 'summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com';
const EXCAV_CAL_ID   = 'c_86ccbe589549562e734ff696a2cebbefc071fe607283d4a7cac31c0c36d1155c@group.calendar.google.com';

const SKIP_KEYWORDS = ['no install','hunter out','johnny out','randy off','jake out','eli out','crane service','2018 crane','mother\'s day','memorial day'];

const CREW_NAMES = ['Johnny', 'Jonathan', 'Randy', 'Eli', 'Jerry', 'Jake'];
function normalizeCrew(names) {
  return names.map(n => {
    const match = CREW_NAMES.find(k => k.toLowerCase() === n.toLowerCase());
    return match || n;
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
// Active PINs live in Script Properties. They are seeded once from DEFAULT_PINS
// (these defaults are already public in git history — rotate to new PINs by
// editing setPins() in the Apps Script editor, running it, then undoing the
// edit so the new PINs never land in this public repo).
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // sessions last 30 days
const MAX_PIN_FAILS = 10;                   // then logins lock for 10 minutes

const DEFAULT_PINS = {
  '2580': 'Jake Banks',
  '4567': 'Ryan Chapman',
  '6789': 'Monica White',
  '6543': 'Anders Nordstrom',
};

// To change PINs: paste the new set here, run this once from the Apps Script
// editor, then undo the edit so real PINs never land in git.
function setPins() {
  PropertiesService.getScriptProperties()
    .setProperty('PINS', JSON.stringify(DEFAULT_PINS));
}

// Admin helper for onboarding a new user without touching the other live
// PINs. Takes the PIN/name as arguments rather than a hardcoded value, so
// it's safe to keep in source — see addPinRunner() below for how to invoke
// it from the Apps Script editor (which can't pass arguments to Run).
function addPin(pin, user) {
  const pins = getPins();
  pins[String(pin)] = user;
  PropertiesService.getScriptProperties().setProperty('PINS', JSON.stringify(pins));
}

function getPins() {
  const props = PropertiesService.getScriptProperties();
  let pins = props.getProperty('PINS');
  if (!pins) {
    pins = JSON.stringify(DEFAULT_PINS);
    props.setProperty('PINS', pins);
  }
  return JSON.parse(pins);
}

function getAuthSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('AUTH_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', secret);
  }
  return secret;
}

function signPayload(payload) {
  const sig = Utilities.computeHmacSha256Signature(payload, getAuthSecret());
  return Utilities.base64EncodeWebSafe(sig);
}

function makeToken(user) {
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ u: user, e: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + signPayload(payload);
}

// Returns the user name for a valid unexpired token, else null
function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (signPayload(parts[0]) !== parts[1]) return null;
  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (err) { return null; }
  if (!data || !data.u || !data.e || data.e < Date.now()) return null;
  return data.u;
}

function checkPin(pin) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('pin_fails') || 0);
  if (fails >= MAX_PIN_FAILS) return { ok: false, locked: true };
  const user = getPins()[String(pin)];
  if (!user) {
    cache.put('pin_fails', String(fails + 1), 600);
    return { ok: false };
  }
  return { ok: true, user: user, token: makeToken(user) };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const UNAUTHORIZED = { error: 'unauthorized' };

// ── Routing ───────────────────────────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getJobs' || action === 'getUnsched') {
    if (!verifyToken(e.parameter.token)) return json(UNAUTHORIZED);
    return json(action === 'getJobs' ? getJobs(e) : getUnsched());
  }

  if (action === 'getVehicles') {
    if (!verifyToken(e.parameter.token)) return json(UNAUTHORIZED);
    const cached = CacheService.getScriptCache().get('sc_vehicles');
    return json({ vehicles: cached ? JSON.parse(cached) : [] });
  }

  // Temporary: dump raw Turbo Frame HTML for one vehicle to diagnose coord parsing
  if (action === 'debugVehicleHtml') {
    var session = scSession_();
    if (!session) return ContentService.createTextOutput('no session');
    var deviceId = e.parameter.id || '33bb8790-2acc-4ae5-9729-c6435152cf6f';
    var url = SC_BASE + '/accounts/' + SC_ACCT + '/live/' + deviceId + '?sort_view=lastConnected';
    var resp = UrlFetchApp.fetch(url, {
      headers: {
        'Cookie': session,
        'Turbo-Frame': 'live_device',
        'Accept': 'text/html, application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': SC_BASE + '/accounts/' + SC_ACCT + '/live',
      },
      muteHttpExceptions: true, followRedirects: true,
    });
    return ContentService.createTextOutput(resp.getContentText()).setMimeType(ContentService.MimeType.TEXT);
  }

  // The app itself is hosted on GitHub Pages, not here
  return ContentService.createTextOutput(
    'SWS Job Map: https://jake17388.github.io/sws-job-map/');
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.action === 'login') {
    return json(checkPin(data.pin));
  }

  const user = verifyToken(data.token);
  if (!user) return json(UNAUTHORIZED);

  if (data.action === 'addUnsched') {
    data.added_by = user; // trust the token, not the client-supplied name
    return json(addUnsched(data));
  }
  if (data.action === 'removeUnsched') {
    return json(removeUnsched(data.id));
  }
  if (data.action === 'updateUnsched') {
    return json(updateUnsched(data));
  }
  return json({ error: 'unknown action' });
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

// ── Current Jobs sheet ────────────────────────────────────────────────────────
function refreshCurrentJobs() {
  const start = new Date();
  const end = new Date(start); end.setDate(end.getDate() + 60);

  const allJobs = [
    ...fetchCalendarEvents(INSTALL_CAL_ID, 'Install', start, end),
    ...fetchCalendarEvents(SERVICE_CAL_ID, 'Service', start, end),
    ...fetchCalendarEvents(EXCAV_CAL_ID,   'Excavation', start, end),
  ];
  allJobs.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Current Jobs');
  if (!sheet) return;

  // Clear existing data rows, keep header
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 5).clearContent();

  if (allJobs.length === 0) return;

  // Build rows array for a single batch write (much faster than appendRow loop)
  const tz = Session.getScriptTimeZone();
  const rows = allJobs.filter(job => job.num).map(job => {
    const p = job.start.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    let dateStr;
    if (job.start === job.end) {
      dateStr = Utilities.formatDate(d, tz, 'MMM d, yyyy');
    } else {
      const ep = job.end.split('-');
      const de = new Date(+ep[0], +ep[1] - 1, +ep[2]);
      dateStr = Utilities.formatDate(d, tz, 'MMM d') + ' – ' +
                Utilities.formatDate(de, tz, 'MMM d, yyyy');
    }
    return [job.num || '', job.title, dateStr, job.type, ''];
  });

  sheet.getRange(2, 1, rows.length, 5).setValues(rows);
}

// ── SureCam Integration ───────────────────────────────────────────────────────
// Auth: form POST to /login using SC_EMAIL + SC_PASS from Script Properties.
// Data: one /live sidebar fetch → parse each vehicle's data-* attributes for GPS + status.
// Trigger: cacheSurecamVehicles() every 1 min via setupVehicleTrigger().
const SC_BASE = 'https://view.surecam.com';
const SC_ACCT = '01127';
const SC_NAMES = {
  '33bb8790-2acc-4ae5-9729-c6435152cf6f': '2025 Double Bucket',
  'e6c84a15-6a26-4f5a-9f27-494dc3a15f9a': '2016 Flatbed',
  'cbb1eae7-8270-4ded-ab87-910281b5800d': '2018 Big Crane',
  'e7ee6ba9-1f74-4a76-b318-fae044c8a818': '2019 Single Bucket',
  '0f74b5cc-b7e8-41d6-a5fc-6daa201b138a': '2023 Single Bucket',
  '5e2c8f15-7b50-404a-baf3-538a2f51f301': '2022 Small Crane',
  '3812774d-22d0-4a8e-9e35-22e277fa29f5': '2015 Double Bucket',
};

function setSurecamCreds() {
  var email = 'YOUR_SURECAM_EMAIL'; // ← replace, run once, then undo this edit
  var pass  = 'YOUR_SURECAM_PASSWORD';
  if (!email || email === 'YOUR_SURECAM_EMAIL' || !pass || pass === 'YOUR_SURECAM_PASSWORD') {
    Logger.log('Replace placeholder values before running.');
    return;
  }
  PropertiesService.getScriptProperties().setProperties({ SC_EMAIL: email, SC_PASS: pass });
  CacheService.getScriptCache().remove('sc_session');
  Logger.log('Credentials stored. Run debugSurecamVehicle() to test.');
}

function setSurecamDeviceIds() {
  var ids = [
    '33bb8790-2acc-4ae5-9729-c6435152cf6f', // 2025 Double Bucket
    'e6c84a15-6a26-4f5a-9f27-494dc3a15f9a', // 2016 FLATBED
    'cbb1eae7-8270-4ded-ab87-910281b5800d', // 2018 BIG CRANE
    'e7ee6ba9-1f74-4a76-b318-fae044c8a818', // 2019 SINGLE BUCKET
    '0f74b5cc-b7e8-41d6-a5fc-6daa201b138a', // 2023 SINGLE BUCKET
    '5e2c8f15-7b50-404a-baf3-538a2f51f301', // 2022 SMALL CRANE
    '3812774d-22d0-4a8e-9e35-22e277fa29f5', // 2015 DOUBLE BUCKET
  ];
  PropertiesService.getScriptProperties().setProperty('SC_DEVICE_IDS', JSON.stringify(ids));
  Logger.log('Stored ' + ids.length + ' device IDs.');
}

// ─── Auth ────────────────────────────────────────────────────────────────────

// Paste the FULL Cookie header value from Chrome DevTools:
//   1. Open view.surecam.com/accounts/01127/live in Chrome
//   2. Open DevTools → Network tab
//   3. Click any request to view.surecam.com
//   4. Under "Request Headers", find "cookie:" and copy the entire value
//   5. Paste that full string below (it looks like: _vts2_session=ABC...; remember_user_token=XYZ...; ...)
// Then run this function once.
function setScSession() {
  var cookieString = 'PASTE_FULL_COOKIE_STRING_HERE';
  if (!cookieString || cookieString === 'PASTE_FULL_COOKIE_STRING_HERE') {
    Logger.log('Paste your full cookie string from Chrome DevTools (Network tab → any view.surecam.com request → Request Headers → cookie:), then run this function.');
    return;
  }
  // If the user pasted just a raw _vts2_session VALUE (no "="), wrap it for backwards compat
  if (!cookieString.includes('=')) {
    cookieString = '_vts2_session=' + cookieString;
  }
  PropertiesService.getScriptProperties().setProperty('SC_SESSION', cookieString);
  CacheService.getScriptCache().put('sc_session', cookieString, 7000);
  Logger.log('Session stored (' + cookieString.substring(0, 60) + '...). Trigger will test it within 5 min.');
}

function scSession_() {
  var cached = CacheService.getScriptCache().get('sc_session');
  if (cached) return cached;
  // Fallback: manually-stored session (from setScSession())
  var stored = PropertiesService.getScriptProperties().getProperty('SC_SESSION');
  if (stored) {
    // Stored value is now a full cookie string (e.g. "_vts2_session=ABC; remember_user_token=XYZ")
    // but tolerate the old format where only the raw value was stored
    var session = stored.includes('=') ? stored : '_vts2_session=' + stored;
    CacheService.getScriptCache().put('sc_session', session, 7000);
    return session;
  }
  return null;
}

// Kept for reference — SureCam uses Auth0 OAuth (browser-redirect flow) so
// programmatic login from Apps Script cannot complete authentication.
function scLogin_() {
  Logger.log('SC: programmatic login not available (Auth0 OAuth requires browser redirect). Run setScSession() instead.');
  return null;
}


// ─── Cookie helpers ──────────────────────────────────────────────────────────

function scParseCookies_(resp) {
  var raw = resp.getAllHeaders()['Set-Cookie'] || [];
  var arr = Array.isArray(raw) ? raw : [raw];
  var out = {};
  arr.forEach(function(c) {
    var m = c.match(/^([^=]+)=([^;]*)/);
    if (m) out[m[1].trim()] = m[2].trim();
  });
  return out;
}

function scCookieStr_(obj) {
  return Object.keys(obj).map(function(k) { return k + '=' + obj[k]; }).join('; ');
}

// Returns a full cookie string from the response's Set-Cookie headers,
// updating any matching keys from the current session.
function scExtractSession_(resp, currentSession) {
  var incoming = scParseCookies_(resp);
  if (!incoming['_vts2_session']) return null; // only refresh when we get a new main session
  // Merge with current session to keep all cookies (e.g. remember_user_token)
  var merged = {};
  if (currentSession) {
    currentSession.split('; ').forEach(function(pair) {
      var eq = pair.indexOf('=');
      if (eq > 0) merged[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
  }
  Object.keys(incoming).forEach(function(k) { merged[k] = incoming[k]; });
  return Object.keys(merged).map(function(k) { return k + '=' + merged[k]; }).join('; ');
}

// ─── Vehicle data ────────────────────────────────────────────────────────────

// Called every 1 minute by the time-based trigger created by setupVehicleTrigger().
function cacheSurecamVehicles() {
  var session = scSession_();
  if (!session) { Logger.log('SC: no session'); return; }

  // Warm-up: visit the main live page so Rails can write account context into the
  // encrypted session cookie. Vehicle detail pages require this context to render
  // the full page rather than the unauthenticated landing shell.
  var warmResp = UrlFetchApp.fetch(SC_BASE + '/accounts/' + SC_ACCT + '/live', {
    headers: {
      'Cookie':      session,
      'Accept':      'text/html, application/xhtml+xml',
      'User-Agent':  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    muteHttpExceptions: true,
    followRedirects: true,
  });
  var warmHtml = warmResp.getContentText();
  var warmCode = warmResp.getResponseCode();
  Logger.log('SC warm-up: code=' + warmCode + ' len=' + warmHtml.length);

  // Unauthenticated landing page is ~13K. Authenticated live page is ~150K+.
  // Use length as the primary auth signal — more robust than attribute checks.
  if (warmHtml.length < 50000) {
    Logger.log('SC: session rejected at warm-up (code=' + warmCode + ', len=' + warmHtml.length + '). Paste a fresh full cookie string via setScSession().');
    CacheService.getScriptCache().remove('sc_session');
    return;
  }
  Logger.log('SC: warm-up authenticated ✓ (len=' + warmHtml.length + ')');

  // Capture the refreshed session cookie the warm-up response may include
  var warmSession = scExtractSession_(warmResp, session);
  if (warmSession && warmSession !== session) {
    var raw = warmSession.replace(/^_vts2_session=/, '');
    PropertiesService.getScriptProperties().setProperty('SC_SESSION', raw);
    CacheService.getScriptCache().put('sc_session', warmSession, 7000);
    session = warmSession;
    Logger.log('SC: session refreshed from warm-up response');
  }

  var ids = [];
  try { ids = JSON.parse(PropertiesService.getScriptProperties().getProperty('SC_DEVICE_IDS') || '[]'); } catch(e) {}
  if (!ids.length) { Logger.log('SC: no device IDs — run setSurecamDeviceIds() first'); return; }

  // The /live sidebar (already fetched above for warm-up) embeds every vehicle's
  // true GPS position as data-* attributes, keyed by the same device UUID used
  // in per-device URLs — one page covers the whole fleet, correctly scoped.
  var idSet = {};
  ids.forEach(function(id) { idSet[id] = true; });
  var vehicles = scParseLivePage_(warmHtml).filter(function(v) { return idSet[v.deviceId]; });
  Logger.log('SC: parsed ' + vehicles.length + ' of ' + ids.length + ' tracked vehicles from live page');

  vehicles.forEach(function(v) {
    if (SC_NAMES[v.deviceId]) v.name = SC_NAMES[v.deviceId];
  });

  if (vehicles.length) {
    CacheService.getScriptCache().put('sc_vehicles', JSON.stringify(vehicles), 400);
    Logger.log('SC: cached ' + vehicles.length + ' of ' + ids.length + ' vehicles');
  } else {
    CacheService.getScriptCache().remove('sc_session');
    Logger.log('SC: zero vehicles returned; session cleared for re-login');
  }
}

// Parses the SureCam /live sidebar HTML for every vehicle's GPS position in one pass.
// Each vehicle's tracking data lives entirely on its own "group/vehicle" list-item
// div: data-live-device-details-src carries the same device UUID used in
// /live/{deviceId} URLs, alongside data-latitude/data-longitude/data-status/data-label.
// Reading it straight off that div (rather than scanning the whole page for the
// first lat/lng-shaped pair) is what keeps each position matched to the right truck.
function scParseLivePage_(html) {
  var vehicles = [];
  var tags = html.match(/<div class="group\/vehicle[^"]*"(?:\s+[a-zA-Z0-9_-]+(?:="[^"]*")?)*>/g) || [];
  tags.forEach(function(tag) {
    var deviceId = (tag.match(/data-live-device-details-src="\/accounts\/[^\/"]+\/live\/([0-9a-f-]+)"/) || [])[1];
    var lat = (tag.match(/data-latitude="(-?\d+\.\d+)"/) || [])[1];
    var lng = (tag.match(/data-longitude="(-?\d+\.\d+)"/) || [])[1];
    if (!deviceId || !lat || !lng) return;
    vehicles.push({
      deviceId: deviceId,
      name: (tag.match(/data-label="([^"]*)"/) || [])[1] || deviceId,
      status: (tag.match(/data-status="([^"]*)"/) || [])[1] || 'unknown',
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      updatedAt: new Date().toISOString(),
    });
  });
  return vehicles;
}

// ─── Debug ───────────────────────────────────────────────────────────────────

// Reads the debug snapshot saved by the trigger. Call via: clasp run getDebugHtml
function getDebugHtml() {
  var snap = PropertiesService.getScriptProperties().getProperty('SC_DEBUG_SNAP') || '(nothing saved yet)';
  // Log in 2000-char chunks
  for (var i = 0; i < snap.length; i += 2000) {
    Logger.log('[' + i + '] ' + snap.substring(i, i + 2000));
  }
}

// Run from Apps Script editor to log the raw HTML of one vehicle's Turbo Frame.
// Paste any UUID from SC_NAMES into deviceId to inspect.
function debugVehicleHtml() {
  var deviceId = '33bb8790-2acc-4ae5-9729-c6435152cf6f'; // 2025 Double Bucket
  var session = scSession_();
  if (!session) { Logger.log('No session'); return; }
  var url = SC_BASE + '/accounts/' + SC_ACCT + '/live/' + deviceId + '?sort_view=lastConnected';
  var resp = UrlFetchApp.fetch(url, {
    headers: {
      'Cookie': session,
      'Turbo-Frame': 'live_device',
      'Accept': 'text/html, application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': SC_BASE + '/accounts/' + SC_ACCT + '/live',
    },
    muteHttpExceptions: true,
    followRedirects: true,
  });
  var html = resp.getContentText();
  Logger.log('Length: ' + html.length);
  // Log chunks so nothing gets truncated
  for (var i = 0; i < Math.min(html.length, 9000); i += 3000) {
    Logger.log('HTML[' + i + ']: ' + html.substring(i, i + 3000));
  }
}

// Run from the Apps Script editor to test the full login → vehicle data flow.
function debugSurecamVehicle() {
  CacheService.getScriptCache().remove('sc_session');
  var session = scSession_();
  if (!session) { Logger.log('✗ Login failed — check SC_EMAIL/SC_PASS in Script Properties'); return; }
  Logger.log('✓ Login succeeded: ' + session.substring(0, 50) + '...');

  var html = UrlFetchApp.fetch(SC_BASE + '/accounts/' + SC_ACCT + '/live', {
    headers: { 'Cookie': session, 'Accept': 'text/html, application/xhtml+xml' },
    muteHttpExceptions: true, followRedirects: true,
  }).getContentText();
  var vehicles = scParseLivePage_(html);
  Logger.log('Parsed ' + vehicles.length + ' vehicles: ' + JSON.stringify(vehicles));
}


// Tests two Auth0 approaches that don't require a browser.
// Run once and share the full execution log.
function debugAuth0DirectLogin() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('SC_EMAIL');
  var pass  = props.getProperty('SC_PASS');
  var AUTH0  = 'https://surecam.eu.auth0.com';
  var CLIENT = 'SALqqmUHTaanNjTlJzoqqeWQVTT3nptG';

  // ── Approach A: Resource Owner Password Credentials (ROPG) ────────────────
  // If enabled, returns access_token + refresh_token directly.
  Logger.log('=== A: ROPG /oauth/token ===');
  try {
    var ra = UrlFetchApp.fetch(AUTH0 + '/oauth/token', {
      method: 'post', muteHttpExceptions: true,
      contentType: 'application/json',
      payload: JSON.stringify({
        grant_type: 'password',
        username: email, password: pass,
        client_id: CLIENT,
        scope: 'openid profile email',
      }),
    });
    Logger.log('Status: ' + ra.getResponseCode());
    Logger.log('Body:   ' + ra.getContentText().substring(0, 600));
  } catch(e) { Logger.log('Error: ' + e.message); }

  // ── Approach B: Cross-Origin Authenticate → login_ticket ─────────────────
  // Returns a login_ticket we use to complete the auth-code flow server-side.
  Logger.log('=== B: /co/authenticate ===');
  try {
    var rb = UrlFetchApp.fetch(AUTH0 + '/co/authenticate', {
      method: 'post', muteHttpExceptions: true,
      contentType: 'application/json',
      payload: JSON.stringify({
        client_id: CLIENT,
        username: email, password: pass,
        realm: 'Username-Password-Authentication',
        credential_type: 'http://auth0.com/oauth/grant-type/password-realm',
      }),
    });
    Logger.log('Status: ' + rb.getResponseCode());
    Logger.log('Body:   ' + rb.getContentText().substring(0, 600));
  } catch(e) { Logger.log('Error: ' + e.message); }
}

// Run once to find SureCam's Auth0 domain — needed to enable auto-login.
// Share the full execution log output with the developer after running.
function debugScLoginRedirect() {
  var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  var getResp = UrlFetchApp.fetch(SC_BASE + '/login', {
    followRedirects: true, muteHttpExceptions: true,
    headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml' },
  });
  var html = getResp.getContentText();
  var csrf = (html.match(/name="csrf-token"\s+content="([^"]+)"/) || [])[1] || '';
  var formAction = (html.match(/<form[^>]+action="([^"]+)"/) || [])[1] || '/auth/auth0';
  if (!formAction.startsWith('http')) formAction = SC_BASE + formAction;
  Logger.log('Form action: ' + formAction);
  if (!csrf) { Logger.log('No CSRF token found'); return; }

  var initCookies = scParseCookies_(getResp);
  var postResp = UrlFetchApp.fetch(formAction, {
    method: 'post',
    payload: 'authenticity_token=' + encodeURIComponent(csrf),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua,
      'Cookie': scCookieStr_(initCookies),
    },
    followRedirects: false,
    muteHttpExceptions: true,
  });
  Logger.log('POST status: ' + postResp.getResponseCode());
  var allHeaders = postResp.getAllHeaders();
  var location = allHeaders['Location'] || allHeaders['location'] || '';
  Logger.log('Redirect URL: ' + location);

  if (location) {
    var domainMatch = location.match(/https?:\/\/([^\/\?]+)/);
    if (domainMatch) Logger.log('Auth0 domain: ' + domainMatch[1]);
    var clientMatch = location.match(/client_id=([^&]+)/);
    if (clientMatch) Logger.log('client_id: ' + decodeURIComponent(clientMatch[1]));
    var audienceMatch = location.match(/audience=([^&]+)/);
    if (audienceMatch) Logger.log('audience: ' + decodeURIComponent(audienceMatch[1]));

    // Test if the Auth0 domain is reachable from Apps Script
    if (domainMatch) {
      try {
        var testResp = UrlFetchApp.fetch('https://' + domainMatch[1] + '/', {
          muteHttpExceptions: true, followRedirects: false,
        });
        Logger.log('Auth0 domain reachable — status ' + testResp.getResponseCode());
      } catch(e) {
        Logger.log('Auth0 domain NOT reachable: ' + e.message);
      }
    }
  }
}

// Run once to set up the 1-minute refresh trigger for truck positions.
function setupVehicleTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'cacheSurecamVehicles'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cacheSurecamVehicles').timeBased().everyMinutes(1).create();
  cacheSurecamVehicles(); // populate immediately
}

// ── Current Jobs sheet ────────────────────────────────────────────────────────
// Run once from the Apps Script editor to schedule daily auto-refresh at 6 am.
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'refreshCurrentJobs')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshCurrentJobs')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  // Populate immediately so the sheet isn't empty after setup
  refreshCurrentJobs();
}
