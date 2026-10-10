"""Runtime configuration from environment variables (and an optional repo-root .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    manifest_path: Path
    mappings_dir: Path
    ollama_base_url: str
    ollama_model: str
    ollama_timeout_s: float
    max_output_tokens: int


def load_settings() -> Settings:
    _load_dotenv(REPO_DIR / ".env")
    return Settings(
        data_dir=Path(os.environ.get("BMW_DATA_DIR", "~/DataSetsfromBMW")).expanduser(),
        manifest_path=Path(
            os.environ.get("CUSTOMER_AGENT_MANIFEST", BACKEND_DIR / "datasets.yaml")
        ),
        mappings_dir=Path(
            os.environ.get("CUSTOMER_AGENT_MAPPINGS", BACKEND_DIR / "mappings")
        ),
        ollama_base_url=os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
        ollama_model=os.environ.get("OLLAMA_MODEL", "qwen3:8b"),
        ollama_timeout_s=float(os.environ.get("OLLAMA_TIMEOUT_S", "180")),
        max_output_tokens=int(os.environ.get("OLLAMA_MAX_OUTPUT_TOKENS", "3072")),
    )
