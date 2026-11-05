// Live timer rules. No DOM here, so this can be tested in Node (tests/timer-logic.test.js).
//
// A timer holds the stretches of real work: { id, type, updatedAt, segments: [{ start, end }] },
// in milliseconds. Pause closes the last stretch, resume opens a new one, and an `end` of
// null means it is still running.
(function (root) {
  const MIN_ACTIVE_MS = 30000;
  const CHECK_AFTER_MS = 4 * 3600000;
  const MAX_OVERNIGHT_MINUTES = 720;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const closedSegments = (timer, now) => timer.segments.map((s) => ({ start: s.start, end: s.end === null ? now : s.end }));

  const isRunning = (timer) => timer.segments[timer.segments.length - 1].end === null;

  function totals(timer, now) {
    const segments = closedSegments(timer, now);
    const activeMs = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
    return { activeMs, pausedMs: Math.max(0, now - segments[0].start - activeMs) };
  }

  // Cuts stretches at local midnight, so each calendar day gets its own entry.
  function splitByDay(segments) {
    const days = new Map();
    for (const segment of segments) {
      let from = segment.start;
      while (from < segment.end) {
        const start = new Date(from);
        const nextMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
        const to = Math.min(segment.end, nextMidnight);
        const key = dayKey(start);
        if (!days.has(key)) days.set(key, []);
        days.get(key).push({ start: from, end: to });
        from = to;
      }
    }
    return days;
  }

  function entryForDay(date, segments) {
    const activeMs = segments.reduce((sum, s) => sum + s.end - s.start, 0);
    const minutes = Math.round(activeMs / 60000);
    if (minutes < 1) return null;
    const first = new Date(segments[0].start);
    const startMinute = first.getHours() * 60 + first.getMinutes();
    // A stretch ending exactly at midnight belongs to this day: show it as 23:59.
    const last = new Date(segments[segments.length - 1].end);
    const endsAtMidnight = last.getHours() === 0 && last.getMinutes() === 0 && last.getSeconds() === 0 && last.getMilliseconds() === 0;
    let endMinute = endsAtMidnight ? 1439 : last.getHours() * 60 + last.getMinutes();
    let start = clock(first);
    // The app needs the end after the start, even for work inside one clock minute.
    if (endMinute <= startMinute) {
      if (startMinute < 1439) endMinute = startMinute + 1;
      else start = '23:58';
    }
    const fromMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
    const span = endMinute - fromMinute;
    const pausedMs = segments[segments.length - 1].end - segments[0].start - activeMs;
    const pausedMinutes = Math.round(pausedMs / 60000);
    return {
      date,
      start,
      end: `${pad(Math.floor(endMinute / 60))}:${pad(endMinute % 60)}`,
      minutes: Math.min(minutes, span),
      ...(pausedMinutes > 0 ? { pausedMinutes } : {}),
    };
  }

  // Turns a stopped timer into entries. Below 30 seconds of work there is nothing to save.
  function toEntries(timer, now) {
    if (totals(timer, now).activeMs < MIN_ACTIVE_MS) return [];
    const entries = [];
    for (const [date, segments] of splitByDay(closedSegments(timer, now))) {
      const entry = entryForDay(date, segments);
      if (entry) entries.push({ id: `${timer.id}-${date}`, type: timer.type, ...entry });
    }
    return entries;
  }

  const toMinutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  const toClock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

  // Manual entry: an end before the start means the next day, split into one entry per day.
  // Over 12 hours is far more likely a typo (10:00 to 09:00) than a real night, so it's refused.
  function manualEntries(date, start, end) {
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
    const from = toMinutes(start);
    const to = toMinutes(end);
    if (to > from) return [{ date, start, end, minutes: to - from }];
    const overnight = 1440 - from + to;
    if (to === from || overnight > MAX_OVERNIGHT_MINUTES) return null;
    const [y, m, d] = date.split('-').map(Number);
    const parts = [{ date, start, end: '23:59', minutes: 1440 - from }];
    if (to > 0) parts.push({ date: dayKey(new Date(y, m - 1, d + 1)), start: '00:00', end, minutes: to });
    return parts;
  }

  // Manual entry records what just happened: the hour ending now, on a 5-minute mark.
  function defaultTimes(now) {
    const current = now.getHours() * 60 + now.getMinutes();
    const end = Math.max(current - current % 5, 5);
    return { start: toClock(Math.max(end - 60, 0)), end: toClock(end) };
  }

  // The next entry usually follows on from the one just added.
  function followingTimes(previousEnd, now) {
    const start = toMinutes(previousEnd);
    if (start >= 1439) return defaultTimes(now);
    return { start: previousEnd, end: toClock(Math.min(start + 60, 1439)) };
  }

  // When the timer last counted: now if running, otherwise the moment it was paused.
  function lastActivity(timer, now) {
    return isRunning(timer) ? now : timer.segments[timer.segments.length - 1].end;
  }

  // Turns an "HH:MM" end time into a moment: the latest such time that isn't in the future.
  // Returns null if that's before the timer started.
  function resolveStopTime(timer, now, text) {
    if (!/^\d{2}:\d{2}$/.test(text)) return null;
    const moment = new Date(now);
    moment.setHours(Number(text.slice(0, 2)), Number(text.slice(3)), 0, 0);
    if (moment.getTime() > now) moment.setDate(moment.getDate() - 1);
    return moment.getTime() > timer.segments[0].start ? moment.getTime() : null;
  }

  // The timer as if it had been stopped at this moment.
  function stoppedAt(timer, stopMs) {
    const segments = closedSegments(timer, stopMs)
      .filter((s) => s.start < stopMs)
      .map((s) => ({ start: s.start, end: Math.min(s.end, stopMs) }));
    return { ...timer, segments };
  }

  // A running timer asks "still working?" after 4 hours, then 4 hours after each "yes".
  function needsCheck(timer, now) {
    return isRunning(timer) && totals(timer, now).activeMs - (timer.checkedMs || 0) >= CHECK_AFTER_MS;
  }

  const api = { isRunning, totals, toEntries, manualEntries, defaultTimes, followingTimes, lastActivity, resolveStopTime, stoppedAt, needsCheck, MIN_ACTIVE_MS, CHECK_AFTER_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimerLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
