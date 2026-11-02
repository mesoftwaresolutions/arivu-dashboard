// ARIVU dashboard app: screens, routing (#/home, #/queue, #/stats, #/alerts, #/settings) and data loading.
import { CONFIG } from './config.js';
import { AuthError, hasClientId, loadSettings, readTabs, saveSettings, signIn, signOut, userInfo } from './google.js';
import { DEFAULT_SETTINGS, PLATFORMS, buildModel, compact, duration, sheetId, spark, timeLabel } from './model.js';
import { h, icon, s } from './ui.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const ROUTES = [
  { id: 'home', label: 'Home' }, { id: 'queue', label: 'Queue' }, { id: 'stats', label: 'Analytics' },
  { id: 'alerts', label: 'Alerts' }, { id: 'settings', label: 'Settings' },
];

const state = {
  user: null, settings: null, raw: null, model: null, error: '', loading: false,
  picked: null, range: 7, loadedAt: null,
};

// ---------- theme (per device) ----------
function theme() { try { return localStorage.getItem('arivu.theme') || 'light'; } catch { return 'light'; } }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#1E201D' : '#F7F6F4');
}
function toggleTheme() {
  const t = theme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('arivu.theme', t); } catch { /* ignore */ }
  applyTheme(t);
}
applyTheme(theme());

const logo = (kind, cls, alt) => [
  h('img', { src: `icons/${kind}-dark.png`, class: `logo-light-theme ${cls || ''}`, alt }),
  h('img', { src: `icons/${kind}-light.png`, class: `logo-dark-theme ${cls || ''}`, alt: '' }),
];
const ARIVU_ALT = 'ARIVU — Automated Reach, Insights, Visibility, Utility';

