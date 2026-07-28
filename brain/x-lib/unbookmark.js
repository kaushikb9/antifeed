// Remove the bookmark on the tweet named by the current URL.
//
// Load-bearing: a status page for a REPLY renders the whole conversation, and
// the parent tweet is the FIRST article[data-testid="tweet"] in the DOM. Taking
// the first article therefore clears the wrong bookmark — this really happened,
// twice. Always pick the article whose own permalink matches the URL, and if it
// hasn't rendered yet report WRONG-TWEET so the caller can wait and retry.
(() => {
  const want = location.pathname.match(/\/status\/(\d+)/);
  if (!want) return JSON.stringify({ status: "no-status-in-url" });
  const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  if (!arts.length) return JSON.stringify({ status: "no-article" });

  const idsOf = (art) =>
    Array.from(art.querySelectorAll('a[href*="/status/"]'))
      .map((a) => (a.getAttribute("href") || "").match(/^\/[^/]+\/status\/(\d+)$/))
      .filter(Boolean)
      .map((m) => m[1]);

  const art = arts.find((a) => idsOf(a).includes(want[1]));
  if (!art)
    return JSON.stringify({
      status: "WRONG-TWEET",
      want: want[1],
      shown: arts.map((a) => idsOf(a)[0]).filter(Boolean),
    });

  const remove = art.querySelector('[data-testid="removeBookmark"]');
  if (remove) { remove.click(); return JSON.stringify({ status: "removed" }); }
  if (art.querySelector('[data-testid="bookmark"]'))
    return JSON.stringify({ status: "already-not-bookmarked" });
  return JSON.stringify({ status: "no-button" });
})()
