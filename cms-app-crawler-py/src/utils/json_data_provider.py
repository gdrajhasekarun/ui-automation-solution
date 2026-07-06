import json
from pathlib import Path

_TESTDATA_DIR = Path(__file__).parent.parent.parent / "resources" / "testdata"


class JsonDataProvider:
    @staticmethod
    def get_data(method_name: str) -> list[dict]:
        file_path = _TESTDATA_DIR / f"{method_name}.json"
        if not file_path.exists():
            raise FileNotFoundError(
                f"No test data JSON found for: {method_name} (expected: {file_path})"
            )
        with open(file_path, encoding="utf-8") as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            raise ValueError(f"Test data file must contain a JSON array: {file_path}")
        return rows
