const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfyJCV7R64CCB2RiRfgkOAtFb79JPhv_rXIxmkedaY4rqjEIJH7tumtXu_8UlwJW4P/exec';
const SURECAM_DOMAIN = 'view.surecam.com';

// Watch for any SureCam cookie change
chrome.cookies.onChanged.addListener((changeInfo) => {
  const cookie = changeInfo.cookie;
  if (cookie.domain.includes('surecam.com') && cookie.name === '_vts2_session' && !changeInfo.removed) {
    console.log('SureCam session cookie updated — syncing to Apps Script...');
    syncCookies().catch(err => console.error('SWS: sync error —', err));
  }
});

// Throws on any failure so callers (the popup's manual sync button) see the real reason.
async function syncCookies() {
  const cookies = await chrome.cookies.getAll({ domain: SURECAM_DOMAIN });
  if (!cookies.length || !cookies.some(c => c.name === '_vts2_session')) {
    throw new Error('Not logged into SureCam — open view.surecam.com, sign in, then sync again.');
  }

  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const secret = await getSecret();
  if (!secret) {
    throw new Error('No secret set. Open the extension popup to configure.');
  }

  const resp = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'updateScSession', secret, cookieString }),
  });
  const data = await resp.json();
  if (!data.success) {
    throw new Error(data.error || 'Apps Script rejected the sync');
  }
  console.log('SWS: SureCam session synced OK');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'syncNow') {
    syncCookies().then(() => sendResponse({ success: true }))
                 .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

function getSecret() {
  return new Promise(resolve => {
    chrome.storage.local.get('extensionSecret', result => {
      resolve(result.extensionSecret || null);
    });
  });
}
