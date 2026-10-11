import sqlite3
from pathlib import Path

from .models import Presentation
from .stories import ORDERS, audience_outline


class PresentationStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, input_hash TEXT NOT NULL, presentation_id TEXT NOT NULL)"
        )
        self.db.commit()

    @staticmethod
    def decode(raw):
        p = Presentation.model_validate_json(raw)
        for audience in ORDERS:
            if audience not in p.audience_outlines:
                p.audience_outlines[audience] = audience_outline(p, audience)
        return p

    def save(self, p: Presentation, receipt: tuple[str, str] | None = None):
        with self.db:
            self.db.execute(
                "INSERT INTO presentations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",
                (p.id, p.model_dump_json()),
            )
            if receipt:
                self.db.execute("INSERT INTO receipts VALUES (?,?,?)", (*receipt, p.id))

    def receipt(self, key):
        return self.db.execute(
            "SELECT input_hash, presentation_id FROM receipts WHERE key=?", (key,)
        ).fetchone()

    def get(self, pid):
        row = self.db.execute(
            "SELECT snapshot FROM presentations WHERE id=?", (pid,)
        ).fetchone()
        if not row:
            raise KeyError(pid)
        return self.decode(row[0])

    def list(self):
        return [
            self.decode(r[0])
            for r in self.db.execute(
                "SELECT snapshot FROM presentations ORDER BY rowid DESC"
            )
        ]

    def close(self):
        self.db.close()
