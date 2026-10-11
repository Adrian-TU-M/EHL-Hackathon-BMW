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
            CREATE TABLE IF NOT EXISTS vehicle_starts (command_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id));
            CREATE TABLE IF NOT EXISTS jury_discussions (session_id TEXT NOT NULL REFERENCES sessions(id), assessment_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id,assessment_id));
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

    def recent_sessions(self):
        """Small read-only discovery index, excluding objectives and evidence."""
        rows = self.db.execute("""
            SELECT s.id,
                   json_extract(s.snapshot, '$.status') AS status,
                   json_object(
                       'vehicle', json_extract(s.snapshot, '$.agenda.scope.vehicle'),
                       'market', json_extract(s.snapshot, '$.agenda.scope.market'),
                       'powertrain', json_extract(s.snapshot, '$.agenda.scope.powertrain'),
                       'horizon', json_extract(s.snapshot, '$.agenda.scope.horizon')
                   ) AS scope,
                   (SELECT json_extract(topic.value, '$.label')
                    FROM json_each(s.snapshot, '$.agenda.topics') AS topic
                    WHERE json_extract(topic.value, '$.id') = COALESCE(
                        json_extract(s.snapshot, '$.work.brief.topic_id'),
                        json_extract(s.snapshot, '$.agenda.selected_ids[0]'))
                    LIMIT 1) AS topic_label,
                   json_extract(s.snapshot, '$.sequence') AS sequence,
                   json_array_length(s.snapshot, '$.outcomes') AS outcome_count,
                   (SELECT COUNT(*) FROM json_each(s.snapshot, '$.outcomes') AS outcome
                    WHERE json_extract(outcome.value, '$.assessment.native_assessment.id') IS NOT NULL
                      AND json_extract(outcome.value, '$.assessment_valid') = 1
                   ) AS native_assessment_count,
                   json_array_length(s.snapshot, '$.agenda.selected_ids') AS selected_count,
                   json_extract(s.snapshot, '$.work.stage') AS stage,
                   json_extract(s.snapshot, '$.created_at') AS created_at,
                   COALESCE(
                       (SELECT json_extract(e.payload, '$.timestamp') FROM events AS e
                        WHERE e.session_id = s.id ORDER BY e.sequence DESC LIMIT 1),
                       json_extract(s.snapshot, '$.created_at')
                   ) AS updated_at,
                   json_extract(s.snapshot, '$.mode') AS mode
            FROM sessions AS s
            WHERE json_extract(s.snapshot, '$.mode') != 'deterministic'
            ORDER BY CASE json_extract(s.snapshot, '$.status')
                WHEN 'running' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                updated_at DESC, s.id
            LIMIT 20
        """).fetchall()
        fields = ("id", "status", "scope", "topic_label", "sequence", "outcome_count",
                  "native_assessment_count", "selected_count", "stage", "created_at", "updated_at", "mode")
        result = [dict(zip(fields, row)) for row in rows]
        for item in result:
            item["scope"] = json.loads(item["scope"])
            item["has_native_assessment"] = item["native_assessment_count"] > 0
        return result

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
