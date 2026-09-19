// The security surface of every KB app: kb-auth.js in both wiring modes.
// Stubbed KV, real Request/Response, no wrangler. Vendored with the module;
// each repo runs it from ./check.sh and adds its own test for its own list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth, mintSession, validSession, sessionCookie, authenticate, readCookie } from "./kb-auth.js";

const SECRET = "test-secret-do-not-ship";
function mockKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); m.set(k + ":opts", opts); },
    async delete(k) { m.delete(k); },
    raw: m,
  };
}
const env = (extra = {}) => ({ KB_TOKEN: SECRET, KB_KV: mockKV(), ...extra });
const req = (path, headers = {}) => new Request("https://app.test" + path, { headers });
const NEXT = () => new Response("served", { status: 200 });
const APP = { name: "testapp" };

// A private app (brain, kaizen): everything gated but the short open list.
const priv = createAuth({ kv: "KB_KV", app: APP, open: [/^\/favicon\.ico$/, /^\/icon\.svg$/] });
// A public site with a private API (antifeed).
const pub = createAuth({ kv: "KB_KV", app: APP, gate: [/^\/api\/(flags|pair)$/] });

test("a minted session validates, a tampered or expired one does not", async () => {
  const { value } = await mintSession(SECRET);
  assert.equal(await validSession(SECRET, value), true);
  assert.equal(await validSession("other-secret", value), false, "signed with a different secret");
  const [exp, sig] = value.split(".");
  assert.equal(await validSession(SECRET, `${exp}.${sig.replace(/^./, (c) => (c === "a" ? "b" : "a"))}`), false, "one hex digit flipped");
  assert.equal(await validSession(SECRET, `${Number(exp) + 1}.${sig}`), false, "expiry edited");
  const past = Math.floor(Date.now() / 1000) - 10;
  assert.equal(await validSession(SECRET, `${past}.${sig}`), false, "expired");
  for (const junk of ["", null, "nodot", ".sig", "abc.def"]) assert.equal(await validSession(SECRET, junk), false, JSON.stringify(junk));
});

test("the cookie is HttpOnly, Lax, one year, Secure everywhere but plain-http localhost", async () => {
  const { value, maxAge } = await mintSession(SECRET);
  const prod = sessionCookie(value, maxAge, new URL("https://app.test/claim"));
  assert.match(prod, /^kb_session=.*; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000$/);
  const local = sessionCookie(value, maxAge, new URL("http://localhost:8788/claim"));
  assert.doesNotMatch(local, /Secure/);
  assert.match(local, /HttpOnly/);
  assert.equal(readCookie(new Request("https://x", { headers: { Cookie: `a=1; ${prod.split(";")[0]}; b=2` } })), value);
});

test("authenticate: bearer first, cookie second, nothing else; no secret means nobody", async () => {
  const e = env();
  assert.equal(await authenticate(req("/", { Authorization: `Bearer ${SECRET}` }), e), "token");
  assert.equal(await authenticate(req("/", { Authorization: `Bearer ${SECRET}x` }), e), null);
  assert.equal(await authenticate(req("/", { Authorization: `Basic ${SECRET}` }), e), null);
  const { value } = await mintSession(SECRET);
  assert.equal(await authenticate(req("/", { Cookie: `kb_session=${value}` }), e), "cookie");
  assert.equal(await authenticate(req("/"), e), null);
  assert.equal(await authenticate(req("/", { Authorization: `Bearer ${SECRET}` }), { KB_TOKEN: "" }), null);
});

test("createAuth refuses a half-configured app", () => {
  assert.throws(() => createAuth({ kv: "KB_KV", app: APP }), /exactly one/);
  assert.throws(() => createAuth({ kv: "KB_KV", app: APP, open: [], gate: [] }), /exactly one/);
  assert.throws(() => createAuth({ app: APP, open: [] }), /required/);
  assert.throws(() => createAuth({ kv: "KB_KV", app: {}, open: [] }), /required/);
});

test("open mode: private by default, the open list and /claim are the only way through", async () => {
  const e = env();
  for (const p of ["/claim", "/favicon.ico", "/icon.svg"])
    assert.equal((await priv.middleware({ request: req(p), env: e, next: NEXT })).status, 200, p);
  for (const p of ["/", "/index.html", "/posts/x", "/app.js", "/api/pair", "/claim/", "/Claim", "/api/anything"]) {
    const r = await priv.middleware({ request: req(p), env: e, next: NEXT });
    assert.equal(r.status, 401, p);
    assert.match(r.headers.get("Content-Type"), /json/, `${p}: non-browser callers get JSON`);
  }
});

test("gate mode: public by default, exactly the gated list needs auth", async () => {
  const e = env();
  for (const p of ["/", "/index.html", "/data/articles.json", "/app.js", "/claim", "/api/telemetry"])
    assert.equal((await pub.middleware({ request: req(p), env: e, next: NEXT })).status, 200, p);
  for (const p of ["/api/flags", "/api/pair"])
    assert.equal((await pub.middleware({ request: req(p), env: e, next: NEXT })).status, 401, p);
  const ok = await pub.middleware({ request: req("/api/flags", { Authorization: `Bearer ${SECRET}` }), env: e, next: NEXT });
  assert.equal(ok.status, 200);
});

test("a browser without a cookie gets the pairing page naming the app; a paired one is served", async () => {
  const e = env();
  const r = await priv.middleware({ request: req("/", { Accept: "text/html,*/*" }), env: e, next: NEXT });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("Content-Type"), /text\/html/);
  const html = await r.text();
  assert.match(html, /isn't paired/);
  assert.match(html, /testapp is private/);
  assert.doesNotMatch(html, /npm run pair|~\/Code/, "the public page says nothing about how pairing works");
  const { value } = await mintSession(SECRET);
  const ok = await priv.middleware({ request: req("/", { Accept: "text/html", Cookie: `kb_session=${value}` }), env: e, next: NEXT });
  assert.equal(ok.status, 200);
  const tok = await priv.middleware({ request: req("/api/pair", { Authorization: `Bearer ${SECRET}` }), env: e, next: NEXT });
  assert.equal(tok.status, 200);
});

