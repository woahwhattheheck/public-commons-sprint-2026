"""Bind an original business request to native Datasette and Analysis delivery.

The existing source CLI, customer operator, query/report engines and archive
receiver own all data operations. This adapter retains their original inputs,
identities and complete outputs in the caller's private request workspace.
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from urllib.request import Request
import uuid

HERE = Path(__file__).resolve().parent
PYTHON = HERE.parents[1] / "sf88-operator-buyer-cli" / "python"
if str(PYTHON) not in sys.path:
    sys.path.insert(0, str(PYTHON))

from stellar_forge_buyer.storage import private_directory, sync_directory
from stellar_forge_buyer.workspace_archive_receive import restore_archive

SCHEMA = "stellar-forge.native-source-workflow.v1"
CONFIGURATION = "stellar-forge.source-workflow-configuration.v1"
REQUEST = "stellar-forge.source-workflow-request.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}")
_TOKEN = re.compile(r"\{\{(?:(collection|column|source):)?([A-Za-z][A-Za-z0-9_]*)(?::([A-Za-z][A-Za-z0-9_]*))?\}\}")
_MAX_JSON = 64 * 1024 * 1024


def _sibling(name):
    key = "_starforge_workflow_" + name
    if key not in sys.modules:
        spec = importlib.util.spec_from_file_location(key, HERE / (name + ".py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[key] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(key, None)
            raise
    return sys.modules[key]


_client = _sibling("operator_client")
_source = _sibling("source")
DatasetteOperatorClient = _client.DatasetteOperatorClient
DatasetteClientError = _client.DatasetteClientError


class WorkflowAnalysisError(RuntimeError):
    def __init__(self, code, detail=None):
        self.code, self.detail = code, detail
        super().__init__(code)


def _require(condition, code, detail=None):
    if not condition:
        raise WorkflowAnalysisError(code, detail)


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _identity(run_id, phase):
    return _sha((run_id + "\0" + phase).encode())[:32]


def _absolute(value):
    _require(isinstance(value, (str, os.PathLike)), "WORKFLOW_ABSOLUTE_PATH_REQUIRED")
    path = Path(value).expanduser()
    _require(path.is_absolute() and "\0" not in str(path), "WORKFLOW_ABSOLUTE_PATH_REQUIRED")
    return path.resolve()


def _record(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        _require(stat.S_ISREG(info.st_mode) and info.st_size <= _MAX_JSON,
                 "WORKFLOW_NATIVE_RECORD_INVALID")
        raw = stream.read(_MAX_JSON + 1)
    _require(len(raw) <= _MAX_JSON, "WORKFLOW_NATIVE_RECORD_TOO_LARGE")
    return json.loads(raw)


def _write(path, value, *, immutable=False):
    raw = _json(value) + b"\n"
    if immutable and path.exists():
        _require(_json(_record(path)) == _json(value), "WORKFLOW_ORIGINAL_INPUT_CHANGED")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".workflow-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                _require(_json(_record(path)) == _json(value), "WORKFLOW_ORIGINAL_INPUT_CHANGED")
        else:
            _require(not path.is_symlink(), "WORKFLOW_RECORD_SYMLINK")
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _file(path, *, name=None, content_type="application/octet-stream", expected=None):
    _require(not Path(path).is_symlink(), "WORKFLOW_REGULAR_OUTPUT_REQUIRED")
    path = _absolute(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        _require(stat.S_ISREG(before.st_mode), "WORKFLOW_REGULAR_OUTPUT_REQUIRED")
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
    _require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "WORKFLOW_OUTPUT_CHANGED_DURING_READ")
    result = {"name": name or path.name, "path": str(path), "bytes": before.st_size,
              "sha256": checksum, "contentType": content_type}
    if expected:
        _require(all(result[key] == expected[key] for key in ("bytes", "sha256")),
                 "WORKFLOW_NATIVE_OUTPUT_CHANGED")
    return result


def _preserve_bytes(path, raw, content_type):
    expected = {"bytes": len(raw), "sha256": _sha(raw)}
    if path.exists():
        return _file(path, content_type=content_type, expected=expected)
    descriptor, temporary = tempfile.mkstemp(prefix=".original-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            _file(path, expected=expected)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return _file(path, content_type=content_type, expected=expected)


class _AnalysisHTTP:
    """Small typed companion for the maintained report/export HTTP routes.

    The original Datasette client continues to own connection validation,
    loopback capability, no-proxy transport and redirect refusal.
    """
    def __init__(self, client):
        self.client = client

    def _open(self, route, body=None):
        parsed = urlsplit(route)
        _require(not parsed.scheme and not parsed.netloc and not parsed.fragment
                 and "\\" not in route and not any(ord(char) < 32 for char in route),
                 "WORKFLOW_NATIVE_ROUTE_INVALID")
        path = parsed.path
        if body is not None:
            allowed = (not parsed.query and (
                re.fullmatch(r"/api/reports/[A-Za-z][A-Za-z0-9_]{0,63}", path) or
                re.fullmatch(r"/api/start/(query-export|report|report-export|change-export)", path) or
                re.fullmatch(r"/api/report-runs/[a-f0-9]{32}/publish", path)))
        else:
            values = parse_qsl(parsed.query, strict_parsing=True)
            keys = [key for key, _ in values]
            allowed = len(keys) == len(set(keys)) and (
                re.fullmatch(r"/api/reports/[A-Za-z][A-Za-z0-9_]{0,63}", path)
                and set(keys) <= {"revision"} or
                path == "/api/report-publications" and set(keys) <= {"name", "before", "limit"} or
                re.fullmatch(r"/api/(report-export|change-export)/[a-f0-9]{32}", path) and not keys or
                re.fullmatch(r"/api/query-exports/[a-f0-9]{32}/file", path) and set(keys) == {"name"})
        _require(bool(allowed), "WORKFLOW_NATIVE_ROUTE_INVALID")
        self.client.status()
        connection = self.client.connection
        headers = {"X-Analysis-Capability": connection.capability,
                   "Origin": connection.origin}
        raw = None
        if body is not None:
            raw = _json(body)
            headers["Content-Type"] = "application/json"
        request = Request(connection.origin + route, data=raw, headers=headers,
                          method="POST" if body is not None else "GET")
        try:
            return self.client.opener.open(request, timeout=self.client.timeout)
        except HTTPError as error:
            raw = error.read(65537)
            try:
                value = json.loads(raw) if len(raw) <= 65536 else {}
            except (ValueError, UnicodeError):
                value = {}
            code = value.get("error", "WORKFLOW_NATIVE_HTTP_FAILED")
            raise DatasetteClientError(str(code), str(code), status=error.code) from None

    def json(self, route, body=None):
        with self._open(route, body) as response:
            raw = response.read(_MAX_JSON + 1)
        _require(len(raw) <= _MAX_JSON, "WORKFLOW_NATIVE_RESPONSE_TOO_LARGE")
        return json.loads(raw)

    def download(self, route, destination, expected):
        if destination.exists():
            return _file(destination, content_type=expected["contentType"], expected=expected)
        descriptor, temporary = tempfile.mkstemp(prefix=".native-download-", dir=destination.parent)
        try:
            with os.fdopen(descriptor, "wb") as target, self._open(route) as response:
                _require(response.headers.get("X-Content-SHA256") == expected["sha256"]
                         and response.headers.get("Content-Length") == str(expected["bytes"]),
                         "WORKFLOW_NATIVE_DOWNLOAD_IDENTITY_CHANGED")
                size, checksum = 0, hashlib.sha256()
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    _require(size <= expected["bytes"], "WORKFLOW_NATIVE_DOWNLOAD_TOO_LONG")
                    checksum.update(block)
                    target.write(block)
                _require(size == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                         "WORKFLOW_NATIVE_DOWNLOAD_INCOMPLETE")
                target.flush()
                os.fsync(target.fileno())
            try:
                os.link(temporary, destination, follow_symlinks=False)
            except FileExistsError:
                _file(destination, expected=expected)
            sync_directory(destination.parent)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return _file(destination, content_type=expected["contentType"], expected=expected)


class NativeWorkflowAdapter:
    """Run the installed source/report profile for one stable original run ID."""

    def __init__(self, configuration, *, workspace: Path, progress=None):
        _require(isinstance(configuration, dict) and configuration.get("schema") == CONFIGURATION,
                 "WORKFLOW_CONFIGURATION_REQUIRED")
        _require(isinstance(configuration.get("profile"), str) and configuration["profile"],
                 "WORKFLOW_PROFILE_REQUIRED")
        _require(isinstance(configuration.get("source"), dict)
                 and isinstance(configuration.get("analysis"), dict), "WORKFLOW_NATIVE_CONFIGURATION_REQUIRED")
        self.configuration = json.loads(_json(configuration))
        self.source_alias = configuration.get("sourceAlias", "source")
        self.related_sources = configuration.get("relatedSources", {})
        _require(isinstance(self.source_alias, str) and _NAME.fullmatch(self.source_alias)
                 and isinstance(self.related_sources, dict), "WORKFLOW_SOURCE_ALIASES_INVALID")
        aliases = [self.source_alias, *self.related_sources]
        _require(all(isinstance(alias, str) and _NAME.fullmatch(alias) for alias in aliases)
                 and len({alias.casefold() for alias in aliases}) == len(aliases)
                 and all(isinstance(value, dict) for value in self.related_sources.values()),
                 "WORKFLOW_SOURCE_ALIASES_INVALID")
        self.directory = private_directory(_absolute(workspace), create=True)
        self.outputs = private_directory(self.directory / "files", create=True)
        self.inputs = private_directory(self.directory / "native-inputs", create=True)
        self.records = private_directory(self.directory / "native-records", create=True)
        self.path = self.directory / "native-workflow.json"
        self.progress = progress if callable(progress) else lambda event: None
        self.state = None
        self.client = self.http = None
        wait = configuration["analysis"].get("waitSeconds", 3600)
        _require(type(wait) in (int, float) and math.isfinite(wait) and wait > 0,
                 "WORKFLOW_WAIT_INVALID")
        self.wait_seconds = wait

    def _emit(self, phase, **values):
        self.progress({"phase": phase, "runId": self.state["runId"], **values})

    def _save(self):
        _write(self.path, self.state)

    def _bind(self, key, value):
        bindings = self.state.setdefault("bindings", {})
        if key in bindings:
            _require(_json(bindings[key]) == _json(value), "WORKFLOW_NATIVE_INPUT_CHANGED", {"phase": key})
        else:
            bindings[key] = value
            self._save()
        return bindings[key]

    def _id(self, phase):
        value = _identity(self.state["runId"], phase)
        self.state["nativeIds"][phase] = value
        self._save()
        return value

    @contextlib.contextmanager
    def _lock(self):
        descriptor = os.open(self.directory / "native-workflow.lock",
                             os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield None
        finally:
            os.close(descriptor)

    def _invoke(self, phase, command, value, *, cli=False):
        """Use the original native program and retain each actual invocation."""
        self._bind("source:" + phase, {"command": command, "input": value, "cli": cli})
        output = self.records / (phase + ".json")
        if output.exists():
            return _record(output)
        input_path = self.inputs / (phase + ".json")
        _write(input_path, value, immutable=True)
        attempts = self.state.setdefault("sourceAttempts", {})
        number = attempts.get(phase, 0)
        attempts[phase] = number + 1
        self._save()
        stdout_path = self.records / (phase + "." + str(number) + ".stdout")
        stderr_path = self.records / (phase + "." + str(number) + ".stderr")
        args = [*command, "--input-file", str(input_path), "--out", str(output)] if cli else command
        self._emit("SOURCE_" + phase.upper(), attempt=number)
        with input_path.open("rb") as stdin, stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            os.chmod(stdout_path, 0o600)
            os.chmod(stderr_path, 0o600)
            completed = subprocess.run(args, stdin=None if cli else stdin, stdout=stdout, stderr=stderr,
                                       check=False, shell=False, timeout=self.wait_seconds)
            stdout.flush()
            stderr.flush()
            os.fsync(stdout.fileno())
            os.fsync(stderr.fileno())
        if output.exists():
            return _record(output)
        _require(completed.returncode == 0, "WORKFLOW_NATIVE_SOURCE_FAILED",
                 {"phase": phase, "exitCode": completed.returncode, "stderr": str(stderr_path)})
        result = _record(stdout_path)
        _write(output, result, immutable=True)
        return result

    def _source_call(self, phase, operation, value, *, config=None):
        config = self.configuration["source"] if config is None else config
        command = [config.get("node", "node"), str(HERE.parent / "datasette" / "cli.mjs"),
                   "--url-file", str(_absolute(config["connectionFile"])),
                   "--expected-workspace-id", config["workspaceId"], "--operation", operation]
        return self._invoke(phase, command, value, cli=True)

    def _source_archive(self, edition_file, edition_sha, node, *, alias=None):
        scope = "" if alias is None else "related-" + alias + "-"
        filename = ("" if alias is None else alias + "_") + "Source_Edition.datasette.json.gz"
        destination = self.outputs / filename
        program = (
            "import{pathToFileURL}from'node:url';"
            "let s='';for await(const b of process.stdin)s+=b;"
            "const p=JSON.parse(s);const m=await import(pathToFileURL(p.module));"
            "await m.readDatasetteEdition(p.editionFile,{expectedSha256:p.editionSha256});"
            "const r=await m.exportDatasetteEdition({editionFile:p.editionFile,outputFile:p.outputFile});"
            "process.stdout.write(JSON.stringify(r)+'\\n');")
        result = self._invoke(scope + "source-package", [node, "--input-type=module", "--eval", program], {
            "module": str(HERE.parent / "datasette" / "editions.mjs"),
            "editionFile": edition_file, "editionSha256": edition_sha, "outputFile": str(destination)})
        _require(result["editionSha256"] == edition_sha, "WORKFLOW_SOURCE_ARCHIVE_EDITION_CHANGED")
        return _file(destination, content_type="application/gzip", expected=result)

    def _acquire(self, request, *, config=None, alias=None):
        config = self.configuration["source"] if config is None else config
        kind = config.get("kind")
        scope = "" if alias is None else "related-" + alias + "-"
        filename_prefix = "" if alias is None else alias + "_"
        files = []

        def source_call(phase, operation, value):
            return self._source_call(scope + phase, operation, value, config=config)
        if kind == "handover":
            path = _absolute(config["path"])
            expected = config.get("sha256")
            _require(isinstance(expected, str) and _HASH.fullmatch(expected), "WORKFLOW_HANDOVER_HASH_REQUIRED")
            original = _source.handover(path)
            _require(original["sha256"] == expected, "WORKFLOW_HANDOVER_CHANGED")
            self._bind(scope + "handover", {"path": str(path), "sha256": expected,
                                    "delivery": original["record"]["delivery"]})
            handover = original["record"]
            files.append(_preserve_bytes(self.outputs / (filename_prefix + "Original_Handover.json"),
                                         original["raw"], "application/json"))
            if handover["delivery"].get("kind") == "native-edition":
                delivery = handover["delivery"]
                files.append(self._source_archive(
                    str(_absolute(delivery["edition"])), delivery["sha256"],
                    config.get("node", "node"), alias=alias))

        elif kind == "csv":
            path = _absolute(config["path"])
            _require(isinstance(config.get("sha256"), str) and _HASH.fullmatch(config["sha256"])
                     and type(config.get("bytes")) is int and config["bytes"] >= 0,
                     "WORKFLOW_CSV_DESCRIPTOR_REQUIRED")
            descriptor = _file(path, expected=config)
            original = path.read_bytes()
            _require(_sha(original) == descriptor["sha256"], "WORKFLOW_CSV_SOURCE_CHANGED")
            original_output = self.outputs / (filename_prefix + "Original_Source.csv")
            files.append(_preserve_bytes(original_output, original, "text/csv; charset=utf-8"))
            supplier = self.configuration.get("delivery", {}).get("supplier", {})
            parser = _absolute(config.get("parser") or
                               str(_absolute(supplier["component"]) / "supplier-report.mjs"))
            parser_file = _file(parser, content_type="text/javascript")
            if config.get("parserSha256") is not None:
                _require(parser_file["sha256"] == config["parserSha256"],
                         "WORKFLOW_CSV_PARSER_CHANGED")
            self._bind(scope + "csvParser", parser_file)
            delivery = {"kind": "csv-source", "csv": str(original_output),
                        "sha256": descriptor["sha256"], "parser": str(parser),
                        "parser_sha256": parser_file["sha256"]}
            metadata = config.get("metadata")
            if metadata is not None:
                _require(isinstance(metadata, dict) and isinstance(metadata.get("sha256"), str)
                         and _HASH.fullmatch(metadata["sha256"]) and type(metadata.get("bytes")) is int,
                         "WORKFLOW_CSV_METADATA_REQUIRED")
                metadata_path = _absolute(metadata["path"])
                metadata_file = _file(metadata_path, expected=metadata)
                metadata_raw = metadata_path.read_bytes()
                _require(_sha(metadata_raw) == metadata_file["sha256"],
                         "WORKFLOW_CSV_METADATA_CHANGED")
                metadata_output = self.outputs / (filename_prefix + "Original_Metadata.json")
                files.append(_preserve_bytes(metadata_output, metadata_raw, "application/json"))
                delivery.update(metadata=str(metadata_output),
                                metadata_sha256=metadata_file["sha256"])
            source = config.get("source")
            _require(isinstance(source, dict) and source.get("url")
                     and source.get("publisher") and source.get("title"),
                     "WORKFLOW_CSV_PUBLISHER_SOURCE_REQUIRED")
            source = json.loads(_json(source))
            receipt_key = scope + "csvOriginalImport"
            if receipt_key not in self.state.setdefault("bindings", {}):
                self._bind(receipt_key, {"importedAt": datetime.now(timezone.utc).isoformat(),
                    "sourceSha256": descriptor["sha256"], "source": source})
            receipt = self.state["bindings"][receipt_key]
            _require(receipt["sourceSha256"] == descriptor["sha256"] and receipt["source"] == source,
                     "WORKFLOW_CSV_SOURCE_CHANGED")
            source["captured_at"] = receipt["importedAt"]
            source["capture_time_basis"] = "local-original-file-import"
            handover = {"schema": "stellar-forge.datasette-analysis-handover.v1",
                        "delivery": delivery, "source": source,
                        "review": {"keys": config.get("key", [])},
                        "column_mapping": config.get("columnMapping", {})}
            self._bind(scope + "originalCsv", {"file": descriptor, "delivery": delivery,
                                              "review": handover["review"]})
        elif kind in {"native-edition", "datasette"}:
            if kind == "native-edition":
                edition_file, edition_sha = str(_absolute(config["edition"])), config.get("sha256")
                _require(isinstance(edition_sha, str) and _HASH.fullmatch(edition_sha),
                         "WORKFLOW_SOURCE_EDITION_HASH_REQUIRED")
            else:
                _require(isinstance(config.get("workspaceId"), str) and config["workspaceId"],
                         "WORKFLOW_SOURCE_WORKSPACE_ID_REQUIRED")
                selection = json.loads(_json(config["selection"]))
                filters = config.get("urlParameters", {})
                _require(isinstance(filters, dict), "WORKFLOW_SOURCE_PARAMETERS_INVALID")
                if filters:
                    parsed = urlsplit(selection["url"])
                    values = list(parse_qsl(parsed.query, keep_blank_values=True))
                    for name, parameter in filters.items():
                        _require(isinstance(name, str) and isinstance(parameter, str)
                                 and parameter in request["parameters"], "WORKFLOW_SOURCE_PARAMETER_REQUIRED")
                        value = request["parameters"][parameter]
                        _require(value is not None and type(value) in (str, int, float, bool),
                                 "WORKFLOW_SOURCE_PARAMETER_INVALID")
                        values = [(key, old) for key, old in values if key != name]
                        values.append((name, str(value).lower() if type(value) is bool else str(value)))
                    selection["url"] = urlunsplit((parsed.scheme, parsed.netloc, parsed.path,
                                                  urlencode(values), parsed.fragment))
                capture_id = str(uuid.uuid5(uuid.UUID(hex=self.state["runId"]), scope + "source-capture"))
                self.state["nativeIds"][scope + "sourceCapture"] = capture_id
                edition_id = "workflow-" + (self.state["runId"] if alias is None else
                    _identity(self.state["runId"], scope + "source-edition"))
                self.state["nativeIds"][scope + "sourceEdition"] = edition_id
                self._save()
                capture = source_call("capture", "source.capture",
                                            {"operationId": capture_id, "selection": selection})
                self._bind(scope + "sourceCaptureReceipt", capture)
                key = config.get("key", [])
                reviewed = source_call("profile", "source.review", {
                    "operationId": capture_id, "key": key,
                    **({"projection": config["projection"]} if config.get("projection") is not None else {})})
                projection = config.get("projection") or reviewed["suggestedProjection"]
                reviewed = source_call("review", "source.review", {
                    "operationId": capture_id, "key": key, "projection": projection})
                _require(reviewed.get("approved") is True, "WORKFLOW_NATIVE_SOURCE_REVIEW_INCOMPLETE")
                created = source_call("edition", "editions.create", {
                    "id": edition_id, "operationId": capture_id,
                    "name": config.get("editionName", self.configuration["profile"][:90] + " " + self.state["runId"][:12]),
                    "key": key, "projection": projection})
                inspected = source_call("edition-inspect", "editions.inspect",
                                              {"id": edition_id, "offset": 0, "limit": 1})
                _require(created["editionSha256"] == inspected["editionSha256"],
                         "WORKFLOW_SOURCE_EDITION_CHANGED")
                edition_file, edition_sha = inspected["editionFile"], inspected["editionSha256"]
            handover = {"schema": "stellar-forge.datasette-analysis-handover.v1",
                        "delivery": {"kind": "native-edition", "edition": edition_file, "sha256": edition_sha}}
            self._bind(scope + "nativeEdition", handover["delivery"])
            files.append(self._source_archive(edition_file, edition_sha, config.get("node", "node"), alias=alias))
        else:
            raise WorkflowAnalysisError("WORKFLOW_SOURCE_KIND_INVALID")
        # Normalization preserves the original selected member paths; the native
        # reader still verifies the complete source closure during prepare.
        selected_path = self.inputs / (scope + "selected-handover.json")
        _write(selected_path, handover, immutable=True)
        handover_output = self.outputs / (filename_prefix + "Source_Handover.json")
        _write(handover_output, handover, immutable=True)
        files.append(_file(handover_output, content_type="application/json"))
        self.state.setdefault("sources", {})[alias or self.source_alias] = {
            "kind": kind, "handover": str(selected_path), "delivery": handover["delivery"]}
        self._save()
        return str(selected_path), files

    def _action(self, phase, action, body):
        request_id = self._id(phase)
        self._bind("action:" + phase, {"action": action, "body": body, "requestId": request_id})
        deadline = time.monotonic() + self.wait_seconds
        waiting = False
        while True:
            try:
                result = self.client.submit(action, body, request_id=request_id)["request"]
                if result["status"] in {"FAILED", "INTERRUPTED"}:
                    result = self.client.resume(request_id)["request"]
                break
            except DatasetteClientError as error:
                if error.code != "DATASETTE_OPERATOR_BUSY":
                    raise
                _require(time.monotonic() < deadline, "WORKFLOW_NATIVE_OPERATOR_STILL_BUSY",
                         {"phase": phase, "requestId": request_id})
                if not waiting:
                    self._emit(phase.upper(), nativeId=request_id, status="WAITING_FOR_NATIVE_OWNER")
                    waiting = True
                time.sleep(0.5)
        if result["status"] == "RUNNING":
            result = self.client.wait(request_id, timeout=self.wait_seconds,
                progress=lambda item: self._emit(phase.upper(), nativeId=request_id, status=item["status"]))
        _require(result["status"] == "COMPLETE", "WORKFLOW_NATIVE_ACTION_INCOMPLETE",
                 {"phase": phase, "requestId": request_id, "status": result["status"], "error": result.get("error")})
        self._emit(phase.upper(), nativeId=request_id, status="COMPLETE")
        return result["result"]

    def _job(self, phase, kind, fields, *, allow_partial=False):
        """Reopen saved jobs; native immutable failed jobs retain attempt identity."""
        self._bind("job-input:" + phase, {"kind": kind, "fields": fields})
        attempts = self.state.setdefault("jobAttempts", {}).setdefault(phase, [])
        if not attempts:
            attempts.append(_identity(self.state["runId"], phase + ":0"))
            self._save()
        job_id = attempts[-1]
        try:
            current = self.client.analysis_job(job_id)
        except DatasetteClientError as error:
            if error.code != "ANALYSIS_JOB_NOT_FOUND":
                raise
            current = None
        partial = lambda item: (kind == "report" and str(item.get("error", "")).startswith(
            ("ANALYSIS_REPORT_INCOMPLETE_SECTION_", "ANALYSIS_REPORT_RESULT_LIMIT", "ANALYSIS_REPORT_TIME_LIMIT")))
        if current and current["status"] in {"FAILED", "INTERRUPTED", "CANCELLED"}:
            if allow_partial and partial(current):
                return current
            job_id = _identity(self.state["runId"], phase + ":" + str(len(attempts)))
            attempts.append(job_id)
            self._save()
            current = None
        self.state["nativeIds"][phase] = job_id
        self._save()
        if current is None:
            current = (self.client.start_query(fields, job_id=job_id) if kind == "query" else
                       self.http.json("/api/start/" + kind, {"id": job_id, **fields}))
        _require(current.get("id") == job_id and current.get("kind") == kind
                 and all(current.get("request", {}).get(key) == value for key, value in fields.items()),
                 "WORKFLOW_ORIGINAL_NATIVE_JOB_CHANGED", {"phase": phase, "jobId": job_id})
        deadline = time.monotonic() + self.wait_seconds
        marker = None
        while current["status"] == "RUNNING":
            progress = current.get("progress") or {}
            observed = (current["status"], progress.get("rows"), progress.get("outputBytes"), progress.get("phase"))
            if observed != marker:
                self._emit(phase.upper(), nativeId=job_id, status="RUNNING",
                           **{key: progress[key] for key in ("rows", "outputBytes") if key in progress})
                marker = observed
            _require(time.monotonic() < deadline, "WORKFLOW_NATIVE_JOB_STILL_RUNNING",
                     {"phase": phase, "jobId": job_id})
            time.sleep(0.5)
            current = self.client.analysis_job(job_id)
        _require(current["status"] == "COMPLETE" or allow_partial and partial(current),
                 "WORKFLOW_NATIVE_JOB_INCOMPLETE",
                 {"phase": phase, "jobId": job_id, "status": current["status"], "error": current.get("error")})
        self._emit(phase.upper(), nativeId=job_id, status=current["status"])
        return current

    @staticmethod
    def _query_fields(query, edition, parameters, editions=None):
        editions = editions or {}
        def replace(match):
            kind, name, member = match.groups()
            if kind == "source":
                _require(member is None and name in editions,
                         "WORKFLOW_QUERY_SOURCE_NOT_IN_PROFILE", {"source": name})
                selected = editions[name]["collections"]["plants"]["name"]
            else:
                target = edition
                if member is not None:
                    _require(kind in {"column", "collection"} and name in editions,
                             "WORKFLOW_QUERY_SOURCE_NOT_IN_PROFILE", {"source": name})
                    target, name = editions[name], member
                if kind == "column":
                    mapping = target["source"].get("column_mapping", {})
                    selected = mapping.get(name, name)
                    _require(selected in target["collections"]["plants"]["columns"],
                             "WORKFLOW_QUERY_COLUMN_NOT_IN_EDITION", {"column": name})
                else:
                    collection = target["collections"].get(name)
                    _require(collection is not None, "WORKFLOW_QUERY_COLLECTION_NOT_IN_EDITION",
                             {"collection": name})
                    selected = collection["name"]
            return '"' + selected.replace('"', '""') + '"'
        sql = query.get("sql")
        _require(isinstance(sql, str) and sql.strip(), "WORKFLOW_CUSTOMER_SQL_REQUIRED")
        sql = _TOKEN.sub(replace, sql)
        _require("{{" not in sql and "}}" not in sql, "WORKFLOW_QUERY_TEMPLATE_INVALID")
        names = query.get("parameterNames", [])
        _require(isinstance(names, list) and all(isinstance(name, str) and name in parameters for name in names),
                 "WORKFLOW_QUERY_PARAMETER_REQUIRED")
        values = [parameters[name] for name in names]
        _require(all(value is None or type(value) in (str, int, float, bool) for value in values),
                 "WORKFLOW_QUERY_PARAMETER_INVALID")
        maximum = query.get("maxRows", 100000)
        _require(type(maximum) is int and 1 <= maximum <= 100000, "WORKFLOW_QUERY_LIMIT_INVALID")
        return {"sql": sql, "parameters_text": _json(values).decode(), "max_rows": maximum}


    def _analysis_phase(self, phase):
        return ("selected-" if self.state.get("selectionContinuation") else "") + phase

    def _analysis_filename(self, name):
        return ("Selected_" if self.state.get("selectionContinuation") else "") + name

    def _source_views(self, editions):
        """Pin the original imported versions, independent of other requests."""
        selected = {}
        for edition in editions.values():
            for item in edition["collections"].values():
                binding = {"name": item["name"], "version_id": item["version_id"],
                           "revision": item["view_revision"]}
                previous = selected.get(item["name"].lower())
                _require(previous is None or previous == binding,
                         "WORKFLOW_SOURCE_VIEW_COLLISION")
                selected[item["name"].lower()] = binding
        _require(selected, "WORKFLOW_SOURCE_VIEWS_REQUIRED")
        value = {"scope": "selected",
                 "bindings": [selected[name] for name in sorted(selected)]}
        return self._bind("querySourceViews", value)

    def _queries(self, edition, request, editions=None):
        config = self.configuration["analysis"]
        queries = config.get("queries")
        if queries is None:
            queries = [config.get("query")]
        _require(isinstance(queries, list) and 1 <= len(queries) <= 12,
                 "WORKFLOW_CUSTOMER_QUERIES_REQUIRED")
        views = self._source_views(editions or {self.source_alias: edition})
        files, results, names = [], [], set()
        formats = self.configuration.get("delivery", {}).get("queryFormats", ["csv", "jsonl", "sqlite"])
        _require(isinstance(formats, list) and formats and len(formats) == len(set(formats))
                 and all(value in {"csv", "jsonl", "sqlite"} for value in formats),
                 "WORKFLOW_QUERY_EXPORT_FORMATS_INVALID")
        for ordinal, query in enumerate(queries):
            _require(isinstance(query, dict) and isinstance(query.get("name"), str)
                     and _NAME.fullmatch(query["name"]) and query["name"] not in names,
                     "WORKFLOW_QUERY_NAME_INVALID")
            names.add(query["name"])
            name = query["name"] + "_" + self.state["runId"][:12]
            fields = self._query_fields(query, edition, request["parameters"], editions)
            self._bind("saved-query:" + str(ordinal), {"name": name, "fields": fields})
            try:
                saved = self.client.saved_query(name)
            except DatasetteClientError as error:
                if error.code != "ANALYSIS_QUERY_NOT_FOUND":
                    raise
                saved = self.client.save_query(name, fields, expected_revision=0)
            _require(all(saved.get(key) == value for key, value in fields.items()),
                     "WORKFLOW_SAVED_CUSTOMER_QUERY_CHANGED", {"name": name})
            job = self._job(self._analysis_phase("query" + str(ordinal)), "query",
                            {**fields, "expected_views": views})
            output = self._job(self._analysis_phase("queryExport" + str(ordinal)), "query-export", {
                "query_id": job["id"], "result_sha256": job["result"]["result_sha256"],
                "label": query.get("title", query["name"]).strip(), "formats": formats})
            for item in output["result"]["files"]:
                _require(item["name"] in {"rows.csv", "rows.jsonl", "rows.sqlite3", "manifest.json"},
                         "WORKFLOW_NATIVE_QUERY_FILENAME_INVALID")
                destination = self.outputs / self._analysis_filename(query["name"] + "_" + item["name"])
                expected = {"bytes": item["bytes"], "sha256": item["sha256"], "contentType": item["mime"]}
                route = "/api/query-exports/" + output["id"] + "/file?" + urlencode({"name": item["name"]})
                files.append(self.http.download(route, destination, expected))
            results.append({"name": name, "revision": saved["revision"], "fields": fields,
                "title": query.get("title", query["name"]), "note": query.get("note", ""),
                "jobId": job["id"], "resultSha256": job["result"]["result_sha256"],
                "previewRows": job["result"]["total_rows"], "previewTruncated": job["result"]["truncated"],
                "viewBindings": job["result"]["views"], "sourceVersions": job["result"].get("source_versions", []),
                "exportId": output["id"], "exportManifestSha256": output["result"]["manifest_sha256"],
                "exportRows": output["result"]["manifest"]["rowCount"], "exportStatus": output["status"]})
        return results, files, views

    def _report(self, edition, queries, views, editions=None):
        config = self.configuration["analysis"].get("report", {})
        name = "workflow_report_" + self.state["runId"]
        if self.state.get("selectionContinuation"):
            name += "_selected"
        request_id = self._id(self._analysis_phase("reportDefinition"))
        source_note = "\nSource edition: " + edition["edition_id"]
        if editions:
            source_note = "\n" + "\n".join("Source " + alias + ": " + item["edition_id"]
                                          for alias, item in sorted(editions.items()))
        definition_input = {
            "id": request_id, "expected_revision": 0,
            "title": config.get("title", self.configuration["profile"] + " report"),
            "introduction": config.get("introduction", "") + source_note,
            "sections": [{"title": query["title"], "note": query["note"], "query_name": query["name"],
                          "query_revision": query["revision"], "parameters_text": None} for query in queries]}
        self._bind(self._analysis_phase("reportDefinition"), definition_input)
        saved = self.http.json("/api/reports/" + name, definition_input)
        definition = self.http.json("/api/reports/" + name + "?" + urlencode({"revision": saved["revision"]}))
        job = self._job(self._analysis_phase("report"), "report", {"name": name, "revision": saved["revision"],
                    "definition_sha256": definition["sha256"], "expected_views": views}, allow_partial=True)
        if job["status"] != "COMPLETE":
            return {"status": "PARTIAL", "name": name, "jobId": job["id"],
                    "definitionRevision": saved["revision"], "nativeError": job.get("error")}, []
        publication_id = self._id(self._analysis_phase("reportPublication"))
        publish_input = {"id": publication_id, "result_sha256": job["result"]["result_sha256"],
                         "expected_revision": 0, "note": config.get("note", "Original source and customer SQL retained together.")}
        self._bind(self._analysis_phase("reportPublication"), publish_input)
        publication = self.http.json("/api/report-runs/" + job["id"] + "/publish", publish_input)
        before, observed = None, None
        while True:
            values = {"name": name, "limit": 25}
            if before is not None:
                values["before"] = before
            page = self.http.json("/api/report-publications?" + urlencode(values))
            observed = next((item for item in page["publications"] if item["publication"]["id"] == publication_id), None)
            if observed or page.get("next_before") is None:
                break
            next_before = page["next_before"]
            _require(before is None or next_before < before, "WORKFLOW_REPORT_PUBLICATION_CURSOR_CHANGED")
            before = next_before
        _require(observed is not None and observed["publication"] == publication,
                 "WORKFLOW_ORIGINAL_REPORT_PUBLICATION_MISSING")
        files = []
        for format, filename, content_type in (
            ("html", "Customer_Report.html", "text/html; charset=utf-8"),
            ("json", "Customer_Report.json", "application/json"),
            ("csv", "Customer_Report_Tables.zip", "application/zip")):
            exported = self._job(self._analysis_phase("reportExport" + format), "report-export", {
                "publication_id": publication_id, "publication_sha256": observed["sha256"], "format": format})
            result = exported["result"]
            files.append(self.http.download("/api/report-export/" + exported["id"],
                self.outputs / self._analysis_filename(filename), {"bytes": result["bytes"], "sha256": result["sha256"],
                                          "contentType": content_type}))
        return {"status": "COMPLETE", "name": name, "jobId": job["id"],
                "definitionRevision": saved["revision"], "definitionSha256": definition["sha256"],
                "resultSha256": job["result"]["result_sha256"], "rows": job["result"]["total_rows"],
                "publicationId": publication_id, "publicationSha256": observed["sha256"]}, files

    def _comparison(self, edition, *, config=None, alias=None):
        config = self.configuration["analysis"].get("comparison") if config is None else config
        scope = "" if alias is None else "related-" + alias + "-"
        filename_prefix = "" if alias is None else alias + "_"
        if config is None:
            return None, []
        comparison = self._action(scope + "compare", "compare", {
            "before": config["before"], "after": edition["edition_id"], "keys": config["keys"]})
        native = comparison["page"]["report"]
        files = []
        for format in ("json", "csv"):
            exported = self._job(scope + "comparisonExport" + format, "change-export", {
                "comparison_id": native["id"], "result_sha256": native["result_sha256"],
                "selection_sha256": comparison["page"]["selection_sha256"], "format": format})
            result = exported["result"]
            files.append(self.http.download("/api/change-export/" + exported["id"],
                self.outputs / (filename_prefix + "Source_Comparison." + format),
                {"bytes": result["bytes"], "sha256": result["sha256"],
                 "contentType": "application/json" if format == "json" else "text/csv; charset=utf-8"}))
        return {"id": comparison["comparison_id"], "jobId": native["id"],
                "before": comparison["before"], "after": comparison["after"], "keys": comparison["keys"],
                "summary": comparison["summary"], "resultSha256": native["result_sha256"],
                "selectionSha256": comparison["page"]["selection_sha256"]}, files

    def _deliver(self, edition, editions=None):
        phase = self._analysis_phase("export")
        export_id = self._id(phase)
        exported = self._action(phase, "export", {"export_id": export_id,
                                               "edition_id": edition["edition_id"]})
        _require(exported["id"] == export_id and exported.get("edition_id") == edition["edition_id"],
                 "WORKFLOW_ARCHIVE_SOURCE_EDITION_CHANGED")
        files, archive = [], None
        original_files = [(None, item) for item in [*edition.get("files", []), *exported["files"]]]
        for alias, related in sorted((editions or {}).items()):
            if alias != self.source_alias:
                original_files.extend((alias, item) for item in related.get("files", []))
        for alias, item in original_files:
            filename = self._analysis_filename(("" if alias is None else alias + "_") + item["filename"])
            _require(Path(filename).name == filename and filename not in {".", ".."},
                     "WORKFLOW_NATIVE_FILENAME_INVALID")
            destination = self.outputs / filename
            if destination.exists():
                _file(destination, expected=item)
            else:
                self.client.download(item["name"], destination, edition_id=item.get("edition_id"),
                                     export_id=item.get("export_id"), expected_sha256=item["sha256"])
            content_type = {".json": "application/json", ".html": "text/html; charset=utf-8",
                ".zip": "application/zip",
                ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}.get(
                    destination.suffix, "application/octet-stream")
            descriptor = _file(destination, content_type=content_type, expected=item)
            files.append(descriptor)
            if item["name"] == "workspace":
                archive = descriptor
        _require(archive is not None, "WORKFLOW_NATIVE_ARCHIVE_REQUIRED")
        self.state["nativeIds"]["workspaceArchiveJob"] = exported["job_id"]
        self._save()
        return archive, files

    def _supplier_input(self, value, filename, content_type):
        _require(isinstance(value, dict) and isinstance(value.get("path"), str)
                 and type(value.get("bytes")) is int and value["bytes"] >= 0
                 and isinstance(value.get("sha256"), str) and _HASH.fullmatch(value["sha256"]),
                 "WORKFLOW_SUPPLIER_DESCRIPTOR_REQUIRED", {"file": filename})
        original = _file(_absolute(value["path"]), expected=value)
        raw = Path(original["path"]).read_bytes()
        _require(len(raw) == original["bytes"] and _sha(raw) == original["sha256"],
                 "WORKFLOW_SUPPLIER_INPUT_CHANGED", {"file": filename})
        retained = _preserve_bytes(self.outputs / filename, raw, content_type)
        self._bind("supplierInput:" + filename, {"original": original, "retained": retained})
        return retained

    def _supplier_module(self, component, coverage, *, native=False):
        names = ["supplier-report.mjs", "supplier-report-cli.mjs", "supplier_attachments.py"]
        if coverage is not None:
            names.append("catalogue-coverage.mjs")
        if native:
            names.extend(["datasette-bridge.mjs", "source-editions.mjs",
                          "native-source-io.mjs", "native-runtime.json"])
        source = {name: _file(component / name) for name in names}
        self._bind("supplierInstalledSource", source)
        key = "_starforge_supplier_attachments_" + source["supplier_attachments.py"]["sha256"]
        if key not in sys.modules:
            spec = importlib.util.spec_from_file_location(key, component / "supplier_attachments.py")
            _require(spec is not None and spec.loader is not None,
                     "WORKFLOW_SUPPLIER_ATTACHMENT_MODULE_REQUIRED")
            module = importlib.util.module_from_spec(spec)
            sys.modules[key] = module
            try:
                spec.loader.exec_module(module)
            except BaseException:
                sys.modules.pop(key, None)
                raise
        module = sys.modules[key]
        _require(callable(getattr(module, "supplier_attachment_files", None)),
                 "WORKFLOW_SUPPLIER_ATTACHMENT_MODULE_REQUIRED")
        return module, source

    def _supplier_export(self, config, component, original, module, reserved, *, native_archives=None):
        """Continue the maintained CLI export; adopt its complete manifest."""
        directory = private_directory(self.directory / "supplier", create=True)
        selected = self.state.get("bindings", {}).get("supplierExport")
        attempts = self.state.setdefault("supplierExportAttempts", [])

        def finished(attempt):
            bundle = directory / attempt["directory"]
            manifest = bundle / "manifest.json"
            if not manifest.exists():
                return None
            expected = selected["manifestSha256"] if selected is not None else None
            files = module.supplier_attachment_files(
                bundle, request_workspace=self.directory,
                expected_manifest_sha256=expected, reserved_names=reserved)
            descriptor = next(item for item in files if item["name"] == "Supplier_Report_manifest.json")
            value = _record(manifest)
            _require(isinstance(value.get("requestId"), str) and value["requestId"]
                     and isinstance(value.get("comparisonId"), str) and value["comparisonId"]
                     and type(value.get("revision")) is int and value["revision"] >= 0
                     and isinstance(value.get("status"), str) and value["status"],
                     "WORKFLOW_SUPPLIER_NATIVE_IDENTITY_REQUIRED")
            self._bind("supplierExport", {"directory": attempt["directory"],
                "manifestSha256": descriptor["sha256"], "manifestBytes": descriptor["bytes"],
                "requestId": value["requestId"], "comparisonId": value["comparisonId"],
                "revision": value["revision"], "status": value["status"]})
            attempt["status"] = "COMPLETE"
            self._save()
            return bundle, value, descriptor

        if selected is not None:
            attempt = next((item for item in attempts
                            if item["directory"] == selected["directory"]), None)
            _require(attempt is not None, "WORKFLOW_SUPPLIER_EXPORT_HISTORY_CHANGED")
            result = finished(attempt)
            _require(result is not None, "WORKFLOW_ORIGINAL_SUPPLIER_EXPORT_MISSING")
            return result
        for attempt in attempts:
            result = finished(attempt)
            if result is not None:
                return result
        number = len(attempts)
        export_id = self._id("supplier-export-" + str(number))
        attempt = {"id": export_id, "directory": "export-" + export_id, "status": "STARTING"}
        attempts.append(attempt)
        self._save()
        bundle = directory / attempt["directory"]
        _require(not bundle.exists(), "WORKFLOW_SUPPLIER_EXPORT_DIRECTORY_EXISTS")
        command = [config.get("node", "node"), str(component / "supplier-report-cli.mjs"),
                   "export", "--workspace", original["path"], "--out-dir", str(bundle),
                   "--table-name", config.get("tableName", "supplier_feed_accepted")]
        if native_archives:
            command += ["--native-cache", str(directory / "native-source-cache")]
            for role, filename in sorted(native_archives.items()):
                command += ["--" + role + "-native-archive", filename]
        if config.get("nativeDirectory") is not None:
            command += ["--native-directory", str(_absolute(config["nativeDirectory"]))]
        self._bind("supplierCommand:" + export_id, command)
        stdout_path = self.records / ("supplier-export-" + export_id + ".stdout")
        stderr_path = self.records / ("supplier-export-" + export_id + ".stderr")
        self._emit("SUPPLIER_EXPORT", nativeId=export_id, status="RUNNING", attempt=number)
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            os.chmod(stdout_path, 0o600)
            os.chmod(stderr_path, 0o600)
            try:
                process = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=stdout,
                                         stderr=stderr, shell=False, check=False,
                                         timeout=self.wait_seconds)
                attempt["exitCode"] = process.returncode
            except subprocess.TimeoutExpired:
                attempt["status"] = "INTERRUPTED"
                self._save()
                result = finished(attempt)
                if result is not None:
                    return result
                raise WorkflowAnalysisError("WORKFLOW_SUPPLIER_EXPORT_TIMEOUT",
                                            {"attempt": export_id}) from None
            finally:
                stdout.flush()
                stderr.flush()
                os.fsync(stdout.fileno())
                os.fsync(stderr.fileno())
        _file(original["path"], expected=original)
        result = finished(attempt)
        if result is not None:
            return result
        attempt["status"] = "INCOMPLETE"
        self._save()
        raise WorkflowAnalysisError("WORKFLOW_SUPPLIER_EXPORT_INCOMPLETE",
            {"attempt": export_id, "exitCode": attempt["exitCode"], "stderr": str(stderr_path)})

    def _supplier_coverage(self, config, component, editions):
        if config is None:
            return None, []
        _require(isinstance(config, dict) and isinstance(config.get("sourceMetadata", {}), dict),
                 "WORKFLOW_SUPPLIER_COVERAGE_CONFIGURATION_REQUIRED")
        pricing_alias = config.get("pricingAlias", self.source_alias)
        catalogue_alias = config.get("catalogueAlias", "catalog")
        _require(pricing_alias in editions and catalogue_alias in editions
                 and pricing_alias != catalogue_alias, "WORKFLOW_SUPPLIER_COVERAGE_ALIASES_REQUIRED")
        pricing = self._supplier_input(config["pricing"], "coverage-pricing-source.csv",
                                       "text/csv; charset=utf-8")
        catalogue = self._supplier_input(config["catalogue"], "coverage-catalogue-source.csv",
                                         "text/csv; charset=utf-8")
        metadata = self._supplier_input(config["metadata"], "coverage-publisher-metadata.json",
                                        "application/json")
        for alias, original in ((pricing_alias, pricing), (catalogue_alias, catalogue)):
            edition = editions[alias]
            _require(edition["source"].get("source_mode") == "original-csv"
                     and edition["source"].get("csv_sha256") == original["sha256"],
                     "WORKFLOW_SUPPLIER_COVERAGE_SOURCE_CHANGED", {"source": alias})
            selected_metadata = self.state["sources"][alias]["delivery"].get("metadata_sha256")
            _require(selected_metadata is None or selected_metadata == metadata["sha256"],
                     "WORKFLOW_SUPPLIER_COVERAGE_METADATA_CHANGED", {"source": alias})
        program = (
            "import{readFile}from'node:fs/promises';import{pathToFileURL}from'node:url';"
            "let s='';for await(const b of process.stdin)s+=b;const p=JSON.parse(s);"
            "const m=await import(pathToFileURL(p.module));"
            "const read=async f=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(f));"
            "const [pricingCSV,catalogueCSV,originalMetadataText]=await Promise.all("
            "[read(p.pricing),read(p.catalogue),read(p.metadata)]);"
            "const report=m.catalogueCoverage({pricingCSV,catalogueCSV,origin:p.origin,"
            "sourceMetadata:{...p.sourceMetadata,originalMetadata:JSON.parse(originalMetadataText),"
            "originalMetadataText}});"
            "process.stdout.write(JSON.stringify({report,csv:m.coverageCSV(report),"
            "html:m.coverageHTML(report)})+'\\n');")
        result = self._invoke("supplier-coverage", [config.get("node", "node"),
            "--input-type=module", "--eval", program], {
                "module": str(component / "catalogue-coverage.mjs"),
                "pricing": pricing["path"], "catalogue": catalogue["path"],
                "metadata": metadata["path"], "origin": config["origin"],
                "sourceMetadata": config.get("sourceMetadata", {})})
        report = result.get("report")
        _require(isinstance(report, dict) and isinstance(result.get("csv"), str)
                 and isinstance(result.get("html"), str), "WORKFLOW_SUPPLIER_COVERAGE_RESULT_REQUIRED")
        _require(report["sources"]["pricing"]["sha256"] == pricing["sha256"]
                 and report["sources"]["catalogue"]["sha256"] == catalogue["sha256"],
                 "WORKFLOW_SUPPLIER_COVERAGE_RESULT_CHANGED")
        files = [pricing, catalogue, metadata,
            _preserve_bytes(self.outputs / "catalogue-coverage.json", _json(report) + b"\n", "application/json"),
            _preserve_bytes(self.outputs / "catalogue-coverage.csv", result["csv"].encode("utf-8"),
                            "text/csv; charset=utf-8"),
            _preserve_bytes(self.outputs / "catalogue-coverage.html", result["html"].encode("utf-8"),
                            "text/html; charset=utf-8")]
        for item in files[:3]:
            _file(item["path"], expected=item)
        binding = {"pricingAlias": pricing_alias, "catalogueAlias": catalogue_alias,
            "pricing": {"editionId": editions[pricing_alias]["edition_id"],
                        "bytes": pricing["bytes"], "sha256": pricing["sha256"]},
            "catalogue": {"editionId": editions[catalogue_alias]["edition_id"],
                          "bytes": catalogue["bytes"], "sha256": catalogue["sha256"]},
            "metadataSha256": metadata["sha256"],
            "reportSha256": files[3]["sha256"], "summary": report.get("summary"),
            "joinPolicy": report.get("joinPolicy")}
        self._bind("supplierCoverage", binding)
        return binding, files

    def _supplier_native_binding(self, alias, role, prepared, bundle, declared, manifest):
        filename = role + "-source.json"
        member = declared.get(filename)
        _require(member is not None, "WORKFLOW_SUPPLIER_NATIVE_SOURCE_REQUIRED",
                 {"source": alias, "role": role})
        _file(bundle / filename, expected=member)
        original = _record(bundle / filename)
        metadata = original.get("source", {})
        native = metadata.get("native", {})
        source = prepared["source"]
        _require(metadata.get("kind") == "datasette-native-edition"
                 and metadata.get("bridge") == "conapi.datasette-supplier-edition.v1"
                 and isinstance(native, dict)
                 and native.get("editionSha256") == source.get("edition_sha256")
                 and native.get("captureSha256") == source.get("capture_sha256")
                 and native.get("edition", {}).get("reviewSha256") == source.get("review_sha256"),
                 "WORKFLOW_SUPPLIER_NATIVE_SOURCE_CHANGED", {"source": alias, "role": role})
        _require(native.get("projection") == source.get("reviewed_projection")
                 and native.get("sourceColumns") == source.get("source_columns")
                 and native.get("projectedColumns") == source.get("projected_columns")
                 and original.get("columns") == source.get("projected_columns")
                 and isinstance(original.get("rows"), list)
                 and len(original["rows"]) == prepared["row_count"]
                 and isinstance(native.get("nativeRowsJSON"), str)
                 and native.get("edition", {}).get("rowCount") == prepared["row_count"]
                 and native.get("capture", {}).get("rowCount") == prepared["row_count"],
                 "WORKFLOW_SUPPLIER_NATIVE_PROJECTION_CHANGED", {"source": alias, "role": role})
        archives = manifest.get("nativeSources", {})
        archive = archives.get(role) if isinstance(archives, dict) else None
        archive_name = role + "-native-source.datasette.json.gz"
        archive_member = declared.get(archive_name)
        _require(isinstance(archive, dict) and archive.get("archive") == archive_name
                 and archive_member is not None
                 and archive.get("bytes") == archive_member["bytes"]
                 and archive.get("sha256") == archive_member["sha256"]
                 and archive.get("editionSha256") == source["edition_sha256"]
                 and archive.get("captureSha256") == source["capture_sha256"],
                 "WORKFLOW_SUPPLIER_NATIVE_ARCHIVE_CHANGED", {"source": alias, "role": role})
        _file(bundle / archive_name, expected=archive_member)
        return {"role": role, "filename": filename, "editionId": prepared["edition_id"],
                "bytes": member["bytes"], "sha256": member["sha256"],
                "collections": prepared["collections"], "sourceMode": "native-edition",
                "nativeEditionSha256": source["edition_sha256"],
                "nativeCaptureSha256": source["capture_sha256"],
                "nativeReviewSha256": source["review_sha256"],
                "projection": source["reviewed_projection"],
                "rowCount": prepared["row_count"],
                "sourceDigest": original["sourceDigest"],
                "supplierEditionDigest": original["digest"],
                "archive": {"filename": archive_name, "bytes": archive_member["bytes"],
                            "sha256": archive_member["sha256"]}}

    def _supplier(self, request, editions, views, native_files):
        config = self.configuration.get("delivery", {}).get("supplier")
        if config is None:
            return None, []
        _require(isinstance(config, dict), "WORKFLOW_SUPPLIER_CONFIGURATION_REQUIRED")
        roles = config.get("sourceBindings")
        _require(isinstance(roles, dict) and roles
                 and all(alias in editions and role in {"baseline", "candidate"}
                         for alias, role in roles.items()),
                 "WORKFLOW_SUPPLIER_SOURCE_BINDINGS_REQUIRED")
        for alias in roles:
            _require(editions[alias]["source"].get("source_mode") in {"original-csv", "native-edition"},
                     "WORKFLOW_SUPPLIER_ORIGINAL_SOURCE_REQUIRED", {"source": alias})
        component = _absolute(config["component"])
        original = self._supplier_input(config["workspace"], "original-supplier-workspace.json",
                                         "application/json")
        native_roles = {alias: role for alias, role in roles.items()
                        if editions[alias]["source"].get("source_mode") == "native-edition"}
        module, component_files = self._supplier_module(
            component, config.get("coverage"), native=bool(native_roles))
        reserved = [item["name"] for item in native_files]
        native_archives = {}
        if native_roles:
            workspace = _record(Path(original["path"]))
            retained = workspace.get("payload", {})
            _require(workspace.get("format") == "conapi-supplier-report" and isinstance(retained, dict),
                     "WORKFLOW_SUPPLIER_WORKSPACE_REQUIRED")
            for alias, role in sorted(native_roles.items()):
                source = editions[alias]["source"]
                edition = retained.get(role, {})
                native = edition.get("source", {}).get("native", {})
                _require(native.get("editionSha256") == source["edition_sha256"]
                         and native.get("captureSha256") == source["capture_sha256"],
                         "WORKFLOW_SUPPLIER_NATIVE_SOURCE_CHANGED", {"source": alias, "role": role})
                original_archive = native.get("archive", {})
                archive_name = ("" if alias == self.source_alias else alias + "_") + "Source_Edition.datasette.json.gz"
                available = [item for item in native_files if item["name"] == archive_name
                             and (not original_archive or item["sha256"] == original_archive.get("sha256"))]
                if available:
                    _require(len(available) == 1, "WORKFLOW_SUPPLIER_NATIVE_ARCHIVE_AMBIGUOUS")
                    if role in native_archives:
                        _require(_file(native_archives[role])["sha256"] == available[0]["sha256"],
                                 "WORKFLOW_SUPPLIER_NATIVE_SOURCE_CHANGED", {"role": role})
                    native_archives[role] = available[0]["path"]
        bundle, manifest, manifest_file = self._supplier_export(
            config, component, original, module, reserved, native_archives=native_archives)
        source_bindings = {}
        declared = {item["filename"]: item for item in manifest["files"]}
        for alias, role in sorted(roles.items()):
            if editions[alias]["source"].get("source_mode") == "native-edition":
                source_bindings[alias] = self._supplier_native_binding(
                    alias, role, editions[alias], bundle, declared, manifest)
                continue
            filename = role + "-source.csv"
            member = declared.get(filename)
            native_sha = editions[alias]["source"].get("csv_sha256")
            _require(member is not None and member["sha256"] == native_sha,
                     "WORKFLOW_SUPPLIER_REVIEW_SOURCE_CHANGED",
                     {"source": alias, "role": role, "editionId": editions[alias]["edition_id"]})
            source_bindings[alias] = {"role": role, "filename": filename,
                "editionId": editions[alias]["edition_id"], "bytes": member["bytes"],
                "sha256": member["sha256"], "collections": editions[alias]["collections"]}
        self._bind("supplierSourceBindings", source_bindings)
        coverage, coverage_files = self._supplier_coverage(config.get("coverage"), component, editions)
        identity = {key: manifest[key] for key in ("requestId", "comparisonId", "revision", "status")}
        link = {"schema": "stellar-forge.supplier-workflow-link.v1",
            "workflow": {"runId": self.state["runId"], "requestId": request["requestId"],
                         "correlationId": request.get("correlationId"), "profile": request["profile"],
                         "parameters": request["parameters"],
                         "parentRequestId": request.get("parentRequestId")},
            "supplier": {**identity, "workspaceSha256": original["sha256"],
                         "workspaceBytes": original["bytes"], "manifestSha256": manifest_file["sha256"],
                         "manifestBytes": manifest_file["bytes"], "tableName": config.get("tableName", "supplier_feed_accepted")},
            "analysis": {"operationId": self.configuration["analysis"]["operationId"],
                         "viewSelection": views, "sourceBindings": source_bindings},
            "coverage": coverage,
            "installedSource": {name: {"bytes": value["bytes"], "sha256": value["sha256"]}
                                for name, value in component_files.items()}}
        link_path = self.outputs / "supplier-workflow-link.json"
        _write(link_path, link, immutable=True)
        additional = [original, *coverage_files, _file(link_path, content_type="application/json")]
        files = module.supplier_attachment_files(
            bundle, request_workspace=self.directory, expected_manifest_sha256=manifest_file["sha256"],
            expected_request_id=manifest["requestId"], additional_files=additional, reserved_names=reserved)
        for source in component_files.values():
            _file(source["path"], expected=source)
        _file(original["path"], expected=original)
        names = {item["path"]: item["name"] for item in files}
        mapping = [{"name": item["name"], "filename": Path(item["path"]).name} for item in files]
        result = {**identity, "manifestName": names[manifest_file["path"]],
            "manifestSha256": manifest_file["sha256"],
            "workspaceSha256": original["sha256"],
            "businessRequestId": request["requestId"], "correlationId": request.get("correlationId"),
            "sourceBindings": source_bindings, "coverage": coverage, "files": mapping,
            "workflowLinkName": names[str(link_path)]}
        self.state["nativeIds"]["supplier"] = {**identity,
            "manifestSha256": manifest_file["sha256"], "sourceBindings": source_bindings,
            "workspaceSha256": original["sha256"]}
        self._save()
        self._emit("SUPPLIER_COMPLETE", status=manifest["status"],
                   requestId=manifest["requestId"], comparisonId=manifest["comparisonId"],
                   revision=manifest["revision"], files=len(files))
        return result, files

    def run(self, request: dict, run_id: str) -> dict:
        _require(isinstance(request, dict) and request.get("schema") == REQUEST
                 and isinstance(request.get("requestId"), str) and request["requestId"]
                 and request.get("profile") == self.configuration["profile"]
                 and isinstance(request.get("parameters"), dict), "WORKFLOW_ORIGINAL_REQUEST_REQUIRED")
        _require(isinstance(run_id, str) and _ID.fullmatch(run_id), "WORKFLOW_RUN_ID_REQUIRED")
        binding = _sha(_json({"configuration": self.configuration, "request": request, "runId": run_id}))
        with self._lock():
            if self.path.exists():
                self.state = _record(self.path)
                _require(self.state.get("schema") == SCHEMA and self.state.get("runId") == run_id
                         and self.state.get("bindingSha256") == binding, "WORKFLOW_ORIGINAL_RUN_CHANGED")
            else:
                self.state = {"schema": SCHEMA, "runId": run_id, "bindingSha256": binding,
                              "nativeIds": {}, "bindings": {}, "status": "RUNNING"}
                self._save()
            if self.state.get("result") is not None:
                result = self.state["result"]
                for item in result["files"]:
                    _file(item["path"], expected=item)
                self._emit("COMPLETE", status=result["analysis"]["status"], reused=True)
                return result
            analysis = self.configuration["analysis"]
            self.client = DatasetteOperatorClient.from_workspace(_absolute(analysis["workspace"]))
            original = self.client.status()
            _require(original["operation_id"] == analysis["operationId"], "WORKFLOW_ANALYSIS_OPERATION_CHANGED")
            self._bind("analysisWorkspace", {"workspaceId": original["workspace_id"],
                                           "operationId": original["operation_id"]})
            self.http = _AnalysisHTTP(self.client)
            editions, files = {}, []
            for alias, source in sorted(self.related_sources.items()):
                related_handover, source_files = self._acquire(request, config=source, alias=alias)
                prepared = self._action("prepare-related-" + alias, "prepare", {
                    "handover": related_handover, "prefix": source.get("analysisPrefix", alias[:16])})
                _require(prepared["status"] == "COMPLETE", "WORKFLOW_COMPLETE_EDITION_REQUIRED",
                         {"source": alias})
                editions[alias] = prepared
                self.state["nativeIds"]["analysisEdition:" + alias] = prepared["edition_id"]
                files += source_files
                self._save()
            handover, primary_files = self._acquire(request)
            files += primary_files
            edition = self._action("prepare", "prepare",
                                   {"handover": handover, "prefix": analysis.get("prefix", "source")})
            _require(edition["status"] == "COMPLETE", "WORKFLOW_COMPLETE_EDITION_REQUIRED")
            self.state["nativeIds"]["analysisEdition"] = edition["edition_id"]
            editions[self.source_alias] = edition
            self._bind("preparedSources", {alias: {"editionId": item["edition_id"],
                "rowCount": item["row_count"], "collections": item["collections"]}
                for alias, item in sorted(editions.items())})
            self._save()
            if "queryViews" in self.state.get("bindings", {}) and not self.state.get("selectionContinuation"):
                # Retain interrupted older jobs and create an explicit native
                # continuation with selected-source identities and filenames.
                self.state["selectionContinuation"] = {
                    "from": "full-view-catalogue", "to": "selected-source-views",
                    "originalNativeIds": dict(self.state["nativeIds"])}
                self._save()
                self._emit("SOURCE_SELECTION_CONTINUATION", status="RUNNING")
            comparison, comparison_files = self._comparison(edition)
            comparisons = {self.source_alias: comparison} if comparison is not None else {}
            for alias, selection in sorted(analysis.get("comparisons", {}).items()):
                _require(alias in editions and alias not in comparisons and isinstance(selection, dict),
                         "WORKFLOW_COMPARISON_SOURCE_INVALID", {"source": alias})
                observed, observed_files = self._comparison(editions[alias], config=selection, alias=alias)
                comparisons[alias] = observed
                comparison_files += observed_files
            queries, query_files, views = self._queries(edition, request, editions)
            report, report_files = self._report(edition, queries, views,
                                               editions if self.related_sources else None)
            archive, native_files = self._deliver(edition, editions)
            files += comparison_files + query_files + report_files + native_files
            supplier, supplier_files = self._supplier(request, editions, views, files)
            files += supplier_files
            names = [item["name"] for item in files]
            _require(len(names) == len(set(names)), "WORKFLOW_DELIVERY_NAME_COLLISION")
            status = "PARTIAL" if report["status"] != "COMPLETE" or any(
                item["previewTruncated"] for item in queries) else "COMPLETE"
            result = {"edition": edition,
                "analysis": {"status": status, "workspaceId": original["workspace_id"],
                             "operationId": original["operation_id"], "queries": queries,
                             "report": report, "comparison": comparison, "comparisons": comparisons,
                             "sourceAlias": self.source_alias, "viewSelection": views,
                             "sources": {alias: {"editionId": item["edition_id"],
                                 "rowCount": item["row_count"], "source": item["source"],
                                 "sourceReview": item.get("source_review"),
                                 "collections": item["collections"]}
                                 for alias, item in sorted(editions.items())}},
                "files": files,
                "archive": {key: archive[key] for key in ("name", "path", "bytes", "sha256")},
                "nativeIds": dict(self.state["nativeIds"])}
            if supplier is not None:
                result["supplier"] = supplier
            self.state.update(status=status, result=result)
            self._save()
            self._emit("COMPLETE", status=status, files=len(files), sourceRows=edition["row_count"])
            return result

    def receive(self, archive_path, sha256, destination, operation_id):
        _require(isinstance(sha256, str) and _HASH.fullmatch(sha256),
                 "WORKFLOW_RECEIVING_HASH_REQUIRED")
        _require(isinstance(operation_id, str) and _ID.fullmatch(operation_id),
                 "WORKFLOW_RECEIVING_OPERATION_REQUIRED")
        archive = _absolute(archive_path)
        destination = _absolute(destination)
        private_directory(destination.parent, create=True)
        return restore_archive(archive, destination, operation=operation_id, expected_sha256=sha256)
