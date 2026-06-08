import json
import os
import re
import logging

from pom_validator import validate_all

logger = logging.getLogger("generator.pom_gen")

HEADER = "// AUTO-GENERATED — DO NOT EDIT\n// Regenerate via POST /trigger\n\n"


def _pascal(s: str) -> str:
    return "".join(w.capitalize() for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)


_GENERIC_LABELS = {"input", "button", "element", "text", "select", "checkbox", "radio", "a", "link", ""}

# ID/selector strings that look like internal system fields rather than semantic names
_INTERNAL_ID_RE = re.compile(r'[0-9a-f]{8}|FormSession|FormItem|PageItem|NavigationButton|__VIEWSTATE', re.IGNORECASE)


def _semantic_words(label: str, el: dict | None = None, selector_key: str = "") -> list[str]:
    """
    Return the most semantic word list for naming a constant or method.
    Priority: label → primary attribute value → selectorKey.
    Falls back gracefully when any source looks like an internal ID.
    """
    def clean(s: str) -> list[str]:
        return [w for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w]

    label_words = clean(label)
    # Label is usable if it's short, non-generic, and has no internal-ID patterns
    if label_words and label.lower() not in _GENERIC_LABELS and not _INTERNAL_ID_RE.search(label):
        return label_words[:6]

    # Try the primary attribute value (e.g. name="dd-country" → ["dd", "country"])
    if el:
        primary = el.get("primary") or {}
        ptype = primary.get("type", "")
        pval = primary.get("value", "")
        if ptype in ("name", "aria-label") and pval and not _INTERNAL_ID_RE.search(pval):
            words = clean(pval)
            if words:
                return words[:6]
        # Try id only if it's a short human-readable slug (not a GUID)
        if ptype == "id" and pval and not _INTERNAL_ID_RE.search(pval) and len(pval) < 40:
            words = clean(pval)
            if words:
                return words[:6]

    # Last resort: selectorKey
    sk_words = clean(selector_key)
    return sk_words[:6] if sk_words else ["Element"]


def _method_name(prefix: str, label: str, selector_key: str = "", el: dict | None = None) -> str:
    words = _semantic_words(label, el, selector_key)
    camel = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return prefix + camel[0].upper() + camel[1:]


def _const_name(label: str, el: dict | None = None, selector_key: str = "") -> str:
    """SCREAMING_SNAKE_CASE constant name — uses the most semantic source available."""
    words = _semantic_words(label, el, selector_key)
    name = "_".join(w.upper() for w in words)
    # Java identifiers cannot start with a digit
    if name and name[0].isdigit():
        name = "EL_" + name
    return name


def _parse_locator(selector_key: str) -> tuple[str, str]:
    """
    Convert a selectorKey string to (type, value) for Locator construction.
      #id            → ("id", "id-value")
      [name="x"]     → ("name", "x")
      [data-testid=] → ("css", full-selector)
      xpath=...      → ("xpath", xpath-expression)
      anything else  → ("css", selector)
    """
    sk = selector_key.strip()
    if sk.startswith("xpath="):
        return "xpath", sk[6:]
    if sk.startswith("#") and " " not in sk:
        return "id", sk[1:]
    # [name="value"] — extract the value so By.name() is used
    m = re.match(r'^\[name=["\']?([^"\'>\]]+)["\']?\]$', sk)
    if m:
        return "name", m.group(1)
    return "css", sk


