"""Receive a complete original buyer-expense project without executing archive code."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import zipfile
from store import DDL
from domain import SCHEMA

FORMAT = "stellar-forge.buyer-expense-private-project.v1"
MAX_BYTES = 256_000_000
APP_PREFIX = "app/sf36-spend-governor/"
REQUIRED_APP = {"native.py", "domain.py", "store.py", "exports.py", "portable.py", "server.py",
                "public/index.html", "public/app.mjs", "public/style.css", "README.md", "cli.mjs"}
REQUIRED = {APP_PREFIX + "expense-workspace/" + n for n in REQUIRED_APP}
REQUIRED.update(APP_PREFIX + n for n in ("statement.py", "governor.py", "STATEMENTS.md"))
REQUIRED.update({"project/workspace.sqlite", "README.md", "prepare_private.py"})
ALLOWED = REQUIRED | {APP_PREFIX + "expense-workspace/receive.py"}
MCP_REQUIRED = {APP_PREFIX + "expense-workspace/native_mcp.py",
    "app/stellar-forge/mcp-paid-agent/expense-statement.mjs",
    "app/stellar-forge/mcp-paid-agent/quote-store.mjs",
    "app/stellar-forge/mcp-paid-agent/remote-mcp.mjs",
    "app/stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs",
    "app/stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/networks.json"}


def digest_file(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_bytes(path, value):
    pending = path.with_name(path.name + ".receiving-pending")
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, path)
    sync_directory(path.parent)


def trusted_schema():
    db = sqlite3.connect(":memory:")
    try:
        db.executescript(DDL)
        return {row[0]: [(x[1], x[2], x[3], x[5]) for x in db.execute('PRAGMA table_info("' + row[0] + '")')]
                for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        db.close()


def inspect_database(path, manifest):
    database = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        database.execute("PRAGMA trusted_schema=OFF")
        if database.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("The retained native database is not complete.")
        if database.execute("SELECT name FROM sqlite_master WHERE type IN ('view','trigger')").fetchall():
            raise ValueError("The project contains objects outside the original trusted native schema.")
        tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected = trusted_schema()
        legacy = manifest.get("request_recovery") is None
        required = set(expected) - ({"api_requests"} if legacy else set())
        if not required <= tables <= set(expected):
            raise ValueError("The archive does not retain the complete supported expense schema.")
        for name in tables:
            actual = [(x[1], x[2], x[3], x[5]) for x in database.execute('PRAGMA table_info("' + name + '")')]
            if actual != expected[name]:
                raise ValueError("A native table differs from the trusted expense application schema.")
        meta = dict(database.execute("SELECT key,value FROM meta"))
        if meta.get("schema") != SCHEMA:
            raise ValueError("The original workspace schema does not match this application.")
        revision = int(meta["revision"])
        count = database.execute("SELECT COUNT(*) FROM api_requests").fetchone()[0] if "api_requests" in tables else 0
        if not legacy and (manifest.get("request_recovery") != "sqlite-transaction-v1" or manifest.get("request_count") != count):
            raise ValueError("The retained request-recovery history is incomplete.")
        if "workspace" in manifest and manifest["workspace"] != meta["id"] or "revision" in manifest and manifest["revision"] != revision:
            raise ValueError("The project manifest does not match its original native workspace revision.")
        source_kinds = sorted({json.loads(row[0]).get("kind", "sf36_ledger") for row in
                               database.execute("SELECT body FROM sources")})
        if any(kind not in ("sf36_ledger", "mcp_quote") for kind in source_kinds):
            raise ValueError("The retained source kind is not supported by this original receiver.")
        if "mcp_quote" in source_kinds and manifest.get("mcp_quote_capture") != "native-readonly-v1":
            raise ValueError("The complete MCP expense source requires its original included reader.")
        if manifest.get("mcp_quote_capture") is not None and manifest.get("source_kinds") != source_kinds:
            raise ValueError("The original source kinds do not match the complete project manifest.")
        return {"workspace": meta["id"], "revision": revision, "successful_requests": count,
                "source_kinds": source_kinds,
                "legacy_request_history": legacy, "tables": len(tables)}
    finally:
        database.close()


def receive(archive, directory, expected_sha256):
    archive = Path(archive).expanduser().resolve(strict=True)
    st = archive.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
        raise ValueError("Choose a complete private expense ZIP within 256 MB.")
    if not isinstance(expected_sha256, str) or len(expected_sha256) != 64 or digest_file(archive) != expected_sha256:
        raise ValueError("The complete project differs from its reviewed SHA-256.")
    raw_directory = Path(directory).expanduser()
    if not raw_directory.is_absolute():
        raise ValueError("Choose an absolute private receiving directory.")
    root = raw_directory.parent.resolve(strict=True) / raw_directory.name
    try:
        root.mkdir(mode=0o700)
    except FileExistsError:
        pass
    st = root.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_mode & 0o077 or st.st_uid != os.getuid():
        raise ValueError("Use an owned private receiving directory without symlinks.")
    lock = os.open(root / ".receiving.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marker = root / ".receiving.json"
        identity = {"schema": "stellar-forge.buyer-expense-receiving.v1", "archive_sha256": expected_sha256}
        if marker.exists():
            if marker.is_symlink() or json.loads(marker.read_text()) != identity:
                raise ValueError("This receiving folder belongs to another complete project.")
        elif any(p.name != ".receiving.lock" for p in root.iterdir()):
            raise ValueError("Choose an empty receiving folder or resume its exact original archive.")
        else:
            atomic_bytes(marker, (json.dumps(identity) + "\n").encode())
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            names = [v.filename for v in infos]
            if len(names) != len(set(names)) or "manifest.json" not in names:
                raise ValueError("The archive has missing or duplicate native members.")
            if z.getinfo("manifest.json").file_size > 65000:
                raise ValueError("The project manifest exceeds its native limit.")
            manifest = json.loads(z.read("manifest.json"))
            if manifest.get("schema") != FORMAT or not isinstance(manifest.get("files"), list):
                raise ValueError("Choose the original buyer-expense complete project format.")
            descriptions = manifest["files"]
            entries = {row["path"]: row for row in descriptions}
            feature = manifest.get("mcp_quote_capture")
            if feature not in (None, "native-readonly-v1"):
                raise ValueError("The archive advertises an unsupported original MCP reader version.")
            required = REQUIRED | (MCP_REQUIRED if feature else set())
            allowed = ALLOWED | (MCP_REQUIRED if feature else set())
            if len(entries) != len(descriptions) or not required <= set(entries) <= allowed or set(names) != set(entries) | {"manifest.json"}:
                raise ValueError("The complete project must retain the exact original application and workspace members.")
            if sum(i.file_size for i in infos) > MAX_BYTES:
                raise ValueError("The expanded project exceeds the native receiving limit.")
            for name, row in entries.items():
                info = z.getinfo(name)
                if info.file_size != row["bytes"] or info.is_dir() or stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG):
                    raise ValueError("An original archive member has changed type or size.")
                target = root / name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                for p in target.parents:
                    if p == root.parent:
                        break
                    if p.is_symlink():
                        raise ValueError("A receiving directory is linked.")
                    os.chmod(p, 0o700)
                if target.exists():
                    if target.is_symlink() or not target.is_file() or target.stat().st_size != row["bytes"] or digest_file(target) != row["sha256"]:
                        raise ValueError("A previously received file changed; keep it and choose a new destination.")
                    continue
                pending = target.with_name(target.name + ".receiving-pending")
                if pending.exists():
                    if pending.is_symlink() or not pending.is_file():
                        raise ValueError("The pending native receiving file is not regular.")
                    pending.unlink()
                count, digest = 0, hashlib.sha256()
                with z.open(name) as source, pending.open("xb") as output:
                    os.chmod(pending, 0o600)
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        count += len(chunk)
                        if count > row["bytes"]:
                            raise ValueError("The original member grew beyond its recorded size.")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if count != row["bytes"] or digest.hexdigest() != row["sha256"]:
                    raise ValueError("An original member differs from its retained digest.")
                os.replace(pending, target)
                sync_directory(target.parent)
            atomic_bytes(root / "manifest.json", z.read("manifest.json"))
        result = inspect_database(root / "project/workspace.sqlite", manifest)
        result.update(state="RECEIVED", directory=str(root), archive_sha256=expected_sha256,
                      files=len(entries), source_captures_replayed=0, original_ledger_copied=False,
                      original_quote_store_copied=False, purchased_result_bodies_copied=False,
                      application=str(root / (APP_PREFIX + "expense-workspace/server.py")))
        atomic_bytes(root / "RECEIVED.json", (json.dumps(result, indent=2) + "\n").encode())
        return result
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(lock, fcntl.LOCK_UN)
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(receive(args.archive, args.directory, args.expected_sha256)))


if __name__ == "__main__":
    main()
