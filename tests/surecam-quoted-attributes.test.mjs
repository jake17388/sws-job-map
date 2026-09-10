import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseSurecamVehicles } from '../surecam-sync/lib.mjs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../Code.js', import.meta.url), 'utf8'), context);

for (const [name, parse] of [
  ['Apps Script', html => context.scParseLivePage_(html)],
  ['browser sync', parseSurecamVehicles],
]) {
  for (const quote of ['"', "'"]) {
    for (const actionFirst of [true, false]) {
      test(`${name}: quoted > preserves GPS attributes (${quote}, action first=${actionFirst})`, () => {
        const action = `data-action=${quote}click->live-device#select${quote}`;
        const src = `data-live-device-details-src=${quote}/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f${quote}`;
        const html = `<div ${actionFirst ? action + ' ' + src : src + ' ' + action}
          data-latitude=${quote}33.4${quote} data-longitude=${quote}-111.9${quote}
          data-status=${quote}normal${quote} data-label=${quote}Truck${quote}></div>`;
        const vehicles = parse(html);
        assert.equal(vehicles.length, 1);
        assert.equal(vehicles[0].lat, 33.4);
        assert.equal(vehicles[0].lng, -111.9);
        assert.equal(vehicles[0].status, 'normal');
      });
    }
  }
}

for (const [name, parse] of [['Apps Script', html => context.scParseLivePage_(html)], ['browser sync', parseSurecamVehicles]]) {
  test(`${name}: missing GPS must not become a position at zero`, () => {
    assert.equal(parse('<div data-live-device-details-src="/accounts/01127/live/33bb8790-2acc-4ae5-9729-c6435152cf6f"></div>').length, 0);
  });
}
