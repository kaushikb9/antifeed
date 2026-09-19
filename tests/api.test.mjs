// The API seam: functions/api/flags.js and inbox.js with a stubbed KV, and
// the middleware's gate list — the reader is public, these two are not.
// No wrangler. The flag vocabulary must come from brain/schema.json.
// Auth itself (cookie, bearer, pairing) is tested in auth/kb-auth.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as flags from "../functions/api/flags.js";
import * as inbox from "../functions/api/inbox.js";
import { onRequest as middleware } from "../functions/_middleware.js";
import { onRequestGet as claim } from "../functions/claim.js";
import { onRequestPost as pair } from "../functions/api/pair.js";
import { schema } from "../brain/validate.mjs";

const TOKEN = "test-token";

function mockKV() {
  const m = new Map(), meta = new Map();
  return {
    async get(k, type) { const v = m.get(k); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v, opts) { m.set(k, String(v)); if (opts?.metadata) meta.set(k, opts.metadata); },
    async list({ prefix }) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true };
    },
    raw: m,
  };
}
const env = () => ({ KB_TOKEN: TOKEN, ANTIFEED_KV: mockKV() });
const req = (path, { token = TOKEN, body } = {}) => new Request("https://x.test" + path, {
  method: body ? "POST" : "GET",
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

const NEXT = () => new Response("served", { status: 200 });
const gate = async (path, opts) => (await middleware({ request: req(path, { token: null, ...opts }), env: env(), next: NEXT })).status;

test("the gate: flags, inbox and pair need auth; the reader, its data, claim and telemetry do not", async () => {
  for (const p of ["/api/flags", "/api/inbox", "/api/pair"]) {
    assert.equal(await gate(p), 401, p);
    assert.equal(await gate(p, { token: "nope" }), 401, `${p} wrong bearer`);
    assert.equal(await gate(p, { token: TOKEN }), 200, `${p} right bearer`);
  }
  for (const p of ["/", "/index.html", "/data/articles.json", "/app.js", "/usage/", "/claim", "/api/telemetry"])
    assert.equal(await gate(p), 200, p);
  assert.equal(typeof claim, "function"); assert.equal(typeof pair, "function");
});

test("no KB_TOKEN configured means nobody gets in, not everybody", async () => {
  const r = await middleware({ request: req("/api/flags", { token: "" }), env: { ANTIFEED_KV: mockKV() }, next: NEXT });
  assert.equal(r.status, 503);
});

test("a flag toggle writes one key per article and reads back merged", async () => {
  const e = env();
  let r = await flags.onRequestPost({ request: req("/api/flags", { body: { id: "a1", key: "r", value: 1 } }), env: e });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).flags, { a1: { r: true } });
  r = await flags.onRequestPost({ request: req("/api/flags", { body: { id: "a1", key: "f", value: true } }), env: e });
  assert.deepEqual((await r.json()).flags, { a1: { r: true, f: true } });
  assert.ok(e.ANTIFEED_KV.raw.has("flag:a1"), "one key per article");
  const g = await flags.onRequestGet({ request: req("/api/flags"), env: e });
  assert.deepEqual((await g.json()).flags, { a1: { r: true, f: true } });
});

test("only the schema's flag keys are storable", async () => {
  const e = env();
  const r = await flags.onRequestPost({ request: req("/api/flags", { body: { id: "a1", key: "z", value: true } }), env: e });
  assert.equal(r.status, 400);
  assert.match(await r.text(), new RegExp(schema.flags.keys.join("\\|")));
  for (const k of schema.flags.keys) {
    const ok = await flags.onRequestPost({ request: req("/api/flags", { body: { id: "a1", key: k, value: true } }), env: e });
    assert.equal(ok.status, 200, k);
  }
});

test("merge ORs a device's flags in and drops keys the schema does not know", async () => {
  const e = env();
  await flags.onRequestPost({ request: req("/api/flags", { body: { id: "a1", key: "r", value: true } }), env: e });
  const r = await flags.onRequestPost({ request: req("/api/flags", { body: { merge: { a1: { f: true, junk: true }, a2: { x: 1 } } } }), env: e });
  assert.deepEqual((await r.json()).flags, { a1: { r: true, f: true }, a2: { x: true } });
});

test("the legacy blob is a read-only base layer that per-article keys shadow", async () => {
  const e = env();
  await e.ANTIFEED_KV.put("flags", JSON.stringify({ old: { r: true }, a1: { f: true } }));
  const r = await flags.onRequestPost({ request: req("/api/flags", { body: { id: "a1", key: "r", value: true } }), env: e });
  assert.deepEqual((await r.json()).flags, { old: { r: true }, a1: { f: true, r: true } });
});

test("inbox: add, dedupe by trailing slash, remove only what was ingested, clear", async () => {
  const e = env();
  let r = await inbox.onRequestPost({ request: req("/api/inbox", { body: { url: "https://a.test/x/", note: "n" } }), env: e });
  assert.equal((await r.json()).inbox.length, 1);
  r = await inbox.onRequestPost({ request: req("/api/inbox", { body: { url: "https://a.test/x" } }), env: e });
  const j = await r.json(); assert.equal(j.dup, true); assert.equal(j.inbox.length, 1);
  await inbox.onRequestPost({ request: req("/api/inbox", { body: { url: "https://b.test/" } }), env: e });
  r = await inbox.onRequestPost({ request: req("/api/inbox", { body: { remove: ["https://a.test/x"] } }), env: e });
  assert.deepEqual((await r.json()).inbox.map((i) => i.url), ["https://b.test/"]);
  r = await inbox.onRequestPost({ request: req("/api/inbox", { body: { clear: true } }), env: e });
  assert.deepEqual((await r.json()).inbox, []);
  assert.equal((await inbox.onRequestPost({ request: req("/api/inbox", { body: { url: "not a url" } }), env: e })).status, 400);
  assert.equal((await inbox.onRequestPost({ request: req("/api/inbox", { body: {} }), env: e })).status, 400);
});
