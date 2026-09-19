// The data seam: site/data/articles.json and data/retired.json against
// brain/schema.json, via brain/validate.mjs. Real files first, then the
// validator's own teeth on deliberately broken entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAll, validateEntry, schema, ROOT } from "../brain/validate.mjs";

const live = JSON.parse(readFileSync(`${ROOT}/site/data/articles.json`, "utf8")).articles;
const good = () => structuredClone(live[0]);

test("the real data is clean", () => {
  assert.deepEqual(validateAll(), []);
});

test("every required field is required", () => {
  for (const k of schema.entry.required) {
    const a = good(); delete a[k];
    assert.ok(validateEntry(a, { live: true }).some((m) => m.includes(`missing field "${k}"`)), k);
  }
});

test("unknown fields are rejected — the schema is closed", () => {
  const a = good(); a.score = 5;
  assert.match(validateEntry(a, { live: true }).join("\n"), /unknown field "score"/);
});

test("hook rules apply to live entries only", () => {
  const a = good(); a.hook = Array(45).fill("word").join(" ") + " — done"; // 47 words
  const liveMsgs = validateEntry(a, { live: true }).join("\n");
  assert.match(liveMsgs, /hook is 47 words/);
  assert.match(liveMsgs, /no em dashes/);
  const r = { ...a, retired: "2026-09-06", retired_why: "superseded" };
  assert.equal(validateEntry(r, { live: false }).filter((m) => /hook/.test(m)).length, 0);
});

test("id must start with its date; dates are YYYY-MM-DD", () => {
  const a = good(); a.id = "2026-01-01-thing"; a.date = "2026-02-02";
  assert.match(validateEntry(a, { live: true }).join("\n"), /does not start with its date/);
  const b = good(); b.published = "yesterday";
  assert.match(validateEntry(b, { live: true }).join("\n"), /published .* not YYYY-MM-DD/);
});

test("resurfacing fields travel in pairs; mine is true or absent", () => {
  const a = good(); a.resurfaced = "2026-09-01";
  assert.match(validateEntry(a, { live: true }).join("\n"), /resurfaced without resurfaced_note/);
  const b = good(); b.mine = false;
  assert.match(validateEntry(b, { live: true }).join("\n"), /mine is false, must be true/);
});

test("tier is must|more; hn_url is null or an HN item", () => {
  const a = good(); a.tier = "maybe";
  assert.match(validateEntry(a, { live: true }).join("\n"), /tier is "maybe"/);
  const b = good(); b.hn_url = "https://example.com";
  assert.match(validateEntry(b, { live: true }).join("\n"), /hn_url .* does not match/);
  const c = good(); c.hn_url = null; c.hn_points = null; c.hn_comments = null;
  assert.deepEqual(validateEntry(c, { live: true }), []);
});

test("a retired entry needs a date and a reason; live entries carry neither", () => {
  const a = good();
  assert.match(validateEntry(a, { live: false }).join("\n"), /no retired date/);
  const b = { ...good(), retired: "2026-09-06" };
  assert.match(validateEntry(b, { live: false }).join("\n"), /retired without retired_why/);
  const c = { ...good(), retired: "2026-09-06", retired_why: "x" };
  assert.match(validateEntry(c, { live: true }).join("\n"), /live entry carries a retired field/);
});

test("mine entries are never retired, from 2026-09-10", () => {
  const a = { ...good(), mine: true, retired: "2026-09-10", retired_why: "oops" };
  assert.match(validateEntry(a, { live: false }).join("\n"), /never retired/);
  const b = { ...good(), mine: true, retired: "2026-09-06", retired_why: "the cut" };
  assert.equal(validateEntry(b, { live: false }).filter((m) => /never retired/.test(m)).length, 0);
});
