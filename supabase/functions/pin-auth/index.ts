// Deploy with: npx supabase functions deploy pin-auth --no-verify-jwt
// Signed-out visitors must be able to call it, so it checks sessions itself where needed.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle } from './logic.js';

const ALLOWED_ORIGINS = new Set([
  'https://daymark-activity-tracker.pages.dev',
  'https://olegogurev-glitch.github.io',
  'http://127.0.0.1:8765',
]);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

const CLEARED = { failed_attempts: 0, lock_count: 0, locked_until: null, reset_until: null };

const deps = {
  async beginAttempt(login: string) {
    const rows = check(await admin.rpc('pin_begin_attempt', { p_login: login })) as unknown[];
    return rows[0] ?? null;
  },
  async attemptSucceeded(login: string) {
    check(await admin.rpc('pin_attempt_succeeded', { p_login: login }));
  },
  async findLogin(login: string) {
    return check(await admin.from('pin_logins').select('login,user_id,reset_until').eq('login', login).maybeSingle());
  },
  async findLoginByUser(userId: string) {
    return check(await admin.from('pin_logins').select('login,user_id').eq('user_id', userId).maybeSingle());
  },
  async insertLogin(row: { login: string; user_id: string; pin_hash: string }) {
    const { error } = await admin.from('pin_logins').insert(row);
    if (error?.code === '23505') return false;
    if (error) throw new Error(error.message);
    return true;
  },
  async updateLogin(login: string, changes: { login: string; pin_hash: string }) {
    check(await admin.from('pin_logins').update({ ...changes, ...CLEARED, updated_at: new Date().toISOString() }).eq('login', login));
  },
  async countRecentSignups() {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count, error } = await admin.from('pin_logins').select('login', { count: 'exact', head: true }).gte('created_at', since);
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
  // Login-only accounts get a random placeholder address that is never written to.
  async createUser(login: string) {
    const email = `${crypto.randomUUID()}@login.daymark.invalid`;
    const { user } = check(await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { login } }));
    return user.id;
  },
  async deleteUser(userId: string) {
    check(await admin.auth.admin.deleteUser(userId));
  },
  async setUserLogin(userId: string, login: string) {
    const { user } = check(await admin.auth.admin.getUserById(userId));
    check(await admin.auth.admin.updateUserById(userId, { user_metadata: { ...user.user_metadata, login } }));
  },
  // A one-time token the browser exchanges for a session. No email is sent.
  async issueToken(userId: string) {
    const { user } = check(await admin.auth.admin.getUserById(userId));
    const { properties } = check(await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email! }));
    return properties.hashed_token;
  },
  async currentUserId(authHeader: string | null) {
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const { data, error } = await admin.auth.getUser(token);
    return error ? null : data.user.id;
  },
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), { status: 405, headers });

  try {
    const pepper = Deno.env.get('PIN_PEPPER');
    if (!pepper) throw new Error('PIN_PEPPER is not set');
    const body = await req.json().catch(() => null);
    const result = await handle(body, req.headers.get('authorization'), deps, pepper);
    return new Response(JSON.stringify(result), { headers });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: 'server' }), { status: 500, headers });
  }
});
