import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const personalProjectKey = 'AIzaSyBxzLeU1u-5AAmb-J_wAC2-QT-wf2-qiXQ';
const coordinatorProjectKey = 'AIzaSyAiuFrr648HGoeFn3BmScaDVAbzJKPfXcA';

assert.doesNotMatch(html, new RegExp(personalProjectKey),
  'the retired personal-project Maps API key must not be deployed');
assert.match(html, new RegExp(`maps\\.googleapis\\.com/maps/api/js\\?key=${coordinatorProjectKey}`),
  'the Maps loader must use the coordinator-owned project key');

console.log('Maps API key ownership contract passed');
