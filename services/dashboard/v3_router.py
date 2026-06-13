"""
Dashboard V3 API — wired to the app-graph-crawler TypeScript service.

Mirrors the V2 structure exactly: same endpoint shapes, same DB recording,
same SSE streaming. The key difference from V2:
  - Downstream is the app-graph-crawler service (port 8005 by default)
  - Trigger accepts Playwright/Crawlee-specific params (seed_url, allowed_domain,
    llm_enabled, config_path) instead of BFS-specific ones (excel_path, target_flows)
  - Graph endpoint proxies directly from the crawler service rather than shared dir
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from config import GRAPH_CRAWLER_URL
from db import (db_emit_event, db_insert, db_list, db_list_after_rowid,
                db_list_since, db_rowid_before_since)

_SHARED_DIR = os.environ.get("SHARED_DIR", os.path.join(os.path.dirname(__file__), "../../shared"))

logger = logging.getLogger("dashboard.v3")

router = APIRouter(prefix="/api/v3", tags=["v3"])


# ── Request models ─────────────────────────────────────────────────────────────

VALID_TARGET_TOOLS = {"selenium-java", "selenium-csharp", "playwright-js", "playwright-ts"}


class V3CrawlTriggerBody(BaseModel):
    """Mirrors V2CrawlTriggerBody field-for-field; adds V3-specific extras at the end."""
    app_id:         str
    app_url:        str = ""           # seed URL (mirrors V2 app_url)
    excel_path:     str = ""           # path to crawl-data.xlsx — credentials + form fills (mirrors V2)
    framework_dir:  str = ""           # kept for API parity with V2 (not used by crawler)
    target_tool:    str = "selenium-java"  # POM generation target: selenium-java|selenium-csharp|playwright-js|playwright-ts
    max_pages:      int | None = None  # override maxPages in config (mirrors V2)
    max_depth:      int | None = None  # kept for API parity with V2 (not used by crawler)
    headless:       bool = True        # run browser headlessly (mirrors V2)
    # V3-specific extras
    config_path:    str = ""           # path to crawler.config.json override
    allowed_domain: str = ""           # restrict crawl to this hostname
    llm_enabled:    bool = True        # toggle all LLM calls
    target_flows:   list[str] = []     # element-value filter — only follow elements matching these terms


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/crawl/trigger")
async def v3_crawl_trigger(body: V3CrawlTriggerBody):
    """Trigger a Playwright/Crawlee graph crawl via the app-graph-crawler service."""
    run_id = "v3-run-" + uuid.uuid4().hex[:8]
    now    = datetime.now(timezone.utc).isoformat()

    db_insert("crawl_runs", {
        "run_id":       run_id,
        "app_id":       body.app_id,
        "status":       "STARTED",
        "phase":        "init",
        "trigger_type": "INITIAL",
        "started_at":   now,
        "finished_at":  None,
        "node_count":   0,
        "edge_count":   0,
    })
    db_emit_event(body.app_id, "GRAPH_CRAWLER_V3", "Graph crawl triggered via V3 dashboard")

    target_tool = body.target_tool if body.target_tool in VALID_TARGET_TOOLS else "selenium-java"

    payload: dict = {
        "app_id":      body.app_id,
        "seed_url":    body.app_url,       # V2 calls it app_url; crawler calls it seed_url
        "headless":    body.headless,
        "llm_enabled": body.llm_enabled,
        "output_dir":  os.path.join(os.path.abspath(_SHARED_DIR), "outputs", body.app_id),
        "target_tool": target_tool,
    }
    if body.excel_path:
        payload["excel_path"] = body.excel_path
    if body.framework_dir:
        payload["framework_dir"] = body.framework_dir
    if body.config_path:
        payload["config_path"] = body.config_path
    if body.max_pages is not None:
        payload["max_pages"] = body.max_pages
    if body.allowed_domain:
        payload["allowed_domain"] = body.allowed_domain
    if body.target_flows:
        payload["target_flows"] = body.target_flows

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{GRAPH_CRAWLER_URL}/trigger", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "GRAPH_CRAWLER_V3", f"app-graph-crawler unreachable: {e}", "ERROR")
        return JSONResponse(
            status_code=503,
            content={"run_id": run_id, "status": "ERROR", "detail": str(e)},
        )

    crawl_job_id = data.get("job_id", "")
    logger.info(f"V3 crawl triggered — run_id={run_id} job_id={crawl_job_id}")
    return {"run_id": run_id, "crawl_job_id": crawl_job_id, "status": "STARTED"}


@router.get("/crawl/status/{crawl_job_id}")
async def v3_crawl_status(crawl_job_id: str):
    """Poll app-graph-crawler for live job status."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{GRAPH_CRAWLER_URL}/status/{crawl_job_id}")
            data = resp.json()

        # Sync node/edge counts back into the DB crawl_runs record when complete
        if data.get("status") in ("COMPLETE", "FAILED"):
            from db import db_list, db_update
            from datetime import datetime, timezone
            rows = db_list("crawl_runs", "app_id = ?", [data.get("app_id", "")], limit=1)
            if rows:
                db_update("crawl_runs", "run_id", rows[0]["run_id"], {
                    "status":      data.get("status"),
                    "phase":       "done",
                    "finished_at": data.get("finished_at") or datetime.now(timezone.utc).isoformat(),
                    "node_count":  data.get("node_count", 0),
                    "edge_count":  data.get("edge_count", 0),
                })
                db_emit_event(
                    data.get("app_id", ""),
                    "GRAPH_CRAWLER_V3",
                    f"Crawl {data.get('status')} — "
                    f"{data.get('node_count', 0)} nodes, "
                    f"{data.get('edge_count', 0)} edges, "
                    f"{data.get('unfilled_fields', 0)} unfilled fields",
                    "INFO" if data.get("status") == "COMPLETE" else "ERROR",
                )

        return data
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "UNKNOWN", "detail": str(e)},
        )


