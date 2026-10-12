"""MIT. Original FHIR Bulk Data HTTP custody, SMART auth and resumable export operations."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import stat
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler
import uuid
import zipfile

from fhir_source import (InputError, MAX_SOURCE, MAX_FILES, MAX_MANIFEST, MAX_LINE, SOURCE_SCHEMA,
    CONNECTION_SCHEMA, EXPORT_SCHEMA, jbytes, sha, json_value, text, exact, integer, identity,
    operation_id, http_url, origin, instant, epoch, validate_connection, validate_export,
    request_matches, manifest_value, member_name, descriptor, file_identity, Packet)
from fhir_runtime import original_workspace

HERE = Path(__file__).resolve().parent
OPERATION_SCHEMA = "stellar-forge.fhir-bulk-operation.v1"
CREDENTIAL_SCHEMA = "stellar-forge.fhir-bulk-credentials.v1"
RECEIPT_SCHEMA = "stellar-forge.fhir-bulk-http-receipt.v1"
MAX_PROTOCOL = 32 * 1024 * 1024
MAX_HTTP_STEPS = 8192
TIMEOUT = 45
RETRY_CODES = {408, 429, 500, 502, 503, 504}
SAFE_HEADERS = {"content-type", "content-length", "content-encoding", "content-range", "content-location",
    "location", "etag", "last-modified", "retry-after", "x-progress", "x-export-status",
    "preference-applied", "date", "expires", "cache-control", "accept-ranges", "www-authenticate"}


class ConflictError(InputError):
    status = 409


class ProviderError(InputError):
    status = 502
    def __init__(self, message, provider_status=None, retry_after=None, not_before=None, receipt=None):
        super().__init__(message)
        self.provider_status = provider_status
        self.retry_after = retry_after
        self.not_before = not_before
        self.receipt = receipt


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def later(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def retry_time(value, attempt=0):
    minimum = min(60, 1 * 2 ** min(6, attempt))
    delay = minimum
    if value:
        try:
            if re.fullmatch(r"[0-9]+", value.strip()):
                delay = max(delay, int(value))
            else:
                target = parsedate_to_datetime(value)
                if target.tzinfo is None:
                    target = target.replace(tzinfo=timezone.utc)
                delay = max(delay, (target - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            pass
    # An actual long provider wait remains long; the client never shortens Retry-After.
    return later(delay)


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    original_workspace.private_write(temporary, jbytes(value))
    os.replace(temporary, path)
    original_workspace.sync_dir(path.parent)


def private_directory(path):
    path = Path(path)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.is_symlink() or (os.name == "posix" and
       (info.st_uid != os.getuid() or info.st_mode & 0o077)):
        raise InputError("Original operation directories must be real private operator directories")
    return path


def safe_read(path, limit=MAX_MANIFEST):
    path = Path(path)
    before = original_workspace.regular(path, limit)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size) != (before.st_dev, before.st_ino, before.st_size):
            raise InputError("Retained file changed while opening")
        result = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    if len(result) > limit or (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
        raise InputError("Retained file changed while reading")
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def opener():
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return build_opener(NoRedirect(), HTTPSHandler(context=context))


class Credentials:
    def __init__(self, path=None):
        self.path = None
        self.tokens = {}
        if path is not None:
            supplied = Path(path).expanduser()
            if not supplied.is_absolute():
                raise InputError("The local credentials file must have an absolute path")
            if supplied.is_symlink():
                raise InputError("The local credentials file must be a regular private file")
            self.path = supplied
            self._profiles()

    def _profiles(self):
        if self.path is None:
            return {}
        value = json_value(safe_read(self.path, 1024 * 1024))
        exact(value, {"schema", "profiles"}, "Local credential file")
        if value.get("schema") != CREDENTIAL_SCHEMA or not isinstance(value.get("profiles"), dict) or len(value["profiles"]) > 64:
            raise InputError("Unsupported local credential profile file")
        profiles = {}
        for name, raw in value["profiles"].items():
            operation_id(name)
            exact(raw, {"type", "origins", "token", "clientId", "tokenEndpoint", "scope",
                        "privateJwk", "kid", "algorithm", "jwksUrl"}, "Local authentication profile")
            if raw.get("type") not in {"bearer", "smart_backend"}:
                raise InputError("Choose bearer or smart_backend authentication")
            origins = raw.get("origins")
            if not isinstance(origins, list) or not origins or len(origins) > 32:
                raise InputError("A configured authentication profile needs its explicit allowed origins")
            for item in origins:
                parsed = urlsplit(http_url(item))
                if parsed.path not in {"", "/"} or parsed.query:
                    raise InputError("Credential origins must be exact scheme/host/port origins")
            if raw["type"] == "bearer":
                token = text(raw.get("token"), "Configured bearer token", 65536, False)
                if re.search(r"\s", token):
                    raise InputError("Configured bearer token contains whitespace")
            else:
                text(raw.get("clientId"), "Registered SMART client ID", 2048, False)
                http_url(raw.get("tokenEndpoint"), "Registered token endpoint")
                if raw.get("algorithm") not in {"RS384", "ES384"} or not isinstance(raw.get("privateJwk"), dict):
                    raise InputError("SMART requires the registered private JWK and RS384 or ES384")
                scope = raw.get("scope")
                if isinstance(scope, list):
                    if any(not isinstance(s, str) or not s or re.search(r"\s", s) for s in scope):
                        raise InputError("SMART scopes must be exact nonempty scope tokens")
                    scope = " ".join(scope)
                text(scope, "Reviewed SMART scope", 8192, False)
            profiles[name] = raw
        return profiles

    def public(self):
        return [{"name": name, "type": raw["type"], "origins": list(raw["origins"])}
                for name, raw in sorted(self._profiles().items())]

    def authorization(self, connection, url, required=None):
        if required is False:
            return None
        name = connection.get("authProfile")
        if not name:
            if required:
                raise ProviderError("The original manifest requires a configured authorization profile")
            return None
        raw = self._profiles().get(name)
        if raw is None:
            raise InputError("The retained connection's local authentication profile is not configured")
        if origin(url) not in {origin(item) for item in raw["origins"]}:
            raise InputError("The original URL is outside this credential profile's explicitly configured origins")
        if raw["type"] == "bearer":
            return "Bearer " + raw["token"]
        fingerprint = sha(jbytes(raw))
        cached = self.tokens.get(name)
        if cached and cached["profile"] == fingerprint and cached["expires"] > time.time() + 15:
            return "Bearer " + cached["token"]
        signed = subprocess.run([os.environ.get("SF30_FHIR_NODE", os.environ.get("SF30_XML_NODE", "node")),
            str(HERE / "fhir_auth.mjs")], input=jbytes(raw), stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=30, check=False)
        if signed.returncode or len(signed.stdout) > 65536:
            raise InputError("The registered SMART assertion could not be signed with the selected original key")
        assertion = json_value(signed.stdout).get("assertion")
        if not isinstance(assertion, str):
            raise InputError("The native SMART signer did not return its assertion")
        scope = " ".join(raw["scope"]) if isinstance(raw["scope"], list) else raw["scope"]
        form = urlencode({"grant_type": "client_credentials", "scope": scope,
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": assertion}).encode()
        request = Request(raw["tokenEndpoint"], form,
            {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        try:
            with opener().open(request, timeout=TIMEOUT) as response:
                result = response.read(1024 * 1024 + 1)
                if len(result) > 1024 * 1024:
                    raise InputError("OAuth response exceeds the supported token-response limit")
        except HTTPError as error:
            # Token responses and assertions are never stored in source custody or error payloads.
            raise ProviderError("The selected authorization server rejected the registered client request",
                                error.code, error.headers.get("Retry-After")) from None
        except (OSError, URLError) as error:
            raise ProviderError("The selected authorization server could not be reached") from error
        token = json_value(result)
        if not isinstance(token, dict) or str(token.get("token_type", "")).lower() != "bearer":
            raise InputError("OAuth token_type is not Bearer")
        value = text(token.get("access_token"), "Returned access token", 65536, False)
        if re.search(r"\s", value):
            raise InputError("Authorization server returned an invalid bearer token")
        lifetime = token.get("expires_in")
        if type(lifetime) is not int or not 1 <= lifetime <= 86400:
            raise InputError("Authorization server must return a supported explicit token lifetime")
        self.tokens[name] = {"profile": fingerprint, "expires": time.time() + lifetime, "token": value}
        return "Bearer " + value


class Transport:
    def __init__(self, credentials):
        self.credentials = credentials

    def _open(self, method, url, headers, body, connection, required=None, allow_external=False):
        current = http_url(url)
        redirects = []
        for _ in range(6):
            if not allow_external and origin(current) != origin(connection["baseUrl"]):
                profiles = {item["name"]: item for item in self.credentials.public()}
                profile = profiles.get(connection.get("authProfile"))
                if not profile or origin(current) not in {origin(x) for x in profile["origins"]}:
                    raise InputError("Native control/discovery URL changed its reviewed provider origin")
            outgoing = dict(headers)
            authorization = self.credentials.authorization(connection, current, required)
            if authorization:
                outgoing["Authorization"] = authorization
            try:
                response = opener().open(Request(current, body, outgoing, method=method), timeout=TIMEOUT)
            except HTTPError as error:
                response = error
            if response.code not in {301, 302, 303, 307, 308}:
                return response, current, redirects
            location = response.headers.get("Location")
            status = response.code
            response.close()
            if not location:
                raise ProviderError("Provider redirect is missing its Location", status)
            if method not in {"GET", "HEAD"} and status not in {307, 308}:
                raise ProviderError("Provider redirected a retained mutation with a method-changing redirect", status)
            destination = http_url(urljoin(current, location), "Native redirect URL")
            redirects.append({"status": status, "from": current, "to": destination})
            current = destination
        raise ProviderError("Provider exceeded six retained redirects")

    def receive(self, directory, stem, method, url, headers, body, connection,
                limit=MAX_MANIFEST, required=None, allow_external=False, offset=0, validator=None,
                encoding=None, target=None):
        """Retain exact wire response and a completed receipt before the caller changes operation state."""
        directory = private_directory(directory)
        operation_id(stem)
        receipt_path = directory / (stem + ".receipt.json")
        if receipt_path.exists():
            receipt = json_value(safe_read(receipt_path))
            expected = sha(jbytes({"method": method, "url": url, "headers": headers,
                "bodySha256": sha(body) if body is not None else None, "offset": offset, "validator": validator}))
            if receipt.get("requestSha256") != expected:
                raise ConflictError("Retained HTTP step identity was reused for a different request")
            if receipt.get("body"):
                original_workspace.regular(directory / receipt["body"], limit)
                if original_workspace.file_digest(directory / receipt["body"], limit) != receipt["sha256"]:
                    raise InputError("Retained original HTTP bytes changed")
            return receipt
        request_sha = sha(jbytes({"method": method, "url": url, "headers": headers,
            "bodySha256": sha(body) if body is not None else None, "offset": offset, "validator": validator}))
        receipt = {"schema": RECEIPT_SCHEMA, "id": stem, "requestSha256": request_sha,
            "method": method, "url": url, "at": now(), "status": None, "headers": {},
            "body": None, "sha256": None, "bytes": 0, "complete": False, "redirects": []}
        partial_path = directory / (stem + ".wire")
        if partial_path.exists():
            # No complete receipt means an interrupted original attempt. Preserve that exact partial.
            original_workspace.regular(partial_path, limit)
            retained = directory / (stem + ".interrupted-" + uuid.uuid4().hex + ".wire")
            os.replace(partial_path, retained)
            original_workspace.sync_dir(directory)
        outgoing = dict(headers)
        if offset:
            outgoing["Range"] = "bytes=" + str(offset) + "-"
            outgoing["If-Range"] = validator
        try:
            response, actual_url, redirects = self._open(method, url, outgoing, body, connection, required, allow_external)
            receipt["actualUrl"], receipt["redirects"] = actual_url, redirects
            receipt["status"] = response.code
            receipt["headers"] = {key.lower(): value for key, value in response.headers.items() if key.lower() in SAFE_HEADERS}
            accepted = True
            if offset:
                content_range = response.headers.get("Content-Range", "")
                match = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)", content_range)
                received_validator = response.headers.get("ETag") if validator and validator.startswith('"') else response.headers.get("Last-Modified")
                accepted = response.code == 206 and match and int(match[1]) == offset and received_validator == validator
                if encoding is not None and response.headers.get("Content-Encoding", "identity").lower() != encoding:
                    accepted = False
                if not accepted:
                    receipt["restartRequired"] = True
                    response.close()
                    atomic_json(receipt_path, receipt)
                    return receipt
            digest, count = hashlib.sha256(), 0
            with response, os.fdopen(os.open(partial_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                receipt["body"] = partial_path.name
                while block := response.read(65536):
                    count += len(block)
                    if count > limit:
                        raise InputError("The native response exceeds the reviewed remaining source-byte budget")
                    digest.update(block)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            expected_length = receipt["headers"].get("content-length")
            if expected_length is not None and re.fullmatch(r"[0-9]+", expected_length.strip()) and count != int(expected_length):
                raise InputError("The original HTTP body ended before its declared Content-Length")
            if offset:
                match = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)", receipt["headers"].get("content-range", ""))
                if not match or count != int(match[2]) - int(match[1]) + 1 or int(match[2]) + 1 != int(match[3]):
                    raise InputError("The original byte range did not complete its declared resource length")
            receipt["complete"] = True
        except (OSError, URLError, http.client.HTTPException, TimeoutError, InputError) as error:
            if isinstance(error, (InputError, ProviderError)) and not partial_path.exists():
                raise
            receipt["transportError"] = "The original response was interrupted" if not isinstance(error, InputError) else str(error)
        if partial_path.exists():
            receipt["bytes"] = partial_path.stat().st_size
            receipt["sha256"] = original_workspace.file_digest(partial_path, limit)
        receipt["finishedAt"] = now()
        atomic_json(receipt_path, receipt)
        return receipt


def decoded_body(directory, receipt, maximum=MAX_MANIFEST):
    if not receipt.get("body"):
        return b""
    raw = safe_read(Path(directory) / receipt["body"], maximum)
    if receipt.get("headers", {}).get("content-encoding", "identity").lower() == "gzip":
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                decoded = stream.read(maximum + 1)
            if len(decoded) > maximum:
                raise InputError("Decoded provider response exceeds the supported budget")
            return decoded
        except (OSError, EOFError) as error:
            raise InputError("Provider response has invalid gzip bytes") from error
    if receipt.get("headers", {}).get("content-encoding", "identity").lower() not in {"identity", ""}:
        raise InputError("Provider response encoding is not identity or gzip")
    return raw


def write_zip(path, members):
    """Deterministic original-byte packet assembly; file objects are streamed."""
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for name, value in sorted(members.items()):
            member_name(name)
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            with archive.open(info, "w", force_zip64=True) as output:
                if isinstance(value, bytes):
                    output.write(value)
                else:
                    with Path(value).open("rb") as stream:
                        shutil.copyfileobj(stream, output, 65536)
    Path(path).chmod(0o600)
    with Path(path).open("rb") as stream:
        os.fsync(stream.fileno())


class Acquisition:
    def __init__(self, workspace, credentials):
        self.ws = workspace
        self.credentials = credentials
        self.transport = Transport(credentials)
        self.root = private_directory(self.ws.root / "fhir")
        self.operations = private_directory(self.root / "operations")
        self.observations = private_directory(self.root / "observations")

    def directory(self, op_id):
        return private_directory(self.operations / operation_id(op_id))

    def _save(self, op, action=None, receipt=None):
        op["updatedAt"] = now()
        if action:
            entry = {"at": op["updatedAt"], "action": action}
            if receipt:
                entry.update({"status": receipt.get("status"),
                              "receipt": {"id": receipt["id"], "sha256": receipt.get("sha256"),
                                          "bytes": receipt.get("bytes"), "complete": receipt.get("complete")}})
            op["history"].append(entry)
        if len(op["history"]) > MAX_HTTP_STEPS * 2:
            raise InputError("Retained operation exceeds its explicit supported HTTP-step budget")
        atomic_json(self.directory(op["operationId"]) / "operation.json", op)
        self.ws._put("operations", op["operationId"], op, immutable=False)
        return op

    def operation(self, op_id):
        op_id = operation_id(op_id)
        path = self.operations / op_id / "operation.json"
        if path.exists():
            result = json_value(safe_read(path, MAX_MANIFEST))
            if result.get("operationId") != op_id or result.get("schema") != OPERATION_SCHEMA:
                raise InputError("Retained operation identity changed")
            row = self.ws._get("operations", op_id, required=False)
            if row != result:
                self.ws._put("operations", op_id, result, immutable=False)
            return result
        return self.ws._get("operations", op_id)

    def _remaining(self, directory, export):
        size = 0
        for parent, folders, files in os.walk(directory, followlinks=False):
            for name in folders:
                if (Path(parent) / name).is_symlink():
                    raise InputError("Operation storage contains an unsupported symbolic link")
            for name in files:
                path = Path(parent) / name
                original_workspace.regular(path, MAX_SOURCE)
                size += path.stat().st_size
        return max(0, export["limits"]["maxBytes"] - size)

    def _new_step(self, op, action, url, method="GET", headers=None, body=None, **values):
        sequence = op.get("_sequence", 0) + 1
        if sequence > MAX_HTTP_STEPS:
            raise InputError("The retained operation reached its supported HTTP-step budget")
        op["_sequence"] = sequence
        step = {"id": "step-" + str(sequence).zfill(6), "action": action, "method": method,
                "url": http_url(url), "headers": headers or {}, "bodyText": body, **values}
        op["_pending"] = step
        if action == "kickoff":
            op["state"], op["phase"] = "kickoff_unknown", "kickoff"
        self._save(op, "request-prepared:" + action)
        return step

    def _request(self, op, step, export, connection, fresh=False):
        directory = self.directory(op["operationId"])
        receipts = private_directory(directory / "receipts")
        receipt_file = receipts / (step["id"] + ".receipt.json")
        if step["action"] == "kickoff" and not fresh and not receipt_file.exists():
            # The native request may already have started a server job. Recover its actual Content-Location.
            return None
        remaining = self._remaining(directory, export)
        if remaining <= 0:
            raise InputError("The complete retained operation reached its reviewed source-byte budget")
        return self.transport.receive(receipts, step["id"], step["method"], step["url"],
            step["headers"], step.get("bodyText").encode() if step.get("bodyText") is not None else None,
            connection, limit=min(remaining, MAX_MANIFEST if step["action"] != "file" else MAX_SOURCE),
            required=step.get("requiresAccessToken"),
            allow_external=step["action"] == "file", offset=step.get("offset", 0),
            validator=step.get("validator"), encoding=step.get("encoding"))

    def _decoded(self, op, receipt):
        directory = self.directory(op["operationId"]) / "receipts"
        return decoded_body(directory, receipt)

    def _error(self, op, receipt, message, retryable=False):
        op["error"] = {"message": message, "providerStatus": receipt.get("status"),
                       "receipt": {"id": receipt["id"], "sha256": receipt.get("sha256")}}
        if retryable:
            op["_retryCount"] = op.get("_retryCount", 0) + 1
            op["state"] = "waiting"
            op["notBefore"] = retry_time(receipt.get("headers", {}).get("retry-after"), op["_retryCount"])
        else:
            op["state"] = "failed"
            op["notBefore"] = None

    def _apply_control(self, op, step, receipt, export, connection):
        action, status = step["action"], receipt.get("status")
        if not receipt.get("complete"):
            if action == "kickoff":
                op["state"], op["phase"] = "kickoff_unknown", "kickoff"
                op["error"] = {"message": "The initial native response was interrupted; receive its actual provider status URL",
                               "providerStatus": status, "receipt": {"id": receipt["id"]}}
            else:
                self._error(op, receipt, "The original provider response was interrupted", True)
            return
        headers = receipt.get("headers", {})
        if action == "kickoff":
            if status != 202:
                self._error(op, receipt, "The original kick-off did not return HTTP 202 and a status URL",
                            status in RETRY_CODES and status != 500)
                # HTTP errors are known responses, but creating another server job remains an explicit new operation.
                if op["state"] == "waiting":
                    op["state"] = "failed"
                return
            location = headers.get("content-location")
            if not location:
                op["state"] = "kickoff_unknown"
                op["error"] = {"message": "The provider accepted the export without returning its Content-Location",
                               "providerStatus": status, "receipt": {"id": receipt["id"]}}
                return
            op["statusUrl"] = http_url(urljoin(receipt.get("actualUrl", step["url"]), location), "Provider status URL")
            applied = headers.get("preference-applied", "").lower()
            op["_separateAccepted"] = export["parameters"]["separateExportStatus"] and "separate-export-status" in applied
            op["state"], op["phase"] = "exporting", "status"
            op["notBefore"] = retry_time(headers.get("retry-after"))
            op["_statusPage"] = 0
            op["_pollUrl"] = op["statusUrl"]
            return
        effective = status
        if status == 200 and op.get("_separateAccepted") and "x-export-status" in headers:
            if not re.fullmatch(r"[0-9]{3}", headers["x-export-status"].strip()):
                raise InputError("Provider X-Export-Status is not a valid native status")
            effective = int(headers["x-export-status"])
        op["progress"] = headers.get("x-progress")
        if effective not in {200, 202}:
            raw = self._decoded(op, receipt)
            retryable = effective in RETRY_CODES
            try:
                outcome = json_value(raw)
                if isinstance(outcome, dict) and outcome.get("resourceType") == "OperationOutcome":
                    retryable = retryable or any(isinstance(item, dict) and item.get("code") in
                        {"transient", "timeout", "throttled"} for item in outcome.get("issue", []))
            except InputError:
                pass
            self._error(op, {**receipt, "status": effective},
                        "The native export status returned " + str(effective), retryable)
            return
        raw = self._decoded(op, receipt)
        candidate = None
        if raw.strip():
            try:
                value = json_value(raw)
                if isinstance(value, dict) and "transactionTime" in value and "output" in value:
                    candidate = value
            except InputError:
                if effective == 200:
                    raise
        if candidate is None:
            if effective == 200:
                raise InputError("Completed native export did not return its complete manifest")
            op["state"], op["phase"] = "exporting", "status"
            op["_retryCount"] = op.get("_retryCount", 0) + 1
            op["notBefore"] = retry_time(headers.get("retry-after"), op["_retryCount"])
            return
        if effective == 202 and not export["parameters"]["allowPartialManifests"]:
            raise InputError("Provider returned an unrequested partial manifest")
        page = step.get("page", 0)
        chain = op.get("_manifestChain", [])
        previous = None
        if page:
            if page > len(chain):
                raise InputError("Native manifest pagination skipped an original page")
            previous = json_value(safe_read(self.directory(op["operationId"]) / chain[page - 1]["path"]))
        manifest = manifest_value(raw, export, previous)
        decoded = self.directory(op["operationId"]) / "receipts" / (step["id"] + ".manifest.json")
        if decoded.exists():
            if safe_read(decoded) != raw:
                raise ConflictError("Original decoded manifest step changed")
        else:
            original_workspace.private_write(decoded, raw)
        next_url = manifest.get("link", [{}])[0].get("url") if manifest.get("link") else None
        page_record = {"id": sha(raw), "url": step["url"], "status": status, "exportStatus": effective,
            "sha256": sha(raw), "bytes": len(raw), "transactionTime": manifest["transactionTime"],
            "nextUrl": next_url, "path": str(decoded.relative_to(self.directory(op["operationId"])))}
        if page < len(chain):
            older = json_value(safe_read(self.directory(op["operationId"]) / chain[page]["path"]))
            for key in ["transactionTime", "request", "requiresAccessToken", "outputOrganizedBy", "error", "extension"]:
                if older.get(key) != manifest.get(key):
                    raise InputError("The provider changed an already issued manifest's shared " + key)
            for kind in ["output", "error", "deleted"]:
                old_files, new_files = older.get(kind, []), manifest.get(kind, [])
                if len(new_files) < len(old_files):
                    raise InputError("The provider removed an already issued output file")
                for index, old_file in enumerate(old_files):
                    if any(old_file.get(key) != new_files[index].get(key) for key in ["type", "count", "continuesInFile"]):
                        raise InputError("The provider changed an already issued immutable output file")
            chain[page] = page_record
            chain = chain[:page + 1]
        else:
            chain.append(page_record)
        current = {item["id"]: item for item in op["files"]}
        for kind in ["output", "error", "deleted"]:
            for index, item in enumerate(manifest.get(kind, [])):
                fid = file_identity(page, kind, index)
                actual = current.get(fid)
                if actual:
                    actual["url"] = item["url"]
                    actual["continuesInFile"] = item.get("continuesInFile")
                else:
                    actual = {"id": fid, "kind": kind, "type": item.get("type"), "url": item["url"],
                        "count": item.get("count"), "continuesInFile": item.get("continuesInFile"),
                        "state": "pending", "bytes": 0, "parts": [], "attempts": [], "page": page,
                        "requiresAccessToken": manifest["requiresAccessToken"]}
                    op["files"].append(actual)
        if len(op["files"]) > export["limits"]["maxFiles"]:
            raise InputError("The complete native export exceeds the reviewed maxFiles")
        op["_manifestChain"] = chain
        op["manifests"] = [{k: v for k, v in item.items() if k != "path"} for item in chain]
        op["_nextManifest"] = next_url
        op["_statusPage"] = page
        op["_pollUrl"] = step["url"]
        op["_manifestComplete"] = effective == 200 and next_url is None
        op["transactionTime"] = manifest["transactionTime"]
        op["_retryCount"] = 0
        op["state"], op["phase"] = "receiving", "files"
        op["notBefore"] = retry_time(headers.get("retry-after")) if effective == 202 else None

    def _apply_file(self, op, step, receipt, export):
        item = next((f for f in op["files"] if f["id"] == step["fileId"]), None)
        if item is None:
            raise InputError("Original download no longer identifies its manifest file")
        item["attempts"].append({"receipt": receipt["id"], "status": receipt.get("status"),
                                 "bytes": receipt.get("bytes", 0), "sha256": receipt.get("sha256")})
        if receipt.get("restartRequired"):
            item["parts"], item["bytes"] = [], 0
            item.pop("validator", None)
            item["state"] = "pending"
            op["state"], op["phase"] = "receiving", "files"
            op["notBefore"] = None
            return
        status = receipt.get("status")
        if status not in {200, 206}:
            if status in {401, 403, 404, 410}:
                # Refresh the same status/manifest to receive renewed native download URLs.
                op["_manifestComplete"] = False
                op["_pollUrl"] = op["statusUrl"]
                op["_statusPage"] = 0
                op["state"], op["phase"] = "exporting", "status"
                op["notBefore"] = retry_time(receipt.get("headers", {}).get("retry-after"))
                item["state"] = "pending"
                item["urlFailures"] = item.get("urlFailures", 0) + 1
                if item["urlFailures"] > 2:
                    self._error(op, receipt, "The original download remains unavailable after its native manifest was refreshed")
                return
            self._error(op, receipt, "The native output file returned " + str(status),
                        status is None or status in RETRY_CODES)
            return
        headers = receipt.get("headers", {})
        if status == 206 and not step.get("offset"):
            raise InputError("Provider returned an unsolicited partial resource file")
        encoding = headers.get("content-encoding", "identity").lower()
        if encoding not in {"", "identity", "gzip"}:
            raise InputError("Original output encoding is not identity or gzip")
        current_validator = headers.get("etag")
        if current_validator and current_validator.startswith("W/"):
            current_validator = None
        if not current_validator:
            current_validator = headers.get("last-modified")
        if not step.get("offset"):
            item["parts"] = []
            item["validator"] = current_validator
            item["encoding"] = encoding
        if receipt.get("body"):
            item["parts"].append({"name": "receipts/" + receipt["body"], "bytes": receipt["bytes"],
                                  "sha256": receipt["sha256"], "receipt": receipt["id"]})
        item["bytes"] = sum(part["bytes"] for part in item["parts"])
        item["contentType"] = headers.get("content-type", item.get("contentType"))
        if not receipt.get("complete"):
            if not item.get("validator"):
                # Keep the original incomplete attempt, then receive a whole new one without concatenation.
                item["parts"], item["bytes"] = [], 0
            item["state"] = "partial" if item["parts"] else "pending"
            op["state"], op["phase"] = "waiting", "files"
            op["notBefore"] = retry_time(headers.get("retry-after"), op.get("_retryCount", 0))
            op["_retryCount"] = op.get("_retryCount", 0) + 1
            return
        directory = self.directory(op["operationId"])
        files = private_directory(directory / "files")
        wire = files / (item["id"] + ".wire")
        if wire.exists():
            original_workspace.regular(wire)
            wire.unlink()
        with os.fdopen(os.open(wire, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
            for part in item["parts"]:
                path = directory / part["name"]
                if original_workspace.file_digest(path) != part["sha256"]:
                    raise InputError("An original file range changed before complete receiving")
                with path.open("rb") as stream:
                    shutil.copyfileobj(stream, out, 65536)
            out.flush()
            os.fsync(out.fileno())
        target = files / (item["id"] + ".ndjson")
        if target.exists():
            original_workspace.regular(target)
            target.unlink()
        decoded_count, digest, lines = 0, hashlib.sha256(), 0
        try:
            with wire.open("rb") as original, \
                 (gzip.GzipFile(fileobj=original) if encoding == "gzip" else original) as decoded, \
                 os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                while raw := decoded.readline(export["limits"]["maxLineBytes"] + 1):
                    if len(raw) > export["limits"]["maxLineBytes"]:
                        raise InputError("Native NDJSON line exceeds the reviewed maxLineBytes")
                    decoded_count += len(raw)
                    if decoded_count > export["limits"]["maxBytes"]:
                        raise InputError("Decoded original file exceeds the complete source-byte budget")
                    digest.update(raw)
                    out.write(raw)
                    lines += bool(raw.strip())
                out.flush()
                os.fsync(out.fileno())
        except (OSError, EOFError) as error:
            raise InputError("The original output could not be decoded as complete native gzip/NDJSON bytes") from error
        item.update({"state": "complete", "bytes": decoded_count, "wireBytes": wire.stat().st_size,
                     "sha256": digest.hexdigest(), "lineCount": lines, "name": str(target.relative_to(directory)),
                     "wireName": str(wire.relative_to(directory))})
        if item.get("count") is not None and item["count"] != lines:
            raise InputError("Original manifest count differs from the received complete NDJSON records")
        op["state"], op["phase"], op["notBefore"], op["error"] = "receiving", "files", None, None
        op["_retryCount"] = 0

    def _finish(self, op, export, connection):
        if not op.get("_manifestComplete") or any(item["state"] != "complete" for item in op["files"]):
            raise InputError("The full original manifest/file chain is not complete")
        directory = self.directory(op["operationId"])
        packet = directory / "source.zip"
        members, protocol, files, original_paths = {}, [], [], {}
        for item in op["files"]:
            path = directory / item["name"]
            native = {k: item.get(k) for k in ["id", "name", "kind", "type", "url", "count", "continuesInFile",
                                               "bytes", "sha256", "lineCount", "contentType"]}
            files.append(native)
            members[native["name"]] = path
        receipts = directory / "receipts"
        for path in sorted(receipts.iterdir()):
            original_workspace.regular(path)
            name = "protocol/" + path.name
            role = "manifest" if path.name.endswith(".manifest.json") else "http-receipt" if path.name.endswith(".receipt.json") else "http-wire"
            descriptor_value = {"name": name, "bytes": path.stat().st_size,
                                "sha256": original_workspace.file_digest(path), "role": role}
            protocol.append(descriptor_value)
            members[name] = path
            original_paths[str(path.relative_to(directory))] = name
        manifests = [{"name": original_paths[item["path"]], "url": item["url"],
                      "status": item["status"], "exportStatus": item["exportStatus"]}
                     for item in op["_manifestChain"]]
        manifest = {"schema": SOURCE_SCHEMA, "mode": "capture", "operationId": op["operationId"],
            "connection": connection, "export": export, "transactionTime": op["transactionTime"],
            "files": files, "protocol": protocol, "manifests": manifests, "transportArtifacts": original_paths}
        members["manifest.json"] = jbytes(manifest)
        total = sum(len(value) if isinstance(value, bytes) else value.stat().st_size for value in members.values())
        if total > export["limits"]["maxBytes"] or total > MAX_SOURCE:
            raise InputError("The complete original source packet exceeds its reviewed byte budget")
        if packet.exists():
            with packet.open("rb") as stream:
                result = self.ws.add_source(stream, export["label"], "fhir-bulk-source.zip")
        else:
            temporary = directory / "source.receiving.zip"
            if temporary.exists():
                original_workspace.regular(temporary)
                temporary.unlink()
            write_zip(temporary, members)
            os.replace(temporary, packet)
            original_workspace.sync_dir(directory)
            with packet.open("rb") as stream:
                result = self.ws.add_source(stream, export["label"], "fhir-bulk-source.zip")
        op.update({"state": "complete", "phase": "complete", "notBefore": None, "error": None,
                   "sourceId": result["id"], "source": {k: result[k] for k in ["id", "label", "name", "bytes", "created"]}})
        return self._save(op, "original-source-received")

    def advance(self, export_id, op_id):
        export_id, op_id = identity(export_id), operation_id(op_id)
        export = self.ws.export_plan(export_id)["export"]
        connection = self.ws.connection(export["connectionId"])["connection"]
        with self.ws.mutex:
            op = self.ws._get("operations", op_id, required=False)
            if op is None and (self.operations / op_id / "operation.json").exists():
                op = self.operation(op_id)
            if op is None:
                timestamp = now()
                op = {"schema": OPERATION_SCHEMA, "operationId": op_id, "exportId": export_id,
                    "connectionId": export["connectionId"], "state": "prepared", "phase": "kickoff",
                    "requestSha256": export["request"]["requestSha256"], "createdAt": timestamp, "updatedAt": timestamp,
                    "statusUrl": None, "notBefore": None, "progress": None, "files": [], "manifests": [],
                    "sourceId": None, "source": None, "error": None, "history": [], "_sequence": 0}
                self._save(op, "operation-retained")
            else:
                op = self.operation(op_id)
            if op["exportId"] != export_id or op["requestSha256"] != export["request"]["requestSha256"]:
                raise ConflictError("Original operation ID already belongs to another retained export")
            if op["state"] in {"complete", "cancelled", "cancel_unknown", "failed"}:
                return op
            if op.get("notBefore") and epoch(op["notBefore"]) > epoch(now()):
                return op
            fresh = False
            step = op.get("_pending")
            if step is None:
                if op["phase"] == "kickoff":
                    if op["state"] == "kickoff_unknown":
                        return op
                    request = export["request"]
                    step = self._new_step(op, "kickoff", request["url"], request["method"],
                                          request["headers"], request["bodyText"])
                    fresh = True
                elif op["phase"] == "status":
                    step = self._new_step(op, "status", op.get("_pollUrl") or op["statusUrl"],
                        headers={"Accept": "application/json", "Accept-Encoding": "gzip"},
                        page=op.get("_statusPage", 0))
                else:
                    pending = next((item for item in op["files"] if item["state"] != "complete"), None)
                    if pending:
                        offset = sum(part["bytes"] for part in pending.get("parts", []))
                        step = self._new_step(op, "file", pending["url"],
                            headers={"Accept": "application/fhir+ndjson,application/ndjson,application/octet-stream",
                                     "Accept-Encoding": "gzip"},
                            fileId=pending["id"], requiresAccessToken=pending["requiresAccessToken"],
                            offset=offset if pending.get("validator") else 0, validator=pending.get("validator"),
                            encoding=pending.get("encoding"))
                    elif op.get("_nextManifest"):
                        op["_statusPage"] += 1
                        op["_pollUrl"], op["phase"] = op["_nextManifest"], "manifest"
                        step = self._new_step(op, "status", op["_nextManifest"],
                            headers={"Accept": "application/json", "Accept-Encoding": "gzip"},
                            page=op["_statusPage"])
                    elif op.get("_manifestComplete"):
                        return self._finish(op, export, connection)
                    else:
                        op["phase"] = "status"
                        step = self._new_step(op, "status", op.get("_pollUrl") or op["statusUrl"],
                            headers={"Accept": "application/json", "Accept-Encoding": "gzip"},
                            page=op.get("_statusPage", 0))
            try:
                receipt = self._request(op, step, export, connection, fresh)
                if receipt is None:
                    return op
                if step["action"] == "file":
                    self._apply_file(op, step, receipt, export)
                else:
                    self._apply_control(op, step, receipt, export, connection)
                op.pop("_pending", None)
                return self._save(op, "response-received:" + step["action"], receipt)
            except (InputError, OSError, URLError) as error:
                if isinstance(error, ConflictError):
                    raise
                op["error"] = {"message": str(error), "providerStatus": getattr(error, "provider_status", None),
                               "receipt": getattr(error, "receipt", None)}
                if step["action"] == "kickoff":
                    op["state"], op["phase"] = "kickoff_unknown", "kickoff"
                else:
                    op["state"] = "failed"
                op["notBefore"] = None
                self._save(op, "receiving-paused:" + step["action"])
                return op

    def adopt_status(self, op_id, body):
        exact(body, {"statusUrl", "reason"}, "Original status receiving")
        status_url = http_url(body.get("statusUrl"), "Original provider status URL")
        reason = text(body.get("reason"), "Original status receiving reason", 4096, False)
        with self.ws.mutex:
            op = self.operation(op_id)
            if op["state"] in {"complete", "cancelled", "cancel_unknown"}:
                raise ConflictError("This original operation is already terminal")
            connection = self.ws.connection(op["connectionId"])["connection"]
            if origin(status_url) != origin(connection["baseUrl"]):
                profiles = {item["name"]: item for item in self.credentials.public()}
                profile = profiles.get(connection.get("authProfile"))
                if not profile or origin(status_url) not in {origin(x) for x in profile["origins"]}:
                    raise InputError("The actual status URL is outside the reviewed provider origins")
            op["statusUrl"], op["_pollUrl"], op["_statusPage"] = status_url, status_url, 0
            op["state"], op["phase"], op["notBefore"], op["error"] = "exporting", "status", None, None
            op.pop("_pending", None)
            op.setdefault("statusReceivings", []).append({"at": now(), "statusUrl": status_url, "reason": reason})
            return self._save(op, "actual-status-url-received")

    def receive_capture(self, op_id, body):
        """Join complete retained originals to their existing accepted operation."""
        exact(body, {"sourceId", "reason"}, "Retained capture receiving")
        source_id = identity(body.get("sourceId"))
        reason = text(body.get("reason"), "Retained capture receiving reason", 4096, False)
        with self.ws.mutex:
            op = self.operation(op_id)
            export = self.ws.export_plan(op["exportId"])["export"]
            connection = self.ws.connection(op["connectionId"])["connection"]
            if op["state"] in {"cancelled", "cancel_unknown"}:
                raise ConflictError("Reopen the original cancellation before receiving its source")
            if op["state"] == "complete" and op.get("sourceId") != source_id:
                raise ConflictError("This original operation already received another complete source")
            if not op.get("statusUrl"):
                raise ConflictError("Receive the actual accepted status URL before joining retained source files")
            saved = self.ws.source(source_id)
            with self.ws.source_path(source_id).open("rb") as stream, Packet(stream) as packet:
                if packet.mode != "capture" or packet.manifest.get("operationId") != op["operationId"]:
                    raise ConflictError("Select the complete original capture for this operation UUID")
                if jbytes(packet.connection) != jbytes(connection) or jbytes(packet.export) != jbytes(export):
                    raise ConflictError("The retained capture belongs to another reviewed connection or export")
                if packet.source_id != source_id:
                    raise InputError("The complete retained source packet changed its content identity")
                manifest = packet.manifest
                pages = manifest["manifests"]
                if not request_matches(op["statusUrl"], pages[0].get("url", "")):
                    raise ConflictError("The retained manifest belongs to another accepted provider job")
                if op.get("transactionTime") and op["transactionTime"] != manifest["transactionTime"]:
                    raise ConflictError("The retained capture changed the original export transaction time")
                total = sum(info.file_size for info in packet.infos.values())
                if total > export["limits"]["maxBytes"]:
                    raise InputError("Complete retained originals exceed the reviewed export byte budget")
                for name in packet.members:
                    packet.verify(name)
                original_pages = []
                for index, page in enumerate(pages):
                    with packet.open(page["name"]) as member:
                        raw = member.read(MAX_MANIFEST + 1)
                    if len(raw) > MAX_MANIFEST:
                        raise InputError("The retained native manifest exceeds its supported byte budget")
                    value = json_value(raw)
                    prior = op.get("_manifestChain", [])
                    if index < len(prior):
                        old = json_value(safe_read(self.directory(op["operationId"]) / prior[index]["path"]))
                        for key in ["transactionTime", "request", "requiresAccessToken", "outputOrganizedBy",
                                    "error", "extension"]:
                            if old.get(key) != value.get(key):
                                raise ConflictError("The retained capture changed an observed manifest's " + key)
                    original_pages.append({"id": sha(raw), "sha256": sha(raw), "bytes": len(raw),
                        "url": page["url"], "status": page.get("status"),
                        "exportStatus": page.get("exportStatus", page.get("status")),
                        "transactionTime": value["transactionTime"],
                        "nextUrl": value.get("link", [{}])[0].get("url") if value.get("link") else None,
                        "sourceId": source_id, "member": page["name"]})
                current = {item["id"]: item for item in op["files"]}
                received = {item["id"]: item for item in packet.files}
                if not set(current).issubset(received):
                    raise ConflictError("The complete retained capture omitted an already observed original file")
                for ident, previous in current.items():
                    incoming = received[ident]
                    for key in ["kind", "type", "count", "continuesInFile"]:
                        if previous.get(key) != incoming.get(key):
                            raise ConflictError("The retained capture changed an observed original file's " + key)
                    if previous.get("state") == "complete" and any(
                            previous.get(key) != incoming.get(key) for key in ["bytes", "sha256"]):
                        raise ConflictError("A received original file differs from the already retained bytes")
                if op["state"] == "complete":
                    return op
                stats = {item["id"]: item for item in saved["inventory"]["files"]}
                files = []
                for item in packet.files:
                    previous = current.get(item["id"], {})
                    row = {**previous, **item, "state": "complete",
                           "lineCount": stats[item["id"]]["lines"],
                           "retainedSource": {"sourceId": source_id, "member": item["name"]}}
                    if previous.get("name") and previous["name"] != item["name"]:
                        row["previousNativeName"] = previous["name"]
                    files.append(row)
                receiving = {"at": now(), "sourceId": source_id, "reason": reason,
                    "kind": "complete-retained-source-packet", "fileCount": len(files),
                    "bytes": sum(item["bytes"] for item in files),
                    "manifests": [{"sha256": page["sha256"], "bytes": page["bytes"],
                                  "url": page["url"], "member": page["member"]} for page in original_pages],
                    "previousState": op["state"], "previousPhase": op["phase"],
                    "previousError": op.get("error"), "previousPending": op.get("_pending")}
                op.setdefault("captureReceivings", []).append(receiving)
                op.update({"state": "complete", "phase": "complete", "notBefore": None, "error": None,
                    "transactionTime": manifest["transactionTime"], "files": files, "manifests": original_pages,
                    "sourceId": source_id,
                    "source": {key: saved[key] for key in ["id", "label", "name", "bytes", "created"]},
                    "_manifestComplete": True, "_nextManifest": None})
                op.pop("_pending", None)
                return self._save(op, "retained-source-packet-received")

    def cancel(self, op_id, request_id):
        request_id = operation_id(request_id)
        with self.ws.mutex:
            op = self.operation(op_id)
            if op["state"] == "cancelled":
                return op
            if op["state"] == "complete":
                raise ConflictError("The original source is already completely received")
            if not op.get("statusUrl"):
                raise InputError("Cancellation requires the actual native provider status URL")
            cancellations = private_directory(self.directory(op_id) / "cancellations")
            path = cancellations / (request_id + ".json")
            original_request = {"requestId": request_id, "operationId": op_id,
                                "method": "DELETE", "url": op["statusUrl"]}
            if path.exists():
                record = json_value(safe_read(path))
                if record["request"] != original_request:
                    raise ConflictError("Cancellation UUID belongs to another native request")
                if record.get("result"):
                    op["cancellation"] = record
                    if record["result"].get("status") in {202, 404, 410}:
                        op["state"], op["notBefore"] = "cancelled", None
                    return self._save(op, "original-cancellation-reopened")
            else:
                record = {"request": original_request, "createdAt": now(), "result": None}
                atomic_json(path, record)
            op["state"], op["cancellation"] = "cancel_unknown", record
            self._save(op, "native-cancellation-prepared")
            connection = self.ws.connection(op["connectionId"])["connection"]
            try:
                receipt = self.transport.receive(cancellations, request_id, "DELETE", op["statusUrl"],
                    {"Accept": "application/fhir+json"}, None, connection)
                record["result"] = receipt
                atomic_json(path, record)
                op["cancellation"] = record
                if receipt.get("complete") and receipt.get("status") in {202, 404, 410}:
                    op["state"], op["notBefore"], op["error"] = "cancelled", None, None
                else:
                    op["error"] = {"message": "Reopen the retained native cancellation outcome",
                                   "providerStatus": receipt.get("status"), "receipt": {"id": request_id}}
                return self._save(op, "native-cancellation-received", receipt)
            except (InputError, OSError) as error:
                op["error"] = {"message": str(error)}
                return self._save(op, "native-cancellation-awaiting-receiving")

    def observation(self, connection_id, action, url, required=None):
        connection = self.ws.connection(connection_id)["connection"]
        request_id = uuid.uuid4().hex
        directory = private_directory(self.observations / request_id)
        receipt = self.transport.receive(directory, "response", "GET", url,
            {"Accept": "application/fhir+json,application/json", "Accept-Encoding": "gzip"},
            None, connection, required=required)
        body = decoded_body(directory, receipt) if receipt.get("complete") else b""
        decoded = directory / "original.json"
        original_workspace.private_write(decoded, body)
        saved = {"action": action, "connectionId": connection_id, "receipt": receipt,
                 "file": str(decoded.relative_to(self.ws.root)), "sha256": sha(body), "bytes": len(body),
                 "status": receipt.get("status"), "jsonText": body.decode("utf-8", errors="strict"),
                 "createdAt": now(), "directory": str(directory.relative_to(self.ws.root))}
        observed_id = sha(jbytes(saved))
        saved["id"] = observed_id
        self.ws._put("observations", observed_id, saved)
        if not receipt.get("complete"):
            raise ProviderError("Original provider discovery was interrupted", receipt.get("status"),
                                receipt=receipt)
        return saved

    def discover(self, connection_id):
        connection_id = identity(connection_id)
        connection = self.ws.connection(connection_id)["connection"]
        capability = self.observation(connection_id, "capability", connection["baseUrl"] + "/metadata")
        smart = self.observation(connection_id, "smart", connection["baseUrl"] + "/.well-known/smart-configuration", False)
        if capability["status"] != 200:
            raise ProviderError("Original CapabilityStatement was not returned", capability["status"], receipt=capability["receipt"])
        value = json_value(capability["jsonText"])
        if not isinstance(value, dict) or value.get("resourceType") != "CapabilityStatement":
            raise InputError("Original metadata response is not a FHIR CapabilityStatement")
        resource_types, operations = [], []
        for rest in value.get("rest", []):
            if not isinstance(rest, dict):
                continue
            for resource in rest.get("resource", []):
                if isinstance(resource, dict) and isinstance(resource.get("type"), str) and resource["type"] not in resource_types:
                    resource_types.append(resource["type"])
            operations.extend(item for item in rest.get("operation", []) if isinstance(item, dict))
        result = {"connectionId": connection_id, "fhirVersion": value.get("fhirVersion"),
            "resourceTypes": resource_types, "operations": operations, "capability": capability, "smart": smart,
            "receipts": [capability["receipt"], smart["receipt"]], "createdAt": now()}
        result["id"] = sha(jbytes(result))
        self.ws._put("discoveries", result["id"], result)
        return result

    def groups(self, connection_id, url=None):
        connection_id = identity(connection_id)
        connection = self.ws.connection(connection_id)["connection"]
        target = http_url(url) if url else connection["baseUrl"] + "/Group"
        if origin(target) != origin(connection["baseUrl"]):
            raise InputError("Group paging must keep the original FHIR provider origin")
        if url and not any(row.get("nextUrl") == url and row["connectionId"] == connection_id
                           for row in self.ws._list("groupPages")):
            raise InputError("Choose the retained original next link from this connection's Group page")
        observed = self.observation(connection_id, "groups", target)
        if observed["status"] != 200:
            raise ProviderError("Original Group page was not returned", observed["status"], receipt=observed["receipt"])
        bundle = json_value(observed["jsonText"])
        if not isinstance(bundle, dict) or bundle.get("resourceType") != "Bundle":
            raise InputError("Original Group search did not return a FHIR Bundle")
        items = []
        for entry in bundle.get("entry", []):
            resource = entry.get("resource") if isinstance(entry, dict) else None
            if isinstance(resource, dict) and resource.get("resourceType") == "Group":
                items.append({key: resource.get(key) for key in ["id", "name", "type", "actual", "quantity"]} |
                             {"jsonText": jbytes(resource).decode()})
        links = [link.get("url") for link in bundle.get("link", []) if isinstance(link, dict) and link.get("relation") == "next"]
        if len(links) > 1 or (links and origin(http_url(links[0])) != origin(connection["baseUrl"])):
            raise InputError("Original Group next link changed its provider origin")
        result = {"connectionId": connection_id, "items": items, "count": len(items),
                  "nextUrl": links[0] if links else None, "receipt": observed["receipt"],
                  "observationId": observed["id"], "createdAt": now()}
        result["id"] = sha(jbytes(result))
        self.ws._put("groupPages", result["id"], result)
        return result
