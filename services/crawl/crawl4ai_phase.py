import logging
import os

import httpx

logger = logging.getLogger("crawl-service.crawl4ai")


class CrawlAuthError(Exception):
    pass


def resolve_env(value: str) -> str:
    if value.startswith("${") and value.endswith("}"):
        var_name = value[2:-1]
        resolved = os.environ.get(var_name, "")
        if not resolved:
            logger.warning(f"Environment variable {var_name} is not set — using empty string")
        return resolved
    return value


def _has_real_credentials(auth: dict) -> bool:
    """Return True only if all field values resolve to non-empty strings."""
    for value in auth.get("fields", {}).values():
        if not resolve_env(value):
            return False
    return bool(auth.get("fields"))


async def _notify(dashboard_url: str, app_id: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{dashboard_url}/api/events", json={
                "app_id": app_id, "stage": "CRAWL_C4AI", "message": message, "level": level
            })
    except Exception:
        pass


async def discover_pages(
    app_url: str,
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except ImportError:
        raise ImportError("pip install crawl4ai")

    auth = seed_data.get("auth", {})
    strategy = auth.get("strategy", "none")
    blocklist = seed_data.get("blocklist", [])

    browser_config = BrowserConfig(headless=True, verbose=False)

    max_pages  = int(seed_data.get("max_pages", 60))
    max_depth  = int(seed_data.get("max_depth", 2))
    batch_size = int(seed_data.get("batch_size", 8))

    # ── No auth — public site, crawl directly
    if strategy == "none" or not _has_real_credentials(auth):
        logger.info("No auth credentials — crawling without login")
        await _notify(dashboard_url, app_id, f"Crawling as public site (max {max_pages} pages, depth ≤{max_depth})")
        async with AsyncWebCrawler(config=browser_config) as crawler:
            return await _crawl_pages(crawler, app_url, app_id, dashboard_url, blocklist, max_pages, max_depth, batch_size)

    # ── Cookie auth
    if strategy == "cookie":
        cookie_cfg = auth.get("cookie", {})
        browser_config = BrowserConfig(
            headless=True,
            verbose=False,
            cookies=[{
                "name":   cookie_cfg["name"],
                "value":  cookie_cfg["value"],
                "domain": cookie_cfg["domain"],
                "path":   cookie_cfg.get("path", "/"),
            }],
        )
        async with AsyncWebCrawler(config=browser_config) as crawler:
            return await _crawl_pages(crawler, app_url, app_id, dashboard_url, blocklist, max_pages, max_depth, batch_size)

    # ── Form auth
    fields = auth.get("fields", {})
    field_keys = list(fields.keys())
    field_vals = list(fields.values())

    if len(field_keys) >= 2:
        login_js = (
            f"document.querySelector('{field_keys[0]}').value = '{resolve_env(field_vals[0])}';"
            f"document.querySelector('{field_keys[1]}').value = '{resolve_env(field_vals[1])}';"
            f"document.querySelector('{auth['submitSelector']}').click();"
        )
    else:
        login_js = f"document.querySelector('{auth.get('submitSelector', '#submit-btn')}').click();"

    login_url = auth.get("loginUrl", "/login")
    if not login_url.startswith("http"):
        login_url = app_url.rstrip("/") + login_url

    async with AsyncWebCrawler(config=browser_config) as crawler:
        from crawl4ai import CrawlerRunConfig, CacheMode
        auth_result = await crawler.arun(
            url=login_url,
            config=CrawlerRunConfig(
                js_code=login_js,
                wait_for=f"css:{auth.get('successIndicator', '#dashboard')}",
                cache_mode=CacheMode.BYPASS,
            ),
        )
        if not auth_result.success:
            raise CrawlAuthError(f"Login failed at {login_url}")

        logger.info("Crawl4AI authentication successful")
        await _notify(dashboard_url, app_id, "Authentication successful")
        return await _crawl_pages(crawler, app_url, app_id, dashboard_url, blocklist, max_pages, max_depth, batch_size)


_ERROR_TITLES = {
    "error page", "access denied", "page not found",
    "404", "403", "500", "service unavailable", "forbidden", "",
}

_NOISE_SUBSTRINGS = [
    "screen reader", "alt and 1", "alt and 2", "press combination",
    "make this website accessible", "skip to content", "skip navigation",
]


def _extract_elements_from_html(html: str) -> list[dict]:
    """Parse interactable elements from Crawl4AI's cleaned HTML using BeautifulSoup."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "lxml")
    elements: list[dict] = []
    seen: set[str] = set()

    def is_noise(text: str) -> bool:
        t = text.lower()
        return len(text) > 80 or any(p in t for p in _NOISE_SUBSTRINGS)

    def _attr(tag, *names, default: str = "") -> str:
        """Get an attribute value as a plain string (BS4 can return lists for multi-valued attrs)."""
        for name in names:
            val = tag.get(name, None)
            if val is None:
                continue
            if isinstance(val, list):
                val = " ".join(val)
            val = val.strip()
            if val:
                return val
        return default

    def best_selector(tag) -> tuple[str, str] | None:
        """Return (css_selector, label) using the most stable attribute."""
        eid = _attr(tag, "id")
        if eid:
            return f"#{eid}", eid
        dt = _attr(tag, "data-testid", "data-test-id")
        if dt:
            return f'[data-testid="{dt}"]', dt
        nm = _attr(tag, "name")
        if nm:
            return f'[name="{nm}"]', nm
        ph = _attr(tag, "placeholder")
        if ph:
            return f'[placeholder="{ph}"]', ph
        return None

    def best_label(tag) -> str:
        al = _attr(tag, "aria-label")
        if al and len(al) < 60:
            return al
        txt = tag.get_text(separator=" ", strip=True)[:60]
        if txt:
            return txt
        val = _attr(tag, "value")
        if val:
            return val
        return _attr(tag, "type", default=tag.name)

    def push(tag, action: str, role: str):
        sel_label = best_selector(tag)
        label = best_label(tag)
        if not label or is_noise(label):
            return
        sel = sel_label[0] if sel_label else f'xpath=//{tag.name}[normalize-space()="{label}"]'
        if sel in seen:
            return
        seen.add(sel)
        elements.append({
            "role": role,
            "name": label,
            "selectorKey": sel,
            "actionType": action,
            "isInteractable": True,
            "frameContext": None,
        })

    # inputs
    for tag in soup.find_all("input", limit=20):
        t = _attr(tag, "type", default="text").lower()
        if t in ("hidden", "submit", "button", "image", "reset"):
            continue
        push(tag, "click" if t in ("checkbox", "radio") else "fill", f"input[type={t}]")

    # selects
    for tag in soup.find_all("select", limit=10):
        push(tag, "select", "select")

    # buttons
    for tag in soup.find_all(["button", "input"], limit=20):
        if tag.name == "input" and _attr(tag, "type").lower() not in ("submit", "button"):
            continue
        push(tag, "click", "button")

    # links
    for tag in soup.find_all("a", href=True, limit=30):
        href = _attr(tag, "href")
        if not href or href.startswith("javascript:") or href == "#":
            continue
        push(tag, "click", "a[href]")

    return elements


async def _crawl_pages(
    crawler,
    app_url: str,
    app_id: str,
    dashboard_url: str,
    blocklist: list,
    max_pages: int = 60,
    max_depth: int = 2,
    batch_size: int = 8,
) -> list[dict]:
    from crawl4ai import CrawlerRunConfig, CacheMode

    pages_discovered: list[dict] = []
    visited: set[str] = set()
    # Queue entries are (url, depth)
    queue: list[tuple[str, int]] = [(app_url, 0)]

    def _blocked(url: str) -> bool:
        return any(b in url for b in blocklist)

    while queue and len(pages_discovered) < max_pages:
        # Pull a batch of unvisited URLs at the current frontier
        batch: list[tuple[str, int]] = []
        remaining: list[tuple[str, int]] = []
        for item in queue:
            url, depth = item
            if url in visited or _blocked(url):
                continue
            if len(batch) < batch_size:
                batch.append(item)
                visited.add(url)
            else:
                remaining.append(item)
        queue = remaining

        if not batch:
            break

        depth_map = {url: depth for url, depth in batch}
        urls_to_fetch = list(depth_map.keys())
        try:
            stream = await crawler.arun_many(
                urls_to_fetch,
                config=CrawlerRunConfig(
                    cache_mode=CacheMode.BYPASS,
                    page_timeout=30000,
                    exclude_external_links=True,
                    exclude_social_media_links=True,
                    stream=True,
                ),
            )
            async for result in stream:
                if not result.success:
                    logger.warning(f"Crawl4AI: failed {result.url}: {result.error_message}")
                    continue

                url = result.url
                depth = depth_map.get(url, 0)
                page_title = result.metadata.get("title", "").strip()
                # Don't expand links from error/access-denied pages — they only lead to more broken pages
                is_error = page_title.lower() in {
                    "error page", "access denied", "page not found",
                    "404", "403", "500", "service unavailable", "forbidden",
                }
                internal_links = result.links.get("internal", []) or []
                new_links = [] if is_error else [
                    lnk["href"] for lnk in internal_links
                    if lnk.get("href") and lnk["href"] not in visited and not _blocked(lnk["href"])
                ]
                elements = _extract_elements_from_html(result.cleaned_html or result.html or "")
                pages_discovered.append({
                    "url":         url,
                    "title":       page_title,
                    "description": result.metadata.get("description", ""),
                    "links":       new_links,
                    "elements":    elements,
                    "source":      "crawl4ai",
                })

                if depth < max_depth:
                    for link_url in new_links:
                        if link_url not in visited:
                            queue.append((link_url, depth + 1))

                if len(pages_discovered) >= max_pages:
                    break
        except Exception as e:
            logger.warning(f"Crawl4AI batch failed: {e}")
            continue

        await _notify(
            dashboard_url, app_id,
            f"Crawl4AI: {len(pages_discovered)} pages discovered (depth ≤{max_depth}, cap {max_pages})..."
        )

    logger.info(f"Crawl4AI phase complete — {len(pages_discovered)} pages")
    return pages_discovered
