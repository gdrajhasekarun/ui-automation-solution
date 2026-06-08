import logging
import os
import traceback
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, FastAPI

from config import DASHBOARD_URL, GENERATOR_URL, PORT, SHARED_DIR
from diff_engine import run_diff
from seed_builder import build_seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("crawl-service")

_jobs: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("=" * 55)
    logger.info("Crawl service ready — waiting for trigger")
    logger.info("Deployment type : LAMBDA-STYLE (event-driven)")
    logger.info("Phase 1 tool   : Crawl4AI  (open-source, self-hosted)")
    logger.info("Phase 2 tool   : Playwright MCP (open-source)")
    logger.info("Trigger        : POST /trigger")
    logger.info("=" * 55)
    yield
    logger.info("Crawl service shutting down")


app = FastAPI(
    title="Crawl Service",
    description="Lambda-style. Crawl4AI page discovery + Playwright interaction tracing.",
    version="1.0.0",
    lifespan=lifespan,
)


async def _notify(app_id: str, stage: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{DASHBOARD_URL}/api/events", json={
                "app_id": app_id, "stage": stage, "message": message, "level": level
            })
    except Exception:
        pass


async def _run_pipeline(
    job_id: str, app_id: str, app_url: str,
    build_id: str, trigger_type: str, framework_dir: str
):
    _jobs[job_id]["status"] = "running"
    try:
        logger.info(f"Crawl service activated — build {build_id}, framework_dir='{framework_dir}'")

        # Build seed_data.json from Excel (if present) or defaults
        await _notify(app_id, "CRAWL_C4AI", "Preparing seed config...", "INFO")
        seed_data = build_seed(app_id, app_url, framework_dir, SHARED_DIR)
        source = "Excel" if framework_dir else "defaults"
        await _notify(app_id, "CRAWL_C4AI", f"Seed config ready (source: {source})", "INFO")

        out_dir = os.path.join(SHARED_DIR, "outputs", app_id)
        os.makedirs(out_dir, exist_ok=True)

        # Phase 1 — Crawl4AI
        await _notify(app_id, "CRAWL_C4AI", "Phase 1 starting — Crawl4AI page discovery", "INFO")
        _jobs[job_id]["phase"] = "crawl4ai"
        from crawl4ai_phase import discover_pages
        page_inventory = await discover_pages(app_url, app_id, seed_data, DASHBOARD_URL)
        _jobs[job_id]["pages_discovered"] = len(page_inventory)

        # Phase 2 — Playwright
        await _notify(app_id, "CRAWL_PW", "Phase 2 starting — Playwright interaction tracing", "INFO")
        _jobs[job_id]["phase"] = "playwright"
        from playwright_phase import trace_interactions
        traced_pages = await trace_interactions(page_inventory, app_id, seed_data, DASHBOARD_URL)
        _jobs[job_id]["pages_traced"] = len(traced_pages)

        # Merge + write crawl_raw.json
        import json
        from engine import merge_crawl_output
        merged = merge_crawl_output(page_inventory, traced_pages)
        raw_path = os.path.join(out_dir, "crawl_raw.json")
        with open(raw_path, "w") as f:
            json.dump(merged, f, indent=2)

        # Graph build
        _jobs[job_id]["phase"] = "graph_build"
        from graph_builder import build_graph
        graph = await build_graph(raw_path, app_id, DASHBOARD_URL)
        n = graph["meta"]["totalNodes"]
        m = graph["meta"]["totalEdges"]
        _jobs[job_id]["nodes"] = n
        _jobs[job_id]["edges"] = m

        # Diff (UPDATE only)
        if trigger_type == "UPDATE":
            await _notify(app_id, "DIFF", "Running diff...", "INFO")
            _jobs[job_id]["phase"] = "diff"
            diff = run_diff(app_id, SHARED_DIR)
            s = diff["summary"]
            breaking = s["removed"] > 0
            await _notify(
                app_id, "DIFF",
                f"Diff complete — +{s['added']} added, -{s['removed']} removed, ~{s['renamed']} renamed"
                + (" — BREAKING CHANGES DETECTED" if breaking else ""),
                "WARN" if breaking else "SUCCESS",
            )

        # Trigger Generator — forward framework_dir so it writes to the correct Maven project
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"{GENERATOR_URL}/trigger", json={
                "app_id": app_id, "build_id": build_id,
                "trigger_type": trigger_type, "framework_dir": framework_dir,
            })

        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["phase"] = "idle"
        logger.info("Crawl complete — results written — service idle")

    except Exception:
        tb = traceback.format_exc()
        logger.error(f"Crawl job {job_id} failed:\n{tb}")
        await _notify(app_id, "CRAWL_C4AI", f"Crawl failed: {tb[:500]}", "ERROR")
        _jobs[job_id]["status"] = "error"


@app.post("/trigger")
async def trigger(body: dict, background_tasks: BackgroundTasks):
    app_id        = body["app_id"]
    app_url       = body.get("app_url", "")
    build_id      = body.get("build_id", "build-" + uuid.uuid4().hex[:8])
    trigger_type  = body.get("trigger_type", "INITIAL")
    framework_dir = body.get("framework_dir", "")

    job_id = "job-" + uuid.uuid4().hex[:8]
    _jobs[job_id] = {
        "status": "started", "phase": "init",
        "pages_discovered": 0, "pages_traced": 0,
        "nodes": 0, "edges": 0,
    }

    background_tasks.add_task(
        _run_pipeline, job_id, app_id, app_url, build_id, trigger_type, framework_dir
    )
    return {"job_id": job_id, "status": "STARTED"}


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = _jobs.get(job_id, {"status": "not_found"})
    return {"job_id": job_id, **job}


@app.get("/health")
async def health():
    running = any(j.get("status") == "running" for j in _jobs.values())
    return {
        "service":         "crawl",
        "status":          "running" if running else "idle",
        "deployment_type": "lambda-style",
        "phase1_tool":     "crawl4ai",
        "phase2_tool":     "playwright",
        "port":            PORT,
    }
