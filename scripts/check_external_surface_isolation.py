#!/usr/bin/env python3
"""Fail closed when a public repository surface links back to internal Commons infrastructure."""

from __future__ import annotations

import argparse
import html
import os
import re
from pathlib import Path
import sys
import stat
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

TEXT_FILENAMES = frozenset({"dockerfile", "makefile", "procfile", "readme", "license"})
MAX_TEXT_BYTES = 4 * 1024 * 1024
MAX_NORMALIZATION_PASSES = 4


class ScanError(RuntimeError):
    """The scan could not establish a complete public-text result."""


# Build markers from fragments so the guard does not flag its own source.
FORBIDDEN_MARKERS = (
    ("commons-repository", "woahwhattheheck" + "/commons"),
    ("commons-pages", "woahwhattheheck.github.io" + "/commons"),
    ("legacy-commons-mcp", "commons-spark-mcp" + ".vercel.app"),
)


ASCII_ESCAPE_RE = re.compile(r"\\\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))")


def _decode_source_ascii_escapes(value: str) -> str:
    """Decode bounded source escapes that can hide ASCII URL/path markers."""

    def replace(match: re.Match[str]) -> str:
        digits = match.group(1) or match.group(2)
        codepoint = int(digits, 16)
        return chr(codepoint) if codepoint <= 0x7F else match.group(0)

    return ASCII_ESCAPE_RE.sub(replace, value)


def normalized_for_scan(text: str) -> str:
    """Normalize bounded layers of ordinary URL/text/source obfuscation."""
    value = text
    for _ in range(MAX_NORMALIZATION_PASSES):
        previous = value
        value = html.unescape(value)
        value = unquote(value)
        value = _decode_source_ascii_escapes(value)
        value = unicodedata.normalize("NFKC", value)
        value = "".join(ch for ch in value if unicodedata.category(ch) != "Cf")
        value = value.replace("\\", "/")
        if value == previous:
            return value.casefold()
    raise ScanError("normalization pass limit exceeded")


def _fingerprint(info: os.stat_result) -> tuple[int, int, int, int]:
    return (
        int(info.st_dev),
        int(info.st_ino),
        int(info.st_size),
        int(getattr(info, "st_mtime_ns", int(info.st_mtime * 1_000_000_000))),
    )


def _read_public_text(path: Path) -> str:
    try:
        visible_before = path.lstat()
    except OSError as exc:
        raise ScanError(f"cannot stat public text path: {path}") from exc
    if stat.S_ISLNK(visible_before.st_mode):
        raise ScanError(f"symlinked public text path: {path}")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ScanError(f"cannot open public text path: {path}") from exc

    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ScanError(f"public text path is not a regular file: {path}")
        if before.st_size > MAX_TEXT_BYTES:
            raise ScanError(f"public text file exceeds {MAX_TEXT_BYTES} bytes: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(fd, min(65536, MAX_TEXT_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_TEXT_BYTES:
                raise ScanError(f"public text file exceeds {MAX_TEXT_BYTES} bytes: {path}")
        after = os.fstat(fd)
        if _fingerprint(before) != _fingerprint(after):
            raise ScanError(f"public text file changed during scan: {path}")
    finally:
        os.close(fd)

    try:
        visible_after = path.lstat()
    except OSError as exc:
        raise ScanError(f"public text path disappeared during scan: {path}") from exc
    if stat.S_ISLNK(visible_after.st_mode):
        raise ScanError(f"public text path reminted as symlink: {path}")
    if _fingerprint(visible_after) != _fingerprint(before):
        raise ScanError(f"public text path generation changed during scan: {path}")

    raw = b"".join(chunks)
    try:
        return raw.decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        raise ScanError(f"non-UTF-8 public text: {path}") from exc

def iter_text_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        base = Path(dirpath)
        for filename in sorted(filenames):
            path = base / filename
            if (
                path.suffix.casefold() in TEXT_SUFFIXES
                or filename.casefold() in TEXT_FILENAMES
            ):
                yield path


def scan_root(root: Path):
    root = root.resolve()
    if not root.exists():
        raise ScanError(f"scan root does not exist: {root}")
    if not root.is_dir():
        raise ScanError(f"scan root is not a directory: {root}")

    violations: list[tuple[str, int, str]] = []
    checked = 0

    for path in iter_text_files(root):
        checked += 1
        try:
            text = _read_public_text(path)
        except ScanError as exc:
            rel = path.relative_to(root).as_posix()
            violations.append((rel, 0, f"unscannable-public-text:{exc}"))
            continue

        for lineno, line in enumerate(text.splitlines(), 1):
            rel = path.relative_to(root).as_posix()
            try:
                candidate = normalized_for_scan(line)
            except ScanError as exc:
                violations.append((rel, lineno, f"unscannable-public-line:{exc}"))
                continue
            for label, marker in FORBIDDEN_MARKERS:
                if marker.casefold() in candidate:
                    violations.append((rel, lineno, label))

    return checked, violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reject public-surface references to internal Commons infrastructure."
    )
    parser.add_argument("--root", default=".", help="repository root (default: current directory)")
    args = parser.parse_args(argv)

    root = Path(args.root)
    try:
        checked, violations = scan_root(root)
    except ScanError as exc:
        print(f"external-surface-isolation: FAIL ({exc})", file=sys.stderr)
        return 2
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
