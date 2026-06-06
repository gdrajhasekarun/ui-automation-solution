import json
import os
import re
import logging
from pom_generator import generate_all, _pascal, _method_name, _generate_class, HEADER

logger = logging.getLogger("generator.updater")


def update_incrementally(diff_report_path: str, graph_path: str, java_dir: str, app_id: str) -> dict:
    with open(diff_report_path) as f:
        diff = json.load(f)
    with open(graph_path) as f:
        graph = json.load(f)

    pages_dir = os.path.join(java_dir, "src", "main", "java", "pages")
    os.makedirs(pages_dir, exist_ok=True)

    node_map = {n["nodeId"]: n for n in graph.get("nodes", [])}
    added_classes = []
    added_methods = []
    renamed_methods = []
    needs_review = []

    for item in diff.get("added", []):
        sk = item.get("selectorKey", "")
        # Check if it belongs to a new node
        owning_node = next(
            (n for n in graph["nodes"]
             if any(e.get("selectorKey") == sk for e in n.get("elements", []))),
            None
        )
        if not owning_node:
            continue
        class_name = _pascal(owning_node.get("title", "")) + "Page"
        class_file = os.path.join(pages_dir, f"{class_name}.java")
        if not os.path.exists(class_file):
            content = _generate_class(owning_node, graph)
            with open(class_file, "w") as f:
                f.write(content)
            added_classes.append(class_name)
            logger.info(f"Added new class: {class_name}.java")
        else:
            label = item.get("label", sk)
            action = next(
                (e.get("actionType", "click") for e in owning_node.get("elements", [])
                 if e.get("selectorKey") == sk), "click"
            )
            if action == "fill":
                mname = _method_name("enter", label)
                new_method = (
                    f"\n    public {class_name} {mname}(String value) {{\n"
                    f"        fill(\"{sk}\", value);\n        return this;\n    }}\n"
                )
            elif action == "select":
                mname = _method_name("select", label)
                new_method = (
                    f"\n    public {class_name} {mname}(String value) {{\n"
                    f"        select(\"{sk}\", value);\n        return this;\n    }}\n"
                )
            else:
                mname = _method_name("click", label)
                new_method = (
                    f"\n    public {class_name} {mname}() {{\n"
                    f"        click(\"{sk}\");\n        return this;\n    }}\n"
                )
            with open(class_file, "r") as f:
                content = f.read()
            content = content.rstrip().rstrip("}") + new_method + "}\n"
            with open(class_file, "w") as f:
                f.write(content)
            added_methods.append({"class": class_name, "method": mname})

    for item in diff.get("renamed", []):
        old_sk = item.get("oldSelectorKey", "")
        new_label = item.get("newName", "")
        old_label = item.get("oldName", "")
        for fname in os.listdir(pages_dir):
            if not fname.endswith(".java"):
                continue
            fpath = os.path.join(pages_dir, fname)
            with open(fpath) as f:
                content = f.read()
            for prefix in ["enter", "click", "select"]:
                old_mname = _method_name(prefix, old_label)
                new_mname = _method_name(prefix, new_label)
                if old_mname in content:
                    content = content.replace(old_mname, new_mname)
                    renamed_methods.append({"file": fname, "old": old_mname, "new": new_mname})
            with open(fpath, "w") as f:
                f.write(content)

    for item in diff.get("removed", []):
        needs_review.append({
            "selectorKey": item.get("selectorKey", ""),
            "label": item.get("label", ""),
            "reason": "Element removed in latest crawl"
        })

    return {
        "added_classes": len(added_classes),
        "added_methods": len(added_methods),
        "renamed_methods": len(renamed_methods),
        "removed_flagged": len(needs_review),
        "needs_review": needs_review
    }
