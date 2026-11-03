// Changes the dashboard makes to the page's content sheet: approve/skip, the Schedule tab, new posts.
// Every write first re-reads the sheet and finds the row by its key, so a sheet sorted by hand is safe.
// In demo mode nothing leaves the browser: the same changes are applied to the in-memory demo data.

import { addTab, appendRows, readTabs, uploadFile, writeCells } from './google.js';
import { keyColumn, sheetId } from './model.js';

export const SCHEDULE_TAB = 'Schedule';
const NEW_POST_COLUMNS = ['media_link', 'media_type', 'caption_base', 'hashtags', 'platforms', 'publish_at', 'status', 'post_order'];

/** ctx = { demo: bool, settings, raw } (raw.contentValues / raw.scheduleValues are updated in demo mode). */
async function content(ctx) {
  if (ctx.demo) return ctx.raw.contentValues;
  const tab = ctx.settings.contentTab || 'Content';
  const values = (await readTabs(sheetId(ctx.settings.contentSheet), [tab]))[tab];
  if (!values.length) throw new Error(`The tab “${tab}” is empty or missing.`);
  return values;
}

function locate(values, key) {
  const header = values[0].map((x) => String(x || '').trim());
  const k = header.indexOf(keyColumn(header));
  const i = values.findIndex((r, n) => n > 0 && String(r[k] ?? '').trim() === String(key));
  if (i < 0) throw new Error(`Row ${key} is not in the sheet any more (refresh).`);
  return { header, rowIndex: i };
}

/** Set a row's status (Approved, Skip, Pending). Approving clears an old error. */
export async function setStatus(ctx, key, status) {
  const values = await content(ctx);
  const { header, rowIndex } = locate(values, key);
  const fields = { status, ...(status === 'Approved' ? { error: '' } : {}) };
  if (ctx.demo) {
    Object.entries(fields).forEach(([f, v]) => { const c = header.indexOf(f); if (c >= 0) values[rowIndex][c] = v; });
    return;
  }
  const missing = Object.keys(fields).filter((f) => !header.includes(f));
  if (missing.includes('status')) throw new Error('The content sheet has no status column.');
  const tab = ctx.settings.contentTab || 'Content';
  await writeCells(sheetId(ctx.settings.contentSheet), Object.entries(fields).filter(([f]) => header.includes(f))
    .map(([f, v]) => ({ tab, row: rowIndex + 1, col: header.indexOf(f) + 1, values: [[v]] })));
}

/** Write publish times and pause into the Schedule tab (creates it when missing; other keys are kept). */
export async function saveSchedule(ctx, times, paused) {
  const wanted = { publish_times: times.join(', '), paused: paused ? 'true' : 'false' };
  if (ctx.demo) {
    const rows = ctx.raw.scheduleValues || (ctx.raw.scheduleValues = [['key', 'value']]);
    Object.entries(wanted).forEach(([k, v]) => { const r = rows.find((x) => x[0] === k); if (r) r[1] = v; else rows.push([k, v]); });
    return;
  }
  const id = sheetId(ctx.settings.contentSheet);
  const read = await readTabs(id, [SCHEDULE_TAB]);
  let rows = read[SCHEDULE_TAB];
  if (!read._tabs.includes(SCHEDULE_TAB)) {
    await addTab(id, SCHEDULE_TAB);
    rows = [];
  }
  if (!rows.length) {
    await writeCells(id, [{ tab: SCHEDULE_TAB, row: 1, col: 1, values: [['key', 'value'], ...Object.entries(wanted)] }]);
    return;
  }
  const updates = [];
  const extra = [];
  Object.entries(wanted).forEach(([k, v]) => {
    const i = rows.findIndex((r) => String(r[0] || '').trim().toLowerCase() === k);
    if (i >= 0) updates.push({ tab: SCHEDULE_TAB, row: i + 1, col: 2, values: [[v]] });
    else extra.push([k, v]);
  });
  if (updates.length) await writeCells(id, updates);
  if (extra.length) await appendRows(id, SCHEDULE_TAB, extra);
}

function newKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `C-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${Math.random().toString(36).slice(2, 4)}`;
}

/**
 * Upload the owner's file and add it as a new content row.
 * post = { file, caption, hashtags, platforms: [...], when: 'next' | 'end' | 'at', at: 'YYYY-MM-DD HH:MM', approve }
 */
export async function addPost(ctx, post, onProgress = () => {}) {
  const kind = post.file.type.startsWith('video/') ? 'video' : 'image';
  const key = newKey();
  let link;
  if (ctx.demo) {
    onProgress(1);
    link = `https://drive.google.com/file/d/demo-${key}/view`;
  } else {
    if (!ctx.settings.robotEmail) throw new Error('Add the robot (service account) email in Settings first.');
    const ext = (post.file.name.match(/\.\w+$/) || [kind === 'video' ? '.mp4' : '.jpg'])[0];
    link = (await uploadFile(post.file, `${key}${ext}`, ctx.settings.robotEmail, onProgress)).link;
  }
  const values = await content(ctx);
  let header = values[0].map((x) => String(x || '').trim());
  const missing = NEW_POST_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) header = [...header, ...missing];
  const keyCol = keyColumn(header);
  const orders = values.slice(1).map((r) => Number(r[header.indexOf('post_order')])).filter(Number.isFinite);
  const fields = {
    [keyCol]: key, media_link: link, media_type: kind, caption_base: post.caption.trim(), hashtags: post.hashtags.trim(),
    platforms: post.platforms.join(', '), status: post.approve ? 'Approved' : 'Pending',
    publish_at: post.when === 'at' ? post.at : '',
    post_order: post.when === 'next' ? '0' : post.when === 'end' ? String((orders.length ? Math.max(...orders) : 0) + 1) : '',
  };
  const row = header.map((c) => fields[c] ?? '');
  if (ctx.demo) {
    values[0] = header;
    values.push(row);
    return key;
  }
  const id = sheetId(ctx.settings.contentSheet);
  const tab = ctx.settings.contentTab || 'Content';
  if (missing.length) await writeCells(id, [{ tab, row: 1, col: 1, values: [header] }]);
  await appendRows(id, tab, [row]);
  return key;
}
