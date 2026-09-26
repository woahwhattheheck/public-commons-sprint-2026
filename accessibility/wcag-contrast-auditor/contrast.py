#!/usr/bin/env python3
"""Offline WCAG 2.x text contrast checker using only the Python standard library."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import asdict, dataclass
from typing import Sequence, TextIO

_HEX_COLOR = re.compile(r"^#?(?P<hex>[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


@dataclass(frozen=True)
class ContrastResult:
    foreground: str
    background: str
    ratio: float
    level: str
    large_text: bool
    threshold: float
    passes: bool


def normalize_hex(value: str) -> str:
    """Return a canonical #RRGGBB color or raise ValueError."""
    match = _HEX_COLOR.fullmatch(value.strip())
    if match is None:
        raise ValueError(f"invalid color {value!r}; use #RGB or #RRGGBB")
    digits = match.group("hex").upper()
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return f"#{digits}"


def _srgb_channel_to_linear(channel: int) -> float:
    value = channel / 255.0
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def relative_luminance(color: str) -> float:
    """Return WCAG 2.x relative luminance for an sRGB hex color."""
    normalized = normalize_hex(color)
    red = int(normalized[1:3], 16)
    green = int(normalized[3:5], 16)
    blue = int(normalized[5:7], 16)
    r = _srgb_channel_to_linear(red)
    g = _srgb_channel_to_linear(green)
    b = _srgb_channel_to_linear(blue)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(foreground: str, background: str) -> float:
    """Return the WCAG 2.x contrast ratio, from 1.0 through 21.0."""
    first = relative_luminance(foreground)
    second = relative_luminance(background)
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


def required_ratio(level: str, large_text: bool) -> float:
    normalized = level.upper()
    thresholds = {
        ("AA", False): 4.5,
        ("AA", True): 3.0,
        ("AAA", False): 7.0,
        ("AAA", True): 4.5,
    }
    try:
        return thresholds[(normalized, large_text)]
    except KeyError as exc:
        raise ValueError("level must be AA or AAA") from exc


def evaluate(
    foreground: str,
    background: str,
    *,
    level: str = "AA",
    large_text: bool = False,
) -> ContrastResult:
    fg = normalize_hex(foreground)
    bg = normalize_hex(background)
    normalized_level = level.upper()
    threshold = required_ratio(normalized_level, large_text)
    ratio = contrast_ratio(fg, bg)
    return ContrastResult(
        foreground=fg,
        background=bg,
        ratio=ratio,
        level=normalized_level,
        large_text=large_text,
        threshold=threshold,
        passes=ratio >= threshold,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check a color pair or CSV palette against WCAG 2.x text contrast thresholds."
    )
    parser.add_argument("foreground", nargs="?", help="foreground color as #RGB or #RRGGBB")
    parser.add_argument("background", nargs="?", help="background color as #RGB or #RRGGBB")
    parser.add_argument("--csv", metavar="PATH", help="audit a UTF-8 CSV palette; use - for stdin")
    parser.add_argument("--level", choices=("AA", "AAA"), default="AA")
    parser.add_argument(
        "--large-text",
        action="store_true",
        help="use the WCAG large-text threshold (size/weight classification is up to the caller)",
    )
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    return parser


def audit_csv(stream: TextIO, *, level: str = "AA", large_text: bool = False) -> dict:
    """Evaluate every CSV record using the same unrounded single-pair calculation."""
    reader = csv.reader(stream, strict=True)
    header = next(reader, None)
    if header:
        header[0] = header[0].removeprefix("\ufeff")
    required = {"foreground", "background"}
    allowed = required | {"name", "level", "large_text"}
    if (
        not header
        or len(header) != len(set(header))
        or not required.issubset(header)
        or not set(header).issubset(allowed)
    ):
        raise ValueError(
            "CSV needs unique foreground,background columns; "
            "optional columns are name,level,large_text"
        )
    rows = []
    counts = {"pass": 0, "fail": 0, "error": 0}
    for record, values in enumerate(reader, start=1):
        row = {"record": record, "line": reader.line_num, "cells": values}
        if len(values) != len(header):
            row.update(status="ERROR", error=f"expected {len(header)} cells, got {len(values)}")
        else:
            source = dict(zip(header, values))
            row["name"] = source.get("name", "")
            row["input"] = source
            try:
                selected_level = source.get("level", "").strip() or level
                selected_large = source.get("large_text", "").strip().lower()
                if selected_large not in ("", "true", "false"):
                    raise ValueError("large_text must be true, false, or empty")
                result = evaluate(
                    source["foreground"], source["background"],
                    level=selected_level,
                    large_text=large_text if not selected_large else selected_large == "true",
                )
                row.update(asdict(result))
                row["ratio"] = round(result.ratio, 4)
                row["status"] = "PASS" if result.passes else "FAIL"
            except ValueError as exc:
                row.update(status="ERROR", error=str(exc))
        counts[row["status"].lower()] += 1
        rows.append(row)
    if not rows:
        raise ValueError("CSV must contain at least one color pair")
    return {"rows": rows, "summary": {"total": len(rows), **counts}}


def _print_audit(report: dict, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(report, sort_keys=True))
        return
    for row in report["rows"]:
        name = f" {json.dumps(row['name'])}" if row.get("name") else ""
        prefix = f"{row['status']}: record {row['record']} (line {row['line']}){name}"
        if row["status"] == "ERROR":
            print(f"{prefix}; {row['error']}")
        else:
            kind = "large text" if row["large_text"] else "normal text"
            print(
                f"{prefix}; {row['foreground']} on {row['background']} = "
                f"{row['ratio']:.4f}:1; WCAG {row['level']} {kind} "
                f"requires {row['threshold']:.1f}:1"
            )
    summary = report["summary"]
    print(
        f"TOTAL: {summary['total']}; PASS: {summary['pass']}; "
        f"FAIL: {summary['fail']}; ERROR: {summary['error']}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.csv is not None:
        if args.foreground is not None or args.background is not None:
            parser.error("use either --csv or a foreground/background pair")
        try:
            if args.csv == "-":
                report = audit_csv(sys.stdin, level=args.level, large_text=args.large_text)
            else:
                with open(args.csv, encoding="utf-8-sig", newline="") as stream:
                    report = audit_csv(stream, level=args.level, large_text=args.large_text)
        except (OSError, UnicodeError, csv.Error, ValueError) as exc:
            parser.error(str(exc))
        _print_audit(report, as_json=args.json)
        counts = report["summary"]
        return 2 if counts["error"] else 1 if counts["fail"] else 0
    if args.foreground is None or args.background is None:
        parser.error("provide a foreground/background pair or --csv PATH")
    try:
        result = evaluate(
            args.foreground,
            args.background,
            level=args.level,
            large_text=args.large_text,
        )
    except ValueError as exc:
        parser.error(str(exc))

    if args.json:
        payload = asdict(result)
        payload["ratio"] = round(result.ratio, 4)
        print(json.dumps(payload, sort_keys=True))
    else:
        status = "PASS" if result.passes else "FAIL"
        text_kind = "large text" if result.large_text else "normal text"
        print(
            f"{status}: {result.foreground} on {result.background} = "
            f"{result.ratio:.2f}:1; WCAG {result.level} {text_kind} requires "
            f"{result.threshold:.1f}:1"
        )
    return 0 if result.passes else 1


if __name__ == "__main__":
    sys.exit(main())
