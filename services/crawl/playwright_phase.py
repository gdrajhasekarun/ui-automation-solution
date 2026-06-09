import asyncio
import logging
import os
import re
import sys

import httpx
from playwright.async_api import async_playwright, Page, BrowserContext
from crawl4ai_phase import resolve_login_url

logger = logging.getLogger("crawl-service.playwright")


def resolve_env(value: str) -> str:
    import os
    if value.startswith("${") and value.endswith("}"):
        var_name = value[2:-1]
        resolved = os.environ.get(var_name, "")
        if not resolved:
            logger.warning(f"Environment variable {var_name} is not set — using empty string")
        return resolved
    return value


async def _notify(dashboard_url: str, app_id: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{dashboard_url}/api/events", json={
                "app_id": app_id, "stage": "CRAWL_PW", "message": message, "level": level
            })
    except Exception:
        pass


async def _authenticate(page: Page, context: BrowserContext, seed_data: dict, app_url: str):
    auth = seed_data.get("auth", {})
    strategy = auth.get("strategy", "none")

    if strategy == "cookie":
        cookie_cfg = auth.get("cookie", {})
        await context.add_cookies([{
            "name":   cookie_cfg["name"],
            "value":  cookie_cfg["value"],
            "domain": cookie_cfg["domain"],
            "path":   cookie_cfg.get("path", "/"),
        }])
        return

    if strategy == "auto":
        from auth_detect import DETECTOR_FN_JS, auto_credentials
        identity, secret = auto_credentials(auth)
        login_url = resolve_login_url(auth, app_url)
        logger.info(f"Login URL: {login_url}")
        await page.goto(login_url, wait_until="domcontentloaded")
        success_indicator = auth.get("successIndicator")

        for _round in range(2):  # up to 2 rounds for multi-step login
            try:
                detected = await page.evaluate(DETECTOR_FN_JS)
            except Exception as e:
                logger.warning(f"Auto-detect failed (round {_round+1}): {e}")
                break
            identity_sel = detected.get("identitySel")
            secret_sel   = detected.get("secretSel")
            submit_sel   = detected.get("submitSel")
            if identity_sel:
                try:
                    await page.fill(identity_sel, identity)
                except Exception as e:
                    logger.warning(f"Could not fill identity field {identity_sel}: {e}")
            if secret_sel:
                try:
                    await page.fill(secret_sel, secret)
                except Exception as e:
                    logger.warning(f"Could not fill secret field {secret_sel}: {e}")
            if submit_sel:
                try:
                    await page.click(submit_sel)
                except Exception as e:
                    logger.warning(f"Could not click submit {submit_sel}: {e}")
                    if secret_sel:
                        await page.press(secret_sel, "Enter")
            elif secret_sel:
                await page.press(secret_sel, "Enter")
            await page.wait_for_load_state("networkidle", timeout=15000)
            if success_indicator:
                try:
                    await page.wait_for_selector(success_indicator, timeout=8000)
                    logger.info(f"Auto-login success (round {_round+1})")
                    return
                except Exception:
                    pass
            else:
                has_password = await page.query_selector("input[type=password]") is not None
                if not has_password and login_url not in page.url:
                    logger.info(f"Auto-login success (round {_round+1})")
                    return
        logger.warning("Auto-login: could not confirm success after 2 rounds — continuing anyway")
        return

    if strategy == "form":
        login_url = resolve_login_url(auth, app_url)
        logger.info(f"Login URL: {login_url}")
        await page.goto(login_url, wait_until="domcontentloaded")
        for selector, env_key in auth.get("fields", {}).items():
            value = resolve_env(env_key)
            try:
                await page.fill(selector, value)
            except Exception as e:
                logger.warning(f"Could not fill {selector}: {e}")
        submit = auth.get("submitSelector", "#submit-btn")
        try:
            await page.click(submit)
            success = auth.get("successIndicator")
            if success:
                await page.wait_for_selector(success, timeout=15000)
            else:
                await page.wait_for_load_state("networkidle")
        except Exception as e:
            logger.warning(f"Auth submit/wait failed: {e}")


_NOISE_PATTERNS = [
    "screen reader", "alt and 1", "alt and 2", "press combination",
    "make this website accessible", "skip to content", "skip navigation",
]

_GENERIC_NAMES = {"home", "menu", "navigation", "header", "footer", "search", "close", "open", ""}


def _is_noise(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in _NOISE_PATTERNS) or len(text) > 80


