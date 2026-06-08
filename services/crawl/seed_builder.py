import json
import logging
import os
import glob

logger = logging.getLogger("crawl-service.seed_builder")


def _find_excel(framework_dir: str) -> str | None:
    """Return the first .xlsx found under framework_dir/src/main/resources, or None."""
    if not framework_dir or not os.path.isdir(framework_dir):
        return None
    pattern = os.path.join(framework_dir, "src", "main", "resources", "**", "*.xlsx")
    matches = glob.glob(pattern, recursive=True)
    if matches:
        logger.info(f"Found Excel file: {matches[0]}")
        return matches[0]
    return None


def _read_excel_seed(xlsx_path: str) -> dict:
    """
    Read seed config from Excel.
    Expects a sheet named 'config' (or first sheet) with two columns: key | value
    Recognised keys: loginUrl, submitSelector, successIndicator,
                     emailSelector, passwordSelector, appUsername, appPassword,
                     blocklist (comma-separated), strategy
    """
    try:
        import openpyxl
    except ImportError:
        raise ImportError("pip install openpyxl")

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    sheet = wb["config"] if "config" in wb.sheetnames else wb.active

    rows = {}
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if row[0] and row[1]:
            rows[str(row[0]).strip()] = str(row[1]).strip()

    logger.info(f"Excel seed keys found: {list(rows.keys())}")

    blocklist_raw = rows.get("blocklist", "/logout,/delete,/destroy,/admin/reset")
    blocklist = [b.strip() for b in blocklist_raw.split(",") if b.strip()]

    return {
        "auth": {
            "strategy":         rows.get("strategy", "form"),
            "loginUrl":         rows.get("loginUrl", "/login"),
            "fields": {
                rows.get("emailSelector", "#email"):    rows.get("appUsername", "${APP_USERNAME}"),
                rows.get("passwordSelector", "#password"): rows.get("appPassword", "${APP_PASSWORD}"),
            },
            "submitSelector":   rows.get("submitSelector", "#submit-btn"),
            "successIndicator": rows.get("successIndicator", "#dashboard"),
        },
        "blocklist": blocklist,
    }


def _default_seed() -> dict:
    return {
        "auth": {
            "strategy":         "none",
            "loginUrl":         "/login",
            "fields": {
                "#email":    "${APP_USERNAME}",
                "#password": "${APP_PASSWORD}",
            },
            "submitSelector":   "#submit-btn",
            "successIndicator": "#dashboard",
        },
        "blocklist": ["/logout", "/delete", "/destroy", "/admin/reset"],
    }


def build_seed(app_id: str, app_url: str, framework_dir: str, shared_dir: str) -> dict:
    """
    Build and persist seed_data.json for this app_id.
    Priority:
      1. Excel in framework_dir/src/test/java  → parse into seed
      2. No Excel                               → create default seed
    Always stamps app_id and app_url from the UI trigger.
    """
    xlsx = _find_excel(framework_dir) if framework_dir else None

    if xlsx:
        logger.info(f"Building seed from Excel: {xlsx}")
        seed = _read_excel_seed(xlsx)
    else:
        logger.info("No Excel found — using default seed config")
        seed = _default_seed()

    seed["appId"]  = app_id
    seed["appUrl"] = app_url
    seed["form_pool"] = {
        "email":    "testuser@poc.test",
        "password": "TestPass123!",
        "text":     "Sample input",
        "number":   "42",
        "phone":    "5551234567",
        "date":     "2024-06-01",
        "select":   "Option 1",
    }

    # Resolve any literal credential values that aren't env-var placeholders
    # (i.e. if Excel had the actual username/password written in it)
    for selector, value in seed["auth"]["fields"].items():
        if not value.startswith("${"):
            # Already a plain value — leave as-is, resolve_env won't touch it
            pass

    out_path = os.path.join(shared_dir, "config", "seed_data.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(seed, f, indent=2)

    logger.info(f"seed_data.json written to {out_path}")
    return seed
