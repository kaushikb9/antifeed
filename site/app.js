const LS_KEY = "antifeed:flags";
const TOKEN_KEY = "antifeed:token";
const MERGED_KEY = "antifeed:merged";
const QUEUE_KEY = "antifeed:queue";
const ICONS = {
  f: `<svg class="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 6.1 6.6.7-4.9 4.5 1.4 6.6L12 17.1 6 20.4l1.4-6.6-4.9-4.5 6.6-.7L12 2.5z"/></svg>`,
  r: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
};
const FLAG_DEFS = [
  { key: "f", glyph: ICONS.f, label: "star — favorite / for later" },
  { key: "r", glyph: ICONS.r, label: "mark as read" },
  { key: "x", glyph: ICONS.x, label: "skip — hide from feed" },
];

let articles = [];
let flags = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
let queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
let tab = "must"; // must | more | mine | f (starred) | r (read) | x (skipped)
let token = localStorage.getItem(TOKEN_KEY);
let synced = false;
let inbox = [];
const expanded = new Set();

const $ = (sel) => document.querySelector(sel);

/* ---- flag state: localStorage cache + KV via /api/flags ---- */

function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(flags));
}

function saveQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// replay unsent toggle deltas in order; false = server unreachable
async function flushQueue() {
  while (queue.length) {
    try {
      await api("flags", "POST", queue[0]);
      queue.shift();
      saveQueue();
    } catch (e) {
      synced = false;
      paintSync();
      return false;
    }
  }
  return true;
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
      queue = [];
      saveQueue();
    } else {
      // replay offline toggles BEFORE pulling, or the GET would erase them
      if (!(await flushQueue())) throw new Error("queue not flushed");
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
  queue.push({ id, key, value: f[key] });
  saveQueue();
  render();
  if (token) {
    flushQueue().then((ok) => {
      if (ok && !synced) { synced = true; paintSync(); }
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
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// data attributes + delegation, not inline onclick: ids come from
// brain-written JSON, and an id with a quote in it must stay data, not code
function flagBtns(a) {
  return FLAG_DEFS.map(({ key, glyph, label }) => {
    const on = flags[a.id]?.[key] ? "on" : "";
    return `<button class="flag ${on}" title="${label}" aria-label="${label}"
      data-id="${esc(a.id)}" data-key="${key}">${glyph}</button>`;
  }).join("");
}

function isSkipped(a) {
  return !!flags[a.id]?.x;
}

function visibleList() {
  if (tab === "x") return articles.filter(isSkipped);
  if (tab === "f" || tab === "r")
    return articles.filter((a) => flags[a.id]?.[tab] && !isSkipped(a));
  if (tab === "mine") return articles.filter((a) => a.mine && !isSkipped(a));
  // "more" excludes mine items (they live in their own tab); "must" keeps
  // promoted mine picks — dope is dope.
  return articles.filter((a) =>
    (a.tier || "must") === tab && !(tab === "more" && a.mine) && !isSkipped(a));
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
  <article class="card" data-id="${esc(a.id)}">
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
  if (tab !== "mine" || !inbox.length) return "";
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
        <article class="card mini">
          <div class="kicker">why this made the cut
            <span class="meta">published ${fmtDate(a.published || a.date)} · curated ${fmtDate(a.date)} · ${a.read_minutes} min</span>
          </div>
          <p class="byline">${esc(a.author)}${a.hn_points ? ` · ${a.hn_points} pts / ${a.hn_comments} comments on HN` : ""}</p>
          <p class="hook">${esc(a.hook)}</p>
          <div class="actions">
            <a class="go" href="${esc(a.url)}" target="_blank" rel="noopener">Read it →</a>
            ${a.hn_url ? `<a class="hn" href="${esc(a.hn_url)}" target="_blank" rel="noopener">HN thread ↗</a>` : ""}
          </div>
        </article>
      </div>
    </li>`;
  }).join("");

  const empty = $("#empty");
  empty.hidden = list.length > 0 || pre !== "";
  if (!empty.hidden) {
    empty.textContent = {
      must: "nothing here yet — the archive grows one read at a time.",
      more: "no extra reads yet.",
      mine: "nothing saved — paste a link above.",
      f: "nothing starred yet.",
      r: "nothing marked read yet.",
      x: "nothing skipped. ruthless is good.",
    }[tab];
  }
}

function render() {
  if (!articles.length) {
    $("#today").innerHTML = `<p class="empty">no picks yet — run the brain.</p>`;
    return;
  }
  $("#add-form").hidden = tab !== "mine";
  const list = visibleList();
  if (tab === "must") {
    renderToday(list[0]);
    renderArchive(list.slice(1));
    $("#archive-title").textContent = "previously";
  } else {
    $("#today").innerHTML = "";
    renderArchive(list);
    $("#archive-title").textContent = {
      more: "when you feel like wandering",
      mine: "saved by me",
      f: "starred",
      r: "read",
      x: "skipped",
    }[tab];
  }
}

/* ---- clipper: bookmarklet / share sheet opens #add=<url>&t=<title> ---- */

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}

async function handleClip() {
  // ?add= is what the bookmarklet sends (a # inside a javascript: URL gets
  // mangled by some browsers); #add= kept for bookmarklets dragged before
  // the switch
  const p = new URLSearchParams(
    location.hash.startsWith("#add=") ? location.hash.slice(1) : location.search);
  const url = (p.get("add") || "").trim();
  const title = (p.get("t") || "").trim();
  if (!url) return;
  history.replaceState(null, "", location.pathname);
  if (!token) {
    // bookmarks sync across browsers/profiles; the token doesn't — connect
    // right here so the clip isn't lost
    const t = prompt("connect sync to save this clip — sync token (same one on every device):");
    if (!t) return;
    token = t.trim();
    localStorage.setItem(TOKEN_KEY, token);
    $('#tabs [data-tab="mine"]').hidden = false;
    await syncLoad();
  }
  setTab("mine");
  const norm = (s) => s.replace(/\/+$/, "");
  if (articles.some((a) => norm(a.url) === norm(url))) { toast("already in the list"); return; }
  try {
    const res = await api("inbox", "POST", { url, note: title.slice(0, 300) });
    inbox = res.inbox;
    render();
    toast(res.dup ? "already saved" : "saved — awaiting the brain");
  } catch {
    toast("couldn’t save — check sync");
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
    // the error state must not be a dead end: a wrong or rotated token used
    // to leave "retry" looping forever with no way to enter a new one
    if (confirm("Sync is failing. Re-enter the token? (Cancel just retries.)")) {
      const t = prompt("sync token (same one on every device):");
      if (!t) return;
      localStorage.setItem(TOKEN_KEY, t.trim());
      location.reload();
    } else {
      syncLoad();
    }
  } else if (confirm("Disconnect sync on this device?")) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MERGED_KEY);
    location.reload();
  }
});

/* ---- wiring ---- */

function setTab(next) {
  tab = next;
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === next));
  render();
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || !btn.dataset.tab) return;
  setTab(btn.dataset.tab);
});

// clicking "Read it →" IS reading it — mark r without a second tap (#1).
// Mark-only: a repeat click must never un-read it.
function markRead(id) {
  if (id && !flags[id]?.r) toggleFlag(id, "r");
}

// shared by the today card and archive rows: flag buttons, and the
// read-marking on the outbound link. Returns true when the click was handled.
function onCardClick(e) {
  const btn = e.target.closest("button.flag");
  if (btn) {
    toggleFlag(btn.dataset.id, btn.dataset.key);
    return true;
  }
  if (e.target.closest("a.go")) {
    markRead(e.target.closest("[data-id]")?.dataset.id);
  }
  return false;
}

$("#today").addEventListener("click", onCardClick);

$("#archive").addEventListener("click", (e) => {
  if (onCardClick(e)) return;
  if (e.target.closest("a, button")) return;
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const wasOpen = expanded.has(li.dataset.id);
  expanded.clear(); // accordion: only one open at a time
  if (!wasOpen) expanded.add(li.dataset.id);
  render();
});

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!token) { alert("connect sync first (footer) — saved links live in the shared store."); return; }
  let url = $("#add-url").value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const norm = (s) => s.replace(/\/+$/, "");
  if (articles.some((a) => norm(a.url) === norm(url))) { alert("already in the list."); return; }
  if (inbox.some((i) => norm(i.url) === norm(url))) { alert("already saved."); return; }
  try {
    const res = await api("inbox", "POST", { url, note: $("#add-note").value.trim() });
    inbox = res.inbox;
    if (res.dup) { alert("already saved."); return; }
    $("#add-url").value = "";
    $("#add-note").value = "";
    render();
  } catch {
    alert("couldn't save the link — check sync.");
  }
});

/* ---- themes: presets, not a settings panel (shared with kaizen) ---- */

const THEME_KEY = "antifeed:theme";
const THEMES = [
  ["", "Auto"],
  ["paper", "Paper"],
  ["ink", "Ink"],
  ["graphite", "Graphite"],
  ["nordic", "Nordic"],
  ["dieci", "Dieci"],
];
// the old button stored auto/light/dark; keep those choices meaning what they
// meant rather than resetting anyone to a palette they didn't pick
const LEGACY = { light: "paper", dark: "ink", auto: "" };

function applyTheme(id) {
  if (id) document.documentElement.dataset.theme = id;
  else delete document.documentElement.dataset.theme;
  id ? localStorage.setItem(THEME_KEY, id) : localStorage.removeItem(THEME_KEY);
  document.querySelectorAll("#themes button").forEach((b) =>
    b.classList.toggle("sel", b.dataset.theme === id));
}

(function initThemes() {
  const row = document.createElement("nav");
  row.className = "themes";
  row.id = "themes";
  row.innerHTML = THEMES.map(
    ([id, name]) => `<button data-theme="${id}">${name}</button>`
  ).join("");
  row.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) applyTheme(b.dataset.theme);
  });
  document.body.appendChild(row);

  const saved = localStorage.getItem(THEME_KEY) || "";
  const mapped = saved in LEGACY ? LEGACY[saved] : saved;
  applyTheme(THEMES.some(([id]) => id === mapped) ? mapped : "");
})();

// "mine" is personal — without sync (no token) the tab has no point
$('#tabs [data-tab="mine"]').hidden = !token;
if (!token && tab === "mine") tab = "must";

fetch("data/articles.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then((d) => {
    articles = d.articles.slice().sort((x, y) => y.date.localeCompare(x.date));
    render();
    paintSync();
    syncLoad();
    handleClip();
  })
  .catch(() => {
    $("#today").innerHTML = `<p class="empty">couldn’t load articles.json</p>`;
  });
