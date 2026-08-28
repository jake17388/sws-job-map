// ── Auth ──────────────────────────────────────────────────────────────────────
// Active PINs live only in Script Properties. Versioned property names prevent
// legacy source-controlled credentials and sessions from being reused.
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // sessions last 30 days
const PINS_PROPERTY = 'PINS_V2';
const AUTH_SECRET_PROPERTY = 'AUTH_SECRET_V2';

// Execution-API helpers for secure PIN provisioning. PIN values are passed at
// invocation time and never stored in source control.
function addPin(pin, user) {
  if (!/^\d{4}$/.test(String(pin)) || !String(user || '').trim()) throw new Error('PIN must be four digits and user is required');
  const pins = getPins();
  pins[String(pin)] = String(user).trim();
  PropertiesService.getScriptProperties().setProperty(PINS_PROPERTY, JSON.stringify(pins));
  return { success: true, user: pins[String(pin)] };
}

function replaceUserPin(pin, user) {
  if (!/^\d{4}$/.test(String(pin)) || !String(user || '').trim()) throw new Error('PIN must be four digits and user is required');
  const normalizedUser = String(user).trim();
  const pins = getPins();
  Object.keys(pins).forEach(existingPin => { if (pins[existingPin] === normalizedUser) delete pins[existingPin]; });
  pins[String(pin)] = normalizedUser;
  PropertiesService.getScriptProperties().setProperty(PINS_PROPERTY, JSON.stringify(pins));
  return { success: true, user: normalizedUser };
}

function getPins() {
  const pins = PropertiesService.getScriptProperties().getProperty(PINS_PROPERTY);
  if (!pins) return {};
  try { return JSON.parse(pins); } catch (err) { return {}; }
}

function getAuthSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(AUTH_SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(AUTH_SECRET_PROPERTY, secret);
  }
  return secret;
}

function signPayload(payload) {
  const sig = Utilities.computeHmacSha256Signature(payload, getAuthSecret());
  return Utilities.base64EncodeWebSafe(sig);
}

function makeToken(user) {
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ u: user, e: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + signPayload(payload);
}

function roleForUser_(user) {
  return user === ADMIN_USER_NAME ? 'admin' : 'viewer';
}

function resolveActor_(token) {
  const user = verifyToken(token);
  if (!user || !Object.values(getPins()).includes(user)) return null;
  return { name: user, role: roleForUser_(user) };
}

function isAdmin_(actor) {
  return !!actor && actor.role === 'admin' && actor.name === ADMIN_USER_NAME;
}

// Returns the user name for a valid unexpired token, else null
function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (signPayload(parts[0]) !== parts[1]) return null;
  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (err) { return null; }
  if (!data || !data.u || !data.e || data.e < Date.now()) return null;
  return data.u;
}

function checkPin(pin) {
  const user = getPins()[String(pin)];
  if (!user) return { ok: false };
  return { ok: true, user: user, role: roleForUser_(user), token: makeToken(user) };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const UNAUTHORIZED = { error: 'unauthorized' };
