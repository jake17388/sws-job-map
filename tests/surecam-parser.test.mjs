import assert from 'node:assert/strict';
import { parseSurecamVehicles, postJsonWithRetry } from '../surecam-sync/lib.mjs';

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
