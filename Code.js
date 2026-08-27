const SHEET_ID = '1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU';
const UNSCHEDULED_SHEET_GID = 0;
const ADMIN_USER_NAME = 'Jake Banks';

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
// Active PINs live only in Script Properties. Versioned property names prevent
// legacy source-controlled credentials and sessions from being reused.
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // sessions last 30 days
const PINS_PROPERTY = 'PINS_V2';
const AUTH_SECRET_PROPERTY = 'AUTH_SECRET_V2';

// Execution-API helpers for secure PIN provisioning. PIN values are passed at
// invocation time and never stored in source control.
function addPin(pin, user) {
  if (!/^\d{4}$/.test(String(pin)) || !String(user || '').trim()) throw new Error('PIN must be four digits and user is required');
  const pins = getPins();
  pins[String(pin)] = String(user).trim();
  PropertiesService.getScriptProperties().setProperty(PINS_PROPERTY, JSON.stringify(pins));
  return { success: true, user: pins[String(pin)] };
}

function replaceUserPin(pin, user) {
  if (!/^\d{4}$/.test(String(pin)) || !String(user || '').trim()) throw new Error('PIN must be four digits and user is required');
  const normalizedUser = String(user).trim();
  const pins = getPins();
  Object.keys(pins).forEach(existingPin => { if (pins[existingPin] === normalizedUser) delete pins[existingPin]; });
  pins[String(pin)] = normalizedUser;
  PropertiesService.getScriptProperties().setProperty(PINS_PROPERTY, JSON.stringify(pins));
  return { success: true, user: normalizedUser };
}

function getPins() {
  const pins = PropertiesService.getScriptProperties().getProperty(PINS_PROPERTY);
  if (!pins) return {};
  try { return JSON.parse(pins); } catch (err) { return {}; }
}

function getAuthSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(AUTH_SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(AUTH_SECRET_PROPERTY, secret);
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

function roleForUser_(user) {
  return user === ADMIN_USER_NAME ? 'admin' : 'viewer';
}

function resolveActor_(token) {
  const user = verifyToken(token);
  if (!user || !Object.values(getPins()).includes(user)) return null;
  return { name: user, role: roleForUser_(user) };
}

function isAdmin_(actor) {
  return !!actor && actor.role === 'admin' && actor.name === ADMIN_USER_NAME;
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
  const user = getPins()[String(pin)];
  if (!user) return { ok: false };
  return { ok: true, user: user, role: roleForUser_(user), token: makeToken(user) };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const UNAUTHORIZED = { error: 'unauthorized' };

// ── Routing ───────────────────────────────────────────────────────────────────
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;
  const actor = resolveActor_(params.token);

  if (action === 'getJobs' || action === 'getUnsched') {
    if (!actor) return json(UNAUTHORIZED);
    return json(action === 'getJobs' ? getJobs(e) : getUnsched());
  }

  if (action === 'getVehicles') {
    if (!actor) return json(UNAUTHORIZED);
    const snapshot = getVehicleSnapshot_();
    const ageMs = snapshot.snapshotAt ? Date.now() - new Date(snapshot.snapshotAt).getTime() : null;
    return json({
      vehicles: snapshot.vehicles,
      snapshotAt: snapshot.snapshotAt,
      stale: ageMs === null || ageMs > 30 * 60 * 1000,
    });
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
  // The Chrome extension has no PIN session — it authenticates with its own
  // shared secret, so this must run before the token gate below.
  if (data.action === 'updateScSession') {
    return json(updateScSessionFromSyncJob(data));
  }

  const actor = resolveActor_(data.token);
  if (!actor) return json(UNAUTHORIZED);

  if (data.action === 'addUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    data.added_by = actor.name; // trust the token, not the client-supplied name
    return json(addUnsched(data));
  }
  if (data.action === 'removeUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(removeUnsched(data.id));
  }
  if (data.action === 'updateUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
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
// Auth: SureCam uses an Auth0 browser-redirect login that UrlFetchApp can't
//   complete, so the session is produced elsewhere: the surecam-sync GitHub
//   Action logs in with a headless browser and POSTs the cookie here via
//   updateScSession (see updateScSessionFromSyncJob).
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

// Called by the surecam-sync GitHub Action — verifies the shared secret then
// stores the cookie. This is the only way a session gets in: SureCam's Auth0
// login needs a real browser, which the Action provides and Apps Script can't.
function updateScSessionFromSyncJob(data) {
  var secret = PropertiesService.getScriptProperties().getProperty('EXTENSION_SECRET');
  if (!secret || data.secret !== secret) return { success: false, error: 'invalid secret' };
  if (!data.cookieString || !data.cookieString.includes('_vts2_session')) {
    return { success: false, error: 'no _vts2_session in cookie string' };
  }
  PropertiesService.getScriptProperties().setProperty('SC_SESSION', data.cookieString);
  CacheService.getScriptCache().put('sc_session', data.cookieString, 7000);
  if (data.vehicles && data.vehicles.length) {
    storeVehicleSnapshot_(data.vehicles, data.snapshotAt || new Date().toISOString());
  }
  Logger.log('SC: session updated by sync job');
  return { success: true };
}

// Run once from the Apps Script editor to read the shared secret that the
// GitHub Action sends (stored as the SWS_EXTENSION_SECRET repo secret).
function getExtensionSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('EXTENSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty('EXTENSION_SECRET', secret);
  }
  Logger.log('Extension secret: ' + secret);
}

function scSession_() {
  var cached = CacheService.getScriptCache().get('sc_session');
  if (cached) return cached;
  var stored = PropertiesService.getScriptProperties().getProperty('SC_SESSION');
  if (stored) {
    CacheService.getScriptCache().put('sc_session', stored, 7000);
    return stored;
  }
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

// Vehicle positions must survive CacheService eviction, trigger outages, and
// temporary SureCam/App Script authorization failures. PropertiesService is the
// durable last-known-good source; CacheService is only a read-through speedup.
function storeVehicleSnapshot_(vehicles, snapshotAt) {
  var clean = (vehicles || []).slice(0, 50).filter(function(v) {
    return v && v.deviceId && isFinite(Number(v.lat)) && isFinite(Number(v.lng));
  }).map(function(v) {
    return {
      deviceId: String(v.deviceId),
      name: String(v.name || v.deviceId),
      status: String(v.status || 'unknown'),
      lat: Number(v.lat),
      lng: Number(v.lng),
      updatedAt: String(v.updatedAt || snapshotAt),
    };
  });
  if (!clean.length) return false;
  var snapshot = { vehicles: clean, snapshotAt: String(snapshotAt || new Date().toISOString()) };
  var encoded = JSON.stringify(snapshot);
  PropertiesService.getScriptProperties().setProperty('SC_VEHICLE_SNAPSHOT', encoded);
  CacheService.getScriptCache().put('sc_vehicle_snapshot', encoded, 21600);
  return true;
}

function getVehicleSnapshot_() {
  var cache = CacheService.getScriptCache();
  var encoded = cache.get('sc_vehicle_snapshot');
  if (!encoded) {
    encoded = PropertiesService.getScriptProperties().getProperty('SC_VEHICLE_SNAPSHOT');
    if (encoded) cache.put('sc_vehicle_snapshot', encoded, 21600);
  }
  if (!encoded) return { vehicles: [], snapshotAt: null };
  try { return JSON.parse(encoded); }
  catch (e) { return { vehicles: [], snapshotAt: null }; }
}

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
    Logger.log('SC warm-up body head: ' + warmHtml.substring(0, 400).replace(/\s+/g, ' '));
    Logger.log('SC: session rejected at warm-up (code=' + warmCode + ', len=' + warmHtml.length + '). Re-run the surecam-sync GitHub Action to refresh it.');
    CacheService.getScriptCache().remove('sc_session');
    return;
  }
  Logger.log('SC: warm-up authenticated ✓ (len=' + warmHtml.length + ')');

  // Capture the refreshed session cookie the warm-up response may include.
  // Store the full cookie string in BOTH places: an older version stripped the
  // leading "_vts2_session=" before saving to Properties, which silently saved a
  // nameless value. The cache hid that for ~2h, then the fallback read the
  // corrupted property and trucks vanished for no visible reason.
  var warmSession = scExtractSession_(warmResp, session);
  if (warmSession && warmSession !== session) {
    PropertiesService.getScriptProperties().setProperty('SC_SESSION', warmSession);
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
    storeVehicleSnapshot_(vehicles, new Date().toISOString());
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

// ── Retired install-analysis trigger handlers ──────────────────────────────
// Keep these handlers until the old Apps Script triggers have been removed.
function processInstallAnalysisQueue() {
  return { processed: 0, retired: true };
}

function scheduledInstallAnalysisRefresh_() {
  return { processed: 0, retired: true };
}

function setupInstallAnalysisTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['processInstallAnalysisQueue', 'scheduledInstallAnalysisRefresh_'].indexOf(trigger.getHandlerFunction()) !== -1)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return { retired: true };
}
