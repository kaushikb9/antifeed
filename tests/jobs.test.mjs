// The jobs seam: brain/jobs.sh (sourced by curate, inbox, x-bookmarks, auto,
// deploy) and brain/runlog.mjs. No network, no claude, no wrangler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { runLine } from "../brain/runlog.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const JOBS = resolve(ROOT, "brain/jobs.sh");
const tmp = () => mkdtempSync(join(tmpdir(), "antifeed-jobs-"));
const sh = (script, env = {}) => spawnSync("bash", ["-c", script], {
  encoding: "utf8", env: { ...process.env, PATH: "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin", ...env },
});

test("cf_token exports the Cloudflare token and account when config has them", () => {
  const home = tmp(); mkdirSync(join(home, ".config/kb"), { recursive: true });
  writeFileSync(join(home, ".config/kb/config.json"), JSON.stringify({ cloudflare_api_token: "tok", cloudflare_account_id: "acc" }));
  const r = sh(`. "${JOBS}"; cf_token; echo "$CLOUDFLARE_API_TOKEN|$CLOUDFLARE_ACCOUNT_ID"`, { HOME: home, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" });
  assert.equal(r.stdout.trim(), "tok|acc");
});

test("cf_token exports nothing when config lacks them, so wrangler OAuth still works", () => {
  const home = tmp(); mkdirSync(join(home, ".config/kb"), { recursive: true });
  writeFileSync(join(home, ".config/kb/config.json"), JSON.stringify({ token: "x" }));
  const env = { ...process.env, HOME: home }; delete env.CLOUDFLARE_API_TOKEN; delete env.CLOUDFLARE_ACCOUNT_ID;
  const r = spawnSync("bash", ["-c", `. "${JOBS}"; cf_token; echo "\${CLOUDFLARE_API_TOKEN-unset}|\${CLOUDFLARE_ACCOUNT_ID-unset}"`], { encoding: "utf8", env });
  assert.equal(r.stdout.trim(), "unset|unset");
});

test("a failed leg exits non-zero and logs one dated FAILED line with a fix hint", () => {
  const log = join(tmp(), "auto.log");
  const r = sh(`. "${JOBS}"; fail deploy "wrangler 401" "check cloudflare_api_token"; echo unreachable`, { JOB_LOG: log, JOB: "antifeed-test" });
  assert.notEqual(r.status, 0);
  assert.ok(!r.stdout.includes("unreachable"));
  assert.match(readFileSync(log, "utf8"), /^\d{4}-\d\d-\d\d \d\d:\d\d antifeed-test: FAILED at deploy · wrangler 401 · fix: check cloudflare_api_token\n$/);
});

test("a red validator moves the edits to brain/scratch and restores the committed data", () => {
  const repo = tmp();
  mkdirSync(join(repo, "brain")); mkdirSync(join(repo, "data"));
  copyFileSync(JOBS, join(repo, "brain/jobs.sh"));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q"); writeFileSync(join(repo, "data/a.json"), "good\n");
  git("add", "."); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeFileSync(join(repo, "data/a.json"), "bad\n");
  const r = sh(`. "${repo}/brain/jobs.sh"; restore_data validate data/a.json`, { JOB_LOG: join(repo, "log") });
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(repo, "data/a.json"), "utf8"), "good\n");
  const [dir] = readdirSync(join(repo, "brain/scratch"));
  assert.equal(readFileSync(join(repo, "brain/scratch", dir, "a.json"), "utf8"), "bad\n");
  assert.match(readFileSync(join(repo, "log"), "utf8"), /FAILED at validate/);
});

test("every claude, git push/pull and deploy call in the jobs is time-boxed", () => {
  const files = ["brain/jobs.sh", "brain/curate.sh", "brain/inbox.sh", "brain/x-bookmarks.sh", "brain/auto.sh", "deploy.sh"];
  for (const f of files) for (const [i, line] of readFileSync(resolve(ROOT, f), "utf8").split("\n").entries()) {
    const code = line.replace(/#.*/, "");
    if (/\bclaude -p\b|\bgit (push|pull)\b|\.\/deploy\.sh\b|\bwrangler\b.*deploy/.test(code) && !/^\s*(\|\| )?(echo|fail|case)/.test(code) && !/"[^"]*(claude -p|git push)[^"]*"/.test(code))
      assert.match(code, /\btmo (45m|90|300)\b/, `${f}:${i + 1} ${line.trim()}`);
  }
});

test("wrangler is pinned, never a bare npx wrangler", () => {
  for (const f of ["deploy.sh", "package.json"])
    assert.doesNotMatch(readFileSync(resolve(ROOT, f), "utf8"), /npx (-y )?wrangler(?!@)\b/);
});

test("runlog: a successful run is one metrics line, never the model's words", () => {
  const raw = JSON.stringify({ subtype: "success", is_error: false, num_turns: 12, duration_ms: 61000, modelUsage: { "claude-opus-5-5": {} }, result: "secret prose" });
  const { ok, line } = runLine("curate-daily", raw, new Date(2026, 8, 27, 8, 0));
  assert.ok(ok); assert.equal(line, "2026-09-27 08:00 curate-daily: claude-opus-5-5 · 12 turns · 61s · ok");
});

test("runlog: no JSON (hung or killed by the 45m timeout) is a failure", () => {
  assert.equal(runLine("x", "").ok, false);
});
