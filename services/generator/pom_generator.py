import json
import os
import re
import logging

logger = logging.getLogger("generator.pom_gen")

HEADER = "// AUTO-GENERATED — DO NOT EDIT\n// Regenerate via POST /trigger\n\n"


def _pascal(s: str) -> str:
    return "".join(w.capitalize() for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)


def _method_name(prefix: str, label: str) -> str:
    words = re.sub(r"[^a-zA-Z0-9 ]", " ", label).split()
    if not words:
        return prefix + "Element"
    camel = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return prefix + camel[0].upper() + camel[1:]


def _generate_class(node: dict, graph: dict) -> str:
    title = node.get("title", "Page")
    class_name = _pascal(title) + "Page"
    node_id = node["nodeId"]

    edges_from = [e for e in graph.get("edges", []) if e["fromNodeId"] == node_id]
    edge_targets = {}
    for e in edges_from:
        to_node = next((n for n in graph["nodes"] if n["nodeId"] == e["toNodeId"]), None)
        if to_node:
            target_class = _pascal(to_node.get("title", "")) + "Page"
            edge_targets[e["selectorKey"]] = (target_class, e["toNodeId"] == node_id)

    assertable = node.get("assertableElements", [])
    constructor_asserts = "\n".join(
        f"        assertVisible(\"{a}\");" for a in assertable[:3]
    )

    methods = []
    seen_keys = set()
    for elem in node.get("elements", []):
        sk = elem.get("selectorKey", "")
        if not sk or sk in seen_keys:
            continue
        seen_keys.add(sk)
        label = elem.get("name", sk)
        action = elem.get("actionType", "click")

        if sk in edge_targets:
            target_class, is_self = edge_targets[sk]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(driver)"
            mname = _method_name("click", label)
            methods.append(
                f"    public {ret_type} {mname}() {{\n"
                f"        click(\"{sk}\");\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _method_name("enter", label)
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        fill(\"{sk}\", value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _method_name("select", label)
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        select(\"{sk}\", value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _method_name("click", label)
            methods.append(
                f"    public {class_name} {mname}() {{\n"
                f"        click(\"{sk}\");\n"
                f"        return this;\n"
                f"    }}"
            )

    methods_str = "\n\n".join(methods)
    return (
        HEADER +
        f"package pages;\n\nimport base.BasePage;\nimport org.openqa.selenium.WebDriver;\n\n"
        f"public class {class_name} extends BasePage {{\n\n"
        f"    public {class_name}(WebDriver driver) {{\n"
        f"        super(driver);\n"
        f"{constructor_asserts}\n"
        f"    }}\n\n"
        f"{methods_str}\n}}\n"
    )


def generate_all(graph_path: str, output_dir: str, app_id: str) -> dict:
    with open(graph_path) as f:
        graph = json.load(f)

    os.makedirs(output_dir, exist_ok=True)
    written = []

    for node in graph.get("nodes", []):
        title = node.get("title", "Page")
        class_name = _pascal(title) + "Page"
        content = _generate_class(node, graph)
        file_path = os.path.join(output_dir, f"{class_name}.java")
        with open(file_path, "w") as f:
            f.write(content)
        written.append({"class": class_name, "path": file_path, "node_id": node["nodeId"]})
        logger.info(f"Generated {class_name}.java")

    return {"written": written, "count": len(written)}
