#!/usr/bin/env python3
"""Durable Aviary REST operations using the provider's current native contract."""
from __future__ import annotations

import contextlib
import datetime as dt
from email.utils import parsedate_to_datetime
import hashlib
import http.client
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
import ssl
import stat
import time
from urllib.parse import quote, urlencode, urljoin, urlsplit, urlunsplit
import urllib.error
import urllib.request
import uuid

import aviary as a

MIN_PART = 5 * 1024 * 1024
MAX_PART = 5 * 1024 * 1024 * 1024
DEFAULT_PART = 100 * 1024 * 1024
MAX_MEDIA = 25_000_000_000
JSON_LIMIT = 16 * 1024 * 1024
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
TERMINAL = {"CONFIRMED", "ADOPTED"}
SENSITIVE = {"authorization", "cookie", "set-cookie", "token", "api_token", "password"}


class ProviderProblem(a.Problem):
    def __init__(self, code, message, details=None, *, uncertain=False, retry_at=None):
        super().__init__(code, message, details)
        self.uncertain, self.retry_at = uncertain, retry_at


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def normalize_base(value, allow_loopback=False):
    if not isinstance(value, str):
        raise a.Problem("CONFIG", "baseUrl must be an HTTP(S) origin.")
    parsed = urlsplit(value)
    loopback = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and loopback and allow_loopback)
            or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
        raise a.Problem("CONFIG", "Use the Aviary organization HTTPS origin; loopback HTTP requires allowLoopback.")
    try:
        parsed.port
    except ValueError:
        raise a.Problem("CONFIG", "baseUrl has an invalid port.")
    return urlunsplit((parsed.scheme, parsed.netloc.lower(), "", "", ""))


def config_document(config):
    if not isinstance(config, dict) or config.get("schema") != "stellar-forge.aviary-client.v1":
        raise a.Problem("CONFIG", "Client schema must be stellar-forge.aviary-client.v1.")
    allowed = {"schema", "baseUrl", "collectionId", "tokenEnv", "authorizationScheme",
               "organizationId", "allowLoopback", "timeoutSeconds", "partSize",
               "multipartThreshold", "caFile"}
    if set(config) - allowed:
        raise a.Problem("CONFIG", "Unknown client settings.", sorted(set(config) - allowed))
    if not isinstance(config.get("allowLoopback", False), bool):
        raise a.Problem("CONFIG", "allowLoopback must be a Boolean.")
    base = normalize_base(config.get("baseUrl"), config.get("allowLoopback", False))
    collection = str(config.get("collectionId", ""))
    if not a.ID.fullmatch(collection):
        raise a.Problem("CONFIG", "collectionId must be a positive integer.")
    token_env = config.get("tokenEnv", "AVIARY_TOKEN")
    if not isinstance(token_env, str) or not ENV_NAME.fullmatch(token_env):
        raise a.Problem("CONFIG", "tokenEnv must name a process environment variable.")
    scheme = config.get("authorizationScheme", "Bearer")
    if scheme not in ("Bearer", "raw"):
        raise a.Problem("CONFIG", "authorizationScheme must be Bearer or raw.")
    part = config.get("partSize", DEFAULT_PART)
    threshold = config.get("multipartThreshold", DEFAULT_PART)
    timeout = config.get("timeoutSeconds", 120)
    for key, value, minimum, maximum in (
        ("partSize", part, MIN_PART, MAX_PART),
        ("multipartThreshold", threshold, MIN_PART, MAX_PART),
        ("timeoutSeconds", timeout, 5, 3600),
    ):
        if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
            raise a.Problem("CONFIG", f"{key} must be an integer between {minimum} and {maximum}.")
    organization = str(config.get("organizationId", ""))
    if any(char in organization for char in "\r\n"):
        raise a.Problem("CONFIG", "organizationId cannot contain a newline.")
    ca_file = config.get("caFile")
    if ca_file is not None and (not isinstance(ca_file, str) or not Path(ca_file).is_file()):
        raise a.Problem("CONFIG", "caFile must name an existing CA certificate file.")
    return {"schema": config["schema"], "baseUrl": base, "collectionId": collection,
            "tokenEnv": token_env, "authorizationScheme": scheme, "organizationId": organization,
            "allowLoopback": config.get("allowLoopback", False), "partSize": part,
            "multipartThreshold": threshold, "timeoutSeconds": timeout, "caFile": ca_file}


def redacted(value, token=""):
    if isinstance(value, dict):
        return {key: ("[redacted]" if key.lower() in SENSITIVE else redacted(item, token))
                for key, item in value.items()}
    if isinstance(value, list):
        return [redacted(item, token) for item in value]
    if isinstance(value, str) and token:
        return value.replace(token, "[redacted]")
    return value


def retry_time(headers):
    value = headers.get("Retry-After") or headers.get("retry-after")
    if value is None:
        return None
    try:
        seconds = max(0, int(value))
        result = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=seconds)
    except ValueError:
        try:
            result = parsedate_to_datetime(value)
            if result.tzinfo is None:
                result = result.replace(tzinfo=dt.timezone.utc)
        except (TypeError, ValueError):
            return None
    return result.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds")


class VerifiedFile:
    """Hold the original source descriptor and bind its bytes to the saved plan."""
    def __init__(self, path, expected):
        self.path = Path(path)
        self.expected = {key: expected[key] for key in ("bytes", "sha256")}
        self.fd = None

    @staticmethod
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    def __enter__(self):
        try:
            self.fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
            info = os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size != self.expected["bytes"]:
                raise a.Problem("SOURCE_CHANGED", "Upload source size or file type differs from the saved plan.",
                                str(self.path))
            self.original = self.identity(info)
            self.size = info.st_size
            digest, count = hashlib.sha256(), 0
            while True:
                value = os.read(self.fd, a.CHUNK)
                if not value:
                    break
                digest.update(value)
                count += len(value)
            self.assert_unchanged()
            if count != self.expected["bytes"] or digest.hexdigest() != self.expected["sha256"]:
                raise a.Problem("SOURCE_CHANGED", "Upload source bytes differ from the saved plan.",
                                str(self.path))
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def assert_unchanged(self):
        if self.fd is None or self.identity(os.fstat(self.fd)) != self.original:
            raise a.Problem("SOURCE_CHANGED", "The held upload source changed during transfer.", str(self.path))

    def __exit__(self, exc_type, exc_value, traceback):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


