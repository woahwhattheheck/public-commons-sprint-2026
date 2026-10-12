#!/usr/bin/env python3
"""RODA v2 staging and ingest client for an immutable research-transfer workspace.

Uses Python's standard library. The repository source contract is pinned in
RODA_REST.md. Every mutating HTTP request has a durable local dispatch marker;
a lost response is reconciled against the original resource/job.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import ssl
import stat
import sys
import tempfile
import time
import urllib.parse
import zipfile

SCHEMA = "stellar-forge.roda-client.v1"
HANDOFF_SCHEMA = "stellar-forge.roda-research-transfer.v1"
SOURCE_COMMIT = "668f61b2d7d3154cb6cc3220ff83cbbd7e206822"
TRANSFER_CLASS = "org.roda.core.data.v2.ip.TransferredResource"
AIP_CLASS = "org.roda.core.data.v2.ip.AIP"
BAGIT_PLUGIN = "org.roda.core.plugins.base.ingest.BagitToAIPPlugin"
INGEST_PLUGINS = {
    "org.roda.core.plugins.base.ingest.v2.ConfigurableIngestPlugin",
    "org.roda.core.plugins.base.ingest.v2.MinimalIngestPlugin",
}
# DefaultIngestPlugin mutates the submitted Job map during service validation.
# Worker-only job/lock/parent parameters are added to a copied map (JobsHelper).
DERIVED_JOB_PARAMETERS = {
    "parameter.total_steps", "parameter.create_submission", "parameter.reporting_class",
}
TERMINAL = {"COMPLETED", "FAILED_DURING_CREATION", "FAILED_TO_COMPLETE", "STOPPED", "REJECTED"}
PAUSED = {"PENDING_APPROVAL", "SCHEDULED"}
KNOWN_STATES = TERMINAL | PAUSED | {"CREATED", "STARTED", "STOPPING", "TO_BE_CLEANED"}
SAFE_HEADERS = {
    "content-type", "content-length", "content-disposition", "date", "etag",
    "last-modified", "retry-after", "location", "x-request-id", "x-correlation-id",
}
CHUNK = 256 * 1024
JSON_LIMIT = 16 * 1024 * 1024
HEX = re.compile(r"[0-9a-f]{64}\Z")
ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
SIMPLE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}\Z")


class RodaError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details

    def result(self):
        return {"schema": SCHEMA, "error": self.code, "message": str(self), **self.details}


def _fail(code, message, **details):
    raise RodaError(code, message, **details)


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode("utf-8")


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _object_pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            _fail("DUPLICATE_JSON_KEY", "A JSON object contains a duplicate key.", key=key)
        out[key] = value
    return out


def _parse(body):
    try:
        return json.loads(body.decode("utf-8"), object_pairs_hook=_object_pairs,
                          parse_constant=lambda _: _fail("INVALID_JSON", "Non-finite JSON number."))
    except (UnicodeError, ValueError, RecursionError) as exc:
        _fail("INVALID_JSON", "Expected a complete UTF-8 JSON document.", cause=type(exc).__name__)


def _private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path.absolute():
        _fail("UNSAFE_DIRECTORY", "Journal directories must be real local directories.", path=str(path))
    return path


def _fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _read(path, limit=JSON_LIMIT):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            _fail("INVALID_LOCAL_FILE", "Expected a bounded regular file.", path=str(path), limit=limit)
        chunks, size = [], 0
        while True:
            block = os.read(fd, min(CHUNK, limit + 1 - size))
            if not block:
                break
            chunks.append(block)
            size += len(block)
            if size > limit:
                _fail("LOCAL_FILE_TOO_LARGE", "Local file exceeded its declared limit.", path=str(path))
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            _fail("LOCAL_FILE_CHANGED", "Local file changed while it was read.", path=str(path))
        return b"".join(chunks)
    finally:
        os.close(fd)


def _read_json(path, limit=JSON_LIMIT):
    return _parse(_read(path, limit))


def _optional_json(path):
    try:
        return _read_json(path)
    except FileNotFoundError:
        return None


def _write(path, body, *, replace=False):
    """Publish complete bytes; exclusive publication never exposes a partial target."""
    path = Path(path)
    _private_directory(path.parent)
    fd, tmp = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", buffering=0) as stream:
            pending = memoryview(body)
            while pending:
                written = stream.write(pending)
                if not written:
                    raise OSError("Atomic file write made no progress")
                pending = pending[written:]
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(tmp, path)
        else:
            try:
                os.link(tmp, path, follow_symlinks=False)
            except FileExistsError:
                if _read(path, max(len(body), 1)) != body:
                    _fail("IMMUTABLE_RECORD_CONFLICT", "A saved immutable record has different bytes.", path=str(path))
        _fsync_directory(path.parent)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def _write_json(path, value, *, replace=False):
    _write(path, _json(value), replace=replace)


def _hash_file(path, *, expected=None):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            _fail("INVALID_TRANSFER_FILE", "The transfer must be a regular file.")
        digest, total = hashlib.sha256(), 0
        while True:
            block = os.read(fd, CHUNK)
            if not block:
                break
            digest.update(block)
            total += len(block)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            _fail("TRANSFER_CHANGED", "Transfer bytes changed while being hashed.")
        actual = {"bytes": total, "sha256": digest.hexdigest()}
        if expected and (actual["bytes"] != expected["bytes"] or actual["sha256"] != expected["sha256"]):
            _fail("TRANSFER_HASH_MISMATCH", "Transfer bytes differ from the immutable handoff.", actual=actual)
        return actual
    finally:
        os.close(fd)


def _relative(root, name):
    if not isinstance(name, str) or not name or "\\" in name:
        _fail("INVALID_RELATIVE_PATH", "Expected a nonempty relative POSIX path.")
    posix = PurePosixPath(name)
    if posix.is_absolute() or any(p in {"", ".", ".."} for p in name.split("/")):
        _fail("INVALID_RELATIVE_PATH", "Prepared paths must remain within the workspace.", path=name)
    path = root.joinpath(*posix.parts)
    if path.resolve() != path.absolute() or not path.is_relative_to(root):
        _fail("INVALID_RELATIVE_PATH", "Prepared files cannot traverse symbolic links.", path=name)
    return path


def _string(value, field, limit=1024):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        _fail("INVALID_FIELD", "Expected a nonempty bounded string without control characters.", field=field)
    return value


def _id(value, field):
    if not isinstance(value, str) or not SIMPLE_ID.fullmatch(value):
        _fail("INVALID_IDENTIFIER", "Invalid service identifier.", field=field)
    return value


def _integer(value, field, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        _fail("INVALID_FIELD", "Integer is outside the accepted range.", field=field, minimum=low, maximum=high)
    return value


def _base_url(value):
    _string(value, "baseUrl", 4096)
    url = urllib.parse.urlsplit(value)
    if (url.scheme not in {"https", "http"} or not url.hostname or url.username is not None
            or url.password is not None or url.query or url.fragment or "%" in url.netloc):
        _fail("INVALID_BASE_URL", "Use an absolute repository HTTP(S) URL without credentials, query or fragment.")
    try:
        _ = url.port
    except ValueError:
        _fail("INVALID_BASE_URL", "Repository port is invalid.")
    path = url.path.rstrip("/")
    if any(p in {".", ".."} for p in path.split("/")) or path.endswith("/api/v2"):
        _fail("INVALID_BASE_URL", "baseUrl is the application root, before /api/v2.")
    return urllib.parse.urlunsplit((url.scheme, url.netloc, path, "", ""))


def read_handoff(workspace):
    root = Path(workspace).resolve(strict=True)
    from roda import Error as PreparationError, verify_workspace
    try:
        verified_handoff = verify_workspace(root)
    except (PreparationError, zipfile.BadZipFile, UnicodeError, ValueError, KeyError, TypeError) as exc:
        _fail("PREPARED_WORKSPACE_INVALID", "The original producer rejected the prepared workspace.",
              cause=type(exc).__name__, reason=str(exc)[:2048])
    raw = _read(root / "handoff.json")
    handoff = _parse(raw)
    if handoff != verified_handoff:
        _fail("HANDOFF_CHANGED", "Prepared handoff changed after the original producer verification.")
    if not isinstance(handoff, dict) or handoff.get("schema") != HANDOFF_SCHEMA:
        _fail("INVALID_HANDOFF", "Expected the original prepared RODA research-transfer handoff.")
    if handoff.get("packageModel") != "one-bag-one-aip":
        _fail("INVALID_PACKAGE_MODEL", "This client receives one original bag as one AIP.")
    transfer = handoff.get("transfer")
    agreement = handoff.get("agreement")
    repository = handoff.get("repository")
    if not all(isinstance(v, dict) for v in (transfer, agreement, repository)):
        _fail("INVALID_HANDOFF", "Transfer, agreement and repository descriptors are required.")
    if transfer.get("path") != "transfer.zip" or not HEX.fullmatch(str(transfer.get("sha256", ""))):
        _fail("INVALID_HANDOFF", "The handoff must bind transfer.zip with SHA-256.")
    _integer(transfer.get("bytes"), "transfer.bytes", 1, 2**63 - 1)
    _string(transfer.get("bagId"), "transfer.bagId")
    _string(repository.get("name"), "repository.name")
    _base_url(repository.get("baseUrl"))
    if not isinstance(handoff.get("verification"), dict) or not handoff["verification"]:
        _fail("INVALID_HANDOFF", "The original full preservation verification must be retained.")
    if not HEX.fullmatch(str(agreement.get("sha256", ""))):
        _fail("INVALID_HANDOFF", "The agreement SHA-256 is required.")
    transfer_path = _relative(root, transfer["path"])
    _hash_file(transfer_path, expected=transfer)
    agreement_raw = _read(_relative(root, agreement.get("path")))
    if _sha(agreement_raw) != agreement["sha256"]:
        _fail("AGREEMENT_HASH_MISMATCH", "The prepared agreement differs from its handoff.")
    _parse(agreement_raw)
    return {"root": root, "handoff": handoff, "handoffSha256": _sha(raw),
            "transferPath": transfer_path, "agreementBytes": agreement_raw}


def _config(path):
    raw = _read(Path(path).resolve(strict=True), 1024 * 1024)
    value = _parse(raw)
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        _fail("INVALID_CONFIG", "Expected a RODA client configuration.")
    allowed = {"schema", "baseUrl", "repositoryUsername", "auth", "stagingParentUuid",
               "caFile", "timeoutSeconds", "maxResponseBytes", "reportPageSize", "maxPages", "allowHttp"}
    if set(value) - allowed:
        _fail("UNKNOWN_CONFIG_FIELD", "Configuration contains unknown fields.", fields=sorted(set(value) - allowed))
    out = {"schema": SCHEMA, "baseUrl": _base_url(value.get("baseUrl")),
           "repositoryUsername": _string(value.get("repositoryUsername"), "repositoryUsername", 255),
           "timeoutSeconds": _integer(value.get("timeoutSeconds", 120), "timeoutSeconds", 1, 3600),
           "maxResponseBytes": _integer(value.get("maxResponseBytes", JSON_LIMIT), "maxResponseBytes", 1024, 64 * 1024 * 1024),
           "reportPageSize": _integer(value.get("reportPageSize", 100), "reportPageSize", 1, 1000),
           "maxPages": _integer(value.get("maxPages", 1000), "maxPages", 1, 10000),
           "allowHttp": value.get("allowHttp", False)}
    if not isinstance(out["allowHttp"], bool):
        _fail("INVALID_CONFIG", "allowHttp must be a boolean.")
    if out["baseUrl"].startswith("http:") and not out["allowHttp"]:
        _fail("HTTP_NOT_SELECTED", "HTTP repositories require explicit allowHttp in the selected configuration.")
    auth = value.get("auth")
    if not isinstance(auth, dict):
        _fail("INVALID_CONFIG", "Choose HTTP basic or bearer authentication using environment references.")
    key = "tokenEnv" if auth.get("type") == "bearer" else "passwordEnv" if auth.get("type") == "basic" else None
    if key is None or set(auth) != {"type", key} or not isinstance(auth.get(key), str) or not ENV.fullmatch(auth[key]):
        _fail("INVALID_CONFIG", "Authentication must contain its type and one environment variable name.")
    out["auth"] = dict(auth)
    if value.get("stagingParentUuid") is not None:
        out["stagingParentUuid"] = _id(value["stagingParentUuid"], "stagingParentUuid")
    if value.get("caFile") is not None:
        ca = Path(value["caFile"]).expanduser().resolve(strict=True)
        out["caFile"] = str(ca)
        out["caSha256"] = _hash_file(ca)["sha256"]
    return out


def _template(path, handoff):
    raw = _read(Path(path).resolve(strict=True), 1024 * 1024)
    value = _parse(raw)
    required = {"name", "plugin", "pluginParameters", "priority", "parallelism"}
    if not isinstance(value, dict) or set(value) != required:
        _fail("INVALID_JOB_TEMPLATE", "Template must contain name, plugin, pluginParameters, priority and parallelism.")
    _string(value["name"], "job.name", 160)
    if value["plugin"] not in INGEST_PLUGINS:
        _fail("INVALID_INGEST_PLUGIN", "Select one of the reviewed RODA v2 ingest workflows.")
    parameters = value["pluginParameters"]
    if not isinstance(parameters, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parameters.items()):
        _fail("INVALID_JOB_TEMPLATE", "pluginParameters must be an exact string-to-string map.")
    if {"parameter.total_steps", "parameter.reporting_class"} & set(parameters):
        _fail("DERIVED_JOB_PARAMETER", "Leave total_steps and reporting_class to the original ingest implementation.")
    if ("parameter.create_submission" in parameters
            and parameters["parameter.create_submission"] not in {"true", "false"}):
        _fail("INVALID_JOB_TEMPLATE", "Explicit create_submission must be the original lowercase boolean string.")
    if parameters.get("parameter.sip_to_aip_class") != BAGIT_PLUGIN:
        _fail("WRONG_SIP_PARSER", "The reviewed transfer requires the original BagIt-to-AIP parser.")
    if value["priority"] not in {"URGENT", "HIGH", "MEDIUM", "LOW"} or value["parallelism"] not in {"LIMITED", "NORMAL"}:
        _fail("INVALID_JOB_TEMPLATE", "Invalid RODA priority or parallelism.")
    parent = handoff.get("collection", {}).get("parentAipId")
    selected = parameters.get("parameter.parent_id", "")
    if parent:
        if selected != parent or parameters.get("parameter.force_parent_id") != "true":
            _fail("COLLECTION_SCOPE_MISMATCH", "Template must force the exact parent AIP in the submission agreement.")
    elif selected:
        _fail("COLLECTION_SCOPE_MISMATCH", "Template parent must match the prepared agreement's collection scope.")
    return value, _sha(raw)


def _root_lock(root):
    @contextlib.contextmanager
    def acquire():
        path = root / "workspace.lock"
        fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                _fail("INVALID_WORKSPACE_LOCK", "Expected the original owned workspace lock.")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                _fail("WORKSPACE_BUSY", "The original workspace is in use by another operation.")
            yield
        finally:
            os.close(fd)
    return acquire()


def _error_class(status):
    if status == 401:
        return "AUTHENTICATION_FAILED"
    if status == 403:
        return "PERMISSION_DENIED"
    if status == 429:
        return "RATE_LIMITED"
    if status == 409:
        return "REMOTE_CONFLICT"
    if status == 404:
        return "REMOTE_NOT_FOUND"
    if 300 <= status < 400:
        return "REDIRECT_NOT_ACCEPTED"
    return "PROVIDER_REJECTED" if status < 500 else "PROVIDER_ERROR"


class _Client:
    """Caller holds the one original workspace.lock for this complete scope."""
    def __init__(self, workspace, config_file=None):
        self.inputs = read_handoff(workspace)
        self.root = self.inputs["root"]
        self.remote = self.root / "remote"
        self.config = _config(config_file) if config_file else None
        self.plan = _optional_json(self.remote / "plan.json")
        self.actor = None
        if self.plan is not None:
            self._validate_plan()

    def _validate_plan(self):
        plan = self.plan
        if (plan.get("schema") != "stellar-forge.roda-ingest-plan.v1"
                or plan.get("handoffSha256") != self.inputs["handoffSha256"]
                or plan.get("transfer") != self.inputs["handoff"]["transfer"]
                or plan.get("agreement") != self.inputs["handoff"]["agreement"]):
            _fail("PLAN_SOURCE_MISMATCH", "The saved remote operation is bound to a different prepared handoff.")
        if self.config is not None and self.config != plan.get("config"):
            _fail("CONFIGURATION_CHANGED", "Resume with the originally selected repository/account/configuration.")
        identity = {k: plan[k] for k in ("handoffSha256", "transfer", "agreement", "config", "jobTemplate")}
        if _sha(_json(identity)) != plan.get("operationId"):
            _fail("PLAN_IDENTITY_MISMATCH", "The original ingest-plan fingerprint is invalid.")
        if (plan.get("uploadName") != "sf88-" + plan["operationId"] + ".zip"
                or plan.get("jobName") != plan["jobTemplate"]["name"] + " [sf88:" + plan["operationId"] + "]"):
            _fail("PLAN_NAME_MISMATCH", "Saved remote names differ from the original operation identity.")

    def prepare(self, job_template_file=None):
        if self.config is None:
            _fail("CONFIG_REQUIRED", "A selected repository configuration is required.")
        if self.plan:
            if job_template_file:
                template, _ = _template(job_template_file, self.inputs["handoff"])
                if template != self.plan["jobTemplate"]:
                    _fail("JOB_TEMPLATE_CHANGED", "Resume with the exact original job template.")
            return self.local_status()
        if not job_template_file:
            _fail("JOB_TEMPLATE_REQUIRED", "Select the reviewed repository ingest job template.")
        if self.config["baseUrl"] != _base_url(self.inputs["handoff"]["repository"]["baseUrl"]):
            _fail("REPOSITORY_MISMATCH", "Configured repository differs from the submission agreement.")
        template, template_sha = _template(job_template_file, self.inputs["handoff"])
        identity = {"handoffSha256": self.inputs["handoffSha256"],
                    "transfer": self.inputs["handoff"]["transfer"],
                    "agreement": self.inputs["handoff"]["agreement"],
                    "config": self.config, "jobTemplate": template}
        operation_id = _sha(_json(identity))
        self.plan = {"schema": "stellar-forge.roda-ingest-plan.v1", **identity,
                     "operationId": operation_id, "preparedAt": _now(),
                     "jobTemplateSourceSha256": template_sha, "sourceCommit": SOURCE_COMMIT,
                     "uploadName": "sf88-" + operation_id + ".zip",
                     "jobName": template["name"] + " [sf88:" + operation_id + "]"}
        _private_directory(self.remote)
        _write_json(self.remote / "plan.json", self.plan)
        self._validate_plan()
        return self.local_status()

    def _require_plan(self):
        if not self.plan or not self.config:
            _fail("PLAN_REQUIRED", "Prepare the original handoff with its repository configuration and job template.")

    def _auth_header(self):
        auth = self.config["auth"]
        name = auth.get("tokenEnv", auth.get("passwordEnv"))
        secret = os.environ.get(name)
        if not secret or any(c in secret for c in "\r\n\x00"):
            _fail("CREDENTIAL_UNAVAILABLE", "The selected credential environment variable is unavailable.", variable=name)
        if auth["type"] == "bearer":
            return "Bearer " + secret
        user = self.config["repositoryUsername"]
        if ":" in user:
            _fail("INVALID_BASIC_USERNAME", "HTTP basic usernames cannot contain a colon.")
        return "Basic " + base64.b64encode((user + ":" + secret).encode("utf-8")).decode("ascii")

    def _exchange_dir(self, kind):
        base = _private_directory(self.remote / "exchanges")
        for number in range(1, 1000000):
            path = base / ("%06d-%s" % (number, kind))
            try:
                path.mkdir(mode=0o700)
                return path
            except FileExistsError:
                continue
        _fail("JOURNAL_LIMIT", "The response journal reached its supported entry count.")

    def _completed(self, directory):
        record = _optional_json(directory / "response.json")
        if record is None:
            return None
        request = _read(directory / "request.json")
        request_value = _parse(request)
        if (record.get("requestSha256") != _sha(request)
                or request_value.get("operationId") != self.plan["operationId"]):
            _fail("SAVED_RESPONSE_REQUEST_CHANGED", "Saved response no longer binds its original request.")
        if record.get("bodyReference") == "transfer.zip":
            actual = _hash_file(self.inputs["transferPath"], expected=self.plan["transfer"])
            if actual != {"sha256": record["bodySha256"], "bytes": record["bodyBytes"]}:
                _fail("SAVED_RESPONSE_CHANGED", "The retained staged-byte reference has changed.")
            return record, None
        body = _read(directory / "response.body", self.config["maxResponseBytes"])
        if _sha(body) != record.get("bodySha256") or len(body) != record.get("bodyBytes"):
            _fail("SAVED_RESPONSE_CHANGED", "A retained HTTP response has changed.", directory=str(directory))
        return record, body

    def _request(self, method, endpoint, *, body=None, multipart=False, mutation=False,
                 stage=None, expected=(200,), verify_transfer=False):
        self._require_plan()
        directory = _private_directory(self.remote / stage) if stage else self._exchange_dir("read")
        url = self.config["baseUrl"] + "/api/v2" + endpoint
        if not endpoint.startswith("/") or "#" in endpoint:
            _fail("INVALID_API_PATH", "Expected an original relative RODA API path.")
        boundary = "sf88-" + self.plan["operationId"]
        prefix, suffix = b"", b""
        if multipart:
            prefix = ('--' + boundary + '\r\nContent-Disposition: form-data; name="resource"; filename="' +
                      self.plan["uploadName"] + '"\r\nContent-Type: application/zip\r\n\r\n').encode("ascii")
            suffix = ("\r\n--" + boundary + "--\r\n").encode("ascii")
            length = len(prefix) + self.plan["transfer"]["bytes"] + len(suffix)
            content_type = "multipart/form-data; boundary=" + boundary
            descriptor = {"kind": "multipart/resource", "file": self.plan["transfer"],
                          "filename": self.plan["uploadName"], "prefixSha256": _sha(prefix),
                          "suffixSha256": _sha(suffix), "bytes": length}
        else:
            body = b"" if body is None else body
            length, content_type = len(body), "application/json"
            descriptor = {"kind": "bytes", "bytes": length, "sha256": _sha(body)}
        request = {"schema": "stellar-forge.roda-http-request.v1", "method": method, "url": url,
                   "mutation": mutation, "body": descriptor, "operationId": self.plan["operationId"],
                   "repositoryUsername": self.config["repositoryUsername"],
                   "authReference": self.config["auth"]}
        _write_json(directory / "request.json", request)
        if not multipart:
            _write(directory / "request.body", body)
        complete = self._completed(directory)
        if complete is not None:
            record, received = complete
            if record["status"] not in expected:
                _fail(_error_class(record["status"]), "The original repository request returned an error.",
                      status=record["status"], response=str(directory.relative_to(self.root)),
                      retryAfter=record["headers"].get("retry-after"))
            return record, received
        if mutation and (directory / "dispatch.json").exists():
            _fail("REMOTE_WRITE_UNCERTAIN", "Reconcile the original dispatched request before any further mutation.",
                  stage=stage, operationId=self.plan["operationId"])
        authorization = self._auth_header()
        target = urllib.parse.urlsplit(url)
        context = None
        if target.scheme == "https":
            if self.config.get("caFile"):
                if _hash_file(self.config["caFile"])["sha256"] != self.config["caSha256"]:
                    _fail("CA_SOURCE_CHANGED", "The selected repository CA file has changed.")
            context = ssl.create_default_context(cafile=self.config.get("caFile"))
        connection = (http.client.HTTPSConnection(target.hostname, target.port, timeout=self.config["timeoutSeconds"], context=context)
                      if context else http.client.HTTPConnection(target.hostname, target.port, timeout=self.config["timeoutSeconds"]))
        deadline = time.monotonic() + self.config["timeoutSeconds"]
        phase = "CONNECT"
        def remaining():
            value = deadline - time.monotonic()
            if value <= 0:
                raise TimeoutError("RODA request deadline elapsed")
            if connection.sock is not None:
                connection.sock.settimeout(value)
        try:
            connection.connect()
            remaining()
            phase = "DISPATCH"
            _write_json(directory / "dispatch.json", {"requestSha256": _sha(_json(request)),
                        "dispatchedAt": _now(), "mutation": mutation})
            path = urllib.parse.urlunsplit(("", "", target.path, target.query, ""))
            connection.putrequest(method, path, skip_accept_encoding=True)
            connection.putheader("Authorization", authorization)
            connection.putheader("Accept", "application/octet-stream" if verify_transfer else "application/json")
            connection.putheader("Accept-Encoding", "identity")
            if method != "GET":
                connection.putheader("Content-Type", content_type)
                connection.putheader("Content-Length", str(length))
            connection.endheaders()
            if multipart:
                connection.send(prefix)
                fd = os.open(self.inputs["transferPath"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                try:
                    digest, count = hashlib.sha256(), 0
                    while True:
                        remaining()
                        chunk = os.read(fd, CHUNK)
                        if not chunk:
                            break
                        count += len(chunk)
                        digest.update(chunk)
                        connection.send(chunk)
                    if count != self.plan["transfer"]["bytes"] or digest.hexdigest() != self.plan["transfer"]["sha256"]:
                        _fail("TRANSFER_CHANGED_DURING_UPLOAD", "Uploaded source no longer matches the prepared transfer.")
                finally:
                    os.close(fd)
                remaining()
                connection.send(suffix)
            elif body:
                for offset in range(0, len(body), CHUNK):
                    remaining()
                    connection.send(body[offset:offset + CHUNK])
            remaining()
            phase = "RESPONSE"
            response = connection.getresponse()
            headers = {k.lower(): v for k, v in response.getheaders() if k.lower() in SAFE_HEADERS}
            response_head = {"schema": "stellar-forge.roda-http-response.v1", "status": response.status,
                             "headers": headers, "receivedAt": _now(), "requestSha256": _sha(_json(request))}
            _write_json(directory / "response-head.json", response_head)
            limit = self.plan["transfer"]["bytes"] if verify_transfer and response.status == 200 else self.config["maxResponseBytes"]
            chunks, digest, count = [], hashlib.sha256(), 0
            while True:
                remaining()
                block = response.read(min(CHUNK, limit + 1 - count))
                if not block:
                    break
                count += len(block)
                digest.update(block)
                if count > limit:
                    _fail("RESPONSE_TOO_LARGE", "Repository response exceeded its selected receiving limit.", limit=limit)
                if not (verify_transfer and response.status == 200):
                    chunks.append(block)
            declared = headers.get("content-length")
            if declared is not None and (not declared.isdigit() or int(declared) != count):
                _fail("HTTP_BODY_INCOMPLETE", "Repository response length does not match Content-Length.")
            record = {**response_head, "bodySha256": digest.hexdigest(), "bodyBytes": count,
                      "completedAt": _now()}
            received = None if verify_transfer and response.status == 200 else b"".join(chunks)
            if received is None:
                if count != self.plan["transfer"]["bytes"] or digest.hexdigest() != self.plan["transfer"]["sha256"]:
                    _write_json(directory / "verification-mismatch.json", record)
                    _fail("STAGED_BYTES_MISMATCH", "The staged resource is not the original complete transfer.",
                          actualSha256=digest.hexdigest(), actualBytes=count)
                record["bodyReference"] = "transfer.zip"
            else:
                if endpoint == "/members/users/authenticated" and response.status == 200:
                    user = _parse(received)
                    if not isinstance(user, dict):
                        _fail("INVALID_ACCOUNT_RESPONSE", "Expected the original authenticated-user object.")
                    record["providerBodySha256"] = record["bodySha256"]
                    record["providerBodyBytes"] = record["bodyBytes"]
                    record["retainedBodyKind"] = "authenticated-user-identity-projection"
                    received = _json({key: user.get(key) for key in ("id", "uuid", "name", "active", "guest", "type")})
                    record["bodySha256"], record["bodyBytes"] = _sha(received), len(received)
                _write(directory / "response.body", received)
            _write_json(directory / "response.json", record)
            if response.status not in expected:
                _fail(_error_class(response.status), "Repository returned an error.",
                      status=response.status, response=str(directory.relative_to(self.root)),
                      retryAfter=headers.get("retry-after"))
            return record, received
        except BaseException as exc:
            try:
                _write_json(directory / ("error-" + str(time.time_ns()) + ".json"),
                            {"at": _now(), "phase": phase, "kind": type(exc).__name__,
                             "code": exc.code if isinstance(exc, RodaError) else "HTTP_TRANSPORT_FAILED",
                             "mutationDispatched": mutation and (directory / "dispatch.json").exists()})
            except OSError:
                pass
            if isinstance(exc, (RodaError, KeyboardInterrupt, SystemExit)):
                raise
            _fail("HTTP_TRANSPORT_FAILED", "Repository transport did not produce a complete saved response.",
                  phase=phase, cause=type(exc).__name__,
                  mutationDispatched=mutation and (directory / "dispatch.json").exists())
        finally:
            connection.close()

    def _api(self, method, endpoint, *, value=None, stage=None, mutation=False, expected=(200,)):
        _, body = self._request(method, endpoint, body=_json(value) if value is not None else None,
                                mutation=mutation, stage=stage, expected=expected)
        value = _parse(body)
        if not isinstance(value, dict):
            _fail("INVALID_API_OBJECT", "The original RODA endpoint must return a JSON object.")
        return value

    def authenticate(self):
        if self.actor is not None:
            return {"username": self.actor}
        user = self._api("GET", "/members/users/authenticated")
        if (not isinstance(user, dict) or user.get("name") != self.config["repositoryUsername"]
                or user.get("guest") is True or user.get("active") is False):
            _fail("AUTHENTICATED_ACTOR_MISMATCH", "The repository authenticated a different or inactive user.")
        self.actor = user["name"]
        return {"username": user["name"], "id": user.get("id"), "uuid": user.get("uuid")}

    def _find(self, resource, filters):
        offset, seen, rows, totals = 0, set(), [], []
        limit = self.config["reportPageSize"]
        for _ in range(self.config["maxPages"]):
            result = self._api("POST", "/" + resource + "/find", value={
                "filter": {"parameters": [{"@type": "SimpleFilterParameter", "name": key, "value": value}
                                           for key, value in filters]},
                "onlyActive": False, "sorter": {"parameters": [{"name": "uuid", "descending": False}]},
                "sublist": {"firstElementIndex": offset, "maximumElementCount": limit}})
            if not isinstance(result, dict) or not isinstance(result.get("results"), list):
                _fail("INVALID_INDEX_RESPONSE", "Expected the original RODA IndexResult.")
            batch = result["results"]
            total = result.get("totalCount")
            if isinstance(total, bool) or not isinstance(total, int) or total < 0:
                _fail("INVALID_INDEX_RESPONSE", "IndexResult must include its nonnegative totalCount.")
            if result.get("offset", offset) != offset:
                _fail("INDEX_OFFSET_MISMATCH", "Repository returned a different search page offset.")
            totals.append(total)
            for row in batch:
                if not isinstance(row, dict):
                    _fail("INVALID_INDEX_RESPONSE", "Index rows must be objects.")
                identity = row.get("uuid") or row.get("id")
                if not identity or identity in seen:
                    _fail("INDEX_PAGE_OVERLAP", "Search pages overlap or omit an object identifier.")
                seen.add(identity)
                rows.append(row)
            offset += len(batch)
            if offset >= total:
                if any(x != total for x in totals):
                    _fail("INDEX_CHANGED_DURING_READ", "Repository index changed while this recovery was paged.")
                return rows
            if not batch:
                _fail("INCOMPLETE_INDEX_RESPONSE", "Index pagination ended before its reported total.")
        _fail("INDEX_PAGE_LIMIT", "Continue reconciliation with an appropriate configured pagination limit.")

    def _validate_transfer(self, resource, *, job_move=False):
        if not isinstance(resource, dict):
            _fail("INVALID_TRANSFER_RESPONSE", "Expected the original transferred resource.")
        _id(resource.get("uuid"), "transfer.uuid")
        if resource.get("name") != self.plan["uploadName"] or resource.get("file") is not True:
            _fail("TRANSFER_IDENTITY_MISMATCH", "Staged resource is not this operation's selected ZIP.")
        if resource.get("size") != self.plan["transfer"]["bytes"]:
            _fail("STAGED_SIZE_MISMATCH", "Staged ZIP length differs from the original transfer.")
        parent = resource.get("parentUUID") or None
        if not job_move and parent != self.config.get("stagingParentUuid"):
            _fail("STAGING_PARENT_MISMATCH", "Staged resource belongs to a different parent.")
        return resource

    def _accept_transfer(self, resource, source):
        resource = self._validate_transfer(resource)
        uuid = resource["uuid"]
        record, _ = self._request("GET", "/transfers/" + urllib.parse.quote(uuid, safe="") + "/download",
                                  verify_transfer=True)
        accepted = {"schema": "stellar-forge.roda-upload-accepted.v1", "operationId": self.plan["operationId"],
                    "uuid": uuid, "name": resource["name"], "relativePath": resource.get("relativePath"),
                    "parentUUID": resource.get("parentUUID"), "bytes": self.plan["transfer"]["bytes"],
                    "sha256": self.plan["transfer"]["sha256"], "source": source,
                    "download": {"bodySha256": record["bodySha256"], "bodyBytes": record["bodyBytes"]}}
        _write_json(self.remote / "upload" / "accepted.json", accepted)
        return accepted

    def _recover_upload(self, transfer_uuid=None):
        accepted = _optional_json(self.remote / "upload" / "accepted.json")
        if accepted:
            if (accepted.get("operationId") != self.plan["operationId"]
                    or accepted.get("sha256") != self.plan["transfer"]["sha256"]
                    or accepted.get("bytes") != self.plan["transfer"]["bytes"]):
                _fail("SAVED_UPLOAD_BINDING_CHANGED", "Saved upload does not match the original operation.")
            if transfer_uuid is not None and transfer_uuid != accepted["uuid"]:
                _fail("TRANSFER_SELECTION_CONFLICT", "This operation already selected another transferred UUID.")
            return accepted
        if transfer_uuid is not None:
            resource = self._api("GET", "/transfers/" + urllib.parse.quote(_id(transfer_uuid, "transferUuid"), safe=""))
            return self._accept_transfer(resource, "operator-selected-original-uuid")
        response = self._completed(self.remote / "upload")
        if response and response[0]["status"] == 201:
            return self._accept_transfer(_parse(response[1]), "original-upload-response")
        if not (self.remote / "upload" / "dispatch.json").exists():
            return None
        filters = [("name", self.plan["uploadName"])]
        if self.config.get("stagingParentUuid"):
            filters.append(("parentUUID", self.config["stagingParentUuid"]))
        found = self._find("transfers", filters)
        found = [r for r in found if r.get("name") == self.plan["uploadName"]
                 and (r.get("parentUUID") or None) == self.config.get("stagingParentUuid")]
        if len(found) > 1:
            _fail("MULTIPLE_UPLOAD_MATCHES", "More than one staged resource matches the original upload identity.")
        if found:
            return self._accept_transfer(found[0], "original-upload-index-reconciliation")
        return None

    def upload(self):
        self._require_plan()
        self.authenticate()
        existing = self._recover_upload()
        if existing:
            return self.local_status()
        if (self.remote / "upload" / "dispatch.json").exists():
            _fail("UPLOAD_UNRESOLVED", "The original upload was dispatched but its complete resource is not yet discoverable.",
                  operationId=self.plan["operationId"], uploadName=self.plan["uploadName"])
        if self.config.get("stagingParentUuid"):
            parent = self._api("GET", "/transfers/" + urllib.parse.quote(self.config["stagingParentUuid"], safe=""))
            if parent.get("uuid") != self.config["stagingParentUuid"] or parent.get("file") is not False:
                _fail("INVALID_STAGING_PARENT", "Configured staging parent must be the selected existing folder.")
        query = {"commit": "true"}
        if self.config.get("stagingParentUuid"):
            query["parent-uuid"] = self.config["stagingParentUuid"]
        _, body = self._request("POST", "/transfers/create/resource?" + urllib.parse.urlencode(query),
                                 multipart=True, mutation=True, stage="upload", expected=(201,))
        self._accept_transfer(_parse(body), "original-upload-response")
        return self.local_status()

    def _job_request(self, accepted):
        value = dict(self.plan["jobTemplate"])
        value["pluginParameters"] = dict(value["pluginParameters"])
        value["name"] = self.plan["jobName"]
        value["sourceObjects"] = {"@type": "SelectedItemsListRequest", "ids": [accepted["uuid"]]}
        value["sourceObjectsClass"] = TRANSFER_CLASS
        return value

    def _job_model(self, job_id):
        job_id = _id(job_id, "job.id")
        job = self._api("GET", "/jobs/" + urllib.parse.quote(job_id, safe=""))
        if job.get("id") != job_id:
            _fail("JOB_IDENTITY_MISMATCH", "Repository returned a different full job model.")
        return job

    def _job_parameters(self, job, request):
        requested, effective = request["pluginParameters"], job.get("pluginParameters")
        if not isinstance(effective, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in effective.items()):
            _fail("INVALID_JOB_PARAMETERS", "The full job must retain its string-to-string parameter map.")
        for key, value in requested.items():
            if effective.get(key) != value:
                _fail("JOB_PARAMETER_MISMATCH", "A requested ingest parameter changed.", field=key)
        unexpected = set(effective) - set(requested) - DERIVED_JOB_PARAMETERS
        if unexpected:
            _fail("UNREVIEWED_JOB_PARAMETERS", "The job contains additional parameters outside the reviewed server contract.",
                  fields=sorted(unexpected))
        maximum = 5 if request["plugin"].endswith(".MinimalIngestPlugin") else 11
        steps = effective.get("parameter.total_steps")
        if (not isinstance(steps, str) or not re.fullmatch(r"[1-9][0-9]*", steps)
                or not 1 <= int(steps) <= maximum):
            _fail("INVALID_DERIVED_JOB_PARAMETER", "The original effective ingest-step count is invalid.",
                  field="parameter.total_steps")
        if effective.get("parameter.create_submission") not in {"true", "false"}:
            _fail("INVALID_DERIVED_JOB_PARAMETER", "The repository submission setting must be a lowercase boolean.",
                  field="parameter.create_submission")
        if effective.get("parameter.reporting_class") != request["plugin"]:
            _fail("INVALID_DERIVED_JOB_PARAMETER", "The report class must be the selected concrete ingest plugin.",
                  field="parameter.reporting_class")
        return {"requestedSha256": _sha(_json(requested)), "effectiveSha256": _sha(_json(effective)),
                "derivedParameters": {key: effective[key] for key in sorted(set(effective) - set(requested))},
                "sourceCommit": SOURCE_COMMIT}

    def _source_identity(self, job, request, current_uuid):
        upload = _optional_json(self.remote / "upload" / "accepted.json")
        if (not upload or upload.get("operationId") != self.plan["operationId"]
                or upload.get("uuid") != request["sourceObjects"]["ids"][0]
                or upload.get("sha256") != self.plan["transfer"]["sha256"]
                or upload.get("bytes") != self.plan["transfer"]["bytes"]):
            _fail("SAVED_UPLOAD_BINDING_CHANGED", "Job source requires the original verified upload.")
        return {"schema": "stellar-forge.roda-job-source-binding.v1",
                "operationId": self.plan["operationId"], "jobId": job["id"],
                "requestSha256": _sha(_json(request)), "originalUuid": request["sourceObjects"]["ids"][0],
                "originalRelativePath": upload.get("relativePath"),
                "currentUuid": _id(current_uuid, "job.sourceUuid"),
                "name": self.plan["uploadName"], "bytes": self.plan["transfer"]["bytes"],
                "sha256": self.plan["transfer"]["sha256"]}

    def _read_source_binding(self, path, job, request):
        value = _read_json(path)
        if not isinstance(value, dict):
            _fail("JOB_SOURCE_BINDING_CHANGED", "Saved source movement must be an object.")
        identity = self._source_identity(job, request, value.get("currentUuid"))
        if any(value.get(key) != expected for key, expected in identity.items()):
            _fail("JOB_SOURCE_BINDING_CHANGED", "Saved movement is not bound to this job and original transfer.")
        canonical = {key: item for key, item in value.items() if key != "bindingSha256"}
        if value.get("bindingSha256") != _sha(_json(canonical)):
            _fail("JOB_SOURCE_BINDING_CHANGED", "The original saved movement bytes have changed.")
        if path.name != _sha(_json(identity)) + ".json" or value.get("kind") != "SAME_JOB_MOVED_SOURCE":
            _fail("JOB_SOURCE_BINDING_CHANGED", "Saved movement identity differs from its immutable file.")
        resource, download = value.get("resource"), value.get("download")
        self._validate_transfer(resource, job_move=True)
        if (resource.get("uuid") != identity["currentUuid"] or not isinstance(download, dict)
                or download.get("bodySha256") != identity["sha256"]
                or download.get("bodyBytes") != identity["bytes"] or download.get("status") != 200):
            _fail("JOB_SOURCE_BINDING_CHANGED", "Saved moved-source verification differs from the original transfer.")
        return value

    def _job_source(self, job, request):
        source = job.get("sourceObjects")
        if (not isinstance(source, dict) or source.get("type") != "list"
                or not isinstance(source.get("ids"), list) or len(source["ids"]) != 1
                or source.get("selectedClass") != TRANSFER_CLASS):
            _fail("JOB_SOURCE_MISMATCH", "The full job must select one transferred-resource source.")
        current_uuid = _id(source["ids"][0], "job.sourceUuid")
        identity = self._source_identity(job, request, current_uuid)
        if current_uuid == identity["originalUuid"]:
            return {**identity, "kind": "ORIGINAL_UPLOAD"}
        path = self.remote / "job" / "source-moves" / (_sha(_json(identity)) + ".json")
        if path.exists():
            return self._read_source_binding(path, job, request)
        # The original autoaccept workflow can move a SIP and rewrite the job
        # and report source UUID. Bind that observation to this same job plus
        # its actual unchanged ZIP; never replace the original upload record.
        try:
            resource = self._validate_transfer(
                self._api("GET", "/transfers/" + urllib.parse.quote(current_uuid, safe="")), job_move=True)
            if resource["uuid"] != current_uuid:
                _fail("JOB_SOURCE_MISMATCH", "Repository returned a different moved source.")
            download, _ = self._request(
                "GET", "/transfers/" + urllib.parse.quote(current_uuid, safe="") + "/download",
                verify_transfer=True)
        except RodaError as exc:
            if exc.code != "REMOTE_NOT_FOUND":
                raise
            _fail("JOB_SOURCE_MOVE_UNRESOLVED", "The job's current source is not yet retrievable; reopen this same job.",
                  jobId=job["id"], originalTransferUuid=identity["originalUuid"],
                  currentTransferUuid=current_uuid, response=exc.details.get("response"))
        value = {**identity, "kind": "SAME_JOB_MOVED_SOURCE", "observedAt": _now(),
                 "jobSourceObjects": source, "resource": resource, "download": download,
                 "basis": "same-job-selected-source-and-original-complete-zip",
                 "sourceCommit": SOURCE_COMMIT}
        value["bindingSha256"] = _sha(_json(value))
        _write_json(path, value)
        return self._read_source_binding(path, job, request)

    def _known_job_sources(self, job, request):
        current = self._job_source(job, request)
        known = {current["originalUuid"], current["currentUuid"]}
        directory = self.remote / "job" / "source-moves"
        if directory.exists():
            paths = sorted(directory.iterdir())
            if len(paths) > 10000:
                _fail("JOB_SOURCE_HISTORY_LIMIT", "Source movement history exceeds the receiving limit.")
            for path in paths:
                # Ignore the original writer's unpublished .write-* files.
                if path.name.startswith(".write-"):
                    continue
                if path.suffix != ".json":
                    _fail("JOB_SOURCE_BINDING_CHANGED", "Unexpected file in source movement history.")
                known.add(self._read_source_binding(path, job, request)["currentUuid"])
        return current, known

    def _validate_job(self, job, request):
        if not isinstance(job, dict):
            _fail("INVALID_JOB_RESPONSE", "Expected the full original RODA job model.")
        _id(job.get("id"), "job.id")
        for key in ("name", "plugin", "priority", "parallelism"):
            if job.get(key) != request[key]:
                _fail("JOB_IDENTITY_MISMATCH", "Job model differs from the original submitted request.", field=key)
        if job.get("username") != self.config["repositoryUsername"]:
            _fail("JOB_ACTOR_MISMATCH", "Job belongs to a different repository user.")
        self._job_parameters(job, request)
        self._job_source(job, request)
        if job.get("state") not in KNOWN_STATES:
            _fail("UNKNOWN_JOB_STATE", "The repository returned an unknown job state.", state=job.get("state"))
        return job

    def _accept_job(self, job, request, source):
        job = self._validate_job(job, request)
        value = {"schema": "stellar-forge.roda-job-accepted.v1", "operationId": self.plan["operationId"],
                 "jobId": job["id"], "requestSha256": _sha(_json(request)),
                 "transferUuid": request["sourceObjects"]["ids"][0], "source": source,
                 "parameters": self._job_parameters(job, request),
                 "acceptedSource": self._job_source(job, request)}
        _write_json(self.remote / "job" / "accepted.json", value)
        return value

    def _recover_job(self, accepted_upload, job_id=None):
        request = self._job_request(accepted_upload)
        accepted = _optional_json(self.remote / "job" / "accepted.json")
        if accepted:
            if (accepted.get("operationId") != self.plan["operationId"]
                    or accepted.get("requestSha256") != _sha(_json(request))
                    or accepted.get("transferUuid") != accepted_upload["uuid"]):
                _fail("SAVED_JOB_BINDING_CHANGED", "Saved job does not match its original request.")
            if job_id is not None and job_id != accepted["jobId"]:
                _fail("JOB_SELECTION_CONFLICT", "This operation has already selected another job.")
            return accepted
        if job_id is not None:
            job = self._job_model(job_id)
            return self._accept_job(job, request, "operator-selected-original-job")
        response = self._completed(self.remote / "job")
        if response and response[0]["status"] == 201:
            job = _parse(response[1])
            # Reopen the full model even when an ingress proxy returned a projection.
            job = self._job_model(job.get("id"))
            return self._accept_job(job, request, "original-create-response")
        candidates = self._find("jobs", [("name", self.plan["jobName"]),
                                         ("username", self.config["repositoryUsername"])])
        candidates = [r for r in candidates if r.get("name") == self.plan["jobName"]
                      and r.get("username") == self.config["repositoryUsername"]]
        if len(candidates) > 1:
            _fail("MULTIPLE_JOB_MATCHES", "More than one job carries the immutable original operation marker.",
                  jobIds=[r.get("id") for r in candidates])
        if candidates:
            job = self._job_model(candidates[0].get("id"))
            return self._accept_job(job, request, "original-create-index-reconciliation")
        return None

    def submit(self):
        self._require_plan()
        self.authenticate()
        upload = self._recover_upload()
        if upload is None:
            _fail("VERIFIED_UPLOAD_REQUIRED", "The original complete staged bytes must be verified before ingest.")
        existing = self._recover_job(upload)
        if existing:
            return self.local_status()
        if (self.remote / "job" / "dispatch.json").exists():
            _fail("JOB_CREATION_UNRESOLVED", "The original create request is retained; reconcile its job before another submission.",
                  operationId=self.plan["operationId"], jobName=self.plan["jobName"])
        # Verify current staging bytes just before the one job submission.
        resource = self._api("GET", "/transfers/" + urllib.parse.quote(upload["uuid"], safe=""))
        self._validate_transfer(resource)
        self._request("GET", "/transfers/" + urllib.parse.quote(upload["uuid"], safe="") + "/download",
                      verify_transfer=True)
        request = self._job_request(upload)
        _write_json(self.remote / "job" / "create-request.json", request)
        job = self._api("POST", "/jobs", value=request, mutation=True, stage="job", expected=(201,))
        model = self._job_model(job.get("id"))
        self._accept_job(model, request, "original-create-response")
        return self.local_status()

    def _reports(self, job_id):
        reports, seen, start = [], set(), 0
        limit = self.config["reportPageSize"]
        for _ in range(self.config["maxPages"]):
            result = self._api("GET", "/jobs/" + urllib.parse.quote(job_id, safe="") + "/reports?" +
                               urllib.parse.urlencode({"job-just-failed": "false", "start": start, "limit": limit}))
            batch = result.get("reports") if isinstance(result, dict) else None
            if not isinstance(batch, list):
                _fail("INVALID_REPORTS_RESPONSE", "Expected the original RODA Reports object.")
            for indexed in batch:
                if not isinstance(indexed, dict):
                    _fail("INVALID_REPORTS_RESPONSE", "Each indexed report must be an original object.")
                report_id = _id(indexed.get("id"), "report.id")
                if report_id in seen:
                    _fail("REPORT_PAGE_OVERLAP", "Report pagination returned a repeated original report.")
                seen.add(report_id)
                model = self._api("GET", "/jobs/" + urllib.parse.quote(job_id, safe="") +
                                  "/report/" + urllib.parse.quote(report_id, safe=""))
                if model.get("id") != report_id or model.get("jobId") != job_id:
                    _fail("REPORT_JOB_MISMATCH", "Report model does not belong to the selected original job.")
                reports.append(model)
            start += len(batch)
            if len(batch) < limit:
                return reports
        _fail("REPORT_PAGE_LIMIT", "Report enumeration reached the selected page limit before completion.")

    def _outcome(self, job, reports, upload):
        stats = job.get("jobStats")
        if not isinstance(stats, dict):
            _fail("JOB_STATS_MISSING", "The full job model must retain its per-object counters.")
        source_binding, source_ids = self._known_job_sources(job, self._job_request(upload))
        report_rows, aip_ids, failures = [], set(), []
        def visit(report, depth=0):
            if depth > 32 or len(report_rows) >= 100000:
                _fail("REPORT_NESTING_LIMIT", "Report structure exceeds the supported receiving bound.")
            if not isinstance(report, dict):
                _fail("INVALID_REPORT", "Nested report must be an object.")
            if report.get("jobId") not in {None, job["id"]}:
                _fail("REPORT_JOB_MISMATCH", "Nested report belongs to another job.")
            source_id = report.get("sourceObjectId")
            row = {k: report.get(k) for k in ("id", "jobId", "sourceObjectId", "sourceObjectClass",
                                              "outcomeObjectId", "outcomeObjectClass", "outcomeObjectState",
                                              "plugin", "pluginState", "pluginIsMandatory", "pluginDetails")}
            report_rows.append(row)
            if row["pluginState"] in {"FAILURE", "PARTIAL_SUCCESS"}:
                failures.append(row)
            if (source_id in source_ids and row["sourceObjectClass"] == TRANSFER_CLASS
                    and row["outcomeObjectId"] not in {None, "", "NO_OUTCOME_ID"}
                    and row["outcomeObjectClass"] in {AIP_CLASS, "org.roda.core.data.v2.ip.IndexedAIP"}):
                aip_ids.add(_id(row["outcomeObjectId"], "outcomeObjectId"))
            children = report.get("reports", [])
            if children is not None:
                if not isinstance(children, list):
                    _fail("INVALID_REPORT", "Nested reports must be a list.")
                for child in children:
                    visit(child, depth + 1)
        for report in reports:
            visit(report)
        aips, unresolved_aips = [], []
        for aip_id in sorted(aip_ids):
            try:
                aip = self._api("GET", "/aips/" + urllib.parse.quote(aip_id, safe=""))
            except RodaError as exc:
                if exc.code != "REMOTE_NOT_FOUND":
                    raise
                unresolved_aips.append({"id": aip_id, "state": "NOT_YET_RETRIEVABLE",
                                        "response": exc.details.get("response")})
                continue
            if aip.get("id") != aip_id:
                _fail("AIP_IDENTITY_MISMATCH", "Repository returned a different result AIP.")
            parent = self.inputs["handoff"].get("collection", {}).get("parentAipId")
            if (aip.get("parentId") or "") != (parent or ""):
                _fail("AIP_COLLECTION_MISMATCH", "Result AIP is outside the reviewed parent collection.")
            aips.append(aip)
        state = job["state"]
        status = "INGEST_RUNNING"
        if state in PAUSED:
            status = "JOB_" + state
        elif state in TERMINAL - {"COMPLETED"}:
            status = "JOB_" + state
        elif state == "COMPLETED":
            counts = {key: stats.get(key) for key in (
                "sourceObjectsCount", "sourceObjectsBeingProcessed", "sourceObjectsWaitingToBeProcessed",
                "sourceObjectsProcessedWithSuccess", "sourceObjectsProcessedWithPartialSuccess", "sourceObjectsProcessedWithFailure",
                "sourceObjectsProcessedWithSkipped", "outcomeObjectsWithManualIntervention")}
            if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in counts.values()):
                _fail("JOB_STATS_INCOMPLETE", "Completed job counters are incomplete or invalid.")
            if (counts["sourceObjectsCount"] != 1 or not reports or len(aips) != 1 or unresolved_aips
                    or counts["sourceObjectsBeingProcessed"] or counts["sourceObjectsWaitingToBeProcessed"]):
                status = "INGEST_RESULT_INCOMPLETE"
            elif (failures or counts["sourceObjectsProcessedWithFailure"]
                  or counts["sourceObjectsProcessedWithPartialSuccess"]
                  or counts["sourceObjectsProcessedWithSkipped"]):
                status = "INGEST_REVIEW_REQUIRED"
            elif (counts["outcomeObjectsWithManualIntervention"]
                  or aips[0].get("state") == "UNDER_APPRAISAL"):
                status = "AIP_UNDER_APPRAISAL"
            elif counts["sourceObjectsProcessedWithSuccess"] == 1 and aips[0].get("state") == "ACTIVE":
                status = "INGESTED_ACTIVE"
            else:
                status = "AIP_" + str(aips[0].get("state", "UNKNOWN"))
        return {"schema": "stellar-forge.roda-ingest-observation.v1",
                "operationId": self.plan["operationId"], "observedAt": _now(), "status": status,
                "jobId": job["id"], "jobState": state, "jobStats": stats, "job": job,
                "uploadUuid": upload["uuid"], "currentTransferUuid": source_binding["currentUuid"],
                "sourceBinding": source_binding, "verifiedSourceUuids": sorted(source_ids),
                "jobParameters": self._job_parameters(job, self._job_request(upload)),
                "reports": reports, "reportRows": report_rows,
                "aips": aips, "unresolvedAips": unresolved_aips, "resultAipIds": sorted(aip_ids),
                "reportPaginationComplete": True, "packageModel": "one-bag-one-aip"}

    def reconcile(self, *, transfer_uuid=None, job_id=None, poll_seconds=0, interval_seconds=5):
        self._require_plan()
        self.authenticate()
        if not isinstance(poll_seconds, (int, float)) or not 0 <= poll_seconds <= 86400:
            _fail("INVALID_POLL_TIMEOUT", "poll_seconds must be between zero and 86400.")
        if not isinstance(interval_seconds, (int, float)) or not 1 <= interval_seconds <= 3600:
            _fail("INVALID_POLL_INTERVAL", "interval_seconds must be between one and 3600.")
        upload = self._recover_upload(transfer_uuid)
        if upload is None:
            result = {**self.local_status(), "status": "UPLOAD_UNRESOLVED" if (self.remote / "upload" / "dispatch.json").exists() else "PREPARED"}
            return result
        accepted = self._recover_job(upload, job_id)
        if accepted is None:
            return {**self.local_status(), "status": "JOB_CREATION_UNRESOLVED" if (self.remote / "job" / "dispatch.json").exists() else "UPLOADED_VERIFIED"}
        request = self._job_request(upload)
        deadline = time.monotonic() + poll_seconds
        while True:
            job = self._validate_job(self._job_model(accepted["jobId"]), request)
            if job["state"] in TERMINAL | PAUSED or time.monotonic() >= deadline:
                break
            time.sleep(min(interval_seconds, max(0, deadline - time.monotonic())))
        reports = self._reports(job["id"])
        latest = self._validate_job(self._job_model(job["id"]), request)
        observation = self._outcome(latest, reports, upload)
        if (latest["state"] != job["state"] or latest.get("jobStats") != job.get("jobStats")
                or latest.get("endDate") != job.get("endDate")
                or latest.get("sourceObjects") != job.get("sourceObjects")):
            observation["status"] = "JOB_CHANGED_DURING_RECONCILIATION"
            observation["reportPaginationComplete"] = False
        path = self.remote / "observations" / (_sha(_json(observation)) + ".json")
        _write_json(path, observation)
        _write_json(self.remote / "latest.json", {"path": str(path.relative_to(self.remote)),
                    "sha256": _sha(_json(observation)), "operationId": self.plan["operationId"]}, replace=True)
        return self.local_status()

    def local_status(self):
        if self.plan is None:
            return {"schema": SCHEMA, "status": "HANDOFF_VERIFIED", "handoffSha256": self.inputs["handoffSha256"]}
        upload = _optional_json(self.remote / "upload" / "accepted.json")
        job = _optional_json(self.remote / "job" / "accepted.json")
        if upload:
            if (upload.get("operationId") != self.plan["operationId"]
                    or upload.get("sha256") != self.plan["transfer"]["sha256"]
                    or upload.get("bytes") != self.plan["transfer"]["bytes"]
                    or upload.get("name") != self.plan["uploadName"]
                    or (upload.get("parentUUID") or None) != self.plan["config"].get("stagingParentUuid")):
                _fail("SAVED_UPLOAD_BINDING_CHANGED", "Saved upload does not match the original plan.")
            _id(upload.get("uuid"), "transfer.uuid")
        if job:
            if (not upload or job.get("operationId") != self.plan["operationId"]
                    or job.get("requestSha256") != _sha(_json(self._job_request(upload)))
                    or job.get("transferUuid") != upload["uuid"]):
                _fail("SAVED_JOB_BINDING_CHANGED", "Saved job does not match the original upload and request.")
            _id(job.get("jobId"), "job.id")
        state = ("JOB_ACCEPTED" if job else "JOB_CREATION_UNRESOLVED" if (self.remote / "job" / "dispatch.json").exists()
                 else "UPLOADED_VERIFIED" if upload else "UPLOAD_UNRESOLVED" if (self.remote / "upload" / "dispatch.json").exists()
                 else "PREPARED")
        result = {"schema": SCHEMA, "status": state, "operationId": self.plan["operationId"],
                  "repository": self.plan["config"]["baseUrl"],
                  "repositoryUsername": self.plan["config"]["repositoryUsername"],
                  "handoffSha256": self.plan["handoffSha256"], "uploadName": self.plan["uploadName"],
                  "jobName": self.plan["jobName"], "transferUuid": upload.get("uuid") if upload else None,
                  "jobId": job.get("jobId") if job else None}
        pointer = _optional_json(self.remote / "latest.json")
        if pointer:
            raw = _read(_relative(self.remote, pointer["path"]), JSON_LIMIT * 4)
            if _sha(raw) != pointer.get("sha256"):
                _fail("OBSERVATION_HASH_MISMATCH", "The saved latest observation has changed.")
            value = _parse(raw)
            if value.get("operationId") != self.plan["operationId"]:
                _fail("OBSERVATION_OPERATION_MISMATCH", "Saved observation belongs to a different original operation.")
            result.update({k: value.get(k) for k in ("status", "jobState", "jobStats", "resultAipIds", "currentTransferUuid",
                                                   "reportPaginationComplete", "observedAt")})
            result["observation"] = "remote/" + pointer["path"]
        return result


def _operate(workspace, config_file, callback):
    root = Path(workspace).resolve(strict=True)
    with _root_lock(root):
        return callback(_Client(root, config_file))


def plan(workspace, config_file, job_template_file):
    return _operate(workspace, config_file, lambda c: c.prepare(job_template_file))


def upload(workspace, config_file):
    return _operate(workspace, config_file, lambda c: c.upload())


def submit(workspace, config_file):
    return _operate(workspace, config_file, lambda c: c.submit())


def reconcile(workspace, config_file, *, transfer_uuid=None, job_id=None, poll_seconds=0, interval_seconds=5):
    return _operate(workspace, config_file, lambda c: c.reconcile(
        transfer_uuid=transfer_uuid, job_id=job_id, poll_seconds=poll_seconds, interval_seconds=interval_seconds))


def status(workspace):
    return _operate(workspace, None, lambda c: c.local_status())


def run(workspace, config_file, job_template_file=None, poll_seconds=0):
    def work(client):
        client.prepare(job_template_file)
        client.upload()
        client.submit()
        return client.reconcile(poll_seconds=poll_seconds)
    return _operate(workspace, config_file, work)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "upload", "submit", "reconcile", "run", "status"])
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--config")
    parser.add_argument("--job-template")
    parser.add_argument("--transfer-uuid")
    parser.add_argument("--job-id")
    parser.add_argument("--poll-seconds", type=float, default=0)
    parser.add_argument("--interval-seconds", type=float, default=5)
    args = parser.parse_args(argv)
    if args.command != "status" and not args.config:
        parser.error("--config is required for repository operations")
    if args.command == "plan" and not args.job_template:
        parser.error("--job-template is required for plan")
    if args.command != "reconcile" and (args.transfer_uuid or args.job_id):
        parser.error("--transfer-uuid and --job-id select existing records only during reconcile")
    try:
        if args.command == "plan":
            result = plan(args.workspace, args.config, args.job_template)
        elif args.command == "upload":
            result = upload(args.workspace, args.config)
        elif args.command == "submit":
            result = submit(args.workspace, args.config)
        elif args.command == "run":
            result = run(args.workspace, args.config, args.job_template, args.poll_seconds)
        elif args.command == "reconcile":
            result = reconcile(args.workspace, args.config, transfer_uuid=args.transfer_uuid,
                               job_id=args.job_id, poll_seconds=args.poll_seconds,
                               interval_seconds=args.interval_seconds)
        else:
            result = status(args.workspace)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    except RodaError as exc:
        print(json.dumps(exc.result(), ensure_ascii=False, sort_keys=True, indent=2), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(json.dumps({"schema": SCHEMA, "error": "INTERRUPTED",
                          "message": "Reopen the same workspace to reconcile the retained request."}), file=sys.stderr)
        return 130
    except OSError as exc:
        print(json.dumps({"schema": SCHEMA, "error": "LOCAL_IO_ERROR",
                          "cause": type(exc).__name__, "errno": exc.errno,
                          "message": "The original journal remains the continuation source."}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
