import json
import os
import re
import logging

logger = logging.getLogger("generator.registry")


def _pascal(s: str) -> str:
    return "".join(w[0].upper() + w[1:] for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)


def _method_name(prefix: str, label: str, el: dict | None = None) -> str:
    # Mirror pom_generator_v2: when uniqueName is set, use label directly (no action prefix)
    if el and el.get("uniqueName"):
        words = re.sub(r"[^a-zA-Z0-9 ]", " ", label).split()
        alpha = [w for w in words if w and not w.isdigit()]
        words = alpha if alpha else words
        if words:
            return words[0].lower() + "".join(w.capitalize() for w in words[1:])
    words = re.sub(r"[^a-zA-Z0-9 ]", " ", label).split()
    if not words:
        return prefix + "Element"
    camel = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return prefix + camel[0].upper() + camel[1:]


def generate_registry(graph_path: str, java_dir: str) -> dict:
    with open(graph_path) as f:
        graph = json.load(f)

    # nodes is a dict keyed by node_id in crawl-ai format
    nodes_dict = graph.get("nodes", {})
    node_map = dict(nodes_dict)  # node_id -> node_data

    edges_by_from = {}
    for e in graph.get("edges", []):
        # crawl-ai uses "from"/"to"; legacy format uses "fromNodeId"/"toNodeId"
        from_id = e.get("from") or e.get("fromNodeId", "")
        edges_by_from.setdefault(from_id, []).append(e)

    def _class_name_for_node(node: dict) -> str:
        from urllib.parse import urlparse
        if node.get("className"):
            cn = node["className"].strip()
            return cn if cn.endswith("Page") else cn + "Page"
        _SKIP = {"error page", "access denied", "page", "untitled", "403", "404", "500", ""}
        node_name = (node.get("nodeName") or "").strip()
        if node_name and node_name.lower() not in _SKIP and len(node_name) <= 80:
            return _pascal(node_name) + "Page"
        heading = (node.get("heading") or "").strip()
        if heading and heading.lower() not in _SKIP and len(heading) <= 80:
            return _pascal(heading) + "Page"
        title = (node.get("title") or "").strip()
        if title.lower() not in _SKIP:
            return _pascal(title) + "Page"
        url = node.get("url", "")
        parsed = urlparse(url)
        ignore = {"en-us", "en-US", "common", "members", "pages", "aspx", ""}
        parts = [p.rsplit(".", 1)[0] for p in parsed.path.strip("/").split("/")
                 if p and p.lower() not in ignore]
        label = " ".join(parts[-2:]) if parts else (parsed.hostname or "Unknown").split(".")[0]
        return _pascal(label) + "Page" if label else "UnknownPage"

    registry = []

    for node_id, node in nodes_dict.items():
        class_name = _class_name_for_node(node)
        my_edges = edges_by_from.get(node_id, [])
        # crawl-ai edges use trigger.elementName as selector key fallback
        edge_sk = {
            (e.get("selectorKey") or e.get("trigger", {}).get("elementName") or e.get("label", "")): e
            for e in my_edges
            if (e.get("selectorKey") or e.get("trigger", {}).get("elementName") or e.get("label"))
        }

        seen_sk = set()
        seen_methods: set = set()
        for elem in node.get("elements", []):
            sk = elem.get("selectorKey") or elem.get("_selector") or elem.get("interactionKey") or ""
            if not sk:
                continue
            label = elem.get("uniqueName") or elem.get("label") or elem.get("name") or sk
            _raw = (elem.get("actionType") or elem.get("elementType") or "").lower()
            if _raw in ("textbox", "textarea", "fill", "input"):
                action = "fill"
            elif _raw in ("select", "combobox"):
                action = "select"
            else:
                action = "click"

            is_nav = sk in edge_sk
            navigates_to = ""
            if is_nav:
                to_nid = edge_sk[sk].get("to") or edge_sk[sk].get("toNodeId", "")
                to_node = node_map.get(to_nid)
                if to_node:
                    navigates_to = _pascal(to_node.get("title", "")) + "Page"

            if sk in edge_sk:
                method_name = _method_name("click", label, el=elem)
                params = []
                ret_type = navigates_to or class_name
                desc = f"clicks the {label} on {class_name} and navigates to {navigates_to}" if navigates_to else f"clicks the {label} on {class_name}"
            elif action == "fill":
                method_name = _method_name("enter", label, el=elem)
                params = [{"name": "value", "type": "String"}]
                ret_type = class_name
                desc = f"fills the {label} on {class_name}"
            elif action == "select":
                method_name = _method_name("select", label, el=elem)
                params = [{"name": "value", "type": "String"}]
                ret_type = class_name
                desc = f"selects the {label} on {class_name}"
            else:
                method_name = _method_name("click", label, el=elem)
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