class Slice:
    """A repeatable exact range of one already verified, continuously held file."""
    def __init__(self, source, offset=0, length=None):
        if not isinstance(source, VerifiedFile) or source.fd is None:
            raise a.Problem("UPLOAD_SOURCE", "Upload requires a held source verified against the saved plan.")
        self.source, self.offset = source, offset
        self.length = source.size - offset if length is None else length
        if offset < 0 or self.length < 0 or offset + self.length > source.size:
            raise a.Problem("UPLOAD_RANGE", "Upload range exceeds the retained file.")
        self.last_digest = None

    def __iter__(self):
        digest, count = hashlib.sha256(), 0
        self.source.assert_unchanged()
        remaining = self.length
        while remaining:
            value = os.pread(self.source.fd, min(remaining, a.CHUNK), self.offset + count)
            if not value:
                raise a.Problem("SOURCE_CHANGED", "Upload source ended before its planned length.")
            digest.update(value)
            count += len(value)
            remaining -= len(value)
            yield value
        self.source.assert_unchanged()
        self.last_digest = {"bytes": count, "sha256": digest.hexdigest()}


class Multipart:
    def __init__(self, fields, files):
        self.boundary = "commons-aviary-" + uuid.uuid4().hex
        self.pieces = []
        for name, value in fields.items():
            safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", name)
            self.pieces.append((f"--{self.boundary}\r\nContent-Disposition: form-data; "
                                f'name="{safe_name}"\r\n\r\n{value}\r\n').encode("utf-8"))
        for name, entry in files.items():
            safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", name)
            filename = re.sub(r"[^A-Za-z0-9._-]", "_", entry.get("filename") or Path(entry.get("path", "file")).name)
            media_type = entry.get("contentType") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            if "\r" in media_type or "\n" in media_type:
                raise a.Problem("CONTENT_TYPE", "Invalid file content type.")
            self.pieces.append((f"--{self.boundary}\r\nContent-Disposition: form-data; "
                f'name="{safe_name}"; filename="{filename}"\r\nContent-Type: {media_type}\r\n\r\n').encode())
            self.pieces.append(Slice(entry["held"]) if "path" in entry else entry["content"].encode())
            self.pieces.append(b"\r\n")
        self.pieces.append(("--" + self.boundary + "--\r\n").encode())
        self.length = sum(len(piece) if isinstance(piece, bytes) else piece.length for piece in self.pieces)
        self.content_type = "multipart/form-data; boundary=" + self.boundary

    def __iter__(self):
        for piece in self.pieces:
            if isinstance(piece, bytes):
                yield piece
            else:
                yield from piece


