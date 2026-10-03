"""Persistent local operator commands for ProofTreasury paper records."""
from __future__ import annotations

import argparse
import os
import sqlite3
import stat
import sys
from pathlib import Path

from . import core

TABLE = "CREATE TABLE events (number INTEGER PRIMARY KEY, document TEXT NOT NULL)"
MAX_LEDGER_BYTES = 64 * 1024 * 1024
MAX_JOURNAL_BYTES = 32 * 1024 * 1024


def read_regular(path: str | Path, limit: int = core.MAX_BYTES) -> str:
    path = str(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            core.fail("INPUT_NOT_BOUNDED_REGULAR_FILE")
        chunks, size = [], 0
        while True:
            part = os.read(fd, min(65536, limit + 1 - size))
            if not part:
                break
            chunks.append(part)
            size += len(part)
            if size > limit:
                core.fail("INPUT_TOO_LARGE")
        after = os.fstat(fd)
        named = os.stat(path, follow_symlinks=False)
        signature = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_size,
                                  item.st_mtime_ns, item.st_ctime_ns)
        if size != before.st_size or signature(before) != signature(after) or signature(after) != signature(named):
            core.fail("INPUT_GENERATION_CHANGED")
        return b"".join(chunks).decode("utf-8", "strict")
    finally:
        os.close(fd)


def write_new(path: str | Path, text: str) -> None:
    data = text.encode("utf-8", "strict")
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    owned = os.fstat(fd)
    try:
        remaining = memoryview(data)
        while remaining:
            count = os.write(fd, remaining)
            if count <= 0:
                core.fail("OUTPUT_SHORT_WRITE")
            remaining = remaining[count:]
        os.fsync(fd)
    except BaseException:
        try:
            current = os.stat(path, follow_symlinks=False)
            if (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino):
                os.unlink(path)
        except FileNotFoundError:
            pass
        raise
    finally:
        os.close(fd)


