#!/usr/bin/env python3
"""Render a Commons prompt template from a JSON object, entirely offline."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")


def read_values(path: Path) -> dict[str, str]:
    """Read a JSON object whose values are strings."""
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("values JSON must contain one object")

    invalid = sorted(key for key, item in value.items() if not isinstance(key, str) or not isinstance(item, str))
    if invalid:
        raise ValueError("every values entry must have a string key and string value")
    return value


def render(template: str, values: dict[str, str]) -> str:
    """Substitute every documented placeholder exactly once or more."""
    required = set(PLACEHOLDER.findall(template))
    supplied = set(values)
    missing = sorted(required - supplied)
    unused = sorted(supplied - required)
    problems = []
    if missing:
        problems.append("missing values: " + ", ".join(missing))
    if unused:
        problems.append("unused values: " + ", ".join(unused))
    if problems:
        raise ValueError("; ".join(problems))

    return PLACEHOLDER.sub(lambda match: values[match.group(1)], template)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Render a {{PLACEHOLDER}} prompt from a UTF-8 JSON object without network access."
    )
    result.add_argument("template", type=Path, help="UTF-8 prompt template")
    result.add_argument("values", type=Path, help="UTF-8 JSON object with string values")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        template = args.template.read_text(encoding="utf-8")
        values = read_values(args.values)
        output = render(template, values)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    sys.stdout.buffer.write(output.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
