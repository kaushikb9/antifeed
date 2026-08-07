// Nightly KV snapshot → data/snapshot/*.json, committed by curate.sh.
// The flags are the only record of what KB has read, starred and skipped —
// KV keeps no history and has no undo, so this is the daily diff and the
// restore path. Read-only against the API: it cannot corrupt anything.
// (Deliberately under data/, not site/ — reading behaviour stays private.)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const token = readFileSync(".af-token.local", "utf8").trim();
const BASE = "https://antifeed.pages.dev";

async function get(path) {
  const res = await fetch(`${BASE}/api/${path}`, { headers: { "x-af-token": token } });
  if (!res.ok) throw new Error(`GET /api/${path} → ${res.status}`);
  return res.json();
}

// pretty-printed so a git diff reads line by line
const save = (name, data) =>
  writeFileSync(`data/snapshot/${name}.json`, JSON.stringify(data, null, 2) + "\n");

mkdirSync("data/snapshot", { recursive: true });
save("flags", (await get("flags")).flags);
save("inbox", (await get("inbox")).inbox);
console.log("snapshot: flags + inbox → data/snapshot/");