class Transport:
    def __init__(self, config):
        self.config = config
        token = os.environ.get(config["tokenEnv"], "")
        if not token or any(char in token for char in "\r\n"):
            raise a.Problem("CREDENTIAL", "Set the selected API token environment variable.", config["tokenEnv"])
        self.token = token
        self.origin = config["baseUrl"]
        self.context = ssl.create_default_context(cafile=config.get("caFile"))
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=self.context))

    def headers(self):
        value = self.token if self.config["authorizationScheme"] == "raw" else "Bearer " + self.token
        headers = {"Authorization": value, "Accept": "application/json",
                   "User-Agent": "Commons-Aviary-Migration/" + a.VERSION}
        if self.config["organizationId"]:
            headers["organization-id"] = self.config["organizationId"]
        return headers

    def url(self, path):
        if not isinstance(path, str) or not re.fullmatch(r"[A-Za-z0-9_/-]+", path) or ".." in path:
            raise a.Problem("API_PATH", "API path must be a relative provider path.")
        return self.origin + "/api/v1/" + path.lstrip("/")

    def request(self, method, path, *, payload=None, fields=None, files=None, query=None):
        url = self.url(path)
        if query:
            url += "?" + urlencode(query)
        mutates = method != "GET" or path.endswith("/complete")
        headers, body = self.headers(), None
        if files is not None:
            body = Multipart(fields or {}, files)
            headers["Content-Type"], headers["Content-Length"] = body.content_type, str(body.length)
        elif payload is not None:
            body = a.encoded(payload)
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
        elif fields is not None:
            body = urlencode(fields).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Content-Length"] = str(len(body))
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            response = self.opener.open(request, timeout=self.config["timeoutSeconds"])
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as error:
            raise ProviderProblem("TRANSPORT", "Provider request ended without a usable response.",
                                  {"type": type(error).__name__, "path": path, "method": method},
                                  uncertain=mutates)
        raw_parts, count = [], 0
        with response:
            status = response.status
            selected_headers = {key: value for key, value in response.headers.items()
                                if key.lower() in ("retry-after", "content-type", "content-length", "x-request-id",
                                                   "request-id", "etag", "location")}
            receipt = {"status": status, "headers": redacted(selected_headers, self.token),
                       "at": a.now(), "path": path, "method": method}
            try:
                while count <= JSON_LIMIT:
                    value = response.read(min(65536, JSON_LIMIT + 1 - count))
                    if not value:
                        break
                    raw_parts.append(value)
                    count += len(value)
            except (TimeoutError, OSError, http.client.HTTPException) as error:
                partial = getattr(error, "partial", b"")
                if isinstance(partial, bytes) and partial:
                    raw_parts.append(partial[:max(0, JSON_LIMIT + 1 - count)])
                observed = b"".join(raw_parts)
                receipt.update({"type": type(error).__name__, "responseBytes": len(observed),
                                "responsePrefixSha256": hashlib.sha256(observed).hexdigest()})
                code = ("AUTHENTICATION" if status == 401 else "PERMISSION" if status == 403
                        else "RATE_LIMIT" if status == 429 else "RESPONSE_TRANSPORT")
                raise ProviderProblem(code, "Provider response ended before its full body was received.",
                                      receipt, uncertain=mutates and (200 <= status < 300 or status >= 500),
                                      retry_at=retry_time(selected_headers))
        raw = b"".join(raw_parts)
        receipt.update({"responseBytes": len(raw), "responseSha256": hashlib.sha256(raw).hexdigest()})
        declared_length = next((value for key, value in selected_headers.items()
                                if key.lower() == "content-length"), None)
        if (declared_length is not None and str(declared_length).isdigit()
                and len(raw) <= JSON_LIMIT and int(declared_length) != len(raw)):
            code = ("AUTHENTICATION" if status == 401 else "PERMISSION" if status == 403
                    else "RATE_LIMIT" if status == 429 else "RESPONSE_TRANSPORT")
            raise ProviderProblem(code, "Provider response length differs from its declared body length.",
                                  receipt, uncertain=mutates and (200 <= status < 300 or status >= 500),
                                  retry_at=retry_time(selected_headers))
        if len(raw) > JSON_LIMIT:
            raise ProviderProblem("RESPONSE_SIZE", "Provider JSON response exceeds 16 MiB.",
                                  receipt, uncertain=mutates and (200 <= status < 300 or status >= 500))
        try:
            content = json.loads(raw)
        except (ValueError, UnicodeError):
            content = {"responseText": raw.decode("utf-8", errors="replace")}
        receipt["body"] = redacted(content, self.token)
        code = ("AUTHENTICATION" if status == 401 else "PERMISSION" if status == 403
                else "RATE_LIMIT" if status == 429 else "CONFLICT" if status == 409
                else "PROVIDER" if status >= 400 else "REDIRECT" if 300 <= status < 400 else None)
        error_body = isinstance(content, dict) and (content.get("error") or content.get("errors"))
        if code or error_body:
            raise ProviderProblem(code or "PROVIDER",
                f"Aviary returned HTTP {status}" + (" with an error response." if error_body else "."),
                receipt, uncertain=mutates and (status >= 500 or 200 <= status < 300),
                retry_at=retry_time(selected_headers))
        if not isinstance(content, dict) or "responseText" in content:
            raise ProviderProblem("RESPONSE_SHAPE", "Aviary response is not a JSON object.", receipt,
                                  uncertain=mutates)
        return receipt

    def storage_url(self, value):
        if not isinstance(value, str) or value.startswith("[local"):
            raise ProviderProblem("UPLOAD_URL", "Supply a current provider URL for the original upload.")
        parsed = urlsplit(value)
        loopback = parsed.hostname in ("127.0.0.1", "localhost", "::1")
        if (not parsed.hostname or parsed.username or parsed.password or parsed.fragment
                or (parsed.scheme != "https" and not (
                    parsed.scheme == "http" and loopback and self.config["allowLoopback"]))):
            raise ProviderProblem("UPLOAD_URL", "Provider upload URL must use HTTPS.")
        return value

    def put(self, url, source, offset, length):
        """The only automatic write retry repeats one original storage part."""
        url = self.storage_url(url)
        failures = []
        for attempt in range(1, 4):
            body = Slice(source, offset, length)
            request = urllib.request.Request(url, data=body, method="PUT",
                headers={"Content-Length": str(length), "Content-Type": "application/octet-stream"})
            try:
                try:
                    response = self.opener.open(request, timeout=max(120, self.config["timeoutSeconds"]))
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    status, etag = response.status, response.headers.get("ETag")
                    retry_at = retry_time(dict(response.headers.items()))
                    response.read(2048)
                if 200 <= status < 300:
                    if not body.last_digest or body.last_digest["bytes"] != length:
                        raise ProviderProblem("UPLOAD_LENGTH", "Storage response arrived before all planned bytes were sent.")
                    return {"status": status, "etag": etag, "attempts": attempt,
                            "offset": offset, "length": length, "at": a.now(), **body.last_digest}
                if status in (401, 403):
                    raise ProviderProblem("UPLOAD_URL_EXPIRED",
                        "Obtain fresh provider upload URLs for the original media/upload ID.",
                        {"status": status, "attempt": attempt})
                if status == 429:
                    raise ProviderProblem("RATE_LIMIT", "Storage returned a rate limit.",
                                          {"status": status}, retry_at=retry_at)
                if status < 500:
                    raise ProviderProblem("UPLOAD_REJECTED", "Storage rejected the upload part.",
                                          {"status": status, "attempt": attempt})
                failures.append({"status": status, "attempt": attempt})
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as error:
                failures.append({"type": type(error).__name__, "attempt": attempt})
            if attempt < 3:
                time.sleep(2 ** attempt)
        raise ProviderProblem("UPLOAD_TRANSPORT", "The original storage part remains unfinished.", failures)

    def download(self, url, destination):
        """Follow file redirects with authentication confined to the Aviary origin."""
        original, current = url, url
        for _ in range(6):
            self.storage_url(current)
            parsed = urlsplit(current)
            origin = urlunsplit((parsed.scheme, parsed.netloc.lower(), "", "", ""))
            headers = self.headers() if origin == self.origin else {"User-Agent": "Commons-Aviary-Migration/" + a.VERSION}
            request = urllib.request.Request(current, headers=headers, method="GET")
            try:
                response = self.opener.open(request, timeout=self.config["timeoutSeconds"])
            except urllib.error.HTTPError as error:
                response = error
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as error:
                raise ProviderProblem("DOWNLOAD_TRANSPORT", "Transcript download was interrupted.",
                                      {"type": type(error).__name__})
            with response:
                if response.status in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise ProviderProblem("DOWNLOAD_REDIRECT", "File redirect has no Location.")
                    current = urljoin(current, location)
                    continue
                if not 200 <= response.status < 300:
                    code = ("RATE_LIMIT" if response.status == 429 else
                            "AUTHENTICATION" if response.status == 401 and origin == self.origin else
                            "PERMISSION" if response.status == 403 and origin == self.origin else "DOWNLOAD_HTTP")
                    raise ProviderProblem(code, "Transcript download returned HTTP " + str(response.status),
                                          {"status": response.status}, retry_at=retry_time(dict(response.headers)))
                destination = Path(destination)
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                temporary = destination.with_name("." + destination.name + "." + uuid.uuid4().hex)
                try:
                    h, count = hashlib.sha256(), 0
                    try:
                        with open(temporary, "xb") as out:
                            while block := response.read(a.CHUNK):
                                count += len(block)
                                h.update(block)
                                out.write(block)
                            out.flush()
                            os.fsync(out.fileno())
                    except (TimeoutError, OSError, http.client.HTTPException) as error:
                        raise ProviderProblem("DOWNLOAD_TRANSPORT", "Transcript download ended before completion.",
                                              {"type": type(error).__name__, "receivedBytes": count,
                                               "receivedPrefixSha256": h.hexdigest()})
                    declared = response.headers.get("Content-Length")
                    if declared is not None and (not declared.isdigit() or int(declared) != count):
                        raise ProviderProblem("DOWNLOAD_LENGTH", "Transcript bytes differ from the provider's length.",
                                              {"declared": declared, "receivedBytes": count})
                    if destination.exists():
                        previous = a.fingerprint(destination)
                        if previous != {"bytes": count, "sha256": h.hexdigest()}:
                            raise ProviderProblem("DOWNLOAD_CHANGED", "Saved transcript bytes differ from this export.")
                    else:
                        os.link(temporary, destination)
                    a.sync_dir(destination.parent)
                    return {"bytes": count, "sha256": h.hexdigest(), "at": a.now(),
                            "origin": origin, "originalUrlSha256": hashlib.sha256(original.encode()).hexdigest(),
                            "contentType": response.headers.get("Content-Type")}
                finally:
                    if temporary.exists():
                        temporary.unlink()
        raise ProviderProblem("DOWNLOAD_REDIRECT", "Transcript export exceeded six file redirects.")


