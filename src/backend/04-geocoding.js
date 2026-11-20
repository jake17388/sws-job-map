// ── Free US address geocoding ────────────────────────────────────────────────
// The Census Geocoder is public and requires no API key. Results are cached in
// Apps Script so repeat lookups from different clients avoid unnecessary calls.
function geocodeAddress_(address) {
  const normalized = String(address || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { ok: false, error: 'INVALID_REQUEST' };

  const cache = CacheService.getScriptCache();
  const cacheKey = 'geocode:v2:' + normalized.toLowerCase().slice(0, 230);
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* fetch a fresh result */ }
  }

  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    + '?address=' + encodeURIComponent(normalized)
    + '&benchmark=Public_AR_Current&format=json';
  let result;
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' },
    });
    if (response.getResponseCode() !== 200) {
      result = { ok: false, error: 'UPSTREAM_ERROR' };
    } else {
      const payload = JSON.parse(response.getContentText());
      const match = payload && payload.result && payload.result.addressMatches
        ? payload.result.addressMatches[0]
        : null;
      const lat = match && match.coordinates ? Number(match.coordinates.y) : NaN;
      const lng = match && match.coordinates ? Number(match.coordinates.x) : NaN;
      result = Number.isFinite(lat) && Number.isFinite(lng)
        ? { ok: true, lat, lng, matchedAddress: match.matchedAddress || normalized }
        : { ok: false, error: 'ZERO_RESULTS' };
    }
  } catch (err) {
    result = { ok: false, error: 'UPSTREAM_ERROR' };
  }

  if (result.error === 'ZERO_RESULTS') {
    try {
      const payload = Maps.newGeocoder().setRegion('us').geocode(normalized);
      const match = payload && payload.results ? payload.results[0] : null;
      const location = match && match.geometry ? match.geometry.location : null;
      const lat = location ? Number(location.lat) : NaN;
      const lng = location ? Number(location.lng) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        result = {
          ok: true,
          lat,
          lng,
          matchedAddress: match.formatted_address || normalized,
        };
      }
    } catch (err) {
      // Keep the stable Census no-match response if the fallback is unavailable.
    }
  }

  cache.put(cacheKey, JSON.stringify(result), 21600);
  return result;
}
