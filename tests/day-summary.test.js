// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { summarize, dailyPhrase, LINES, PHRASES } = require('../day-summary.js');

const TODAY = '2026-11-05'; // A Thursday.
const entry = (date, minutes, type = 'работа') => ({ date, type, minutes });
const daysBefore = (n, date = TODAY) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
// Six ordinary earlier days of 120 minutes, spaced so they form no streak.
const history = [2, 4, 6, 8, 10, 12].map((n) => entry(daysBefore(n), 120, 'чтение'));
const run = (over) => summarize({ date: TODAY, today: TODAY, hour: 21, entries: [], goals: {}, jokes: true, ...over });

test('a future day gets a future line', () => {
  assert.equal(run({ date: '2026-11-06', entries: history }).kind, 'future');
});

test('before anything is logged there is a welcome, not a joke', () => {
  assert.equal(run({}).kind, 'startToday');
  assert.equal(run({ date: daysBefore(20), entries: history }).kind, 'startPast');
});

test('an empty morning gets encouragement, an empty evening gets a joke', () => {
  assert.equal(run({ entries: history, hour: 9 }).kind, 'morning');
  assert.equal(run({ entries: history, hour: 18 }).kind, 'morning');
  assert.equal(run({ entries: history, hour: 19 }).kind, 'emptyToday');
});

test('an empty past day gets its own joke', () => {
  assert.equal(run({ date: daysBefore(3), entries: history }).kind, 'emptyPast');
});

test('a weak day is judged against your usual days, and only once the day is over', () => {
  const entries = [...history, entry(TODAY, 30)];
  const result = run({ entries });
  assert.equal(result.kind, 'weak');
  assert.ok(result.text.includes('30 мин'));
  assert.equal(run({ entries, hour: 10 }).kind, 'live');
});

test('what counts as weak depends on the person', () => {
  const light = [2, 4, 6, 8, 10, 12].map((n) => entry(daysBefore(n), 40, 'чтение'));
  assert.equal(run({ entries: [...light, entry(TODAY, 30)] }).kind, 'normal');
  assert.equal(run({ entries: [...history, entry(TODAY, 30)] }).kind, 'weak');
});

test('with little history there is no teasing about a slow day', () => {
  assert.equal(run({ entries: [entry(TODAY, 20)] }).kind, 'normal');
  assert.equal(run({ entries: [entry(TODAY, 120)] }).kind, 'normal');
  assert.equal(run({ entries: [entry(TODAY, 300)] }).kind, 'strong');
});

test('a strong day is praised and names the top activity', () => {
  const entries = [...history, entry(daysBefore(1), 300), entry(TODAY, 180, 'рисование'), entry(TODAY, 20, 'ходьба')];
  const result = run({ entries });
  assert.equal(result.kind, 'strong');
  assert.ok(result.text.includes('3 ч 20 мин'));
});

test('a record for the last month is recognised', () => {
  const result = run({ entries: [...history, entry(TODAY, 400)] });
  assert.equal(result.kind, 'best');
  assert.ok(result.text.includes('6 ч 40 мин'));
});

test('a streak of three days or more is recognised, with correct wording', () => {
  const three = [entry(daysBefore(2), 30, 'рисование'), entry(daysBefore(1), 30, 'рисование'), entry(TODAY, 30, 'рисование')];
  assert.match(run({ entries: three }).text, /«рисование»: 3 дня подряд/);
  const five = [3, 4].map((n) => entry(daysBefore(n), 30, 'рисование')).concat(three);
  assert.match(run({ entries: five }).text, /5 дней подряд/);
  assert.notEqual(run({ entries: three.slice(1) }).kind, 'streak');
});

test('reaching a weekly goal on this day is recognised once', () => {
  const entries = [entry('2026-11-03', 120, 'чтение'), entry('2026-11-05', 70, 'чтение')];
  const result = run({ entries, goals: { 'чтение': 3 } });
  assert.equal(result.kind, 'goal');
  assert.match(result.text, /неделя ещё не закончилась/);
  assert.notEqual(run({ entries: [...entries, entry('2026-11-06', 30, 'чтение')], date: '2026-11-06', today: '2026-11-06', goals: { 'чтение': 3 } }).kind, 'goal');
});

