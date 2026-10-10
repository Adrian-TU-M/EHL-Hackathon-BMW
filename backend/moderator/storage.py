from __future__ import annotations

import json
import sqlite3
import os
from pathlib import Path

from .models import Catalog, DiscussionEvent, Session


class Store:
    """Single-process local store. Snapshot + ordered events + command receipt commit together."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock_file = path.with_suffix(path.suffix + ".lock").open("a+")
        try:
            if os.name == "nt":
                import msvcrt
                if self.lock_file.seek(0, 2) == 0:
                    self.lock_file.write("\0")
                    self.lock_file.flush()
                self.lock_file.seek(0)
                msvcrt.locking(self.lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.lock_file.close()
            raise RuntimeError("The moderator database is already open in another backend. Run one backend worker; tests must use a temporary MODERATOR_DATA_DIR.") from error
        try:
            self.db = sqlite3.connect(path)
        except BaseException:
            self.lock_file.close()
            raise
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL REFERENCES sessions(id), sequence INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id,sequence));
            CREATE TABLE IF NOT EXISTS commands (session_id TEXT NOT NULL REFERENCES sessions(id), command_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id,command_key));
            CREATE TABLE IF NOT EXISTS catalogs (snapshot_hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
        """)

    def save(
        self,
        session: Session,
        events: list[DiscussionEvent] = (),
        command: tuple[str, dict] | None = None,
    ):
        with self.db:
            self.db.execute(
                "INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",
                (session.id, session.model_dump_json()),
            )
            for event in events:
                self.db.execute(
                    "INSERT INTO events VALUES (?,?,?)",
                    (session.id, event.sequence, event.model_dump_json()),
                )
            if command:
                self.db.execute(
                    "INSERT INTO commands VALUES (?,?,?)",
                    (session.id, command[0], json.dumps(command[1], sort_keys=True)),
                )

    def get(self, sid: str) -> Session:
        row = self.db.execute(
            "SELECT snapshot FROM sessions WHERE id=?", (sid,)
        ).fetchone()
        if row is None:
            raise KeyError(sid)
        return Session.model_validate_json(row[0])

    def command(self, sid, key):
        row = self.db.execute(
            "SELECT payload FROM commands WHERE session_id=? AND command_key=?",
            (sid, key),
        ).fetchone()
        return json.loads(row[0]) if row else None

    def events(self, sid: str, after: int = 0) -> list[DiscussionEvent]:
        return [
            DiscussionEvent.model_validate_json(r[0])
            for r in self.db.execute(
                "SELECT payload FROM events WHERE session_id=? AND sequence>? ORDER BY sequence",
                (sid, after),
            )
        ]

    def sessions(self):
        return [
            Session.model_validate_json(r[0])
            for r in self.db.execute("SELECT snapshot FROM sessions")
        ]

    def catalogs(self):
        return [
            Catalog.model_validate_json(r[0])
            for r in self.db.execute("SELECT payload FROM catalogs ORDER BY rowid")
        ]

    def save_catalog(self, catalog):
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO catalogs VALUES (?,?)",
                (catalog.snapshot_hash, catalog.model_dump_json()),
            )

    def close(self):
        self.db.close()
        self.lock_file.close()
