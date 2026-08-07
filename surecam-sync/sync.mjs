// Logs into SureCam with a real headless browser (Playwright) and pushes the
// resulting session cookie to Apps Script — replaces both the manual
// DevTools-paste flow and the Chrome extension, neither of which could run
// unattended. UrlFetchApp can't complete this login itself because SureCam
// uses an Auth0 browser-redirect flow; a real browser can.
import { chromium } from 'playwright';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfyJCV7R64CCB2RiRfgkOAtFb79JPhv_rXIxmkedaY4rqjEIJH7tumtXu_8UlwJW4P/exec';
const LIVE_URL = 'https://view.surecam.com/accounts/01127/live';
const SHOT_PATH = 'failure.png';

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

  // Wait only for the callback to land us back on SureCam — don't assume which
  // page it redirects to, since that target has changed before.
  await page.waitForURL(/view\.surecam\.com/, { timeout: 30000 });

  // Then load the live map explicitly: Rails writes account context into the
  // session cookie here, and the backend's warm-up check requires it.
  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const cookies = await context.cookies('https://view.surecam.com');
  if (!cookies.some(c => c.name === '_vts2_session')) {
    throw new Error('Login finished but no _vts2_session cookie was set — check credentials, or SureCam changed its login flow.');
  }
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const resp = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'updateScSession', secret: SWS_EXTENSION_SECRET, cookieString }),
  });
  const data = await resp.json();
  if (!data.success) throw new Error('Apps Script rejected the sync: ' + data.error);

  console.log('SureCam session synced OK');
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
