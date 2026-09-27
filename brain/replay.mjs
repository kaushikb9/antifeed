// Replay a past day's curation into a scratch dir and diff it against what
// shipped. Never touches site/data, never commits, pushes or deploys.
//
//   node brain/replay.mjs <YYYY-MM-DD> [--model X] [--effort Y] [--prompt path]
//
// Base state: articles.json + retired.json as of the parent of that day's
// "curate: daily <date>" commit. Inputs: brain/replay/inputs/<date>.json when
// curate.sh archived one; otherwise THIS MONTH and the inbox are empty and
// the header says so. Candidates are never archived yet (the brain finds its
// own mid-run), so a replay sees today's web, not that day's.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { INPUTS } from "./replay/archive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
// Same pin as curate.sh.
export const DEFAULTS = { model: "claude-opus-5-5", effort: "low", prompt: resolve(HERE, "prompt.md") };

export function parseArgs(argv) {
  const o = { ...DEFAULTS, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") o.model = argv[++i];
    else if (a === "--effort") o.effort = argv[++i];
    else if (a === "--prompt") o.prompt = resolve(argv[++i]);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(a)) o.date = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.date) throw new Error("usage: node brain/replay.mjs <YYYY-MM-DD> [--model X] [--effort Y] [--prompt path]");
  return o;
}

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });

export function curateCommit(date) {
  const h = git("log", "--format=%H", "-1", "--fixed-strings", `--grep=curate: daily ${date}`, "--", "site/data/articles.json").trim();
  if (!h) throw new Error(`no "curate: daily ${date}" commit touching site/data/articles.json`);
  return h;
}

// Entries a run produced: new ids, plus entries resurfaced on that date.
export function picksOf(before, after, date) {
  const had = new Set(before.map((a) => a.id));
  return after.filter((a) => !had.has(a.id) || (a.resurfaced === date && before.find((b) => b.id === a.id)?.resurfaced !== date));
}

// Builds the scratch tree the brain runs in. Everything outside ROOT.
export function prepareScratch(date, { prompt = DEFAULTS.prompt, dir } = {}) {
  const commit = curateCommit(date);
  const scratch = dir ?? mkdtempSync(resolve(tmpdir(), `antifeed-replay-${date}-`));
  if (!relative(ROOT, scratch).startsWith("..")) throw new Error("scratch must be outside the repo");
  mkdirSync(resolve(scratch, "site/data"), { recursive: true });
  mkdirSync(resolve(scratch, "data"), { recursive: true });
  cpSync(resolve(ROOT, "brain"), resolve(scratch, "brain"), { recursive: true, filter: (s) => !s.includes("/replay/inputs") && !s.endsWith("auto.log") });
  cpSync(prompt, resolve(scratch, "brain/prompt.md"));
  writeFileSync(resolve(scratch, "site/data/articles.json"), git("show", `${commit}^:site/data/articles.json`));
  writeFileSync(resolve(scratch, "data/retired.json"), git("show", `${commit}^:data/retired.json`));
  const shipped = JSON.parse(git("show", `${commit}:site/data/articles.json`)).articles;
  const archivePath = resolve(INPUTS, `${date}.json`);
  const archive = existsSync(archivePath) ? JSON.parse(readFileSync(archivePath, "utf8")) : null;
  return { commit, scratch, shipped, archive };
}

export function taskText(date, archive) {
  const task = `DAILY MODE: today is ${date}. Budget: at most ONE tier='must' entry dated ${date}, at most ONE tier='more' (default zero). If nothing clears the bar, add nothing and resurface one existing unread entry instead (set 'resurfaced' to ${date}). Retire any existing entry that today's pick supersedes, per the rules.`;
  const month = archive?.this_month || "(no signal available this run)";
  const inbox = JSON.stringify(archive?.inbox ?? { inbox: [] });
  return `${task}\n\nTHIS MONTH (weight the search with this; never narrow to it):\n${month}\n\nMANUAL INBOX (process every item per the 'Manual inbox' section of the rules):\n${inbox}`;
}

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

function sideBySide(shipped, replay) {
  const rows = (label, e) => e
    ? [`${label}  ${e.tier}${e.resurfaced ? " (resurfaced)" : ""}  ${e.title}`, `  hook (${words(e.hook)}w): ${e.hook}`]
    : [`${label}  (nothing)`];
  const n = Math.max(shipped.length, replay.length, 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(...rows("SHIPPED", shipped[i]), ...rows("REPLAY ", replay[i]), "");
  return out.join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { commit, scratch, shipped, archive } = prepareScratch(o.date, { prompt: o.prompt });
  const before = JSON.parse(readFileSync(resolve(scratch, "site/data/articles.json"), "utf8")).articles;
  console.log(`replay ${o.date}  base ${commit.slice(0, 7)}^  model ${o.model}  effort ${o.effort}  prompt ${relative(ROOT, o.prompt) || o.prompt}`);
  console.log(`inputs: ${archive ? "archived (this month + inbox; candidates not archived)" : "NO ARCHIVE: this month and inbox empty"}  scratch ${scratch}`);
  const r = spawnSync("claude", ["-p", "--model", o.model, "--effort", o.effort,
    `${readFileSync(o.prompt, "utf8")}\n\n---\n\n${taskText(o.date, archive)}`,
    "--allowedTools", "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)",
    "--strict-mcp-config", "--permission-mode", "acceptEdits", "--output-format", "json"],
    { cwd: scratch, encoding: "utf8", maxBuffer: 64 << 20 });
  let meta = {};
  try { meta = JSON.parse(r.stdout); } catch { console.error(r.stdout, r.stderr); }
  writeFileSync(resolve(scratch, "claude-result.json"), r.stdout ?? "");
  const after = JSON.parse(readFileSync(resolve(scratch, "site/data/articles.json"), "utf8")).articles;
  const v = spawnSync("node", ["brain/validate.mjs"], { cwd: scratch, encoding: "utf8" });
  const shippedPicks = picksOf(before, shipped, o.date);
  const replayPicks = picksOf(before, after, o.date);
  console.log(`\nturns ${meta.num_turns ?? "?"}  duration ${meta.duration_ms ? (meta.duration_ms / 1000).toFixed(0) + "s" : "?"}  cost $${meta.total_cost_usd?.toFixed?.(2) ?? "?"}  validate ${v.status === 0 ? "PASS" : "FAIL"}\n`);
  if (v.status !== 0) console.log(v.stdout + v.stderr);
  console.log(sideBySide(shippedPicks, replayPicks));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
