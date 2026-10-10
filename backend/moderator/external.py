"""Explicit external-source intake. Pages are evidence, never agent instructions."""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import socket
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pymupdf
from pydantic import Field, field_validator

from .models import Catalog, Domain, Evidence, Model, Source, now
from .sources import topics_for


class ExternalInput(Model):
    url: str = Field(max_length=2000)
    title: str = Field(min_length=1, max_length=200)
    domain: Domain
    publisher: str = Field(min_length=1, max_length=200)
    quality: str = Field(
        default="unverified", pattern="^(primary|secondary|unverified)$"
    )
    vehicle: str | None = Field(default=None, pattern="^(F70|G60|G68|G70|G60_G68)$")
    region: str | None = Field(default=None, max_length=100)
    powertrain: str | None = Field(
        default=None, pattern="^(Electric|Plug-in hybrid|Combustion)$"
    )
    published_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    period: str | None = Field(default=None, max_length=100)
    limitations: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("published_at")
    @classmethod
    def calendar_date(cls, value):
        if value is not None:
            date.fromisoformat(value)
        return value


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden += 1
        if tag in {"p", "div", "li", "h1", "h2", "h3", "tr", "br"} and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


async def public_url(url: str):
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
    ):
        raise ValueError(
            "Use a public HTTPS source URL without credentials or custom ports"
        )
    addresses = await asyncio.to_thread(
        socket.getaddrinfo, parsed.hostname, 443, type=socket.SOCK_STREAM
    )
    if not addresses or any(
        not ipaddress.ip_address(a[4][0]).is_global for a in addresses
    ):
        raise ValueError(
            "Private/local network sources are not allowed through URL intake"
        )


async def fetch_source(body: ExternalInput, folder: Path, client=None):
    await public_url(body.url)
    owned = client is None
    client = client or httpx.AsyncClient(follow_redirects=False, timeout=20)
    try:
        async with client.stream(
            "GET", body.url, headers={"Accept": "text/html,text/plain,application/pdf"}
        ) as response:
            response.raise_for_status()
            mime = response.headers.get("content-type", "").split(";")[0].strip()
            if mime not in {"text/html", "text/plain", "application/pdf"}:
                raise ValueError("Only HTML, plain text and PDF sources are supported")
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > 10_000_000:
                    raise ValueError("Source exceeds the 10 MB intake limit")
        digest = hashlib.sha256(raw).hexdigest()
        # Include declared scope/domain/date in identity: same page under different
        # metadata must not overwrite another frozen evidence record.
        identity = hashlib.sha256(
            (digest + body.model_dump_json()).encode()
        ).hexdigest()[:24]
        sid = f"external-{identity}"
        if mime == "application/pdf":
            with pymupdf.open(stream=bytes(raw), filetype="pdf") as pdf:
                if len(pdf) > 500:
                    raise ValueError("PDF exceeds the 500 page extraction limit")
                passages = [
                    (f"PDF page {i + 1}", page.get_text()) for i, page in enumerate(pdf)
                ]
        else:
            text = raw.decode("utf-8", errors="replace")
            if mime == "text/html":
                parser = PageText()
                parser.feed(text)
                text = "".join(parser.parts)
            # Lines refer to this immutable normalized text, not shifting live HTML.
            lines = [
                " ".join(line.split()) for line in text.splitlines() if line.strip()
            ]
            passages = [
                (
                    f"Extracted text lines {i + 1}–{min(i + 12, len(lines))}",
                    "\n".join(lines[i : i + 12]),
                )
                for i in range(0, len(lines), 12)
            ]
        passages = [(loc, text) for loc, text in passages if text.strip()]
        if not passages:
            raise ValueError(
                "No readable source text; scanned/dynamic content needs a separate extractor"
            )
        limitations = body.limitations + [
            "Externally retrieved source; publisher quality is declared metadata, not independent verification.",
            "Text extraction may omit image, chart or dynamic content.",
        ]
        if not body.published_at:
            limitations.append(
                "Publication date unknown; retrieval time is not publication time."
            )
        if not body.region:
            limitations.append(
                "Market unspecified; source is context only, not evidence of regional availability."
            )
        source = Source(
            id=sid,
            name=body.title,
            domain=body.domain,
            sha256=digest,
            source_url=body.url,
            provenance="external",
            publisher=body.publisher,
            quality=body.quality,
            retrieved_at=now(),
            coverage={"content_type": mime, "extracted_passages": len(passages)},
            limitations=limitations,
        )
        evidence = [
            Evidence(
                id=f"{sid}:{i + 1}",
                source_id=sid,
                domain=body.domain,
                location=loc,
                passage=text,
                vehicle=body.vehicle,
                region=body.region,
                powertrain=body.powertrain,
                published_at=body.published_at,
                period=body.period,
                kind="external_context",
                topics=topics_for(text),
                limitations=limitations,
            )
            for i, (loc, text) in enumerate(passages)
        ]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{digest}.bin").write_bytes(raw)
        return source, evidence
    finally:
        if owned:
            await client.aclose()


def extend_catalog(base: Catalog | None, source: Source, evidence: list[Evidence]):
    if base and any(s.id == source.id for s in base.sources):
        existing = [e for e in base.evidence if e.source_id == source.id]
        if existing == evidence:
            return base
    sources = [s for s in base.sources if s.id != source.id] if base else []
    records = [e for e in base.evidence if e.source_id != source.id] if base else []
    sources.append(source)
    records.extend(evidence)
    # Content-address the combined extraction rather than its import history.
    # Reimporting identical evidence or changing import order keeps one snapshot;
    # revised supplied extraction/scope metadata necessarily changes the hash.
    digest = hashlib.sha256(b"external-policy-v2")
    for record in sorted(sources, key=lambda s: s.id):
        digest.update(
            json.dumps(
                record.model_dump(exclude={"retrieved_at"}), sort_keys=True
            ).encode()
        )
    for record in sorted(records, key=lambda e: e.id):
        digest.update(record.model_dump_json().encode())
    snapshot = digest.hexdigest()
    warnings = (
        [w for w in base.warnings if not w.startswith("No verified competitor")]
        if base
        else ["Supplied Drive collection not loaded; source coverage is incomplete."]
    )
    warnings.append(
        "External context does not by itself establish a verified competitive gap; equivalent BMW/peer configurations must be compared."
    )
    return Catalog(
        snapshot_hash=snapshot,
        sources=sources,
        evidence=records,
        warnings=list(dict.fromkeys(warnings)),
    )
