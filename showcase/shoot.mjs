// Regenerate showcase/light.png and dark.png (1280×800): the reader served from
// site/, with data/articles.json swapped for showcase/fixture.json (made-up
// entries, example.com-style sources) and /api/* stubbed, so no real pick,
// flag or inbox appears. Run: node showcase/shoot.mjs
import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(repo, "site");
const fixture = readFileSync(join(repo, "showcase", "fixture.json"));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const browser = await chromium.launch();
for (const look of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: look });
  await page.route("http://antifeed.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/data/articles.json")) return route.fulfill({ body: fixture, contentType: "application/json" });
    if (path.startsWith("/api/")) return route.fulfill({ status: 404, body: "" });
    let p = join(site, decodeURIComponent(path));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ body: readFileSync(p), contentType: types[extname(p)] || "application/octet-stream" });
  });
  await page.route(/^https?:\/\/(?!antifeed\.test)/, (r) => r.abort());
  await page.goto("http://antifeed.test/", { waitUntil: "networkidle" });
  await page.screenshot({ path: join(repo, "showcase", `${look}.png`) });
  console.log(`showcase: ${look}.png`);
  await page.close();
}
await browser.close();
