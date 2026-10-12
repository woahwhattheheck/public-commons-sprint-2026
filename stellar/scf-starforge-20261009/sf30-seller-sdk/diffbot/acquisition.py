#!/usr/bin/env python3
"""Diffbot Account, Extract and Bulk client with retained private response custody.

Only the selected, redacted capture is exported. Completed operation IDs reopen
offline; an interrupted request is never automatically repeated. Python 3.10+,
standard library only. See WORKSPACE.md for customer operation and recovery.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

SCHEMA = "tj.diffbot-acquisition.v1"
ORIGIN = "https://api.diffbot.com"
APIS = ("analyze", "article", "product", "image", "video", "discussion", "event", "list", "job")
FORMATS = ("diffbot-extract-json", "diffbot-bulk-data-json",
           "diffbot-bulk-status-json", "diffbot-bulk-url-report-csv", "diffbot-account-json")
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
NUMBER_PATTERN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
CREDENTIAL_KEYS = {"token", "childtokens", "apikey", "accesstoken", "authtoken",
                   "authorization", "proxyauth", "password", "secret", "clientsecret",
                   "cookie", "setcookie", "customheaders"}
QUERY_SECRET = re.compile(
    r"([?&](?:token|api[_-]?key|access[_-]?token|auth[_-]?token|proxyAuth|password|secret)=)"
    r"([^&#\s\"'<>]*)", re.I)
ACCOUNT_FIELDS = ("plan", "planCredits", "status", "created", "usage")
USAGE_FIELDS = ("date", "nlp", "credits", "extractions", "proxies", "entities",
                "refresh", "facets", "videos", "subtitles")
JOB_FIELDS = ("name", "type", "apiUrl", "jobStatus", "jobCreationTimeUTC",
              "jobCompletionTimeUTC", "currentTimeUTC", "roundStartTime",
              "roundsCompleted", "repeat", "pageCrawlAttempts", "pageCrawlSuccesses",
              "pageProcessAttempts", "pageProcessSuccesses", "objectsFound",
              "urlsHarvested")
MAX_DEFAULT_BYTES = 64 * 1024 * 1024


class AcquisitionError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details

    def as_dict(self):
        return {"code": self.code, "message": self.message, **self.details}


class NumberLexeme(str):
    """A JSON number retaining its original digits, exponent and trailing zeros."""


def _object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise AcquisitionError("DUPLICATE_JSON_KEY", "The response has duplicate JSON object keys.")
        result[key] = value
    return result


def lossless_loads(value):
    def invalid(_):
        raise AcquisitionError("NONFINITE_JSON_NUMBER", "Non-finite JSON numbers are unsupported.")
    try:
        if isinstance(value, bytes):
            value = value.decode("utf-8-sig")
        return json.loads(value, parse_int=NumberLexeme, parse_float=NumberLexeme,
                          parse_constant=invalid, object_pairs_hook=_object_pairs)
    except AcquisitionError:
        raise
    except (ValueError, UnicodeError, RecursionError):
        raise AcquisitionError("RESPONSE_DECODE", "The retained response is not supported UTF-8 JSON.") from None


def lossless_dumps(value):
    def emit(v):
        if isinstance(v, NumberLexeme):
            if not NUMBER_PATTERN.fullmatch(v):
                raise AcquisitionError("INVALID_NUMBER_LEXEME", "Invalid retained numeric token.")
            return str(v)
        if v is None:
            return "null"
        if v is True:
            return "true"
        if v is False:
            return "false"
        if isinstance(v, int):
            return str(v)
        if isinstance(v, str):
            return json.dumps(v, ensure_ascii=False)
        if isinstance(v, list):
            return "[" + ",".join(emit(x) for x in v) + "]"
        if isinstance(v, dict):
            if any(not isinstance(k, str) or isinstance(k, NumberLexeme) for k in v):
                raise AcquisitionError("JSON_KEY", "JSON object keys must be strings.")
            return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + emit(x)
                                  for k, x in v.items()) + "}"
        raise AcquisitionError("JSON_VALUE", "Floating-point conversion is not used by this client.")
    return emit(value)


def json_bytes(value):
    return (lossless_dumps(value) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def integer(value, name, minimum=0, maximum=None):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]+", str(value)):
        raise AcquisitionError("INVALID_ARGUMENT", name + " must be a nonnegative integer.")
    n = int(value)
    if n < minimum or (maximum is not None and n > maximum):
        raise AcquisitionError("INVALID_ARGUMENT", name + " is outside the supported range.")
    return n


def identifier(value, name="operation ID"):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise AcquisitionError("INVALID_ARGUMENT", name + " must use 1–96 letters, digits, dots, underscores or hyphens.")
    return value


def normalized_key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _learn_secrets(value, known):
    if isinstance(value, dict):
        for key, item in value.items():
            if normalized_key(key) in CREDENTIAL_KEYS:
                def collect(v):
                    if isinstance(v, str) and not isinstance(v, NumberLexeme) and v:
                        known.add(v)
                    elif isinstance(v, list):
                        for x in v:
                            collect(x)
                    elif isinstance(v, dict):
                        for x in v.values():
                            collect(x)
                collect(item)
            _learn_secrets(item, known)
    elif isinstance(value, list):
        for item in value:
            _learn_secrets(item, known)
    elif isinstance(value, str) and not isinstance(value, NumberLexeme):
        for match in QUERY_SECRET.finditer(value):
            raw = match.group(2)
            if raw:
                known.update((raw, urllib.parse.unquote_plus(raw)))


def sanitize(value, known_secrets=()):
    """Remove credential fields/URL parameters; keep every other numeric lexeme."""
    known = {x for x in known_secrets if isinstance(x, str) and x}
    _learn_secrets(value, known)
    variants = set(known)
    for item in known:
        variants.update((urllib.parse.quote(item, safe=""), urllib.parse.quote_plus(item)))
    ordered = sorted(variants, key=len, reverse=True)
    redactions = []

    def clean_string(s):
        result = QUERY_SECRET.sub(lambda m: m.group(1) + "[REDACTED]", s)
        for secret in ordered:
            result = result.replace(secret, "[REDACTED]")
        return result

    def pointer(parent, key):
        key = clean_string(str(key)).replace("~", "~0").replace("/", "~1")
        return parent + "/" + key

    def walk(v, path):
        if isinstance(v, NumberLexeme):
            return v
        if isinstance(v, str):
            cleaned = clean_string(v)
            if cleaned != v:
                redactions.append({"pointer": path or "", "reason": "Credential value or credential URL parameter removed."})
            return cleaned
        if isinstance(v, list):
            return [walk(x, pointer(path, i)) for i, x in enumerate(v)]
        if isinstance(v, dict):
            result = {}
            for key, item in v.items():
                p = pointer(path, key)
                if normalized_key(key) in CREDENTIAL_KEYS or clean_string(key) != key:
                    redactions.append({"pointer": p, "reason": "Credential or credential-capable header field removed."})
                else:
                    result[key] = walk(item, p)
            return result
        return v
    return walk(value, ""), redactions


def selected_account(payload):
    if not isinstance(payload, dict):
        raise AcquisitionError("ACCOUNT_SHAPE", "Account response must be a JSON object.")
    selected = {k: payload[k] for k in ACCOUNT_FIELDS if k in payload}
    omissions = [{"pointer": "/" + k.replace("~", "~0").replace("/", "~1"),
                  "reason": "Field omitted from the selected account plan and usage view."}
                 for k in payload if k not in ACCOUNT_FIELDS]
    if "usage" in selected:
        if not isinstance(selected["usage"], list):
            raise AcquisitionError("ACCOUNT_SHAPE", "Account usage must be an array.")
        rows = []
        for i, row in enumerate(selected["usage"]):
            if not isinstance(row, dict):
                raise AcquisitionError("ACCOUNT_SHAPE", "Account usage rows must be objects.")
            rows.append({k: row[k] for k in USAGE_FIELDS if k in row})
            omissions.extend({"pointer": "/usage/" + str(i) + "/" + k,
                              "reason": "Field omitted from selected usage metrics."}
                             for k in row if k not in USAGE_FIELDS)
        selected["usage"] = rows
    return selected, omissions


def project_capture(raw, metadata, request, known_secrets=()):
    """Make an explicit derivative; raw HTTP/UI bytes remain in private custody."""
    fmt = metadata["format"]
    if fmt not in FORMATS:
        raise AcquisitionError("CAPTURE_FORMAT", "Unsupported Diffbot capture format.")
    encoding = str(metadata.get("contentEncoding") or "identity").lower()
    if encoding not in ("", "identity"):
        raise AcquisitionError("CONTENT_ENCODING", "The original encoded body is retained; projection requires an identity-encoded response.")
    omissions = []
    known = {x for x in known_secrets if isinstance(x, str) and x}
    if fmt == "diffbot-bulk-url-report-csv":
        try:
            rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True))
        except (UnicodeError, csv.Error):
            raise AcquisitionError("RESPONSE_DECODE", "The retained URL report is not supported UTF-8 CSV.") from None
        if not rows:
            raise AcquisitionError("CSV_SHAPE", "The retained URL report has no header.")
        hidden = {i for i, name in enumerate(rows[0]) if normalized_key(name) in CREDENTIAL_KEYS}
        for row in rows[1:]:
            known.update(cell for i, cell in enumerate(row) if i in hidden and cell)
        selected = [[cell for i, cell in enumerate(row) if i not in hidden] for row in rows]
        clean, changes = sanitize(selected, known)
        target = io.StringIO(newline="")
        csv.writer(target, lineterminator="\r\n").writerows(clean)
        payload = target.getvalue()
        redactions = [{"pointer": "/payload", "reason": "Credential CSV column " + str(i) + " removed."}
                      for i in sorted(hidden)]
        redactions.extend({"pointer": "/payload", "reason": "Credential value removed from CSV cells."}
                          for _ in changes[:1])
    else:
        original = lossless_loads(raw)
        # Discover credentials before an account selection removes their fields.
        known = {x for x in known_secrets if x}
        _learn_secrets(original, known)
        if fmt == "diffbot-account-json" and isinstance(original, dict) and "errorCode" not in original:
            original, omissions = selected_account(original)
        payload, redactions = sanitize(original, known)
        redactions = [{"pointer": "/payload" + x["pointer"], "reason": x["reason"]}
                      for x in redactions + omissions]
    safe_request, request_redactions = sanitize(request, known)
    redactions.extend({"pointer": "/request" + x["pointer"], "reason": x["reason"]}
                      for x in request_redactions)
    redactions = sanitize(redactions, known)[0]
    return {
        "schema": "tj.diffbot-safe-capture.v1", "format": fmt,
        "capture": {
            "id": metadata["id"], "capturedAt": metadata["capturedAt"],
            "sourceKind": metadata["sourceKind"],
            "original": {"sha256": digest(raw), "bytes": len(raw),
                         "wireBytes": bool(metadata.get("wireBytes", True))},
            "httpStatus": metadata.get("httpStatus")
        },
        "request": safe_request, "payload": payload, "redactions": redactions
    }


def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _regular_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():
        raise AcquisitionError("CUSTODY_PATH", "A custody file must be a regular file owned by the current user.")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise AcquisitionError("CUSTODY_MODE", "Private custody files must be mode 0600 or stricter.")
    return info


def _private_directory(path):
    path = Path(path).absolute()
    try:
        path.mkdir(mode=0o700, parents=True)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise AcquisitionError("CUSTODY_MODE", "Use an owned private custody directory with mode 0700.")
    return path


def atomic_bytes(path, content):
    path = Path(path)
    if path.exists() or path.is_symlink():
        _regular_file(path)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def create_bytes(path, content):
    path = Path(path)
    if path.exists() or path.is_symlink():
        _regular_file(path)
        if path.read_bytes() != content:
            raise AcquisitionError("OUTPUT_CONFLICT", "An existing file has different bytes.", file=path.name)
        return
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            _regular_file(path)
            if path.read_bytes() != content:
                raise AcquisitionError("OUTPUT_CONFLICT", "An existing file has different bytes.", file=path.name) from None
        _sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

class CaptureStore:
    def __init__(self, root):
        self.root = _private_directory(root)
        self.operations = _private_directory(self.root / "operations")
        self.locks = _private_directory(self.root / "locks")

    def directory(self, operation_id):
        return _private_directory(self.operations / identifier(operation_id))

    @contextlib.contextmanager
    def lock(self, key):
        path = self.locks / (digest(key.encode("utf-8")) + ".lock")
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
                raise AcquisitionError("CUSTODY_MODE", "Private lock permissions are unsafe.")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise AcquisitionError("OPERATION_ACTIVE", "The same retained operation is already active.") from None
            yield
        finally:
            os.close(fd)

    def read(self, operation_id, name):
        path = self.directory(operation_id) / name
        if not path.exists():
            return None
        _regular_file(path)
        return lossless_loads(path.read_bytes())

    def write(self, operation_id, name, value, immutable=False):
        path = self.directory(operation_id) / name
        (create_bytes if immutable else atomic_bytes)(path, json_bytes(value))

    def inspect(self, operation_id):
        intent = self.read(operation_id, "intent.json")
        if intent is None:
            raise AcquisitionError("OPERATION_NOT_FOUND", "No retained operation has that ID.")
        state = self.read(operation_id, "state.json") or {"phase": "PREPARED"}
        result = self.read(operation_id, "result.json")
        if result is not None:
            return result
        info = {"schema": SCHEMA, "operationId": operation_id, "state": state["phase"],
                "operation": intent["operation"], "request": intent["request"],
                "createdAt": intent["createdAt"]}
        body = self.directory(operation_id) / "response.body.part"
        if body.exists():
            _regular_file(body)
            info["retainedPartialBytes"] = body.stat().st_size
        if state["phase"] != "PREPARED":
            info["automaticReplay"] = False
            info["next"] = ("Reconcile this Bulk creation by exact job name; status and download remain available."
                            if intent["operation"] == "bulk-create"
                            else "Reopen a complete retained response or explicitly use a new ID for a fresh read.")
        return info


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_token(env_name="DIFFBOT_TOKEN", token_file=None):
    if token_file:
        path = Path(token_file)
        _regular_file(path)
        token = path.read_text("utf-8").strip()
    else:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", env_name):
            raise AcquisitionError("TOKEN_ENV", "Invalid token environment-variable name.")
        token = os.environ.get(env_name, "").strip()
    if not token or any(c.isspace() for c in token):
        raise AcquisitionError("TOKEN_REQUIRED", "Supply the existing Diffbot token through the selected environment variable or private token file.")
    return token


def _url(value):
    if not isinstance(value, str) or not value or any(c.isspace() for c in value):
        raise AcquisitionError("URL", "Each source URL must be a nonempty URL without whitespace.")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise AcquisitionError("URL", "Use HTTP(S) source URLs without embedded user credentials.")
    if QUERY_SECRET.search(value):
        raise AcquisitionError("URL_CREDENTIAL", "A source URL contains credential query parameters; keep such input out of the portable selection.")
    return value


def extract_parameters(api, fields=None, timeout_ms=30000, use_proxy="none"):
    if api not in APIS:
        raise AcquisitionError("API", "Choose one of the supported structured Extract APIs.")
    params = {"timeout": str(integer(timeout_ms, "timeout milliseconds", 1, 300000))}
    if fields:
        if not isinstance(fields, str) or not re.fullmatch(r"[A-Za-z0-9_,.\[\]-]+", fields):
            raise AcquisitionError("FIELDS", "Fields must be a comma-separated Extract field selection.")
        params["fields"] = fields
    if use_proxy not in ("none", "default"):
        raise AcquisitionError("PROXY", "useProxy must be none or default.")
    params["useProxy"] = use_proxy
    return params


def estimate(urls, use_proxy="none", repetitions=1, account=None):
    urls = [_url(x) for x in urls]
    repeats = integer(repetitions, "repetitions", 1, 1000000)
    if use_proxy not in ("none", "default"):
        raise AcquisitionError("PROXY", "useProxy must be none or default.")
    cost = 2 if use_proxy == "default" else 1
    return {
        "schema": "tj.diffbot-credit-estimate.v1", "observedAt": utc_now(),
        "submittedUrlEntries": len(urls), "distinctUrls": len(set(urls)),
        "assumedExtractions": len(urls) * repeats, "repetitions": repeats,
        "creditsPerExtractedPage": cost, "estimatedCredits": len(urls) * repeats * cost,
        "providerCharge": None, "currency": None,
        "basis": "Proposed page-extraction credit estimate; actual account charges and failed/repeated work are provider-reported.",
        "useProxy": use_proxy, "rateAssumptionAsOf": "2026-10-11", "notAnInvoice": True,
        "creditSource": "https://www.diffbot.com/docs/credits",
        "bulkEntitlementSource": "https://www.diffbot.com/docs/rate-limits",
        "bulkEntitlement": "Plus or a separately contracted account entitlement; this estimate does not enable or purchase it.",
        "accountObservation": account
    }


class DiffbotClient:
    def __init__(self, store, token=None, timeout=45, max_bytes=MAX_DEFAULT_BYTES, opener=None):
        self.store = store if isinstance(store, CaptureStore) else CaptureStore(store)
        self.token = token
        self.timeout = integer(timeout, "HTTP timeout seconds", 1, 600)
        self.max_bytes = integer(max_bytes, "response byte limit", 1, 1024 * 1024 * 1024)
        self.opener = opener or urllib.request.build_opener(_NoRedirect())

    def _fingerprint(self):
        return digest(("diffbot-account-binding\0" + self.token).encode("utf-8")) if self.token else None

    def _bound(self, intent):
        expected = intent.get("accountFingerprint")
        if expected and (not self.token or self._fingerprint() != expected):
            raise AcquisitionError("ACCOUNT_BINDING", "Use the same account token to recover or continue this private operation.")

    def _intent(self, operation, method, path, query, form, request, fmt, source_kind="live-api"):
        return {"schema": SCHEMA, "operation": operation, "method": method, "path": path,
                "query": query, "form": form, "request": request, "format": fmt,
                "sourceKind": source_kind, "accountFingerprint": self._fingerprint()}

    def _response_metadata(self, operation_id):
        meta = self.store.read(operation_id, "response.json")
        if meta is not None:
            return meta
        body = self.store.directory(operation_id) / "response.body"
        if not body.exists():
            return None
        # response.body is renamed into place only after EOF; a .part file is
        # never promoted during recovery. Recover the metadata after that rename.
        headers = self.store.read(operation_id, "headers.json")
        intent = self.store.read(operation_id, "intent.json")
        if headers:
            meta = headers
        elif intent and intent.get("importedOriginal"):
            original = intent["importedOriginal"]
            meta = {"id": operation_id, "capturedAt": original["capturedAt"],
                    "format": intent["format"], "sourceKind": intent["sourceKind"],
                    "wireBytes": original["wireBytes"], "httpStatus": original.get("httpStatus"),
                    "contentEncoding": "identity"}
        else:
            return None
        _regular_file(body)
        raw = body.read_bytes()
        meta = {**meta, "bytes": len(raw), "sha256": digest(raw), "complete": True,
                "metadataRecoveredAt": utc_now()}
        self.store.write(operation_id, "response.json", meta, immutable=True)
        return meta

    def _request(self, operation_id, intent):
        identifier(operation_id)
        with self.store.lock("operation:" + operation_id):
            old = self.store.read(operation_id, "intent.json")
            if old:
                if json_bytes({k: v for k, v in old.items() if k != "createdAt"}) != json_bytes(intent):
                    raise AcquisitionError("OPERATION_CONFLICT", "The operation ID is already bound to a different request or account.")
                if self.store.read(operation_id, "result.json") is not None:
                    return self.reopen(operation_id, locked=True)
                response = self._response_metadata(operation_id)
                if response and response.get("complete"):
                    return self._finish(operation_id, old, response)
                state = self.store.read(operation_id, "state.json")
                if state and state["phase"] != "PREPARED":
                    return self.store.inspect(operation_id)
            else:
                old = {**intent, "createdAt": utc_now()}
                self.store.write(operation_id, "intent.json", old, immutable=True)
                self.store.write(operation_id, "state.json", {"phase": "PREPARED"})
            if not self.token:
                raise AcquisitionError("TOKEN_REQUIRED", "An existing account token is required for this provider operation.")
            self._bound(old)
            query = dict(intent["query"])
            query["token"] = self.token
            endpoint = ORIGIN + intent["path"] + "?" + urllib.parse.urlencode(query)
            body = urllib.parse.urlencode(intent["form"]).encode("utf-8") if intent["form"] is not None else None
            headers = {"Accept": "text/csv" if intent["format"].endswith("-csv") else "application/json",
                       "Accept-Encoding": "identity", "User-Agent": "Starforge-Diffbot-Retained-Client/1"}
            if body is not None:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            req = urllib.request.Request(endpoint, data=body, headers=headers, method=intent["method"])
            directory = self.store.directory(operation_id)
            # This durable mark always precedes the provider request.
            self.store.write(operation_id, "state.json", {"phase": "DISPATCHING", "startedAt": utc_now()})
            response = None
            size = 0
            checksum = hashlib.sha256()
            try:
                try:
                    response = self.opener.open(req, timeout=self.timeout)
                except urllib.error.HTTPError as error:
                    response = error  # Retain the provider's complete error body too.
                status_code = int(response.status if hasattr(response, "status") else response.code)
                raw_headers = list(response.headers.raw_items())
                meta = {"id": operation_id, "capturedAt": utc_now(), "format": intent["format"],
                        "sourceKind": intent["sourceKind"], "wireBytes": True,
                        "httpStatus": status_code, "headers": raw_headers,
                        "contentType": response.headers.get("Content-Type", ""),
                        "contentEncoding": response.headers.get("Content-Encoding", "identity"),
                        "retryAfter": response.headers.get("Retry-After")}
                self.store.write(operation_id, "headers.json", meta, immutable=True)
                partial = directory / "response.body.part"
                fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as output:
                    while True:
                        block = response.read(min(65536, self.max_bytes - size + 1))
                        if not block:
                            break
                        output.write(block)
                        checksum.update(block)
                        size += len(block)
                        output.flush()
                        os.fsync(output.fileno())
                        if size > self.max_bytes:
                            raise AcquisitionError("RESPONSE_LIMIT", "The retained response exceeds the selected byte limit.")
                expected_length = response.headers.get("Content-Length")
                if expected_length and expected_length.isdigit() and size != int(expected_length):
                    raise AcquisitionError("INCOMPLETE_RESPONSE", "The retained body is shorter than the provider Content-Length.")
                meta.update({"capturedAt": utc_now(), "bytes": size, "sha256": checksum.hexdigest(), "complete": True})
                os.replace(partial, directory / "response.body")
                _sync_directory(directory)
                self.store.write(operation_id, "response.json", meta, immutable=True)
                self.store.write(operation_id, "state.json", {"phase": "RESPONSE_RETAINED", "capturedAt": meta["capturedAt"]})
                return self._finish(operation_id, old, meta)
            except (OSError, AcquisitionError, urllib.error.URLError, TimeoutError) as error:
                # Exception text can contain the authenticated URL; only retain a safe class/code.
                phase = "INCOMPLETE" if size else "UNCERTAIN"
                code = error.code if isinstance(error, AcquisitionError) else type(error).__name__
                self.store.write(operation_id, "state.json", {
                    "phase": phase, "observedAt": utc_now(), "retainedBytes": size,
                    "errorCode": str(code), "automaticReplay": False})
                return self.store.inspect(operation_id)
            finally:
                if response is not None:
                    response.close()

    def _finish(self, operation_id, intent, meta):
        self._bound(intent)
        path = self.store.directory(operation_id) / "response.body"
        _regular_file(path)
        raw = path.read_bytes()
        if len(raw) != int(meta["bytes"]) or digest(raw) != meta["sha256"]:
            raise AcquisitionError("CAPTURE_CHANGED", "The retained original response does not match its custody metadata.")
        result = {"schema": SCHEMA, "operationId": operation_id, "operation": intent["operation"],
                  "state": "COMPLETED", "request": sanitize(intent["request"], (self.token,) if self.token else ())[0], "capturedAt": meta["capturedAt"],
                  "httpStatus": meta.get("httpStatus"), "automaticReplay": False,
                  "original": {"bytes": len(raw), "sha256": digest(raw), "wireBytes": bool(meta.get("wireBytes", True))}}
        try:
            projection = project_capture(raw, meta, intent["request"], (self.token,) if self.token else ())
            projected = json_bytes(projection)
            create_bytes(self.store.directory(operation_id) / "projection.json", projected)
            result["projection"] = {"file": "projection.json", "bytes": len(projected),
                                    "sha256": digest(projected), "format": "diffbot-safe-capture-v1",
                                    "redactions": len(projection["redactions"])}
            result["request"] = projection["request"]
            payload = projection["payload"]
            if isinstance(payload, dict) and ("errorCode" in payload or payload.get("error")):
                result["state"] = "PROVIDER_ERROR"
                result["error"] = {k: payload[k] for k in ("errorCode", "error") if k in payload}
            elif intent["operation"] == "account":
                result["account"] = payload
            elif isinstance(payload, dict) and isinstance(payload.get("jobs"), list):
                result["jobs"] = [{k: job[k] for k in JOB_FIELDS if k in job}
                                  for job in payload["jobs"] if isinstance(job, dict)]
            elif isinstance(payload, dict):
                result["objectCount"] = len(payload.get("objects", [])) if isinstance(payload.get("objects"), list) else None
            elif isinstance(payload, list):
                result["recordCount"] = len(payload)
            elif intent["format"].endswith("-csv"):
                result["urlReport"] = True
        except AcquisitionError as error:
            result["state"] = "RESPONSE_RETAINED"
            result["projectionError"] = error.as_dict()
        if meta.get("httpStatus") is not None and not 200 <= int(meta["httpStatus"]) < 300:
            result["state"] = "HTTP_ERROR"
        if meta.get("retryAfter"):
            result["retryAfter"] = sanitize(str(meta["retryAfter"]), (self.token,) if self.token else ())[0]
        self.store.write(operation_id, "result.json", result, immutable=True)
        self.store.write(operation_id, "state.json", {"phase": result["state"], "completedAt": utc_now()})
        return result

    def reopen(self, operation_id, locked=False):
        with contextlib.nullcontext() if locked else self.store.lock("operation:" + identifier(operation_id)):
            result = self.store.read(operation_id, "result.json")
            if result is not None:
                directory = self.store.directory(operation_id)
                original = directory / "response.body"
                _regular_file(original)
                raw = original.read_bytes()
                if digest(raw) != result["original"]["sha256"] or len(raw) != int(result["original"]["bytes"]):
                    raise AcquisitionError("CAPTURE_CHANGED", "The original response bytes changed.")
                if result.get("projection"):
                    path = directory / result["projection"]["file"]
                    _regular_file(path)
                    value = path.read_bytes()
                    if digest(value) != result["projection"]["sha256"] or len(value) != int(result["projection"]["bytes"]):
                        raise AcquisitionError("CAPTURE_CHANGED", "The safe projection bytes changed.")
                return result
            intent = self.store.read(operation_id, "intent.json")
            meta = self._response_metadata(operation_id)
            if intent and meta and meta.get("complete"):
                return self._finish(operation_id, intent, meta)
            return self.store.inspect(operation_id)

    def account(self, operation_id, days=31):
        days = integer(days, "days", 1, 2147483647)
        intent = self._intent("account", "GET", "/v4/account", {"days": str(days)}, None,
                              {"api": "account", "version": 4, "days": days}, "diffbot-account-json")
        return self._request(operation_id, intent)

    def extract(self, operation_id, url, api="analyze", fields=None, timeout_ms=30000, use_proxy="none"):
        params = extract_parameters(api, fields, timeout_ms, use_proxy)
        url = _url(url)
        query = {"url": url, **params}
        intent = self._intent("extract", "GET", "/v3/" + api, query, None,
                              {"pageUrl": url, "api": api, "version": 3, **params}, "diffbot-extract-json")
        return self._request(operation_id, intent)

    def bulk_status(self, operation_id, name=None):
        if name is not None and not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            raise AcquisitionError("JOB_NAME", "Bulk job names use letters, numbers, underscores or hyphens.")
        query = {"name": name} if name is not None else {}
        # Never pass pause, restart or delete to the read-only status operation.
        intent = self._intent("bulk-status", "GET", "/v3/bulk", query, None,
                              {"api": "bulk", "version": 3, **query}, "diffbot-bulk-status-json")
        return self._request(operation_id, intent)

    def bulk_create(self, operation_id, name, urls, api="analyze", fields=None,
                    timeout_ms=30000, use_proxy="none"):
        identifier(operation_id)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name or ""):
            raise AcquisitionError("JOB_NAME", "Bulk job names use letters, numbers, underscores or hyphens.")
        urls = [_url(x) for x in urls]
        if not urls:
            raise AcquisitionError("URLS_REQUIRED", "A Bulk submission needs at least one selected URL.")
        params = extract_parameters(api, fields, timeout_ms, use_proxy)
        api_url = ORIGIN + "/v3/" + api + "?" + urllib.parse.urlencode(params)
        form = {"name": name, "urls": " ".join(urls), "apiUrl": api_url}
        request = {"api": "bulk", "version": 3, "name": name, "urls": urls, "apiUrl": api_url,
                   "repeat": 0, "urlEntries": len(urls)}
        intent = self._intent("bulk-create", "POST", "/v3/bulk", {}, form, request, "diffbot-bulk-status-json")
        with self.store.lock("bulk-name:" + str(self._fingerprint()) + ":" + name):
            old = self.store.read(operation_id, "intent.json")
            if old and (self.store.read(operation_id, "state.json") or {"phase": "PREPARED"}).get("phase") != "PREPARED":
                return self._request(operation_id, intent)
            # A fresh, read-only exact-name observation precedes any new POST.
            lookup_id = "lookup-" + uuid.uuid4().hex
            lookup = self.bulk_status(lookup_id, name)
            missing = (str(lookup.get("error", {}).get("errorCode", "")) == "500" and
                       str(lookup.get("error", {}).get("error", "")).strip().lower().rstrip(".") == "no collection record")
            if not missing:
                return {"schema": SCHEMA, "operationId": operation_id, "state": "NOT_SUBMITTED",
                        "operation": "bulk-create", "request": request, "lookup": lookup,
                        "reason": "The exact-name lookup did not establish absence. Existing jobs can be adopted through status and download.",
                        "automaticReplay": False}
            return self._request(operation_id, intent)

    def bulk_download(self, operation_id, name, urls_report=False):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name or ""):
            raise AcquisitionError("JOB_NAME", "Bulk job names use letters, numbers, underscores or hyphens.")
        query = {"name": name}
        if urls_report:
            query["type"] = "urls"
        else:
            query["format"] = "json"
        # num is deliberately absent: it requests only the newest subset.
        fmt = "diffbot-bulk-url-report-csv" if urls_report else "diffbot-bulk-data-json"
        request = {"api": "bulk/data", "version": 3, **query, "subsetRequested": False,
                   "completeness": "Complete currently available response; consult a separately retained job-status observation."}
        return self._request(operation_id, self._intent("bulk-download", "GET", "/v3/bulk/data",
                                                        query, None, request, fmt))

    def reconcile(self, operation_id, create_operation):
        prior = self.store.read(create_operation, "intent.json")
        if not prior or prior["operation"] != "bulk-create":
            raise AcquisitionError("CREATE_OPERATION", "Reconciliation needs the original retained Bulk create operation.")
        self._bound(prior)
        name, api_url = prior["request"]["name"], prior["request"]["apiUrl"]
        observed = self.bulk_status(operation_id, name)
        jobs = [j for j in observed.get("jobs", []) if j.get("name") == name]
        missing = (str(observed.get("error", {}).get("errorCode", "")) == "500" and
                   str(observed.get("error", {}).get("error", "")).strip().lower().rstrip(".") == "no collection record")
        outcome = "JOB_ABSENT" if missing else "LOOKUP_INCOMPLETE"
        if jobs:
            outcome = "JOB_PRESENT_MATCHING_ENDPOINT" if any(j.get("apiUrl") == api_url for j in jobs) else "JOB_PRESENT_DIFFERENT_ENDPOINT"
        result = {"schema": "tj.diffbot-bulk-reconciliation.v1", "createOperationId": create_operation,
                  "observationOperationId": operation_id, "name": name, "outcome": outcome,
                  "observation": observed, "automaticResubmit": False,
                  "submissionAttribution": "A job-name lookup alone does not prove which caller submitted every URL.",
                  "next": "Continue the observed job through status and full data/URL-report download; any new submission is an explicit new operation."}
        with self.store.lock("reconciliation:" + operation_id):
            self.store.write(operation_id, "reconciliation.json", result, immutable=True)
        return result

    def import_capture(self, operation_id, file, fmt, captured_at, source_kind,
                       request=None, wire_bytes=False, http_status=None):
        identifier(operation_id)
        if fmt not in FORMATS:
            raise AcquisitionError("CAPTURE_FORMAT", "Unsupported imported format.")
        raw = Path(file).read_bytes()
        if len(raw) > self.max_bytes:
            raise AcquisitionError("RESPONSE_LIMIT", "The imported capture exceeds the selected byte limit.")
        try:
            dt.datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            raise AcquisitionError("CAPTURE_TIME", "Supply the original observed capture time.") from None
        intent = self._intent("import", "LOCAL", "", {}, None, request or {}, fmt, source_kind)
        intent["accountFingerprint"] = None
        intent["importedOriginal"] = {"sha256": digest(raw), "bytes": len(raw), "wireBytes": bool(wire_bytes),
                                      "capturedAt": captured_at, "httpStatus": http_status}
        with self.store.lock("operation:" + operation_id):
            old = self.store.read(operation_id, "intent.json")
            if old:
                if json_bytes({k: v for k, v in old.items() if k != "createdAt"}) != json_bytes(intent):
                    raise AcquisitionError("OPERATION_CONFLICT", "This import ID is bound to another capture.")
                return self.reopen(operation_id, locked=True)
            self.store.write(operation_id, "intent.json", {**intent, "createdAt": utc_now()}, immutable=True)
            create_bytes(self.store.directory(operation_id) / "response.body", raw)
            meta = {"id": operation_id, "capturedAt": captured_at, "format": fmt, "sourceKind": source_kind,
                    "wireBytes": bool(wire_bytes), "httpStatus": http_status, "bytes": len(raw),
                    "sha256": digest(raw), "complete": True, "contentEncoding": "identity"}
            self.store.write(operation_id, "response.json", meta, immutable=True)
            return self._finish(operation_id, intent, meta)

    def export_capture(self, operation_id, output):
        result = self.reopen(operation_id)
        if not result.get("projection"):
            raise AcquisitionError("PROJECTION_UNAVAILABLE", "This operation has no complete safe projection.", state=result["state"])
        if self.store.read(operation_id, "intent.json")["format"] == "diffbot-account-json":
            raise AcquisitionError("ACCOUNT_EXPORT", "Account data belongs in the private selected account view, not the dataset workspace.")
        target = Path(output).absolute()
        # Custody must never be imported as a native merchant workspace.
        store = self.store.root.resolve()
        resolved = target.resolve()
        if resolved == store or store in resolved.parents or resolved in store.parents:
            raise AcquisitionError("EXPORT_LOCATION", "Choose an export directory separate from private transport custody.")
        _private_directory(target)
        captures = _private_directory(target / "captures")
        projection = self.store.directory(operation_id) / "projection.json"
        data = projection.read_bytes()
        name = result["projection"]["sha256"] + ".json"
        create_bytes(captures / name, data)
        source = {
            "id": operation_id, "format": "diffbot-safe-capture-v1",
            "path": "captures/" + name, "sha256": digest(data), "bytes": len(data),
            "capturedAt": result["capturedAt"],
            "sourceKind": self.store.read(operation_id, "intent.json")["sourceKind"],
            "originalWireBytes": False, "request": result["request"],
            "provenance": {
                "sourceUrl": "https://www.diffbot.com/docs/" + ("bulk/retrieve" if result["operation"] == "bulk-download" else "extract"),
                "description": "Explicit credential-free derivative linked to the private original by SHA-256 and byte length."
            }
        }
        create_bytes(target / (operation_id + ".source.json"), json_bytes(source))
        return {"schema": "tj.diffbot-capture-export.v1", "operationId": operation_id, "source": source}


def _read_urls(file):
    value = Path(file).read_text("utf-8")
    if value.lstrip().startswith("["):
        rows = lossless_loads(value)
        if not isinstance(rows, list) or any(not isinstance(x, str) or isinstance(x, NumberLexeme) for x in rows):
            raise AcquisitionError("URLS_FILE", "A JSON URL selection must be an array of strings.")
        return rows
    return [line.strip() for line in value.splitlines() if line.strip()]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", help="Private 0700 transport-custody directory, separate from the native workspace")
    token = parser.add_mutually_exclusive_group()
    token.add_argument("--token-env", default="DIFFBOT_TOKEN")
    token.add_argument("--token-file")
    parser.add_argument("--http-timeout", type=int, default=45)
    parser.add_argument("--max-bytes", type=int, default=MAX_DEFAULT_BYTES)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("account")
    p.add_argument("--id", required=True)
    p.add_argument("--days", type=int, default=31)
    p = commands.add_parser("estimate")
    p.add_argument("--urls", required=True)
    p.add_argument("--use-proxy", choices=("none", "default"), default="none")
    p.add_argument("--repetitions", type=int, default=1)
    p.add_argument("--account-operation")
    p = commands.add_parser("extract")
    p.add_argument("--id", required=True)
    p.add_argument("--url", required=True)
    p.add_argument("--api", choices=APIS, default="analyze")
    p.add_argument("--fields")
    p.add_argument("--timeout-ms", type=int, default=30000)
    p.add_argument("--use-proxy", choices=("none", "default"), default="none")
    p = commands.add_parser("bulk-create")
    p.add_argument("--id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--urls", required=True)
    p.add_argument("--api", choices=APIS, default="analyze")
    p.add_argument("--fields")
    p.add_argument("--timeout-ms", type=int, default=30000)
    p.add_argument("--use-proxy", choices=("none", "default"), default="none")
    p = commands.add_parser("bulk-status")
    p.add_argument("--id", required=True)
    p.add_argument("--name")
    p = commands.add_parser("bulk-download")
    p.add_argument("--id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--url-report", action="store_true")
    p = commands.add_parser("reconcile")
    p.add_argument("--id", required=True)
    p.add_argument("--create-operation", required=True)
    p = commands.add_parser("reopen")
    p.add_argument("--id", required=True)
    p = commands.add_parser("export")
    p.add_argument("--id", required=True)
    p.add_argument("--out", required=True)
    p = commands.add_parser("import")
    p.add_argument("--id", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--format", choices=FORMATS, required=True)
    p.add_argument("--captured-at", required=True)
    p.add_argument("--source-kind", required=True)
    p.add_argument("--request", help="JSON file with the original safe request metadata")
    p.add_argument("--wire-bytes", action="store_true", help="Set only for original captured HTTP response bytes")
    p.add_argument("--http-status", type=int)
    args = parser.parse_args(argv)
    try:
        if args.command == "estimate" and not args.account_operation:
            result = estimate(_read_urls(args.urls), args.use_proxy, args.repetitions)
        else:
            if not args.store:
                raise AcquisitionError("STORE_REQUIRED", "--store is required for retained operations.")
            network = args.command in ("account", "extract", "bulk-create", "bulk-status", "bulk-download", "reconcile")
            credential = load_token(args.token_env, args.token_file) if network or args.token_file or os.environ.get(args.token_env) else None
            client = DiffbotClient(args.store, credential, args.http_timeout, args.max_bytes)
            if args.command == "account":
                result = client.account(args.id, args.days)
            elif args.command == "extract":
                result = client.extract(args.id, args.url, args.api, args.fields, args.timeout_ms, args.use_proxy)
            elif args.command == "bulk-create":
                result = client.bulk_create(args.id, args.name, _read_urls(args.urls), args.api, args.fields, args.timeout_ms, args.use_proxy)
            elif args.command == "bulk-status":
                result = client.bulk_status(args.id, args.name)
            elif args.command == "bulk-download":
                result = client.bulk_download(args.id, args.name, args.url_report)
            elif args.command == "reconcile":
                result = client.reconcile(args.id, args.create_operation)
            elif args.command == "reopen":
                result = client.reopen(args.id)
            elif args.command == "export":
                result = client.export_capture(args.id, args.out)
            elif args.command == "estimate":
                account = client.reopen(args.account_operation)
                if account.get("operation") != "account" or account.get("state") != "COMPLETED":
                    raise AcquisitionError("ACCOUNT_OBSERVATION", "Use a complete original account observation.")
                result = estimate(_read_urls(args.urls), args.use_proxy, args.repetitions,
                                  {"operationId": args.account_operation, "capturedAt": account["capturedAt"],
                                   "account": account["account"]})
            else:
                request = lossless_loads(Path(args.request).read_bytes()) if args.request else {}
                result = client.import_capture(args.id, args.file, args.format, args.captured_at,
                                                args.source_kind, request, args.wire_bytes, args.http_status)
        print(lossless_dumps(result))
        state = result.get("state")
        return 0 if state in (None, "COMPLETED") else 2
    except AcquisitionError as error:
        print(lossless_dumps({"schema": SCHEMA, "error": error.as_dict()}))
        return 2
    except (OSError, ValueError, TypeError) as error:
        # File and urllib exception text can include private paths or credential URLs.
        print(lossless_dumps({"schema": SCHEMA, "error": {"code": type(error).__name__,
                              "message": "The local operation failed; retained custody remains available."}}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
