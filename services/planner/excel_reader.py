from __future__ import annotations
import openpyxl
import logging

logger = logging.getLogger("planner.excel")


def _find_col(norm: list[str], *keywords: str, exclude: int | None = None) -> int | None:
    for i, h in enumerate(norm):
        if i == exclude:
            continue
        if any(kw in h for kw in keywords):
            return i
    return None


def load_test_cases(excel_path: str) -> list[dict]:
    """
    Read test cases from Excel. Handles multi-row test cases where steps occupy
    additional rows with a blank Test Case Name cell.

    Flexible column matching (case-insensitive, spaces/underscores stripped):
      - Test Case Name column: matches 'testcasename', 'testcase', 'tcname', 'name'
      - Description column: matches 'description', 'desc'
      - Steps column (optional): matches 'step'
      - Expected Result column (optional): matches 'expected', 'result'

    Returns: [{ "tc_name": str, "description": str, "steps": [...] }]
    """
    wb = openpyxl.load_workbook(excel_path)
    sheet = wb.active or wb.worksheets[0]
    raw_headers = [cell.value for cell in sheet[1]]
    norm = [str(h).replace(" ", "").replace("_", "").lower() if h else "" for h in raw_headers]

    # Prefer exact match on 'testcasename' before broader terms to avoid matching 'testcaseid'
    tc_col = _find_col(norm, "testcasename", "tcname")
    if tc_col is None:
        tc_col = _find_col(norm, "testcase")
    if tc_col is None:
        tc_col = _find_col(norm, "name")
    desc_col = _find_col(norm, "description", "desc", "summary", "objective", "detail", exclude=tc_col)
    steps_col = _find_col(norm, "step", "action")
    exp_col   = _find_col(norm, "expected", "result")

    if tc_col is None:
        raise ValueError(
            f"Could not find a Test Case Name column in {excel_path}. "
            f"Headers found: {[h for h in raw_headers if h]}"
        )
    if desc_col is None:
        raise ValueError(
            f"Could not find a Description column in {excel_path}. "
            f"Headers found: {[h for h in raw_headers if h]}"
        )

    results: list[dict] = []
    current: dict | None = None

    for row in sheet.iter_rows(min_row=2, values_only=True):
        def cell(idx: int | None) -> str:
            if idx is None or idx >= len(row):
                return ""
            return str(row[idx]).strip() if row[idx] is not None else ""

        tc_name = cell(tc_col)
        if tc_name:
            # New test case row
            current = {
                "tc_name": tc_name,
                "description": cell(desc_col),
                "steps": [],
            }
            results.append(current)

        if current is None:
            continue

        # Accumulate step rows (including the first row if it has step data)
        step_text = cell(steps_col)
        exp_text  = cell(exp_col)
        if step_text or exp_text:
            step_num = cell(3) if len(row) > 3 else ""  # '#' column is typically index 3
            entry = {"step": step_text, "expected": exp_text}
            if step_num:
                entry["number"] = step_num
            current["steps"].append(entry)

    logger.info(f"Loaded {len(results)} test cases from {excel_path}")
    return results
