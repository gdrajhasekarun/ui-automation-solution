import os

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:8000")
GENERATOR_URL = os.environ.get("GENERATOR_URL", "http://localhost:8002")
SHARED_DIR    = os.environ.get("SHARED_DIR", "../../shared")
PORT          = 8001
