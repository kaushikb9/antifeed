// Saves the inputs a real curate run had, so `node brain/replay.mjs <date>`
// can rerun that day later. Called by curate.sh; never fails the run.
//
// Gap: candidates are discovered by the model mid-run (WebSearch/WebFetch on
// the sources in brain/sources.md), so there is no candidate list to keep
// until the planned candidate pre-fetch lands. `candidates` is null until then.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INPUTS = resolve(dirname(fileURLToPath(import.meta.url)), "inputs");
export const ARCHIVE_KEYS = ["date", "mode", "this_month", "inbox", "candidates", "candidates_note", "archived_at"];

export function buildArchive({ date, mode, thisMonth, inbox }) {
  let parsed;
  try { parsed = JSON.parse(inbox); } catch { parsed = { inbox: [] }; }
  return {
    date, mode,
    this_month: thisMonth ?? "",
    inbox: parsed,
    candidates: null,
    candidates_note: "not archived: the brain finds candidates itself mid-run; lands with the candidate pre-fetch",
    archived_at: new Date().toISOString(),
  };
}

export function writeArchive(input, dir = INPUTS) {
  const a = buildArchive(input);
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, `${a.date}.json`);
  writeFileSync(p, JSON.stringify(a, null, 2) + "\n");
  return p;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const e = process.env;
    writeArchive({ date: e.AF_DATE, mode: e.AF_MODE, thisMonth: e.AF_THIS_MONTH, inbox: e.AF_INBOX });
  } catch {}
}
