#!/usr/bin/env python3
"""Fail closed when a public repository surface links back to internal Commons infrastructure."""

from __future__ import annotations

import argparse
import html
import os
from pathlib import Path
import sys
import unicodedata
from urllib.parse import unquote

TEXT_SUFFIXES = frozenset(
    {
        ".cfg",
        ".css",
        ".htm",
        ".html",
        ".ini",
        ".js",
        ".json",
        ".jsonl",
        ".jsx",
        ".md",
        ".mdx",
        ".ps1",
        ".py",
        ".sh",
        ".sql",
        ".toml",
        ".ts",
        ".tsx",
        ".txt",
        ".yaml",
        ".yml",
    }
)

SKIP_DIRS = frozenset(
    {
        ".git",
        ".next",
        ".pytest_cache",
        ".venv",
        "__pycache__",
        "coverage",
        "dist",
        "node_modules",
        "vendor",
    }
)

# Build markers from fragments so the guard does not flag its own source.
FORBIDDEN_MARKERS = (
    ("commons-repository", "woahwhattheheck" + "/commons"),
    ("commons-pages", "woahwhattheheck.github.io" + "/commons"),
    ("legacy-commons-mcp", "commons-spark-mcp" + ".vercel.app"),
)


def normalized_for_scan(text: str) -> str:
    """Normalize ordinary URL/text obfuscations before marker matching."""
    value = unicodedata.normalize("NFKC", text)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Cf")
    value = html.unescape(value)
    # Two decoding passes catch common nested percent encoding without
    # turning this into an unbounded decoder.
    value = unquote(unquote(value))
    return value.casefold()


def iter_text_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        base = Path(dirpath)
        for filename in sorted(filenames):
            path = base / filename
            if path.suffix.casefold() in TEXT_SUFFIXES:
                yield path


def scan_root(root: Path):
    root = root.resolve()
    violations: list[tuple[str, int, str]] = []
    checked = 0

    for path in iter_text_files(root):
        checked += 1
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            rel = path.relative_to(root).as_posix()
            violations.append((rel, 0, "non-utf8-public-text"))
            continue

        for lineno, line in enumerate(text.splitlines(), 1):
            candidate = normalized_for_scan(line)
            for label, marker in FORBIDDEN_MARKERS:
                if marker.casefold() in candidate:
                    rel = path.relative_to(root).as_posix()
                    violations.append((rel, lineno, label))

    return checked, violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reject public-surface references to internal Commons infrastructure."
    )
    parser.add_argument("--root", default=".", help="repository root (default: current directory)")
    args = parser.parse_args(argv)

    root = Path(args.root)
    checked, violations = scan_root(root)
    if violations:
        print("external-surface-isolation: FAIL", file=sys.stderr)
        for path, lineno, label in violations:
            location = f"{path}:{lineno}" if lineno else path
            print(f"  {location}: {label}", file=sys.stderr)
        return 1

    print(f"external-surface-isolation: PASS ({checked} text files checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
