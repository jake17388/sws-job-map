import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const properties = new Map();
const cache = new Map();
const propertyApi = {
  getProperty: key => properties.get(key) ?? null,
  setProperty: (key, value) => properties.set(key, value),
};
const cacheApi = {
  get: key => cache.get(key) ?? null,
  put: (key, value) => cache.set(key, value),
  remove: key => cache.delete(key),
};
const context = vm.createContext({
  PropertiesService: { getScriptProperties: () => propertyApi },
  CacheService: { getScriptCache: () => cacheApi },
  Utilities: { getUuid: () => 'uuid' },
  console,
});
vm.runInContext(readFileSync(new URL('../Code.js', import.meta.url), 'utf8'), context);

assert.match(readFileSync(new URL('../Code.js', import.meta.url), 'utf8'),
  /action === 'refreshVehicles'/,
  'backend should expose a protected action for forcing a fresh vehicle snapshot');

const snapshot = {
  snapshotAt: '2026-08-13T12:00:00.000Z',
  vehicles: [{
    deviceId: 'truck-1', name: 'Truck 1', status: 'normal', lat: 33.4, lng: -111.9,
    updatedAt: '2026-08-13T12:00:00.000Z',
  }],
};

// A successful update must be durable, not only a six-minute CacheService entry.
context.storeVehicleSnapshot_(snapshot.vehicles, snapshot.snapshotAt);
assert.ok(properties.get('SC_VEHICLE_SNAPSHOT'));

// Simulate cache expiry/restart: durable PropertiesService data must still load.
cache.clear();
const restored = JSON.parse(JSON.stringify(context.getVehicleSnapshot_()));
assert.deepEqual(restored, snapshot);
