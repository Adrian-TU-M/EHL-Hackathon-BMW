"""Native-PDF matrix extraction; blank cells never imply unavailability."""

import re
from collections import defaultdict

import pymupdf

from .models import Evidence
from .sources import topics_for


def matrix_rows(page, vehicle, sid, page_number):
    text = page.get_text()
    if "AUSGEWÄHLTE SERIENAUSSTATTUNGEN" not in text:
        return []
    words = page.get_text("words")
    headers = defaultdict(list)
    for w in words:
        if w[0] > 300 and 65 < w[1] < 115 and w[3] <= 115:
            headers[round((w[0] + w[2]) / 2)].append(w)
    columns = {
        x: " ".join(w[4] for w in sorted(group, key=lambda w: -w[1]))
        for x, group in headers.items()
    }
    # Reject layouts whose headers are not clearly identifiable derivatives.
    columns = {
        x: label
        for x, label in columns.items()
        if re.match(r"^(i[57]|[1-7]\d{2}[a-z]?|M\d{3})\b", label)
    }
    if not columns:
        return []
    marks = defaultdict(list)
    for w in words:
        if w[4] == "■" and 120 < w[1] < 775 and w[0] > min(columns) - 5:
            x = min(columns, key=lambda x: abs(x - (w[0] + w[2]) / 2))
            if abs(x - (w[0] + w[2]) / 2) <= 4:
                marks[round(w[1], 1)].append(x)
    records = []
    ys = sorted(marks)
    for index, y in enumerate(ys):
        end = ys[index + 1] - 3 if index + 1 < len(ys) else min(y + 100, 775)
        bounds = [40, y - 3, min(columns) - 8, end]
        row = page.get_text(clip=pymupdf.Rect(bounds)).strip()
        if not row:
            continue
        for x in marks[y]:
            derivative = columns[x]
            powertrain = (
                "Electric"
                if derivative.startswith(("i5", "i7"))
                else "Plug-in hybrid"
                if re.match(r"\d{3}e", derivative)
                else "Combustion"
            )
            records.append(
                Evidence(
                    id=f"{sid}:p{page_number}:y{y}:x{x}",
                    source_id=sid,
                    domain="product",
                    location=f"PDF page {page_number}, row y={y}, derivative {derivative}, column x={x}; native ■ glyph",
                    passage=f"German edition: {derivative}, standard equipment row: {row}",
                    vehicle=vehicle,
                    region="Germany",
                    powertrain=powertrain,
                    published_at="2026-05-28",
                    kind="equipment",
                    derivative=derivative,
                    availability="standard",
                    equipment_verified=True,
                    dependencies=[
                        line
                        for line in row.splitlines()
                        if re.search(
                            r"Nur|Nicht|Verbindung|Paket|erforderlich|Laufzeit", line
                        )
                    ]
                    + [
                        "See this page's footnotes and edition conditions; blank cells are not unavailability."
                    ],
                    topics=topics_for(row),
                    limitations=[
                        "German edition only; no Europe-wide availability claim.",
                        "Verified native header/glyph mapping for selected standard-equipment matrices only. Optional/package tables remain page context.",
                    ],
                )
            )
    return records
