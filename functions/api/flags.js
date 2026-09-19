// Flags live one KV key per article (`flag:<id>`), so two devices toggling
// different articles never clobber each other (issue #4). The flag object is
// duplicated into KV metadata, letting GET read everything with list() alone.
// The pre-migration blob under `flags` stays as a read-only base layer —
// per-article keys shadow it, so no migration run is needed.
import schema from "../../brain/schema.json" with { type: "json" };

const LEGACY_KEY = "flags";
const PREFIX = "flag:";
// The flag vocabulary comes from the schema, so the API can never store a key
// the reader does not draw (or kaizen does not write).
const KEYS = new Set(schema.flags.keys);

// Auth is the middleware's job (functions/_middleware.js gates this route).

async function readAll(env) {
  const flags = (await env.ANTIFEED_KV.get(LEGACY_KEY, "json")) || {};
  let cursor;
  do {
    const page = await env.ANTIFEED_KV.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) {
      if (k.metadata) flags[k.name.slice(PREFIX.length)] = k.metadata;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return flags;
}

// current state of one article: its own key if written since the migration,
// else whatever the legacy blob (fetched once by the caller) says
async function readOne(env, legacy, id) {
  return (await env.ANTIFEED_KV.get(PREFIX + id, "json")) || legacy[id] || {};
}

async function writeOne(env, id, f) {
  await env.ANTIFEED_KV.put(PREFIX + id, JSON.stringify(f), { metadata: f });
}

export async function onRequestGet({ env }) {
  return Response.json({ flags: await readAll(env) });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const legacy = (await env.ANTIFEED_KV.get(LEGACY_KEY, "json")) || {};
  const written = {};
  if (body.merge) {
    // one-time import of a device's local flags: OR them into the server copy
    for (const [id, f] of Object.entries(body.merge)) {
      const known = Object.fromEntries(Object.entries(f).filter(([k]) => KEYS.has(k)).map(([k, v]) => [k, !!v]));
      const cur = Object.assign(await readOne(env, legacy, id), known);
      await writeOne(env, id, cur);
      written[id] = cur;
    }
  } else if (body.id && body.key) {
    if (!KEYS.has(body.key)) return new Response(`bad request: key must be one of ${[...KEYS].join("|")}`, { status: 400 });
    const f = await readOne(env, legacy, body.id);
    f[body.key] = !!body.value;
    await writeOne(env, body.id, f);
    written[body.id] = f;
  } else {
    return new Response("bad request", { status: 400 });
  }
  // overlay what we just wrote — list() is eventually consistent and may not
  // see it yet
  return Response.json({ flags: Object.assign(await readAll(env), written) });
}
