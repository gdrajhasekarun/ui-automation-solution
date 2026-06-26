"""
POM Generator v2 — multi-tool support.

Supported target_tool values:
  selenium-java      → Java classes (Selenium WebDriver)  [default]
  selenium-csharp    → C# classes  (Selenium WebDriver)
  selenium-python    → Python classes (Selenium WebDriver)
  playwright-js      → JavaScript classes (Playwright)
  playwright-ts      → TypeScript classes (Playwright)
  playwright-python  → Python classes (Playwright)
  cypress-js         → JavaScript classes (Cypress)
  cypress-ts         → TypeScript classes (Cypress)
"""

import json
import logging
import os
import re

from pom_validator import validate_all

logger = logging.getLogger("generator.pom_gen_v2")

HEADER = "// AUTO-GENERATED — DO NOT EDIT\n// Regenerate via POST /v2/trigger\n\n"
HEADER_PY = "# AUTO-GENERATED — DO NOT EDIT\n# Regenerate via POST /v2/trigger\n\n"


# ── Name registry — persists constName/methodName across runs ─────────────────

def _load_name_registry(path: str) -> dict:
    """Load {selectorKey: {constName, methodName}} from disk, or return empty dict."""
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_name_registry(path: str, registry: dict) -> None:
    with open(path, "w") as f:
        json.dump(registry, f, indent=2)


def _pick_method_name(prefix: str, label: str, sk: str, elem: dict,
                      name_registry: dict, seen_methods: dict,
                      computed_base: str | None = None) -> str:
    """Return the stored method name for sk if available, otherwise compute and store a new one.

    Pass computed_base to override _method_name() — used by Python generators that produce
    snake_case names via _snake().
    """
    stored = name_registry.get(sk, {}).get("methodName")
    if stored:
        seen_methods[stored] = seen_methods.get(stored, 0) + 1
        return stored
    base = computed_base if computed_base is not None else _method_name(prefix, label, sk, elem)
    # Preserve separator style: snake_case uses "_N", camelCase uses "N"
    sep = "_" if "_" in base else ""
    if base not in seen_methods:
        name = base
    else:
        count = seen_methods[base] + 1
        while f"{base}{sep}{count}" in seen_methods:
            count += 1
        name = f"{base}{sep}{count}"
    seen_methods[name] = 1
    name_registry.setdefault(sk, {})["methodName"] = name
    return name

# ── Shared helpers (copied from pom_generator.py) ────────────────────────────

def _pascal(s: str) -> str:
    return "".join(w[0].upper() + w[1:] for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)


_GENERIC_LABELS = {"input", "button", "element", "text", "select", "checkbox", "radio", "a", "link", ""}
_INTERNAL_ID_RE = re.compile(r'[0-9a-f]{8}|FormSession|FormItem|PageItem|NavigationButton|__VIEWSTATE', re.IGNORECASE)


def _ascii_ratio(s: str) -> float:
    printable = [c for c in s if not c.isspace()]
    if not printable:
        return 1.0
    return len([c for c in printable if ord(c) < 128 and (c.isalnum() or c in "-_")]) / len(printable)


def _semantic_words(label: str, el: dict | None = None, selector_key: str = "") -> list[str]:
    def clean(s: str) -> list[str]:
        return [w for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w]

    label_words = clean(label)
    label_usable = (
        label_words
        and label.lower() not in _GENERIC_LABELS
        and not _INTERNAL_ID_RE.search(label)
        and _ascii_ratio(label) >= 0.6
        and len(label) <= 60
    )
    if label_usable:
        return label_words[:6]

    if el:
        primary = el.get("primary") or {}
        ptype = primary.get("type", "")
        pval = primary.get("value", "")
        if ptype in ("name", "aria-label") and pval and not _INTERNAL_ID_RE.search(pval):
            words = clean(pval)
            if words:
                return words[:6]
        if ptype == "id" and pval and not _INTERNAL_ID_RE.search(pval) and len(pval) < 40:
            words = clean(pval)
            if words:
                return words[:6]

    sk_words = clean(selector_key)
    return sk_words[:6] if sk_words else ["Element"]


def _method_name(prefix: str, label: str, selector_key: str = "", el: dict | None = None) -> str:
    words = _semantic_words(label, el, selector_key)
    camel = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return prefix + camel[0].upper() + camel[1:]


def _const_name(label: str, el: dict | None = None, selector_key: str = "") -> str:
    words = _semantic_words(label, el, selector_key)
    name = "_".join(w.upper() for w in words)
    if name and name[0].isdigit():
        name = "EL_" + name
    return name


def _sanitise_xpath(xpath: str) -> str:
    m = re.search(r'normalize-space\(\)\s*=\s*["\']([^"\']+)["\']', xpath)
    if m:
        raw_text = m.group(1)
        if "\n" in raw_text or "\r" in raw_text or "\xa0" in raw_text or any(ord(c) > 127 for c in raw_text) or len(raw_text) > 60:
            first_clause = re.split(r'[\n\r\xa0|]', raw_text)[0].strip()
            first_clause = re.sub(r'[^\x20-\x7E]', '', first_clause).strip()
            if first_clause:
                return re.sub(
                    r'normalize-space\(\)\s*=\s*["\'][^"\']+["\']',
                    f'contains(normalize-space(), "{first_clause}")',
                    xpath,
                )
    return xpath


