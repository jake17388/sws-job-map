import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');
const setup = source.slice(source.indexOf('(function setupPullToRefresh()'), source.indexOf('// ── Auto-login'));

function fixture() {
  const handlers = {};
  const classes = new Set();
  const indicator = { style: {}, classList: {
    add: name => classes.add(name), remove: name => classes.delete(name),
    contains: name => classes.has(name),
    toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
  } };
  const list = { scrollTop: 0, addEventListener: (name, fn, options) => { handlers[name] = { fn, options }; } };
  let refreshes = 0, prevented = false, finish;
  vm.runInNewContext(setup, {
    document: { getElementById: id => id === 'job-list' ? list : indicator },
    refreshAll: () => { refreshes++; return new Promise(resolve => { finish = resolve; }); },
  });
  const fire = (name, y = 0) => handlers[name].fn({ touches: [{ clientY: y }], cancelable: true, preventDefault() { prevented = true; } });
  return { handlers, list, indicator, fire, get refreshes() { return refreshes; }, get prevented() { return prevented; }, finish: () => finish() };
}

test('pull at top suppresses native page movement and refreshes once after release', async () => {
  const f = fixture();
  assert.equal(f.handlers.touchmove.options.passive, false);
  f.fire('touchstart', 20);
  f.fire('touchmove', 160);
  assert.equal(f.prevented, true);
  assert.equal(f.refreshes, 0);
  f.fire('touchend');
  f.fire('touchend');
  assert.equal(f.refreshes, 1);
  f.finish();
  await Promise.resolve();
  assert.equal(f.indicator.style.height, '0px');
});

test('regular list scrolling is not intercepted', () => {
  const f = fixture();
  f.list.scrollTop = 100;
  f.fire('touchstart', 20);
  f.fire('touchmove', 160);
  f.fire('touchend');
  assert.equal(f.prevented, false);
  assert.equal(f.refreshes, 0);
});

test('canceled and short pulls do not refresh or leave the indicator open', () => {
  const f = fixture();
  f.fire('touchstart', 20);
  f.fire('touchmove', 160);
  f.fire('touchcancel');
  f.fire('touchend');
  assert.equal(f.refreshes, 0);
  assert.equal(f.indicator.style.height, '0px');
  f.fire('touchstart', 20);
  f.fire('touchmove', 40);
  f.fire('touchend');
  assert.equal(f.refreshes, 0);
  assert.equal(f.indicator.style.height, '0px');
});
