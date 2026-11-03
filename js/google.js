// Google sign-in (Google Identity Services, token model) and the Google APIs the dashboard uses:
// Sheets (read and update the page's sheets), Drive (only files this app creates: uploads, and its own
// hidden settings file in appDataFolder), userinfo.
// The access token lives only in memory and sessionStorage (cleared when the browser tab closes).

import { CONFIG } from './config.js';

const NEEDED = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
];
const SCOPES = ['openid', 'email', 'profile', ...NEEDED].join(' ');
const SCOPE_VERSION = 2;                 // bump when SCOPES change: older saved tokens are not reused
const SETTINGS_FILE = 'arivu-dashboard-settings.json';
const UPLOAD_FOLDER = 'ARIVU uploads';
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
    return t && t.v === SCOPE_VERSION && t.expires > Date.now() + 60_000 ? t : null;
  } catch { return null; }
}

function save(t) {
  token = t;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* private mode: memory only */ }
}

export function hasClientId() { return Boolean(CONFIG.googleClientId); }

/** Ask Google for an access token. interactive=false only reuses a token saved in this tab. */
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
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...NEEDED)) {
          return reject(new AuthError('Please tick all three permissions (your sheets, files ARIVU creates, dashboard settings).'));
        }
        const t = { access: r.access_token, expires: Date.now() + Number(r.expires_in || 3600) * 1000, v: SCOPE_VERSION };
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

function bearer() {
  const t = token || saved();
  if (!t) throw new AuthError('Signed out. Please sign in again.');
  return `Bearer ${t.access}`;
}

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: bearer(), ...(opts.headers || {}) } });
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

// ---------- Sheets ----------
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const q = (tab) => encodeURIComponent(`'${String(tab).replace(/'/g, "''")}'`);

/** Values of several tabs of one spreadsheet: {tabName: [[...], ...]}. Missing tabs come back empty. */
export async function readTabs(spreadsheetId, tabs) {
  const meta = await api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`);
  const have = new Set((meta.sheets || []).map((s) => s.properties.title));
  const wanted = tabs.filter((t) => have.has(t));
  const out = Object.fromEntries(tabs.map((t) => [t, []]));
  out._title = meta.properties?.title || '';
  out._tabs = [...have];
  if (!wanted.length) return out;
  const qs = wanted.map((t) => `ranges=${q(t)}`).join('&');
  const data = await api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`);
  (data.valueRanges || []).forEach((vr, i) => { out[wanted[i]] = vr.values || []; });
  return out;
}

/** Write cells. updates = [{tab, row (1-based), col (1-based), values: [[...]]}] in one call. RAW: no formulas, no date guessing. */
export async function writeCells(spreadsheetId, updates) {
  const data = updates.map((u) => ({ range: `'${String(u.tab).replace(/'/g, "''")}'!${a1(u.row, u.col)}`, values: u.values }));
  return api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

/** Append rows at the end of a tab. */
export async function appendRows(spreadsheetId, tab, rows) {
  return api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }),
  });
}

export async function addTab(spreadsheetId, title) {
  return api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

export function a1(row, col) {
  let s = '';
  for (let c = col; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return `${s}${row}`;
}

// ---------- Drive ----------
const DRIVE = 'https://www.googleapis.com/drive/v3';

async function settingsFileId() {
  const query = encodeURIComponent(`name='${SETTINGS_FILE}'`);
  const r = await api(`${DRIVE}/files?spaces=appDataFolder&q=${query}&fields=files(id)`);
  return r.files?.[0]?.id || null;
}

/** This app's settings, kept in the signed-in account's hidden Drive app folder (follows the account to every device). */
export async function loadSettings() {
  const id = await settingsFileId();
  if (!id) return null;
  return api(`${DRIVE}/files/${id}?alt=media`);
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

/** The "ARIVU uploads" folder in the account's Drive (made by this app, so drive.file can see it). */
async function uploadFolder() {
  const query = encodeURIComponent(`name='${UPLOAD_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await api(`${DRIVE}/files?q=${query}&fields=files(id)`);
  if (found.files?.length) return found.files[0].id;
  const made = await api(`${DRIVE}/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: UPLOAD_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return made.id;
}

/**
 * Upload a file (resumable, with progress) into "ARIVU uploads", then let the page's service account read it
 * so the ARIVU engine can download it. Returns {id, link}.
 */
export async function uploadFile(file, name, robotEmail, onProgress = () => {}) {
  const folder = await uploadFolder();
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: bearer(), 'Content-Type': 'application/json', 'X-Upload-Content-Type': file.type || 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  if (!start.ok) throw new Error(`Upload could not start (HTTP ${start.status}).`);
  const session = start.headers.get('Location');
  if (!session) throw new Error('Upload could not start (no upload address from Google).');
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', session);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status === 200 || xhr.status === 201 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`Upload failed (HTTP ${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Upload failed: network error. Try again on a better connection.'));
    xhr.send(file);
  });
  if (robotEmail) {
    await api(`${DRIVE}/files/${result.id}/permissions?sendNotificationEmail=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: robotEmail }),
    });
  }
  return { id: result.id, link: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view` };
}