def _generate_class(node: dict, graph: dict, class_name: str) -> str:
    node_id = node["nodeId"]

    node_class_map: dict[str, str] = {}
    for n in graph.get("nodes", []):
        node_class_map[n["nodeId"]] = _class_name_from_node(n)

    edges_from = [e for e in graph.get("edges", []) if e["fromNodeId"] == node_id]
    edge_targets: dict[str, tuple[str, bool]] = {}
    for e in edges_from:
        to_nid = e["toNodeId"]
        target_class = node_class_map.get(to_nid, "UnknownPage")
        edge_targets[e["selectorKey"]] = (target_class, to_nid == node_id)

    elements = node.get("elements", [])
    assertable = node.get("assertableElements", [])

    # ── Deduplicate elements by selectorKey ──────────────────────────────────
    seen_sk: set[str] = set()
    unique_elements: list[dict] = []
    for elem in elements:
        sk = elem.get("selectorKey", "")
        if sk and sk not in seen_sk:
            seen_sk.add(sk)
            unique_elements.append(elem)

    # ── Build constant name → (type, value, element) map ────────────────────
    # Guard against duplicate constant names (two elements with same label)
    seen_const: set[str] = set()
    elem_consts: list[tuple[str, str, str, dict]] = []  # (const_name, loc_type, loc_val, elem)
    for elem in unique_elements:
        sk = elem.get("selectorKey") or ""
        label = (elem.get("name") or "").strip()
        loc_type, loc_val = _parse_locator(sk)
        cname = _const_name(label, el=elem, selector_key=sk)
        # Resolve collision by appending a disambiguator from the selector
        if cname in seen_const:
            disambig = re.sub(r"[^A-Z0-9]", "", _const_name(sk, selector_key=sk))
            cname = (cname + "_" + disambig) if disambig else cname + "_2"
        seen_const.add(cname)
        elem_consts.append((cname, loc_type, loc_val, elem))

    # ── Locator constants ────────────────────────────────────────────────────
    # Escape backslashes and double-quotes in loc_val for Java string literals
    def _java_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    constants_lines = [
        f'    private static final Locator {cname} = new Locator("{loc_type}", "{_java_str(loc_val)}");'
        for cname, loc_type, loc_val, _ in elem_consts
    ]
    constants_block = "\n".join(constants_lines)

    # ── Constructor asserts ──────────────────────────────────────────────────
    assert_consts = []
    for cname, _, _, elem in elem_consts:
        if elem.get("selectorKey") in assertable:
            assert_consts.append(cname)
    constructor_asserts = "\n".join(
        f"        assertVisible({c});" for c in assert_consts[:3]
    )

    # ── Methods ──────────────────────────────────────────────────────────────
    methods: list[str] = []
    seen_methods: dict[str, int] = {}  # method_name → usage count for dedup

    def _unique_method(base_name: str) -> str:
        if base_name not in seen_methods:
            seen_methods[base_name] = 1
            return base_name
        count = seen_methods[base_name] + 1
        seen_methods[base_name] = count
        return f"{base_name}{count}"

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or ""
        label = (elem.get("name") or "").strip()
        action = elem.get("actionType") or "click"

        if sk in edge_targets:
            target_class, is_self = edge_targets[sk]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(driver)"
            mname = _unique_method(_method_name("click", label, sk, elem))
            methods.append(
                f"    public {ret_type} {mname}() {{\n"
                f"        click({cname});\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _unique_method(_method_name("enter", label, sk, elem))
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        fill({cname}, value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _unique_method(_method_name("select", label, sk, elem))
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        select({cname}, value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _unique_method(_method_name("click", label, sk, elem))
            methods.append(
                f"    public {class_name} {mname}() {{\n"
                f"        click({cname});\n"
                f"        return this;\n"
                f"    }}"
            )

    methods_str = "\n\n".join(methods)
    return (
        HEADER +
        f"package pages;\n\n"
        f"import base.BasePage;\n"
        f"import base.Locator;\n"
        f"import org.openqa.selenium.WebDriver;\n\n"
        f"public class {class_name} extends BasePage {{\n\n"
        f"{constants_block}\n\n"
        f"    public {class_name}(WebDriver driver) {{\n"
        f"        super(driver);\n"
        f"{constructor_asserts}\n"
        f"    }}\n\n"
        f"{methods_str}\n}}\n"
    )


_SKIP_TITLES = {"error page", "access denied", "page", "untitled", "403", "404", "500", ""}


def _class_name_from_node(node: dict) -> str:
    title = (node.get("title") or "").strip()
    if title.lower() not in _SKIP_TITLES:
        return _pascal(title) + "Page"
    from urllib.parse import urlparse
    url = node.get("url", "")
    parsed = urlparse(url)
    ignore = {"en-us", "en-US", "common", "members", "pages", "aspx", ""}
    parts = [p.rsplit(".", 1)[0] for p in parsed.path.strip("/").split("/")
             if p and p.lower() not in ignore]
    label = " ".join(parts[-2:]) if parts else (parsed.hostname or "Unknown").split(".")[0]
    return _pascal(label) + "Page" if label else "UnknownPage"


def generate_all(graph_path: str, output_dir: str) -> dict:
    with open(graph_path) as f:
        graph = json.load(f)

    os.makedirs(output_dir, exist_ok=True)
    written = []
    seen_classes: set[str] = set()

    for node in graph.get("nodes", []):
        elements = node.get("elements", [])
        if not elements:
            logger.info(f"Skipping {node.get('url', '?')} — no interactable elements")
            continue

        class_name = _class_name_from_node(node)
        if class_name in seen_classes:
            suffix = node["nodeId"][-4:]
            class_name = class_name[:-4] + suffix.capitalize() + "Page"
        seen_classes.add(class_name)

        content = _generate_class(node, graph, class_name)
        file_path = os.path.join(output_dir, f"{class_name}.java")
        with open(file_path, "w") as f:
            f.write(content)
        written.append({"class": class_name, "path": file_path, "node_id": node["nodeId"]})
        logger.info(f"Generated {class_name}.java — {len(elements)} elements")

    validation_failures = validate_all(written)
    return {"written": written, "count": len(written), "validation_failures": validation_failures}
