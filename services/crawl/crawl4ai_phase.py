try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not installed — env vars must be set manually

import asyncio
import logging
import os
import re

import httpx

logger = logging.getLogger("crawl-service.crawl4ai")


class CrawlAuthError(Exception):
    pass


def resolve_login_url(auth: dict, app_url: str) -> str:
    """
    Resolve the full login URL using priority order:
      1. auth["loginUrl"] if set — explicit config wins
      2. APP_LOGIN_PATH env var — controllable from .env
      3. "/login" — default fallback
    """
    login_path = auth.get("loginUrl", "").strip()
    if not login_path:
        login_path = os.environ.get("APP_LOGIN_PATH", "").strip()
    if not login_path:
        login_path = "/login"
    if login_path.startswith("http"):
        return login_path
    return app_url.rstrip("/") + "/" + login_path.lstrip("/")


def resolve_env(value: str) -> str:
    if value.startswith("${") and value.endswith("}"):
        var_name = value[2:-1]
        resolved = os.environ.get(var_name, "")
        if not resolved:
            logger.warning(f"Environment variable {var_name} is not set — using empty string")
        return resolved
    return value


def _has_real_credentials(auth: dict) -> bool:
    """Return True only if credentials are present and non-empty for the given strategy."""
    from auth_detect import has_auto_credentials
    strategy = auth.get("strategy", "none")
    if strategy == "auto":
        return has_auto_credentials(auth)
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
    loop = asyncio.get_running_loop()
    if type(loop).__name__ == "_WindowsSelectorEventLoop":
        logger.info("Windows SelectorEventLoop detected — running Crawl4AI in a ProactorEventLoop thread")
        return await asyncio.to_thread(
            _run_in_proactor, app_url, app_id, seed_data, dashboard_url
        )
    return await _discover_pages_impl(app_url, app_id, seed_data, dashboard_url)