function route() { const r = (location.hash.match(/^#\/(\w+)/) || [])[1]; return ROUTES.some((x) => x.id === r) ? r : 'home'; }

function render() {
  app.replaceChildren(view());
  document.title = `${state.model?.page?.name ? state.model.page.name + ' · ' : ''}ARIVU Dashboard`;
}

function view() {
  if (state.loading && !state.model) return h('div', { class: 'loading', role: 'status' }, 'Loading your page…');
  if (!DEMO && !state.user) return signInView();
  if (!DEMO && (!state.settings || !sheetId(state.settings.contentSheet)) ) return settingsView(true);
  if (!state.model) return errorView();
  return shell();
}

// ---------- sign-in ----------
function signInView() {
  const ready = hasClientId();
  return h('div', { class: 'center' }, h('main', { class: 'login card' },
    h('div', { class: 'logo' }, logo('arivu', '', ARIVU_ALT)),
    h('h1', { style: { fontSize: '22px', fontWeight: 600 } }, 'Dashboard'),
    h('p', { class: 'small' }, 'Sign in with your page’s Google account. Google asks for your 2-step verification.'),
    state.error ? h('div', { class: 'banner bad', role: 'alert' }, state.error) : null,
    ready
      ? h('button', { class: 'btn primary', type: 'button', onclick: doSignIn }, 'Sign in with Google')
      : h('div', { class: 'banner warn' }, 'Setup pending: the Google sign-in client is not added yet.'),
    h('a', { href: '?demo#/home', class: 'small' }, 'See a demo with sample data'),
    h('div', { class: 'by' }, logo('me', '', 'ME Software Solutions'), h('span', { class: 'tiny' }, 'by ME Software Solutions')),
  ));
}

async function doSignIn() {
  state.error = '';
  try {
    await signIn({ interactive: true });
    await afterSignIn();
  } catch (e) {
    state.error = e.message;
    render();
  }
}

async function afterSignIn() {
  state.loading = true; render();
  try {
    state.user = await userInfo();
    state.settings = { ...DEFAULT_SETTINGS, ...((await loadSettings()) || {}) };
    if (sheetId(state.settings.contentSheet)) await loadData();
  } catch (e) {
    if (e instanceof AuthError) state.user = null;
    state.error = e.message;
  }
  state.loading = false; render();
}

// ---------- data ----------
async function loadData() {
  const st = state.settings;
  const [content, hub] = await Promise.all([
    readTabs(sheetId(st.contentSheet), [st.contentTab || 'Content']),
    sheetId(st.hubSheet) ? readTabs(sheetId(st.hubSheet), ['DailyStats', 'PostStats', 'Pages']) : Promise.resolve({}),
  ]);
  state.raw = { contentValues: content[st.contentTab || 'Content'], hub, now: null };
  state.loadedAt = new Date();
  state.error = (content[st.contentTab || 'Content'] || []).length ? '' : `The tab “${st.contentTab}” is empty or missing in the content sheet.`;
  rebuild();
}

function rebuild() {
  if (!state.raw) return;
  state.model = buildModel({ ...state.raw, settings: state.settings, now: state.raw.now ? new Date(state.raw.now) : new Date(), rangeDays: state.range });
  if (!state.picked || !state.model.platforms.some((p) => p.id === state.picked)) state.picked = state.model.platforms[0]?.id || null;
}

async function refresh() {
  if (DEMO) return;
  state.loading = true; render();
  try { await loadData(); } catch (e) { if (e instanceof AuthError) state.user = null; state.error = e.message; }
  state.loading = false; render();
}

// ---------- layout ----------
function shell() {
  const r = route();
  const m = state.model;
  const navItem = (x) => h('a', { class: 'nav-item', href: `#/${x.id}`, 'aria-current': r === x.id ? 'page' : null }, x.label);
  return h('div', { class: 'shell' },
    h('nav', { class: 'side', 'aria-label': 'Main' },
      h('div', { class: 'brand' }, logo('arivu', '', ARIVU_ALT), h('span', { class: 'tiny' }, `Dashboard ${CONFIG.version}${m.page.engine ? ' · Engine ' + m.page.engine : ''}`)),
      ROUTES.map(navItem),
      h('span', { class: 'nav-item soon', title: 'Coming in phase 3' }, '+ New post (soon)'),
      h('div', { class: 'who' }, h('strong', {}, DEMO ? 'Demo' : 'Signed in'), h('br'), DEMO ? 'sample data' : (state.user?.email || '')),
      h('div', { class: 'by' }, logo('me', '', 'ME Software Solutions'), h('span', { class: 'tiny' }, 'by ME Software Solutions')),
    ),
    h('div', { class: 'main' }, page(r)),
    h('nav', { class: 'tabbar', 'aria-label': 'Tabs' }, ROUTES.map((x) => h('a', { href: `#/${x.id}`, 'aria-current': r === x.id ? 'page' : null }, x.id === 'stats' ? 'Stats' : x.label))),
  );
}

function header(title) {
  const m = state.model;
  const live = m.page.live === 'false' ? 'live: false (dry-run)' : m.page.live === 'true' ? 'live' : '';
  return [
    h('div', { class: 'mobile-brand' }, h('div', {}, logo('arivu', '', ARIVU_ALT)), themeButton()),
    h('header', { class: 'top' },
      h('div', {},
        h('h1', { class: 'ta' }, title || m.page.name || 'Your page'),
        h('span', { class: 'small' }, [new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), live].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'tools' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' },
          [7, 30, 90].map((d) => h('button', { type: 'button', 'aria-pressed': state.range === d ? 'true' : 'false', onclick: () => { state.range = d; rebuild(); render(); } }, `${d}d`))),
        DEMO ? null : h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Refresh', title: state.loadedAt ? `Updated ${state.loadedAt.toLocaleTimeString()}` : 'Refresh', onclick: refresh }, icon.refresh()),
        themeButton('theme-btn'),
      ),
    ),
    DEMO ? h('div', { class: 'banner warn' }, 'Demo: made-up numbers for the “Daily Spark” demo page. ', h('a', { href: './' }, 'Sign in for your page')) : null,
    state.error ? h('div', { class: 'banner bad', role: 'alert' }, state.error) : null,
    state.loading ? h('div', { class: 'banner info', role: 'status' }, 'Refreshing…') : null,
  ];
}

function themeButton(extra = '') {
  return h('button', { class: `btn round ${extra}`, type: 'button', onclick: () => { toggleTheme(); render(); }, 'aria-label': theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode' },
    icon.moon(), h('span', {}, theme() === 'dark' ? 'Light' : 'Dark'));
}

function page(r) {
  if (r === 'queue') return h('div', { class: 'col' }, header('Queue'), queueTable(state.model.queue), calendarCard());
  if (r === 'stats') return h('div', { class: 'col' }, header('Analytics'), kpis(), platformsSection(), postsTable(state.model.posts));
  if (r === 'alerts') return h('div', { class: 'col' }, header('Alerts'), alertsCard(), h('p', { class: 'small' }, 'Phone notifications come on Telegram in the next phase.'));
  if (r === 'settings') return settingsView(false);
  return [
    h('div', { class: 'col' }, header(), nextCard(), kpis(), platformsSection(), postsTable(state.model.posts.slice(0, 6), 'Top posts'), queueTable(state.model.queue.slice(0, 7), 'Queue · next 7')),
    h('aside', { class: 'aside' }, calendarCard(), alertsCard(), goalsCard()),
  ];
}

// ---------- cards ----------
function nextCard() {
  const n = state.model.next;
  if (!n) return h('section', { class: 'card', 'aria-label': 'Next post' }, h('span', { class: 'label' }, 'Next post'), h('p', {}, 'No approved posts in the queue. Approve rows in the sheet (status = Approved).'));
  return h('section', { class: 'card next', 'aria-label': 'Next post' },
    h('div', { class: 'thumb ta' }, n.group ? h('span', { class: 'chip' }, n.group.split(' · ').pop()) : h('span'), h('div', {}, n.title.map((t) => h('div', {}, t))), h('span', { class: 'tiny', style: { fontWeight: 400 } }, `#${n.key}`)),
    h('div', { class: 'body' },
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Next post'), h('span', { class: 'pill ok' }, 'Approved'), n.group ? h('span', { class: 'small ta' }, n.group) : null),
      h('h2', {}, `${n.when} · ${n.until}`),
      n.meaning ? h('p', { class: 'ta' }, n.meaning) : null,
      n.notes ? h('p', { class: 'small' }, n.notes) : null,
      h('div', { class: 'row' },
        n.preview ? h('a', { class: 'btn primary', href: n.preview, target: '_blank', rel: 'noopener' }, 'Preview video') : h('span', { class: 'small' }, 'No preview yet (render runs on Monday).'),
        n.captions.length ? h('button', { class: 'btn', type: 'button', onclick: () => showCaptions(n) }, 'Captions') : null,
      ),
    ),
  );
}

function showCaptions(item) {
  const d = h('dialog', { 'aria-label': 'Captions' },
    h('h2', { class: 'sec', style: { marginBottom: '8px' } }, `Captions · #${item.key}`),
    item.captions.map((c) => [h('strong', { class: 'small' }, c.label), h('pre', {}, c.text)]),
    h('form', { method: 'dialog' }, h('button', { class: 'btn primary', type: 'submit' }, 'Close')),
  );
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  d.showModal();
}

function kpis() {
  return h('section', { class: 'kpis', 'aria-label': 'Totals' }, state.model.kpis.map((k) =>
    h('div', { class: 'card kpi' }, h('span', { class: 'small' }, k.label), h('span', { class: 'v' }, k.value), h('span', { class: 'tiny' }, k.note))));
}

const badge = (p) => h('span', { class: 'badge', style: { background: p.color, color: p.inkText || '#FFFFFF' } }, p.short);

function platformsSection() {
  const ps = state.model.platforms;
  if (!ps.length) return h('section', { class: 'card' }, h('h2', { class: 'sec' }, 'Platforms'), h('p', { class: 'small' }, 'No analytics yet. Add the analytics hub sheet in Settings; ARIVU fills it every night.'));
  const sel = ps.find((p) => p.id === state.picked) || ps[0];
  return h('section', { 'aria-label': 'Platforms', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, 'Platforms ', h('span', { class: 'small', style: { fontWeight: 400 } }, '· tap one for details')),
    h('div', { class: 'plats' }, ps.map((p) => h('button', {
      type: 'button', class: 'plat', 'aria-pressed': p.id === sel.id ? 'true' : 'false', style: { borderColor: p.id === sel.id ? p.color : '' },
      onclick: () => { state.picked = p.id; render(); },
    },
    h('span', { class: 'row' }, badge(p), h('strong', {}, p.name)),
    h('span', { class: 'v' }, compact(p.followers)),
    h('span', { class: 'tiny' }, `${p.follow} · ${compact(p.views)} views`),
    sparkSvg(p.viewSeries.map((x) => x.value), p.color, 36, 2.5),
    h('span', { class: 'tiny' }, p.followersDelta ? `${p.followersDelta > 0 ? '▲' : '▼'} ${compact(Math.abs(p.followersDelta))} ${p.follow} in ${state.range}d` : (p.handle || '')),
    ))),
    detail(sel),
  );
}

function sparkSvg(values, color, height, width) {
  return s('svg', { viewBox: '0 0 120 36', height, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('polyline', { points: spark(values), fill: 'none', style: `stroke:${color}`, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
}

function detail(p) {
  const sum = (f) => p.posts.reduce((a, x) => a + (Number(x[f]) || 0), 0);
  const has = (f) => p.posts.some((x) => x[f] !== '' && x[f] !== undefined);
  const metrics = [
    [p.follow[0].toUpperCase() + p.follow.slice(1), compact(p.followers)],
    ['Views', compact(p.views)],
    ['Likes', has('likes') ? compact(sum('likes')) : '—'],
    ['Comments', has('comments') ? compact(sum('comments')) : '—'],
    ['Shares', has('shares') ? compact(sum('shares')) : '—'],
    ['Saves', has('saves') ? compact(sum('saves')) : '—'],
    ['Watch time', has('watch_time') ? duration(sum('watch_time')) : '—'],
    ['Posts tracked', String(p.posts.length)],
  ];
  const series = p.viewSeries;
  return h('div', { class: 'card detail' },
    h('div', { class: 'top' }, h('h3', { class: 'sec' }, `${p.name} · details`), p.handle ? h('span', { class: 'small' }, p.handle) : null),
    h('div', { class: 'metrics' }, metrics.map(([l, v]) => h('div', { class: 'metric' }, h('span', { class: 'tiny' }, l), h('span', { class: 'v' }, v)))),
    series.length > 1
      ? h('div', {}, h('span', { class: 'small' }, `Total views of ${p.name} posts, last ${state.range} days`), sparkSvg(series.map((x) => x.value), p.color, 120, 1.2),
        h('div', { class: 'row tiny', style: { justifyContent: 'space-between' } }, h('span', {}, series[0].date), h('span', {}, series[series.length - 1].date)))
      : h('p', { class: 'small' }, 'The chart appears after two days of analytics.'),
  );
}

function postsTable(posts, title = 'Post performance') {
  return h('section', { 'aria-label': title, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, title),
    posts.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Post', 'Platform', 'Views', 'Likes', 'Comments', 'Watch time', 'Posted'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, posts.map((x) => {
        const p = PLATFORMS[x.platform];
        return h('tr', {},
          h('td', { class: 'ta' }, h('a', { href: x.post_url, target: '_blank', rel: 'noopener' }, x.title)),
          h('td', {}, badge(p)), h('td', {}, h('strong', {}, compact(Number(x.views)))),
          h('td', {}, x.likes === '' ? '—' : compact(Number(x.likes))), h('td', {}, x.comments === '' ? '—' : compact(Number(x.comments))),
          h('td', {}, x.watch_time === '' ? '—' : duration(Number(x.watch_time))), h('td', { class: 'small' }, x.posted_at || ''));
      })),
    )) : h('p', { class: 'small card' }, 'No published posts tracked yet.'),
  );
}

function queueTable(queue, title = 'Queue') {
  return h('section', { 'aria-label': title, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, title, ' ', h('span', { class: 'small', style: { fontWeight: 400 } }, `· publish time ${String(state.settings?.publishTimes || '19:00').split(/[\s,]+/).map(timeLabel).join(', ')}`)),
    queue.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['When', '#', 'Post', 'Group', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, queue.map((q) => h('tr', {},
        h('td', { style: { whiteSpace: 'nowrap' } }, q.when), h('td', {}, h('strong', {}, q.key)),
        h('td', { class: 'ta' }, q.title.join(' / ')), h('td', { class: 'ta small' }, q.group),
        h('td', {}, h('span', { class: 'pill ok' }, 'Approved')),
        h('td', {}, q.captions.length ? h('button', { class: 'btn', type: 'button', onclick: () => showCaptions(q) }, 'Captions') : null)))),
    )) : h('p', { class: 'small card' }, 'Nothing approved yet.'),
    h('p', { class: 'tiny' }, Object.entries(state.model.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')),
  );
}

function calendarCard() {
  return h('section', { class: 'card', 'aria-label': 'Calendar', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, 'Calendar'),
    h('span', { class: 'small' }, 'filled dot = planned · green = posted'),
    h('div', { class: 'cal-head', 'aria-hidden': 'true' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', {}, d))),
    h('div', { class: 'cal' }, state.model.calendar.map((d) => h('div', { class: `day${d.today ? ' today' : ''}`, title: d.date, 'aria-label': `${d.date}${d.posted ? ', posted' : ''}${d.planned ? ', planned' : ''}` },
      h('span', {}, d.day), h('span', { class: `dot${d.posted ? ' posted' : d.planned ? ' planned' : ''}` })))),
  );
}

function alertsCard() {
  const list = state.model.alerts;
  return h('section', { class: 'card', 'aria-label': 'Notifications', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('h2', { class: 'sec' }, 'Notifications'),
    list.length ? list.map((a) => h('div', { class: `alert ${a.kind}` }, h('span', { class: 'dot' }),
      h('div', {}, h('div', { class: 'small' }, a.text), a.when ? h('div', { class: 'tiny' }, a.when) : null))) : h('p', { class: 'small' }, 'All quiet.'),
  );
}

function goalsCard() {
  return h('section', { class: 'card', 'aria-label': 'Goals', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, 'Goals'),
    state.model.goals.map((g) => h('div', { class: 'goal' },
      h('div', { class: 'row small', style: { justifyContent: 'space-between' } }, h('span', {}, g.label), h('span', {}, g.value)),
      h('div', { class: 'track', role: 'progressbar', 'aria-valuenow': Math.round(g.pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': g.label },
        h('div', { class: 'bar', style: { width: `${Math.max(g.pct, 1)}%`, background: g.color } })))),
  );
}

function errorView() {
  return h('div', { class: 'center' }, h('main', { class: 'login card' },
    h('div', { class: 'logo' }, logo('arivu', '', ARIVU_ALT)),
    h('div', { class: 'banner bad', role: 'alert' }, state.error || 'Could not load your page.'),
    h('button', { class: 'btn primary', type: 'button', onclick: refresh }, 'Try again'),
    state.user ? h('button', { class: 'btn', type: 'button', onclick: () => { state.settings = { ...state.settings, contentSheet: '' }; render(); } }, 'Change sheet links') : null,
  ));
}

// ---------- settings ----------
function settingsView(first) {
  const st = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const goal = (i) => st.goals[i] || DEFAULT_SETTINGS.goals[i];
  const field = (name, label, value, hint, type = 'text') => h('label', {}, label,
    h('input', { name, type, value: value ?? '', autocomplete: 'off', spellcheck: 'false' }), hint ? h('span', { class: 'hint' }, hint) : null);
  const form = h('form', { class: 'settings', onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const next = {
      contentSheet: f.get('contentSheet').trim(), hubSheet: f.get('hubSheet').trim(), contentTab: f.get('contentTab').trim() || 'Content',
      publishTimes: f.get('publishTimes').trim() || '19:00', timezone: f.get('timezone').trim() || 'Asia/Kolkata',
      goals: [
        { platform: 'youtube', label: `YouTube: ${compact(Number(f.get('goalYt')) || 1000)} subscribers`, target: Number(f.get('goalYt')) || 1000 },
        { platform: 'instagram', label: `Instagram: ${compact(Number(f.get('goalIg')) || 10000)} followers`, target: Number(f.get('goalIg')) || 10000 },
      ],
    };
    if (!sheetId(next.contentSheet)) { state.error = 'Paste the content sheet’s link (https://docs.google.com/spreadsheets/d/…).'; render(); return; }
    if (next.hubSheet && !sheetId(next.hubSheet)) { state.error = 'The analytics hub link does not look like a Google Sheets link.'; render(); return; }
    state.error = ''; state.loading = true; render();
    try {
      if (!DEMO) await saveSettings(next);
      state.settings = next;
      if (!DEMO) await loadData();
      location.hash = '#/home';
    } catch (err) { state.error = err.message; }
    state.loading = false; render();
  } },
  field('contentSheet', 'Content sheet link', st.contentSheet, 'The page’s Google Sheet with the posts (Content tab).'),
  field('contentTab', 'Content tab name', st.contentTab),
  field('hubSheet', 'Analytics hub sheet link', st.hubSheet, '“ARIVU Hub – <Page>”: DailyStats, PostStats, Pages tabs.'),
  field('publishTimes', 'Publish time(s)', st.publishTimes, 'Same as schedule.publish_times_ist in page.yml, e.g. 19:00 (or 09:00, 19:00).'),
  field('timezone', 'Time zone', st.timezone),
  field('goalYt', 'Goal: YouTube subscribers', goal(0).target, '', 'number'),
  field('goalIg', 'Goal: Instagram followers', goal(1).target, '', 'number'),
  h('button', { class: 'btn primary', type: 'submit', disabled: DEMO ? true : null }, first ? 'Save and open dashboard' : 'Save'),
  h('p', { class: 'tiny' }, 'Saved in your Google account’s hidden app folder for this dashboard, so it follows you to every phone and computer. Nothing is stored on our servers.'),
  );
  const body = [
    h('h1', { style: { fontSize: '22px', fontWeight: 600 } }, first ? 'Connect your page' : 'Settings'),
    state.user ? h('p', { class: 'small' }, `Signed in as ${state.user.email}`) : null,
    state.error ? h('div', { class: 'banner bad', role: 'alert' }, state.error) : null,
    form,
    !first ? h('div', { class: 'row' }, themeButton(), DEMO ? null : h('button', { class: 'btn', type: 'button', onclick: () => { signOut(); state.user = null; state.model = null; state.raw = null; location.hash = ''; render(); } }, 'Sign out')) : null,
    h('p', { class: 'tiny' }, `ARIVU Dashboard ${CONFIG.version} · read-only · by ME Software Solutions`),
  ];
  if (first) return h('div', { class: 'center' }, h('main', { class: 'login card', style: { maxWidth: '560px', textAlign: 'left' } }, h('div', { class: 'logo', style: { textAlign: 'center' } }, logo('arivu', '', ARIVU_ALT)), body));
  return h('div', { class: 'col' }, header('Settings'), h('section', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '640px' } }, body));
}

// ---------- start ----------
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.loadedAt && Date.now() - state.loadedAt > 5 * 60_000) refresh();
});

async function start() {
  if (DEMO) {
    const demo = await (await fetch('demo/demo-data.json')).json();
    state.settings = { ...DEFAULT_SETTINGS, ...demo.settings };
    state.raw = { contentValues: demo.content, hub: demo.hub, now: params.get('demo') === 'live' ? null : demo.now };
    rebuild();
    render();
    return;
  }
  render();
  try {
    await signIn({ interactive: false });       // only succeeds with a token saved in this tab session
    await afterSignIn();
  } catch { render(); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
