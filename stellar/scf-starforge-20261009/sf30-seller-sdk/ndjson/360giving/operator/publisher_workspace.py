"""MIT. Saved publisher work using the original 360Giving and NDJSON engines."""
from __future__ import annotations

from argparse import Namespace
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import threading
import time
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
PROFILE = HERE.parent
NDJSON = PROFILE.parent
SDK = NDJSON.parent
SHARED = SDK / "xml"
sys.path.insert(0, str(NDJSON))
from application import Workspace as NativeWorkspace, InputError, load_json
sys.path.remove(str(NDJSON))
_spec = importlib.util.spec_from_file_location("sf30_360giving_publisher", PROFILE / "publisher.py")
publisher = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(publisher)

SCHEMA = "stellar-forge.360giving-operator.v1"
REQUEST = SCHEMA + ".request"
HANDOFF = SCHEMA + ".handoff"
MAX_UPLOAD = 1024 * 1024 * 1024
MAX_EXPANDED = 2 * MAX_UPLOAD
HEX = re.compile(r"[0-9a-f]{64}\Z")
KEY = re.compile(r"[a-z0-9][a-z0-9_-]{0,79}\Z")
STORES = ("objects", "datasets", "editions", "decisions", "candidates", "native",
          "requests", "deliveries", "received", "tmp")
RUNTIME = ("dataset-handler.mjs", "xml/workspace.py", "xml/xml_source.py",
           "xml/native.mjs", "xml/server.py", "ndjson/application.py",
           "ndjson/ndjson_source.py")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def identifier(value):
    if not isinstance(value, str) or not KEY.fullmatch(value):
        raise InputError("Use a short lower-case identifier with letters, numbers, _ or -")
    return value


def identity(value):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise InputError("Select the complete original SHA-256 identity")
    return value


def file_info(path, limit=MAX_EXPANDED):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        raise InputError("Expected a complete regular file within the selected size limit")
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            total += len(block)
            if total > limit:
                raise InputError("The selected file exceeds its complete-file limit")
            digest.update(block)
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise InputError("The original file changed while it was read")
    return {"bytes": total, "sha256": digest.hexdigest()}


def read(path):
    return load_json(Path(path).read_bytes())


def sync_dir(path):
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".operator-pending-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def immutable(path, data):
    path = Path(path)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise InputError("This retained path already contains a different original input")
        return
    atomic(path, data)


def call_publisher(name, **args):
    output = io.StringIO()
    with redirect_stdout(output):
        code = getattr(publisher, name)(Namespace(**args))
    result = load_json(output.getvalue())
    return {"exitCode": code, **result}


