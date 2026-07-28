#!/usr/bin/env python3
"""Resolve bookmarked tweets into article candidates.

Uses X's public syndication endpoint (no API key, no login) to expand each
bookmarked tweet into: outbound URLs, card URLs, quoted tweets, and X-native
article ids. Most article bookmarks are quote-tweets whose link lives in the
*quoted* tweet, so the walk has to recurse.

Usage: resolve.py <ids-file> <out-candidates.json> [articles.json]
"""
import json
import math
import re
import sys
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0"}


def token(tid: str) -> str:
    """Reproduce X's syndication token: base36 of (id / 1e15 * pi), minus 0s and dots."""
    t = (int(tid) / 1e15) * math.pi
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    ip, fp = int(t), t - int(t)
    out, x = "", ip
    while x:
        out = digits[x % 36] + out
        x //= 36
    out = (out or "0") + "."
    for _ in range(12):
        fp *= 36
        d = int(fp)
        out += digits[d]
        fp -= d
    return out.replace("0", "").replace(".", "")


def fetch(tid: str) -> dict:
    url = f"https://cdn.syndication.twimg.com/tweet-result?id={tid}&token={token(tid)}"
    err = "unknown"
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12))
        except Exception as e:  # noqa: BLE001 - transient network/ratelimit
            err = str(e)
            time.sleep(1.5)
    return {"error": err}


def summarize(d: dict) -> dict:
    # NOTE: quoted tweets carry no __typename, so key off id_str.
    if not isinstance(d, dict) or d.get("error") or not d.get("id_str"):
        return {"error": str((d or {}).get("error", "empty"))}
    o = {
        "id": d.get("id_str"),
        "author": d.get("user", {}).get("screen_name"),
        "name": d.get("user", {}).get("name"),
        "text": d.get("text", "")[:500],
        "urls": [u.get("expanded_url") for u in d.get("entities", {}).get("urls", []) if u.get("expanded_url")],
        "created": d.get("created_at", "")[:10],
    }
    if d.get("article"):
        o["x_article_title"] = d["article"].get("title")
    card = d.get("card") or {}
    bv = card.get("binding_values") or {}
    if isinstance(bv, dict):
        if (bv.get("card_url") or {}).get("string_value"):
            o["card_url"] = bv["card_url"]["string_value"]
        if (bv.get("title") or {}).get("string_value"):
            o["card_title"] = bv["title"]["string_value"]
    if d.get("quoted_tweet"):
        o["quoted"] = summarize(d["quoted_tweet"])
    return o


def norm(u: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", u or "").rstrip("/")


def main() -> None:
    ids = [l.strip() for l in open(sys.argv[1]) if l.strip()]
    out_path = sys.argv[2]
    have = set()
    if len(sys.argv) > 3:
        try:
            have = {norm(a["url"]) for a in json.load(open(sys.argv[3]))["articles"]}
        except Exception as e:  # noqa: BLE001
            print(f"warn: could not read articles.json: {e}", file=sys.stderr)

    rows = []
    for p in ids:
        s = summarize(fetch(p.rsplit("/", 1)[-1]))
        permalink = f"https://x.com{p}" if p.startswith("/") else p
        ext, xart = [], []

        def walk(x, depth=0):
            if not isinstance(x, dict) or x.get("error"):
                return
            aid = next((u.rsplit("/", 1)[-1] for u in x.get("urls", []) if u and "/i/article/" in u), None)
            if aid or x.get("x_article_title"):
                xart.append({
                    "article_id": aid,
                    "title": x.get("x_article_title"),
                    "author": x.get("author"),
                    "name": x.get("name"),
                    "url": f"https://x.com/{x.get('author')}/article/{x.get('id')}",
                })
            for u in list(x.get("urls", [])) + ([x["card_url"]] if x.get("card_url") else []):
                if not u or "/i/article/" in u or u.startswith("https://t.co/"):
                    continue
                if re.match(r"https?://(x|twitter)\.com/", u):
                    continue
                if u not in [e["url"] for e in ext]:
                    ext.append({"url": u, "title": x.get("card_title"), "already_in_antifeed": norm(u) in have})
            if x.get("quoted") and depth < 2:
                walk(x["quoted"], depth + 1)

        walk(s)
        rows.append({
            "permalink": permalink,
            "author": s.get("author"),
            "text": (s.get("text") or "").replace("\n", " "),
            "quoted_author": (s.get("quoted") or {}).get("author"),
            "quoted_text": ((s.get("quoted") or {}).get("text") or "").replace("\n", " ")[:200],
            "external": ext,
            "x_articles": xart,
        })
        time.sleep(0.4)

    json.dump(rows, open(out_path, "w"), indent=1)
    n_art = sum(len(r["x_articles"]) for r in rows)
    n_ext = sum(len(r["external"]) for r in rows)
    n_dup = sum(1 for r in rows for e in r["external"] if e["already_in_antifeed"])
    print(f"resolved {len(rows)} bookmarks: {n_art} X-native articles, {n_ext} external links ({n_dup} already in antifeed)")


if __name__ == "__main__":
    main()
