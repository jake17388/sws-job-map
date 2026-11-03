// ── Squarecoil estimate labor ────────────────────────────────────────────────
// Credentials are stored only in Apps Script Script Properties. One login is
// reused for the whole KPI sync, and resolved job totals are cached for six
// hours so normal calendar refreshes do not repeatedly scrape Squarecoil.
const SQUARECOIL_ESTIMATE_BASE_URL = 'https://summitwestsigns.squarecoil.net';
const SQUARECOIL_ESTIMATE_BATCH_SIZE = 15;
const SQUARECOIL_ESTIMATE_CACHE_SECONDS = 21600;

function squarecoilEstimateCredentials_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    username: properties.getProperty('SQUARECOIL_USERNAME') || '',
    password: properties.getProperty('SQUARECOIL_PASSWORD') || '',
  };
}

function isSquarecoilEstimateConfigured_() {
  const credentials = squarecoilEstimateCredentials_();
  return !!(credentials.username && credentials.password);
}

function squarecoilEstimateConnectionStatus_() {
  return { configured: isSquarecoilEstimateConfigured_() };
}

function saveSquarecoilEstimateCredentials_(usernameValue, passwordValue) {
  const username = String(usernameValue || '').trim();
  const password = String(passwordValue || '');
  if (!username || !password) {
    return {
      success: false,
      configured: false,
      error: 'Enter both the Squarecoil username and password.',
    };
  }
  try {
    squarecoilEstimateLogin_(username, password);
  } catch (error) {
    return {
      success: false,
      configured: false,
      error: 'Squarecoil rejected the credentials. Check the username and password.',
    };
  }
  PropertiesService.getScriptProperties().setProperties({
    SQUARECOIL_USERNAME: username,
    SQUARECOIL_PASSWORD: password,
  }, false);
  return { success: true, configured: true };
}

function squarecoilEstimateResponseHeader_(response, name) {
  const headers = response.getAllHeaders ? response.getAllHeaders() : response.getHeaders();
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers || {}).find(header => String(header).toLowerCase() === wanted);
  return key ? headers[key] : '';
}

function squarecoilEstimateMergeCookies_(currentCookie, response) {
  const merged = {};
  String(currentCookie || '').split(/;\s*/).forEach(pair => {
    const equals = pair.indexOf('=');
    if (equals > 0) merged[pair.slice(0, equals).trim()] = pair.slice(equals + 1).trim();
  });
  const raw = squarecoilEstimateResponseHeader_(response, 'Set-Cookie');
  const cookies = Array.isArray(raw) ? raw : String(raw || '').split(/,(?=\s*[^;,=\s]+=)/);
  cookies.forEach(cookie => {
    const match = String(cookie).match(/^\s*([^=;,\s]+)=([^;]*)/);
    if (match) merged[match[1]] = match[2];
  });
  return Object.keys(merged).map(key => `${key}=${merged[key]}`).join('; ');
}

function squarecoilEstimateUrl_(path) {
  const value = String(path || '');
  if (/^https:\/\//i.test(value)) return value;
  return `${SQUARECOIL_ESTIMATE_BASE_URL}/${value.replace(/^\/+/, '')}`;
}

function squarecoilEstimateGet_(path, cookie) {
  return UrlFetchApp.fetch(squarecoilEstimateUrl_(path), {
    method: 'get',
    headers: {
      Cookie: cookie,
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; SWS-Job-Map/1.0)',
    },
    followRedirects: false,
    muteHttpExceptions: true,
  });
}

