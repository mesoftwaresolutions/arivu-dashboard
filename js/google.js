// Google sign-in (Google Identity Services, token model) and the three Google APIs the dashboard uses:
// Sheets (read the page's sheets), Drive appDataFolder (this app's own hidden settings file), userinfo.
// The access token lives only in memory and sessionStorage (cleared when the browser tab closes).

import { CONFIG } from './config.js';

const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');
const SETTINGS_FILE = 'arivu-dashboard-settings.json';
const TOKEN_KEY = 'arivu.token';

let tokenClient = null;
let token = null;

export class AuthError extends Error {}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google sign-in. Check the internet connection.'));
    document.head.appendChild(s);
  });
}

function saved() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.expires > Date.now() + 60_000 ? t : null;
  } catch { return null; }
}

function save(t) {
  token = t;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* private mode: memory only */ }
}

export function hasClientId() { return Boolean(CONFIG.googleClientId); }

/** Ask Google for an access token. interactive=false tries silently (no popup if already allowed). */
export async function signIn({ interactive = true, hint = '' } = {}) {
  if (!hasClientId()) throw new AuthError('This dashboard has no Google client ID yet (js/config.js).');
  const s = saved();
  if (s) { token = s; return s; }
  if (!interactive) throw new AuthError('Not signed in.');      // a popup needs a user's click
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPES,
      hint,
      prompt: '',
      callback: (r) => {
        if (r.error) return reject(new AuthError(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES.split(' ').slice(3))) {
          return reject(new AuthError('Please allow both permissions (read your sheets, keep dashboard settings).'));
        }
        const t = { access: r.access_token, expires: Date.now() + Number(r.expires_in || 3600) * 1000 };
        save(t);
        resolve(t);
      },
      error_callback: (e) => reject(new AuthError(e && e.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Sign-in did not finish.')),
    });
    tokenClient.requestAccessToken();
  });
}

export function signOut() {
  const t = token || saved();
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.access, () => {});
}

async function api(url, opts = {}) {
  const t = token || saved();
  if (!t) throw new AuthError('Signed out.');
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t.access}`, ...(opts.headers || {}) } });
  if (res.status === 401) { signOut(); throw new AuthError('Session expired. Please sign in again.'); }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* not JSON */ }
    if (res.status === 403 || res.status === 404) msg += ' — is this sheet shared with the account you signed in with?';
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const userInfo = () => api('https://www.googleapis.com/oauth2/v3/userinfo');

/** Values of several tabs of one spreadsheet: {tabName: [[...], ...]}. Missing tabs come back empty. */
export async function readTabs(spreadsheetId, tabs) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`);
  const have = new Set((meta.sheets || []).map((s) => s.properties.title));
  const wanted = tabs.filter((t) => have.has(t));
  const out = Object.fromEntries(tabs.map((t) => [t, []]));
  out._title = meta.properties?.title || '';
  if (!wanted.length) return out;
  const qs = wanted.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&');
  const data = await api(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`);
  (data.valueRanges || []).forEach((vr, i) => { out[wanted[i]] = vr.values || []; });
  return out;
}

async function settingsFileId() {
  const q = encodeURIComponent(`name='${SETTINGS_FILE}'`);
  const r = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  return r.files?.[0]?.id || null;
}

/** This app's settings, kept in the signed-in account's hidden Drive app folder (follows the account to every device). */
export async function loadSettings() {
  const id = await settingsFileId();
  if (!id) return null;
  return api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
}

export async function saveSettings(settings) {
  const id = await settingsFileId();
  const boundary = 'arivu' + Math.random().toString(36).slice(2);
  const meta = id ? {} : { name: SETTINGS_FILE, parents: ['appDataFolder'] };
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(settings)}\r\n--${boundary}--`;
  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  return api(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}
