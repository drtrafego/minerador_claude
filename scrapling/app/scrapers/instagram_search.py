from __future__ import annotations

import asyncio
import re
from urllib.parse import quote_plus

from ..errors import BlockedError, UpstreamError
from ..schemas import IgLead

IG_URL_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]{1,30})/?(?:[\"'\s<>]|$)")
IG_SKIP = {"p", "explore", "accounts", "reel", "reels", "stories", "tv", "direct", "tags"}


async def search(search_term: str, search_type: str, max_results: int) -> list[IgLead]:
    try:
        from scrapling.fetchers import PlayWrightFetcher
    except ImportError as exc:
        raise UpstreamError("scrapling PlayWrightFetcher indisponivel", code="deps") from exc

    if search_type == "hashtag":
        dork = f'site:instagram.com/explore/tags "{search_term.lstrip("#")}"'
    else:
        dork = f'site:instagram.com "{search_term}"'

    google_url = f"https://www.google.com/search?q={quote_plus(dork)}&num={min(max_results * 3, 50)}"

    try:
        page = await PlayWrightFetcher.async_fetch(
            google_url,
            headless=True,
            wait_selector="div#search",
            network_idle=True,
        )
    except Exception as exc:
        raise UpstreamError(f"instagram dork falhou: {exc}") from exc

    status = getattr(page, "status", None)
    if status in (429, 503):
        raise BlockedError("google rate limit")
    if status and status >= 400:
        raise UpstreamError(f"google http {status}")

    html = getattr(page, "body", None) or str(page)
    usernames = _extract_usernames(html, max_results)

    leads: list[IgLead] = []
    for username in usernames:
        leads.append(IgLead(
            username=username,
            full_name=None,
            bio=None,
            followers=None,
            following=None,
            posts_count=None,
            category=None,
            external_url=None,
            is_business_account=None,
            profile_pic_url=None,
            raw={"source": "google_dork"},
        ))
        await asyncio.sleep(0.3)

    return leads


def _extract_usernames(html: str, max_results: int) -> list[str]:
    seen: list[str] = []
    seen_set: set[str] = set()
    for m in IG_URL_RE.finditer(html):
        username = m.group(1).rstrip("/").lower()
        if username in IG_SKIP or username in seen_set:
            continue
        seen_set.add(username)
        seen.append(username)
        if len(seen) >= max_results:
            break
    return seen
