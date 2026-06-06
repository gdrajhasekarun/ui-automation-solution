import os
import logging
import httpx
from typing import Optional

logger = logging.getLogger("crawl-service.firecrawl")


async def _notify(dashboard_url: str, app_id: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{dashboard_url}/api/events", json={
                "app_id": app_id, "stage": "CRAWL_FC", "message": message, "level": level
            })
    except Exception:
        pass


async def discover_pages(
    app_url: str,
    app_id: str,
    seed_data: dict,
    dashboard_url: str
) -> list[dict]:
    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        logger.warning("FIRECRAWL_API_KEY not set — skipping Firecrawl phase, Playwright will handle discovery")
        return []

    try:
        from firecrawl import FirecrawlApp
        fc = FirecrawlApp(api_key=api_key)
        blocklist = seed_data.get("blocklist", [])

        logger.info(f"Firecrawl starting crawl of {app_url}")
        await _notify(dashboard_url, app_id, f"Firecrawl starting crawl of {app_url}")

        result = fc.crawl_url(
            app_url,
            params={
                "excludes": blocklist,
                "maxDepth": 10,
                "limit": 500
            }
        )

        pages = []
        raw_pages = result.get("data", []) if isinstance(result, dict) else result

        for i, page in enumerate(raw_pages):
            url = page.get("url") or page.get("metadata", {}).get("sourceURL", "")
            if not url:
                continue
            if any(b in url for b in blocklist):
                continue
            pages.append({
                "url": url,
                "title": page.get("metadata", {}).get("title", ""),
                "description": page.get("metadata", {}).get("description", ""),
                "links": page.get("links", []),
                "source": "firecrawl"
            })
            if (i + 1) % 10 == 0:
                await _notify(dashboard_url, app_id, f"Firecrawl discovered {i + 1} pages")

        await _notify(dashboard_url, app_id, f"Firecrawl complete — {len(pages)} pages discovered")
        logger.info(f"Firecrawl discovered {len(pages)} pages")
        return pages

    except Exception as e:
        logger.error(f"Firecrawl phase failed: {e}")
        await _notify(dashboard_url, app_id, f"Firecrawl phase failed: {e}", "ERROR")
        return []
