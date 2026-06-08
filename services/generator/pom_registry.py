import json
import os
import re
import logging

logger = logging.getLogger("generator.registry")


def _pascal(s: str) -> str:
    return "".join(w.capitalize() for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)


def _method_name(prefix: str, label: str) -> str:
    words = re.sub(r"[^a-zA-Z0-9 ]", " ", label).split()
    if not words:
        return prefix + "Element"
    camel = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return prefix + camel[0].upper() + camel[1:]


def generate_registry(graph_path: str, java_dir: str) -> dict:
    with open(graph_path) as f:
        graph = json.load(f)

    node_map = {n["nodeId"]: n for n in graph.get("nodes", [])}
    edges_by_from = {}
    for e in graph.get("edges", []):
        edges_by_from.setdefault(e["fromNodeId"], []).append(e)

    registry = []
    for node in graph.get("nodes", []):
        title = node.get("title", "Page")
        class_name = _pascal(title) + "Page"
        node_id = node["nodeId"]
        my_edges = edges_by_from.get(node_id, [])
        edge_sk = {e["selectorKey"]: e for e in my_edges}

        seen = set()
        for elem in node.get("elements", []):
            sk = elem.get("selectorKey", "")
            if not sk or sk in seen:
                continue
            seen.add(sk)
            label = elem.get("name", sk)
            action = elem.get("actionType", "click")

            is_nav = sk in edge_sk
            navigates_to = ""
            if is_nav:
                to_node = node_map.get(edge_sk[sk]["toNodeId"])
                if to_node:
                    navigates_to = _pascal(to_node.get("title", "")) + "Page"

            if sk in edge_sk:
                method_name = _method_name("click", label)
                params = []
                ret_type = navigates_to or class_name
                desc = f"clicks the {label} on {class_name} and navigates to {navigates_to}" if navigates_to else f"clicks the {label} on {class_name}"
            elif action == "fill":
                method_name = _method_name("enter", label)
                params = [{"name": "value", "type": "String"}]
                ret_type = class_name
                desc = f"fills the {label} on {class_name}"
            elif action == "select":
                method_name = _method_name("select", label)
                params = [{"name": "value", "type": "String"}]
                ret_type = class_name
                desc = f"selects the {label} on {class_name}"
            else:
                method_name = _method_name("click", label)
                params = []
                ret_type = class_name
                desc = f"clicks the {label} on {class_name}"

            registry.append({
                "className":       class_name,
                "methodName":      method_name,
                "selectorKey":     sk,
                "actionType":      action,
                "parameterNames":  [p["name"] for p in params],
                "returnType":      ret_type,
                "isNavigation":    is_nav,
                "navigatesTo":     navigates_to,
                "description":     desc,
                # Rich attribute capture from crawl — used by LLM planner + self-healing
                "allAttributes":   elem.get("allAttributes") or {},
                "selectorFallbacks": elem.get("selectorFallbacks") or [],
            })

    # Primary copy — alongside graph.json for dashboard/API access
    out_dir = os.path.join(os.path.dirname(graph_path))
    reg_path = os.path.join(out_dir, "pom_registry.json")
    with open(reg_path, "w") as f:
        json.dump(registry, f, indent=2)

    # Framework copy — src/main/resources so it's on the classpath at test runtime
    resources_dir = os.path.join(java_dir, "src", "main", "resources")
    os.makedirs(resources_dir, exist_ok=True)
    framework_reg_path = os.path.join(resources_dir, "pom_registry.json")
    with open(framework_reg_path, "w") as f:
        json.dump(registry, f, indent=2)

    logger.info(f"Registry: {len(registry)} methods → {reg_path} + {framework_reg_path}")
    return {"path": reg_path, "count": len(registry), "registry": registry}
