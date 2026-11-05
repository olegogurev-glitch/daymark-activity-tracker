// PIN rules and the sign-in flow. No Supabase calls here: everything external comes in
// through `deps`, so this can be tested in Node (see tests/pin-logic.test.mjs).

const ITERATIONS = 100000;
const MAX_SIGNUPS_PER_HOUR = 20;
const encoder = new TextEncoder();

export const normalizeLogin = (value) => String(value ?? '').trim().normalize('NFC').toLowerCase();

export function isValidLogin(login) {
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,29}$/u.test(login);
}

// Rejects the PINs people try first: 1111, 1234, 4321, 1212.
export function isAcceptablePin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return false;
  const [a, b, c, d] = [...pin].map(Number);
  if (a === b && b === c && c === d) return false;
  if (b - a === c - b && c - b === d - c && Math.abs(b - a) === 1) return false;
  if (a === c && b === d) return false;
  return true;
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// The pepper is a server secret, so a leaked table alone can't be used to try all 10,000 PINs.
async function derive(pin, pepper, salt, iterations) {
  const hmacKey = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(pin));
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPin(pin, pepper) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, pepper, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPin(pin, pepper, stored) {
  const [, iterations, salt, expected] = String(stored).split('$');
  const actual = new Uint8Array(await derive(pin, pepper, fromBase64(salt), Number(iterations)));
  const wanted = fromBase64(expected);
  if (actual.length !== wanted.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ wanted[i];
  return difference === 0;
}

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

async function signIn(login, pin, { deps, pepper }) {
  const attempt = isValidLogin(login) ? await deps.beginAttempt(login) : null;
  if (!attempt) {
    // Same work and same answer as a wrong PIN, so logins can't be discovered this way.
    await hashPin('0000', pepper);
    return fail('invalid');
  }
  if (attempt.locked_seconds > 0) return fail('locked', { retry_after: attempt.locked_seconds });
  if (!(await verifyPin(String(pin), pepper, attempt.pin_hash))) return fail('invalid');
  await deps.attemptSucceeded(login);
  return { ok: true, token_hash: await deps.issueToken(attempt.user_id) };
}

async function signUp(login, pin, { deps, pepper }) {
  if (!isValidLogin(login)) return fail('bad_login');
  if (!isAcceptablePin(pin)) return fail('weak_pin');

  const existing = await deps.findLogin(login);
  if (existing) {
    // A reset the owner opened by hand: this person picks a new PIN and keeps their account.
    if (!existing.reset_until || new Date(existing.reset_until) <= new Date()) return fail('login_taken');
    await deps.updateLogin(login, { login, pin_hash: await hashPin(pin, pepper) });
    return { ok: true, token_hash: await deps.issueToken(existing.user_id) };
  }

  if ((await deps.countRecentSignups()) >= MAX_SIGNUPS_PER_HOUR) return fail('too_many_signups');
  const pinHash = await hashPin(pin, pepper);
  const userId = await deps.createUser(login);
  if (!(await deps.insertLogin({ login, user_id: userId, pin_hash: pinHash }))) {
    await deps.deleteUser(userId);
    return fail('login_taken');
  }
  return { ok: true, token_hash: await deps.issueToken(userId) };
}

// For someone already signed in: adds a login and PIN to their account, or changes them.
async function setPin(login, pin, authHeader, { deps, pepper }) {
  const userId = await deps.currentUserId(authHeader);
  if (!userId) return fail('not_signed_in');
  if (!isValidLogin(login)) return fail('bad_login');
  if (!isAcceptablePin(pin)) return fail('weak_pin');

  const owner = await deps.findLogin(login);
  if (owner && owner.user_id !== userId) return fail('login_taken');
  const pinHash = await hashPin(pin, pepper);
  const mine = await deps.findLoginByUser(userId);
  if (mine) await deps.updateLogin(mine.login, { login, pin_hash: pinHash });
  else if (!(await deps.insertLogin({ login, user_id: userId, pin_hash: pinHash }))) return fail('login_taken');
  await deps.setUserLogin(userId, login);
  return { ok: true, login };
}

export async function handle(body, authHeader, deps, pepper) {
  const login = normalizeLogin(body?.login);
  const context = { deps, pepper };
  switch (body?.action) {
    case 'signin': return signIn(login, body.pin, context);
    case 'signup': return signUp(login, body.pin, context);
    case 'set_pin': return setPin(login, body.pin, authHeader, context);
    default: return fail('bad_request');
  }
}
