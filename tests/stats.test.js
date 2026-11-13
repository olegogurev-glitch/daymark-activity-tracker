// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { periodStats, orderByUse, lastUsed, goalStatus } = require('../stats.js');

const TODAY = '2026-11-05'; // A Thursday.
const e = (date, minutes, type = 'работа') => ({ date, minutes, type });
const week = (entries, over = {}) => periodStats({ period: 'week', ref: TODAY, today: TODAY, entries, ...over });
const month = (entries, over = {}) => periodStats({ period: 'month', ref: TODAY, today: TODAY, entries, ...over });
const all = (entries, over = {}) => periodStats({ period: 'all', ref: TODAY, today: TODAY, entries, ...over });

test('a week runs Monday to Sunday, marking today and the days still ahead', () => {
  const s = week([e('2026-11-02', 60), e('2026-11-05', 30)]);
  assert.deepEqual(s.buckets.map((b) => b.key), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.deepEqual(s.buckets.map((b) => b.minutes), [60, 0, 0, 30, 0, 0, 0]);
  assert.equal(s.buckets[3].isCurrent, true);
  assert.deepEqual(s.buckets.map((b) => b.isFuture), [false, false, false, false, true, true, true]);
});

test('totals, active days, average and best day cover only the period', () => {
  const s = week([e('2026-11-01', 999), e('2026-11-02', 60), e('2026-11-02', 30), e('2026-11-04', 150)]);
  assert.equal(s.total, 240);
  assert.equal(s.activeDays, 2);
  assert.equal(s.average, 120);
  assert.deepEqual(s.bestDay, { date: '2026-11-04', minutes: 150 });
});

test('this week compares with the same days of last week, not all of it', () => {
  const entries = [e('2026-11-03', 100), e('2026-10-27', 40), e('2026-10-31', 500)];
  const c = week(entries).comparison;
  assert.equal(c.isPartial, true);
  assert.equal(c.current, 100);
  assert.equal(c.previous, 40);
});

test('a finished week compares with the whole week before', () => {
  const entries = [e('2026-10-26', 100), e('2026-10-25', 30), e('2026-10-19', 20)];
  const c = week(entries, { ref: '2026-10-28' }).comparison;
  assert.equal(c.isPartial, false);
  assert.equal(c.current, 100);
  assert.equal(c.previous, 50);
});

test('a future week has no comparison', () => {
  assert.equal(week([], { ref: '2026-11-20' }).comparison, null);
});

test('a month has one bucket per day, including leap years', () => {
  assert.equal(month([]).buckets.length, 30);
  assert.equal(month([], { ref: '2028-02-10', today: '2028-03-20' }).buckets.length, 29);
  assert.equal(month([], { ref: '2027-02-10', today: '2027-03-20' }).buckets.length, 28);
});

test('this month compares with the same number of days last month', () => {
  const entries = [e('2026-11-03', 100), e('2026-10-05', 40), e('2026-10-06', 500)];
  const c = month(entries).comparison;
  assert.equal(c.isPartial, true);
  assert.equal(c.current, 100);
  assert.equal(c.previous, 40);
});

test('comparing with a shorter month stops at its end', () => {
  const entries = [e('2026-03-31', 100), e('2026-02-28', 40), e('2026-03-01', 7)];
  const c = month(entries, { ref: '2026-03-31', today: '2026-03-31' }).comparison;
  assert.equal(c.current, 107);
  assert.equal(c.previous, 40);
});

test('a finished month compares with the whole month before', () => {
  const entries = [e('2026-02-28', 40), e('2026-02-01', 60), e('2026-01-31', 10), e('2026-01-01', 5)];
  const c = month(entries, { ref: '2026-02-10' }).comparison;
  assert.equal(c.isPartial, false);
  assert.equal(c.current, 100);
  assert.equal(c.previous, 15);
});

test('January compares with December of the year before', () => {
  const c = month([e('2027-01-02', 10), e('2026-12-02', 20)], { ref: '2027-01-05', today: '2027-01-05' }).comparison;
  assert.equal(c.previous, 20);
});

test('all time with a short history shows days, not one lonely month bar', () => {
  const s = all([e('2026-11-03', 60), e('2026-11-05', 30)]);
  assert.equal(s.grouping, 'day');
  assert.deepEqual(s.buckets.map((b) => b.key), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(s.comparison, null);
});

test('all time with a longer history shows months', () => {
  const s = all([e('2026-08-15', 60), e('2026-08-20', 30), e('2026-11-05', 15)]);
  assert.equal(s.grouping, 'month');
  assert.deepEqual(s.buckets.map((b) => [b.key, b.minutes]), [['2026-08', 90], ['2026-09', 0], ['2026-10', 0], ['2026-11', 15]]);
  assert.equal(s.buckets.at(-1).isCurrent, true);
});

test('over a year of history shows the last 12 months, but totals count everything', () => {
  const s = all([e('2024-01-10', 100), e('2026-11-05', 15)]);
  assert.equal(s.buckets.length, 12);
  assert.equal(s.buckets[0].key, '2025-12');
  assert.equal(s.isCapped, true);
  assert.equal(s.total, 115);
});

test('all time with no entries is empty', () => {
  const s = all([]);
  assert.deepEqual(s.buckets, []);
  assert.equal(s.total, 0);
  assert.equal(s.bestDay, null);
});

test('filtering by activity applies to bars, totals and the comparison', () => {
  const entries = [e('2026-11-03', 100, 'чтение'), e('2026-11-03', 50, 'работа'), e('2026-10-27', 40, 'чтение'), e('2026-10-27', 70, 'работа')];
  const s = week(entries, { type: 'чтение' });
  assert.equal(s.total, 100);
  assert.equal(s.comparison.previous, 40);
  assert.equal(s.buckets[1].minutes, 100);
});

test('most-used activities come first, by entries in the last 30 days', () => {
  const entries = [e('2026-11-01', 10, 'ходьба'), e('2026-11-02', 10, 'ходьба'), e('2026-11-03', 500, 'работа')];
  assert.deepEqual(orderByUse(['работа', 'чтение', 'ходьба'], entries, TODAY), ['ходьба', 'работа', 'чтение']);
});

test('old entries do not count, and ties keep the person\'s own order', () => {
  const entries = [e('2026-10-06', 10, 'старое'), e('2026-10-07', 10, 'новое'), e('2026-10-05', 10, 'старое')];
  assert.deepEqual(orderByUse(['старое', 'новое', 'третье'], entries, TODAY), ['новое', 'старое', 'третье']);
  assert.deepEqual(orderByUse(['б', 'а'], [], TODAY), ['б', 'а']);
});

test('future entries do not count towards use', () => {
  assert.deepEqual(orderByUse(['а', 'б'], [e('2026-11-20', 10, 'б')], TODAY), ['а', 'б']);
});

test('the last used activity is the most recent entry on offer', () => {
  const entries = [
    { date: '2026-11-05', end: '09:00', type: 'работа', minutes: 1 },
    { date: '2026-11-05', end: '20:00', type: 'чтение', minutes: 1 },
    { date: '2026-11-04', end: '23:00', type: 'ходьба', minutes: 1 },
  ];
  assert.equal(lastUsed(['работа', 'чтение', 'ходьба'], entries), 'чтение');
  assert.equal(lastUsed(['работа', 'ходьба'], entries), 'работа');
  assert.equal(lastUsed(['работа'], []), null);
});

// Week of Monday 2026-11-09 to Sunday 2026-11-15; goal of 3 hours (about 26 minutes a day).
const goal = (minutes, today) => goalStatus({ targetMinutes: 180, minutes, weekFrom: '2026-11-09', today });

test('a goal says nothing early in the week, unless it is already reached', () => {
  assert.deepEqual(goal(0, '2026-11-12'), { state: 'early' });
  assert.deepEqual(goal(180, '2026-11-10'), { state: 'done' });
});

test('from Friday a goal is on track while the rest fits its usual daily share', () => {
  assert.deepEqual(goal(120, '2026-11-13'), { state: 'on-track', remaining: 60, daysLeft: 3 });
  assert.deepEqual(goal(60, '2026-11-13'), { state: 'at-risk', remaining: 120, daysLeft: 3 });
  assert.deepEqual(goal(160, '2026-11-15'), { state: 'on-track', remaining: 20, daysLeft: 1 });
  assert.deepEqual(goal(140, '2026-11-15'), { state: 'at-risk', remaining: 40, daysLeft: 1 });
});

test('a goal for another week is past or future, any day of that week works as its start', () => {
  assert.deepEqual(goal(10, '2026-11-16'), { state: 'past' });
  assert.deepEqual(goal(10, '2026-11-08'), { state: 'future' });
  assert.deepEqual(goalStatus({ targetMinutes: 180, minutes: 0, weekFrom: '2026-11-12', today: '2026-11-14' }).daysLeft, 2);
});

const { weekReview, previousWeekStart } = require('../stats.js');

test('last week is the Monday-to-Sunday week before today’s', () => {
  assert.equal(previousWeekStart('2026-11-13'), '2026-11-02'); // Friday
  assert.equal(previousWeekStart('2026-11-09'), '2026-11-02'); // Monday
  assert.equal(previousWeekStart('2026-11-08'), '2026-10-26'); // Sunday
});

test('a week review counts goals, days and each activity', () => {
  const entries = [
    e('2026-11-02', 120, 'рисование'), e('2026-11-04', 90, 'рисование'), e('2026-11-04', 40, 'чтение'),
    e('2026-11-08', 45, 'чтение'), e('2026-11-09', 500, 'чтение'), // next week: left out
    e('2026-10-30', 60, 'рисование'), e('2026-10-28', 40, 'танцы'), // the week before
  ];
  const r = weekReview({ ref: '2026-11-05', entries, goals: { 'рисование': 3, 'чтение': 2, 'танцы': 1 } });
  assert.equal(r.from, '2026-11-02');
  assert.equal(r.to, '2026-11-08');
  assert.equal(r.total, 295);
  assert.equal(r.previousTotal, 100);
  assert.equal(r.sessions, 4);
  assert.equal(r.activeDays, 3);
  assert.deepEqual(r.bestDay, { date: '2026-11-04', minutes: 130 });
  assert.deepEqual(r.days.map((d) => d.minutes), [120, 0, 130, 0, 0, 0, 45]);
  assert.deepEqual(r.activities, [
    { type: 'рисование', minutes: 210, sessions: 2, previousMinutes: 60, days: 2 },
    { type: 'чтение', minutes: 85, sessions: 2, previousMinutes: 0, days: 2 },
  ]);
  assert.equal(r.goalsDone, 1);
  assert.deepEqual(r.goals.map((g) => [g.type, g.done, g.missing]), [['рисование', true, 0], ['чтение', false, 35], ['танцы', false, 60]]);
});

test('an empty week has no best day, and broken goals are skipped', () => {
  const r = weekReview({ ref: '2026-11-05', entries: [], goals: { 'чтение': 0, 'танцы': 'x' } });
  assert.equal(r.total, 0);
  assert.equal(r.bestDay, null);
  assert.deepEqual(r.goals, []);
});
