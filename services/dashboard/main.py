import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
import tempfile
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from config import CRAWL_URL, CRAWL_AI_URL, EXECUTOR_URL, GENERATOR_URL, PLANNER_URL, PORT
from db import (db_emit_event, db_get, db_insert, db_list, db_list_after_rowid,
                db_list_since, db_rowid_before_since, db_update)
from models import (CrawlTriggerBody, EventBody, ExecuteResultsBody,
                    ExecuteRunBody, PlanRunBody)
from v3_router import router as v3_router
from v3_ai_router import router as v3_ai_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("dashboard")

_SHARED_DIR = os.environ.get("SHARED_DIR", os.path.join(os.path.dirname(__file__), "../../shared"))

CATALOG_URL        = os.environ.get("CATALOG_URL", "http://localhost:8761")
CATALOG_HEARTBEAT  = int(os.environ.get("CATALOG_HEARTBEAT_INTERVAL", "20"))


class _CatalogRegistration:
    """Registers this service with the CaaS catalog and keeps the lease alive."""

    def __init__(self, catalog_url: str, name: str, host: str, port: int, health_path: str):
        self._url        = catalog_url.rstrip("/")
        self._body       = {"name": name, "host": host, "port": port,
                            "healthUrl": f"http://{host}:{port}{health_path}", "metadata": {}}
        self._instance_id: str | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await self._register()
        self._task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        await self._deregister()

    async def _register(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.post(f"{self._url}/register", json=self._body)
                r.raise_for_status()
                self._instance_id = r.json()["id"]
                logger.info("Registered with catalog as instance %s", self._instance_id)
        except Exception as exc:
            logger.warning("Could not register with catalog: %s — will retry on next heartbeat", exc)

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(CATALOG_HEARTBEAT)
            if self._instance_id is None:
                await self._register()
                continue
            try:
                async with httpx.AsyncClient(timeout=5) as c:
                    r = await c.put(f"{self._url}/heartbeat/{self._instance_id}")
                    if r.status_code == 404:
                        self._instance_id = None
            except Exception as exc:
                logger.warning("Heartbeat failed: %s — will re-register on next tick", exc)
                self._instance_id = None

    async def _deregister(self) -> None:
        if not self._instance_id:
            return
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                await c.delete(f"{self._url}/deregister/{self._instance_id}")
                logger.info("Deregistered instance %s from catalog", self._instance_id)
        except Exception as exc:
            logger.warning("Deregister failed: %s — catalog lease TTL will evict the instance", exc)
        finally:
            self._instance_id = None


_catalog = _CatalogRegistration(
    catalog_url=CATALOG_URL,
    name="dashboard",
    host="localhost",
    port=PORT,
    health_path="/health",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("=" * 50)
    logger.info("Dashboard API online — control plane ready")
    logger.info("Deployment type: ALWAYS-ON")
    logger.info("Web UI: http://localhost:8000")
    logger.info("=" * 50)
    await _catalog.start()
    yield
    logger.info("Dashboard shutting down")
    await _catalog.stop()


app = FastAPI(
    title="Dashboard API",
    description="Control plane. Always-on. All services report here.",
    version="1.0.0",
    lifespan=lifespan
)

app.include_router(v3_router)
app.include_router(v3_ai_router)

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
            payload: dict = {
                "app_id": body.app_id,
                "app_url": body.app_url,
                "build_id": build_id,
                "trigger_type": body.trigger_type,
                "framework_dir": body.framework_dir,
                "headless": body.headless,
            }
            if body.flow_name:
                payload["flow_name"] = body.flow_name
            resp = await client.post(f"{CRAWL_AI_URL}/trigger", json=payload)
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "CRAWL", f"Crawl service unreachable: {e}", "ERROR")
        return {"run_id": run_id, "status": "ERROR", "detail": str(e)}

    return {"run_id": run_id, "build_id": build_id, "crawl_job_id": data.get("job_id"), "status": "STARTED"}


@app.post("/api/pom/trigger")
async def pom_trigger(body: dict):
    """Generator — supports target_tool: selenium-java|selenium-csharp|playwright-js|playwright-ts"""
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


@app.post("/api/plan/upload-excel")
async def plan_upload_excel(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{PLANNER_URL}/plan/load-excel", json={"excel_path": tmp_path})
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
                "description": body.description, "java_dir": body.java_dir,
                "steps": [s.model_dump() for s in body.steps],
            })
            data = resp.json()
    except Exception as e:
        db_emit_event(body.app_id, "PLANNER", f"Planner unreachable: {e}", "ERROR")
        return {"tc_id": tc_id, "status": "ERROR", "detail": str(e)}

    return {"tc_id": tc_id, "job_id": data.get("job_id"), "status": "STARTED"}


