import os

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:8000")
SHARED_DIR    = os.environ.get("SHARED_DIR", "../../shared")
JAVA_DIR      = os.environ.get("JAVA_DIR", "../../shared/java")
PORT          = 8002

# Repo root — used to resolve relative framework_dir paths from the UI
_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT    = os.environ.get("REPO_ROOT", os.path.abspath(os.path.join(_SERVICE_DIR, "../..")))
