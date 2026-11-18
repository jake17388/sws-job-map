import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/frontend/style.css', import.meta.url), 'utf8');

test('filters/search and vehicles live in accessible map controls instead of the sidebar', () => {
  const sidebar = html.slice(html.indexOf('<div class="sidebar">'), html.indexOf('<div class="map-container">'));
  const map = html.slice(html.indexOf('<div class="map-container">'), html.indexOf('<div id="map"></div>'));

  assert.doesNotMatch(sidebar, /class="filters"|class="vehicles-section"|id="job-search(?:-mobile)?"/);
  assert.match(map, /id="map-filter-toggle"[^>]*aria-controls="map-filter-panel"[^>]*aria-expanded="false"/);
  assert.match(map, /id="map-vehicles-toggle"[^>]*aria-controls="map-vehicles-panel"[^>]*aria-expanded="false"/);
  assert.match(map, /id="job-search"[^>]*oninput="setSearch\(this\.value\)"/);
  assert.match(map, /id="map-truck-refresh"[^>]*onclick="refreshVehicles\(\)"/);
});

test('map panels are mutually exclusive, closable, and replace Leaflet zoom buttons', () => {
  assert.match(frontend, /function setMapPanel\(panelName\)/);
  assert.match(frontend, /filterPanel\.classList\.toggle\('open', filterOpen\)/);
  assert.match(frontend, /vehiclePanel\.classList\.toggle\('open', vehicleOpen\)/);
  assert.match(frontend, /setAttribute\('aria-expanded', String\(filterOpen\)\)/);
  assert.match(frontend, /setAttribute\('aria-expanded', String\(vehicleOpen\)\)/);
  assert.match(frontend, /L\.map\('map', \{ zoomControl: false, scrollWheelZoom: true \}\)/);
});

test('map controls stay usable without covering the full map on desktop or mobile', () => {
  assert.match(styles, /\.map-panel-controls\s*\{[^}]*position:\s*absolute;[^}]*top:[^;}]+;[^}]*left:/s);
  assert.match(styles, /\.map-filter-panel\s*\{[^}]*max-height:\s*min\(/s);
  assert.match(styles, /\.map-filter-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /@media[^}]+max-width:\s*768px[\s\S]*?\.map-control-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
});
