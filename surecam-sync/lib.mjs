const TAG_RE = /<div class="group\/vehicle[^"]*"(?:\s+[a-zA-Z0-9_-]+(?:="[^"]*")?)*>/g;

export function parseSurecamVehicles(html, updatedAt = new Date().toISOString()) {
  const tags = html.match(TAG_RE) || [];
  return tags.flatMap(tag => {
    const deviceId = (tag.match(/data-live-device-details-src="\/accounts\/[^\/"]+\/live\/([0-9a-f-]+)"/) || [])[1];
    const lat = Number((tag.match(/data-latitude="(-?\d+\.\d+)"/) || [])[1]);
    const lng = Number((tag.match(/data-longitude="(-?\d+\.\d+)"/) || [])[1]);
    if (!deviceId || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      deviceId,
      name: (tag.match(/data-label="([^"]*)"/) || [])[1] || deviceId,
      status: (tag.match(/data-status="([^"]*)"/) || [])[1] || 'unknown',
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
