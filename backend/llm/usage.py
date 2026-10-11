"""Per-turn accounting shared by asynchronous and native threaded Ollama clients."""
from contextvars import ContextVar
from contextlib import contextmanager

_usage = ContextVar("council_model_usage", default=None)


@contextmanager
def measured_usage():
    calls = []
    token = _usage.set(calls)
    try:
        yield calls
    finally:
        _usage.reset(token)


def record_usage(response):
    calls = _usage.get()
    if calls is None:
        return
    values = [response.get("prompt_eval_count"), response.get("eval_count")]
    if any(not isinstance(n, int) or n < 0 for n in values):
        raise ValueError("Native Ollama call did not report actual token usage")
    calls.append(sum(values))
