import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const routing = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../Code.js', import.meta.url), 'utf8');

test('the deployed map uses Leaflet and OpenStreetMap without a Google API key', () => {
  assert.doesNotMatch(html, /maps\.googleapis\.com|AIza[\w-]+/);
  assert.match(template, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
  assert.match(template, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(frontend, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(frontend, /&copy; OpenStreetMap contributors/);
});

test('the authenticated backend route owns Census geocoding', () => {
  assert.match(routing, /action === 'geocode'/);
  assert.match(routing, /if \(!actor\) return json\(UNAUTHORIZED\)/);
  assert.match(routing, /geocodeAddress_\(params\.address\)/);
  assert.match(backend, /geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress/);
});

function makeGeocoder(payload, statusCode = 200) {
  let fetches = 0;
  const values = new Map();
  const context = vm.createContext({
    JSON,
    Number,
    String,
    encodeURIComponent,
    CacheService: {
      getScriptCache: () => ({
        get: key => values.get(key) || null,
        put: (key, value) => values.set(key, value),
      }),
    },
    UrlFetchApp: {
      fetch: () => {
        fetches += 1;
        return {
          getResponseCode: () => statusCode,
          getContentText: () => JSON.stringify(payload),
        };
      },
    },
  });
  new vm.Script(backend, { filename: 'Code.js' }).runInContext(context);
  return {
    geocode: address => JSON.parse(JSON.stringify(
      vm.runInContext(`geocodeAddress_(${JSON.stringify(address)})`, context),
    )),
    fetchCount: () => fetches,
  };
}

test('Census matches are normalized and cached', () => {
  const service = makeGeocoder({
    result: {
      addressMatches: [{
        matchedAddress: '4049 E PRESIDIO ST, MESA, AZ, 85215',
        coordinates: { x: -111.7427, y: 33.4722 },
      }],
    },
  });

  assert.deepEqual(service.geocode('4049 E Presidio St, Mesa, AZ 85215'), {
    ok: true,
    lat: 33.4722,
    lng: -111.7427,
    matchedAddress: '4049 E PRESIDIO ST, MESA, AZ, 85215',
  });
  assert.equal(service.geocode(' 4049 E Presidio St, Mesa, AZ 85215 ').ok, true);
  assert.equal(service.fetchCount(), 1);
});

test('Census no-match and upstream failures become stable client errors', () => {
  const noMatch = makeGeocoder({ result: { addressMatches: [] } });
  assert.deepEqual(noMatch.geocode('Not a real address'), { ok: false, error: 'ZERO_RESULTS' });

  const unavailable = makeGeocoder({}, 503);
  assert.deepEqual(unavailable.geocode('4049 E Presidio St'), { ok: false, error: 'UPSTREAM_ERROR' });
});

test('blank geocoding requests are rejected without calling Census', () => {
  const service = makeGeocoder({ result: { addressMatches: [] } });
  assert.deepEqual(service.geocode('  '), { ok: false, error: 'INVALID_REQUEST' });
  assert.equal(service.fetchCount(), 0);
});
