/* /api/telemetry — was the read read, by whom, from where.
   =========================================================================
   WHY THIS EXISTS. antifeed publishes one good read a day and had no way of
   knowing whether the read was opened. Not analytics in the industry sense —
   no funnels, no retention curves, no third party. One line per page view,
   per tab tap and per article opened, kept for ninety days, readable by one
   person.

   WHAT IT IS HONEST ABOUT. The client says only WHAT HAPPENED. Everything
   that could be lied about the server works out for itself:

     who      whether the post carried a VALID AF_TOKEN — checked here, never
              believed from a flag in the body. A reader without it is
              nobody, not "anonymous user 12".
     where    request.cf.country / .city, which Cloudflare hands us free.
     device   the UA reduced to one coarse word. Not a fingerprint.
     when     the server clock.

   NO IP IS STORED. Not in a field, not in a key. Traffic without the token
   gets a `vid`: six characters of HMAC over ip+UA salted with TODAY'S DATE,
   so two hits from the same stranger on one day count as one person and the
   same stranger tomorrow is a new one. That is enough to say "three
   strangers this week" and not enough to follow anybody.

   WHY KV METADATA AND NOT VALUES. The whole event lives in the key's
   metadata, and the value is empty. A `list()` returns metadata with the
   names, so reading three months back is one paginated list rather than
   three thousand gets.

   WHY THE KEY COUNTS DOWN. `tel:<1e13 - ms>:<rand>` sorts NEWEST FIRST in
   KV's lexicographic listing, so "the last day" stops after one page instead
   of paging through the entire ninety.

   WHY IT SHARES ANTIFEED_KV WITH FLAGS AND THE INBOX. One namespace, three
   prefixes that cannot collide (`flag:`, `inbox`, `tel:`), and the flags
   listing already filters by its own prefix. A second namespace would buy
   nothing but another id to keep in wrangler.toml.

   POST { e, p, s, k }  -> 204, always. Telemetry never breaks the page.
   GET  ?days=7         -> { events } to a caller with x-af-token; 404 to
                           everybody else.
   ========================================================================= */

const TTL = 60 * 60 * 24 * 90; // ninety days, then it forgets by itself
const KEY_SPACE = 1e13; // comfortably past any ms timestamp this century

/* The two pages that exist, and the four things that can happen on them. An
   event for anything else is dropped rather than recorded, so a stranger
   cannot write arbitrary strings into the page KB reads. */
const PATHS = ["/", "/about/"];
const EVENTS = ["view", "tab", "open", "hn"];
const TABS = ["must", "more", "mine"];

/* Enough writes for a public reader having a good day, few enough that a
   stranger with a loop cannot spend the day's KV budget. */
const RATE_LIMIT = 120;
const RATE_WINDOW = 600;

const noContent = () =>
  new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/* ---------------- what the client is allowed to say ---------------- */

/* An article id is a date-slug that antifeed itself minted
   (`2026-07-25-software-getting-worse`), so it can be held to that shape
   exactly. Anything else is dropped, not sanitised into something plausible:
   a mangled id would sit in the page looking like a read that never
   happened. The page escapes on top of this; both, not either. */
function cleanId(raw) {
  const s = String(raw == null ? "" : raw).trim().slice(0, 64);
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(s) ? s : null;
}

/* Coarse on purpose. "What are they reading this on" is a real question;
   "which of the four hundred Chrome builds" is not, and the narrower the
   string the closer it gets to identifying a device rather than a kind. */
