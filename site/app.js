const LS_KEY = "antifeed:flags";
const TOKEN_KEY = "antifeed:token";
const MERGED_KEY = "antifeed:merged";
const FLAG_DEFS = [
  { key: "r", glyph: "✓", label: "mark as read" },
  { key: "f", glyph: "★", label: "star — favorite / for later" },
  { key: "x", glyph: "✕", label: "skip — hide from feed" },
];

let articles = [];
let flags = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
let tab = "must";
let filter = "all";
let token = localStorage.getItem(TOKEN_KEY);
let synced = false;
let inbox = [];
const expanded = new Set();

const $ = (sel) => document.querySelector(sel);

/* ---- flag state: localStorage cache + KV via /api/flags ---- */

function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(flags));
}

async function api(path, method, body) {
  const r = await fetch("api/" + path, {
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
      flags = (await api("flags", "POST", { merge: flags })).flags;
      localStorage.setItem(MERGED_KEY, "1");
    } else {
      flags = (await api("flags", "GET")).flags;
    }
    inbox = (await api("inbox", "GET")).inbox;
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
    api("flags", "POST", { id, key, value: f[key] }).catch(() => {
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
    <p class="byline">${esc(a.author)} · published ${fmtDate(a.published || a.date)}${
      a.hn_points ? ` · ${a.hn_points} pts / ${a.hn_comments} comments on HN` : ""}</p>
    <p class="hook">${esc(a.hook)}</p>
    <div class="actions">
      <a class="go" href="${esc(a.url)}" target="_blank" rel="noopener">Read it →</a>
      ${hn}
      <span class="spacer"></span>
      ${flagBtns(a)}
    </div>
  </article>`;
}

function inboxRows() {
  if (tab !== "more" || filter !== "all" || !inbox.length) return "";
  return inbox.map((i) => {
    let label = i.url;
    try {
      const u = new URL(i.url);
      label = u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : "");
    } catch {}
    if (label.length > 60) label = label.slice(0, 57) + "…";
    return `<li class="pending">
      <div class="row">
        <span class="when">${fmtDate(i.added)}</span>
        <span class="t">
          <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(label)}</a>
          <div class="sub">added by you${i.note ? " · " + esc(i.note) : ""} · awaiting the brain</div>
        </span>
      </div>
    </li>`;
  }).join("");
}

function renderArchive(list) {
  const pre = inboxRows();
  $("#archive").innerHTML = pre + list.map((a) => {
    const hn = a.hn_url
      ? ` · <a href="${esc(a.hn_url)}" target="_blank" rel="noopener">HN</a>` : "";
    const ever = a.evergreen ? " · evergreen" : "";
    const open = expanded.has(a.id);
    const hnMeta = a.hn_points
      ? ` · <a href="${esc(a.hn_url)}" target="_blank" rel="noopener">HN ${a.hn_points} pts / ${a.hn_comments} comments</a>` : "";
    return `<li data-id="${a.id}" class="${flags[a.id]?.r ? "read" : ""}${open ? " open" : ""}">
      <div class="row">
        <span class="when" title="curated ${fmtDate(a.date)}">${fmtDate(a.date)}</span>
        <span class="t">
          <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
          <div class="sub">${esc(a.source)} · ${a.read_minutes} min${hn}${ever}</div>
        </span>
        <span class="mini">${flagBtns(a)}</span>
      </div>
      <div class="expand" ${open ? "" : "hidden"}>
        <p class="whyline">why this made the cut</p>
        <p class="hook">${esc(a.hook)}</p>
        <div class="chips">
          <span class="chip">by ${esc(a.author)}</span>
          <span class="chip">published ${fmtDate(a.published || a.date)}</span>
          <span class="chip">curated ${fmtDate(a.date)}</span>
          <span class="chip">${a.read_minutes} min</span>
          ${a.hn_points ? `<a class="chip hot" href="${esc(a.hn_url)}" target="_blank" rel="noopener">HN ${a.hn_points}▲ · ${a.hn_comments} comments</a>` : ""}
        </div>
        <a class="go small" href="${esc(a.url)}" target="_blank" rel="noopener">Read it →</a>
      </div>
    </li>`;
  }).join("");

  const empty = $("#empty");
  empty.hidden = list.length > 0 || pre !== "";
  if (!empty.hidden) {
    empty.textContent = {
      all: tab === "must"
        ? "nothing here yet — the archive grows one read at a time."
        : "no extra reads yet.",
      r: "nothing marked read yet.",
      f: "nothing starred yet.",
      x: "nothing skipped. ruthless is good.",
    }[filter];
  }
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
      { r: "read", f: "starred", x: "skipped" }[filter];
  }
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
  if (!btn || !btn.dataset.tab) return;
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

$("#archive").addEventListener("click", (e) => {
  if (e.target.closest("a, button")) return;
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const wasOpen = expanded.has(li.dataset.id);
  expanded.clear(); // accordion: only one open at a time
  if (!wasOpen) expanded.add(li.dataset.id);
  render();
});

$("#add-link").addEventListener("click", async () => {
  if (!token) { alert("connect sync first (footer) — added links live in the shared store."); return; }
  let url = prompt("paste the link:");
  if (!url) return;
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const norm = (s) => s.replace(/\/+$/, "");
  if (articles.some((a) => norm(a.url) === norm(url))) { alert("already in the list."); return; }
  if (inbox.some((i) => norm(i.url) === norm(url))) { alert("already waiting in the inbox."); return; }
  const note = prompt("note — who shared it / why it caught you (optional):") || "";
  try {
    const res = await api("inbox", "POST", { url, note });
    inbox = res.inbox;
    if (res.dup) { alert("already waiting in the inbox."); return; }
    tab = "more"; filter = "all";
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === "more"));
    render();
  } catch {
    alert("couldn't save the link — check sync.");
  }
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
