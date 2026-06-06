import json
import logging
import os
import traceback
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import BackgroundTasks, FastAPI

from config import DASHBOARD_URL, GENERATOR_URL, PORT, SHARED_DIR
from diff_engine import run_diff
from firecrawl_phase import discover_pages
from graph_builder import build_graph
from playwright_phase import trace_interactions

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("crawl-service")

_jobs: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 50)
    logger.info("Crawl service ready — waiting for trigger")
    logger.info("Deployment type: LAMBDA-STYLE (event-driven)")
    logger.info("Trigger: build complete webhook → POST /trigger")
    logger.info("=" * 50)
    yield
    logger.info("Crawl service shutting down")


app = FastAPI(
    title="Crawl Service",
    description="Lambda-style crawl pipeline. Triggered by build complete.",
    version="1.0.0",
    lifespan=lifespan
)


async def _notify(app_id: str, stage: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{DASHBOARD_URL}/api/events", json={
                "app_id": app_id, "stage": stage, "message": message, "level": level
            })
    except Exception:
        pass


async def _run_crawl(job_id: str, app_id: str, app_url: str, build_id: str, trigger_type: str):
    _jobs[job_id]["status"] = "running"
    try:
        await _notify(app_id, "CRAWL_FC", "Crawl service activated", "INFO")

        seed_path = os.path.join(SHARED_DIR, "config", "seed_data.json")
        with open(seed_path) as f:
            seed_data = json.load(f)
        seed_data["appUrl"] = app_url or seed_data.get("appUrl", "")

        out_dir = os.path.join(SHARED_DIR, "outputs", app_id)
        os.makedirs(out_dir, exist_ok=True)

        _jobs[job_id]["phase"] = "firecrawl"
        fc_pages = await discover_pages(app_url, app_id, seed_data, DASHBOARD_URL)
        _jobs[job_id]["pages_found"] = len(fc_pages)

        _jobs[job_id]["phase"] = "playwright"
        pw_pages = await trace_interactions(fc_pages, app_id, seed_data, DASHBOARD_URL)
        _jobs[job_id]["pages_traced"] = len(pw_pages)

        merged = {p["url"]: p for p in fc_pages}
        for p in pw_pages:
            url = p["url"]
            if url in merged:
                merged[url]["elements"] = p.get("elements", merged[url].get("elements", []))
                merged[url]["transitions"] = p.get("transitions", [])
            else:
                merged[url] = p

        raw_path = os.path.join(out_dir, "crawl_raw.json")
        with open(raw_path, "w") as f:
            json.dump(list(merged.values()), f, indent=2)

        _jobs[job_id]["phase"] = "graph_build"
        graph = build_graph(raw_path, app_id)
        await _notify(app_id, "GRAPH", f"Graph built: {graph['meta']['totalNodes']} nodes, {graph['meta']['totalEdges']} edges")

        if trigger_type == "UPDATE":
            _jobs[job_id]["phase"] = "diff"
            diff = run_diff(app_id, SHARED_DIR)
            await _notify(app_id, "DIFF", f"Diff complete: +{diff['summary']['added']} -{diff['summary']['removed']} ~{diff['summary']['renamed']}")

        await _notify(app_id, "CRAWL_DONE", "Crawl complete — triggering generator")

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"{GENERATOR_URL}/trigger", json={"app_id": app_id, "build_id": build_id, "trigger_type": trigger_type})

        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["phase"] = "idle"
        logger.info("Crawl complete — results written — service idle")

    except Exception:
        tb = traceback.format_exc()
        logger.error(f"Crawl job {job_id} failed:\n{tb}")
        await _notify(app_id, "CRAWL_ERROR", f"Crawl failed: {tb[:500]}", "ERROR")
        _jobs[job_id]["status"] = "error"


@app.post("/trigger")
async def trigger(body: dict, background_tasks: BackgroundTasks):
    app_id = body["app_id"]
    app_url = body.get("app_url", "")
    build_id = body.get("build_id", "build-" + uuid.uuid4().hex[:8])
    trigger_type = body.get("trigger_type", "INITIAL")

    job_id = "job-" + uuid.uuid4().hex[:8]
    _jobs[job_id] = {"status": "started", "phase": "init", "pages_found": 0, "pages_traced": 0}

    logger.info(f"Crawl service activated — build {build_id}")
    background_tasks.add_task(_run_crawl, job_id, app_id, app_url, build_id, trigger_type)
    return {"job_id": job_id, "status": "STARTED"}


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = _jobs.get(job_id, {"status": "not_found"})
    return {"job_id": job_id, **job}


@app.get("/health")
async def health():
    running = any(j.get("status") == "running" for j in _jobs.values())
    return {
        "service": "crawl",
        "status": "running" if running else "idle",
        "deployment_type": "lambda-style",
        "port": PORT
    }
