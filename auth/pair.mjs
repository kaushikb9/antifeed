#!/usr/bin/env node
// Mint a one-time pairing link for a browser. Open it on the device and that
// device stays paired for a year. Vendored with kb-auth.js; each repo's
// package.json runs it as `npm run pair` with the app's host:
//
//   node auth/pair.mjs https://antifeed.pages.dev
//
// The token comes from ~/.config/kb/config.json ({ token }) or KB_TOKEN in
// the environment. The host may also come from KB_HOST or config.json's
// `host` (brain's original shape) when no argument is given.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let cfg = {};
try { cfg = JSON.parse(readFileSync(join(homedir(), '.config/kb/config.json'), 'utf8')); } catch {}
const host = process.argv[2] || process.env.KB_HOST || cfg.host;
const token = process.env.KB_TOKEN || cfg.token;
if (!host || !token) {
  console.error('Usage: node auth/pair.mjs <https://host>  — token from ~/.config/kb/config.json { token } or KB_TOKEN.');
  process.exit(1);
}

const res = await fetch(`${host.replace(/\/$/, '')}/api/pair`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`${res.status} ${await res.text()}`);
  process.exit(1);
}
const { url, expiresIn } = await res.json();
console.log(url);
console.log(`Single use, expires in ${Math.round(expiresIn / 60)} minutes. Open it on the device to pair.`);
