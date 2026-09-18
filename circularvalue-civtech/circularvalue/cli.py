from __future__ import annotations

import argparse
import os
import stat
from pathlib import Path

from .core import CircularValueError, canonical_json, compile_case, loads_strict, verify_packet
from .demo import synthetic_case

MAX_INPUT_BYTES = 1_048_576
_READ_CHUNK_BYTES = 65_536


def _read(path: str) -> dict:
    p = Path(path)
    before = p.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise CircularValueError("input must be a regular non-symlink file")
    if before.st_size > MAX_INPUT_BYTES:
        raise CircularValueError(f"input exceeds {MAX_INPUT_BYTES} bytes")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(p, flags)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode):
            raise CircularValueError("input must remain a regular file")
        if before.st_dev != opened.st_dev or before.st_ino != opened.st_ino:
            raise CircularValueError("input changed during admission")
        if opened.st_size > MAX_INPUT_BYTES:
            raise CircularValueError(f"input exceeds {MAX_INPUT_BYTES} bytes")

        chunks: list[bytes] = []
        remaining = MAX_INPUT_BYTES + 1
        while remaining:
            chunk = os.read(fd, min(_READ_CHUNK_BYTES, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > MAX_INPUT_BYTES:
            raise CircularValueError(f"input exceeds {MAX_INPUT_BYTES} bytes")
    finally:
        os.close(fd)

    try:
        data = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CircularValueError("input must be valid UTF-8") from exc
    value = loads_strict(data)
    if type(value) is not dict:
        raise CircularValueError("top-level JSON must be object")
    return value


def _require_absent_output(path: Path) -> None:
    try:
        path.lstat()
    except FileNotFoundError:
        return
    raise CircularValueError(f"refusing existing output path: {path}")


def _write_new(path: Path, text: str) -> None:
    data = text.encode("utf-8")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    fd = os.open(path, flags, 0o600)
    try:
        offset = 0
        while offset < len(data):
            written = os.write(fd, data[offset:])
            if written <= 0:
                raise OSError("short output write")
            offset += written
    finally:
        os.close(fd)


def _prepare_output_dir(path: Path) -> Path:
    try:
        current = path.lstat()
    except FileNotFoundError:
        path.mkdir(parents=True, exist_ok=False)
        current = path.lstat()
    if not stat.S_ISDIR(current.st_mode):
        raise CircularValueError("demo output directory must be a real directory, not a symlink or special file")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="circularvalue")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compile")
    c.add_argument("case")
    c.add_argument("--out", required=True)
    v = sub.add_parser("verify")
    v.add_argument("case")
    v.add_argument("packet")
    d = sub.add_parser("demo")
    d.add_argument("--out-dir", required=True)
    ns = parser.parse_args(argv)
    try:
        if ns.cmd == "compile":
            case = _read(ns.case)
            packet = compile_case(case)
            out = Path(ns.out)
            _require_absent_output(out)
            _write_new(out, canonical_json(packet) + "\n")
            print(packet["decisionSupportState"], packet["packetSha256"])
            return 0
        if ns.cmd == "verify":
            case = _read(ns.case)
            packet = _read(ns.packet)
            ok = verify_packet(case, packet)
            print("VALID" if ok else "INVALID")
            return 0 if ok else 2
        out = _prepare_output_dir(Path(ns.out_dir))
        case = synthetic_case()
        packet = compile_case(case)
        case_path = out / "case.json"
        packet_path = out / "packet.json"
        _require_absent_output(case_path)
        _require_absent_output(packet_path)
        _write_new(case_path, canonical_json(case) + "\n")
        _write_new(packet_path, canonical_json(packet) + "\n")
        print(case_path)
        print(packet_path)
        print(packet["decisionSupportState"], packet["packetSha256"])
        return 0
    except (OSError, CircularValueError) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
