import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("crawl-service.seed_builder")


def _find_excel(framework_dir: str) -> str | None:
    """Return the first .xlsx/.xls found under framework_dir/src/main/resources, or None.
    Uses pathlib for cross-platform path handling (Windows and Mac)."""
    if not framework_dir:
        return None
    base = Path(framework_dir).expanduser().resolve() / "src" / "main" / "resources"
    logger.info(f"Looking for Excel in: {base}")
    if not base.is_dir():
        logger.warning(f"Resources dir not found: {base}")
        return None
    for pattern in ("**/*.xlsx", "**/*.xls"):
        matches = sorted(base.glob(pattern))
        if matches:
            logger.info(f"Found Excel file: {matches[0]}")
            return str(matches[0])
    return None


def _read_excel_seed(xlsx_path: str) -> dict:
    """
    Read all key/value rows from the Excel config sheet and return them as-is.
    Sheet must be named 'config' (or be the first/only sheet).
    First row is treated as a header and skipped.
    Every subsequent row with a non-empty key and value is included.
    """
    try:
        import openpyxl
    except ImportError:
        raise ImportError("pip install openpyxl")

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    sheet = wb["config"] if "config" in wb.sheetnames else wb.active
    if sheet is None:
        raise ValueError(f"Excel file has no sheets: {xlsx_path}")

    rows = {}
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if row[0] and row[1]:
            rows[str(row[0]).strip()] = str(row[1]).strip()

    logger.info(f"Excel seed keys loaded: {list(rows.keys())}")
    return rows


def build_seed(app_id: str, app_url: str, framework_dir: str, shared_dir: str) -> dict:
    """
    Build and persist seed_data.json.
    - If an Excel file exists in src/main/resources: load all its key/value pairs.
    - If no Excel: seed contains only appId and appUrl — no form data, no auth fields.
    """
    xlsx = _find_excel(framework_dir) if framework_dir else None

    if xlsx:
        logger.info(f"Building seed from Excel: {xlsx}")
        seed = _read_excel_seed(xlsx)
    else:
        logger.info("No Excel found — seed will contain only appId and appUrl")
        seed = {}

    seed["appId"]  = app_id
    seed["appUrl"] = app_url

    out_path = os.path.join(shared_dir, "config", "seed_data.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(seed, f, indent=2)

    logger.info(f"seed_data.json written to {out_path}")
    return seed
