const TAG_RE = /<div\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bgroup\/vehicle\b[^'"]*\1[^>]*>/gi;

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

export function parseSurecamVehicles(html, updatedAt = new Date().toISOString()) {
  const tags = html.match(TAG_RE) || [];
  return tags.flatMap(tag => {
    const src = attr(tag, 'data-live-device-details-src');
    const deviceId = (src.match(/\/accounts\/[^\/]+\/live\/([0-9a-f-]+)/i) || [])[1];
    const lat = Number(attr(tag, 'data-latitude'));
    const lng = Number(attr(tag, 'data-longitude'));
    if (!deviceId || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      deviceId,
      name: attr(tag, 'data-label') || deviceId,
      status: attr(tag, 'data-status') || 'unknown',
      lat,
      lng,
      updatedAt,
    }];
  });
}

export function selectTrackedVehicles(vehicles, trackedIds) {
  return vehicles.filter(vehicle => trackedIds.has(vehicle.deviceId));
}

export async function postJsonWithRetry(url, payload, options = {}) {
  const attempts = options.attempts || 3;
  const delayMs = options.delayMs ?? 5000;
  const fetchImpl = options.fetchImpl || fetch;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const body = await response.text();
      let data;
      try { data = JSON.parse(body); }
      catch { throw new Error(`HTTP ${response.status}: non-JSON response (${body.slice(0, 80)})`); }
      if (!response.ok || !data.success) {
        throw new Error(`HTTP ${response.status}: ${data.error || 'sync rejected'}`);
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Snapshot delivery failed after ${attempts} attempts: ${lastError.message}`);
}