def data_model(receipt):
    result = receipt["body"].get("data")
    if isinstance(result, dict) and isinstance(result.get("update"), dict):
        result = result["update"]
    if not isinstance(result, dict):
        raise ProviderProblem("RESPONSE_SHAPE", "Expected a provider record object.", receipt,
                              uncertain=receipt.get("method") != "GET" or receipt.get("path", "").endswith("/complete"))
    return result


def provider_id(receipt):
    value = str(data_model(receipt).get("id", ""))
    if not a.ID.fullmatch(value):
        raise ProviderProblem("PROVIDER_ID", "Provider response lacks a positive record ID.",
                              receipt, uncertain=receipt.get("method") != "GET")
    return value


def metadata(values, kind):
    standard = set(a.FIELDS[kind])
    fields = list(a.RESOURCE_METADATA if kind == "resources" else a.MEDIA_METADATA)
    fields += sorted(set(values) - standard)
    result = {}
    for field in fields:
        value = values.get(field, "")
        if not value:
            continue
        pairs = []
        for part in value.split("|"):
            vocabulary, separator, content = part.partition(";;")
            pairs.append({"vocabulary": vocabulary.strip() if separator else "",
                          "value": content.strip() if separator else vocabulary.strip()})
        name = field if kind == "resources" else field.lower().replace(" ", "_")
        result[name] = pairs
    return result


def resource_payload(values, config):
    result = {"resource_user_key": values["Resource User Key"],
              "collection_id": config["collectionId"], "title": values["Title"],
              "access": {"yes": "public", "no": "restricted", "": "private"}[values["Public"]],
              "is_featured": "true" if values["Featured"] == "yes" else "false",
              "metadata": metadata(values, "resources")}
    if values["Custom Unique Identifier"]:
        result["custom_unique_identifier"] = values["Custom Unique Identifier"]
    return result


def target_document(config):
    return {"baseUrl": config["baseUrl"], "collectionId": config["collectionId"],
            "organizationId": config["organizationId"]}


def plan(workspace, config, operation_id, revision=None):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}", operation_id):
        raise a.Problem("OPERATION_ID", "Use a stable operation ID with letters, digits, dots, colons, underscores or hyphens.")
    config = config_document(config)
    with a.locked(workspace) as root, a.connect(root) as db:
        model = a.preview(root, revision)
        if not model["ready"]:
            raise a.Problem("VALIDATION", "Resolve the listed source mapping issues.", model["issues"])
        a.verify_source(root)
        document = {"schema": "stellar-forge.aviary-operation.v1", "id": operation_id,
                    "workspaceId": model["workspace"]["id"], "revision": model["revision"],
                    "mappingSha256": model["mappingSha256"],
                    "sourceManifestSha256": model["sourceManifestSha256"],
                    "config": config, "preview": model, "contract": a.CONTRACT}
        existing = db.execute("SELECT * FROM runs WHERE id=?", (operation_id,)).fetchone()
        if existing:
            if a.digest(json.loads(existing["document"])) != a.digest(document):
                raise a.Problem("OPERATION_CHANGED", "Original operation is bound to a different plan.")
            return {"operationId": operation_id, "reused": True, "status": a.show(root, operation_id)}
        target = a.encoded(target_document(config)).decode()
        previous = db.execute("SELECT id FROM runs WHERE target=?", (target,)).fetchone()
        if previous:
            raise a.Problem("ORIGINAL_OPERATION", "Resume the original migration for this workspace and receiving target.",
                            {"operationId": previous["id"]})
        with db:
            db.execute("INSERT INTO runs VALUES(?,?,?,?,?)",
                       (operation_id, model["revision"], target, a.encoded(document).decode(), a.now()))
            a.event(db, operation_id, None, "OPERATION_PLANNED",
                    {"mappingSha256": model["mappingSha256"], "counts": model["counts"],
                     "target": target_document(config)})
        return {"operationId": operation_id, "reused": False, "counts": model["counts"],
                "target": target_document(config), "status": a.show(root, operation_id)}


def operation(db, operation_id):
    row = db.execute("SELECT document FROM runs WHERE id=?", (operation_id,)).fetchone()
    if row is None:
        raise a.Problem("OPERATION", "Operation is not in this workspace.", operation_id)
    return json.loads(row["document"])


