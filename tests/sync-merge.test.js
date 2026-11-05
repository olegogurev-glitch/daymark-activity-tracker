// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { mergeStates, canonical } = require('../sync-merge.js');

const entry = (over = {}) => ({ id: 'e1', date: '2026-11-05', type: 'чтение', start: '09:00', end: '10:00', minutes: 60, note: '', ...over });
const names = (state) => state.types.map(([name]) => name);

test('a newer edit survives a device holding an old copy', () => {
  const cloud = { activities: [entry({ note: 'new', updatedAt: 200 })] };
  const stale = { activities: [entry({ note: 'old', updatedAt: 100 })] };
  assert.equal(mergeStates(stale, cloud).activities[0].note, 'new');
});

test('an unstamped old copy does not overwrite a stamped edit', () => {
  const cloud = { activities: [entry({ note: 'new', updatedAt: 200 })] };
  const stale = { activities: [entry({ note: 'old' })] };
  assert.equal(mergeStates(stale, cloud).activities[0].note, 'new');
});

test('a newer local edit reaches the cloud', () => {
  const cloud = { activities: [entry({ note: 'old', updatedAt: 100 })] };
  const local = { activities: [entry({ note: 'new', updatedAt: 200 })] };
  assert.equal(mergeStates(local, cloud).activities[0].note, 'new');
});

test('with no stamps at all the cloud copy wins', () => {
  assert.equal(mergeStates({ activities: [entry({ note: 'device' })] }, { activities: [entry({ note: 'cloud' })] }).activities[0].note, 'cloud');
});

test('entries added on different devices are both kept', () => {
  const merged = mergeStates({ activities: [entry({ id: 'a' })] }, { activities: [entry({ id: 'b' })] });
  assert.deepEqual(merged.activities.map((x) => x.id).sort(), ['a', 'b']);
});

test('a deleted entry stays deleted, even if another device edited it later', () => {
  const merged = mergeStates({ activities: [entry({ updatedAt: 999 })] }, { deletedIds: ['e1'] });
  assert.equal(merged.activities.length, 0);
  assert.deepEqual(merged.deletedIds, ['e1']);
});

test('a rename beats a stale device, and its entries follow', () => {
  const cloud = {
    activities: [entry({ type: 'книги', updatedAt: 200 })],
    types: [['книги', '#111111']],
    deletedTypes: ['чтение'],
    typeChanges: {
      'чтение': { updatedAt: 200, deleted: true, renamedTo: 'книги' },
      'книги': { updatedAt: 200, deleted: false, color: '#111111', hidden: false },
    },
  };
  const stale = { activities: [entry({ type: 'чтение' })], types: [['чтение', '#111111']] };
  const merged = mergeStates(stale, cloud);
  assert.equal(merged.activities[0].type, 'книги');
  assert.deepEqual(names(merged), ['книги']);
});

test('an entry logged under the old name after a rename moves to the new name', () => {
  const cloud = {
    types: [['книги', '#111111']],
    typeChanges: {
      'чтение': { updatedAt: 200, deleted: true, renamedTo: 'книги' },
      'книги': { updatedAt: 200, deleted: false, color: '#111111', hidden: false },
    },
  };
  const merged = mergeStates({ activities: [entry({ type: 'чтение', updatedAt: 300 })], types: [['чтение', '#111111']] }, cloud);
  assert.equal(merged.activities[0].type, 'книги');
});

test('renaming A to B and back to A ends on A', () => {
  const changes = {
    A: { updatedAt: 300, deleted: false, color: '#111111', hidden: false },
    B: { updatedAt: 300, deleted: true, renamedTo: 'A' },
  };
  const merged = mergeStates({ activities: [entry({ type: 'B', updatedAt: 250 })], types: [['B', '#111111']] }, { types: [['A', '#111111']], typeChanges: changes });
  assert.equal(merged.activities[0].type, 'A');
  assert.deepEqual(names(merged), ['A']);
});

test('unhiding sticks', () => {
  const cloud = { types: [['танцы', '#111111']], hidden: ['танцы'], typeChanges: { 'танцы': { updatedAt: 100, deleted: false, color: '#111111', hidden: true } } };
  const local = { types: [['танцы', '#111111']], hidden: [], typeChanges: { 'танцы': { updatedAt: 200, deleted: false, color: '#111111', hidden: false } } };
  assert.deepEqual(mergeStates(local, cloud).hidden, []);
});

test('legacy hidden types stay hidden when nothing is stamped', () => {
  const merged = mergeStates({ types: [['танцы', '#111111']] }, { types: [['танцы', '#111111']], hidden: ['танцы'] });
  assert.deepEqual(merged.hidden, ['танцы']);
});

test('a reorder sticks, and a type added elsewhere is not lost', () => {
  const cloud = { types: [['a', '#1'], ['b', '#2'], ['new', '#3']] };
  const local = { types: [['b', '#2'], ['a', '#1']], typeOrder: { updatedAt: 200, names: ['b', 'a'] } };
  assert.deepEqual(names(mergeStates(local, cloud)), ['b', 'a', 'new']);
});

