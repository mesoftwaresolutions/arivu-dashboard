import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildModel, compact, duration, keyColumn, rowsFromValues, sheetId, spark, upcomingSlots } from '../js/model.js';

const demo = JSON.parse(readFileSync(new URL('../demo/demo-data.json', import.meta.url), 'utf-8'));
const model = (over = {}) => buildModel({ contentValues: demo.content, hub: demo.hub, settings: demo.settings, now: new Date(demo.now), ...over });

test('sheet id from URL or bare id', () => {
  assert.equal(sheetId('https://docs.google.com/spreadsheets/d/1AbC-dEf_1234567890xyz/edit#gid=0'), '1AbC-dEf_1234567890xyz');
  assert.equal(sheetId('1AbC-dEf_1234567890xyz'), '1AbC-dEf_1234567890xyz');
  assert.equal(sheetId('not a sheet'), '');
});

test('rows, key column and number formats', () => {
  assert.equal(keyColumn(['post_order', 'kural_no', 'pal']), 'kural_no');
  assert.equal(keyColumn(['id', 'topic']), 'id');
  assert.equal(rowsFromValues([['a', 'b'], ['', ''], ['1']]).length, 1);
  assert.equal(rowsFromValues([['a', 'b'], ['1']])[0].b, '');
  assert.equal(compact(41200), '41K');
  assert.equal(compact(1234), '1.2K');
  assert.equal(compact(null), '—');
  assert.equal(duration(497000), '138h 3m');
  assert.equal(duration(248), '4m 8s');
});

test('slots: today if before publish time, tomorrow if already posted today', () => {
  const s = { publishTimes: '19:00', timezone: 'Asia/Kolkata' };
  const morning = new Date('2026-11-02T08:30:00Z');                 // 2 PM IST
  assert.deepEqual(upcomingSlots(morning, s, 0, 2), [{ date: '2026-11-02', time: '19:00' }, { date: '2026-11-03', time: '19:00' }]);
  assert.equal(upcomingSlots(morning, s, 1, 1)[0].date, '2026-11-03');
  const night = new Date('2026-11-02T15:00:00Z');                   // 8:30 PM IST
  assert.equal(upcomingSlots(night, s, 0, 1)[0].date, '2026-11-03');
  const two = upcomingSlots(morning, { ...s, publishTimes: '19:00, 09:00' }, 0, 3);
  assert.deepEqual(two.map((x) => `${x.date} ${x.time}`), ['2026-11-02 19:00', '2026-11-03 09:00', '2026-11-03 19:00']);
});

test('next post, queue and counts', () => {
  const m = model();
  assert.equal(m.key, 'id');
  assert.equal(m.next.key, '104');
  assert.equal(m.next.until, 'in 5h 0m');
  assert.deepEqual(m.next.title, ['One thing at a time', 'is the fastest way']);
  assert.ok(m.next.preview.startsWith('https://drive.google.com/'));
  assert.equal(m.next.captions[0].label, 'Instagram');
  assert.deepEqual(m.queue.map((q) => q.key), ['104', 'C-1103-1830', '105', '106']);   // own post at 3 Nov 18:30
  assert.equal(m.queue[1].slot.date, '2026-11-03');
  assert.equal(m.counts.Posted, 3);
  assert.equal(m.counts.Failed, 1);
});

test('platforms, posts and KPIs from the hub', () => {
  const m = model();
  assert.deepEqual(m.platforms.map((p) => p.id), ['instagram', 'facebook', 'threads', 'youtube']);
  const yt = m.platforms.find((p) => p.id === 'youtube');
  assert.equal(yt.followers, 890);
  assert.equal(yt.followersDelta, 170);                               // 890 - 720 (7-day range)
  assert.equal(yt.views, 41200 + 12800);                              // latest snapshot of each post
  assert.deepEqual(yt.viewSeries.map((x) => x.value), [21000, 54000]);
  assert.equal(m.posts[0].title, 'Small steps every day / build a life you love');
  assert.equal(m.posts[0].platform, 'youtube');
  assert.equal(m.kpis[0].value, '19K');                               // 12400+3100+2210+890
  assert.equal(m.kpis[3].value, '3');
  assert.equal(m.page.name, 'Daily Spark');
});

test('alerts, calendar and goals', () => {
  const m = model();
  assert.ok(m.alerts.some((a) => a.kind === 'bad' && a.text.includes('#108')));
  assert.ok(m.alerts.some((a) => a.text === 'Analytics up to date'));
  const today = m.calendar.find((d) => d.today);
  assert.equal(today.date, '2026-11-02');
  assert.ok(today.planned);
  assert.ok(m.calendar.find((d) => d.date === '2026-10-31').posted);
  assert.equal(m.calendar.length, 21);
  assert.equal(m.goals[0].value, '890 / 1K');
  assert.equal(Math.round(m.goals[0].pct), 89);
});

test('empty sheets do not crash', () => {
  const m = buildModel({ contentValues: [], hub: {}, settings: {}, now: new Date(demo.now) });
  assert.equal(m.next, null);
  assert.equal(m.platforms.length, 0);
  assert.equal(m.kpis[1].value, '0');
});

test('sparkline points', () => {
  assert.equal(spark([1, 1]), '0.0,18.0 120.0,18.0');
  assert.equal(spark([0, 10]).split(' ').length, 2);
});

import { parseSchedule, suggestTimes } from '../js/model.js';

test('schedule tab, suggested times', () => {
  const sc = parseSchedule(demo.schedule);
  assert.deepEqual(sc.times, ['12:30', '19:00']);
  assert.equal(sc.paused, false);
  assert.equal(parseSchedule([['paused', 'TRUE']]).paused, true);
  assert.equal(parseSchedule(undefined).exists, false);
  assert.deepEqual(suggestTimes(2, []), ['12:30', '19:00']);
  assert.deepEqual(suggestTimes(2, ['10:00', '18:00']), ['10:00', '18:00']);
  assert.equal(suggestTimes(9, []).length, 9);
});

test('schedule tab drives the queue; own posts with a time join it; waiting list', () => {
  const m = model({ scheduleValues: demo.schedule });
  assert.deepEqual(m.publishTimes, ['12:30', '19:00']);
  // 2 PM IST now: today 19:00, tomorrow 12:30 (own video at 18:30), tomorrow 19:00
  assert.deepEqual(m.queue.map((q) => `${q.key} ${q.slot.date} ${q.slot.time}`),
    ['104 2026-11-02 19:00', '105 2026-11-03 12:30', 'C-1103-1830 2026-11-03 18:30', '106 2026-11-03 19:00']);
  const own = m.queue.find((q) => q.custom);
  assert.equal(own.exact, true);
  assert.deepEqual(own.title, ['Behind the scenes of Daily Spark 🎬']);
  assert.equal(own.group, 'Your video');
  assert.deepEqual(m.waiting.map((w) => `${w.key}:${w.status}`), ['107:Rendered', '108:Failed', '109:Pending']);
  assert.equal(m.waiting[0].row._row, 8);                      // sheet row number for writing back
});

test('scheduler alerts', () => {
  const late = model({ scheduleValues: demo.schedule, now: new Date('2026-11-02T12:00:00Z') });   // 2h after last_check... 17:30 IST
  assert.ok(late.alerts.some((a) => a.kind === 'bad' && a.text.includes('has not checked in')));
  const paused = model({ scheduleValues: [['paused', 'true'], ['last_error', 'HTTP 401 token']] });
  assert.ok(paused.alerts.some((a) => a.text.includes('paused')));
  assert.ok(paused.alerts.some((a) => a.kind === 'bad' && a.text.includes('401')));
});
