import json
import logging
import os
from urllib.parse import urlparse

from config import SHARED_DIR
import crawl4ai_phase
import playwright_phase
from graph_builder import build_graph

logger = logging.getLogger("crawl-service.engine")


def normalise_url(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")


def merge_crawl_output(c4ai_pages: list, pw_pages: list) -> list:
    """
    Merge Crawl4AI and Playwright results.
    Elements priority: Playwright (live DOM eval) > Crawl4AI HTML parse > empty.
    Pages only in Crawl4AI (Playwright skipped them as errors) are included with C4AI elements.
    """
    c4ai_by_url = {normalise_url(p["url"]): p for p in (c4ai_pages or [])}
    pw_by_url   = {normalise_url(p["url"]): p for p in (pw_pages  or [])}
    all_urls    = list(c4ai_by_url.keys())
    # Add PW-only pages (e.g. auth-required pages Crawl4AI didn't hit)
    for u in pw_by_url:
        if u not in c4ai_by_url:
            all_urls.append(u)

    merged = []
    for norm_url in all_urls:
        c4ai = c4ai_by_url.get(norm_url, {})
        pw   = pw_by_url.get(norm_url, {})

        # Prefer Playwright elements (live DOM); fall back to Crawl4AI HTML parse
        elements    = pw.get("elements") or c4ai.get("elements") or []
        transitions = pw.get("transitions", [])
        title       = pw.get("title") or c4ai.get("title", "")

        merged.append({
            "url":         c4ai.get("url") or pw.get("url", norm_url),
            "title":       title,
            "description": c4ai.get("description", ""),
            "elements":    elements,
            "transitions": transitions,
            "c4ai_links":  c4ai.get("links", []),
            "sources":     (["crawl4ai"] if c4ai else []) + (["playwright"] if pw else []),
        })
    return merged


async def run_crawl(
    app_url: str,
    app_id: str,
    run_id: str,  # reserved for future run tracking
    seed_data: dict,
    dashboard_url: str,
) -> dict:
    logger.info("Phase 1 starting — Crawl4AI page discovery")
    page_inventory = await crawl4ai_phase.discover_pages(
        app_url, app_id, seed_data, dashboard_url
    )
    logger.info(f"Phase 1 complete — {len(page_inventory)} pages discovered")

    logger.info("Phase 2 starting — Playwright interaction tracing")
    traced_pages = await playwright_phase.trace_interactions(
        page_inventory, app_id, seed_data, dashboard_url
    )
    logger.info(f"Phase 2 complete — {len(traced_pages)} pages traced")

    merged = merge_crawl_output(page_inventory, traced_pages)
    output_path = os.path.join(SHARED_DIR, "outputs", app_id, "crawl_raw.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(merged, f, indent=2)

    logger.info(f"Crawl output written to {output_path}")

    graph = await build_graph(output_path, app_id, dashboard_url)

    return {
        "pages_discovered": len(page_inventory),
        "pages_traced":     len(traced_pages),
        "output_path":      output_path,
        "nodes":            graph["meta"]["totalNodes"],
        "edges":            graph["meta"]["totalEdges"],
    }
