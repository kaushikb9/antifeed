/* usage — was the read read.
   =========================================================================
   The third page, and the only one that is not the product: nothing links
   here, and it is empty for everyone but KB, whose sync token doubles as the
   admin key. /api/telemetry answers 404 to anybody else, so this page cannot
   show anything it was not given.

   The aggregation lives here rather than in the Function on purpose. The
   server's job is to remember; deciding that "opened vs. merely visited" is
   the interesting cut — and changing that decision next week — is a page
   concern, and a page can be reloaded without a deploy of anything else.

   THE ONE NUMBER. antifeed publishes one thing a day. The question is not
   how many people came, it is what share of the READERS reached the article.
   People, not events: one reader who opens the piece and then its HN thread
   is one reader who got there, not two. That is the first thing on the page,
   and everything under it exists to explain a bad one:

     the strip    visits, opens, the share of READERS who reached the read,
                  strangers, and when the last visit was
     the verdict  one sentence naming what the rate means today, because a
                  percentage with no reading of it is a number, not an answer
     the reads    every article opened in the window, most-opened first, with
                  the HN thread counted separately — if the thread beats the
                  article consistently, the curation is picking arguments
                  rather than essays, and that is worth seeing
     tabs         must reads / more / mine, which says whether the day's pick
                  is enough or KB is digging past it
     who & where  KB against strangers, then country and device
     the last     fifty events, plainly, because a total hides the story of
                  an evening and a list does not
   ========================================================================= */

