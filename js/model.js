// Pure data logic: turns the page's Content sheet and analytics hub into what the dashboard shows.
// No DOM and no network here, so it can be tested with Node (tests/model.test.mjs).

export const PLATFORMS = {
  instagram: { name: 'Instagram', short: 'IG', color: '#C13584', follow: 'followers', link: 'ig_post_url' },
  facebook: { name: 'Facebook', short: 'FB', color: '#1877F2', follow: 'followers', link: 'fb_post_url' },
  threads: { name: 'Threads', short: 'TH', color: 'var(--ink)', inkText: 'var(--bg)', follow: 'followers', link: 'threads_post_url' },
  youtube: { name: 'YouTube', short: 'YT', color: '#CC0000', follow: 'subscribers', link: 'yt_video_url' },
  pinterest: { name: 'Pinterest', short: 'PIN', color: '#BD081C', follow: 'followers', link: 'pin_post_url' },
};
export const PLATFORM_ORDER = Object.keys(PLATFORMS);

export const DEFAULT_SETTINGS = {
  contentSheet: '',
  hubSheet: '',
  contentTab: 'Content',
  publishTimes: '19:00',
  timezone: 'Asia/Kolkata',
  goals: [
    { platform: 'youtube', label: 'YouTube: 1,000 subscribers', target: 1000 },
    { platform: 'instagram', label: 'Instagram: 10K followers', target: 10000 },
  ],
};

/** Sheet ID from a full Google Sheets URL or a bare ID. */
export function sheetId(text) {
  const s = String(text || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

/** 2D values (first row = header) → array of objects keyed by header. Blank rows are skipped. */
export function rowsFromValues(values) {
  if (!values || !values.length) return [];
  const header = values[0].map((h) => String(h || '').trim());
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] || [];
    if (!raw.some((v) => String(v ?? '').trim())) continue;
    const row = { _row: i + 1 };                       // 1-based sheet row, used when writing back
    header.forEach((h, j) => { if (h) row[h] = String(raw[j] ?? '').trim(); });
    out.push(row);
  }
  return out;
}

/** The content key column: the one after post_order (ARIVU's layout), else "id", else the first. */
export function keyColumn(header) {
  const h = (header || []).map((x) => String(x || '').trim());
  if (h[0] === 'post_order' && h[1]) return h[1];
  if (h.includes('id')) return 'id';
  return h[0] || 'id';
}

