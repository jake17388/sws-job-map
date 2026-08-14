import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function loadBackend() {
  const properties = new Map();
  const cache = new Map();
  const propertyApi = {
    getProperty: key => properties.get(key) ?? null,
    setProperty: (key, value) => properties.set(key, String(value)),
    deleteProperty: key => properties.delete(key),
  };
  const cacheApi = {
    get: key => cache.get(key) ?? null,
    put: (key, value) => cache.set(key, String(value)),
    remove: key => cache.delete(key),
  };
  let uuid = 0;
  const requests = [];
  const response = (code, body) => ({
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(body),
  });
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => propertyApi },
    CacheService: { getScriptCache: () => cacheApi },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      computeDigest: (_algorithm, value) => Array.from(Buffer.from(String(value))),
      base64Encode: value => Buffer.from(value).toString('base64'),
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
      DigestAlgorithm: { SHA_256: 'sha256' },
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/users/get_current_account')) {
          return response(200, { account_id: 'dbid:test', root_info: { root_namespace_id: 'team-root' } });
        }
        return response(200, { entries: [], has_more: false });
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } }),
    },
    HtmlService: { createHtmlOutput: html => ({ html }) },
    console,
  });
  vm.runInContext(readFileSync(new URL('../Code.js', import.meta.url), 'utf8'), context);
  return { context, properties, cache, requests };
}

test('Jake Banks is the only administrator', () => {
  const { context } = loadBackend();
  assert.equal(context.roleForUser_('Jake Banks'), 'admin');
  assert.equal(context.roleForUser_('Ryan Chapman'), 'viewer');
  assert.equal(context.roleForUser_('jake banks'), 'viewer');
});

test('authentication has no source-controlled PIN fallback and uses a new session namespace', () => {
  const { context, properties } = loadBackend();
  assert.deepEqual(JSON.parse(JSON.stringify(context.getPins())), {});
  context.getAuthSecret();
  assert.ok(properties.has('AUTH_SECRET_V2'));
  assert.equal(properties.has('AUTH_SECRET'), false);
});

test('incorrect PINs never create a shared failed-attempt lockout', () => {
  const { context } = loadBackend();
  for (let i = 0; i < 20; i++) assert.deepEqual(JSON.parse(JSON.stringify(context.checkPin('0000'))), { ok: false });
});

test('job numbers accept only normalized five or six digit values', () => {
  const { context } = loadBackend();
  assert.equal(context.normalizeJobNumber_(' 260248 '), '260248');
  assert.equal(context.normalizeJobNumber_('12345'), '12345');
  assert.equal(context.normalizeJobNumber_('../260248'), null);
  assert.equal(context.normalizeJobNumber_('260248 Project'), null);
});

test('range parsing tolerates irregular names and overlapping bounds', () => {
  const { context } = loadBackend();
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.parseDropboxRangeFolder_({ name: '_260299 thru 260200', path_lower: '/bucket' }))),
    { name: '_260299 thru 260200', path: '/bucket', low: 260200, high: 260299 },
  );
  assert.equal(context.parseDropboxRangeFolder_({ name: 'Archive 260200', path_lower: '/bad' }), null);
});

test('numeric proof versions win and unversioned files fall back to modified time', () => {
  const { context } = loadBackend();
  const files = [
    { '.tag': 'file', id: 'id:9', rev: '9', name: 'Project_v9.pdf', server_modified: '2026-08-14T10:00:00Z' },
    { '.tag': 'file', id: 'id:10', rev: '10', name: 'Project_v10.PDF', server_modified: '2026-08-13T10:00:00Z' },
    { '.tag': 'file', id: 'id:txt', name: 'notes.txt', server_modified: '2026-08-15T10:00:00Z' },
  ];
  assert.equal(context.pickWinningProof_(files).id, 'id:10');

  const fallback = [
    { '.tag': 'file', id: 'id:old', rev: 'a', name: 'Old.pdf', server_modified: '2026-08-13T10:00:00Z' },
    { '.tag': 'file', id: 'id:new', rev: 'b', name: 'New.PDF', server_modified: '2026-08-14T10:00:00Z' },
  ];
  assert.equal(context.pickWinningProof_(fallback).id, 'id:new');
  assert.equal(context.pickWinningProof_([{ '.tag': 'file', name: 'notes.txt' }]), null);
});

