import os
import xml.etree.ElementTree as ET
import logging
import uuid

logger = logging.getLogger("executor.surefire")


def parse(java_dir: str, run_id: str) -> list[dict]:
    reports_dir = os.path.join(java_dir, "target", "surefire-reports")
    if not os.path.exists(reports_dir):
        logger.warning(f"Surefire reports dir not found: {reports_dir}")
        return []

    results = []
    for fname in os.listdir(reports_dir):
        if not fname.endswith(".xml"):
            continue
        fpath = os.path.join(reports_dir, fname)
        try:
            tree = ET.parse(fpath)
            root = tree.getroot()
            for tc in root.iter("testcase"):
                tc_name = tc.get("name", "unknown")
                duration_ms = int(float(tc.get("time", "0")) * 1000)
                failure = tc.find("failure")
                skipped = tc.find("skipped")
                if failure is not None:
                    status = "FAILED"
                    msg = (failure.get("message", "") + "\n" + (failure.text or ""))[:500]
                elif skipped is not None:
                    status = "SKIPPED"
                    msg = ""
                else:
                    status = "PASSED"
                    msg = ""
                results.append({
                    "result_id": "res-" + uuid.uuid4().hex[:8],
                    "run_id": run_id,
                    "tc_name": tc_name,
                    "status": status,
                    "duration_ms": duration_ms,
                    "failure_msg": msg
                })
        except Exception as e:
            logger.warning(f"Failed to parse {fname}: {e}")

    logger.info(f"Surefire: parsed {len(results)} results for run {run_id}")
    return results
