"""
Runs Jest tests for the cms-app-crawler-ts framework (via ts-jest) and returns normalized results.
"""

import asyncio
import json
import logging
import os

from result_normalizer import normalize_jest

logger = logging.getLogger("executor.ts_runner")

_REPORT_FILE = "jest-results.json"


async def run(framework_dir: str, run_id: str, app_id: str,
              selected_tests: list[str], test_data: list[dict],
              dashboard_url: str = "", app_url: str = "") -> dict:
    """Write per-method JSON test data, install deps, run ts-jest. Returns {"exit_code", "results"}."""
    install = await asyncio.create_subprocess_exec(
        "npm", "install",
        cwd=framework_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    await install.communicate()

    pw_install = await asyncio.create_subprocess_exec(
        "npx", "playwright", "install", "chromium",
        cwd=framework_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    await pw_install.communicate()

    _write_testdata(framework_dir, test_data)

    report_path = os.path.join(framework_dir, _REPORT_FILE)
    if os.path.exists(report_path):
        os.remove(report_path)

    pattern = "|".join(selected_tests) if selected_tests else "."
    env = {**os.environ, "APP_URL": app_url}
    cmd = [
        "npx", "jest",
        "--testNamePattern", pattern,
        "--json", f"--outputFile={_REPORT_FILE}",
        "--forceExit",
    ]
    logger.info("Running ts-jest: %s in %s", " ".join(cmd), framework_dir)
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=framework_dir, env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await proc.communicate()
    exit_code = proc.returncode or 0
    if stdout:
        logger.info("ts-jest output:\n%s", stdout.decode(errors="replace")[-2000:])

    results = normalize_jest(report_path, run_id)
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
