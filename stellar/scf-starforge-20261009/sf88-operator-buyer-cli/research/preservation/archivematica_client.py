#!/usr/bin/env python3
"""Source-bound Archivematica 1.18.0 / Storage Service 0.24.0 receiving.

Preparation is offline. A run stages one original BagIt ZIP and records every
entered provider action before dispatch. Refresh does not start transfers,
approve jobs, request retrieval or run fixity. Original-response reconciliation
never redispatches an uncertain action.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import email.utils
import hashlib
import html
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import ssl
import stat
import sys
import tempfile
import time
from urllib.parse import quote, unquote, urlencode, urljoin, urlsplit
import uuid
import xml.etree.ElementTree as ET

import archivematica as package

SCHEMA = "stellar-forge.archivematica-client.v1"
OP_SCHEMA = "stellar-forge.archivematica-operation.v1"
RECONCILIATION_KINDS = ("original-start-response", "original-action-response")
DECISION_SCHEMA = OP_SCHEMA + ".decision"
DASHBOARD_COMMIT = "243867858da329bb27ac9d5cf1747b3389d39149"
STORAGE_COMMIT = "0c3129d6f549e1223a119c07f0d3f9f972b9c890"
SOURCES = {
    "dashboardVersion": "1.18.0", "dashboardCommit": DASHBOARD_COMMIT,
    "storageVersion": "0.24.0", "storageCommit": STORAGE_COMMIT,
    "dashboardApi": "https://archivematica.org/fr/docs/archivematica-1.18/dev-manual/api/api-reference-archivematica/",
    "storageApi": "https://www.archivematica.org/en/docs/archivematica-1.18/dev-manual/api/api-reference-storage-service/",
    "packageCreate": "389fba2fb8abc437491f143a3426c2b02f75e651",
    "apiViews": "3c0edf8ee4a78042e118b345742319a138fec16c",
    "storageResources": "cae745acf88b1c78a0b090a99465918c2c22385f",
    "bagRestructure": "2bd61f81657a390d5237c4a2c0eb5338fcb01ebc",
    "sipCreation": "d590f7bdc338d792243e03ce6566daae721e5908",
    "aipBagging": "0f11b844fa497d54790862e5449a772756d6364a",
    "archiveReader": {"py7zr": "1.1.3", "api": "https://py7zr.readthedocs.io/en/latest/api.html",
                      "source": "https://github.com/miurahr/py7zr/tree/v1.1.3"},
}
NS = {"mets": "http://www.loc.gov/METS/",
      "xlink": "http://www.w3.org/1999/xlink",
      "dc": "http://purl.org/dc/elements/1.1/",
      "dcterms": "http://purl.org/dc/terms/"}
HASH = re.compile(r"[0-9a-f]{64}\Z")
ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}\Z")
TERMINAL_ACTIONS = {"CONFIRMED", "ADOPTED"}
SAFE_HEADERS = {"content-type", "content-length", "transfer-encoding", "retry-after",
                "etag", "last-modified", "date", "content-disposition",
                "x-archivematica-version", "x-archivematica-id"}
Error = package.ArchivematicaError


class Pause(Exception):
    def __init__(self, state, message, **details):
        super().__init__(message)
        self.state, self.message, self.details = state, message, details


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def encoded(value):
    return package.canonical(value)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def text(value, label, maximum=10000, nonempty=False):
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value or (nonempty and not value.strip()):
        raise Error("Invalid " + label)
    return value


def one_line(value, label, maximum=255, nonempty=True):
    value = text(value, label, maximum, nonempty)
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise Error("Control characters in " + label)
    return value


def identifier(value, label):
    try:
        result = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise Error("Enter the original " + label + " UUID") from None
    if not isinstance(value, str) or value.lower() != result:
        raise Error("Use a canonical UUID for " + label)
    return result


def token(value, label="operation identifier"):
    return package.token(value, label)


def env_name(value, label):
    if not isinstance(value, str) or not ENV.fullmatch(value):
        raise Error("Enter an environment-variable name for " + label)
    return value


def number(value, label, minimum, maximum, integral=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum:
        raise Error("Invalid bounded " + label)
    if integral and not isinstance(value, int):
        raise Error(label + " must be an integer")
    return value


def base_url(value, allow_loopback=False):
    value = text(value, "service base URL", 2000, True)
    parsed = urlsplit(value)
    if parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
        raise Error("Service URLs cannot contain credentials, queries or fragments")
    if parsed.scheme != "https" and not (
            allow_loopback and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1", "localhost"}):
        raise Error("Use HTTPS, or explicitly allow the local receiving fixture")
    if not parsed.hostname or "\\" in value or any(ord(c) < 33 for c in value):
        raise Error("Invalid service URL")
    try:
        parsed.port
    except ValueError:
        raise Error("Invalid service port") from None
    path = parsed.path.rstrip("/")
    if any(x in {".", ".."} for x in unquote(path).split("/")) or "//" in path:
        raise Error("Service base path must be canonical")
    return value.rstrip("/")


def configuration_template():
    return {
        "schema": SCHEMA,
        "dashboard": {"baseUrl": "https://your-existing-dashboard.example",
                      "username": "your-api-user", "apiKeyEnv": "ARCHIVEMATICA_DASHBOARD_API_KEY",
                      "sessionCookieEnv": None, "csrfTokenEnv": None},
        "storage": {"baseUrl": "https://your-existing-storage-service.example",
                    "username": "your-api-user", "apiKeyEnv": "ARCHIVEMATICA_STORAGE_API_KEY"},
        "deployment": {"dashboardVersion": "1.18.0", "storageVersion": "0.24.0"},
        "transferSourceRootEnv": "ARCHIVEMATICA_TRANSFER_SOURCE_ROOT",
        "timeoutSeconds": 60, "pollSeconds": 2, "waitSeconds": 30,
        "maxResponseBytes": 16777216, "maxDownloadBytes": 2147483648,
        "caFile": None, "allowLoopback": False,
        "note": "Select existing services, locations and pipeline. The source root is the authorized "
                "shared/mounted directory for the reviewed transfer-source location. Session cookies "
                "and CSRF are needed only for original Dashboard processing/arrangement decisions."
    }


def normalize_configuration(value):
    allowed = set(configuration_template())
    if not isinstance(value, dict) or set(value) != allowed or value.get("schema") != SCHEMA:
        raise Error("Use the complete Archivematica client configuration template")
    if type(value["allowLoopback"]) is not bool:
        raise Error("allowLoopback must be an explicit boolean")
    result = {"schema": SCHEMA, "allowLoopback": value["allowLoopback"]}
    for kind in ("dashboard", "storage"):
        record = value[kind]
        keys = {"baseUrl", "username", "apiKeyEnv"}
        if kind == "dashboard":
            keys |= {"sessionCookieEnv", "csrfTokenEnv"}
        if not isinstance(record, dict) or set(record) != keys:
            raise Error("Unknown or missing " + kind + " configuration fields")
        username = one_line(record["username"], kind + " username")
        if ":" in username:
            raise Error("An API username cannot contain a colon")
        item = {"baseUrl": base_url(record["baseUrl"], value["allowLoopback"]),
                "username": username, "apiKeyEnv": env_name(record["apiKeyEnv"], kind + " API key")}
        if kind == "dashboard":
            for key in ("sessionCookieEnv", "csrfTokenEnv"):
                item[key] = env_name(record[key], key) if record[key] is not None else None
            if bool(item["sessionCookieEnv"]) != bool(item["csrfTokenEnv"]):
                raise Error("Dashboard session and CSRF environment references must be supplied together")
        result[kind] = item
    expected = {"dashboardVersion": "1.18.0", "storageVersion": "0.24.0"}
    if value["deployment"] != expected:
        raise Error("This reviewed adapter targets Dashboard 1.18.0 and Storage Service 0.24.0")
    result["deployment"] = expected
    result["transferSourceRootEnv"] = env_name(value["transferSourceRootEnv"], "transfer source root")
    for name, lo, hi, integer in (
            ("timeoutSeconds", 1, 300, False), ("pollSeconds", 0.05, 30, False),
            ("waitSeconds", 0, 600, False), ("maxResponseBytes", 65536, 134217728, True),
            ("maxDownloadBytes", 1048576, 8589934592, True)):
        result[name] = number(value[name], name, lo, hi, integer)
    ca = value["caFile"]
    if ca is not None:
        ca = one_line(ca, "CA certificate path", 4096)
        if not Path(ca).is_absolute():
            raise Error("CA certificate file must have an absolute path")
    result["caFile"] = ca
    result["note"] = text(value["note"], "configuration note")
    return result


validate_configuration = normalize_configuration


def reconciliation_template(kind="original-start-response"):
    if kind not in RECONCILIATION_KINDS:
        raise Error("Unsupported original-response reconciliation kind")
    result = {"schema": OP_SCHEMA + ".reconciliation", "kind": kind,
              "requestSha256": "", "response": {"status": 202, "body": {"id": ""}},
              "note": ""}
    if kind == "original-action-response":
        result["actionKey"] = ""
        result["response"] = {"status": 200, "body": None}
    return result


def safe_path(value):
    return package.safe(value)


def folder(root, relative):
    root = Path(root).absolute()
    current = root
    if root.is_symlink() or not root.is_dir():
        raise Error("Original workspace directory is missing or changed")
    for part in safe_path(relative).split("/"):
        current /= part
        if current.is_symlink():
            raise Error("A retained operation directory is a symlink")
        current.mkdir(exist_ok=True, mode=0o700)
        if not current.is_dir():
            raise Error("Retained operation path is not a directory")
    return current


def read_json(path, limit=134217728):
    path = Path(path)
    source = package.regular(path.parent, path.name)
    if source.stat().st_size > limit:
        raise Error("Retained JSON exceeds its declared limit")
    return package.parse(source.read_bytes())


def file_descriptor(root, path):
    return {"path": Path(path).relative_to(root).as_posix(), **package.file_identity(path)}


def xml(raw, label):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise Error(label + " contains an external/entity declaration")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise Error("Invalid retained " + label) from exc


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def child_text(node, name, default=None):
    values = [x.text or "" for x in node.iter() if local_name(x.tag) == name]
    if not values:
        return default
    if len(set(values)) != 1:
        raise Error("Contradictory " + name + " values in original XML")
    return values[0]


def _manifest(workspace, verify=False):
    root = Path(workspace).absolute()
    if verify:
        checked = package.verify(root)
        return root, checked["manifest"], checked["manifestSha256"]
    raw = package.regular(root, "manifest.json").read_bytes()
    manifest = package.parse(raw)
    if manifest.get("schema") != package.SCHEMA:
        raise Error("Unsupported prepared Archivematica package")
    return root, manifest, digest(raw)


def _load(workspace, operation_id, verify=False):
    operation_id = token(operation_id)
    root, manifest, manifest_sha = _manifest(workspace, verify)
    directory = root / "operations" / operation_id
    operation = read_json(package.regular(root, "operations/" + operation_id + "/operation.json"))
    if (operation.get("schema") != OP_SCHEMA or operation.get("id") != operation_id
            or operation.get("packageId") != manifest["packageId"]
            or operation.get("manifestSha256") != manifest_sha
            or operation.get("sources") != SOURCES
            or operation.get("configuration") != normalize_configuration(operation.get("configuration"))
            or operation.get("configurationSha256") != digest(encoded(operation["configuration"]))):
        raise Error("Original operation, source or configuration binding changed")
    identifier(operation.get("arrangedSipUuid"), "retained arranged SIP")
    return root, directory, manifest, operation


def plan(workspace, configuration, operation_id):
    configuration = normalize_configuration(configuration)
    operation_id = token(operation_id)
    root = Path(workspace).absolute()
    with package.lock(root):
        _, manifest, manifest_sha = _manifest(root, True)
        directory = folder(root, "operations/" + operation_id)
        expected = {"schema": OP_SCHEMA, "id": operation_id,
                    "packageId": manifest["packageId"], "manifestSha256": manifest_sha,
                    "configuration": configuration,
                    "configurationSha256": digest(encoded(configuration)), "sources": SOURCES}
        path = directory / "operation.json"
        if path.exists():
            existing = read_json(path)
            if any(existing.get(key) != value for key, value in expected.items()):
                raise Error("Original operation already binds a different package or configuration")
            identifier(existing.get("arrangedSipUuid"), "original arranged SIP")
        else:
            expected["arrangedSipUuid"] = str(uuid.uuid4())
            expected["plannedAt"] = stamp()
            package.publish_json(path, expected)
        if not (directory / "state.json").exists():
            package.publish_json(directory / "state.json",
                {"schema": OP_SCHEMA + ".state", "operationId": operation_id,
                 "packageId": manifest["packageId"], "state": "PLANNED", "updatedAt": stamp(),
                 "transferUuid": None, "sipUuid": None, "aipUuid": None, "dipUuids": [],
                 "pendingChoices": [], "pendingBacklog": None})
        return show(root, operation_id)


def show(workspace, operation_id):
    root, directory, manifest, operation = _load(workspace, operation_id)
    state = read_json(package.regular(root, "operations/" + operation["id"] + "/state.json"))
    if (state.get("schema") != OP_SCHEMA + ".state" or state.get("operationId") != operation["id"]
            or state.get("packageId") != manifest["packageId"]):
        raise Error("Original progress identity changed")
    return {"operation": operation, "state": state, "networkRequests": 0, "mutation": False,
            "stateRead": "atomic saved progress; an active writer may advance it"}


class Context:
    def __init__(self, workspace, operation_id, verify=True):
        self.root, self.directory, self.manifest, self.operation = _load(workspace, operation_id, verify)
        self.settings = self.manifest["settings"]
        self.config = self.operation["configuration"]
        self.state = read_json(package.regular(self.root, "operations/" + self.operation["id"] + "/state.json"))
        self.requests = 0
        self.secrets = []

    def save(self, state=None, **values):
        previous = self.state
        if previous.get("state") == "VERIFIED" and state != "VERIFIED":
            values.setdefault("previousVerifiedObservation",
                              {key: previous[key] for key in ("proof", "summary", "updatedAt") if key in previous})
        result = dict(previous)
        if state is not None:
            result["state"] = state
        result.update(values)
        result["updatedAt"] = stamp()
        result["networkRequestsThisCall"] = self.requests
        package.replace_json(self.directory / "state.json", result)
        self.state = result
        return result

    def observe(self, name, value):
        raw = encoded(value)
        path = folder(self.directory, "observations") / (token(name, "observation name") + "-" + digest(raw) + ".json")
        package.publish(path, raw)
        return file_descriptor(self.root, path)

    def secret(self, name, label):
        value = os.environ.get(name)
        if not value or any(c in value for c in "\r\n\x00"):
            raise Pause("CREDENTIALS_REQUIRED", "Supply the configured environment reference for " + label,
                        environmentVariable=name)
        self.secrets.append(value)
        return value

    def redact(self, value):
        if isinstance(value, str):
            for secret in self.secrets:
                if secret:
                    value = value.replace(secret, "[credential omitted]")
            return value
        if isinstance(value, list):
            return [self.redact(x) for x in value]
        if isinstance(value, dict):
            return {k: self.redact(v) for k, v in value.items()
                    if k.lower() not in {"authorization", "cookie", "set-cookie", "api_key", "apikey", "password", "token"}}
        return value

    def url(self, service, path):
        selected = self.config[service]["baseUrl"]
        base = urlsplit(selected)
        if path.startswith(("http://", "https://")):
            url = path
        elif base.path and path.startswith(base.path.rstrip("/") + "/"):
            url = base.scheme + "://" + base.netloc + path
        else:
            url = selected + "/" + path.lstrip("/")
        actual = urlsplit(url)
        if (actual.scheme, actual.hostname, actual.port) != (base.scheme, base.hostname, base.port):
            raise Error("A provider URL left its original authenticated origin")
        prefix = base.path.rstrip("/") + "/"
        if (not actual.path.startswith(prefix) or actual.username is not None
                or actual.password is not None or actual.fragment
                or any(x == ".." for x in unquote(actual.path).split("/"))):
            raise Error("A provider URL left its original service path")
        return url

    def request_description(self, service, path, method="GET", body=None, form=None,
                            session=False, accept="application/json", download=False):
        if body is not None and form is not None:
            raise Error("Request body and form cannot both be selected")
        headers = {"Accept": accept, "Accept-Encoding": "identity"}
        raw = None
        if body is not None:
            raw = encoded(body)
            headers["Content-Type"] = "application/json"
        elif form is not None:
            raw = urlencode(form, doseq=True).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        return {"service": service, "url": self.url(service, path), "method": method,
                "authentication": "dashboard-session" if session else "api-key",
                "headers": headers, "body": None if raw is None else raw.decode("utf-8"),
                "bodyBytes": 0 if raw is None else len(raw),
                "bodySha256": None if raw is None else digest(raw), "download": download}

    def cooldown(self):
        until = self.state.get("retryAfterEpoch")
        if isinstance(until, (int, float)) and until > time.time():
            raise Pause("COOLDOWN", "The original service requested a later observation.",
                        retryAfterEpoch=until)

    def authenticated_headers(self, description):
        service = description["service"]
        session = description["authentication"] == "dashboard-session"
        config = self.config[service]
        headers = dict(description["headers"])
        if session:
            if service != "dashboard" or not config.get("sessionCookieEnv") or not config.get("csrfTokenEnv"):
                raise Pause("SESSION_REQUIRED", "This original Dashboard decision requires an existing session and CSRF references.")
            headers["Cookie"] = self.secret(config["sessionCookieEnv"], "Dashboard session")
            headers["X-CSRFToken"] = self.secret(config["csrfTokenEnv"], "Dashboard CSRF token")
            headers["Referer"] = config["baseUrl"] + "/"
            headers["Origin"] = urlsplit(config["baseUrl"]).scheme + "://" + urlsplit(config["baseUrl"]).netloc
        else:
            key = self.secret(config["apiKeyEnv"], service + " API key")
            headers["Authorization"] = "ApiKey " + config["username"] + ":" + key
        headers["User-Agent"] = "Commons-Archivematica-Original-Receiving/1"
        return headers

    def validate_response_profile(self, description, receipt):
        service = description["service"]
        parsed = urlsplit(description["url"])
        status = receipt.get("status")
        pairs = receipt.get("headers", [])
        if service == "dashboard" and "/api/" in parsed.path and type(status) is int and 200 <= status < 300:
            versions = [v for k, v in pairs if k == "x-archivematica-version"]
            if len(versions) != 1 or not re.fullmatch(r"1\.18\.0(?:[-+ ].*)?", versions[0]):
                raise Pause("DEPLOYMENT_MISMATCH", "Dashboard response does not identify the reviewed 1.18.0 deployment.",
                            observedVersions=versions, response=receipt.get("_receipt"))
            ids = [v for k, v in pairs if k == "x-archivematica-id"]
            if ids and (len(set(ids)) != 1 or identifier(ids[0], "Dashboard identity") != self.settings["pipelineUuid"]):
                raise Error("Dashboard identity differs from the selected original pipeline")

    def request(self, description, wire_directory=None):
        self.cooldown()
        service = description["service"]
        headers = self.authenticated_headers(description)
        if wire_directory is None:
            wire_directory = folder(self.directory, "http/" + str(uuid.uuid4()))
        else:
            wire_directory = folder(self.directory, wire_directory)
        package.publish_json(wire_directory / "request.json", description)
        target_url = self.url(service, description["url"])
        parsed = urlsplit(target_url)
        target = parsed.path + ("?" + parsed.query if parsed.query else "")
        data = None if description["body"] is None else description["body"].encode("utf-8")
        context = ssl.create_default_context(cafile=self.config["caFile"])
        conn = (http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=self.config["timeoutSeconds"],
                                            context=context)
                if parsed.scheme == "https" else
                http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=self.config["timeoutSeconds"]))
        limit = self.config["maxDownloadBytes"] if description["download"] else self.config["maxResponseBytes"]
        raw_path = wire_directory / "body.bin"
        handle = None
        response = None
        started = stamp()
        total, h = 0, hashlib.sha256()
        status, pairs, complete, failure = None, [], False, None
        self.requests += 1
        try:
            # No automatic redirects or request retries are performed.
            conn.request(description["method"], target, body=data, headers=headers)
            response = conn.getresponse()
            status = response.status
            pairs = [(k.lower(), v) for k, v in response.getheaders()]
            content_lengths = [v.strip() for k, v in pairs if k == "content-length"]
            if len(set(content_lengths)) > 1 or any(not re.fullmatch(r"[0-9]+", x) for x in content_lengths):
                raise Error("Contradictory or invalid response Content-Length")
            declared = int(content_lengths[0]) if content_lengths else None
            encodings = [v.lower().strip() for k, v in pairs if k == "transfer-encoding"]
            if encodings and (declared is not None or encodings != ["chunked"]):
                raise Error("Contradictory response framing")
            if declared is not None and declared > limit:
                raise Error("Provider response exceeds the declared receiving limit")
            content_encoding = [v.lower().strip() for k, v in pairs if k == "content-encoding"]
            if content_encoding and content_encoding != ["identity"]:
                raise Error("Unexpected encoded response; exact original bytes require identity encoding")
            safe_headers = [(k, self.redact(v)) for k, v in pairs if k in SAFE_HEADERS]
            package.publish_json(wire_directory / "headers.json",
                                 {"status": status, "headers": safe_headers, "observedAt": stamp()})
            handle = open(raw_path, "xb")
            os.chmod(raw_path, 0o600)
            while True:
                block = response.read(min(262144, limit - total + 1))
                if not block:
                    break
                total += len(block)
                if total > limit:
                    raise Error("Provider response exceeds its receiving limit")
                handle.write(block)
                h.update(block)
            if declared is not None and total != declared:
                raise Error("Provider closed before the declared response length")
            # HTTPResponse.read(amt) may return b'' for a truncated Content-Length.
            if response.length not in (None, 0):
                raise Error("Provider response framing is incomplete")
            handle.flush()
            os.fsync(handle.fileno())
            complete = True
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                failure = type(exc).__name__
                raise
            failure = type(exc).__name__
        finally:
            if handle is not None:
                try:
                    handle.flush()
                    os.fsync(handle.fileno())
                finally:
                    handle.close()
            if response is not None:
                response.close()
            conn.close()
        body_descriptor = None
        if raw_path.exists():
            body_descriptor = file_descriptor(self.root, raw_path)
            # JSON/XML metadata must not retain reflected credentials.
            if not description["download"] and body_descriptor["bytes"] <= self.config["maxResponseBytes"]:
                captured = raw_path.read_bytes()
                if any(secret.encode() in captured for secret in self.secrets if secret):
                    replacement = self.redact(captured.decode("utf-8", "replace")).encode()
                    redacted = wire_directory / "body.redacted.txt"
                    package.publish(redacted, replacement)
                    raw_path.unlink()
                    body_descriptor = {**file_descriptor(self.root, redacted),
                                       "originalSha256": digest(captured), "credentialReflectionRedacted": True}
                    complete = False
                    failure = "CredentialReflectedByProvider"
        receipt = {"schema": OP_SCHEMA + ".http", "requestSha256": digest(encoded(description)),
                   "startedAt": started, "completedAt": stamp(), "status": status,
                   "headers": [(k, self.redact(v)) for k, v in pairs if k in SAFE_HEADERS],
                   "complete": complete, "failure": failure, "body": body_descriptor}
        package.publish_json(wire_directory / "response.json", receipt)
        receipt["_receipt"] = file_descriptor(self.root, wire_directory / "response.json")
        if not complete:
            raise Pause("RESPONSE_INCOMPLETE", "The original response was incomplete; its bytes and request were retained.",
                        response=receipt["_receipt"], failure=failure)
        if status == 429:
            values = [v for k, v in pairs if k == "retry-after"]
            until = retry_after(values[-1] if values else None)
            self.save("COOLDOWN", retryAfterEpoch=until, lastResponse=receipt["_receipt"])
            raise Pause("COOLDOWN", "The service requested a later observation.", retryAfterEpoch=until,
                        response=receipt["_receipt"])
        if 300 <= status < 400:
            raise Pause("REDIRECT_REQUIRES_REVIEW", "The service redirected the original request; credentials were not forwarded.",
                        response=receipt["_receipt"])
        if status in {401, 403}:
            raise Pause("ACCESS_REQUIRED", "The existing service credentials did not authorize this action.",
                        service=service, status=status, response=receipt["_receipt"])
        self.validate_response_profile(description, receipt)
        return receipt

    def response_body(self, receipt):
        descriptor = receipt.get("body")
        if not descriptor:
            return b""
        path = package.regular(self.root, descriptor["path"])
        if package.file_identity(path) != {k: descriptor[k] for k in ("bytes", "sha256")}:
            raise Error("Retained provider response changed")
        return path.read_bytes()

    def json_response(self, receipt, allowed=(200,)):
        if receipt["status"] not in allowed:
            raise Pause("PROVIDER_RESPONSE", "The service has not returned the expected original result.",
                        status=receipt["status"], response=receipt["_receipt"])
        try:
            result = package.parse(self.response_body(receipt))
        except (ValueError, UnicodeError) as exc:
            raise Error("Provider response is not complete valid JSON") from exc
        if isinstance(result, dict) and (result.get("error") is True or result.get("success") is False):
            raise Pause("PROVIDER_REJECTED", "The service rejected the original request.",
                        response=receipt["_receipt"], provider=self.redact(result))
        return result

    def get(self, service, path, allowed=(200,)):
        receipt = self.request(self.request_description(service, path))
        return self.json_response(receipt, allowed), receipt

    def action(self, key, description, expected_status=(200, 201, 202)):
        key = safe_path(key)
        directory = folder(self.directory, "actions/" + key)
        request_sha = digest(encoded(description))
        package.publish_json(directory / "request.json", description)
        terminal = directory / "result.json"
        if terminal.exists():
            result = read_json(terminal)
            if result.get("requestSha256") != request_sha or result.get("state") not in TERMINAL_ACTIONS:
                raise Error("Original action result changed")
            return result
        started = directory / "started.json"
        if started.exists():
            self.recover_action_response(key, description, expected_status)
            if terminal.exists():
                return read_json(terminal)
            raise Pause("RECONCILIATION_REQUIRED", "Reconcile the retained original action before continuing.",
                        actionKey=key, requestSha256=request_sha)
        # Resolve selected credentials before publishing a dispatch marker.
        self.cooldown()
        self.authenticated_headers(description)
        wire = "http/" + str(uuid.uuid4())
        package.publish_json(started, {"schema": OP_SCHEMA + ".dispatch", "actionKey": key,
                                     "requestSha256": request_sha, "wireDirectory": wire,
                                     "dispatchedAt": stamp()})
        self.save("DISPATCHING", actionKey=key, requestSha256=request_sha)
        try:
            receipt = self.request(description, wire)
        except Pause as paused:
            raise Pause("RECONCILIATION_REQUIRED",
                        "The original action was entered but has no accepted response; reconcile that action before continuing.",
                        actionKey=key, requestSha256=request_sha, causeState=paused.state,
                        cause=paused.details) from paused
        return self.complete_action(key, description, receipt, expected_status)

    def complete_action(self, key, description, receipt, expected_status, adopted=False, evidence=None):
        if not receipt.get("complete") or receipt["status"] not in expected_status:
            raise Pause("RECONCILIATION_REQUIRED", "The original action has no accepted terminal response.",
                        actionKey=key, requestSha256=digest(encoded(description)), response=receipt.get("_receipt"))
        self.validate_response_profile(description, receipt)
        raw = self.response_body(receipt)
        if raw.strip():
            try:
                body = package.parse(raw)
            except (ValueError, UnicodeError):
                body = raw.decode("utf-8", "strict")
        else:
            body = None
        if isinstance(body, dict) and (body.get("error") is True or (body.get("success") is False and key != "fixity/aip")):
            raise Pause("PROVIDER_REJECTED", "The original action was rejected.", actionKey=key,
                        provider=self.redact(body))
        result = {"schema": OP_SCHEMA + ".action", "actionKey": key,
                  "requestSha256": digest(encoded(description)),
                  "state": "ADOPTED" if adopted else "CONFIRMED",
                  "status": receipt["status"], "body": body,
                  "response": receipt.get("_receipt"), "recordedAt": stamp()}
        if evidence:
            result["evidence"] = evidence
        package.publish_json(folder(self.directory, "actions/" + key) / "result.json", result)
        return result

    def recover_action_response(self, key, description, expected_status):
        directory = self.directory / "actions" / key
        started = read_json(directory / "started.json")
        if started["requestSha256"] != digest(encoded(description)):
            raise Error("Original started action request changed")
        wire = self.directory / safe_path(started["wireDirectory"])
        if not (wire / "response.json").exists():
            return
        receipt = read_json(wire / "response.json")
        if receipt.get("requestSha256") != started["requestSha256"]:
            raise Error("Original response request identity changed")
        receipt["_receipt"] = file_descriptor(self.root, wire / "response.json")
        if receipt.get("complete") and receipt.get("status") in expected_status:
            self.complete_action(key, description, receipt, expected_status, adopted=True)

    def action_result(self, key):
        path = self.directory / "actions" / safe_path(key) / "result.json"
        return read_json(path) if path.exists() else None


def retry_after(value):
    if value and re.fullmatch(r"[0-9]+", value.strip()):
        return time.time() + min(86400, int(value.strip()))
    if value:
        try:
            parsed = email.utils.parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return max(time.time(), min(time.time() + 86400, parsed.timestamp()))
        except (ValueError, TypeError):
            pass
    return time.time() + 60


def relation_uuid(ctx, value, resource):
    if isinstance(value, dict):
        value = value.get("resource_uri")
    if not isinstance(value, str):
        raise Error("Missing Storage Service " + resource + " relation")
    parsed = urlsplit(ctx.url("storage", value))
    prefix = urlsplit(ctx.config["storage"]["baseUrl"]).path.rstrip("/") + "/api/v2/" + resource + "/"
    if not parsed.path.startswith(prefix) or parsed.query:
        raise Error("Unexpected Storage Service relation path")
    tail = parsed.path[len(prefix):].strip("/")
    return identifier(tail, resource)


def model_location(ctx, location_id, purpose):
    model, receipt = ctx.get("storage", "/api/v2/location/" + location_id + "/")
    if (not isinstance(model, dict) or identifier(model.get("uuid"), "location") != location_id
            or model.get("purpose") != purpose or model.get("enabled") is not True):
        raise Error("Selected Storage Service location identity, purpose or enabled state differs")
    pipelines = model.get("pipeline")
    if not isinstance(pipelines, list) or ctx.settings["pipelineUuid"] not in {
            relation_uuid(ctx, x, "pipeline") for x in pipelines}:
        raise Error("Selected location does not belong to the original pipeline")
    return model, receipt


def paginated(ctx, path, resource, limit=30000):
    result, seen, next_url = [], set(), path
    while next_url:
        url = ctx.url("storage", next_url)
        parsed = urlsplit(url)
        expected = urlsplit(ctx.config["storage"]["baseUrl"]).path.rstrip("/") + "/api/v2/" + resource + "/"
        if parsed.path != expected or url in seen:
            raise Error("Storage pagination changed its original endpoint or repeated a page")
        seen.add(url)
        value, receipt = ctx.get("storage", url)
        if not isinstance(value, dict) or not isinstance(value.get("objects"), list) or not isinstance(value.get("meta"), dict):
            raise Error("Storage Service did not return its paginated collection envelope")
        result.extend(value["objects"])
        if len(result) > limit:
            raise Error("Storage collection exceeds the receiving inventory limit")
        next_url = value["meta"].get("next")
        if next_url is not None and not isinstance(next_url, str):
            raise Error("Invalid Storage Service next-page relation")
    return result


def b64(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def decode_browse(value):
    if not isinstance(value, dict) or not isinstance(value.get("entries"), list) or not isinstance(value.get("directories"), list):
        raise Error("Invalid original directory listing")
    def decode(item):
        try:
            result = base64.b64decode(item, validate=True).decode("utf-8")
        except (ValueError, UnicodeError, TypeError):
            raise Error("Invalid base64 directory entry") from None
        if not result or result in {".", ".."} or any(c in result for c in "/\\\x00"):
            raise Error("Directory listing contains a non-child path")
        return result
    entries, directories = [decode(x) for x in value["entries"]], [decode(x) for x in value["directories"]]
    if len(entries) != len(set(entries)) or not set(directories) <= set(entries):
        raise Error("Repeated or contradictory directory entries")
    properties = {decode(k): v for k, v in value.get("properties", {}).items()}
    return {"entries": entries, "directories": directories, "properties": properties}


def preflight(ctx):
    pipeline_id = ctx.settings["pipelineUuid"]
    pipeline, pipeline_receipt = ctx.get("storage", "/api/v2/pipeline/" + pipeline_id + "/")
    if not isinstance(pipeline, dict) or identifier(pipeline.get("uuid"), "pipeline") != pipeline_id:
        raise Error("Storage pipeline identity differs")
    locations = {}
    selected = [("transferSource", ctx.settings["transferSource"]["locationUuid"], "TS"),
                ("aip", ctx.settings["aipLocationUuid"], "AS")]
    for label, owner, purpose in (("dip", "dip", "DS"), ("backlog", "backlog", "BL")):
        value = ctx.settings[owner]["locationUuid"]
        if value:
            selected.append((label, value, purpose))
    for label, location_id, purpose in selected:
        model, receipt = model_location(ctx, location_id, purpose)
        locations[label] = {"model": model, "response": receipt["_receipt"]}
    configs, config_receipt = ctx.get("dashboard", "/api/processing-configuration")
    name = ctx.settings["processingConfiguration"]
    if not isinstance(configs, dict) or name not in configs.get("processing_configurations", []):
        raise Pause("PROCESSING_CONFIGURATION_REQUIRED", "The selected existing processing configuration was not listed.",
                    processingConfiguration=name, response=config_receipt["_receipt"])
    # This released GET can regenerate a missing built-in configuration. It is
    # restricted to the entered run and preceded by the original listing.
    description = ctx.request_description("dashboard", "/api/processing-configuration/" + quote(name, safe=""),
                                          accept="application/xml")
    receipt = ctx.request(description)
    if receipt["status"] != 200:
        raise Pause("PROCESSING_CONFIGURATION_REQUIRED", "The original selected configuration could not be read.",
                    response=receipt["_receipt"])
    config_raw = ctx.response_body(receipt)
    xml(config_raw, "processing configuration")
    binding = {"schema": OP_SCHEMA + ".provider-binding", "packageId": ctx.manifest["packageId"],
               "pipelineUuid": pipeline_id, "pipeline": pipeline,
               "pipelineResponse": pipeline_receipt["_receipt"],
               "locations": locations, "processingConfiguration": name,
               "processingConfigurationFile": receipt["body"],
               "processingConfigurationSha256": digest(config_raw),
               "processingConfigurationScope": "The existing XML was observed before start. The released "
                     "server can fall back to default if the selected name disappears before creation; "
                     "this read is not a server-side applied-configuration attestation.",
               "deployment": ctx.config["deployment"],
               "storageVersionScope": "Selected released deployment supplied by the operator; Storage "
                                      "Service does not expose a version header on this resource.",
               "observedAt": stamp()}
    current = ctx.directory / "provider-binding.json"
    if current.exists():
        original = read_json(current)
        for field in ("pipelineUuid", "processingConfiguration", "processingConfigurationSha256", "deployment"):
            if original.get(field) != binding[field]:
                raise Error("The original provider selection changed before transfer dispatch")
        for label, location_id, purpose in selected:
            saved = original.get("locations", {}).get(label, {}).get("model", {})
            if saved.get("uuid") != location_id or saved.get("purpose") != purpose:
                raise Error("The original location selection changed")
        return original
    package.publish_json(current, binding)
    return binding


def stage_original(ctx, binding):
    source_root_string = os.environ.get(ctx.config["transferSourceRootEnv"])
    if not source_root_string or not Path(source_root_string).is_absolute():
        raise Pause("SOURCE_LOCATION_REQUIRED", "Supply the actual authorized source-location directory.",
                    environmentVariable=ctx.config["transferSourceRootEnv"])
    source_root = Path(source_root_string)
    if source_root.is_symlink() or not source_root.is_dir():
        raise Error("Transfer source root must be an existing original directory")
    relative = safe_path(ctx.settings["transferSource"]["relativePath"])
    parent = source_root
    for part in relative.split("/")[:-1]:
        parent /= part
        if parent.is_symlink():
            raise Error("A transfer source subdirectory is a symlink")
        parent.mkdir(mode=0o750, exist_ok=True)
        if not parent.is_dir():
            raise Error("Transfer source parent is not a directory")
    target = parent / relative.split("/")[-1]
    wanted = {key: ctx.manifest["originalBag"][key] for key in ("bytes", "sha256")}
    original = package.regular(ctx.root, "source/bag.zip")
    if target.exists():
        if target.is_symlink() or package.file_identity(target) != wanted:
            raise Error("The reviewed transfer-source path contains different original bytes")
    else:
        fd, temporary = tempfile.mkstemp(prefix=".commons-archivematica-stage-", dir=parent)
        try:
            with os.fdopen(fd, "wb") as output, open(original, "rb") as source:
                os.fchmod(output.fileno(), 0o640)
                h, count = hashlib.sha256(), 0
                for block in iter(lambda: source.read(262144), b""):
                    output.write(block)
                    h.update(block)
                    count += len(block)
                output.flush()
                os.fsync(output.fileno())
            if {"bytes": count, "sha256": h.hexdigest()} != wanted:
                raise Error("The original BagIt changed while staging")
            try:
                os.link(temporary, target, follow_symlinks=False)
            except FileExistsError:
                if target.is_symlink() or package.file_identity(target) != wanted:
                    raise Error("A different transfer source appeared while staging")
            package.fsync_directory(parent)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    if package.file_identity(target) != wanted:
        raise Error("Staged original source changed before the transfer request")
    location_id = ctx.settings["transferSource"]["locationUuid"]
    parent_relative = str(PurePosixPath(relative).parent)
    if parent_relative == ".":
        parent_relative = ""
    listing, receipt = ctx.get("storage", "/api/v2/location/" + location_id
                               + "/browse/?" + urlencode({"path": b64(parent_relative)}))
    listing = decode_browse(listing)
    if target.name not in listing["entries"] or target.name in listing["directories"]:
        raise Pause("SOURCE_LOCATION_REQUIRED", "The configured Storage Service source location did not show the staged original ZIP.",
                    locationUuid=location_id, relativePath=relative, response=receipt["_receipt"])
    identity = {"schema": OP_SCHEMA + ".staged-source", "packageId": ctx.manifest["packageId"],
                "locationUuid": location_id, "relativePath": relative, **wanted,
                "localRoot": str(source_root), "localPath": str(target),
                "storageLocationPath": binding["locations"]["transferSource"]["model"].get("path"),
                "scope": "Exact local/mounted original ZIP and selected Storage listing. Final received "
                         "AIP content establishes original source delivery to the selected pipeline.",
                "sourceListing": receipt["_receipt"]}
    path = ctx.directory / "staged-source.json"
    if path.exists():
        saved = read_json(path)
        for key in ("packageId", "locationUuid", "relativePath", "bytes", "sha256"):
            if saved.get(key) != identity[key]:
                raise Error("Original staged-source binding changed")
    else:
        package.publish_json(path, identity)
    return identity


def transfer_request(ctx):
    source = ctx.settings["transferSource"]
    body = {"name": ctx.settings["name"], "type": "zipped bag",
            "accession": ctx.settings["accession"], "access_system_id": ctx.settings["accessSystemId"],
            "path": b64(source["locationUuid"] + ":" + source["relativePath"]),
            "auto_approve": False, "processing_config": ctx.settings["processingConfiguration"]}
    return ctx.request_description("dashboard", "/api/v2beta/package", "POST", body=body)


def start_transfer(ctx):
    result = ctx.action("start-transfer", transfer_request(ctx), (202,))
    if not isinstance(result["body"], dict):
        raise Error("Original package creation response has no transfer ID")
    transfer_id = identifier(result["body"].get("id"), "original transfer")
    if ctx.state.get("transferUuid") not in (None, transfer_id):
        raise Error("The original transfer UUID changed")
    ctx.save("TRANSFER_STARTED", transferUuid=transfer_id, actionKey=None)
    return transfer_id


def unit_status(ctx, unit_id, unit_type):
    path = "/api/" + ("transfer" if unit_type == "Transfer" else "ingest") + "/status/" + unit_id + "/"
    receipt = ctx.request(ctx.request_description("dashboard", path))
    if receipt["status"] == 400:
        raise Pause("WAITING_UNIT", "The original unit has not produced its first status yet.",
                    unitUuid=unit_id, response=receipt["_receipt"])
    value = ctx.json_response(receipt)
    if (not isinstance(value, dict) or identifier(value.get("uuid"), "status unit") != unit_id
            or value.get("type") != ("transfer" if unit_type == "Transfer" else "SIP")
            or value.get("status") not in {"PROCESSING", "COMPLETE", "FAILED", "REJECTED", "USER_INPUT"}):
        raise Error("Dashboard status identity or state differs from its original unit")
    return value, receipt


def unit_jobs(ctx, unit_id):
    value, receipt = ctx.get("dashboard", "/api/v2beta/jobs/" + unit_id + "?detailed")
    if not isinstance(value, list) or len(value) > 30000:
        raise Error("Invalid original unit job inventory")
    for item in value:
        if not isinstance(item, dict):
            raise Error("Invalid original job row")
        identifier(item.get("uuid"), "original job")
    return value, receipt


def read_choices(ctx, unit_id, unit_type):
    if not ctx.config["dashboard"]["sessionCookieEnv"]:
        return [], None
    desc = ctx.request_description("dashboard", "/mcp/list/", session=True, accept="application/xml")
    receipt = ctx.request(desc)
    if receipt["status"] != 200:
        raise Pause("SESSION_REQUIRED", "The original processing choices require a current Dashboard session.",
                    response=receipt["_receipt"])
    root = xml(ctx.response_body(receipt), "Dashboard processing choices")
    if local_name(root.tag) != "MCP":
        raise Error("The Dashboard returned a different choices document")
    result, jobs_seen = [], set()
    for entry in root:
        if local_name(entry.tag) != "choicesAvailableForUnit":
            continue
        unit = entry.find("unit")
        unit_xml = None if unit is None else unit.find("unitXML")
        if unit_xml is None or unit is None:
            raise Error("A processing choice lacks its original unit")
        observed_id = unit_xml.findtext("UUID")
        if observed_id != unit_id:
            continue
        if unit.findtext("type") != unit_type:
            raise Error("Processing choice type differs from the original unit")
        job_id = identifier(entry.findtext("UUID"), "choice job")
        if job_id in jobs_seen:
            raise Error("Duplicate original waiting job")
        jobs_seen.add(job_id)
        choices = []
        for option in entry.findall("choices/choice"):
            choice_id = one_line(option.findtext("chainAvailable"), "original choice ID", 255)
            label = text(option.findtext("description", ""), "original choice label", 10000)
            if choice_id in {x["choiceId"] for x in choices}:
                raise Error("Repeated original choice ID")
            choices.append({"choiceId": choice_id, "label": label})
        result.append({"kind": "processing-choice", "unitUuid": unit_id,
                       "unitType": unit_type, "jobUuid": job_id, "choices": choices,
                       "observation": receipt["body"], "response": receipt["_receipt"]})
    if result:
        history, history_receipt = unit_jobs(ctx, unit_id)
        labels = {}
        for job in history:
            job_id = job["uuid"]
            if job_id in labels:
                raise Error("Original unit history repeats a processing job")
            labels[job_id] = job
        for selected in result:
            job = labels.get(selected["jobUuid"])
            if job is not None and isinstance(job.get("name"), str):
                selected["label"] = text(job["name"], "original processing question", 10000)
                selected["labelResponse"] = history_receipt["_receipt"]
                selected["microservice"] = text(job.get("microservice") or "", "original microservice label", 10000)
    return result, receipt


def approve_original(ctx, transfer_id):
    directory = ctx.directory / "actions" / "approve-transfer"
    if (directory / "request.json").exists():
        description = read_json(directory / "request.json")
        result = ctx.action("approve-transfer", description, (200,))
        if not isinstance(result["body"], dict) or identifier(result["body"].get("uuid"), "approved transfer") != transfer_id:
            raise Error("Original approval returned a different transfer UUID")
        return
    value, receipt = ctx.get("dashboard", "/api/transfer/unapproved/")
    if not isinstance(value, dict) or not isinstance(value.get("results"), list):
        raise Error("Invalid original unapproved transfer inventory")
    matches = [row for row in value["results"] if row.get("uuid") == transfer_id]
    if len(matches) > 1:
        raise Error("Duplicate original transfer approval entries")
    if not matches:
        return
    row = matches[0]
    if row.get("type") != "zipped bag":
        raise Error("The original transfer has a different approval type")
    selected_directory = one_line(row.get("directory"), "original approval directory", 4096)
    if selected_directory.startswith("/") or ".." in selected_directory.split("/") or "\\" in selected_directory:
        raise Error("Unsafe provider approval directory")
    package.publish_json(directory.parent / "original-unapproved-transfer.json",
                         {"transferUuid": transfer_id, "entry": row, "response": receipt["_receipt"]})
    description = ctx.request_description("dashboard", "/api/transfer/approve/", "POST",
                                          form={"directory": selected_directory, "type": "zipped bag"})
    result = ctx.action("approve-transfer", description, (200,))
    if not isinstance(result["body"], dict) or identifier(result["body"].get("uuid"), "approved transfer") != transfer_id:
        raise Error("Original approval returned a different transfer UUID")


def storage_package(ctx, package_id, kind, location=None, allow_missing=False):
    receipt = ctx.request(ctx.request_description("storage", "/api/v2/file/" + package_id + "/"))
    if receipt["status"] == 404 and allow_missing:
        return None, receipt
    model = ctx.json_response(receipt)
    if (not isinstance(model, dict) or identifier(model.get("uuid"), "stored package") != package_id
            or model.get("package_type") != kind
            or relation_uuid(ctx, model.get("origin_pipeline"), "pipeline") != ctx.settings["pipelineUuid"]):
        raise Error("Stored package identity/type/original pipeline differs")
    actual_location = relation_uuid(ctx, model.get("current_location"), "location")
    if location and actual_location != location:
        raise Error("Original stored package is outside the selected receiving location")
    return model, receipt


def storage_contents(ctx, package_id, required_source_package=None):
    value, receipt = ctx.get("storage", "/api/v2/file/" + package_id + "/contents/")
    if (not isinstance(value, dict) or value.get("success") is not True
            or identifier(value.get("package"), "contents package") != package_id
            or not isinstance(value.get("files"), list) or len(value["files"]) > 30000):
        raise Error("Stored package contents do not bind the original package")
    ids = set()
    for item in value["files"]:
        if not isinstance(item, dict):
            raise Error("Invalid original package content row")
        file_id = one_line(item.get("source_id"), "stored source file identity", 4096)
        if required_source_package is not None:
            identifier(file_id, "original backlog file")
            if file_id in ids:
                raise Error("Repeated original backlog file identity")
            if identifier(item.get("source_package"), "original backlog source package") != required_source_package:
                raise Error("Backlog file belongs to another original transfer")
            if item.get("origin") not in (None, "") and identifier(item["origin"], "backlog content origin") != ctx.settings["pipelineUuid"]:
                raise Error("Backlog file origin differs from selected Dashboard")
        ids.add(file_id)
        for field in ("source_package", "origin"):
            if item.get(field) is not None:
                one_line(item[field], "observed Storage " + field, 4096, False)
        one_line(item.get("name"), "stored file name", 4096)
        if item.get("checksum") is not None and not isinstance(item.get("checksum"), str):
            raise Error("Invalid nullable Storage checksum")
    return value, receipt

def observe_workflow(ctx):
    transfer_id = ctx.state.get("transferUuid")
    if transfer_id is None:
        action = ctx.action_result("start-transfer")
        if action:
            transfer_id = identifier(action.get("body", {}).get("id"), "retained transfer")
            ctx.save(transferUuid=transfer_id)
        else:
            return ctx.save("PLANNED")
    transfer, transfer_receipt = unit_status(ctx, transfer_id, "Transfer")
    ctx.save(transfer=transfer, transferResponse=transfer_receipt["_receipt"],
             transferDirectory=transfer.get("directory"), pendingChoices=[], pendingBacklog=None)
    if transfer["status"] in {"FAILED", "REJECTED"}:
        return ctx.save("TRANSFER_" + transfer["status"])
    sip_id = ctx.state.get("sipUuid")
    observed_sip = transfer.get("sip_uuid")
    if observed_sip and observed_sip != "BACKLOG":
        observed_sip = identifier(observed_sip, "original SIP")
        if sip_id not in (None, observed_sip):
            raise Error("The original transfer returned a different SIP")
        sip_id = observed_sip
        ctx.save(sipUuid=sip_id)
    if observed_sip == "BACKLOG" and sip_id is None:
        return observe_backlog(ctx, transfer, transfer_receipt)
    if transfer["status"] == "USER_INPUT" and sip_id is None:
        choices, receipt = read_choices(ctx, transfer_id, "Transfer")
        return ctx.save("WAITING_FOR_DECISION", pendingChoices=choices,
                        message="Select one original observed processing choice."
                        if choices else "Open the existing Dashboard session to read the original choices.")
    if sip_id is None:
        return ctx.save("WAITING_SIP" if transfer["status"] == "COMPLETE" else "TRANSFER_PROCESSING",
                        message="Transfer completion and SIP assignment are separate observations.")
    sip, sip_receipt = unit_status(ctx, sip_id, "SIP")
    ctx.save(sip=sip, sipResponse=sip_receipt["_receipt"])
    if sip["status"] in {"FAILED", "REJECTED"}:
        return ctx.save("INGEST_" + sip["status"])
    if sip["status"] == "USER_INPUT":
        choices, receipt = read_choices(ctx, sip_id, "SIP")
        return ctx.save("WAITING_FOR_DECISION", pendingChoices=choices)
    if sip["status"] != "COMPLETE":
        return ctx.save("INGESTING")
    aip, receipt = storage_package(ctx, sip_id, "AIP", ctx.settings["aipLocationUuid"], True)
    if aip is None or aip.get("status") != "UPLOADED":
        return ctx.save("WAITING_AIP", aipUuid=sip_id, aip=aip, aipResponse=receipt["_receipt"])
    contents, contents_receipt = storage_contents(ctx, sip_id)
    ctx.save(aipUuid=sip_id, aip=aip, aipResponse=receipt["_receipt"],
             aipContents=contents, aipContentsResponse=contents_receipt["_receipt"])
    dips = related_dips(ctx, aip)
    ctx.save(dipUuids=[x["model"]["uuid"] for x in dips], dips=dips)
    if ctx.settings["dip"]["policy"] == "required" and not dips:
        return ctx.save("WAITING_DIP", message="The original required DIP is not yet stored and related to the AIP.")
    if ctx.state.get("proof"):
        validate_saved_proof(ctx)
        return ctx.save("VERIFIED", pendingChoices=[], pendingBacklog=None)
    return ctx.save("READY_TO_VERIFY", message="Run the original receiving operation to retrieve and verify its AIP/DIP bytes.")


def related_dips(ctx, aip):
    policy = ctx.settings["dip"]["policy"]
    if policy == "not-requested":
        return []
    relations = aip.get("related_packages")
    if not isinstance(relations, list):
        raise Error("Original AIP has no related-package inventory")
    result = []
    seen = set()
    for relation in relations:
        related_id = relation_uuid(ctx, relation, "file")
        if related_id == aip["uuid"] or related_id in seen:
            raise Error("Invalid repeated or self-related stored package")
        seen.add(related_id)
        receipt = ctx.request(ctx.request_description("storage", "/api/v2/file/" + related_id + "/"))
        if receipt["status"] == 404:
            continue
        model = ctx.json_response(receipt)
        if model.get("package_type") != "DIP":
            continue
        if (identifier(model.get("uuid"), "DIP") != related_id
                or relation_uuid(ctx, model.get("origin_pipeline"), "pipeline") != ctx.settings["pipelineUuid"]
                or aip["uuid"] not in {relation_uuid(ctx, x, "file") for x in model.get("related_packages", [])}):
            raise Error("DIP does not preserve the original symmetric AIP/pipeline relationship")
        location = relation_uuid(ctx, model.get("current_location"), "location")
        if ctx.settings["dip"]["locationUuid"] and location != ctx.settings["dip"]["locationUuid"]:
            raise Error("Original related DIP differs from the selected DIP location")
        model_location(ctx, location, "DS")
        if model.get("status") != "UPLOADED":
            continue
        contents, contents_receipt = storage_contents(ctx, related_id)
        result.append({"model": model, "response": receipt["_receipt"],
                       "contents": contents, "contentsResponse": contents_receipt["_receipt"]})
    return result


def observe_backlog(ctx, transfer, transfer_receipt):
    if ctx.settings["backlog"]["policy"] != "arrange":
        return ctx.save("BACKLOG", message="The original transfer is in backlog. The reviewed policy pauses here.",
                        pendingBacklog=None)
    transfer_id = ctx.state["transferUuid"]
    location_id = ctx.settings["backlog"]["locationUuid"]
    model, receipt = storage_package(ctx, transfer_id, "transfer", location_id, True)
    if model is None or model.get("status") != "UPLOADED":
        return ctx.save("WAITING_BACKLOG", backlogPackage=model, backlogResponse=receipt["_receipt"])
    contents, contents_receipt = storage_contents(ctx, transfer_id, required_source_package=transfer_id)
    current_path = safe_path(model.get("current_path"))
    parts = current_path.split("/")
    if len(parts) != 2 or parts[0] != "originals":
        raise Error("The released backlog package is not in its recorded originals/<transfer> location")
    transfer_name = parts[1]
    if not transfer_name.endswith("-" + transfer_id):
        raise Error("Backlog basename does not preserve the original transfer UUID")
    location_list = paginated(ctx, "/api/v2/location/?" + urlencode(
        {"pipeline__uuid": ctx.settings["pipelineUuid"], "purpose": "BL", "offset": 0}), "location")
    if not location_list or location_list[0].get("uuid") != location_id:
        raise Error("The reviewed backlog is not this Dashboard's original first BL location")
    source_path = "/" + current_path + "/data/objects/"
    listing, listing_receipt = ctx.get("storage", "/api/v2/location/" + location_id + "/browse/?"
        + urlencode({"path": b64(current_path + "/data")}))
    listing = decode_browse(listing)
    if "objects" not in listing["directories"]:
        raise Error("The original BagIt backlog listing has no recorded objects directory")
    prefix = transfer_name + "/data/objects/"
    files = []
    for row in contents["files"]:
        if row["name"].startswith(prefix):
            relative = safe_path(row["name"][len(prefix):])
            files.append({"relativePath": relative, "fileUuid": row["source_id"],
                          "sourcePath": "/originals/" + row["name"],
                          "sourcePackage": row["source_package"], "checksum": row.get("checksum")})
    if not files or len({x["relativePath"] for x in files}) != len(files):
        raise Error("Original backlog contents lack a unique object inventory")
    observation_value = {"schema": OP_SCHEMA + ".backlog-observation",
                         "transferUuid": transfer_id, "packageUuid": model["uuid"],
                         "sourcePath": source_path, "currentPath": current_path,
                         "transferBasename": transfer_name, "locationUuid": location_id,
                         "files": sorted(files, key=lambda x: x["relativePath"]),
                         "packageResponse": receipt["_receipt"],
                         "contentsResponse": contents_receipt["_receipt"],
                         "listingResponse": listing_receipt["_receipt"],
                         "transferResponse": transfer_receipt["_receipt"]}
    observation = ctx.observe("backlog", observation_value)
    return ctx.save("BACKLOG", backlogPackage=model,
                    transferDirectory=transfer_name,
                    pendingBacklog={**observation_value, "observation": observation,
                                    "arrangedSipUuid": ctx.operation["arrangedSipUuid"]},
                    message="Select the original backlog contents and an explicit new arrangement path.")


def arrangement_path(value):
    value = one_line(value, "arrangement path", 4096)
    if not value.startswith("/arrange/") or not value.endswith("/"):
        raise Error("Enter an explicit /arrange/<name>/ directory")
    name = value[len("/arrange/"):-1]
    if not name or "/" in name or "\\" in name or name in {".", ".."}:
        raise Error("Select one named arrangement directory")
    return value


def arrangement_listing(ctx, path, allow_missing=False):
    desc = ctx.request_description("dashboard", "/filesystem/contents/arrange/?"
                                    + urlencode({"path": b64(path)}), session=True)
    receipt = ctx.request(desc)
    if receipt["status"] == 404 and allow_missing:
        return None, receipt
    value = ctx.json_response(receipt)
    return decode_browse(value), receipt


def arranged_files(ctx, path):
    found, pending, count = {}, [("", path)], 0
    receipts = []
    while pending:
        relative_parent, current = pending.pop()
        if len(PurePosixPath(relative_parent).parts) > 64:
            raise Error("Arrangement is deeper than the original receiving limit")
        listing, receipt = arrangement_listing(ctx, current)
        receipts.append(receipt["_receipt"])
        for name in sorted(listing["entries"]):
            relative = relative_parent + name
            if name in listing["directories"]:
                pending.append((relative + "/", current + name + "/"))
            else:
                props = listing["properties"].get(name, {})
                file_id = identifier(props.get("file_uuid"), "arranged original file")
                if relative in found:
                    raise Error("Repeated original arranged file")
                found[relative] = file_id
                count += 1
                if count > 30000:
                    raise Error("Arrangement exceeds the original receiving inventory")
    return found, receipts


def adopt_observed_action(ctx, key, description, body, evidence, status=200):
    directory = ctx.directory / "actions" / safe_path(key)
    started = read_json(directory / "started.json")
    request_sha = digest(encoded(description))
    if started.get("requestSha256") != request_sha:
        raise Error("Observed action does not bind the original dispatch")
    result = {"schema": OP_SCHEMA + ".action", "actionKey": key, "requestSha256": request_sha,
              "state": "ADOPTED", "status": status, "body": body,
              "response": None, "evidence": evidence,
              "scope": "Original dispatched action reconciled from its explicitly bound current native result.",
              "recordedAt": stamp()}
    path = directory / "result.json"
    if path.exists():
        original = read_json(path)
        if any(original.get(k) != result[k] for k in ("actionKey", "requestSha256", "status", "body")):
            raise Error("Original observed action result differs")
        return original
    package.publish_json(path, result)
    return result


def continue_arrangement(ctx, chosen):
    original = chosen["backlog"]
    path = chosen["decision"]["arrangePath"]
    expected = {row["relativePath"]: row["fileUuid"] for row in original["files"]}
    create_desc = ctx.request_description("dashboard", "/filesystem/create_directory_within_arrange/",
                                         "POST", form=[("paths[]", b64(path))], session=True)
    copy_desc = ctx.request_description("dashboard", "/filesystem/copy_to_arrange/", "POST",
                                       form={"filepath": b64(original["sourcePath"]), "destination": b64(path)},
                                       session=True)
    create_key, copy_key, sip_key = "backlog/create-directory", "backlog/copy-original", "backlog/create-sip"
    sip_desc = ctx.request_description("dashboard", "/filesystem/copy_from_arrange/", "POST",
                                      form={"filepath": b64(path), "uuid": ctx.operation["arrangedSipUuid"]},
                                      session=True)
    # A returned or observed original SIP is sufficient to reopen its processing.
    sip_result = ctx.action_result(sip_key)
    sip_started = ctx.directory / "actions" / sip_key / "started.json"
    if sip_result is None and sip_started.exists():
        ctx.recover_action_response(sip_key, sip_desc, (201,))
        sip_result = ctx.action_result(sip_key)
        if sip_result is None:
            try:
                observed, receipt = unit_status(ctx, ctx.operation["arrangedSipUuid"], "SIP")
            except Pause as exc:
                if exc.state != "WAITING_UNIT":
                    raise
            else:
                sip_result = adopt_observed_action(ctx, sip_key, sip_desc,
                    {"sip_uuid": ctx.operation["arrangedSipUuid"]},
                    {"status": receipt["_receipt"], "originalArrangement": chosen["observation"]}, 201)
    if sip_result:
        returned = identifier(sip_result.get("body", {}).get("sip_uuid"), "original arranged SIP")
        if returned != ctx.operation["arrangedSipUuid"]:
            raise Error("Arrangement returned another SIP UUID")
        ctx.save("INGESTING", sipUuid=returned, pendingBacklog=None)
        return observe_workflow(ctx)
    created = ctx.action_result(create_key)
    if not created:
        started = ctx.directory / "actions" / create_key / "started.json"
        if started.exists():
            ctx.recover_action_response(create_key, create_desc, (201,))
            created = ctx.action_result(create_key)
            if created is None:
                value, receipt = arrangement_listing(ctx, path, True)
                if value is not None:
                    created = adopt_observed_action(ctx, create_key, create_desc,
                        {"message": "Original arrangement directory observed"},
                        {"listing": receipt["_receipt"], "originalEmptyObservation": chosen["emptyObservation"]}, 201)
        if created is None:
            value, receipt = arrangement_listing(ctx, path, True)
            if value is not None:
                raise Error("The selected arrangement appeared before its original create action")
            ctx.action(create_key, create_desc, (201,))
    copied = ctx.action_result(copy_key)
    copy_started = ctx.directory / "actions" / copy_key / "started.json"
    if copied is None and copy_started.exists():
        ctx.recover_action_response(copy_key, copy_desc, (201,))
        copied = ctx.action_result(copy_key)
        if copied is None:
            actual, receipts = arranged_files(ctx, path)
            if actual == expected:
                copied = adopt_observed_action(ctx, copy_key, copy_desc,
                    {"message": "All original arranged File UUIDs observed"},
                    {"listings": receipts, "expectedFiles": expected,
                     "originalBacklog": original["observation"]}, 201)
            else:
                raise Pause("RECONCILIATION_REQUIRED", "The original copy has no complete matching arrangement.",
                            actionKey=copy_key, requestSha256=digest(encoded(copy_desc)))
    if copied is None:
        actual, receipts = arranged_files(ctx, path)
        if actual:
            raise Error("Original arrangement is not empty before its one copy action")
        ctx.action(copy_key, copy_desc, (201,))
    actual, receipts = arranged_files(ctx, path)
    if actual != expected:
        raise Error("The original arrangement contains missing, changed or additional File UUIDs")
    proof = ctx.observe("arrangement", {"path": path, "files": actual, "listings": receipts,
                                      "backlog": original["observation"]})
    sip_result = ctx.action(sip_key, sip_desc, (201,))
    returned = identifier(sip_result.get("body", {}).get("sip_uuid"), "original arranged SIP")
    if returned != ctx.operation["arrangedSipUuid"]:
        raise Error("Original arrangement returned another SIP")
    ctx.save("INGESTING", sipUuid=returned, pendingBacklog=None, arrangementProof=proof)
    return observe_workflow(ctx)


def _decide(ctx, evidence):
    if not isinstance(evidence, dict) or evidence.get("schema") != DECISION_SCHEMA:
        raise Error("Use the original observed-decision schema")
    kind = evidence.get("kind")
    note = text(evidence.get("note"), "decision note", 10000, True)
    observed_sha = evidence.get("observationSha256")
    if not isinstance(observed_sha, str) or not HASH.fullmatch(observed_sha):
        raise Error("Decision needs the exact saved observation SHA-256")
    if kind == "processing-choice":
        required = {"schema", "kind", "unitUuid", "jobUuid", "choiceId", "observationSha256", "note"}
        if set(evidence) != required:
            raise Error("Unknown or missing original processing-choice fields")
        unit_id, job_id = identifier(evidence["unitUuid"], "decision unit"), identifier(evidence["jobUuid"], "decision job")
        choice_id = one_line(evidence["choiceId"], "original choice ID", 255)
        key = "choices/" + job_id
        saved = ctx.directory / "decisions" / (job_id + ".json")
        if saved.exists():
            original = read_json(saved)
            if original["decision"] != evidence:
                raise Error("That original job already has a different saved decision")
            desc = ctx.request_description("dashboard", "/mcp/execute/", "POST",
                                           form={"uuid": job_id, "choice": choice_id}, session=True,
                                           accept="text/plain")
            ctx.action(key, desc, (200,))
            return observe_workflow(ctx)
        choices = ctx.state.get("pendingChoices", [])
        matches = [x for x in choices if x["jobUuid"] == job_id and x["unitUuid"] == unit_id
                   and x["observation"]["sha256"] == observed_sha]
        if len(matches) != 1 or choice_id not in {x["choiceId"] for x in matches[0]["choices"]}:
            raise Error("Decision does not match one exact saved original choice")
        selected = matches[0]
        current, receipt = read_choices(ctx, unit_id, selected["unitType"])
        live = [x for x in current if x["jobUuid"] == job_id]
        if len(live) != 1 or choice_id not in {x["choiceId"] for x in live[0]["choices"]}:
            raise Error("The original job or chosen option is no longer available")
        folder(ctx.directory, "decisions")
        package.publish_json(saved, {"decision": evidence, "original": selected,
                                     "current": live[0], "retainedAt": stamp()})
        desc = ctx.request_description("dashboard", "/mcp/execute/", "POST",
                                       form={"uuid": job_id, "choice": choice_id}, session=True,
                                       accept="text/plain")
        result = ctx.action(key, desc, (200,))
        if result["body"] not in (None, ""):
            raise Error("The released MCP choice response should be empty")
        ctx.save("DECISION_SUBMITTED", pendingChoices=[], lastDecision={"jobUuid": job_id, "choiceId": choice_id})
        return observe_workflow(ctx)
    if kind == "arrange-backlog":
        required = {"schema", "kind", "transferUuid", "observationSha256", "arrangePath", "note"}
        if set(evidence) != required:
            raise Error("Unknown or missing original backlog-decision fields")
        transfer_id = identifier(evidence["transferUuid"], "original backlog transfer")
        path = arrangement_path(evidence["arrangePath"])
        saved = ctx.directory / "backlog-decision.json"
        if saved.exists():
            chosen = read_json(saved)
            if chosen["decision"] != evidence:
                raise Error("The original backlog has a different retained arrangement decision")
            return continue_arrangement(ctx, chosen)
        selected = ctx.state.get("pendingBacklog")
        if (not selected or selected["transferUuid"] != transfer_id
                or selected["observation"]["sha256"] != observed_sha
                or ctx.settings["backlog"]["policy"] != "arrange"):
            raise Error("Backlog decision does not bind the exact saved original inventory")
        value, receipt = arrangement_listing(ctx, path, True)
        if value is not None:
            raise Error("Select a new arrangement path; this path is already in use")
        chosen = {"schema": OP_SCHEMA + ".backlog-decision", "decision": evidence,
                  "backlog": selected, "emptyObservation": receipt["_receipt"],
                  "observation": selected["observation"], "retainedAt": stamp()}
        package.publish_json(saved, chosen)
        return continue_arrangement(ctx, chosen)
    raise Error("Unsupported original processing decision kind")


def package_basename(model):
    current = safe_path(model.get("current_path"))
    name = PurePosixPath(current).name
    for suffix in reversed(PurePosixPath(name).suffixes):
        if suffix not in {".tar", ".7z", ".bz2", ".gz"}:
            break
        name = name[:-len(suffix)]
    if not name or name in {".", ".."}:
        raise Error("Stored package has no original archive root")
    return safe_path(name)


def retained_download(ctx, package_id, endpoint, parameters=None):
    path = "/api/v2/file/" + package_id + "/" + endpoint + "/"
    if parameters:
        path += "?" + urlencode(parameters)
    desc = ctx.request_description("storage", path, accept="application/octet-stream", download=True)
    key = digest(encoded(desc))
    directory = folder(ctx.directory, "downloads/" + key)
    package.publish_json(directory / "request.json", desc)
    result_file = directory / "result.json"
    if result_file.exists():
        result = read_json(result_file)
        if result.get("requestSha256") != key or result.get("packageUuid") != package_id:
            raise Error("Retained download binding changed")
        member = result["file"]
        if package.file_identity(package.regular(ctx.root, member["path"])) != {k: member[k] for k in ("bytes", "sha256")}:
            raise Error("Previously received original package bytes changed")
        return result
    # Recover an already-complete original response before making another GET.
    response = None
    for prior in sorted(directory.glob("attempt-*.json")):
        recorded = read_json(prior)
        wire = ctx.directory / safe_path(recorded["wireDirectory"])
        receipt_path = wire / "response.json"
        if not receipt_path.exists():
            continue
        candidate = read_json(receipt_path)
        if candidate.get("requestSha256") != key:
            raise Error("Original download attempt request changed")
        if candidate.get("complete") and candidate.get("status") == 200:
            candidate["_receipt"] = file_descriptor(ctx.root, receipt_path)
            response = candidate
            break
    if response is None:
        wire = "http/" + str(uuid.uuid4())
        attempt = {"requestSha256": key, "packageUuid": package_id, "wireDirectory": wire,
                   "requestedAt": stamp()}
        package.publish_json(directory / ("attempt-" + str(uuid.uuid4()) + ".json"), attempt)
        ctx.save("RETRIEVING", retrieving={"packageUuid": package_id, "endpoint": endpoint,
                                         "parameters": parameters or {}})
        response = ctx.request(desc, wire)
    if response["status"] == 202:
        raw = ctx.response_body(response)
        body = package.parse(raw) if len(raw) <= ctx.config["maxResponseBytes"] else None
        headers = dict(response["headers"])
        until = retry_after(headers["retry-after"]) if headers.get("retry-after") else None
        raise Pause("OFFLINE_RETRIEVAL_PENDING",
                    "Storage has accepted an offline retrieval request but has not returned file bytes.",
                    packageUuid=package_id, endpoint=endpoint, response=response["_receipt"],
                    retryAfterEpoch=until, provider=ctx.redact(body))
    if response["status"] != 200:
        raise Pause("RETRIEVAL_PENDING", "The original stored object has not returned complete bytes.",
                    packageUuid=package_id, status=response["status"], response=response["_receipt"])
    if not response.get("body") or response["body"]["bytes"] == 0:
        # Empty submitted files remain valid; whole archive/METS may not be empty.
        if endpoint != "extract_file":
            raise Error("Storage returned an empty package download")
    result = {"schema": OP_SCHEMA + ".download", "packageUuid": package_id,
              "requestSha256": key, "endpoint": endpoint, "parameters": parameters or {},
              "file": response["body"], "response": response["_receipt"], "receivedAt": stamp()}
    package.publish_json(result_file, result)
    return result



ARCHIVE_ALGORITHMS = ("md5", "sha1", "sha224", "sha256", "sha384", "sha512")


def archive_inventory(ctx, download, retain_bagit_tags=False):
    """Read one held original archive without extracting provider paths to disk."""
    import tarfile
    import zipfile

    source = package.regular(ctx.root, download["file"]["path"])
    limit = ctx.config["maxDownloadBytes"]
    metadata_limit = ctx.config["maxResponseBytes"]
    entries, directories, tags, seen = {}, [], {}, set()
    total, tag_bytes = 0, 0

    def member_name(value):
        value = one_line(value, "archive member path", 16384)
        # A packaging-only './' prefix is normalized once, never '..' or an absolute path.
        if value.startswith("./"):
            value = value[2:]
        return safe_path(value.rstrip("/"))

    def declare(value, size, directory=False):
        name = member_name(value)
        if name in seen or len(seen) >= 30000:
            raise Error("Stored archive repeats a path or exceeds its member limit")
        seen.add(name)
        if directory:
            directories.append(name)
            return name
        if type(size) is not int or not 0 <= size <= limit:
            raise Error("Stored archive member has an invalid declared size")
        entries[name] = {"path": name, "bytes": size}
        return name

    def wants_tag(name):
        leaf = PurePosixPath(name).name
        return retain_bagit_tags and len(PurePosixPath(name).parts) == 2 and (
            leaf in {"bagit.txt", "bag-info.txt"} or
            re.fullmatch(r"(?:tag)?manifest-[A-Za-z0-9_-]+\.txt", leaf) is not None)

    class Sink:
        def __init__(self, name):
            self.name, self.length = name, 0
            self.hashes = {algorithm: hashlib.new(algorithm) for algorithm in ARCHIVE_ALGORITHMS}
            self.saved = bytearray() if wants_tag(name) else None

        def write(self, block):
            nonlocal total, tag_bytes
            length = len(block)
            self.length += length
            total += length
            if self.length > entries[self.name]["bytes"] or total > limit:
                raise Error("Stored archive expanded beyond its declared byte limit")
            for h in self.hashes.values():
                h.update(block)
            if self.saved is not None:
                tag_bytes += length
                if tag_bytes > metadata_limit:
                    raise Error("Stored archive BagIt tag material exceeds the metadata limit")
                self.saved.extend(block)
            return length

        def read(self, size=None):
            raw = bytes(self.saved) if self.saved is not None else b""
            return raw if size is None else raw[:size]

        def seek(self, offset, whence=0):
            if (offset, whence) not in {(0, 0), (0, 2)}:
                raise Error("The archive reader requested a nonsequential output write")
            return self.length if whence == 2 else 0

        def flush(self):
            return None

        def size(self):
            return self.length

        def close(self):
            return None

        def finish(self):
            if self.length != entries[self.name]["bytes"]:
                raise Error("Stored archive member ended before its declared size")
            entries[self.name]["digests"] = {name: h.hexdigest() for name, h in self.hashes.items()}
            entries[self.name]["sha256"] = entries[self.name]["digests"]["sha256"]
            if self.saved is not None:
                tags[self.name] = bytes(self.saved)

    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode) or initial.st_size != download["file"]["bytes"]:
            raise Error("Original downloaded archive identity changed")
        with os.fdopen(fd, "rb", closefd=False) as held:
            original_hash = hashlib.sha256()
            for block in iter(lambda: held.read(262144), b""):
                original_hash.update(block)
            if original_hash.hexdigest() != download["file"]["sha256"]:
                raise Error("Original downloaded archive bytes changed")
            held.seek(0)
            signature = held.read(8)
            held.seek(0)
            if zipfile.is_zipfile(held):
                held.seek(0)
                archive_format = "zip"
                with zipfile.ZipFile(held) as archive:
                    records = archive.infolist()
                    for item in records:
                        mode = item.external_attr >> 16
                        directory = item.is_dir()
                        if (item.flag_bits & 1 or
                                stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}):
                            raise Error("Encrypted or special/link archive members are unsupported")
                        declare(item.filename, item.file_size, directory)
                    for item in records:
                        if item.is_dir():
                            continue
                        name = member_name(item.filename)
                        sink = Sink(name)
                        with archive.open(item) as handle:
                            for block in iter(lambda: handle.read(262144), b""):
                                sink.write(block)
                        sink.finish()
            elif signature.startswith(b"7z\xbc\xaf\x27\x1c"):
                try:
                    import py7zr
                    from importlib.metadata import version
                except ImportError as exc:
                    raise Pause("ARCHIVE_READER_REQUIRED",
                                "Install the declared py7zr 1.1.3 dependency to verify the original 7z package.",
                                requirement="py7zr==1.1.3", packageUuid=download["packageUuid"]) from exc
                if version("py7zr") != "1.1.3":
                    raise Pause("ARCHIVE_READER_REQUIRED",
                                "The selected 7z reader differs from the declared reviewed dependency.",
                                requirement="py7zr==1.1.3", observedVersion=version("py7zr"))
                held.seek(0)
                archive_format = "7z"
                # A supplied BinaryIO keeps py7zr on this descriptor and disables parallel path reopening.
                with py7zr.SevenZipFile(held, "r", max_extract_size=limit) as archive:
                    if archive.needs_password():
                        raise Error("Encrypted stored packages require an explicit separate receiving profile")
                    files = archive.list()
                    for item in files:
                        if item.is_symlink or not (item.is_file or item.is_directory):
                            raise Error("Stored 7z contains a special/link member")
                        declare(item.filename, item.uncompressed, item.is_directory)
                    class Factory(py7zr.WriterFactory):
                        def __init__(self):
                            self.products = {}

                        def create(self, filename):
                            # py7zr's writer factory receives an absolute sanitized output name.
                            candidate = Path(filename)
                            try:
                                relative = candidate.relative_to(Path.cwd()).as_posix() if candidate.is_absolute() else candidate.as_posix()
                            except ValueError:
                                raise Error("7z writer name left its retained archive root") from None
                            name = member_name(relative)
                            if name not in entries or name in self.products:
                                raise Error("7z writer changed the declared file inventory")
                            product = Sink(name)
                            self.products[name] = product
                            return product
                    factory = Factory()
                    archive.extractall(factory=factory)
                    if set(factory.products) != set(entries):
                        raise Error("7z archive did not return its complete declared inventory")
                    for product in factory.products.values():
                        product.finish()
            else:
                held.seek(0)
                archive_format = "tar"
                try:
                    archive = tarfile.open(fileobj=held, mode="r:*")
                except tarfile.ReadError as exc:
                    raise Pause("ARCHIVE_FORMAT_REQUIRES_REVIEW",
                                "The stored archive is not a supported ZIP, TAR or declared 7z package.",
                                packageUuid=download["packageUuid"], download=download["file"]) from exc
                with archive:
                    records = archive.getmembers()
                    for item in records:
                        if item.name in {".", "./"} and item.isdir():
                            continue
                        if not (item.isfile() or item.isdir()) or item.issym() or item.islnk():
                            raise Error("Stored TAR contains a special/link member")
                        declare(item.name, item.size, item.isdir())
                    for item in records:
                        if not item.isfile():
                            continue
                        sink = Sink(member_name(item.name))
                        handle = archive.extractfile(item)
                        if handle is None:
                            raise Error("Stored TAR omitted an original regular file")
                        with handle:
                            for block in iter(lambda: handle.read(262144), b""):
                                sink.write(block)
                        sink.finish()
            final = os.fstat(fd)
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if any(getattr(initial, field) != getattr(final, field) for field in fields):
                raise Error("Original archive changed during complete receiving")
    finally:
        os.close(fd)
    for name in entries:
        parent = PurePosixPath(name).parent
        while str(parent) != ".":
            if str(parent) in entries:
                raise Error("Stored archive uses one path as both a file and a directory")
            parent = parent.parent
    if not entries:
        raise Error("Original stored package has no regular files")
    return {"format": archive_format, "files": [entries[name] for name in sorted(entries)],
            "directories": sorted(directories), "expandedBytes": total, "tags": tags}


def bagit_tags(raw, label):
    try:
        value = raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise Error("Stored " + label + " is not UTF-8") from exc
    fields, key = {}, None
    for line in value.splitlines():
        if not line.strip():
            continue
        if line[0].isspace() and key is not None:
            fields[key][-1] += " " + line.strip()
            continue
        if ":" not in line:
            raise Error("Stored " + label + " has an invalid tag line")
        key, text_value = line.split(":", 1)
        if not key or key != key.strip():
            raise Error("Stored " + label + " has an invalid tag name")
        fields.setdefault(key, []).append(text_value.strip())
    return fields


def verify_stored_bagit(ctx, download):
    inventory = archive_inventory(ctx, download, True)
    entries = {row["path"]: row for row in inventory["files"]}
    roots = {path.split("/", 1)[0] for path in entries}
    if len(roots) != 1:
        raise Error("Downloaded AIP must contain one complete original archive root")
    base = next(iter(roots))
    marker = base + "/bagit.txt"
    if marker not in entries:
        raise Error("The original AIP archive root lacks its direct BagIt declaration")
    prefix = base + "/"
    if any(not name.startswith(prefix) for name in entries):
        raise Error("Downloaded AIP contains files outside its one BagIt root")
    relative = {name[len(prefix):]: item for name, item in entries.items()}
    tags = inventory.pop("tags")
    info = bagit_tags(tags[marker], "bagit.txt")
    if (info.get("BagIt-Version") not in (["0.97"], ["1.0"])
            or len(info.get("Tag-File-Character-Encoding", [])) != 1
            or info["Tag-File-Character-Encoding"][0].lower().replace("-", "") != "utf8"):
        raise Error("Stored BagIt declaration is outside the released UTF-8 profile")
    if "bag-info.txt" not in relative or prefix + "bag-info.txt" not in tags:
        raise Error("Stored AIP BagIt information is missing")
    bag_info = bagit_tags(tags[prefix + "bag-info.txt"], "bag-info.txt")
    if bag_info.get("External-Identifier") != [ctx.state["sipUuid"]]:
        raise Error("Stored BagIt External-Identifier does not bind the original SIP UUID")
    payload = {name for name in relative if name.startswith("data/")}
    manifests, tagmanifests = {}, {}
    for name in relative:
        matched = re.fullmatch(r"(tag)?manifest-([A-Za-z0-9_-]+)\.txt", name)
        if not matched:
            continue
        algorithm = matched[2].lower().replace("-", "")
        if algorithm not in ARCHIVE_ALGORITHMS:
            raise Error("Stored BagIt uses an unsupported observed checksum algorithm")
        target = tagmanifests if matched[1] else manifests
        if algorithm in target:
            raise Error("Stored BagIt repeats an algorithm manifest")
        try:
            manifest_text = tags[prefix + name].decode("utf-8-sig")
        except (KeyError, UnicodeError) as exc:
            raise Error("Stored BagIt manifest is missing or not UTF-8") from exc
        rows = {}
        for line in manifest_text.splitlines():
            if not line.strip():
                continue
            matched_line = re.fullmatch(r"([0-9A-Fa-f]+)[ \t]+(.+)", line)
            if not matched_line:
                raise Error("Invalid stored BagIt manifest line")
            checksum, path = matched_line.groups()
            # BagIt 1.0 reserves these percent escapes for manifest path characters.
            if info["BagIt-Version"] == ["1.0"]:
                path = re.sub(r"%(25|0A|0D)", lambda m: {"25": "%", "0A": "\n", "0D": "\r"}[m[1].upper()],
                              path, flags=re.IGNORECASE)
            path = safe_path(path)
            if path not in relative or path in rows:
                raise Error("Stored BagIt manifest names an absent or repeated file")
            observed = relative[path]["digests"][algorithm]
            if checksum.lower() != observed:
                raise Error("Stored BagIt manifest fixity failed: " + path)
            rows[path] = checksum.lower()
        target[algorithm] = {"path": prefix + name, "files": len(rows), "entries": rows}
    if not manifests or not payload:
        raise Error("Stored AIP is missing its payload or checksum manifest")
    for manifest in manifests.values():
        if set(manifest["entries"]) != payload:
            raise Error("Stored BagIt payload inventory differs from its manifest")
    tags_except_manifests = {name for name in relative if not name.startswith("data/")
                            and not re.fullmatch(r"tagmanifest-[A-Za-z0-9_-]+\.txt", name)}
    for tagmanifest in tagmanifests.values():
        if set(tagmanifest["entries"]) != tags_except_manifests:
            raise Error("Stored BagIt tag manifest does not cover its complete declared tag inventory")
    oxum = bag_info.get("Payload-Oxum")
    actual_oxum = str(sum(relative[name]["bytes"] for name in payload)) + "." + str(len(payload))
    if oxum is not None and oxum != [actual_oxum]:
        raise Error("Stored BagIt Payload-Oxum differs from its received bytes")
    return {**inventory, "archiveRoot": base, "bagit": info, "bagInfo": bag_info,
            "payloadFiles": len(payload), "payloadBytes": sum(relative[name]["bytes"] for name in payload),
            "payloadAlgorithms": sorted(manifests), "tagAlgorithms": sorted(tagmanifests),
            "manifests": manifests, "tagManifests": tagmanifests,
            "allPayloadBytesVerified": True, "allDeclaredTagBytesVerified": True,
            "scope": "Every actual regular archive member is inventoried; every observed supported payload and tag manifest is checked against those same held archive bytes."}


def relative_reference(value):
    value = one_line(value, "METS file reference", 16384)
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise Error("METS references must be original relative package paths")
    try:
        decoded = unquote(parsed.path, encoding="utf-8", errors="strict")
    except UnicodeError:
        raise Error("Invalid UTF-8 METS file reference") from None
    return safe_path(decoded)


def direct_children(node, name):
    return [x for x in node if local_name(x.tag) == name]


def premis_object(amd, file_id):
    found = []
    for node in amd.iter():
        if local_name(node.tag) != "object":
            continue
        for ident in direct_children(node, "objectIdentifier"):
            values = {local_name(x.tag): x.text or "" for x in ident}
            if values.get("objectIdentifierType", "").lower() == "uuid":
                candidate = identifier(values.get("objectIdentifierValue"), "PREMIS object")
                if candidate == file_id:
                    found.append(node)
    if len(found) != 1:
        raise Error("METS file does not bind one original PREMIS File UUID")
    node = found[0]
    original = child_text(node, "originalName")
    if original is None:
        raise Error("Original PREMIS name is missing")
    original = one_line(original, "PREMIS original name", 16384)
    size_text = child_text(node, "size")
    if not isinstance(size_text, str) or not re.fullmatch(r"[0-9]+", size_text):
        raise Error("PREMIS file size is missing or invalid")
    algorithms = {"md5": ("md5", 32), "sha1": ("sha1", 40), "sha256": ("sha256", 64), "sha512": ("sha512", 128)}
    fixity = {}
    for item in node.iter():
        if local_name(item.tag) != "fixity":
            continue
        algorithm = child_text(item, "messageDigestAlgorithm", "").lower().replace("-", "")
        value = child_text(item, "messageDigest", "").lower()
        if algorithm not in algorithms:
            continue
        name, length = algorithms[algorithm]
        if not re.fullmatch(r"[0-9a-f]{" + str(length) + r"}", value):
            raise Error("Invalid original PREMIS digest")
        if name in fixity and fixity[name] != value:
            raise Error("Contradictory original PREMIS digests")
        fixity[name] = value
    if not fixity:
        raise Error("No supported original PREMIS fixity algorithm was supplied")
    return {"fileUuid": file_id, "originalName": original, "bytes": int(size_text), "fixity": fixity}


def mets_inventory(raw):
    root = xml(raw, "METS document")
    if root.tag != "{" + NS["mets"] + "}mets":
        raise Error("The retained document is not a METS document")
    amd = {}
    for node in root.findall("mets:amdSec", NS):
        ident = node.get("ID")
        if not ident or ident in amd:
            raise Error("METS has missing or repeated administrative section IDs")
        amd[ident] = node
    dmd = {}
    for node in root.findall("mets:dmdSec", NS):
        ident = node.get("ID")
        if not ident or ident in dmd:
            raise Error("METS has missing or repeated descriptive section IDs")
        values = {}
        for child in node.iter():
            if child.tag.startswith("{" + NS["dc"] + "}") or child.tag.startswith("{" + NS["dcterms"] + "}"):
                key = local_name(child.tag)
                if len(child) == 0 and child.text is not None:
                    values.setdefault(key, []).append(child.text)
        dmd[ident] = values
    dmd_links = {}
    for structmap in root.findall("mets:structMap", NS):
        for division in structmap.iter("{" + NS["mets"] + "}div"):
            references = (division.get("DMDID") or "").split()
            for pointer in division.findall("mets:fptr", NS):
                dmd_links.setdefault(pointer.get("FILEID"), set()).update(references)
    files, file_ids = [], set()
    for group in root.findall(".//mets:fileSec/mets:fileGrp", NS):
        for file in group.findall("mets:file", NS):
            file_ref = file.get("ID")
            if not file_ref or file_ref in file_ids:
                raise Error("METS has missing or repeated file IDs")
            file_ids.add(file_ref)
            if not file_ref.startswith("file-"):
                raise Error("Released Archivematica METS file ID lacks its File UUID")
            file_uuid = identifier(file_ref[len("file-"):], "METS file")
            admids = (file.get("ADMID") or "").split()
            if len(admids) != 1 or admids[0] not in amd:
                raise Error("METS file does not bind one retained administrative section")
            original = premis_object(amd[admids[0]], file_uuid)
            locations = file.findall("mets:FLocat", NS)
            if len(locations) != 1:
                raise Error("METS file has ambiguous original content locations")
            href = relative_reference(locations[0].get("{" + NS["xlink"] + "}href"))
            descriptive_ids = set((file.get("DMDID") or "").split()) | dmd_links.get(file_ref, set())
            values = {}
            for dmd_id in sorted(descriptive_ids):
                if dmd_id not in dmd:
                    raise Error("METS references a missing descriptive section")
                for key, items in dmd[dmd_id].items():
                    values.setdefault(key, []).extend(items)
            files.append({**original, "fileId": file_ref, "admId": admids[0],
                          "use": group.get("USE", ""), "href": href,
                          "dmdIds": sorted(descriptive_ids), "dc": values})
    if not files:
        raise Error("Original METS file inventory is empty")
    if len({x["fileUuid"] for x in files}) != len(files):
        raise Error("METS repeats an original File UUID")
    return {"objid": root.get("OBJID"), "files": files}


def check_download_fixity(ctx, download, declared, expected=None):
    file = download["file"]
    source = package.regular(ctx.root, file["path"])
    if declared["bytes"] != file["bytes"]:
        raise Error("Received bytes differ from the original PREMIS file size")
    if expected and any(file[k] != expected[k] for k in ("bytes", "sha256")):
        raise Error("Received file differs from the submitted original bytes")
    hashes = {name: hashlib.new(name) for name in declared["fixity"]}
    with open(source, "rb") as handle:
        for block in iter(lambda: handle.read(262144), b""):
            for item in hashes.values():
                item.update(block)
    if any(hashes[name].hexdigest() != value for name, value in declared["fixity"].items()):
        raise Error("Received original file failed its PREMIS fixity")
    return {"size": True, "premisAlgorithms": sorted(hashes),
            "submittedSha256": bool(expected), "file": file}


def expected_original_name(path, transfer_name, metadata_name):
    if path.startswith("data/metadata/submissionDocumentation/"):
        return ("%SIPDirectory%objects/submissionDocumentation/transfer-" + transfer_name + "/"
                + path[len("data/metadata/submissionDocumentation/"):], "submissiondocumentation")
    if path.startswith("data/metadata/"):
        return ("%SIPDirectory%objects/metadata/transfers/" + metadata_name + "/"
                + path[len("data/metadata/"):], "metadata")
    if path.startswith("data/"):
        return "%transferDirectory%" + path, "original"
    if path.startswith("manifest"):
        return "%SIPDirectory%objects/metadata/transfers/" + metadata_name + "/" + path, "metadata"
    return None, "bagit-log"


def original_transfer_names(ctx):
    transfer_id = ctx.state["transferUuid"]
    arranged = (ctx.directory / "backlog-decision.json").exists()
    if arranged:
        chosen = read_json(ctx.directory / "backlog-decision.json")
        transfer_name = chosen["backlog"]["transferBasename"]
        if ctx.state["sipUuid"] != ctx.operation["arrangedSipUuid"]:
            raise Error("Backlog metadata path does not belong to the original selected SIP")
        metadata_name = "transfer-" + transfer_id
    else:
        transfer_name = one_line(ctx.state.get("transferDirectory"), "actual transfer basename", 4096)
        metadata_name = transfer_name
    if "/" in transfer_name or "\\" in transfer_name or not transfer_name.endswith("-" + transfer_id):
        raise Error("Actual transfer basename does not preserve its original UUID")
    return transfer_name, metadata_name


def metadata_matches(expected, received):
    if not isinstance(expected, dict) or not isinstance(received, dict):
        return False
    for key, values in expected.items():
        if not isinstance(values, list):
            return False
        if Counter(values) - Counter(received.get(key, [])):
            return False
    return True


def verify_aip_originals(ctx):
    sip_id = ctx.state["sipUuid"]
    model = ctx.state["aip"]
    archive = retained_download(ctx, sip_id, "download")
    stored_bagit = verify_stored_bagit(ctx, archive)
    base = stored_bagit["archiveRoot"]
    archive_files = {row["path"]: row for row in stored_bagit["files"]}
    data_root = base + "/data/"
    mets_path = data_root + "METS." + sip_id + ".xml"
    mets_download = retained_download(ctx, sip_id, "extract_file", {"relative_path_to_file": mets_path})
    mets_raw = package.regular(ctx.root, mets_download["file"]["path"]).read_bytes()
    if len(mets_raw) > ctx.config["maxResponseBytes"]:
        raise Error("Original AIP METS exceeds the metadata receiving limit")
    mets = mets_inventory(mets_raw)
    transfer_name, metadata_name = original_transfer_names(ctx)
    transfer_mets_name = ("%SIPDirectory%objects/submissionDocumentation/transfer-"
                          + transfer_name + "/METS.xml")
    transfers = [x for x in mets["files"] if x["originalName"] == transfer_mets_name
                 and x["use"].lower() == "submissiondocumentation"]
    if len(transfers) != 1:
        raise Error("AIP does not retain one original transfer METS document")
    transfer_file = transfers[0]
    transfer_download = retained_download(ctx, sip_id, "extract_file",
        {"relative_path_to_file": data_root + transfer_file["href"]})
    check_download_fixity(ctx, transfer_download, transfer_file)
    transfer_raw = package.regular(ctx.root, transfer_download["file"]["path"]).read_bytes()
    if len(transfer_raw) > ctx.config["maxResponseBytes"]:
        raise Error("Original transfer METS exceeds its metadata receiving limit")
    transfer_mets = mets_inventory(transfer_raw)
    if transfer_mets["objid"] != ctx.state["transferUuid"]:
        raise Error("Retained transfer METS OBJID is not the original transfer UUID")
    by_original = {}
    for row in mets["files"]:
        by_original.setdefault(row["originalName"], []).append(row)
    transfer_by_uuid = {row["fileUuid"]: row for row in transfer_mets["files"]}
    storage_by_uuid = {}
    for row in ctx.state["aipContents"]["files"]:
        storage_by_uuid.setdefault(row["source_id"], []).append(row)
    records = package.read_json(ctx.root, "records.json")
    if not isinstance(records, list):
        raise Error("Prepared original record review is not an array")
    included = {row["payloadPath"]: row for row in records if row["include"]}
    expected_originals = {"%transferDirectory%" + path for path in included}
    actual_originals = {row["originalName"] for row in mets["files"] if row["use"].lower() == "original"}
    if actual_originals != expected_originals:
        raise Error("AIP original records differ from the included source review")
    file_proofs, record_proofs = [], []
    members = ctx.manifest["bagMembers"]
    if not isinstance(members, list):
        raise Error("Prepared original BagIt inventory is missing")
    for index, submitted in enumerate(members):
        path = safe_path(submitted["path"])
        expected = {key: submitted[key] for key in ("bytes", "sha256")}
        original_name, required_use = expected_original_name(path, transfer_name, metadata_name)
        if original_name is None:
            href = data_root + "logs/transfers/" + metadata_name + "/logs/BagIt/" + path
            download = retained_download(ctx, sip_id, "extract_file", {"relative_path_to_file": href})
            if any(download["file"][k] != expected[k] for k in ("bytes", "sha256")):
                raise Error("Retained original BagIt tag bytes differ: " + path)
            proof = {"submittedPath": path, **expected, "kind": "copied-original-bagit-log",
                     "aipPath": href, "received": download["file"],
                     "scope": "Released transfer-log copy path and exact submitted bytes; no File UUID is invented."}
        else:
            candidates = [row for row in by_original.get(original_name, [])
                          if row["use"].lower() == required_use]
            if len(candidates) != 1:
                raise Error("AIP does not bind one original submitted member: " + path)
            observed = candidates[0]
            download = retained_download(ctx, sip_id, "extract_file",
                                         {"relative_path_to_file": data_root + observed["href"]})
            checks = check_download_fixity(ctx, download, observed, expected)
            proof = {"submittedPath": path, **expected, "kind": required_use,
                     "originalName": original_name, "fileUuid": observed["fileUuid"],
                     "admId": observed["admId"], "aipPath": data_root + observed["href"],
                     "fixity": checks, "received": download["file"]}
            if path in included:
                transfer_original = transfer_by_uuid.get(observed["fileUuid"])
                if (transfer_original is None or transfer_original["originalName"] != original_name
                        or transfer_original["bytes"] != expected["bytes"]):
                    raise Error("Original record does not join transfer METS and AIP File UUID")
                check_download_fixity(ctx, download, transfer_original, expected)
                source_row = included[path]
                if not metadata_matches(source_row["reviewedDc"], observed["dc"]):
                    raise Error("AIP descriptive metadata does not preserve the original reviewed Dublin Core mapping")
                indexed_rows = storage_by_uuid.get(observed["fileUuid"], [])
                for indexed in indexed_rows:
                    # The envelope establishes containment. source_package is the originating unit,
                    # which can be the transfer even when the row is attached to the resulting AIP.
                    if indexed.get("source_package") not in (None, "", ctx.state["transferUuid"], sip_id):
                        raise Error("Storage provenance contradicts the matched original transfer/SIP File UUID")
                    if indexed.get("origin") not in (None, "", ctx.settings["pipelineUuid"]):
                        raise Error("Storage origin contradicts the matched original File UUID")
                    checksum = indexed.get("checksum")
                    archived = archive_files.get(data_root + observed["href"])
                    if archived is None:
                        raise Error("Indexed original is absent from the same complete AIP archive")
                    if checksum and checksum.lower() not in set(archived["digests"].values()):
                        raise Error("Storage contents checksum is unsupported or contradicts the bound original file")
                indexed = indexed_rows[0] if indexed_rows else None
                record_proofs.append({"identifier": source_row["identifier"], "payloadPath": path,
                    "fileUuid": observed["fileUuid"], "transferUuid": ctx.state["transferUuid"],
                    "sipUuid": sip_id, "sourceSha256": expected["sha256"],
                    "aipOriginalName": original_name, "aipFile": download["file"],
                    "transferPremis": transfer_original, "aipPremis": observed,
                    "storageContent": indexed, "storageContents": indexed_rows, "storageContentScope": "Optional indexed corroboration; not a complete AIP inventory.",
                    "mappedDcPreserved": True,
                    "metadataScope": "Every mapped value and its multiplicity is retained; additional provider metadata is preserved."})
        file_proofs.append(proof)
        ctx.save("VERIFYING_ORIGINAL_FILES", verifiedFiles=index + 1, originalFiles=len(members),
                 verifiedRecords=len(record_proofs), originalRecords=len(included))
    if len(record_proofs) != len(included):
        raise Error("The original included record inventory is incomplete")
    for member_path, received in [(mets_path, mets_download["file"]),
                                   (data_root + transfer_file["href"], transfer_download["file"])] + [
                                       (item["aipPath"], item["received"]) for item in file_proofs]:
        actual = archive_files.get(member_path)
        if actual is None or any(actual[k] != received[k] for k in ("bytes", "sha256")):
            raise Error("Extracted API member does not match the same complete downloaded AIP archive")
    return {"aipUuid": sip_id, "archiveRoot": base, "mets": mets_download,
            "transferMets": transfer_download, "transferUuid": ctx.state["transferUuid"],
            "transferBasename": transfer_name, "metadataTransferBasename": metadata_name,
            "packageDownload": archive, "storedBagit": stored_bagit, "files": file_proofs, "records": record_proofs,
            "allSubmittedMembersVerified": True, "allOriginalRecordsVerified": True,
            "allMappedDcVerified": True}


def inspect_dip_archive(ctx, download):
    import tarfile
    import zipfile
    source = package.regular(ctx.root, download["file"]["path"])
    entries, total = [], 0
    def consume(name, handle, expected_length):
        nonlocal total
        name = safe_path(name.rstrip("/"))
        h, length = hashlib.sha256(), 0
        for block in iter(lambda: handle.read(262144), b""):
            length += len(block)
            total += len(block)
            if total > ctx.config["maxDownloadBytes"]:
                raise Error("DIP expanded contents exceed the receiving limit")
            h.update(block)
        if length != expected_length:
            raise Error("DIP archive member length differs from its original header")
        entries.append({"path": name, "bytes": length, "sha256": h.hexdigest()})
        if len(entries) > 30000:
            raise Error("DIP archive exceeds the member receiving limit")
    with open(source, "rb") as original:
        before = os.fstat(original.fileno())
        if zipfile.is_zipfile(original):
            original.seek(0)
            with zipfile.ZipFile(original) as archive:
                seen = set()
                for member in archive.infolist():
                    name = safe_path(member.filename.rstrip("/"))
                    if name in seen:
                        raise Error("DIP ZIP has duplicate members")
                    seen.add(name)
                    mode = member.external_attr >> 16
                    if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
                        raise Error("DIP ZIP contains a special or linked member")
                    if member.is_dir():
                        continue
                    with archive.open(member) as handle:
                        consume(name, handle, member.file_size)
        else:
            original.seek(0)
            try:
                archive = tarfile.open(fileobj=original, mode="r:*")
            except tarfile.TarError:
                raise Pause("DIP_ARCHIVE_FORMAT_REQUIRES_REVIEW",
                            "The exact DIP download is retained; this receiver supports ZIP and TAR-family access packages.",
                            download=download["file"]) from None
            with archive:
                seen = set()
                for member in archive:
                    name = safe_path(member.name.rstrip("/"))
                    if name in seen:
                        raise Error("DIP TAR has duplicate members")
                    seen.add(name)
                    if member.isdir():
                        continue
                    if not member.isfile():
                        raise Error("DIP TAR contains a linked or special member")
                    with archive.extractfile(member) as handle:
                        consume(name, handle, member.size)
        after = os.fstat(original.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise Error("Original DIP archive changed while receiving")
    if not entries:
        raise Error("Original DIP download contains no files")
    return sorted(entries, key=lambda row: row["path"])


def verify_dips(ctx):
    results = []
    for selected in ctx.state.get("dips", []):
        model = selected["model"]
        dip_id = model["uuid"]
        download = retained_download(ctx, dip_id, "download")
        members = inspect_dip_archive(ctx, download)
        results.append({"dipUuid": dip_id, "relatedAipUuid": ctx.state["aipUuid"],
                        "originPipelineUuid": ctx.settings["pipelineUuid"],
                        "locationUuid": relation_uuid(ctx, model["current_location"], "location"),
                        "model": model, "contents": selected["contents"],
                        "download": download, "archiveMembers": members,
                        "scope": "Distinct related access package and exact complete archive member bytes. "
                                 "Access derivatives are not claimed byte-identical to submitted originals.",
                        "fixityCheck": {"requested": False,
                                        "reason": "Released Storage Service check_fixity does not support DIP."}})
    if ctx.settings["dip"]["policy"] == "required" and not results:
        raise Pause("WAITING_DIP", "No complete related original DIP is available")
    return results


def fixity_aip(ctx):
    selected = ctx.settings["fixity"]
    if not selected["requestAipCheck"]:
        return {"requested": False, "success": None, "scope": "No provider fixity action selected."}
    aip_id = ctx.state["aipUuid"]
    path = "/api/v2/file/" + aip_id + "/check_fixity/"
    if selected["forceLocal"]:
        path += "?force_local=true"
    desc = ctx.request_description("storage", path)
    result = ctx.action("fixity/aip", desc, (200,))
    body = result["body"]
    if (not isinstance(body, dict) or "success" not in body
            or (body["success"] is not None and type(body["success"]) is not bool)):
        raise Error("Original Storage fixity result is not tri-state")
    proof = {"requested": True, "success": body["success"], "originalAction": result,
             "scope": "Provider's recorded package-level check. A compressed AIP can pass by its stored "
                      "archive checksum; this is independent of the original-file METS and byte proof."}
    if body["success"] is not True:
        raise Pause("FIXITY_FAILED" if body["success"] is False else "FIXITY_INCONCLUSIVE",
                    "The original requested provider fixity check did not return success:true.",
                    fixity=proof)
    return proof


def receiving_report(proof):
    esc = lambda value: html.escape(str(value))
    summary = proof["summary"]
    rows = "".join("<tr><td>" + esc(row["identifier"]) + "</td><td>" + esc(row["fileUuid"])
                   + "</td><td><code>" + esc(row["sourceSha256"]) + "</code></td><td>Verified</td></tr>"
                   for row in proof["aip"]["records"])
    members = "".join("<tr><td>" + esc(row["submittedPath"]) + "</td><td>" + esc(row["kind"])
                      + "</td><td>" + esc(row["bytes"]) + "</td><td><code>" + esc(row["sha256"])
                      + "</code></td></tr>" for row in proof["aip"]["files"])
    settings = proof["settings"]
    dip_text = ("No DIP was requested." if settings["dip"]["policy"] == "not-requested" else
                "No related DIP was available in the original optional observation." if not proof["dips"] else
                "Distinct related DIP archives received: " + ", ".join(row["dipUuid"] for row in proof["dips"]))
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Archivematica original receiving</title><style>"
        "body{font:15px/1.5 system-ui,sans-serif;max-width:1240px;margin:auto;padding:24px;color:#202020;background:#fff}"
        "h1,h2{color:#161616}h1{font-size:26px}h2{font-size:18px}section{background:#fff;padding:18px;margin:18px 0;border:1px solid #c9c9c9}"
        "table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:8px;border-bottom:1px solid #d4d4d4}th{background:#f3f3f3}"
        ".scroll{overflow:auto}code{overflow-wrap:anywhere}dt{font-weight:700}dd{margin-bottom:10px}"
        "</style><h1>Archivematica original receiving</h1><p>Verified original source, processing identities and received bytes.</p>"
        "<section><h2>Received edition</h2><dl><dt>Operation</dt><dd>" + esc(proof["operationId"])
        + "</dd><dt>Original package</dt><dd>" + esc(proof["packageId"])
        + "</dd><dt>Transfer / SIP / AIP</dt><dd>" + esc(proof["transferUuid"]) + " / " + esc(proof["sipUuid"])
        + " / " + esc(proof["aipUuid"]) + "</dd><dt>Source records</dt><dd>" + esc(summary["sourceRecords"])
        + "; included " + esc(summary["includedRecords"]) + "; excluded " + esc(summary["excludedRecords"])
        + "</dd><dt>Original BagIt members verified</dt><dd>" + esc(summary["originalMembers"])
        + " files; " + esc(summary["originalMemberBytes"]) + " bytes</dd>"
        "<dt>Processing configuration</dt><dd>" + esc(settings["processingConfiguration"])
        + "</dd><dt>Completed observation</dt><dd>" + esc(proof["completedAt"]) + "</dd></dl></section>"
        "<section><h2>What the evidence establishes</h2><p>Each selected JSON record joins its original transfer File UUID, "
        "PREMIS original name, file size and digest to its AIP METS location and the exact returned bytes. The physical "
        "METS descriptive links preserve every reviewed Dublin Core value and its multiplicity. Copied metadata and "
        "submission documentation retain their source bytes through their released ingest paths and new SIP File UUIDs. "
        "Original BagIt tags copied into logs are checked separately without inventing File UUIDs. "
        "The complete downloaded AIP archive is independently inventoried and every observed payload/tag manifest is "
        "verified against those same archive bytes. Extracted source and METS responses must match the archive.</p><p>"
        + esc(dip_text) + " Access derivatives have their own complete download and member checks; they are not described "
        "as byte-identical copies of source records.</p><p>The selected provider fixity check is "
        + ("recorded as success:true." if proof["fixity"]["requested"] else "not requested.")
        + " A compressed-AIP check can validate only the stored archive checksum; all source-file checks above are independent.</p>"
        "<p>The existing processing XML was observed before start. The released Dashboard can choose its default if a named "
        "configuration disappears before creation; the captured XML is not a server-side attestation of the applied configuration.</p></section>"
        "<section><h2>Original records and metadata</h2><div class=scroll><table><thead><tr><th>Identifier</th><th>File UUID</th>"
        "<th>Original SHA-256</th><th>DC and bytes</th></tr></thead><tbody>" + rows + "</tbody></table></div></section>"
        "<section><h2>Complete original member inventory</h2><div class=scroll><table><thead><tr><th>Submitted path</th>"
        "<th>Receiving association</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>" + members
        + "</tbody></table></div></section><section><h2>Released contract</h2><p>"
        "<a href='" + SOURCES["dashboardApi"] + "'>Archivematica 1.18 Dashboard API</a>; "
        "<a href='" + SOURCES["storageApi"] + "'>Storage Service API</a>. Source commits: "
        "<a href='https://github.com/artefactual/archivematica/tree/" + DASHBOARD_COMMIT + "'>"
        + DASHBOARD_COMMIT + "</a> and <a href='https://github.com/artefactual/archivematica-storage-service/tree/"
        + STORAGE_COMMIT + "'>" + STORAGE_COMMIT + "</a>.</p><p>All operation requests, responses, processing decisions, "
        "source mapping, manifests and receiving observations accompany this report. Credentials are environment references.</p></section></html>").encode("utf-8")


def _proof_identity(ctx, proof):
    if (proof.get("schema") != OP_SCHEMA + ".receiving"
            or proof.get("operationId") != ctx.operation["id"]
            or proof.get("packageId") != ctx.manifest["packageId"]
            or proof.get("manifestSha256") != ctx.operation["manifestSha256"]
            or proof.get("configurationSha256") != ctx.operation["configurationSha256"]
            or proof.get("settings") != ctx.settings
            or proof.get("sources") != SOURCES):
        raise Error("Original receiving proof belongs to another source or operation")
    for key in ("transferUuid", "sipUuid", "aipUuid"):
        if proof.get(key) != ctx.state.get(key):
            raise Error("Original receiving proof has another " + key)
    if (proof["aip"].get("allSubmittedMembersVerified") is not True
            or proof["aip"].get("allOriginalRecordsVerified") is not True
            or proof["aip"].get("allMappedDcVerified") is not True
            or proof["aip"].get("storedBagit", {}).get("allPayloadBytesVerified") is not True
            or proof["aip"].get("storedBagit", {}).get("allDeclaredTagBytesVerified") is not True):
        raise Error("Original receiving proof is incomplete")
    if ctx.settings["fixity"]["requestAipCheck"] and proof.get("fixity", {}).get("success") is not True:
        raise Error("Selected original fixity result is missing")
    if ctx.settings["dip"]["policy"] == "required" and not proof.get("dips"):
        raise Error("Selected original DIP proof is missing")
    actual = ctx.state.get("aip")
    if actual:
        previous = proof["aipModel"]
        for field in ("uuid", "package_type", "origin_pipeline", "current_location", "current_path", "size"):
            if actual.get(field) != previous.get(field):
                raise Pause("STORED_PACKAGE_CHANGED", "A current stored-package field differs from the preserved verified observation.",
                            field=field, previous=previous.get(field), current=actual.get(field))
    return proof


def _check_descriptors(ctx, value, seen=None):
    if seen is None:
        seen = set()
    if isinstance(value, list):
        for child in value:
            _check_descriptors(ctx, child, seen)
    elif isinstance(value, dict):
        if (isinstance(value.get("path"), str) and type(value.get("bytes")) is int
                and isinstance(value.get("sha256"), str) and HASH.fullmatch(value["sha256"])
                and value["path"].startswith("operations/")):
            path = safe_path(value["path"])
            wanted = (value["bytes"], value["sha256"])
            if path not in seen:
                actual = package.file_identity(package.regular(ctx.root, path))
                if (actual["bytes"], actual["sha256"]) != wanted:
                    raise Error("Original proof artifact changed: " + path)
                seen.add(path)
        for child in value.values():
            _check_descriptors(ctx, child, seen)


def validate_saved_proof(ctx):
    descriptor = ctx.state.get("proof")
    if not descriptor:
        raise Error("Original receiving proof is missing")
    path = package.regular(ctx.root, safe_path(descriptor["path"]))
    if package.file_identity(path) != {key: descriptor[key] for key in ("bytes", "sha256")}:
        raise Error("Original receiving proof bytes changed")
    proof = _proof_identity(ctx, package.parse(path.read_bytes()))
    _check_descriptors(ctx, proof)
    return proof


def finish_proof(ctx, proof, path):
    raw = encoded(proof)
    package.publish(path, raw)
    report_path = path.with_suffix(".html")
    package.publish(report_path, receiving_report(proof))
    return ctx.save("VERIFIED", proof=file_descriptor(ctx.root, path),
                    report=report_path.relative_to(ctx.root).as_posix(),
                    summary=proof["summary"], verifiedAt=proof["completedAt"],
                    pendingChoices=[], pendingBacklog=None, actionKey=None, requestSha256=None,
                    message="Original records, mapped metadata, package identities and selected receiving requirements verified.")


def verify_receiving(ctx):
    if ctx.state.get("proof"):
        proof = validate_saved_proof(ctx)
        return finish_proof(ctx, proof, package.regular(ctx.root, ctx.state["proof"]["path"]))
    receiving_dir = folder(ctx.directory, "receiving")
    # Reopen a proof published before its atomic progress pointer.
    candidates = []
    for path in sorted(receiving_dir.glob("*.json")):
        candidate = read_json(path)
        if candidate.get("schema") == OP_SCHEMA + ".receiving":
            _proof_identity(ctx, candidate)
            if digest(encoded(candidate)) != path.stem:
                raise Error("Immutable receiving proof filename differs from its bytes")
            _check_descriptors(ctx, candidate)
            candidates.append((path, candidate))
    if len(candidates) > 1:
        raise Error("More than one final original receiving proof is present")
    if candidates:
        path, proof = candidates[0]
        return finish_proof(ctx, proof, path)
    aip = verify_aip_originals(ctx)
    dips = verify_dips(ctx)
    fixity = fixity_aip(ctx)
    original_summary = ctx.manifest["summary"]
    summary = {"sourceRecords": original_summary["sourceRecords"],
               "includedRecords": original_summary["includedRecords"],
               "excludedRecords": original_summary["excludedRecords"],
               "originalMembers": len(aip["files"]),
               "originalMemberBytes": sum(x["bytes"] for x in aip["files"]),
               "originalTransferUuid": ctx.state["transferUuid"],
               "originalSipUuid": ctx.state["sipUuid"], "originalAipUuid": ctx.state["aipUuid"],
               "dipUuids": [x["dipUuid"] for x in dips],
               "allOriginalBytesVerified": True, "allMappedMetadataVerified": True,
               "allStoredBagitPayloadVerified": True, "allDeclaredBagitTagsVerified": True,
               "allSelectedRequirementsVerified": True}
    proof = {"schema": OP_SCHEMA + ".receiving", "operationId": ctx.operation["id"],
             "packageId": ctx.manifest["packageId"], "manifestSha256": ctx.operation["manifestSha256"],
             "configurationSha256": ctx.operation["configurationSha256"],
             "settings": ctx.settings, "sources": SOURCES,
             "transferUuid": ctx.state["transferUuid"], "sipUuid": ctx.state["sipUuid"],
             "aipUuid": ctx.state["aipUuid"], "dipUuids": summary["dipUuids"],
             "originalBag": ctx.manifest["originalBag"], "bagIdentity": ctx.manifest["bagIdentity"],
             "bagManifestSha256": ctx.manifest["bagManifestSha256"],
             "providerBinding": file_descriptor(ctx.root, ctx.directory / "provider-binding.json"),
             "aipModel": ctx.state["aip"], "aipModelResponse": ctx.state["aipResponse"],
             "aipContentsResponse": ctx.state["aipContentsResponse"],
             "aip": aip, "dips": dips, "fixity": fixity, "summary": summary, "completedAt": stamp()}
    path = receiving_dir / (digest(encoded(proof)) + ".json")
    return finish_proof(ctx, proof, path)


def _run(ctx):
    ctx.cooldown()
    if ctx.state.get("proof"):
        observe_workflow(ctx)
        return verify_receiving(ctx)
    start = ctx.directory / "actions" / "start-transfer"
    if not (start / "started.json").exists():
        binding = preflight(ctx)
        stage_original(ctx, binding)
    transfer_id = start_transfer(ctx)
    if ctx.state.get("sipUuid") is None:
        if (ctx.directory / "backlog-decision.json").exists():
            chosen = read_json(ctx.directory / "backlog-decision.json")
            continue_arrangement(ctx, chosen)
        else:
            approve_original(ctx, transfer_id)
    deadline = time.monotonic() + ctx.config["waitSeconds"]
    while True:
        state = observe_workflow(ctx)
        if state["state"] in {"READY_TO_VERIFY", "VERIFIED"}:
            return verify_receiving(ctx)
        if state["state"] not in {"TRANSFER_STARTED", "TRANSFER_PROCESSING", "WAITING_SIP",
                                  "INGESTING", "WAITING_AIP", "WAITING_DIP", "WAITING_BACKLOG"}:
            return state
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return state
        time.sleep(min(ctx.config["pollSeconds"], remaining))


def _reconcile(ctx, evidence):
    if not isinstance(evidence, dict) or evidence.get("schema") != OP_SCHEMA + ".reconciliation":
        raise Error("Use an original-response reconciliation template")
    kind = evidence.get("kind")
    if kind not in RECONCILIATION_KINDS:
        raise Error("Unsupported original-response reconciliation kind")
    required = {"schema", "kind", "requestSha256", "response", "note"}
    if kind == "original-action-response":
        required.add("actionKey")
    if set(evidence) != required:
        raise Error("Unknown or missing original-response evidence fields")
    text(evidence["note"], "original response evidence note", 10000, True)
    key = "start-transfer" if kind == "original-start-response" else safe_path(evidence["actionKey"])
    directory = ctx.directory / "actions" / key
    if not (directory / "started.json").exists():
        raise Error("No original dispatched action exists for this evidence")
    description = read_json(directory / "request.json")
    started = read_json(directory / "started.json")
    wanted = digest(encoded(description))
    if evidence["requestSha256"] != wanted or started["requestSha256"] != wanted:
        raise Error("Evidence does not bind the original exact request")
    response = evidence["response"]
    if not isinstance(response, dict) or set(response) != {"status", "body"} or type(response["status"]) is not int:
        raise Error("Retain the original status and complete response body")
    body, status = response["body"], response["status"]
    if isinstance(body, dict) and body.get("error") is True:
        raise Error("A provider error does not confirm the original action")
    expected_status = {200}
    if key == "start-transfer":
        expected_status = {202}
        if not isinstance(body, dict) or set(body) != {"id"}:
            raise Error("Retain the original package creation response")
        identifier(body["id"], "original transfer response")
    elif key == "approve-transfer":
        if (not isinstance(body, dict) or identifier(body.get("uuid"), "original approval")
                != ctx.state.get("transferUuid")):
            raise Error("Approval evidence returned a different transfer")
    elif key.startswith("choices/"):
        if body not in (None, ""):
            raise Error("The released original MCP response is empty")
    elif key == "backlog/create-sip":
        expected_status = {201}
        if (not isinstance(body, dict) or identifier(body.get("sip_uuid"), "original arranged SIP")
                != ctx.operation["arrangedSipUuid"]):
            raise Error("Arrangement evidence returned a different original SIP")
    elif key in {"backlog/create-directory", "backlog/copy-original"}:
        expected_status = {201}
        if not isinstance(body, dict) or body.get("error") is True:
            raise Error("Retain the original successful arrangement response")
    elif key == "fixity/aip":
        if (not isinstance(body, dict) or "success" not in body
                or (body["success"] is not None and type(body["success"]) is not bool)):
            raise Error("Retain the original tri-state fixity result")
    else:
        raise Error("This is not an entered action of the released workflow")
    if status not in expected_status:
        raise Error("Original response status does not confirm that action")
    if ctx.redact(evidence) != evidence:
        raise Error("Do not place credentials in original response evidence")
    evidence_dir = folder(ctx.directory, "reconciliations")
    raw = encoded(evidence)
    evidence_path = evidence_dir / (digest(raw) + ".json")
    package.publish(evidence_path, raw)
    observations = []
    if key == "start-transfer":
        observed, receipt = unit_status(ctx, body["id"], "Transfer")
        observations.append(receipt["_receipt"])
    elif key == "backlog/create-sip":
        observed, receipt = unit_status(ctx, body["sip_uuid"], "SIP")
        observations.append(receipt["_receipt"])
    elif key.startswith("choices/"):
        decision = read_json(ctx.directory / "decisions" / (key.split("/")[-1] + ".json"))
        jobs, receipt = unit_jobs(ctx, decision["decision"]["unitUuid"])
        if key.split("/")[-1] not in {row["uuid"] for row in jobs}:
            raise Error("Original decision job is not in its unit history")
        observations.append(receipt["_receipt"])
    result = {"schema": OP_SCHEMA + ".action", "actionKey": key, "requestSha256": wanted,
              "state": "ADOPTED", "status": status, "body": body, "response": None,
              "evidence": file_descriptor(ctx.root, evidence_path), "observations": observations,
              "scope": "Operator-supplied original response bound to the already-dispatched request; no replay.",
              "recordedAt": stamp()}
    result_path = directory / "result.json"
    if result_path.exists():
        original = read_json(result_path)
        if any(original.get(k) != result[k] for k in ("actionKey", "requestSha256", "status", "body")):
            raise Error("Existing original action result contradicts this evidence")
    else:
        package.publish_json(result_path, result)
    if key == "start-transfer":
        ctx.save("TRANSFER_STARTED", transferUuid=body["id"])
    if key == "backlog/create-sip":
        ctx.save("INGESTING", sipUuid=body["sip_uuid"])
    return observe_workflow(ctx)


def _entry(workspace, operation_id, action, argument=None):
    root = Path(workspace).absolute()
    with package.lock(root):
        ctx = Context(root, operation_id, True)
        try:
            if action == "run":
                return _run(ctx)
            if action == "refresh":
                ctx.cooldown()
                return observe_workflow(ctx)
            if action == "reconcile":
                return _reconcile(ctx, argument)
            if action == "decide":
                return _decide(ctx, argument)
            raise Error("Unsupported operation action")
        except Pause as paused:
            return ctx.save(paused.state, message=paused.message, details=paused.details,
                            **({"retryAfterEpoch": paused.details["retryAfterEpoch"]}
                               if paused.details.get("retryAfterEpoch") is not None else {}))
        except (Error, OSError, ValueError) as exc:
            ctx.save("FAILED", message=str(exc), failureType=type(exc).__name__)
            raise


def run(workspace, operation_id):
    return _entry(workspace, operation_id, "run")


def refresh(workspace, operation_id):
    return _entry(workspace, operation_id, "refresh")


def reconcile(workspace, operation_id, evidence):
    return _entry(workspace, operation_id, "reconcile", evidence)


def decide(workspace, operation_id, evidence):
    return _entry(workspace, operation_id, "decide", evidence)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("configuration-template")
    template = commands.add_parser("reconciliation-template")
    template.add_argument("--kind", default=RECONCILIATION_KINDS[0], choices=RECONCILIATION_KINDS)
    create = commands.add_parser("plan")
    create.add_argument("--workspace", required=True)
    create.add_argument("--configuration", required=True)
    create.add_argument("--operation-id", required=True)
    for name in ("show", "run", "refresh", "reconcile", "decide"):
        command = commands.add_parser(name)
        command.add_argument("--workspace", required=True)
        command.add_argument("--operation-id", required=True)
        if name in {"reconcile", "decide"}:
            command.add_argument("--evidence", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "configuration-template":
            result = configuration_template()
        elif args.command == "reconciliation-template":
            result = reconciliation_template(args.kind)
        elif args.command == "plan":
            result = plan(args.workspace, read_json(args.configuration), args.operation_id)
        elif args.command in {"reconcile", "decide"}:
            result = globals()[args.command](args.workspace, args.operation_id, read_json(args.evidence))
        else:
            result = globals()[args.command](args.workspace, args.operation_id)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (Error, OSError, ValueError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
