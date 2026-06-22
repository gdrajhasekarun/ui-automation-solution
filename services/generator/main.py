import logging
import os
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, FastAPI

from config import DASHBOARD_URL, JAVA_DIR, PORT, REPO_ROOT, SHARED_DIR
from pom_generator_v2 import generate_all_v2, update_incrementally_v2, output_subdir, file_extension

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


async def _run_generation_v2(job_id: str, app_id: str, trigger_type: str, framework_dir: str, target_tool: str):
    _jobs[job_id]["status"] = "running"
    try:
        await _notify(app_id, "GENERATOR", f"Generator v2 activated — {target_tool} for {app_id}")

        raw_dir = framework_dir if framework_dir else JAVA_DIR
        base_dir = raw_dir if os.path.isabs(raw_dir) else os.path.join(REPO_ROOT, raw_dir.lstrip("./\\"))
        out_dir = os.path.join(SHARED_DIR, "outputs", app_id)
        graph_path = os.path.join(out_dir, "graph.json")
        diff_path = os.path.join(out_dir, "diff_report.json")
        pages_dir = os.path.join(base_dir, output_subdir(target_tool))
        logger.info(f"v2 generator — tool={target_tool} framework_dir='{framework_dir}' → pages_dir='{pages_dir}'")

        if trigger_type != "INITIAL" and os.path.exists(diff_path):
            await _notify(app_id, "GENERATOR", "Incremental mode — regenerating only changed pages")
            result = update_incrementally_v2(diff_path, graph_path, pages_dir, target_tool)
        else:
            result = generate_all_v2(graph_path, pages_dir, target_tool)
        _jobs[job_id]["classes_written"] = result.get("count", 0)

        validation_failures: dict = result.get("validation_failures", {})
        if validation_failures:
            total_errors = sum(len(v) for v in validation_failures.values())
            bad_files = ", ".join(os.path.basename(p) for p in validation_failures)
            await _notify(app_id, "GENERATOR",
                f"Validation: {total_errors} issue(s) in {len(validation_failures)} file(s): {bad_files}", "WARN")

        ext = file_extension(target_tool)
        await _notify(app_id, "GENERATOR",
            f"Generation complete — {_jobs[job_id]['classes_written']} {ext} classes ({target_tool})",
            "SUCCESS")
        _jobs[job_id]["status"] = "done"
        logger.info(f"v2 generation complete — {_jobs[job_id]['classes_written']} classes")

    except Exception:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"Generator v2 job {job_id} failed:\n{tb}")
        await _notify(app_id, "GENERATOR", f"Generation failed: {tb[:500]}", "ERROR")
        _jobs[job_id]["status"] = "error"


@app.post("/trigger")
async def trigger(body: dict, background_tasks: BackgroundTasks):
    app_id = body["app_id"]
    trigger_type = body.get("trigger_type", "INITIAL")
    target_tool = body.get("target_tool", "selenium-java")
    framework_dir = body.get("framework_dir", "")

    job_id = "job-" + uuid.uuid4().hex[:8]
    _jobs[job_id] = {"status": "started", "classes_written": 0, "target_tool": target_tool}

    logger.info(f"Generator triggered — app_id={app_id} target_tool={target_tool} framework_dir='{framework_dir}'")
    background_tasks.add_task(_run_generation_v2, job_id, app_id, trigger_type, framework_dir, target_tool)
    return {"job_id": job_id, "status": "STARTED", "target_tool": target_tool}


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
