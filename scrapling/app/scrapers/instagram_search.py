from __future__ import annotations

import asyncio
import json
from urllib.parse import quote_plus

from ..config import settings
from ..errors import BlockedError, UpstreamError
from ..schemas import IgLead


async def search(search_term: str, search_type: str, max_results: int) -> list[IgLead]:
    try:
        from scrapling.fetchers import StealthyFetcher
    except ImportError as exc:
        raise UpstreamError("scrapling StealthyFetcher indisponivel", code="deps") from exc

    usernames = await _discover_usernames(search_term, search_type, max_results)
    if not usernames:
        return []

    leads: list[IgLead] = []
    for username in usernames[:max_results]:
        profile = await _fetch_profile(username)
        if profile:
            leads.append(profile)
    return leads


async def _discover_usernames(term: str, search_type: str, max_results: int) -> list[str]:
    from scrapling.fetchers import StealthyFetcher

    if search_type == "hashtag":
        tag = term.lstrip("#")
        url = f"https://www.instagram.com/explore/tags/{quote_plus(tag)}/"
    else:
        url = f"https://www.instagram.com/web/search/topsearch/?query={quote_plus(term)}"

    headers = {"User-Agent": "Mozilla/5.0", "X-IG-App-ID": "936619743392459", "Accept": "application/json"}
    cookies = {"sessionid": settings.ig_session_cookie} if settings.ig_session_cookie else None

    try:
        page = await StealthyFetcher.async_fetch(url, headers=headers, cookies=cookies, headless=True, timeout=30000)
    except Exception as exc:
        raise UpstreamError(f"instagram search falhou: {exc}") from exc

    status = getattr(page, "status", None)
    if status in (429, 403):
        raise BlockedError("instagram rate limit/block")
    if status and status >= 400:
        raise UpstreamError(f"instagram http {status}")

    body = getattr(page, "body", None) or str(page)
    usernames: list[str] = []
    try:
        data = json.loads(body)
        if search_type == "user" and "users" in data:
            for item in data["users"][:max_results]:
                user = item.get("user") or item
                username = user.get("username")
                if username:
                    usernames.append(username)
        elif "hashtag" in data:
            edges = (data.get("hashtag", {}).get("edge_hashtag_to_top_posts", {}).get("edges") or [])
            for edge in edges[:max_results]:
                owner = edge.get("node", {}).get("owner", {})
                username = owner.get("username")
                if username:
                    usernames.append(username)
    except json.JSONDecodeError:
        pass
    return list(dict.fromkeys(usernames))


async def _fetch_profile(username: str) -> IgLead | None:
    from scrapling.fetchers import StealthyFetcher

    url = f"https://i.instagram.com/api/v1/users/web_profile_info/?username={quote_plus(username)}"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "X-IG-App-ID": "936619743392459",
        "Accept": "application/json",
    }
    cookies = {"sessionid": settings.ig_session_cookie} if settings.ig_session_cookie else None

    try:
        page = await StealthyFetcher.async_fetch(url, headers=headers, cookies=cookies, headless=True, timeout=20000)
    except Exception:
        return None

    status = getattr(page, "status", None)
    if not status or status >= 400:
        return None

    try:
        data = json.loads(getattr(page, "body", None) or str(page))
    except json.JSONDecodeError:
        return None

    user = data.get("data", {}).get("user") or {}
    if not user:
        return None

    business = user.get("is_business_account")
    return IgLead(
        username=user.get("username") or username,
        full_name=user.get("full_name"),
        bio=user.get("biography"),
        followers=(user.get("edge_followed_by") or {}).get("count"),
        following=(user.get("edge_follow") or {}).get("count"),
        posts_count=(user.get("edge_owner_to_timeline_media") or {}).get("count"),
        category=user.get("business_category_name") or user.get("category_name"),
        external_url=user.get("external_url"),
        is_business_account=bool(business) if business is not None else None,
        profile_pic_url=user.get("profile_pic_url_hd") or user.get("profile_pic_url"),
        raw=user,
    )
