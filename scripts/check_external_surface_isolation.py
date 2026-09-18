#!/usr/bin/env python3
"""Fail closed when a public repository surface links back to internal Commons infrastructure."""

from __future__ import annotations

import argparse
import html
import hashlib
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
        ".svg",
        ".toml",
        ".ts",
        ".tsx",
        ".txt",
        ".xml",
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
    ("internal-slack-archive", "tokenjunkielabs.slack.com" + "/archives/"),
)


ASCII_ESCAPE_RE = re.compile(r"\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))")


def _decode_source_ascii_escapes(value: str) -> str:
    """Decode bounded source escapes that can hide ASCII URL/path markers."""

    def replace(match: re.Match[str]) -> str:
        digits = match.group(1) or match.group(2) or match.group(3)
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
        value = value.replace("\\/", "/").replace("\\", "/")
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
    def walk_error(error: OSError) -> None:
        location = getattr(error, "filename", None) or root
        raise ScanError(f"cannot traverse public directory: {location}") from error

    for dirpath, dirnames, filenames in os.walk(
        root, topdown=True, onerror=walk_error, followlinks=False
    ):
        base = Path(dirpath)
        retained_dirs: list[str] = []
        for dirname in sorted(dirnames):
            if dirname in SKIP_DIRS:
                continue
            directory = base / dirname
            try:
                info = directory.lstat()
            except OSError as exc:
                raise ScanError(f"cannot stat public directory: {directory}") from exc
            if stat.S_ISLNK(info.st_mode):
                raise ScanError(f"symlinked public directory: {directory}")
            retained_dirs.append(dirname)
        dirnames[:] = retained_dirs
        for filename in sorted(filenames):
            path = base / filename
            if (
                path.suffix.casefold() in TEXT_SUFFIXES
                or filename.casefold() in TEXT_FILENAMES
            ):
                yield path


def marker_present(candidate: str, marker: str) -> bool:
    """Match an internal target without suffix/prefix owner-name false positives."""
    marker = marker.casefold()
    start = 0
    ident = frozenset("abcdefghijklmnopqrstuvwxyz0123456789._-")
    while True:
        at = candidate.find(marker, start)
        if at < 0:
            return False
        left = candidate[at - 1] if at else ""
        if left and left in ident:
            start = at + 1
            continue

        end = at + len(marker)
        if marker.endswith("/"):
            return True
        if end == len(candidate):
            return True

        tail = candidate[end:]
        if tail.startswith(".git"):
            after_git = end + 4
            if after_git == len(candidate) or candidate[after_git] not in ident:
                return True

        if candidate[end] not in ident:
            return True
        start = at + 1


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
            violations.append((rel, 0, "unscannable-public-text"))
            continue

        for lineno, line in enumerate(text.splitlines(), 1):
            rel = path.relative_to(root).as_posix()
            try:
                candidate = normalized_for_scan(line)
            except ScanError as exc:
                violations.append((rel, lineno, f"unscannable-public-line:{exc}"))
                continue
            for label, marker in FORBIDDEN_MARKERS:
                if marker_present(candidate, marker):
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
        print("external-surface-isolation: FAIL (scan-incomplete)", file=sys.stderr)
        return 2
    if violations:
        print("external-surface-isolation: FAIL", file=sys.stderr)
        for path, lineno, label in violations:
            path_id = hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]
            location = f"path_sha256={path_id} line={lineno}" if lineno else f"path_sha256={path_id}"
            print(f"  {location}: {label}", file=sys.stderr)
        return 1

    print(f"external-surface-isolation: PASS ({checked} text files checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
