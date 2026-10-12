#!/usr/bin/env python3
"""Retained Preservica OPEX upload and complete source-linked repository receiving.

Uses the documented Preservica access-token header and S3-compatible upload API.
No tenant is created, no credentials are stored, and uncertain uploads are not
silently replaced. See PRESERVICA_PROVIDER_CONTRACT.md for source/version scope.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
import email.utils
import fcntl
import hashlib
import html
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
import tempfile
import urllib.parse as url
import uuid
import xml.etree.ElementTree as ET
from collections import Counter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preservation as p
import preservica as q

SCHEMA = "stellar-forge.preservica-operation.v1"
CONFIGURATION_SCHEMA = "stellar-forge.preservica-configuration.v1"
EVIDENCE_SCHEMA = "stellar-forge.preservica-original-upload-evidence.v1"
S3_NS = "http://s3.amazonaws.com/doc/2006-03-01/"
STATUS_NS = "http://status.preservica.com"
CHUNK = 256 * 1024
MAX_STATE = 16 * 1024 * 1024
API_SOURCE = {
    "upload": "https://developers.preservica.com/api-reference/3-upload-content-s3-compatible",
    "opex": "https://developers.preservica.com/documentation/open-preservation-exchange-opex",
    "progress": "https://developers.preservica.com/api-reference/4-progress-token-api",
    "monitor": "https://developers.preservica.com/api-reference/5-process-monitoring-api",
    "entityImplementation": "https://github.com/carj/pyPreservica/blob/5a53e7e219ac16d28a5c77640518a596c0e8c088/pyPreservica/entityAPI.py",
    "monitorImplementation": "https://github.com/carj/pyPreservica/blob/5a53e7e219ac16d28a5c77640518a596c0e8c088/pyPreservica/monitorAPI.py",
}
PROGRESS = {"ABORTED", "ACTIVE", "COMPLETED", "PENDING", "SUSPENDING",
            "SUSPENDED", "UNKNOWN", "FAILED", "FINISHED_MIXED_OUTCOME", "CANCELLED"}
ACTIVE = {"ACTIVE", "PENDING", "SUSPENDING", "SUSPENDED", "UNKNOWN"}
FAILED = {"ABORTED", "FAILED", "FINISHED_MIXED_OUTCOME", "CANCELLED"}
PATHS = {"SO": "structural-objects", "IO": "information-objects", "CO": "content-objects"}
SAFE_QUERY = {"start", "max", "type", "value", "monitor", "status", "category",
              "uploadId", "partNumber", "uploads"}
SECRET_HEADERS = {"authorization", "proxy-authorization", "cookie", "set-cookie",
                  "preservica-access-token", "x-amz-security-token"}
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+")


class Error(ValueError):
    pass


class Stop(Exception):
    def __init__(self, state, code, *, retry_at=None):
        super().__init__(code)
        self.state, self.code, self.retry_at = state, code, retry_at


class Unresolved(Exception):
    def __init__(self, code, *, details=None):
        super().__init__(code)
        self.code, self.details = code, details or {}


def clone(value):
    return p.parse_json(p.canonical(value))


def digest(value):
    return p.digest(p.canonical(value))


def require(condition, message):
    if not condition:
        raise Error(message)


def version(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", value),
            "Select an explicit Preservica major.minor version")
    result = ".".join(str(int(x)) for x in value.split(".")[:2])
    require(tuple(map(int, result.split("."))) >= (6, 2), "The OPEX ZIP profile requires version 6.2 or later")
    return result


def reference(value, label="reference", *, nullable=False):
    if value is None and nullable:
        return None
    try:
        require(isinstance(value, str), "Enter a UUID " + label)
        result = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise Error("Enter a UUID " + label)
    return result


def operation_id(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", value)
            and value not in {".", ".."}, "Use a stable operation ID of at most 120 safe characters")
    return value


def configuration_template():
    return {"schema": CONFIGURATION_SCHEMA, "origin": "https://YOUR-TENANT.preservica.com",
            "tenant": "YOUR_TENANT", "targetVersion": "9.3",
            "accessTokenEnv": "PRESERVICA_ACCESS_TOKEN", "parentRef": None,
            "uploadMode": "auto", "partBytes": 8 * 1024 * 1024,
            "requestTimeoutSeconds": 60, "maxResponseBytes": 8 * 1024 * 1024,
            "readbackBatchSize": 25}


def validate_configuration(configuration):
    require(isinstance(configuration, dict), "Configuration must be an object")
    template = configuration_template()
    require(not (set(configuration) - set(template)), "Unknown Preservica configuration field")
    required = {"origin", "tenant", "targetVersion", "accessTokenEnv", "parentRef"}
    require(required.issubset(configuration), "Select origin, tenant, version, token environment name and parentRef")
    result = {**template, **configuration}
    require(result["schema"] == CONFIGURATION_SCHEMA, "Unsupported configuration schema")
    raw = result["origin"]
    require(isinstance(raw, str) and len(raw) <= 2048 and not any(ord(c) < 33 for c in raw),
            "Select one HTTPS API origin")
    parsed = url.urlsplit(raw)
    try:
        port = parsed.port
    except ValueError:
        raise Error("Invalid API origin port")
    loopback = parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    require(parsed.scheme == "https" or (parsed.scheme == "http" and loopback),
            "HTTPS is required except for an explicit local receiving service")
    require(parsed.hostname and not parsed.username and not parsed.password
            and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment,
            "Origin cannot contain credentials, a path, query or fragment")
    host = parsed.hostname.lower()
    require(not host.endswith(".") and re.fullmatch(r"[A-Za-z0-9.:-]+", host), "Invalid API origin hostname")
    if ":" in host:
        host = "[" + host + "]"
    result["origin"] = parsed.scheme + "://" + host + (":" + str(port) if port else "")
    require(isinstance(result["tenant"], str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,119}", result["tenant"]),
            "Enter the existing tenant identifier")
    require(result["tenant"] != "YOUR_TENANT" and "YOUR-TENANT" not in raw.upper(),
            "Replace the configuration template with the selected existing tenant")
    result["targetVersion"] = version(result["targetVersion"])
    name = result["accessTokenEnv"]
    require(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", name),
            "Use an environment variable name; never paste an access token")
    result["parentRef"] = reference(result["parentRef"], "parentRef", nullable=True)
    require(result["uploadMode"] in {"auto", "single", "multipart"}, "Unknown upload mode")
    bounds = {"partBytes": (5 * 1024 * 1024, 128 * 1024 * 1024),
              "requestTimeoutSeconds": (1, 300), "maxResponseBytes": (65536, 64 * 1024 * 1024),
              "readbackBatchSize": (1, 250)}
    for key, (low, high) in bounds.items():
        value = result[key]
        require(isinstance(value, int) and not isinstance(value, bool) and low <= value <= high,
                key + " is outside the supported range")
    return clone(result)


def _cancelled(cancelled):
    if cancelled is None:
        return
    stopped = cancelled() if callable(cancelled) else (
        cancelled.is_set() if hasattr(cancelled, "is_set") else bool(cancelled))
    if stopped:
        raise Stop("INTERRUPTED", "CANCELLED_BETWEEN_REQUESTS")


def _stamp(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _xml(raw):
    require(isinstance(raw, bytes), "Expected retained XML bytes")
    require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper(),
            "DTD/entity declarations are not accepted")
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        raise Unresolved("INVALID_XML_RESPONSE")


def _local(element):
    return element.tag.rsplit("}", 1)[-1] if isinstance(element.tag, str) else ""


def _text(element, name, namespace=None):
    if namespace:
        candidates = element.findall(".//{" + namespace + "}" + name)
        if element.tag == "{" + namespace + "}" + name:
            candidates = [element] + candidates
    else:
        candidates = [x for x in element.iter() if _local(x) == name]
    values = ["".join(x.itertext()) for x in candidates]
    if len(values) > 1 and len(set(values)) != 1:
        raise Unresolved("AMBIGUOUS_RESPONSE_FIELD", details={"field": name})
    return values[0] if values else None


def _retry_at(value):
    now = dt.datetime.now(dt.timezone.utc)
    try:
        if re.fullmatch(r"[0-9]+", value or ""):
            return (now + dt.timedelta(seconds=min(int(value), 86400 * 30))).isoformat().replace("+00:00", "Z")
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return max(now, parsed.astimezone(dt.timezone.utc)).isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError):
        return (now + dt.timedelta(seconds=60)).isoformat().replace("+00:00", "Z")


def _future(value):
    if not value:
        return False
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc)
    except (ValueError, TypeError):
        raise Error("Invalid retained retry timestamp")


def _safe_url(value, origin):
    try:
        parsed = url.urlsplit(html.unescape(value))
        if parsed.scheme not in {"http", "https"}:
            return value
        host = parsed.hostname or ""
        if ":" in host:
            host = "[" + host + "]"
        authority = host + (":" + str(parsed.port) if parsed.port else "")
        actual_origin = parsed.scheme + "://" + authority
        if actual_origin == origin:
            pairs = url.parse_qsl(parsed.query, keep_blank_values=True)
            query = url.urlencode([(k, v if k in SAFE_QUERY else "[REDACTED]") for k, v in pairs])
        else:
            query = "REDACTED_QUERY" if parsed.query else ""
        return url.urlunsplit((parsed.scheme, authority, parsed.path, query, ""))
    except (ValueError, TypeError):
        return "[UNUSABLE_PROVIDER_URL]"


def _safe_text(value, origin, token=None):
    if token:
        value = value.replace(token, "[REDACTED_ACCESS_TOKEN]")
    def replace_url(match):
        original = match.group(0)
        changed = _safe_url(original, origin)
        return changed.replace("&", "&amp;") if "&amp;" in original else changed
    return URL_PATTERN.sub(replace_url, value)


def _safe_value(value, origin, token=None):
    if isinstance(value, str):
        return _safe_text(value, origin, token)
    if isinstance(value, list):
        return [_safe_value(item, origin, token) for item in value]
    if isinstance(value, dict):
        return {key: _safe_value(item, origin, token) for key, item in value.items()}
    return value


def _safe_body(raw, origin, token=None):
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw, False
    replaced = _safe_text(text, origin, token)
    return (raw, False) if replaced == text else (replaced.encode("utf-8"), True)


def _safe_headers(headers, origin, token=None):
    result = {}
    for key, value in headers:
        name = key.lower()
        if name in SECRET_HEADERS:
            continue
        safe = _safe_text(value, origin, token)
        if name in result and result[name] != safe:
            result[name] = result[name] + ", " + safe
        else:
            result[name] = safe
    return result


def _atomic_json(path, value):
    p.replace_bytes(path, p.canonical(value))


def _new_json(path, value):
    data = p.canonical(value)
    if path.exists():
        require(p.read_regular(path.parent, path.name, MAX_STATE) == data, "Immutable journal entry changed")
    else:
        p.write_new(path, data)


@contextlib.contextmanager
def _operation_lock(directory):
    fd = os.open(directory / "operation.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "Operation lock is not a regular file")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Error("This original operation is already active")
        yield
    finally:
        os.close(fd)


def _load(root, relative, limit=MAX_STATE):
    return p.parse_json(p.read_regular(root, relative, limit))


def _binding(root, handoff):
    return {"id": handoff["id"], "handoff": q.file_digest(root / "handoff.json"),
            "manifest": q.file_digest(root / "MANIFEST.json"),
            "transfer": clone(handoff["transfer"]), "source": clone(handoff["source"]),
            "packageSourceId": handoff["packageSourceId"],
            "recordsFolderSourceId": handoff["recordsFolderSourceId"],
            "includedRecords": handoff["counts"]["includedRecords"]}


def _read_state(directory, planned):
    pointer = _load(directory, "current.json")
    require(pointer.get("schema") == SCHEMA + ".current", "Unsupported operation state pointer")
    relative = pointer.get("path")
    require(isinstance(relative, str) and re.fullmatch(r"states/[0-9]{8}-[0-9a-f]{64}\.json", relative),
            "Invalid operation state path")
    raw = p.read_regular(directory, relative, MAX_STATE)
    require(p.digest(raw) == pointer.get("sha256") and len(raw) == pointer.get("bytes"),
            "Operation state bytes changed")
    state = p.parse_json(raw)
    require(state.get("schema") == SCHEMA + ".state" and state.get("planSha256") == digest(planned)
            and state.get("operationId") == planned["operationId"], "Operation state belongs to another plan")
    require(state.get("revision") == pointer.get("revision"), "Operation state revision changed")
    return state


def _save_state(root, directory, planned, state):
    with p.project_lock(root):
        prior = _read_state(directory, planned) if (directory / "current.json").exists() else None
        if prior:
            require(state["revision"] == prior["revision"], "Original operation state changed concurrently")
        else:
            require(state["revision"] == -1, "Initial operation state is not empty")
        state["previousStateSha256"] = digest(prior) if prior else None
        state["revision"] += 1
        state["updatedAt"] = p.utc()
        raw = p.canonical(state)
        require(len(raw) <= MAX_STATE, "Operation state exceeded its retained byte limit")
        relative = "states/" + format(state["revision"], "08d") + "-" + p.digest(raw) + ".json"
        p.write_new(directory / relative, raw)
        _atomic_json(directory / "current.json", {"schema": SCHEMA + ".current", "path": relative,
            "bytes": len(raw), "sha256": p.digest(raw), "revision": state["revision"]})


def plan(package_workspace, configuration, operation_id):
    config = validate_configuration(configuration)
    identifier = globals()["operation_id"](operation_id)
    root = Path(package_workspace).absolute()
    handoff = q.verify_workspace(root)
    selected = handoff["settings"].get("targetPreservicaVersion")
    if selected is not None:
        require(version(selected) == config["targetVersion"], "Package and client select different target versions")
    bound = _binding(root, handoff)
    object_key = "commons-" + identifier + "-" + bound["transfer"]["sha256"][:24] + ".zip"
    mode = config["uploadMode"]
    if mode == "auto":
        mode = "single" if bound["transfer"]["bytes"] <= config["partBytes"] else "multipart"
    stable = {"schema": SCHEMA + ".plan", "operationId": identifier, "configuration": config,
              "configurationSha256": digest(config), "package": bound,
              "bucket": config["tenant"].lower() + ".package.upload", "key": object_key,
              "mode": mode, "apiSources": API_SOURCE}
    with p.project_lock(root):
        remote = root / "remote"
        require(not remote.is_symlink(), "Remote journal cannot be a symlink")
        remote.mkdir(mode=0o700, exist_ok=True)
        directory = remote / identifier
        require(not directory.is_symlink(), "Operation cannot be a symlink")
        directory.mkdir(mode=0o700, exist_ok=True)
        if (directory / "plan.json").exists():
            old = _load(directory, "plan.json")
            require(old == stable, "This operation ID already belongs to a different original plan")
        else:
            p.write_new(directory / "plan.json", p.canonical(stable))
        if (directory / "current.json").exists():
            _read_state(directory, stable)
            return show(root, identifier)
        initial = {"schema": SCHEMA + ".state", "operationId": identifier, "planSha256": digest(stable),
            "revision": -1, "state": "PLANNED", "createdAt": p.utc(), "updatedAt": None,
            "retryAt": None, "lastIssue": None, "actions": {},
            "transfer": {"key": object_key, "bucket": stable["bucket"], "mode": mode,
                         "uploadId": None, "parts": {}, "progressToken": None, "submitted": False},
            "ingest": {"status": None, "processId": None, "processStatus": None},
            "readback": {"totalRecords": bound["includedRecords"], "verifiedRecords": 0,
                         "unresolvedRecords": bound["includedRecords"], "records": {},
                         "folders": {}, "lastObservedAt": None},
            "events": []}
        # Publish initial state under this already-held ordinary workspace lock.
        initial["revision"] = 0
        initial["previousStateSha256"] = None
        initial["updatedAt"] = p.utc()
        raw = p.canonical(initial)
        relative = "states/00000000-" + p.digest(raw) + ".json"
        if not (directory / relative).exists():
            p.write_new(directory / relative, raw)
        _atomic_json(directory / "current.json", {"schema": SCHEMA + ".current", "path": relative,
            "bytes": len(raw), "sha256": p.digest(raw), "revision": 0})
    return show(root, identifier)


def _planned(root, identifier):
    identifier = operation_id(identifier)
    directory = root / "remote" / identifier
    require(directory.is_dir() and not directory.is_symlink(), "Open the original saved upload operation")
    planned = _load(directory, "plan.json")
    require(planned.get("schema") == SCHEMA + ".plan" and planned.get("operationId") == identifier,
            "Unsupported saved upload plan")
    config = validate_configuration(planned["configuration"])
    require(config == planned["configuration"] and digest(config) == planned.get("configurationSha256"),
            "Saved configuration changed")
    return directory, planned


def _summary(root, directory, planned, state):
    rb = state["readback"]
    records = sorted(rb["records"].values(), key=lambda x: x["identifier"])
    next_actions = []
    if state["state"] == "PLANNED":
        next_actions.append("run")
    if state["state"] == "AUTH_REQUIRED":
        next_actions.append("Supply a fresh token in " + planned["configuration"]["accessTokenEnv"] + "; run or refresh")
    if state["state"] == "UPLOAD_UNCERTAIN":
        next_actions.append("Refresh original progress/source readback or reconcile an original upload response")
    if state["state"] not in {"VERIFIED", "PLANNED"}:
        next_actions.append("refresh")
    return {"schema": SCHEMA + ".status", "operationId": planned["operationId"],
            "state": state["state"], "revision": state["revision"], "updatedAt": state["updatedAt"],
            "configuration": clone(planned["configuration"]), "package": clone(planned["package"]),
            "transfer": clone(state["transfer"]), "ingest": clone(state["ingest"]),
            "target": clone(state.get("target")),
            "readback": {**clone(rb), "records": records},
            "nextActions": next_actions, "retryAt": state.get("retryAt"),
            "lastIssue": clone(state.get("lastIssue")), "events": clone(state.get("events", [])),
            "actions": clone(state.get("actions", {})),
            "scope": "Verified records describe retained receiving observations, not continuous repository monitoring."}


def show(package_workspace, operation_id=None):
    root = Path(package_workspace).absolute()
    if operation_id is None:
        remote = root / "remote"
        if not remote.exists():
            return {"schema": SCHEMA + ".operations", "operations": []}
        require(remote.is_dir() and not remote.is_symlink(), "Invalid remote operation directory")
        results = []
        for directory in sorted(remote.iterdir()):
            if directory.is_dir() and not directory.is_symlink() and (directory / "plan.json").exists():
                results.append(show(root, directory.name))
        return {"schema": SCHEMA + ".operations", "operations": results}
    directory, planned = _planned(root, operation_id)
    # Atomic current.json plus immutable state: no network or writer lock.
    state = _read_state(directory, planned)
    return _summary(root, directory, planned, state)


class Slice:
    def __init__(self, path, expected, offset=0, length=None, expected_stamp=None):
        self.path, self.expected = Path(path), expected
        self.offset = offset
        self.length = expected["bytes"] - offset if length is None else length
        require(0 <= offset <= expected["bytes"] and 0 <= self.length <= expected["bytes"] - offset,
                "Invalid original upload byte range")
        self.fd = os.open(self.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            self.before = os.fstat(self.fd)
            require(stat.S_ISREG(self.before.st_mode) and self.before.st_size == expected["bytes"],
                    "Original transfer file changed")
            if expected_stamp is not None:
                require(_stamp(self.before) == expected_stamp, "Upload file changed after source verification")
            self.sha256 = self._range_hash()
            if self.offset == 0 and self.length == expected["bytes"]:
                require(self.sha256 == expected["sha256"], "Original upload bytes differ from the saved package")
        except BaseException:
            os.close(self.fd)
            raise

    def _range_hash(self):
        value, position, remaining = hashlib.sha256(), self.offset, self.length
        while remaining:
            block = os.pread(self.fd, min(CHUNK, remaining), position)
            require(bool(block), "Original transfer ended before its declared size")
            value.update(block)
            position += len(block)
            remaining -= len(block)
        self.check()
        return value.hexdigest()

    def check(self):
        require(_stamp(os.fstat(self.fd)) == _stamp(self.before), "Original transfer changed during use")

    def blocks(self, cancelled):
        remaining, position = self.length, self.offset
        while remaining:
            _cancelled(cancelled)
            block = os.pread(self.fd, min(CHUNK, remaining), position)
            require(bool(block), "Original upload source ended early")
            yield block
            position += len(block)
            remaining -= len(block)
        self.check()

    def close(self):
        os.close(self.fd)


class Context:
    def __init__(self, root, identifier, cancelled=None):
        self.root, self.cancelled = Path(root).absolute(), cancelled
        self.directory, self.planned = _planned(self.root, identifier)
        self.handoff = q.verify_workspace(self.root)
        require(_binding(self.root, self.handoff) == self.planned["package"], "Saved plan source package changed")
        self.config = self.planned["configuration"]
        self.catalog = q.json_member(self.root, "catalog.json")
        self.state = _read_state(self.directory, self.planned)
        self.origin = self.config["origin"]
        self.version = self.config["targetVersion"]
        self.entity_ns = "http://preservica.com/EntityAPI/v" + self.version
        self.xip_ns = "http://preservica.com/XIP/v" + self.version
        self.trace = []
        self.transfer = self.handoff["transfer"]
        source_path = self.root / self.transfer["path"]
        before = source_path.stat()
        require(q.file_digest(source_path) == {
            "bytes": self.transfer["bytes"], "sha256": self.transfer["sha256"]},
            "Original upload archive changed")
        require(_stamp(before) == _stamp(source_path.stat()), "Original archive changed during verification")
        self.source_stamp = _stamp(before)
        require(self.planned["bucket"] == self.config["tenant"].lower() + ".package.upload",
                "Original upload bucket changed")
        require(self.planned["key"] == "commons-" + self.planned["operationId"] + "-"
                + self.transfer["sha256"][:24] + ".zip", "Original object key changed")

    def publish(self):
        _save_state(self.root, self.directory, self.planned, self.state)

    def note(self, kind, **details):
        self.state["events"].append({"at": p.utc(), "kind": kind, **clone(details)})
        self.state["events"] = self.state["events"][-200:]

    def finish(self, state, code=None, retry_at=None):
        self.state["state"] = state
        self.state["retryAt"] = retry_at
        self.state["lastIssue"] = {"code": code, "at": p.utc()} if code else None
        self.publish()

    def api_url(self, value, *, endpoint=None):
        require(isinstance(value, str) and value, "Missing provider API URL")
        absolute = url.urljoin(self.origin + "/", value)
        parsed = url.urlsplit(absolute)
        base = url.urlsplit(self.origin)
        require((parsed.scheme, parsed.hostname, parsed.port) == (base.scheme, base.hostname, base.port)
                and not parsed.username and not parsed.password and not parsed.fragment,
                "Provider API link left the selected authenticated origin")
        require(parsed.path.startswith("/api/") and "\\" not in parsed.path
                and not any(part in {".", ".."} for part in url.unquote(parsed.path).split("/")),
                "Provider API link left the supported API path")
        if endpoint is not None:
            require(parsed.path == endpoint, "Provider pagination changed the original endpoint")
        for name, _ in url.parse_qsl(parsed.query, keep_blank_values=True):
            require(name in SAFE_QUERY, "Provider API link contains an unsupported query field")
        return absolute

    def path(self, name, query=None):
        return name + ("?" + url.urlencode(query) if query else "")

    def object_path(self, query=None):
        name = "/api/s3/buckets/" + url.quote(self.planned["bucket"], safe="") + "/" + url.quote(self.planned["key"], safe="")
        return self.path(name, query)

    def _new_request(self, request):
        with p.project_lock(self.root):
            parent = self.directory / "http"
            parent.mkdir(exist_ok=True, mode=0o700)
            require(not parent.is_symlink(), "HTTP journal cannot be a symlink")
            numbers = [int(x.name.split("-", 1)[0]) for x in parent.iterdir()
                       if x.is_dir() and re.fullmatch(r"[0-9]{8}-[0-9a-f]{16}", x.name)]
            number = max(numbers, default=0) + 1
            require(number < 100000000, "HTTP journal exhausted")
            name = format(number, "08d") + "-" + digest(request)[:16]
            directory = parent / name
            directory.mkdir(mode=0o700)
            p.write_new(directory / "request.json", p.canonical(request))
            p.fsync_dir(parent)
        return directory

    def _save_response(self, directory, receipt, retained):
        with p.project_lock(self.root):
            if retained is not None:
                p.write_new(directory / "response.body", retained)
            p.write_new(directory / "response.json", p.canonical(receipt))
        entry = {"request": directory.relative_to(self.directory).as_posix() + "/request.json",
                 "response": directory.relative_to(self.directory).as_posix() + "/response.json",
                 "requestSha256": receipt["requestSha256"], "responseSha256": digest(receipt)}
        self.trace.append(entry)
        return entry

    def request(self, method, target, *, data=None, headers=None, action=None, download=None, external=False):
        _cancelled(self.cancelled)
        if _future(self.state.get("retryAt")):
            raise Stop("COOLDOWN", "RETAINED_RETRY_AFTER", retry_at=self.state["retryAt"])
        absolute = self.api_url(target) if not external else target
        parsed = url.urlsplit(absolute)
        require(parsed.scheme == "https" or (parsed.scheme == "http" and
                parsed.hostname in {"127.0.0.1", "::1", "localhost"}), "Unsafe content download transport")
        require(not parsed.username and not parsed.password and not parsed.fragment, "Invalid content download URL")
        authenticated = not external
        token = os.environ.get(self.config["accessTokenEnv"]) if authenticated else None
        if authenticated and (not isinstance(token, str) or not token or any(ord(c) < 33 for c in token)):
            raise Stop("AUTH_REQUIRED", "ACCESS_TOKEN_ENVIRONMENT_MISSING")
        safe_headers = dict(headers or {})
        require(not (set(k.lower() for k in safe_headers) & SECRET_HEADERS), "Credentials are not caller headers")
        if isinstance(data, Slice):
            body = {"kind": "original-transfer-range", "path": self.transfer["path"],
                    "transferSha256": self.transfer["sha256"], "offset": data.offset,
                    "bytes": data.length, "sha256": data.sha256}
            length = data.length
        elif data is not None:
            require(isinstance(data, bytes), "Request body must be exact bytes")
            body, length = {"kind": "bytes", "bytes": len(data), "sha256": p.digest(data)}, len(data)
        else:
            body, length = None, 0
        request = {"schema": SCHEMA + ".http-request", "operationId": self.planned["operationId"],
                   "method": method, "url": _safe_url(absolute, self.origin),
                   "urlSha256": p.digest(absolute.encode("utf-8")), "headers": safe_headers,
                   "body": body, "action": action, "createdAt": p.utc(),
                   "authentication": "selected-environment-reference" if authenticated else "none",
                   "downloadExpected": clone(download)}
        directory = self._new_request(request)
        if data is not None and not isinstance(data, Slice):
            with p.project_lock(self.root):
                p.write_new(directory / "request.body", data)
        if action:
            previous = self.state["actions"].get(action)
            attempts = list(previous.get("attempts", [])) if previous else []
            attempts.append(directory.relative_to(self.directory).as_posix())
            self.state["actions"][action] = {"state": "DISPATCHED", "attempts": attempts,
                "request": attempts[-1], "requestSha256": digest(request), "result": None}
            self.state["state"] = "UPLOADING"
            self.state["lastIssue"] = None
            self.publish()
        connection = None
        response, status_code, response_headers = None, None, []
        sent, complete, raw, total, source_sha = False, False, bytearray(), 0, hashlib.sha256()
        error = None
        try:
            constructor = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
            options = {"timeout": self.config["requestTimeoutSeconds"]}
            if parsed.scheme == "https":
                options["context"] = ssl.create_default_context()
            connection = constructor(parsed.hostname, parsed.port, **options)
            path = url.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
            connection.putrequest(method, path, skip_accept_encoding=True)
            connection.putheader("User-Agent", "Commons-Preservica-Receiving/1")
            connection.putheader("Accept", "*/*")
            connection.putheader("Connection", "close")
            if authenticated:
                connection.putheader("Preservica-Access-Token", token)
            for name, value in safe_headers.items():
                require(isinstance(name, str) and isinstance(value, str)
                        and not any(c in name + value for c in "\r\n"), "Invalid outgoing header")
                connection.putheader(name, value)
            if data is not None or method in {"POST", "PUT"}:
                connection.putheader("Content-Length", str(length))
            # Once endheaders starts, a remote side effect cannot be excluded.
            sent = True
            connection.endheaders()
            if isinstance(data, Slice):
                for block in data.blocks(self.cancelled):
                    connection.send(block)
            elif data:
                connection.send(data)
            response = connection.getresponse()
            status_code, response_headers = response.status, response.getheaders()
            limit = download["bytes"] if download and status_code == 200 else self.config["maxResponseBytes"]
            while True:
                _cancelled(self.cancelled)
                block = response.read(min(CHUNK, max(1, limit + 1 - total)))
                if not block:
                    complete = response.length in {None, 0}
                    if not complete:
                        error = "TRUNCATED_CONTENT_LENGTH"
                    break
                source_sha.update(block)
                total += len(block)
                if not (download and status_code == 200):
                    raw.extend(block)
                if total > limit:
                    error = "RESPONSE_BYTE_LIMIT"
                    break
            if isinstance(data, Slice):
                data.check()
        except Stop as exc:
            error = exc.code
        except (OSError, http.client.HTTPException, ssl.SSLError, ValueError) as exc:
            error = type(exc).__name__
        finally:
            if response is not None:
                response.close()
            if connection is not None:
                connection.close()
        for selected_header in ("etag", "preservica-progress-token", "content-length", "location", "retry-after"):
            values = {value for key, value in response_headers if key.lower() == selected_header}
            if len(values) > 1:
                error = "AMBIGUOUS_RESPONSE_HEADERS"
        header_map = _safe_headers(response_headers, self.origin, token)
        source_descriptor = {"bytes": total, "sha256": source_sha.hexdigest(), "complete": complete}
        retained = None
        redacted = False
        if not (download and status_code == 200):
            retained, redacted = _safe_body(bytes(raw), self.origin, token)
        receipt = {"schema": SCHEMA + ".http-response", "requestSha256": digest(request),
                   "status": status_code, "headers": header_map, "completedAt": p.utc(),
                   "dispatchStarted": sent, "body": source_descriptor, "error": error,
                   "retainedBody": None if retained is None else {
                       "path": "response.body", "bytes": len(retained), "sha256": p.digest(retained),
                       "redacted": redacted},
                   "download": clone(download)}
        entry = self._save_response(directory, receipt, retained)
        result = {"receipt": receipt, "raw": bytes(raw), "entry": entry, "directory": directory,
                  "headers": dict((k.lower(), v) for k, v in response_headers),
                  "body": source_descriptor}
        if status_code == 401:
            raise Stop("AUTH_REQUIRED", "PROVIDER_REQUIRES_FRESH_TOKEN")
        if status_code == 429 or (status_code == 503 and header_map.get("retry-after")):
            raise Stop("COOLDOWN", "PROVIDER_RETRY_AFTER", retry_at=_retry_at(header_map.get("retry-after")))
        if error == "CANCELLED_BETWEEN_REQUESTS":
            raise Stop("INTERRUPTED", error)
        return result

    def retained_response(self, relative):
        require(isinstance(relative, str) and re.fullmatch(r"http/[0-9]{8}-[0-9a-f]{16}", relative),
                "Invalid original request directory")
        directory = self.directory / relative
        request = _load(directory, "request.json")
        if not (directory / "response.json").exists():
            return None
        receipt = _load(directory, "response.json")
        require(receipt.get("schema") == SCHEMA + ".http-response"
                and receipt.get("requestSha256") == digest(request), "Retained HTTP response binding changed")
        body = receipt.get("retainedBody")
        raw = b""
        if body is not None:
            require(body.get("path") == "response.body", "Invalid retained response body path")
            raw = p.read_regular(directory, "response.body", self.config["maxResponseBytes"] + 1)
            require(len(raw) == body.get("bytes") and p.digest(raw) == body.get("sha256"),
                    "Retained response bytes changed")
        return {"receipt": receipt, "raw": raw, "headers": receipt["headers"],
                "directory": directory, "body": receipt["body"],
                "entry": {"request": relative + "/request.json", "response": relative + "/response.json",
                          "requestSha256": digest(request), "responseSha256": digest(receipt)}}

    def get(self, target, *, missing=False, endpoint=None):
        if endpoint is not None:
            target = self.api_url(target, endpoint=endpoint)
        result = self.request("GET", target)
        receipt = result["receipt"]
        if receipt["status"] == 404 and missing and receipt["body"]["complete"]:
            return None
        if receipt["status"] != 200 or not receipt["body"]["complete"] or receipt["error"]:
            raise Unresolved("PROVIDER_READ_UNAVAILABLE", details={"status": receipt["status"],
                                                               "response": result["entry"]})
        return result

    def get_xml(self, target, *, missing=False, endpoint=None):
        result = self.get(target, missing=missing, endpoint=endpoint)
        return None if result is None else (_xml(result["raw"]), result)

    def perform(self, name, method, target, parser, *, data=None, headers=None, repeatable=False):
        retained = self.state["actions"].get(name)
        if retained and retained["state"] == "CONFIRMED":
            if retained.get("adoption"):
                old = _adopted_response(self, retained["adoption"])
            else:
                old = self.retained_response(retained["request"])
                require(old is not None, "Confirmed original response is missing")
                if retained.get("response"):
                    require(old["entry"] == retained["response"], "Confirmed response identity changed")
            checked = parser(old)
            require(checked == retained["result"], "Confirmed response differs from its original source")
            return clone(checked)
        if retained:
            old = self.retained_response(retained["request"])
            if old:
                try:
                    result = parser(old)
                    self.state["actions"][name].update({"state": "CONFIRMED", "result": result,
                                                       "response": old["entry"]})
                    self.publish()
                    return clone(result)
                except Unresolved:
                    status = old["receipt"]["status"]
                    rejection = old["body"]["complete"] and status in {401, 429}
                    never_sent = not old["receipt"]["dispatchStarted"]
            else:
                rejection, never_sent = False, False
            if not repeatable and not (old and (rejection or never_sent)):
                self.state["actions"][name]["state"] = "UNCERTAIN"
                self.publish()
                raise Stop("UPLOAD_UNCERTAIN", "ORIGINAL_" + name.upper() + "_RESPONSE_REQUIRED")
        response = self.request(method, target, data=data, headers=headers, action=name)
        try:
            result = parser(response)
        except Unresolved as exc:
            self.state["actions"][name].update({"state": "UNCERTAIN", "response": response["entry"]})
            self.publish()
            raise Stop("UPLOAD_UNCERTAIN", exc.code)
        self.state["actions"][name].update({"state": "CONFIRMED", "result": result, "response": response["entry"]})
        self.publish()
        return clone(result)

    def evidence(self, name, value):
        value = _safe_value(value, self.origin, os.environ.get(self.config["accessTokenEnv"]))
        raw = p.canonical(value)
        relative = "evidence/" + name + "-" + p.digest(raw) + ".json"
        with p.project_lock(self.root):
            _new_json(self.directory / relative, value)
        return {"path": relative, "bytes": len(raw), "sha256": p.digest(raw)}

    def summary(self):
        return _summary(self.root, self.directory, self.planned, self.state)


def _successful(result, codes=(200,)):
    receipt = result["receipt"]
    if receipt["status"] not in codes or not receipt["body"]["complete"] or receipt.get("error"):
        raise Unresolved("ORIGINAL_RESPONSE_NOT_SUCCESSFUL", details={"status": receipt["status"]})
    return receipt


def _progress_token(result, *, etag=None):
    header = result["headers"].get("preservica-progress-token")
    candidate = None
    if etag and "-progressToken-" in etag:
        candidate = etag.strip('"').rsplit("-progressToken-", 1)[1]
    if header and candidate and header != candidate:
        raise Unresolved("CONFLICTING_PROGRESS_TOKENS")
    value = header or candidate
    if value is not None:
        require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,239}", value),
                "Unsupported progress token representation")
    return value


def _parse_init(context, result):
    _successful(result)
    document = _xml(result["raw"])
    if document.tag != "{" + S3_NS + "}InitiateMultipartUploadResult":
        raise Unresolved("MULTIPART_INIT_RESULT_MISSING")
    bucket, key, upload_id = (_text(document, x, S3_NS) for x in ("Bucket", "Key", "UploadId"))
    if bucket != context.planned["bucket"] or key != context.planned["key"]:
        raise Unresolved("MULTIPART_ORIGINAL_TARGET_MISMATCH")
    require(isinstance(upload_id, str) and 1 <= len(upload_id) <= 2048
            and not any(ord(c) < 33 for c in upload_id), "Invalid original multipart upload ID")
    return {"bucket": bucket, "key": key, "uploadId": upload_id,
            "observedAt": result["receipt"]["completedAt"]}


def _parse_part(context, number, part_sha, part_bytes, result):
    _successful(result)
    etag = result["headers"].get("etag")
    if not isinstance(etag, str) or not etag or len(etag) > 4096 or any(ord(c) < 32 for c in etag):
        raise Unresolved("ORIGINAL_PART_ETAG_MISSING")
    return {"partNumber": number, "etag": etag, "bytes": part_bytes, "sha256": part_sha,
            "uploadId": context.state["transfer"]["uploadId"],
            "observedAt": result["receipt"]["completedAt"]}


def _parse_complete(context, result):
    _successful(result)
    document = _xml(result["raw"])
    if document.tag != "{" + S3_NS + "}CompleteMultipartUploadResult":
        raise Unresolved("COMPLETE_RESULT_MISSING_OR_ERROR")
    bucket, key = (_text(document, x, S3_NS) for x in ("Bucket", "Key"))
    if bucket != context.planned["bucket"] or key != context.planned["key"]:
        raise Unresolved("COMPLETION_ORIGINAL_TARGET_MISMATCH")
    etag = _text(document, "ETag", S3_NS)
    if not etag:
        raise Unresolved("COMPLETION_ETAG_MISSING")
    return {"key": key, "bucket": bucket, "etag": etag, "progressToken": _progress_token(result, etag=etag),
            "uploadId": context.state["transfer"]["uploadId"],
            "observedAt": result["receipt"]["completedAt"]}


def _parse_single(context, result):
    _successful(result)
    if result["raw"].lstrip().startswith(b"<"):
        document = _xml(result["raw"])
        if _local(document) == "Error":
            raise Unresolved("SINGLE_UPLOAD_PROVIDER_ERROR")
    etag = result["headers"].get("etag")
    if not etag:
        raise Unresolved("SINGLE_UPLOAD_ETAG_MISSING")
    return {"key": context.planned["key"], "bucket": context.planned["bucket"], "etag": etag,
            "progressToken": _progress_token(result, etag=etag),
            "observedAt": result["receipt"]["completedAt"]}


def _entity(context, entity_type, entity_ref):
    entity_ref = reference(entity_ref, "provider entity")
    path = "/api/entity/" + PATHS[entity_type] + "/" + entity_ref
    value = context.get_xml(path, missing=True)
    if value is None:
        raise Unresolved("ENTITY_NOT_YET_AVAILABLE", details={"entityType": entity_type, "entityRef": entity_ref})
    document, response = value
    found = _text(document, "Ref", context.xip_ns)
    if found != entity_ref:
        raise Unresolved("ENTITY_IDENTITY_MISMATCH", details={"requested": entity_ref, "returned": found})
    parent_text = _text(document, "Parent", context.xip_ns)
    parent = reference(parent_text, "provider parent") if parent_text else None
    return {"type": entity_type, "ref": entity_ref, "parent": parent,
            "title": _text(document, "Title", context.xip_ns),
            "description": _text(document, "Description", context.xip_ns),
            "securityTag": _text(document, "SecurityTag", context.xip_ns),
            "document": document, "response": response, "path": path}


def _preflight(context):
    document, response = context.get_xml("/api/entity/versiondetails/version")
    observed = _text(document, "CurrentVersion")
    if version(observed) != context.config["targetVersion"]:
        raise Unresolved("SELECTED_TARGET_VERSION_MISMATCH", details={"observedVersion": observed})
    parent = None
    if context.config["parentRef"]:
        parent = _entity(context, "SO", context.config["parentRef"])
    context.state["target"] = {"version": observed, "versionResponse": response["entry"],
                               "parentRef": context.config["parentRef"],
                               "parentResponse": parent["response"]["entry"] if parent else None,
                               "observedAt": p.utc()}
    context.publish()


def _empty_target(context):
    if context.state.get("initialTargetObservation"):
        return
    # HEAD only checks the original unique upload key. It is not entity readback.
    response = context.request("HEAD", context.object_path())
    receipt = response["receipt"]
    if receipt["status"] == 404 and receipt["body"]["complete"] and not receipt["error"]:
        context.state["initialTargetObservation"] = {"state": "ABSENT", "response": response["entry"],
                                                     "observedAt": receipt["completedAt"]}
        context.publish()
        return
    if receipt["status"] == 200:
        raise Stop("UPLOAD_UNCERTAIN", "ORIGINAL_OBJECT_KEY_ALREADY_EXISTS")
    raise Unresolved("UPLOAD_TARGET_PRECHECK_UNAVAILABLE", details={"status": receipt["status"]})


def _complete_body(parts):
    document = ET.Element("CompleteMultipartUpload")
    for part in sorted(parts, key=lambda x: x["partNumber"]):
        item = ET.SubElement(document, "Part")
        ET.SubElement(item, "PartNumber").text = str(part["partNumber"])
        ET.SubElement(item, "ETag").text = part["etag"]
    return ET.tostring(document, encoding="utf-8", xml_declaration=True)


def _upload(context):
    if context.state["transfer"]["submitted"] or context.state["state"] == "VERIFIED":
        return
    _preflight(context)
    _empty_target(context)
    headers = {"Content-Type": "application/zip"}
    if context.config["parentRef"]:
        headers["x-amz-meta-structuralobjectreference"] = context.config["parentRef"]
    transfer_path = context.root / context.transfer["path"]
    expected = {"bytes": context.transfer["bytes"], "sha256": context.transfer["sha256"]}
    if context.planned["mode"] == "single":
        stream = Slice(transfer_path, expected, expected_stamp=context.source_stamp)
        try:
            result = context.perform("single", "PUT", context.object_path(),
                                     lambda value: _parse_single(context, value), data=stream, headers=headers)
        finally:
            stream.close()
    else:
        if not context.state["transfer"]["uploadId"]:
            initialized = context.perform("init", "POST", context.object_path([("uploads", "")]),
                                          lambda value: _parse_init(context, value), data=b"", headers=headers)
            context.state["transfer"]["uploadId"] = initialized["uploadId"]
            context.publish()
        upload_id = context.state["transfer"]["uploadId"]
        parts, offset, number = [], 0, 1
        while offset < expected["bytes"]:
            _cancelled(context.cancelled)
            length = min(context.config["partBytes"], expected["bytes"] - offset)
            stream = Slice(transfer_path, expected, offset, length, expected_stamp=context.source_stamp)
            try:
                part = context.perform("part-" + str(number), "PUT",
                    context.object_path([("uploadId", upload_id), ("partNumber", str(number))]),
                    lambda value, n=number, h=stream.sha256, size=length: _parse_part(context, n, h, size, value),
                    data=stream, headers={"Content-Type": "application/octet-stream"}, repeatable=True)
            finally:
                stream.close()
            require(part["uploadId"] == upload_id and part["partNumber"] == number
                    and part["bytes"] == length, "Original multipart selection changed")
            parts.append(part)
            context.state["transfer"]["parts"][str(number)] = part
            context.publish()
            offset += length
            number += 1
        require(len(parts) <= 10000, "Multipart upload exceeds the supported part count")
        body = _complete_body(parts)
        result = context.perform("complete", "POST", context.object_path([("uploadId", upload_id)]),
                                 lambda value: _parse_complete(context, value), data=body,
                                 headers={"Content-Type": "application/xml"})
    context.state["transfer"]["submitted"] = True
    if result.get("progressToken"):
        context.state["transfer"]["progressToken"] = result["progressToken"]
    context.state["transfer"]["completion"] = result
    context.state["state"] = "INGESTING"
    context.note("ORIGINAL_UPLOAD_RESPONSE_CONFIRMED", key=context.planned["key"])
    context.publish()


def _head_progress(context):
    if context.state["transfer"]["progressToken"]:
        return
    if not context.state["actions"] and not context.state.get("initialTargetObservation"):
        return
    response = context.request("HEAD", context.object_path())
    receipt = response["receipt"]
    if receipt["status"] != 200 or not receipt["body"]["complete"] or receipt["error"]:
        return
    token = _progress_token(response, etag=response["headers"].get("etag"))
    if token:
        context.state["transfer"]["progressToken"] = token
        context.state["transfer"]["progressObservation"] = {
            "kind": "ORIGINAL_OBJECT_HEAD", "response": response["entry"],
            "scope": "Progress observed on this original unique key; content is verified separately."}
        context.publish()


def _observe_progress(context):
    token = context.state["transfer"]["progressToken"]
    if not token:
        return
    response = context.get_xml("/api/entity/progress/" + url.quote(token, safe=""), missing=True)
    if response is None:
        context.state["ingest"].update({"status": "UNKNOWN", "lastObservedAt": p.utc(),
                                        "issue": "ORIGINAL_PROGRESS_TOKEN_NOT_AVAILABLE"})
        context.publish()
        return
    document, result = response
    observed = _text(document, "Status", STATUS_NS)
    if observed not in PROGRESS:
        raise Unresolved("UNSUPPORTED_PROGRESS_STATUS", details={"status": observed})
    context.state["ingest"].update({"status": observed, "lastObservedAt": result["receipt"]["completedAt"],
                                    "progressResponse": result["entry"], "issue": None})
    context.publish()


def _paged_xml(context, target, tag, *, endpoint=None):
    original = url.urlsplit(context.api_url(target)).path
    endpoint = endpoint or original
    bound_query = {k: v for k, v in url.parse_qsl(url.urlsplit(context.api_url(target)).query)
                   if k not in {"start", "max"}}
    seen, values, total = set(), [], None
    while target:
        current = context.api_url(target, endpoint=endpoint)
        selected_query = {k: v for k, v in url.parse_qsl(url.urlsplit(current).query)
                          if k not in {"start", "max"}}
        if selected_query != bound_query:
            raise Unresolved("ENTITY_PAGINATION_SOURCE_SELECTION_CHANGED")
        if current in seen or len(seen) >= 10000:
            raise Unresolved("ENTITY_PAGINATION_LOOP_OR_LIMIT")
        seen.add(current)
        result = context.get_xml(current, missing=True, endpoint=endpoint)
        if result is None:
            return []
        document, _ = result
        values.extend(document.findall(".//{" + context.entity_ns + "}" + tag))
        count = _text(document, "TotalResults", context.entity_ns)
        if count is not None:
            require(re.fullmatch(r"[0-9]+", count), "Invalid provider total")
            if total is not None and total != int(count):
                raise Unresolved("ENTITY_PAGINATION_TOTAL_CHANGED")
            total = int(count)
        next_url = _text(document, "Next", context.entity_ns)
        target = next_url if next_url else None
    if total is not None and len(values) != total:
        raise Unresolved("ENTITY_PAGINATION_INCOMPLETE")
    return values


def _lookup(context, source_id, entity_type):
    target = context.path("/api/entity/entities/by-identifier", [("type", "SourceID"), ("value", source_id)])
    values = _paged_xml(context, target, "Entity")
    exact = {(x.get("type"), x.get("ref")) for x in values}
    if not exact:
        raise Unresolved("SOURCE_ID_NOT_YET_AVAILABLE", details={"sourceId": source_id})
    if len(exact) != 1 or next(iter(exact))[0] != entity_type:
        raise Unresolved("SOURCE_ID_AMBIGUOUS", details={"sourceId": source_id, "matches": len(exact)})
    return _entity(context, entity_type, next(iter(exact))[1])


def _identifiers(context, entity):
    target = entity["path"] + "/identifiers"
    visited, identifiers = set(), []
    while target:
        current = context.api_url(target, endpoint=entity["path"] + "/identifiers")
        if current in visited or len(visited) >= 10000:
            raise Unresolved("IDENTIFIER_PAGINATION_LOOP")
        visited.add(current)
        document, _ = context.get_xml(current)
        for item in document.findall(".//{" + context.xip_ns + "}Identifier"):
            kind, value = (_text(item, field, context.xip_ns) for field in ("Type", "Value"))
            identifiers.append({"type": kind, "value": value, "apiId": _text(item, "ApiId", context.xip_ns)})
        target = _text(document, "Next", context.entity_ns)
    return identifiers


def _metadata(context, entity, expected):
    fragments = entity["document"].findall(".//{" + context.entity_ns + "}Metadata/{" + context.entity_ns + "}Fragment")
    candidates = []
    for fragment in fragments:
        if fragment.get("schema") not in {q.OAI_DC_NS, q.DC_NS}:
            continue
        require(fragment.text is not None, "Metadata fragment has no URL")
        document, response = context.get_xml(context.api_url(fragment.text))
        content = document.find(".//{" + context.xip_ns + "}Content")
        dc = None
        if content is not None:
            children = list(content)
            if len(children) == 1 and children[0].tag == "{" + q.OAI_DC_NS + "}dc":
                dc = children[0]
        if dc is None:
            continue
        actual = {}
        for element in dc:
            if not isinstance(element.tag, str) or not element.tag.startswith("{" + q.DC_NS + "}"):
                raise Unresolved("UNEXPECTED_DUBLIN_CORE_FIELD")
            field = _local(element)
            actual.setdefault(field, []).append("".join(element.itertext()))
        same = set(actual) == set(expected) and all(Counter(actual[k]) == Counter(expected[k]) for k in expected)
        if same:
            candidates.append({"fragment": _safe_url(fragment.text, context.origin), "response": response["entry"],
                               "reviewedDcSha256": digest(expected), "observedDcSha256": digest(actual)})
    if len(candidates) != 1:
        raise Unresolved("REVIEWED_METADATA_NOT_UNIQUELY_VERIFIED", details={"matchingFragments": len(candidates)})
    return candidates[0]


def _check_entity(context, entity, *, parent, title, source_id, identifier=None):
    if entity["parent"] != parent:
        raise Unresolved("ENTITY_PARENT_MISMATCH", details={"entityRef": entity["ref"],
                                                         "expectedParent": parent, "actualParent": entity["parent"]})
    if entity["title"] != title:
        raise Unresolved("ENTITY_TITLE_MISMATCH", details={"entityRef": entity["ref"]})
    configured_security = context.handoff["settings"]["securityTag"]
    if configured_security is not None and entity["securityTag"] != configured_security:
        raise Unresolved("ENTITY_SECURITY_TAG_MISMATCH", details={"entityRef": entity["ref"]})
    identifiers = _identifiers(context, entity)
    if not any(x["type"] == "SourceID" and x["value"] == source_id for x in identifiers):
        raise Unresolved("ORIGINAL_SOURCE_ID_NOT_RETAINED", details={"entityRef": entity["ref"]})
    if identifier and not any(x["value"] == identifier for x in identifiers):
        raise Unresolved("ORIGINAL_RESEARCH_IDENTIFIER_NOT_RETAINED", details={"entityRef": entity["ref"]})
    return {"entityType": entity["type"], "entityRef": entity["ref"], "parentRef": entity["parent"],
            "title": entity["title"], "securityTag": entity["securityTag"], "sourceId": source_id,
            "identifiers": identifiers, "entityResponse": entity["response"]["entry"]}


def _download(context, target, expected):
    require(isinstance(target, str) and target, "Missing provider content URL")
    current = url.urljoin(context.origin + "/", target)
    initial = url.urlsplit(current)
    require(initial.scheme == "https" or (initial.scheme == "http" and
            initial.hostname in {"127.0.0.1", "::1", "localhost"}), "Unsafe provider content URL")
    require(not initial.username and not initial.password and not initial.fragment, "Invalid provider content URL")
    visited = set()
    for _ in range(6):
        if current in visited:
            raise Unresolved("CONTENT_REDIRECT_LOOP")
        visited.add(current)
        parsed, base = url.urlsplit(current), url.urlsplit(context.origin)
        external = (parsed.scheme, parsed.hostname, parsed.port) != (base.scheme, base.hostname, base.port)
        result = context.request("GET", current, download=expected, external=external)
        receipt = result["receipt"]
        if receipt["status"] in {301, 302, 303, 307, 308}:
            if not receipt["body"]["complete"] or receipt["error"]:
                raise Unresolved("CONTENT_REDIRECT_RESPONSE_INCOMPLETE")
            location = result["headers"].get("location")
            if not location:
                raise Unresolved("CONTENT_REDIRECT_LOCATION_MISSING")
            next_url = url.urljoin(current, location)
            next_parts = url.urlsplit(next_url)
            require(next_parts.scheme == "https" or (
                next_parts.scheme == "http" and parsed.scheme == "http"
                and next_parts.hostname in {"127.0.0.1", "::1", "localhost"}),
                "Content redirect downgraded transport")
            require(not next_parts.username and not next_parts.password and not next_parts.fragment,
                    "Unsafe content redirect")
            current = next_url
            continue
        _successful(result)
        if result["body"]["bytes"] != expected["bytes"] or result["body"]["sha256"] != expected["sha256"]:
            raise Unresolved("ORIGINAL_CONTENT_BYTES_DIFFER", details={"expected": expected,
                "actual": {"bytes": result["body"]["bytes"], "sha256": result["body"]["sha256"]}})
        return {"bytes": expected["bytes"], "sha256": expected["sha256"],
                "response": result["entry"], "observedAt": receipt["completedAt"],
                "scope": "Full returned original content was streamed and hashed; credentials were not forwarded across origins."}
    raise Unresolved("CONTENT_REDIRECT_LIMIT")


def _content(context, entity, row):
    document, _ = context.get_xml(entity["path"] + "/representations")
    representations = document.findall(".//{" + context.entity_ns + "}Representation")
    originals = []
    for representation in representations:
        if representation.get("type") != "Preservation":
            continue
        if not representation.text:
            raise Unresolved("PRESERVATION_REPRESENTATION_URL_MISSING")
        rep_url = context.api_url(representation.text)
        rep_doc, _ = context.get_xml(rep_url)
        refs = rep_doc.findall(".//{" + context.xip_ns + "}Representation/{" + context.xip_ns
                               + "}ContentObjects/{" + context.xip_ns + "}ContentObject")
        for ref in refs:
            content_object = _entity(context, "CO", ref.text)
            if content_object["parent"] != entity["ref"]:
                raise Unresolved("CONTENT_OBJECT_PARENT_MISMATCH")
            generations, _ = context.get_xml(content_object["path"] + "/generations")
            for link in generations.findall(".//{" + context.entity_ns + "}Generation"):
                require(link.text is not None, "Generation has no URL")
                generation_url = context.api_url(link.text)
                generation, _ = context.get_xml(generation_url)
                original = generation.find(".//{" + context.xip_ns + "}Generation")
                if original is None or original.get("original", "").lower() not in {"true", "1"}:
                    continue
                for bit in generation.findall(".//{" + context.entity_ns + "}Bitstreams/{" + context.entity_ns + "}Bitstream"):
                    require(bit.text is not None, "Original bitstream has no URL")
                    bit_url = context.api_url(bit.text)
                    stream, response = context.get_xml(bit_url)
                    filename = _text(stream, "Filename", context.xip_ns)
                    size = _text(stream, "FileSize", context.xip_ns)
                    require(size is not None and re.fullmatch(r"[0-9]+", size), "Invalid original bitstream size")
                    fixities = []
                    for fixity in stream.findall(".//{" + context.xip_ns + "}Fixity"):
                        algorithm = _text(fixity, "FixityAlgorithmRef", context.xip_ns)
                        value = _text(fixity, "FixityValue", context.xip_ns)
                        # The maintained entity model exposes these two XIP children;
                        # their values are retained without assuming an ETag algorithm.
                        if algorithm is None or value is None:
                            children = list(fixity)
                            if len(children) == 2:
                                algorithm, value = children[0].text, children[1].text
                        fixities.append({"algorithm": algorithm, "value": value})
                    target = _text(stream, "Content", context.entity_ns)
                    originals.append({"filename": filename, "bytes": int(size), "fixities": fixities,
                        "contentUrl": target, "contentObjectRef": content_object["ref"],
                        "representationUrl": _safe_url(rep_url, context.origin),
                        "generationUrl": _safe_url(generation_url, context.origin),
                        "bitstreamUrl": _safe_url(bit_url, context.origin), "response": response["entry"]})
    expected_name = row["nativePath"].rsplit("/", 1)[1]
    if len(originals) != 1 or originals[0]["filename"] != expected_name:
        raise Unresolved("ORIGINAL_CONTENT_STRUCTURE_MISMATCH", details={"originalFiles": len(originals)})
    original = originals[0]
    if original["bytes"] != row["payload"]["bytes"]:
        raise Unresolved("ORIGINAL_CONTENT_SIZE_MISMATCH")
    hashes = [x["value"].lower() for x in original["fixities"]
              if isinstance(x["algorithm"], str) and isinstance(x["value"], str)
              and re.sub(r"[^A-Z0-9]", "", x["algorithm"].upper()) == "SHA256"]
    if not hashes or set(hashes) != {row["payload"]["sha256"]}:
        raise Unresolved("ORIGINAL_REPOSITORY_FIXITY_MISMATCH")
    if not original["contentUrl"]:
        raise Unresolved("ORIGINAL_CONTENT_DOWNLOAD_UNAVAILABLE")
    downloaded = _download(context, original.pop("contentUrl"), row["payload"])
    return {**original, "download": downloaded}


def _verify_folders(context):
    cached = context.state["readback"]["folders"]
    for value in cached.values():
        descriptor = value["evidence"]
        raw = p.read_regular(context.directory, descriptor["path"], MAX_STATE)
        require(p.digest(raw) == descriptor["sha256"] and len(raw) == descriptor["bytes"],
                "Retained folder verification changed")
    if "package" not in cached:
        start = len(context.trace)
        folder = _lookup(context, context.handoff["packageSourceId"], "SO")
        checked = _check_entity(context, folder, parent=context.config["parentRef"],
                               title=context.handoff["settings"]["title"],
                               source_id=context.handoff["packageSourceId"])
        settings = context.handoff["settings"]
        dc = {"title": [settings["title"]], "description": [
                settings["description"], "Original bibliographic metadata; no paper full text is included."],
              "type": ["Collection"], "identifier": [context.handoff["packageSourceId"]],
              "source": ["urn:sha256:" + context.handoff["source"]["manifestSha256"]], "rights": [p.LICENSE]}
        checked["metadata"] = _metadata(context, folder, dc)
        checked.update({"schema": SCHEMA + ".folder-readback", "kind": "package",
                        "observedAt": p.utc(), "http": context.trace[start:]})
        descriptor = context.evidence("package-folder", checked)
        cached["package"] = {"entityRef": folder["ref"], "parentRef": folder["parent"],
                             "observedAt": checked["observedAt"], "evidence": descriptor}
        context.publish()
    if "records" not in cached:
        start = len(context.trace)
        folder = _lookup(context, context.handoff["recordsFolderSourceId"], "SO")
        checked = _check_entity(context, folder, parent=cached["package"]["entityRef"],
                               title="Research records", source_id=context.handoff["recordsFolderSourceId"])
        checked.update({"schema": SCHEMA + ".folder-readback", "kind": "records",
                        "observedAt": p.utc(), "http": context.trace[start:]})
        descriptor = context.evidence("records-folder", checked)
        cached["records"] = {"entityRef": folder["ref"], "parentRef": folder["parent"],
                             "observedAt": checked["observedAt"], "evidence": descriptor}
        context.publish()
    return cached["records"]["entityRef"]


def _verified_entry(context, row, parent):
    start = len(context.trace)
    entity = _lookup(context, row["sourceId"], "IO")
    checked = _check_entity(context, entity, parent=parent,
                           title=" | ".join(row["reviewedDc"].get("title", [])),
                           source_id=row["sourceId"], identifier=row["identifier"])
    metadata = _metadata(context, entity, row["reviewedDc"])
    content = _content(context, entity, row)
    record = {"schema": SCHEMA + ".record-readback", "operationId": context.planned["operationId"],
              "packageId": context.handoff["id"], "identifier": row["identifier"],
              "sourceId": row["sourceId"], "nativePath": row["nativePath"],
              "expected": clone(row["payload"]), "reviewedDcSha256": digest(row["reviewedDc"]),
              "entity": checked, "metadata": metadata, "content": content,
              "observedAt": p.utc(), "http": context.trace[start:]}
    descriptor = context.evidence(row["identifier"].rsplit("/", 1)[1], record)
    return {"identifier": row["identifier"], "sourceId": row["sourceId"], "status": "VERIFIED",
            "entityRef": entity["ref"], "parentRef": entity["parent"], "bytes": row["payload"]["bytes"],
            "sha256": row["payload"]["sha256"], "observedAt": record["observedAt"], "evidence": descriptor}


def _verify_records(context):
    try:
        parent = _verify_folders(context)
    except Unresolved as exc:
        context.state["readback"]["folderIssue"] = {"code": exc.code, "details": clone(exc.details), "at": p.utc()}
        context.publish()
        return
    context.state["readback"]["folderIssue"] = None
    selected = [row for row in context.catalog["records"] if row["include"]]
    saved = context.state["readback"]["records"]
    context.state["state"] = "VERIFYING"
    context.publish()
    pending = 0
    for row in selected:
        _cancelled(context.cancelled)
        original = saved.get(row["identifier"])
        if original and original.get("status") == "VERIFIED":
            descriptor = original["evidence"]
            raw = p.read_regular(context.directory, descriptor["path"], MAX_STATE)
            require(len(raw) == descriptor["bytes"] and p.digest(raw) == descriptor["sha256"],
                    "Retained record verification changed")
            value = p.parse_json(raw)
            require(value["identifier"] == row["identifier"] and value["sourceId"] == row["sourceId"]
                    and value["expected"] == row["payload"] and value["reviewedDcSha256"] == digest(row["reviewedDc"]),
                    "Verified record belongs to another original source")
            continue
        try:
            saved[row["identifier"]] = _verified_entry(context, row, parent)
        except Unresolved as exc:
            saved[row["identifier"]] = {"identifier": row["identifier"], "sourceId": row["sourceId"],
                "status": "UNRESOLVED", "code": exc.code, "details": clone(exc.details), "observedAt": p.utc()}
        pending += 1
        if pending >= context.config["readbackBatchSize"]:
            _readback_counts(context)
            context.publish()
            pending = 0
    _readback_counts(context)
    context.publish()


def _readback_counts(context):
    readback = context.state["readback"]
    readback["verifiedRecords"] = sum(value.get("status") == "VERIFIED" for value in readback["records"].values())
    readback["unresolvedRecords"] = readback["totalRecords"] - readback["verifiedRecords"]
    readback["lastObservedAt"] = p.utc()


def _monitor(context):
    selected = context.state["ingest"].get("processId")
    if not selected:
        return
    start = len(context.trace)
    target = "/api/processmonitor/monitors"
    visited, matches, complete = set(), [], True
    while target:
        absolute = context.api_url(target, endpoint="/api/processmonitor/monitors")
        if absolute in visited or len(visited) >= 1000:
            raise Unresolved("PROCESS_MONITOR_PAGINATION_LOOP")
        visited.add(absolute)
        response = context.get(absolute)
        value = p.parse_json(response["raw"]).get("value")
        require(isinstance(value, dict) and isinstance(value.get("monitors"), list), "Invalid process-monitor response")
        matches.extend(row for row in value["monitors"] if str(row.get("mappedId")) == selected)
        paging = value.get("paging")
        if isinstance(paging, dict):
            target = paging.get("next")
            if not target and isinstance(paging.get("totalResults"), int):
                # A list without an explicit paging contract is never used to prove absence.
                complete = False
        else:
            target, complete = None, False
    if len(matches) != 1:
        context.state["ingest"].update({"processStatus": None, "processObservation": {
            "selectedId": selected, "matches": len(matches), "listExhaustive": complete,
            "issue": "SELECTED_MONITOR_NOT_UNIQUELY_RETURNED", "observedAt": p.utc()}})
        context.publish()
        return
    messages, target, visited, expected_total = [], context.path(
        "/api/processmonitor/messages", [("monitor", selected), ("start", "0"), ("max", "100")]), set(), None
    while target:
        absolute = context.api_url(target, endpoint="/api/processmonitor/messages")
        parsed = dict(url.parse_qsl(url.urlsplit(absolute).query))
        if parsed.get("monitor") != selected or absolute in visited or len(visited) >= 10000:
            raise Unresolved("PROCESS_MESSAGE_SELECTION_OR_PAGINATION_CHANGED")
        visited.add(absolute)
        response = context.get(absolute)
        value = p.parse_json(response["raw"]).get("value")
        require(isinstance(value, dict) and isinstance(value.get("messages"), list), "Invalid process message response")
        for message in value["messages"]:
            if str(message.get("mappedMonitorId")) != selected:
                raise Unresolved("PROCESS_MESSAGE_MONITOR_MISMATCH")
            messages.append(message)
        paging = value.get("paging", {})
        require(isinstance(paging, dict), "Invalid process message paging")
        total = paging.get("totalResults")
        if total is not None:
            require(isinstance(total, int) and not isinstance(total, bool) and total >= 0,
                    "Invalid process message total")
            if expected_total is not None and expected_total != total:
                raise Unresolved("PROCESS_MESSAGE_TOTAL_CHANGED")
            expected_total = total
        target = paging.get("next")
    if expected_total is not None and len(messages) != expected_total:
        raise Unresolved("PROCESS_MESSAGE_PAGINATION_INCOMPLETE")
    record = {"schema": SCHEMA + ".process-observation", "selectedId": selected,
              "monitor": matches[0], "messages": messages, "observedAt": p.utc(), "http": context.trace[start:],
              "association": "Explicit operator-selected process observation; not a progress-token or permanent entity link.",
              "idScope": "Monitor mapped IDs can change between product releases."}
    descriptor = context.evidence("process-observation", record)
    status = matches[0].get("status", matches[0].get("state"))
    context.state["ingest"].update({"processStatus": status, "processObservation": descriptor})
    context.publish()


def _observe(context):
    _preflight(context)
    _head_progress(context)
    _observe_progress(context)
    if context.state["ingest"].get("processId"):
        try:
            _monitor(context)
        except Unresolved as exc:
            context.state["ingest"]["processIssue"] = {"code": exc.code, "details": clone(exc.details), "at": p.utc()}
            context.publish()
    _verify_records(context)
    rb = context.state["readback"]
    status = context.state["ingest"].get("status")
    if status in FAILED:
        context.finish("INGEST_FAILED", "ORIGINAL_PROGRESS_" + status)
    elif rb["verifiedRecords"] == rb["totalRecords"] and set(rb["folders"]) == {"package", "records"}:
        context.finish("VERIFIED")
    elif any(x["state"] in {"DISPATCHED", "UNCERTAIN"} for x in context.state["actions"].values()):
        context.finish("UPLOAD_UNCERTAIN", "ORIGINAL_DISPATCH_OR_RESPONSE_UNRESOLVED")
    elif status in ACTIVE or not context.state["transfer"]["submitted"]:
        context.finish("INGESTING", "SOURCE_READBACK_PENDING")
    else:
        context.finish("VERIFYING", "SOURCE_READBACK_INCOMPLETE")


def _run(package_workspace, identifier, *, cancelled=None, observe_only=False, evidence=None):
    root = Path(package_workspace).absolute()
    directory, _ = _planned(root, identifier)
    with _operation_lock(directory):
        context = Context(root, identifier, cancelled)
        try:
            _cancelled(cancelled)
            if _future(context.state.get("retryAt")):
                return context.summary()
            context.state["retryAt"] = None
            if evidence is not None:
                _reconcile(context, evidence)
            if not observe_only and evidence is None and context.state["state"] != "VERIFIED":
                try:
                    _upload(context)
                except Stop as exc:
                    if exc.state != "UPLOAD_UNCERTAIN":
                        raise
                    context.finish(exc.state, exc.code, exc.retry_at)
                    # An observed original SourceID+metadata+file can still resolve
                    # content receiving without repeating this uncertain upload.
            _observe(context)
        except Stop as exc:
            _readback_counts(context)
            context.finish(exc.state, exc.code, exc.retry_at)
        except Unresolved as exc:
            _readback_counts(context)
            context.state["lastObservationDetails"] = clone(exc.details)
            context.finish("NEEDS_REVIEW", exc.code)
        return context.summary()


def run(package_workspace, operation_id, *, cancelled=None):
    return _run(package_workspace, operation_id, cancelled=cancelled)


def refresh(package_workspace, operation_id, *, cancelled=None):
    return _run(package_workspace, operation_id, cancelled=cancelled, observe_only=True)


def reconciliation_template(kind="original-response"):
    if kind == "original-response":
        return {"schema": EVIDENCE_SCHEMA, "kind": kind, "operationId": "original-operation-id",
                "action": "complete", "requestSha256": "EXACT_ORIGINAL_REQUEST_SHA256",
                "status": 200, "headers": {"etag": "ORIGINAL_ETAG",
                    "preservica-progress-token": "ORIGINAL_PROGRESS_TOKEN"},
                "bodyBase64": "BASE64_OF_THE_ORIGINAL_COMPLETE_XML_BODY",
                "observedAt": "2026-10-12T00:00:00Z",
                "sourceDescription": "Original retained HTTP response for this exact upload"}
    if kind == "progress-observation":
        return {"schema": EVIDENCE_SCHEMA, "kind": kind, "operationId": "original-operation-id",
                "action": "complete", "requestSha256": "EXACT_ORIGINAL_REQUEST_SHA256",
                "bucket": "tenant.package.upload", "key": "EXACT_ORIGINAL_OBJECT_KEY",
                "progressToken": "ORIGINAL_PROGRESS_TOKEN",
                "sourceDescription": "Original upload response retained outside this client"}
    if kind == "process-observation":
        return {"schema": EVIDENCE_SCHEMA, "kind": kind, "operationId": "original-operation-id",
                "processId": "ORIGINAL_MONITOR_MAPPED_ID",
                "sourceDescription": "Explicit original process selection; not inferred from a title or time"}
    raise Error("Unsupported reconciliation evidence kind")


def _validate_evidence(context, value):
    require(isinstance(value, dict), "Reconciliation evidence must be a JSON object")
    kind = value.get("kind")
    template = reconciliation_template(kind)
    require(set(value) == set(template), "Reconciliation evidence fields do not match the selected kind")
    require(value.get("schema") == EVIDENCE_SCHEMA and value.get("operationId") == context.planned["operationId"],
            "Evidence belongs to a different original operation")
    source = value.get("sourceDescription")
    require(isinstance(source, str) and 1 <= len(source) <= 4000, "Describe the retained original evidence source")
    if kind in {"original-response", "progress-observation"}:
        action = value.get("action")
        require(action in {"init", "single", "complete"}, "Reconcile only an original upload action")
        original = context.state["actions"].get(action)
        require(isinstance(original, dict), "No original dispatch exists for this action")
        request = _load(context.directory, original["request"] + "/request.json")
        require(value.get("requestSha256") == digest(request) == original.get("requestSha256")
                and request.get("action") == action, "Evidence does not bind the exact original HTTP request")
    else:
        process_id = value.get("processId")
        require(isinstance(process_id, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,239}", process_id),
                "Select the original observed process ID")
    return clone(value)


def _adopted_response(context, descriptor):
    raw = p.read_regular(context.directory, descriptor["path"], MAX_STATE)
    require(len(raw) == descriptor["bytes"] and p.digest(raw) == descriptor["sha256"],
            "Original adopted evidence changed")
    value = p.parse_json(raw)
    require(value.get("kind") == "original-response" and value.get("operationId") == context.planned["operationId"],
            "Adopted response belongs to another operation")
    action = context.state["actions"].get(value.get("action"))
    require(action and action.get("requestSha256") == value.get("requestSha256"),
            "Adopted response lost its original request binding")
    try:
        body = base64.b64decode(value["bodyBase64"], validate=True)
    except (ValueError, TypeError):
        raise Error("Invalid retained original response encoding")
    return {"receipt": {"status": value["status"], "body": {"complete": True},
                       "error": None, "completedAt": value["observedAt"]},
            "headers": {k.lower(): v for k, v in value["headers"].items()}, "raw": body}


def _reconcile(context, evidence):
    value = _validate_evidence(context, evidence)
    kind = value["kind"]
    if kind == "original-response":
        require(isinstance(value["status"], int) and not isinstance(value["status"], bool), "Invalid original status")
        headers = value["headers"]
        require(isinstance(headers, dict) and all(isinstance(k, str) and isinstance(v, str)
                for k, v in headers.items()), "Original response headers must be strings")
        require(not (set(k.lower() for k in headers) & SECRET_HEADERS), "Do not include credentials or cookies in evidence")
        try:
            raw = base64.b64decode(value["bodyBase64"], validate=True)
        except (ValueError, TypeError):
            raise Error("Original response body must be valid base64")
        require(len(raw) <= context.config["maxResponseBytes"], "Original response evidence is too large")
        try:
            at = dt.datetime.fromisoformat(value["observedAt"].replace("Z", "+00:00"))
            require(at.tzinfo is not None, "Original observation needs a timezone")
        except (ValueError, TypeError, AttributeError):
            raise Error("Invalid original response observation timestamp")
        response = {"receipt": {"status": value["status"], "body": {"complete": True},
                    "error": None, "completedAt": value["observedAt"]},
                    "headers": {k.lower(): v for k, v in headers.items()}, "raw": raw}
        action = value["action"]
        parser = {"init": _parse_init, "single": _parse_single, "complete": _parse_complete}[action]
        result = parser(context, response)
        original = context.state["actions"][action]
        if original["state"] == "CONFIRMED":
            require(original["result"] == result, "An existing confirmed original result cannot be replaced")
        safe, changed = _safe_body(raw, context.origin, os.environ.get(context.config["accessTokenEnv"]))
        retained = {**value, "headers": _safe_headers(list(headers.items()), context.origin),
                    "bodyBase64": base64.b64encode(safe).decode("ascii"),
                    "sourceBody": {"bytes": len(raw), "sha256": p.digest(raw), "redacted": changed}}
        descriptor = context.evidence("original-response", retained)
        original.update({"state": "CONFIRMED", "result": result, "adoption": descriptor})
        if action == "init":
            prior = context.state["transfer"]["uploadId"]
            require(prior in {None, result["uploadId"]}, "Original multipart upload ID differs")
            context.state["transfer"]["uploadId"] = result["uploadId"]
        else:
            context.state["transfer"]["submitted"] = True
            context.state["transfer"]["completion"] = result
            if result.get("progressToken"):
                context.state["transfer"]["progressToken"] = result["progressToken"]
        context.note("ORIGINAL_RESPONSE_ADOPTED", action=action, requestSha256=value["requestSha256"],
                     evidence=descriptor)
    elif kind == "progress-observation":
        require(value["action"] in {"single", "complete"}, "A progress token follows an upload completion")
        require(value["bucket"] == context.planned["bucket"] and value["key"] == context.planned["key"],
                "Progress observation belongs to a different original target")
        token = value["progressToken"]
        require(isinstance(token, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,239}", token),
                "Invalid original progress token")
        prior = context.state["transfer"]["progressToken"]
        require(prior in {None, token}, "An original progress token is already selected")
        descriptor = context.evidence("original-progress-observation", value)
        context.state["transfer"]["progressToken"] = token
        context.state["transfer"]["progressObservation"] = {"kind": "EXPLICIT_ORIGINAL_RESPONSE",
            "evidence": descriptor, "scope": "Operator-provided original response association; repository source readback remains required."}
        context.note("ORIGINAL_PROGRESS_OBSERVATION_SELECTED", evidence=descriptor)
    else:
        descriptor = context.evidence("original-process-selection", value)
        context.state["ingest"]["processId"] = value["processId"]
        context.state["ingest"].setdefault("processSelections", []).append(descriptor)
        context.state["ingest"]["processStatus"] = None
        context.note("ORIGINAL_PROCESS_OBSERVATION_SELECTED", evidence=descriptor)
    context.state["lastIssue"] = None
    context.publish()


def reconcile(package_workspace, operation_id, evidence, *, cancelled=None):
    # Exact caller value is cloned before any provider or journal action.
    return _run(package_workspace, operation_id, cancelled=cancelled,
                observe_only=True, evidence=clone(evidence))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("configuration-template")
    evidence = sub.add_parser("reconciliation-template")
    evidence.add_argument("--kind", choices=["original-response", "progress-observation", "process-observation"],
                          default="original-response")
    command = sub.add_parser("plan")
    command.add_argument("--workspace", required=True)
    command.add_argument("--configuration", required=True)
    command.add_argument("--operation-id", required=True)
    for name in ("show", "run", "refresh", "reconcile"):
        command = sub.add_parser(name)
        command.add_argument("--workspace", required=True)
        command.add_argument("--operation-id", required=name != "show")
        if name == "reconcile":
            command.add_argument("--evidence", required=True)
    args = parser.parse_args(argv)
    if args.command == "configuration-template":
        result = configuration_template()
    elif args.command == "reconciliation-template":
        result = reconciliation_template(args.kind)
    elif args.command == "plan":
        path = Path(args.configuration).absolute()
        result = plan(args.workspace, _load(path.parent, path.name), args.operation_id)
    elif args.command == "show":
        result = show(args.workspace, args.operation_id)
    elif args.command == "reconcile":
        path = Path(args.evidence).absolute()
        result = reconcile(args.workspace, args.operation_id, _load(path.parent, path.name))
    else:
        result = globals()[args.command](args.workspace, args.operation_id)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (Error, q.Error, p.PreservationError, OSError, KeyError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__,
                          "message": str(exc) if isinstance(exc, (Error, q.Error, p.PreservationError)) else
                                     "The original operation remains retained; inspect its saved journal."}), file=sys.stderr)
        raise SystemExit(1)
