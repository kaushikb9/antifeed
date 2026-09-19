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
// returns are the app's functions/_middleware.js, functions/claim.js (GET and
// POST) and functions/api/pair.js, each a one-line re-export.

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

export const usedKey = (token) => `used:${token}`;

export const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

export const oops = (status, message) => json({ error: message }, status);

// ---- the pages a browser sees ----

const PAGE_CSS = `body{font:17px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;max-width:32rem;
margin:18vh auto;padding:0 1.5rem;background:#faf8f4;color:#1c1b18}
code{background:#f4ead2;padding:.15em .4em;border-radius:4px;font-size:.9em}
button{font:inherit;font-weight:600;padding:.7em 1.4em;border:0;border-radius:8px;background:#1c1b18;color:#faf8f4;cursor:pointer}
p{color:#78736a}@media(prefers-color-scheme:dark){body{background:#131210;color:#e8e4dc}
code{background:#2e2718}p{color:#8f887c}button{background:#e8e4dc;color:#131210}}`;

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

// The page a pairing link lands on. Nothing happens until the button is
// tapped: link previews (WhatsApp, Messages, Slack) and in-app browsers all
// GET the link, and none of them submit a form, so the link survives them.
const pairPage = ({ name }, t, next) => page('Pair this device', `<h1>Pair this device with ${name}?</h1>
<p>One tap, and this browser stays paired for a year. If this opened inside another app, open it in Safari or Chrome first so the real browser gets paired.</p>
<form method="post" action="/claim">
<input type="hidden" name="t" value="${t}">
<input type="hidden" name="next" value="${next}">
<button type="submit">Pair this device</button>
</form>`, 200);

// ---- the factory ----
//
//   createAuth({
//     kv:   'KB_KV',                              // binding holding used:* burn records
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
  // one-time link and taps one button, which swaps the link for a one-year
  // signed cookie.
  //
  // The link is self-verifying: `${exp}.${nonce}.${hmac}` signed with
  // KB_TOKEN, so any edge can check it without a KV read. KV holds only the
  // burn record (used:*) written on claim. Two things this design survives,
  // both of which bit on 2026-09-19: KV is eventually consistent across edges
  // (a phone on cellular reads a different edge from the laptop that minted,
  // and a key written seconds ago may not be there yet), and anything that
  // previews or pre-opens a URL (WhatsApp, Messages, an in-app browser) GETs
  // it before the person does. So GET never burns; only the POST does.
  //
  // Only someone who already holds KB_TOKEN can mint a link: in `open` mode
  // the middleware gates /api/pair; in `gate` mode the app must list it (the
  // test suite checks that it did).
  async function pair({ request, env }) {
    const exp = Math.floor(Date.now() / 1000) + PAIR_TTL;
    const nonce = randomId(16);
    const sig = await hmac(env.KB_TOKEN, `pair:${exp}.${nonce}`);
    const url = new URL(request.url);
    return json({
      url: `${url.origin}/claim?t=${exp}.${nonce}.${sig}`,
      expiresIn: PAIR_TTL,
      note: 'Single use, 15 minutes. Open it on a device and tap Pair to pair that device for a year.',
    });
  }

  // Signature and expiry only; the burn record is checked by claim's POST.
  async function validLink(secret, t) {
    if (typeof t !== 'string') return false;
    const m = t.match(/^(\d+)\.([a-z0-9]+)\.([0-9a-f]{64})$/);
    if (!m) return false;
    if (Number(m[1]) < Math.floor(Date.now() / 1000)) return false;
    return safeEqual(m[3], await hmac(secret, `pair:${m[1]}.${m[2]}`));
  }

  // Same-site path only: "//evil.test" is a protocol-relative URL, not a path.
  const safeNext = (next) => (next && /^\/(?!\/)/.test(next) ? next : '/');

  async function claim({ request, env }) {
    const url = new URL(request.url);
    let t; let next;
    if (request.method === 'POST') {
      const form = await request.formData().catch(() => null);
      t = form?.get('t'); next = form?.get('next');
    } else {
      t = url.searchParams.get('t'); next = url.searchParams.get('next');
    }
    if (!t) return expiredPage('No pairing token');
    if (!(await validLink(env.KB_TOKEN, t))) return expiredPage('Link expired');
    const dest = safeNext(next);

    // Already paired (the link was opened in a browser that has the cookie):
    // just go where it was going.
    if (await validSession(env.KB_TOKEN, readCookie(request))) {
      return Response.redirect(new URL(dest, url).toString(), 302);
    }

    // The burn check is honest on both verbs; only the POST writes. (A stale
    // edge that has not yet seen the burn just shows the button again, and the
    // POST re-checks.)
    if (await env[kv].get(usedKey(t))) return expiredPage('Link already used');
    if (request.method !== 'POST') return pairPage(app, t, dest);

    // Burn before minting, so a double-tap cannot pair twice off one link.
    await env[kv].put(usedKey(t), new Date().toISOString(), { expirationTtl: PAIR_TTL + 60 });

    const { value, maxAge } = await mintSession(env.KB_TOKEN);
    return new Response(null, {
      status: 302,
      headers: { Location: dest, 'Set-Cookie': sessionCookie(value, maxAge, url) },
    });
  }

  return { middleware, claim, pair, needsAuth };
}
