"""Atomic files plus text and CSV operator outputs."""

from __future__ import annotations

import csv
import io
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def format_table(operations: Sequence[Mapping[str, Any]]) -> str:
    headers = ["CLASS", "AGE", "GEN", "ANOM", "OWNER", "OPERATION", "CHECKPOINT", "STATUS"]
    rows: list[list[str]] = []
    for item in operations:
        rows.append(
            [
                str(item["classification"]),
                f"{item['age_minutes']}m",
                str(item["generation"]),
                str(item.get("anomaly_count", 0)),
                str(item["owner"] or "-"),
                str(item["operation_id"]),
                "yes" if item["recovery_ready"] else "no",
                str(item["status"]),
            ]
        )
    widths = [len(header) for header in headers]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = min(64, max(widths[index], len(value)))

    def crop(value: str, width: int) -> str:
        if len(value) <= width:
            return value
        return value[: max(1, width - 1)] + "…"

    lines = ["  ".join(header.ljust(widths[index]) for index, header in enumerate(headers))]
    lines.append("  ".join("-" * width for width in widths))
    for row in rows:
        lines.append(
            "  ".join(crop(value, widths[index]).ljust(widths[index]) for index, value in enumerate(row))
        )
    if not rows:
        lines.append("(no operations)")
    return "\n".join(lines)


def operations_to_csv(operations: Sequence[Mapping[str, Any]]) -> str:
    stream = io.StringIO(newline="")
    fields = [
        "operation_id",
        "generation",
        "owner",
        "status",
        "classification",
        "age_minutes",
        "anomaly_count",
        "recovery_ready",
        "last_seen_at",
        "checkpoint_at",
        "source_ref",
        "summary",
        "next_action",
    ]
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(operations)
    return stream.getvalue()


def list_anomalies(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT operation_id, event_id, code, detail, created_at
        FROM anomalies
        ORDER BY created_at DESC, operation_id, event_id, code
        """
    ).fetchall()
    return [dict(row) for row in rows]


def format_anomalies_table(anomalies: Sequence[Mapping[str, Any]]) -> str:
    headers = ["TIME", "CODE", "OPERATION", "EVENT", "DETAIL"]
    rows = [
        [
            str(item["created_at"]),
            str(item["code"]),
            str(item["operation_id"]),
            str(item["event_id"]),
            str(item["detail"]),
        ]
        for item in anomalies
    ]
    widths = [len(header) for header in headers]
    caps = [20, 34, 54, 40, 88]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = min(caps[index], max(widths[index], len(value)))

    def crop(value: str, width: int) -> str:
        return value if len(value) <= width else value[: max(1, width - 1)] + "…"

    lines = ["  ".join(header.ljust(widths[index]) for index, header in enumerate(headers))]
    lines.append("  ".join("-" * width for width in widths))
    lines.extend(
        "  ".join(crop(value, widths[index]).ljust(widths[index]) for index, value in enumerate(row))
        for row in rows
    )
    if not rows:
        lines.append("(no anomalies)")
    return "\n".join(lines)


def anomalies_to_csv(anomalies: Sequence[Mapping[str, Any]]) -> str:
    stream = io.StringIO(newline="")
    fields = ["created_at", "code", "operation_id", "event_id", "detail"]
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(anomalies)
    return stream.getvalue()