def _run_in_proactor(
    app_url: str,
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    import sys
    if sys.platform != "win32":
        raise RuntimeError("ProactorEventLoop is only available on Windows")
    loop = asyncio.ProactorEventLoop()  # type: ignore[attr-defined]
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(
            _discover_pages_impl(app_url, app_id, seed_data, dashboard_url)
        )
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()


async def _login_with_playwright(
    app_url: str,
    auth: dict,
    seed_data: dict,
    dashboard_url: str,
    app_id: str,
    headless: bool = True,
) -> tuple[list, str]:
    """
    Authenticate using Playwright directly — full browser control, no Crawl4AI layers.
    Returns: (session_cookies, post_login_url)
    """
    from playwright.async_api import async_playwright

    login_url   = resolve_login_url(auth, app_url)
    strategy    = auth.get("strategy", "form")
    fields      = auth.get("fields", {})
    submit_sel  = auth.get("submitSelector", "#loginBtn")
    success_ind = auth.get("successIndicator", "")
    if success_ind.startswith("${"):
        success_ind = resolve_env(success_ind)

    logger.info(f"Playwright login — navigating to {login_url}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=headless,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        try:
            await page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
            logger.info(f"Login page loaded: {page.url}")

            if strategy == "cookie":
                cookie_cfg = auth.get("cookie", {})
                await context.add_cookies([{
                    "name":   cookie_cfg["name"],
                    "value":  cookie_cfg["value"],
                    "domain": cookie_cfg["domain"],
                    "path":   cookie_cfg.get("path", "/"),
                }])
                await page.goto(app_url, wait_until="domcontentloaded", timeout=30000)
            else:
                await page.wait_for_load_state("networkidle", timeout=15000)

                for selector, env_value in fields.items():
                    value = resolve_env(env_value)
                    try:
                        await page.wait_for_selector(selector, timeout=10000)
                        await page.fill(selector, value)
                        logger.info(f"Filled: {selector}")
                    except Exception as e:
                        logger.warning(f"Could not fill {selector}: {e}")

                await page.wait_for_timeout(500)

                try:
                    await page.wait_for_selector(submit_sel, timeout=10000)
                    await page.click(submit_sel)
                    logger.info(f"Clicked submit: {submit_sel}")
                except Exception as e:
                    logger.warning(f"Submit click failed ({e}) — trying form.submit()")
                    await page.evaluate(
                        "() => { var f = document.querySelector('form'); if(f) f.submit(); }"
                    )

                if success_ind:
                    try:
                        await page.wait_for_selector(success_ind, timeout=20000)
                        logger.info(f"Success indicator found: {success_ind}")
                    except Exception:
                        logger.warning(
                            f"Success indicator '{success_ind}' not found — "
                            "checking if URL changed from login page"
                        )
                else:
                    try:
                        await page.wait_for_url(
                            lambda url: login_url not in url,
                            timeout=20000,
                        )
                        logger.info("URL changed from login page — login likely successful")
                    except Exception:
                        logger.warning("URL did not change — login may have failed")

            post_login_url = page.url
            logger.info(f"Post-login URL: {post_login_url}")

            if login_url in post_login_url:
                raise CrawlAuthError(
                    f"Login silently failed — still on login page. "
                    f"Check APP_USERNAME and APP_PASSWORD. URL: {post_login_url}"
                )

            cookies = await context.cookies()
            logger.info(f"Captured {len(cookies)} session cookies")
            return cookies, post_login_url

        finally:
            await browser.close()


async def _discover_pages_impl(
    app_url: str,
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except ImportError:
        raise ImportError("pip install crawl4ai")

    auth      = seed_data.get("auth", {})
    blocklist = seed_data.get("blocklist", [])
    max_pages  = int(seed_data.get("max_pages", 60))
    max_depth  = int(seed_data.get("max_depth", 2))
    batch_size = int(seed_data.get("batch_size", 8))

    _headless_raw = os.environ.get("CRAWL_HEADLESS", "true").strip().lower()
    _headless = _headless_raw != "false"
    print(f"[CRAWL] CRAWL_HEADLESS env = '{_headless_raw}' → headless={_headless}")

    if not _headless:
        logger.info("HEADED MODE — browser window will open")

    strategy = auth.get("strategy", "none")

    # ── No auth — crawl public site directly ─────────────────────────
    if strategy == "none" or not _has_real_credentials(auth):
        logger.info("No auth — crawling as public site")
        await _notify(dashboard_url, app_id, "Crawling as public site")
        browser_config = BrowserConfig(headless=_headless, verbose=not _headless)
        async with AsyncWebCrawler(config=browser_config) as crawler:
            return await _crawl_pages(
                crawler, app_url, app_id, dashboard_url,
                blocklist, max_pages, max_depth, batch_size,
            )

    # ── All authenticated strategies — Playwright logs in first ──────
    # Playwright gives direct browser control with no Crawl4AI injection layers.
    logger.info(f"Auth strategy: {strategy} — logging in via Playwright first")
    await _notify(dashboard_url, app_id, "Authenticating via Playwright...")

    session_cookies, post_login_url = await _login_with_playwright(
        app_url, auth, seed_data, dashboard_url, app_id, _headless
    )

    if not session_cookies:
        raise CrawlAuthError("Playwright login failed — no session cookies captured")

    logger.info(f"Login successful — {len(session_cookies)} cookies captured")
    logger.info(f"Post-login URL: {post_login_url}")
    await _notify(dashboard_url, app_id,
        f"Login successful — crawling from {post_login_url}", "SUCCESS")

    browser_config = BrowserConfig(
        headless=_headless,
        verbose=not _headless,
        cookies=session_cookies,
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        return await _crawl_pages(
            crawler, post_login_url, app_id, dashboard_url,
            blocklist, max_pages, max_depth, batch_size,
        )


_ERROR_TITLES = {
    "error page", "access denied", "page not found",
    "404", "403", "500", "service unavailable", "forbidden", "",
}

_NOISE_SUBSTRINGS = [
    "screen reader", "alt and 1", "alt and 2", "press combination",
    "make this website accessible", "skip to content", "skip navigation",
]


# ── Unstable class pattern — generated hashes, framework prefixes, etc. ──────
_UNSTABLE_CLASS_RE = re.compile(
    r'[a-z]+-[a-z0-9]{5,}'       # css-1x7skt3, sc-bdVTJa
    r'|[A-Z][a-zA-Z]+[A-Z][a-z]+'  # camelCase with hash suffix
    r'|^\d'                          # starts with digit
    r'|jss\d+'                       # MUI generated
    r'|^(css|sc|styled|jss|hash)-'  # framework prefixes
)

_INTERACTABLE_TAGS = {"a": "click", "button": "click", "input": "fill", "select": "select", "textarea": "fill"}


def _bs4_str(el, *attrs) -> str | None:
    """Get an attribute as a plain string — BS4 can return lists for class etc."""
    for attr in attrs:
        val = el.get(attr)
        if val is None:
            continue
        if isinstance(val, list):
            val = " ".join(val)
        val = val.strip()
        if val:
            return val
    return None


def _capture_all_attributes(el) -> dict:
    """Pass 1 — capture every attribute on the element. Never throws."""
    tag = el.name
    classes = el.get("class") or []
    if isinstance(classes, str):
        classes = classes.split()
    return {
        "tag":               tag,
        "id":                _bs4_str(el, "id"),
        "name":              _bs4_str(el, "name"),
        "type":              (_bs4_str(el, "type") or "").lower() or None,
        "classes":           classes,
        "data_testid":       _bs4_str(el, "data-testid", "data-test-id"),
        "aria_label":        _bs4_str(el, "aria-label"),
        "aria_role":         _bs4_str(el, "role"),
        "aria_labelledby":   _bs4_str(el, "aria-labelledby"),
        "aria_describedby":  _bs4_str(el, "aria-describedby"),
        "aria_placeholder":  _bs4_str(el, "aria-placeholder"),
        "placeholder":       _bs4_str(el, "placeholder"),
        "title":             _bs4_str(el, "title"),
        "alt":               _bs4_str(el, "alt"),
        "value":             _bs4_str(el, "value"),
        "text_content":      (el.get_text(separator=" ", strip=True)[:80] or None)
                              if tag != "select" else None,  # select text = concatenated options — skip
        "href":              _bs4_str(el, "href"),
        "data_attrs":        {k: v for k, v in el.attrs.items()
                              if k.startswith("data-") and k not in ("data-testid", "data-test-id")},
        "disabled":          el.has_attr("disabled"),
        "required":          el.has_attr("required"),
        "readonly":          el.has_attr("readonly"),
        "checked":           el.has_attr("checked"),
        "hidden":            ((_bs4_str(el, "type") or "").lower() == "hidden"
                              or el.get("aria-hidden") == "true"),
    }


def _select_best_selector(attrs: dict) -> str | None:
    """Pass 2 — pick the best stable selector from what was captured."""
    tag = attrs["tag"]

    if attrs["data_testid"]:
        return f"data-testid={attrs['data_testid']}"
    if attrs["aria_label"]:
        return f"aria-label={attrs['aria_label']}"
    if attrs["id"] and not _UNSTABLE_CLASS_RE.search(attrs["id"]):
        return f"#{attrs['id']}"
    if attrs["name"]:
        return f"[name='{attrs['name']}']"
    if tag == "input" and attrs["type"] in (
        "submit", "email", "password", "tel", "date",
        "number", "search", "url", "checkbox", "radio", "file",
    ):
        return f"input[type='{attrs['type']}']"
    for k, v in attrs.get("data_attrs", {}).items():
        if v and v.strip():
            return f"[{k}='{v.strip()}']"
    stable = [c for c in attrs["classes"] if c and len(c) > 2 and not _UNSTABLE_CLASS_RE.search(c)]
    if len(stable) == 1:
        return f".{stable[0]}"
    return None


def _build_fallback_chain(attrs: dict, exclude: str) -> list[str]:
    """All valid stable selectors in priority order, minus the chosen primary."""
    candidates: list[str] = []
    if attrs["data_testid"]:
        candidates.append(f"data-testid={attrs['data_testid']}")
    if attrs["aria_label"]:
        candidates.append(f"aria-label={attrs['aria_label']}")
    if attrs["id"] and not _UNSTABLE_CLASS_RE.search(attrs["id"]):
        candidates.append(f"#{attrs['id']}")
    if attrs["name"]:
        candidates.append(f"[name='{attrs['name']}']")
    if attrs["tag"] == "input" and attrs["type"] in (
        "submit", "email", "password", "tel", "date",
        "number", "search", "url", "checkbox", "radio",
    ):
        candidates.append(f"input[type='{attrs['type']}']")
    for k, v in attrs.get("data_attrs", {}).items():
        if v and v.strip():
            candidates.append(f"[{k}='{v.strip()}']")
    stable = [c for c in attrs["classes"] if c and len(c) > 2 and not _UNSTABLE_CLASS_RE.search(c)]
    if len(stable) == 1:
        candidates.append(f".{stable[0]}")
    return [c for c in candidates if c != exclude]


def _determine_action(attrs: dict) -> str:
    tag, t = attrs["tag"], attrs["type"] or ""
    if tag == "select":   return "select"
    if tag == "textarea": return "fill"
    if tag == "a":        return "click"
    if tag == "button":   return "click"
    if tag == "input":
        return "click" if t in ("submit", "button", "reset", "image", "checkbox", "radio") else "fill"
    return "click"


def _extract_best_label(attrs: dict) -> str:
    return (
        attrs["aria_label"] or attrs["placeholder"] or attrs["aria_placeholder"] or
        attrs["title"] or attrs["text_content"] or attrs["value"] or
        attrs["name"] or attrs["id"] or attrs["data_testid"] or
        f"{attrs['tag']} element"
    )


def _selector_to_primary(selector_key: str) -> dict | None:
    """Convert a selectorKey string back to {type, value} for backward-compat with graph_builder."""
    if not selector_key:
        return None
    if selector_key.startswith("data-testid="):
        return {"type": "data-testid", "value": selector_key[12:]}
    if selector_key.startswith("aria-label="):
        return {"type": "aria-label",  "value": selector_key[11:]}
    if selector_key.startswith("#"):
        return {"type": "id",          "value": selector_key[1:]}
    m = re.match(r"^\[name='([^']+)'\]$", selector_key)
    if m:
        return {"type": "name",        "value": m.group(1)}
    m = re.match(r"^input\[type='([^']+)'\]$", selector_key)
    if m:
        return {"type": "type",        "value": m.group(1)}
    m = re.match(r"^\[([^=]+)='([^']+)'\]$", selector_key)
    if m:
        return {"type": m.group(1),    "value": m.group(2)}
    if selector_key.startswith("."):
        return {"type": "css-class",   "value": selector_key[1:]}
    return None


def _is_noise_label(text: str) -> bool:
    t = text.lower()
    return len(text) > 80 or any(p in t for p in _NOISE_SUBSTRINGS)


def extract_interactable_elements(html: str) -> list[dict]:
    """
    Two-pass element extraction.
      Pass 1 — _capture_all_attributes(): get every attribute on the element
      Pass 2 — _select_best_selector():   pick the best stable locator

    Output fields:
      selectorKey        — chosen stable locator (primary)
      selectorFallbacks  — ordered alternatives for self-healing
      allAttributes      — full raw capture for LLM context / registry
      name / primary / properties — backward-compat aliases for graph_builder + pom_generator
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "lxml")
    elements: list[dict] = []
    seen_keys: set[str] = set()

    for tag_name in _INTERACTABLE_TAGS:
        limit = 30 if tag_name == "a" else 20
        for el in soup.find_all(tag_name, limit=limit):

            # Pass 1
            attrs = _capture_all_attributes(el)

            # Skip hidden / disabled / non-interactable early
            if attrs["hidden"] or attrs["disabled"]:
                continue
            if attrs["type"] == "hidden":
                continue
            if tag_name == "a" and not attrs["href"]:
                continue
            if tag_name == "a" and attrs["href"] in ("#",):
                continue
            if tag_name == "a" and (attrs["href"] or "").startswith("javascript:"):
                continue
            if tag_name == "input" and attrs["type"] in ("image", "reset"):
                continue

            # Pass 2
            selector_key = _select_best_selector(attrs)
            if selector_key is None:
                continue
            if selector_key in seen_keys:
                continue
            seen_keys.add(selector_key)

            label = _extract_best_label(attrs)
            if _is_noise_label(label):
                continue

            fallbacks  = _build_fallback_chain(attrs, exclude=selector_key)
            primary    = _selector_to_primary(selector_key)
            # properties: convert fallbacks to {type, value} for graph_builder fingerprinting
            properties = [p for p in (_selector_to_primary(f) for f in fallbacks) if p]

            elements.append({
                # ── Primary fields (unchanged names — graph_builder + pom_generator rely on these)
                "selectorKey":    selector_key,
                "role":           attrs["aria_role"] or tag_name,
                "name":           label,          # backward-compat alias for label
                "actionType":     _determine_action(attrs),
                "isInteractable": True,
                "frameContext":   None,
                "primary":        primary,        # backward-compat {type, value}
                "properties":     properties,     # backward-compat [{type, value}, ...]

                # ── New rich fields
                "label":          label,
                "tag":            tag_name,
                "allAttributes": {
                    "dataTestId":  attrs["data_testid"],
                    "ariaLabel":   attrs["aria_label"],
                    "id":          attrs["id"],
                    "name":        attrs["name"],
                    "type":        attrs["type"],
                    "placeholder": attrs["placeholder"],
                    "title":       attrs["title"],
                    "alt":         attrs["alt"],
                    "value":       attrs["value"],
                    "textContent": attrs["text_content"],
                    "href":        attrs["href"],
                    "classes":     attrs["classes"],
                    "dataAttrs":   attrs["data_attrs"],
                    "required":    attrs["required"],
                    "readonly":    attrs["readonly"],
                },
                "selectorFallbacks": fallbacks,
            })

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
                # Use raw html — cleaned_html strips form inputs (email, password fields disappear)
                elements = extract_interactable_elements(result.html or result.cleaned_html or "")
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

    await _notify(
        dashboard_url, app_id,
        f"Page discovery complete — {len(pages_discovered)} pages crawled",
        "SUCCESS",
    )
    logger.info(f"Crawl4AI phase complete — {len(pages_discovered)} pages")
    return pages_discovered
