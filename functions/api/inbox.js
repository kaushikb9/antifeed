const KEY = "inbox";

function authed(request, env) {
  return env.AF_TOKEN && request.headers.get("x-af-token") === env.AF_TOKEN;
}

const norm = (s) => s.replace(/\/+$/, "");

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return new Response("unauthorized", { status: 401 });
  const inbox = (await env.ANTIFEED_KV.get(KEY, "json")) || [];
  return Response.json({ inbox });
}

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return new Response("unauthorized", { status: 401 });
  const body = await request.json();
  let inbox = (await env.ANTIFEED_KV.get(KEY, "json")) || [];
  if (body.clear) {
    inbox = [];
  } else if (Array.isArray(body.remove)) {
    // targeted removal: only the URLs a brain run actually ingested —
    // links added mid-run or skipped by the brain stay put
    const gone = new Set(body.remove.map(norm));
    inbox = inbox.filter((i) => !gone.has(norm(i.url)));
  } else if (body.url) {
    let url;
    try {
      url = new URL(body.url).toString();
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (inbox.some((i) => norm(i.url) === norm(url))) {
      return Response.json({ inbox, dup: true });
    }
    inbox.push({
      url,
      note: String(body.note || "").slice(0, 300),
      added: new Date().toISOString().slice(0, 10),
    });
  } else {
    return new Response("bad request", { status: 400 });
  }
  await env.ANTIFEED_KV.put(KEY, JSON.stringify(inbox));
  return Response.json({ inbox });
}
