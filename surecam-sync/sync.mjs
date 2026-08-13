// Logs into SureCam with a real headless browser (Playwright) and pushes the
// resulting session cookie to Apps Script — replaces both the manual
// DevTools-paste flow and the Chrome extension, neither of which could run
// unattended. UrlFetchApp can't complete this login itself because SureCam
// uses an Auth0 browser-redirect flow; a real browser can.
import { chromium } from 'playwright';
import { parseSurecamVehicles, postJsonWithRetry, selectTrackedVehicles } from './lib.mjs';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfyJCV7R64CCB2RiRfgkOAtFb79JPhv_rXIxmkedaY4rqjEIJH7tumtXu_8UlwJW4P/exec';
const LIVE_URL = 'https://view.surecam.com/accounts/01127/live';
const SHOT_PATH = 'failure.png';
// Matches the backend's own auth check in cacheSurecamVehicles().
const MIN_AUTHED_BYTES = 50000;
const TRACKED_NAMES = new Map([
  ['33bb8790-2acc-4ae5-9729-c6435152cf6f', '2025 Double Bucket'],
  ['e6c84a15-6a26-4f5a-9f27-494dc3a15f9a', '2016 Flatbed'],
  ['cbb1eae7-8270-4ded-ab87-910281b5800d', '2018 Big Crane'],
  ['e7ee6ba9-1f74-4a76-b318-fae044c8a818', '2019 Single Bucket'],
  ['0f74b5cc-b7e8-41d6-a5fc-6daa201b138a', '2023 Single Bucket'],
  ['5e2c8f15-7b50-404a-baf3-538a2f51f301', '2022 Small Crane'],
  ['3812774d-22d0-4a8e-9e35-22e277fa29f5', '2015 Double Bucket'],
]);

// Name the specific missing variables — a generic "something is missing" tells
// you nothing when three secrets have to line up.
const REQUIRED = ['SURECAM_EMAIL', 'SURECAM_PASSWORD', 'SWS_EXTENSION_SECRET'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required secret(s): ' + missing.join(', '));
  console.error('Add them under repo Settings → Secrets and variables → Actions.');
  process.exit(1);
}
const { SURECAM_EMAIL, SURECAM_PASSWORD, SWS_EXTENSION_SECRET } = process.env;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto('https://view.surecam.com/login', { waitUntil: 'domcontentloaded' });
  // /login is just a CSRF-token form whose submit kicks off the Auth0 redirect.
  await page.click('button[type="submit"]');
  await page.waitForURL(/auth0\.com/, { timeout: 20000 });

  // Auth0 ids look like "1-email"; a CSS id selector can't start with a digit,
  // so select by name instead (also stabler across Auth0 template changes).
  await page.fill('input[name="email"]', SURECAM_EMAIL);
  await page.fill('input[name="password"]', SURECAM_PASSWORD);
  await page.click('button[name="submit"]');

  // Auth0 reports bad credentials/MFA inline without navigating, which would
  // otherwise surface later as a confusing "not authenticated" size check.
  const authError = await page
    .waitForSelector('.auth0-global-message-error, [class*="error-message"]', { timeout: 8000 })
    .then(el => el.textContent())
    .catch(() => null);
  if (authError && authError.trim()) {
    throw new Error('Auth0 rejected the login: ' + authError.trim());
  }

  // Wait only for the callback to land us back on SureCam — don't assume which
  // page it redirects to, since that target has changed before.
  await page.waitForURL(/view\.surecam\.com/, { timeout: 30000 });

  // Then load the live map explicitly: Rails writes account context into the
  // session cookie here, and the backend's warm-up check requires it.
  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  // Verify we're ACTUALLY logged in before shipping anything. A _vts2_session
  // cookie proves nothing — Rails issues one to anonymous visitors too, so a
  // failed login still yields a cookie and would silently push a dead session.
  // Use the same signal the backend uses: the logged-out shell is ~13KB, the
  // real live page is 150KB+.
  const html = await page.content();
  console.log(`Live page: ${page.url()} (${html.length} bytes)`);
  if (html.length < MIN_AUTHED_BYTES) {
    throw new Error(
      `Not authenticated — live page was only ${html.length} bytes (need >${MIN_AUTHED_BYTES}). ` +
      'Login likely failed; check SURECAM_EMAIL/SURECAM_PASSWORD, or SureCam may now require MFA.'
    );
  }

  const cookies = await context.cookies('https://view.surecam.com');
  if (!cookies.some(c => c.name === '_vts2_session')) {
    throw new Error('Login finished but no _vts2_session cookie was set — check credentials, or SureCam changed its login flow.');
  }
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const snapshotAt = new Date().toISOString();
  const vehicles = selectTrackedVehicles(parseSurecamVehicles(html, snapshotAt), new Set(TRACKED_NAMES.keys()))
    .map(vehicle => ({ ...vehicle, name: TRACKED_NAMES.get(vehicle.deviceId) }));
  if (!vehicles.length) {
    throw new Error('Authenticated live page contained no vehicle positions; refusing to replace the last-known snapshot.');
  }
  console.log(`Parsed ${vehicles.length} vehicle positions for durable snapshot`);

  // Diagnostic: replay the same cookie over plain HTTP (no browser), exactly as
  // Apps Script does. If this returns the small shell while the browser got
  // 200KB+, the session needs browser context (JS/bot check) rather than just
  // the cookie — which would explain the backend's persistent warm-up failures.
  const probe = await fetch(LIVE_URL, {
    headers: {
      'Cookie': cookieString,
      'Accept': 'text/html, application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });
  const probeBody = await probe.text();
  console.log(`Plain-HTTP probe: status=${probe.status} bytes=${probeBody.length} url=${probe.url}`);
  console.log(`Probe verdict: ${probeBody.length >= MIN_AUTHED_BYTES ? 'cookie works without a browser' : 'cookie does NOT work without a browser'}`);

  await postJsonWithRetry(SCRIPT_URL, {
    action: 'updateScSession',
    secret: SWS_EXTENSION_SECRET,
    cookieString,
    vehicles,
    snapshotAt,
  });

  console.log(`SureCam session and ${vehicles.length}-vehicle snapshot synced OK`);
} catch (err) {
  // Capture where we actually ended up — the login flow is the fragile part and
  // a URL + screenshot usually identifies the failure immediately.
  console.error('Sync failed:', err.message);
  console.error('Final URL:  ' + page.url());
  console.error('Page title: ' + await page.title().catch(() => '(unavailable)'));
  await page.screenshot({ path: SHOT_PATH, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
