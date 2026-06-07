import sqlite3
import threading
import uuid
from datetime import datetime, timezone

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS crawl_runs (
  run_id TEXT PRIMARY KEY, app_id TEXT, status TEXT,
  phase TEXT, node_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0, trigger_type TEXT,
  started_at TEXT, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS graph_state (
  app_id TEXT PRIMARY KEY, current_path TEXT,
  previous_path TEXT, node_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0, last_crawled_at TEXT
);
CREATE TABLE IF NOT EXISTS pom_state (
  app_id TEXT PRIMARY KEY, classes_count INTEGER DEFAULT 0,
  methods_count INTEGER DEFAULT 0, output_dir TEXT,
  last_generated_at TEXT
);
CREATE TABLE IF NOT EXISTS test_cases (
  tc_id TEXT PRIMARY KEY, app_id TEXT, tc_name TEXT,
  status TEXT, confidence REAL, file_path TEXT,
  class_name TEXT, method_name TEXT,
  parameters TEXT, review_reason TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS test_runs (
  run_id TEXT PRIMARY KEY, app_id TEXT,
  selected_tcs TEXT, status TEXT,
  triggered_at TEXT, finished_at TEXT, mvn_exit_code INTEGER
);
CREATE TABLE IF NOT EXISTS test_results (
  result_id TEXT PRIMARY KEY, run_id TEXT, tc_name TEXT,
  status TEXT, duration_ms INTEGER, failure_msg TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS ui_events (
  event_id TEXT PRIMARY KEY, app_id TEXT,
  stage TEXT, message TEXT, level TEXT, created_at TEXT
);
"""


def get_db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(":memory:", check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        _conn.commit()
    return _conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_insert(table: str, data: dict):
    with _lock:
        db = get_db()
        cols = ", ".join(data.keys())
        placeholders = ", ".join("?" * len(data))
        db.execute(f"INSERT OR REPLACE INTO {table} ({cols}) VALUES ({placeholders})",
                   list(data.values()))
        db.commit()


def db_update(table: str, pk_col: str, pk_val, updates: dict):
    with _lock:
        db = get_db()
        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        db.execute(f"UPDATE {table} SET {set_clause} WHERE {pk_col} = ?",
                   list(updates.values()) + [pk_val])
        db.commit()


def db_get(table: str, pk_col: str, pk_val) -> dict | None:
    db = get_db()
    row = db.execute(f"SELECT * FROM {table} WHERE {pk_col} = ?", [pk_val]).fetchone()
    return dict(row) if row else None


def db_list(table: str, where: str = "", params: list = None, limit: int = 100) -> list[dict]:
    db = get_db()
    query = f"SELECT * FROM {table}"
    if where:
        query += f" WHERE {where}"
    query += f" ORDER BY rowid DESC LIMIT {limit}"
    rows = db.execute(query, params or []).fetchall()
    return [dict(r) for r in rows]


def db_list_since(table: str, app_id: str, since: str, limit: int = 200) -> list[dict]:
    db = get_db()
    rows = db.execute(
        f"SELECT * FROM {table} WHERE app_id = ? AND created_at >= ? ORDER BY rowid DESC LIMIT ?",
        [app_id, since, limit],
    ).fetchall()
    return [dict(r) for r in rows]


def db_emit_event(app_id: str, stage: str, message: str, level: str = "INFO"):
    db_insert("ui_events", {
        "event_id": "evt-" + uuid.uuid4().hex[:8],
        "app_id": app_id,
        "stage": stage,
        "message": message,
        "level": level,
        "created_at": _now()
    })
