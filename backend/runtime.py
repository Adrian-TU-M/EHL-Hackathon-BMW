"""Single-worker laptop runtime: one inference workflow at a time."""
import asyncio
run_lock = asyncio.Lock()
