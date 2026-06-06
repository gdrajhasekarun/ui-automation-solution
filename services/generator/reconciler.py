import json
import os
import re
import logging
import httpx

logger = logging.getLogger("generator.reconciler")


def _method_name(prefix: str, label: str) -> str:
    words = re.sub(r"[^a-zA-Z0-9 ]", " ", label).split()
    if not words:
        return prefix + "Element"
    camel = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return prefix + camel[0].upper() + camel[1:]


def run(diff_report_path: str, java_dir: str, dashboard_url: str) -> dict:
    if not os.path.exists(diff_report_path):
        return {"auto_fixed": [], "needs_review": [], "status": "no_diff"}

    with open(diff_report_path) as f:
        diff = json.load(f)

    tests_dir = os.path.join(java_dir, "src", "test", "java", "tests", "generated")
    auto_fixed = []
    needs_review = []

    if not os.path.exists(tests_dir):
        return {"auto_fixed": [], "needs_review": [], "status": "no_tests_dir"}

    test_files = [f for f in os.listdir(tests_dir) if f.endswith(".java")]

    for item in diff.get("renamed", []):
        old_label = item.get("oldName", "")
        new_label = item.get("newName", "")
        for prefix in ["enter", "click", "select"]:
            old_mname = _method_name(prefix, old_label)
            new_mname = _method_name(prefix, new_label)
            pattern = re.compile(r'\.' + re.escape(old_mname) + r'\(')
            for fname in test_files:
                fpath = os.path.join(tests_dir, fname)
                with open(fpath) as f:
                    content = f.read()
                if pattern.search(content):
                    new_content = pattern.sub(f'.{new_mname}(', content)
                    with open(fpath, "w") as f:
                        f.write(new_content)
                    auto_fixed.append({"file": fname, "old": old_mname, "new": new_mname})
                    logger.info(f"Auto-fixed {old_mname} → {new_mname} in {fname}")

    for item in diff.get("removed", []):
        sk = item.get("selectorKey", "")
        label = item.get("label", sk)
        for prefix in ["enter", "click", "select"]:
            mname = _method_name(prefix, label)
            pattern = re.compile(r'\.' + re.escape(mname) + r'\(')
            for fname in test_files:
                fpath = os.path.join(tests_dir, fname)
                with open(fpath) as f:
                    content = f.read()
                if pattern.search(content):
                    entry = {"selectorKey": sk, "method": mname, "file": fname,
                             "reason": "Referenced method was removed in latest crawl"}
                    needs_review.append(entry)
                    try:
                        import httpx as hx
                        hx.post(f"{dashboard_url}/api/events", json={
                            "app_id": "unknown", "stage": "RECONCILER",
                            "message": f"NEEDS_REVIEW: {mname} in {fname} — element removed",
                            "level": "WARN"
                        }, timeout=5)
                    except Exception:
                        pass

    return {"auto_fixed": auto_fixed, "needs_review": needs_review, "status": "done"}
