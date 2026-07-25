const LS_KEY = "antifeed:flags";
const TOKEN_KEY = "antifeed:token";
const MERGED_KEY = "antifeed:merged";
const FLAG_DEFS = [
  { key: "b", glyph: "⚑", label: "read later" },
  { key: "f", glyph: "★", label: "favorite" },
  { key: "s", glyph: "↗", label: "save to share" },
  { key: "x", glyph: "✕", label: "skip — not for me" },
];

let articles = [];
let flags = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
let tab = "must";
let filter = "all";
let token = localStorage.getItem(TOKEN_KEY);
let synced = false;

const $ = (sel) => document.querySelector(sel);

/* ---- flag state: localStorage cache + KV via /api/flags ---- */

function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(flags));
}

async function api(method, body) {
  const r = await fetch("api/flags", {
    method,
    headers: { "x-af-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("api " + r.status);
  return r.json();
}

async function syncLoad() {
  if (!token) return;
  try {
    if (!localStorage.getItem(MERGED_KEY)) {
      // first connect from this device: push local flags up, take the union
      flags = (await api("POST", { merge: flags })).flags;
      localStorage.setItem(MERGED_KEY, "1");
    } else {
      flags = (await api("GET")).flags;
    }
    synced = true;
    saveLocal();
  } catch (e) {
    synced = false;
  }
  render();
  paintSync();
}

function toggleFlag(id, key) {
  const f = flags[id] || {};
  f[key] = !f[key];
  flags[id] = f;
  saveLocal();
  render();
  if (token) {
    api("POST", { id, key, value: f[key] }).catch(() => {
      synced = false;
      paintSync();
    });
  }
}

/* ---- rendering ---- */

function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function flagBtns(a) {
  return FLAG_DEFS.map(({ key, glyph, label }) => {
    const on = flags[a.id]?.[key] ? "on" : "";
    return `<button class="flag ${on}" title="${label}" aria-label="${label}"
      onclick="toggleFlag('${a.id}','${key}')">${glyph}</button>`;
  }).join("");
}

function isSkipped(a) {
  return !!flags[a.id]?.x;
}

function visibleList() {
  if (filter === "x") return articles.filter(isSkipped);
  if (filter !== "all") return articles.filter((a) => flags[a.id]?.[filter] && !isSkipped(a));
  return articles.filter((a) => (a.tier || "must") === tab && !isSkipped(a));
}

function renderToday(a) {
  if (!a) {
    $("#today").innerHTML = `<p class="empty">nothing unskipped left — run the brain.</p>`;
    return;
  }
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

function renderArchive(list) {
  $("#archive").innerHTML = list.map((a) => {
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
        <span class="mini">${flagBtns(a)}</span>
      </div>
    </li>`;
  }).join("");

  const empty = $("#empty");
  empty.hidden = list.length > 0;
  if (!empty.hidden) {
    empty.textContent = {
      all: tab === "must"
        ? "nothing here yet — the archive grows one read at a time."
        : "no extra reads yet.",
      b: "nothing saved for later.",
      f: "no favorites yet.",
      s: "nothing on the share list.",
      x: "nothing skipped. ruthless is good.",
    }[filter];
  }
  $("#copy-share").hidden = filter !== "s" || list.length === 0;
}

function render() {
  if (!articles.length) {
    $("#today").innerHTML = `<p class="empty">no picks yet — run the brain.</p>`;
    return;
  }
  const list = visibleList();
  if (tab === "must" && filter === "all") {
    renderToday(list[0]);
    renderArchive(list.slice(1));
    $("#archive-title").textContent = "previously";
  } else {
    $("#today").innerHTML = "";
    renderArchive(list);
    $("#archive-title").textContent =
      filter === "all" ? "when you feel like wandering" :
      { b: "read later", f: "favorites", s: "to share", x: "skipped" }[filter];
  }
}

function shareMarkdown() {
  return articles.filter((a) => flags[a.id]?.s && !isSkipped(a)).map((a) => {
    const hn = a.hn_url ? ` ([HN discussion](${a.hn_url}))` : "";
    return `- [${a.title}](${a.url}) — ${a.source}${hn}\n  ${a.hook}`;
  }).join("\n");
}

/* ---- sync control ---- */

function paintSync() {
  $("#sync-btn").textContent = !token ? "sync off — connect"
    : synced ? "sync on" : "sync error — retry";
}

$("#sync-btn").addEventListener("click", () => {
  if (!token) {
    const t = prompt("sync token (same one on every device):");
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t.trim());
    location.reload();
  } else if (!synced) {
    syncLoad();
  } else if (confirm("Disconnect sync on this device?")) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MERGED_KEY);
    location.reload();
  }
});

/* ---- wiring ---- */

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  tab = btn.dataset.tab;
  filter = "all";
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("active", b === btn));
  document.querySelectorAll("#filters button").forEach((b) =>
    b.classList.toggle("active", b.dataset.filter === "all"));
  render();
});

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
    paintSync();
    syncLoad();
  })
  .catch(() => {
    $("#today").innerHTML = `<p class="empty">couldn’t load articles.json</p>`;
  });
