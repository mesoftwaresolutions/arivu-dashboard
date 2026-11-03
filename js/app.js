// ARIVU dashboard app: screens, routing (#/home, #/queue, #/new, #/stats, #/alerts, #/settings) and data loading.
import { SCHEDULE_TAB, addPost, saveSchedule, setStatus } from './actions.js';
import { CONFIG } from './config.js';
import { AuthError, currentAccount, hasClientId, loadSettings, readTabs, saveSettings, signIn, signOut, signedInAccounts, userInfo } from './google.js';
import { DEFAULT_SETTINGS, PLATFORMS, PLATFORM_ORDER, buildModel, compact, duration, sheetId, spark, suggestTimes, timeLabel } from './model.js';
import { h, icon, s } from './ui.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const ROUTES = [
  { id: 'home', label: 'Home' }, { id: 'queue', label: 'Queue' }, { id: 'new', label: '+ New post', tab: '+ New' },
  { id: 'stats', label: 'Analytics', tab: 'Stats' }, { id: 'alerts', label: 'Alerts' }, { id: 'settings', label: 'Settings' },
];

const state = {
  user: null, settings: null, raw: null, model: null, error: '', loading: false,
  picked: null, range: 7, loadedAt: null, notice: '', busy: false, draftTimes: null,
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

// ---------- pages remembered on this device (email + page name only; no tokens) ----------
const PAGES_KEY = 'arivu.pages';
function knownPages() { try { return JSON.parse(localStorage.getItem(PAGES_KEY) || '[]'); } catch { return []; } }
function rememberPage(email, name) {
  if (!email) return;
  const list = knownPages().filter((p) => p.email !== email);
  list.unshift({ email, name: name || email, at: Date.now() });
  try { localStorage.setItem(PAGES_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* ignore */ }
}
function forgetPage(email) {
  try { localStorage.setItem(PAGES_KEY, JSON.stringify(knownPages().filter((p) => p.email !== email))); } catch { /* ignore */ }
}

function resetPageState() {
  Object.assign(state, { user: null, settings: null, raw: null, model: null, error: '', notice: '', picked: null, draftTimes: null });
}

/** Switch to a remembered page (instant when this tab already has its token), or add a new one. */
async function switchTo(email) {
  if (email === currentAccount() && state.model) return;
  resetPageState();
  try {
    if (email) await signIn({ hint: email }); else await signIn({ chooseAccount: true });
    await afterSignIn();
  } catch (e) {
    state.error = e.message;
    render();
  }
}

function signOutHere(forget = false) {
  const email = currentAccount();
  if (forget) forgetPage(email);
  const next = signOut(email);
  resetPageState();
  location.hash = '#/home';
  if (next) switchTo(next); else render();
}

/** The page dropdown: every remembered page, then "Add another page". */
function pageSwitcher(extra = '') {
  if (DEMO) return null;
  const me = currentAccount();
  const pages = knownPages();
  if (me && !pages.some((p) => p.email === me)) pages.unshift({ email: me, name: state.model?.page?.name || me });
  const live = new Set(signedInAccounts());
  return h('label', { class: `switcher ${extra}` }, h('span', { class: 'sr-only' }, 'Page'),
    h('select', { 'aria-label': 'Switch page', onchange: (e) => { const v = e.target.value; if (v === '+') switchTo(''); else switchTo(v); } },
      pages.map((p) => h('option', { value: p.email, selected: p.email === me || null }, `${p.name}${live.has(p.email) || p.email === me ? '' : ' (sign in)'}`)),
      h('option', { value: '+' }, '＋ Add another page…')));
}

// ---------- sign-in ----------
function signInView() {
  const ready = hasClientId();
  const pages = knownPages();
  return h('div', { class: 'center' }, h('main', { class: 'login card' },
    h('div', { class: 'logo' }, logo('arivu', '', ARIVU_ALT)),
    h('h1', { style: { fontSize: '22px', fontWeight: 600 } }, 'Dashboard'),
    h('p', { class: 'small' }, 'Sign in with your page’s Google account. Google asks for your 2-step verification.'),
    state.error ? h('div', { class: 'banner bad', role: 'alert' }, state.error) : null,
    ready && pages.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('span', { class: 'small' }, 'Your pages on this device'),
      pages.map((p) => h('button', { class: 'btn page-btn', type: 'button', onclick: () => switchTo(p.email) },
        h('span', { class: 'ta' }, p.name), h('span', { class: 'tiny' }, p.email)))) : null,
    ready
      ? h('button', { class: 'btn primary', type: 'button', onclick: () => switchTo('') }, pages.length ? 'Sign in to another page' : 'Sign in with Google')
      : h('div', { class: 'banner warn' }, 'Setup pending: the Google sign-in client is not added yet.'),
    h('a', { href: '?demo#/home', class: 'small' }, 'See a demo with sample data'),
    h('div', { class: 'by' }, logo('me', '', 'ME Software Solutions'), h('span', { class: 'tiny' }, 'by ME Software Solutions')),
  ));
}

async function afterSignIn() {
  state.loading = true; render();
  try {
    state.user = await userInfo();
    state.settings = { ...DEFAULT_SETTINGS, ...((await loadSettings()) || {}) };
    if (sheetId(state.settings.contentSheet)) await loadData();
    rememberPage(state.user.email, state.model?.page?.name || state.raw?.title || state.user.email);
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
    readTabs(sheetId(st.contentSheet), [st.contentTab || 'Content', SCHEDULE_TAB]),
    sheetId(st.hubSheet) ? readTabs(sheetId(st.hubSheet), ['DailyStats', 'PostStats', 'Pages']) : Promise.resolve({}),
  ]);
  state.raw = { contentValues: content[st.contentTab || 'Content'], scheduleValues: content[SCHEDULE_TAB], hub, now: null, title: content._title };
  state.loadedAt = new Date();
  state.error = (content[st.contentTab || 'Content'] || []).length ? '' : `The tab “${st.contentTab}” is empty or missing in the content sheet.`;
  rebuild();
}

