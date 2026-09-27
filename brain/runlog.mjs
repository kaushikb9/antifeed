// One metrics line per brain run, never the model's words. A copy of
// kaizen/brain/runlog.mjs (2026-09-27): apps stay separate, no cross-repo import.
// The brains run with --output-format json and this reads the result.
//
//   node brain/runlog.mjs <name> <run.json>   one line; exit 1 if the run failed
import { readFileSync } from "node:fs";

// An error from the CLI (a usage limit, an expired login, an API error) is
// safe to log and says what to do; anything else could be the model talking.
const CLI_ERROR = /api error|usage limit|reached your|limit|log ?in|\/login|expired|unauthori[sz]ed|overloaded/i;

export function runLine(name, raw, now = new Date()) {
  // local time, like jobs.sh's lines in the same log (kaizen's copy uses UTC)
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  let r;
  try { r = JSON.parse(raw); } catch {
    return { ok: false, line: `${stamp} ${name}: FAILED · no JSON result from claude -p (crashed, killed, or never started)` };
  }
  const model = Object.keys(r.modelUsage || {})[0] || "?";
  const secs = Math.round((r.duration_ms || 0) / 1000);
  const base = `${stamp} ${name}: ${model} · ${r.num_turns ?? "?"} turns · ${secs}s`;
  if (!r.is_error && r.subtype === "success") return { ok: true, line: `${base} · ok` };
  const text = String(r.result || "").replace(/\s+/g, " ");
  let why = CLI_ERROR.test(text) ? text.slice(0, 160) : (r.subtype || "error");
  if (/log ?in|\/login|expired|unauthori[sz]ed/i.test(text)) why += " · fix: run `claude /login` in a terminal";
  return { ok: false, line: `${base} · FAILED · ${why}` };
}

if (process.argv[1]?.endsWith("runlog.mjs")) {
  const [name, file] = process.argv.slice(2);
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch {}
  const { ok, line } = runLine(name, raw);
  console.log(line);
  process.exit(ok ? 0 : 1);
}
