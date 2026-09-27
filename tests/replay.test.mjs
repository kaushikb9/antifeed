// The replay seam: brain/replay.mjs reruns a past day in scratch, and
// curate.sh's input archive has a fixed shape. No network, no claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, prepareScratch, parseArgs, picksOf, DEFAULTS } from "../brain/replay.mjs";
import { writeArchive, ARCHIVE_KEYS } from "../brain/replay/archive.mjs";

const hash = (p) => createHash("sha256").update(readFileSync(resolve(ROOT, p))).digest("hex");
const lastDaily = () => execFileSync("git", ["log", "--format=%s", "--grep=^curate: daily ", "-1"], { cwd: ROOT, encoding: "utf8" }).trim().split(" ").pop();

test("replay never writes site/data: scratch is outside the repo and the real files are untouched", () => {
  const files = ["site/data/articles.json", "data/retired.json"];
  const pre = files.map(hash);
  const { scratch } = prepareScratch(lastDaily());
  assert.ok(relative(ROOT, scratch).startsWith(".."), scratch);
  writeFileSync(resolve(scratch, "site/data/articles.json"), '{"articles":[]}'); // what a brain would do
  assert.deepEqual(files.map(hash), pre);
});

test("replay starts from the state before that day's pick", () => {
  const date = lastDaily();
  const { scratch, shipped } = prepareScratch(date);
  const before = JSON.parse(readFileSync(resolve(scratch, "site/data/articles.json"), "utf8")).articles;
  assert.ok(picksOf(before, shipped, date).length >= 1);
});

test("replay refuses a scratch dir inside the repo", () => {
  assert.throws(() => prepareScratch(lastDaily(), { dir: resolve(ROOT, "site/data") }), /outside the repo/);
});

test("replay uses curate.sh's pinned model and effort by default", () => {
  const sh = readFileSync(resolve(ROOT, "brain/curate.sh"), "utf8");
  assert.match(sh, new RegExp(`--model ${DEFAULTS.model} --effort ${DEFAULTS.effort}\\b`));
  assert.deepEqual([parseArgs(["2026-09-27", "--model", "m", "--effort", "high"]).model, parseArgs(["2026-09-27", "--effort", "high"]).effort], ["m", "high"]);
});

test("the input archive has a fixed shape and survives a bad inbox", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "af-archive-"));
  const p = writeArchive({ date: "2026-09-27", mode: "daily", thisMonth: "Starred: x.", inbox: "not json" }, dir);
  assert.ok(existsSync(resolve(dir, "2026-09-27.json")));
  const a = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(Object.keys(a), ARCHIVE_KEYS);
  assert.deepEqual(a.inbox, { inbox: [] });
  assert.equal(a.candidates, null);
});

test("curate.sh's archive write cannot fail the run", () => {
  const sh = readFileSync(resolve(ROOT, "brain/curate.sh"), "utf8");
  assert.match(sh, /node brain\/replay\/archive\.mjs >\/dev\/null 2>&1 \|\| true/);
});
