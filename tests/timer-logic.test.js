// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { isRunning, totals, toEntries } = require('../timer-logic.js');
const { mergeStates } = require('../sync-merge.js');

const at = (h, m, s = 0, day = 5) => new Date(2026, 10, day, h, m, s).getTime();
const timer = (segments) => ({ id: 't1', type: 'чтение', updatedAt: 1, segments });

test('a simple run becomes one entry', () => {
  assert.deepEqual(toEntries(timer([{ start: at(9, 0), end: null }]), at(10, 30)), [
    { id: 't1-2026-11-05', type: 'чтение', date: '2026-11-05', start: '09:00', end: '10:30', minutes: 90 },
  ]);
});

test('paused time is not counted but is recorded', () => {
  const [entry] = toEntries(timer([{ start: at(9, 0), end: at(9, 30) }, { start: at(9, 45), end: null }]), at(10, 0));
  assert.equal(entry.start, '09:00');
  assert.equal(entry.end, '10:00');
  assert.equal(entry.minutes, 45);
  assert.equal(entry.pausedMinutes, 15);
});

test('stopping while paused ends at the pause, and the wait after it does not count', () => {
  const [entry] = toEntries(timer([{ start: at(9, 0), end: at(9, 30) }]), at(12, 0));
  assert.equal(entry.end, '09:30');
  assert.equal(entry.minutes, 30);
  assert.equal(entry.pausedMinutes, undefined);
});

test('totals count work and pauses, including a pause still going', () => {
  const t = timer([{ start: at(9, 0), end: at(9, 30) }]);
  assert.deepEqual(totals(t, at(10, 0)), { activeMs: 30 * 60000, pausedMs: 30 * 60000 });
  assert.equal(isRunning(t), false);
  assert.equal(isRunning(timer([{ start: at(9, 0), end: null }])), true);
});

test('a run across midnight becomes one entry per day', () => {
  const entries = toEntries(timer([{ start: at(23, 30), end: null }]), at(0, 45, 0, 6));
  assert.deepEqual(entries.map((e) => [e.date, e.start, e.end, e.minutes]), [
    ['2026-11-05', '23:30', '23:59', 29],
    ['2026-11-06', '00:00', '00:45', 45],
  ]);
  assert.notEqual(entries[0].id, entries[1].id);
});

test('a pause across midnight adds no paused time to either day', () => {
  const entries = toEntries(timer([{ start: at(23, 0), end: at(23, 30) }, { start: at(1, 0, 0, 6), end: null }]), at(2, 0, 0, 6));
  assert.deepEqual(entries.map((e) => [e.date, e.start, e.end, e.minutes, e.pausedMinutes]), [
    ['2026-11-05', '23:00', '23:30', 30, undefined],
    ['2026-11-06', '01:00', '02:00', 60, undefined],
  ]);
});

test('under 30 seconds of work saves nothing, even after a long pause', () => {
  assert.deepEqual(toEntries(timer([{ start: at(9, 0), end: null }]), at(9, 0, 29)), []);
  assert.deepEqual(toEntries(timer([{ start: at(9, 0), end: at(9, 0, 10) }]), at(15, 0)), []);
});

test('work inside one clock minute still gets a valid time range', () => {
  const [entry] = toEntries(timer([{ start: at(10, 0, 5), end: null }]), at(10, 0, 50));
  assert.deepEqual([entry.start, entry.end, entry.minutes], ['10:00', '10:01', 1]);
});

test('work in the last minute of the day still gets a valid time range', () => {
  const [entry] = toEntries(timer([{ start: at(23, 59, 5), end: at(23, 59, 50) }]), at(23, 59, 55));
  assert.deepEqual([entry.start, entry.end, entry.minutes], ['23:58', '23:59', 1]);
});

test('minutes never exceed the time range shown', () => {
  const [entry] = toEntries(timer([{ start: at(10, 0, 10), end: null }]), at(10, 1, 40));
  assert.deepEqual([entry.start, entry.end, entry.minutes], ['10:00', '10:01', 1]);
});

test('sync keeps the newest timer state', () => {
  const running = { id: 't1', type: 'a', updatedAt: 100, segments: [{ start: 1, end: null }] };
  const stopped = { updatedAt: 200, stopped: true };
  assert.deepEqual(mergeStates({ timer: stopped }, { timer: running }).timer, stopped);
  assert.deepEqual(mergeStates({ timer: running }, { timer: stopped }).timer, stopped);
  assert.deepEqual(mergeStates({ timer: running }, {}).timer, running);
  assert.deepEqual(mergeStates({}, { timer: running }).timer, running);
  assert.equal(mergeStates({}, {}).timer, null);
});

test('a running timer follows a rename from another device', () => {
  const running = { id: 't1', type: 'чтение', updatedAt: 100, segments: [{ start: 1, end: null }] };
  const cloud = { types: [['книги', '#1']], typeChanges: { 'чтение': { updatedAt: 200, deleted: true, renamedTo: 'книги' }, 'книги': { updatedAt: 200, deleted: false, color: '#1', hidden: false } } };
  assert.equal(mergeStates({ timer: running }, cloud).timer.type, 'книги');
});
