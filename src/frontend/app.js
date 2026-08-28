// ── Config ────────────────────────────────────────────────────────────────────
// Your Apps Script deployment URL — update this if you redeploy
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfyJCV7R64CCB2RiRfgkOAtFb79JPhv_rXIxmkedaY4rqjEIJH7tumtXu_8UlwJW4P/exec';
// Bump this on every deploy — shown in the app footer and used to detect
// when the installed iOS home-screen app is running stale cached code.
const APP_VERSION = '2026.08.27.1';
 
const COLORS = { install:'#3aad6e', service:'#4169E1', excavation:'#FFBF00', unscheduled:'#DC143C' };
const SCHED_PIN = '#1e4589'; // matches the SWS brand navy used in the header
const TYPE_INIT = { install:'I', service:'S', excavation:'E' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const GEO_ERRORS = { ZERO_RESULTS:'Address not found', OVER_DAILY_LIMIT:'API limit reached', OVER_QUERY_LIMIT:'Rate limited', REQUEST_DENIED:'API key error', INVALID_REQUEST:'Invalid address', UNKNOWN_ERROR:'Server error' };
const CREW = ['Johnny', 'Jonathan', 'Randy', 'Eli', 'Jerry', 'Jake'];
const CREW_COLORS = { Johnny:'#F97316', Jonathan:'#5B9CF6', Randy:'#3aad6e', Eli:'#5E35B1', Jerry:'#FFBF00', Jake:'#111111' };
 
// ── State ─────────────────────────────────────────────────────────────────────
let map, geocoder, infoWindowOpen = null;
let scheduledJobs = [], unscheduledJobs = [];
const activeTypes = new Set(['install','service','excavation','unscheduled']);
let currentUser = null;
let pinEntry = '';
let pinBusy = false;
const AUTH_KEY = 'sws_auth_v1';
let auth = readCache(AUTH_KEY) || null; // { token, user } — validated server-side
if (auth && !auth.role) auth.role = auth.user === 'Jake Banks' ? 'admin' : 'viewer';
let fetchedDateRange = null;
let searchQuery = '';
let editingId = null;
const activeCrews = new Set(CREW);

// ── Local caches (geocode results + last-session data) ───────────────────────
const GEO_CACHE_KEY = 'sws_geo_cache_v1';
const JOBS_CACHE_KEY = 'sws_jobs_cache_v1';
const UNSCHED_CACHE_KEY = 'sws_unsched_cache_v1';
const VEHICLE_CACHE_KEY = 'sws_vehicle_snapshot_v1';
const GEO_CACHE_MAX_AGE = 90 * 24 * 3600 * 1000;  // addresses rarely move
const DATA_CACHE_MAX_AGE = 24 * 3600 * 1000;      // jobs change daily
const VEHICLE_CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;

function readCache(key, maxAge) {
  try {
    const wrap = JSON.parse(localStorage.getItem(key));
    if (!wrap || (maxAge && Date.now() - wrap.at > maxAge)) return null;
    return wrap.data;
  } catch (e) { return null; }
}
function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); }
  catch (e) { /* quota exceeded or storage blocked — caching is best-effort */ }
}

const geoCache = (() => {
  const stored = readCache(GEO_CACHE_KEY) || {};
  const cutoff = Date.now() - GEO_CACHE_MAX_AGE;
  const fresh = {};
  Object.keys(stored).forEach(k => { if ((stored[k].t || 0) > cutoff) fresh[k] = stored[k]; });
  return fresh;
})();
function geoKey(addr) { return String(addr).trim().toLowerCase().replace(/\s+/g, ' '); }
function geoCacheGet(addr) { return addr ? geoCache[geoKey(addr)] : null; }
function geoCacheSet(addr, lat, lng) {
  geoCache[geoKey(addr)] = { lat, lng, t: Date.now() };
  writeCache(GEO_CACHE_KEY, geoCache);
}

// Cache-first geocode: cached addresses resolve synchronously with no API call
function geocodeAddress(addr, cb) {
  const hit = geoCacheGet(addr);
  if (hit) { cb(true, hit.lat, hit.lng, null); return; }
  geocoder.geocode({ address: addr }, (results, status) => {
    if (status === 'OK' && results[0]) {
      const lat = results[0].geometry.location.lat();
      const lng = results[0].geometry.location.lng();
      geoCacheSet(addr, lat, lng);
      cb(true, lat, lng, null);
    } else cb(false, null, null, status);
  });
}

// Coalesce per-geocode re-renders into at most ~5 list/map refreshes per second
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; applyFilters(); }, 200);
}

// ── Mobile layout: List/Map tabs, filters accordion, add-job modal, job card ──
function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

function setMobileView(view) {
  const main = document.querySelector('.main');
  if (!main) return;
  main.classList.remove('mobile-view-list', 'mobile-view-map');
  main.classList.add('mobile-view-' + view);
  document.querySelectorAll('.mobile-tab').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  if (view !== 'map') closeJobCard();
  if (view === 'map' && map) {
    const c = map.getCenter();
    google.maps.event.trigger(map, 'resize');
    if (c) map.setCenter(c);
  }
}

function toggleFiltersPanel() {
  document.getElementById('filters-collapsible').classList.toggle('open');
  document.getElementById('filters-toggle').classList.toggle('open');
}

function openAddModal() {
  if (!isAdmin()) return;
  document.body.classList.add('add-modal-open');
  document.getElementById('unsched-add').classList.add('modal-open');
}
function closeAddModal() {
  document.body.classList.remove('add-modal-open');
  document.getElementById('unsched-add').classList.remove('modal-open');
  if (editingId !== null) cancelEdit();
}

function openJobCard(html) {
  document.getElementById('job-card-body').innerHTML = html;
  document.getElementById('job-card').classList.add('open');
}
function closeJobCard() {
  document.getElementById('job-card').classList.remove('open');
}

// ── PIN logic ─────────────────────────────────────────────────────────────────
function pinKey(k) {
  if (pinBusy || pinEntry.length >= 4) return;
  pinEntry += k;
  updateDots();
  if (pinEntry.length === 4) submitPin();
}
function pinDel() {
  if (pinBusy) return;
  pinEntry = pinEntry.slice(0, -1);
  updateDots();
  document.getElementById('pin-error').textContent = '';
  document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error'));
}
function updateDots(state) {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('d' + i);
    dot.className = 'pin-dot';
    if (state === 'error') dot.classList.add('error');
    else if (i < pinEntry.length) dot.classList.add('filled');
  }
}
function submitPin() {
  pinBusy = true;
  document.getElementById('pin-error').textContent = 'Verifying…';
  scriptPost({ action: 'login', pin: pinEntry })
    .then(res => {
      pinBusy = false;
      if (res && res.ok) {
        auth = { token: res.token, user: res.user, role: res.role || 'viewer' };
        writeCache(AUTH_KEY, auth);
        pinEntry = '';
        document.getElementById('pin-error').textContent = '';
        enterApp();
      } else {
        pinFailed(res && res.locked
          ? 'Too many attempts. Try again in 10 minutes.'
          : 'Incorrect PIN. Try again.');
      }
    })
    .catch(() => { pinBusy = false; pinFailed('Connection error. Try again.'); });
}
function pinFailed(msg) {
  updateDots('error');
  document.getElementById('pin-error').textContent = msg;
  setTimeout(() => { pinEntry = ''; updateDots(); document.getElementById('pin-error').textContent = ''; }, 1500);
}
function enterApp() {
  currentUser = auth.user;
  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-badge').textContent = currentUser;
  applyRoleVisibility();
  requestMap(); // loadAll(), called once the map is ready, also checks for an app update
}