def _parse_locator(selector_key: str) -> tuple[str, str]:
    sk = selector_key.strip()
    if sk.startswith("xpath="):
        return "xpath", _sanitise_xpath(sk[6:])
    if sk.startswith("#") and " " not in sk:
        return "id", sk[1:]
    m = re.match(r'^\[name=["\']?([^"\'>\]]+)["\']?\]$', sk)
    if m:
        return "name", m.group(1)
    return "css", sk


def _class_name_from_node(node: dict) -> str:
    # Prefer LLM-assigned className from the crawler annotation pass
    if node.get("className"):
        cn = node["className"]
        return cn if cn.endswith("Page") else cn + "Page"
    _SKIP_TITLES = {"error page", "access denied", "page", "untitled", "403", "404", "500", ""}
    node_name = (node.get("nodeName") or "").strip()
    if node_name and node_name.lower() not in _SKIP_TITLES and len(node_name) <= 80:
        return _pascal(node_name) + "Page"
    heading = (node.get("heading") or "").strip()
    if heading and heading.lower() not in _SKIP_TITLES and len(heading) <= 80:
        return _pascal(heading) + "Page"
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


# ── Per-tool output directory helper ─────────────────────────────────────────

def output_subdir(target_tool: str) -> str:
    if target_tool == "selenium-java":
        return os.path.join("src", "main", "java", "pages")
    if target_tool == "selenium-csharp":
        return os.path.join("src", "Pages")
    if target_tool in ("selenium-python", "playwright-python"):
        return "pages"
    if target_tool in ("cypress-js", "cypress-ts"):
        return os.path.join("cypress", "pages")
    # playwright-js / playwright-ts
    return os.path.join("src", "pages")


def file_extension(target_tool: str) -> str:
    if target_tool == "selenium-java":
        return ".java"
    if target_tool == "selenium-csharp":
        return ".cs"
    if target_tool in ("selenium-python", "playwright-python"):
        return ".py"
    if target_tool in ("playwright-js", "cypress-js"):
        return ".js"
    return ".ts"


# ── Element extraction helper ─────────────────────────────────────────────────

def _extract_elements(node: dict, node_id: str, graph: dict, name_registry: dict | None = None):
    """Return (elem_consts, edge_targets) for a node.

    elem_consts: list of (const_name, loc_type, loc_val, elem)
    edge_targets: dict of selectorKey → (target_class_name, is_self)
    name_registry: if provided, stored constNames are reused and new ones are written back.
    """
    if name_registry is None:
        name_registry = {}
    raw_nodes = graph.get("nodes", {})
    def _node_class(n: dict) -> str:
        return _class_name_from_node(n)

    if isinstance(raw_nodes, list):
        node_class_map: dict[str, str] = {
            n.get("nodeId", str(i)): _node_class(n)
            for i, n in enumerate(raw_nodes)
        }
    else:
        node_class_map = {
            nid: _node_class(n)
            for nid, n in raw_nodes.items()
        }
    # edges support both raw (from/to) and normalized (fromNodeId/toNodeId) formats
    edges_from = [
        e for e in graph.get("edges", [])
        if (e.get("from") or e.get("fromNodeId")) == node_id
    ]
    # Key by elementId (present on every trigger) so lookup works regardless of selector format
    edge_targets: dict[str, tuple[str, bool]] = {}
    for e in edges_from:
        elem_id = e.get("trigger", {}).get("elementId") or e.get("elementId") or ""
        if not elem_id:
            continue
        to_nid = e.get("to") or e.get("toNodeId") or ""
        edge_targets[elem_id] = (node_class_map.get(to_nid, "UnknownPage"), to_nid == node_id)

    elements = node.get("elements", [])
    trigger_ids: set[str] = {e.get("trigger", {}).get("elementId", "") for e in edges_from}
    seen_sk: dict[str, int] = {}  # sk → index in unique_elements
    unique_elements: list[dict] = []
    for elem in elements:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        if not sk:
            continue
        elem_id = elem.get("id", "")
        if sk in seen_sk:
            if elem_id in trigger_ids:
                unique_elements[seen_sk[sk]] = elem
        else:
            seen_sk[sk] = len(unique_elements)
            unique_elements.append(elem)

    seen_const: set[str] = set()
    # Pre-seed seen_const with stored constNames so new elements don't collide
    for elem in unique_elements:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        stored_cname = name_registry.get(sk, {}).get("constName")
        if stored_cname:
            seen_const.add(stored_cname)

    elem_consts: list[tuple[str, str, str, dict]] = []
    for elem in unique_elements:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        loc_type, loc_val = _parse_locator(sk)
        # Reuse stored constName if available
        stored_cname = name_registry.get(sk, {}).get("constName")
        if stored_cname:
            cname = stored_cname
        else:
            cname = _const_name(label, el=elem, selector_key=sk)
            if cname in seen_const:
                base, counter = cname, 2
                while f"{base}_{counter}" in seen_const:
                    counter += 1
                cname = f"{base}_{counter}"
            seen_const.add(cname)
            name_registry.setdefault(sk, {})["constName"] = cname
        elem_consts.append((cname, loc_type, loc_val, elem))

    return elem_consts, edge_targets


# ── Selenium Java ─────────────────────────────────────────────────────────────

