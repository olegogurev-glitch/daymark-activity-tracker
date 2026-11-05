// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { reminder, snoozeUntil } = require('../backup-reminder.js');

const DAY = 86400000;
const now = Date.UTC(2026, 10, 6, 12);

test('no entries means no reminder', () => {
  assert.equal(reminder({ now, oldestEntry: null }), null);
});

test('a new user is left alone for the first week', () => {
  assert.equal(reminder({ now, oldestEntry: now - 6 * DAY }), null);
  assert.deepEqual(reminder({ now, oldestEntry: now - 7 * DAY }), { days: 0, never: true });
});

test('a recent backup means no reminder, and 30 days brings one', () => {
  const oldestEntry = now - 400 * DAY;
  assert.equal(reminder({ now, oldestEntry, lastBackup: now - 29 * DAY }), null);
  assert.deepEqual(reminder({ now, oldestEntry, lastBackup: now - 30 * DAY }), { days: 30, never: false });
});

test('"later" hides it for a week, then it comes back', () => {
  const oldestEntry = now - 400 * DAY;
  const lastBackup = now - 40 * DAY;
  const snoozedUntil = snoozeUntil(now);
  assert.equal(reminder({ now, oldestEntry, lastBackup, snoozedUntil }), null);
  assert.equal(reminder({ now: now + 6 * DAY, oldestEntry, lastBackup, snoozedUntil }), null);
  assert.ok(reminder({ now: now + 7 * DAY, oldestEntry, lastBackup, snoozedUntil }));
});
