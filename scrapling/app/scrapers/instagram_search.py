from __future__ import annotations

import json
from urllib.parse import quote_plus

import httpx

from ..config import settings
from ..errors import BlockedError, UpstreamError
from ..schemas import IgLead

_IG_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    "X-IG-App-ID": "936619743392459",
    "Accept": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
}


async def search(search_term: str, search_type: str, max_results: int) -> list[IgLead]:
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
    if search_type == "hashtag":
        tag = term.lstrip("#")
        url = f"https://www.instagram.com/explore/tags/{quote_plus(tag)}/"
    else:
        url = f"https://www.instagram.com/web/search/topsearch/?query={quote_plus(term)}"

    cookies = {}
    if settings.ig_session_cookie:
        cookies["sessionid"] = settings.ig_session_cookie

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url, headers=_IG_HEADERS, cookies=cookies)
    except Exception as exc:
        raise UpstreamError(f"instagram search falhou: {exc}") from exc

    if resp.status_code in (429, 403):
        raise BlockedError("instagram rate limit/block")
    if resp.status_code >= 400:
        raise UpstreamError(f"instagram http {resp.status_code}")

    body = resp.text
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
    url = f"https://i.instagram.com/api/v1/users/web_profile_info/?username={quote_plus(username)}"
    cookies = {}
    if settings.ig_session_cookie:
        cookies["sessionid"] = settings.ig_session_cookie

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=_IG_HEADERS, cookies=cookies)
    except Exception:
        return None

    if resp.status_code >= 400:
        return None

    try:
        data = json.loads(resp.text)
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
