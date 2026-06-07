import logging

import httpx
from playwright.async_api import async_playwright, Page, BrowserContext

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

    if strategy == "form":
        login_url = auth.get("loginUrl", "/login")
        if not login_url.startswith("http"):
            login_url = app_url.rstrip("/") + login_url
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

        function bestSelector(el) {
            if (el.id) return { sel: '#' + CSS.escape(el.id), label: el.id };
            const dt = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
            if (dt) return { sel: '[data-testid="' + dt + '"]', label: dt };
            const nm = el.getAttribute('name');
            if (nm) return { sel: '[name="' + nm + '"]', label: nm };
            const ph = el.getAttribute('placeholder');
            if (ph) return { sel: '[placeholder="' + ph + '"]', label: ph };
            return null;
        }

        function bestLabel(el) {
            // aria-label first (if short and specific)
            const al = el.getAttribute('aria-label') || '';
            if (al && al.length < 60) return al;
            // For links/buttons use visible text
            const txt = (el.innerText || el.textContent || '').trim().slice(0, 60);
            if (txt) return txt;
            // value for submit buttons
            const val = el.getAttribute('value') || '';
            if (val) return val;
            return el.getAttribute('type') || el.tagName.toLowerCase();
        }

        function push(el, actionType, role) {
            const sel = bestSelector(el);
            const label = bestLabel(el);
            if (!label) return;
            const key = sel ? sel.sel : ('text=' + label);
            if (seen.has(key)) return;
            seen.add(key);
            results.push({
                role: role,
                name: label,
                selectorKey: sel ? sel.sel : ('xpath=//button[normalize-space()="' + label + '"]'),
                actionType: actionType,
                isInteractable: true,
                frameContext: null,
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


_ERROR_TITLES = {
    "error page", "access denied", "page not found", "404", "403", "500",
    "service unavailable", "forbidden", "unauthorized", "page", "",
}


async def _trace_page(page: Page, url: str, dashboard_url: str, app_id: str) -> dict | None:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # Use load state instead of wait_for_function — avoids CSP eval restrictions
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass  # networkidle timeout is fine; domcontentloaded already succeeded

        title = await page.title()

        # Skip server-side error pages — no point generating POM classes for them
        if title.strip().lower() in _ERROR_TITLES:
            logger.info(f"Skipping error page: {title} ({url})")
            await _notify(dashboard_url, app_id, f"Skipped error page: {url}")
            return None

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


async def trace_interactions(
    page_inventory: list[dict],
    app_id: str,
    seed_data: dict,
    dashboard_url: str,
) -> list[dict]:
    app_url = seed_data.get("appUrl", "")
    blocklist = seed_data.get("blocklist", [])
    traced: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        await _authenticate(page, context, seed_data, app_url)
        await _notify(dashboard_url, app_id, "Playwright authentication complete")

        if not page_inventory:
            # Fallback — Crawl4AI returned nothing; do navigation-by-clicking discovery
            await _notify(
                dashboard_url, app_id,
                "Crawl4AI returned 0 pages — falling back to Playwright-only discovery", "WARN"
            )
            logger.warning("Crawl4AI returned 0 pages — falling back to Playwright-only discovery")
            urls_to_visit = [app_url] if app_url else []
            visited: set[str] = set()
            queue = list(urls_to_visit)
            while queue:
                url = queue.pop(0)
                if url in visited or any(b in url for b in blocklist):
                    continue
                visited.add(url)
                result = await _trace_page(page, url, dashboard_url, app_id)
                if result:
                    traced.append(result)
                    # Discover new URLs via transitions
                    for t in result.get("transitions", []):
                        href = t.get("toUrl", "")
                        if href and href not in visited and not any(b in href for b in blocklist):
                            queue.append(href)
        else:
            visited = set()
            for entry in page_inventory:
                url = entry["url"]
                if url in visited or any(b in url for b in blocklist):
                    continue
                visited.add(url)
                result = await _trace_page(page, url, dashboard_url, app_id)
                if result:
                    traced.append(result)

        await browser.close()

    return traced
