import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const squarecoilSource = readFileSync(new URL('../src/backend/11-squarecoil-estimates.js', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/frontend/app.js', import.meta.url), 'utf8');

function squarecoilContext(initial = {}) {
  const values = { ...initial };
  const writes = [];
  const context = vm.createContext({
    Map,
    Set,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty: key => values[key] || '',
          setProperties(next) {
            writes.push({ ...next });
            Object.assign(values, next);
          },
        };
      },
    },
  });
  vm.runInContext(squarecoilSource, context);
  return { context, values, writes };
}

test('valid Squarecoil credentials are verified before being stored', () => {
  const backend = squarecoilContext();
  const attempts = [];
  backend.context.squarecoilEstimateLogin_ = (username, password) => {
    attempts.push([username, password]);
    return 'authenticated-cookie';
  };

  const result = backend.context.saveSquarecoilEstimateCredentials_(' install.admin ', 'secret-value');

  assert.deepEqual(attempts, [['install.admin', 'secret-value']]);
  assert.deepEqual(backend.writes, [{
    SQUARECOIL_USERNAME: 'install.admin',
    SQUARECOIL_PASSWORD: 'secret-value',
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, configured: true });
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
});

test('rejected Squarecoil credentials are not stored or echoed', () => {
  const backend = squarecoilContext();
  backend.context.squarecoilEstimateLogin_ = () => {
    throw new Error('remote failure containing secret-value');
  };

  const result = backend.context.saveSquarecoilEstimateCredentials_('install.admin', 'secret-value');

  assert.deepEqual(backend.writes, []);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    configured: false,
    error: 'Squarecoil rejected the credentials. Check the username and password.',
  });
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
});

test('Squarecoil status and credential updates are admin-only routes', () => {
  const calls = [];
  const context = vm.createContext({
    JSON,
    UNAUTHORIZED: { error: 'unauthorized' },
    json: value => value,
    resolveActor_: token => token === 'admin-token'
      ? { name: 'Jake Banks', role: 'admin' }
      : token === 'viewer-token' ? { name: 'Viewer', role: 'viewer' } : null,
    isAdmin_: actor => !!actor && actor.role === 'admin',
    squarecoilEstimateConnectionStatus_: () => ({ configured: true }),
    saveSquarecoilEstimateCredentials_: (username, password) => {
      calls.push([username, password]);
      return { success: true, configured: true };
    },
  });
  vm.runInContext(routingSource, context);

  assert.deepEqual(
    context.doGet({ parameter: { action: 'getSquarecoilEstimateStatus', token: 'admin-token' } }),
    { configured: true },
  );
  assert.deepEqual(
    context.doGet({ parameter: { action: 'getSquarecoilEstimateStatus', token: 'viewer-token' } }),
    { error: 'unauthorized' },
  );
  assert.deepEqual(
    context.doPost({ postData: { contents: JSON.stringify({
      action: 'saveSquarecoilEstimateCredentials',
      token: 'viewer-token',
      username: 'viewer',
      password: 'secret-value',
    }) } }),
    { error: 'forbidden' },
  );
  assert.deepEqual(
    context.doPost({ postData: { contents: JSON.stringify({
      action: 'saveSquarecoilEstimateCredentials',
      token: 'admin-token',
      username: 'install.admin',
      password: 'secret-value',
    }) } }),
    { success: true, configured: true },
  );
  assert.deepEqual(calls, [['install.admin', 'secret-value']]);
});

test('settings provide an admin-only password form without prefilled secrets', () => {
  assert.match(htmlSource, /id="squarecoil-settings-card"[^>]+hidden/);
  assert.match(htmlSource, /id="squarecoil-username"[^>]+autocomplete="username"/);
  assert.match(htmlSource, /id="squarecoil-password"[^>]+type="password"[^>]+autocomplete="current-password"/);
  assert.match(htmlSource, /onclick="saveSquarecoilSettings\(\)"/);
  assert.match(frontendSource, /squarecoil-settings-card[\s\S]{0,300}isAdmin\(\)/);
  assert.match(frontendSource, /action:\s*'saveSquarecoilEstimateCredentials'/);
  assert.match(frontendSource, /squarecoil-password'\)\.value\s*=\s*''/);
  assert.doesNotMatch(frontendSource, /localStorage[^\n]+squarecoil/i);
});
