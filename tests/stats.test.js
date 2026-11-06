// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { periodStats } = require('../stats.js');

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
