// Run with: node --test tests/
// The lockout itself lives in the database function, so it is checked against the real
// project after deploy. Here the fake only imitates its counting.
import test from 'node:test';
import assert from 'node:assert';
import { handle, hashPin, verifyPin, isAcceptablePin, isValidLogin, normalizeLogin } from '../supabase/functions/pin-auth/logic.js';

const PEPPER = 'test-pepper';

function fakeDeps() {
  const rows = new Map();
  let nextUser = 1;
  const users = new Set();
  const deps = {
    rows, users,
    async beginAttempt(login) {
      const row = rows.get(login);
      if (!row) return null;
      if (row.locked) return { user_id: row.user_id, pin_hash: null, locked_seconds: 900 };
      row.failed = (row.failed || 0) + 1;
      if (row.failed >= 5) { row.locked = true; row.failed = 0; }
      return { user_id: row.user_id, pin_hash: row.pin_hash, locked_seconds: 0 };
    },
    async attemptSucceeded(login) { const row = rows.get(login); row.failed = 0; row.locked = false; },
    async findLogin(login) { return rows.get(login) ?? null; },
    async findLoginByUser(id) { return [...rows.values()].find((r) => r.user_id === id) ?? null; },
    async insertLogin(row) { if (rows.has(row.login)) return false; rows.set(row.login, { ...row }); return true; },
    async updateLogin(login, changes) {
      const row = rows.get(login);
      rows.delete(login);
      rows.set(changes.login, { ...row, ...changes, reset_until: null, failed: 0, locked: false });
    },
    async countRecentSignups() { return deps.recent ?? rows.size; },
    async createUser() { const id = `u${nextUser++}`; users.add(id); return id; },
    async deleteUser(id) { users.delete(id); },
    async setUserLogin() {},
    async issueToken(id) { return `token-for-${id}`; },
    async currentUserId(header) { return header === 'Bearer good' ? 'existing-user' : null; },
  };
  return deps;
}
const call = (deps, body, auth = null) => handle(body, auth, deps, PEPPER);

test('PIN hashes verify only with the right PIN and pepper, and differ per use', async () => {
  const stored = await hashPin('2749', PEPPER);
  assert.ok(await verifyPin('2749', PEPPER, stored));
  assert.ok(!(await verifyPin('2748', PEPPER, stored)));
  assert.ok(!(await verifyPin('2749', 'other', stored)));
  assert.notEqual(stored, await hashPin('2749', PEPPER));
  assert.ok(!stored.includes('2749'));
});

test('obvious PINs and non-PINs are refused', () => {
  for (const pin of ['1111', '1234', '4321', '6789', '1212', '123', '12345', 'abcd', 1234, null]) assert.equal(isAcceptablePin(pin), false, String(pin));
  for (const pin of ['2749', '1357', '9024']) assert.equal(isAcceptablePin(pin), true, pin);
});

test('logins accept Cyrillic and ignore case and spaces', () => {
  assert.equal(normalizeLogin('  Олег '), 'олег');
  for (const login of ['олег', 'oleg_g', 'a.b-c']) assert.ok(isValidLogin(login), login);
  for (const login of ['ab', 'has space', 'me@mail.ru', '-start', '', 'x'.repeat(31)]) assert.ok(!isValidLogin(login), login);
});

test('sign up, then sign in, returns a token for the same user', async () => {
  const deps = fakeDeps();
  const up = await call(deps, { action: 'signup', login: 'Олег', pin: '2749' });
  assert.deepEqual(up, { ok: true, token_hash: 'token-for-u1' });
  assert.deepEqual(await call(deps, { action: 'signin', login: 'олег', pin: '2749' }), { ok: true, token_hash: 'token-for-u1' });
});

test('wrong PIN and unknown login give the same answer', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'signup', login: 'oleg', pin: '2749' });
  const wrong = await call(deps, { action: 'signin', login: 'oleg', pin: '0000' });
  const unknown = await call(deps, { action: 'signin', login: 'nobody', pin: '2749' });
  assert.deepEqual(wrong, { ok: false, error: 'invalid' });
  assert.deepEqual(unknown, wrong);
});