def _generate_java(node: dict, node_id: str, graph: dict, class_name: str,
                   name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    def _java_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    constants_lines = [
        f'    private static final Locator {cname} = new Locator("{loc_type}", "{_java_str(loc_val)}");'
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    assertable = node.get("assertableElements", [])
    constructor_asserts = "\n".join(
        f"        assertVisible({cname});"
        for cname, _, _, elem in elem_consts
        if elem.get("selectorKey") in assertable
    )[:3 * 40]  # max 3

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(driver)"
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    public {ret_type} {mname}() {{\n"
                f"        click({cname});\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _pick_method_name("enter", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        fill({cname}, value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _pick_method_name("select", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        select({cname}, value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    public {class_name} {mname}() {{\n"
                f"        click({cname});\n"
                f"        return this;\n"
                f"    }}"
            )

    return (
        HEADER +
        f"package pages;\n\n"
        f"import base.GlobalTabs;\n"
        f"import base.Locator;\n"
        f"import org.openqa.selenium.WebDriver;\n\n"
        f"public class {class_name} extends GlobalTabs {{\n\n"
        + "\n".join(constants_lines) + "\n\n"
        f"    public {class_name}(WebDriver driver) {{\n"
        f"        super(driver);\n"
        f"{constructor_asserts}\n"
        f"    }}\n\n"
        + "\n\n".join(methods) + "\n}\n"
    )


# ── Selenium C# ───────────────────────────────────────────────────────────────

def _cs_by(loc_type: str, loc_val: str) -> str:
    def _cs_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')
    if loc_type == "id":
        return f'By.Id("{_cs_str(loc_val)}")'
    if loc_type == "name":
        return f'By.Name("{_cs_str(loc_val)}")'
    if loc_type == "xpath":
        return f'By.XPath("{_cs_str(loc_val)}")'
    return f'By.CssSelector("{_cs_str(loc_val)}")'


def _generate_csharp(node: dict, node_id: str, graph: dict, class_name: str,
                     name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    constants_lines = [
        f"        private static readonly By {cname} = {_cs_by(loc_type, loc_val)};"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    def _pascal_method(prefix: str, label: str, sk: str, elem: dict) -> str:
        words = _semantic_words(label, elem, sk)
        return prefix + "".join(w.capitalize() for w in words)

    def _pick_cs(prefix: str, label: str, sk: str, elem: dict) -> str:
        return _pick_method_name(prefix, label, sk, elem, name_registry, seen_methods)

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(driver)"
            mname = _pick_cs("Click", label, sk, elem)
            methods.append(
                f"        public {ret_type} {mname}()\n"
                f"        {{\n"
                f"            Click({cname});\n"
                f"            return {ret_expr};\n"
                f"        }}"
            )
        elif action == "fill":
            mname = _pick_cs("Enter", label, sk, elem)
            methods.append(
                f"        public {class_name} {mname}(string value)\n"
                f"        {{\n"
                f"            Fill({cname}, value);\n"
                f"            return this;\n"
                f"        }}"
            )
        elif action == "select":
            mname = _pick_cs("Select", label, sk, elem)
            methods.append(
                f"        public {class_name} {mname}(string value)\n"
                f"        {{\n"
                f"            Select({cname}, value);\n"
                f"            return this;\n"
                f"        }}"
            )
        else:
            mname = _pick_cs("Click", label, sk, elem)
            methods.append(
                f"        public {class_name} {mname}()\n"
                f"        {{\n"
                f"            Click({cname});\n"
                f"            return this;\n"
                f"        }}"
            )

    return (
        HEADER +
        f"using OpenQA.Selenium;\n"
        f"using Base;\n\n"
        f"namespace Pages\n{{\n"
        f"    public class {class_name} : GlobalTabs\n"
        f"    {{\n"
        + "\n".join(constants_lines) + "\n\n"
        f"        public {class_name}(IWebDriver driver) : base(driver) {{ }}\n\n"
        + "\n\n".join(methods) + "\n"
        f"    }}\n}}\n"
    )


# ── Playwright locator helper ─────────────────────────────────────────────────

def _pw_locator(loc_type: str, loc_val: str) -> str:
    def _js_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'")
    if loc_type == "id":
        return f"'#{_js_str(loc_val)}'"
    if loc_type == "name":
        return f"'[name=\"{_js_str(loc_val)}\"]'"
    if loc_type == "xpath":
        return f"'xpath={_js_str(loc_val)}'"
    return f"'{_js_str(loc_val)}'"


# ── Playwright JS ─────────────────────────────────────────────────────────────

def _generate_playwright_js(node: dict, node_id: str, graph: dict, class_name: str,
                            name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    field_name = lambda cname: cname.lower().replace("_", "")

    constructor_lines = [
        f"        this.{field_name(cname)} = page.locator({_pw_locator(loc_type, loc_val)});"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"
        fname = field_name(cname)

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_expr = "this" if is_self else f"new {target_class}(this.page)"
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}() {{\n"
                f"        await this.{fname}.click();\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _pick_method_name("enter", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}(value) {{\n"
                f"        await this.{fname}.fill(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _pick_method_name("select", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}(value) {{\n"
                f"        await this.{fname}.selectOption(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}() {{\n"
                f"        await this.{fname}.click();\n"
                f"        return this;\n"
                f"    }}"
            )

    has_base = bool(graph.get("globalElements"))
    base_clause = " extends GlobalTabs" if has_base else ""
    base_import = "const { GlobalTabs } = require('./GlobalTabs');\n" if has_base else ""
    super_call = "        super(page);\n" if has_base else ""
    return (
        HEADER +
        base_import +
        f"class {class_name}{base_clause} {{\n"
        f"    constructor(page) {{\n"
        f"{super_call}"
        + "\n".join(constructor_lines) + "\n"
        f"    }}\n\n"
        + "\n\n".join(methods) + "\n"
        f"}}\n\n"
        f"module.exports = {{ {class_name} }};\n"
    )


# ── Playwright TypeScript ─────────────────────────────────────────────────────

def _generate_playwright_ts(node: dict, node_id: str, graph: dict, class_name: str,
                            name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    field_name = lambda cname: cname.lower().replace("_", "")

    # collect unique target classes for imports
    imported_classes: set[str] = set()
    for sk in [elem.get("selectorKey", "") for _, _, _, elem in elem_consts]:
        if sk in edge_targets:
            target_class, is_self = edge_targets[sk]
            if not is_self:
                imported_classes.add(target_class)

    field_declarations = [
        f"    readonly {field_name(cname)}: Locator;"
        for cname, _, _, _ in elem_consts
    ]

    constructor_lines = [
        f"        this.{field_name(cname)} = page.locator({_pw_locator(loc_type, loc_val)});"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"
        fname = field_name(cname)

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(this.page)"
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}(): Promise<{ret_type}> {{\n"
                f"        await this.{fname}.click();\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _pick_method_name("enter", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}(value: string): Promise<this> {{\n"
                f"        await this.{fname}.fill(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _pick_method_name("select", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}(value: string): Promise<this> {{\n"
                f"        await this.{fname}.selectOption(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    async {mname}(): Promise<this> {{\n"
                f"        await this.{fname}.click();\n"
                f"        return this;\n"
                f"    }}"
            )

    has_base = bool(graph.get("globalElements"))
    base_clause = " extends GlobalTabs" if has_base else ""
    base_import = "import { GlobalTabs } from './GlobalTabs';\n" if has_base else ""
    super_call = "        super(page);\n" if has_base else "        this.page = page;\n"
    page_field = "" if has_base else "    readonly page: Page;\n"

    import_lines = "import { Page, Locator } from '@playwright/test';\n"
    if base_import:
        import_lines += base_import
    for cls in sorted(imported_classes):
        import_lines += f"import {{ {cls} }} from './{cls}';\n"

    return (
        HEADER +
        import_lines + "\n"
        f"export class {class_name}{base_clause} {{\n"
        + page_field
        + "\n".join(field_declarations) + "\n\n"
        f"    constructor(page: Page) {{\n"
        + super_call
        + "\n".join(constructor_lines) + "\n"
        f"    }}\n\n"
        + "\n\n".join(methods) + "\n"
        f"}}\n"
    )


# ── Selenium Python ───────────────────────────────────────────────────────────

def _py_locator(loc_type: str, loc_val: str) -> str:
    def _py_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')
    if loc_type == "id":
        return f'By.ID, "{_py_str(loc_val)}"'
    if loc_type == "name":
        return f'By.NAME, "{_py_str(loc_val)}"'
    if loc_type == "xpath":
        return f'By.XPATH, "{_py_str(loc_val)}"'
    return f'By.CSS_SELECTOR, "{_py_str(loc_val)}"'


def _snake(label: str, el: dict | None = None, selector_key: str = "") -> str:
    words = _semantic_words(label, el, selector_key)
    return "_".join(w.lower() for w in words)


def _generate_selenium_python(node: dict, node_id: str, graph: dict, class_name: str,
                              name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    locator_lines = [
        f'    {cname} = ({_py_locator(loc_type, loc_val)})'
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_class = class_name if is_self else target_class
            ret_expr = "self" if is_self else f"{ret_class}(self.driver)"
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self):\n"
                f"        self.driver.find_element(*self.{cname}).click()\n"
                f"        return {ret_expr}"
            )
        elif action == "fill":
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self, value: str):\n"
                f"        self.driver.find_element(*self.{cname}).clear()\n"
                f"        self.driver.find_element(*self.{cname}).send_keys(value)\n"
                f"        return self"
            )
        elif action == "select":
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self, value: str):\n"
                f"        from selenium.webdriver.support.ui import Select\n"
                f"        Select(self.driver.find_element(*self.{cname})).select_by_visible_text(value)\n"
                f"        return self"
            )
        else:
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self):\n"
                f"        self.driver.find_element(*self.{cname}).click()\n"
                f"        return self"
            )

    return (
        HEADER_PY +
        "from selenium.webdriver.common.by import By\n\n\n"
        f"class {class_name}:\n"
        + "\n".join(locator_lines) + "\n\n"
        f"    def __init__(self, driver):\n"
        f"        self.driver = driver\n\n"
        + "\n\n".join(methods) + "\n"
    )


# ── Playwright Python ─────────────────────────────────────────────────────────

def _pw_py_locator(loc_type: str, loc_val: str) -> str:
    def _py_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')
    if loc_type == "id":
        return f'"#{_py_str(loc_val)}"'
    if loc_type == "name":
        return f'"[name=\\"{_py_str(loc_val)}\\"]"'
    if loc_type == "xpath":
        return f'"xpath={_py_str(loc_val)}"'
    return f'"{_py_str(loc_val)}"'


def _generate_playwright_python(node: dict, node_id: str, graph: dict, class_name: str,
                                name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    field_name = lambda cname: cname.lower().replace("_", "")

    constructor_lines = [
        f"        self.{field_name(cname)} = page.locator({_pw_py_locator(loc_type, loc_val)})"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"
        fname = field_name(cname)

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_expr = "self" if is_self else f"{target_class}(self.page)"
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self):\n"
                f"        self.{fname}.click()\n"
                f"        return {ret_expr}"
            )
        elif action == "fill":
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self, value: str):\n"
                f"        self.{fname}.fill(value)\n"
                f"        return self"
            )
        elif action == "select":
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self, value: str):\n"
                f"        self.{fname}.select_option(value)\n"
                f"        return self"
            )
        else:
            mname = _pick_method_name("", "", sk, elem, name_registry, seen_methods, computed_base=_snake(label, elem, sk))
            methods.append(
                f"    def {mname}(self):\n"
                f"        self.{fname}.click()\n"
                f"        return self"
            )

    has_base = bool(graph.get("globalElements"))
    base_import = "from global_tabs import GlobalTabs\n" if has_base else ""
    base_clause = "(GlobalTabs)" if has_base else ""
    super_call = "        super().__init__(page)\n" if has_base else "        self.page = page\n"

    return (
        HEADER_PY +
        "from playwright.sync_api import Page, Locator\n"
        + base_import + "\n\n"
        f"class {class_name}{base_clause}:\n"
        f"    def __init__(self, page: Page):\n"
        + super_call
        + "\n".join(constructor_lines) + "\n\n"
        + "\n\n".join(methods) + "\n"
    )


