// When to remind someone to download a backup. No DOM here, so it can be tested in Node
// (tests/backup-reminder.test.js).
(function (root) {
  const DAY = 86400000;
  const REMIND_AFTER_DAYS = 30;
  const NEW_USER_GRACE_DAYS = 7;
  const SNOOZE_DAYS = 7;

  // Returns null when no reminder is due, otherwise how many days ago the last copy was
  // (or `never: true` if there hasn't been one).
  function reminder({ lastBackup, snoozedUntil, now, oldestEntry }) {
    if (oldestEntry === null || oldestEntry === undefined) return null;
    if (snoozedUntil && now < snoozedUntil) return null;
    if (lastBackup) {
      const days = Math.floor((now - lastBackup) / DAY);
      return days >= REMIND_AFTER_DAYS ? { days, never: false } : null;
    }
    return now - oldestEntry >= NEW_USER_GRACE_DAYS * DAY ? { days: 0, never: true } : null;
  }

  const snoozeUntil = (now) => now + SNOOZE_DAYS * DAY;

  const api = { reminder, snoozeUntil, REMIND_AFTER_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BackupReminder = api;
})(typeof window !== 'undefined' ? window : globalThis);
