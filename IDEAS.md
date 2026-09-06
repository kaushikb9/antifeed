# antifeed — feature ideas

Shipped 2026-09-06 and removed from here: resurface starred, feedback loop
v1 (both live as the THIS MONTH block and `resurfaced` field — see README).

Future features only, deliberately not built. Defects, gaps, and
enhancements live in **GitHub issues** (`gh issue list`), not here.
Prime directive when picking anything up: **read, don't tweak systems.**

- **[S] PWA-lite** — web app manifest + standalone display for a
  chrome-less home-screen app. No service worker (offline caching would
  fight freshness).
- **[S] Quiet read counter** in the footer ("41 reads since July").
  Lifetime count only — streaks/fire-emoji mechanics are engagement bait
  and violate the ethos.
- **[S] Nightly KV→git backup** of flags + inbox via a cron curl. Makes
  KV loss a non-event.
- **[S] Archive search / tag filter** — defer until ~100 entries; before
  that it's tweaking, not reading.
- **[M] Reader profiles (shared curation, personal flags)** — invite-only:
  KB hands a friend a unique hash; they read the SAME kb-curated list but
  their read/star/skip flags sync to their own KV bucket (`flags:<hash>`).
  Not multi-tenant curation — one brain, many readers. API change: token →
  profile lookup (owner hash keeps inbox + mine; guest hashes get flags
  only). The public articles.json already supports this shape.
- **[M] Notes capture** — one text field on the expanded card, stored in
  KV beside flags; brain weaves past notes into future hooks. Only if the
  reading habit itself has stuck for a month.
- **[M] Weekly digest** — Sunday brain run writes a 5-line recap as a
  self-referential `more` entry. Cute; medium scope-creep risk.
- **[M] Public "what KB reads" page / RSS** from must entries. High
  scope-creep risk: hooks are written *to KB* — sharing quietly turns a
  private tool into a publication with a different audience.
- **[L] Multi-user / circles / voting** — documented so it can be
  declined quickly. Against everything in CLAUDE.md.