def connect(path: str, *, write: bool = False) -> sqlite3.Connection:
    info = os.stat(path, follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_LEDGER_BYTES:
        core.fail("LEDGER_NOT_BOUNDED_REGULAR_FILE")
    uri = Path(path).absolute().as_uri() + ("?mode=rw" if write else "?mode=ro")
    db = sqlite3.connect(uri, uri=True, timeout=5, isolation_level=None)
    try:
        db.execute("PRAGMA trusted_schema=OFF")
        schema = db.execute("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if schema != [("table", "events", TABLE)]:
            core.fail("LEDGER_SCHEMA_MISMATCH")
        db.execute("PRAGMA synchronous=FULL")
        return db
    except BaseException:
        db.close()
        raise


def read_events(db: sqlite3.Connection) -> list[dict]:
    count = db.execute("SELECT count(*) FROM events").fetchone()[0]
    if not 1 <= count <= 10000:
        core.fail("EVENT_COUNT_INVALID")
    events = []
    for expected, (number, document) in enumerate(db.execute("SELECT number, document FROM events ORDER BY number"), 1):
        if number != expected or type(document) is not str:
            core.fail("EVENT_SEQUENCE_INVALID")
        item = core.load_json(document)
        if type(item) is not dict or item.get("number") != number:
            core.fail("EVENT_SEQUENCE_INVALID")
        events.append(item)
    return events


def create_ledger(path: str, first: dict) -> dict:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    owned = os.fstat(fd)
    os.close(fd)
    db = None
    try:
        db = sqlite3.connect(Path(path).absolute().as_uri() + "?mode=rw", uri=True,
                             timeout=5, isolation_level=None)
        db.execute("PRAGMA synchronous=FULL")
        db.execute("BEGIN IMMEDIATE")
        db.execute(TABLE)
        db.execute("INSERT INTO events(number, document) VALUES (?, ?)", (1, core.canonical(first)))
        state = core.replay(read_events(db))
        db.execute("COMMIT")
        return state
    except BaseException:
        if db is not None:
            db.close()
            db = None
        try:
            current = os.stat(path, follow_symlinks=False)
            if (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino):
                os.unlink(path)
        except FileNotFoundError:
            pass
        raise
    finally:
        if db is not None:
            db.close()


def read_ledger(path: str) -> tuple[list[dict], dict]:
    db = connect(path)
    try:
        db.execute("BEGIN")
        events = read_events(db)
        return events, core.replay(events)
    finally:
        db.close()


def append(path: str, action: str, at: str, payload: dict) -> dict:
    core.utc(at)
    db = connect(path, write=True)
    try:
        db.execute("BEGIN IMMEDIATE")
        events = read_events(db)
        state = core.replay(events)
        if state["count"] >= 10000:
            core.fail("EVENT_LIMIT_REACHED")
        result = core.transition(state, action, at, payload)
        item = core.event(state["count"] + 1, state["head_sha256"], action, at, payload, result)
        db.execute("INSERT INTO events(number, document) VALUES (?, ?)", (item["number"], core.canonical(item)))
        core.apply_event(state, item)
        db.execute("COMMIT")
        return state
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()


def bundle_files(events: list[dict], state: dict) -> dict[str, str]:
    files = {"source.json": state["input_text"], "proposal.json": core.canonical(state["proposal"]) + "\n",
             "journal.jsonl": "".join(core.canonical(item) + "\n" for item in events),
             "review.md": core.report(state)}
    receipt = {"schema": "proof-treasury.bundle/v1", **core.AUTHORITY,
               "head_sha256": state["head_sha256"], "event_count": state["count"],
               "core_source_sha256": core.source_digest(),
               "files": {name: {"sha256": core.sha256(text.encode("utf-8")),
                                "bytes": len(text.encode("utf-8"))} for name, text in sorted(files.items())}}
    files["receipt.json"] = core.canonical(receipt) + "\n"
    return files


def write_bundle(path: str, files: dict[str, str]) -> None:
    os.mkdir(path, 0o700)
    written = []
    try:
        for name, text in files.items():
            destination = Path(path) / name
            write_new(destination, text)
            info = destination.stat(follow_symlinks=False)
            written.append((destination, info.st_dev, info.st_ino))
    except BaseException:
        for destination, dev, ino in written:
            try:
                info = destination.stat(follow_symlinks=False)
                if (info.st_dev, info.st_ino) == (dev, ino):
                    destination.unlink()
            except FileNotFoundError:
                pass
        try:
            os.rmdir(path)
        except OSError:
            pass
        raise


def verify_bundle(path: str) -> dict:
    root = Path(path)
    if root.is_symlink() or not root.is_dir():
        core.fail("BUNDLE_NOT_DIRECTORY")
    names = {"source.json", "proposal.json", "journal.jsonl", "review.md", "receipt.json"}
    if {p.name for p in root.iterdir()} != names:
        core.fail("BUNDLE_MEMBERSHIP_MISMATCH")
    journal = read_regular(root / "journal.jsonl", MAX_JOURNAL_BYTES)
    lines = journal.splitlines()
    if not 1 <= len(lines) <= 10000:
        core.fail("EVENT_COUNT_INVALID")
    events = [core.load_json(line) for line in lines]
    state = core.replay(events)
    expected = bundle_files(events, state)
    for name, text in expected.items():
        actual = journal if name == "journal.jsonl" else read_regular(root / name)
        if actual != text:
            core.fail("BUNDLE_REPLAY_MISMATCH", name)
    return state


def expected_head(state: dict, expected: str | None) -> None:
    if expected is not None and expected != state["head_sha256"]:
        core.fail("EXPECTED_HEAD_MISMATCH")


def arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    example = commands.add_parser("template", help="Write an explicitly fictional editable paper case")
    example.add_argument("--out", required=True)
    example.add_argument("--at", required=True)
    propose = commands.add_parser("propose", help="Review an exact input and create a new paper ledger")
    propose.add_argument("input")
    propose.add_argument("--at", required=True)
    propose.add_argument("--ledger", required=True)
    for command in ("inspect", "verify", "export", "confirm", "paper-execute"):
        sub = commands.add_parser(command)
        sub.add_argument("ledger")
        if command == "verify":
            sub.add_argument("--expected-head-sha256")
        if command == "export":
            sub.add_argument("--out", required=True)
        if command in ("confirm", "paper-execute"):
            sub.add_argument("--at", required=True)
            sub.add_argument("--proposal-sha256" if command == "confirm" else "--confirmation-sha256", required=True)
    verify = commands.add_parser("verify-bundle")
    verify.add_argument("directory")
    verify.add_argument("--expected-head-sha256")
    fetch = commands.add_parser("fetch-snapshot", help="Read-only SoSoValue capture; a configured key is required")
    fetch.add_argument("--asset", action="append", required=True)
    fetch.add_argument("--quote-scale", type=int, required=True)
    fetch.add_argument("--cache", required=True)
    fetch.add_argument("--json-out", required=True)
    fragment = commands.add_parser("import-snapshot-fragment", help="Retain an unbound supplied API-format fragment")
    fragment.add_argument("--response", required=True)
    fragment.add_argument("--quote-scale", type=int, required=True)
    fragment.add_argument("--cache", required=True)
    fragment.add_argument("--json-out", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = arguments(argv)
    try:
        if args.command == "template":
            write_new(args.out, core.canonical(core.template(args.at)) + "\n")
            result = {**core.AUTHORITY, "ok": True, "fictional": True, "output": args.out}
        elif args.command == "propose":
            state = create_ledger(args.ledger, core.opening(read_regular(args.input), args.at))
            result = {"ok": True, **core.summary(state)}
        elif args.command in ("confirm", "paper-execute"):
            name = "proposal_sha256" if args.command == "confirm" else "confirmation_sha256"
            value = getattr(args, name)
            if not core.DIGEST.fullmatch(value):
                core.fail("DIGEST_INVALID", name)
            state = append(args.ledger, "CONFIRM" if args.command == "confirm" else "PAPER_EXECUTE",
                           args.at, {name: value})
            result = {"ok": state["last_result"]["status"] != "REJECTED", **core.summary(state)}
        elif args.command == "verify-bundle":
            state = verify_bundle(args.directory)
            expected_head(state, args.expected_head_sha256)
            result = {"ok": True, "valid": True, "scope": "RETAINED_PAPER_REPLAY", **core.summary(state)}
        elif args.command in ("fetch-snapshot", "import-snapshot-fragment"):
            from .sosovalue import AdapterError, collect_snapshot, import_snapshot_fragment
            try:
                captured = (collect_snapshot(args.asset, args.quote_scale, args.cache)
                            if args.command == "fetch-snapshot" else
                            import_snapshot_fragment(args.response, args.quote_scale, args.cache))
            except AdapterError as exc:
                print(core.canonical({**core.AUTHORITY, "ok": False, "code": exc.code, "health": exc.health}))
                return 2
            write_new(args.json_out, core.canonical(captured["snapshot"]) + "\n")
            result = {**core.AUTHORITY, "ok": True, "output": args.json_out, **captured}
        else:
            events, state = read_ledger(args.ledger)
            if args.command == "export":
                write_bundle(args.out, bundle_files(events, state))
                result = {"ok": True, "output": args.out, **core.summary(state)}
            elif args.command == "verify":
                expected_head(state, args.expected_head_sha256)
                result = {"ok": True, "valid": True, "scope": "RETAINED_PAPER_REPLAY", **core.summary(state)}
            else:
                result = {"ok": True, **core.summary(state)}
        print(core.canonical(result))
        if args.command == "propose" and state["proposal"]["state"] == "HOLD":
            return 1
        if args.command in ("confirm", "paper-execute") and not result["ok"]:
            return 1
        return 0
    except (core.TreasuryError, OSError, UnicodeError, sqlite3.Error, ValueError,
            KeyError, TypeError, OverflowError, RecursionError) as exc:
        result = {**core.AUTHORITY, "ok": False,
                  "code": exc.code if isinstance(exc, core.TreasuryError) else "INPUT_OR_STORAGE_ERROR"}
        if isinstance(exc, core.TreasuryError) and exc.path:
            result["path"] = exc.path
        print(core.canonical(result))
        return 2


if __name__ == "__main__":
    sys.exit(main())
