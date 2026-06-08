import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from config import CRAWL_URL, EXECUTOR_URL, GENERATOR_URL, PLANNER_URL, PORT
from db import (db_emit_event, db_get, db_insert, db_list, db_list_after_rowid,
                db_list_since, db_rowid_before_since, db_update)
from models import (CrawlTriggerBody, EventBody, ExecuteResultsBody,
                    ExecuteRunBody, PlanRunBody)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("dashboard")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 50)
    logger.info("Dashboard API online — control plane ready")
    logger.info("Deployment type: ALWAYS-ON")
    logger.info("Web UI: http://localhost:8000")
    logger.info("=" * 50)
    yield
    logger.info("Dashboard shutting down")


app = FastAPI(
    title="Dashboard API",
    description="Control plane. Always-on. All services report here.",
    version="1.0.0",
    lifespan=lifespan
)

UI_DIR = Path(__file__).parent.parent.parent / "ui"

if UI_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(UI_DIR)), name="ui")


@app.get("/")
def serve_ui():
    index = UI_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "Dashboard API online", "ui": "index.html not found"}


@app.get("/health")
def health():
    return {"service": "dashboard", "status": "online", "deployment_type": "always-on", "port": PORT}


@app.post("/api/events")
async def emit_event(body: EventBody):
    db_emit_event(body.app_id, body.stage, body.message, body.level)
    return {"status": "ok"}


@app.get("/api/events/{app_id}")
def get_events(app_id: str, limit: int = 200, since: str = ""):
    if since:
        events = db_list_since("ui_events", app_id, since, limit=limit)
    else:
        events = db_list("ui_events", "app_id = ?", [app_id], limit=limit)
    return {"events": list(reversed(events))}


@app.get("/api/events/{app_id}/stream")
async def stream_events(request: Request, app_id: str, since: str = ""):
    """SSE endpoint — streams events as they arrive, replaying from `since` first."""
    # Resume from Last-Event-ID if the browser reconnects, else resolve from `since` timestamp
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
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.post("/api/crawl/trigger")
async def crawl_trigger(body: CrawlTriggerBody):
    build_id = body.build_id or "build-" + uuid.uuid4().hex[:8]
    run_id = "crawl-" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    db_insert("crawl_runs", {
        "run_id": run_id, "app_id": body.app_id, "status": "STARTED",
        "phase": "init", "trigger_type": body.trigger_type,
        "started_at": now, "finished_at": None, "node_count": 0, "edge_count": 0
    })
    db_emit_event(body.app_id, "CRAWL", f"Crawl triggered — {body.trigger_type}")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{CRAWL_URL}/trigger", json={
                "app_id": body.app_id,
                "app_url": body.app_url,
                "build_id": build_id,
                "trigger_type": body.trigger_type,
                "framework_dir": body.framework_dir,
            })
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "CRAWL", f"Crawl service unreachable: {e}", "ERROR")
        return {"run_id": run_id, "status": "ERROR", "detail": str(e)}

    return {"run_id": run_id, "build_id": build_id, "crawl_job_id": data.get("job_id"), "status": "STARTED"}


@app.post("/api/pom/trigger")
async def pom_trigger(body: dict):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{GENERATOR_URL}/trigger", json=body)
            return resp.json()
    except Exception as e:
        return {"status": "ERROR", "detail": str(e)}


@app.post("/api/plan/load-excel")
async def plan_load_excel(body: dict):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{PLANNER_URL}/plan/load-excel", json=body)
            return resp.json()
    except Exception as e:
        return {"status": "ERROR", "detail": str(e)}


@app.post("/api/plan/run")
async def plan_run(body: PlanRunBody):
    tc_id = "tc-" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()
    db_insert("test_cases", {
        "tc_id": tc_id, "app_id": body.app_id, "tc_name": body.tc_name,
        "status": "PLANNED", "confidence": 0.0, "file_path": "",
        "class_name": "", "method_name": "", "parameters": "[]",
        "review_reason": "", "created_at": now, "updated_at": now
    })
    db_emit_event(body.app_id, "PLANNER", f"Planning started: {body.tc_name}")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{PLANNER_URL}/plan/run", json={
                "app_id": body.app_id, "tc_name": body.tc_name,
                "description": body.description, "java_dir": body.java_dir
            })
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "PLANNER", f"Planner unreachable: {e}", "ERROR")
        return {"tc_id": tc_id, "status": "ERROR", "detail": str(e)}

    return {"tc_id": tc_id, "job_id": data.get("job_id"), "status": "STARTED"}