def safe_members(archive, limit=MAX_EXPANDED):
    infos = archive.infolist()
    names, total = set(), 0
    if len(infos) > 20000:
        raise InputError("The complete handoff contains too many members")
    for item in infos:
        path = PurePosixPath(item.filename)
        mode = item.external_attr >> 16
        if (not item.filename or path.is_absolute() or ".." in path.parts
                or path.as_posix() != item.filename or "\\" in item.filename
                or any(c in item.filename for c in "\r\n\0")
                or item.filename in names or item.is_dir() or stat.S_ISLNK(mode)
                or (stat.S_IFMT(mode) not in (0, stat.S_IFREG))
                or item.flag_bits & 1
                or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise InputError("The complete handoff has an unsupported or repeated file member")
        names.add(item.filename)
        total += item.file_size
        if total > limit:
            raise InputError("The complete handoff exceeds its expanded-size limit")
    return infos


def verified_archive(path):
    file_info(path, MAX_UPLOAD)
    with zipfile.ZipFile(path) as archive:
        infos = safe_members(archive)
        names = {i.filename for i in infos}
        if "manifest.json" not in names:
            raise InputError("The complete operator handoff manifest is missing")
        member = archive.getinfo("manifest.json")
        if member.file_size > 16 * 1024 * 1024:
            raise InputError("The complete handoff manifest is too large")
        manifest = load_json(archive.read(member))
        if manifest.get("schema") != HANDOFF or not isinstance(manifest.get("files"), dict):
            raise InputError("Use the complete saved publisher handoff")
        if set(manifest["files"]) != names - {"manifest.json"}:
            raise InputError("The handoff must contain every declared original member exactly once")
        for name, expected in manifest["files"].items():
            total, h = 0, hashlib.sha256()
            with archive.open(name) as stream:
                while block := stream.read(1024 * 1024):
                    total += len(block)
                    h.update(block)
            if expected != {"bytes": total, "sha256": h.hexdigest()}:
                raise InputError("A complete handoff member differs: " + name)
        return manifest


class PublisherWorkspace:
    """One original operator writer, with native datasets kept separate by fund."""

    def __init__(self, root, create=False):
        root = Path(root).expanduser().absolute()
        if create:
            root.mkdir(mode=0o700, parents=True, exist_ok=False)
            for name in STORES:
                (root / name).mkdir(mode=0o700)
            immutable(root / "workspace.json", encoded({
                "schema": SCHEMA, "id": str(uuid.uuid4()), "createdAt": time.time()}))
        self.root = root.resolve(strict=True)
        info = self.root.stat()
        if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise InputError("Use a private operator-owned workspace directory")
        self.binding = read(self.root / "workspace.json")
        if self.binding.get("schema") != SCHEMA:
            raise InputError("Select the original 360Giving operator workspace")
        for name in STORES:
            path = self.root / name
            if path.is_symlink() or not path.is_dir():
                raise InputError("The original workspace storage is missing: " + name)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        self.lease = os.fdopen(os.open(self.root / ".operator.lock", flags, 0o600), "r+b", buffering=0)
        try:
            if os.name == "posix":
                import fcntl
                fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            else:
                import msvcrt
                if not self.lease.read(1):
                    self.lease.write(b"0")
                self.lease.seek(0)
                msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            self.lease.close()
            raise InputError("This publisher workspace is open; use its existing console") from error
        self.mutex = threading.RLock()
        self.requests_mutex = threading.RLock()
        self.native_key, self.native = None, None
        self.closed = False
        program_files = [PROFILE / name for name in (
            "publisher.py", "cli.mjs", "review.html", "review.js", "review.css",
            "README.md", "requirements.txt", "ATTRIBUTION.md")]
        program_files.extend(sorted((PROFILE / "schemas").iterdir()))
        self.program = hashlib.sha256(encoded({
            p.relative_to(PROFILE).as_posix(): file_info(p) for p in program_files if p.is_file()
        })).hexdigest()
        # The original writer lock establishes that the previous process is closed.
        for path in (self.root / "requests").glob("*.json"):
            record = read(path)
            if record.get("status") == "running":
                record.update(status="interrupted", updatedAt=time.time(),
                    error={"type": "PreviousProcessClosed",
                           "message": "Reopen this saved request to continue its retained inputs and output."})
                atomic(path, encoded(record))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        with self.mutex:
            if not self.closed:
                if self.native is not None:
                    self.native.close()
                    self.native = None
                self.lease.close()
                self.closed = True

    def object(self, value):
        path = self.root / "objects" / identity(value)
        if file_info(path, MAX_UPLOAD)["sha256"] != value:
            raise InputError("The retained input object changed")
        return path

    def upload(self, stream):
        fd, name = tempfile.mkstemp(prefix="input-", dir=self.root / "tmp")
        temporary = Path(name)
        size, h = 0, hashlib.sha256()
        try:
            with os.fdopen(fd, "wb") as output:
                while block := stream.read(65536):
                    size += len(block)
                    if size > MAX_UPLOAD:
                        raise InputError("The complete input exceeds 1 GiB")
                    h.update(block)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            ident = h.hexdigest()
            destination = self.root / "objects" / ident
            with self.mutex:
                if destination.exists():
                    if file_info(destination, MAX_UPLOAD) != {"sha256": ident, "bytes": size}:
                        raise InputError("The retained input identity differs")
                else:
                    os.replace(temporary, destination)
                    sync_dir(destination.parent)
            return {"id": ident, "sha256": ident, "bytes": size}
        finally:
            temporary.unlink(missing_ok=True)

    def state(self):
        return {**self.binding,
            "datasets": [read(p) for p in sorted((self.root / "datasets").glob("*.json"))],
            "editions": [read(p) for p in sorted((self.root / "editions").glob("*/edition.json"))],
            "decisions": [read(p) for p in sorted((self.root / "decisions").glob("*/*/decision.json"))],
            "candidates": [read(p) for p in sorted((self.root / "candidates").glob("*/operator-candidate.json"))],
            "requests": sorted([read(p) for p in (self.root / "requests").glob("*.json")],
                               key=lambda item: item["createdAt"], reverse=True)}

    def request(self, request_id):
        return read(self.root / "requests" / (identifier(request_id) + ".json"))

    def admit(self, request_id, action, body):
        identifier(request_id)
        if action not in {"intake", "decisions", "candidate", "build", "compare", "export", "receive"}:
            raise InputError("Select an existing publisher operation")
        if not isinstance(body, dict):
            raise InputError("Supply the complete operation input object")
        with self.requests_mutex:
            path = self.root / "requests" / (request_id + ".json")
            if path.exists():
                record = read(path)
                if record["action"] != action or record["input"] != body:
                    raise InputError("This request already selects different original input")
                return record
            record = {"schema": REQUEST, "id": request_id, "workspaceId": self.binding["id"],
                "action": action, "input": body, "status": "pending", "phase": "prepared",
                "createdAt": time.time(), "programSha256": self.program}
            immutable(path, encoded(record))
            return record

    def execute(self, request_id):
        with self.mutex:
            record = self.request(request_id)
            if record["status"] == "complete":
                return record
            if record["programSha256"] != self.program:
                raise InputError("Continue this request with its selected publisher program; retain the original record")
            record.update(status="running", phase=record["action"], updatedAt=time.time())
            path = self.root / "requests" / (request_id + ".json")
            atomic(path, encoded(record))
            try:
                result = getattr(self, "_" + record["action"])(record["input"], record)
                record.update(status="complete", phase="complete", result=result, updatedAt=time.time())
                record.pop("error", None)
                atomic(path, encoded(record))
                return record
            except BaseException as error:
                record.update(status="interrupted", error={"type": type(error).__name__, "message": str(error)},
                              updatedAt=time.time())
                atomic(path, encoded(record))
                raise

    def _edition(self, edition_id):
        path = self.root / "editions" / identity(edition_id)
        item = read(path / "edition.json")
        if item["id"] != edition_id:
            raise InputError("The original edition binding differs")
        publisher.verify_workspace(path / "publisher")
        return path, item

    def _decision(self, decision_id, edition_id):
        path = self.root / "decisions" / identity(edition_id) / identity(decision_id)
        item = read(path / "decision.json")
        if item["editionId"] != edition_id or file_info(path / "decisions.json")["sha256"] != decision_id:
            raise InputError("Select saved decisions for this exact source edition")
        return path, item

    def _candidate_path(self, candidate_id, edition_id):
        path = self.root / "candidates" / identity(candidate_id)
        item = read(path / "operator-candidate.json")
        original, edition = self._edition(edition_id)
        decision, _ = self._decision(item["decisionId"], edition_id)
        expected_id = hashlib.sha256(encoded({"edition": edition_id, "decision": item["decisionId"],
                                               "program": identity(item["programSha256"])})).hexdigest()
        metadata = read(path / "candidate.json")
        info = file_info(path / "candidate-package.json")
        if (item["id"] != candidate_id or expected_id != candidate_id or item["editionId"] != edition_id
                or metadata["parentSourceSha256"] != edition["sourceSha256"]
                or metadata["candidateSha256"] != item["candidateSha256"] or info["sha256"] != item["candidateSha256"]
                or metadata["candidateBytes"] != info["bytes"]
                or (path / "decisions.json").read_bytes() != (decision / "decisions.json").read_bytes()
                or (path / "mapping.json").read_bytes() != (original / "publisher" / "mapping.json").read_bytes()):
            raise InputError("The complete candidate and original decision/source binding differ")
        package = publisher.json_file(path / "candidate-package.json")
        lines = ("\n".join(publisher.exact(grant) for grant in package["grants"]) + "\n").encode("utf-8")
        if (len(package["grants"]) != item["grantCount"]
                or metadata["grantCount"] != item["grantCount"] or (path / "grants.ndjson").read_bytes() != lines):
            raise InputError("The candidate native grants differ from the complete package")
        return path, item

    def _dataset(self, key):
        key = identifier(key)
        if self.native_key == key and self.native is not None:
            return self.native
        if self.native is not None:
            self.native.close()
            self.native = None
            self.native_key = None
        path = self.root / "native" / key
        if not path.exists():
            temp = self.root / "tmp" / ("native-init-" + key)
            if temp.exists() and not (temp / "workspace.json").is_file():
                # These are the only empty directories native initialization creates before workspace.json.
                expected = {"sources", "plans", "builds", "comparisons", "tmp"}
                if any(p.is_symlink() or not p.is_dir() or p.name not in expected
                       or any(p.iterdir()) for p in temp.iterdir()):
                    raise InputError("Original initialization storage contains additional retained work")
                for child in temp.iterdir():
                    child.rmdir()
                temp.rmdir()
            if not temp.exists():
                with NativeWorkspace(temp, create=True):
                    pass
            else:
                with NativeWorkspace(temp):
                    pass
            os.rename(temp, path)
            sync_dir(path.parent)
        self.native = NativeWorkspace(path)
        self.native_key = key
        return self.native

    def _intake(self, body, record):
        key = identifier(body["dataset"])
        url = body["sourceUrl"]
        if not isinstance(url, str) or not re.match(r"^https?://[^/\s]+", url):
            raise InputError("Retain the original publisher source URL")
        label = body.get("label", key)
        if not isinstance(label, str) or not label.strip() or len(label) > 160:
            raise InputError("Use a complete short publisher dataset label")
        dataset = {"schema": SCHEMA + ".dataset", "key": key, "label": label}
        inputs = {name: body.get(name) for name in ("source", "registry", "capture", "transport")}
        for name in ("source", "registry"):
            if not inputs[name]:
                raise InputError("Select the complete source and its matching registry record")
        files = {name: self.object(value) if value else None for name, value in inputs.items()}
        selected = {"dataset": key, "sourceUrl": url, "inputs": inputs, "programSha256": record["programSha256"]}
        edition_id = hashlib.sha256(encoded(selected)).hexdigest()
        path = self.root / "editions" / edition_id
        if (path / "edition.json").exists():
            _, entry = self._edition(edition_id)
            if any(entry.get(k) != v for k, v in selected.items()):
                raise InputError("The original saved edition selects different input")
            immutable(self.root / "datasets" / (key + ".json"), encoded(dataset))
            return entry
        path.mkdir(mode=0o700, exist_ok=True)
        result = call_publisher("prepare", source=str(files["source"]), source_url=url,
            registry=str(files["registry"]), capture=str(files["capture"]) if files["capture"] else None,
            transport=str(files["transport"]) if files["transport"] else None, out=str(path / "publisher"))
        entry = {"schema": SCHEMA + ".edition", "id": edition_id, **selected,
            "sourceSha256": result["sourceSha256"], "grantCount": result["grantCount"],
            "nativeInputReady": result["nativeInputReady"],
            "preparedAt": read(path / "publisher" / "source.json")["preparedAt"]}
        immutable(self.root / "datasets" / (key + ".json"), encoded(dataset))
        immutable(path / "edition.json", encoded(entry))
        return entry

    def review(self, edition_id, decision_id=None):
        path, edition = self._edition(edition_id)
        decisions = path / "publisher" / "decisions-template.json"
        if decision_id:
            decisions = self._decision(decision_id, edition_id)[0] / "decisions.json"
        return {"workspaceId": self.binding["id"], "report": publisher.json_file(path / "publisher" / "report.json"),
                "template": publisher.json_file(decisions), "edition": edition}

    def _decisions(self, body, record):
        edition_id = identity(body["edition"])
        _, edition = self._edition(edition_id)
        source = self.object(body["object"])
        raw = publisher.raw_file(source)
        value = publisher.parse(raw.decode("utf-8-sig"))
        if (value.get("schema") != publisher.DECISIONS
                or value.get("sourceSha256") != edition["sourceSha256"]
                or not isinstance(value.get("reviewer"), str) or not value["reviewer"].strip()
                or not isinstance(value.get("reviewedAt", ""), str)
                or any(not isinstance(value.get(key), list) for key in ("reviews", "changes", "metadataFromRegistry"))):
            raise InputError("Save the complete named review for this exact original source")
        decision_id = hashlib.sha256(raw).hexdigest()
        path = self.root / "decisions" / edition_id / decision_id
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        immutable(path / "decisions.json", raw)
        entry = {"schema": SCHEMA + ".decision", "id": decision_id, "editionId": edition_id,
                 "sourceSha256": edition["sourceSha256"], "reviewer": value["reviewer"],
                 "reviewedAt": value.get("reviewedAt", ""), "bytes": len(raw)}
        immutable(path / "decision.json", encoded(entry))
        return entry

    def _candidate(self, body, record):
        edition_id = identity(body["edition"])
        original, edition = self._edition(edition_id)
        decisions, decision = self._decision(body["decision"], edition_id)
        candidate_id = hashlib.sha256(encoded({"edition": edition_id, "decision": decision["id"],
                                               "program": record["programSha256"]})).hexdigest()
        path = self.root / "candidates" / candidate_id
        if (path / "operator-candidate.json").exists():
            _, entry = self._candidate_path(candidate_id, edition_id)
            return entry
        result = call_publisher("candidate", workspace=str(original / "publisher"),
                               decisions=str(decisions / "decisions.json"), out=str(path))
        entry = {"schema": SCHEMA + ".candidate", "id": candidate_id, "editionId": edition_id,
                 "decisionId": decision["id"], "dataset": edition["dataset"],
                 "candidateSha256": result["candidateSha256"], "grantCount": result["grantCount"],
                 "grantCorrections": result["grantCorrections"], "metadataFields": result["metadataFields"]}
        immutable(path / "operator-candidate.json", encoded(entry))
        return entry

    def _build(self, body, record):
        edition_id = identity(body["edition"])
        path, edition = self._edition(edition_id)
        candidate_id = body.get("candidate")
        if candidate_id:
            source, _ = self._candidate_path(candidate_id, edition_id)
        else:
            if not edition["nativeInputReady"]:
                raise InputError("Resolve the original schema or duplicate-key findings before native build")
            source = path / "publisher"
        native = self._dataset(edition["dataset"])
        with (source / "grants.ndjson").open("rb") as stream:
            original = native.add_source(stream, read(self.root / "datasets" / (edition["dataset"] + ".json"))["label"],
                                         "grants.ndjson")
        plan = native.save_plan(load_json((source / "mapping.json").read_bytes()))
        build = native.build(original["id"], plan["id"])
        return {"editionId": edition_id, "candidateId": candidate_id, "dataset": edition["dataset"], "build": build}

    def query(self, dataset, build, params):
        with self.mutex:
            if not isinstance(params, dict):
                raise InputError("Use the original native scalar-string query parameters")
            return self._dataset(identifier(dataset)).query(identity(build), params)

    def changes(self, dataset, comparison, offset=0, limit=50):
        with self.mutex:
            return self._dataset(identifier(dataset)).comparison_page(identity(comparison), offset, limit)

    def _compare(self, body, record):
        key = identifier(body["dataset"])
        return {"dataset": key, "comparison": self._dataset(key).compare(
            identity(body["before"]), identity(body["after"]))}

    def native_state(self, dataset):
        with self.mutex:
            return self._dataset(identifier(dataset)).state()

    def _packet(self, native, build, path):
        if path.exists():
            restored = native.import_packet(path)
            if restored["build"]["id"] != build:
                raise InputError("The retained native handoff selects another build")
            return file_info(path, MAX_UPLOAD)
        temporary = path.with_name(path.name + ".pending")
        if temporary.exists():
            try:
                restored = native.import_packet(temporary)
                if restored["build"]["id"] != build:
                    raise InputError("The retained native export selects another original build")
            except (InputError, ValueError, zipfile.BadZipFile, OSError):
                temporary.unlink()
        if not temporary.exists():
            native.export_packet(build, temporary)
        os.replace(temporary, path)
        sync_dir(path.parent)
        return file_info(path, MAX_UPLOAD)

    def _runtime_files(self):
        paths = {name: SDK / name for name in RUNTIME}
        for root in (PROFILE,):
            for path in root.rglob("*"):
                if path.is_file() and not path.is_symlink() and "__pycache__" not in path.parts:
                    if path.suffix in {".py", ".mjs", ".js", ".css", ".html", ".md", ".txt", ".json"}:
                        paths[path.relative_to(SDK).as_posix()] = path
        return {"runtime/sf30-seller-sdk/" + name: path for name, path in paths.items()}

    def _export(self, body, record):
        edition_id = identity(body["edition"])
        edition_path, edition = self._edition(edition_id)
        decision_id, candidate_id = body.get("decision"), body.get("candidate")
        decision_path = self._decision(decision_id, edition_id)[0] if decision_id else None
        candidate_path, candidate = (self._candidate_path(candidate_id, edition_id)
                                      if candidate_id else (None, None))
        if candidate and candidate["decisionId"] != decision_id:
            raise InputError("Export the candidate with the exact decisions that produced it")
        folder = self.root / "deliveries" / record["id"]
        folder.mkdir(mode=0o700, exist_ok=True)
        final = folder / "360giving-complete-handoff.zip"
        if final.exists():
            manifest = verified_archive(final)
            if manifest.get("request") != record["id"] or manifest.get("workspaceId") != self.binding["id"]:
                raise InputError("The complete output belongs to another original handoff")
            return {"file": record["id"], **file_info(final, MAX_UPLOAD), "manifest": manifest}
        domain = folder / "publisher.zip"
        call_publisher("export", workspace=str(edition_path / "publisher"),
            decisions=str(decision_path / "decisions.json") if decision_path else None,
            candidate=str(candidate_path) if candidate_path else None, out=str(domain))
        files = {"publisher.zip": domain}
        for name, ident in edition["inputs"].items():
            if ident:
                files["inputs/" + name] = self.object(ident)
        native = self._dataset(edition["dataset"])
        builds = {}
        if edition["nativeInputReady"]:
            original = self._build({"edition": edition_id}, record)
            builds["original"] = original["build"]["id"]
            self._packet(native, builds["original"], folder / "native-original.zip")
            files["native-original.zip"] = folder / "native-original.zip"
        if candidate:
            selected = self._build({"edition": edition_id, "candidate": candidate_id}, record)
            builds["candidate"] = selected["build"]["id"]
            self._packet(native, builds["candidate"], folder / "native-candidate.zip")
            files["native-candidate.zip"] = folder / "native-candidate.zip"
        comparison = None
        if set(builds) == {"original", "candidate"}:
            comparison = native.compare(builds["original"], builds["candidate"])
            immutable(folder / "comparison.json", encoded(comparison))
            files["comparison.json"] = folder / "comparison.json"
            files["changes.jsonl"] = native.comparison_file(comparison["id"])
        selected = {"schema": HANDOFF, "workspaceId": self.binding["id"], "request": record["id"],
                    "dataset": read(self.root / "datasets" / (edition["dataset"] + ".json")),
                    "edition": edition, "decision": read(decision_path / "decision.json") if decision_path else None,
                    "candidate": candidate, "builds": builds, "comparison": comparison}
        immutable(folder / "handoff.json", encoded(selected))
        files["handoff.json"] = folder / "handoff.json"
        files.update(self._runtime_files())
        files["README.md"] = HERE / "RECEIVING.md"
        manifest = {"schema": HANDOFF, "workspaceId": self.binding["id"], "request": record["id"],
                    "files": {name: file_info(path) for name, path in sorted(files.items())}}
        if sum(item["bytes"] for item in manifest["files"].values()) > MAX_EXPANDED:
            raise InputError("The complete selected handoff exceeds 2 GiB expanded")
        temporary = final.with_name(final.name + ".pending")
        def archive_write(out):
            with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, path in sorted(files.items()):
                    entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    entry.external_attr = 0o100600 << 16
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    with archive.open(entry, "w") as target, path.open("rb") as source:
                        shutil.copyfileobj(source, target, 1024 * 1024)
                    if file_info(path) != manifest["files"][name]:
                        raise InputError("Original source changed during complete handoff: " + name)
                entry = zipfile.ZipInfo("manifest.json", (1980, 1, 1, 0, 0, 0))
                entry.external_attr = 0o100600 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, encoded(manifest))
        # The pending archive belongs to this saved request; every input remains retained.
        if temporary.exists():
            temporary.unlink()
        with temporary.open("xb") as out:
            temporary.chmod(0o600)
            archive_write(out)
            out.flush()
            os.fsync(out.fileno())
        verified_archive(temporary)
        os.replace(temporary, final)
        sync_dir(final.parent)
        return {"file": record["id"], **file_info(final, MAX_UPLOAD), "manifest": manifest}

    def delivery(self, request_id):
        record = self.request(request_id)
        if record["action"] != "export" or record["status"] != "complete":
            raise InputError("Complete the original handoff before downloading it")
        path = self.root / "deliveries" / request_id / "360giving-complete-handoff.zip"
        if file_info(path, MAX_UPLOAD) != {key: record["result"][key] for key in ("bytes", "sha256")}:
            raise InputError("The complete handoff changed after publication")
        return path

    def _receive(self, body, record):
        archive_path = self.object(body["object"])
        manifest = verified_archive(archive_path)
        archive_id = file_info(archive_path, MAX_UPLOAD)["sha256"]
        target = self.root / "received" / archive_id
        target.mkdir(mode=0o700, exist_ok=True)
        immutable(target / "receiving-intent.json", encoded({
            "schema": HANDOFF, "archiveSha256": archive_id, "workspaceId": self.binding["id"]}))
        # Every received byte is retained as source; code from the archive is never imported.
        with zipfile.ZipFile(archive_path) as archive:
            for name, expected in manifest["files"].items():
                destination = target / "source" / PurePosixPath(name)
                if destination.exists():
                    if file_info(destination) != expected:
                        raise InputError("The selected received member changed: " + name)
                    continue
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd, tmp = tempfile.mkstemp(prefix=".receive-", dir=destination.parent)
                try:
                    with os.fdopen(fd, "wb") as out, archive.open(name) as inp:
                        shutil.copyfileobj(inp, out, 1024 * 1024)
                        out.flush()
                        os.fsync(out.fileno())
                    if file_info(tmp) != expected:
                        raise InputError("The received member differs: " + name)
                    os.replace(tmp, destination)
                    sync_dir(destination.parent)
                finally:
                    Path(tmp).unlink(missing_ok=True)
        original = target / "source"
        descriptor = read(original / "handoff.json")
        if (descriptor.get("schema") != HANDOFF or descriptor.get("workspaceId") != manifest["workspaceId"]
                or descriptor.get("request") != manifest["request"]):
            raise InputError("The selected source handoff and full manifest differ")
        edition, dataset = descriptor["edition"], descriptor["dataset"]
        key, edition_id = identifier(dataset["key"]), identity(edition["id"])
        if (dataset.get("schema") != SCHEMA + ".dataset"
                or edition.get("schema") != SCHEMA + ".edition" or key != edition["dataset"]
                or not isinstance(dataset.get("label"), str)):
            raise InputError("The received edition and native dataset identity differ")
        selected = {k: edition[k] for k in ("dataset", "sourceUrl", "inputs", "programSha256")}
        if hashlib.sha256(encoded(selected)).hexdigest() != edition_id:
            raise InputError("The complete original intake identity differs")
        if set(edition["inputs"]) != {"source", "registry", "capture", "transport"}:
            raise InputError("The original intake input selection is incomplete")
        for name, ident in edition["inputs"].items():
            if ident and file_info(original / "inputs" / name)["sha256"] != identity(ident):
                raise InputError("The complete original intake bytes differ: " + name)
        if not edition["inputs"]["registry"] or edition["inputs"]["source"] != edition["sourceSha256"]:
            raise InputError("The original source and registry selection is incomplete")
        received_domain = target / "publisher"
        domain = call_publisher("receive", file=str(original / "publisher.zip"), out=str(received_domain))
        if (domain["sourceSha256"] != edition["sourceSha256"]
                or domain["grantCount"] != edition["grantCount"]
                or domain["nativeInputReady"] != edition["nativeInputReady"]
                or file_info(received_domain / "source" / "original-package.json")["sha256"] != edition["inputs"]["source"]):
            raise InputError("The complete publisher source differs from its receiving descriptor")
        receipt = publisher.json_file(received_domain / "source.json")
        if (receipt["sourceUrl"] != edition["sourceUrl"] or receipt["preparedAt"] != edition["preparedAt"]
                or publisher.exact(publisher.json_file(original / "inputs" / "registry"))
                   != publisher.exact(publisher.json_file(received_domain / "registry.json"))):
            raise InputError("The retained source URL, preparation, or registry differs")
        if edition["inputs"]["capture"]:
            if publisher.exact(publisher.json_file(original / "inputs" / "capture")) != publisher.exact(receipt["captured"]):
                raise InputError("The complete original source capture differs")
        if edition["inputs"]["transport"]:
            if file_info(received_domain / "source" / "transport.bin")["sha256"] != edition["inputs"]["transport"]:
                raise InputError("The original transport bytes differ")

        decision, candidate = descriptor.get("decision"), descriptor.get("candidate")
        if decision:
            identity(decision["id"])
            raw = publisher.raw_file(received_domain / "review" / "decisions.json")
            if (hashlib.sha256(raw).hexdigest() != decision["id"]
                    or decision["editionId"] != edition_id
                    or decision["sourceSha256"] != edition["sourceSha256"]):
                raise InputError("The received decision identity differs")
        if candidate:
            expected_id = hashlib.sha256(encoded({"edition": edition_id, "decision": decision["id"],
                                                  "program": identity(candidate["programSha256"])})).hexdigest() if decision else None
            if (not decision or candidate["decisionId"] != decision["id"]
                    or candidate["editionId"] != edition_id or identity(candidate["id"]) != expected_id):
                raise InputError("The received candidate and original decision differ")
            supplied = received_domain / "candidate"
            actual = read(supplied / "candidate.json")
            if (actual["candidateSha256"] != candidate["candidateSha256"]
                    or file_info(supplied / "candidate-package.json")["sha256"] != candidate["candidateSha256"]
                    or (supplied / "decisions.json").read_bytes() != raw):
                raise InputError("The full received candidate identity differs")
        builds = descriptor.get("builds", {})
        if not isinstance(builds, dict) or set(builds) - {"original", "candidate"}:
            raise InputError("The handoff has an unknown native build selection")
        if ("candidate" in builds and not candidate) or ("original" in builds and not edition["nativeInputReady"]):
            raise InputError("The received native build selection differs from its complete source")
        if descriptor.get("comparison") and set(builds) != {"original", "candidate"}:
            raise InputError("The comparison is missing an original native build")
        for build_id in builds.values():
            identity(build_id)

        # Retain each incoming review, and reconstruct a stable original preparation.
        edition_path = self.root / "editions" / edition_id
        base = edition_path / "publisher"
        base.mkdir(mode=0o700, parents=True, exist_ok=True)
        incoming = publisher.verify_workspace(received_domain)
        for member in incoming["files"]:
            name = member["path"]
            if name == "review.html" or name.startswith(("review/", "candidate/")):
                continue
            publisher.write_exact(base / name, publisher.raw_file(received_domain / name))
        publisher.write_exact(base / "review.html", publisher.render_review(
            publisher.json_file(base / "report.json"),
            publisher.json_file(base / "decisions-template.json"), base / "operator"))
        base_manifest = {key: value for key, value in incoming.items() if key not in {"files", "review"}}
        base_manifest["files"] = publisher.artifact_files(base)
        publisher.write_json(base / "manifest.json", base_manifest)
        publisher.verify_workspace(base)
        for name, ident in edition["inputs"].items():
            if ident:
                immutable(self.root / "objects" / ident, (original / "inputs" / name).read_bytes())
        immutable(self.root / "datasets" / (key + ".json"), encoded(dataset))
        immutable(edition_path / "edition.json", encoded(edition))
        if decision:
            decision_path = self.root / "decisions" / edition_id / decision["id"]
            decision_path.mkdir(mode=0o700, parents=True, exist_ok=True)
            immutable(decision_path / "decisions.json", raw)
            immutable(decision_path / "decision.json", encoded(decision))
        if candidate:
            candidate_path = self.root / "candidates" / candidate["id"]
            candidate_path.mkdir(mode=0o700, exist_ok=True)
            for item in supplied.iterdir():
                if item.is_file() and not item.is_symlink():
                    immutable(candidate_path / item.name, publisher.raw_file(item))
            immutable(candidate_path / "operator-candidate.json", encoded(candidate))
        native = self._dataset(key)
        recovered = {}
        for kind, build_id in descriptor.get("builds", {}).items():
            if kind not in {"original", "candidate"}:
                raise InputError("The handoff has an unknown native build selection")
            result = native.import_packet(original / ("native-" + kind + ".zip"))
            if result["build"]["id"] != build_id:
                raise InputError("The original native build identity differs after receiving")
            expected_source = (edition_path / "publisher" / "grants.ndjson" if kind == "original"
                               else self.root / "candidates" / candidate["id"] / "grants.ndjson")
            if result["source"] != file_info(expected_source)["sha256"]:
                raise InputError("The native build does not contain the complete selected publisher grants")
            expected_plan = native.save_plan(load_json((expected_source.parent / "mapping.json").read_bytes()))
            if result["plan"] != expected_plan["id"]:
                raise InputError("The native build differs from the original 26-column publisher mapping")
            recovered[kind] = result["build"]
        comparison = None
        if descriptor.get("comparison"):
            comparison = native.compare(descriptor["builds"]["original"], descriptor["builds"]["candidate"])
            if comparison != descriptor["comparison"]:
                raise InputError("The received original/candidate comparison differs")
            if file_info(native.comparison_file(comparison["id"])) != file_info(original / "changes.jsonl"):
                raise InputError("The full received field changes differ")
        result = {"schema": HANDOFF + ".received", "archiveSha256": archive_id,
                  "sourceWorkspaceId": manifest["workspaceId"], "workspaceId": self.binding["id"],
                  "sourceRequest": manifest["request"], "editionId": edition_id, "dataset": key,
                  "builds": recovered, "comparison": comparison,
                  "sourceDirectory": str(original), "files": len(manifest["files"])}
        immutable(target / "receiving.json", encoded(result))
        return result
