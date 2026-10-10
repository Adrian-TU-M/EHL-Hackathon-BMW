"""Runtime configuration from environment variables (and an optional repo-root .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from backend.config import Settings as SharedSettings

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


def load_settings(shared: SharedSettings | None = None) -> Settings:
    # The application owns dotenv loading and the model configuration. A specialist
    # must not silently select another model or another laptop's dataset location.
    shared = shared or SharedSettings.from_env()
    data_dir = shared.data_dir.expanduser()
    if (data_dir / "BMW-Data").is_dir():
        data_dir = data_dir / "BMW-Data"
    return Settings(
        data_dir=data_dir,
        manifest_path=Path(
            os.environ.get("CUSTOMER_AGENT_MANIFEST", BACKEND_DIR / "datasets.yaml")
        ),
        mappings_dir=Path(
            os.environ.get("CUSTOMER_AGENT_MAPPINGS", BACKEND_DIR / "mappings")
        ),
        ollama_base_url=shared.ollama_base_url,
        ollama_model=shared.ollama_model,
        ollama_timeout_s=max(180, shared.ollama_timeout_seconds),
        max_output_tokens=int(os.environ.get("OLLAMA_MAX_OUTPUT_TOKENS", "3072")),
    )
