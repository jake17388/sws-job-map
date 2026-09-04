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
    Logger.log('SC: zero vehicles returned; retaining session for next attempt');
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
  // The device-detail attribute is stable across SureCam's wrapper/class changes.
  var tags = html.match(/<[a-z][a-z0-9:-]*\b[^>]*\bdata-live-device-details-src\s*=\s*(['"])[^'"]*\1[^>]*>/gi) || [];
  function attr(tag, name) {
    var match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'));
    return match ? match[2] : '';
  }
  tags.forEach(function(tag) {
    var src = attr(tag, 'data-live-device-details-src');
    var deviceId = (src.match(/\/accounts\/[^\/]+\/live\/([0-9a-f-]+)/i) || [])[1];
    var lat = attr(tag, 'data-latitude');
    var lng = attr(tag, 'data-longitude');
    if (!deviceId || !lat || !lng) return;
    vehicles.push({
      deviceId: deviceId,
      name: attr(tag, 'data-label') || deviceId,
      status: attr(tag, 'data-status') || 'unknown',
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
