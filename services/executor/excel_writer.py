import os
import logging
import openpyxl

logger = logging.getLogger("executor.excel")


def write(test_data: list[dict], java_dir: str) -> str:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "TestData"

    all_params = {}
    for td in test_data:
        for k in td.get("values", {}).keys():
            all_params[k] = True

    param_cols = list(all_params.keys())
    headers = ["TestCaseName"] + param_cols
    ws.append(headers)

    for td in test_data:
        tc_name = td["tc_name"]
        values = td.get("values", {})
        row = [tc_name] + [values.get(p, "") for p in param_cols]
        ws.append(row)

    resources_dir = os.path.join(java_dir, "src", "test", "resources")
    os.makedirs(resources_dir, exist_ok=True)
    out_path = os.path.join(resources_dir, "testdata.xlsx")
    wb.save(out_path)
    logger.info(f"Wrote testdata.xlsx with {len(test_data)} rows")
    return out_path