@router.get("/crawl/jobs")
async def v3_crawl_jobs():
    """List all jobs known to the app-graph-crawler service."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{GRAPH_CRAWLER_URL}/jobs")
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=503, content={"detail": str(e)})


@router.get("/crawl/health")
async def v3_crawl_health():
    """Health check for the app-graph-crawler service."""
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get(f"{GRAPH_CRAWLER_URL}/health")
            return resp.json()
    except Exception as e:
        return {"status": "offline", "detail": str(e)}


_SKIP_TITLES = {"error page", "access denied", "page", "untitled", "403", "404", "500", ""}

def _pascal(s: str) -> str:
    import re as _re
    return "".join(w.capitalize() for w in _re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)

def _page_ref_name(node: dict) -> str:
    """Derive a stable PascalCase page ref name from a node — mirrors pom_generator_v2._class_name_from_node."""
    from urllib.parse import urlparse
    for field in ("nodeName", "heading"):
        val = (node.get(field) or "").strip()
        if val and val.lower() not in _SKIP_TITLES and len(val) <= 80:
            return _pascal(val) + "Page"
    title = (node.get("title") or "").strip()
    if title and title.lower() not in _SKIP_TITLES:
        return _pascal(title) + "Page"
    url = node.get("url", "")
    parsed = urlparse(url)
    ignore = {"en-us", "en-US", "common", "members", "pages", "aspx", ""}
    parts = [p.rsplit(".", 1)[0] for p in parsed.path.strip("/").split("/")
             if p and p.lower() not in ignore]
    label = " ".join(parts[-2:]) if parts else (parsed.hostname or "Unknown").split(".")[0]
    return _pascal(label) + "Page" if label else "UnknownPage"


def _patch_page_ref_names(local_path: str, raw: dict, normalized_nodes: list) -> None:
    """Write pageRef back into each node of the raw graph file so the generator can read it."""
    raw_nodes = raw.get("nodes", {})
    changed = False
    if isinstance(raw_nodes, list):
        id_to_ref = {n["nodeId"]: n.get("pageRef", "") for n in normalized_nodes}
        for node in raw_nodes:
            nid = node.get("nodeId", "")
            ref = id_to_ref.get(nid, "")
            if ref and node.get("pageRef") != ref:
                node["pageRef"] = ref
                changed = True
    else:
        id_to_ref = {n["nodeId"]: n.get("pageRef", "") for n in normalized_nodes}
        for node_id, node in raw_nodes.items():
            ref = id_to_ref.get(node_id, "")
            if ref and node.get("pageRef") != ref:
                node["pageRef"] = ref
                changed = True
    if changed:
        try:
            with open(local_path, "w") as f:
                json.dump(raw, f, indent=2)
        except Exception as e:
            logger.warning(f"Could not patch pageRef into {local_path}: {e}")


def _infer_action_type(el: dict) -> str:
    """Infer V2-style actionType from a V3 element's role/tag/type fields."""
    role = (el.get("role") or "").lower()
    tag  = (el.get("tag")  or "").lower()
    typ  = (el.get("type") or "").lower()
    if role == "checkbox" or typ == "checkbox":
        return "check"
    if role in ("combobox", "listbox") or tag == "select":
        return "select"
    if role in ("textbox", "searchbox", "spinbutton") or tag in ("textarea",) or typ in ("text", "email", "password", "search", "tel", "number", "url"):
        return "fill"
    return "click"


