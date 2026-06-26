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
// Credentials live in Script Properties. Run setSurecamCreds() once from the
// Apps Script editor with your real email/password, then undo the edit so
// credentials never land in this public repo.
const SC_BASE = 'https://install.surecam.com';
const SC_ACCT = '01127';

function setSurecamCreds() {
  PropertiesService.getScriptProperties().setProperties({
    SC_EMAIL: 'YOUR_SURECAM_EMAIL',
    SC_PASS:  'YOUR_SURECAM_PASSWORD',
  });
}

// Run once to store device IDs. Re-run if you add or remove trucks.
// UUIDs come from data-live-device-details-src attributes on the SureCam live page.
function setSurecamDeviceIds() {
  var ids = [
    '33bb8790-2acc-4ae5-9729-c6435152cf6f', // 2025 Double Bucket
    'e6c84a15-6a26-4f5a-9f27-494dc3a15f9a', // 2016 FLATBED
    'cbb1eae7-8270-4ded-ab87-910281b5800d', // 2018 BIG CRANE
    'e7305eeb-b034-4ca6-bc39-44a34e7baea8', // 2023 SEQUOIA
    '7e29173d-2aff-4040-a217-77d82213f48a', // 2018 YUKON
    'e7ee6ba9-1f74-4a76-b318-fae044c8a818', // 2019 SINGLE BUCKET
    '8b9bbd1f-e903-4354-a79c-738493f69028', // 2023 GMC 3500
    '0f74b5cc-b7e8-41d6-a5fc-6daa201b138a', // 2023 SINGLE BUCKET
    '58dc9b5b-ada3-4085-a2f5-08baebe7d97c', // 2022 CRV
    '5e2c8f15-7b50-404a-baf3-538a2f51f301', // 2022 SMALL CRANE
    '3812774d-22d0-4a8e-9e35-22e277fa29f5', // 2015 DOUBLE BUCKET
    'f7c3efd5-e9b7-40ec-80c7-99534c8b3117', // 2005 SILVERADO
  ];
  PropertiesService.getScriptProperties().setProperty('SC_DEVICE_IDS', JSON.stringify(ids));
  Logger.log('SC: stored ' + ids.length + ' device IDs');
}

function scLogin_() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('SC_EMAIL');
  const pass  = props.getProperty('SC_PASS');
  if (!email || !pass) return null; // not configured — skip silently

  // Fetch login page for CSRF token
  const pageResp = UrlFetchApp.fetch(SC_BASE + '/users/sign_in', {
    muteHttpExceptions: true, followRedirects: false,
  });
  const html = pageResp.getContentText();
  const csrf = (html.match(/name="authenticity_token"[^>]*value="([^"]+)"/) || [])[1];
  if (!csrf) { Logger.log('SC: no CSRF on login page — wrong URL or already authenticated'); return null; }

  const initCookies = scParseCookies_(pageResp);
  const loginResp = UrlFetchApp.fetch(SC_BASE + '/users/sign_in', {
    method: 'post',
    payload: 'authenticity_token=' + encodeURIComponent(csrf) +
             '&user%5Bemail%5D=' + encodeURIComponent(email) +
             '&user%5Bpassword%5D=' + encodeURIComponent(pass),
    headers: {
      Cookie: scCookieStr_(initCookies),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    muteHttpExceptions: true, followRedirects: false,
  });

  var cookies = Object.assign({}, initCookies, scParseCookies_(loginResp));
  if (!cookies['_vts2_session']) { Logger.log('SC: login failed — check credentials'); return null; }

  // Visit the live overview page (following redirects manually) so Rails writes account context
  // into the encrypted session cookie. Vehicle detail pages require this to render beyond the shell.
  var warmUrl = SC_BASE + '/accounts/' + SC_ACCT + '/live';
  for (var hop = 0; hop < 5; hop++) {
    var liveResp = UrlFetchApp.fetch(warmUrl, {
      headers: { Cookie: scCookieStr_(cookies), 'Accept': 'text/html, application/xhtml+xml' },
      muteHttpExceptions: true, followRedirects: false,
    });
    var liveCode = liveResp.getResponseCode();
    var liveCookies = scParseCookies_(liveResp);
    if (liveCookies['_vts2_session']) {
      cookies['_vts2_session'] = liveCookies['_vts2_session'];
      Logger.log('SC: session updated at warm-up hop ' + hop);
    }
    if (liveCode < 300 || liveCode >= 400) break;
    var loc = liveResp.getAllHeaders()['Location'] || liveResp.getAllHeaders()['location'] || '';
    if (!loc) break;
    warmUrl = loc.startsWith('http') ? loc : SC_BASE + loc;
  }

  const session = scCookieStr_(cookies);
  CacheService.getScriptCache().put('sc_session', session, 7000); // ~2hr
  return session;
}