async def _extract_elements(page: Page) -> list[dict]:
    """
    Extract interactable elements via JavaScript so we can read all useful attributes
    in a single round-trip and build proper CSS/XPath selectors for Selenium.
    """
    js = """
    () => {
        const MAX_PER_TYPE = 20;
        const results = [];
        const seen = new Set();

        // Collect ALL available locator properties in priority order
        function allProperties(el) {
            const props = [];
            if (el.id)
                props.push({ type: 'id', value: el.id });
            const dt = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
            if (dt)
                props.push({ type: 'data-testid', value: dt });
            const nm = el.getAttribute('name');
            if (nm)
                props.push({ type: 'name', value: nm });
            const ph = el.getAttribute('placeholder');
            if (ph)
                props.push({ type: 'placeholder', value: ph });
            const al = el.getAttribute('aria-label');
            if (al && al.length < 80)
                props.push({ type: 'aria-label', value: al.trim() });
            const cls = el.getAttribute('class');
            if (cls) {
                const stable = cls.trim().split(/\s+/).filter(c => !/^(active|disabled|hover|focus|selected|open|closed|visible|hidden)$/i.test(c));
                if (stable.length)
                    props.push({ type: 'css-class', value: stable.join(' ') });
            }
            return props;
        }

        function selectorFromProp(prop) {
            if (prop.type === 'id')           return '#' + CSS.escape(prop.value);
            if (prop.type === 'data-testid')  return '[data-testid="' + prop.value + '"]';
            if (prop.type === 'name')         return '[name="' + prop.value + '"]';
            if (prop.type === 'placeholder')  return '[placeholder="' + prop.value + '"]';
            return null;
        }

        function bestLabel(el) {
            const al = el.getAttribute('aria-label') || '';
            if (al && al.length < 60) return al;
            // For <select>, innerText is concatenated option values — use name/id instead
            if (el.tagName === 'SELECT') {
                return el.getAttribute('name') || el.getAttribute('id') || '';
            }
            const txt = (el.innerText || el.textContent || '').trim().slice(0, 60);
            if (txt) return txt;
            const val = el.getAttribute('value') || '';
            if (val) return val;
            return el.getAttribute('type') || el.tagName.toLowerCase();
        }

        function push(el, actionType, role) {
            const props = allProperties(el);
            const primary = props[0] || null;
            const label = bestLabel(el);
            if (!label) return;
            const dedupeKey = primary ? (primary.type + ':' + primary.value) : ('text:' + label);
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            const selectorKey = primary
                ? (selectorFromProp(primary) || ('xpath=//' + el.tagName.toLowerCase() + '[normalize-space()="' + label + '"]'))
                : ('xpath=//button[normalize-space()="' + label + '"]');
            results.push({
                role: role,
                name: label,
                selectorKey: selectorKey,
                actionType: actionType,
                isInteractable: true,
                frameContext: null,
                primary: primary,
                properties: props.slice(1),
            });
        }

        // Inputs
        document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').forEach((el, i) => {
            if (i >= MAX_PER_TYPE) return;
            const t = el.getAttribute('type') || 'text';
            push(el, t === 'checkbox' || t === 'radio' ? 'click' : 'fill', 'input[type=' + t + ']');
        });

        // Selects
        document.querySelectorAll('select').forEach((el, i) => {
            if (i >= MAX_PER_TYPE) return;
            push(el, 'select', 'select');
        });

        // Buttons (deduplicated by text)
        document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach((el, i) => {
            if (i >= MAX_PER_TYPE) return;
            push(el, 'click', 'button');
        });

        // Meaningful links (with href, not JS-void, not external)
        document.querySelectorAll('a[href]').forEach((el, i) => {
            if (i >= MAX_PER_TYPE) return;
            const href = el.getAttribute('href') || '';
            if (href.startsWith('javascript:') || href === '#') return;
            push(el, 'click', 'a[href]');
        });

        return results;
    }
    """
    try:
        raw: list[dict] = await page.evaluate(js)
    except Exception as e:
        logger.warning(f"Element extraction JS failed: {e}")
        return []

    elements = []
    seen_keys: set[str] = set()
    for el in raw:
        name = (el.get("name") or "").strip()
        sk = el.get("selectorKey", "")
        if not name or not sk:
            continue
        if _is_noise(name):
            continue
        if sk in seen_keys:
            continue
        seen_keys.add(sk)
        elements.append(el)

    return elements


# Only real HTTP error responses — generic/empty titles mean JS hasn't rendered yet, not an error
_ERROR_TITLES = {
    "error page", "access denied", "page not found",
    "404", "403", "500", "service unavailable", "forbidden", "unauthorized",
}

_TITLE_FROM_URL_RE = re.compile(r'[^a-zA-Z0-9]+')


def _derive_title(url: str) -> str:
    """Fallback title from the last meaningful URL path segment."""
    from urllib.parse import urlparse
    parts = [p for p in urlparse(url).path.strip("/").split("/") if p]
    if parts:
        last = parts[-1].rsplit(".", 1)[0]  # strip .html
        return " ".join(w.capitalize() for w in _TITLE_FROM_URL_RE.split(last) if w)
    return url


