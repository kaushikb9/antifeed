# showcase

kaushik.sh/projects/ reads this folder to show antifeed. Keep it current whenever
the app's look, name or status changes, and bump `updated` when you do.
Contract: `~/Code/brain/design-system/INVARIANTS.md` → Portfolio.

- `showcase.json`: name, line (under 110 characters, for a stranger), url,
  url_label, repo (public repos only), public, updated.
- `light.png`, `dark.png`: 1280×800, the app's own content edge to edge.

## Regenerate

```sh
node showcase/shoot.mjs
```

Serves `site/` in headless Chromium with `data/articles.json` swapped for `showcase/fixture.json` (six made-up entries on `.example` sources) and `/api/*` stubbed, so no real pick, flag or inbox item appears. Edit the fixture, not the live data, to change what the shot shows.