function squarecoilEstimateNeedsSequentialRetry_(response) {
  if (!response || response.getResponseCode() !== 200) return true;
  return /<form[^>]+action=["']login\.php/i.test(response.getContentText());
}

function squarecoilEstimateGetBatch_(paths, cookie) {
  const results = [];
  for (let index = 0; index < paths.length; index += SQUARECOIL_ESTIMATE_BATCH_SIZE) {
    const chunk = paths.slice(index, index + SQUARECOIL_ESTIMATE_BATCH_SIZE);
    const requests = chunk.map(path => ({
      url: squarecoilEstimateUrl_(path),
      method: 'get',
      headers: {
        Cookie: cookie,
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; SWS-Job-Map/1.0)',
      },
      followRedirects: false,
      muteHttpExceptions: true,
    }));
    let responses;
    try { responses = UrlFetchApp.fetchAll(requests); }
    catch (error) { responses = chunk.map(() => null); }
    responses.forEach((response, responseIndex) => {
      if (squarecoilEstimateNeedsSequentialRetry_(response)) {
        try { response = squarecoilEstimateGet_(chunk[responseIndex], cookie); }
        catch (error) { response = null; }
      }
      results.push(response);
    });
  }
  return results;
}

function squarecoilEstimateLogin_(username, password) {
  const initial = UrlFetchApp.fetch(`${SQUARECOIL_ESTIMATE_BASE_URL}/login.php`, {
    method: 'get',
    followRedirects: false,
    muteHttpExceptions: true,
  });
  let cookie = squarecoilEstimateMergeCookies_('', initial);
  const login = UrlFetchApp.fetch(`${SQUARECOIL_ESTIMATE_BASE_URL}/login.php`, {
    method: 'post',
    payload: {
      action: '1', username, password,
      latlong: '', latlong_error: '', latitude: '', longitude: '',
    },
    headers: {
      Cookie: cookie,
      'User-Agent': 'Mozilla/5.0 (compatible; SWS-Job-Map/1.0)',
    },
    followRedirects: false,
    muteHttpExceptions: true,
  });
  cookie = squarecoilEstimateMergeCookies_(cookie, login);
  const code = login.getResponseCode();
  const location = squarecoilEstimateResponseHeader_(login, 'Location');
  const authenticated = code >= 300 && code < 400 && location
    ? squarecoilEstimateGet_(location, cookie)
    : login;
  cookie = squarecoilEstimateMergeCookies_(cookie, authenticated);
  const html = authenticated.getContentText();
  if (authenticated.getResponseCode() !== 200
      || /<form[^>]+action=["']login\.php/i.test(html)
      || !/(?:dashboard\.php|project\.php)/i.test(html)) {
    throw new Error('Squarecoil rejected the login or changed its login flow');
  }
  return cookie;
}

function squarecoilDecodeTextForKpi_(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|#0*38|#x0*26);/gi, '&')
    .replace(/&(quot|#0*34|#x0*22);/gi, '"')
    .replace(/&(#0*39|#x0*27);/gi, "'")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function squarecoilEstimateIdsFromHtml_(html, jobNum) {
  const normalized = String(html || '').replace(/&amp;/gi, '&');
  const estimateIds = [];
  const seen = new Set();
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = hrefPattern.exec(normalized))) {
    const href = match[1] || match[2] || match[3] || '';
    if (!/project_estimates\.php\?/i.test(href)) continue;
    const projectId = (href.match(/[?&]id=(\d+)/i) || [])[1] || '';
    const estimateId = (href.match(/[?&]estimateid=(\d+)/i) || [])[1] || '';
    if (projectId !== String(jobNum) || !estimateId || seen.has(estimateId)) continue;
    seen.add(estimateId);
    estimateIds.push(estimateId);
  }
  return estimateIds;
}

function squarecoilTableRowsForKpi_(tableHtml) {
  return (String(tableHtml || '').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []).map(row => (
    (row.match(/<(?:th|td)\b[^>]*>[\s\S]*?<\/(?:th|td)>/gi) || [])
      .map(cell => squarecoilDecodeTextForKpi_(cell))
  ));
}

function squarecoilIsInstallLaborLabel_(value) {
  const label = String(value || '').toLowerCase().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  return /^install(?:ation)?(?:\b|\s*\()/.test(label) || label === 'loading / unloading';
}

function squarecoilInstallHoursFromEstimateHtml_(html) {
  const tables = String(html || '').match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const rows = squarecoilTableRowsForKpi_(tables[tableIndex]);
    const headerIndex = rows.findIndex(row => {
      const labels = row.map(cell => cell.toLowerCase());
      return labels.includes('description') && labels.includes('notes') && labels.includes('hours');
    });
    if (headerIndex === -1) continue;
    const header = rows[headerIndex].map(cell => cell.toLowerCase());
    const descriptionIndex = header.indexOf('description');
    const hoursIndex = header.indexOf('hours');
    return rows.slice(headerIndex + 1).reduce((total, row) => {
      if (!squarecoilIsInstallLaborLabel_(row[descriptionIndex])) return total;
      const hours = Number(String(row[hoursIndex] || '').replace(/,/g, ''));
      return Number.isFinite(hours) ? total + hours : total;
    }, 0);
  }
  return null;
}

function squarecoilEstimateCache_() {
  if (typeof CacheService === 'undefined') return null;
  try { return CacheService.getScriptCache(); }
  catch (error) { return null; }
}

function squarecoilEstimateCacheKey_(jobNum) {
  return `squarecoil_install_hours_v1_${jobNum}`;
}

function squarecoilInstallHoursByJob_(jobNums, forceRefresh) {
  const unique = Array.from(new Set((jobNums || [])
    .map(value => String(value || '').trim())
    .filter(value => /^\d{5,6}$/.test(value))));
  const totals = new Map();
  const cache = squarecoilEstimateCache_();
  const missing = [];
  unique.forEach(jobNum => {
    let cached = null;
    if (!forceRefresh && cache) {
      try { cached = cache.get(squarecoilEstimateCacheKey_(jobNum)); }
      catch (error) { cached = null; }
    }
    if (cached != null && cached !== '' && Number.isFinite(Number(cached))) totals.set(jobNum, Number(cached));
    else missing.push(jobNum);
  });
  if (!missing.length) return totals;

  const credentials = squarecoilEstimateCredentials_();
  if (!credentials.username || !credentials.password) return totals;
  const cookie = squarecoilEstimateLogin_(credentials.username, credentials.password);
  const listResponses = squarecoilEstimateGetBatch_(
    missing.map(jobNum => `project_estimates.php?id=${encodeURIComponent(jobNum)}`),
    cookie,
  );
  const details = [];
  const state = {};
  missing.forEach((jobNum, index) => {
    const response = listResponses[index];
    if (!response || response.getResponseCode() !== 200) return;
    const estimateIds = squarecoilEstimateIdsFromHtml_(response.getContentText(), jobNum);
    state[jobNum] = { total: 0, failed: false, expected: estimateIds.length };
    estimateIds.forEach(estimateId => details.push({ jobNum, estimateId }));
  });
  const detailResponses = squarecoilEstimateGetBatch_(details.map(item => (
    `project_estimates.php?id=${encodeURIComponent(item.jobNum)}&estimateid=${encodeURIComponent(item.estimateId)}`
  )), cookie);
  details.forEach((item, index) => {
    const response = detailResponses[index];
    const jobState = state[item.jobNum];
    if (!response || response.getResponseCode() !== 200) {
      jobState.failed = true;
      return;
    }
    const hours = squarecoilInstallHoursFromEstimateHtml_(response.getContentText());
    if (hours == null) jobState.failed = true;
    else jobState.total += hours;
  });
  Object.keys(state).forEach(jobNum => {
    const jobState = state[jobNum];
    if (jobState.failed) return;
    const total = Math.round(jobState.total * 100) / 100;
    totals.set(jobNum, total);
    if (cache) {
      try { cache.put(squarecoilEstimateCacheKey_(jobNum), String(total), SQUARECOIL_ESTIMATE_CACHE_SECONDS); }
      catch (error) { /* the live result remains usable */ }
    }
  });
  return totals;
}
