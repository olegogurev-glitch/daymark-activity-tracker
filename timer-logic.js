// Live timer rules. No DOM here, so this can be tested in Node (tests/timer-logic.test.js).
//
// A timer holds the stretches of real work: { id, type, updatedAt, segments: [{ start, end }] },
// in milliseconds. Pause closes the last stretch, resume opens a new one, and an `end` of
// null means it is still running.
(function (root) {
  const MIN_ACTIVE_MS = 30000;
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

  const api = { isRunning, totals, toEntries, MIN_ACTIVE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimerLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
