// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { isRunning, totals, toEntries, manualEntries, defaultTimes, followingTimes, lastActivity, resolveStopTime, stoppedAt, needsCheck } = require('../timer-logic.js');
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

test('a normal manual entry stays one entry', () => {
  assert.deepEqual(manualEntries('2026-11-05', '09:00', '10:30'), [{ date: '2026-11-05', start: '09:00', end: '10:30', minutes: 90 }]);
});

test('an overnight manual entry splits across the two days, with the full time counted', () => {
  assert.deepEqual(manualEntries('2026-11-05', '23:00', '01:00'), [
    { date: '2026-11-05', start: '23:00', end: '23:59', minutes: 60 },
    { date: '2026-11-06', start: '00:00', end: '01:00', minutes: 60 },
  ]);
});

test('overnight entries handle the end of a month and of a year', () => {
  assert.equal(manualEntries('2026-11-30', '23:00', '01:00')[1].date, '2026-12-01');
  assert.equal(manualEntries('2026-12-31', '23:00', '01:00')[1].date, '2027-01-01');
});

test('ending exactly at midnight stays on the first day', () => {
  assert.deepEqual(manualEntries('2026-11-05', '22:00', '00:00'), [{ date: '2026-11-05', start: '22:00', end: '23:59', minutes: 120 }]);
});

test('equal times, likely typos and bad values are refused', () => {
  assert.equal(manualEntries('2026-11-05', '10:00', '10:00'), null);
  assert.equal(manualEntries('2026-11-05', '10:00', '09:00'), null);
  assert.equal(manualEntries('2026-11-05', '', '09:00'), null);
  assert.ok(manualEntries('2026-11-05', '20:00', '08:00'));
  assert.equal(manualEntries('2026-11-05', '20:00', '08:01'), null);
});

test('the form starts with the hour ending now, on a 5-minute mark', () => {
  assert.deepEqual(defaultTimes(new Date(2026, 10, 5, 14, 37)), { start: '13:35', end: '14:35' });
  assert.deepEqual(defaultTimes(new Date(2026, 10, 5, 0, 20)), { start: '00:00', end: '00:20' });
  assert.deepEqual(defaultTimes(new Date(2026, 10, 5, 0, 2)), { start: '00:00', end: '00:05' });
  assert.deepEqual(defaultTimes(new Date(2026, 10, 5, 23, 59)), { start: '22:55', end: '23:55' });
});

test('after adding, the form continues from the last end time', () => {
  const now = new Date(2026, 10, 5, 14, 37);
  assert.deepEqual(followingTimes('10:00', now), { start: '10:00', end: '11:00' });
  assert.deepEqual(followingTimes('23:30', now), { start: '23:30', end: '23:59' });
  assert.deepEqual(followingTimes('23:59', now), { start: '13:35', end: '14:35' });
});

test('the last activity is now while running, or the moment of the pause', () => {
  assert.equal(lastActivity(timer([{ start: at(9, 0), end: null }]), at(10, 0)), at(10, 0));
  assert.equal(lastActivity(timer([{ start: at(9, 0), end: at(9, 30) }]), at(12, 0)), at(9, 30));
});

test('an end time means the latest such time that is not in the future', () => {
  const t = timer([{ start: at(22, 0), end: null }]);
  assert.equal(resolveStopTime(t, at(23, 30), '23:00'), at(23, 0));
  assert.equal(resolveStopTime(t, at(1, 0, 0, 6), '23:15'), at(23, 15));
  assert.equal(resolveStopTime(t, at(1, 0, 0, 6), '00:30'), at(0, 30, 0, 6));
});

test('an end time before the start, or a bad value, is refused', () => {
  const t = timer([{ start: at(9, 0), end: null }]);
  assert.equal(resolveStopTime(t, at(10, 0), '08:00'), null);
  assert.equal(resolveStopTime(t, at(10, 0), '09:00'), null);
  assert.equal(resolveStopTime(t, at(10, 0), '11:00'), null);
  assert.equal(resolveStopTime(t, at(10, 0), ''), null);
});

test('correcting the end cuts a forgotten timer down to the real time', () => {
  const forgotten = timer([{ start: at(9, 0), end: null }]);
  const fixed = stoppedAt(forgotten, at(10, 0));
  assert.deepEqual(toEntries(fixed, at(10, 0)).map((e) => [e.start, e.end, e.minutes]), [['09:00', '10:00', 60]]);
});