function isAdmin() { return !!auth && auth.role === 'admin'; }

function applyRoleVisibility() {
  const admin = isAdmin();
  document.getElementById('fab-add').hidden = !admin;
  document.getElementById('fab-add').style.display = admin ? '' : 'none';
  document.getElementById('unsched-add').hidden = !admin;
  document.getElementById('unsched-add').style.display = admin ? '' : 'none';
  if (!admin) closeAddModal();
  renderList();
}

// ── Text zoom ────────────────────────────────────────────────────────────────
const ZOOM_STEPS = [80, 90, 100, 110, 120, 130, 140];
let textZoomIdx = 2; // default 100%
function initTextZoom() {
  const saved = localStorage.getItem('sws_text_zoom');
  if (saved !== null) textZoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, +saved));
  applyTextZoom();
}
function applyTextZoom() {
  document.getElementById('job-list').style.zoom = ZOOM_STEPS[textZoomIdx] / 100;
  const label = document.getElementById('zoom-label');
  if (label) label.textContent = ZOOM_STEPS[textZoomIdx] + '%';
  localStorage.setItem('sws_text_zoom', textZoomIdx);
}
function adjustZoom(dir) {
  textZoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, textZoomIdx + dir));
  applyTextZoom();
}
function resetZoom() {
  textZoomIdx = 2; // 100%
  applyTextZoom();
}

// ── Settings panel ───────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-version-text').textContent = APP_VERSION;
  document.getElementById('zoom-label').textContent = ZOOM_STEPS[textZoomIdx] + '%';
  document.getElementById('settings-backdrop').classList.add('show');
  document.getElementById('settings-panel').classList.add('show');
}
function closeSettings() {
  document.getElementById('settings-backdrop').classList.remove('show');
  document.getElementById('settings-panel').classList.remove('show');
}

