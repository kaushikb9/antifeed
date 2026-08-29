/* antifeed — the smallest possible record of whether the read got read.
   =========================================================================
   antifeed asks a different question from touchline. Touchline is written for
   five known people and wants to know whether any of them came back.
   antifeed is public, publishes ONE thing a day, and wants to know whether
   that one thing was opened. A visit that never reaches the article is the
   site failing at its only job, and until now there was no way to see it.

   So four events, and the pair that matters is the last two:

     view   a page load, "/" or "/about/"
     tab    must reads / more / mine
     open   the article itself was opened      ← the read happened
     hn     the HN thread was opened instead   ← the comments won

   WHAT IT DOES NOT DO. No id is minted here, no cookie is set, nothing is
   kept in localStorage, and nothing about the reader is measured or sent.
   The post carries what happened and nothing else — the server works out who
   from the sync token it already has, and where from Cloudflare's own
   headers. See functions/api/telemetry.js.

   WHY IT IS A SEPARATE FILE AND ONE DELEGATED LISTENER. app.js does not know
   this exists. It listens in the capture phase on document, does no work but
   a fire-and-forget post, and never calls preventDefault — so a card added
   next month is tracked with no telemetry code written, and deleting this
   file plus one <script> line removes the feature completely. Nothing here
   can throw into app.js's own handlers.

   THE TOKEN. If the reader has the sync token, the post carries it and the
   SERVER checks it — that is how KB's own visits get told apart from a
   stranger's. A body cannot claim to be KB; a valid token proves it. This is
   the one thing antifeed can do that touchline's version cannot, because the
   token is a real credential rather than a name typed into a field.
   ========================================================================= */

(function () {
  "use strict";

  /* The two pages that exist. Anything else — a preview, a stray URL,
     /usage/ itself — sends nothing at all. /usage/ does not watch itself. */
  var PATHS = ["/", "/about/"];

  /* A page load that fired forty events was a stuck handler, not a reader.
     The server has its own limit; this one stops us reaching it. */
  var MAX = 40;
  var sent = 0;

  function path() {
    var p = location.pathname.replace(/index\.html$/, "");
    if (p.length > 1 && p.charAt(p.length - 1) !== "/") p += "/";
    return PATHS.indexOf(p) === -1 ? null : p;
  }

  var P = path();
  if (!P) return;

  /* Read directly rather than caching: the reader can connect sync mid-visit,
     and the next event should already know about it. */
  function token() {
    try { return localStorage.getItem("antifeed:token") || null; } catch (e) { return null; }
  }

  function post(e, s) {
    if (sent >= MAX) return;
    sent++;
    var body = { e: e, p: P };
    if (s) body.s = s;
    var t = token();
    if (t) body.k = t;
    try {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(function () {});
    } catch (err) {}
  }

  post("view", null);

  /* One listener, capture phase, for every click on the page. It reads the
     DOM app.js already renders — `a.go` is the article, `a.hn` is the thread,
     `#tabs button[data-tab]` is a tab — and the nearest `[data-id]` names
     which read it was. No hooks in app.js, nothing for it to keep in sync. */
  document.addEventListener(
    "click",
    function (ev) {
      var el = ev.target && ev.target.closest ? ev.target : null;
      if (!el) return;

      var tab = el.closest("#tabs button[data-tab]");
      if (tab) {
        post("tab", tab.getAttribute("data-tab"));
        return;
      }

      var link = el.closest("a.go, a.hn");
      if (!link) return;

      /* The article's own id, which is a date-slug and stable. Falls back to
         nothing rather than to a URL: a URL is the third party's, and this
         file is not in the business of recording other people's addresses. */
      var holder = link.closest("[data-id]");
      var id = holder ? holder.getAttribute("data-id") : null;
      post(link.classList.contains("hn") ? "hn" : "open", id);
    },
    true
  );
})();
