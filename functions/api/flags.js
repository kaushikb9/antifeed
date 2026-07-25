const KEY = "flags";

function authed(request, env) {
  return env.AF_TOKEN && request.headers.get("x-af-token") === env.AF_TOKEN;
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return new Response("unauthorized", { status: 401 });
  const flags = (await env.ANTIFEED_KV.get(KEY, "json")) || {};
  return Response.json({ flags });
}

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return new Response("unauthorized", { status: 401 });
  const body = await request.json();
  const flags = (await env.ANTIFEED_KV.get(KEY, "json")) || {};
  if (body.merge) {
    // one-time import of a device's local flags: OR them into the server copy
    for (const [id, f] of Object.entries(body.merge)) {
      flags[id] = Object.assign({}, flags[id], f);
    }
  } else if (body.id && body.key) {
    const f = flags[body.id] || {};
    f[body.key] = !!body.value;
    flags[body.id] = f;
  } else {
    return new Response("bad request", { status: 400 });
  }
  await env.ANTIFEED_KV.put(KEY, JSON.stringify(flags));
  return Response.json({ flags });
}