test("503 without KB_TOKEN in both modes, 302 to the canonical host when one is set", async () => {
  for (const a of [priv, pub])
    assert.equal((await a.middleware({ request: req("/"), env: { KB_KV: mockKV() }, next: NEXT })).status, 503);
  const e = env({ CANONICAL_HOST: "app.example" });
  const r = await priv.middleware({ request: req("/posts/x?y=1"), env: e, next: NEXT });
  assert.equal(r.status, 302, "temporary, never 301");
  assert.equal(r.headers.get("Location"), "https://app.example/posts/x?y=1");
  const same = await priv.middleware({ request: new Request("https://app.example/icon.svg"), env: e, next: NEXT });
  assert.equal(same.status, 200);
});

test("pair mints a signed 15-minute link with no KV write; GET shows the button, POST burns it and sets the cookie", async () => {
  const e = { KB_TOKEN: SECRET, OTHER_KV: mockKV() };
  const a = createAuth({ kv: "OTHER_KV", app: APP, open: [] });
  const p = await a.pair({ request: new Request("https://app.test/api/pair", { method: "POST" }), env: e });
  const { url, expiresIn } = await p.json();
  assert.equal(expiresIn, 900);
  const t = new URL(url).searchParams.get("t");
  assert.match(t, /^\d+\.[a-z0-9]+\.[0-9a-f]{64}$/, "self-verifying token");
  assert.equal(e.OTHER_KV.raw.size, 0, "minting writes nothing: a fresh key may not be at the phone's edge yet");

  // GET: the page with the button. Previews and in-app browsers stop here.
  const g = await a.claim({ request: req(`/claim?t=${t}&next=/posts/x`), env: e });
  assert.equal(g.status, 200);
  const html = await g.text();
  assert.match(html, /method="post" action="\/claim"/);
  assert.match(html, new RegExp(`name="t" value="${t}"`));
  assert.match(html, /name="next" value="\/posts\/x"/);
  assert.equal(g.headers.get("Set-Cookie"), null, "a GET never pairs");
  assert.equal(e.OTHER_KV.raw.size, 0, "a GET never burns");
  const g2 = await a.claim({ request: req(`/claim?t=${t}`), env: e });
  assert.equal(g2.status, 200, "opening the link twice is fine");

  // POST: burn, cookie, redirect.
  const post = (tok, next = "/posts/x") => new Request("https://app.test/claim", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t: tok, next }),
  });
  const c = await a.claim({ request: post(t), env: e });
  assert.equal(c.status, 302);
  assert.equal(c.headers.get("Location"), "/posts/x");
  const cookie = c.headers.get("Set-Cookie");
  assert.match(cookie, /^kb_session=\d+\.[0-9a-f]{64}; .*HttpOnly; Secure/);
  assert.equal(await validSession(SECRET, cookie.match(/kb_session=([^;]+)/)[1]), true);
  assert.deepEqual(e.OTHER_KV.raw.get(`used:${t}:opts`), { expirationTtl: 960 });

  assert.equal((await a.claim({ request: post(t), env: e })).status, 400, "second use of the same link");
  assert.equal((await a.claim({ request: req(`/claim?t=${t}`), env: e })).status, 400, "used link on GET");
  assert.equal((await a.claim({ request: req("/claim"), env: e })).status, 400, "no token");

  // Tampered or expired links fail before any KV read.
  const [exp, nonce, sig] = t.split(".");
  for (const bad of [`${exp}.${nonce}x.${sig}`, `${Number(exp) + 1}.${nonce}.${sig}`, `${exp}.${nonce}.${sig.replace(/^./, (ch) => (ch === "a" ? "b" : "a"))}`, `${Math.floor(Date.now() / 1000) - 5}.${nonce}.${sig}`])
    assert.equal((await a.claim({ request: req(`/claim?t=${bad}`), env: e })).status, 400, bad);
  assert.equal((await a.claim({ request: post(t.replace(/^\d+/, (d) => String(Number(d) + 1))), env: e })).status, 400, "tampered POST");

  // A browser that already holds the cookie is just sent on its way.
  const p2 = await a.pair({ request: new Request("https://app.test/api/pair", { method: "POST" }), env: e });
  const t2 = new URL((await p2.json()).url).searchParams.get("t");
  const paired = await a.claim({ request: req(`/claim?t=${t2}&next=/posts/y`, { Cookie: `kb_session=${(await mintSession(SECRET)).value}` }), env: e });
  assert.equal(paired.status, 302);
  assert.equal(paired.headers.get("Location"), "https://app.test/posts/y");
});

test("claim's next must be a same-site path: absolute and protocol-relative URLs go to /", async () => {
  const e = env();
  for (const next of ["https://evil.test", "//evil.test", "evil"]) {
    const p = await priv.pair({ request: new Request("https://app.test/api/pair", { method: "POST" }), env: e });
    const t = new URL((await p.json()).url).searchParams.get("t");
    const g = await priv.claim({ request: req(`/claim?t=${t}&next=${encodeURIComponent(next)}`), env: e });
    assert.match(await g.text(), /name="next" value="\/"/, `GET form: ${next}`);
    const c = await priv.claim({ request: new Request("https://app.test/claim", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, next }) }), env: e });
    assert.equal(c.headers.get("Location"), "/", next);
  }
});