(function () {
  "use strict";

  var TOKEN_KEY = "antifeed:token";
  var main = document.getElementById("main");

  var RANGES = [
    { d: 1, label: "24 hours" },
    { d: 7, label: "7 days" },
    { d: 30, label: "30 days" },
    { d: 90, label: "90 days" },
  ];
  var range = 7;

  /* The API stores paths because a path cannot drift; the page says the
     pages' names because KB does not think in URLs. */
  var PAGE = { "/": "today", "/about/": "about" };
  var TAB = { must: "must reads", more: "more", mine: "mine" };

  /* ---------------- small helps ---------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function ago(iso) {
    var ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms)) return "";
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }

  /* An article id is `2026-07-25-software-getting-worse`. The date is already
     the row's own column elsewhere, so the title reads better without it. */
  function slugTitle(id) {
    if (!id) return "(unnamed)";
    return String(id).replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  }

  function pct(n, d) {
    if (!d) return "—";
    return Math.round((n / d) * 100) + "%";
  }

  function countBy(rows, key) {
    var m = new Map();
    rows.forEach(function (r) {
      var k = typeof key === "function" ? key(r) : r[key];
      if (k == null || k === "") return;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort(function (a, b) { return b[1] - a[1]; });
  }

  /* A bar that is a share of the biggest row, not of the total: with two
     rows a share-of-total bar is always half the width and says nothing. */
  function bar(n, max) {
    var w = max ? Math.max(2, Math.round((n / max) * 90)) : 2;
    return '<span class="u-bar" style="width:' + w + 'px"></span>';
  }

  function table(head, rows, empty) {
    if (!rows.length) return '<p class="u-empty">' + esc(empty) + "</p>";
    return (
      '<div class="u-scroll"><table class="u"><thead><tr>' +
      head.map(function (h) {
        return '<th class="' + (h.n ? "n" : "") + '">' + esc(h.label) + "</th>";
      }).join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  function section(title, inner) {
    return '<section class="u-sec"><h2>' + esc(title) + "</h2>" + inner + "</section>";
  }

  /* ---------------- the page ---------------- */

  function controls() {
    return (
      '<div class="u-controls">' +
      RANGES.map(function (r) {
        return '<button data-days="' + r.d + '" aria-pressed="' +
          (r.d === range) + '">' + esc(r.label) + "</button>";
      }).join("") +
      '<span class="u-dim" id="u-stamp"></span></div>'
    );
  }

  function render(data) {
    var ev = (data.events || []).slice();
    var views = ev.filter(function (e) { return e.e === "view"; });
    var todayViews = views.filter(function (e) { return e.p === "/"; });
    var opens = ev.filter(function (e) { return e.e === "open"; });
    var hns = ev.filter(function (e) { return e.e === "hn"; });
    var tabs = ev.filter(function (e) { return e.e === "tab"; });

    /* The rate counts PEOPLE, not events, and it took a 200% to work that
       out: one reader who opens the article and then the HN thread produces
       two opens against one visit, so opens-over-visits is not a rate at all.
       A reader who reached the read once reached it, and reading it twice is
       not more reached.

       Identity here is the same thing the server recorded — "kb" when the
       token proved it, otherwise the day's rotating stranger hash — so this
       is as honest as the data underneath and no more: across a day boundary
       the same stranger counts twice, which is stated on the page.

       Only visits to "/" count as a chance to open the read. A visit to
       /about/ never was one, and counting it would flatter or punish the
       number depending on traffic that has nothing to do with the question. */
    var who = function (e) { return e.w === "kb" ? "kb" : e.v; };
    var readers = new Set(todayViews.map(who).filter(Boolean));
    var reachers = new Set(opens.concat(hns).map(who).filter(Boolean));
    var rate = readers.size ? Math.min(1, reachers.size / readers.size) : 0;

    var strangers = new Set(ev.filter(function (e) { return e.v; })
      .map(function (e) { return e.v; })).size;
    var mine = ev.filter(function (e) { return e.w === "kb"; }).length;

    var last = ev.length ? ev[0].t : null;

    var html = "";
    html += controls();

    /* ---- the strip ---- */
    html +=
      '<div class="u-strip">' +
      stat(todayViews.length, "visits to today") +
      stat(opens.length, "articles opened") +
      stat(hns.length, "HN threads opened") +
      stat(readers.size ? Math.round(rate * 100) + "%" : "—", "of readers reached it") +
      stat(strangers, strangers === 1 ? "stranger" : "strangers") +
      stat(last ? ago(last) : "—", "last visit") +
      "</div>";

    /* ---- the verdict ---- */
    html += '<p class="u-verdict">' +
      verdict(readers.size, reachers.size, rate, opens, hns) + "</p>";

    /* ---- the reads ---- */
    var byRead = new Map();
    opens.concat(hns).forEach(function (e) {
      var id = e.s || "(unnamed)";
      if (!byRead.has(id)) byRead.set(id, { id: id, open: 0, hn: 0, last: e.t });
      var r = byRead.get(id);
      if (e.e === "hn") r.hn++; else r.open++;
      if (Date.parse(e.t) > Date.parse(r.last)) r.last = e.t;
    });
    var reads = [...byRead.values()].sort(function (a, b) {
      return (b.open + b.hn) - (a.open + a.hn);
    });
    var maxRead = reads.length ? reads[0].open + reads[0].hn : 0;

    html += section(
      "What got opened",
      table(
        [{ label: "read" }, { label: "article", n: true }, { label: "HN", n: true },
         { label: "" }, { label: "last" }],
        reads.map(function (r) {
          return "<tr><td class=\"wide\">" + esc(slugTitle(r.id)) + "</td>" +
            '<td class="n">' + r.open + "</td>" +
            '<td class="n">' + (r.hn || '<span class="u-dim">·</span>') + "</td>" +
            "<td>" + bar(r.open + r.hn, maxRead) + "</td>" +
            '<td class="u-dim">' + esc(ago(r.last)) + "</td></tr>";
        }),
        "Nothing opened in this window."
      )
    );

    /* ---- tabs ---- */
    var tabRows = countBy(tabs, "s");
    var maxTab = tabRows.length ? tabRows[0][1] : 0;
    html += section(
      "Tabs tapped",
      table(
        [{ label: "tab" }, { label: "taps", n: true }, { label: "" }],
        tabRows.map(function (r) {
          return "<tr><td>" + esc(TAB[r[0]] || r[0]) + "</td>" +
            '<td class="n">' + r[1] + "</td><td>" + bar(r[1], maxTab) + "</td></tr>";
        }),
        "No tabs tapped — everything happened on the day's pick."
      )
    );

    /* ---- who ---- */
    html += section(
      "Who",
      table(
        [{ label: "" }, { label: "events", n: true }, { label: "share", n: true }],
        [
          '<tr><td class="u-me">you</td><td class="n">' + mine + '</td><td class="n">' +
            pct(mine, ev.length) + "</td></tr>",
          "<tr><td>strangers</td><td class=\"n\">" + (ev.length - mine) +
            '</td><td class="n">' + pct(ev.length - mine, ev.length) + "</td></tr>",
        ],
        "Nothing yet."
      )
    );

    /* ---- where and what on ---- */
    var places = countBy(ev, function (e) {
      return e.c ? (e.y ? e.y + ", " + e.c : e.c) : null;
    }).slice(0, 8);
    var maxPlace = places.length ? places[0][1] : 0;
    html += section(
      "Where from",
      table(
        [{ label: "place" }, { label: "events", n: true }, { label: "" }],
        places.map(function (r) {
          return "<tr><td>" + esc(r[0]) + '</td><td class="n">' + r[1] +
            "</td><td>" + bar(r[1], maxPlace) + "</td></tr>";
        }),
        "No location on any event."
      )
    );

    var devices = countBy(ev, "d");
    var maxDev = devices.length ? devices[0][1] : 0;
    html += section(
      "Read on",
      table(
        [{ label: "device" }, { label: "events", n: true }, { label: "" }],
        devices.map(function (r) {
          return "<tr><td>" + esc(r[0]) + '</td><td class="n">' + r[1] +
            "</td><td>" + bar(r[1], maxDev) + "</td></tr>";
        }),
        "Nothing yet."
      )
    );

    /* ---- the last fifty ---- */
    html += section(
      "The last fifty",
      ev.length
        ? '<ul class="u-feed">' + ev.slice(0, 50).map(function (e) {
            return "<li><span class=\"w\">" + esc(clock(e.t)) + '</span><span class="b">' +
              line(e) + "</span></li>";
          }).join("") + "</ul>"
        : '<p class="u-empty">Nothing in this window.</p>'
    );

    if (data.truncated) {
      html += '<p class="u-note"><strong>Truncated.</strong> More events exist in ' +
        "this window than one read will return. Narrow the range for an exact count.</p>";
    }

    html += '<p class="u-note">One line per page view, per tab tap and per link ' +
      "opened, kept ninety days, then forgotten automatically. No IP is stored and " +
      "no id is minted in the page: a visit without the sync token is counted as a " +
      "stranger under a hash that changes daily, so the same person tomorrow is a " +
      "new one. Automated visits — the bookmark sweep, /browse dogfooding — are " +
      "dropped server-side rather than counted.</p>";

    main.innerHTML = html;
    var stamp = document.getElementById("u-stamp");
    if (stamp) stamp.textContent = ev.length + " events since " + clock(data.since);

    main.querySelector(".u-controls").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-days]");
      if (!b) return;
      range = Number(b.getAttribute("data-days"));
      load();
    });
  }

  function stat(value, label) {
    return '<div class="u-stat"><b>' + esc(value) + "</b><span>" + esc(label) + "</span></div>";
  }

  /* A percentage with no reading of it is a number, not an answer. Each
     branch names what to do about it, or says plainly that there is nothing
     to conclude yet — which is the honest answer most days on a site with
     one reader. */
  function verdict(readers, reachers, rate, opens, hns) {
    if (!readers) return "Nobody reached the day's read in this window. <em>Nothing to conclude.</em>";
    if (readers < 5) {
      return "Only " + readers + " reader" + (readers === 1 ? "" : "s") +
        " opened the page in this window — <em>too few for a rate to mean anything.</em>";
    }
    var p = Math.round(rate * 100) + "%";
    if (!reachers) {
      return "<strong>" + readers + " readers, nothing opened.</strong> The page is being " +
        "looked at and the pick is not being taken — <em>that is a hook problem, not a " +
        "traffic problem.</em>";
    }
    if (hns.length > opens.length) {
      return "The HN thread beat the article " + hns.length + " to " + opens.length +
        ". <em>The picks are landing as arguments to read about rather than essays " +
        "to read.</em>";
    }
    if (rate >= 0.5) {
      return "<strong>" + p + " of readers reached the read.</strong> " +
        "<em>The pick is doing its job.</em>";
    }
    if (rate >= 0.2) {
      return p + " of readers reached the read. <em>Middling — the hook is getting " +
        "attention but not commitment.</em>";
    }
    return "<strong>" + p + " of readers reached the read.</strong> <em>Most visits " +
      "end at the hook.</em>";
  }

  function line(e) {
    var who = e.w === "kb"
      ? '<span class="u-me">you</span>'
      : '<span class="u-dim">' + esc(e.v || "someone") + "</span>";
    var where = e.c ? ' <span class="u-dim">· ' + esc(e.y ? e.y + ", " + e.c : e.c) + "</span>" : "";
    var dev = ' <span class="u-dim">· ' + esc(e.d || "?") + "</span>";
    var what;
    if (e.e === "view") what = "opened " + esc(PAGE[e.p] || e.p);
    else if (e.e === "tab") what = "tapped " + esc(TAB[e.s] || e.s);
    else if (e.e === "open") what = "<strong>read</strong> " + esc(slugTitle(e.s));
    else what = "opened the HN thread on " + esc(slugTitle(e.s));
    return who + " " + what + where + dev;
  }

  /* ---------------- load ---------------- */

  function load() {
    var token;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (err) { token = null; }

    if (!token) {
      main.innerHTML =
        '<p class="empty">This page needs the sync token. Connect sync on ' +
        '<a href="../">today</a> first — it is the same token on every device.</p>';
      return;
    }

    fetch("/api/telemetry?days=" + range, { headers: { "x-af-token": token } })
      .then(function (r) {
        if (r.status === 404) throw new Error("nope");
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        main.innerHTML = err && err.message === "nope"
          ? '<p class="empty">Nothing here.</p>'
          : '<p class="empty">Could not load usage. Reload to try again.</p>';
      });
  }

  load();
})();
