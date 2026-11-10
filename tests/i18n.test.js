// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EN, PLURAL, LISTS } = require('../i18n.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('every Russian line the page translates has an English version', () => {
  const missing = [];
  for (const call of html.matchAll(/T\(([^()]*?)(?:,\{|\))/g)) {
    for (const [, key] of call[1].matchAll(/'([^']*)'/g)) {
      if (/[а-яё]/i.test(key) && !(key in EN) && !PLURAL[key] && key !== 'Русский текст {x}') missing.push(key);
    }
  }
  assert.deepEqual(missing, []);
});

test('every word that changes with a number has English forms', () => {
  const missing = [...html.matchAll(/plural\([^,]+,'([^']*)'/g)].map((m) => m[1]).filter((one) => !PLURAL[one]);
  assert.deepEqual(missing, []);
});

test('English lines keep the placeholders of the Russian ones', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].toLowerCase()).sort().join();
  for (const [ru, en] of Object.entries(EN)) assert.equal(names(en), names(ru.replace(/#\w+$/, '')), ru);
  for (const [ru, forms] of Object.entries(PLURAL)) for (const en of forms) assert.equal(names(en), names(ru), ru);
});

test('the English lists are complete', () => {
  assert.equal(LISTS.weekdaysShort.length, 7);
  assert.equal(LISTS.weekdaysOn.length, 7);
  assert.ok(LISTS.defaultTypes.every(([name, color]) => name && /^#[0-9a-f]{6}$/i.test(color)));
});
