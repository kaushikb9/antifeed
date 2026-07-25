const LS_KEY = "antifeed:flags";
const FLAG_DEFS = [
  { key: "b", glyph: "🔖", label: "read later" },
  { key: "f", glyph: "★", label: "favorite" },
  { key: "s", glyph: "↗", label: "save to share" },
];

let articles = [];
let flags = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
let filter = "all";

const $ = (sel) => document.querySelector(sel);

function saveFlags() {
  localStorage.setItem(LS_KEY, JSON.stringify(flags));
}

function toggleFlag(id, key) {
  const f = flags[id] || {};
  f[key] = !f[key];
  flags[id] = f;
  saveFlags();
  render();
}

function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function flagBtns(a, mini) {
  return FLAG_DEFS.map(({ key, glyph, label }) => {
    const on = flags[a.id]?.[key] ? "on" : "";
    return `<button class="flag ${on}" title="${label}" aria-label="${label}"
      onclick="toggleFlag('${a.id}','${key}')">${glyph}</button>`;
  }).join("");
}

function renderToday(a) {
  const hn = a.hn_url
    ? `<a class="hn" href="${esc(a.hn_url)}" target="_blank" rel="noopener">HN thread ↗</a>` : "";
  const ever = a.evergreen ? ` <span class="badge">evergreen</span>` : "";
  $("#today").innerHTML = `
  <article class="card">
    <div class="kicker">today’s read
      <span class="meta">${fmtDate(a.date)} · ${esc(a.source)} · ${a.read_minutes} min</span>
    </div>
    <h3><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>${ever}</h3>
    <p class="byline">${esc(a.author)}</p>
    <p class="hook">${esc(a.hook)}</p>
    <div class="actions">
      <a class="go" href="${esc(a.url)}" target="_blank" rel="noopener">Read it →</a>
      ${hn}
      <span class="spacer"></span>
      ${flagBtns(a)}
    </div>
  </article>`;
}

function renderArchive(rest) {
  const shown = rest.filter((a) => filter === "all" || flags[a.id]?.[filter]);
  $("#archive").innerHTML = shown.map((a) => {
    const hn = a.hn_url
      ? ` · <a href="${esc(a.hn_url)}" target="_blank" rel="noopener">HN</a>` : "";
    const ever = a.evergreen ? " · evergreen" : "";
    return `<li>
      <div class="row">
        <span class="when">${fmtDate(a.date)}</span>
        <span class="t">
          <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
          <div class="sub">${esc(a.source)} · ${a.read_minutes} min${hn}${ever}</div>
        </span>
        <span class="mini">${flagBtns(a, true)}</span>
      </div>
    </li>`;
  }).join("");

  const empty = $("#empty");
  empty.hidden = shown.length > 0;
  if (!empty.hidden) {
    empty.textContent = filter === "all"
      ? "nothing here yet — the archive grows one read at a time."
      : "nothing flagged here yet.";
  }
  $("#copy-share").hidden = filter !== "s" || shown.length === 0;
}

function render() {
  if (!articles.length) {
    $("#today").innerHTML = `<p class="empty">no picks yet — run the brain.</p>`;
    return;
  }
  const [today, ...rest] = articles;
  renderToday(today);
  // flag filters search the whole catalog, incl. today's pick
  renderArchive(filter === "all" ? rest : articles);
}

function shareMarkdown() {
  const picked = articles.filter((a) => flags[a.id]?.s);
  return picked.map((a) => {
    const hn = a.hn_url ? ` ([HN discussion](${a.hn_url}))` : "";
    return `- [${a.title}](${a.url}) — ${a.source}${hn}\n  ${a.hook}`;
  }).join("\n");
}

$("#filters").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  filter = btn.dataset.filter;
  document.querySelectorAll("#filters button").forEach((b) =>
    b.classList.toggle("active", b === btn));
  render();
});

$("#copy-share").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(shareMarkdown());
  e.target.textContent = "copied ✓";
  setTimeout(() => (e.target.textContent = "copy share list as markdown"), 1500);
});

fetch("data/articles.json")
  .then((r) => r.json())
  .then((d) => {
    articles = d.articles.slice().sort((x, y) => y.date.localeCompare(x.date));
    render();
  })
  .catch(() => {
    $("#today").innerHTML = `<p class="empty">couldn’t load articles.json</p>`;
  });