function rebuild() {
  if (!state.raw) return;
  state.model = buildModel({ ...state.raw, settings: state.settings, now: state.raw.now ? new Date(state.raw.now) : new Date(), rangeDays: state.range });
  if (!state.picked || !state.model.platforms.some((p) => p.id === state.picked)) state.picked = state.model.platforms[0]?.id || null;
}

/** Run a change (approve, schedule, new post), then reload. Demo mode changes only the demo data. */
async function act(label, fn, okText) {
  if (state.busy) return;
  state.busy = true; state.error = ''; state.notice = `${label}…`; render();
  try {
    await fn({ demo: DEMO, settings: state.settings, raw: state.raw });
    if (DEMO) rebuild(); else await loadData();
    state.notice = `${okText}${DEMO ? ' (demo: not saved anywhere)' : ''}`;
  } catch (e) {
    if (e instanceof AuthError) state.user = null;
    state.error = e.message; state.notice = '';
  }
  state.busy = false; render();
}

const confirmAct = (question, label, fn, okText) => { if (window.confirm(question)) act(label, fn, okText); };

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
      h('div', { class: 'who' }, h('strong', {}, DEMO ? 'Demo' : 'Signed in'), h('br'), DEMO ? 'sample data' : (state.user?.email || '')),
      h('div', { class: 'by' }, logo('me', '', 'ME Software Solutions'), h('span', { class: 'tiny' }, 'by ME Software Solutions')),
    ),
    h('div', { class: 'main' }, page(r)),
    h('nav', { class: 'tabbar', 'aria-label': 'Tabs' }, ROUTES.map((x) => h('a', { href: `#/${x.id}`, 'aria-current': r === x.id ? 'page' : null }, x.tab || x.label))),
  );
}

function header(title) {
  const m = state.model;
  const live = m.page.live === 'false' ? 'live: false (dry-run)' : m.page.live === 'true' ? 'live' : '';
  return [
    h('div', { class: 'mobile-brand' }, h('div', {}, logo('arivu', '', ARIVU_ALT)), h('div', { class: 'row' }, themeButton())),
    DEMO ? null : h('div', { class: 'mobile-switch' }, pageSwitcher()),
    h('header', { class: 'top' },
      h('div', {},
        h('h1', { class: 'ta' }, title || m.page.name || 'Your page'),
        h('span', { class: 'small' }, [new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), live].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'tools' },
        pageSwitcher('desk-switch'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' },
          [7, 30, 90].map((d) => h('button', { type: 'button', 'aria-pressed': state.range === d ? 'true' : 'false', onclick: () => { state.range = d; rebuild(); render(); } }, `${d}d`))),
        DEMO ? null : h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Refresh', title: state.loadedAt ? `Updated ${state.loadedAt.toLocaleTimeString()}` : 'Refresh', onclick: refresh }, icon.refresh()),
        themeButton('theme-btn'),
      ),
    ),
    DEMO ? h('div', { class: 'banner warn' }, 'Demo: made-up numbers for the “Daily Spark” demo page. ', h('a', { href: './' }, 'Sign in for your page')) : null,
    state.error ? h('div', { class: 'banner bad', role: 'alert' }, state.error) : null,
    state.loading ? h('div', { class: 'banner info', role: 'status' }, 'Refreshing…') : null,
    state.notice ? h('div', { class: 'banner info', role: 'status' }, state.notice) : null,
  ];
}

