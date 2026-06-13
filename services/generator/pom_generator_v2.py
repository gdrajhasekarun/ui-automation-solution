"""
POM Generator v2 — multi-tool support.

Supported target_tool values:
  selenium-java    → Java classes (Selenium WebDriver)  [default]
  selenium-csharp  → C# classes  (Selenium WebDriver)
  playwright-js    → JavaScript classes (Playwright)
  playwright-ts    → TypeScript classes (Playwright)
"""

import json
import logging
import os
import re

from pom_validator import validate_all

logger = logging.getLogger("generator.pom_gen_v2")

HEADER = "// AUTO-GENERATED — DO NOT EDIT\n// Regenerate via POST /v2/trigger\n\n"

# ── Shared helpers (copied from pom_generator.py) ────────────────────────────

def _pascal(s: str) -> str:
    return "".join(w.capitalize() for w in re.sub(r"[^a-zA-Z0-9 ]", " ", s).split() if w)


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
    # playwright-js / playwright-ts
    return os.path.join("src", "pages")


def file_extension(target_tool: str) -> str:
    if target_tool == "selenium-java":
        return ".java"
    if target_tool == "selenium-csharp":
        return ".cs"
    if target_tool == "playwright-js":
        return ".js"
    return ".ts"


# ── Element extraction helper ─────────────────────────────────────────────────

def _extract_elements(node: dict, node_id: str, graph: dict):
    """Return (elem_consts, edge_targets) for a node.

    elem_consts: list of (const_name, loc_type, loc_val, elem)
    edge_targets: dict of selectorKey → (target_class_name, is_self)
    """
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, list):
        node_class_map: dict[str, str] = {
            n.get("nodeId", str(i)): (n.get("pageRef") or _class_name_from_node(n))
            for i, n in enumerate(raw_nodes)
        }
    else:
        node_class_map = {
            nid: (n.get("pageRef") or _class_name_from_node(n))
            for nid, n in raw_nodes.items()
        }
    # edges support both raw (from/to) and normalized (fromNodeId/toNodeId) formats
    edges_from = [
        e for e in graph.get("edges", [])
        if (e.get("from") or e.get("fromNodeId")) == node_id
    ]
    edge_targets: dict[str, tuple[str, bool]] = {}
    for e in edges_from:
        sk = e.get("selectorKey") or e.get("trigger", {}).get("elementName") or e.get("label") or ""
        if not sk:
            continue
        to_nid = e.get("to") or e.get("toNodeId") or ""
        edge_targets[sk] = (node_class_map.get(to_nid, "UnknownPage"), to_nid == node_id)

    elements = node.get("elements", [])
    seen_sk: set[str] = set()
    unique_elements: list[dict] = []
    for elem in elements:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        if sk and sk not in seen_sk:
            seen_sk.add(sk)
            unique_elements.append(elem)

    seen_const: set[str] = set()
    elem_consts: list[tuple[str, str, str, dict]] = []
    for elem in unique_elements:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        loc_type, loc_val = _parse_locator(sk)
        cname = _const_name(label, el=elem, selector_key=sk)
        if cname in seen_const:
            base, counter = cname, 2
            while f"{base}_{counter}" in seen_const:
                counter += 1
            cname = f"{base}_{counter}"
        seen_const.add(cname)
        elem_consts.append((cname, loc_type, loc_val, elem))

    return elem_consts, edge_targets


# ── Selenium Java ─────────────────────────────────────────────────────────────