// ── App update check ─────────────────────────────────────────────────────────
// iOS caches the home-screen PWA shell aggressively and doesn't always refetch
// on launch, so the app can silently run stale code. version.json is fetched
// with cache:'no-store' to always hit the network, and a mismatch surfaces a
// banner the crew can tap to force a fresh load.
function checkForUpdate(manual) {
  const checkLink = document.getElementById('settings-check-link');
  if (manual && checkLink) checkLink.textContent = 'Checking…';
  fetch('version.json', { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      if (data.version && data.version !== APP_VERSION) {
        document.getElementById('update-banner').classList.add('show');
        if (manual && checkLink) checkLink.textContent = 'Update available — see banner above';
      } else if (manual && checkLink) {
        checkLink.textContent = "You're up to date";
        setTimeout(() => { checkLink.textContent = 'Check for updates'; }, 2500);
      }
    })
    .catch(() => {
      if (manual && checkLink) {
        checkLink.textContent = 'Could not check — try again';
        setTimeout(() => { checkLink.textContent = 'Check for updates'; }, 2500);
      }
    });
}
function applyUpdate() {
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now());
  window.location.href = url.toString();
}
function signOut() {
  localStorage.removeItem(AUTH_KEY);
  auth = null;
  currentUser = null; pinEntry = '';
  updateDots();
  document.getElementById('pin-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  scheduledJobs.forEach(j => { if (j._marker) j._marker.setMap(null); });
  unscheduledJobs.forEach(j => { if (j._marker) j._marker.setMap(null); });
  scheduledJobs = []; unscheduledJobs = [];
}
document.addEventListener('keydown', e => {
  if (currentUser) return;
  if (e.key >= '0' && e.key <= '9') pinKey(e.key);
  if (e.key === 'Backspace') pinDel();
});
 
// ── API calls to Apps Script ──────────────────────────────────────────────────
function scriptGet(action) {
  const token = encodeURIComponent(auth ? auth.token : '');
  return fetch(`${SCRIPT_URL}?action=${action}&token=${token}`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(checkAuthError);
}
function scriptPost(body) {
  const payload = body.action === 'login' ? body : { ...body, token: auth ? auth.token : '' };
  return fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(checkAuthError);
}
function checkAuthError(data) {
  if (data && data.error === 'unauthorized') {
    signOut(); // token expired or revoked — back to the PIN screen
    document.getElementById('pin-error').textContent = 'Session expired — enter your PIN.';
    throw new Error('unauthorized');
  }
  return data;
}
 
// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const dow = DAYS[new Date(+y, +m - 1, +day).getDay()];
  return `${dow} ${MONTHS[+m - 1]} ${+day}`;
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
}
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
 
// ── Home base marker ──────────────────────────────────────────────────────────
const HOME_ADDRESS = '4049 E Presidio St, Mesa, AZ 85215';
const HOME_COORDS = { lat: 33.4722424, lng: -111.7427657 }; // fixed — never re-geocode
function makeHomeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 44 54">
    <path d="M22 2C13.16 2 6 9.16 6 18c0 13 16 34 16 34s16-21 16-34C38 9.16 30.84 2 22 2z" fill="#2447a3"/>
    <circle cx="22" cy="17" r="11.5" fill="#f5a31c"/>
  </svg>`;
}
function initHomeMarker() {
  const icon = {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(makeHomeSVG()),
    scaledSize: new google.maps.Size(44, 54),
    anchor: new google.maps.Point(22, 54)
  };
  const marker = new google.maps.Marker({ position: HOME_COORDS, map, icon, title: 'SWS — Home Base', zIndex: 9999 });
  const iw = new google.maps.InfoWindow({
    content: `<div style="font-family:'DM Sans',sans-serif;padding:4px 2px;min-width:160px">
      <div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:3px">SWS Home Base</div>
      <div style="font-size:11px;color:#888">${HOME_ADDRESS}</div>
    </div>`
  });
  marker.addListener('click', () => {
    if (infoWindowOpen) infoWindowOpen.close();
    iw.open(map, marker); infoWindowOpen = iw;
  });
}

// ── SureCam vehicle markers ───────────────────────────────────────────────────
let vehicleMarkers = [];
let lastVehicles = [];
let showVehicles = true;
let vehicleSnapshotAt = null;
let vehicleDataStale = false;

function truckIcon_(status) {
  const fill = { normal: '#16a34a', idling: '#d97706', park_mode: '#6b7280' }[status] || '#9ca3af';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'><circle cx='17' cy='17' r='15' fill='${fill}' stroke='#fff' stroke-width='2.5'/><path d='M8 13h11v9H8zm11 0h5l3 3.5V22h-8z' fill='#fff'/><circle cx='11.5' cy='22' r='2' fill='${fill}' stroke='#fff' stroke-width='1.5'/><circle cx='23.5' cy='22' r='2' fill='${fill}' stroke='#fff' stroke-width='1.5'/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(34, 34),
    anchor: new google.maps.Point(17, 17),
  };
}

function truckInfoHtml_(v) {
  const label = { normal: 'Driving', idling: 'Idle', park_mode: 'Parked', unknown: 'Unknown' }[v.status] || v.status;
  const dot = { normal: '#16a34a', idling: '#d97706', park_mode: '#9ca3af' }[v.status] || '#9ca3af';
  const updated = v.updatedAt ? new Date(v.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  return `<div style="font-family:'DM Sans',sans-serif;padding:4px 2px;min-width:190px">
    <div style="font-weight:700;font-size:13px;margin-bottom:5px">${v.name}</div>
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
      <span style="width:7px;height:7px;border-radius:50%;background:${dot};display:inline-block;flex-shrink:0"></span>
      <span style="font-size:12px;color:#444">${label}</span>
    </div>
    ${v.address ? `<div style="font-size:11px;color:#777;margin-bottom:4px">${v.address}</div>` : ''}
    ${updated ? `<div style="font-size:10px;color:#bbb">Updated ${updated}</div>` : ''}
  </div>`;
}

function renderVehicleMarkers(vehicles) {
  vehicleMarkers.forEach(m => m.setMap(null));
  vehicleMarkers = [];
  vehicles.forEach(v => { v._marker = null; });
  if (!showVehicles || !map) return;
  vehicles.forEach(v => {
    if (!v.lat || !v.lng) return;
    const marker = new google.maps.Marker({
      position: { lat: v.lat, lng: v.lng },
      map,
      icon: truckIcon_(v.status),
      title: v.name,
      zIndex: 500,
    });
    marker.addListener('click', () => {
      if (infoWindowOpen) infoWindowOpen.close();
      const iw = new google.maps.InfoWindow({ content: truckInfoHtml_(v) });
      iw.open(map, marker); infoWindowOpen = iw;
    });
    v._marker = marker;
    vehicleMarkers.push(marker);
  });
}

function applyVehicleSnapshot(data, fromCache) {
  if (!data || !Array.isArray(data.vehicles) || !data.vehicles.length) return;
  lastVehicles = data.vehicles;
  vehicleSnapshotAt = data.snapshotAt || data.vehicles[0]?.updatedAt || null;
  vehicleDataStale = !!data.stale || !!fromCache;
  renderVehicleMarkers(lastVehicles);
  renderVehiclesPanel();
}

function fetchVehicles() {
  if (!auth) return;
  scriptGet('getVehicles')
    .then(data => {
      if (data && data.vehicles && data.vehicles.length) {
        writeCache(VEHICLE_CACHE_KEY, data);
        applyVehicleSnapshot(data, false);
      }
    })
    .catch(err => {
      console.error('Failed to load vehicles; keeping last-known positions:', err);
      vehicleDataStale = true;
      renderVehiclesPanel();
    });
}

function toggleVehiclesPanel() {
  document.getElementById('vehicles-collapsible').classList.toggle('open');
  document.getElementById('vehicles-toggle').classList.toggle('open');
}

function toggleMapVehiclesPanel() {
  document.getElementById('map-vehicles-panel').classList.toggle('open');
  document.getElementById('map-vehicles-toggle').classList.toggle('open');
}

function focusVehicle(idx) {
  const v = lastVehicles[idx];
  if (!v || !v.lat || !v.lng) return;
  if (isMobile()) setMobileView('map');
  map.panTo({ lat: v.lat, lng: v.lng });
  map.setZoom(15);
  if (v._marker) {
    if (infoWindowOpen) infoWindowOpen.close();
    const iw = new google.maps.InfoWindow({ content: truckInfoHtml_(v) });
    iw.open(map, v._marker); infoWindowOpen = iw;
  }
}

function renderVehiclesPanel() {
  const STATUS_COLORS = { normal: '#16a34a', idling: '#d97706', park_mode: '#6b7280' };
  const STATUS_LABELS = { normal: 'Driving', idling: 'Idle', park_mode: 'Parked', unknown: 'Unknown' };
  const snapshotTime = vehicleSnapshotAt
    ? new Date(vehicleSnapshotAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const ageNote = snapshotTime
    ? '<div style="font-size:10px;color:' + (vehicleDataStale ? '#b7791f' : '#aaa') + ';padding:2px 4px 5px">' +
      (vehicleDataStale ? 'Last known positions · ' : 'Positions updated · ') + snapshotTime + '</div>'
    : '';
  const rows = lastVehicles.length
    ? lastVehicles.map((v, i) => {
        const dot = STATUS_COLORS[v.status] || '#9ca3af';
        const label = STATUS_LABELS[v.status] || (v.status || 'Unknown');
        const hasPos = !!(v.lat && v.lng);
        return '<div class="vehicle-item' + (hasPos ? '' : ' v-no-pos') + '"' +
          (hasPos ? ' onclick="focusVehicle(' + i + ')"' : '') + '>' +
          '<span class="v-dot" style="background:' + dot + '"></span>' +
          '<div class="v-info"><div class="v-name">' + v.name + '</div>' +
          '<div class="v-status">' + label + '</div></div>' +
          (hasPos ? '<span class="v-arrow">›</span>' : '') +
          '</div>';
      }).join('')
    : '<div style="font-size:11px;color:#ccc;padding:6px 4px">No vehicles loaded yet</div>';
  const html = ageNote + rows;
  ['vehicle-list-items', 'map-vehicle-list-items'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

function toggleTrucks() {
  showVehicles = !showVehicles;
  ['btn-trucks', 'map-btn-trucks'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('on', showVehicles);
  });
  if (showVehicles) fetchVehicles();
  else { vehicleMarkers.forEach(m => m.setMap(null)); vehicleMarkers = []; }
}

// ── Map init ──────────────────────────────────────────────────────────────────
// With a saved session, enterApp() can run before the async Maps script is
// ready — queue the init until the loader's callback fires
let mapsLoaded = false, mapWanted = false;
function mapsReady() { mapsLoaded = true; if (mapWanted) initMap(); }
function requestMap() { if (mapsLoaded) initMap(); else mapWanted = true; }

function initMap() {
  if (map) { loadAll(); return; }
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 33.40, lng: -111.85 }, zoom: 10,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    gestureHandling: 'greedy',
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ]
  });
  geocoder = new google.maps.Geocoder();
  initCrewButtons();
  initTextZoom();
  initHomeMarker();
  const today = new Date();
  document.getElementById('date-from').value = fmt(today);
  document.getElementById('date-to').value = fmt(today);
  loadAll();
  const savedVehicles = readCache(VEHICLE_CACHE_KEY, VEHICLE_CACHE_MAX_AGE);
  if (savedVehicles) applyVehicleSnapshot(savedVehicles, true);
  fetchVehicles();
  setInterval(fetchVehicles, 90 * 1000);
}
 
// On first load, paint last session's data from localStorage immediately,
// then fetch fresh data in the background (Apps Script cold start can take 3-8s)
let cacheHydrated = false;
function loadAll() {
  if (!cacheHydrated) {
    cacheHydrated = true;
    const jobsData = readCache(JOBS_CACHE_KEY, DATA_CACHE_MAX_AGE);
    if (jobsData && jobsData.jobs && jobsData.jobs.length) applyJobsData(jobsData, true);
    const unschedData = readCache(UNSCHED_CACHE_KEY, DATA_CACHE_MAX_AGE);
    if (unschedData && unschedData.jobs && unschedData.jobs.length) applyUnschedData(unschedData);
  }
  checkForUpdate();
  return Promise.all([loadJobs(), loadUnscheduled()]);
}

async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  const status = document.getElementById('last-updated');
  btn.disabled = true;
  btn.textContent = '↻ Refreshing…';
  status.textContent = 'Refreshing…';
  try {
    const results = await loadAll();
    if (results.some(ok => !ok)) {
      status.textContent = 'Connection error — showing cached data';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}
 
// ── Toggle ────────────────────────────────────────────────────────────────────
function toggleType(type) {
  if (activeTypes.has(type)) { if (activeTypes.size === 1) return; activeTypes.delete(type); }
  else activeTypes.add(type);
  updateButtons();
  document.getElementById('unsched-add').classList.toggle('visible', isAdmin() && activeTypes.has('unscheduled'));
  applyFilters();
}
function updateButtons() {
  ['install', 'service', 'excavation', 'unscheduled'].forEach(t => {
    ['btn-', 'map-btn-'].forEach(prefix => {
      const btn = document.getElementById(prefix + t);
      if (btn) activeTypes.has(t) ? btn.classList.add('on') : btn.classList.remove('on');
    });
  });
}
function toggleMapFilters() {
  document.getElementById('map-filter-panel').classList.toggle('open');
  document.getElementById('map-filter-toggle').classList.toggle('open');
}
function setSearch(val) {
  searchQuery = val.trim();
  const d = document.getElementById('job-search');
  const m = document.getElementById('job-search-mobile');
  if (d && d !== document.activeElement) d.value = val;
  if (m && m !== document.activeElement) m.value = val;
  renderList();
}
 
// ── Load scheduled jobs ───────────────────────────────────────────────────────
function loadJobs() {
  if (!scheduledJobs.length) {
    document.getElementById('job-list').innerHTML = '<div class="loading-state">Fetching calendar...</div>';
    document.getElementById('map-overlay').style.display = 'flex';
    document.getElementById('header-count').textContent = '';
  }

  const fetchFrom = fmt(new Date());
  const fetchTo = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return fmt(d); })();
  return scriptGet(`getJobs&from=${fetchFrom}&to=${fetchTo}`)
    .then(data => {
      writeCache(JOBS_CACHE_KEY, data);
      applyJobsData(data, false);
      return true;
    })
    .catch(() => {
      if (!scheduledJobs.length) {
        document.getElementById('job-list').innerHTML = '<div class="no-results">Failed to load calendar.<br>Try refreshing.</div>';
        document.getElementById('map-overlay').style.display = 'none';
      }
      return false;
    });
}

function applyJobsData(data, fromCache) {
  scheduledJobs.forEach(j => { if (j._marker) j._marker.setMap(null); });
  scheduledJobs = data.jobs || [];
  scheduledJobs.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  scheduledJobs.forEach(j => { j._status = 'pending'; j._marker = null; j._iw = null; });
  fetchedDateRange = { from: data.fetchedFrom, to: data.fetchedTo };
  const ts = new Date(data.timestamp);
  document.getElementById('last-updated').textContent =
    `Updated ${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${fromCache ? ' (cached)' : ''}`;
  document.getElementById('map-overlay').style.display = 'none';
  renderList();
  geocodeScheduled();
}
 
function geocodeScheduled() {
  let delay = 0;
  scheduledJobs.forEach(job => {
    if (!job.addr) { job._status = 'error'; return; }
    const hit = geoCacheGet(job.addr);
    if (hit) {
      job._lat = hit.lat; job._lng = hit.lng; job._status = 'ok';
      buildScheduledMarker(job);
      return;
    }
    setTimeout(() => {
      geocodeAddress(job.addr, (ok, lat, lng, status) => {
        if (ok) {
          job._lat = lat; job._lng = lng; job._status = 'ok';
          buildScheduledMarker(job);
        } else { job._status = 'error'; job._geoError = status; }
        scheduleRender();
      });
    }, delay);
    delay += 120;
  });
  scheduleRender();
}

// ── Markers ───────────────────────────────────────────────────────────────────
function makeSVG(label, color, crew = [], textColor = '#1a1a1a') {
  const s = String(label);
  const fs = s.length > 2 ? '7' : s.length === 2 ? '9' : '11';
  // Refined shape: larger circular head (~60% of height), smooth tail taper
  const body = "M17 3C24.73 3 31 9.27 31 17C31 23.5 28 28.5 22.8 31.6C21.5 34.5 19 40.5 17 45C15 40.5 12.5 34.5 11.2 31.6C6 28.5 3 23.5 3 17C3 9.27 9.27 3 17 3Z";
  let ring = '';
  if (crew.length > 0) {
    const r = 11;
    const C = +(2 * Math.PI * r).toFixed(3);
    const gap = crew.length > 1 ? 3.5 : 0;
    const seg = +((C - crew.length * gap) / crew.length).toFixed(3);
    crew.forEach((name, i) => {
      const rot = +(-90 + (i * (seg + gap) / C) * 360).toFixed(2);
      ring += `<circle cx="17" cy="17" r="${r}" fill="none" stroke="${CREW_COLORS[name]||'#999'}" stroke-width="4.5" stroke-dasharray="${seg} ${+(C-seg).toFixed(3)}" transform="rotate(${rot} 17 17)" stroke-linecap="round"/>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="47" viewBox="0 0 34 47" overflow="visible">
    <defs>
      <filter id="sh" x="-50%" y="-20%" width="200%" height="160%">
        <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="rgba(0,0,0,0.35)"/>
      </filter>
      <radialGradient id="gl" cx="38%" cy="28%" r="65%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.38)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.22)"/>
      </radialGradient>
      <clipPath id="pc"><path d="${body}"/></clipPath>
    </defs>
    <path d="${body}" fill="${color}" filter="url(#sh)"/>
    <path d="${body}" fill="url(#gl)"/>
    <g clip-path="url(#pc)">${ring}</g>
    <circle cx="17" cy="17" r="9.5" fill="rgba(255,255,255,0.96)"/>
    <text x="17" y="21.5" text-anchor="middle" font-family="'DM Mono',monospace" font-size="${fs}" font-weight="700" fill="#1a1a1a">${s}</text>
  </svg>`;
}
function makeIcon(label, color, crew = [], textColor = '#1a1a1a') {
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(makeSVG(label, color, crew, textColor)),
    scaledSize: new google.maps.Size(34, 47),
    anchor: new google.maps.Point(17, 47)
  };
}
 
// Shared content builders — feed both the desktop InfoWindow and the
// mobile bottom-sheet job card so they never drift apart.
function scheduledCardHTML(job) {
  const dateStr = job.start === job.end ? fmtDate(job.start) : `${fmtDate(job.start)} – ${fmtDate(job.end)}`;
  const crew = job.crew || [];
  const crewChips = crew.length > 0
    ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${crew.map(n => `<span style="font-size:10px;font-weight:700;color:${CREW_COLORS[n]||'#555'};background:${CREW_COLORS[n]||'#999'}22;padding:2px 7px;border-radius:3px;border:1px solid ${CREW_COLORS[n]||'#999'}44">${n}</span>`).join('')}</div>`
    : '';
  return `<div style="font-family:'DM Sans',sans-serif;min-width:200px;padding:3px 0">
    <div style="font-size:10px;color:#aaa;font-weight:700;letter-spacing:.05em;font-family:'DM Mono',monospace">${escapeHtml(job.num)}</div>
    <div style="font-weight:700;font-size:13px;margin:3px 0;color:#1a1a1a">${escapeHtml(job.title)}</div>
    <div style="font-size:11px;color:#888;margin-bottom:5px">${escapeHtml(job.addr)}</div>
    <div style="font-size:11px;font-weight:600;color:${SCHED_PIN}">${escapeHtml(job.type.toUpperCase())} · ${escapeHtml(dateStr)}</div>
    ${crewChips}
  </div>`;
}
function unschedCardHTML(job) {
  const adminActions = isAdmin() ? `<div class="job-card-actions">
      <button onclick="closeJobCard();editUnsched('${escapeHtml(job.id)}')">✎ Edit</button>
      <button class="danger" onclick="closeJobCard();removeUnsched('${escapeHtml(job.id)}')">✕ Remove</button>
    </div>` : '';
  return `<div style="font-family:'DM Sans',sans-serif;min-width:200px;padding:3px 0">
    <div style="font-size:10px;color:#aaa;font-weight:700;letter-spacing:.05em;font-family:'DM Mono',monospace">${escapeHtml(job.job_num)}</div>
    <div style="font-weight:700;font-size:13px;margin:3px 0;color:#1a1a1a">${escapeHtml(job.title)}</div>
    <div style="font-size:11px;color:#888;margin-bottom:5px">${escapeHtml(job.address)}</div>
    <div style="font-size:11px;font-weight:600;color:${COLORS.unscheduled}">UNSCHEDULED · Added by ${escapeHtml(job.added_by || 'Unknown')}</div>
    ${adminActions}
  </div>`;
}

function buildScheduledMarker(job) {
  const color = SCHED_PIN;
  const crew = job.crew || [];
  const marker = new google.maps.Marker({
    position: { lat: job._lat, lng: job._lng }, map,
    icon: makeIcon('•', color, crew, COLORS[job.type] || COLORS.install), title: `${job.num} — ${job.title}`, zIndex: 100
  });
  const iw = new google.maps.InfoWindow({ content: scheduledCardHTML(job) });
  marker.addListener('click', () => {
    if (isMobile()) {
      setMobileView('map');
      openJobCard(scheduledCardHTML(job));
    } else {
      if (infoWindowOpen) infoWindowOpen.close();
      iw.open(map, marker); infoWindowOpen = iw;
    }
    highlightItem('sched-' + scheduledJobs.indexOf(job));
  });
  job._marker = marker; job._iw = iw;
  scheduleRender();
}

function buildUnschedMarker(job, label) {
  const color = COLORS.unscheduled;
  const marker = new google.maps.Marker({
    position: { lat: job._lat, lng: job._lng }, map,
    icon: makeIcon(label, color), title: `${job.job_num} — ${job.title}`, zIndex: 200
  });
  const iw = new google.maps.InfoWindow({ content: unschedCardHTML(job) });
  marker.addListener('click', () => {
    if (isMobile()) {
      setMobileView('map');
      openJobCard(unschedCardHTML(job));
    } else {
      if (infoWindowOpen) infoWindowOpen.close();
      iw.open(map, marker); infoWindowOpen = iw;
    }
    highlightItem('unsched-' + unscheduledJobs.indexOf(job));
  });
  job._marker = marker; job._iw = iw;
}
 
// ── Day navigation ────────────────────────────────────────────────────────────
// Custom range calendar — tap a day to start, tap again to set the range.
// Tapping the same day twice collapses the range to that single day.
let calMonth = null, calPickStart = null;
function openCalendar() {
  const from = document.getElementById('date-from').value || fmt(new Date());
  calPickStart = null;
  const [y, m, d] = from.split('-').map(Number);
  calMonth = new Date(y, m - 1, d);
  renderCalendar();
  document.getElementById('calendar-backdrop').classList.add('show');
  document.getElementById('calendar-panel').classList.add('show');
}
function closeCalendar() {
  document.getElementById('calendar-backdrop').classList.remove('show');
  document.getElementById('calendar-panel').classList.remove('show');
}
function shiftCalendarMonth(delta) {
  calMonth.setMonth(calMonth.getMonth() + delta);
  renderCalendar();
}
function jumpCalendarToday() {
  calMonth = new Date();
  renderCalendar();
}
function renderCalendar() {
  document.getElementById('calendar-month-label').textContent =
    calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  const todayStr = fmt(new Date());
  const year = calMonth.getFullYear(), month = calMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = fmt(new Date(year, month, d));
    const classes = ['calendar-day'];
    if (dateStr === todayStr) classes.push('today');
    if (calPickStart) {
      if (dateStr === calPickStart) classes.push('range-start', 'range-end');
    } else if (from && to) {
      if (dateStr === from) classes.push('range-start');
      if (dateStr === to) classes.push('range-end');
      if (dateStr > from && dateStr < to) classes.push('in-range');
    }
    cells.push(`<button class="${classes.join(' ')}" onclick="pickCalendarDay('${dateStr}')">${d}</button>`);
  }
  document.getElementById('calendar-grid').innerHTML = cells.join('');
}
function pickCalendarDay(dateStr) {
  if (!calPickStart) {
    calPickStart = dateStr;
    renderCalendar();
    return;
  }
  let from = calPickStart, to = dateStr;
  if (to < from) { [from, to] = [to, from]; }
  document.getElementById('date-from').value = from;
  document.getElementById('date-to').value = to;
  calPickStart = null;
  applyFilters();
  closeCalendar();
}
function shiftDay(delta) {
  const from = document.getElementById('date-from').value;
  const d = new Date(from + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const s = fmt(d);
  document.getElementById('date-from').value = s;
  document.getElementById('date-to').value = s;
  applyFilters();
}
function goToday() {
  const s = fmt(new Date());
  document.getElementById('date-from').value = s;
  document.getElementById('date-to').value = s;
  applyFilters();
}
function updateDayNav() {
  const btn = document.getElementById('day-nav-label');
  if (!btn) return;
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  const todayStr = fmt(new Date());
  if (from === to) {
    btn.textContent = from === todayStr ? 'Today' : fmtDate(from);
  } else {
    btn.textContent = `${fmtDate(from)} – ${fmtDate(to)}`;
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  updateDayNav();
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  const warn = document.getElementById('date-warn');
  if (warn) warn.style.display = (fetchedDateRange && (from < fetchedDateRange.from || to > fetchedDateRange.to)) ? 'block' : 'none';
  scheduledJobs.forEach(j => { if (j._marker) j._marker.setVisible(false); });
  unscheduledJobs.forEach(j => { if (j._marker) j._marker.setVisible(false); });
  if (activeTypes.has('unscheduled')) {
    unscheduledJobs.forEach((job, i) => {
      if (job._marker && job._status === 'ok') {
        job._marker.setIcon(makeIcon('U' + (i + 1), COLORS.unscheduled));
        job._marker.setVisible(true);
      }
    });
  }
  let n = 0;
  scheduledJobs.forEach(job => {
    const crew = job.crew || [];
    const crewOk = crew.length === 0 || crew.some(nm => activeCrews.has(nm));
    const show = activeTypes.has(job.type) && job.start <= to && job.end >= from && job._status === 'ok' && crewOk;
    if (job._marker) {
      if (show) {
        n++; job._visLabel = n;
        job._marker.setIcon(makeIcon(n, SCHED_PIN, crew, COLORS[job.type] || COLORS.install));
        job._marker.setZIndex(n);
        job._marker.setVisible(true);
      } else {
        job._visLabel = null;
        job._marker.setVisible(false);
      }
    }
  });
  renderList(); updateCount();
}

function getVisibleScheduled() {
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  return scheduledJobs.filter(j => {
    const crew = j.crew || [];
    const crewOk = crew.length === 0 || crew.some(nm => activeCrews.has(nm));
    return activeTypes.has(j.type) && j.start <= to && j.end >= from && crewOk;
  });
}
 
function resetFilters() {
  const today = new Date();
  document.getElementById('date-from').value = fmt(today);
  document.getElementById('date-to').value = fmt(today);
  activeTypes.add('install'); activeTypes.add('service'); activeTypes.add('excavation'); activeTypes.add('unscheduled');
  updateButtons();
  document.getElementById('unsched-add').classList.toggle('visible', isAdmin());
  searchQuery = '';
  document.getElementById('job-search').value = '';
  const ms = document.getElementById('job-search-mobile');
  if (ms) ms.value = '';
  CREW.forEach(n => activeCrews.add(n));
  updateCrewButtons();
  applyFilters();
}
 

// ── Render list ───────────────────────────────────────────────────────────────
function renderList() {
  const list = document.getElementById('job-list');
  const rows = [];
  const q = searchQuery.toLowerCase();
  if (activeTypes.has('unscheduled')) {
    unscheduledJobs.forEach((job, i) => {
      if (q && !String(job.job_num).toLowerCase().includes(q) && !job.title.toLowerCase().includes(q)) return;
      const sc = job._status === 'pending' ? 'pending' : job._status === 'error' ? 'error' : 'unscheduled';
      const errText = job._status === 'error'
        ? `<div class="geo-error-text">${GEO_ERRORS[job._geoError] || 'Geocode failed'} <button class="btn-retry" onclick="event.stopPropagation();retryGeocodeUnsched('${job.id}')" title="Retry">↺</button></div>`
        : '';
      rows.push(`<div class="job-item" id="item-unsched-${i}" onclick="focusUnsched('${job.id}')">
        <div class="pin-badge ${sc}">U${i + 1}</div>
        <div class="job-info">
          <div class="job-num">${escapeHtml(job.job_num)}</div>
          <div class="job-title">${escapeHtml(job.title)}</div>
          <div class="job-addr">${escapeHtml(job.address)}</div>
          <div class="job-meta">
            <span class="badge unscheduled">unscheduled</span>
            <span class="added-by">Added by ${escapeHtml(job.added_by || 'Unknown')}</span>
          </div>
          ${errText}
        </div>
        ${isAdmin() ? `<button class="btn-edit" onclick="event.stopPropagation();editUnsched('${escapeHtml(job.id)}')" title="Edit">✎</button>
        <button class="btn-remove" onclick="event.stopPropagation();removeUnsched('${escapeHtml(job.id)}')" title="Remove">✕</button>` : ''}
      </div>`);
    });
  }
  let n = 0;
  getVisibleScheduled().forEach(job => {
    if (q && !String(job.num).toLowerCase().includes(q) && !job.title.toLowerCase().includes(q)) return;
    const sc = job._status === 'pending' ? 'pending' : job._status === 'error' ? 'error' : job.type;
    const dateStr = job.start === job.end ? fmtDate(job.start) : `${fmtDate(job.start)} – ${fmtDate(job.end)}`;
    const label = job._status === 'ok' ? ++n : '–';
    const idx = scheduledJobs.indexOf(job);
    const errText = job._status === 'error'
      ? `<div class="geo-error-text">${GEO_ERRORS[job._geoError] || 'Geocode failed'} <button class="btn-retry" onclick="event.stopPropagation();retryGeocodeScheduled(${idx})" title="Retry">↺</button></div>`
      : '';
    rows.push(`<div class="job-item" id="item-sched-${idx}" onclick="focusJob(${idx})">
      <div class="pin-badge ${sc}">${label}</div>
      <div class="job-info">
        <div class="job-num">${escapeHtml(job.num || '—')}</div>
        <div class="job-title">${escapeHtml(job.title)}</div>
        <div class="job-addr">${escapeHtml(job.addr)}</div>
        <div class="job-meta"><span class="badge ${job.type}">${job.type}</span>${dateStr}</div>
        ${(job.crew||[]).length>0?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${(job.crew||[]).map(n=>`<span style="font-size:10px;font-weight:700;color:${CREW_COLORS[n]||'#555'};background:${CREW_COLORS[n]||'#999'}22;padding:2px 7px;border-radius:3px;border:1px solid ${CREW_COLORS[n]||'#999'}55">${n}</span>`).join('')}</div>`:''}
        ${errText}
      </div>
    </div>`);
  });
  list.innerHTML = rows.length ? rows.join('') : '<div class="no-results">No jobs match current filters</div>';
}
 
function focusJob(idx) {
  const job = scheduledJobs[idx];
  if (!job._marker || !job._marker.getVisible()) return;
  map.panTo({ lat: job._lat, lng: job._lng }); map.setZoom(14);
  if (isMobile()) {
    setMobileView('map');
    openJobCard(scheduledCardHTML(job));
  } else {
    if (infoWindowOpen) infoWindowOpen.close();
    job._iw.open(map, job._marker); infoWindowOpen = job._iw;
  }
  highlightItem('sched-' + idx);
}
 
// ── Unscheduled ───────────────────────────────────────────────────────────────
function loadUnscheduled() {
  return scriptGet('getUnsched')
    .then(data => {
      writeCache(UNSCHED_CACHE_KEY, data);
      applyUnschedData(data);
      return true;
    })
    .catch(err => {
      console.error('Failed to load unscheduled:', err);
      return false;
    });
}

function applyUnschedData(data) {
  unscheduledJobs.forEach(j => { if (j._marker) j._marker.setMap(null); });
  unscheduledJobs = data.jobs || [];
  unscheduledJobs.forEach(j => { j._status = 'pending'; j._marker = null; j._iw = null; });
  renderList();
  geocodeUnscheduled();
}
 
function geocodeUnscheduled() {
  let delay = 0;
  unscheduledJobs.forEach((job, i) => {
    const hit = geoCacheGet(job.address);
    if (hit) {
      job._lat = hit.lat; job._lng = hit.lng; job._status = 'ok';
      buildUnschedMarker(job, 'U' + (i + 1));
      return;
    }
    setTimeout(() => {
      geocodeAddress(job.address, (ok, lat, lng, status) => {
        if (ok) {
          job._lat = lat; job._lng = lng; job._status = 'ok';
          buildUnschedMarker(job, 'U' + (i + 1));
        } else { job._status = 'error'; job._geoError = status; }
        scheduleRender();
      });
    }, delay);
    delay += 120;
  });
  scheduleRender();
}
 
function addUnscheduled() {
  if (!isAdmin()) return;
  const num = document.getElementById('u-num').value.trim();
  const title = document.getElementById('u-title').value.trim();
  const addr = document.getElementById('u-addr').value.trim();
  if (!num || !addr) { alert('Job number and address are required.'); return; }

  document.getElementById('u-num').value = '';
  document.getElementById('u-title').value = '';
  document.getElementById('u-addr').value = '';
  document.getElementById('u-num').focus();
  closeAddModal();

  // Optimistic insert: show the job (and geocode it) immediately, reconcile with the server in the background.
  const job = {
    id: 'temp-' + Date.now(), job_num: num, title: title || num, address: addr,
    added_by: currentUser, added: new Date().toISOString(), _status: 'pending', _marker: null, _iw: null,
  };
  unscheduledJobs.push(job);
  renderList();
  const hit = geoCacheGet(addr);
  if (hit) {
    job._lat = hit.lat; job._lng = hit.lng; job._status = 'ok';
    buildUnschedMarker(job, 'U' + (unscheduledJobs.indexOf(job) + 1));
  } else {
    geocodeAddress(addr, (ok, lat, lng, status) => {
      if (ok) {
        job._lat = lat; job._lng = lng; job._status = 'ok';
        buildUnschedMarker(job, 'U' + (unscheduledJobs.indexOf(job) + 1));
      } else { job._status = 'error'; job._geoError = status; }
      scheduleRender();
    });
  }

  scriptPost({ action: 'addUnsched', job_num: num, title: title || num, address: addr, added_by: currentUser })
    .then(data => {
      if (!data || data.error || data.success === false) throw new Error(data && data.error || 'Save failed');
      job.id = String(data.id);
      if (job._iw) job._iw.setContent(unschedCardHTML(job));
      writeCache(UNSCHED_CACHE_KEY, { jobs: unscheduledJobs });
      renderList();
    })
    .catch(err => {
      if (job._marker) job._marker.setMap(null);
      unscheduledJobs = unscheduledJobs.filter(j => j !== job);
      renderList();
      alert('Failed to save. Try again.\n' + (err && err.message ? err.message : ''));
    });
}

function removeUnsched(id) {
  if (!isAdmin()) return;
  const job = unscheduledJobs.find(j => String(j.id) === String(id));
  if (!job) return;
  const idx = unscheduledJobs.indexOf(job);

  // Optimistic removal: hide it immediately, roll back if the server call fails.
  if (job._marker) job._marker.setMap(null);
  unscheduledJobs = unscheduledJobs.filter(j => j !== job);
  writeCache(UNSCHED_CACHE_KEY, { jobs: unscheduledJobs });
  renderList();

  scriptPost({ action: 'removeUnsched', id })
    .then(data => {
      if (data && data.success === false) throw new Error(data.error || 'Row not found');
    })
    .catch(err => {
      unscheduledJobs.splice(idx, 0, job);
      if (job._lat != null && job._lng != null) buildUnschedMarker(job, 'U' + (unscheduledJobs.indexOf(job) + 1));
      writeCache(UNSCHED_CACHE_KEY, { jobs: unscheduledJobs });
      renderList();
      alert('Failed to remove. Try again.\n' + (err && err.message ? err.message : ''));
    });
}
 
function focusUnsched(id) {
  const job = unscheduledJobs.find(j => String(j.id) === String(id));
  if (!job || !job._marker) return;
  map.panTo({ lat: job._lat, lng: job._lng }); map.setZoom(14);
  if (isMobile()) {
    setMobileView('map');
    openJobCard(unschedCardHTML(job));
  } else {
    if (infoWindowOpen) infoWindowOpen.close();
    job._iw.open(map, job._marker); infoWindowOpen = job._iw;
  }
  highlightItem('unsched-' + unscheduledJobs.indexOf(job));
}

function highlightItem(id) {
  document.querySelectorAll('.job-item').forEach(el => el.classList.remove('highlighted'));
  const el = document.getElementById('item-' + id);
  if (el) { el.classList.add('highlighted'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}
 
function fitVisible() {
  const bounds = new google.maps.LatLngBounds(); let any = false;
  scheduledJobs.forEach(j => { if (j._marker && j._marker.getVisible()) { bounds.extend({ lat: j._lat, lng: j._lng }); any = true; } });
  unscheduledJobs.forEach(j => { if (j._marker && j._marker.getVisible()) { bounds.extend({ lat: j._lat, lng: j._lng }); any = true; } });
  if (any) map.fitBounds(bounds);
}
 
function updateCount() {
  const sched = getVisibleScheduled().filter(j => j._status === 'ok').length;
  const unsched = activeTypes.has('unscheduled') ? unscheduledJobs.filter(j => j._status === 'ok').length : 0;
  const total = sched + unsched;
  document.getElementById('header-count').textContent = `${total} job${total !== 1 ? 's' : ''} shown`;
  const badge = document.getElementById('mobile-tab-badge');
  if (badge) badge.textContent = total;
}
 
document.addEventListener('keydown', e => {
  if (document.getElementById('app').style.display === 'none') return;
  if (e.key === 'Enter' && ['u-num', 'u-title', 'u-addr'].includes(document.activeElement?.id)) submitUnschedForm();
  if (e.key === 'Escape' && editingId !== null) cancelEdit();
});

// ── Crew filters ─────────────────────────────────────────────────────────────
function crewTextColor(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (0.299*r + 0.587*g + 0.114*b) > 140 ? '#1a1a1a' : '#fff';
}
function initCrewButtons() {
  [['crew-btns', 'crew-btn-'], ['map-crew-btns', 'map-crew-btn-']].forEach(([containerId, prefix]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = CREW.map(name => {
      const cc = CREW_COLORS[name], ct = crewTextColor(cc);
      return `<button class="crew-btn on" id="${prefix}${name}" onclick="toggleCrew('${name}')" style="--cc:${cc};--ct:${ct}" title="${name}">${name}</button>`;
    }).join('');
  });
}

function toggleCrew(name) {
  if (activeCrews.has(name)) {
    if (activeCrews.size === 1) return;
    activeCrews.delete(name);
  } else {
    activeCrews.add(name);
  }
  updateCrewButtons();
  applyFilters();
}

function updateCrewButtons() {
  CREW.forEach(name => {
    ['crew-btn-', 'map-crew-btn-'].forEach(prefix => {
      const btn = document.getElementById(prefix + name);
      if (btn) activeCrews.has(name) ? btn.classList.add('on') : btn.classList.remove('on');
    });
  });
}

// ── Geocode retry ─────────────────────────────────────────────────────────────
function retryGeocodeScheduled(idx) {
  const job = scheduledJobs[idx];
  if (!job) return;
  job._status = 'pending'; job._geoError = null;
  renderList();
  geocodeAddress(job.addr, (ok, lat, lng, status) => {
    if (ok) {
      job._lat = lat; job._lng = lng; job._status = 'ok';
      buildScheduledMarker(job);
    } else { job._status = 'error'; job._geoError = status; }
    renderList(); updateCount();
  });
}

function retryGeocodeUnsched(id) {
  const job = unscheduledJobs.find(j => String(j.id) === String(id));
  if (!job) return;
  job._status = 'pending'; job._geoError = null;
  renderList();
  geocodeAddress(job.address, (ok, lat, lng, status) => {
    if (ok) {
      job._lat = lat; job._lng = lng; job._status = 'ok';
      buildUnschedMarker(job, 'U' + (unscheduledJobs.indexOf(job) + 1));
    } else { job._status = 'error'; job._geoError = status; }
    renderList(); updateCount();
  });
}

// ── Edit unscheduled ──────────────────────────────────────────────────────────
function submitUnschedForm() {
  editingId !== null ? saveUnschedEdit() : addUnscheduled();
}

function editUnsched(id) {
  if (!isAdmin()) return;
  const job = unscheduledJobs.find(j => String(j.id) === String(id));
  if (!job) return;
  editingId = id;
  document.getElementById('u-num').value = job.job_num;
  document.getElementById('u-title').value = job.title;
  document.getElementById('u-addr').value = job.address;
  document.getElementById('add-btn').textContent = 'Save Changes';
  document.querySelector('.add-form-label').textContent = 'Edit Unscheduled Job';
  document.getElementById('cancel-edit-btn').style.display = 'block';
  if (isMobile()) {
    openAddModal();
  } else {
    document.getElementById('unsched-add').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('u-num').focus();
  }
}

function cancelEdit() {
  editingId = null;
  document.getElementById('u-num').value = '';
  document.getElementById('u-title').value = '';
  document.getElementById('u-addr').value = '';
  document.getElementById('add-btn').textContent = '+ Add to map';
  document.querySelector('.add-form-label').textContent = 'Add Unscheduled Job';
  document.getElementById('cancel-edit-btn').style.display = 'none';
}

function saveUnschedEdit() {
  const num = document.getElementById('u-num').value.trim();
  const title = document.getElementById('u-title').value.trim();
  const addr = document.getElementById('u-addr').value.trim();
  if (!num || !addr) { alert('Job number and address are required.'); return; }
  const btn = document.getElementById('add-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  scriptPost({ action: 'updateUnsched', id: editingId, job_num: num, title: title || num, address: addr })
    .then(result => { if (!result || result.error || result.success === false) throw new Error(result && result.error || 'Save failed'); cancelEdit(); closeAddModal(); loadUnscheduled(); })
    .catch(() => { btn.disabled = false; btn.textContent = 'Save Changes'; alert('Failed to save. Try again.'); });
}

// ── Pull-to-refresh ──────────────────────────────────────────────────────────
(function setupPullToRefresh() {
  const list = document.getElementById('job-list');
  const indicator = document.getElementById('pull-indicator');
  const THRESHOLD = 64;
  let startY = null, pulling = false, refreshing = false;

  list.addEventListener('touchstart', e => {
    if (refreshing) return;
    pulling = list.scrollTop <= 0;
    startY = pulling ? e.touches[0].clientY : null;
  }, { passive: true });

  list.addEventListener('touchmove', e => {
    if (!pulling || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { indicator.style.height = '0px'; indicator.classList.remove('armed'); return; }
    const dist = Math.min(dy * 0.5, 90);
    indicator.style.height = dist + 'px';
    indicator.classList.toggle('armed', dist >= THRESHOLD);
  }, { passive: true });

  list.addEventListener('touchend', () => {
    if (!pulling || refreshing) { pulling = false; return; }
    const armed = indicator.classList.contains('armed');
    pulling = false;
    if (!armed) { indicator.style.height = '0px'; return; }
    refreshing = true;
    indicator.classList.remove('armed');
    indicator.classList.add('spinning');
    indicator.style.height = '40px';
    refreshAll().finally(() => {
      refreshing = false;
      indicator.classList.remove('spinning');
      indicator.style.height = '0px';
    });
  }, { passive: true });
})();

// ── Auto-login ────────────────────────────────────────────────────────────────
// Saved session skips the PIN screen; the token is validated server-side on
// the first fetch and an expired one bounces back to the PIN screen
if (auth && auth.token) enterApp();