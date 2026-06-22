"""
Dashboard V3-AI API — wired to the Node.js crawl-ai service (port 8006).

Same endpoint shape as v3_router but points at crawl-ai instead of app-graph-crawler.
Supports full crawl_ai feature set: BFS + LLM flow execution, target_flows, Excel seed.
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

from db import (db_emit_event, db_insert, db_list, db_list_after_rowid,
                db_list_since, db_rowid_before_since, db_update)

logger = logging.getLogger("dashboard.v3_ai")

import os

from config import CRAWL_AI_URL
from v3_router import _normalize_v3_graph, _patch_page_ref_names

_SHARED_DIR = os.environ.get("SHARED_DIR", os.path.join(os.path.dirname(__file__), "../../shared"))

router = APIRouter(prefix="/api/v3/ai", tags=["v3-ai"])


# ── Request models ─────────────────────────────────────────────────────────────

class V3AiCrawlTriggerBody(BaseModel):
    app_id:         str
    app_url:        str = ""
    excel_path:     str = ""
    framework_dir:  str = ""
    max_pages:      int | None = None
    max_depth:      int | None = None
    headless:       bool = True
    target_flows:   list[str] = []
    allowed_domain: str = ""
    llm_enabled:    bool = True


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/crawl/trigger")
async def v3_ai_crawl_trigger(body: V3AiCrawlTriggerBody):
    run_id = "v3ai-run-" + uuid.uuid4().hex[:8]
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
    db_emit_event(body.app_id, "CRAWL_AI", "Crawl AI (Node.js) triggered via V3 dashboard")

    payload: dict = {
        "app_id":   body.app_id,
        "app_url":  body.app_url,
        "headless": body.headless,
        "llm_enabled": body.llm_enabled,
    }
    if body.excel_path:     payload["excel_path"]     = body.excel_path
    if body.max_pages:      payload["max_pages"]      = body.max_pages
    if body.max_depth:      payload["max_depth"]      = body.max_depth
    if body.allowed_domain: payload["allowed_domain"] = body.allowed_domain
    if body.target_flows:   payload["target_flows"]   = body.target_flows
    if body.framework_dir:  payload["framework_dir"]  = body.framework_dir

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{CRAWL_AI_URL}/trigger", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "CRAWL_AI", f"crawl-ai service unreachable: {e}", "ERROR")
        return JSONResponse(
            status_code=503,
            content={"run_id": run_id, "status": "ERROR", "detail": str(e)},
        )

    crawl_job_id = data.get("job_id", "")
    logger.info(f"V3 AI crawl triggered — run_id={run_id} job_id={crawl_job_id}")
    return {"run_id": run_id, "crawl_job_id": crawl_job_id, "status": "STARTED"}


@router.get("/crawl/status/{crawl_job_id}")
async def v3_ai_crawl_status(crawl_job_id: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{CRAWL_AI_URL}/status/{crawl_job_id}")
            data = resp.json()

        if data.get("status") in ("COMPLETE", "FAILED"):
            rows = db_list("crawl_runs", "app_id = ?", [data.get("app_id", "")], limit=1)
            if rows:
                db_update("crawl_runs", "run_id", rows[0]["run_id"], {
                    "status":      data.get("status"),
                    "phase":       "done",
                    "finished_at": data.get("finished_at") or datetime.now(timezone.utc).isoformat(),
                    "node_count":  data.get("node_count", 0),
                    "edge_count":  data.get("edge_count", 0),
                })
                app_id = data.get("app_id", "")
                crawl_status = data.get("status")
                db_emit_event(
                    app_id,
                    "CRAWL_AI",
                    f"Crawl {crawl_status} — "
                    f"{data.get('node_count', 0)} nodes, {data.get('edge_count', 0)} edges",
                    "INFO" if crawl_status == "COMPLETE" else "ERROR",
                )
                if crawl_status == "COMPLETE" and data.get("eval_grade"):
                    score = data.get("eval_score", "?")
                    grade = data.get("eval_grade", "?")
                    spec  = data.get("spec_quality_recommendation", "")
                    level = "SUCCESS" if grade in ("A", "B") else "WARN" if grade in ("C", "D") else "ERROR"
                    db_emit_event(app_id, "CRAWL_AI", f"Eval — score: {score}/100  grade: {grade}", level)
                    if spec:
                        spec_level = "SUCCESS" if spec == "ready" else "WARN" if spec == "review_required" else "ERROR"
                        db_emit_event(app_id, "CRAWL_AI", f"Spec quality: {spec}", spec_level)
        return data
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "UNKNOWN", "detail": str(e)})


@router.get("/crawl/health")
async def v3_ai_crawl_health():
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get(f"{CRAWL_AI_URL}/health")
            return resp.json()
    except Exception as e:
        return {"status": "offline", "detail": str(e)}


@router.get("/graph/{app_id}")
async def v3_ai_get_graph(app_id: str):
    # Prefer the shared file — it has className patched by the generator and pageRef
    local_path = os.path.join(_SHARED_DIR, "outputs", app_id, "graph.json")
    if os.path.exists(local_path):
        try:
            with open(local_path) as f:
                raw = json.load(f)
            normalized = _normalize_v3_graph(raw)
            _patch_page_ref_names(local_path, raw, normalized["nodes"])
            return normalized
        except Exception as e:
            logger.warning(f"Failed to read local graph for {app_id}: {e}")

    # Fall back to the live crawl-ai service
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{CRAWL_AI_URL}/graph/{app_id}")
            if resp.status_code == 404:
                return JSONResponse(
                    status_code=404,
                    content={"detail": "Graph not found — run a V3 AI crawl first"},
                )
            return _normalize_v3_graph(resp.json())
    except Exception as e:
        return JSONResponse(status_code=503, content={"detail": str(e)})


@router.get("/events/{app_id}")
def v3_ai_get_events(app_id: str, limit: int = 300, since: str = ""):
    if since:
        events = db_list_since("ui_events", app_id, since, limit=limit)
    else:
        events = db_list("ui_events", "app_id = ?", [app_id], limit=limit)
    return {"events": list(reversed(events))}


@router.get("/events/{app_id}/stream")
async def v3_ai_stream_events(request: Request, app_id: str, since: str = ""):
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