function themeButton(extra = '') {
  return h('button', { class: `btn round ${extra}`, type: 'button', onclick: () => { toggleTheme(); render(); }, 'aria-label': theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode' },
    icon.moon(), h('span', {}, theme() === 'dark' ? 'Light' : 'Dark'));
}

function page(r) {
  if (r === 'queue') return h('div', { class: 'col' }, header('Queue'), scheduleCard(), waitingTable(), queueTable(state.model.queue), calendarCard());
  if (r === 'new') return h('div', { class: 'col' }, header('New post'), newPostForm());
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
        skipButton(n),
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

function skipButton(q) {
  return h('button', { class: 'btn', type: 'button', disabled: state.busy || null, style: { color: 'var(--bad-fg)' },
    onclick: () => confirmAct(`Skip #${q.key}? It will not be posted (you can approve it again later).`, `Skipping #${q.key}`,
      (ctx) => setStatus(ctx, q.key, 'Skip'), `#${q.key} skipped.`) }, 'Skip');
}

function queueTable(queue, title = 'Queue') {
  const times = state.model.publishTimes.map(timeLabel).join(', ');
  return h('section', { 'aria-label': title, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, title, ' ', h('span', { class: 'small', style: { fontWeight: 400 } }, `· ${state.model.publishTimes.length} a day: ${times}`)),
    queue.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['When', '#', 'Post', 'Group', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, queue.map((q) => h('tr', {},
        h('td', { style: { whiteSpace: 'nowrap' } }, q.when, q.exact ? h('div', { class: 'tiny' }, 'own time') : null), h('td', {}, h('strong', {}, q.key)),
        h('td', { class: 'ta' }, q.title.join(' / ')), h('td', { class: 'ta small' }, q.group),
        h('td', {}, h('span', { class: 'pill ok' }, 'Approved')),
        h('td', {}, h('div', { class: 'row' },
          q.captions.length ? h('button', { class: 'btn', type: 'button', onclick: () => showCaptions(q) }, 'Captions') : null,
          skipButton(q)))))),
    )) : h('p', { class: 'small card' }, 'Nothing approved yet.'),
    h('p', { class: 'tiny' }, Object.entries(state.model.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')),
  );
}

// ---------- schedule: posts per day ----------
function scheduleCard() {
  const sc = state.model.schedule;
  const current = state.model.publishTimes.length ? state.model.publishTimes : ['19:00'];
  const times = state.draftTimes || current;
  const setCount = (n) => { state.draftTimes = suggestTimes(Math.max(1, Math.min(10, n)), times.length === n ? times : []); render(); };
  const changed = state.draftTimes && state.draftTimes.join(',') !== current.join(',');
  const save = (paused) => act('Saving the schedule', (ctx) => saveSchedule(ctx, [...times].sort(), paused),
    paused ? 'Publishing paused.' : `Saved: ${times.length} post(s) a day.`).then(() => { state.draftTimes = null; render(); });
  return h('section', { class: 'card', 'aria-label': 'Posts per day', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('div', { class: 'top' }, h('h2', { class: 'sec' }, 'Posts per day'),
      sc.paused ? h('span', { class: 'pill warn' }, 'Paused') : h('span', { class: 'pill ok' }, sc.exists ? 'Active' : 'Not set up yet')),
    h('div', { class: 'row' },
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'One post less', onclick: () => setCount(times.length - 1), disabled: times.length <= 1 || null }, '−'),
      h('strong', { style: { fontSize: '28px', minWidth: '48px', textAlign: 'center' }, 'aria-live': 'polite' }, String(times.length)),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'One post more', onclick: () => setCount(times.length + 1), disabled: times.length >= 10 || null }, '+'),
      h('span', { class: 'small' }, 'posts a day, at:')),
    h('div', { class: 'row' }, times.map((t, i) => h('label', { class: 'small', style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, `Post ${i + 1}`,
      h('input', { type: 'time', value: t, step: 300, style: { minHeight: '44px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface)', padding: '0 10px' },
        onchange: (e) => { const next = [...times]; next[i] = e.target.value; state.draftTimes = next; render(); } })))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', disabled: (!changed && sc.exists) || state.busy || null, onclick: () => save(sc.paused) }, 'Save times'),
      changed ? h('button', { class: 'btn', type: 'button', onclick: () => { state.draftTimes = null; render(); } }, 'Undo') : null,
      h('button', { class: 'btn', type: 'button', disabled: state.busy || null, onclick: () => save(!sc.paused) }, sc.paused ? 'Resume publishing' : 'Pause publishing')),
    h('p', { class: 'tiny' }, 'Times are India time. The scheduler checks every 30 minutes, so a post goes out up to 30 minutes after its time.',
      sc.lastCheck ? ` Last check: ${sc.lastCheck.replace('T', ' ').slice(0, 16)}.` : ''),
  );
}

