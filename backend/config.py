"""Shared runtime settings; all agents will use the same model configuration."""

from dataclasses import dataclass
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")
load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    ollama_base_url: str
    ollama_model: str
    ollama_timeout_seconds: float
    data_dir: Path
    frontend_origin: str
    evidence_index: Path = Path("backend/data/evidence.json")
    runs_dir: Path = Path("backend/data/runs")
    agent_timeout_seconds: float = 360

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
            ollama_model=os.getenv("OLLAMA_MODEL", "qwen3:8b"),
            ollama_timeout_seconds=float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "180")),
            data_dir=Path(os.getenv("BMW_DATA_DIR", str(ROOT / "private-data" / "inputs"))).expanduser(),
            frontend_origin=os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173"),
            evidence_index=Path(os.getenv("EVIDENCE_INDEX", "backend/data/evidence.json")),
            runs_dir=Path(os.getenv("AGENT_RUNS_DIR", "backend/data/runs")),
            agent_timeout_seconds=float(os.getenv("AGENT_TIMEOUT_SECONDS", "360")),
        )
