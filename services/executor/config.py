import os

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:8000")
SHARED_DIR    = os.environ.get("SHARED_DIR", "../../shared")
JAVA_DIR      = os.environ.get("JAVA_DIR", "../../shared/java")
PORT          = 8004

# Repo root: two levels up from this service directory
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def resolve_java_dir(java_dir: str) -> str:
    """Resolve a possibly-relative java_dir against REPO_ROOT."""
    if os.path.isabs(java_dir):
        return java_dir
    return os.path.abspath(os.path.join(REPO_ROOT, java_dir))