def _selector_from_element(el: dict) -> str:
    """Derive the best CSS/xpath selector from a V3 element."""
    # Prefer an already-computed selector key, then a raw CSS selector, then id, then label/name
    for key in ("selectorKey", "_selector"):
        val = el.get(key) or ""
        if val:
            return val
    eid = el.get("id") or ""
    if eid:
        return f"#{eid}"
    return el.get("label") or el.get("name") or el.get("inferredName") or ""


def _normalize_v3_graph(raw: dict) -> dict:
    """
    Convert a V3 crawler graph (nodes as Record, V3 element schema) into the
    GraphView-compatible format (nodes as list, selectorKey + actionType on elements).

    Priority order for the graph source:
      1. shared/outputs/{app_id}/graph.json  — post-generator, has className
      2. raw graph from crawler service       — pre-generator, no className

    The caller passes whichever source they have; this function only normalizes shape.
    """
    raw_nodes = raw.get("nodes", {})
    raw_edges = raw.get("edges", [])
    raw_meta  = raw.get("meta", {})

    # ── Normalise nodes ────────────────────────────────────────────────────────
    if isinstance(raw_nodes, list):
        # Already V2-style array — just ensure selectorKey/actionType exist
        nodes = []
        for node in raw_nodes:
            new_els = []
            for el in node.get("elements", []):
                new_el = dict(el)
                if "selectorKey" not in new_el or not new_el["selectorKey"]:
                    new_el["selectorKey"] = _selector_from_element(el)
                if "actionType" not in new_el or not new_el["actionType"]:
                    new_el["actionType"] = el.get("actionType") or _infer_action_type(el)
                if "name" not in new_el or not new_el["name"]:
                    new_el["name"] = (el.get("label") or el.get("inferredName")
                                      or el.get("name") or el.get("role") or "")
                new_els.append(new_el)
            ref = node.get("pageRef") or _page_ref_name(node)
            nodes.append({**node, "elements": new_els, "pageRef": ref})
    else:
        # V3 Record<nodeId, node> format — convert to list
        nodes = []
        for node_id, node in raw_nodes.items():
            new_els = []
            for el in node.get("elements", []):
                new_els.append({
                    "role":        el.get("role", "") or el.get("tag", ""),
                    "name":        el.get("label") or el.get("inferredName") or el.get("name") or "",
                    "selectorKey": _selector_from_element(el),
                    "actionType":  el.get("actionType") or _infer_action_type(el),
                    "tag":         el.get("tag", ""),
                    "inputType":   el.get("inputType") or el.get("type") or "",
                })
            unf = node.get("unfilledFields", [])
            ref = _page_ref_name(node)
            nodes.append({
                "nodeId":       node_id,
                "url":          node.get("url", ""),
                "title":        node.get("title", ""),
                "className":    node.get("className", ""),
                "pageRef":  ref,
                "elements":     new_els,
                "assertableElements": [_selector_from_element({"_selector": f.get("fieldId", "")}) for f in unf],
            })

    # ── Normalise edges ────────────────────────────────────────────────────────
    edges = []
    for e in raw_edges:
        trigger = e.get("trigger", {})
        edges.append({
            "edgeId":      e.get("id") or e.get("edgeId") or "",
            "fromNodeId":  e.get("from") or e.get("fromNodeId") or "",
            "toNodeId":    e.get("to")   or e.get("toNodeId")   or "",
            "selectorKey": trigger.get("elementName") or e.get("selectorKey") or "",
            "label":       trigger.get("semanticType") or e.get("label") or "",
            "actionType":  trigger.get("type") or e.get("actionType") or "click",
        })

    # ── Normalise meta ─────────────────────────────────────────────────────────
    meta = {
        "totalNodes": raw_meta.get("totalNodes", len(nodes)),
        "totalEdges": raw_meta.get("totalEdges", len(edges)),
        "crawledAt":  raw_meta.get("crawledAt", ""),
        "appId":      raw_meta.get("appId") or raw_meta.get("seedUrl", ""),
        "summary":    raw_meta.get("summary", ""),
        "unfilledFields": raw_meta.get("unfilledFields", 0),
    }

    return {"nodes": nodes, "edges": edges, "meta": meta}


