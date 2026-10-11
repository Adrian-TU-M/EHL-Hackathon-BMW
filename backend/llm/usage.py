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

# A queued call has consumed no model budget. This mutable marker also travels
# into the native Customer thread; started workflows remain conservatively charged.
_started_requests = ContextVar("council_started_requests", default=None)


@contextmanager
def tracked_requests():
    marker = {"started": False}
    token = _started_requests.set(marker)
    try:
        yield marker
    finally:
        _started_requests.reset(token)


def mark_request_started():
    marker = _started_requests.get()
    if marker is not None:
        marker["started"] = True
