# antifeed

See [`README.md`](README.md) — the single source of truth for this repo's
architecture, content model, gotchas and rules.

(`AGENTS.md` is a symlink to this file, so both names resolve here. The text
used to say "see AGENTS.md", which from this file meant "see this file" —
harmless but useless. `README.md` was the real doc the whole time. Corrected
2026-08-29.)

## kaizen writes flags here (2026-09-06)

kaizen (`~/Code/kaizen`, `functions/api/pick.js`) shows each day's must-read
from `data/articles.json` and toggles its `f` / `r` / `x` flags through
`/api/flags` with this repo's token, one `{id, key, value}` at a time. It is
the one external writer. Changing the flag keys, the POST shape, the
`must` tier name, or the public file's `date`/`tier` fields breaks it —
change both repos in the same sitting.