function deviceOf(ua) {
  const s = String(ua || "");
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android";
  if (/Macintosh|Mac OS X/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows";
  if (/Linux/i.test(s)) return "Linux";
  return "Other";
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

const hex = (buf, bytes) =>
  [...new Uint8Array(buf)].slice(0, bytes)
    .map((b) => b.toString(16).padStart(2, "0")).join("");

/* The daily rotating id. Salted with the secret so it cannot be recomputed
   from outside, and with the date so it cannot be followed across days. */
async function dailyId(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  const ua = request.headers.get("user-agent") || "";
  if (!ip && !ua) return null;
  const day = new Date().toISOString().slice(0, 10);
  return hex(await hmac(String(env.AF_TOKEN || "no-secret"), day + "|" + ip + "|" + ua), 3);
}

/* Counts one bucket against a cap, and records the attempt.

   HOW LATE THIS IS. KV reads are cached at the edge for at least sixty
   seconds, so a fast burst reads a stale counter and overshoots before the
   limit engages. The cap is a ceiling on SUSTAINED writing, not on a burst,
   and cannot be made tighter with KV alone; a hard cap needs a Durable
   Object or a Cloudflare rate-limiting rule, neither of which is worth it
   here. That is the honest shape, and it is enough for what it defends
   against: somebody filling KB's usage page with junk over minutes. It is
   not a defence against a determined flood, and should never be described
   as one. */
async function overRate(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!ip) return false;
  const day = new Date().toISOString().slice(0, 10);
  const id = hex(await hmac(String(env.AF_TOKEN || "no-secret"), day + "|" + ip), 3);
  const k = "telrate:" + id;
  const n = Number(await env.ANTIFEED_KV.get(k)) || 0;
  if (n >= RATE_LIMIT) return true;
  await env.ANTIFEED_KV.put(k, String(n + 1), { expirationTtl: RATE_WINDOW });
  return false;
}

/* ---------------- not a person ----------------
   The X-bookmark sweep and any /browse dogfooding drive a real browser
   through the site. On touchline a single verification run wrote ~30 views
   and buried the five friends it was meant to count; antifeed has the same
   exposure and less traffic to hide it in.

   Checked on the UA rather than navigator.webdriver, which is FALSE under
   CDP-attached Chrome. Server-side rather than in the page, so it cannot be
   defeated by a cached script, and dropped rather than tagged: an event
   nobody wants to see is not worth a KV write. This is noise control, not a
   security control — anything determined can send any UA it likes, and lying
   its way OUT of the analytics is not an attack worth defending against. */
const isAutomated = (ua) =>
  /HeadlessChrome|Puppeteer|Playwright|\bbot\b|crawler|spider|curl\/|wget|python-requests/i
    .test(String(ua || ""));

/* Constant-time-ish compare. The token is 30+ characters of entropy and this
   endpoint is rate-limited, so this is belt and braces rather than a fix for
   a real timing attack — but a plain === on a secret is a habit worth not
   having. */
function sameSecret(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ---------------- write ---------------- */

export async function onRequestPost({ request, env }) {
  // No store bound is not the reader's problem, and it is not worth a 500 to
  // a page that is otherwise working perfectly.
  if (!env.ANTIFEED_KV) return noContent();

  let body;
  try { body = await request.json(); } catch { return noContent(); }

  const e = EVENTS.includes(body && body.e) ? body.e : null;
  const p = PATHS.includes(body && body.p) ? body.p : null;
  if (!e || !p) return noContent();

  // What `s` means depends on the event, and each is validated as its own
  // kind rather than through one loose string cleaner.
  let s = null;
  if (e === "tab") {
    s = TABS.includes(body.s) ? body.s : null;
    if (!s) return noContent();
  } else if (e === "open" || e === "hn") {
    s = cleanId(body.s); // a missing id is fine: the open still counts
  }

  if (isAutomated(request.headers.get("user-agent"))) return noContent();
  if (await overRate(env, request)) return noContent();

  // The one claim the server checks rather than believes. `k` is the sync
  // token; a valid one means this is KB on one of his own devices.
  const mine = sameSecret(body && body.k, env.AF_TOKEN);
  const id = mine ? null : await dailyId(env, request);

  const cf = request.cf || {};
  const now = Date.now();

  const event = {
    t: new Date(now).toISOString(),
    w: mine ? "kb" : null,                  // who, or nobody
    v: mine ? null : id,                    // a stranger, counted for one day
    e, p, s,
    c: String(cf.country || "").slice(0, 2) || null,
    y: String(cf.city || "").slice(0, 40) || null,
    d: deviceOf(request.headers.get("user-agent")),
  };

  const key = "tel:" + String(KEY_SPACE - now).padStart(14, "0") +
    ":" + Math.random().toString(36).slice(2, 6);

  try {
    await env.ANTIFEED_KV.put(key, "", { expirationTtl: TTL, metadata: event });
  } catch { /* a lost event is not worth a word to the reader */ }

  return noContent();
}

/* ---------------- read ---------------- */

const RANGES = { 1: 1, 7: 7, 30: 30, 90: 90 };
const PAGE = 1000;
const MAX_PAGES = 6;

export async function onRequestGet({ request, env }) {
  if (!env.ANTIFEED_KV || !env.AF_TOKEN) return notFound();

  // Wrong token and no token are the same answer. A 401 would confirm the
  // endpoint exists; the page is unlisted, so this is a 404. (flags.js and
  // inbox.js answer 401 because their existence is not a secret — they are
  // reachable from the site's own sync button. This one is not.)
  if (!sameSecret(request.headers.get("x-af-token"), env.AF_TOKEN)) return notFound();

  const url = new URL(request.url);
  const days = RANGES[Number(url.searchParams.get("days"))] || 7;
  const cutoff = Date.now() - days * 86400000;

  const events = [];
  let cursor;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await env.ANTIFEED_KV.list({ prefix: "tel:", limit: PAGE, cursor });
    let past = false;
    for (const k of res.keys) {
      const m = k.metadata;
      if (!m || !m.t) continue;
      // Keys count down, so the first one older than the cutoff means every
      // key after it is older too.
      if (Date.parse(m.t) < cutoff) { past = true; break; }
      events.push(m);
    }
    if (past || res.list_complete) { cursor = null; break; }
    cursor = res.cursor;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return json({ days, since: new Date(cutoff).toISOString(), truncated, events });
}
