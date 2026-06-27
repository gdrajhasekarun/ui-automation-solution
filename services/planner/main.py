import asyncio
import json
import logging
import os
import time
import traceback
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, FastAPI

from config import DASHBOARD_URL, JAVA_DIR, PORT, REPO_ROOT, SHARED_DIR
from excel_reader import load_test_cases
from plan_eval import eval_plan
from step_planner import plan, _build_registry_index, _build_pageref_class_map
from story_parser import parse_story
from test_generator import generate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("planner-service")

_jobs: dict = {}
_app_llm_usage: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 50)
    logger.info("Planner service ready — waiting for test case requests")
    logger.info("Deployment type: ON-DEMAND (serverless-style)")
    logger.info("Trigger: POST /plan/run (called by user via UI)")
    logger.info("=" * 50)
    yield
    logger.info("Planner service shutting down")


app = FastAPI(
    title="Planner Service",
    description="On-demand AI test planner. Triggered by user action.",
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


def _resolve_java_dir(java_dir: str) -> str:
    """Resolve a possibly-relative java_dir against REPO_ROOT so paths like ./cms-app-crawler work."""
    if os.path.isabs(java_dir):
        return java_dir
    return os.path.abspath(os.path.join(REPO_ROOT, java_dir))


async def _run_plan(job_id: str, app_id: str, tc_name: str, description: str, java_dir: str, steps: list = []):
    java_dir = _resolve_java_dir(java_dir)
    _jobs[job_id]["status"] = "running"
    try:
        await _notify(app_id, "PLANNER", f"Planning {tc_name}")

        out_dir = os.path.join(SHARED_DIR, "outputs", app_id)
        graph_path = os.path.join(out_dir, "graph.json")
        reg_path = os.path.join(out_dir, "pom_registry.json")

        with open(graph_path) as f:
            graph = json.load(f)
        with open(reg_path) as f:
            registry = json.load(f)

        result = await plan(tc_name, description, graph, registry, steps)
        confidence = result.get("confidence", 0)
        status = result.get("status", "NEEDS_REVIEW")

        # Deterministic plan eval (no LLM)
        _sk_to_method, _sk_to_class = _build_registry_index(registry)
        _pageref_to_class, _ = _build_pageref_class_map(graph, _sk_to_class)
        result["eval"] = eval_plan(result, graph, registry, _pageref_to_class, _sk_to_method)

        # Accumulate LLM usage per app
        usage = result.pop("llm_usage", {})
        if usage:
            acc = _app_llm_usage.setdefault(app_id, {
                "totalCalls": 0, "totalInputTokens": 0, "totalOutputTokens": 0,
                "totalCostUsd": 0.0, "calls": []
            })
            acc["totalCalls"] += 1
            acc["totalInputTokens"]  += usage.get("inputTokens", 0)
            acc["totalOutputTokens"] += usage.get("outputTokens", 0)
            acc["totalCostUsd"] = round(acc["totalCostUsd"] + usage.get("costUsd", 0.0), 6)
            acc["calls"].append({**usage, "tcName": tc_name, "ts": int(time.time())})

        _jobs[job_id].update({
            "status": "done",
            "tc_name": tc_name,
            "confidence": confidence,
            "planner_status": status,
            "review_reason": result.get("review_reason", ""),
            "parameters": result.get("parameters", []),
            "steps": result.get("steps", []),
            "class_name": result.get("startingClass", ""),
            "method_name": result.get("testMethodName", ""),
            "eval": result.get("eval", {}),
        })

        await _notify(app_id, "PLANNER",
            f"Planning complete — {tc_name} confidence:{confidence:.2f} status:{status}")
        await _notify(app_id, "PLANNER_RESULT", json.dumps({
            "tc_name": tc_name, "status": status, "confidence": confidence,
            "parameters": result.get("parameters", []),
            "steps": result.get("steps", []),
            "review_reason": result.get("review_reason", ""),
            "method_name": result.get("testMethodName", ""),
            "class_name": result.get("startingClass", "").replace("Page","") + "Tests",
            "llm_usage": _app_llm_usage.get(app_id, {}),
            "eval": result.get("eval", {})
        }))
        logger.info(f"Planning complete — {tc_name} confidence:{confidence:.2f} — service idle")

    except Exception:
        tb = traceback.format_exc()
        logger.error(f"Planner job {job_id} failed:\n{tb}")
        await _notify(app_id, "PLANNER", f"Planning failed for {tc_name}: {tb[:300]}", "ERROR")
        _jobs[job_id]["status"] = "error"


@app.post("/story/interpret")
async def story_interpret(body: dict):
    user_story = body.get("user_story", "")
    app_url = body.get("app_url", "")
    result = await parse_story(user_story, app_url)
    return result


@app.post("/plan/load-excel")
async def load_excel(body: dict):
    excel_path = body["excel_path"]
    test_cases = load_test_cases(excel_path)
    return {"test_cases": test_cases}


@app.post("/plan/run")
async def plan_run(body: dict, background_tasks: BackgroundTasks):
    app_id      = body["app_id"]
    tc_name     = body["tc_name"]
    description = body.get("description", "")
    java_dir    = body.get("java_dir", JAVA_DIR)
    steps       = body.get("steps", [])

    job_id = "job-" + uuid.uuid4().hex[:8]
    _jobs[job_id] = {"status": "started", "tc_name": tc_name}

    logger.info(f"Planner activated — planning {tc_name} ({len(steps)} steps)")
    background_tasks.add_task(_run_plan, job_id, app_id, tc_name, description, java_dir, steps)
    return {"job_id": job_id, "status": "STARTED"}


@app.post("/plan/save")
async def plan_save(body: dict):
    app_id   = body.get("app_id", "")
    java_dir = _resolve_java_dir(body.get("java_dir", JAVA_DIR))
    saved: list = []
    for tc in body.get("test_cases", []):
        result      = tc.get("result") or {}
        tc_name     = tc.get("tc_name", "")
        description = (result.get("description") or tc_name) if isinstance(result, dict) else tc_name
        confidence  = result.get("confidence", 0) if isinstance(result, dict) else 0
        status      = "READY"
        file_path   = ""
        if isinstance(result, dict):
            try:
                file_path = generate(result, app_id, java_dir, description, tc_name)
            except Exception as e:
                logger.error(f"generate() failed for {tc_name}: {e}")
        saved.append({
            "tc_name":       tc_name,
            "status":        status,
            "confidence":    confidence,
            "file_path":     file_path,
            "class_name":    result.get("startingClass", "") if isinstance(result, dict) else "",
            "method_name":   result.get("testMethodName", "") if isinstance(result, dict) else "",
            "parameters":    result.get("parameters", []) if isinstance(result, dict) else [],
            "review_reason": "" if isinstance(result, dict) else "",
        })
    return {"status": "ok", "saved": saved}


@app.post("/plan/run-batch")
async def plan_batch(body: dict, background_tasks: BackgroundTasks):
    app_id = body["app_id"]
    excel_path = body["excel_path"]
    java_dir = body.get("java_dir", JAVA_DIR)
    test_cases = load_test_cases(excel_path)

    job_id = "batch-" + uuid.uuid4().hex[:8]
    _jobs[job_id] = {"status": "started", "tc_count": len(test_cases)}

    async def _run_batch():
        for tc in test_cases:
            sub_job = "job-" + uuid.uuid4().hex[:8]
            _jobs[sub_job] = {"status": "started", "tc_name": tc["tc_name"]}
            await _run_plan(sub_job, app_id, tc["tc_name"], tc["description"], java_dir)
            await asyncio.sleep(1)
        _jobs[job_id]["status"] = "done"

    background_tasks.add_task(_run_batch)
    return {"job_id": job_id, "tc_count": len(test_cases), "status": "STARTED"}


@app.get("/plan/usage/{app_id}")
async def plan_usage(app_id: str):
    return _app_llm_usage.get(app_id, {
        "totalCalls": 0, "totalInputTokens": 0, "totalOutputTokens": 0, "totalCostUsd": 0.0, "calls": []
    })


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = _jobs.get(job_id, {"status": "not_found"})
    return {"job_id": job_id, **job}


@app.get("/health")
async def health():
    running = any(j.get("status") == "running" for j in _jobs.values())
    return {
        "service": "planner",
        "status": "running" if running else "idle",
        "deployment_type": "on-demand",
        "port": PORT
    }