@app.get("/api/plan/usage/{app_id}")
async def plan_usage(app_id: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{PLANNER_URL}/plan/usage/{app_id}")
            return resp.json()
    except Exception as e:
        return {"totalCalls": 0, "totalCostUsd": 0.0, "detail": str(e)}


@app.get("/api/plan/status/{job_id}")
async def plan_status(job_id: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{PLANNER_URL}/status/{job_id}")
            return resp.json()
    except Exception as e:
        return {"job_id": job_id, "status": "error", "detail": str(e)}


def _tc_json_path(app_id: str) -> str:
    return os.path.join(_SHARED_DIR, "outputs", app_id, "test_cases.json")


def _load_tc_json(app_id: str) -> dict:
    path = _tc_json_path(app_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_tc_json(app_id: str, records: dict):
    path = _tc_json_path(app_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(records, f, indent=2)


@app.post("/api/plan/save")
async def plan_save(body: dict):
    app_id = body.get("app_id", "")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{PLANNER_URL}/plan/save", json=body)
            data = resp.json()
    except Exception as e:
        return {"status": "error", "detail": str(e)}

    now = datetime.now(timezone.utc).isoformat()
    records = _load_tc_json(app_id)
    for entry in data.get("saved", []):
        tc_name = entry.get("tc_name", "")
        existing = records.get(tc_name, {})
        records[tc_name] = {
            **existing,
            "tc_name":       tc_name,
            "app_id":        app_id,
            "status":        entry.get("status", "READY"),
            "confidence":    entry.get("confidence", 0),
            "file_path":     entry.get("file_path", ""),
            "class_name":    entry.get("class_name", ""),
            "method_name":   entry.get("method_name", ""),
            "parameters":    entry.get("parameters", []),
            "review_reason": entry.get("review_reason", ""),
            "updated_at":    now,
            "created_at":    existing.get("created_at", now),
        }
    _save_tc_json(app_id, records)
    return data


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
            resp.json()
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


@app.post("/api/execute/export-template")
async def execute_export_template(body: dict):
    """Proxy: build Excel template for selected test methods."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{EXECUTOR_URL}/execute/export-template", json=body)
        return StreamingResponse(
            iter([resp.content]),
            media_type=resp.headers.get("content-type", "application/octet-stream"),
            headers={"Content-Disposition": resp.headers.get("content-disposition", "attachment")},
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/api/execute/import-data")
async def execute_import_data(app_id: str, file: UploadFile = File(...), java_dir: str | None = None):
    """Proxy: forward uploaded Excel, write testdata JSON + regenerate testng.xml."""
    try:
        contents = await file.read()
        params: dict = {"app_id": app_id}
        if java_dir:
            params["java_dir"] = java_dir
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{EXECUTOR_URL}/execute/import-data",
                params=params,
                files={"file": (file.filename, contents, file.content_type)},
            )
        return resp.json()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/api/execute/run-suite")
async def execute_run_suite(body: dict):
    """Proxy: stream SSE from the executor's run-suite endpoint."""
    async def _stream():
        async with httpx.AsyncClient(timeout=600) as client:
            async with client.stream("POST", f"{EXECUTOR_URL}/execute/run-suite", json=body) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk
    return StreamingResponse(_stream(), media_type="text/event-stream")


@app.get("/api/execute/executor-results")
async def execute_executor_results(app_id: str, limit: int = 20):
    """Proxy: list past execution results from shared outputs."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{EXECUTOR_URL}/execute/results",
                params={"app_id": app_id, "limit": limit},
            )
        return resp.json()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/test-cases/{app_id}")
def get_test_cases(app_id: str):
    records = _load_tc_json(app_id)
    rows = sorted(records.values(), key=lambda r: r.get("created_at", ""), reverse=True)
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


@app.get("/api/graph/{app_id}")
def get_graph(app_id: str):
    graph_path = os.path.join(_SHARED_DIR, "outputs", app_id, "graph.json")
    if not os.path.exists(graph_path):
        return JSONResponse(status_code=404, content={"detail": "Graph not found — run the pipeline first"})
    with open(graph_path) as f:
        raw = json.load(f)
    # Hydrate node.elements from globalElements + ownElements for graphs written in split format
    global_elements = raw.get("globalElements") or {}
    if global_elements:
        for node in (raw.get("nodes") or {}).values() if isinstance(raw.get("nodes"), dict) else (raw.get("nodes") or []):
            if "ownElements" in node:
                inherited = [global_elements[eid] for eid in (node.get("inheritedElementIds") or []) if eid in global_elements]
                node["elements"] = inherited + (node.get("ownElements") or [])
    return raw


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
