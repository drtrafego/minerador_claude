from __future__ import annotations

import asyncio
import re
from urllib.parse import quote_plus

from ..errors import BlockedError, UpstreamError
from ..schemas import PlaceLead

PHONE_RE = re.compile(r"(\+?\d[\d\s().-]{7,}\d)")
URL_RE = re.compile(r"https?://[^\s\"'<>]+")


async def _scroll_feed(page) -> None:
    try:
        for _ in range(10):
            await page.evaluate(
                "() => { const f = document.querySelector('div[role=feed]'); if (f) f.scrollBy(0, f.clientHeight); }"
            )
            await asyncio.sleep(1.2)
    except Exception:
        pass


async def search(query: str, location: str | None, max_results: int) -> list[PlaceLead]:
    full_query = f"{query} em {location}" if location else query
    url = f"https://www.google.com/maps/search/{quote_plus(full_query)}"

    try:
        from scrapling.fetchers import AsyncDynamicSession
    except ImportError as exc:
        raise UpstreamError("scrapling AsyncDynamicSession indisponivel", code="deps") from exc

    try:
        async with AsyncDynamicSession(headless=True) as session:
            page = await session.fetch(
                url,
                network_idle=True,
                timeout=60000,
                wait_selector="div[role='feed']",
                page_action=_scroll_feed,
            )
    except Exception as exc:
        raise UpstreamError(f"falha ao abrir google maps: {exc}") from exc

    status = getattr(page, "status", None)
    if status and status >= 400:
        if status in (429, 503):
            raise BlockedError("google maps rate limit")
        raise UpstreamError(f"google maps http {status}")

    leads = _parse_cards(page, max_results)
    return leads[:max_results]


def _parse_cards(page, max_results: int) -> list[PlaceLead]:
    leads: list[PlaceLead] = []
    try:
        cards = page.css("div[role='feed'] > div > div[jsaction]")
    except Exception:
        return leads

    seen: set[str] = set()
    for card in cards:
        try:
            name = card.css("div.fontHeadlineSmall::text, div[role='heading']::text").get()
            if not name:
                continue
            name = name.strip()
            info = " ".join(card.css("div.fontBodyMedium *::text").getall()) or ""
            href = card.css("a[href*='/maps/place/']::attr(href)").get() or ""
            place_id_match = re.search(r"!19s([^!]+)", href) or re.search(r"!1s([^!]+)", href)
            place_id = place_id_match.group(1) if place_id_match else href.split("?")[0]
            if not place_id or place_id in seen:
                continue
            seen.add(place_id)

            phone_match = PHONE_RE.search(info)
            website_match = URL_RE.search(info)
            rating_match = re.search(r"(\d+[.,]\d+)\s*\(", info) or re.search(r"(\d+[.,]\d+)", info)
            ratings_total_match = re.search(r"\((\d[\d\.]*)\)", info)

            rating = None
            if rating_match:
                try:
                    rating = float(rating_match.group(1).replace(",", "."))
                except Exception:
                    rating = None
            user_ratings_total = None
            if ratings_total_match:
                try:
                    user_ratings_total = int(ratings_total_match.group(1).replace(".", "").replace(",", ""))
                except Exception:
                    user_ratings_total = None

            leads.append(
                PlaceLead(
                    place_id=place_id,
                    name=name,
                    phone=phone_match.group(1).strip() if phone_match else None,
                    website=website_match.group(0) if website_match else None,
                    address=None,
                    city=None,
                    state=None,
                    country=None,
                    rating=rating,
                    user_ratings_total=user_ratings_total,
                    types=[],
                    location=None,
                    raw={"href": href, "info": info[:400]},
                )
            )
            if len(leads) >= max_results:
                break
        except Exception:
            continue
    return leads
