import logging
import httpx
from playwright.async_api import async_playwright, Page, BrowserContext

logger = logging.getLogger("crawl-service.playwright")


async def _notify(dashboard_url: str, app_id: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{dashboard_url}/api/events", json={
                "app_id": app_id, "stage": "CRAWL_PW", "message": message, "level": level
            })
    except Exception:
        pass


def _selector_key(element: dict) -> str:
    if element.get("data-testid"):
        return f"data-testid={element['data-testid']}"
    if element.get("aria-label"):
        return f"aria-label={element['aria-label']}"
    if element.get("css"):
        return element["css"]
    if element.get("xpath"):
        return f"xpath={element['xpath']}"
    return element.get("role", "unknown")


async def _authenticate(page: Page, seed_data: dict, app_url: str):
    auth = seed_data.get("auth", {})
    strategy = auth.get("strategy", "none")
    if strategy != "form":
        return
    import os
    login_url = app_url.rstrip("/") + auth.get("loginUrl", "/login")
    await page.goto(login_url, wait_until="networkidle")
    fields = auth.get("fields", {})
    for selector, value in fields.items():
        resolved = value.replace("${APP_USERNAME}", os.environ.get("APP_USERNAME", "admin"))
        resolved = resolved.replace("${APP_PASSWORD}", os.environ.get("APP_PASSWORD", "admin"))
        try:
            await page.fill(selector, resolved)
        except Exception:
            pass
    submit = auth.get("submitSelector", "#submit-btn")
    try:
        await page.click(submit)
        await page.wait_for_load_state("networkidle")
    except Exception as e:
        logger.warning(f"Auth submit failed: {e}")


async def _extract_elements(page: Page) -> list[dict]:
    snapshot = await page.accessibility.snapshot()
    elements = []
    if not snapshot:
        return elements

    def walk(node, depth=0):
        if not node:
            return
        role = node.get("role", "")
        name = node.get("name", "")
        interactable_roles = {"button", "link", "textbox", "checkbox", "radio",
                               "combobox", "listbox", "menuitem", "tab", "searchbox"}
        if role in interactable_roles and name:
            elements.append({
                "role": role,
                "name": name,
                "aria-label": name if role in {"button", "link"} else "",
                "actionType": "click" if role in {"button", "link", "checkbox", "radio", "menuitem", "tab"} else
                              "fill" if role in {"textbox", "searchbox"} else "select",
                "selectorKey": f"aria-label={name}" if name else role
            })
        for child in node.get("children", []):
            walk(child, depth + 1)

    walk(snapshot)
    return elements


async def trace_interactions(
    page_inventory: list[dict],
    app_id: str,
    seed_data: dict,
    dashboard_url: str
) -> list[dict]:
    app_url = seed_data.get("appUrl", "")
    traced = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        await _authenticate(page, seed_data, app_url)
        await _notify(dashboard_url, app_id, "Playwright authentication complete")

        urls_to_visit = [p["url"] for p in page_inventory] if page_inventory else []

        if not urls_to_visit and app_url:
            urls_to_visit = [app_url]

        visited = set()
        for url in urls_to_visit:
            if url in visited:
                continue
            visited.add(url)
            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
                await page.wait_for_function("document.readyState === 'complete'", timeout=10000)
                title = await page.title()
                elements = await _extract_elements(page)

                transitions = []
                for elem in elements:
                    if elem.get("actionType") == "click":
                        try:
                            before_url = page.url
                            # Don't actually click in tracing — record intent
                            transitions.append({
                                "fromUrl": url,
                                "selectorKey": elem["selectorKey"],
                                "actionType": "click",
                                "label": elem["name"]
                            })
                        except Exception:
                            pass

                traced.append({
                    "url": url,
                    "title": title,
                    "elements": elements,
                    "transitions": transitions,
                    "source": "playwright"
                })
                await _notify(dashboard_url, app_id, f"Traced: {title} ({url})")
                logger.info(f"Traced page: {title}")
            except Exception as e:
                logger.warning(f"Failed to trace {url}: {e}")
                await _notify(dashboard_url, app_id, f"Failed to trace {url}: {e}", "WARN")

        await browser.close()

    return traced