async def _trace_page(page: Page, url: str, dashboard_url: str, app_id: str) -> dict | None:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # Use load state instead of wait_for_function — avoids CSP eval restrictions
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass  # networkidle timeout is fine; domcontentloaded already succeeded

        title = (await page.title()).strip()

        # Skip only real HTTP error pages — empty/generic titles mean JS hasn't rendered,
        # so fall back to a URL-derived title and continue tracing
        if title.lower() in _ERROR_TITLES:
            logger.info(f"Skipping error page: {title} ({url})")
            await _notify(dashboard_url, app_id, f"Skipped error page: {url}")
            return None

        if not title or title.lower() in ("page", "untitled", "loading..."):
            title = _derive_title(url)

        elements = await _extract_elements(page)
        transitions = [
            {
                "fromUrl":     url,
                "selectorKey": el["selectorKey"],
                "actionType":  "click",
                "label":       el["name"],
            }
            for el in elements
            if el.get("actionType") == "click"
        ]
        await _notify(dashboard_url, app_id, f"Traced: {title} ({url})")
        logger.info(f"Traced page: {title} — {len(elements)} elements")
        return {
            "url":         url,
            "title":       title,
            "elements":    elements,
            "transitions": transitions,
            "source":      "playwright",
        }
    except Exception as e:
        logger.warning(f"Failed to trace {url}: {e}")
        await _notify(dashboard_url, app_id, f"Failed to trace {url}: {e}", "WARN")
        return None


_TRACE_CONCURRENCY = 4


async def _launch_browser(pw):
    """
    Launch Chromium with a fallback chain:
      1. PLAYWRIGHT_CHROMIUM_PATH / PLAYWRIGHT_EXECUTABLE_PATH env var (manual install)
      2. PLAYWRIGHT_CHANNEL env var (e.g. "chrome", "msedge")
      3. Bundled Chromium (default)
      4. Fallback to system "chrome" then "msedge" channel
    """
    exe_path = os.environ.get("PLAYWRIGHT_CHROMIUM_PATH") or os.environ.get("PLAYWRIGHT_EXECUTABLE_PATH")
    if exe_path:
        logger.info(f"Launching browser from PLAYWRIGHT_CHROMIUM_PATH: {exe_path}")
        return await pw.chromium.launch(headless=True, executable_path=exe_path)

    channel = os.environ.get("PLAYWRIGHT_CHANNEL")
    if channel:
        logger.info(f"Launching browser via PLAYWRIGHT_CHANNEL: {channel}")
        return await pw.chromium.launch(headless=True, channel=channel)

    try:
        logger.info("Launching bundled Chromium")
        return await pw.chromium.launch(headless=True)
    except Exception as e:
        logger.warning(f"Bundled Chromium failed ({e}) — trying system Chrome")

    for fallback_channel in ("chrome", "msedge"):
        try:
            logger.info(f"Trying channel fallback: {fallback_channel}")
            return await pw.chromium.launch(headless=True, channel=fallback_channel)
        except Exception:
            continue

    raise RuntimeError(
        "No usable browser found. Set PLAYWRIGHT_CHROMIUM_PATH to your browser executable "
        "or PLAYWRIGHT_CHANNEL to 'chrome'/'msedge', or run 'playwright install chromium'."
    )


async def trace_interactions(
    page_inventory: list[dict],
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    loop = asyncio.get_running_loop()
    if type(loop).__name__ == "WindowsSelectorEventLoop":
        logger.info("Windows SelectorEventLoop detected — running Playwright in a ProactorEventLoop thread")
        return await asyncio.to_thread(_run_in_proactor, page_inventory, app_id, seed_data, dashboard_url)
    return await _trace_interactions_impl(page_inventory, app_id, seed_data, dashboard_url)


def _run_in_proactor(
    page_inventory: list[dict],
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    if sys.platform != "win32":
        raise RuntimeError("ProactorEventLoop is only available on Windows")
    loop = asyncio.ProactorEventLoop()  # type: ignore[attr-defined]
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(
            _trace_interactions_impl(page_inventory, app_id, seed_data, dashboard_url)
        )
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()


async def _trace_interactions_impl(
    page_inventory: list[dict],
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    app_url = seed_data.get("appUrl", "")
    blocklist = seed_data.get("blocklist", [])

    async with async_playwright() as pw:
        browser = await _launch_browser(pw)
        # Single shared context so auth cookies/session are available to all parallel pages
        context = await browser.new_context()
        auth_page = await context.new_page()
        await _authenticate(auth_page, context, seed_data, app_url)
        await auth_page.close()
        await _notify(dashboard_url, app_id, "Playwright authentication complete")

        if not page_inventory:
            await _notify(
                dashboard_url, app_id,
                "Crawl4AI returned 0 pages — falling back to Playwright-only discovery", "WARN"
            )
            logger.warning("Crawl4AI returned 0 pages — falling back to Playwright-only discovery")
            urls_to_trace = [app_url] if app_url else []
        else:
            seen_urls: set[str] = set()
            urls_to_trace = []
            for entry in page_inventory:
                url = entry["url"]
                if url not in seen_urls and not any(b in url for b in blocklist):
                    seen_urls.add(url)
                    urls_to_trace.append(url)

        sem = asyncio.Semaphore(_TRACE_CONCURRENCY)

        async def trace_with_sem(url: str) -> dict | None:
            async with sem:
                page = await context.new_page()
                try:
                    return await _trace_page(page, url, dashboard_url, app_id)
                finally:
                    await page.close()

        results = await asyncio.gather(*[trace_with_sem(u) for u in urls_to_trace])
        traced = [r for r in results if r]

        await browser.close()

    await _notify(dashboard_url, app_id,
        f"Interaction tracing complete — {len(traced)} pages traced", "SUCCESS")
    return traced
