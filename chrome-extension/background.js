const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcac0fvc0_sIIl7DQ5cHNV_94AxD_Ijobv1_HpcDI/exec';
const SURECAM_DOMAIN = 'view.surecam.com';

// Watch for any SureCam cookie change
chrome.cookies.onChanged.addListener((changeInfo) => {
  const cookie = changeInfo.cookie;
  if (cookie.domain.includes('surecam.com') && cookie.name === '_vts2_session' && !changeInfo.removed) {
    console.log('SureCam session cookie updated — syncing to Apps Script...');
    syncCookies();
  }
});

async function syncCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: SURECAM_DOMAIN });
    if (!cookies.length) return;

    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const secret = await getSecret();
    if (!secret) {
      console.warn('SWS extension: no secret set. Open the extension popup to configure.');
      return;
    }

    const resp = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'updateScSession', secret, cookieString }),
    });
    const data = await resp.json();
    if (data.success) {
      console.log('SWS: SureCam session synced OK');
    } else {
      console.warn('SWS: sync failed —', data.error);
    }
  } catch (err) {
    console.error('SWS: sync error —', err);
  }
}

function getSecret() {
  return new Promise(resolve => {
    chrome.storage.local.get('extensionSecret', result => {
      resolve(result.extensionSecret || null);
    });
  });
}
