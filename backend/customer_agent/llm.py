"""Minimal Ollama client: /api/chat with JSON-schema constrained output."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .config import Settings


class LLMUnavailable(RuntimeError):
    """Ollama is not reachable, the model is missing, or the call timed out."""


class LLMOutputError(RuntimeError):
    """The model returned output that does not parse as the requested JSON."""


class OllamaClient:
    def __init__(self, settings: Settings):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model
        self.timeout = settings.ollama_timeout_s
        self.max_tokens = settings.max_output_tokens

    def status(self) -> dict[str, Any]:
        try:
            response = httpx.get(f"{self.base_url}/api/tags", timeout=5)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            return {"reachable": False, "model": self.model, "modelAvailable": False, "error": str(exc)}
        names = {m["name"] for m in response.json().get("models", [])}
        return {"reachable": True, "model": self.model, "modelAvailable": self.model in names}

    def chat_json(self, system: str, user: str, schema: dict, temperature: float = 0.2) -> dict:
        """One retry on unparseable output (e.g. a generation cut off by the token cap)."""
        try:
            return self._chat_json(system, user, schema, temperature, seed=7)
        except LLMOutputError:
            return self._chat_json(system, user, schema, temperature, seed=8)

    def _chat_json(self, system: str, user: str, schema: dict, temperature: float, seed: int) -> dict:
        payload = {
            "model": self.model,
            "stream": False,
            "think": False,  # qwen3: skip the reasoning trace; schema output only
            "format": schema,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "options": {
                "temperature": temperature,
                "seed": seed,
                "num_predict": self.max_tokens,
                "num_ctx": 16384,
                "repeat_penalty": 1.1,
            },
        }
        try:
            response = httpx.post(f"{self.base_url}/api/chat", json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise LLMUnavailable(f"Ollama request failed: {exc}") from exc
        if response.status_code == 404:
            raise LLMUnavailable(f"Model {self.model!r} not found. Run: ollama pull {self.model}")
        if response.status_code >= 400:
            raise LLMUnavailable(f"Ollama error {response.status_code}: {response.text[:300]}")
        content = response.json().get("message", {}).get("content", "")
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMOutputError(f"Model output is not valid JSON: {content[:300]}") from exc
