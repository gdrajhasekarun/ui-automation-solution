import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("crawl-service.seed_builder")


def _resolve_framework_dir(framework_dir: str) -> str | None:
    """
    Resolve framework_dir to an absolute path that exists on disk.
    1. Absolute path — use as-is
    2. Relative path — try repo root first (services/crawl is 2 levels deep), then cwd
    """
    if not framework_dir:
        return None
    raw = framework_dir.strip().strip('"').strip("'")

    # 1) Absolute path
    abs_path = Path(raw).expanduser().resolve()
    if abs_path.is_dir():
        return str(abs_path)

    # 2) Repo root (services/crawl/seed_builder.py → up 2 levels)
    repo_root = Path(__file__).parent.parent.parent.resolve()
    repo_path = (repo_root / raw).resolve()
    if repo_path.is_dir():
        logger.info(f"Resolved '{raw}' from repo root: {repo_path}")
        return str(repo_path)

    # 3) Current working directory
    cwd_path = (Path.cwd() / raw).resolve()
    if cwd_path.is_dir():
        logger.info(f"Resolved '{raw}' from cwd: {cwd_path}")
        return str(cwd_path)

    logger.warning(f"framework_dir '{raw}' could not be resolved (tried absolute, repo root, cwd)")
    return None


def _find_excel(framework_dir: str) -> str | None:
    """Return the first .xlsx/.xls found under framework_dir/src/main/resources, or None."""
    resolved = _resolve_framework_dir(framework_dir)
    if not resolved:
        return None
    base = Path(resolved) / "src" / "main" / "resources"
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
    Build and persist seed_data.json using a merge strategy (low → high priority):
      1. Existing shared/config/seed_data.json  — committed base (auth, blocklist, etc.)
      2. Excel flat key/values, if found         — overrides individual keys
      3. Runtime app_id / app_url               — always win
    This preserves the auth block across runs even when no Excel is present.
    """
    out_path = os.path.join(shared_dir, "config", "seed_data.json")

    # 1) Load committed base
    seed: dict = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as f:
                seed = json.load(f)
            logger.info("Loaded existing seed_data.json as base")
        except Exception as e:
            logger.warning(f"Could not parse existing seed_data.json — starting empty: {e}")

    # 2) Merge Excel flat key/values on top (shallow merge at top level)
    xlsx = _find_excel(framework_dir) if framework_dir else None
    if xlsx:
        logger.info(f"Merging Excel seed from: {xlsx}")
        excel_data = _read_excel_seed(xlsx)
        seed.update(excel_data)
    else:
        logger.info("No Excel found — keeping existing seed base")

    # 3) Runtime values always win
    seed["appId"] = app_id
    if app_url:
        seed["appUrl"] = app_url

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(seed, f, indent=2)

    logger.info(f"seed_data.json written to {out_path}")
    return seed
