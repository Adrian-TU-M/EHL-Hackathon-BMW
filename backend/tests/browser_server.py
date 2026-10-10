import asyncio
from pathlib import Path

from moderator.adapters import DeterministicAdapters
from moderator.app import create_app
from moderator.engine import Engine
from moderator.storage import Store

from .conftest import make_catalog


class BrowserAdapters(DeterministicAdapters):
    async def call(self, *args):
        await asyncio.sleep(0.2)
        return await super().call(*args)


app = create_app(
    Engine(
        make_catalog(),
        Store(Path("test-results/moderator-browser.sqlite3")),
        BrowserAdapters(),
    )
)
