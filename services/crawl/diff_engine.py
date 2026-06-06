import json
import os
import shutil
import logging

logger = logging.getLogger("crawl-service.diff")


def _load(path: str) -> dict:
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def run_diff(app_id: str, shared_dir: str = "../../shared") -> dict:
    out_dir = os.path.join(shared_dir, "outputs", app_id)
    graph_path = os.path.join(out_dir, "graph.json")
    prev_path  = os.path.join(out_dir, "graph_previous.json")
    diff_path  = os.path.join(out_dir, "diff_report.json")

    current  = _load(graph_path)
    previous = _load(prev_path)

    def key_map(graph: dict) -> dict:
        result = {}
        for node in graph.get("nodes", []):
            for elem in node.get("elements", []):
                sk = elem.get("selectorKey", "")
                if sk:
                    result[sk] = elem.get("name", sk)
        return result

    curr_keys = key_map(current)
    prev_keys = key_map(previous)

    added   = [{"selectorKey": k, "label": curr_keys[k]} for k in curr_keys if k not in prev_keys]
    removed = [{"selectorKey": k, "label": prev_keys[k]} for k in prev_keys if k not in curr_keys]
    renamed = []

    curr_labels = {v: k for k, v in curr_keys.items()}
    for sk, label in prev_keys.items():
        if sk not in curr_keys and label in curr_labels:
            renamed.append({"oldSelectorKey": sk, "newSelectorKey": curr_labels[label],
                            "oldName": label, "newName": label})

    diff = {"added": added, "removed": removed, "renamed": renamed,
            "summary": {"added": len(added), "removed": len(removed), "renamed": len(renamed)}}

    with open(diff_path, "w") as f:
        json.dump(diff, f, indent=2)

    if os.path.exists(graph_path):
        shutil.copy2(graph_path, prev_path)

    logger.info(f"Diff: +{len(added)} added, -{len(removed)} removed, ~{len(renamed)} renamed")
    return diff
