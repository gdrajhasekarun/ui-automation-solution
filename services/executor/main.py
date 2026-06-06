import asyncio
import logging
import os
import traceback
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, FastAPI

from config import DASHBOARD_URL, JAVA_DIR, PORT
from excel_writer import write as excel_write
from mvn_runner import run as mvn_run
from surefire_parser import parse as surefire_parse
from testng_generator import generate as testng_gen

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("executor-service")

_jobs: dict = {}
_active_runs: int = 0
_run_queue: asyncio.Queue = asyncio.Queue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 50)
    logger.info("Executor service online — ready for test runs")
    logger.info("Deployment type: ALWAYS-ON")
    logger.info("Handling: user story tests + regression runs")
    logger.info("=" * 50)
    yield
    logger.info("Executor service shutting down")


app = FastAPI(
    title="Executor Service",
    description="Always-on test executor. Handles regression + user story runs.",
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


async def _execute(run_id: str, app_id: str, java_dir: str,
                   selected_tests: list[str], test_data: list[dict]):
    global _active_runs
    _active_runs += 1
    _jobs[run_id]["status"] = "running"
    testdata_path = None
    testng_path = None

    try:
        n = len(selected_tests)
        logger.info(f"Executing run {run_id} — {n} test cases selected")
        await _notify(app_id, "EXECUTE", f"Run started — {n} tests")

        testdata_path = excel_write(test_data, java_dir)
        testng_path = testng_gen(selected_tests, java_dir, run_id, app_id)

        mvn_result = await mvn_run(java_dir, run_id, app_id, DASHBOARD_URL)
        exit_code = mvn_result.get("exit_code", 1)

        results = surefire_parse(java_dir, run_id)
        passed = sum(1 for r in results if r["status"] == "PASSED")
        failed = sum(1 for r in results if r["status"] == "FAILED")

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"{DASHBOARD_URL}/api/execute/results", json={
                "run_id": run_id,
                "results": results,
                "mvn_exit_code": exit_code
            })

        _jobs[run_id].update({
            "status": "done",
            "passed": passed,
            "failed": failed,
            "skipped": len(results) - passed - failed,
            "mvn_exit_code": exit_code
        })

        logger.info(f"Run {run_id} complete — {passed} passed, {failed} failed")
        await _notify(app_id, "EXECUTE", f"Run {run_id} complete — {passed} passed, {failed} failed")

    except Exception:
        tb = traceback.format_exc()
        logger.error(f"Executor run {run_id} failed:\n{tb}")
        await _notify(app_id, "EXECUTE", f"Run {run_id} failed: {tb[:300]}", "ERROR")
        _jobs[run_id]["status"] = "error"
    finally:
        _active_runs -= 1
        for path in [testdata_path, testng_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass


@app.post("/execute/run")
async def execute_run(body: dict, background_tasks: BackgroundTasks):
    app_id = body["app_id"]
    run_id = body.get("run_id", "run-" + uuid.uuid4().hex[:8])
    java_dir = body.get("java_dir", JAVA_DIR)
    selected_tests = body.get("selected_tests", [])
    test_data = body.get("test_data", [])

    _jobs[run_id] = {"status": "started", "passed": 0, "failed": 0, "skipped": 0}
    background_tasks.add_task(_execute, run_id, app_id, java_dir, selected_tests, test_data)
    return {"run_id": run_id, "status": "STARTED"}


@app.get("/status/{run_id}")
async def status(run_id: str):
    job = _jobs.get(run_id, {"status": "not_found"})
    return {"run_id": run_id, **job}


@app.get("/health")
async def health():
    return {
        "service": "executor",
        "status": "running" if _active_runs > 0 else "idle",
        "deployment_type": "always-on",
        "active_runs": _active_runs,
        "port": PORT
    }
