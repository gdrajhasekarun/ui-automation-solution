import re
import logging
from pathlib import Path

logger = logging.getLogger("generator.validator")

_VALID_LOCATOR_TYPES = {"id", "name", "css", "xpath"}
_JAVA_IDENT = re.compile(r'^[A-Za-z_$][A-Za-z0-9_$]*$')

# Patterns compiled once
_PKG_RE          = re.compile(r'^\s*package\s+[\w.]+\s*;', re.MULTILINE)
_LOCATOR_CONST   = re.compile(r'private\s+static\s+final\s+Locator\s+(\w+)\s*=\s*new\s+Locator\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)')
_METHOD_SIG      = re.compile(r'public\s+(\S+)\s+(\w+)\s*\(([^)]*)\)\s*\{', re.DOTALL)
_RETURN_IN_BLOCK = re.compile(r'\breturn\b')


def _extract_method_body(content: str, brace_pos: int) -> str:
    """Extract text between the opening brace at brace_pos and its matching closing brace."""
    depth = 0
    i = brace_pos
    start = -1
    while i < len(content):
        ch = content[i]
        if ch == '{':
            depth += 1
            if depth == 1:
                start = i + 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return content[start:i]
        i += 1
    return ""


def validate_pom_file(file_path: str) -> list[str]:
    """
    Validate a generated Java POM file structurally.
    Returns a list of human-readable error strings. Empty list means the file looks valid.
    """
    errors: list[str] = []

    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except Exception as e:
        return [f"Cannot read file: {e}"]

    class_name = Path(file_path).stem

    # ── 1. Package declaration ──────────────────────────────────────────────────
    if not _PKG_RE.search(content):
        errors.append("Missing package declaration")

    # ── 2. Class declaration ────────────────────────────────────────────────────
    class_pat = re.compile(
        rf'public\s+class\s+{re.escape(class_name)}\s+extends\s+BasePage\s*\{{'
    )
    if not class_pat.search(content):
        errors.append(f"Missing or malformed class declaration: expected 'public class {class_name} extends BasePage'")

    # ── 3. Constructor ──────────────────────────────────────────────────────────
    ctor_pat = re.compile(
        rf'public\s+{re.escape(class_name)}\s*\(\s*WebDriver\s+\w+\s*\)'
    )
    if not ctor_pat.search(content):
        errors.append(f"Missing WebDriver constructor for {class_name}")

    # ── 4. Balanced braces ──────────────────────────────────────────────────────
    opens  = content.count('{')
    closes = content.count('}')
    if opens != closes:
        errors.append(f"Unbalanced braces: {opens} '{{' vs {closes} '}}'")

    # ── 5. Locator constants ────────────────────────────────────────────────────
    seen_consts: set[str] = set()
    for m in _LOCATOR_CONST.finditer(content):
        const_name = m.group(1)
        loc_type   = m.group(2)
        loc_val    = m.group(3)

        if not _JAVA_IDENT.match(const_name):
            errors.append(f"Invalid constant name: '{const_name}'")

        if const_name in seen_consts:
            errors.append(f"Duplicate constant name: '{const_name}'")
        seen_consts.add(const_name)

        if loc_type not in _VALID_LOCATOR_TYPES:
            errors.append(
                f"Constant '{const_name}': invalid locator type '{loc_type}' "
                f"(valid: {sorted(_VALID_LOCATOR_TYPES)})"
            )

        if not loc_val.strip():
            errors.append(f"Constant '{const_name}': locator value is empty (type='{loc_type}')")

    # ── 6. Methods ──────────────────────────────────────────────────────────────
    seen_methods: set[str] = set()
    for m in _METHOD_SIG.finditer(content):
        ret_type    = m.group(1)
        method_name = m.group(2)

        # Skip constructor
        if method_name == class_name:
            continue

        if not _JAVA_IDENT.match(method_name):
            errors.append(f"Invalid method name: '{method_name}'")

        if method_name in seen_methods:
            errors.append(f"Duplicate method name: '{method_name}'")
        seen_methods.add(method_name)

        # Check return statement in non-void methods
        if ret_type != "void":
            body = _extract_method_body(content, m.end() - 1)
            if not _RETURN_IN_BLOCK.search(body):
                errors.append(f"Method '{method_name}' (return type '{ret_type}') has no return statement")

    return errors


def validate_all(written: list[dict]) -> dict[str, list[str]]:
    """Validate every generated file. Returns {file_path: [errors]} for files that have errors."""
    failures: dict[str, list[str]] = {}
    for entry in written:
        path = entry.get("path", "")
        if not path:
            continue
        errs = validate_pom_file(path)
        if errs:
            failures[path] = errs
            logger.warning(f"Validation failed for {Path(path).name}: {'; '.join(errs)}")
        else:
            logger.debug(f"Validated OK: {Path(path).name}")
    return failures
