"""Transactional operator workspace, immutable original files, and complete receiving."""
from __future__ import annotations

from contextlib import contextmanager
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tempfile
import uuid
import zipfile

from .util import identity, json_text, require

FORMAT = "hive-router-workspace.v1"
PACKAGE = "hive-router-receiving.v1"
SOURCE_PIN = "28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6"


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def connection_digest(config):
    """Keep the original full connection binding used by saved native operations."""
    return sha(json_text(config).encode("utf-8"))


def durable_file(path, writer, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            writer(stream)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


class RevisionConflict(ValueError):
    pass


class Workspace:
    def __init__(self, root, create=False, name=None):
        self.root = Path(root).resolve()
        if create:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.root, 0o700)
        require(self.root.is_dir(), "Workspace directory does not exist.")
        self.path = self.root / "desk.sqlite"
        if not create:
            require(self.path.is_file(), "Workspace database does not exist.")
        self.db = sqlite3.connect(str(self.path), timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA synchronous=FULL")
        with self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS entities(
                    kind TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS events(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
                    at TEXT NOT NULL, parent TEXT NOT NULL, revision TEXT UNIQUE NOT NULL,
                    kind TEXT NOT NULL, entity_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS objects(
                    sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
            """)
        if self.meta("format") is None:
            require(create, "Uninitialized workspace.")
            with self.transaction():
                for key, value in {"format": FORMAT, "id": uuid.uuid4().hex, "name": name or "Hive deployment operations",
                                   "sourcePin": SOURCE_PIN, "revision": "0" * 64, "createdAt": now()}.items():
                    self.db.execute("INSERT INTO meta VALUES (?,?)", (key, value))
        require(self.meta("format") == FORMAT and self.meta("sourcePin") == SOURCE_PIN,
                "Workspace format or original Hive source pin differs.")
        os.chmod(self.path, 0o600)

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.close()

    @contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def meta(self, key):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def object_path(self, digest):
        require(isinstance(digest, str) and len(digest) == 64
                and all(c in "0123456789abcdef" for c in digest), "Invalid file digest.")
        return self.root / "objects" / digest[:2] / digest

    def put_stream(self, stream):
        directory = self.root / "objects"
        directory.mkdir(exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix=".incoming-", dir=directory)
        digest = hashlib.sha256()
        size = 0
        try:
            with os.fdopen(fd, "wb") as output:
                while block := stream.read(1024 * 1024):
                    size += len(block)
                    digest.update(block)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            fingerprint = digest.hexdigest()
            destination = self.object_path(fingerprint)
            destination.parent.mkdir(exist_ok=True, mode=0o700)
            try:
                os.link(temporary, destination)
            except FileExistsError:
                require(identity(destination) == {"bytes": size, "sha256": fingerprint},
                        "Existing immutable file has different bytes.")
            parent = os.open(destination.parent, os.O_RDONLY)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO objects VALUES (?,?,?)", (fingerprint, size, now()))
            return {"bytes": size, "sha256": fingerprint}
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def put_file(self, path):
        with Path(path).open("rb") as stream:
            return self.put_stream(stream)

    def put_bytes(self, data):
        return self.put_stream(io.BytesIO(data))

    def object_bytes(self, digest):
        path = self.object_path(digest)
        require(path.is_file(), "Original file is missing: " + digest)
        data = path.read_bytes()
        require(sha(data) == digest, "Original file digest differs: " + digest)
        return data

    def get(self, kind, entity_id):
        row = self.db.execute("SELECT * FROM entities WHERE kind=? AND id=?", (kind, entity_id)).fetchone()
        if not row:
            return None
        return {"kind": row["kind"], "id": row["id"], "revision": row["revision"], "data": json.loads(row["body"])}

    def list(self, kind=None):
        rows = self.db.execute("SELECT * FROM entities" + (" WHERE kind=?" if kind else "") +
                               " ORDER BY kind,id", (kind,) if kind else ())
        return [{"kind": r["kind"], "id": r["id"], "revision": r["revision"], "data": json.loads(r["body"])} for r in rows]

    def save(self, kind, entity_id, body, expected=None):
        require(isinstance(kind, str) and kind and isinstance(entity_id, str) and entity_id, "Entity identity is required.")
        encoded = json_text(body)
        with self.transaction():
            current = self.get(kind, entity_id)
            if (current and current["revision"] != expected) or (not current and expected is not None):
                raise RevisionConflict("This item changed. Reopen its current revision before saving.")
            parent, event_id, at = self.meta("revision"), uuid.uuid4().hex, now()
            event = {"parent": parent, "eventId": event_id, "at": at, "kind": kind,
                     "entityId": entity_id, "data": body}
            revision = sha(json_text(event).encode("utf-8"))
            self.db.execute("INSERT INTO events(event_id,at,parent,revision,kind,entity_id,body) VALUES (?,?,?,?,?,?,?)",
                            (event_id, at, parent, revision, kind, entity_id, encoded))
            self.db.execute("""INSERT INTO entities VALUES (?,?,?,?) ON CONFLICT(kind,id)
                DO UPDATE SET revision=excluded.revision,body=excluded.body""", (kind, entity_id, revision, encoded))
            self.db.execute("UPDATE meta SET value=? WHERE key='revision'", (revision,))
        return self.get(kind, entity_id)

    def summary(self):
        entities = self.list()
        return {"format": FORMAT, "id": self.meta("id"), "name": self.meta("name"),
                "sourcePin": self.meta("sourcePin"), "revision": self.meta("revision"), "entities": entities,
                "connectionFingerprints": {item["id"]: connection_digest(item["data"])
                    for item in entities if item["kind"] == "connection"}}

    def verify(self, check_files=True):
        require(self.db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Workspace SQLite integrity check failed.")
        parent, current_entities = "0" * 64, {}
        for row in self.db.execute("SELECT * FROM events ORDER BY seq"):
            require(row["parent"] == parent, "Workspace event chain diverges.")
            event = {"parent": parent, "eventId": row["event_id"], "at": row["at"], "kind": row["kind"],
                     "entityId": row["entity_id"], "data": json.loads(row["body"])}
            require(sha(json_text(event).encode("utf-8")) == row["revision"], "Workspace event content changed.")
            parent = row["revision"]
            current_entities[(row["kind"], row["entity_id"])] = (row["revision"], row["body"])
        require(parent == self.meta("revision"), "Workspace revision does not match its event chain.")
        observed = {(r["kind"], r["id"]): (r["revision"], r["body"])
                    for r in self.db.execute("SELECT * FROM entities")}
        require(current_entities == observed, "Workspace item state differs from its retained events.")
        objects = []
        for row in self.db.execute("SELECT * FROM objects ORDER BY sha256"):
            expected = {"bytes": row["bytes"], "sha256": row["sha256"]}
            if check_files:
                require(identity(self.object_path(row["sha256"])) == expected, "Workspace original file changed.")
            objects.append(expected)
        return {"id": self.meta("id"), "revision": parent, "objects": len(objects),
                "objectBytes": sum(x["bytes"] for x in objects), "verified": True}

    def export(self, destination, source_root):
        destination, source_root = Path(destination).resolve(), Path(source_root).resolve()
        require(not destination.exists(), "Use a new receiving archive name.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        source_index = source_root / "source-files.json"
        require(source_index.is_file(), "Complete application source inventory is required.")
        source_paths = json.loads(source_index.read_text(encoding="utf-8"))["files"]
        require(source_paths and len(source_paths) == len(set(source_paths)), "Application source inventory is invalid.")
        source_files = []
        for name in source_paths:
            relative = PurePosixPath(name)
            require(not relative.is_absolute() and ".." not in relative.parts and relative.as_posix() == name,
                    "Invalid application source path.")
            source = source_root.joinpath(*relative.parts)
            require(source.is_file() and not source.is_symlink(), "Application source is missing: " + name)
            source_files.append(source)
        for directory in ("hive_desk", "web", "reference"):
            for source in (source_root / directory).rglob("*"):
                if source.is_file() and source.suffix in {".py", ".java", ".js", ".css", ".html"}:
                    require(source.relative_to(source_root).as_posix() in source_paths,
                            "Add this application source to source-files.json: " + str(source))
        with tempfile.TemporaryDirectory(prefix="hive-receiving-", dir=destination.parent) as tmp:
            snapshot_path = Path(tmp) / "desk.sqlite"
            snapshot = sqlite3.connect(snapshot_path)
            try:
                self.db.backup(snapshot)
            finally:
                snapshot.close()
            with Workspace(tmp) as frozen:
                # Objects are immutable and shared into the frozen view for complete verification.
                os.symlink(self.root / "objects", Path(tmp) / "objects", target_is_directory=True)
                verified = frozen.verify()
                object_rows = list(frozen.db.execute("SELECT sha256 FROM objects ORDER BY sha256"))
                events = [r[0] for r in frozen.db.execute("SELECT revision FROM events ORDER BY seq")]
                manifest = {"format": PACKAGE, "workspaceId": frozen.meta("id"), "revision": frozen.meta("revision"),
                            "sourcePin": SOURCE_PIN, "createdAt": now(), "ancestors": ["0" * 64] + events,
                            "members": []}
            members = [("workspace/desk.sqlite", snapshot_path)]
            members.extend(("workspace/objects/" + r[0][:2] + "/" + r[0], self.object_path(r[0])) for r in object_rows)
            members.extend(("source/" + p.relative_to(source_root).as_posix(), p) for p in source_files)
            for name, path in members:
                manifest["members"].append({"path": name, **identity(path)})
            raw_manifest = (json_text(manifest) + "\n").encode("utf-8")
            def write_archive(stream):
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    archive.writestr("manifest.json", raw_manifest)
                    for name, path in members:
                        archive.write(path, name)
            staged = Path(tmp) / "complete-receiving.zip"
            durable_file(staged, write_archive, exclusive=True)
            inspect_archive(staged)
            os.link(staged, destination)
            descriptor = os.open(destination.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return {"path": str(destination), **identity(destination), "workspace": verified,
                "members": len(manifest["members"]), "sourceFiles": len(source_files)}


def inspect_archive(path):
    result = identity(path)
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [e.filename for e in entries]
        require(len(names) == len(set(names)), "Receiving ZIP contains duplicate members.")
        for entry in entries:
            p = PurePosixPath(entry.filename)
            require(not p.is_absolute() and ".." not in p.parts and "\\" not in entry.filename
                    and not entry.is_dir() and entry.filename == p.as_posix(),
                    "Receiving ZIP member path is unsafe.")
            require((entry.external_attr >> 16) & 0o170000 != 0o120000, "Receiving ZIP contains a symlink.")
        manifest = json.loads(archive.read("manifest.json"))
        require(manifest["format"] == PACKAGE and manifest["sourcePin"] == SOURCE_PIN, "Unknown receiving format/source.")
        members = manifest["members"]
        require(len({m["path"] for m in members}) == len(members), "Receiving manifest has duplicate members.")
        require(set(names) == {"manifest.json", *(m["path"] for m in members)}, "Receiving member inventory differs.")
        for member in members:
            digest, size = hashlib.sha256(), 0
            with archive.open(member["path"]) as stream:
                while block := stream.read(1024 * 1024):
                    digest.update(block)
                    size += len(block)
            require({"bytes": size, "sha256": digest.hexdigest()} ==
                    {"bytes": member["bytes"], "sha256": member["sha256"]},
                    "Receiving member changed: " + member["path"])
        require("workspace/desk.sqlite" in names, "Receiving workspace database is missing.")
        with tempfile.TemporaryDirectory(prefix="hive-archive-inspect-", dir=Path(path).resolve().parent) as tmp:
            database = Path(tmp) / "desk.sqlite"
            with archive.open("workspace/desk.sqlite") as source, database.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            with Workspace(tmp) as saved:
                state = saved.verify(check_files=False)
                require(state["id"] == manifest["workspaceId"] and state["revision"] == manifest["revision"],
                        "Receiving database identity differs from its manifest.")
                ancestors = ["0" * 64] + [r[0] for r in saved.db.execute("SELECT revision FROM events ORDER BY seq")]
                require(ancestors == manifest["ancestors"], "Receiving ancestry differs from its original database.")
                inventory = {m["path"]: m for m in members}
                for row in saved.db.execute("SELECT sha256,bytes FROM objects"):
                    key = "workspace/objects/" + row[0][:2] + "/" + row[0]
                    require(key in inventory and inventory[key]["sha256"] == row[0]
                            and inventory[key]["bytes"] == row[1], "Receiving original object inventory differs.")
        return {**result, "manifest": manifest, "verified": True}


def receive_archive(path, destination):
    """Restore whole source and saved results in a new directory, then verify the original workspace."""
    inspected = inspect_archive(path)
    destination = Path(destination).resolve()
    require(not destination.exists(), "Receiving creates a new complete directory; choose a new destination.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="." + destination.name + "-", dir=destination.parent) as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                target = tmp_path.joinpath(*PurePosixPath(name).parts)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.open(name) as source:
                    durable_file(target, lambda output, source=source: shutil.copyfileobj(source, output), exclusive=True)
        with Workspace(tmp_path / "workspace") as restored:
            result = restored.verify()
            require(result["id"] == inspected["manifest"]["workspaceId"]
                    and result["revision"] == inspected["manifest"]["revision"],
                    "Restored workspace differs from the complete package.")
        os.rename(tmp_path, destination)
    return {"path": str(destination), "archive": {k: inspected[k] for k in ("bytes", "sha256")},
            "workspace": result, "source": str(destination / "source")}


def compare_receiving(path, workspace):
    """Classify an incoming full edition against current edits without discarding either history."""
    incoming = inspect_archive(path)["manifest"]
    current = workspace.verify()
    require(incoming["workspaceId"] == current["id"], "Receiving package belongs to a different workspace.")
    if incoming["revision"] == current["revision"]:
        relation = "identical"
    elif current["revision"] in incoming["ancestors"]:
        relation = "incoming-forward"
    elif workspace.db.execute("SELECT 1 FROM events WHERE revision=?", (incoming["revision"],)).fetchone():
        relation = "current-forward"
    else:
        relation = "diverged"
    return {"relation": relation, "current": current["revision"], "incoming": incoming["revision"],
            "workspaceId": current["id"], "action": "Receive to a new directory and reopen its original operation IDs."}