test('OAuth state is expiring, one-time, and never stored in plaintext', () => {
  const { context, properties } = loadBackend();
  const now = 1_000_000;
  const state = context.createDropboxOAuthState_('Jake Banks', now);
  const stored = properties.get('DROPBOX_OAUTH_STATE');
  assert.ok(stored);
  assert.doesNotMatch(stored, new RegExp(state));
  assert.equal(context.consumeDropboxOAuthState_(state, now + 1000), true);
  assert.equal(context.consumeDropboxOAuthState_(state, now + 1001), false);

  const expired = context.createDropboxOAuthState_('Jake Banks', now);
  assert.equal(context.consumeDropboxOAuthState_(expired, now + 11 * 60 * 1000), false);
});

test('Dropbox denial consumes OAuth state and returns a sanitized error', () => {
  const { context } = loadBackend();
  const state = context.createDropboxOAuthState_('Jake Banks', 1_000_000);
  const result = context.handleDropboxOAuthCallback_({ parameter: { state, error: 'access_denied' } }, 'https://example.test/exec');
  assert.match(result.html, /connection failed/i);
  assert.doesNotMatch(result.html, /access_denied/);
  assert.equal(context.consumeDropboxOAuthState_(state, 1_000_001), false);
});

test('analysis validation limits equipment and preserves unknown counts', () => {
  const { context } = loadBackend();
  const valid = {
    recommendedEquipment: ['crane', 'double bucket'],
    installRequirements: [{ item: 'Mount letters', quantity: 12, unit: 'letters', notes: '', source: 'shown', pages: [2] }],
    letterCount: 12,
    lettersetCount: 1,
    monument: { present: false, quantity: 0, notes: '' },
    components: Object.fromEntries(['acm','rpc','fco','emc','sf','ds','df','wireway','raceway'].map(key => [key, { present: null, quantity: null, notes: '' }])),
    unknowns: [],
  };
  assert.equal(context.validateInstallAnalysis_(valid), true);
  assert.equal(context.validateInstallAnalysis_({ ...valid, recommendedEquipment: ['forklift'] }), false);
  assert.equal(context.validateInstallAnalysis_({ ...valid, letterCount: -1 }), false);
  assert.equal(context.validateInstallAnalysis_({ ...valid, letterCount: null }), true);
  assert.equal(context.validateInstallAnalysis_({ ...valid, installRequirements: [{ ...valid.installRequirements[0], quantity: -2 }] }), false);
  assert.equal(context.validateInstallAnalysis_({ ...valid, installRequirements: [{ ...valid.installRequirements[0], source: 'invented' }] }), false);
});

test('strict install-analysis schema uses only supported array constraints', () => {
  const { context } = loadBackend();
  const serialized = JSON.stringify(context.installAnalysisJsonSchema_());
  assert.doesNotMatch(serialized, /uniqueItems/);
  assert.match(serialized, /flatbed truck/);
});

test('Responses API request sends a high-detail PDF with strict structured output', () => {
  const { context, properties } = loadBackend();
  properties.set('OPENAI_API_KEY', 'test-key');
  let captured;
  context.UrlFetchApp.fetch = (url, options) => {
    captured = { url, options };
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ output_text: JSON.stringify({
        recommendedEquipment: ['crane', 'crane'],
        installRequirements: [],
        letterCount: null,
        lettersetCount: null,
        monument: { present: null, quantity: null, notes: '' },
        components: Object.fromEntries(['acm','rpc','fco','emc','sf','ds','df','wireway','raceway'].map(key => [key, { present: null, quantity: null, notes: '' }])),
        unknowns: [],
      }) }),
    };
  };
  const result = context.analyzeProductionPdf_({ getBytes: () => [1, 2, 3] }, '260248');
  const payload = JSON.parse(captured.options.payload);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(payload.input[0].content[1].type, 'input_file');
  assert.equal(payload.input[0].content[1].detail, 'high');
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.strict, true);
  assert.doesNotMatch(JSON.stringify(payload.text.format.schema), /uniqueItems/);
  assert.deepEqual(JSON.parse(JSON.stringify(result.analysis.recommendedEquipment)), ['crane']);
});

