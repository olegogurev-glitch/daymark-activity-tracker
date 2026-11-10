// Writes the "Итог дня" line from a day's entries. No DOM here, so it can be tested in Node
// (tests/day-summary.test.js). The line is the same on every device for the same data.
(function (root) {
  const EVENING_HOUR = 19;
  const WINDOW_DAYS = 30;
  const MIN_DAYS_FOR_USUAL = 5;

  const LINES = {
    future: ['Этот день ещё впереди. Посмотрим, что он принесёт.', 'Будущее пока без записей.', 'Этот день ещё не наступил. Диван уже волнуется.'],
    startToday: ['Здесь появится итог дня. Добавьте первое занятие.'],
    startPast: ['В этот день дневник ещё не вёлся.'],
    morning: [
      'День только начинается. Что будет первым?',
      'Пока ни одной записи, и это нормально. Ещё не вечер.',
      'Чистый лист. Самое время что-нибудь на нём написать.',
      'Диван уже зовёт. Посмотрим, кто кого.',
      'Маленький шаг, и день уже не пустой.',
      'Всё ещё впереди. Даже подвиги.',
    ],
    live: [
      'Уже {time}. День только набирает ход.',
      'На счету {time}. Продолжаем?',
      '{time} позади. Пока всё идёт хорошо.',
      'Уже {time}, а день ещё не закончен.',
      '{time} есть. Что дальше?',
    ],
    emptyToday: [
      'Сегодня диван одержал уверенную победу. Реванш завтра?',
      'Ноль записей. Зато какой отдохнувший вид!',
      'День прошёл в режиме энергосбережения.',
      'Планы на сегодня успешно перенесены на завтра. Снова.',
      'Сегодня вы берегли силы. Знать бы ещё, для чего.',
      'Лучшее занятие дня: ничего. Результат стабильный.',
      'Если бездействие считать спортом, вы сегодня в сборной.',
      'Кот бы вами гордился.',
      'Рекорд по неподвижности пока не подтверждён, но заявка сильная.',
      'Ничего не записано. Либо вы забыли записать, либо забыли сделать.',
      'Лень сегодня вышла на работу без опозданий.',
      'Дела отдыхают от вас, вы отдыхаете от дел. Все довольны.',
    ],
    emptyPast: [
      'В этот день диван победил без боя.',
      'День без записей. Историки до сих пор спорят, что это было.',
      'Этот день вы провели инкогнито.',
      'Записей нет. Алиби тоже.',
      'Тихий день. Возможно, даже слишком.',
      'В этот день дела отдыхали от вас, а вы от дел.',
      'Об этом дне известно немного. Но диван что-то знает.',
    ],
    weak: [
      '{time}. Скромно, зато без переутомления.',
      '{time}. Главное, не надорваться.',
      'Целых {time}! Можно и отдохнуть. Снова.',
      '{time}: разминка удалась, остальное потом.',
      '{time}. Диван впечатлён, но не побеждён.',
      '{time} за весь день. Экономно.',
      '{time}. Будем считать, что это был разгон.',
      '{time}. Не подвиг, но и не диван.',
      '{time}. Маленькие шаги тоже дела. Очень маленькие.',
      '{time}: темп черепахи, зато уверенный.',
    ],
    strong: [
      '{time}! Настоящая машина. Больше всего времени: {top}.',
      '{time}. Диван в этот день скучал. Лидер дня: {top}.',
      '{time}. Мощно! Главное занятие: {top}.',
      '{time}. Кому-то пора отдохнуть. Честно заслужили.',
      '{time} дел. Лень подала заявление об уходе.',
      '{time}. Такой день хочется распечатать и повесить на стену.',
      '{time}! Больше всего досталось занятию «{top}».',
    ],
    normal: [
      '{time}. Больше всего времени: {top}.',
      '{time}. Хороший, ровный день. Впереди всех: {top}.',
      '{time}, и главным стало занятие «{top}».',
      '{time}. Без рекордов, но и без дивана. Лидер дня: {top}.',
      '{time} дел. На первом месте: {top}.',
      '{time}. Стабильность тоже достижение. Больше всего: {top}.',
    ],
    best: [
      'Самый длинный день за месяц: {time}!',
      '{time}. Это ваш рекорд за последний месяц.',
      'Новый рекорд месяца: {time}. Диван в шоке.',
    ],
    // Without jokes, the same days get a plain line.
    plainEmptyToday: ['Сегодня записей нет.'],
    plainEmptyPast: ['В этот день записей нет.'],
    plainWeak: ['{time} за день.'],
  };

  // The phrase at the top of the page: one per calendar day.
  const PHRASES = [
    'Маленькие шаги — тоже дела!',
    'Диван подождёт. Он терпеливый.',
    'Начните с малого. Например, встаньте.',
    'Сегодня вы главный герой. Герои не лежат весь день.',
    'Лень — это просто привычка. И не самая ваша.',
    'Кофе сам себя не выпьет. Дела тоже сами не сделаются.',
    'Великие дела начинались со слов «ладно, пять минут».',
    'Завтра вы скажете себе спасибо. Или снова отложите.',
    'Пять минут — это не срок, а начало.',
    'Прокрастинацию тоже можно отложить на потом.',
    'Не обязательно идеально. Обязательно хоть как-нибудь.',
    'Если не вы, то кто? Кот точно не будет.',
    'Даже улитка куда-то доползает.',
    'План простой: начать, а там разберёмся.',
    'Сделано лучше, чем идеально. И лучше, чем лежит.',
    'Телефон никуда не денется. Честно.',
    'Будущий вы передаёт привет и просит начать.',
    'Один шаг сегодня — минус одна отговорка завтра.',
    'Отговорки закончились? Тогда вперёд.',
    'Вдохните. Выдохните. А теперь за дело.',
    'Мотивация придёт в процессе. Она всегда опаздывает.',
    'Ваш диван заслужил выходной.',
    'Не ждите понедельника. Он вас тоже не ждёт.',
    'Отличный день, чтобы удивить диван.',
    'Чуть-чуть — это уже не ничего.',
    'Дорогу осилит идущий. Лежащий осилит сериал.',
    'Вы справитесь. Особенно если начнёте.',
    'Дела не кусаются. Почти.',
    'Шаг за шагом. Можно даже маленькими.',
    'Главное — начать. Второе главное — не закончить на этом.',
    'Лучшее время начать было вчера. Второе лучшее — сейчас.',
    'Сегодня без подвигов. Просто немного дел.',
    'Энтузиазм загружается. Пожалуйста, начните без него.',
    'Чашка чая — и вперёд. Вторая чашка — это уже хитрость.',
    'Успех любит тех, кто хотя бы встал.',
    'Лень стучится? Вас нет дома.',
    'Сделайте что-нибудь. Потом гордитесь этим весь вечер.',
    'Кто рано встал, тот молодец. Остальные тоже успеют.',
    'Немного дел — и совесть спит спокойно.',
    'Ещё не поздно. А если поздно, то завтра.',
  ];

  // The same in English. Lines need not match the Russian one for one.
  const LINES_EN = {
    future: ['This day is still ahead. Let’s see what it brings.', 'The future has no entries yet.', 'This day hasn’t come yet. The couch is already nervous.'],
    startToday: ['Your day’s summary will appear here. Add your first activity.'],
    startPast: ['You weren’t keeping a diary yet on this day.'],
    morning: [
      'The day is just getting started. What comes first?',
      'No entries yet, and that’s fine. The day is young.',
      'A blank page. A good time to write something on it.',
      'The couch is calling. Let’s see who wins.',
      'One small step, and the day isn’t empty any more.',
      'It’s all still ahead. Even the heroic stuff.',
    ],
    live: [
      '{time} already. The day is picking up speed.',
      '{time} on the clock. Keep going?',
      '{time} done. So far, so good.',
      '{time} already, and the day isn’t over yet.',
      '{time} in the bag. What’s next?',
    ],
    emptyToday: [
      'Today the couch won a confident victory. Rematch tomorrow?',
      'Zero entries. But you look so well rested!',
      'Today ran in power-saving mode.',
      'Today’s plans were successfully moved to tomorrow. Again.',
      'You saved your energy today. If only we knew what for.',
      'Best activity of the day: nothing. Very consistent.',
      'If doing nothing were a sport, you’d make the national team today.',
      'A cat would be proud of you.',
      'The record for sitting still isn’t confirmed yet, but it was a strong attempt.',
      'Nothing logged. Either you forgot to log it, or forgot to do it.',
      'Laziness showed up for work right on time today.',
      'Your tasks rested from you, and you rested from them. Everyone’s happy.',
    ],
    emptyPast: [
      'On this day the couch won without a fight.',
      'A day with no entries. Historians still argue about what happened.',
      'You spent this day incognito.',
      'No entries. No alibi either.',
      'A quiet day. Maybe too quiet.',
      'On this day your tasks rested from you, and you from them.',
      'Little is known about this day. But the couch knows something.',
    ],
    weak: [
      '{time}. Modest, but no burnout.',
      '{time}. The main thing is not to overdo it.',
      'A whole {time}! Time for a rest. Again.',
      '{time}: a good warm-up, the rest can wait.',
      '{time}. The couch is impressed, but not defeated.',
      '{time} for the whole day. Economical.',
      '{time}. Let’s call it a run-up.',
      '{time}. Not heroic, but not the couch either.',
      '{time}. Small steps count too. Very small ones.',
      '{time}: a tortoise’s pace, but a steady one.',
    ],
    strong: [
      '{time}! A real machine. Most time went to {top}.',
      '{time}. The couch missed you that day. Leader of the day: {top}.',
      '{time}. Powerful! Main activity: {top}.',
      '{time}. Someone deserves a rest. Honestly earned.',
      '{time} of getting things done. Laziness has handed in its notice.',
      '{time}. A day worth printing out and hanging on the wall.',
      '{time}! {top} got the biggest share.',
    ],
    normal: [
      '{time}. Most time went to {top}.',
      '{time}. A good, steady day. Out in front: {top}.',
      '{time}, and {top} took the lead.',
      '{time}. No records, but no couch either. Leader of the day: {top}.',
      '{time} of getting things done. In first place: {top}.',
      '{time}. Consistency is an achievement too. Most of all: {top}.',
    ],
    best: [
      'Your longest day this month: {time}!',
      '{time}. That’s your record for the past month.',
      'New monthly record: {time}. The couch is in shock.',
    ],
    plainEmptyToday: ['No entries today.'],
    plainEmptyPast: ['No entries on this day.'],
    plainWeak: ['{time} for the day.'],
  };

  const PHRASES_EN = [
    'Small steps count too!',
    'The couch can wait. It’s patient.',
    'Start small. For example, stand up.',
    'Today you’re the main character. Main characters don’t lie around all day.',
    'Laziness is just a habit. And not really yours.',
    'The coffee won’t drink itself. The tasks won’t do themselves either.',
    'Great things began with “fine, five minutes”.',
    'Tomorrow you’ll thank yourself. Or put it off again.',
    'Five minutes isn’t a deadline, it’s a beginning.',
    'You can put off procrastinating too.',
    'It doesn’t have to be perfect. It just has to be something.',
    'If not you, then who? The cat certainly won’t.',
    'Even a snail gets somewhere.',
    'The plan is simple: start, and figure it out from there.',
    'Done is better than perfect. And better than lying down.',
    'Your phone isn’t going anywhere. Honestly.',
    'Future you says hi and asks you to start.',
    'One step today is one less excuse tomorrow.',
    'Out of excuses? Then off you go.',
    'Breathe in. Breathe out. Now get to it.',
    'Motivation turns up along the way. It’s always late.',
    'Your couch has earned a day off.',
    'Don’t wait for Monday. It isn’t waiting for you.',
    'A great day to surprise your couch.',
    'A little bit is already more than nothing.',
    'The road is conquered by those who walk. Those lying down conquer a TV series.',
    'You can do it. Especially if you start.',
    'Tasks don’t bite. Mostly.',
    'Step by step. Small steps are fine.',
    'The main thing is to start. The second main thing is not to stop there.',
    'The best time to start was yesterday. The second best is now.',
    'No heroics today. Just a few things done.',
    'Enthusiasm is loading. Please start without it.',
    'A cup of tea and off you go. A second cup is just stalling.',
    'Success loves those who at least got up.',
    'Laziness is knocking? You’re not home.',
    'Do something. Then be proud of it all evening.',
    'The early bird did great. Everyone else still has time.',
    'Get a few things done and sleep with a clear conscience.',
    'It’s not too late. And if it is, there’s tomorrow.',
  ];

  // Everything that differs by language. Unknown languages get Russian.
  const TEXT = {
    ru: {
      lines: LINES, phrases: PHRASES, jokeWords: /диван|лень/i, phraseJokeWords: /диван|лень|лежа/i, h: 'ч', min: 'мин',
      goal: (hours, type, isSunday) => `Цель выполнена: ${String(hours).replace('.', ',')} ч на занятие «${type}», ${isSunday ? 'как раз к концу недели' : 'а неделя ещё не закончилась'}.`,
      streak: (type, count) => `«${type}»: ${count} ${daysWord(count)} подряд. Похоже, это уже привычка.`,
    },
    en: {
      lines: LINES_EN, phrases: PHRASES_EN, jokeWords: /couch|laz/i, phraseJokeWords: /couch|laz|lying|lie around/i, h: 'h', min: 'min',
      goal: (hours, type, isSunday) => `Goal reached: ${hours} h of ${type}, ${isSunday ? 'just in time for the end of the week' : 'and the week isn’t over yet'}.`,
      streak: (type, count) => `“${type}”: ${count} days in a row. Looks like a habit now.`,
    },
  };
  const textFor = (lang) => TEXT[lang] || TEXT.ru;

  const dayNumber = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  };
  const dateFromNumber = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const mondayOf = (n) => n - ((n + 3) % 7); // 1970-01-01 (day 0) was a Thursday.

  function duration(minutes, text) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!h) return `${m} ${text.min}`;
    return m ? `${h} ${text.h} ${String(m).padStart(2, '0')} ${text.min}` : `${h} ${text.h}`;
  }

  function daysWord(n) {
    const a = n % 100;
    const b = n % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b === 1) return 'день';
    return b >= 2 && b <= 4 ? 'дня' : 'дней';
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // Moving one line per calendar day means a set never repeats until it has run through.
  function pick(kind, date, values, jokes, text) {
    const all = text.lines[kind];
    const set = jokes ? all : all.filter((line) => !text.jokeWords.test(line));
    const line = set[((dayNumber(date) % set.length) + set.length) % set.length];
    return line.replace('{time}', values.time || '').replace('{top}', values.top || '');
  }

  function reachedGoal(entries, goals, date) {
    const today = dayNumber(date);
    const monday = mondayOf(today);
    for (const [type, hours] of Object.entries(goals || {})) {
      let before = 0;
      let during = 0;
      for (const e of entries) {
        if (e.type !== type) continue;
        const n = dayNumber(e.date);
        if (n >= monday && n < today) before += e.minutes;
        if (n === today) during += e.minutes;
      }
      if (during > 0 && before < hours * 60 && before + during >= hours * 60) {
        const isSunday = today === monday + 6;
        return { type, hours, isSunday };
      }
    }
    return null;
  }

  function longestStreak(entries, date) {
    const daysByType = new Map();
    for (const e of entries) {
      if (!daysByType.has(e.type)) daysByType.set(e.type, new Set());
      daysByType.get(e.type).add(dayNumber(e.date));
    }
    const today = dayNumber(date);
    let best = null;
    for (const [type, days] of daysByType) {
      if (!days.has(today)) continue;
      let count = 1;
      while (days.has(today - count)) count++;
      if (count >= 3 && (!best || count > best.count)) best = { type, count };
    }
    return best;
  }

  function summarize({ date, today, hour, entries, goals, jokes = true, lang = 'ru' }) {
    const text = textFor(lang);
    const line = (kind, values = {}) => ({ kind, text: pick(kind, date, values, jokes, text) });
    if (date > today) return line('future');

    const dayEntries = entries.filter((e) => e.date === date);
    const total = dayEntries.reduce((sum, e) => sum + e.minutes, 0);
    const isLive = date === today && hour < EVENING_HOUR;
    const firstDate = entries.reduce((first, e) => (first === null || e.date < first ? e.date : first), null);

    if (total === 0) {
      if (firstDate === null || date < firstDate) return line(date === today ? 'startToday' : 'startPast');
      if (isLive) return line('morning');
      if (date === today) return line(jokes ? 'emptyToday' : 'plainEmptyToday');
      return line(jokes ? 'emptyPast' : 'plainEmptyPast');
    }

    const byType = new Map();
    for (const e of dayEntries) byType.set(e.type, (byType.get(e.type) || 0) + e.minutes);
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const values = { time: duration(total, text), top };

    const goal = reachedGoal(entries, goals, date);
    if (goal) return { kind: 'goal', text: text.goal(goal.hours, goal.type, goal.isSunday) };

    const dateNumber = dayNumber(date);
    const totals = new Map();
    for (const e of entries) {
      const n = dayNumber(e.date);
      if (n < dateNumber && n >= dateNumber - WINDOW_DAYS) totals.set(n, (totals.get(n) || 0) + e.minutes);
    }
    const history = [...totals.values()].filter((v) => v > 0);
    const hasHistory = history.length >= MIN_DAYS_FOR_USUAL;
    const usual = hasHistory ? median(history) : null;

    if (hasHistory && total > Math.max(...history)) return line('best', values);

    const streak = longestStreak(entries, date);
    if (streak) {
      return { kind: 'streak', text: text.streak(streak.type, streak.count) };
    }

    const isStrong = hasHistory ? total >= usual * 1.3 && total >= 60 : total >= 300;
    if (isStrong) return line('strong', values);
    if (isLive) return line('live', values);

    // Nobody gets teased about a slow day until the app knows what their usual day looks like.
    const isWeak = hasHistory && total < usual * 0.5;
    if (isWeak) return line(jokes ? 'weak' : 'plainWeak', values);
    return line('normal', values);
  }

  // Stepping by 7 mixes the order, and every phrase comes up once before any repeats.
  function dailyPhrase(date, jokes = true, lang = 'ru') {
    const text = textFor(lang);
    const set = jokes ? text.phrases : text.phrases.filter((phrase) => !text.phraseJokeWords.test(phrase));
    const step = 7;
    return set[(((dayNumber(date) * step) % set.length) + set.length) % set.length];
  }

  const api = { summarize, dailyPhrase, EVENING_HOUR, LINES, PHRASES, LINES_EN, PHRASES_EN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DaySummary = api;
})(typeof window !== 'undefined' ? window : globalThis);
