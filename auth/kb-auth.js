// One auth for every KB app. Canonical copy: ~/Code/brain/auth/. Other repos
// hold a byte-identical copy at <repo>/auth/; ~/Code/check-all.sh diffs them.
// Edit here, copy out.
//
// Single-tenant. Two credentials, one secret (KB_TOKEN, a Pages secret).
//
//   Bearer token  — the CLI and any agent. Raw KB_TOKEN in an Authorization header.
//   Session cookie — a browser. HMAC-signed with KB_TOKEN, one year, set once
//                    per device via a magic link so the phone never sees a login.
//
// There is no users table on purpose: one reader, one secret, nothing to enumerate.
//
// An app wires it with createAuth() at the bottom of this file; the routes it
// returns are the app's functions/_middleware.js, functions/claim.js and
// functions/api/pair.js, each a one-line re-export.

const COOKIE = 'kb_session';
const YEAR = 60 * 60 * 24 * 365;
const PAIR_TTL = 15 * 60;
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time compare. Both values are hex of fixed length, but compare
// defensively anyway so a length mismatch cannot short-circuit.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function mintSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + YEAR;
  const sig = await hmac(secret, `session:${exp}`);
  return { value: `${exp}.${sig}`, maxAge: YEAR };
}

export async function validSession(secret, value) {
  if (!value) return false;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, await hmac(secret, `session:${exp}`));
}

export function sessionCookie(value, maxAge, url) {
  // Lax rather than Strict: a magic link arriving from Messages or Mail is a
  // top-level cross-site navigation, and Strict would drop the cookie on the
  // very first load, which is exactly the flow this exists to make painless.
  //
  // Secure is dropped only for plain-http localhost, where some browsers refuse
  // it outright and local dev silently fails to pair. Every real deployment is
  // https, so this never loosens anything in production.
  const local = url && url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  return `${COOKIE}=${value}; Path=/; HttpOnly;${local ? '' : ' Secure;'} SameSite=Lax; Max-Age=${maxAge}`;
}

export function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Is this request allowed to act as KB? Bearer first (agents), cookie second
// (browsers). Returns 'token' | 'cookie' | null so callers can distinguish.
export async function authenticate(request, env) {
  const secret = env.KB_TOKEN;
  if (!secret) return null;
  const tok = bearer(request);
  if (tok && safeEqual(tok, secret)) return 'token';
  if (await validSession(secret, readCookie(request))) return 'cookie';
  return null;
}

export function randomId(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, bytes * 1.5 | 0);
}

export const magicKey = (token) => `magic:${token}`;

export const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

export const oops = (status, message) => json({ error: message }, status);

// ---- the pages a browser sees ----

const PAGE_CSS = `body{font:17px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;max-width:32rem;
margin:18vh auto;padding:0 1.5rem;background:#faf8f4;color:#1c1b18}
code{background:#f4ead2;padding:.15em .4em;border-radius:4px;font-size:.9em}
p{color:#78736a}@media(prefers-color-scheme:dark){body{background:#131210;color:#e8e4dc}
code{background:#2e2718}p{color:#8f887c}}`;

const page = (title, body, status) => new Response(
  `<!doctype html><meta charset=utf8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${PAGE_CSS}</style>
${body}`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

// Public-facing, so it says nothing about how pairing works: the how lives in
// the repo's AGENTS.md, and the only person who can pair already knows it.
const denyPage = ({ name }) => page('Not paired', `<h1>This device isn't paired</h1>
<p>${name} is private. Pair this device once from the laptop and it stays paired for a year.</p>`, 401);

const expiredPage = (msg) => page('Link expired', `<h1>${msg}</h1>
<p>Pairing links are single use and last 15 minutes. Mint a new one from the laptop.</p>`, 400);

// ---- the factory ----
//
//   createAuth({
//     kv:   'KB_KV',                              // binding holding magic:* links
//     app:  { name: 'brain' },                     // named on the deny page
//     open: [/^\/icon\.svg$/, ...],                // default-private: everything else needs auth
//     gate: [/^\/api\/flags/, ...],                // default-public: only these need auth
//   }) → { middleware, claim, pair }
//
// Exactly one of `open` / `gate`. /claim is always open; it is the only way in.
// A missing KB_TOKEN answers 503 everywhere, never "open". CANONICAL_HOST, when
// set, 302s every other hostname to it (Pages never detaches <project>.pages.dev).

export function createAuth({ kv, app, open, gate }) {
  if (!kv || !app?.name) throw new Error('createAuth: kv and app { name } are required');
  if ((open && gate) || (!open && !gate)) throw new Error('createAuth: pass exactly one of open / gate');

  const CLAIM = /^\/claim$/;
  const needsAuth = (path) => {
    if (CLAIM.test(path)) return false;
    return open ? !open.some((re) => re.test(path)) : gate.some((re) => re.test(path));
  };

  async function middleware({ request, env, next }) {
    const url = new URL(request.url);

    if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST) {
      url.hostname = env.CANONICAL_HOST;
      // 302, not 301: browsers cache a permanent redirect hard enough that
      // backing this out would mean clearing state on every device.
      return Response.redirect(url.toString(), 302);
    }

    if (!env.KB_TOKEN) return oops(503, 'KB_TOKEN is not configured on this deployment.');
    if (!needsAuth(url.pathname)) return next();
    if (await authenticate(request, env)) return next();

    const wantsHtml = (request.headers.get('Accept') || '').includes('text/html');
    if (wantsHtml) return denyPage(app);
    return oops(401, 'Unauthorized. Send Authorization: Bearer <KB_TOKEN>, or pair this device.');
  }

  // Device pairing. Private-by-default only works if reading on the phone is
  // frictionless, so the phone never sees a token or a login form: it opens a
  // one-time link, which swaps itself for a one-year signed cookie.
  //
  // Only someone who already holds KB_TOKEN can mint a link: in `open` mode
  // the middleware gates /api/pair; in `gate` mode the app must list it (the
  // test suite checks that it did).
  async function pair({ request, env }) {
    const token = randomId(24);
    await env[kv].put(magicKey(token), JSON.stringify({ created: new Date().toISOString() }), { expirationTtl: PAIR_TTL });
    const url = new URL(request.url);
    return json({
      url: `${url.origin}/claim?t=${token}`,
      expiresIn: PAIR_TTL,
      note: 'Single use, 15 minutes. Opening it on a device pairs that device for a year.',
    });
  }

  async function claim({ request, env }) {
    const url = new URL(request.url);
    const t = url.searchParams.get('t');
    if (!t) return expiredPage('No pairing token');
    const rec = await env[kv].get(magicKey(t));
    if (!rec) return expiredPage('Link expired');
    // Burn it before minting, so a double-tap cannot pair twice off one link.
    await env[kv].delete(magicKey(t));

    const { value, maxAge } = await mintSession(env.KB_TOKEN);
    const next = url.searchParams.get('next');
    // Same-site path only: "//evil.test" is a protocol-relative URL, not a path.
    const dest = next && /^\/(?!\/)/.test(next) ? next : '/';
    return new Response(null, {
      status: 302,
      headers: { Location: dest, 'Set-Cookie': sessionCookie(value, maxAge, url) },
    });
  }

  return { middleware, claim, pair, needsAuth };
}
