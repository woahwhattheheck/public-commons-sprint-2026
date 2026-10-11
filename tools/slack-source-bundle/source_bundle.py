#!/usr/bin/env python3
"""MIT. Offline, byte-exact source delivery through a whitespace-changing Canvas."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import textwrap
import unicodedata
import zlib

FORMAT = "tjl-source-bundle/v1"
START = "TJL_SOURCE_BUNDLE_V1"
END = "TJL_SOURCE_BUNDLE_END"
MAX_BYTES = 16 * 1024 * 1024
MAX_ENVELOPE = 32 * 1024 * 1024
MAX_FILES = 256
META = ".tjl-source-manifest.json"
HEX = re.compile(r"[0-9a-f]{64}\Z")


class BundleError(ValueError):
    """Invalid or incomplete source bundle; no payload is ever executed."""


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise BundleError(reason)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_path(value: str) -> str:
    require(isinstance(value, str) and 0 < len(value) <= 512, "INVALID_PATH")
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.as_posix() == value, "NONCANONICAL_PATH")
    for part in path.parts:
        require(part.casefold() not in {".", "..", ".git", META} and not part.endswith((".", " ")),
                "UNSAFE_PATH")
        require(not any(ord(c) < 32 or ord(c) == 127 or c in '<>:"\\|?*' for c in part),
                "UNSAFE_PATH_CHARACTER")
        require(part.split(".")[0].upper() not in
                {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(10)), *(f"LPT{i}" for i in range(10))},
                "RESERVED_DEVICE_PATH")
    require(bool(path.parts), "EMPTY_PATH")
    return value


def unique_paths(paths: list[str]) -> None:
    seen: set[str] = set()
    for path in sorted(paths):
        key = unicodedata.normalize("NFC", safe_path(path)).casefold()
        require(key not in seen, "DUPLICATE_PATH")
        seen.add(key)
    for key in seen:
        require(not any(parent.as_posix() in seen for parent in PurePosixPath(key).parents
                        if parent.as_posix() != "."), "FILE_DIRECTORY_COLLISION")


def canonical(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")


def no_duplicate_keys(pairs: list[tuple]) -> dict:
    result: dict = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def pack(root: Path, paths: list[str], base: str = "") -> tuple[str, dict]:
    """Read ONLY explicitly named regular files from a trusted, quiescent root."""
    require(isinstance(base, str) and len(base) <= 200 and all(32 <= ord(c) < 127 for c in base),
            "INVALID_BASE_DESCRIPTION")
    require(0 < len(paths) <= MAX_FILES, "INVALID_FILE_COUNT")
    unique_paths(paths)
    root = root.resolve(strict=True)
    require(root.is_dir(), "ROOT_NOT_DIRECTORY")
    entries = []
    total = 0
    for name in sorted(paths):
        path = root
        for part in PurePosixPath(name).parts:
            path = path / part
            require(not path.is_symlink(), "SYMLINK_SOURCE")
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode), "SOURCE_NOT_REGULAR_FILE")
        flags = (os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
                 | getattr(os, "O_BINARY", 0))
        with os.fdopen(os.open(path, flags), "rb") as handle:
            opened = os.fstat(handle.fileno())
            require(stat.S_ISREG(opened.st_mode) and (opened.st_dev, opened.st_ino) ==
                    (info.st_dev, info.st_ino), "SOURCE_CHANGED_DURING_OPEN")
            data = handle.read(MAX_BYTES + 1)
        total += len(data)
        require(total <= MAX_BYTES, "SOURCE_TOO_LARGE")
        entries.append({"path": name, "mode": 0o755 if info.st_mode & 0o111 else 0o644,
                        "bytes": len(data), "sha256": digest(data),
                        "content": base64.b64encode(data).decode("ascii")})
    raw = canonical({"format": FORMAT, "base": base, "files": entries})
    require(len(raw) <= MAX_BYTES, "MANIFEST_TOO_LARGE")
    sha = digest(raw)
    encoded = base64.b64encode(zlib.compress(raw, 9)).decode("ascii")
    envelope = f"{START} {sha} {len(raw)}\n" + "\n".join(textwrap.wrap(encoded, 100)) + f"\n{END}\n"
    return envelope, {"sha256": sha, "manifest_bytes": len(raw), "source_bytes": total,
                      "files": len(entries), "base": base}


def decode(text: str, expected_sha256: str) -> tuple[dict, list[tuple[dict, bytes]]]:
    """Verify complete bytes and metadata before creating any output directory."""
    require(isinstance(expected_sha256, str) and HEX.fullmatch(expected_sha256), "EXPECTED_SHA256_REQUIRED")
    require(len(text.encode("utf-8")) <= MAX_ENVELOPE, "ENVELOPE_TOO_LARGE")
    require(text.count(START) == 1 and text.count(END) == 1, "EXACTLY_ONE_ENVELOPE_REQUIRED")
    match = re.search(rf"{START}\s+([0-9a-f]{{64}})\s+([0-9]{{1,8}})\s+([\s\S]*?){END}", text)
    require(match is not None, "INCOMPLETE_ENVELOPE")
    advertised, raw_size, payload = match.groups()
    require(advertised == expected_sha256, "EXPECTED_DIGEST_MISMATCH")
    require(0 < int(raw_size) <= MAX_BYTES, "INVALID_MANIFEST_SIZE")
    # Only the printable transport is whitespace-insensitive. Source bytes,
    # including genuine NBSP/CRLF/tabs and consecutive blank lines, stay opaque.
    encoded = "".join(payload.split())
    compressed = base64.b64decode(encoded, validate=True)
    require(base64.b64encode(compressed).decode("ascii") == encoded, "NONCANONICAL_BASE64")
    inflater = zlib.decompressobj()
    raw = inflater.decompress(compressed, MAX_BYTES + 1)
    require(len(raw) <= MAX_BYTES and not inflater.unconsumed_tail, "EXPANDED_SIZE_LIMIT")
    require(inflater.eof and not inflater.unused_data, "TRUNCATED_OR_TRAILING_COMPRESSED_DATA")
    require(len(raw) == int(raw_size) and digest(raw) == expected_sha256, "PAYLOAD_DIGEST_MISMATCH")
    manifest = json.loads(raw, object_pairs_hook=no_duplicate_keys)
    require(isinstance(manifest, dict) and set(manifest) == {"format", "base", "files"}, "INVALID_MANIFEST")
    require(manifest["format"] == FORMAT and isinstance(manifest["base"], str)
            and len(manifest["base"]) <= 200 and all(32 <= ord(c) < 127 for c in manifest["base"]),
            "INVALID_FORMAT_OR_BASE")
    files = manifest["files"]
    require(isinstance(files, list) and 0 < len(files) <= MAX_FILES, "INVALID_FILE_COUNT")
    unpacked = []
    total = 0
    for item in files:
        require(isinstance(item, dict) and set(item) == {"path", "mode", "bytes", "sha256", "content"},
                "INVALID_FILE_RECORD")
        safe_path(item["path"])
        require(type(item["mode"]) is int and item["mode"] in (0o644, 0o755), "INVALID_FILE_MODE")
        require(type(item["bytes"]) is int and 0 <= item["bytes"] <= MAX_BYTES, "INVALID_FILE_SIZE")
        require(isinstance(item["sha256"], str) and HEX.fullmatch(item["sha256"])
                and isinstance(item["content"], str), "INVALID_FILE_HASH_OR_ENCODING")
        data = base64.b64decode(item["content"], validate=True)
        require(base64.b64encode(data).decode("ascii") == item["content"], "NONCANONICAL_FILE_ENCODING")
        require(len(data) == item["bytes"] and digest(data) == item["sha256"], "FILE_DIGEST_MISMATCH")
        total += len(data)
        require(total <= MAX_BYTES, "SOURCE_TOO_LARGE")
        unpacked.append((item, data))
    unique_paths([item["path"] for item, _ in unpacked])
    return manifest, unpacked


def inspect_bundle(text: str, sha: str) -> dict:
    manifest, files = decode(text, sha)
    return {"sha256": sha, "base": manifest["base"], "files": [
        {key: value for key, value in item.items() if key != "content"} for item, _ in files]}


def unpack(text: str, sha: str, parent: Path) -> Path:
    manifest, files = decode(text, sha)
    parent = parent.resolve(strict=True)
    require(parent.is_dir(), "PARENT_NOT_DIRECTORY")
    # Never target an existing checkout or output directory. mkdtemp creates a
    # unique private container first; no symlinks or archive extraction helpers.
    output = Path(tempfile.mkdtemp(prefix="tjl-source-", dir=parent))
    try:
        for item, data in files:
            target = output.joinpath(*PurePosixPath(item["path"]).parts)
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open("xb") as handle:
                handle.write(data)
            target.chmod(item["mode"])
            require(digest(target.read_bytes()) == item["sha256"], "WRITTEN_FILE_DIGEST_MISMATCH")
        summary = {"sha256": sha, "base": manifest["base"], "files": [
            {key: value for key, value in item.items() if key != "content"} for item, _ in files]}
        (output / META).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    except BaseException:
        shutil.rmtree(output)
        raise
    return output


def read_envelope(path: str) -> str:
    with open(path, "rb") as handle:
        data = handle.read(MAX_ENVELOPE + 1)
    require(len(data) <= MAX_ENVELOPE, "ENVELOPE_TOO_LARGE")
    return data.decode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("pack", help="Explicit files to a printable envelope; inspect files before sharing")
    make.add_argument("--root", type=Path, required=True)
    make.add_argument("--base", default="", help="Informational source commit/ref; not automatic patch application")
    make.add_argument("--output", default="-", help="New output file or - for stdout; never overwrite")
    make.add_argument("paths", nargs="+")
    for name in ("verify", "unpack"):
        command = commands.add_parser(name)
        command.add_argument("envelope", help="UTF-8 Canvas markdown or envelope file containing exactly one bundle")
        command.add_argument("--sha256", required=True, help="Original digest obtained separately from the sender")
        if name == "unpack":
            command.add_argument("--parent", type=Path, default=Path.cwd(), help="Existing trusted parent for a NEW private directory")
    args = parser.parse_args()
    try:
        if args.command == "pack":
            text, result = pack(args.root, args.paths, args.base)
            if args.output == "-":
                sys.stdout.write(text)
            else:
                with open(args.output, "x", encoding="ascii", newline="\n") as handle:
                    handle.write(text)
            print(json.dumps(result), file=sys.stderr)
        else:
            text = read_envelope(args.envelope)
            if args.command == "verify":
                print(json.dumps(inspect_bundle(text, args.sha256), indent=2))
            else:
                print(json.dumps({"output": str(unpack(text, args.sha256, args.parent)), "sha256": args.sha256}))
    except (OSError, ValueError, TypeError, zlib.error, RecursionError) as error:
        print(f"source-bundle: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