# ── Cypress JS ────────────────────────────────────────────────────────────────

def _cy_locator(loc_type: str, loc_val: str) -> str:
    def _js_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace("'", "\\'")
    if loc_type == "id":
        return f"'#{_js_str(loc_val)}'"
    if loc_type == "name":
        return f"'[name=\"{_js_str(loc_val)}\"]'"
    if loc_type == "xpath":
        return f"'{_js_str(loc_val)}', {{ xpath: true }}"
    return f"'{_js_str(loc_val)}'"


def _generate_cypress_js(node: dict, node_id: str, graph: dict, class_name: str,
                         name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    getter_lines = [
        f"    get {cname.lower()}() {{ return cy.get({_cy_locator(loc_type, loc_val)}); }}"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"
        getter = cname.lower()

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_expr = "this" if is_self else f"new {target_class}()"
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}() {{\n"
                f"        this.{getter}.click();\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _pick_method_name("enter", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}(value) {{\n"
                f"        this.{getter}.clear().type(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _pick_method_name("select", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}(value) {{\n"
                f"        this.{getter}.select(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}() {{\n"
                f"        this.{getter}.click();\n"
                f"        return this;\n"
                f"    }}"
            )

    has_base = bool(graph.get("globalElements"))
    base_clause = " extends GlobalTabs" if has_base else ""
    base_import = "const { GlobalTabs } = require('./GlobalTabs');\n" if has_base else ""
    return (
        HEADER +
        base_import +
        f"class {class_name}{base_clause} {{\n"
        + "\n".join(getter_lines) + "\n\n"
        + "\n\n".join(methods) + "\n"
        f"}}\n\n"
        f"module.exports = {{ {class_name} }};\n"
    )


# ── Cypress TypeScript ────────────────────────────────────────────────────────

def _generate_cypress_ts(node: dict, node_id: str, graph: dict, class_name: str,
                         name_registry: dict | None = None) -> str:
    if name_registry is None:
        name_registry = {}
    elem_consts, edge_targets = _extract_elements(node, node_id, graph, name_registry)

    getter_lines = [
        f"    get {cname.lower()}(): Cypress.Chainable {{ return cy.get({_cy_locator(loc_type, loc_val)}); }}"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        elem_id = elem.get("id", "")
        elem_type = elem.get("elementType", "")
        action = "fill" if elem_type in ("textbox", "textarea") else \
                 "select" if elem_type in ("select", "combobox") else "click"
        getter = cname.lower()

        if elem_id in edge_targets:
            target_class, is_self = edge_targets[elem_id]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}()"
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}(): {ret_type} {{\n"
                f"        this.{getter}.click();\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _pick_method_name("enter", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}(value: string): this {{\n"
                f"        this.{getter}.clear().type(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _pick_method_name("select", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}(value: string): this {{\n"
                f"        this.{getter}.select(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _pick_method_name("click", label, sk, elem, name_registry, seen_methods)
            methods.append(
                f"    {mname}(): this {{\n"
                f"        this.{getter}.click();\n"
                f"        return this;\n"
                f"    }}"
            )

    has_base = bool(graph.get("globalElements"))
    base_clause = " extends GlobalTabs" if has_base else ""
    base_import = "import { GlobalTabs } from './GlobalTabs';\n" if has_base else ""
    return (
        HEADER +
        base_import +
        f"export class {class_name}{base_clause} {{\n"
        + "\n".join(getter_lines) + "\n\n"
        + "\n\n".join(methods) + "\n"
        f"}}\n"
    )


# ── Reconciliation helpers ────────────────────────────────────────────────────

def _find_existing_file_for_node(output_dir: str, ext: str, elem_consts: list) -> str | None:
    """Return path of an existing file that already covers ≥50% of the node's locator values."""
    if not elem_consts or not os.path.isdir(output_dir):
        return None
    new_locs = {loc_val for _, _, loc_val, _ in elem_consts if loc_val}
    if not new_locs:
        return None
    best_file, best_overlap = None, 0
    for fname in os.listdir(output_dir):
        if not fname.endswith(ext):
            continue
        fpath = os.path.join(output_dir, fname)
        try:
            content = open(fpath).read()
        except Exception:
            continue
        overlap = sum(1 for v in new_locs if v in content)
        if overlap / len(new_locs) >= 0.5 and overlap > best_overlap:
            best_overlap, best_file = overlap, fpath
    return best_file


def _merge_into_existing_java(existing_path: str, new_content: str) -> None:
    """Inject constants and methods from new_content that are absent from existing_path."""
    with open(existing_path) as f:
        existing = f.read()

    # Constants: lines like "    private static final Locator X = ..."
    new_consts = re.findall(r'    private static final Locator [^\n]+;', new_content)
    # Methods: "    public ... { ... }" blocks (non-greedy per method)
    new_methods = re.findall(r'(    public [^\n]+\{[^}]+\})', new_content, re.DOTALL)

    const_additions, method_additions = [], []
    for line in new_consts:
        m = re.search(r'"([^"]+)"', line)
        if m and m.group(1) not in existing:
            const_additions.append(line)
    for block in new_methods:
        m = re.match(r'    public \w+ (\w+)\(', block)
        if m and (m.group(1) + '(') not in existing:
            method_additions.append(block)

    if not const_additions and not method_additions:
        return

    if const_additions:
        constructor_m = re.search(r'    public \w+\(WebDriver driver\)', existing)
        if constructor_m:
            pos = constructor_m.start()
            existing = existing[:pos] + '\n'.join(const_additions) + '\n' + existing[pos:]

    if method_additions:
        last_brace = existing.rfind('\n}')
        if last_brace >= 0:
            existing = existing[:last_brace] + '\n\n' + '\n\n'.join(method_additions) + existing[last_brace:]

    with open(existing_path, 'w') as f:
        f.write(existing)


# ── Public entry point ────────────────────────────────────────────────────────

_GENERATORS = {
    "selenium-java":     (_generate_java,             ".java"),
    "selenium-csharp":   (_generate_csharp,           ".cs"),
    "selenium-python":   (_generate_selenium_python,  ".py"),
    "playwright-js":     (_generate_playwright_js,    ".js"),
    "playwright-ts":     (_generate_playwright_ts,    ".ts"),
    "playwright-python": (_generate_playwright_python, ".py"),
    "cypress-js":        (_generate_cypress_js,       ".js"),
    "cypress-ts":        (_generate_cypress_ts,       ".ts"),
}


def _nodes_iter_from_graph(graph: dict):
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, list):
        return [(n.get("nodeId", str(i)), n) for i, n in enumerate(raw_nodes)]
    return list(raw_nodes.items())


def _hydrate_graph_elements(graph: dict) -> dict:
    """Re-hydrate node.elements from globalElements + ownElements for split-format graphs.
    Safe to call on old-format graphs (no-op if ownElements absent)."""
    global_elements = graph.get("globalElements") or {}
    if not global_elements:
        return graph
    raw_nodes = graph.get("nodes", {})
    nodes_iter = raw_nodes.values() if isinstance(raw_nodes, dict) else raw_nodes
    for node in nodes_iter:
        if "ownElements" in node:
            inherited = [
                global_elements[eid]
                for eid in (node.get("inheritedElementIds") or [])
                if eid in global_elements
            ]
            node["elements"] = inherited + (node.get("ownElements") or [])
    return graph


def _generate_base_page(global_elements: dict, target_tool: str, output_dir: str,
                        name_registry: dict) -> str | None:
    """Generate a BasePage class file from globalElements for the given target_tool.
    Returns the file path written, or None if nothing was generated."""
    if not global_elements:
        return None

    elements = list(global_elements.values())
    fake_node = {"elements": elements}
    fake_graph = {"nodes": {}, "edges": []}
    elem_consts, _ = _extract_elements(fake_node, "__base__", fake_graph, name_registry)
    if not elem_consts:
        return None

    def _java_str(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    if target_tool == "selenium-java":
        constants = "\n".join(
            f'    protected static final Locator {cname} = new Locator("{loc_type}", "{_java_str(loc_val)}");'
            for cname, loc_type, loc_val, _ in elem_consts
        )
        methods = "\n".join(
            f"    public void click{cname}() {{ click({cname}); }}"
            for cname, _, _, _ in elem_consts
        )
        content = (
            HEADER +
            "package base;\n\nimport org.openqa.selenium.WebDriver;\nimport base.BasePage;\n\n"
            "public class GlobalTabs extends BasePage {\n\n"
            f"{constants}\n\n"
            "    public GlobalTabs(WebDriver driver) { super(driver); }\n\n"
            f"{methods}\n"
            "}\n"
        )
        path = os.path.join(output_dir, "GlobalTabs.java")

    elif target_tool == "selenium-csharp":
        constants = "\n".join(
            f"    protected static readonly By {cname} = {_cs_by(loc_type, loc_val)};"
            for cname, loc_type, loc_val, _ in elem_consts
        )
        methods = "\n".join(
            f"    public void Click{cname}() => Click({cname});"
            for cname, _, _, _ in elem_consts
        )
        content = (
            HEADER +
            "using OpenQA.Selenium;\nusing Base;\n\nnamespace Base {\n"
            "    public class GlobalTabs : BasePage {\n\n"
            f"{constants}\n\n"
            "        public GlobalTabs(IWebDriver driver) : base(driver) { }\n\n"
            f"{methods}\n"
            "    }\n}\n"
        )
        path = os.path.join(output_dir, "GlobalTabs.cs")

    elif target_tool == "selenium-python":
        constants = "\n".join(
            f"    {cname} = ({_py_locator(loc_type, loc_val)})"
            for cname, loc_type, loc_val, _ in elem_consts
        )
        methods = "\n".join(
            f"    def click_{cname.lower()}(self):\n        self.click(self.{cname})"
            for cname, _, _, _ in elem_consts
        )
        content = (
            HEADER_PY +
            "from selenium.webdriver.common.by import By\nfrom base_page import BasePage\n\n"
            "class GlobalTabs(BasePage):\n"
            "    def __init__(self, driver):\n"
            "        super().__init__(driver)\n\n"
            f"{constants}\n\n"
            f"{methods}\n"
        )
        path = os.path.join(output_dir, "global_tabs.py")

    elif target_tool in ("playwright-js", "cypress-js"):
        fields = "\n".join(
            f"        this.{cname.lower()} = page.locator({_pw_locator(loc_type, loc_val)});"
            for cname, loc_type, loc_val, _ in elem_consts
        )
        methods = "\n".join(
            f"    async click{cname}() {{ await this.{cname.lower()}.click(); }}"
            for cname, _, _, _ in elem_consts
        )
        content = (
            HEADER +
            "const { BasePage } = require('./BasePage');\n\n"
            "class GlobalTabs extends BasePage {\n"
            "    constructor(page) {\n"
            "        super(page);\n"
            f"{fields}\n"
            "    }\n\n"
            f"{methods}\n"
            "}\n\n"
            "module.exports = { GlobalTabs };\n"
        )
        path = os.path.join(output_dir, "GlobalTabs.js")

    elif target_tool in ("playwright-ts", "cypress-ts"):
        decls = "\n".join(
            f"    readonly {cname.lower()}: import('@playwright/test').Locator;"
            for cname, _, _, _ in elem_consts
        )
        inits = "\n".join(
            f"        this.{cname.lower()} = page.locator({_pw_locator(loc_type, loc_val)});"
            for cname, loc_type, loc_val, _ in elem_consts
        )
        methods = "\n".join(
            f"    async click{cname}(): Promise<void> {{ await this.{cname.lower()}.click(); }}"
            for cname, _, _, _ in elem_consts
        )
        content = (
            HEADER +
            "import { Page } from '@playwright/test';\nimport { BasePage } from './BasePage';\n\n"
            "export class GlobalTabs extends BasePage {\n"
            f"{decls}\n\n"
            "    constructor(page: Page) {\n"
            "        super(page);\n"
            f"{inits}\n"
            "    }\n\n"
            f"{methods}\n"
            "}\n"
        )
        path = os.path.join(output_dir, "GlobalTabs.ts")

    elif target_tool == "playwright-python":
        fields = "\n".join(
            f"        self.{cname.lower()} = page.locator({_pw_py_locator(loc_type, loc_val)})"
            for cname, loc_type, loc_val, _ in elem_consts
        )
        methods = "\n".join(
            f"    def click_{cname.lower()}(self):\n        self.{cname.lower()}.click()"
            for cname, _, _, _ in elem_consts
        )
        content = (
            HEADER_PY +
            "from playwright.sync_api import Page\nfrom base_page import BasePage\n\n"
            "class GlobalTabs(BasePage):\n"
            "    def __init__(self, page: Page):\n"
            "        super().__init__(page)\n"
            f"{fields}\n\n"
            f"{methods}\n"
        )
        path = os.path.join(output_dir, "global_tabs.py")

    else:
        return None

    os.makedirs(output_dir, exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    logger.info(f"Generated GlobalTabs ({target_tool}) — {len(elem_consts)} shared locators → {path}")
    return path


def generate_all_v2(graph_path: str, output_dir: str, target_tool: str = "selenium-java") -> dict:
    if target_tool not in _GENERATORS:
        logger.warning(f"Unknown target_tool '{target_tool}', defaulting to selenium-java")
        target_tool = "selenium-java"

    generate_fn, ext = _GENERATORS[target_tool]

    with open(graph_path) as f:
        graph = json.load(f)

    # Re-hydrate node.elements for split-format graphs (globalElements + ownElements)
    graph = _hydrate_graph_elements(graph)

    # Load persisted name registry so element/method names survive re-runs
    registry_path = os.path.join(os.path.dirname(graph_path), "name_registry.json")
    name_registry = _load_name_registry(registry_path)

    global_elements = graph.get("globalElements") or {}
    has_base_page = bool(global_elements)

    # Generate BasePage from shared elements (globalElements → BasePage class)
    if has_base_page:
        _generate_base_page(global_elements, target_tool, output_dir, name_registry)

    nodes_iter = _nodes_iter_from_graph(graph)

    os.makedirs(output_dir, exist_ok=True)
    written = []
    seen_classes: set[str] = set()

    for node_id, node in nodes_iter:
        # Use ownElements (page-unique elements) for locator generation so inherited ones
        # (already in BasePage) are not redeclared in the page class.
        inherited_ids = set(node.get("inheritedElementIds") or [])
        if inherited_ids:
            page_node = {**node, "elements": [e for e in node.get("elements", []) if e.get("id") not in inherited_ids]}
        else:
            page_node = node

        elements = page_node.get("elements", [])
        if not elements:
            logger.info(f"Skipping {node.get('url', '?')} — no interactable elements")
            continue

        class_name = _class_name_from_node(node)
        if class_name in seen_classes:
            suffix = node_id[-4:]
            class_name = class_name[:-4] + suffix.capitalize() + "Page"
        seen_classes.add(class_name)

        content = generate_fn(page_node, node_id, graph, class_name, name_registry)
        file_path = os.path.join(output_dir, f"{class_name}{ext}")

        # If the target file doesn't exist yet, check whether another file already
        # covers the same page (can happen when duplicate nodes from auth-state
        # variants were merged but the first run had a different class name).
        if not os.path.exists(file_path) and target_tool == "selenium-java":
            probe_consts, _ = _extract_elements(page_node, node_id, graph, {})
            existing_file = _find_existing_file_for_node(output_dir, ext, probe_consts)
            if existing_file:
                _merge_into_existing_java(existing_file, content)
                logger.info(f"Reconciled {class_name} → {os.path.basename(existing_file)} (merged into existing file)")
                written.append({"class": class_name, "path": existing_file, "node_id": node_id, "reconciled": True})
                continue

        with open(file_path, "w") as f:
            f.write(content)
        written.append({"class": class_name, "path": file_path, "node_id": node_id})
        logger.info(f"Generated {class_name}{ext} ({target_tool}) — {len(elements)} elements")

    # Persist name registry so subsequent runs reuse the same names
    _save_name_registry(registry_path, name_registry)

    # Patch className back into graph for dashboard display
    node_to_class = {w["node_id"]: w["class"] for w in written}
    for node_id, node in nodes_iter:
        node["className"] = node_to_class.get(node_id, "")
    with open(graph_path, "w") as f:
        json.dump(graph, f, indent=2)

    validation_failures = validate_all(written) if target_tool == "selenium-java" else {}
    return {"written": written, "count": len(written), "validation_failures": validation_failures}


def update_incrementally_v2(diff_report_path: str, graph_path: str, output_dir: str,
                            target_tool: str) -> dict:
    """Regenerate only pages that have added or renamed elements; leave others untouched."""
    if target_tool not in _GENERATORS:
        target_tool = "selenium-java"

    with open(diff_report_path) as f:
        diff = json.load(f)
    with open(graph_path) as f:
        graph = json.load(f)

    registry_path = os.path.join(os.path.dirname(graph_path), "name_registry.json")
    name_registry = _load_name_registry(registry_path)

    generate_fn, ext = _GENERATORS[target_tool]
    nodes_iter = _nodes_iter_from_graph(graph)

    # Collect selectorKeys that changed
    changed_sks: set[str] = set()
    for item in diff.get("added", []):
        changed_sks.add(item.get("selectorKey", ""))
    for item in diff.get("renamed", []):
        changed_sks.add(item.get("oldSelectorKey", ""))

    if not changed_sks:
        logger.info("update_incrementally_v2: no added/renamed elements — nothing to regenerate")
        return {"written": [], "count": 0}

    # Map changed selectorKeys → node_ids that own them
    changed_node_ids: set[str] = set()
    for node_id, node in nodes_iter:
        for elem in node.get("elements", []):
            sk = elem.get("selectorKey") or elem.get("_selector") or ""
            if sk in changed_sks:
                changed_node_ids.add(node_id)

    os.makedirs(output_dir, exist_ok=True)
    written = []
    seen_classes: set[str] = set()

    for node_id, node in nodes_iter:
        if node_id not in changed_node_ids:
            continue
        elements = node.get("elements", [])
        if not elements:
            continue

        class_name = _class_name_from_node(node)
        if class_name in seen_classes:
            suffix = node_id[-4:]
            class_name = class_name[:-4] + suffix.capitalize() + "Page"
        seen_classes.add(class_name)

        content = generate_fn(node, node_id, graph, class_name, name_registry)
        file_path = os.path.join(output_dir, f"{class_name}{ext}")
        with open(file_path, "w") as f:
            f.write(content)
        written.append({"class": class_name, "path": file_path, "node_id": node_id})
        logger.info(f"Incremental regen: {class_name}{ext} ({len(elements)} elements, {target_tool})")

    _save_name_registry(registry_path, name_registry)

    # Patch className back into graph
    node_to_class = {w["node_id"]: w["class"] for w in written}
    for node_id, node in nodes_iter:
        if node_id in node_to_class:
            node["className"] = node_to_class[node_id]
    with open(graph_path, "w") as f:
        json.dump(graph, f, indent=2)

    return {"written": written, "count": len(written)}