function scSession_() {
  return CacheService.getScriptCache().get('sc_session') || scLogin_();
}

function scParseCookies_(resp) {
  const raw = resp.getAllHeaders()['Set-Cookie'] || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = {};
  arr.forEach(function(c) {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) out[m[1].trim()] = m[2].trim();
  });
  return out;
}

function scCookieStr_(obj) {
  return Object.keys(obj).map(function(k) { return k + '=' + obj[k]; }).join('; ');
}

function scFetch_(path, session) {
  return UrlFetchApp.fetch(SC_BASE + path, {
    headers: { Cookie: session },
    muteHttpExceptions: true, followRedirects: true,
  });
}

function scDiscoverIds_(session) {
  // Primary: read IDs stored by setSurecamDeviceIds() in Script Properties.
  var stored = PropertiesService.getScriptProperties().getProperty('SC_DEVICE_IDS');
  if (stored) {
    var ids = JSON.parse(stored);
    Logger.log('SC: ' + ids.length + ' device IDs from Script Properties');
    return ids;
  }
  // Fallback: attempt live-page scrape (only works if SureCam ever embeds IDs in server HTML).
  var html = scFetch_('/accounts/' + SC_ACCT + '/live', session).getContentText();
  var seen = {}, fallback = [];
  var re = /\/accounts\/\d+\/live\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
  var m;
  while ((m = re.exec(html)) !== null) { if (!seen[m[1]]) { seen[m[1]] = true; fallback.push(m[1]); } }
  if (!fallback.length) Logger.log('SC: no vehicle IDs found — run setSurecamDeviceIds() once');
  return fallback;
}

