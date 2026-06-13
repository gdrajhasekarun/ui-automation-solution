"""
Dashboard V2 API — wired to the BFS crawl_ai service.

All endpoints live under /api/v2/.
The key difference from V1: trigger accepts excel_path (seed file),
and status polling maps to crawl_ai's job-level status endpoint.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from config import CRAWL_URL
from db import (db_emit_event, db_insert, db_list, db_list_after_rowid,
                db_list_since, db_rowid_before_since)

logger = logging.getLogger("dashboard.v2")

router = APIRouter(prefix="/api/v2", tags=["v2"])


# ── Request models ────────────────────────────────────────────────────────────

class V2CrawlTriggerBody(BaseModel):
    app_id:        str
    app_url:       str = ""
    excel_path:    str = ""       # seed Excel path — new in V2
    framework_dir: str = ""       # path to Java framework root for POM output
    max_pages:     int | None = None
    max_depth:     int | None = None
    headless:      bool = True
    target_flows:  list[str] = []


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/crawl/trigger")
async def v2_crawl_trigger(body: V2CrawlTriggerBody):
    """Trigger a BFS crawl via crawl_ai service. Returns run_id + crawl_job_id."""
    run_id   = "v2-run-"  + uuid.uuid4().hex[:8]
    build_id = "v2-build-" + uuid.uuid4().hex[:8]
    now      = datetime.now(timezone.utc).isoformat()

    db_insert("crawl_runs", {
        "run_id": run_id, "app_id": body.app_id, "status": "STARTED",
        "phase": "init", "trigger_type": "INITIAL",
        "started_at": now, "finished_at": None, "node_count": 0, "edge_count": 0,
    })
    db_emit_event(body.app_id, "CRAWL_AI_V2", "BFS crawl triggered via V2 dashboard")

    payload: dict = {
        "app_id":        body.app_id,
        "app_url":       body.app_url,
        "build_id":      build_id,
        "trigger_type":  "INITIAL",
        "framework_dir": body.framework_dir,
        "headless":      body.headless,
    }
    if body.excel_path:
        payload["excel_path"] = body.excel_path
    if body.max_pages is not None:
        payload["max_pages"] = body.max_pages
    if body.max_depth is not None:
        payload["max_depth"] = body.max_depth
    if body.target_flows:
        payload["target_flows"] = body.target_flows

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{CRAWL_URL}/trigger", json=payload)
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "CRAWL_AI_V2", f"Crawl AI unreachable: {e}", "ERROR")
        return JSONResponse(
            status_code=503,
            content={"run_id": run_id, "status": "ERROR", "detail": str(e)},
        )

    crawl_job_id = data.get("job_id", "")
    logger.info(f"V2 crawl triggered — run_id={run_id} job_id={crawl_job_id}")
    return {"run_id": run_id, "crawl_job_id": crawl_job_id, "status": "STARTED"}


@router.get("/crawl/status/{crawl_job_id}")
async def v2_crawl_status(crawl_job_id: str):
    """Poll crawl_ai for the live job status."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{CRAWL_URL}/status/{crawl_job_id}")
            return resp.json()
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "UNKNOWN", "detail": str(e)},
        )


@router.get("/crawl/health")
async def v2_crawl_health():
    """Health check for the crawl_ai service."""
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get(f"{CRAWL_URL}/health")
            return resp.json()
    except Exception as e:
        return {"status": "offline", "detail": str(e)}


@router.get("/graph/{app_id}")
def v2_get_graph(app_id: str):
    """Return the graph.json produced by the BFS crawl."""
    import os
    shared_dir = os.environ.get("SHARED_DIR", "../../shared")
    graph_path = os.path.join(shared_dir, "outputs", app_id, "graph.json")
    if not os.path.exists(graph_path):
        return JSONResponse(
            status_code=404,
            content={"detail": "Graph not found — run a V2 crawl first"},
        )
    with open(graph_path) as f:
        return json.load(f)


@router.get("/events/{app_id}")
def v2_get_events(app_id: str, limit: int = 300, since: str = ""):
    """Fetch stored events for an app (newest first)."""
    if since:
        events = db_list_since("ui_events", app_id, since, limit=limit)
    else:
        events = db_list("ui_events", "app_id = ?", [app_id], limit=limit)
    return {"events": list(reversed(events))}


@router.get("/events/{app_id}/stream")
async def v2_stream_events(request: Request, app_id: str, since: str = ""):
    """SSE stream — replays from `since`, then tails in real time."""
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
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