// ---------- waiting for approval ----------
function waitingTable() {
  const list = state.model.waiting;
  return h('section', { 'aria-label': 'Waiting for approval', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('h2', { class: 'sec' }, 'Waiting for your approval ', h('span', { class: 'small', style: { fontWeight: 400 } }, `· ${list.length}`)),
    list.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Post', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, list.map((w) => h('tr', {},
        h('td', {}, h('strong', {}, w.key)),
        h('td', { class: 'ta' }, w.title.join(' / '), w.group ? h('div', { class: 'tiny' }, w.group) : null,
          w.row.error ? h('div', { class: 'tiny', style: { color: 'var(--bad-fg)' } }, w.row.error) : null),
        h('td', {}, h('span', { class: `pill ${w.status === 'Failed' ? 'bad' : w.status === 'Rendered' ? 'info' : 'warn'}` }, w.status)),
        h('td', {}, h('div', { class: 'row' },
          w.preview ? h('a', { class: 'btn', href: w.preview, target: '_blank', rel: 'noopener' }, 'Preview') : null,
          w.captions.length ? h('button', { class: 'btn', type: 'button', onclick: () => showCaptions(w) }, 'Captions') : null,
          h('button', { class: 'btn primary', type: 'button', disabled: state.busy || null,
            onclick: () => act(`Approving #${w.key}`, (ctx) => setStatus(ctx, w.key, 'Approved'), `#${w.key} approved.`) }, 'Approve'),
          h('button', { class: 'btn', type: 'button', disabled: state.busy || null, style: { color: 'var(--bad-fg)' },
            onclick: () => confirmAct(`Skip #${w.key}? It will not be posted.`, `Skipping #${w.key}`, (ctx) => setStatus(ctx, w.key, 'Skip'), `#${w.key} skipped.`) }, 'Skip')))))),
    )) : h('p', { class: 'small card' }, 'Nothing is waiting. New kurals appear here after the Monday render.'),
  );
}