// Run from the Apps Script editor to verify the vehicle page fetch and address parsing.
function debugSurecamVehiclePage() {
  var session = scSession_();
  Logger.log('Session present: ' + !!session + (session ? ' (' + session.length + ' chars)' : ''));
  if (!session) { Logger.log('→ Run setSurecamCredentials() first'); return; }

  var deviceId = 'e6c84a15-6a26-4f5a-9f27-494dc3a15f9a'; // 2016 FLATBED

  // Step 1: manually follow the live overview redirect chain, capturing session cookies at each hop.
  // The 302 from /live redirects to the actual page; we need the cookies from that final response.
  var warmUrl = SC_BASE + '/accounts/' + SC_ACCT + '/live';
  var maxHops = 5;
  for (var hop = 0; hop < maxHops; hop++) {
    var warmResp = UrlFetchApp.fetch(warmUrl, {
      headers: { Cookie: session, 'Accept': 'text/html, application/xhtml+xml' },
      muteHttpExceptions: true, followRedirects: false,
    });
    var code = warmResp.getResponseCode();
    var warmLen = warmResp.getContentText().length;
    var location = warmResp.getAllHeaders()['Location'] || warmResp.getAllHeaders()['location'] || '';
    Logger.log('Warm hop ' + hop + ': ' + code + '  len=' + warmLen + '  loc=' + location);

    // Merge any updated session cookie.
    var hopCookies = scParseCookies_(warmResp);
    if (hopCookies['_vts2_session']) {
      var existing = {};
      session.split('; ').forEach(function(pair) {
        var eq = pair.indexOf('='); if (eq > 0) existing[pair.slice(0, eq)] = pair.slice(eq + 1);
      });
      Object.assign(existing, hopCookies);
      session = Object.keys(existing).map(function(k) { return k + '=' + existing[k]; }).join('; ');
      Logger.log('  → session updated, now ' + session.length + ' chars');
    }

    if (code < 300 || code >= 400 || !location) break; // done redirecting
    warmUrl = location.startsWith('http') ? location : SC_BASE + location;
  }
  Logger.log('Warm-up complete. Final session length: ' + session.length);

  // Step 2: fetch the vehicle detail page with the (possibly updated) session.
  var opts = { headers: { Cookie: session, 'Turbo-Frame': 'live_device', 'Accept': 'text/html, application/xhtml+xml' }, muteHttpExceptions: true, followRedirects: true };
  var resp = UrlFetchApp.fetch(SC_BASE + '/accounts/' + SC_ACCT + '/live/' + deviceId + '?sort_view=lastConnected', opts);
  var html = resp.getContentText();
  Logger.log('Detail response code: ' + resp.getResponseCode());
  Logger.log('Detail HTML length: ' + html.length + (html.length < 50000 ? ' ← TOO SHORT (still app shell)' : ' ✓ FULL PAGE'));

  if (html.length > 50000) {
    var name    = ((html.match(/font-semibold leading-5[^"]*">\s*([^<\n]+?)\s*</) || [])[1] ||
                   (html.match(/font-semibold leading-6[^"]*">\s*([^<\n]+?)\s*</) || [])[1] || deviceId).trim();
    var serial  = (html.match(/data-serial="(\d+)"/) || [])[1] || '(none)';
    var status  = (html.match(/data-status="([^"]+)"/) || [])[1] || '(none)';
    var address = (html.match(/class="(?:ml-1 truncate|truncate ml-1)"[^>]*data-tippy-content="([^"]+)"/) || [])[1] || '(none)';
    Logger.log('→ name: ' + name + '  serial: ' + serial + '  status: ' + status);
    Logger.log('→ address: ' + address);
  }
}

function scParseVehicle_(deviceId, session) {
  // Replicate the exact request Turbo Drive sends when clicking a vehicle in the sidebar:
  //   URL includes ?sort_view=lastConnected (triggers full server render, not app shell)
  //   Accept: text/html, application/xhtml+xml  (Turbo's default)
  //   Turbo-Frame: live_device
  var opts = {
    headers: {
      Cookie: session,
      'Turbo-Frame': 'live_device',
      'Accept': 'text/html, application/xhtml+xml',
    },
    muteHttpExceptions: true, followRedirects: true,
  };
  var url = SC_BASE + '/accounts/' + SC_ACCT + '/live/' + deviceId + '?sort_view=lastConnected';
  var html = UrlFetchApp.fetch(url, opts).getContentText();

  // Vehicle name — class varies; try leading-5 first, then any font-semibold heading
  var name = (
    (html.match(/font-semibold leading-5[^"]*">\s*([^<\n]+?)\s*</) || [])[1] ||
    (html.match(/font-semibold leading-6[^"]*">\s*([^<\n]+?)\s*</) || [])[1] ||
    (html.match(/class="[^"]*font-semibold[^"]*"[^>]*>\s*([A-Z0-9 ]{3,40})\s*</) || [])[1] ||
    deviceId
  ).trim();

  var serial  = (html.match(/data-serial="(\d+)"/) || [])[1] || '';
  var status  = (html.match(/data-status="([^"]+)"/) || [])[1] || 'unknown';
  // The current-location address is in the first <span class="ml-1 truncate"> with a tippy,
  // which sits after the map-pin SVG. Matching generically on data-tippy-content picks up the
  // status-description tooltip instead (wrong element, same attribute name).
  var address = (html.match(/class="(?:ml-1 truncate|truncate ml-1)"[^>]*data-tippy-content="([^"]+)"/) || [])[1] || '';
  return { name: name, serial: serial, status: status, address: address, deviceId: deviceId };
}

function scGeocode_(address) {
  if (!address) return null;
  const props = PropertiesService.getScriptProperties();
  let cache = {};
  try { cache = JSON.parse(props.getProperty('SC_GEO') || '{}'); } catch(e) {}
  if (cache[address]) return cache[address];
  try {
    const r = Maps.newGeocoder().geocode(address);
    const loc = r.results && r.results[0] && r.results[0].geometry && r.results[0].geometry.location;
    if (loc) {
      cache[address] = { lat: loc.lat, lng: loc.lng };
      const keys = Object.keys(cache);
      if (keys.length > 300) delete cache[keys[0]]; // keep under control
      props.setProperty('SC_GEO', JSON.stringify(cache));
      return cache[address];
    }
  } catch(e) { Logger.log('SC geocode error for "' + address + '": ' + e.message); }
  return null;
}

// Called by the 5-minute time trigger. Safe to call manually too.
function cacheSurecamVehicles() {
  const session = scSession_();
  if (!session) return; // credentials not yet configured

  try {
    const ids = scDiscoverIds_(session);
    if (!ids.length) { Logger.log('SC: no vehicle IDs found on live page'); return; }

    const vehicles = [];
    ids.forEach(function(id) {
      try {
        const v = scParseVehicle_(id, session);
        const pos = scGeocode_(v.address);
        vehicles.push({
          name: v.name, serial: v.serial, status: v.status,
          address: v.address, deviceId: v.deviceId,
          lat: pos ? pos.lat : null,
          lng: pos ? pos.lng : null,
          updatedAt: new Date().toISOString(),
        });
      } catch(e) {
        Logger.log('SC vehicle error ' + id + ': ' + e.message);
      }
    });

    if (vehicles.length) {
      CacheService.getScriptCache().put('sc_vehicles', JSON.stringify(vehicles), 400);
    }
  } catch(e) {
    Logger.log('cacheSurecamVehicles: ' + e.message);
    CacheService.getScriptCache().remove('sc_session'); // force re-login next time
  }
}

// Run from the Apps Script editor to find which API endpoint returns vehicle/device data.
function debugSurecamApi() {
  var session = scSession_();
  if (!session) { Logger.log('No session'); return; }

  var cookie = scCookieStr_(session);

  function probe(path, acceptHeader) {
    var opts = {
      headers: { 'Cookie': cookie },
      followRedirects: true,
      muteHttpExceptions: true
    };
    if (acceptHeader) opts.headers['Accept'] = acceptHeader;
    try {
      var resp = UrlFetchApp.fetch(SC_BASE + path, opts);
      var code = resp.getResponseCode();
      var body = resp.getContentText().substring(0, 250).replace(/\s+/g, ' ');
      Logger.log(path + ' → ' + code + ' | ' + body);
    } catch(e) {
      Logger.log(path + ' → ERROR: ' + e.message);
    }
  }

  probe('/accounts/' + SC_ACCT + '/vehicles.json');
  probe('/accounts/' + SC_ACCT + '/vehicle_devices.json');
  probe('/accounts/' + SC_ACCT + '/devices.json');
  probe('/accounts/' + SC_ACCT + '/live.json');
  probe('/accounts/' + SC_ACCT + '/live/vehicles.json');
  probe('/accounts/' + SC_ACCT + '/live', 'application/json');
  probe('/api/v1/accounts/' + SC_ACCT + '/vehicles');
  probe('/api/v1/accounts/' + SC_ACCT + '/devices');
}

// Run from the Apps Script editor to find device UUIDs via trip detail pages.
function debugSurecamTrips() {
  var session = scSession_();
  if (!session) { Logger.log('No session'); return; }

  // Get trips list and pull out trip UUIDs
  var tripsHtml = scFetch_('/accounts/' + SC_ACCT + '/trips', session).getContentText();
  var tripIds = (tripsHtml.match(/href="\/accounts\/\d+\/trips\/([0-9a-f-]{36})"/g) || [])
    .map(function(m) { return m.match(/([0-9a-f-]{36})/)[1]; });
  Logger.log('Trip IDs found on trips page: ' + tripIds.length);

  if (!tripIds.length) {
    // Log a page preview so we can see the structure
    Logger.log('Trips page preview: ' + tripsHtml.substring(0, 600).replace(/\s+/g, ' '));
    return;
  }

  // Fetch the first 3 trip detail pages and look for /live/{device_uuid} links
  var deviceIds = {};
  tripIds.slice(0, 6).forEach(function(tid) {
    var html = scFetch_('/accounts/' + SC_ACCT + '/trips/' + tid, session).getContentText();
    var matches = html.match(/\/accounts\/\d+\/live\/([0-9a-f-]{36})/g) || [];
    matches.forEach(function(m) {
      var uuid = m.match(/([0-9a-f-]{36})/)[1];
      deviceIds[uuid] = true;
    });
  });

  var found = Object.keys(deviceIds);
  Logger.log('Device UUIDs found via trip pages: ' + found.length + ' — ' + found.join(', '));
}

// Run from the Apps Script editor to diagnose why vehicle IDs aren't being found.
function debugSurecam() {
  var session = scSession_();
  if (!session) { Logger.log('No session — run setSurecamCreds first'); return; }

  // Main live page
  var liveResp = scFetch_('/accounts/' + SC_ACCT + '/live', session);
  var liveHtml = liveResp.getContentText();
  Logger.log('Live page response code: ' + liveResp.getResponseCode());
  Logger.log('Live page length: ' + liveHtml.length + ' chars');

  // Turbo frames that might load the vehicle list
  var frames = liveHtml.match(/<turbo-frame[^>]+src="([^"]+)"/g) || [];
  Logger.log('Turbo frames with src: ' + (frames.length ? frames.join(' | ') : 'none'));

  // /live/{uuid} links in the page
  var liveLinks = liveHtml.match(/\/accounts\/\d+\/live\/[0-9a-f-]{36}/g) || [];
  Logger.log('Vehicle links on live page: ' + liveLinks.length + (liveLinks.length ? ' — ' + liveLinks.slice(0, 3).join(', ') : ''));

  // Health page often has all devices listed
  var healthHtml = scFetch_('/accounts/' + SC_ACCT + '/health', session).getContentText();
  var healthLinks = healthHtml.match(/\/accounts\/\d+\/live\/[0-9a-f-]{36}/g) || [];
  Logger.log('Health page vehicle links: ' + healthLinks.length + (healthLinks.length ? ' — ' + healthLinks.slice(0, 3).join(', ') : ''));

  // Trips page
  var tripsHtml = scFetch_('/accounts/' + SC_ACCT + '/trips', session).getContentText();
  var tripsLinks = tripsHtml.match(/\/accounts\/\d+\/live\/[0-9a-f-]{36}/g) || [];
  Logger.log('Trips page vehicle links: ' + tripsLinks.length + (tripsLinks.length ? ' — ' + tripsLinks.slice(0, 3).join(', ') : ''));

  // First 400 chars of live page (confirms auth worked)
  Logger.log('Live page start: ' + liveHtml.substring(0, 400).replace(/\s+/g, ' '));
}

// Run once from the Apps Script editor to set up the 5-minute refresh trigger.
function setupVehicleTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'cacheSurecamVehicles'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cacheSurecamVehicles').timeBased().everyMinutes(5).create();
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
