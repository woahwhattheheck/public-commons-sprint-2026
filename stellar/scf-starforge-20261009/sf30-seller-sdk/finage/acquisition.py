#!/usr/bin/env python3
"""Finage original REST/WebSocket acquisition for the existing Python workspace.

This module retains source bodies, original message payloads and acquisition
metadata. The original PythonWorkspace owns edited editions, review and history.
The subscription protocol follows Finage's own Python example and current docs.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import collections
import contextlib
import datetime as dt
import decimal
import hashlib
import http.client
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SOURCE_LIMIT = 8 * 1024 * 1024
REVISION_LIMIT = 32 * 1024 * 1024
STREAM_CHUNK_BYTES = 7 * 1024 * 1024
API_ORIGIN = "https://api.finage.co.uk"
PUBLIC_FOREX_URL = "https://homeapi.finage.co.uk/snapshot/forex"
SECRET_KEYS = {"apikey", "api_key", "api-key", "token", "access_token", "authorization", "password"}
FORMATS = {"finage-snapshot-json", "finage-aggregates-json", "finage-websocket-events-v1",
           "finage-websocket-jsonl", "finage-model-catalog-json"}
OPERATIONS = {
    "stock-aggregates": {"route": "/agg/stock/{symbol}/{multiply}/{time}/{from}/{to}",
                        "format": "finage-aggregates-json", "market": "stock",
                        "path": ["symbol", "multiply", "time", "from", "to"],
                        "query": ["limit", "sort", "dbt_filter", "st", "et", "date_format"]},
    "forex-aggregates": {"route": "/agg/forex/{symbol}/{multiply}/{time}/{from}/{to}",
                        "format": "finage-aggregates-json", "market": "forex",
                        "path": ["symbol", "multiply", "time", "from", "to"],
                        "query": ["limit", "sort", "dbt_filter", "st", "et", "date_format"]},
    "stock-snapshot": {"route": "/snapshot/stock", "format": "finage-snapshot-json",
                      "market": "stock", "path": [], "query": ["quotes", "trades", "symbols"]},
    "forex-snapshot": {"route": "/snapshot/forex", "format": "finage-snapshot-json",
                      "market": "forex", "path": [], "query": ["quotes", "trades", "symbols"]},
    "public-forex-snapshot": {"url": PUBLIC_FOREX_URL, "format": "finage-snapshot-json",
                            "market": "forex", "path": [], "query": [], "public": True},
}
SAFE_HEADERS = {"content-type", "content-length", "content-encoding", "date", "etag",
                "last-modified", "cache-control", "retry-after", "x-ratelimit-limit",
                "x-ratelimit-remaining", "x-ratelimit-reset"}


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dumps(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def parse_raw(data):
    def reject(value):
        raise ValueError("Non-JSON number " + value)
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError("Duplicate JSON key " + key)
            out[key] = value
        return out
    return json.loads(data.decode("utf-8-sig"), parse_float=decimal.Decimal,
                      parse_int=int, parse_constant=reject, object_pairs_hook=pairs)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def save(root, ledger):
    ledger["updatedAt"] = utc()
    atomic(root / "capture.json", dumps(ledger))


def identifier(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,150}", value):
        raise ValueError(label + " must be a portable identifier")
    return value


def relative(root, name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        raise ValueError("Source path must be a nonempty relative POSIX path")
    p = Path(name)
    if p.is_absolute() or ".." in p.parts or "." in p.parts:
        raise ValueError("Source path leaves its capture root")
    result = (root / p).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError("Source symlink leaves its capture root")
    return result


@contextlib.contextmanager
def exclusive(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / ".capture.lock"
    handle = open(path, "a+b")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            if handle.read(1) == b"":
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        handle.close()


def retained(root, data, suffix=".json", area="captures"):
    digest = sha(data)
    path = area + "/" + digest + suffix
    target = relative(root, path)
    if target.exists():
        if target.read_bytes() != data:
            raise ValueError("Retained source identity is corrupt: " + path)
    else:
        atomic(target, data)
    return {"path": path, "sha256": digest, "bytes": len(data)}


def verify(root, record):
    path = relative(root, record["path"])
    data = path.read_bytes()
    if type(record.get("bytes")) is not int or len(data) != record["bytes"] or sha(data) != record.get("sha256"):
        raise ValueError("Exact source bytes do not match: " + record["path"])
    return data


def safe_url(value):
    p = urllib.parse.urlsplit(value)
    if p.username or p.password:
        raise ValueError("Use credential environment variables, not URL user information")
    pairs = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
             if k.lower() not in SECRET_KEYS]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path,
                                   urllib.parse.urlencode(pairs), ""))


def redact_text(text, secrets):
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED_CREDENTIAL]")
            text = text.replace(urllib.parse.quote(secret, safe=""), "[REDACTED_CREDENTIAL]")
    return text


def scope(item, op=None):
    if item.get("scope") is not None:
        return item["scope"]
    op = op or OPERATIONS.get(item.get("operation"), {})
    return {"operation": item.get("operation", "websocket"),
            "market": item.get("market", op.get("market", "")),
            "pathParams": item.get("pathParams", {}),
            "query": item.get("query", {}),
            "symbols": item.get("symbols", "")}


def validate_edition(item):
    edition = item.get("edition", {})
    if not isinstance(edition, dict):
        raise ValueError("edition must be an object")
    identifier(edition.get("id", item["id"]), "Edition id")
    if edition.get("compareToEdition") is not None:
        identifier(edition["compareToEdition"], "Comparison edition")
    return edition


def request_spec(item):
    identifier(item.get("id"), "Request id")
    if item.get("operation") not in OPERATIONS:
        raise ValueError("Unsupported Finage request operation")
    op = OPERATIONS[item["operation"]]
    params, query = item.get("pathParams", {}), item.get("query", {})
    if not isinstance(params, dict) or set(params) != set(op["path"]):
        raise ValueError("Path parameters must match the original operation")
    if not isinstance(query, dict) or set(query) - set(op["query"]):
        raise ValueError("Unsupported request query field")
    for value in list(params.values()) + list(query.values()):
        if isinstance(value, (dict, list)) or value is None:
            raise ValueError("Request parameters must be explicit scalar values")
    if op["format"] == "finage-aggregates-json":
        if type(params["multiply"]) is not int or params["multiply"] < 1:
            raise ValueError("multiply must be a positive integer")
        if params["time"] not in {"minute", "hour", "day", "week", "month", "quarter", "year"}:
            raise ValueError("Unsupported original aggregate interval")
        begin, end = dt.date.fromisoformat(params["from"]), dt.date.fromisoformat(params["to"])
        if begin > end:
            raise ValueError("Aggregate from date exceeds to date")
        if type(query.get("limit")) is not int or not 1 <= query["limit"] <= 50000:
            raise ValueError("Set an explicit original aggregate limit from 1 through 50000")
        if query.get("sort") not in {"asc", "desc"} or query.get("date_format") not in {"dt", "ts"}:
            raise ValueError("Set explicit sort and date_format; source defaults differ")
        if "dbt_filter" in query and type(query["dbt_filter"]) is not bool:
            raise ValueError("dbt_filter must be a boolean")
        for k in ("st", "et"):
            if k in query:
                dt.time.fromisoformat(str(query[k]))
    elif not op.get("public"):
        if type(query.get("quotes")) is not bool or type(query.get("trades")) is not bool:
            raise ValueError("Set explicit snapshot quotes and trades booleans")
        if not isinstance(query.get("symbols", ""), str):
            raise ValueError("Snapshot symbols are the original comma-separated text")
    route = op.get("route", "")
    for name, value in params.items():
        route = route.replace("{" + name + "}", urllib.parse.quote(str(value), safe=""))
    pairs = [(k, str(v).lower() if type(v) is bool else str(v)) for k, v in query.items()]
    url = op.get("url", API_ORIGIN + route)
    if pairs:
        url += "?" + urllib.parse.urlencode(pairs)
    validate_edition(item)
    return op, url


def inspect_payload(data, format_name, request=None):
    result = {"format": format_name, "jsonValid": True}
    try:
        if format_name in {"finage-websocket-events-v1", "finage-websocket-jsonl"}:
            messages = incoming = outgoing = local = 0
            first_ordinal = last_ordinal = None
            for raw in data.splitlines():
                if not raw.strip():
                    continue
                event = parse_raw(raw)
                if format_name == "finage-websocket-events-v1":
                    if event.get("schema") != "commons.finage.message.v1":
                        raise ValueError("Unknown retained message envelope")
                    ordinal = event.get("ordinal")
                    if type(ordinal) is not int or (last_ordinal is not None and ordinal != last_ordinal + 1):
                        raise ValueError("Retained event ordinals are not consecutive")
                    last_ordinal = ordinal
                    if first_ordinal is None:
                        first_ordinal = ordinal
                    payload = event.get("payload")
                    if payload:
                        body = base64.b64decode(payload["base64"], validate=True)
                        if len(body) != payload["bytes"] or sha(body) != payload["sha256"]:
                            raise ValueError("Original message payload identity does not match")
                    direction = event.get("direction")
                    incoming += direction == "incoming"
                    outgoing += direction == "outgoing"
                    local += direction == "local"
                else:
                    if not isinstance(event, (dict, list)):
                        raise ValueError("A provider message must contain a JSON object or list")
                    incoming += 1
                messages += 1
            result.update(events=messages, incoming=incoming, outgoing=outgoing, local=local,
                          firstOrdinal=first_ordinal, lastOrdinal=last_ordinal,
                          providerSequenceComplete=None, streamContinuity=None)
            return result
        obj = parse_raw(data)
        if format_name == "finage-model-catalog-json":
            if not isinstance(obj, list):
                raise ValueError("Published model catalog must contain the original model array")
            models = []
            for model in obj:
                if not isinstance(model, dict) or not isinstance(model.get("structure"), str):
                    raise ValueError("Published model has no original structure string")
                message = parse_raw(model["structure"].encode("utf-8"))
                if not isinstance(message, (dict, list)):
                    raise ValueError("Published structure must contain an original JSON message")
                models.append({"id": model.get("id"), "name": model.get("name"),
                               "isActive": model.get("isActive"), "isPublic": model.get("isPublic"),
                               "messageKind": "object" if isinstance(message, dict) else "array"})
            result.update(modelDefinitions=len(models), models=models,
                          coverageBasis="provider-published schema definitions",
                          liveProviderTraffic=False)
            return result
        if not isinstance(obj, dict):
            raise ValueError("Original response must be a JSON object")
        count = obj.get("totalResults")
        if format_name == "finage-snapshot-json":
            arrays, symbols, duplicates, lengths = [], set(), {}, {}
            for key in ("lastQuotes", "lastTrades"):
                rows = obj.get(key)
                if rows is None:
                    lengths[key] = None
                    continue
                if not isinstance(rows, list):
                    raise ValueError(key + " must be an array or null")
                lengths[key] = len(rows)
                seen = set()
                duplicates[key] = 0
                for row in rows:
                    if not isinstance(row, dict):
                        raise ValueError("A snapshot row is not an object")
                    symbol = row.get("s")
                    if not isinstance(symbol, str):
                        raise ValueError("A snapshot row has no exact string symbol")
                    duplicates[key] += symbol in seen
                    seen.add(symbol)
                    symbols.add(symbol)
                arrays.extend(rows)
            if "lastQuotes" not in obj and "lastTrades" not in obj:
                raise ValueError("Original body does not contain snapshot arrays")
            result.update(lengths, rows=len(arrays), uniqueExactSymbols=len(symbols),
                          duplicateExactSymbols=duplicates, reportedCount=str(count) if isinstance(count, decimal.Decimal) else count,
                          reportedCountMatches=type(count) is int and count == len(symbols))
        elif format_name == "finage-aggregates-json":
            rows = obj.get("results")
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("Original aggregate results must be an object array")
            limit = (request or {}).get("query", {}).get("limit")
            result.update(rows=len(rows), originalSymbol=obj.get("symbol"), reportedCount=count,
                          reportedCountMatches=type(count) is int and count == len(rows),
                          atRequestedLimit=type(limit) is int and len(rows) >= limit,
                          fullRequestedWindow=None)
        else:
            raise ValueError("Unknown source format")
        result["pageChainComplete"] = None
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        result.update(jsonValid=False, error=str(exc), bodyPreserved=True)
    return result


def new_capture(root, config, mode, resume):
    identity = sha(canonical(config))
    path = root / "capture.json"
    if path.exists():
        current = read_json(path)
        if not resume:
            raise ValueError("Capture already exists; use --resume for this exact operation")
        if current.get("configSha256") != identity or current.get("mode") != mode:
            raise ValueError("Resume configuration differs from the retained original capture")
        return current
    ledger = {"schema": "commons.finage.capture.v1", "captureId": config["id"], "mode": mode,
              "configSha256": identity, "title": config.get("title", "Finage source capture"),
              "createdAt": utc(), "updatedAt": utc(), "accountAlias": config.get("accountAlias"),
              "status": "IN_PROGRESS", "selectedEdition": config.get("selectedEdition"),
              "requests": [], "streams": [], "sources": []}
    save(root, ledger)
    return ledger


def source_entry(item, body, captured_at, kind, wire, format_name, metadata=None, shape=None):
    edition = validate_edition(item)
    row = {"id": item["id"], "operation": item.get("operation", "websocket"),
           "format": format_name, **body, "capturedAt": captured_at, "sourceKind": kind,
           "originalWireBytes": wire, "request": item.get("request") or
           {"method": "GET", "url": request_spec(item)[1] if item.get("operation") in OPERATIONS else "",
            "pathParams": item.get("pathParams", {}), "query": item.get("query", {})},
           "scope": scope(item), "edition": edition,
           "coverage": {"bodyComplete": True, "pageChainComplete": None,
                        "streamContinuity": None}, "inspection": shape or {},
           "provenance": dict(item.get("provenance", {})), "metadata": metadata or []}
    if item.get("role") or edition.get("role"):
        row["role"] = item.get("role", edition.get("role"))
    return row


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def capture_rest(root, ledger, item, api_key, timeout):
    op, public_url = request_spec(item)
    existing = next((r for r in ledger["requests"] if r["id"] == item["id"]), None)
    if existing and existing.get("status") in {"COMPLETE", "HTTP_ERROR", "INVALID_BODY", "PARTIAL"}:
        if existing.get("body"):
            verify(root, existing["body"])
        return
    attempt = existing or {"id": item["id"], "operation": item["operation"], "attempts": []}
    if not existing:
        ledger["requests"].append(attempt)
    attempt["status"] = "IN_PROGRESS"
    started = utc()
    record = {"startedAt": started, "request": {"method": "GET", "url": public_url,
              "pathParams": item.get("pathParams", {}), "query": item.get("query", {}),
              "authentication": "none" if op.get("public") else "caller-provided-api-key"}}
    attempt["attempts"].append(record)
    save(root, ledger)
    if not op.get("public") and not api_key:
        raise ValueError("An existing Finage API key is required for the selected account operation")
    request_url = public_url if op.get("public") else public_url + ("&" if "?" in public_url else "?") + urllib.parse.urlencode({"apikey": api_key})
    req = urllib.request.Request(request_url, headers={"Accept": "application/json",
        "Accept-Encoding": "identity", "User-Agent": "Commons-Finage-Source/1"})
    response = None
    wire = b""
    complete = False
    try:
        try:
            response = urllib.request.build_opener(NoRedirect).open(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            response = exc
        record.update(status=response.status,
                      responseUrl=safe_url(response.url),
                      headers={k: v for k, v in response.headers.items() if k.lower() in SAFE_HEADERS})
        chunks = []
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                complete = True
                break
            chunks.append(chunk)
        wire = b"".join(chunks)
        declared_length = response.headers.get("Content-Length")
        if declared_length is not None:
            try:
                expected_length = int(declared_length)
                if expected_length < 0:
                    raise ValueError("Negative Content-Length")
                record["declaredBodyBytes"] = expected_length
                record["declaredLengthMatches"] = len(wire) == expected_length
                if not record["declaredLengthMatches"]:
                    complete = False
                    record["error"] = "Original body length does not match declared Content-Length"
            except ValueError:
                complete = False
                record["declaredLengthMatches"] = False
                record["error"] = "Original Content-Length is not a nonnegative integer"
    except (OSError, urllib.error.URLError, TimeoutError, http.client.HTTPException) as exc:
        if "chunks" in locals():
            if isinstance(exc, http.client.IncompleteRead) and exc.partial:
                chunks.append(exc.partial)
            wire = b"".join(chunks)
        record["error"] = redact_text(str(exc), [api_key])
    finally:
        if response is not None:
            response.close()
    captured = utc()
    original = retained(root, wire, ".body", "private/raw")
    record.update(completedAt=captured, original=original, bodyComplete=complete)
    # Retain private original bytes first. A returned credential is explicitly
    # removed only from the consumer derivative; it is never called wire bytes.
    visible = wire
    changed = False
    if api_key:
        for secret in {api_key.encode(), urllib.parse.quote(api_key, safe="").encode()}:
            if secret and secret in visible:
                visible = visible.replace(secret, b"[REDACTED_CREDENTIAL]")
                changed = True
    body = retained(root, visible, ".json")
    record["body"] = body
    record["credentialRedacted"] = changed
    record["originalWireBytes"] = not changed
    shape = inspect_payload(visible, op["format"], record["request"])
    record["inspection"] = shape
    status = "PARTIAL" if not complete else ("HTTP_ERROR" if record.get("status", 0) not in range(200, 300)
              else ("COMPLETE" if shape.get("jsonValid") else "INVALID_BODY"))
    metadata = retained(root, dumps({k: v for k, v in record.items() if k != "original"}), ".capture.json")
    entry = source_entry(item, body, captured,
                         "live-public-provider-endpoint" if op.get("public") else "live-authorized-provider-api",
                         not changed, op["format"], [metadata], shape)
    entry["coverage"]["bodyComplete"] = complete
    entry["coverage"]["httpStatus"] = record.get("status")
    entry["coverage"]["dataStatus"] = status
    entry["provenance"].update({"originalBodySha256": original["sha256"],
                                "originalBodyBytes": original["bytes"],
                                "credentialRedacted": changed})
    ledger["sources"] = [s for s in ledger["sources"] if s["id"] != entry["id"]] + [entry]
    attempt.update(status=status, body=body, completedAt=captured)
    save(root, ledger)


class EventWriter:
    def __init__(self, root, stream_id, segment, first_ordinal):
        self.root, self.stream_id, self.segment = root, stream_id, segment
        self.ordinal = first_ordinal
        self.handle = None
        self.bytes = 0
        self.parts = []
        self.chunk = 0
        self.last_sync = time.monotonic()

    def open(self):
        self.chunk += 1
        name = "private/streams/" + self.stream_id + "-%04d-%04d.jsonl" % (self.segment, self.chunk)
        self.path = relative(self.root, name)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.handle = open(self.path, "xb")
        if hasattr(os, "chmod"):
            os.chmod(self.path, 0o600)
        self.bytes = 0
        self.start_ordinal = self.ordinal + 1

    def write(self, direction, kind, connection, payload=None, detail=None):
        next_ordinal = self.ordinal + 1
        event = {"schema": "commons.finage.message.v1", "ordinal": next_ordinal,
                 "connectionId": connection, "observedAt": utc(), "direction": direction, "kind": kind}
        if payload is not None:
            raw = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
            event["payload"] = {"encoding": "base64", "type": "text" if isinstance(payload, str) else "binary",
                                "base64": base64.b64encode(raw).decode("ascii"),
                                "bytes": len(raw), "sha256": sha(raw)}
        if detail is not None:
            event["detail"] = detail
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"
        if self.handle is not None and self.bytes and self.bytes + len(line) > STREAM_CHUNK_BYTES:
            self.close()
        if self.handle is None:
            self.open()
        self.ordinal = next_ordinal
        self.handle.write(line)
        self.handle.flush()
        self.bytes += len(line)
        if time.monotonic() - self.last_sync >= 1:
            os.fsync(self.handle.fileno())
            self.last_sync = time.monotonic()
        return event

    def close(self):
        if self.handle is None:
            return
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.handle.close()
        data = self.path.read_bytes()
        body = retained(self.root, data, ".events.jsonl")
        self.parts.append({**body, "firstOrdinal": self.start_ordinal,
                           "lastOrdinal": self.ordinal, "eventCount": len(data.splitlines())})
        self.handle = None


def validate_socket(item):
    identifier(item.get("id"), "Stream id")
    validate_edition(item)
    p = urllib.parse.urlsplit(item.get("server", ""))
    if p.scheme != "wss" or not p.hostname or not p.hostname.endswith(".finage.ws"):
        raise ValueError("Use the existing dashboard-assigned wss Finage server")
    if p.username or p.password or p.query or p.fragment or p.path not in {"", "/"}:
        raise ValueError("Socket server excludes the token; provide it through the socket-key environment")
    if not isinstance(item.get("symbols"), str) or not item["symbols"].strip():
        raise ValueError("Supply exact original comma-separated subscription symbols")
    if type(item.get("durationSeconds")) not in {int, float} or not 0 < item["durationSeconds"] <= 86400:
        raise ValueError("Choose an observation duration above zero through one day")
    reconnect = item.get("reconnect", {})
    if type(reconnect.get("maxAttempts", 0)) is not int or not 0 <= reconnect.get("maxAttempts", 0) <= 20:
        raise ValueError("Reconnect maxAttempts must be from zero through twenty")
    if type(reconnect.get("delaySeconds", 2)) not in {int, float} or not 0 < reconnect.get("delaySeconds", 2) <= 3600:
        raise ValueError("Reconnect delaySeconds must be positive")
    return p


def recover_stream_chunks(root, ledger, item, record):
    """Promote complete original event lines left by an interrupted writer.

    The entire private chunk remains unchanged, including any final fragment.
    Recovered source covers only its exact complete prefix, with that fact saved.
    """
    directory = root / "private/streams"
    if not directory.exists():
        return
    known = {p["sha256"] for p in record.get("parts", [])}
    recovered = {p["originalSha256"] for p in record.get("recoveredChunks", [])}
    for path in sorted(directory.glob(item["id"] + "-*.jsonl")):
        data = path.read_bytes()
        original_digest = sha(data)
        if original_digest in known or original_digest in recovered:
            continue
        end = data.rfind(b"\n") + 1
        prefix = data[:end]
        note = {"originalSha256": original_digest, "originalBytes": len(data),
                "completePrefixBytes": len(prefix), "trailingFragmentBytes": len(data)-end,
                "recoveredAt": utc(), "originalPrivatePath": path.relative_to(root).as_posix(),
                "status": "EMPTY_COMPLETE_PREFIX"}
        record.setdefault("recoveredChunks", []).append(note)
        if not prefix:
            continue
        shape = inspect_payload(prefix, "finage-websocket-events-v1")
        if not shape.get("jsonValid"):
            note.update(status="UNREADABLE_COMPLETE_PREFIX", inspection=shape)
            continue
        events = [parse_raw(line) for line in prefix.splitlines() if line.strip()]
        first, last = events[0], events[-1]
        body = retained(root, prefix, ".events.jsonl")
        part = {**body, "firstOrdinal": first["ordinal"], "lastOrdinal": last["ordinal"],
                "eventCount": len(events), "recoveredAfterInterruption": True}
        record["parts"].append(part)
        note.update(status="RECOVERED_PARTIAL", body=body, eventCount=len(events))
        source_id = item["id"] + "-recovered-" + original_digest[:16]
        metadata = retained(root, dumps(note), ".recovery.capture.json")
        source_item = dict(item, id=source_id, operation="websocket",
                           edition=item.get("edition") or {"id": item["id"], "label": item["id"]},
                           request={"transport": "websocket", "server": item["server"],
                                    "symbols": item["symbols"], "query": {}})
        entry = source_entry(source_item, body, last["observedAt"],
                             "live-authorized-provider-stream", False,
                             "finage-websocket-events-v1", [metadata], shape)
        entry["coverage"].update({"observationStatus": "RECOVERED_PARTIAL",
                                  "providerSequenceComplete": None,
                                  "originalChunkComplete": end == len(data),
                                  "observationElapsedSeconds": None})
        entry["provenance"].update({"byteOrigin": "original-websockets-library-application-payload",
                                    "originalChunkSha256": original_digest,
                                    "originalChunkBytes": len(data),
                                    "firstOrdinal": first["ordinal"], "lastOrdinal": last["ordinal"],
                                    "trailingFragmentBytes": len(data)-end,
                                    "recoveredAfterInterruption": True})
        ledger["sources"] = [x for x in ledger["sources"] if x["id"] != source_id] + [entry]
    for segment in record.get("segments", []):
        if segment.get("status") == "IN_PROGRESS":
            segment["status"] = "INTERRUPTED"
            segment["recoveredAt"] = utc()
            segment["elapsedSecondsKnown"] = False
    save(root, ledger)


async def capture_socket(root, ledger, item, socket_key, timeout):
    validate_socket(item)
    if not socket_key:
        raise ValueError("An existing Finage socket key is required")
    try:
        import websockets
    except ImportError as exc:
        raise ValueError("Install the original provider example's websockets dependency") from exc
    record = next((r for r in ledger["streams"] if r["id"] == item["id"]), None)
    if record and record.get("status") == "COMPLETE":
        for part in record["parts"]:
            verify(root, part)
        return
    if record is None:
        record = {"id": item["id"], "status": "IN_PROGRESS", "segments": [], "parts": [],
                  "request": {"server": item["server"], "symbols": item["symbols"],
                              "durationSeconds": item["durationSeconds"]},
                  "library": {"name": "websockets", "version": importlib.metadata.version("websockets")},
                  "providerSequenceComplete": None}
        ledger["streams"].append(record)
    recover_stream_chunks(root, ledger, item, record)
    # An interrupted process may leave a final private chunk. Preserve it
    # explicitly; new segments never append into or overwrite that original.
    max_segment = len(record["segments"])
    existing_files = list((root / "private/streams").glob(item["id"] + "-*.jsonl")) if (root / "private/streams").exists() else []
    for path in existing_files:
        try:
            max_segment = max(max_segment, int(path.stem.rsplit("-", 2)[1]))
        except ValueError:
            pass
    segment_id = max_segment + 1
    elapsed_before = sum(s.get("elapsedSeconds", 0) for s in record["segments"])
    remaining = max(0.0, float(item["durationSeconds"]) - elapsed_before)
    if remaining == 0:
        record["status"] = "PARTIAL"
        record["observationBudgetElapsed"] = True
        save(root, ledger)
        return
    first_ordinal = max((p.get("lastOrdinal", 0) for p in record["parts"]), default=0)
    writer = EventWriter(root, item["id"], segment_id, first_ordinal)
    segment = {"id": segment_id, "startedAt": utc(), "requestedSeconds": remaining,
               "resumeDiscontinuity": bool(record["segments"] or existing_files),
               "status": "IN_PROGRESS", "connections": [], "connectedSeconds": 0}
    record["segments"].append(segment)
    save(root, ledger)
    start = time.monotonic()
    stop = start + remaining
    reconnect = item.get("reconnect", {})
    reconnects = 0
    observation_ended = False
    try:
        while time.monotonic() < stop:
            connection = item["id"] + "-s%d-c%d" % (segment_id, reconnects + 1)
            info = {"id": connection, "startedAt": utc()}
            connected_at = None
            segment["connections"].append(info)
            writer.write("local", "connection-start", connection,
                         detail={"server": item["server"], "resumed": segment["resumeDiscontinuity"]})
            try:
                url = item["server"].rstrip("/") + "/?" + urllib.parse.urlencode({"token": socket_key})
                async with websockets.connect(url, open_timeout=min(timeout, max(0.001, stop-time.monotonic())), close_timeout=5,
                        ping_interval=None, compression=None,
                        max_size=SOURCE_LIMIT) as ws:
                    connected_at = time.monotonic()
                    info["connectedAt"] = utc()
                    writer.write("local", "connected", connection)
                    subscription = json.dumps({"action": "subscribe", "symbols": item["symbols"]},
                                              ensure_ascii=False, separators=(",", ":"))
                    await ws.send(subscription)
                    writer.write("outgoing", "subscription", connection, subscription)
                    while time.monotonic() < stop:
                        try:
                            payload = await asyncio.wait_for(ws.recv(), timeout=max(0.001, stop-time.monotonic()))
                        except asyncio.TimeoutError:
                            break
                        if isinstance(payload, str):
                            visible = redact_text(payload, [socket_key])
                            if visible != payload:
                                original = retained(root, payload.encode(), ".payload", "private/credential-echo")
                                writer.write("incoming", "credential-redacted-message", connection, visible,
                                             {"originalSha256": original["sha256"], "originalBytes": original["bytes"]})
                            else:
                                writer.write("incoming", "message", connection, payload)
                        else:
                            raw = bytes(payload)
                            visible = raw
                            for secret in {socket_key.encode(), urllib.parse.quote(socket_key, safe="").encode()}:
                                if secret:
                                    visible = visible.replace(secret, b"[REDACTED_CREDENTIAL]")
                            if visible != raw:
                                original = retained(root, raw, ".payload", "private/credential-echo")
                                writer.write("incoming", "credential-redacted-binary", connection, visible,
                                             {"originalSha256": original["sha256"], "originalBytes": original["bytes"]})
                            else:
                                writer.write("incoming", "binary-message", connection, raw)
                    unsubscribe = json.dumps({"action": "unsubscribe", "symbols": item["symbols"]},
                                             ensure_ascii=False, separators=(",", ":"))
                    try:
                        await ws.send(unsubscribe)
                        writer.write("outgoing", "unsubscription", connection, unsubscribe)
                    except Exception as exc:
                        writer.write("local", "unsubscribe-error", connection,
                                     detail={"message": redact_text(str(exc), [socket_key])})
                    writer.write("local", "observation-ended", connection)
                    observation_ended = True
                    info.update(completedAt=utc(), status="OBSERVATION_ENDED",
                                connectedSeconds=max(0.0, time.monotonic()-connected_at))
                    segment["connectedSeconds"] += info["connectedSeconds"]
                    connected_at = None
                    break
            except Exception as exc:
                info.update(completedAt=utc(), status="CONNECTION_ENDED",
                            connectedSeconds=max(0.0, time.monotonic()-connected_at) if connected_at is not None else 0,
                            error=redact_text(str(exc), [socket_key]))
                segment["connectedSeconds"] += info["connectedSeconds"]
                connected_at = None
                writer.write("local", "connection-ended", connection, detail={"message": info["error"]})
                if reconnects >= reconnect.get("maxAttempts", 0):
                    break
                reconnects += 1
                delay = min(float(reconnect.get("delaySeconds", 2)), max(0, stop-time.monotonic()))
                if delay:
                    writer.write("local", "reconnect-wait", connection, detail={"seconds": delay})
                    await asyncio.sleep(delay)
    finally:
        writer.close()
        elapsed = max(0.0, time.monotonic()-start)
        if "connected_at" in locals() and connected_at is not None:
            segment["connectedSeconds"] += max(0.0, time.monotonic()-connected_at)
        observed = segment["connectedSeconds"]
        segment.update(completedAt=utc(), observedSeconds=observed, elapsedSeconds=elapsed,
                       status="COMPLETE" if observation_ended else "PARTIAL",
                       parts=writer.parts, reconnectAttempts=reconnects)
        record["parts"].extend(writer.parts)
        record["status"] = segment["status"]
        record["streamContinuity"] = None
        record["completedAt"] = utc()
        metadata = retained(root, dumps(record), ".stream.capture.json")
        for i, part in enumerate(writer.parts):
            source_item = dict(item, id=item["id"] + "-s%d-p%d" % (segment_id, i + 1),
                               operation="websocket",
                               edition=item.get("edition") or {"id": item["id"], "label": item["id"]},
                               request={"transport": "websocket", "server": item["server"],
                                        "symbols": item["symbols"], "query": {}})
            entry = source_entry(source_item, {k: part[k] for k in ("path","sha256","bytes")},
                                 segment["completedAt"], "live-authorized-provider-stream",
                                 False, "finage-websocket-events-v1", [metadata],
                                 inspect_payload(verify(root, part), "finage-websocket-events-v1"))
            entry["coverage"].update({"observationStatus": segment["status"],
                                      "providerSequenceComplete": None,
                                      "requestedSeconds": remaining, "observedSeconds": observed, "elapsedSeconds": elapsed})
            entry["provenance"].update({"byteOrigin": "original-websockets-library-application-payload",
                "streamId": item["id"], "segmentId": segment_id, "firstOrdinal": part["firstOrdinal"],
                "lastOrdinal": part["lastOrdinal"], "resumeDiscontinuity": segment["resumeDiscontinuity"],
                "sourceMessagePayloadsPreserved": True})
            ledger["sources"].append(entry)
        save(root, ledger)


def validate_config(config, mode):
    expected = "commons.finage.acquisition.v1" if mode == "capture" else "commons.finage.import.v1"
    if config.get("schema") != expected:
        raise ValueError("Expected " + expected)
    identifier(config.get("id"), "Capture id")
    items = config.get("requests", []) + config.get("websockets", []) if mode == "capture" else config.get("sources", [])
    if not isinstance(items, list) or not items:
        raise ValueError("Select at least one original source")
    ids = []
    for item in items:
        ids.append(identifier(item.get("id"), "Source id"))
        validate_edition(item)
    if len(ids) != len(set(ids)):
        raise ValueError("Source ids must be unique")
    if mode == "capture":
        for item in config.get("requests", []):
            request_spec(item)
        for item in config.get("websockets", []):
            validate_socket(item)
    return config


def capture(config, root, resume, api_env, socket_env, timeout):
    validate_config(config, "capture")
    api_key = os.environ.get(api_env, "")
    socket_key = os.environ.get(socket_env, "")
    needed_api = any(not OPERATIONS[x["operation"]].get("public") for x in config.get("requests", []))
    needed_socket = bool(config.get("websockets"))
    if needed_api and not api_key:
        raise ValueError("An existing Finage API key is required for the selected account operation")
    if needed_socket and not socket_key:
        raise ValueError("An existing Finage socket key is required")
    with exclusive(root):
        ledger = new_capture(root, config, "capture", resume)
        identity_path = root / "private/account-identity.json"
        needed_api = any(not OPERATIONS[x["operation"]].get("public") for x in config.get("requests", []))
        needed_socket = bool(config.get("websockets"))
        private_identity = {"accountAlias": config.get("accountAlias"),
                            "apiKeySha256": sha(api_key.encode()) if needed_api and api_key else None,
                            "socketKeySha256": sha(socket_key.encode()) if needed_socket and socket_key else None}
        if identity_path.exists() and read_json(identity_path) != private_identity:
            raise ValueError("Resume credentials differ from the original private capture identity")
        if not identity_path.exists():
            atomic(identity_path, dumps(private_identity))
        for item in config.get("requests", []):
            capture_rest(root, ledger, item, api_key, timeout)
        for item in config.get("websockets", []):
            asyncio.run(capture_socket(root, ledger, item, socket_key, timeout))
        ledger["status"] = "COMPLETE" if all(x.get("status") == "COMPLETE"
                           for x in ledger["requests"] + ledger["streams"]) else "PARTIAL"
        save(root, ledger)
        return inspect(root)


def import_sources(config, manifest_path, root, resume):
    validate_config(config, "import")
    base = manifest_path.parent.resolve()
    with exclusive(root):
        ledger = new_capture(root, config, "import", resume)
        for item in config["sources"]:
            old = next((s for s in ledger["sources"] if s["id"] == item["id"]), None)
            if old:
                verify(root, old)
                for meta in old.get("metadata", []):
                    verify(root, meta)
                continue
            if item.get("format") not in FORMATS:
                raise ValueError("Specify the actual original source format")
            original = verify(base, item)
            body = retained(root, original, ".events.jsonl" if "websocket" in item["format"] else ".json")
            metadata = []
            for meta in item.get("metadata", []):
                data = verify(base, meta)
                metadata.append(retained(root, data, ".capture.json"))
            captured_at = item.get("capturedAt")
            if not isinstance(captured_at, str):
                raise ValueError("Retain the actual capture UTC from the original source")
            parsed_time = dt.datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
            if parsed_time.tzinfo is None or parsed_time.utcoffset() != dt.timedelta(0):
                raise ValueError("Capture time must state UTC explicitly")
            if not isinstance(item.get("sourceKind"), str) or type(item.get("originalWireBytes")) is not bool:
                raise ValueError("Source kind and wire-byte provenance must be explicit")
            shape = inspect_payload(original, item["format"], item.get("request"))
            entry = source_entry(item, body, captured_at, item["sourceKind"], item["originalWireBytes"],
                                 item["format"], metadata, shape)
            if "coverage" in item:
                entry["coverage"] = item["coverage"]
            if not shape.get("jsonValid"):
                entry["coverage"]["dataStatus"] = "INVALID_BODY"
            ledger["sources"].append(entry)
            save(root, ledger)
        ledger["status"] = "COMPLETE" if all(s["inspection"].get("jsonValid") for s in ledger["sources"]) else "PARTIAL"
        save(root, ledger)
        return inspect(root)


def inspect(root):
    ledger = read_json(root / "capture.json")
    if ledger.get("schema") != "commons.finage.capture.v1":
        raise ValueError("Unknown original capture format")
    sources = []
    unique = {}
    for entry in ledger["sources"]:
        body = verify(root, entry)
        shape = inspect_payload(body, entry["format"], entry.get("request"))
        unique[entry["path"]] = entry["bytes"]
        for meta in entry.get("metadata", []):
            verify(root, meta)
            unique[meta["path"]] = meta["bytes"]
        sources.append({"id": entry["id"], "format": entry["format"], "bytes": len(body),
                        "sha256": entry["sha256"], "sourceKind": entry["sourceKind"],
                        "coverage": entry["coverage"], "inspection": shape})
    return {"schema": "commons.finage.capture-inspection.v1", "captureId": ledger["captureId"],
            "status": ledger["status"], "createdAt": ledger["createdAt"], "updatedAt": ledger["updatedAt"],
            "sourceCount": len(sources), "uniqueFiles": len(unique), "sourceBytes": sum(unique.values()),
            "sources": sources, "requestStatuses": [{k: r.get(k) for k in ("id","status")} for r in ledger["requests"]],
            "streamStatuses": [{k: r.get(k) for k in ("id","status","providerSequenceComplete","streamContinuity")}
                               for r in ledger["streams"]]}


def prepare(root, output, selected=None, title=None, resume=False):
    """Create portable source inputs; never create another application store."""
    inspection = inspect(root)
    ledger = read_json(root / "capture.json")
    selected_ids = set(selected) if selected else {s["id"] for s in ledger["sources"]}
    if len(selected_ids) != len(selected or selected_ids):
        raise ValueError("Duplicate selected source id")
    if selected_ids - {s["id"] for s in ledger["sources"]}:
        raise ValueError("Selected source does not belong to the retained capture")
    sources = [s for s in ledger["sources"] if s["id"] in selected_ids]
    files, editions = {}, {}
    for entry in sources:
        for f in [entry] + entry.get("metadata", []):
            data = verify(root, f)
            if len(data) > SOURCE_LIMIT:
                raise ValueError("Source exceeds original 8 MiB file limit; select complete retained stream chunks")
            files[f["path"]] = data
        e = entry.get("edition", {})
        key = e.get("id", entry["id"])
        record = editions.setdefault(key, {"id": key, "label": e.get("label", key),
                    "capturedAt": entry["capturedAt"], "scope": entry["scope"], "sources": []})
        if canonical(record["scope"]) != canonical(entry["scope"]):
            raise ValueError("One edition cannot silently combine different requested scopes")
        if e.get("compareToEdition"):
            record["compareToEdition"] = e["compareToEdition"]
        if entry.get("role"):
            record["role"] = entry["role"]
        record["capturedAt"] = max(record["capturedAt"], entry["capturedAt"],
                    key=lambda value: dt.datetime.fromisoformat(value.replace("Z", "+00:00")))
        record["sources"].append({k: v for k, v in entry.items() if k not in {"edition","scope"}})
    if not editions:
        raise ValueError("Select at least one source")
    workspace = {"schema": "tj.finage-market-workspace.v1",
                 "title": title or ledger["title"], "selectedEdition": ledger.get("selectedEdition") if ledger.get("selectedEdition") in editions
                 else next((e["id"] for e in reversed(list(editions.values())) if e.get("role") != "reference"), list(editions)[-1]),
                 "editions": list(editions.values()), "symbolMappings": [], "timeInterpretations": [],
                 "reviews": [], "analysis": {"priceBasis": "native", "staleAfterSeconds": None},
                 "customer": {"mode": "all", "columns": []},
                 "sourceAcquisition": {"captureId": ledger["captureId"], "sourceStatus": ledger["status"],
                     "allSourceCount": len(ledger["sources"]), "selectedSourceIds": [s["id"] for s in sources],
                     "selectionComplete": len(sources) == len(ledger["sources"]),
                     "completeCaptureInspection": inspection}}
    files["workspace.json"] = dumps(workspace)
    total = sum(len(v) for v in files.values())
    if total > REVISION_LIMIT:
        raise ValueError("Selected source exceeds original 32 MiB revision limit; select complete retained chunks explicitly")
    manifest = [{"path": name, "bytes": len(data), "sha256": sha(data)}
                for name, data in files.items()]
    identity = sha(canonical(manifest))
    if output.exists() and not resume:
        raise ValueError("Prepared output already exists; use --resume for its exact source selection")
    output.mkdir(parents=True, exist_ok=resume, mode=0o700)
    intent_path = output / ".prepare-intent.json"
    if intent_path.exists() and read_json(intent_path).get("inputIdentity") != identity:
        raise ValueError("Prepared source selection differs from its retained original intent")
    if not intent_path.exists():
        atomic(intent_path, dumps({"inputIdentity": identity, "files": manifest}))
    existing_receipt = read_json(output / "source_manifest.json") if (output / "source_manifest.json").exists() else None
    if existing_receipt and existing_receipt.get("inputIdentity") != identity:
        raise ValueError("Prepared manifest belongs to a different source selection")
    for name, data in files.items():
        target = relative(output, name)
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError("Existing prepared file differs: " + name)
        else:
            atomic(target, data)
    if existing_receipt:
        return existing_receipt
    receipt = {"schema": "commons.finage.prepared-input.v1", "captureId": ledger["captureId"],
               "createdAt": utc(), "files": manifest, "sourceBytes": total, "inputIdentity": identity,
               "editionCount": len(editions), "selectedEdition": workspace["selectedEdition"],
               "accountCredentialsIncluded": False, "privateOriginalsIncluded": False}
    atomic(output / "source_manifest.json", dumps(receipt))
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("capture", help="Capture the original selected REST bodies and finite WebSocket observation")
    collect.add_argument("--plan", type=Path, required=True)
    collect.add_argument("--out", type=Path, required=True)
    collect.add_argument("--resume", action="store_true")
    collect.add_argument("--api-key-env", default="FINAGE_API_KEY")
    collect.add_argument("--socket-key-env", default="FINAGE_SOCKET_KEY")
    collect.add_argument("--timeout", type=float, default=30)
    importer = sub.add_parser("import", help="Retain exact existing sources without a provider request")
    importer.add_argument("--manifest", type=Path, required=True)
    importer.add_argument("--out", type=Path, required=True)
    importer.add_argument("--resume", action="store_true")
    inspector = sub.add_parser("inspect", help="Read back all declared source identities and coverage")
    inspector.add_argument("--dir", type=Path, required=True)
    emitter = sub.add_parser("prepare", help="Prepare original PythonWorkspace source files, without creating a second store")
    emitter.add_argument("--dir", type=Path, required=True)
    emitter.add_argument("--out", type=Path, required=True)
    emitter.add_argument("--source", action="append", help="Explicit complete retained source/chunk id; repeatable")
    emitter.add_argument("--title")
    emitter.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            if not 0 < args.timeout <= 600:
                raise ValueError("timeout must be above zero through 600 seconds")
            result = capture(read_json(args.plan), args.out.resolve(), args.resume,
                             args.api_key_env, args.socket_key_env, args.timeout)
        elif args.command == "import":
            result = import_sources(read_json(args.manifest), args.manifest.resolve(),
                                    args.out.resolve(), args.resume)
        elif args.command == "inspect":
            result = inspect(args.dir.resolve())
        else:
            result = prepare(args.dir.resolve(), args.out.resolve(), args.source, args.title, args.resume)
        sys.stdout.write(dumps(result).decode("utf-8"))
        return 0 if result.get("status", "COMPLETE") == "COMPLETE" else 2
    except (ValueError, OSError, KeyError, TypeError) as exc:
        # Request URLs and returned provider errors are sanitized before they
        # enter metadata. Never print environment values or credential bodies.
        secret_values = [os.environ.get(getattr(args,"api_key_env","FINAGE_API_KEY"), ""),
                         os.environ.get(getattr(args,"socket_key_env","FINAGE_SOCKET_KEY"), "")]
        sys.stderr.write(json.dumps({"error": redact_text(str(exc), secret_values)}, ensure_ascii=False) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
