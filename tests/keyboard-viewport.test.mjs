import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const setup = source.slice(source.indexOf('(function setupKeyboardViewport()'), source.indexOf('// ── State'));

function fixture() {
  const events = {};
  let inset, queued;
  const viewport = { height: 894, offsetTop: 0, scale: 1, addEventListener: (type, fn) => { events[type] = fn; } };
  const document = {
    activeElement: null,
    documentElement: { style: { setProperty: (_, value) => { inset = value; } } },
    addEventListener: (type, fn) => { events[type] = fn; },
  };
  vm.runInNewContext(setup, {
    window: { visualViewport: viewport, innerHeight: 956, addEventListener: (type, fn) => { events[type] = fn; } },
    document, requestAnimationFrame: fn => { queued = fn; },
  });
  return {
    viewport, document,
    editing(on) { document.activeElement = on ? { matches: () => true } : null; },
    event(type) { events[type](); },
    flush() { const fn = queued; queued = null; fn?.(); },
    get inset() { return inset; },
  };
}

test('a normal 62px iPhone viewport difference never creates a keyboard gap', () => {
  const f = fixture();
  assert.equal(f.inset, '0px');
  f.editing(true);
  f.event('focusin'); f.flush();
  assert.equal(f.inset, '0px');
});

test('keyboard opening and closing resize the app while preserving the full screen on blur', () => {
  const f = fixture();
  f.editing(true); f.viewport.height = 600;
  f.event('resize'); f.flush();
  assert.equal(f.inset, '356px');
  f.editing(false);
  f.event('focusout'); f.flush();
  assert.equal(f.inset, '0px');
});

test('keyboard panning uses the visible viewport bottom, not height alone', () => {
  const f = fixture();
  f.editing(true); f.viewport.height = 600; f.viewport.offsetTop = 100;
  f.event('scroll'); f.flush();
  assert.equal(f.inset, '256px');
});

test('pinch zoom never counts as keyboard occlusion', () => {
  const f = fixture();
  f.editing(true); f.viewport.height = 500; f.viewport.scale = 1.5;
  f.event('resize'); f.flush();
  assert.equal(f.inset, '0px');
});