class Migration:
    def __init__(self, root, db, document):
        self.root, self.db, self.document = root, db, document
        self.id, self.config = document["id"], document["config"]
        self.transport = Transport(self.config)

    def action(self, key):
        row = self.db.execute("SELECT * FROM actions WHERE run_id=? AND action_key=?", (self.id, key)).fetchone()
        if row is None:
            return None
        result = dict(row)
        for name in ("request", "response", "error"):
            result[name] = json.loads(result[name]) if result[name] else None
        return result

    def save(self, key, state, request, response=None, record_id=None, error=None):
        with self.db:
            self.db.execute("""INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(run_id,action_key) DO UPDATE SET state=excluded.state,
                response=excluded.response,provider_id=excluded.provider_id,
                error=excluded.error,updated=excluded.updated""",
                (self.id, key, state, a.digest(request), a.encoded(request).decode(),
                 a.encoded(response).decode() if response is not None else None, record_id,
                 a.encoded(error).decode() if error is not None else None, a.now()))
            a.event(self.db, self.id, key, state,
                    {"providerId": record_id, "requestSha256": a.digest(request),
                     "response": response, "error": error})

    def cooldown(self):
        row = self.db.execute("SELECT document FROM events WHERE run_id=? AND kind='DEFERRED' "
                              "ORDER BY sequence DESC LIMIT 1", (self.id,)).fetchone()
        if row:
            error = json.loads(row["document"]).get("error") or {}
            retry_at = error.get("retryAt")
            if retry_at and dt.datetime.fromisoformat(retry_at) > dt.datetime.now(dt.timezone.utc):
                raise ProviderProblem("DEFERRED", "Original provider retry time has not arrived.",
                                      {"retryAt": retry_at}, retry_at=retry_at)

    def perform(self, key, method, path, *, payload=None, fields=None, files=None, query=None,
                requires_id=False, repeatable=False):
        logical_files = {}
        for name, value in (files or {}).items():
            logical_files[name] = {k: v for k, v in value.items() if k not in ("path", "held", "expected")}
            if "path" in value:
                expected = value.get("expected")
                if not isinstance(expected, dict) or not all(k in expected for k in ("bytes", "sha256")):
                    raise a.Problem("UPLOAD_SOURCE", "File upload requires the saved source size and SHA256.", name)
                logical_files[name].update({
                    "source": str(Path(value["path"]).relative_to(self.root / "source")),
                    "bytes": expected["bytes"], "sha256": expected["sha256"]})
        request = {"method": method, "path": path, "payload": payload, "fields": fields,
                   "files": logical_files if files is not None else None, "query": query}
        current = self.action(key)
        if current:
            if current["request_sha"] != a.digest(request):
                raise a.Problem("REQUEST_CHANGED", "Original action payload changed.", key)
            if current["state"] in TERMINAL:
                return current["response"]
            if current["state"] in ("DISPATCHING", "UNCERTAIN") and not repeatable:
                raise ProviderProblem("UNCERTAIN",
                    "Reconcile the original provider result before continuing this action.", {"action": key})
        self.cooldown()
        with contextlib.ExitStack() as held_files:
            transfer_files = None if files is None else {}
            for name, value in (files or {}).items():
                entry = dict(value)
                if "path" in entry:
                    entry["held"] = held_files.enter_context(VerifiedFile(entry["path"], entry["expected"]))
                transfer_files[name] = entry
            self.save(key, "DISPATCHING", request, record_id=current["provider_id"] if current else None)
            try:
                receipt = self.transport.request(method, path, payload=payload, fields=fields,
                                                 files=transfer_files, query=query)
                for entry in (transfer_files or {}).values():
                    if "held" in entry:
                        entry["held"].assert_unchanged()
                record_id = provider_id(receipt) if requires_id else (current["provider_id"] if current else None)
                self.save(key, "CONFIRMED", request, receipt, record_id)
                return receipt
            except ProviderProblem as error:
                state = "UNCERTAIN" if error.uncertain else "DEFERRED" if error.retry_at else "RETRYABLE"
                details = error.as_dict() | {"retryAt": error.retry_at}
                self.save(key, state, request, record_id=current["provider_id"] if current else None,
                          error=details)
                raise
            except BaseException:
                # DISPATCHING retains the original request after any local interruption.
                raise

    def parent_id(self, row):
        parent = row["parent"]
        if parent["providerId"]:
            return parent["providerId"]
        saved = self.action(parent["kind"] + ":" + parent["key"] + ":create")
        if not saved or saved["state"] not in TERMINAL or not saved["provider_id"]:
            raise ProviderProblem("PARENT_PENDING", "The original parent record is unfinished.", parent)
        return saved["provider_id"]

    def resource(self, row):
        key = "resources:" + row["values"]["Resource User Key"] + ":create"
        return self.perform(key, "POST", "resources", payload=resource_payload(row["values"], self.config),
                            requires_id=True)

    def media(self, row):
        values, parent = row["values"], self.parent_id(row)
        user_key = values["Media User Key"]
        prefix = "media:" + user_key
        base = {"collection_resource_id": parent,
                "access": "true" if values["Public"] == "yes" else "false",
                "is_360": "true" if values["360 Video"] == "yes" else "false",
                "sort_order": values["Sequence #"]}
        thumbnail = values.get("Media Thumbnail URL", "")
        if thumbnail:
            base["thumbnail_path"] = thumbnail
        if row["assets"].get("Media Thumbnail Path"):
            # Local thumbnail bytes remain in the native package; a separate API
            # file upload is attached below after the media record exists.
            pass
        if values["Path"]:
            item = row["assets"]["Path"]
            path = a.within(self.root / "source", item["path"])
            base.update({"media_file": "presigned", "filename": path.name,
                         "display_name": values["Display Name"] or path.name})
            if item["bytes"] > self.config["multipartThreshold"]:
                base.update({"multipart": "true", "file_size": item["bytes"],
                             "part_size": self.config["partSize"]})
            with VerifiedFile(path, item) as held:
                receipt = self.perform(prefix + ":create", "POST", "media_files", query=base,
                    files={"media_file": {"filename": "media_file", "content": "presigned",
                                          "contentType": "application/octet-stream"}}, requires_id=True)
                record = data_model(receipt)
                media_id = provider_id(receipt)
                complete = self.action(prefix + ":complete")
                if complete is None or complete["state"] not in TERMINAL:
                    record = self.upload(row, record, held)
                    held.assert_unchanged()
                    parameters = {}
                    if record.get("multipart_upload"):
                        parameters = {"upload_id": record["multipart_upload"]["upload_id"],
                                      "parts_count": record["multipart_upload"]["parts_count"]}
                    self.perform(prefix + ":complete", "GET", "media_files/" + media_id + "/complete",
                                 query=parameters)
            self.perform(prefix + ":metadata", "PUT", "media_files/" + media_id,
                         payload={"metadata": metadata(values, "media"), "media_file": {}},
                         repeatable=True)
        elif values["URL"]:
            from urllib.parse import unquote
            filename = Path(unquote(urlsplit(values["URL"]).path)).name or user_key
            payload = base | {"media_file_link": values["URL"], "filename": filename,
                              "display_name": values["Display Name"] or filename,
                              "metadata": metadata(values, "media"), "media_file": {}}
            receipt = self.perform(prefix + ":create", "POST", "media_files", payload=payload, requires_id=True)
        elif values["Embed Code"]:
            payload = base | {"media_embed_code": values["Embed Code"], "media_embed_type": values["Embed Source"],
                              "target_domain": values["Target Domain"], "metadata": metadata(values, "media"),
                              "media_file": {}}
            receipt = self.perform(prefix + ":create", "POST", "media_files", payload=payload, requires_id=True)
        else:
            payload = base | {"media_staging_id": values["Media Staging ID"],
                              "display_name": values["Display Name"],
                              "filename": values["Display Name"] or user_key}
            receipt = self.perform(prefix + ":create", "POST", "media_files", query=payload,
                                   fields={}, requires_id=True)
            self.perform(prefix + ":metadata", "PUT", "media_files/" + provider_id(receipt),
                         payload={"metadata": metadata(values, "media"), "media_file": {}},
                         repeatable=True)
        return receipt

    def upload(self, row, record, source):
        item = row["assets"]["Path"]
        user_key = row["values"]["Media User Key"]
        latest = self.db.execute("SELECT document FROM events WHERE run_id=? AND action_key=? "
                                "AND kind='UPLOAD_URLS_REFRESHED' ORDER BY sequence DESC LIMIT 1",
                                (self.id, "media:" + user_key + ":create")).fetchone()
        if latest:
            record = json.loads(latest["document"])["data"]
        parts, identity = upload_manifest(record, item["bytes"], self.transport, check_urls=False)
        for part in parts:
            key = "media:" + user_key + ":part:" + str(part["number"])
            request = {"mediaId": str(record["id"]), "upload": identity,
                       "number": part["number"], "offset": part["offset"], "length": part["length"],
                       "source": item}
            existing = self.action(key)
            if existing and existing["request_sha"] != a.digest(request):
                raise a.Problem("UPLOAD_CHANGED", "Original upload part binding changed.", key)
            if existing and existing["state"] in TERMINAL:
                continue
            self.cooldown()
            self.save(key, "UPLOADING", request, record_id=str(record["id"]))
            try:
                receipt = self.transport.put(part["url"], source, part["offset"], part["length"])
                self.save(key, "CONFIRMED", request, receipt, str(record["id"]))
            except ProviderProblem as error:
                state = "DEFERRED" if error.retry_at else "UPLOAD_PENDING"
                self.save(key, state, request, record_id=str(record["id"]),
                          error=error.as_dict() | {"retryAt": error.retry_at})
                raise

        return record

    def attachment(self, kind, row):
        values = row["values"]
        parent = self.parent_id(row)
        fields = {"title": values["Title"], "description": values["Description"]}
        if kind == "supplemental":
            fields.update({"access": "yes" if values["Public"] == "yes" else "no",
                           "collection_resource_id": parent})
            endpoint, path_field = "supplemental_files", "File Path"
        else:
            fields.update({"language": values["Language"], "resource_file_id": parent,
                           "is_public": "true" if values["Public"] == "yes" else "false"})
            if kind == "transcripts":
                fields.update({"is_caption": values["Captions"],
                               "remove_title": "1" if values["Ignore Title"] == "yes" else "0"})
            endpoint, path_field = kind, "Path"
        item = row["assets"][path_field]
        path = a.within(self.root / "source", item["path"])
        key = kind + ":" + row["key"] + ":create"
        return self.perform(key, "POST", endpoint, fields=fields,
                            files={"associated_file": {"path": str(path), "filename": path.name, "expected": item}},
                            requires_id=True)


