"""
Normalizes test results from Jest (JS/TS) and pytest JSON reports into the
same schema used by surefire_parser.py:

  [{"tc_name": str, "status": "PASSED|FAILED|SKIPPED", "duration_ms": int, "failure_msg": str}]
"""

import json
import os
import logging

logger = logging.getLogger("executor.result_normalizer")


def normalize_jest(report_path: str, run_id: str) -> list[dict]:
    """Parse Jest --json output file into normalized results."""
    if not os.path.exists(report_path):
        logger.warning("Jest report not found: %s", report_path)
        return []
    with open(report_path, encoding="utf-8") as f:
        report = json.load(f)

    results = []
    for suite in report.get("testResults", []):
        for test in suite.get("testResults", []):
            title = test.get("ancestorTitles", [""])[-1] + " > " + test.get("title", "")
            # Extract the base method name (before " [0]" suffix)
            full_title = test.get("fullName", test.get("title", "unknown"))
            method = full_title.split(" [")[0].strip()

            raw_status = test.get("status", "pending")
            if raw_status == "passed":
                status = "PASSED"
            elif raw_status == "failed":
                status = "FAILED"
            else:
                status = "SKIPPED"

            duration_ms = int(test.get("duration") or 0)
            failure_msg = ""
            if status == "FAILED":
                messages = test.get("failureMessages", [])
                failure_msg = messages[0][:500] if messages else ""

            results.append({
                "tc_name": method,
                "status": status,
                "duration_ms": duration_ms,
                "failure_msg": failure_msg,
            })
    return results


def normalize_pytest(report_path: str, run_id: str) -> list[dict]:
    """Parse pytest-json-report output file into normalized results."""
    if not os.path.exists(report_path):
        logger.warning("pytest report not found: %s", report_path)
        return []
    with open(report_path, encoding="utf-8") as f:
        report = json.load(f)

    results = []
    for test in report.get("tests", []):
        node_id = test.get("nodeid", "")
        # Extract function name: path::function[param]  →  function
        method = node_id.split("::")[-1].split("[")[0]

        outcome = test.get("outcome", "skipped")
        if outcome == "passed":
            status = "PASSED"
        elif outcome == "failed":
            status = "FAILED"
        else:
            status = "SKIPPED"

        duration_ms = int((test.get("call", {}).get("duration") or 0) * 1000)
        failure_msg = ""
        if status == "FAILED":
            call = test.get("call", {})
            failure_msg = (call.get("longrepr") or "")[:500]

        results.append({
            "tc_name": method,
            "status": status,
            "duration_ms": duration_ms,
            "failure_msg": failure_msg,
        })
    return results