def _generate_java(node: dict, node_id: str, graph: dict, class_name: str) -> str:
    elem_consts, edge_targets = _extract_elements(node, node_id, graph)

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

    def _unique(name: str) -> str:
        if name not in seen_methods:
            seen_methods[name] = 1
            return name
        count = seen_methods[name] + 1
        seen_methods[name] = count
        return f"{name}{count}"

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        action = elem.get("actionType") or "click"

        if sk in edge_targets:
            target_class, is_self = edge_targets[sk]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(driver)"
            mname = _unique(_method_name("click", label, sk, elem))
            methods.append(
                f"    public {ret_type} {mname}() {{\n"
                f"        click({cname});\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _unique(_method_name("enter", label, sk, elem))
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        fill({cname}, value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _unique(_method_name("select", label, sk, elem))
            methods.append(
                f"    public {class_name} {mname}(String value) {{\n"
                f"        select({cname}, value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _unique(_method_name("click", label, sk, elem))
            methods.append(
                f"    public {class_name} {mname}() {{\n"
                f"        click({cname});\n"
                f"        return this;\n"
                f"    }}"
            )

    return (
        HEADER +
        f"package pages;\n\n"
        f"import base.BasePage;\n"
        f"import base.Locator;\n"
        f"import org.openqa.selenium.WebDriver;\n\n"
        f"public class {class_name} extends BasePage {{\n\n"
        + "\n".join(constants_lines) + "\n\n"
        f"    public {class_name}(WebDriver driver) {{\n"
        f"        super(driver);\n"
        f"{constructor_asserts}\n"
        f"    }}\n\n"
        + "\n\n".join(methods) + "\n}}\n"
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


def _generate_csharp(node: dict, node_id: str, graph: dict, class_name: str) -> str:
    elem_consts, edge_targets = _extract_elements(node, node_id, graph)

    constants_lines = [
        f"        private static readonly By {cname} = {_cs_by(loc_type, loc_val)};"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    def _unique(name: str) -> str:
        if name not in seen_methods:
            seen_methods[name] = 1
            return name
        count = seen_methods[name] + 1
        seen_methods[name] = count
        return f"{name}{count}"

    def _pascal_method(prefix: str, label: str, sk: str, elem: dict) -> str:
        words = _semantic_words(label, elem, sk)
        return prefix + "".join(w.capitalize() for w in words)

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        action = elem.get("actionType") or "click"

        if sk in edge_targets:
            target_class, is_self = edge_targets[sk]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(driver)"
            mname = _unique(_pascal_method("Click", label, sk, elem))
            methods.append(
                f"        public {ret_type} {mname}()\n"
                f"        {{\n"
                f"            Click({cname});\n"
                f"            return {ret_expr};\n"
                f"        }}"
            )
        elif action == "fill":
            mname = _unique(_pascal_method("Enter", label, sk, elem))
            methods.append(
                f"        public {class_name} {mname}(string value)\n"
                f"        {{\n"
                f"            Fill({cname}, value);\n"
                f"            return this;\n"
                f"        }}"
            )
        elif action == "select":
            mname = _unique(_pascal_method("Select", label, sk, elem))
            methods.append(
                f"        public {class_name} {mname}(string value)\n"
                f"        {{\n"
                f"            Select({cname}, value);\n"
                f"            return this;\n"
                f"        }}"
            )
        else:
            mname = _unique(_pascal_method("Click", label, sk, elem))
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
        f"    public class {class_name} : BasePage\n"
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

def _generate_playwright_js(node: dict, node_id: str, graph: dict, class_name: str) -> str:
    elem_consts, edge_targets = _extract_elements(node, node_id, graph)

    field_name = lambda cname: cname.lower().replace("_", "")

    constructor_lines = [
        f"        this.{field_name(cname)} = page.locator({_pw_locator(loc_type, loc_val)});"
        for cname, loc_type, loc_val, _ in elem_consts
    ]

    methods: list[str] = []
    seen_methods: dict[str, int] = {}

    def _unique(name: str) -> str:
        if name not in seen_methods:
            seen_methods[name] = 1
            return name
        count = seen_methods[name] + 1
        seen_methods[name] = count
        return f"{name}{count}"

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        action = elem.get("actionType") or "click"
        fname = field_name(cname)

        if sk in edge_targets:
            target_class, _ = edge_targets[sk]
            mname = _unique(_method_name("click", label, sk, elem))
            methods.append(
                f"    async {mname}() {{\n"
                f"        await this.{fname}.click();\n"
                f"        return new {target_class}(this.page);\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _unique(_method_name("enter", label, sk, elem))
            methods.append(
                f"    async {mname}(value) {{\n"
                f"        await this.{fname}.fill(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _unique(_method_name("select", label, sk, elem))
            methods.append(
                f"    async {mname}(value) {{\n"
                f"        await this.{fname}.selectOption(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _unique(_method_name("click", label, sk, elem))
            methods.append(
                f"    async {mname}() {{\n"
                f"        await this.{fname}.click();\n"
                f"        return this;\n"
                f"    }}"
            )

    return (
        HEADER +
        f"class {class_name} {{\n"
        f"    constructor(page) {{\n"
        f"        this.page = page;\n"
        + "\n".join(constructor_lines) + "\n"
        f"    }}\n\n"
        + "\n\n".join(methods) + "\n"
        f"}}\n\n"
        f"module.exports = {{ {class_name} }};\n"
    )


# ── Playwright TypeScript ─────────────────────────────────────────────────────

def _generate_playwright_ts(node: dict, node_id: str, graph: dict, class_name: str) -> str:
    elem_consts, edge_targets = _extract_elements(node, node_id, graph)

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

    def _unique(name: str) -> str:
        if name not in seen_methods:
            seen_methods[name] = 1
            return name
        count = seen_methods[name] + 1
        seen_methods[name] = count
        return f"{name}{count}"

    for cname, _, _, elem in elem_consts:
        sk = elem.get("selectorKey") or elem.get("_selector") or ""
        label = (elem.get("label") or elem.get("name") or "").strip()
        action = elem.get("actionType") or "click"
        fname = field_name(cname)

        if sk in edge_targets:
            target_class, is_self = edge_targets[sk]
            ret_type = class_name if is_self else target_class
            ret_expr = "this" if is_self else f"new {target_class}(this.page)"
            mname = _unique(_method_name("click", label, sk, elem))
            methods.append(
                f"    async {mname}(): Promise<{ret_type}> {{\n"
                f"        await this.{fname}.click();\n"
                f"        return {ret_expr};\n"
                f"    }}"
            )
        elif action == "fill":
            mname = _unique(_method_name("enter", label, sk, elem))
            methods.append(
                f"    async {mname}(value: string): Promise<this> {{\n"
                f"        await this.{fname}.fill(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        elif action == "select":
            mname = _unique(_method_name("select", label, sk, elem))
            methods.append(
                f"    async {mname}(value: string): Promise<this> {{\n"
                f"        await this.{fname}.selectOption(value);\n"
                f"        return this;\n"
                f"    }}"
            )
        else:
            mname = _unique(_method_name("click", label, sk, elem))
            methods.append(
                f"    async {mname}(): Promise<this> {{\n"
                f"        await this.{fname}.click();\n"
                f"        return this;\n"
                f"    }}"
            )

    import_lines = "import { Page, Locator } from '@playwright/test';\n"
    for cls in sorted(imported_classes):
        import_lines += f"import {{ {cls} }} from './{cls}';\n"

    return (
        HEADER +
        import_lines + "\n"
        f"export class {class_name} {{\n"
        f"    readonly page: Page;\n"
        + "\n".join(field_declarations) + "\n\n"
        f"    constructor(page: Page) {{\n"
        f"        this.page = page;\n"
        + "\n".join(constructor_lines) + "\n"
        f"    }}\n\n"
        + "\n\n".join(methods) + "\n"
        f"}}\n"
    )


# ── Public entry point ────────────────────────────────────────────────────────

_GENERATORS = {
    "selenium-java":   (_generate_java,          ".java"),
    "selenium-csharp": (_generate_csharp,        ".cs"),
    "playwright-js":   (_generate_playwright_js,  ".js"),
    "playwright-ts":   (_generate_playwright_ts,  ".ts"),
}


def generate_all_v2(graph_path: str, output_dir: str, target_tool: str = "selenium-java") -> dict:
    if target_tool not in _GENERATORS:
        raise ValueError(f"Unknown target_tool '{target_tool}'. Valid: {list(_GENERATORS)}")

    generate_fn, ext = _GENERATORS[target_tool]

    with open(graph_path) as f:
        graph = json.load(f)

    # Support both dict-format nodes (app-graph-crawler) and list-format (crawl-ai)
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, list):
        nodes_iter = [(n.get("nodeId", str(i)), n) for i, n in enumerate(raw_nodes)]
    else:
        nodes_iter = list(raw_nodes.items())

    os.makedirs(output_dir, exist_ok=True)
    written = []
    seen_classes: set[str] = set()

    for node_id, node in nodes_iter:
        elements = node.get("elements", [])
        if not elements:
            logger.info(f"Skipping {node.get('url', '?')} — no interactable elements")
            continue

        class_name = node.get("pageRef") or _class_name_from_node(node)
        if class_name in seen_classes:
            suffix = node_id[-4:]
            class_name = class_name[:-4] + suffix.capitalize() + "Page"
        seen_classes.add(class_name)

        content = generate_fn(node, node_id, graph, class_name)
        file_path = os.path.join(output_dir, f"{class_name}{ext}")
        with open(file_path, "w") as f:
            f.write(content)
        written.append({"class": class_name, "path": file_path, "node_id": node_id})
        logger.info(f"Generated {class_name}{ext} ({target_tool}) — {len(elements)} elements")

    # Patch className back into graph for dashboard display
    node_to_class = {w["node_id"]: w["class"] for w in written}
    for node_id, node in nodes_iter:
        node["className"] = node_to_class.get(node_id, "")
    with open(graph_path, "w") as f:
        json.dump(graph, f, indent=2)

    validation_failures = validate_all(written) if target_tool == "selenium-java" else {}
    return {"written": written, "count": len(written), "validation_failures": validation_failures}