def upload_manifest(record, size, transport, check_urls=True):
    media_id = str(record.get("id", ""))
    if not a.ID.fullmatch(media_id) or size <= 0 or size > MAX_MEDIA:
        raise a.Problem("UPLOAD_MANIFEST", "Upload manifest has an invalid media ID or file size.")
    multipart = record.get("multipart_upload")
    if multipart is None:
        url = record.get("presigned_url")
        if not isinstance(url, str):
            raise a.Problem("UPLOAD_MANIFEST", "Obtain the upload manifest for this original media ID.", media_id)
        if check_urls:
            if not isinstance(url, str) or url.startswith("[local"):
                raise a.Problem("UPLOAD_URL", "Supply a fresh provider upload manifest for this original media ID.")
            transport.storage_url(url)
        if size > MAX_PART:
            raise a.Problem("UPLOAD_SIZE", "Single PUT upload exceeds 5 GiB.")
        return [{"number": 1, "offset": 0, "length": size, "url": url}], {"mode": "single", "mediaId": media_id}
    try:
        part_size, count = int(multipart["part_size"]), int(multipart["parts_count"])
        upload_id, original = str(multipart["upload_id"]), multipart["parts"]
    except (KeyError, ValueError, TypeError):
        raise a.Problem("UPLOAD_MANIFEST", "Multipart response is incomplete.")
    if (not MIN_PART <= part_size <= MAX_PART or count != math.ceil(size / part_size)
            or not upload_id or not isinstance(original, list) or len(original) != count):
        raise a.Problem("UPLOAD_MANIFEST", "Multipart limits or part count differ from the retained media file.")
    parts, seen = [], set()
    for entry in original:
        try:
            number, url = int(entry["part_number"]), entry["url"]
        except (ValueError, TypeError, KeyError):
            raise a.Problem("UPLOAD_MANIFEST", "Multipart part has no usable number or URL.")
        if number in seen or not 1 <= number <= count:
            raise a.Problem("UPLOAD_MANIFEST", "Multipart numbers must be unique and contiguous.")
        if check_urls:
            transport.storage_url(url)
        seen.add(number)
        offset = (number - 1) * part_size
        parts.append({"number": number, "offset": offset,
                      "length": min(part_size, size - offset), "url": url})
    return sorted(parts, key=lambda part: part["number"]), {
        "mode": "multipart", "mediaId": media_id, "uploadId": upload_id,
        "partSize": part_size, "partsCount": count}