test('analysis queue eligibility includes due work and stale claims only', () => {
  const { context } = loadBackend();
  const now = Date.parse('2026-08-14T12:00:00Z');
  assert.equal(context.analysisRecordEligibleForClaim_({ status: 'queued' }, now), true);
  assert.equal(context.analysisRecordEligibleForClaim_({ status: 'retry_wait', next_attempt_at: '2026-08-14T11:59:00Z' }, now), true);
  assert.equal(context.analysisRecordEligibleForClaim_({ status: 'retry_wait', next_attempt_at: '2026-08-14T12:01:00Z' }, now), false);
  assert.equal(context.analysisRecordEligibleForClaim_({ status: 'analyzing', claimed_at: '2026-08-14T11:30:00Z' }, now), true);
  assert.equal(context.analysisRecordEligibleForClaim_({ status: 'analyzing', claimed_at: '2026-08-14T11:55:00Z' }, now), false);
});

test('backend atomically claims analysis work with a script lock', () => {
  const source = readFileSync(new URL('../Code.js', import.meta.url), 'utf8');
  assert.match(source, /function claimNextAnalysisRecord_[\s\S]*LockService\.getScriptLock\(\)[\s\S]*status: 'claimed'/);
  assert.match(source, /function writeAnalysisRecordForClaim_[\s\S]*current\.claim_id !== claimId[\s\S]*return false/);
  assert.match(source, /function enqueueInstallAnalysis_[\s\S]*LockService\.getScriptLock\(\)/);
});

test('already-locked job mutations use the non-locking queue helper', () => {
  const source = readFileSync(new URL('../Code.js', import.meta.url), 'utf8');
  const addBody = source.match(/function addUnsched\(data\) \{([\s\S]*?)\n\}/)[1];
  const updateBody = source.match(/function updateUnsched\(data\) \{([\s\S]*?)\n\}/)[1];
  assert.match(addBody, /enqueueInstallAnalysisUnlocked_/);
  assert.match(updateBody, /enqueueInstallAnalysisUnlocked_/);
  assert.doesNotMatch(addBody, /enqueueInstallAnalysis_\(/);
  assert.doesNotMatch(updateBody, /enqueueInstallAnalysis_\(/);
});

test('folder listing drains every Dropbox pagination cursor', () => {
  const { context } = loadBackend();
  const calls = [];
  context.dropboxApiCall_ = (_token, endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'files/list_folder') return { entries: [{ id: '1' }], has_more: true, cursor: 'next-1' };
    if (payload.cursor === 'next-1') return { entries: [{ id: '2' }], has_more: true, cursor: 'next-2' };
    return { entries: [{ id: '3' }], has_more: false };
  };
  assert.deepEqual(JSON.parse(JSON.stringify(context.listDropboxFolderAll_('token', '/root', {}).map(entry => entry.id))), ['1', '2', '3']);
  assert.deepEqual(calls.map(call => call.endpoint), ['files/list_folder', 'files/list_folder/continue', 'files/list_folder/continue']);
});

test('Team Space root header is attached to metadata requests', () => {
  const { context, requests } = loadBackend();
  context.dropboxApiCall_('token', 'files/list_folder', { path: '/orders' });
  const apiRequest = requests.find(request => request.url.includes('/files/list_folder'));
  assert.equal(apiRequest.options.headers['Dropbox-API-Path-Root'], JSON.stringify({ '.tag': 'root', root: 'team-root' }));
});

test('viewer requests are rejected by backend routes before private work runs', () => {
  const { context } = loadBackend();
  context.resolveActor_ = () => ({ name: 'Ryan Chapman', role: 'viewer' });
  const mutation = context.doPost({ postData: { contents: JSON.stringify({ action: 'addUnsched', token: 'viewer-token', job_num: '260248' }) } });
  assert.deepEqual(JSON.parse(mutation.text), { error: 'forbidden' });
  const privateRead = context.doGet({ parameter: { action: 'getDropboxStatus', token: 'viewer-token' } });
  assert.deepEqual(JSON.parse(privateRead.text), { error: 'unauthorized' });
});
