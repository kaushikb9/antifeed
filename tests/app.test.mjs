// The renderer seam, held to brain/schema.json at source level. site/app.js is
// a browser script; what matters here is that the vocabulary it draws is the
// vocabulary the schema (and kaizen) write. Everything that ships also parses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { schema, ROOT } from "../brain/validate.mjs";

const app = readFileSync(`${ROOT}/site/app.js`, "utf8");

test("app.js draws exactly the schema's flag keys", () => {
  const keys = [...app.matchAll(/\{ key: "([a-z])"/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [...schema.flags.keys].sort());
});

test("app.js knows every tier in the schema and no other", () => {
  for (const t of schema.tiers) assert.ok(app.includes(`"${t}"`), `tier ${t} never mentioned in app.js`);
  const tabs = [...app.matchAll(/tab === "([a-z]+)"/g)].map((m) => m[1]);
  for (const t of tabs) assert.ok(schema.tiers.includes(t) || schema.flags.keys.includes(t) || t === "mine", `tab "${t}" is neither a tier, a flag nor mine`);
});

test("everything that ships as JavaScript parses", () => {
  const files = ["site/app.js", "site/telemetry.js", "brain/snapshot.mjs", "brain/validate.mjs",
    ...readdirSync(`${ROOT}/functions/api`).map((f) => `functions/api/${f}`)];
  for (const f of files) execFileSync("node", ["--check", `${ROOT}/${f}`], { stdio: "pipe" });
});

test("prompt.md points the brain at the schema file", () => {
  assert.match(readFileSync(`${ROOT}/brain/prompt.md`, "utf8"), /brain\/schema\.json/);
});
