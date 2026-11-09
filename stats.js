// Numbers behind the "Мой ритм" block. No DOM here, so it can be tested in Node
// (tests/stats.test.js). Dates are "YYYY-MM-DD" strings, read as plain calendar days.
(function (root) {
  const MONTHS_SHOWN = 12;
  const DAILY_UP_TO_DAYS = 31;

  const toNumber = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  };
  const toDate = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const mondayOf = (n) => n - ((n + 3) % 7); // 1970-01-01 (day 0) was a Thursday.
  const monthKey = (date) => date.slice(0, 7);
  const addMonths = (key, delta) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
  };
  const daysInMonth = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };

  function dayTotals(entries, type) {
    const totals = new Map();
    for (const e of entries) {
      if (type && e.type !== type) continue;
      totals.set(e.date, (totals.get(e.date) || 0) + e.minutes);
    }
    return totals;
  }

  function sumRange(totals, from, to) {
    let sum = 0;
    for (const [date, minutes] of totals) if (date >= from && date <= to) sum += minutes;
    return sum;
  }

  function dayBuckets(fromN, toN, totals, today) {
    const buckets = [];
    for (let n = fromN; n <= toN; n++) {
      const date = toDate(n);
      buckets.push({ key: date, kind: 'day', minutes: totals.get(date) || 0, isCurrent: date === today, isFuture: date > today });
    }
    return buckets;
  }

  function weekView(ref, today, totals) {
    const monday = mondayOf(toNumber(ref));
    const from = toDate(monday);
    const to = toDate(monday + 6);
    return { from, to, buckets: dayBuckets(monday, monday + 6, totals, today), comparison: compareWeek(monday, today, totals) };
  }

  function compareWeek(monday, today, totals) {
    const from = toDate(monday);
    if (from > today) return null;
    const isPartial = today <= toDate(monday + 6);
    const lastDay = isPartial ? toNumber(today) : monday + 6;
    return {
      unit: 'week',
      isPartial,
      current: sumRange(totals, from, toDate(lastDay)),
      previous: sumRange(totals, toDate(monday - 7), toDate(lastDay - 7)),
    };
  }

  function monthView(ref, today, totals) {
    const key = monthKey(ref);
    const count = daysInMonth(key);
    const first = toNumber(`${key}-01`);
    return {
      from: toDate(first),
      to: toDate(first + count - 1),
      buckets: dayBuckets(first, first + count - 1, totals, today),
      comparison: compareMonth(key, first, count, today, totals),
    };
  }

  function compareMonth(key, first, count, today, totals) {
    if (toDate(first) > today) return null;
    const isPartial = today <= toDate(first + count - 1);
    const elapsed = isPartial ? toNumber(today) - first + 1 : count;
    const previousKey = addMonths(key, -1);
    const previousFirst = toNumber(`${previousKey}-01`);
    // A finished month compares with the whole month before; a current one with the same
    // number of days into it, never past its end.
    const previousDays = isPartial ? Math.min(elapsed, daysInMonth(previousKey)) : daysInMonth(previousKey);
    return {
      unit: 'month',
      isPartial,
      current: sumRange(totals, toDate(first), toDate(first + elapsed - 1)),
      previous: sumRange(totals, toDate(previousFirst), toDate(previousFirst + previousDays - 1)),
    };
  }

  // All time: daily while the history is short (a single month bar says nothing), then by month.
  function allView(today, totals) {
    const dates = [...totals.keys()].filter((date) => date <= today).sort();
    if (!dates.length) return { from: today, to: today, buckets: [], comparison: null, grouping: 'day' };
    const firstN = toNumber(dates[0]);
    const todayN = toNumber(today);
    if (todayN - firstN < DAILY_UP_TO_DAYS) {
      return { from: dates[0], to: today, buckets: dayBuckets(firstN, todayN, totals, today), comparison: null, grouping: 'day' };
    }
    const lastKey = monthKey(today);
    const startKey = addMonths(lastKey, -(MONTHS_SHOWN - 1));
    const firstKey = monthKey(dates[0]) > startKey ? monthKey(dates[0]) : startKey;
    const buckets = [];
    for (let key = firstKey; key <= lastKey; key = addMonths(key, 1)) {
      const from = `${key}-01`;
      const to = toDate(toNumber(from) + daysInMonth(key) - 1);
      buckets.push({ key, kind: 'month', minutes: sumRange(totals, from, to), isCurrent: key === lastKey, isFuture: false });
    }
    return { from: dates[0], to: today, buckets, comparison: null, grouping: 'month', isCapped: monthKey(dates[0]) < startKey };
  }

  function periodStats({ period, ref, today, entries, type = null }) {
    const totals = dayTotals(entries, type);
    let view;
    if (period === 'week') view = weekView(ref, today, totals);
    else if (period === 'month') view = monthView(ref, today, totals);
    else view = allView(today, totals);

    let total = 0;
    let activeDays = 0;
    let bestDay = null;
    for (const [date, minutes] of totals) {
      if (date < view.from || date > view.to || minutes <= 0) continue;
      total += minutes;
      activeDays++;
      if (!bestDay || minutes > bestDay.minutes) bestDay = { date, minutes };
    }
    return { ...view, total, activeDays, bestDay, average: activeDays ? Math.round(total / activeDays) : 0 };
  }

  // Most-used activities first, by entries in the last 30 days. Ties and unused activities
  // keep the person's own order.
  function orderByUse(names, entries, today) {
    const since = toDate(toNumber(today) - 29);
    const uses = new Map();
    for (const e of entries) if (e.date >= since && e.date <= today) uses.set(e.type, (uses.get(e.type) || 0) + 1);
    return names
      .map((name, index) => ({ name, index, count: uses.get(name) || 0 }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .map((item) => item.name);
  }

  // The activity logged most recently, among those on offer.
  function lastUsed(names, entries) {
    let latest = null;
    for (const e of entries) {
      if (!names.includes(e.type)) continue;
      const moment = `${e.date} ${e.end || ''}`;
      if (!latest || moment > latest.moment) latest = { moment, type: e.type };
    }
    return latest ? latest.type : null;
  }

  // How a weekly goal stands. Early in the week nothing is said, so the goal doesn't nag.
  // In the last three days (Friday to Sunday) it is "on-track" if the time left fits the
  // goal's usual daily share (a seventh of it) for each remaining day, today included, and
  // "at-risk" if not. A reached goal is "done" whenever it happens.
  const LAST_DAYS = 3;
  function goalStatus({ targetMinutes, minutes, weekFrom, today }) {
    if (minutes >= targetMinutes) return { state: 'done' };
    const monday = mondayOf(toNumber(weekFrom));
    const todayN = toNumber(today);
    if (todayN < monday || todayN > monday + 6) return { state: todayN > monday + 6 ? 'past' : 'future' };
    const daysLeft = monday + 6 - todayN + 1;
    if (daysLeft > LAST_DAYS) return { state: 'early' };
    const remaining = targetMinutes - minutes;
    return { state: remaining <= (targetMinutes / 7) * daysLeft ? 'on-track' : 'at-risk', remaining, daysLeft };
  }

  const api = { periodStats, orderByUse, lastUsed, goalStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StatsLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