export const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function compact(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.round(seconds);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** Calendar date (YYYY-MM-DD) and minutes since midnight of `now` in a time zone. */
export function localParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dayLabel = (date, opts = { day: 'numeric', month: 'short' }) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

function timeToMinutes(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function timeLabel(t) {
  const mins = timeToMinutes(t);
  if (mins === null) return t;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Upcoming publish slots: [{date, time}] starting from the next one not yet used today. */
export function upcomingSlots(now, settings, postedToday, count) {
  const tz = settings.timezone || 'Asia/Kolkata';
  const times = String(settings.publishTimes || '19:00').split(/[\s,]+/).filter((t) => timeToMinutes(t) !== null)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  if (!times.length) times.push('19:00');
  const { date: today, minutes } = localParts(now, tz);
  const slots = [];
  let used = postedToday;
  for (let d = 0; slots.length < count && d < 400; d++) {
    const date = addDays(today, d);
    for (const t of times) {
      if (d === 0) {
        if (used > 0) { used -= 1; continue; }
        if (timeToMinutes(t) <= minutes) continue;
      }
      slots.push({ date, time: t });
      if (slots.length >= count) break;
    }
  }
  return slots;
}

function untilLabel(now, slot, tz) {
  const { date, minutes } = localParts(now, tz);
  const days = Math.round((new Date(`${slot.date}T00:00:00Z`) - new Date(`${date}T00:00:00Z`)) / 864e5);
  const diff = days * 1440 + timeToMinutes(slot.time) - minutes;
  if (diff <= 0) return 'now';
  if (diff < 60) return `in ${diff}m`;
  if (diff < 1440) return `in ${Math.floor(diff / 60)}h ${diff % 60}m`;
  return `in ${Math.floor(diff / 1440)}d ${Math.floor((diff % 1440) / 60)}h`;
}

/** Short human title for a content row (template fields line1/line2, else captions, else the key). */
export function rowTitle(row, key) {
  if (row.media_link) {
    const first = String(row.caption_base || '').split('\n')[0].replace(/\s*#\S+/g, '').trim();
    return [first || `Your ${row.media_type || 'post'} #${row[key]}`];
  }
  const lines = ['line1', 'line2'].map((f) => row[f]).filter(Boolean);
  if (lines.length) return lines;
  const t = row.caption_yt_title || row.caption_pin_title || row.title || '';
  return [t || `#${row[key]}`];
}

function captionsOf(row) {
  return [
    ['Instagram', row.caption_ig], ['Facebook', row.caption_fb], ['Threads', row.caption_threads],
    ['YouTube title', row.caption_yt_title], ['YouTube description', row.caption_yt_desc],
    ['Pinterest title', row.caption_pin_title], ['Pinterest description', row.caption_pin_desc],
  ].filter(([, v]) => v).map(([label, text]) => ({ label, text }));
}

/** Everything the dashboard needs, from raw sheet values. */
export function buildModel({ contentValues, hub, scheduleValues, settings: s, now = new Date(), rangeDays = 7 }) {
  const schedule = parseSchedule(scheduleValues);
  const settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  if (schedule.times.length) settings.publishTimes = schedule.times.join(', ');   // the sheet is the source of truth
  const tz = settings.timezone;
  const header = (contentValues && contentValues[0]) || [];
  const key = keyColumn(header);
  const rows = rowsFromValues(contentValues);
  const today = localParts(now, tz).date;
  const status = (r) => r.status || 'Pending';
  const order = (r) => { const n = num(r.post_order); return n === null ? 1e9 : n; };

  const postedRows = rows.filter((r) => status(r) === 'Posted');
  const timed = (r) => Boolean(r.publish_at);
  const postedToday = postedRows.filter((r) => !timed(r) && String(r.posted_at || '').startsWith(today)).length;
  const approved = rows.filter((r) => status(r) === 'Approved' && !timed(r)).sort((a, b) => order(a) - order(b));
  const slots = upcomingSlots(now, settings, postedToday, Math.max(approved.length, 1));
  const whenLabel = (slot) => (slot ? `${slot.date === today ? 'Today' : dayLabel(slot.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeLabel(slot.time)}` : '');
  const item = (r, slot, exact) => ({
    key: r[key], title: rowTitle(r, key), slot, when: whenLabel(slot), exact, custom: Boolean(r.media_link),
    group: [r.pal, r.chapter_name || r.topic].filter(Boolean).join(' · ') || (r.media_link ? `Your ${r.media_type || 'post'}` : ''),
    preview: r.preview_link || r.media_link || '', captions: captionsOf(r), notes: r.notes || '', status: status(r), row: r,
  });
  const exactRows = rows.filter((r) => status(r) === 'Approved' && timed(r))
    .map((r) => item(r, { date: r.publish_at.slice(0, 10), time: r.publish_at.slice(11, 16) }, true));
  const sortKey = (q) => (q.slot ? `${q.slot.date} ${q.slot.time}` : '9999');
  const queue = [...approved.map((r, i) => item(r, slots[i], false)), ...exactRows].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const waiting = rows.filter((r) => ['Pending', 'Rendered', 'Failed'].includes(status(r)))
    .sort((a, b) => order(a) - order(b)).map((r) => item(r, null, false));
  const next = queue[0] ? { ...queue[0], until: untilLabel(now, queue[0].slot, tz), meaning: queue[0].row.meaning || '' } : null;

  const counts = {};
  rows.forEach((r) => { counts[status(r)] = (counts[status(r)] || 0) + 1; });

  // ---- analytics hub ----
  const daily = rowsFromValues(hub?.DailyStats);
  const postStats = rowsFromValues(hub?.PostStats);
  const pages = rowsFromValues(hub?.Pages);
  const pageInfo = pages[0] || {};
  const from = addDays(today, -(rangeDays - 1));

  const platforms = PLATFORM_ORDER.filter((p) => daily.some((d) => d.platform === p)).map((p) => {
    const series = daily.filter((d) => d.platform === p).sort((a, b) => a.date.localeCompare(b.date));
    const latest = series[series.length - 1] || {};
    const before = [...series].reverse().find((d) => d.date < from) || series[0] || {};
    const inRange = series.filter((d) => d.date >= from);
    const posts = latestPosts(postStats.filter((x) => x.platform === p));
    const views = posts.reduce((a, x) => a + (num(x.views) || 0), 0);
    const f1 = num(latest.followers), f0 = num(before.followers);
    return {
      id: p, ...PLATFORMS[p],
      followers: f1, followersDelta: f1 !== null && f0 !== null && series.length > 1 ? f1 - f0 : null,
      views: posts.length ? views : num(latest.views),
      latest, posts,
      followerSeries: inRange.map((d) => num(d.followers) || 0),
      viewSeries: viewSeries(postStats.filter((x) => x.platform === p), from),
      handle: pageInfo[{ instagram: 'ig_handle', facebook: 'fb_page', threads: 'threads_handle', youtube: 'yt_channel', pinterest: 'pinterest_handle' }[p]] || '',
    };
  });

  const keyTitle = Object.fromEntries(rows.map((r) => [r[key], rowTitle(r, key).join(' / ')]));
  const keyGroup = Object.fromEntries(rows.map((r) => [r[key], r.chapter_name || r.topic || '']));
  const allPosts = platforms.flatMap((p) => p.posts.map((x) => ({
    ...x, platform: p.id, title: keyTitle[x.content_key] || `#${x.content_key}`, group: keyGroup[x.content_key] || '',
  }))).sort((a, b) => (num(b.views) || 0) - (num(a.views) || 0));

  const sum = (f) => allPosts.reduce((a, x) => a + (num(x[f]) || 0), 0);
  const totalViews = sum('views');
  const engaged = sum('likes') + sum('comments') + sum('shares') + sum('saves');
  const followers = platforms.reduce((a, p) => a + (p.followers || 0), 0);
  const followersDelta = platforms.reduce((a, p) => a + (p.followersDelta || 0), 0);
  const kpis = [
    { label: 'Total followers', value: compact(followers), note: platforms.some((p) => p.followersDelta) ? `${followersDelta >= 0 ? '▲' : '▼'} ${compact(Math.abs(followersDelta))} in ${rangeDays} days` : `${platforms.length} platforms` },
    { label: 'Total views', value: compact(totalViews), note: `${allPosts.length} post links tracked` },
    { label: 'Engagement rate', value: totalViews ? `${((engaged * 100) / totalViews).toFixed(1)}%` : '—', note: `${compact(engaged)} likes, comments, shares, saves` },
    { label: 'Posts published', value: String(postedRows.length), note: `${approved.length} approved in queue` },
  ];

  const goals = (settings.goals || []).map((g) => {
    const p = platforms.find((x) => x.id === g.platform);
    const have = p ? p.followers || 0 : 0;
    const target = Number(g.target) || 1;
    return { label: g.label, value: `${compact(have)} / ${compact(target)}`, pct: Math.min(100, (have * 100) / target), color: (PLATFORMS[g.platform] || {}).color || 'var(--ink)' };
  });

  return {
    key, header, schedule, publishTimes: String(settings.publishTimes).split(/[\s,]+/).filter(Boolean), waiting, page: { name: pageInfo.page || '', slug: pageInfo.slug || '', live: pageInfo.live || '', engine: pageInfo.engine_version || '', updated: pageInfo.updated_at || '' },
    today, next, queue, counts, kpis, platforms, posts: allPosts, goals,
    calendar: calendar(today, rows, queue),
    alerts: [...schedulerAlerts(schedule, now), ...alerts(rows, key, next, pageInfo, daily, today)],
  };
}

/** Latest snapshot per post (PostStats keeps one row per day). */
function latestPosts(rows) {
  const by = {};
  rows.forEach((r) => { const k = r.post_id || r.post_url; if (!by[k] || r.date > by[k].date) by[k] = r; });
  return Object.values(by);
}

/** Total views of all this platform's posts, per day in the range (from PostStats snapshots). */
function viewSeries(rows, from) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const last = {};
  const out = [];
  dates.forEach((d) => {
    rows.filter((r) => r.date === d).forEach((r) => { last[r.post_id || r.post_url] = num(r.views) || 0; });
    if (d >= from) out.push({ date: d, value: Object.values(last).reduce((a, v) => a + v, 0) });
  });
  return out;
}

function calendar(today, rows, queue) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;           // Monday = 0
  const start = addDays(today, -weekday - 7);
  const posted = new Set(rows.map((r) => String(r.posted_at || '').slice(0, 10)).filter(Boolean));
  const planned = new Set(queue.map((q) => q.slot && q.slot.date));
  return Array.from({ length: 21 }, (_, i) => {
    const date = addDays(start, i);
    return { date, day: Number(date.slice(8)), today: date === today, posted: posted.has(date), planned: planned.has(date) };
  });
}

function schedulerAlerts(sc, now) {
  if (!sc.exists) return [];
  const out = [];
  if (sc.paused) out.push({ kind: 'info', text: 'Publishing is paused (Schedule).', when: '' });
  if (sc.lastError) out.push({ kind: 'bad', text: `Scheduler error: ${sc.lastError}`, when: '' });
  const t = Date.parse(sc.lastCheck);
  if (sc.lastCheck && Number.isFinite(t) && now - t > 90 * 60_000) {
    out.push({ kind: 'bad', text: `Scheduler has not checked in for ${Math.round((now - t) / 60_000)} min (it runs every 30).`, when: sc.lastCheck });
  }
  return out;
}

function alerts(rows, key, next, pageInfo, daily, today) {
  const out = [];
  if (pageInfo.live === 'false') out.push({ kind: 'info', text: 'live: false — posts are dry-run until you go live.', when: '' });
  if (next) out.push({ kind: 'info', text: `Next: #${next.key} ${next.when}`, when: next.until });
  rows.filter((r) => (r.status || '') === 'Failed').forEach((r) => out.push({ kind: 'bad', text: `Failed #${r[key]}: ${r.error || 'see sheet'}`, when: '' }));
  rows.filter((r) => r.status === 'Posted' && r.posted_at).sort((a, b) => b.posted_at.localeCompare(a.posted_at)).slice(0, 3)
    .forEach((r) => out.push({ kind: 'good', text: `Posted #${r[key]}`, when: r.posted_at }));
  rows.filter((r) => r.notes && r.status !== 'Posted').slice(0, 3).forEach((r) => out.push({ kind: 'info', text: `#${r[key]}: ${r.notes}`, when: '' }));
  const lastDay = daily.map((d) => d.date).sort().pop();
  if (lastDay) out.push({ kind: lastDay >= addDays(today, -1) ? 'good' : 'bad', text: lastDay >= addDays(today, -1) ? 'Analytics up to date' : 'Analytics not updated for 2+ days — check GitHub Actions', when: lastDay });
  return out;
}

/** The sheet's Schedule tab (key | value), as the engine and the Apps Script scheduler read it. */
export function parseSchedule(values) {
  const out = {};
  (values || []).forEach((r) => { const k = String(r[0] || '').trim().toLowerCase(); if (k && k !== 'key') out[k] = String(r[1] ?? '').trim(); });
  const times = String(out.publish_times || '').split(/[\s,]+/).filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => t.padStart(5, '0')).sort();
  return {
    exists: Boolean(values && values.length), times, paused: /^(true|yes|1|paused)$/i.test(out.paused || ''),
    lastCheck: out.last_check || '', lastDispatch: out.last_dispatch || '', lastError: out.last_error || '',
  };
}

/** Times for N posts a day, spread over the day (kept when they already match N). */
export function suggestTimes(n, current = []) {
  if (current.length === n) return current;
  const presets = { 1: ['19:00'], 2: ['12:30', '19:00'], 3: ['09:00', '13:00', '19:00'], 4: ['08:00', '12:30', '17:00', '20:30'],
    5: ['08:00', '11:00', '14:00', '17:00', '20:00'], 6: ['08:00', '10:30', '13:00', '15:30', '18:00', '20:30'],
    7: ['07:30', '09:30', '11:30', '13:30', '16:00', '18:30', '21:00'] };
  if (presets[n]) return presets[n];
  return Array.from({ length: n }, (_, i) => {
    const m = 7 * 60 + Math.round((i * (15 * 60)) / Math.max(n - 1, 1));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
}

/** SVG polyline points for a 120×36 sparkline. */
export function spark(values) {
  const v = values.length ? values : [0];
  const max = Math.max(...v), min = Math.min(...v), span = max - min || 1;
  return v.map((x, i) => `${(v.length === 1 ? 60 : (i * 120) / (v.length - 1)).toFixed(1)},${(max === min ? 18 : 32 - ((x - min) * 28) / span).toFixed(1)}`).join(' ');
}