// ---------- + New post ----------
function newPostForm() {
  const platforms = state.model.platforms.length ? state.model.platforms.map((p) => p.id) : PLATFORM_ORDER;
  const today = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const defaultDay = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
  const input = { minHeight: '44px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface)', padding: '0 12px' };
  const progress = h('progress', { max: 100, value: 0, style: { width: '100%', display: 'none' }, 'aria-label': 'Upload progress' });
  const preview = h('div', { class: 'small' });
  const form = h('form', { class: 'card settings', style: { maxWidth: '720px' }, onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const file = f.get('file');
    if (!file || !file.size) { state.error = 'Choose a photo or video first.'; render(); return; }
    if (file.size > 300 * 1024 * 1024) { state.error = 'The file is over 300 MB. Please make it smaller.'; render(); return; }
    const when = f.get('when');
    const post = {
      file, caption: f.get('caption') || '', hashtags: f.get('hashtags') || '', approve: f.get('approve') === 'on',
      platforms: platforms.filter((p) => f.get(`p_${p}`) === 'on'), when, at: `${f.get('day')} ${f.get('time')}`,
    };
    if (!post.platforms.length) { state.error = 'Choose at least one platform.'; render(); return; }
    if (!post.caption.trim()) { state.error = 'Write a caption.'; render(); return; }
    if (when === 'at' && !(f.get('day') && f.get('time'))) { state.error = 'Choose the date and time.'; render(); return; }
    progress.style.display = 'block';
    await act('Uploading your post', (ctx) => addPost(ctx, post, (x) => { progress.value = Math.round(x * 100); }),
      post.approve ? 'Added and approved. It is in the queue.' : 'Added. Approve it in Queue → Waiting for your approval.');
    if (!state.error) location.hash = '#/queue';
  } },
  h('label', {}, 'Photo or video',
    h('input', { name: 'file', type: 'file', accept: 'image/*,video/*', required: true, style: { ...input, padding: '10px 12px' },
      onchange: (e) => { const x = e.target.files[0]; preview.textContent = x ? `${x.type.startsWith('video/') ? 'Video' : 'Photo'} · ${(x.size / 1048576).toFixed(1)} MB` : ''; } }),
    preview,
    h('span', { class: 'hint' }, 'ARIVU makes it fit each platform: videos become 9:16 (1080×1920), photos 4:5. YouTube takes videos only.')),
  h('label', {}, 'Caption', h('textarea', { name: 'caption', rows: 6, required: true, style: { ...input, padding: '10px 12px', resize: 'vertical' },
    placeholder: 'First line is also the YouTube / Pinterest title.' }),
  h('span', { class: 'hint' }, 'ARIVU adds the page CTA, helpline (when needed) and hashtags, and keeps each platform’s limits (Instagram 5 hashtags, Threads 500 characters).')),
  h('label', {}, 'Hashtags', h('input', { name: 'hashtags', type: 'text', placeholder: '#Tamil #Motivation', style: input })),
  h('fieldset', { style: { border: '1px solid var(--border)', borderRadius: '12px', padding: '12px' } }, h('legend', {}, 'Platforms'),
    h('div', { class: 'row' }, platforms.map((p) => h('label', { style: { flexDirection: 'row', alignItems: 'center', gap: '8px', minHeight: '44px' } },
      h('input', { type: 'checkbox', name: `p_${p}`, checked: true }), PLATFORMS[p].name)))),
  h('fieldset', { style: { border: '1px solid var(--border)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } }, h('legend', {}, 'When'),
    [['next', 'Next free slot (before the queue)'], ['end', 'End of the queue'], ['at', 'At a date and time']].map(([v, l], i) =>
      h('label', { style: { flexDirection: 'row', alignItems: 'center', gap: '8px', minHeight: '44px' } }, h('input', { type: 'radio', name: 'when', value: v, checked: i === 0 }), l)),
    h('div', { class: 'row' }, h('input', { type: 'date', name: 'day', value: defaultDay, style: input, 'aria-label': 'Date' }),
      h('input', { type: 'time', name: 'time', value: '18:30', step: 300, style: input, 'aria-label': 'Time' }))),
  h('label', { style: { flexDirection: 'row', alignItems: 'center', gap: '8px', minHeight: '44px' } }, h('input', { type: 'checkbox', name: 'approve', checked: true }), 'Approve now (otherwise it waits in Queue for your approval)'),
  progress,
  h('button', { class: 'btn primary', type: 'submit', disabled: state.busy || null }, 'Upload and add'),
  DEMO ? h('p', { class: 'tiny' }, 'Demo: nothing is uploaded; the post is added to the demo data only.') : null,
  !DEMO && !state.settings.robotEmail ? h('div', { class: 'banner warn' }, 'Add the robot (service account) email in Settings before uploading.') : null,
  );
  return form;
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
      publishTimes: st.publishTimes, robotEmail: f.get('robotEmail').trim(), timezone: f.get('timezone').trim() || 'Asia/Kolkata',
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
  field('robotEmail', 'Robot (service account) email', st.robotEmail, 'The page’s service account (…@….iam.gserviceaccount.com). Your uploads are shared with it so ARIVU can post them.', 'email'),
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
    !first ? h('div', { class: 'row' }, themeButton(), DEMO ? null : [
      h('button', { class: 'btn', type: 'button', onclick: () => signOutHere(false) }, 'Sign out of this page'),
      h('button', { class: 'btn', type: 'button', onclick: () => { if (window.confirm('Forget this page on this device? (Nothing in Google is deleted.)')) signOutHere(true); } }, 'Forget this page here'),
    ]) : null,
    first && state.user ? h('button', { class: 'btn', type: 'button', onclick: () => signOutHere(false) }, 'Use a different account') : null,
    h('p', { class: 'tiny' }, `ARIVU Dashboard ${CONFIG.version} · by ME Software Solutions`),
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
    state.raw = { contentValues: demo.content, scheduleValues: demo.schedule, hub: demo.hub, now: params.get('demo') === 'live' ? null : demo.now };
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

if ('serviceWorker' in navigator) {
  // When a new version takes over (after a release), reload once so the screen shows the new code.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
}
start();
