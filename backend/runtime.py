"""Single-worker laptop runtime: one inference workflow at a time."""
import asyncio
run_lock = asyncio.Lock()

# Serialize actual model requests across every agent and API.
inference_lock = asyncio.Lock()