test('a deleted type can be created again', () => {
  const cloud = { deletedTypes: ['вязание'], typeChanges: { 'вязание': { updatedAt: 100, deleted: true } } };
  const local = { types: [['вязание', '#123456']], typeChanges: { 'вязание': { updatedAt: 200, deleted: false, color: '#123456', hidden: false } } };
  const merged = mergeStates(local, cloud);
  assert.deepEqual(names(merged), ['вязание']);
  assert.deepEqual(merged.deletedTypes, []);
});

test('a type missing from a saved order is still kept', () => {
  const order = { updatedAt: 100, names: ['a'] };
  const merged = mergeStates(
    { types: [['a', '#1'], ['вязание', '#2']], typeOrder: order, typeChanges: { 'вязание': { updatedAt: 200, deleted: false, color: '#2', hidden: false } } },
    { types: [['a', '#1']], typeOrder: order, deletedTypes: ['вязание'], typeChanges: { 'вязание': { updatedAt: 150, deleted: true } } },
  );
  assert.deepEqual(names(merged), ['a', 'вязание']);
});

test('a legacy deletion beats default types on a new device', () => {
  const merged = mergeStates({ types: [['вязание', '#1']] }, { deletedTypes: ['вязание'], types: [] });
  assert.deepEqual(names(merged), []);
});

test('deleting a type removes its goal, but a goal set later survives', () => {
  const deleted = { 'танцы': { updatedAt: 200, deleted: true } };
  const removed = mergeStates({ goals: { 'танцы': 3 }, goalChanges: { 'танцы': { updatedAt: 100, target: 3, deleted: false } } }, { typeChanges: deleted });
  assert.deepEqual(removed.goals, {});
  const kept = mergeStates({ goals: { 'танцы': 3 }, goalChanges: { 'танцы': { updatedAt: 300, target: 3, deleted: false } } }, { typeChanges: deleted });
  assert.deepEqual(kept.goals, { 'танцы': 3 });
});

test('a newer goal wins, and legacy goals are kept', () => {
  const merged = mergeStates(
    { goals: { a: 5, old: 2 }, goalChanges: { a: { updatedAt: 200, target: 5, deleted: false } } },
    { goals: { a: 3 }, goalChanges: { a: { updatedAt: 100, target: 3, deleted: false } } },
  );
  assert.deepEqual(merged.goals, { a: 5, old: 2 });
});

test('merging again changes nothing, which is what stops the endless sync', () => {
  const local = {
    activities: [entry({ updatedAt: 5 }), entry({ id: 'x', type: 'старое' })],
    types: [['чтение', '#1'], ['танцы', '#2']],
    hidden: ['танцы'],
    deletedTypes: ['вязание'],
    deletedIds: ['z'],
    goals: { 'чтение': 3 },
    deletedGoals: ['вязание'],
  };
  const remote = { activities: [entry({ id: 'y' })], types: [['ходьба', '#3']], deletedTypes: ['бег'], goals: { 'бег': 1 } };
  const once = mergeStates(local, remote);
  assert.equal(canonical(mergeStates(once, once)), canonical(once));
  assert.equal(canonical(mergeStates(local, once)), canonical(once));
  assert.equal(canonical(mergeStates(remote, once)), canonical(once));
});

test('an entry whose type no longer exists is kept, not dropped', () => {
  const merged = mergeStates({ activities: [entry({ type: 'нет такого' })] }, {});
  assert.equal(merged.activities.length, 1);
});

test('merging with an empty or missing cloud row is safe', () => {
  assert.deepEqual(names(mergeStates({ types: [['a', '#1']] }, null)), ['a']);
  assert.deepEqual(mergeStates({}, {}).activities, []);
});

test('canonical ignores set order but sees real differences', () => {
  assert.equal(canonical({ deletedIds: ['a', 'b'] }), canonical({ deletedIds: ['b', 'a'] }));
  assert.notEqual(canonical({ types: [['a'], ['b']] }), canonical({ types: [['b'], ['a']] }));
});

test('the newest highlight for a day wins, and other days are kept', () => {
  const local = { highlights: { '2026-11-05': { text: 'новое', updatedAt: 200 }, '2026-11-04': { text: 'вчера', updatedAt: 50 } } };
  const remote = { highlights: { '2026-11-05': { text: 'старое', updatedAt: 100 }, '2026-11-03': { text: 'раньше', updatedAt: 40 } } };
  const merged = mergeStates(local, remote).highlights;
  assert.equal(merged['2026-11-05'].text, 'новое');
  assert.equal(merged['2026-11-04'].text, 'вчера');
  assert.equal(merged['2026-11-03'].text, 'раньше');
  assert.equal(mergeStates({ highlights: { d: { text: 'старое', updatedAt: 100 } } }, { highlights: { d: { text: 'новое', updatedAt: 200 } } }).highlights.d.text, 'новое');
});

test('a cleared highlight stays cleared against an older copy', () => {
  const merged = mergeStates({ highlights: { d: { text: 'старое', updatedAt: 100 } } }, { highlights: { d: { text: '', updatedAt: 200 } } });
  assert.equal(merged.highlights.d.text, '');
});

test('data without highlights merges to an empty set', () => {
  assert.deepEqual(mergeStates({}, null).highlights, {});
});