test('once locked, even the right PIN gets no token', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'signup', login: 'oleg', pin: '2749' });
  for (let i = 0; i < 5; i++) await call(deps, { action: 'signin', login: 'oleg', pin: '9999' });
  assert.deepEqual(await call(deps, { action: 'signin', login: 'oleg', pin: '2749' }), { ok: false, error: 'locked', retry_after: 900 });
});

test('a correct PIN clears the failed count', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'signup', login: 'oleg', pin: '2749' });
  for (let i = 0; i < 4; i++) await call(deps, { action: 'signin', login: 'oleg', pin: '9999' });
  assert.ok((await call(deps, { action: 'signin', login: 'oleg', pin: '2749' })).ok);
  assert.equal(deps.rows.get('oleg').failed, 0);
});

test('a taken login cannot be claimed, and no user is left behind', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'signup', login: 'oleg', pin: '2749' });
  assert.deepEqual(await call(deps, { action: 'signup', login: 'OLEG', pin: '1357' }), { ok: false, error: 'login_taken' });
  assert.equal(deps.users.size, 1);
});

test('a lost race for a login removes the extra user', async () => {
  const deps = fakeDeps();
  deps.insertLogin = async () => false;
  assert.deepEqual(await call(deps, { action: 'signup', login: 'oleg', pin: '2749' }), { ok: false, error: 'login_taken' });
  assert.equal(deps.users.size, 0);
});

test('a reset opened by hand lets the login pick a new PIN and keep the account', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'signup', login: 'oleg', pin: '2749' });
  deps.rows.get('oleg').reset_until = new Date(Date.now() + 60000).toISOString();
  assert.deepEqual(await call(deps, { action: 'signup', login: 'oleg', pin: '1357' }), { ok: true, token_hash: 'token-for-u1' });
  assert.ok((await call(deps, { action: 'signin', login: 'oleg', pin: '1357' })).ok);
  assert.deepEqual(await call(deps, { action: 'signup', login: 'oleg', pin: '9024' }), { ok: false, error: 'login_taken' });
});

test('an expired reset does nothing', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'signup', login: 'oleg', pin: '2749' });
  deps.rows.get('oleg').reset_until = new Date(Date.now() - 60000).toISOString();
  assert.deepEqual(await call(deps, { action: 'signup', login: 'oleg', pin: '1357' }), { ok: false, error: 'login_taken' });
});

test('setting a PIN needs a session and links to that account', async () => {
  const deps = fakeDeps();
  assert.deepEqual(await call(deps, { action: 'set_pin', login: 'oleg', pin: '2749' }), { ok: false, error: 'not_signed_in' });
  assert.deepEqual(await call(deps, { action: 'set_pin', login: 'oleg', pin: '2749' }, 'Bearer good'), { ok: true, login: 'oleg' });
  assert.deepEqual(await call(deps, { action: 'signin', login: 'oleg', pin: '2749' }), { ok: true, token_hash: 'token-for-existing-user' });
});

test('changing login and PIN keeps one row, and others cannot take a used login', async () => {
  const deps = fakeDeps();
  await call(deps, { action: 'set_pin', login: 'oleg', pin: '2749' }, 'Bearer good');
  await call(deps, { action: 'set_pin', login: 'oleg2', pin: '1357' }, 'Bearer good');
  assert.deepEqual([...deps.rows.keys()], ['oleg2']);
  await call(deps, { action: 'signup', login: 'friend', pin: '2749' });
  assert.deepEqual(await call(deps, { action: 'set_pin', login: 'friend', pin: '1357' }, 'Bearer good'), { ok: false, error: 'login_taken' });
});

test('sign-ups stop at the hourly limit', async () => {
  const deps = fakeDeps();
  deps.recent = 20;
  assert.deepEqual(await call(deps, { action: 'signup', login: 'oleg', pin: '2749' }), { ok: false, error: 'too_many_signups' });
});

test('weak PINs and bad requests are refused', async () => {
  const deps = fakeDeps();
  assert.deepEqual(await call(deps, { action: 'signup', login: 'oleg', pin: '1234' }), { ok: false, error: 'weak_pin' });
  assert.deepEqual(await call(deps, { action: 'signup', login: 'a', pin: '2749' }), { ok: false, error: 'bad_login' });
  assert.deepEqual(await call(deps, { action: 'nope' }), { ok: false, error: 'bad_request' });
  assert.deepEqual(await call(deps, null), { ok: false, error: 'bad_request' });
});
