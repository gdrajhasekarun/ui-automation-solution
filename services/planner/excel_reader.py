import openpyxl
import logging

logger = logging.getLogger("planner.excel")


def load_test_cases(excel_path: str) -> list[dict]:
    """
    Read test cases from Excel.
    Expected columns: TestCaseName | Description
    Returns: [{ "tc_name": str, "description": str }]
    """
    wb = openpyxl.load_workbook(excel_path)
    sheet = wb.active
    headers = [cell.value for cell in sheet[1]]

    tc_col = next((i for i, h in enumerate(headers) if h and "TestCaseName" in str(h)), None)
    desc_col = next((i for i, h in enumerate(headers) if h and "Description" in str(h)), None)

    if tc_col is None:
        raise ValueError(f"Missing 'TestCaseName' column in {excel_path}")
    if desc_col is None:
        raise ValueError(f"Missing 'Description' column in {excel_path}")

    results = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        tc_name = row[tc_col] if tc_col < len(row) else None
        description = row[desc_col] if desc_col < len(row) else ""
        if tc_name:
            results.append({"tc_name": str(tc_name).strip(), "description": str(description or "").strip()})

    logger.info(f"Loaded {len(results)} test cases from {excel_path}")
    return results