def run(workspace, operation_id):
    with a.locked(workspace) as root, a.connect(root) as db:
        document = operation(db, operation_id)
        if document["workspaceId"] != a.meta(db, "identity")["id"]:
            raise a.Problem("WORKSPACE_BINDING", "Operation belongs to a different workspace.")
        a.verify_source(root)
        migration = Migration(root, db, document)
        migration.cooldown()
        errors, completed = [], []
        with db:
            a.event(db, operation_id, None, "RUN_STARTED", {"at": a.now()})
        stop = False
        for kind in a.KINDS:
            if stop:
                break
            rows = [row for row in document["preview"]["tables"][kind] if row["included"]]
            if kind in ("media", "transcripts", "indexes"):
                rows = sorted(rows, key=lambda row: (row.get("parent", {}).get("key", ""),
                                                      int(row["values"].get("Sequence #") or 0)))
            for row in rows:
                if not row["included"]:
                    continue
                try:
                    if kind == "resources":
                        result = migration.resource(row)
                    elif kind == "media":
                        result = migration.media(row)
                    else:
                        result = migration.attachment(kind, row)
                    completed.append({"kind": kind, "key": row["key"], "providerId": provider_id(result)})
                except a.Problem as error:
                    errors.append({"kind": kind, "key": row["key"], **error.as_dict()})
                    if error.code in ("AUTHENTICATION", "PERMISSION", "RATE_LIMIT", "DEFERRED", "CREDENTIAL"):
                        stop = True
                        break
        outcome = {"schema": "stellar-forge.aviary-run-result.v1", "operationId": operation_id,
                   "state": "COMPLETE" if not errors else "PARTIAL", "at": a.now(),
                   "completed": completed, "errors": errors}
        with db:
            a.event(db, operation_id, None, "RUN_FINISHED", outcome)
        return outcome | {"status": a.show(root, operation_id)}


def reconcile(workspace, operation_id, action, remote_id, note):
    remote_id = str(remote_id)
    if not a.ID.fullmatch(remote_id) or not isinstance(note, str) or not note.strip():
        raise a.Problem("RECONCILIATION", "Enter the original provider ID and its discovery note.")
    with a.locked(workspace) as root, a.connect(root) as db:
        migration = Migration(root, db, operation(db, operation_id))
        current = migration.action(action)
        if not current or current["state"] not in ("DISPATCHING", "UNCERTAIN"):
            raise a.Problem("RECONCILIATION", "Action must be an original uncertain creation.", action)
        request = current["request"]
        if request["method"] != "POST" or "/" in request["path"]:
            raise a.Problem("RECONCILIATION", "Only record creation supports provider-ID adoption.", action)
        receipt = migration.transport.request("GET", request["path"] + "/" + remote_id)
        record = data_model(receipt)
        if provider_id(receipt) != remote_id:
            raise a.Problem("RECONCILIATION", "Readback ID differs from the selected original ID.")
        expected = (request["payload"] or {}) | (request["fields"] or {}) | (request["query"] or {})
        bindings = ("collection_id", "collection_resource_id", "resource_file_id", "title", "filename")
        checked = {}
        for field in bindings:
            if expected.get(field) not in (None, ""):
                if field not in record or str(record[field]) != str(expected[field]):
                    raise a.Problem("RECONCILIATION", "Provider record does not match the original " + field + ".",
                                    {"expected": expected[field], "observed": record.get(field)})
                checked[field] = expected[field]
        if not checked:
            raise a.Problem("RECONCILIATION", "Provider response exposes no binding fields for this original action.")
        migration.save(action, "ADOPTED", request, receipt, remote_id)
        with db:
            a.event(db, operation_id, action, "PROVIDER_RECORD_RECONCILED",
                    {"providerId": remote_id, "note": note.strip(), "checked": checked, "response": receipt})
        return {"operationId": operation_id, "action": action, "providerId": remote_id,
                "state": "ADOPTED", "checked": checked}


def refresh_upload(workspace, operation_id, media_key, fresh):
    with a.locked(workspace) as root, a.connect(root) as db:
        migration = Migration(root, db, operation(db, operation_id))
        key = "media:" + str(media_key) + ":create"
        current = migration.action(key)
        if not current or current["state"] not in TERMINAL:
            raise a.Problem("UPLOAD", "The original media record must already be saved.")
        original = data_model(current["response"])
        latest = db.execute("SELECT document FROM events WHERE run_id=? AND action_key=? "
                            "AND kind='UPLOAD_URLS_REFRESHED' ORDER BY sequence DESC LIMIT 1",
                            (operation_id, key)).fetchone()
        if latest:
            original = json.loads(latest["document"])["data"]
        if not isinstance(fresh, dict):
            raise a.Problem("UPLOAD_MANIFEST", "Supply the original provider upload record as a JSON object.")
        new = fresh.get("data", fresh)
        if not isinstance(new, dict) or str(new.get("id", "")) != current["provider_id"]:
            raise a.Problem("UPLOAD_CHANGED", "Fresh URLs must belong to the same original media ID.")
        rows = migration.document["preview"]["tables"]["media"]
        row = next((row for row in rows if row["included"]
                    and row["values"]["Media User Key"] == str(media_key)), None)
        if not row or "Path" not in row["assets"]:
            raise a.Problem("UPLOAD", "This original media row has no local upload.")
        size = row["assets"]["Path"]["bytes"]
        new_parts, new_identity = upload_manifest(new, size, migration.transport)
        known_identity = None
        if original.get("multipart_upload") is not None or isinstance(original.get("presigned_url"), str):
            _, known_identity = upload_manifest(original, size, migration.transport, check_urls=False)
            if new_identity != known_identity:
                raise a.Problem("UPLOAD_CHANGED", "Fresh URLs changed the original upload identity or part layout.",
                                {"original": known_identity, "fresh": new_identity})
        else:
            query = current["request"].get("query") or {}
            requested_multipart = str(query.get("multipart", "")).lower() == "true"
            if requested_multipart != (new_identity["mode"] == "multipart"):
                raise a.Problem("UPLOAD_CHANGED", "Fresh URLs differ from the upload mode in the original request.")
            if requested_multipart and (int(query.get("file_size", -1)) != size
                                        or int(query.get("part_size", -1)) != new_identity["partSize"]):
                raise a.Problem("UPLOAD_CHANGED", "Fresh multipart layout differs from the original request.")
        for saved in db.execute("SELECT request FROM actions WHERE run_id=? AND action_key LIKE ?",
                                (operation_id, "media:" + str(media_key) + ":part:%")):
            binding = json.loads(saved["request"])["upload"]
            if binding != new_identity:
                raise a.Problem("UPLOAD_CHANGED", "Fresh URLs differ from an already dispatched original part.",
                                {"original": binding, "fresh": new_identity})
        with db:
            a.event(db, operation_id, key, "UPLOAD_URLS_REFRESHED",
                    {"data": redacted(new, migration.transport.token), "identity": new_identity,
                     "parts": len(new_parts), "originalRequestSha256": current["request_sha"],
                     "firstObservedUploadIdentity": known_identity is None})
        return {"operationId": operation_id, "mediaId": current["provider_id"],
                "upload": new_identity, "parts": len(new_parts)}


