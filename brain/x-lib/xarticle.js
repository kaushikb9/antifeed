// Full text of an X-native article (x.com/i/article/<id>). Needs a logged-in session.
(() => {
  const root =
    document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
    document.querySelector("article") ||
    document.body;
  const txt = (root.innerText || "").replace(/\s+/g, " ").trim();
  const time = document.querySelector("time");
  const h1 = document.querySelector("h1");
  return JSON.stringify({
    url: location.href,
    title: h1 ? h1.innerText.trim() : document.title,
    published: time ? time.getAttribute("datetime") : null,
    words: txt ? txt.split(" ").length : 0,
    text: txt.slice(0, 8000),
  });
})()
