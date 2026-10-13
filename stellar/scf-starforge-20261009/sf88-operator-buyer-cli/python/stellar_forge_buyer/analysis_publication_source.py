"""Bind prepared Analysis packages to the original Frictionless operator.

Only the existing Runtime/merchant client performs native operations. Original
source requests and publisher runs remain the authority for asynchronous state,
review, extraction, target publication and recovery.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from urllib.parse import urlsplit, urlunsplit
import uuid

from .errors import BuyerError, StateError
from .runtime import Runtime
from .storage import digest, dump, parse, private_directory, read, write
from .analysis_publication import (
    SCHEMA, _fields, _id, _json, _need, _now, _page, _publish_bytes,
    _sha, _verified_file,
)

CONNECTION_SCHEMA = "stellar-forge.analysis-publication-connections.v1"
BRIDGE_SCHEMA = "stellar-forge.analysis-publication-bridge.v1"
BRIDGE_MODE = "ANALYSIS_PUBLICATION_BRIDGE"
RESULT_SCHEMA = "stellar-forge.analysis-publication-native-result.v1"
SOURCE_INDEX_SCHEMA = "stellar-forge.analysis-publication-source-files.v1"
_ALIAS = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
_UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
_QUERY = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}")
_LIMIT = 8 * 1024 * 1024
_READ = {
    "status": (set(), {"limit", "capturesOffset", "editionsOffset", "operationsOffset"}),
    "input": (set(), set()), "current": (set(), set()),
    "request": ({"requestId"}, set()),
    "capture": ({"captureId"}, {"section", "resource", "offset", "limit"}),
    "edition": ({"editionId"}, set()), "review": ({"reviewId"}, set()),
    "plan-input": ({"editionId", "query"}, set()),
    "publisher-status": (set(), {"limit", "plansOffset", "runsOffset", "historyOffset"}),
    "publisher-target": (set(), set()),
    "publisher-inspect": ({"planRequestId", "runId"}, {"query"}),
    "inspect-export": ({"requestId"}, set()),
}
_ACTION = {
    "open": (set(), set()),
    "intake": ({"expectedVersion", "label"}, set()),
    "edition": ({"expectedVersion", "captureId", "label"}, set()),
    "review-edition": ({"expectedVersion", "editionId", "reviewer", "note"}, set()),
    "select": ({"expectedVersion", "editionId", "reviewId", "expectedSourceHash"}, set()),
    "plan": ({"expectedVersion", "editionId", "reviewId", "plan"}, set()),
    "export": ({"expectedVersion", "editionId", "label"}, {"reviewId"}),
    "cancel": ({"operationId"}, set()), "resume": ({"requestId"}, set()),
    "publisher-extract": ({"planRequestId"}, set()),
    "publisher-review": ({"planRequestId", "runId", "candidateDigest", "reviewer", "note"},
                         {"initialize", "expectedSnapshot", "expectedRevision"}),
    "publisher-publish": ({"planRequestId", "runId", "reviewId"}, set()),
    "publisher-recover": ({"planRequestId", "runId"}, set()),
    "publisher-cancel": ({"planRequestId", "runId"}, set()),
    "download-export": ({"requestId", "expected_source_hash"}, set()),
}
_NO_PACKAGE = {"open", "status", "input", "current", "publisher-status", "publisher-target"}
_ONCE = {"publisher-review", "publisher-publish"}


def _plain(value, maximum):
    _need(isinstance(value, str) and value.strip() and len(value) <= maximum
          and not any(ord(c) < 32 or ord(c) == 127 for c in value), "TEXT_INVALID")
    return value


def _private_json(path, maximum):
    p = Path(path)
    _need(p.is_absolute(), "PRIVATE_PATH_REQUIRED")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(p, flags)
    try:
        s = os.fstat(fd)
        _need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and not s.st_mode & 0o077
              and (not hasattr(os, "getuid") or s.st_uid == os.getuid())
              and s.st_size <= maximum, "PRIVATE_FILE_REQUIRED")
        with os.fdopen(fd, "rb", closefd=False) as f:
            raw = f.read(maximum + 1)
        final = os.fstat(fd)
        _need(len(raw) == s.st_size and
              (final.st_size, final.st_mtime_ns, final.st_ctime_ns) ==
              (s.st_size, s.st_mtime_ns, s.st_ctime_ns), "FILE_CHANGED")
        return parse(raw)
    finally:
        os.close(fd)


def _endpoint(value):
    # Match the original client's URL.href without silently resolving path
    # traversal, encoded dot segments, alternative IPv4 spellings or userinfo.
    endpoint = _plain(value, 4096)
    _need(all(33 <= ord(c) <= 126 for c in endpoint) and "\\" not in endpoint,
          "CONNECTION_URL_INVALID")
    try:
        parts = urlsplit(endpoint)
        host, port = parts.hostname, parts.port
        _need(parts.scheme in {"https", "http"} and host
              and not parts.username and not parts.password and not parts.query
              and not parts.fragment, "CONNECTION_URL_INVALID")
        if ":" in host:
            host = str(ipaddress.IPv6Address(host))
            authority = "[" + host + "]"
        else:
            _need(re.fullmatch(r"[A-Za-z0-9._-]+", host), "CONNECTION_URL_INVALID")
            if re.fullmatch(r"[0-9.]+", host):
                host = str(ipaddress.IPv4Address(host))
            else:
                _need(not re.fullmatch(r"(?:0[xX][0-9A-Fa-f]+|[0-9]+)", host.rstrip(".").rsplit(".", 1)[-1]),
                      "CONNECTION_URL_INVALID")
            _need(not re.fullmatch(r"(?:0[xX][0-9A-Fa-f]+|[0-9]+)", host),
                  "CONNECTION_URL_INVALID")
            host = host.lower()
            authority = host
        _need(parts.scheme == "https" or host in {"127.0.0.1", "::1"},
              "CONNECTION_URL_INVALID")
        if port is not None and port != (443 if parts.scheme == "https" else 80):
            authority += ":" + str(port)
        path = parts.path or "/"
        _need(re.fullmatch(r"[-A-Za-z0-9._~!$&'()*+,;=:@/%]*", path)
              and not re.search(r"%(?![0-9A-Fa-f]{2})", path)
              and all(re.sub(r"%2e", ".", segment, flags=re.I) not in {".", ".."}
                      for segment in path.split("/")), "CONNECTION_URL_INVALID")
        return urlunsplit((parts.scheme, authority, path, "", ""))
    except (ValueError, TypeError):
        raise StateError("ANALYSIS_PUBLICATION_CONNECTION_URL_INVALID") from None


def read_connections(value):
    if value is None:
        return {}
    if isinstance(value, (str, os.PathLike)):
        value = _private_json(value, 1024 * 1024)
    _fields(value, {"schema", "connections"})
    _need(value["schema"] == CONNECTION_SCHEMA and isinstance(value["connections"], dict)
          and len(value["connections"]) <= 32, "CONNECTIONS_INVALID")
    result = {}
    for name, raw in value["connections"].items():
        _need(isinstance(name, str) and _ALIAS.fullmatch(name), "CONNECTION_ALIAS_INVALID")
        _fields(raw, {"url", "token_file", "workspace", "workspace_id", "publisher", "input"},
                {"label", "timeout_ms"})
        for key in ("workspace", "publisher", "input"):
            _need(isinstance(raw[key], str) and _ALIAS.fullmatch(raw[key]), "CONNECTION_ALIAS_INVALID")
        _need(isinstance(raw["workspace_id"], str) and _UUID.fullmatch(raw["workspace_id"]),
              "NATIVE_WORKSPACE_REQUIRED")
        endpoint = _endpoint(raw["url"])
        token = raw["token_file"]
        _need(isinstance(token, str) and Path(token).is_absolute(), "PRIVATE_TOKEN_REQUIRED")
        timeout = raw.get("timeout_ms", 120000)
        _need(type(timeout) is int and 1000 <= timeout <= 300000, "TIMEOUT_INVALID")
        result[name] = {**deepcopy(raw), "name": name, "url": endpoint,
                        "label": _plain(raw.get("label", name), 160), "timeout_ms": timeout}
    return result


def _target(connection):
    return {key: connection[key] for key in
            ("name", "url", "workspace", "workspace_id", "publisher", "input")}


def _arguments(action, value, *, reading=False):
    definitions = _READ if reading else _ACTION
    _need(action in definitions, "SOURCE_ACTION_INVALID")
    required, optional = definitions[action]
    _fields(value, required, optional)
    result = deepcopy(value)
    _need(len(_json(result)) <= 1024 * 1024, "REQUEST_TOO_LARGE")
    for key, item in result.items():
        if key in {"requestId", "captureId", "editionId", "reviewId", "operationId",
                   "planRequestId", "runId"}:
            _need(isinstance(item, str) and _UUID.fullmatch(item), "NATIVE_ID_INVALID")
        if key in {"expectedSourceHash", "candidateDigest", "expected_source_hash"}:
            _sha(item)
        if key in {"expectedVersion", "expectedRevision", "offset", "limit",
                   "capturesOffset", "editionsOffset", "operationsOffset",
                   "plansOffset", "runsOffset", "historyOffset"}:
            _need(type(item) is int and 0 <= item <= 9007199254740991, "NATIVE_REVISION_INVALID")
        if key == "limit":
            _need(1 <= item <= 100, "PAGE_INVALID")
        if key == "label":
            _plain(item, 160)
        if key == "reviewer":
            _plain(item, 80 if action == "review-edition" else 128)
        if key == "note":
            _plain(item, 2000)
        if key == "initialize":
            _need(type(item) is bool, "TARGET_DECISION_INVALID")
        if key == "section":
            _need(item in {"overview", "resource", "files", "queries"}, "SECTION_INVALID")
        if key == "plan":
            _need(isinstance(item, dict), "PLAN_INVALID")
    return result


def _native_id(workspace_id, job_id):
    raw = bytearray(hashlib.sha256(("analysis-dataset-source-v1/" + workspace_id + "/" + job_id).encode()).digest()[:16])
    raw[6] = (raw[6] & 15) | 64
    raw[8] = (raw[8] & 63) | 128
    return str(uuid.UUID(bytes=bytes(raw)))


def _relative(value):
    _need(isinstance(value, str) and len(value) <= 512 and "\\" not in value
          and not value.startswith("/") and "\x00" not in value, "SOURCE_FILE_INVALID")
    parts = value.split("/")
    _need(all(p and p not in {".", ".."} and not any(ord(c) < 32 for c in p)
              for p in parts), "SOURCE_FILE_INVALID")
    return PurePosixPath(value)


class PublicationSource:
    def __init__(self, publications, *, connections=None):
        self.owner = publications
        self.workspace = publications.workspace
        self.database = publications.database
        self.connections = read_connections(connections)
        self.outputs = private_directory(publications.directory / "native-exports")
        with self.database._connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_publication_source_actions("
                       "id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,native_request_id TEXT NOT NULL,"
                       "accepted TEXT,accepted_sha256 TEXT)")
        self.recover_completed()

    def configuration(self):
        return {"schema": SCHEMA, "workspace_id": self.workspace.identity,
                "bridge_available": bool(self.workspace.checkout),
                "connections": [{**_target(v), "label": v["label"]}
                                for v in self.connections.values()],
                "source_actions": list(_ACTION), "source_reads": list(_READ)}

    def _connection(self, name, expected=None):
        _need(isinstance(name, str) and name in self.connections, "CONNECTION_NOT_CONFIGURED")
        result = self.connections[name]
        if expected is not None:
            _need(_target(result) == expected, "REVIEWED_CONNECTION_CHANGED")
        return result

    def _package(self, job_id, expected):
        index = self.owner.downloads(_id(job_id))
        _need(index["index_sha256"] == _sha(expected), "PACKAGE_CHANGED")
        job = self.workspace._job(job_id)
        with self.database._connection(readonly=True) as db:
            recipe = self.owner.validate(db, job["request"])
        manifest = self.owner._manifest(job_id, recipe)
        fields = manifest["recipe"]["fields"]
        stats = manifest.get("field_stats")
        _need(isinstance(stats, list) and len(stats) == len(fields)
              and [v.get("name") for v in stats] == [v["name"] for v in fields],
              "PACKAGE_FIELD_STATISTICS_REQUIRED")
        projection, conflicts = {}, ([] if len(fields) <= 64 else ["NATIVE_PROJECTION_LIMIT_64_FIELDS"])
        for field, item in zip(fields, stats):
            for key in ("null_count", "empty_string_count"):
                _need(type(item.get(key)) is int and 0 <= item[key] <= index["source"]["row_count"],
                      "PACKAGE_FIELD_STATISTICS_CHANGED")
            _need(item["null_count"] + item["empty_string_count"] <= index["source"]["row_count"],
                  "PACKAGE_FIELD_STATISTICS_CHANGED")
            representation = field["representation"]
            kind = {"integer": "integer", "number": "number", "boolean01": "boolean"}.get(representation, "string")
            if kind == "string" and item["null_count"] and item["empty_string_count"]:
                conflicts.append(field["name"])
            missing = "literal" if kind == "string" and not item["null_count"] else "null"
            projection[field["name"]] = {"field": field["name"], "type": kind,
                                         "missing": missing, "representation": "logical"}
        name = manifest["recipe"]["resource_name"]
        query = "PublishedData"
        queries_text = json.dumps({query: {"resource": name, "projection": projection}},
                                  ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        directory = self.owner._directory(job_id)
        selected = {}
        for name in ("datapackage.json", "data.json"):
            item = next(v for v in index["files"] if v["name"] == name)
            selected[name] = {"path": str(directory / item["relative"]),
                              "bytes": item["bytes"], "sha256": item["sha256"]}
        package = {"job_id": job_id, "index_sha256": expected,
                   "descriptor": selected["datapackage.json"], "resource": selected["data.json"],
                   "resource_name": manifest["recipe"]["resource_name"], "queries_text": queries_text}
        return package, index, manifest, conflicts

    def package_view(self, job_id):
        with self.owner._operation():
            index = self.owner.downloads(job_id)
            package, _, manifest, conflicts = self._package(job_id, index["index_sha256"])
            return {"index": index, "recipe": manifest["recipe"],
                    "field_stats": manifest["field_stats"], "queries_text": package["queries_text"],
                    "native_projection_conflicts": conflicts,
                    "declared_input": {"kind": "descriptor", "path": package["descriptor"]["path"],
                                       "label": manifest["recipe"]["title"]}}

    def prepare(self, request):
        _fields(request, {"id", "connection", "action", "args"},
                {"package_id", "index_sha256", "reviewed_endpoint", "expected_workspace_id"})
        job_id = _id(request["id"])
        _need(request["action"] in _ACTION, "SOURCE_ACTION_INVALID")
        original = deepcopy(request)
        with self.owner._operation():
            with self.database._connection(readonly=True) as db:
                old = db.execute("SELECT kind,request FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
                if old is not None:
                    spec = parse(old["request"].encode())
                    _need(old["kind"] == "dataset-source"
                          and _json(spec["original_request"]) == _json(original), "REQUEST_ID_REUSED")
                    return {k: v for k, v in spec.items() if k != "id"}
            connection = self._connection(request["connection"])
            _need(request.get("reviewed_endpoint") == connection["url"]
                  and request.get("expected_workspace_id") == connection["workspace_id"],
                  "REVIEWED_CONNECTION_REQUIRED")
            args = _arguments(request["action"], request["args"])
            package = None
            if request["action"] not in _NO_PACKAGE or request.get("package_id") is not None:
                package, _, _, conflicts = self._package(request.get("package_id"), request.get("index_sha256"))
                if request["action"] in {"edition", "review-edition", "select", "plan",
                                         "publisher-extract", "publisher-review", "publisher-publish"}:
                    _need(not conflicts, "NATIVE_NULL_EMPTY_REPRESENTATION_REQUIRED")
            return {"original_request": original, "target": _target(connection),
                    "native_request_id": _native_id(self.workspace.identity, job_id),
                    "package_id": package["job_id"] if package else None,
                    "index_sha256": package["index_sha256"] if package else None,
                    "action": request["action"], "args": args}

    def validate(self, db, spec):
        _id(spec["id"])
        _need(spec["native_request_id"] == _native_id(self.workspace.identity, spec["id"]),
              "NATIVE_ID_CHANGED")
        _arguments(spec["action"], spec["args"])
        checksum = digest(_json(spec))
        old = db.execute("SELECT * FROM sf_analysis_publication_source_actions WHERE id=?",
                         (spec["id"],)).fetchone()
        if old:
            _need(old["request_sha256"] == checksum
                  and old["native_request_id"] == spec["native_request_id"], "REQUEST_ID_REUSED")
        else:
            db.execute("INSERT INTO sf_analysis_publication_source_actions"
                       "(id,request_sha256,native_request_id) VALUES(?,?,?)",
                       (spec["id"], checksum, spec["native_request_id"]))
        return old

    def resume(self, db, spec):
        self.validate(db, spec)
        self.owner._observe(db, spec["id"], "CONTINUE_REQUESTED",
                            {"native_request_id": spec["native_request_id"], "action": spec["action"]})

    def _accepted(self, row, spec):
        if row is None or row["accepted"] is None:
            return None
        raw = row["accepted"].encode()
        _need(digest(raw) == row["accepted_sha256"], "NATIVE_RESULT_CHANGED")
        result = parse(raw)
        _need(result["job_id"] == spec["id"] and result["workspace_id"] == self.workspace.identity
              and result["native_request_id"] == spec["native_request_id"]
              and result["action"] == spec["action"] and result["target"] == spec["target"]
              and result.get("package_id") == spec.get("package_id")
              and result.get("index_sha256") == spec.get("index_sha256"),
              "NATIVE_RESULT_CHANGED")
        self._validate_reply(result["native"], spec)
        return result

    def _validate_reply(self, value, spec):
        _need(isinstance(value, dict) and value.get("mode") == BRIDGE_MODE
              and value.get("ok") is True and value.get("id") == spec["id"]
              and value.get("workspace_id") == self.workspace.identity
              and value.get("package_id") == spec.get("package_id")
              and value.get("index_sha256") == spec.get("index_sha256")
              and value.get("action") == spec["action"]
              and value.get("native_request_id") == spec["native_request_id"]
              and isinstance(value.get("result"), dict), "NATIVE_RECEIPT_INVALID")
        target = spec["target"]
        observed = value.get("connection")
        _need(isinstance(observed, dict)
              and observed.get("name") == target["name"]
              and observed.get("endpoint") == target["url"]
              and observed.get("workspace") == target["workspace"]
              and observed.get("workspace_id") == target["workspace_id"]
              and observed.get("publisher") == target["publisher"], "NATIVE_RECEIPT_INVALID")

    def _attempt(self, job_id):
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT kind,record FROM sf_analysis_publication_observations WHERE job_id=? "
                              "ORDER BY sequence", (job_id,)).fetchall()
        attempts = 0
        uncertain = set()
        current = 0
        for row in rows:
            record = parse(row["record"].encode())
            if row["kind"] == "NATIVE_INTENT":
                attempts += 1
                current = record.get("attempt", attempts)
            elif row["kind"] == "NATIVE_PROCESS":
                uncertain.add(record.get("attempt", current))
            elif row["kind"] == "NATIVE_OUTCOME" and record.get("outcome") in {"NOT_STARTED", "NOT_DISPATCHED"}:
                uncertain.discard(record.get("attempt", current))
        return attempts + 1, bool(uncertain)

    def _invoke(self, spec, event, *, attempt=1, allow_dispatch=False, observe=False):
        self.owner._stop(event)
        selected = self._connection(spec["target"]["name"], spec["target"])
        _need(self.workspace.checkout is not None, "ORIGINAL_RUNTIME_REQUIRED")
        package = None
        if spec.get("package_id"):
            package, _, _, conflicts = self._package(spec["package_id"], spec["index_sha256"])
            if spec["action"] in {"edition", "review-edition", "select", "plan",
                                  "publisher-extract", "publisher-review", "publisher-publish"}:
                _need(not conflicts, "NATIVE_NULL_EMPTY_REPRESENTATION_REQUIRED")
        stage_root = private_directory(self.database.directory / "analysis-publications-private")
        stage = Path(tempfile.mkdtemp(prefix=spec["id"] + "-", dir=stage_root))
        stage.chmod(0o700)
        started, runtime_record, output = False, None, None
        try:
            args = deepcopy(spec["args"])
            if spec["action"] == "download-export":
                args["directory"] = str(private_directory(self.outputs / spec["id"] / "files"))
            request = {"schema": BRIDGE_SCHEMA, "id": spec["id"],
                       "workspace_id": self.workspace.identity, "action": spec["action"],
                       "connection": {key: selected[key] for key in
                                      ("name", "url", "token_file", "workspace", "workspace_id",
                                       "publisher", "input", "timeout_ms")},
                       "reviewed_endpoint": spec["target"]["url"], "package": package,
                       "native_request_id": spec["native_request_id"], "args": args,
                       "allow_dispatch": allow_dispatch}
            dump(stage / "request.json", request, exclusive=True)
            runtime = Runtime(self.workspace.checkout, node=self.workspace.node,
                              timeout=selected["timeout_ms"] / 1000 + 20, output_limit=_LIMIT)
            def on_started(_pid):
                nonlocal started
                started = True
                if observe:
                    with self.database._connection() as db:
                        self.owner._observe(db, spec["id"], "NATIVE_PROCESS",
                                            {"attempt": attempt, "processStarted": True})
            run = runtime.run(["--request", str(stage / "request.json")], target="analysis-publication",
                              logs=private_directory(stage / "logs"),
                              started=on_started, cancel_event=event)
            runtime_record = {"processStarted": started, "returncode": run.returncode,
                              "error": run.error, "interrupted": run.interrupted}
            output = run.output
            if run.returncode == 0 and isinstance(output, dict) and output.get("ok") is True:
                self._validate_reply(output, spec)
                return {"outcome": "ACCEPTED", "native": output, "runtime": runtime_record}, stage
            code = output.get("error") if isinstance(output, dict) and output.get("mode") == BRIDGE_MODE else run.error
            outcome = "OUTCOME_UNKNOWN" if started else "NOT_STARTED"
            if (isinstance(output, dict) and output.get("mode") == BRIDGE_MODE
                    and (output.get("dispatchStarted") is False or output.get("applied") is False)):
                outcome = "NOT_DISPATCHED"
            return {"outcome": outcome, "error": code or "NATIVE_COMMAND_FAILED",
                    "native": output if isinstance(output, dict) and output.get("mode") == BRIDGE_MODE else None,
                    "runtime": runtime_record}, stage
        except BaseException as error:
            code = error.code if isinstance(error, BuyerError) else type(error).__name__
            return {"outcome": "OUTCOME_UNKNOWN" if started else "NOT_STARTED",
                    "error": code, "native": output,
                    "runtime": runtime_record or {"processStarted": started, "returncode": None,
                                                  "error": code, "interrupted": event.is_set()}}, stage

    def run(self, job_id, spec):
        with self.owner._operation(job_id) as event:
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                old = self.validate(db, spec)
                saved = self._accepted(old, spec)
                db.commit()
            if saved is not None:
                return saved
            attempt, uncertain = self._attempt(job_id)
            allow_dispatch = spec["action"] not in _ONCE or not uncertain
            with self.database._connection() as db:
                self.owner._observe(db, job_id, "NATIVE_INTENT",
                                    {"attempt": attempt, "action": spec["action"],
                                     "native_request_id": spec["native_request_id"],
                                     "allow_dispatch": allow_dispatch})
            stage, published = None, False
            try:
                outcome, stage = self._invoke(spec, event, attempt=attempt,
                                               allow_dispatch=allow_dispatch, observe=True)
                outcome["attempt"] = attempt
                accepted = None
                if outcome["outcome"] == "ACCEPTED":
                    accepted = {"schema": RESULT_SCHEMA, "workspace_id": self.workspace.identity,
                                "job_id": job_id, "package_id": spec.get("package_id"),
                                "index_sha256": spec.get("index_sha256"),
                                "native_request_id": spec["native_request_id"],
                                "action": spec["action"], "target": spec["target"],
                                "accepted_at": _now(), "attempt": attempt,
                                "native": outcome["native"], "runtime": outcome["runtime"]}
                    if spec["action"] == "download-export":
                        accepted["source_files"] = self._source_index(job_id, spec, outcome["native"])
                    raw = _json(accepted)
                    with self.database._connection() as db:
                        db.execute("BEGIN IMMEDIATE")
                        old = self.validate(db, spec)
                        prior = self._accepted(old, spec)
                        if prior is not None:
                            accepted = prior
                        else:
                            db.execute("UPDATE sf_analysis_publication_source_actions SET accepted=?,accepted_sha256=? WHERE id=?",
                                       (raw.decode(), digest(raw), job_id))
                        self.owner._observe(db, job_id, "NATIVE_OUTCOME", outcome)
                        db.commit()
                else:
                    with self.database._connection() as db:
                        self.owner._observe(db, job_id, "NATIVE_OUTCOME", outcome)
                published = True
                if accepted is not None:
                    return accepted
                if event.is_set():
                    raise StateError("ANALYSIS_PUBLICATION_CANCELLED")
                raise StateError("ANALYSIS_PUBLICATION_NATIVE_OUTCOME_REQUIRES_REVIEW")
            finally:
                if stage is not None and published:
                    shutil.rmtree(stage, ignore_errors=True)

    def read(self, request):
        _fields(request, {"connection", "action", "args"},
                {"package_id", "index_sha256", "reviewed_endpoint", "expected_workspace_id"})
        action = request["action"]
        args = _arguments(action, request["args"], reading=True)
        with self.owner._operation() as event:
            connection = self._connection(request["connection"])
            if request.get("reviewed_endpoint") is not None:
                _need(request["reviewed_endpoint"] == connection["url"], "REVIEWED_CONNECTION_CHANGED")
            if request.get("expected_workspace_id") is not None:
                _need(request["expected_workspace_id"] == connection["workspace_id"], "NATIVE_WORKSPACE_CHANGED")
            if action not in _NO_PACKAGE:
                _id(request.get("package_id")); _sha(request.get("index_sha256"))
            job_id = uuid.uuid4().hex
            spec = {"id": job_id, "target": _target(connection), "action": action, "args": args,
                    "package_id": request.get("package_id"), "index_sha256": request.get("index_sha256"),
                    "native_request_id": _native_id(self.workspace.identity, job_id)}
            outcome, stage = self._invoke(spec, event)
            try:
                _need(outcome["outcome"] == "ACCEPTED", "SOURCE_READ_FAILED")
                return outcome["native"]
            finally:
                shutil.rmtree(stage, ignore_errors=True)

    def recover_completed(self):
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute("SELECT a.*,j.kind,j.request,j.status FROM sf_analysis_publication_source_actions a "
                                  "JOIN sf_analysis_jobs j ON a.id=j.id WHERE a.accepted IS NOT NULL").fetchall():
                _need(row["kind"] == "dataset-source", "NATIVE_RESULT_CHANGED")
                spec = parse(row["request"].encode())
                result = self._accepted(row, spec)
                if row["status"] != "COMPLETE":
                    db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',finished_at=?,result=?,error=NULL WHERE id=?",
                               (result["accepted_at"], _json(result).decode(), row["id"]))
            db.commit()

    def history(self, *, before=None, limit=25):
        _page(before, limit)
        with self.owner._operation():
            with self.database._connection(readonly=True) as db:
                rows = db.execute("SELECT sequence,id,status,created_at,finished_at,request,result,error "
                                  "FROM sf_analysis_jobs WHERE kind='dataset-source' AND (? IS NULL OR sequence<?) "
                                  "ORDER BY sequence DESC LIMIT ?", (before, before, limit + 1)).fetchall()
            items = []
            for row in rows[:limit]:
                value = dict(row)
                for name in ("request", "result"):
                    value[name] = parse(value[name].encode()) if value[name] else None
                value["progress"] = self.owner.progress(value["id"])
                items.append(value)
            return {"items": items, "next_before": items[-1]["sequence"] if len(rows) > limit else None}

    def _source_index(self, job_id, spec, native):
        result = native["result"]
        _need(result.get("state") == "COMPLETE" and result.get("exportId") == spec["args"]["requestId"]
              and result.get("sourceHash") == spec["args"]["expected_source_hash"]
              and result.get("workspaceId") == spec["target"]["workspace_id"],
              "SOURCE_EXPORT_CHANGED")
        _sha(result.get("manifestSha256")); _sha(result.get("nativeManifestSha256"))
        files = (native.get("binding") or {}).get("files")
        _need(isinstance(files, list) and 1 <= len(files) <= 10000, "SOURCE_EXPORT_FILES_REQUIRED")
        root = self.outputs / job_id / "files"
        _need(Path(result.get("directory", "")).resolve() == root.resolve(), "SOURCE_EXPORT_DIRECTORY_CHANGED")
        entries, total, names = [], 0, set()
        for item in files:
            _fields(item, {"name", "bytes", "sha256"}, {"mime"})
            relative = _relative(item["name"])
            _need(item["name"] not in names and type(item["bytes"]) is int and item["bytes"] >= 0, "SOURCE_FILE_INVALID")
            names.add(item["name"]); _sha(item["sha256"])
            total += item["bytes"]
            _need(total <= 512 * 1024 * 1024, "SOURCE_EXPORT_TOO_LARGE")
            with _verified_file(root / relative, item):
                pass
            entries.append({"name": item["name"], "bytes": item["bytes"], "sha256": item["sha256"],
                            "relative": "files/" + relative.as_posix(),
                            "mime": ("application/gzip" if item["name"].endswith(".gz") else
                                    "application/json" if item["name"].endswith(".json") else "text/markdown;charset=utf-8")})
        _need("manifest.json" in names and "source.tar.gz" in names, "SOURCE_EXPORT_FILES_REQUIRED")
        _need(next(v["sha256"] for v in entries if v["name"] == "manifest.json")
              == result["nativeManifestSha256"], "SOURCE_EXPORT_CHANGED")
        index = {"schema": SOURCE_INDEX_SCHEMA, "workspace_id": self.workspace.identity,
                 "job_id": job_id, "package_id": spec["package_id"], "package_index_sha256": spec["index_sha256"],
                 "native_workspace_id": spec["target"]["workspace_id"], "export_id": result["exportId"],
                 "source_hash": result["sourceHash"], "manifest_sha256": result["manifestSha256"],
                 "native_manifest_sha256": result["nativeManifestSha256"],
                 "files": sorted(entries, key=lambda x: x["name"])}
        raw = _json(index)
        _publish_bytes(self.outputs / job_id / "files-index.json", raw)
        return {**index, "index_sha256": digest(raw)}

    def downloads(self, job_id):
        with self.owner._operation():
            job = self.workspace._job(_id(job_id))
            _need(job["kind"] == "dataset-source" and job["status"] == "COMPLETE"
                  and job["request"]["action"] == "download-export", "COMPLETE_SOURCE_EXPORT_REQUIRED")
            expected = job["result"]["source_files"]
            raw = read(self.outputs / job_id / "files-index.json", _LIMIT)
            index = parse(raw)
            _need(digest(raw) == expected["index_sha256"]
                  and index == {k: v for k, v in expected.items() if k != "index_sha256"}, "SOURCE_EXPORT_CHANGED")
            for item in index["files"]:
                _relative(item["name"]); _relative(item["relative"])
                _need(item["relative"] == "files/" + item["name"], "SOURCE_FILE_INVALID")
                with _verified_file(self.outputs / job_id / item["relative"], item):
                    pass
            return expected

    @contextmanager
    def download(self, job_id, name, *, expected_sha256=None):
        with self.owner._operation() as event:
            index = self.downloads(job_id)
            if name == "files-index.json":
                raw = read(self.outputs / job_id / name, _LIMIT)
                _need(digest(raw) == index["index_sha256"], "SOURCE_EXPORT_CHANGED")
                selected = {"name": name, "relative": name, "bytes": len(raw),
                            "sha256": index["index_sha256"], "mime": "application/json",
                            "visibility": "private"}
            else:
                selected = next((v for v in index["files"] if v["name"] == name), None)
            _need(selected is not None, "SOURCE_FILE_NOT_FOUND")
            if expected_sha256 is not None:
                _need(selected["sha256"] == _sha(expected_sha256), "SOURCE_FILE_CHANGED")
            with _verified_file(self.outputs / job_id / selected["relative"], selected, event.is_set) as stream:
                yield stream, selected
