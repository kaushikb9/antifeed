// The browser half of the X bookmarks sweep: one persistent Chromium profile
// that holds KB's X login, driven by the page scripts next to this file.
//
//   node brain/x-lib/browser.mjs check                   # exit 0 logged in, 2 not
//   node brain/x-lib/browser.mjs sweep <raw.jsonl>       # scroll-and-collect bookmarks
//   node brain/x-lib/browser.mjs articles <ids> <out>    # X-native article text, one line per id
//   node brain/x-lib/browser.mjs unbookmark <urls-file>  # clear the listed bookmarks
//   node brain/x-lib/browser.mjs login                   # headed window; KB logs in
//
// Playwright comes from ~/Code/node_modules (shared by every repo); the profile
// lives at ~/.config/kb/x-profile, outside the repo. Headless and headed runs
// share that one profile, so a login made in the headed window holds for later
// headless runs. (Under gstack they were separate contexts and a server restart
// dropped the cookies.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = process.env.X_PROFILE || path.join(os.homedir(), ".config/kb/x-profile");
const script = (name) => fs.readFileSync(path.join(LIB, name), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("no playwright: run `npm install` in ~/Code (see ~/Code/AGENTS.md, Shared tools)");
  process.exit(1);
}

async function open({ headless = true } = {}) {
  // channel "chromium" = full Chromium in new-headless mode, not the headless
  // shell, which X is quicker to treat as a bot.
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chromium",
    headless,
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

// Navigation failures are not fatal, as with the old `$B goto ... || true`:
// X's SPA often never settles, and the wait after it is what matters.
async function go(page, url, waitMs) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(waitMs);
}

async function evalFile(page, name) {
  try { return await page.evaluate(script(name)); } catch { return null; }
}

async function loggedIn(page) {
  await go(page, "https://x.com/home", 4000);
  const s = JSON.parse((await evalFile(page, "check-login.js")) || "{}");
  return !!s.loggedIn;
}

// Returns false (and says what to do) rather than exiting, so the caller still
// closes the browser: an orphaned Chromium keeps the profile locked.
async function ensureLogin(page) {
  if (await loggedIn(page)) { console.log("X session OK"); return true; }
  console.log("NOT LOGGED IN to X.");
  console.log("Run:  ./brain/x-sweep.sh login   then log in, then re-run this command.");
  process.exitCode = 2;
  return false;
}

async function sweep(page, out) {
  fs.writeFileSync(out, "");
  await go(page, "https://x.com/i/bookmarks", 5000);
  const ids = new Set();
  let prev = 0, dry = 0;
  for (let i = 1; i <= 200; i++) {
    const line = (await evalFile(page, "harvest.js")) || "[]";
    fs.appendFileSync(out, line + "\n");
    try { for (const it of JSON.parse(line)) if (it.id) ids.add(it.id); } catch {}
    dry = ids.size <= prev ? dry + 1 : 0;
    prev = ids.size;
    if (i % 20 === 0) console.log(`  round ${i}: ${prev} unique`);
    // X paginates lazily and stalls for seconds at a time; a short dry streak
    // is NOT the end of the list. 15 dry rounds at 3s is the tested floor.
    if (dry >= 15) break;
    await sleep(3000);
  }
  console.log(`  swept ${prev} bookmarks`);
}

// One output line per input id, in order: a failed page writes `null` so the
// lines stay aligned with the ids (the bash version skipped them and shifted
// every later article's text onto the wrong id).
async function articles(page, idsFile, out) {
  fs.writeFileSync(out, "");
  const ids = fs.readFileSync(idsFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    await go(page, `https://x.com/i/article/${id}`, 3500);
    const r = await evalFile(page, "xarticle.js");
    fs.appendFileSync(out, (r ? r.replace(/\n/g, " ") : "null") + "\n");
  }
}

async function unbookmark(page, listFile) {
  const urls = fs.readFileSync(listFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  for (const u of urls) {
    await go(page, u, 3000);
    let r = (await evalFile(page, "unbookmark.js")) || "{}";
    // WRONG-TWEET means the SPA had not swapped the DOM yet. Retrying is
    // mandatory, not optional: clicking anyway clears somebody else's bookmark.
    if (/WRONG-TWEET|no-article/.test(r)) {
      await sleep(4000);
      r = (await evalFile(page, "unbookmark.js")) || "{}";
    }
    if (/removed|already-not-bookmarked/.test(r)) ok++;
    else { fail++; console.log(`  FAILED: ${u} -> ${r}`); }
    await sleep(1000);
  }
  console.log(`unbookmarked ${ok}, failed ${fail}`);
  // Removing bookmarks lets X paginate deeper: older bookmarks that were never
  // rendered can appear afterwards. Always re-run harvest once after removals.
  console.log("NOTE: re-run './brain/x-sweep.sh harvest' — removals can surface older bookmarks.");
}

async function login() {
  const { ctx, page } = await open({ headless: false });
  await go(page, "https://x.com/login", 2000);
  console.log("Log into X in the window that opened. It closes by itself once you're in (10 minutes max).");
  let closed = false;
  ctx.on("close", () => { closed = true; });
  for (let i = 0; i < 200 && !closed; i++) {
    const s = JSON.parse((await page.evaluate(script("check-login.js")).catch(() => null)) || "{}");
    if (s.loggedIn) { console.log("X session OK. Now run: ./brain/x-sweep.sh harvest"); break; }
    await sleep(3000);
  }
  if (!closed) await ctx.close();
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "login") {
  await login();
} else {
  const { ctx, page } = await open();
  try {
    if (cmd === "check") {
      const ok = await loggedIn(page);
      console.log(ok ? "X session OK" : "NOT LOGGED IN to X.");
      process.exitCode = ok ? 0 : 2;
    } else if (cmd === "sweep" && a) {
      if (await ensureLogin(page)) { console.log("sweeping bookmarks..."); await sweep(page, a); }
    } else if (cmd === "articles" && a && b) {
      await articles(page, a, b);
    } else if (cmd === "unbookmark" && a) {
      if (await ensureLogin(page)) await unbookmark(page, a);
    } else {
      console.error("usage: browser.mjs check | sweep <out> | articles <ids> <out> | unbookmark <file> | login");
      process.exitCode = 1;
    }
  } finally {
    await ctx.close();
  }
}
