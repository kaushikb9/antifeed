// Collect bookmarked tweets visible in the virtualised list, then scroll.
// X renders ~10 at a time and recycles DOM nodes, so this must run in a loop.
(() => {
  const items = [];
  for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
    const permalink = Array.from(art.querySelectorAll('a[href*="/status/"]'))
      .map((a) => a.getAttribute("href"))
      .find((h) => /^\/[^/]+\/status\/\d+$/.test(h));
    const handle = art.querySelector('div[data-testid="User-Name"] a[href^="/"]');
    const text = art.querySelector('div[data-testid="tweetText"]');
    const links = new Set();
    art.querySelectorAll('a[href^="https://t.co/"]').forEach((a) => links.add(a.href));
    const card = art.querySelector('[data-testid="card.wrapper"] a[href]');
    if (card && card.href) links.add(card.href);
    items.push({
      id: permalink || null,
      author: handle ? handle.getAttribute("href") : null,
      text: text ? text.innerText.slice(0, 300) : "",
      links: [...links],
    });
  }
  window.scrollBy(0, window.innerHeight * 2.5);
  return JSON.stringify(items);
})()
