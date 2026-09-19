// Validates antifeed's data against brain/schema.json — the one place the
// entry shape is described. Dependency-free: the handful of JSON Schema
// keywords the schema uses are implemented here, nothing more.
//
//   node brain/validate.mjs        # CLI: exit 1 with every problem named
//   import { validateAll } from "./validate.mjs"   # tests, curate.sh
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
export const schema = JSON.parse(readFileSync(resolve(HERE, "schema.json"), "utf8"));

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
const typeOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

// Minimal JSON Schema: type, enum, const, pattern, format:date, minLength,
// minimum, items, required, properties, additionalProperties, dependentRequired.
export function check(value, sch, path = "") {
  const out = [];
  const at = (m) => out.push(path ? `${path} ${m}` : m);
  if (sch.type) {
    const types = [].concat(sch.type);
    const t = typeOf(value);
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) { at(`is ${t}, expected ${types.join("|")}`); return out; }
  }
  if (value === null) return out;
  if ("const" in sch && value !== sch.const) at(`is ${JSON.stringify(value)}, must be ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.includes(value)) at(`is ${JSON.stringify(value)}, not one of ${sch.enum.join("|")}`);
  if (typeof value === "string") {
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) at(`"${value}" does not match ${sch.pattern}`);
    if (sch.format === "date" && !isDate(value)) at(`"${value}" is not YYYY-MM-DD`);
    if (sch.minLength && value.trim().length < sch.minLength) at("is empty");
  }
  if (typeof value === "number" && sch.minimum != null && value < sch.minimum) at(`${value} is below ${sch.minimum}`);
  if (Array.isArray(value) && sch.items) value.forEach((v, i) => out.push(...check(v, sch.items, `${path}[${i}]`)));
  if (typeOf(value) === "object") {
    for (const k of sch.required || []) if (!(k in value)) at(`missing field "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      if (sch.properties?.[k]) out.push(...check(v, sch.properties[k], path ? `${path}.${k}` : k));
      else if (sch.additionalProperties === false) at(`has unknown field "${k}"`);
    }
    for (const [k, deps] of Object.entries(sch.dependentRequired || {}))
      if (k in value) for (const d of deps) if (!(d in value)) at(`has ${k} without ${d}`);
  }
  return out;
}

// One entry. `live` applies the hook rules; retired entries keep theirs as the record.
export function validateEntry(a, { live }) {
  const out = check(a, schema.entry);
  if (a && typeof a === "object") {
    if (a.id && a.date && !String(a.id).startsWith(a.date)) out.push(`id ${a.id} does not start with its date ${a.date}`);
    if (live) {
      if ("retired" in a) out.push("live entry carries a retired field");
      if (typeof a.hook === "string") {
        const n = words(a.hook);
        if (n > schema.hook.maxWords) out.push(`hook is ${n} words; the rule is under ${schema.hook.maxWords + 1}`);
        for (const f of schema.hook.forbid) if (new RegExp(f.pattern).test(a.hook)) out.push(`hook: ${f.why}`);
      }
      if (typeof a.resurfaced_note === "string" && words(a.resurfaced_note) > schema.hook.maxWords)
        out.push(`resurfaced_note is ${words(a.resurfaced_note)} words; under ${schema.hook.maxWords + 1}`);
    } else {
      if (!("retired" in a)) out.push("retired entry has no retired date");
      // Enforced from the day the validator landed; one earlier retirement
      // (2026-08-05-3b1b-neural-networks, cut 2026-09-06) predates it and is KB's call.
      if (a.mine === true && a.retired >= "2026-09-10") out.push("a mine entry was retired; mine entries are never retired");
    }
  }
  return out;
}

// Both files, plus the cross-file rules. Returns [] when clean.
export function validateAll(root = ROOT) {
  const fails = [];
  const load = (p) => {
    try { return JSON.parse(readFileSync(resolve(root, p), "utf8")); }
    catch (e) { fails.push(`${p}: not valid JSON — ${e.message}`); return null; }
  };
  const live = load("site/data/articles.json"), gone = load("data/retired.json");
  if (!live || !gone) return fails;
  if (!Array.isArray(live.articles)) fails.push("site/data/articles.json: top level must be { articles: [] }");
  if (!Array.isArray(gone.retired)) fails.push("data/retired.json: top level must be { retired: [] }");
  if (fails.length) return fails;

  const seen = new Map(), byUrl = new Map();
  for (const a of live.articles) {
    const where = `articles.json#${a.id ?? "?"}`;
    for (const m of validateEntry(a, { live: true })) fails.push(`${where}: ${m}`);
    if (seen.has(a.id)) fails.push(`${where}: duplicate id`);
    seen.set(a.id, "articles.json");
    const u = String(a.url).replace(/\/+$/, "");
    if (byUrl.has(u)) fails.push(`${where}: same url as ${byUrl.get(u)} — one entry per incident, retire the weaker`);
    byUrl.set(u, a.id);
  }
  for (const a of gone.retired) {
    const where = `retired.json#${a.id ?? "?"}`;
    for (const m of validateEntry(a, { live: false })) fails.push(`${where}: ${m}`);
    if (seen.has(a.id)) fails.push(`${where}: id also in ${seen.get(a.id)} — an entry is live or retired, not both`);
    seen.set(a.id, "retired.json");
  }
  return fails;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fails = validateAll();
  if (fails.length) {
    console.error(`\nFAIL — ${fails.length} problem${fails.length > 1 ? "s" : ""}:`);
    for (const f of fails) console.error("  " + f);
    process.exit(1);
  }
  const live = JSON.parse(readFileSync(resolve(ROOT, "site/data/articles.json"), "utf8")).articles;
  const gone = JSON.parse(readFileSync(resolve(ROOT, "data/retired.json"), "utf8")).retired;
  console.log(`ok — ${live.length} live (${live.filter((a) => a.tier === "must").length} must), ${gone.length} retired, against brain/schema.json`);
}
