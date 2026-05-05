from __future__ import annotations

import re
from urllib.parse import quote_plus, urlparse

from ..errors import BlockedError, UpstreamError
from ..schemas import LinkedInProfile

LINKEDIN_URL_RE = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9\-_%]+)/?", re.IGNORECASE)


async def search(query: str, max_results: int, location: str | None = None) -> list[LinkedInProfile]:
    try:
        from scrapling.fetchers import StealthyFetcher
    except ImportError as exc:
        raise UpstreamError("scrapling StealthyFetcher indisponivel", code="deps") from exc

    search_query = f'site:linkedin.com/in "{query}"'
    if location:
        search_query = f'site:linkedin.com/in "{query}" "{location}"'
    google_url = f"https://www.google.com/search?q={quote_plus(search_query)}&num={min(max_results * 2, 100)}"

    try:
        page = await StealthyFetcher.async_fetch(google_url, headless=True, wait_selector="div", network_idle=True)
    except Exception as exc:
        raise UpstreamError(f"falha ao buscar no google: {exc}") from exc

    status = getattr(page, "status", None)
    if status in (429, 503):
        raise BlockedError("google rate limit/block")
    if status and status >= 400:
        raise UpstreamError(f"google http {status}")

    html = getattr(page, "body", None) or str(page)
    seen: dict[str, LinkedInProfile] = {}

    for match in LINKEDIN_URL_RE.finditer(html):
        public_id = match.group(1).rstrip("/")
        if not public_id or public_id.lower() in {"login", "signup", "pub"}:
            continue
        url = f"https://www.linkedin.com/in/{public_id}/"
        if public_id in seen:
            continue
        seen[public_id] = LinkedInProfile(
            public_identifier=public_id,
            full_name=None,
            headline=None,
            location=location,
            company=None,
            linkedin_url=url,
        )
        if len(seen) >= max_results:
            break

    results = list(seen.values())

    try:
        for profile in results:
            enriched = await _enrich(profile.linkedin_url) if profile.linkedin_url else None
            if enriched:
                profile.full_name = enriched.get("full_name") or profile.full_name
                profile.headline = enriched.get("headline") or profile.headline
                profile.location = enriched.get("location") or profile.location
                profile.company = enriched.get("company") or profile.company
    except Exception:
        pass

    return results


async def _enrich(url: str) -> dict | None:
    try:
        from scrapling.fetchers import StealthyFetcher
    except ImportError:
        return None
    try:
        page = await StealthyFetcher.async_fetch(url, headless=True, timeout=15000)
    except Exception:
        return None
    if getattr(page, "status", 0) >= 400:
        return None
    title = None
    try:
        title = page.css("title::text").get()
    except Exception:
        return None
    if not title or "linkedin" not in title.lower():
        return None
    parts = [p.strip() for p in re.split(r"[\|\-\u2013\u2014]", title) if p.strip()]
    full_name = parts[0] if parts else None
    headline = parts[1] if len(parts) > 1 else None
    return {"full_name": full_name, "headline": headline, "location": None, "company": None}


def extract_domain(url: str) -> str | None:
    try:
        return urlparse(url).netloc or None
    except Exception:
        return None
