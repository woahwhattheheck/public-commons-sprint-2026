#!/usr/bin/env python3
"""One original 169-record LIBNOVA HTTP/S3 receiving operation.

This runs the published client against local protocol fixtures. It performs no
LIBNOVA tenant operation and makes no claim that a deployed Function accepted
the package. The existing preservation producer validates the actual uploaded
BagIt bytes; boto3/botocore perform the real S3 requests and signing.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
import contextlib
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import http.server
import importlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

sys.dont_write_bytecode = True
SCHEMA = "commons.libnova-original-receiving.v1"
OPERATION = "LIBNOVA-RESEARCH-RECEIVING-6BA15-20261012"
SOURCE_SHA = "948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b"
SOURCE_BYTES = 145901
CONTAINER = 61001
STORAGE = 62001
METADATA_SCHEMA = 63001
FUNCTION = 64001
JOB = 80001
ASSET = 90001
BUCKET = "libnova-receiving"
FIXTURE_TOKEN = "synthetic-libnova-receiving-token"
FIXTURE_ACCESS = "SYNTHETICLIBNOVARECEIVING"
FIXTURE_SECRET = "synthetic-local-s3-secret-never-a-tenant-credential"
S3_NS = "http://s3.amazonaws.com/doc/2006-03-01/"
MAX_BODY = 16 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        need(stat.S_ISREG(before.st_mode), "Expected original regular file: " + str(path))
        h, length = hashlib.sha256(), 0
        while True:
            block = os.read(descriptor, 262144)
            if not block:
                break
            h.update(block)
            length += len(block)
        after = os.fstat(descriptor)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
             == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "File changed during bound read: " + str(path))
        return {"bytes": length, "sha256": h.hexdigest()}
    finally:
        os.close(descriptor)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_all(output, raw):
    pending = memoryview(raw)
    while pending:
        written = output.write(pending)
        need(isinstance(written, int) and written > 0, "Original output stopped before complete publication")
        pending = pending[written:]


def publish(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        need(not path.is_symlink() and path.read_bytes() == raw,
             "Immutable receiving member differs: " + str(path))
        return False
    descriptor, temporary = tempfile.mkstemp(prefix=".libnova-receiving-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb", buffering=0) as output:
            os.fchmod(output.fileno(), 0o600)
            write_all(output, raw)
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(not path.is_symlink() and path.read_bytes() == raw,
                 "Concurrent receiving publication differs")
        sync_directory(path.parent)
        return True
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_json(path, value):
    return publish(path, canonical(value))


def replace_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".libnova-progress-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb", buffering=0) as output:
            os.fchmod(output.fileno(), 0o600)
            write_all(output, canonical(value))
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path):
    path = Path(path)
    need(not path.is_symlink() and path.is_file(), "Missing original JSON member: " + str(path))
    need(path.stat().st_size <= MAX_BODY, "Receiving JSON exceeds its bound")
    return json.loads(path.read_bytes())


def copy_immutable(source, target):
    expected = identity(source)
    target = Path(target)
    if target.exists():
        need(identity(target) == expected, "Existing retained copy differs")
        return expected
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".libnova-copy-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output, open(source, "rb") as incoming:
            os.fchmod(output.fileno(), 0o600)
            shutil.copyfileobj(incoming, output, 262144)
            output.flush()
            os.fsync(output.fileno())
        need(identity(temporary) == expected, "Retained original copy differs")
        os.link(temporary, target)
        sync_directory(target.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return expected


@contextlib.contextmanager
def receiving_lock(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    need(root.resolve() == root.absolute(), "Receiving root must be canonical")
    descriptor = os.open(root / "receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


@contextlib.contextmanager
def credentials():
    supplied = {
        "LIBNOVA_API_TOKEN": FIXTURE_TOKEN,
        "LIBNOVA_S3_ACCESS_KEY": FIXTURE_ACCESS,
        "LIBNOVA_S3_SECRET_KEY": FIXTURE_SECRET,
        "AWS_EC2_METADATA_DISABLED": "true",
        "NO_PROXY": "127.0.0.1,localhost,::1",
        "no_proxy": "127.0.0.1,localhost,::1",
    }
    previous = {key: os.environ.get(key) for key in supplied}
    os.environ.update(supplied)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def imports(application):
    application = Path(application).absolute()
    sys.path.insert(0, str(application / "research/preservation"))
    for name in ("preservation", "libnova", "libnova_client", "workbench"):
        existing = sys.modules.get(name)
        if existing is not None:
            need(Path(existing.__file__).resolve().parent == application / "research/preservation",
                 "A different application module is already loaded: " + name)
    p = importlib.import_module("preservation")
    q = importlib.import_module("libnova")
    c = importlib.import_module("libnova_client")
    w = importlib.import_module("workbench")
    return p, q, c, w


def application_identity(application):
    application = Path(application).absolute()
    roots = [application / "research/preservation", application / "research/oai/oai_feed.py"]
    rows = {}
    for selected in roots:
        values = sorted(selected.rglob("*")) if selected.is_dir() else [selected]
        for path in values:
            if path.is_symlink():
                raise RuntimeError("Application source is a symlink")
            if path.is_file() and "__pycache__" not in path.parts:
                rows[path.relative_to(application).as_posix()] = identity(path)
    need(all("research/preservation/" + name in rows for name in
             ("preservation.py", "libnova.py", "libnova_client.py",
              "libnova-requirements.txt", "workbench.py")),
         "Complete original LIBNOVA and Workbench source is required")
    return rows


def configuration(api_port, s3_port):
    return {
        "schema": "stellar-forge.libnova-client.v1",
        "baseUrl": f"http://127.0.0.1:{api_port}",
        "tokenEnv": "LIBNOVA_API_TOKEN",
        "containerId": CONTAINER, "storageId": STORAGE,
        "metadataSchemaId": METADATA_SCHEMA, "functionId": FUNCTION,
        "objectPrefix": "reviewed-research",
        "s3": {"endpointUrl": f"http://127.0.0.1:{s3_port}",
               "bucket": BUCKET, "region": "us-east-1",
               "accessKeyEnv": "LIBNOVA_S3_ACCESS_KEY",
               "secretKeyEnv": "LIBNOVA_S3_SECRET_KEY", "addressingStyle": "path"},
        "timeoutSeconds": 10, "indexWaitSeconds": 0, "jobWaitSeconds": 0,
        "pollSeconds": 0.1, "allowLoopback": True,
        "note": "Local contract receiving only; existing IDs are fixture identities, no tenant credentials."
    }


def prepare_foundation(p, q, c, w, application, source, out, api_port, s3_port):
    need(identity(source) == {"bytes": SOURCE_BYTES, "sha256": SOURCE_SHA},
         "The exact original 169-record source example is required")
    foundation = out / "foundation"
    status = p.initialize(source, foundation, "source-export",
                          organization="Commons local LIBNOVA receiving",
                          contact="Local protocol fixture; no tenant submission")
    need(status["sourceRecords"] == 169, "Original source record count differs")
    project, prepared = p.project_files(foundation)
    review = p.empty_review(prepared)
    first = sorted(row["identifier"] for row in prepared["records"])[0]
    review["note"] = "Original 169 metadata records; complete local LIBNOVA receiving."
    review["decisions"] = [{"identifier": first, "include": True,
                            "fields": {"subject": ["Local LIBNOVA receiving classification"]},
                            "reason": "Explicit local receiving review; the original work JSON remains byte-identical."}]
    desired = p.normalize_review(review, prepared)
    expected_sha = p.digest(p.canonical(desired))
    if status["reviewSha256"] != expected_sha:
        need(status["revision"] == 0, "An existing source review has advanced; preserve its original operation")
        p.save_review(foundation, desired, status["revision"])
    status = p.show(foundation)
    need(status["reviewSha256"] == expected_sha and status["includedRecords"] == 169,
         "The saved original review differs")
    selection = {"sourceManifestSha256": project["binding"]["manifestSha256"],
                 "revision": status["revision"], "reviewSha256": status["reviewSha256"]}
    mapping = q.normalize_mapping(q.mapping_template())
    request = {
        "id": OPERATION, "provider": "libnova",
        "label": "Original 169-record LIBNOVA local receiving",
        "selection": selection, "settings": mapping,
        "configuration": c.normalize_configuration(configuration(api_port, s3_port)),
        "jobTemplate": None,
    }
    publish_json(out / "original-destination-request.json", request)
    app = w.Workbench(foundation)
    try:
        app.prepare_migration(request)
        root, saved = app.operation(OPERATION)
        need(saved["requestSha256"] == p.digest(p.canonical(request)),
             "Workbench selected another original destination")
        workspace = root / "prepared"
        verified = q.verify(workspace)
        need(verified["summary"]["includedRecords"] == 169, "Prepared package lost source records")
        operation = c.load_operation(workspace, OPERATION)
        publish_json(out / "prepared-source-binding.json", {
            "schema": SCHEMA + ".source", "source": identity(source),
            "selection": selection, "package": verified,
            "operation": operation, "managedPreparedPath": str(workspace),
            "originalTransfer": identity(root / "original-transfer.zip"),
        })
        return app, foundation, workspace, selection, operation
    except BaseException:
        app.close()
        raise


class Fixture:
    """Persist actual HTTP effects; all source and File IDs survive reopen."""
    def __init__(self, root, workspace, operation, p, q, api_port, s3_port):
        self.root, self.workspace = Path(root), Path(workspace)
        self.operation, self.p, self.q = operation, p, q
        self.api_port, self.s3_port = api_port, s3_port
        self.guard = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self.exchanges = self.root / "exchanges"
        self.exchanges.mkdir(exist_ok=True)
        self.object_dir = self.root / "objects"
        self.object_dir.mkdir(exist_ok=True)
        self.wire_bodies = self.root / "wire-bodies"
        self.wire_bodies.mkdir(exist_ok=True)
        self.metadata_dir = self.root / "metadata"
        self.metadata_dir.mkdir(exist_ok=True)
        self.package = q.read_json(workspace, "package.json")
        self.records = q.read_json(workspace, "record-metadata.json")
        self.mapping = q.read_json(workspace, "mapping.json")
        self.prefix = str(CONTAINER) + "/" + operation["objectPrefix"] + "/"
        directories = {""}
        for row in self.package["binding"]["bagMembers"]:
            parent = PurePosixPath(row["path"]).parent
            while str(parent) != ".":
                directories.add(str(parent))
                parent = parent.parent
        rows = [{"relative": name, "kind": "directory", "bytes": 0, "sha256": sha(b"")}
                for name in sorted(directories, key=lambda value: (value.count("/"), value))]
        rows.extend({"relative": row["path"], "kind": "file",
                     "bytes": row["bytes"], "sha256": row["sha256"]}
                    for row in sorted(self.package["binding"]["bagMembers"], key=lambda value: value["path"]))
        for index, row in enumerate(rows):
            suffix = row["relative"] + ("/" if row["relative"] and row["kind"] == "directory" else "")
            row.update(key=self.prefix + suffix,
                       fullpath="/" + operation["objectPrefix"] + "/" + suffix,
                       id=70000 + index)
        self.rows = rows
        self.by_key = {row["key"]: row for row in rows}
        self.by_id = {row["id"]: row for row in rows}
        self.by_relative = {row["relative"]: row for row in rows}
        self.by_path = {row["fullpath"]: row for row in rows}
        for row in rows:
            parent = str(PurePosixPath(row["relative"]).parent) if row["relative"] else "."
            row["parent"] = 0 if not row["relative"] else self.by_relative["" if parent == "." else parent]["id"]
        self.first_key = rows[0]["key"]
        self.first_record = self.records[0]
        self.first_record_id = self.by_relative[self.first_record["path"]]["id"]
        self.corrupt_key = self.by_relative[self.records[-1]["path"]]["key"]
        self.control_path = self.root / "control.json"
        if not self.control_path.exists():
            publish_json(self.control_path, {"indexVisible": False, "jobCompleted": False,
                                            "jobAssetsVisible": False, "corruptKey": None})
        binding = {"schema": SCHEMA + ".fixture", "operation": operation,
                   "objectRows": rows, "firstMetadataFileId": self.first_record_id,
                   "ports": {"api": api_port, "s3": s3_port},
                   "credentialScope": "Fixed synthetic local credentials, never an existing account"}
        publish_json(self.root / "binding.json", binding)
        self.sequence = max([int(x.name.split("-", 1)[0]) for x in self.exchanges.glob("*-request.json")], default=0)
        self.server_errors = []

    def control(self):
        return read_json(self.control_path)

    def set_control(self, **values):
        with self.guard:
            current = self.control()
            current.update(values)
            replace_json(self.control_path, current)

    def object_path(self, key):
        return self.object_dir / (sha(key.encode()) + ".bin")

    def record(self, kind, method, target, headers, body):
        with self.guard:
            self.sequence += 1
            selected = {key.lower(): value for key, value in headers.items()
                        if key.lower() in {"content-length", "content-type", "content-md5",
                                           "if-none-match", "x-amz-content-sha256"}}
            raw = {"schema": SCHEMA + ".http-request", "number": self.sequence,
                   "kind": kind, "method": method, "target": target,
                   "headers": selected, "authorizationSha256": sha(headers.get("Authorization", "").encode()),
                   "bodyBytes": len(body), "bodySha256": sha(body), "observedAt": now()}
            if kind == "api" and body:
                raw["json"] = json.loads(body)
            publish(self.wire_bodies / (sha(body) + ".bin"), body)
            raw["bodyFile"] = "wire-bodies/" + sha(body) + ".bin"
            path = self.exchanges / f"{self.sequence:08d}-request.json"
            publish_json(path, raw)
            return self.sequence

    def response_record(self, number, status, body, disposition):
        publish(self.wire_bodies / (sha(body) + ".bin"), body)
        publish_json(self.exchanges / f"{number:08d}-response.json",
                     {"status": status, "bytes": len(body), "sha256": sha(body),
                      "disposition": disposition,
                      "bodyFile": "wire-bodies/" + sha(body) + ".bin",
                      "deliveryAuthority": "Local prepared response; the original client transport receipt records delivery."})

    def counts(self):
        counts = Counter()
        keys = Counter()
        metadata = Counter()
        for path in sorted(self.exchanges.glob("*-request.json")):
            record = read_json(path)
            name = record["kind"] + ":" + record["method"]
            counts[name] += 1
            if record["kind"] == "s3" and record["method"] == "PUT":
                keys[urllib.parse.unquote(urllib.parse.urlsplit(record["target"]).path)] += 1
            if record["kind"] == "api" and record["method"] == "PUT":
                metadata[urllib.parse.urlsplit(record["target"]).path] += 1
        return {"methods": dict(counts), "objectPuts": dict(keys),
                "metadataAdds": dict(metadata),
                "functionPosts": counts["api:POST"]}

    def effect_counts(self):
        value = self.counts()
        return {"objectPuts": value["objectPuts"], "metadataAdds": value["metadataAdds"],
                "functionPosts": value["functionPosts"]}

    def native_file(self, row):
        return {"id": row["id"], "container_id": CONTAINER, "fullpath": row["fullpath"],
                "parent": row["parent"], "type": 2 if row["kind"] == "directory" else 1,
                "size": row["bytes"], "deleted": 0, "name": PurePosixPath(row["relative"]).name}

    def metadata_values(self, file_id):
        path = self.metadata_dir / (str(file_id) + ".json")
        if path.exists():
            return read_json(path)
        return [{"id": file_id * 10, "iecode": "local.receiving-note",
                 "value": "Pre-existing unmapped fixture metadata is preserved."}]

    def original_call(self):
        path = self.root / "original-function-call.json"
        return read_json(path) if path.exists() else None

    def report_body(self):
        path = self.root / "original-function-report.json"
        return path.read_bytes() if path.exists() else None

    def accept_function(self, body):
        expected = {"extra": {"research_package_id": self.operation["packageId"],
                              "research_operation_id": OPERATION}}
        need(body == expected, "Function request differs from the original package/operation")
        need(self.original_call() is None, "A duplicate original Function POST was attempted")
        bag = self.root / "function-input"
        for row in self.rows:
            incoming = self.object_path(row["key"])
            need(incoming.is_file() and identity(incoming) == {"bytes": row["bytes"], "sha256": row["sha256"]},
                 "The Function fixture did not receive the complete original source")
            if row["kind"] == "directory":
                (bag / row["relative"]).mkdir(parents=True, exist_ok=True)
            else:
                copy_immutable(incoming, bag / row["relative"])
        verified = self.p.verify(bag)
        need(verified["includedRecords"] == 169
             and verified["identity"] == self.package["binding"]["bagIdentity"]
             and verified["manifestSha256"] == self.package["binding"]["bagManifestSha256"],
             "Actual uploaded BagIt source identity or record count differs")
        call = {"container_id": CONTAINER, "file_id": self.rows[0]["id"],
                "job_id": JOB, "file_path": self.rows[0]["fullpath"],
                "event_key": "local-bagit-contract-receiving"}
        report = {"schema": SCHEMA + ".function-report",
                  "scope": "Local protocol fixture; original preservation.verify checked actual uploaded bytes",
                  "tenantAccepted": False, "deployedFunctionExecuted": False,
                  "jobId": JOB, "request": body, "bagVerification": verified}
        publish_json(self.root / "original-function-report.json", report)
        publish_json(self.root / "original-function-call.json", call)
        return call

    def api(self, method, path, body):
        cfg = self.control()
        if method == "GET" and path == f"container/{CONTAINER}":
            return {"id": CONTAINER, "storage_id": STORAGE, "metadata_schema_id": METADATA_SCHEMA}
        if method == "GET" and path == f"storage/{STORAGE}":
            return {"id": STORAGE, "type": 2, "extra": {
                "provider": "MINIO", "bucket": BUCKET,
                "endpoint": f"http://127.0.0.1:{self.s3_port}", "secure": False,
                "region": "us-east-1"}}
        if method == "GET" and path == f"objects/metadata/schema/{METADATA_SCHEMA}":
            return {"id": METADATA_SCHEMA, "name": "Existing local Dublin Core descriptor schema"}
        if method == "GET" and path == f"functions/{FUNCTION}":
            return {"id": FUNCTION, "source": 2, "key": "local-bagit-validation"}
        if method == "GET" and path == "objects/metadata/schema/descriptor":
            selected = {k: v for item in body["conditions"] for k, v in item.items()}
            need(selected["metadata_schema_id"] == METADATA_SCHEMA, "Descriptor query scope changed")
            rows = [row for row in self.mapping["fields"] if row["iecode"] == selected["iecode"]]
            need(len(rows) == 1, "Unknown mapped descriptor")
            index = self.mapping["fields"].index(rows[0])
            return [{"id": 65000 + index, "metadata_schema_id": METADATA_SCHEMA,
                     "iecode": rows[0]["iecode"], "data_type": self.q.TYPES[rows[0]["dataType"]]}]
        if method == "GET" and path == "file":
            conditions = {key: value for item in body["conditions"] for key, value in item.items()}
            need(conditions["container_id"] == CONTAINER and conditions["deleted"] == 0,
                 "Native index query escaped the original scope")
            if not cfg["indexVisible"]:
                return []
            existing = [row for row in self.rows if self.object_path(row["key"]).exists()]
            if "fullpath" in conditions:
                need(body.get("limit") == 2, "Exact-path collision query changed")
                return [self.native_file(row) for row in existing if row["fullpath"] == conditions["fullpath"]]
            need(conditions.get("id", {}).get("operator") == "gt", "Expected native keyset pagination")
            floor = conditions["id"]["value"]
            selected = [row for row in existing if row["parent"] == conditions["parent"] and row["id"] > floor]
            # Return bounded pages even when the client permits a larger page.
            return [self.native_file(row) for row in sorted(selected, key=lambda row: row["id"])[:37]]
        match = re.fullmatch(r"file/([0-9]+)/metadata", path)
        if match:
            file_id = int(match[1])
            need(file_id in self.by_id, "Metadata selected an unrelated native file")
            if method == "GET":
                return self.metadata_values(file_id)
            need(method == "PUT" and set(body) == {"metadata"}, "Unexpected metadata mutation")
            record = next((record for record in self.records
                           if self.by_relative[record["path"]]["id"] == file_id), None)
            need(record is not None, "Metadata mutation did not select an original record")
            expected = [{**row, "action": "ADD"} for row in record["metadata"]]
            need(body["metadata"] == expected, "Mapped values differ from the saved review")
            target = self.metadata_dir / (str(file_id) + ".json")
            need(not target.exists(), "A duplicate additive metadata PUT was attempted")
            values = self.metadata_values(file_id) + copy.deepcopy(record["metadata"])
            publish_json(target, values)
            return {"file_id": file_id, "updated": True}
        match = re.fullmatch(r"file/([0-9]+)", path)
        if method == "GET" and match:
            file_id = int(match[1])
            if file_id == ASSET:
                report = self.report_body()
                need(report is not None and cfg["jobAssetsVisible"], "Job asset is not yet present")
                return {"id": ASSET, "container_id": CONTAINER, "parent": 0, "type": 1,
                        "deleted": 0, "fullpath": f"/job-reports/{JOB}/bagit-validation.json",
                        "size": len(report)}
            need(file_id in self.by_id and cfg["indexVisible"], "Unknown original native File ID")
            return self.native_file(self.by_id[file_id])
        if method == "POST" and path == f"container/{CONTAINER}/file/{self.rows[0]['id']}/event/{FUNCTION}":
            return self.accept_function(body)
        match = re.fullmatch(r"job/([0-9]+)", path)
        if method == "GET" and match:
            job_id = int(match[1])
            need(self.original_call() is not None, "No original Function job exists")
            if job_id != JOB:
                return {"id": job_id, "container_id": CONTAINER + 1,
                        "function_id": FUNCTION, "file_id": self.rows[0]["id"] + 1,
                        "status": 2, "result": 1}
            return {"id": JOB, "container_id": CONTAINER, "function_id": FUNCTION,
                    "file_id": self.rows[0]["id"],
                    "function_input": {"function_data": {"files": [{"id": self.rows[0]["id"]}]}},
                    "status": 2 if cfg["jobCompleted"] else 3,
                    "result": 2 if cfg["jobCompleted"] else 0}
        if method == "GET" and path == f"job/{JOB}/messages":
            return [{"id": 91001, "job_id": JOB,
                     "message": "Local fixture verified uploaded original BagIt; tenant execution is outside this exercise."}]
        if method == "GET" and path == f"job/{JOB}/assets":
            return [{"id": 95001, "job_id": JOB, "file_id": ASSET}] if cfg["jobAssetsVisible"] else []
        raise RuntimeError("Unexpected original API operation: " + method + " " + path)


class ReceivingServer(http.server.ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalLIBNOVAReceiving/1.0"

    def log_message(self, format, *args):
        return

    @property
    def fixture(self):
        return self.server.fixture

    def body(self):
        need(not self.headers.get("Transfer-Encoding"), "Fixture expects the original fixed-length request")
        values = self.headers.get_all("Content-Length", [])
        need(len(values) <= 1, "Ambiguous request length")
        text = values[0] if values else "0"
        need(re.fullmatch(r"[0-9]+", text) is not None, "Invalid request length")
        size = int(text)
        need(size <= MAX_BODY, "Request exceeds original receiving bound")
        body = self.rfile.read(size)
        need(len(body) == size, "Request body ended early")
        return body

    def reply(self, number, status, body=b"", content_type="application/json", headers=None):
        self.fixture.response_record(number, status, body, "RETURNED")
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Type", content_type)
        self.send_header("Connection", "close")
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(body)
            self.wfile.flush()

    def lose_response(self, number, body):
        # The original effect and this exact disposition are durable before the
        # real TCP connection closes without an HTTP response.
        self.fixture.response_record(number, 200, body, "CONNECTION_CLOSED_AFTER_ORIGINAL_EFFECT")
        self.close_connection = True
        with contextlib.suppress(OSError):
            self.connection.shutdown(socket.SHUT_RDWR)
        self.connection.close()

    def error(self, number, status, code):
        if self.server.kind == "s3":
            root = ET.Element("Error")
            ET.SubElement(root, "Code").text = code
            ET.SubElement(root, "Message").text = code
            body = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            self.reply(number, status, body, "application/xml")
        else:
            self.reply(number, status, canonical({"success": False, "error": code}))

    def s3(self, number, body):
        f = self.fixture
        authorization = self.headers.get("Authorization", "")
        need(authorization.startswith("AWS4-HMAC-SHA256 ")
             and "Credential=" + FIXTURE_ACCESS + "/" in authorization
             and "/us-east-1/s3/aws4_request" in authorization,
             "The real boto3 SigV4 request did not use the selected synthetic local credential")
        need(self.headers.get("X-Amz-Date") and self.headers.get("X-Amz-Content-SHA256"),
             "Missing native SigV4 headers")
        parsed = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        decoded = urllib.parse.unquote(parsed.path)
        need(decoded == "/" + BUCKET or decoded.startswith("/" + BUCKET + "/"),
             "S3 request escaped the original bucket")
        if "list-type" in query:
            need(self.command == "GET" and query["list-type"] == ["2"],
                 "Expected the original list_objects_v2 operation")
            prefix = query.get("prefix", [""])[0]
            need(prefix == f.prefix, "Object listing escaped the exact operation prefix")
            keys = sorted(row["key"] for row in f.rows if f.object_path(row["key"]).is_file())
            token = query.get("continuation-token", [None])[0]
            offset = 0
            if token:
                decoded_token = json.loads(base64.urlsafe_b64decode(token.encode()))
                need(decoded_token.get("prefix") == prefix
                     and type(decoded_token.get("offset")) is int,
                     "Invalid original list continuation")
                offset = decoded_token["offset"]
                need(0 < offset <= len(keys), "Invalid original list offset")
            limit = min(61, int(query.get("max-keys", ["1000"])[0]))
            need(limit > 0, "Invalid native S3 page size")
            page = keys[offset:offset + limit]
            next_offset = offset + len(page)
            root = ET.Element("ListBucketResult", xmlns=S3_NS)
            for key, value in (("Name", BUCKET), ("Prefix", prefix),
                               ("KeyCount", str(len(page))), ("MaxKeys", str(limit)),
                               ("IsTruncated", "true" if next_offset < len(keys) else "false")):
                ET.SubElement(root, key).text = value
            if token:
                ET.SubElement(root, "ContinuationToken").text = token
            if next_offset < len(keys):
                next_token = base64.urlsafe_b64encode(canonical(
                    {"prefix": prefix, "offset": next_offset})).decode()
                ET.SubElement(root, "NextContinuationToken").text = next_token
            for key in page:
                raw = f.object_path(key).read_bytes()
                entry = ET.SubElement(root, "Contents")
                ET.SubElement(entry, "Key").text = key
                ET.SubElement(entry, "Size").text = str(len(raw))
                ET.SubElement(entry, "ETag").text = '"' + hashlib.md5(raw).hexdigest() + '"'
                ET.SubElement(entry, "LastModified").text = "2026-10-12T00:00:00.000Z"
                ET.SubElement(entry, "StorageClass").text = "STANDARD"
            self.reply(number, 200, ET.tostring(root, encoding="utf-8", xml_declaration=True),
                       "application/xml", {"x-amz-request-id": "local-list-" + str(number)})
            return
        need(decoded.startswith("/" + BUCKET + "/"), "Missing original object key")
        key = decoded[len(BUCKET) + 2:]
        report_key = str(CONTAINER) + f"/job-reports/{JOB}/bagit-validation.json"
        row = f.by_key.get(key)
        if self.command == "PUT":
            need(row is not None, "Upload escaped the exact package inventory")
            need(self.headers.get("If-None-Match") == "*", "Conditional original PutObject is required")
            md5 = base64.b64encode(hashlib.md5(body).digest()).decode()
            need(self.headers.get("Content-MD5") == md5
                 and len(body) == row["bytes"] and sha(body) == row["sha256"],
                 "Actual S3 request bytes differ from the frozen package")
            target = f.object_path(key)
            if target.exists():
                self.error(number, 412, "PreconditionFailed")
                return
            publish(target, body)
            response = b""
            if key == f.first_key:
                self.lose_response(number, response)
            else:
                self.reply(number, 200, response, "application/xml",
                           {"ETag": '"' + hashlib.md5(body).hexdigest() + '"',
                            "x-amz-request-id": "local-put-" + str(number),
                            "x-amz-version-id": "original-local-v1"})
            return
        need(self.command in {"GET", "HEAD"}, "Unexpected S3 provider mutation")
        if key == report_key:
            control = f.control()
            raw = f.report_body() if control["jobAssetsVisible"] else None
            if raw is not None and control.get("armCorruptionOnAssetRead"):
                f.set_control(corruptionArmed=True)
        elif row is not None and f.object_path(key).is_file():
            raw = f.object_path(key).read_bytes()
            control = f.control()
            if (control.get("corruptKey") == key and control.get("corruptionArmed")
                    and self.command == "GET"):
                need(bool(raw), "The selected receiving fault needs a nonempty original record")
                raw = bytes([raw[0] ^ 1]) + raw[1:]
        else:
            raw = None
        if raw is None:
            self.error(number, 404, "NoSuchKey")
            return
        self.reply(number, 200, raw, "application/octet-stream",
                   {"ETag": '"' + hashlib.md5(raw).hexdigest() + '"',
                    "x-amz-version-id": "original-local-v1",
                    "x-amz-request-id": "local-get-" + str(number)})

    def api(self, number, body):
        f = self.fixture
        need(self.headers.get("Authorization") == "Bearer " + FIXTURE_TOKEN,
             "API credential escaped the exact synthetic local scope")
        parsed = urllib.parse.urlsplit(self.path)
        need(not parsed.query and parsed.path.startswith("/api/"),
             "Expected the original API path and JSON condition body")
        value = json.loads(body) if body else None
        path = urllib.parse.unquote(parsed.path[len("/api/"):])
        result = f.api(self.command, path, value)
        raw = canonical({"success": True, "result": result})
        if (self.command == "PUT" and path == f"file/{f.first_record_id}/metadata"
                or self.command == "POST"):
            self.lose_response(number, raw)
        else:
            self.reply(number, 200, raw)

    def dispatch(self):
        number = None
        try:
            body = self.body()
            number = self.fixture.record(self.server.kind, self.command,
                                         self.path, self.headers, body)
            # A single client operation runs at a time; the lock also serializes
            # fixture side effects and their returned/lost-response descriptors.
            with self.fixture.guard:
                if self.server.kind == "s3":
                    self.s3(number, body)
                else:
                    self.api(number, body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except BaseException as exc:
            with self.fixture.guard:
                detail = {"request": number, "type": type(exc).__name__,
                          "message": str(exc), "kind": self.server.kind}
                self.fixture.server_errors.append(detail)
                counter = len(list(self.fixture.root.glob("server-error-*.json"))) + 1
                publish_json(self.fixture.root / f"server-error-{counter:04d}.json", detail)
            if number is not None:
                with contextlib.suppress(Exception):
                    self.error(number, 500, "LOCAL_RECEIVING_CONTRACT_MISMATCH")
            self.close_connection = True

    do_GET = dispatch
    do_HEAD = dispatch
    do_PUT = dispatch
    do_POST = dispatch


@contextlib.contextmanager
def servers(fixture):
    opened, threads = [], []
    try:
        for kind, port in (("api", fixture.api_port), ("s3", fixture.s3_port)):
            server = ReceivingServer(("127.0.0.1", port), Handler)
            server.fixture, server.kind = fixture, kind
            opened.append(server)
            thread = threading.Thread(target=server.serve_forever,
                                      kwargs={"poll_interval": 0.05},
                                      name="libnova-local-" + kind, daemon=False)
            thread.start()
            threads.append(thread)
        yield
    finally:
        for server, thread in zip(opened, threads):
            if thread.is_alive():
                server.shutdown()
        for server in opened:
            server.server_close()
        for thread in threads:
            thread.join(timeout=15)
        need(all(not thread.is_alive() for thread in threads),
             "The original local receiving servers did not drain")


def original_action(workspace, key):
    root = Path(workspace) / "operations" / OPERATION / "actions" / sha(key.encode())
    request_path, result_path = root / "request.json", root / "result.json"
    if not request_path.exists():
        return None
    request = read_json(request_path)
    need(request["operationId"] == OPERATION and request["key"] == key,
         "Original provider action changed")
    return {"request": request, "requestFile": identity(request_path),
            "result": read_json(result_path) if result_path.exists() else None,
            "resultFile": identity(result_path) if result_path.exists() else None}


def current_state(c, workspace):
    value = c.show(workspace, OPERATION)
    need(value["operation"]["id"] == OPERATION and value["state"]["operationId"] == OPERATION,
         "Current original client identity differs")
    return value["state"]


def state_identity(workspace):
    return identity(Path(workspace) / "operations" / OPERATION / "state.json")


def phase(out, label, workspace, c, fixture, action, expected, invoke,
          *, setup=None, interrupted_effect=None, verify=None):
    """Retain one invocation, reuse its saved return, and reconcile an interruption.

    Existing client actions remain authoritative. The fixture never clears them
    or dispatches a substitute write to force a fault scenario to start over.
    """
    root = out / "phases"
    request_path = root / (label + ".request.json")
    result_path = root / (label + ".result.json")
    if request_path.exists():
        request = read_json(request_path)
        need(request["schema"] == SCHEMA + ".phase-request"
             and request["operationId"] == OPERATION and request["label"] == label
             and request["action"] == action and request["expected"] == expected,
             "Retained phase belongs to different receiving work")
    else:
        request = {"schema": SCHEMA + ".phase-request", "operationId": OPERATION,
                   "label": label, "action": action, "expected": expected,
                   "beforeState": state_identity(workspace),
                   "beforeEffects": fixture.effect_counts(),
                   "beforeRequestNumber": fixture.sequence, "preparedAt": now()}
        publish_json(request_path, request)
    request_sha = sha(canonical(request))
    if result_path.exists():
        result = read_json(result_path)
        need(result["requestSha256"] == request_sha and result["operationId"] == OPERATION,
             "Retained phase result differs")
        return result
    old = current_state(c, workspace)
    changed = state_identity(workspace) != request["beforeState"]
    inferred = interrupted_effect() if interrupted_effect else None
    if changed and old.get("state") == expected:
        value, basis = old, "Original terminal phase state recovered without redispatch"
    elif inferred:
        value = old
        basis = "Original effect and request retained; interruption reconstructed without redispatch"
    else:
        if setup is not None:
            setup()
        value = invoke()
        basis = "Original client call returned"
        need(isinstance(value, dict), "Expected the original returned client state")
    if inferred:
        need(expected == "RECONCILE_REQUIRED", "Only an original uncertain-write phase may use effect recovery")
    else:
        need(value.get("state") == expected,
             f"Phase {label}: expected {expected}, observed {value.get('state')}")
    if verify is not None:
        verify(value)
    result = {"schema": SCHEMA + ".phase-result", "operationId": OPERATION,
              "label": label, "requestSha256": request_sha, "basis": basis,
              "expected": expected, "observedState": value,
              "interruptedOriginalEffect": inferred,
              "afterEffects": fixture.effect_counts(),
              "lastRequestNumber": fixture.sequence, "observedAt": now()}
    publish_json(result_path, result)
    print(json.dumps({"phase": label, "state": value.get("state"), "basis": basis}), flush=True)
    return result


def provider_snapshot(q, c, workspace, output):
    """Reuse an exact complete original snapshot if publication already succeeded."""
    output = Path(output)
    selected_path = output.with_name(output.name + ".selection.json")
    state = current_state(c, workspace)
    operation = c.load_operation(workspace, OPERATION)
    if selected_path.exists():
        selected = read_json(selected_path)
        need(selected["operation"] == operation, "Snapshot selection changed its original operation")
    else:
        need(state.get("state") == "VERIFIED", "Export requires the complete observed original operation")
        selected = {"schema": SCHEMA + ".snapshot-selection", "operation": operation,
                    "state": state, "stateFile": state_identity(workspace)}
        publish_json(selected_path, selected)
    if not output.exists():
        need(state_identity(workspace) == selected["stateFile"],
             "Source state advanced before the selected snapshot was published")
        q.export(workspace, output)
    with zipfile.ZipFile(output) as archive:
        manifest = q.verify_snapshot(archive)
        need(manifest["packageId"] == operation["packageId"],
             "Snapshot contains another package")
        stored_operation = json.loads(archive.read("workspace/operations/" + OPERATION + "/operation.json"))
        stored_state = json.loads(archive.read("workspace/operations/" + OPERATION + "/state.json"))
        need(stored_operation == operation and stored_state == selected["state"]
             and stored_state.get("state") == "VERIFIED",
             "Snapshot does not contain the selected original verified state")
        proof_name = "workspace/operations/" + OPERATION + "/" + stored_state["proof"]["path"]
        need(identity_bytes(archive.read(proof_name)) == {
            key: stored_state["proof"][key] for key in ("bytes", "sha256")},
            "Snapshot receiving proof differs")
        saved = {"path": str(output), **identity(output),
                 "manifestSha256": sha(archive.read("SNAPSHOT_MANIFEST.json")),
                 "members": len(manifest["members"]) + 1,
                 "packageId": operation["packageId"], "operationId": OPERATION,
                 "selectedStateSha256": selected["stateFile"]["sha256"]}
    publish_json(output.with_name(output.name + ".receiving.json"), saved)
    return saved


def identity_bytes(raw):
    return {"bytes": len(raw), "sha256": sha(raw)}


def workbench_snapshot(w, p, c, app, output, selection):
    output = Path(output)
    selected_path = output.with_name(output.name + ".selection.json")
    root, destination = app.operation(OPERATION)
    operation = c.load_operation(root / "prepared", OPERATION)
    progress = current_state(c, root / "prepared")
    wanted = {"schema": SCHEMA + ".workbench-snapshot-selection",
              "selection": selection, "operation": operation,
              "state": progress, "destination": destination}
    if selected_path.exists():
        selected = read_json(selected_path)
        need(selected["selection"] == selection and selected["operation"] == operation
             and selected["destination"] == destination,
             "Whole-workspace snapshot selection changed")
    else:
        need(progress.get("state") == "VERIFIED", "Whole workspace lacks a verified original operation")
        publish_json(selected_path, wanted)
        selected = wanted
    if not output.exists():
        need(progress == selected["state"], "Selected full workspace advanced before export")
        w.export_workspace(app, output)
    with zipfile.ZipFile(output) as archive:
        manifest = w.snapshot_manifest(archive)
        need(manifest["selection"] == selection and manifest["sourceRecords"] == 169,
             "Whole snapshot lost the original source/review")
        operation_prefix = "operator/operations/" + OPERATION + "/prepared/operations/" + OPERATION + "/"
        need(json.loads(archive.read(operation_prefix + "operation.json")) == operation
             and json.loads(archive.read(operation_prefix + "state.json")) == selected["state"],
             "Whole snapshot contains a different original operation")
        provider_group = {
            "application/research/preservation/" + name for name in
            ("libnova.py", "libnova_client.py", "libnova-requirements.txt",
             "LIBNOVA.md", "LIBNOVA_PROVIDER_CONTRACT.md")}
        need(provider_group <= set(manifest["files"]),
             "The LIBNOVA operation needs its complete portable provider source")
    item = app.artifact(output, "complete-workspace", selection)
    result = {"path": str(output), **identity(output), "artifact": item,
              "members": len(manifest["files"]) + 1, "selection": selection,
              "operationId": OPERATION}
    publish_json(output.with_name(output.name + ".receiving.json"), result)
    return result


def effect_evidence(fixture, workspace, key, provider_kind, method, path, effect_path):
    action = original_action(workspace, key)
    effect_path = Path(effect_path)
    if action is None or not effect_path.is_file():
        return None
    matching = []
    for request_path in sorted(fixture.exchanges.glob("*-request.json")):
        request = read_json(request_path)
        if (request["kind"] == provider_kind and request["method"] == method
                and urllib.parse.unquote(urllib.parse.urlsplit(request["target"]).path) == path):
            response_path = request_path.with_name(request_path.name.replace("-request.json", "-response.json"))
            matching.append({"request": identity(request_path),
                             "number": request["number"],
                             "response": read_json(response_path) if response_path.exists() else None})
    need(len(matching) == 1, "Original uncertain write must have exactly one captured dispatch")
    return {"originalAction": action, "providerDispatch": matching[0],
            "actualEffect": identity(effect_path),
            "scope": "Retained actual service effect; no claim that its response reached the client"}


def assert_unresolved(workspace, key):
    action = original_action(workspace, key)
    need(action is not None and action["result"] is None,
         "Expected one original started action without a committed outcome")
    return action


def assert_complete(fixture, c, workspace):
    progress = current_state(c, workspace)
    need(progress["state"] == "VERIFIED", "The saved original operation is not verified")
    need(progress["summary"]["includedRecords"] == 169
         and progress["summary"]["sourceRecords"] == 169
         and progress["summary"]["originalJobId"] == JOB,
         "The original receiving count or job changed")
    need(progress["job"]["result"] == "OK_WITH_WARNING",
         "The native job result must remain separate from content verification")
    proof = read_json(Path(workspace) / "operations" / OPERATION / progress["proof"]["path"])
    need(len(proof["records"]) == 169
         and len(proof["members"]) == len(fixture.rows),
         "Complete original record/member proofs were not retained")
    records = {row["identifier"]: row for row in proof["records"]}
    for original in fixture.records:
        observed = records.get(original["identifier"])
        need(observed is not None
             and observed["path"] == original["path"]
             and observed["sourceSha256"] == original["sourceSha256"]
             and observed["sha256"] == original["sourceSha256"]
             and observed["metadata"] == original["metadata"]
             and observed["fileId"] == fixture.by_relative[original["path"]]["id"]
             and observed["unmappedPreserved"] is True,
             "A source/review/native File ID/metadata proof differs")
    for row in fixture.rows:
        need(identity(fixture.object_path(row["key"])) == {
            "bytes": row["bytes"], "sha256": row["sha256"]},
            "The original stored upload changed")
    effects = fixture.effect_counts()
    expected_objects = {"/" + BUCKET + "/" + row["key"]: 1 for row in fixture.rows}
    expected_metadata = {
        f"/api/file/{fixture.by_relative[record['path']]['id']}/metadata": 1
        for record in fixture.records}
    need(effects["objectPuts"] == expected_objects, "An original object was omitted or uploaded twice")
    need(effects["metadataAdds"] == expected_metadata, "An additive metadata request was omitted or repeated")
    need(effects["functionPosts"] == 1, "The original Function was invoked more than once")
    need(not fixture.server_errors and not list(fixture.root.glob("server-error-*.json")),
         "The local receiver observed a source/protocol contract error")
    return {"state": progress, "proof": progress["proof"],
            "effects": effects, "records": len(proof["records"]),
            "members": len(proof["members"])}


def run_phases(out, app, c, workspace, fixture):
    call = lambda action, evidence=None: app.continue_migration(OPERATION, action, evidence)["result"]
    root_key = "put:" + fixture.first_key
    root_effect = lambda: effect_evidence(
        fixture, workspace, root_key, "s3", "PUT", "/" + BUCKET + "/" + fixture.first_key,
        fixture.object_path(fixture.first_key))
    phase(out, "01-original-put-response-lost", workspace, c, fixture, "run",
          "RECONCILE_REQUIRED", lambda: call("run"),
          interrupted_effect=root_effect,
          verify=lambda value: assert_unresolved(workspace, root_key))
    phase(out, "02-original-put-readback", workspace, c, fixture, "refresh",
          "REQUIRES_RUN", lambda: call("refresh"),
          verify=lambda value: need(original_action(workspace, root_key)["result"] is not None,
                                    "The original root object was not adopted"))
    phase(out, "03-complete-source-upload-index-pending", workspace, c, fixture, "run",
          "WAITING_INDEX", lambda: call("run"),
          verify=lambda value: need(all(fixture.object_path(row["key"]).is_file()
                                       for row in fixture.rows), "Some original uploads are absent"))
    metadata_key = "metadata:" + fixture.first_record["identifier"]
    metadata_effect = lambda: effect_evidence(
        fixture, workspace, metadata_key, "api", "PUT",
        f"/api/file/{fixture.first_record_id}/metadata",
        fixture.metadata_dir / (str(fixture.first_record_id) + ".json"))
    phase(out, "04-original-metadata-response-lost", workspace, c, fixture, "run",
          "RECONCILE_REQUIRED", lambda: call("run"),
          setup=lambda: fixture.set_control(indexVisible=True),
          interrupted_effect=metadata_effect,
          verify=lambda value: assert_unresolved(workspace, metadata_key))
    phase(out, "05-original-metadata-readback", workspace, c, fixture, "refresh",
          "REQUIRES_RUN", lambda: call("refresh"),
          verify=lambda value: need(original_action(workspace, metadata_key)["result"] is not None,
                                    "The original metadata ADD was not adopted"))
    function_effect = lambda: effect_evidence(
        fixture, workspace, "function", "api", "POST",
        f"/api/container/{CONTAINER}/file/{fixture.rows[0]['id']}/event/{FUNCTION}",
        fixture.root / "original-function-call.json")
    phase(out, "06-original-function-response-lost", workspace, c, fixture, "run",
          "RECONCILE_REQUIRED", lambda: call("run"),
          interrupted_effect=function_effect,
          verify=lambda value: assert_unresolved(workspace, "function"))
    phase(out, "07-original-job-identity-required", workspace, c, fixture, "refresh",
          "RECONCILE_REQUIRED", lambda: call("refresh"),
          verify=lambda value: need(fixture.effect_counts()["functionPosts"] == 1,
                                    "Read-only reconciliation launched another Function"))

    # A job ID from another folder/container is not sufficient evidence.
    wrong_path = out / "phases/08-unrelated-job-rejected.json"
    wrong = {"schema": c.OP_SCHEMA + ".reconciliation", "kind": "original-job-id",
             "jobId": JOB + 1, "note": "Deliberately unrelated local fixture job; must not be adopted."}
    publish_json(out / "phases/08-unrelated-job-request.json", wrong)
    if not wrong_path.exists():
        original = assert_unresolved(workspace, "function")
        before = fixture.effect_counts()
        try:
            call("reconcile", wrong)
        except c.ReceivingPause as exc:
            need(exc.status == "ORIGINAL_JOB_BINDING_MISMATCH",
                 "Unrelated job failed for a different reason")
            observed_error = {"type": type(exc).__name__, "state": exc.status}
        else:
            raise RuntimeError("An unrelated native job was incorrectly adopted")
        need(original_action(workspace, "function") == original
             and fixture.effect_counts() == before,
             "Rejected evidence changed the original provider action")
        publish_json(wrong_path, {"schema": SCHEMA + ".rejected-evidence",
                     "operationId": OPERATION, "evidenceSha256": sha(canonical(wrong)),
                     "error": observed_error, "originalAction": original})
    else:
        need(read_json(wrong_path)["evidenceSha256"] == sha(canonical(wrong)),
             "Rejected original evidence changed")

    evidence = {"schema": c.OP_SCHEMA + ".reconciliation", "kind": "original-job-id",
                "jobId": JOB,
                "note": "Original local Function request and saved service job receipt in original-function-call.json."}
    publish_json(out / "phases/09-original-job-evidence.json", evidence)
    phase(out, "09-original-job-id-adopted", workspace, c, fixture, "reconcile",
          "ORIGINAL_JOB_RECONCILED", lambda: call("reconcile", evidence),
          verify=lambda value: need(
              original_action(workspace, "function")["result"]["call"]["job_id"] == JOB,
              "The original returned native job was replaced"))
    phase(out, "10-original-job-waiting", workspace, c, fixture, "refresh",
          "WAITING_JOB", lambda: call("refresh"))
    phase(out, "11-completed-job-report-pending", workspace, c, fixture, "refresh",
          "WAITING_JOB_ASSETS", lambda: call("refresh"),
          setup=lambda: fixture.set_control(jobCompleted=True, jobAssetsVisible=False))
    phase(out, "12-completed-job-content-mismatch", workspace, c, fixture, "refresh",
          "REMOTE_CONTENT_MISMATCH", lambda: call("refresh"),
          setup=lambda: fixture.set_control(jobCompleted=True, jobAssetsVisible=True,
                     corruptKey=fixture.corrupt_key, armCorruptionOnAssetRead=True,
                     corruptionArmed=False),
          verify=lambda value: need(fixture.control().get("corruptionArmed") is True,
                                    "The actual report read did not precede the final content fault"))
    phase(out, "13-original-content-and-metadata-verified", workspace, c, fixture, "refresh",
          "VERIFIED", lambda: call("refresh"),
          setup=lambda: fixture.set_control(corruptKey=None, armCorruptionOnAssetRead=False,
                                            corruptionArmed=False),
          verify=lambda value: assert_complete(fixture, c, workspace))
    return assert_complete(fixture, c, workspace)


def process_identity(pid=None):
    pid = os.getpid() if pid is None else int(pid)
    raw = Path(f"/proc/{pid}/stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    return {"pid": pid, "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "startTicks": fields[19]}


def original_process_inactive(value):
    try:
        current = process_identity(value["pid"])
    except FileNotFoundError:
        return True
    return current != value


def provider_imports(application):
    application = Path(application).absolute()
    sys.path.insert(0, str(application / "research/preservation"))
    modules = []
    for name in ("preservation", "libnova", "libnova_client"):
        module = importlib.import_module(name)
        need(Path(module.__file__).resolve().parent == application / "research/preservation",
             "Cold receiving imported another application source")
        modules.append(module)
    return tuple(modules)


def scan_snapshot_credentials(path, manifest_name):
    # Only fixed synthetic receiving values are in memory. Persisted provider
    # workspaces must still retain environment references rather than values.
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith("application/"):
                continue
            with archive.open(name) as handle:
                tail = b""
                while True:
                    block = handle.read(262144)
                    if not block:
                        break
                    window = tail + block
                    need(FIXTURE_TOKEN.encode() not in window
                         and FIXTURE_SECRET.encode() not in window,
                         "A portable provider workspace retained a credential value")
                    tail = window[-128:]


def cold_provider(args):
    p, q, c = provider_imports(args.application)
    out, workspace = Path(args.out).absolute(), Path(args.workspace).absolute()
    out.mkdir(parents=True, exist_ok=True)
    request_path = out / "cold-request.json"
    result_path = out / "cold-result.json"
    operation = c.load_operation(workspace, OPERATION)
    if request_path.exists():
        request = read_json(request_path)
        need(request["operation"] == operation and request["workspace"] == str(workspace),
             "Cold original operation changed")
    else:
        request = {"schema": SCHEMA + ".cold-request", "operation": operation,
                   "workspace": str(workspace), "beforeState": state_identity(workspace),
                   "application": str(Path(args.application).absolute())}
        publish_json(request_path, request)
    if result_path.exists():
        result = read_json(result_path)
        need(result["requestSha256"] == sha(canonical(request)), "Cold result binding changed")
        need(current_state(c, workspace)["state"] == "VERIFIED", "Cold original state is no longer verified")
        for artifact in result["artifacts"]:
            need(identity(artifact["path"]) == {key: artifact[key] for key in ("bytes", "sha256")},
                 "Cold completed artifact differs")
        print(json.dumps({"coldProvider": "REOPENED", "receipt": str(result_path)}), flush=True)
        return
    old = current_state(c, workspace)
    if state_identity(workspace) != request["beforeState"] and old["state"] == "VERIFIED":
        returned = old
        basis = "Original cold refresh recovered from its committed state"
    else:
        returned = c.refresh(workspace, OPERATION)
        basis = "Original cold refresh returned"
    need(returned["state"] == "VERIFIED" and returned["summary"]["includedRecords"] == 169,
         "Cold provider readback did not verify the original 169 records")
    output = provider_snapshot(q, c, workspace, out / "LIBNOVA_Cold_Original_Operation.zip")
    scan_snapshot_credentials(output["path"], "SNAPSHOT_MANIFEST.json")
    result = {"schema": SCHEMA + ".cold-result", "operationId": OPERATION,
              "requestSha256": sha(canonical(request)), "basis": basis,
              "state": returned, "artifacts": [output], "process": process_identity(),
              "observedAt": now()}
    publish_json(result_path, result)
    print(json.dumps({"coldProvider": "VERIFIED", "receipt": str(result_path)}), flush=True)


def cold_workbench(args):
    p, q, c, w = imports(args.application)
    out, workspace = Path(args.out).absolute(), Path(args.workspace).absolute()
    out.mkdir(parents=True, exist_ok=True)
    request = read_json(args.request)
    result_path = out / "cold-workbench-result.json"
    if result_path.exists():
        result = read_json(result_path)
        need(result["requestSha256"] == sha(canonical(request)), "Cold Workbench request differs")
        for artifact in result["artifacts"]:
            need(identity(artifact["path"]) == {key: artifact[key] for key in ("bytes", "sha256")},
                 "Cold Workbench artifact differs")
        print(json.dumps({"coldWorkbench": "REOPENED", "receipt": str(result_path)}), flush=True)
        return
    app = w.Workbench(workspace)
    try:
        before_root, before_selection = app.operation(OPERATION)
        before = current_state(c, before_root / "prepared")
        need(before["state"] == "VERIFIED", "Received Workbench lost its original verified operation")
        # This is the same saved operation and an offline preparation reopen.
        # It must not invoke a new upload, metadata update, or Function.
        app.prepare_migration(request)
        root, selected = app.operation(OPERATION)
        after = current_state(c, root / "prepared")
        need(selected == before_selection and before == after,
             "Offline Workbench reopen changed the provider state or saved selection")
        output = workbench_snapshot(w, p, c, app,
            app.control / "deliveries/LIBNOVA_Cold_Complete_Workbench.zip", request["selection"])
        scan_snapshot_credentials(output["path"], "MANIFEST.json")
        result = {"schema": SCHEMA + ".cold-workbench", "operationId": OPERATION,
                  "requestSha256": sha(canonical(request)), "workspace": str(workspace),
                  "prepared": str(root / "prepared"), "state": after,
                  "artifacts": [output], "process": process_identity(), "observedAt": now()}
    finally:
        app.close()
    # Publication is after the copied Workbench releases its control lock.
    publish_json(result_path, result)
    print(json.dumps({"coldWorkbench": "VERIFIED", "receipt": str(result_path)}), flush=True)


def subprocess_phase(out, label, arguments, final_receipt):
    request_path = out / (label + ".process-request.json")
    process_path = out / (label + ".process.json")
    expected = {"schema": SCHEMA + ".process-request", "operationId": OPERATION,
                "label": label, "argv": arguments, "receipt": str(final_receipt)}
    publish_json(request_path, expected)
    if process_path.exists():
        prior = read_json(process_path)
        need(prior["requestSha256"] == sha(canonical(expected)), "Original child request changed")
        if prior.get("exitCode") == 0:
            need(identity(final_receipt) == prior["receipt"], "Saved cold receiving result differs")
            return prior
        need(original_process_inactive(prior["process"]), "The original cold receiving child remains active")
    for attempt_path in sorted(out.glob(label + ".attempt-*.json")):
        retained_attempt = read_json(attempt_path)
        need(retained_attempt["requestSha256"] == sha(canonical(expected)), "Original child attempt differs")
        need(original_process_inactive(retained_attempt["process"]), "The original cold child is still active")
    # A completed receiving receipt also resolves loss between the child exit and
    # publication of the parent's process result. Its own bound artifact checks
    # are repeated by that child's same immutable entrypoint below.
    stdout = out / (label + ".stdout.log")
    stderr = out / (label + ".stderr.log")
    attempt = len(list(out.glob(label + ".attempt-*.json"))) + 1
    started = now()
    with open(stdout, "ab", buffering=0) as output, open(stderr, "ab", buffering=0) as errors:
        os.chmod(stdout, 0o600)
        os.chmod(stderr, 0o600)
        process = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=output, stderr=errors, close_fds=True)
        try:
            selected = process_identity(process.pid)
            attempt_path = out / f"{label}.attempt-{attempt:04d}.json"
            publish_json(attempt_path, {"schema": SCHEMA + ".process-attempt",
                         "requestSha256": sha(canonical(expected)), "process": selected,
                         "startedAt": started})
            process.stdin.write(b"START\n")
            process.stdin.flush()
            process.stdin.close()
            code = process.wait(timeout=900)
        except BaseException:
            # Closing the gate also releases a child that never received START.
            # Preserve the original failure if it has already exited meanwhile.
            with contextlib.suppress(OSError):
                process.stdin.close()
            with contextlib.suppress(ProcessLookupError):
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                process.wait()
            raise
        output.flush()
        errors.flush()
        os.fsync(output.fileno())
        os.fsync(errors.fileno())
    result = {"schema": SCHEMA + ".process-result", "requestSha256": sha(canonical(expected)),
              "process": selected, "exitCode": code, "startedAt": started,
              "finishedAt": now(), "stdout": identity(stdout), "stderr": identity(stderr),
              "receipt": identity(final_receipt) if Path(final_receipt).exists() else None}
    replace_json(process_path, result)
    need(code == 0 and result["receipt"] is not None, "Original cold receiving child did not complete")
    return result


def freeze_application(application, out):
    rows = application_identity(application)
    binding = {"schema": SCHEMA + ".application", "files": rows}
    publish_json(out / "application-binding.json", binding)
    # The complete Workbench ZIP below includes these original application files.
    # This small plain-source copy makes the receiving entrypoint inspectable too.
    source = Path(__file__).absolute()
    copy_immutable(source, out / "receiving-source/run_libnova_receiving.py")
    return binding


def final_checks(value):
    for artifact in value["artifacts"].values():
        need(identity(artifact["path"]) == {key: artifact[key] for key in ("bytes", "sha256")},
             "A completed original receiving artifact changed")
    for item in value["retainedChecks"]:
        need(identity(item["path"]) == {"bytes": item["bytes"], "sha256": item["sha256"]},
             "A retained original receiving checkpoint changed")


def report_html(result):
    import html
    escape = lambda value: html.escape(str(value), quote=True)
    rows = "".join("<tr><td>" + escape(name) + "</td><td>" +
                   escape(value["bytes"]) + "</td><td><code>" +
                   escape(value["sha256"]) + "</code></td></tr>"
                   for name, value in result["artifacts"].items())
    phases = "".join("<li><code>" + escape(value["label"]) + "</code>: " +
                     escape(value["expected"]) + "</li>" for value in result["phases"])
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>LIBNOVA original 169-record receiving</title>"
            "<style>body{font:16px/1.5 system-ui;max-width:1100px;margin:40px auto;padding:0 22px}"
            "table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:9px;border-bottom:1px solid #ccd5df}"
            "code{font-size:12px;overflow-wrap:anywhere}.scope{padding:16px;background:#eef4fa;border-left:4px solid #276299}"
            "</style><h1>LIBNOVA original research receiving</h1>"
            "<p class=\"scope\">This is one completed local contract receiving operation against "
            "the published client and producer. It used actual Python HTTP transports and boto3/botocore "
            "SigV4 requests with synthetic local credentials. No LIBNOVA tenant was contacted, "
            "no tenant ingest was accepted, and no deployed BagIt Function was executed. "
            "The original preservation verifier checked the actual uploaded BagIt bytes in the fixture.</p>"
            "<p>Operation <code>" + escape(OPERATION) + "</code> retained the original "
            "169 CC0 bibliographic records, one reviewed source selection, one native container, "
            "and job <code>" + escape(JOB) + "</code>. Every original object was uploaded once "
            "with a conditional PUT, each record received its mapped metadata once, and the "
            "Function was invoked once. Unmapped native metadata stayed present.</p>"
            "<h2>Actual interruption and reconciliation</h2><ol>" + phases + "</ol>"
            "<p>The completed job returned <code>OK_WITH_WARNING</code>. The client still required "
            "the original job report, every source content hash, complete native File IDs and "
            "paths, and all mapped metadata before recording <code>VERIFIED</code>. A deliberate "
            "changed-content response was refused after the job report became available.</p>"
            "<h2>Portable continuation</h2><p>The provider workspace was exported and received, "
            "then its copied application ran a fresh-process readback against the same local "
            "objects and original job. Re-receiving the first snapshot preserved this later "
            "verified state. A separate whole Workbench export retained the original managed "
            "operation, review history, source, provider journal and complete application. "
            "Its copied Workbench reopened the same prepared operation offline and exported it "
            "again. Neither cold path issued a provider write.</p>"
            "<p>The original source workspace and managed operation paths are retained in "
            "<code>receiving-result.json</code> for the existing browser receiving handoff. "
            "Both loopback servers, all request threads, both cold children and Workbench locks "
            "were drained before this completion was published.</p>"
            "<h2>Retained artifacts</h2><table><thead><tr><th>Artifact</th><th>Bytes</th>"
            "<th>SHA-256</th></tr></thead><tbody>" + rows + "</tbody></table>"
            "<p>Original metadata is CC0; described publications keep their separate rights. "
            "The complete package preserves source, request, response, job and artifact identities.</p></html>").encode("utf-8")


def delivery(out, result):
    """Publish one complete immutable evidence/source handoff after runtime drain."""
    output = out / "LIBNOVA_Original_169_Complete_Receiving.zip"
    descriptor_path = out / "LIBNOVA_Original_169_Complete_Receiving.delivery.json"
    selected = {
        "receiving-result.json": out / "receiving-result.json",
        "LIBNOVA_Receiving_Report.html": out / "LIBNOVA_Receiving_Report.html",
        "receiving-binding.json": out / "receiving-binding.json",
        "application-binding.json": out / "application-binding.json",
        "original-destination-request.json": out / "original-destination-request.json",
        "prepared-source-binding.json": out / "prepared-source-binding.json",
        "original-source.zip": out / "original-source.zip",
        "receiving-final-control.json": out / "receiving-final-control.json",
    }
    for name, value in result["artifacts"].items():
        selected["artifacts/" + name + ".zip"] = Path(value["path"])
    for name in ("phases", "fixture", "receiving-source", "cold-provider", "cold-workbench"):
        root = out / name
        for path in sorted(root.rglob("*")):
            if path.is_symlink():
                raise RuntimeError("A receiving evidence path is a symlink")
            if path.is_file() and not path.name.endswith(".zip"):
                selected[name + "/" + path.relative_to(root).as_posix()] = path
    for path in sorted(out.glob("*.process*.json")):
        selected[path.name] = path
    for path in sorted(out.glob("*.attempt-*.json")):
        selected[path.name] = path
    for suffix in ("*.stdout.log", "*.stderr.log"):
        for path in sorted(out.glob(suffix)):
            selected[path.name] = path
    manifest = {"schema": SCHEMA + ".delivery", "operationId": OPERATION,
                "resultSha256": identity(out / "receiving-result.json")["sha256"],
                "scope": result["scope"],
                "files": {name: identity(path) for name, path in sorted(selected.items())}}
    manifest_raw = canonical(manifest)
    if not output.exists():
        descriptor, temporary = tempfile.mkstemp(prefix=".libnova-delivery-", dir=out)
        os.close(descriptor)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                for name, path in sorted(selected.items()):
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.compress_type = zipfile.ZIP_STORED if name.endswith(".zip") else zipfile.ZIP_DEFLATED
                    with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                        shutil.copyfileobj(source, target, 262144)
                info = zipfile.ZipInfo("MANIFEST.json", date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, manifest_raw)
            with open(temporary, "rb") as handle:
                os.fsync(handle.fileno())
            verify_delivery(temporary, manifest)
            os.link(temporary, output)
            sync_directory(out)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    verify_delivery(output, manifest)
    value = {"schema": SCHEMA + ".delivery-receipt", "operationId": OPERATION,
             "path": str(output), **identity(output), "members": len(selected) + 1,
             "manifestSha256": sha(manifest_raw),
             "receivingResult": identity(out / "receiving-result.json")}
    publish_json(descriptor_path, value)
    return value


def verify_delivery(path, expected):
    with zipfile.ZipFile(path) as archive:
        need(len(archive.namelist()) == len(set(archive.namelist()))
             and set(archive.namelist()) == set(expected["files"]) | {"MANIFEST.json"},
             "Complete receiving ZIP has an unexpected member inventory")
        need(archive.read("MANIFEST.json") == canonical(expected),
             "Complete receiving ZIP manifest differs")
        for name, descriptor in expected["files"].items():
            h, length = hashlib.sha256(), 0
            with archive.open(name) as incoming:
                for block in iter(lambda: incoming.read(262144), b""):
                    h.update(block)
                    length += len(block)
            need({"bytes": length, "sha256": h.hexdigest()} == descriptor,
                 "Complete receiving ZIP member differs: " + name)
        need(archive.testzip() is None, "Complete receiving ZIP failed its CRC readback")


def main_journey(args):
    from importlib import metadata
    application = Path(args.application).absolute()
    source = Path(args.source).absolute()
    out = Path(args.out).absolute()
    need(application.resolve() == application and source.resolve() == source,
         "Use canonical original application and source paths")
    need(1 <= args.api_port <= 65535 and 1 <= args.s3_port <= 65535
         and args.api_port != args.s3_port, "Select two distinct loopback ports")
    with receiving_lock(out):
        source_id = identity(source)
        need(source_id == {"bytes": SOURCE_BYTES, "sha256": SOURCE_SHA},
             "Original source example changed")
        source_identity = application_identity(application)
        binding_path = out / "receiving-binding.json"
        if binding_path.exists():
            binding = read_json(binding_path)
            need(binding["source"] == source_id and binding["application"] == source_identity
                 and binding["ports"] == {"api": args.api_port, "s3": args.s3_port}
                 and binding["operationId"] == OPERATION,
                 "This receiving directory belongs to different original inputs")
        else:
            boto_version, core_version = metadata.version("boto3"), metadata.version("botocore")
            version = tuple(int(part) for part in boto_version.split(".")[:2])
            need((1, 36) <= version < (2, 0), "Use the declared original boto3 dependency")
            binding = {"schema": SCHEMA + ".binding", "operationId": OPERATION,
                       "source": source_id, "application": source_identity,
                       "ports": {"api": args.api_port, "s3": args.s3_port},
                       "runtime": {"python": sys.version, "executable": sys.executable,
                                   "boto3": boto_version, "botocore": core_version},
                       "startedAt": now()}
            publish_json(binding_path, binding)
        result_path = out / "receiving-result.json"
        candidate_path = out / "completion-candidate.json"
        if result_path.exists():
            result = read_json(result_path)
            need(result["bindingSha256"] == sha(canonical(binding)), "Completed receiving binding differs")
            final_checks(result)
            publish(out / "LIBNOVA_Receiving_Report.html", report_html(result))
            saved = delivery(out, result)
            print(json.dumps({"outcome": "PASS_REOPENED", "receipt": str(result_path),
                              "delivery": saved}), flush=True)
            return
        if candidate_path.exists():
            candidate = read_json(candidate_path)
            need(candidate["bindingSha256"] == sha(canonical(binding))
                 and original_process_inactive(candidate["producerProcess"]),
                 "Original completion candidate still has a live producer or different binding")
            final_checks(candidate)
            result = {**candidate, "outcome": "PASS",
                      "drain": {"servers": "Previous bound process is absent",
                                "coldChildren": "Completed child receipts are retained",
                                "workbench": "Previous bound process is absent",
                                "recoveredAfterInterruption": True, "observedAt": now()}}
            publish_json(result_path, result)
            publish(out / "LIBNOVA_Receiving_Report.html", report_html(result))
            saved = delivery(out, result)
            print(json.dumps({"outcome": "PASS_RECOVERED", "receipt": str(result_path),
                              "delivery": saved}), flush=True)
            return

        p, q, c, w = imports(application)
        freeze_application(application, out)
        copy_immutable(source, out / "original-source.zip")
        app = None
        candidate = None
        with credentials():
            try:
                app, foundation, workspace, selection, operation = prepare_foundation(
                    p, q, c, w, application, source, out, args.api_port, args.s3_port)
                fixture = Fixture(out / "fixture", workspace, operation, p, q,
                                  args.api_port, args.s3_port)
                with servers(fixture):
                    complete = run_phases(out, app, c, workspace, fixture)
                    native = provider_snapshot(q, c, workspace,
                                               out / "LIBNOVA_Original_Provider_Workspace.zip")
                    scan_snapshot_credentials(native["path"], "SNAPSHOT_MANIFEST.json")
                    cold_root = out / "provider-received"
                    received = q.receive(native["path"], cold_root)
                    need(received["verification"]["id"] == operation["packageId"],
                         "Cold original package identity differs")
                    before_effects = fixture.effect_counts()
                    cold_receipt = out / "cold-provider/cold-result.json"
                    subprocess_phase(out, "cold-provider", [
                        sys.executable, "-B", str(Path(__file__).absolute()), "--cold-provider",
                        "--application", str(cold_root / "application"),
                        "--workspace", str(cold_root / "workspace"),
                        "--out", str(out / "cold-provider"), "--start-gate"], cold_receipt)
                    need(fixture.effect_counts() == before_effects,
                         "Cold readback issued a provider mutation")
                    cold_state_before = state_identity(cold_root / "workspace")
                    q.receive(native["path"], cold_root)
                    need(state_identity(cold_root / "workspace") == cold_state_before,
                         "Re-receiving the original snapshot replaced later client progress")
                    cold = read_json(cold_receipt)
                    need(cold["state"]["state"] == "VERIFIED"
                         and cold["state"]["summary"]["includedRecords"] == 169,
                         "Cold same-operation receiving is incomplete")
                    # The original managed operation remains distinct from the
                    # separate portable copy's read-only later observation.
                    need(current_state(c, workspace) == complete["state"],
                         "Cold receiving modified the original managed state")
                    full = workbench_snapshot(w, p, c, app,
                        app.control / "deliveries/LIBNOVA_Complete_Workbench.zip", selection)
                    scan_snapshot_credentials(full["path"], "MANIFEST.json")
                    workbench_received = out / "workbench-received"
                    w.receive_workspace(full["path"], workbench_received)
                    before_requests = fixture.sequence
                    before_effects = fixture.effect_counts()
                    workbench_receipt = out / "cold-workbench/cold-workbench-result.json"
                    subprocess_phase(out, "cold-workbench", [
                        sys.executable, "-B", str(Path(__file__).absolute()), "--cold-workbench",
                        "--application", str(workbench_received / "application"),
                        "--workspace", str(workbench_received / "workspace"),
                        "--request", str(out / "original-destination-request.json"),
                        "--out", str(out / "cold-workbench"), "--start-gate"], workbench_receipt)
                    need(fixture.sequence == before_requests and fixture.effect_counts() == before_effects,
                         "Offline copied Workbench reopen made a provider request")
                    # Original whole-snapshot receiving preserves the copied
                    # operator's later export/artifact history.
                    cold_whole = read_json(workbench_receipt)
                    copied_state_path = (workbench_received / "workspace.operator/operations"
                                         / OPERATION / "prepared/operations" / OPERATION / "state.json")
                    copied_state = identity(copied_state_path)
                    copied_artifacts_path = workbench_received / "workspace.operator/artifacts.json"
                    copied_artifacts = identity(copied_artifacts_path)
                    w.receive_workspace(full["path"], workbench_received)
                    need(identity(copied_state_path) == copied_state
                         and identity(copied_artifacts_path) == copied_artifacts,
                         "Whole-snapshot reopen replaced copied operation progress or export history")
                    complete = assert_complete(fixture, c, workspace)
                    need(application_identity(application) == source_identity,
                         "Original application source changed during receiving")
                    artifacts = {
                        "original-provider-workspace": native,
                        "cold-provider-workspace": cold["artifacts"][0],
                        "original-complete-workbench": full,
                        "cold-complete-workbench": cold_whole["artifacts"][0],
                    }
                    for artifact in artifacts.values():
                        need(Path(artifact["path"]).is_file(), "Completed export is missing")
                    publish_json(out / "receiving-final-control.json", fixture.control())
                    phase_values = [read_json(path) for path in sorted((out / "phases").glob("*.result.json"))]
                    retained = [out / "receiving-binding.json", out / "application-binding.json",
                                out / "original-destination-request.json", out / "prepared-source-binding.json",
                                out / "original-source.zip", cold_receipt, workbench_receipt,
                                out / "fixture/binding.json", out / "fixture/original-function-call.json",
                                out / "fixture/original-function-report.json", out / "receiving-final-control.json"]
                    retained.extend(sorted((out / "phases").glob("*.json")))
                    candidate = {
                        "schema": SCHEMA, "outcome": "READY_FOR_RUNTIME_DRAIN", "operationId": OPERATION,
                        "bindingSha256": sha(canonical(binding)),
                        "scope": {"kind": "LOCAL_CONTRACT_RECEIVING", "tenantAccepted": False,
                                  "deployedFunctionExecuted": False, "realHttp": True,
                                  "s3Transport": "boto3/botocore SigV4",
                                  "credentials": "Synthetic local fixture values only"},
                        "source": source_id, "runtime": binding["runtime"],
                        "sdkCommit": c.SDK_COMMIT, "bagitFunctionCommit": c.BAGIT_FUNCTION_COMMIT,
                        "selection": selection, "packageId": operation["packageId"],
                        "summary": complete["state"]["summary"],
                        "job": complete["state"]["job"], "effects": complete["effects"],
                        "phases": phase_values, "artifacts": artifacts,
                        "originalWorkspace": str(foundation),
                        "originalControl": str(app.control),
                        "originalPrepared": str(workspace),
                        "coldProviderWorkspace": str(cold_root / "workspace"),
                        "coldWorkbenchWorkspace": str(workbench_received / "workspace"),
                        "ports": binding["ports"], "producerProcess": process_identity(),
                        "retainedChecks": [{"path": str(path), **identity(path)} for path in retained],
                        "startedAt": binding["startedAt"], "completedAt": now(),
                    }
                    # Every child has returned and every artifact is complete.
                    # The servers and original Workbench drain in the contexts
                    # below before a final PASS is published.
                    publish_json(candidate_path, candidate)
            finally:
                if app is not None:
                    app.close()
        need(candidate is not None, "No complete original receiving result was produced")
        final_checks(candidate)
        result = {**candidate, "outcome": "PASS",
                  "drain": {"servers": "Both serve loops and non-daemon request threads joined",
                            "coldChildren": "Both original children exited and their outputs were fsynced",
                            "workbench": "Original and copied Workbench control locks released",
                            "recoveredAfterInterruption": False, "observedAt": now()}}
        publish_json(result_path, result)
        publish(out / "LIBNOVA_Receiving_Report.html", report_html(result))
        saved = delivery(out, result)
        print(json.dumps({"outcome": "PASS", "receipt": str(result_path), "delivery": saved,
                          "records": 169, "functionPosts": 1,
                          "serversDrained": True}), flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source")
    parser.add_argument("--out", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--request")
    parser.add_argument("--api-port", type=int, default=18083)
    parser.add_argument("--s3-port", type=int, default=18084)
    parser.add_argument("--cold-provider", action="store_true")
    parser.add_argument("--cold-workbench", action="store_true")
    parser.add_argument("--start-gate", action="store_true")
    args = parser.parse_args(argv)
    os.umask(0o077)
    if args.start_gate:
        need(sys.stdin.buffer.readline(16) == b"START\n",
             "The original parent did not publish this child selection")
    need(not (args.cold_provider and args.cold_workbench), "Choose one original child mode")
    if args.cold_provider:
        need(args.workspace, "Cold provider workspace is required")
        cold_provider(args)
    elif args.cold_workbench:
        need(args.workspace and args.request, "Cold Workbench original input is required")
        cold_workbench(args)
    else:
        need(args.source, "The exact original source ZIP is required")
        main_journey(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