@app.post("/api/plan/callback")
async def plan_callback(body: dict):
    """Called by planner (via events) when planning completes."""
    tc_name = body.get("tc_name")
    app_id = body.get("app_id")
    if not tc_name:
        return {"status": "ok"}

    rows = db_list("test_cases", "app_id = ? AND tc_name = ?", [app_id, tc_name], limit=1)
    if rows:
        tc_id = rows[0]["tc_id"]
        now = datetime.now(timezone.utc).isoformat()
        db_update("test_cases", "tc_id", tc_id, {
            "status": body.get("status", "READY"),
            "confidence": body.get("confidence", 0),
            "file_path": body.get("file_path", ""),
            "class_name": body.get("class_name", ""),
            "method_name": body.get("method_name", ""),
            "parameters": json.dumps(body.get("parameters", [])),
            "review_reason": body.get("review_reason", ""),
            "updated_at": now
        })
    return {"status": "ok"}


@app.post("/api/execute/run")
async def execute_run(body: ExecuteRunBody):
    run_id = body.run_id or "run-" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()
    db_insert("test_runs", {
        "run_id": run_id, "app_id": body.app_id,
        "selected_tcs": json.dumps(body.selected_tests),
        "status": "STARTED", "triggered_at": now,
        "finished_at": None, "mvn_exit_code": None
    })
    db_emit_event(body.app_id, "EXECUTE", f"Run {run_id} started — {len(body.selected_tests)} tests")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{EXECUTOR_URL}/execute/run", json={
                "app_id": body.app_id, "run_id": run_id,
                "java_dir": body.java_dir,
                "selected_tests": body.selected_tests,
                "test_data": body.test_data
            })
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "EXECUTE", f"Executor unreachable: {e}", "ERROR")
        return {"run_id": run_id, "status": "ERROR", "detail": str(e)}

    return {"run_id": run_id, "status": "STARTED"}


@app.post("/api/execute/results")
async def execute_results(body: ExecuteResultsBody):
    now = datetime.now(timezone.utc).isoformat()
    passed = failed = 0
    for r in body.results:
        db_insert("test_results", {
            "result_id": r.get("result_id", "res-" + uuid.uuid4().hex[:8]),
            "run_id": body.run_id,
            "tc_name": r["tc_name"],
            "status": r["status"],
            "duration_ms": r.get("duration_ms", 0),
            "failure_msg": r.get("failure_msg", ""),
            "created_at": now
        })
        if r["status"] == "PASSED":
            passed += 1
        elif r["status"] == "FAILED":
            failed += 1

    db_update("test_runs", "run_id", body.run_id, {
        "status": "DONE", "finished_at": now, "mvn_exit_code": body.mvn_exit_code
    })
    return {"status": "ok", "passed": passed, "failed": failed}


@app.get("/api/test-cases/{app_id}")
def get_test_cases(app_id: str):
    rows = db_list("test_cases", "app_id = ?", [app_id], limit=500)
    for r in rows:
        try:
            r["parameters"] = json.loads(r.get("parameters") or "[]")
        except Exception:
            r["parameters"] = []
    return {"test_cases": rows}


@app.get("/api/test-cases/{tc_id}/parameters")
def get_parameters(tc_id: str):
    row = db_get("test_cases", "tc_id", tc_id)
    if not row:
        return {"parameters": []}
    try:
        params = json.loads(row.get("parameters") or "[]")
    except Exception:
        params = []
    return {"parameters": params}


@app.get("/api/run/{run_id}/results")
def get_run_results(run_id: str):
    results = db_list("test_results", "run_id = ?", [run_id], limit=500)
    return {"results": results}


_SHARED_DIR = os.environ.get("SHARED_DIR", os.path.join(os.path.dirname(__file__), "../../shared"))

@app.get("/api/graph/{app_id}")
def get_graph(app_id: str):
    graph_path = os.path.join(_SHARED_DIR, "outputs", app_id, "graph.json")
    if not os.path.exists(graph_path):
        return JSONResponse(status_code=404, content={"detail": "Graph not found — run the pipeline first"})
    with open(graph_path) as f:
        return json.load(f)


@app.get("/api/services/health")
async def services_health():
    services = {
        "crawl":     (CRAWL_URL,     "lambda-style"),
        "generator": (GENERATOR_URL, "lambda-style"),
        "planner":   (PLANNER_URL,   "on-demand"),
        "executor":  (EXECUTOR_URL,  "always-on"),
    }
    result = {}
    async with httpx.AsyncClient(timeout=3) as client:
        for name, (url, dtype) in services.items():
            try:
                resp = await client.get(f"{url}/health")
                data = resp.json()
                result[name] = data
            except Exception:
                result[name] = {"status": "offline", "deployment_type": dtype}
    return result
