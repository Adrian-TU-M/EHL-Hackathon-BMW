"""Shared, lazy Customer implementation used by its page and both council paths."""
from functools import lru_cache
from threading import RLock

from backend.config import Settings as SharedSettings
from .agent import CustomerAgent
from .config import Settings, load_settings
from .ingest import load_customer_data
from .llm import OllamaClient
from .mappings import Mappings

_load_lock = RLock()


@lru_cache(maxsize=4)
def _agent(settings: Settings) -> CustomerAgent:
    with _load_lock:
        return CustomerAgent(
            load_customer_data(settings.data_dir, settings.manifest_path, settings.mappings_dir),
            Mappings(settings.mappings_dir), OllamaClient(settings),
        )


def get_agent(shared: SharedSettings | None = None, *, settings: Settings | None = None) -> CustomerAgent:
    return _agent(settings or load_settings(shared))


def reload_agents() -> None:
    with _load_lock:
        _agent.cache_clear()
