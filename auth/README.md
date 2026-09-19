# kb-auth

One auth for every KB app. **Canonical copy: `~/Code/brain/auth/`.** antifeed
and kaizen hold a byte-identical copy at `<repo>/auth/`; `~/Code/check-all.sh`
diffs them and goes red on drift. Edit here, copy out:

```sh
cp ~/Code/brain/auth/{kb-auth.js,kb-auth.test.mjs,pair.mjs,README.md} ~/Code/<repo>/auth/
```

## The model

One secret, `KB_TOKEN`, the same value on every Pages project and in
`~/.config/kb/config.json` (`{ token }`). Two ways to present it:

- **Bearer** — agents and scripts send `Authorization: Bearer <KB_TOKEN>`.
- **Cookie** — a browser never sees the token. On the laptop, `npm run pair`
  asks the app (with Bearer) for a single-use 15-minute link; opening it on
  the phone swaps it for a one-year HttpOnly cookie, HMAC-signed with the
  token. Rotating `KB_TOKEN` signs every device out of every app.

No users table, no login form, no token typed on a phone. The "not paired"
page is public-facing and says nothing about how pairing works; that lives in
each repo's AGENTS.md. A clone of the repo holds no secret: pairing needs the
token, which is only on the laptop and in the Pages project.

## Wiring an app

```js
// functions/_middleware.js
import { createAuth } from '../auth/kb-auth.js';
export const auth = createAuth({
  kv: 'APP_KV',                                   // binding that holds magic:* links
  app: { name: 'kaizen' },                        // named on the "not paired" page
  open: [/^\/favicon\.ico$/, /^\/icon\.svg$/],    // private app: everything else gated
  // or  gate: [/^\/api\/(flags|inbox|pair)$/],   // public site: only these gated
});
export const onRequest = auth.middleware;
```

`functions/claim.js` exports `onRequestGet = auth.claim`; `functions/api/pair.js`
exports `onRequestPost = auth.pair`. Routes then contain no auth code at all.
In `gate` mode, list `/api/pair` yourself — the test for your list should
prove it. Open icons and the manifest: iOS and Chrome fetch those without
cookies.

Inside a route that needs to know *who* (antifeed's telemetry), call
`authenticate(request, env)` → `'token' | 'cookie' | null`.

## Verify

`node --test auth/kb-auth.test.mjs` runs from each repo's `./check.sh`. Add
one test per repo for its own open/gate list — the module can't know it.

Local: `wrangler pages dev site --binding KB_TOKEN=devtoken --kv APP_KV`;
the cookie drops `Secure` on plain-http localhost so pairing works there.