test('correcting the end drops stretches after it and keeps earlier pauses', () => {
  const t = timer([{ start: at(9, 0), end: at(9, 30) }, { start: at(10, 0), end: at(11, 0) }, { start: at(12, 0), end: null }]);
  const [entry] = toEntries(stoppedAt(t, at(10, 30)), at(10, 30));
  assert.deepEqual([entry.start, entry.end, entry.minutes, entry.pausedMinutes], ['09:00', '10:30', 60, 30]);
});

test('a timer forgotten overnight, corrected to the evening, stays on one day', () => {
  const t = timer([{ start: at(20, 0), end: null }]);
  const entries = toEntries(stoppedAt(t, at(21, 0)), at(21, 0));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, '2026-11-05');
});

test('"still working?" appears after 4 hours, and again 4 hours after a yes', () => {
  const t = timer([{ start: at(8, 0), end: null }]);
  assert.equal(needsCheck(t, at(11, 59)), false);
  assert.equal(needsCheck(t, at(12, 0)), true);
  const confirmed = { ...t, checkedMs: 4 * 3600000 };
  assert.equal(needsCheck(confirmed, at(15, 59)), false);
  assert.equal(needsCheck(confirmed, at(16, 0)), true);
});

test('a paused timer never asks, and pauses do not count towards the 4 hours', () => {
  assert.equal(needsCheck(timer([{ start: at(8, 0), end: at(9, 0) }]), at(20, 0)), false);
  const t = timer([{ start: at(8, 0), end: at(9, 0) }, { start: at(14, 0), end: null }]);
  assert.equal(needsCheck(t, at(16, 0)), false);
  assert.equal(needsCheck(t, at(17, 0)), true);
});

const run = (id, type, updatedAt) => ({ id, type, updatedAt, segments: [{ start: 1, end: null }] });

test('two timers run side by side and sync on their own', () => {
  const a = run('a', 'чтение', 100), b = run('b', 'ходьба', 150);
  const merged = mergeStates({ timers: { a } }, { timers: { b } });
  assert.deepEqual(Object.keys(merged.timers).sort(), ['a', 'b']);
  // Stopping one on another device leaves the other running.
  const stopped = { id: 'a', updatedAt: 200, stopped: true };
  const after = mergeStates({ timers: { a, b } }, { timers: { a: stopped, b } });
  assert.deepEqual(after.timers.a, stopped);
  assert.deepEqual(after.timers.b, b);
  // An older tab sees the most recently changed running timer.
  assert.deepEqual(after.timer, b);
});

test('a timer started in an older tab joins the list', () => {
  const a = run('a', 'чтение', 100), old = run('x', 'танцы', 300);
  const merged = mergeStates({ timers: { a }, timer: a }, { timer: old });
  assert.deepEqual(Object.keys(merged.timers).sort(), ['a', 'x']);
});

test('a stop from an older tab stops the timer it was showing, not the others', () => {
  const a = run('a', 'чтение', 100), b = run('b', 'ходьба', 150);
  // This tab told older tabs about b; an older tab then stopped it (a stop has no id there).
  const merged = mergeStates({ timers: { a, b }, timer: b }, { timer: { updatedAt: 400, stopped: true } });
  assert.equal(merged.timers.b.stopped, true);
  assert.equal(merged.timers.a.stopped, undefined);
});

test('old stopped timers are dropped after 30 days, running ones are kept', () => {
  const day = 86400000;
  const merged = mergeStates({ timers: { s: { id: 's', updatedAt: day, stopped: true }, a: run('a', 'чтение', 2 * day), n: run('n', 'чтение', 40 * day) } }, {});
  assert.deepEqual(Object.keys(merged.timers).sort(), ['a', 'n']);
});

test('every running timer follows a rename', () => {
  const cloud = { types: [['книги', '#1']], typeChanges: { 'чтение': { updatedAt: 200, deleted: true, renamedTo: 'книги' }, 'книги': { updatedAt: 200, deleted: false, color: '#1', hidden: false } } };
  const merged = mergeStates({ timers: { a: run('a', 'чтение', 1), b: run('b', 'чтение', 2) } }, cloud);
  assert.deepEqual(Object.values(merged.timers).map((t) => t.type), ['книги', 'книги']);
});
