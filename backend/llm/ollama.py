"""Low-level adapter. No request runs at import, startup or health-check time."""

from typing import Any

import httpx

from backend.config import Settings
from backend.runtime import inference_lock


class OllamaClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        output_schema: dict[str, Any] | None = None,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        """Return Ollama's response; the agent must execute allowed tools itself.

        Use tools during research and a separate schema-constrained final call.
        No model response is trusted as verified evidence merely because it parses.
        """
        payload: dict[str, Any] = {
            "model": self.settings.ollama_model,
            "messages": messages,
            "stream": False,
            "think": False,
            "options": {"temperature": 0.2, "num_predict": max_tokens, "num_ctx": 16384},
        }
        if tools:
            payload["tools"] = tools
        if output_schema:
            payload["format"] = output_schema
        async with inference_lock, httpx.AsyncClient(timeout=self.settings.ollama_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url}/api/chat", json=payload
            )
            response.raise_for_status()
            result = response.json()
            from backend.llm.usage import record_usage
            record_usage(result)
            return result
