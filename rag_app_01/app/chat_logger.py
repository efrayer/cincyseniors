"""SQLite logger for Cindy chat interactions."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import PROJECT_ROOT

DB_PATH = PROJECT_ROOT / "cindy_chat_log.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the log table if it doesn't exist, and migrate older schemas."""
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_log (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id       TEXT NOT NULL,
                timestamp        TEXT NOT NULL,
                user_message     TEXT NOT NULL,
                cindy_reply      TEXT NOT NULL,
                sources          TEXT NOT NULL,
                num_docs         INTEGER NOT NULL,
                had_context      INTEGER NOT NULL,
                read_aloud_count INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_session ON chat_log(session_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON chat_log(timestamp)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_had_context ON chat_log(had_context)")
        # Migrate: add read_aloud_count if upgrading from older schema
        try:
            conn.execute("ALTER TABLE chat_log ADD COLUMN read_aloud_count INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass  # Column already exists


def log_turn(
    *,
    session_id: str,
    user_message: str,
    cindy_reply: str,
    sources: list[dict],
    had_context: bool,
) -> int:
    """Insert one chat turn into the log. Returns the new row id (or 0 on error)."""
    try:
        with _connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO chat_log
                    (session_id, timestamp, user_message, cindy_reply, sources, num_docs, had_context)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    datetime.now(timezone.utc).isoformat(),
                    user_message,
                    cindy_reply,
                    json.dumps(sources),
                    len(sources),
                    int(had_context),
                ),
            )
            return cursor.lastrowid or 0
    except Exception as exc:
        print(f"[chat_logger] WARNING: failed to log turn — {exc}")
        return 0


def log_read_aloud(log_id: int):
    """Increment the read_aloud_count for a specific log entry. Errors are swallowed."""
    try:
        with _connect() as conn:
            conn.execute(
                "UPDATE chat_log SET read_aloud_count = read_aloud_count + 1 WHERE id = ?",
                (log_id,),
            )
    except Exception as exc:
        print(f"[chat_logger] WARNING: failed to log read-aloud event — {exc}")


def new_session_id() -> str:
    return str(uuid.uuid4())