@router.get("/graph/{app_id}")
async def v3_get_graph(app_id: str):
    """
    Return the normalized graph for the V3 Knowledge Base.

    Tries the shared dir first (post-generator, has className annotations),
    then falls back to proxying the live graph from the crawler service.
    """
    # 1 — Try the shared dir (generator has patched className into nodes)
    local_path = os.path.join(_SHARED_DIR, "outputs", app_id, "graph.json")
    if os.path.exists(local_path):
        try:
            with open(local_path) as f:
                raw = json.load(f)
            normalized = _normalize_v3_graph(raw)
            # Persist pageRef back into the raw file so the generator can use it
            _patch_page_ref_names(local_path, raw, normalized["nodes"])
            return normalized
        except Exception as e:
            logger.warning(f"Failed to read local graph for {app_id}: {e}")

    # 2 — Fall back to the live crawler service graph
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{GRAPH_CRAWLER_URL}/graph/{app_id}")
            if resp.status_code == 404:
                return JSONResponse(
                    status_code=404,
                    content={"detail": "Graph not found — run a V3 crawl first"},
                )
            raw = resp.json()
        return _normalize_v3_graph(raw)
    except Exception as e:
        return JSONResponse(status_code=503, content={"detail": str(e)})


@router.get("/events/{app_id}")
def v3_get_events(app_id: str, limit: int = 300, since: str = ""):
    """Fetch stored events for an app (newest first)."""
    if since:
        events = db_list_since("ui_events", app_id, since, limit=limit)
    else:
        events = db_list("ui_events", "app_id = ?", [app_id], limit=limit)
    return {"events": list(reversed(events))}


@router.get("/events/{app_id}/stream")
async def v3_stream_events(request: Request, app_id: str, since: str = ""):
    """SSE stream — replays events from `since`, then tails in real time."""
    last_event_id_header = request.headers.get("last-event-id", "")
    if last_event_id_header.isdigit():
        cursor = int(last_event_id_header)
    elif since:
        cursor = db_rowid_before_since("ui_events", app_id, since)
    else:
        cursor = 0

    async def generate():
        nonlocal cursor
        while True:
            if await request.is_disconnected():
                break
            rows = db_list_after_rowid("ui_events", app_id, cursor)
            for rowid, ev in rows:
                cursor = rowid
                yield f"id: {rowid}\ndata: {json.dumps(ev)}\n\n"
            await asyncio.sleep(0.4)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )
