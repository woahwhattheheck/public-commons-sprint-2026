from __future__ import annotations

import argparse
import os
import stat
from pathlib import Path

from .core import CircularValueError, canonical_json, compile_case, loads_strict, verify_packet
from .demo import synthetic_case

MAX_JSON_BYTES = 4 * 1024 * 1024
_READ_CHUNK = 64 * 1024


def _same_identity(before: os.stat_result, after: os.stat_result) -> bool:
    before_id = (getattr(before, "st_dev", None), getattr(before, "st_ino", None))
    after_id = (getattr(after, "st_dev", None), getattr(after, "st_ino", None))
    if None in before_id or None in after_id:
        return True
    return before_id == after_id


def _read(path: str) -> dict:
    p = Path(path)
    try:
        before = p.lstat()
    except OSError as exc:
        raise CircularValueError(f"cannot inspect input: {exc}") from exc
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise CircularValueError("input must be a regular non-symlink file")
    if before.st_size > MAX_JSON_BYTES:
        raise CircularValueError(f"input exceeds {MAX_JSON_BYTES} byte limit")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(p, flags)
    except OSError as exc:
        raise CircularValueError(f"cannot open input safely: {exc}") from exc
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode):
            raise CircularValueError("input must remain a regular file")
        if not _same_identity(before, opened):
            raise CircularValueError("input changed while being opened")
        if opened.st_size > MAX_JSON_BYTES:
            raise CircularValueError(f"input exceeds {MAX_JSON_BYTES} byte limit")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(fd, min(_READ_CHUNK, MAX_JSON_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_JSON_BYTES:
                raise CircularValueError(f"input exceeds {MAX_JSON_BYTES} byte limit")
    finally:
        os.close(fd)

    try:
        data = b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CircularValueError("input must be UTF-8") from exc
    value = loads_strict(data)
    if type(value) is not dict:
        raise CircularValueError("top-level JSON must be object")
    return value


def _open_new(path: Path) -> int:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    return os.open(path, flags, 0o600)


def _write_fd(fd: int, text: str) -> None:
    data = text.encode("utf-8")
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("short write")
        view = view[written:]


def _write_new(path: Path, text: str) -> None:
    fd = _open_new(path)
    try:
        _write_fd(fd, text)
    finally:
        os.close(fd)


def _prepare_demo_dir(path: Path) -> None:
    try:
        existing = path.lstat()
    except FileNotFoundError:
        path.mkdir(parents=True, exist_ok=False)
        existing = path.lstat()
    if stat.S_ISLNK(existing.st_mode) or not stat.S_ISDIR(existing.st_mode):
        raise CircularValueError("demo output directory must be a real directory, not a symlink")


def _unlink_if_same(path: Path, fd: int) -> None:
    try:
        current = path.lstat()
        opened = os.fstat(fd)
    except OSError:
        return
    if stat.S_ISREG(current.st_mode) and _same_identity(current, opened):
        try:
            path.unlink()
        except OSError:
            pass


def _write_demo_pair(out: Path, case_text: str, packet_text: str) -> tuple[Path, Path]:
    case_path = out / "case.json"
    packet_path = out / "packet.json"
    case_fd: int | None = None
    packet_fd: int | None = None
    try:
        case_fd = _open_new(case_path)
        try:
            packet_fd = _open_new(packet_path)
        except Exception:
            _unlink_if_same(case_path, case_fd)
            os.close(case_fd)
            case_fd = None
            raise
        _write_fd(case_fd, case_text)
        _write_fd(packet_fd, packet_text)
    finally:
        if case_fd is not None:
            os.close(case_fd)
        if packet_fd is not None:
            os.close(packet_fd)
    return case_path, packet_path


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
            _write_new(Path(ns.out), canonical_json(packet) + "\n")
            print(packet["decisionSupportState"], packet["packetSha256"])
            return 0
        if ns.cmd == "verify":
            case = _read(ns.case)
            packet = _read(ns.packet)
            ok = verify_packet(case, packet)
            print("VALID" if ok else "INVALID")
            return 0 if ok else 2
        out = Path(ns.out_dir)
        _prepare_demo_dir(out)
        case = synthetic_case()
        packet = compile_case(case)
        case_path, packet_path = _write_demo_pair(
            out,
            canonical_json(case) + "\n",
            canonical_json(packet) + "\n",
        )
        print(case_path)
        print(packet_path)
        print(packet["decisionSupportState"], packet["packetSha256"])
        return 0
    except (OSError, CircularValueError) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
