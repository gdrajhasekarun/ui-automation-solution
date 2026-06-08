import logging
import os
import traceback
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, FastAPI

from config import DASHBOARD_URL, JAVA_DIR, PORT, REPO_ROOT, SHARED_DIR
from pom_generator import generate_all
from pom_registry import generate_registry
from pom_updater import update_incrementally
from reconciler import run as reconciler_run

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("generator-service")

_jobs: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("=" * 50)
    logger.info("Generator service ready — waiting for crawl completion")
    logger.info("Deployment type: LAMBDA-STYLE (event-driven)")
    logger.info("Trigger: crawl complete → POST /trigger")
    logger.info("=" * 50)
    yield
    logger.info("Generator service shutting down")


app = FastAPI(
    title="Generator Service",
    description="Lambda-style POM generator. Triggered by crawl complete.",
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


async def _run_generation(job_id: str, app_id: str, trigger_type: str, framework_dir: str):
    _jobs[job_id]["status"] = "running"
    try:
        await _notify(app_id, "GENERATOR", f"Generator service activated — processing graph for {app_id}")

        # Resolve framework_dir: if relative, anchor to repo root (not service CWD)
        raw_dir = framework_dir if framework_dir else JAVA_DIR
        java_dir = raw_dir if os.path.isabs(raw_dir) else os.path.join(REPO_ROOT, raw_dir.lstrip("./\\"))
        out_dir = os.path.join(SHARED_DIR, "outputs", app_id)
        graph_path = os.path.join(out_dir, "graph.json")
        diff_path = os.path.join(out_dir, "diff_report.json")
        pages_dir = os.path.join(java_dir, "src", "main", "java", "pages")
        logger.info(f"framework_dir received='{framework_dir}' → resolved pages_dir='{pages_dir}'")

        if trigger_type == "INITIAL" or not os.path.exists(diff_path):
            result = generate_all(graph_path, pages_dir)
        else:
            result = update_incrementally(diff_path, graph_path, java_dir, app_id)

        _jobs[job_id]["classes_written"] = result.get("count", result.get("added_classes", 0))

        # Report validation issues per file before proceeding
        validation_failures: dict = result.get("validation_failures", {})
        if validation_failures:
            total_errors = sum(len(v) for v in validation_failures.values())
            bad_files = ", ".join(os.path.basename(p) for p in validation_failures)
            await _notify(app_id, "GENERATOR",
                f"Validation: {total_errors} issue(s) in {len(validation_failures)} file(s): {bad_files}", "WARN")
            for fpath, errs in validation_failures.items():
                for err in errs:
                    await _notify(app_id, "GENERATOR", f"  {os.path.basename(fpath)}: {err}", "WARN")

        reg = generate_registry(graph_path, java_dir)
        _jobs[job_id]["methods_written"] = reg["count"]

        recon = reconciler_run(diff_path, java_dir, DASHBOARD_URL)
        needs_review_count = len(recon.get("needs_review", []))
        _jobs[job_id]["needs_review_count"] = needs_review_count

        valid_tag = f", {len(validation_failures)} file(s) with validation issues" if validation_failures else ""
        await _notify(app_id, "GENERATOR",
            f"Generation complete — {_jobs[job_id]['classes_written']} classes, "
            f"{reg['count']} methods, {needs_review_count} need review{valid_tag}",
            "SUCCESS")

        _jobs[job_id]["status"] = "done"
        logger.info(f"Generation complete — {_jobs[job_id]['classes_written']} classes — service idle")

    except Exception:
        tb = traceback.format_exc()
        logger.error(f"Generator job {job_id} failed:\n{tb}")
        await _notify(app_id, "GENERATOR", f"Generation failed: {tb[:500]}", "ERROR")
        _jobs[job_id]["status"] = "error"


@app.post("/trigger")
async def trigger(body: dict, background_tasks: BackgroundTasks):
    app_id = body["app_id"]
    trigger_type = body.get("trigger_type", "INITIAL")

    job_id = "job-" + uuid.uuid4().hex[:8]
    _jobs[job_id] = {"status": "started", "classes_written": 0, "methods_written": 0, "needs_review_count": 0}

    framework_dir = body.get("framework_dir", "")
    logger.info(f"Generator triggered — app_id={app_id} framework_dir='{framework_dir}'")
    background_tasks.add_task(_run_generation, job_id, app_id, trigger_type, framework_dir)
    return {"job_id": job_id, "status": "STARTED"}


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = _jobs.get(job_id, {"status": "not_found"})
    return {"job_id": job_id, **job}


@app.get("/health")
async def health():
    running = any(j.get("status") == "running" for j in _jobs.values())
    return {
        "service": "generator",
        "status": "running" if running else "idle",
        "deployment_type": "lambda-style",
        "port": PORT
    }