test('a goal reached on Sunday says so, and last week does not count', () => {
  const entries = [entry('2026-11-07', 120, 'чтение'), entry('2026-11-08', 60, 'чтение')];
  assert.match(run({ entries, date: '2026-11-08', today: '2026-11-08', goals: { 'чтение': 3 } }).text, /к концу недели/);
  const lastWeek = [entry('2026-11-01', 170, 'чтение'), entry('2026-11-02', 20, 'чтение')];
  assert.notEqual(run({ entries: lastWeek, date: '2026-11-02', today: '2026-11-02', goals: { 'чтение': 3 } }).kind, 'goal');
});

test('with jokes off, slow and empty days get a plain line', () => {
  assert.equal(run({ entries: history, jokes: false }).text, 'Сегодня записей нет.');
  assert.equal(run({ date: daysBefore(3), entries: history, jokes: false }).text, 'В этот день записей нет.');
  assert.equal(run({ entries: [...history, entry(TODAY, 30)], jokes: false }).text, '30 мин за день.');
});

test('with jokes off, no line on any kind of day mentions the sofa or laziness', () => {
  for (let n = 0; n < 60; n++) {
    const date = daysBefore(n);
    for (const entries of [history, [...history, entry(date, 30)], [...history, entry(date, 200)], [...history, entry(date, 500)]]) {
      for (const hour of [9, 21]) {
        const { text } = summarize({ date, today: date, hour, entries, goals: {}, jokes: false });
        assert.ok(!/диван|лень/i.test(text), text);
      }
    }
  }
});

test('the same day always gets the same line, and neighbouring days differ', () => {
  const entries = history;
  assert.equal(run({ entries }).text, run({ entries }).text);
  const a = run({ date: daysBefore(3), entries }).text;
  const b = run({ date: daysBefore(5), entries }).text;
  assert.notEqual(a, b);
});

test('every line fills in its values and past-day lines never say "today"', () => {
  for (const [name, set] of Object.entries(LINES)) {
    for (const line of set) {
      const filled = line.replace('{time}', '1 ч').replace('{top}', 'работа');
      assert.ok(!filled.includes('{'), line);
      if (['weak', 'strong', 'normal', 'best', 'emptyPast', 'plainEmptyPast', 'plainWeak'].includes(name)) {
        assert.ok(!/сегодня/i.test(line), line);
      }
    }
  }
});

test('every kind of line works across a long run of days', () => {
  for (let n = 0; n < 200; n++) {
    const date = daysBefore(n);
    const result = summarize({ date, today: date, hour: 21, entries: [entry(date, n % 90), ...history], goals: {}, jokes: true });
    assert.ok(result.text.length > 5);
    assert.ok(!result.text.includes('{'));
    assert.ok(!result.text.includes('undefined'));
  }
});

test('the daily phrase stays the same all day and changes the next day', () => {
  assert.equal(dailyPhrase('2026-11-05'), dailyPhrase('2026-11-05'));
  assert.notEqual(dailyPhrase('2026-11-05'), dailyPhrase('2026-11-06'));
});

test('every phrase comes up once before any repeats', () => {
  const seen = new Set();
  for (let n = 0; n < PHRASES.length; n++) seen.add(dailyPhrase(daysBefore(n)));
  assert.equal(seen.size, PHRASES.length);
  assert.ok(PHRASES.includes('Маленькие шаги — тоже дела!'));
});

test('with jokes off the phrases skip the sofa and laziness, and never come up empty', () => {
  for (let n = 0; n < 100; n++) {
    const phrase = dailyPhrase(daysBefore(n), false);
    assert.ok(phrase);
    assert.ok(!/диван|лень|лежа/i.test(phrase), phrase);
  }
});
