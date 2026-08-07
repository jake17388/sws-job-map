// Logs into SureCam with a real headless browser (Playwright) and pushes the
// resulting session cookie to Apps Script — replaces both the manual
// DevTools-paste flow and the Chrome extension, neither of which could run
// unattended. UrlFetchApp can't complete this login itself because SureCam
// uses an Auth0 browser-redirect flow; a real browser can.
import { chromium } from 'playwright';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfyJCV7R64CCB2RiRfgkOAtFb79JPhv_rXIxmkedaY4rqjEIJH7tumtXu_8UlwJW4P/exec';

const { SURECAM_EMAIL, SURECAM_PASSWORD, SWS_EXTENSION_SECRET } = process.env;
if (!SURECAM_EMAIL || !SURECAM_PASSWORD || !SWS_EXTENSION_SECRET) {
  console.error('Missing SURECAM_EMAIL, SURECAM_PASSWORD, or SWS_EXTENSION_SECRET env vars.');
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto('https://view.surecam.com/login', { waitUntil: 'domcontentloaded' });
  await page.click('button[type="submit"]'); // submits the CSRF-token form that kicks off the Auth0 redirect
  await page.waitForURL(/auth0\.com/, { timeout: 15000 });

  await page.fill('#1-email', SURECAM_EMAIL);
  await page.fill('#1-password', SURECAM_PASSWORD);
  await page.click('#1-submit');

  // Auth0 redirects to /auth/auth0/callback, which Rails exchanges server-side
  // before bouncing to the live map — wait for that final landing page so the
  // session cookie carries full account context, not just a bare login.
  await page.waitForURL(/view\.surecam\.com\/accounts\//, { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const cookies = await context.cookies('https://view.surecam.com');
  if (!cookies.some(c => c.name === '_vts2_session')) {
    throw new Error('Login completed but no _vts2_session cookie was set — check credentials or SureCam login flow changes.');
  }
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const resp = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'updateScSession', secret: SWS_EXTENSION_SECRET, cookieString }),
  });
  const data = await resp.json();
  if (!data.success) throw new Error('Apps Script rejected the sync: ' + data.error);

  console.log('SureCam session synced OK');
} finally {
  await browser.close();
}
