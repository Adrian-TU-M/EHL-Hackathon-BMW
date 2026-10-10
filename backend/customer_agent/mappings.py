"""Data-driven label normalization: markets, powertrains, feedback types, vehicles, themes.

All vocabularies live in YAML under ``mappings/`` so new regions, codes or category
labels are supported by editing config, not code.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

UNMAPPED_PREFIX = "Unmapped:"
UNCLASSIFIED = "Unclassified"
UNKNOWN = "Unknown"


def _clean(value: object) -> str:
    if value is None:
        return ""
    text = " ".join(str(value).split())  # also normalizes non-breaking spaces
    return "" if text.lower() == "nan" else text


def _invert(groups: dict[str, list[str]]) -> dict[str, str]:
    return {str(code).strip().lower(): name for name, codes in groups.items() for code in codes}


def _specific(keywords: list[str]) -> list[str]:
    """Keywords specific enough to recognise a theme in conversation."""
    return [k for k in keywords if " " in k.strip() or len(k.strip().rstrip("*")) >= 6]


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    """Whole word/phrase match; a trailing '*' allows any word ending ("charg*")."""
    word = keyword.lower().strip()
    if word.endswith("*"):
        return re.compile(r"(?<!\w)" + re.escape(word[:-1]))
    return re.compile(r"(?<!\w)" + re.escape(word) + r"(?!\w)")


@dataclass(frozen=True)
class ThemeRule:
    theme: str
    topic: str | None
    keywords: tuple[re.Pattern[str], ...]
    exclude: tuple[re.Pattern[str], ...] = ()
    # Free-text recognition only: aliases + specific keywords (phrases, or words of 6+ letters).
    # Short category words ("key", "lock", "range") are too generic for conversation.
    text_patterns: tuple[re.Pattern[str], ...] = ()

    def mentioned_in(self, text: str) -> bool:
        """Does free text (a question, a council message) talk about this theme?"""
        return any(k.search(text) for k in self.text_patterns)

    def matches(self, label: str) -> bool:
        return any(k.search(label) for k in self.keywords) and not any(
            x.search(label) for x in self.exclude
        )


class Mappings:
    def __init__(self, mappings_dir: Path):
        markets = yaml.safe_load((mappings_dir / "markets.yaml").read_text())["markets"]
        values = yaml.safe_load((mappings_dir / "values.yaml").read_text())
        themes = yaml.safe_load((mappings_dir / "themes.yaml").read_text())["themes"]
        self.market_names = list(markets)
        # Accept both codes ("CN") and market names ("China") as raw values.
        self._market = {name.lower(): name for name in markets} | _invert(markets)
        self._powertrain = _invert(values["powertrain"])
        self._feedback = _invert(values["feedback_type"])
        self._vehicle = _invert(values.get("vehicles", {}))
        self._unclassified = {c.strip().lower() for c in values["unclassified_categories"]}
        self.theme_rules = [
            ThemeRule(
                t["theme"],
                t.get("topic"),
                tuple(_keyword_pattern(k) for k in t["keywords"]),
                tuple(_keyword_pattern(k) for k in t.get("exclude", [])),
                tuple(_keyword_pattern(k) for k in [*t.get("aliases", []), *_specific(t["keywords"])]),
            )
            for t in themes
        ]

    def market(self, country: object) -> str:
        code = _clean(country)
        if not code:
            return UNKNOWN
        return self._market.get(code.lower(), f"{UNMAPPED_PREFIX}{code}")

    def powertrain(self, raw: object) -> str:
        value = _clean(raw)
        if not value:
            return UNKNOWN
        return self._powertrain.get(value.lower(), f"{UNMAPPED_PREFIX}{value}")

    def polarity(self, raw: object) -> str:
        """Complaint | Request | Positive | Unclassified."""
        value = _clean(raw)
        if not value:
            return UNCLASSIFIED
        return self._feedback.get(value.lower(), UNCLASSIFIED)

    def vehicle(self, raw: object) -> str:
        """Vehicle code from a code ("G60") or a free-text model name ("BMW 5 Series G60")."""
        value = _clean(raw)
        mapped = self._vehicle.get(value.lower())
        if mapped:
            return mapped
        # Fall back to a trailing BMW-style code token, else the label itself.
        tokens = value.replace("[", " ").replace("]", " ").split()
        return tokens[-1] if tokens else UNKNOWN

    def is_unclassified(self, category: object) -> bool:
        return _clean(category).lower() in self._unclassified

    def themes_in_text(self, text: str) -> list[str]:
        """Every configured theme the text mentions (keywords or aliases), in config order."""
        lower = (text or "").lower()
        return [r.theme for r in self.theme_rules if lower.strip() and r.mentioned_in(lower)]

    def theme(self, category: object) -> tuple[str, str | None]:
        """Return (theme, frontend topic or None). Unseen labels become their own theme."""
        label = _clean(category)
        if self.is_unclassified(label):
            return UNCLASSIFIED, None
        lower = label.lower()
        for rule in self.theme_rules:
            if rule.matches(lower):
                return rule.theme, rule.topic
        return label, None
