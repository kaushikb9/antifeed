(() => {
  const art = document.querySelector('article[data-testid="tweet"]');
  if (!art) return JSON.stringify({ status: "no-article" });
  const remove = art.querySelector('[data-testid="removeBookmark"]');
  if (remove) { remove.click(); return JSON.stringify({ status: "removed" }); }
  if (art.querySelector('[data-testid="bookmark"]'))
    return JSON.stringify({ status: "already-not-bookmarked" });
  return JSON.stringify({ status: "no-button" });
})()
