import assert from 'node:assert/strict';
import { parseSurecamVehicles, postJsonWithRetry, selectTrackedVehicles } from '../surecam-sync/lib.mjs';

const html = `
  <div class="group/vehicle row"
    data-live-device-details-src="/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f"
    data-latitude="33.4123" data-longitude="-111.9345"
    data-status="normal" data-label="Bucket Truck"></div>
  <div class="group/vehicle row"
    data-live-device-details-src="/accounts/01127/live/e6c84a15-6a26-4f5a-9f27-494dc3a15f9a"
    data-latitude="33.5000" data-longitude="-112.1000"
    data-status="park_mode" data-label="Flatbed"></div>`;

const vehicles = parseSurecamVehicles(html, '2026-08-13T12:00:00.000Z');
assert.equal(vehicles.length, 2);
assert.deepEqual(vehicles[0], {
  deviceId: '33bb8790-2acc-4ae5-9729-c6435152cf6f',
  name: 'Bucket Truck',
  status: 'normal',
  lat: 33.4123,
  lng: -111.9345,
  updatedAt: '2026-08-13T12:00:00.000Z',
});

let attempts = 0;
const result = await postJsonWithRetry('https://example.test/sync', { ok: true }, {
  attempts: 3,
  delayMs: 0,
  fetchImpl: async () => {
    attempts += 1;
    if (attempts === 1) return new Response('<!DOCTYPE html>Access denied', { status: 403 });
    return Response.json({ success: true });
  },
});
assert.equal(attempts, 2);
assert.deepEqual(result, { success: true });

assert.deepEqual(
  selectTrackedVehicles(vehicles, new Set(['e6c84a15-6a26-4f5a-9f27-494dc3a15f9a'])).map(v => v.deviceId),
  ['e6c84a15-6a26-4f5a-9f27-494dc3a15f9a'],
  'snapshot must exclude SureCam devices not configured for the Job Map',
);

const reorderedMarkup = `<div data-status='normal' data-label='Reordered Truck'
  class='row group/vehicle' data-longitude='-111.9'
  data-live-device-details-src='/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f'
  data-latitude='33.4'></div>`;
assert.equal(parseSurecamVehicles(reorderedMarkup, '2026-08-13T12:00:00.000Z').length, 1,
  'parser should tolerate attribute order and quote style changes');

const nonDivMarkup = `<li class="row group/vehicle" data-live-device-details-src="/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f"
  data-latitude="33.41" data-longitude="-111.93" data-status="idling" data-label="Bucket Truck"></li>`;
assert.equal(parseSurecamVehicles(nonDivMarkup, '2026-08-13T12:00:00.000Z').length, 1,
  'parser should accept the vehicle container regardless of its HTML element');

const stableAttributeMarkup = `<div data-live-device-details-src="/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f"
  data-latitude="33.42" data-longitude="-111.94" data-status="normal" data-label="Attribute Truck"></div>`;
assert.equal(parseSurecamVehicles(stableAttributeMarkup, '2026-08-13T12:00:00.000Z').length, 1,
  'parser should use the stable device-detail attribute when wrapper classes change');

const unquotedAttributeMarkup = `<div data-live-device-details-src=/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f
  data-latitude=33.43 data-longitude=-111.95 data-status=normal data-label="Unquoted Truck"></div>`;
assert.equal(parseSurecamVehicles(unquotedAttributeMarkup, '2026-08-13T12:00:00.000Z').length, 1,
  'parser should accept unquoted attributes from SureCam server markup');
