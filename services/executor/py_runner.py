"""
Runs pytest tests for the cms-app-crawler-py framework and returns normalized results.
"""

import asyncio
import json
import logging
import os

from result_normalizer import normalize_pytest

logger = logging.getLogger("executor.py_runner")

_REPORT_FILE = "pytest-results.json"


async def run(framework_dir: str, run_id: str, app_id: str,
              selected_tests: list[str], test_data: list[dict],
              dashboard_url: str = "", app_url: str = "") -> dict:
    """Write per-method JSON test data, install deps, run pytest. Returns {"exit_code", "results"}."""
    install = await asyncio.create_subprocess_exec(
        "pip", "install", "-q", "-e", ".",
        cwd=framework_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    await install.communicate()

    _write_testdata(framework_dir, test_data)

    report_path = os.path.join(framework_dir, _REPORT_FILE)
    if os.path.exists(report_path):
        os.remove(report_path)

    env = {**os.environ, "APP_URL": app_url}
    cmd = [
        "python", "-m", "pytest",
        "tests/generated/",
        "--json-report", f"--json-report-file={_REPORT_FILE}",
        "--tb=short", "-q",
    ]
    if selected_tests:
        cmd += ["-k", " or ".join(selected_tests)]

    logger.info("Running pytest: %s in %s", " ".join(cmd), framework_dir)
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=framework_dir, env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await proc.communicate()
    exit_code = proc.returncode if proc.returncode is not None else 1
    if stdout:
        logger.info("pytest output:\n%s", stdout.decode(errors="replace")[-2000:])

    results = normalize_pytest(report_path, run_id)
    return {"exit_code": exit_code, "results": results}


def _write_testdata(framework_dir: str, test_data: list[dict]) -> None:
    testdata_dir = os.path.join(framework_dir, "resources", "testdata")
    os.makedirs(testdata_dir, exist_ok=True)
    for entry in test_data:
        method = entry.get("tc_name", "")
        values = entry.get("values", {})
        if not method:
            continue
        out_path = os.path.join(testdata_dir, f"{method}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump([values], f, indent=2)