def complete_list(receipt, values, name):
    body = receipt["body"]
    meta = body.get("meta", {}) or {}
    links = body.get("links", {}) or {}
    if (body.get("has_more") or body.get("next") or meta.get("has_more") or
            meta.get("next_page") or links.get("next")):
        raise ProviderProblem("PAGINATION", "Provider reports additional " + name +
                              "; retain and follow its documented next-page route.", receipt)
    if not isinstance(values, list):
        raise ProviderProblem("RESPONSE_SHAPE", "Provider " + name + " must be an array.", receipt)
    return values


def export_transcripts(workspace, operation_id, resource_ids=None):
    with a.locked(workspace) as root, a.connect(root) as db:
        document = operation(db, operation_id)
        migration = Migration(root, db, document)
        if resource_ids is None:
            resource_ids = [row["provider_id"] for row in db.execute(
                "SELECT provider_id FROM actions WHERE run_id=? AND action_key LIKE 'resources:%:create' "
                "AND state IN ('CONFIRMED','ADOPTED')", (operation_id,))]
            for row in document["preview"]["tables"]["media"] + document["preview"]["tables"]["supplemental"]:
                if row["included"] and row.get("parent", {}).get("providerId") and row["parent"]["kind"] == "resources":
                    resource_ids.append(row["parent"]["providerId"])
        resource_ids = list(dict.fromkeys(str(value) for value in resource_ids))
        if any(not a.ID.fullmatch(value) for value in resource_ids):
            raise a.Problem("RESOURCE_ID", "Transcript export requires positive resource IDs.")
        retained = []
        for resource_id in resource_ids:
            resource_receipt = migration.transport.request("GET", "resources/" + resource_id)
            resource = data_model(resource_receipt)
            if provider_id(resource_receipt) != resource_id:
                raise a.Problem("RESOURCE_ID", "Resource readback returned a different ID.")
            ids = complete_list(resource_receipt, resource.get("transcripts_id"), "transcript IDs")
            with db:
                a.event(db, operation_id, "resources:" + resource_id, "TRANSCRIPT_LIST_READ", resource_receipt)
            for transcript_id in dict.fromkeys(str(value) for value in ids):
                if not a.ID.fullmatch(transcript_id):
                    raise a.Problem("TRANSCRIPT_ID", "Provider transcript ID is invalid.")
                receipt = migration.transport.request("GET", "transcripts/" + transcript_id)
                record = data_model(receipt)
                if provider_id(receipt) != transcript_id or not isinstance(record.get("export"), dict):
                    raise a.Problem("TRANSCRIPT_EXPORT", "Transcript export response has an invalid ID or format map.")
                with db:
                    a.event(db, operation_id, "transcripts:" + transcript_id, "EXPORT_FORMATS_READ", receipt)
                for format_name, item in sorted(record["export"].items()):
                    if not re.fullmatch(r"[A-Za-z0-9_.-]+", format_name) or format_name in (".", ".."):
                        raise a.Problem("TRANSCRIPT_FORMAT", "Provider export format cannot name a local path.")
                    filename, url = item.get("file_name"), item.get("file")
                    if not isinstance(filename, str) or a.relative(filename) != Path(filename).name:
                        raise a.Problem("TRANSCRIPT_FILENAME", "Provider export filename must be a basename.")
                    if not isinstance(url, str):
                        raise a.Problem("TRANSCRIPT_URL", "Provider export has no file URL.")
                    relative = f"exports/transcripts/{resource_id}/{transcript_id}/{format_name}/{filename}"
                    destination = a.within(root, relative)
                    existing = db.execute("SELECT document FROM downloads WHERE path=?", (relative,)).fetchone()
                    if existing:
                        entry = json.loads(existing["document"])
                        if destination.is_file() and a.fingerprint(destination) == {
                            key: entry[key] for key in ("bytes", "sha256")}:
                            retained.append(entry | {"reused": True})
                            continue
                        raise a.Problem("DOWNLOAD_CHANGED", "A retained transcript export changed.", relative)
                    result = migration.transport.download(url, destination)
                    entry = {"path": relative, "resourceId": resource_id, "transcriptId": transcript_id,
                             "format": format_name, **result}
                    with db:
                        db.execute("INSERT INTO downloads VALUES(?,?,?)", (relative, a.encoded(entry).decode(), a.now()))
                        a.event(db, operation_id, "transcripts:" + transcript_id, "TRANSCRIPT_EXPORTED", entry)
                    retained.append(entry | {"reused": False})
        return {"schema": "stellar-forge.aviary-transcript-exports.v1", "operationId": operation_id,
                "resources": resource_ids, "files": retained}
