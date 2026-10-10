"""Shared runtime settings; all agents will use the same model configuration."""

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    ollama_base_url: str
    ollama_model: str
    ollama_timeout_seconds: float
    data_dir: Path
    frontend_origin: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
            ollama_model=os.getenv("OLLAMA_MODEL", "qwen3:8b"),
            ollama_timeout_seconds=float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120")),
            data_dir=Path(os.getenv("BMW_DATA_DIR", "private-data")),
            frontend_origin=os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173"),
        )
