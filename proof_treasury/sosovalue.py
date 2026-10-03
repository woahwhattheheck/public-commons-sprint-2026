"""Read-only SoSoValue snapshots with retained, exact source evidence.

Needs expert review. No trading, key discovery, retry loop or quote-time inference.
The documented snapshot has a USD price but no quote observation timestamp:
https://sodex.com/documentation/for-developers/api-reference/market-data-api/currency/market-snapshot
Authentication and limits:
https://sodex.com/documentation/for-developers/developers/data-api/authentication-and-limits

collect_snapshot uses only SOSO_API_KEY and the fixed official origin. The local
20-request/minute budget is per process, not a shared or monthly quota guarantee.
Cache hits preserve acquisition time; an expired response is never a fallback.
import_snapshot_fragment is explicitly supplied, unbound data, not a live quote.
"""
from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
from http.client import HTTPException
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE_URL = "https://openapi.sosovalue.com/openapi/v1"
FORMAT_URL = ("https://sodex.com/documentation/for-developers/api-reference/"
              "market-data-api/currency/market-snapshot")
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_CACHE_BYTES = 32 * 1024 * 1024
MAX_CACHE_FILES = 512
CACHE_SECONDS = 30
TIMEOUT_SECONDS = 10
MAX_ASSETS = 19  # One currency-list request plus at most nineteen snapshots.
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}\Z")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_lock = threading.RLock()
_requests: deque[float] = deque()
_cooldown_until = 0.0


class AdapterError(ValueError):
    def __init__(self, code: str, **health):
        super().__init__(code)
        self.code = code
        self.health = {"state": code, "quote_time": "UNKNOWN", **health}


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _epoch(value: str) -> float:
    if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise AdapterError("ACQUISITION_TIME_INVALID")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc).timestamp()
    except ValueError as exc:
        raise AdapterError("ACQUISITION_TIME_INVALID") from exc


def _json(raw: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise AdapterError("RESPONSE_DUPLICATE_KEY")
            result[key] = value
        return result

    def constant(_):
        raise AdapterError("RESPONSE_NONFINITE_NUMBER")

    try:
        return json.loads(raw.decode("utf-8"), parse_float=Decimal,
                          parse_constant=constant, object_pairs_hook=pairs)
    except (ValueError, UnicodeError, RecursionError) as exc:
        if isinstance(exc, AdapterError):
            raise
        raise AdapterError("RESPONSE_JSON_INVALID") from exc


def _read_file(path: Path, cap: int = MAX_RESPONSE_BYTES) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise AdapterError("REGULAR_FILE_REQUIRED")
            if info.st_size > cap:
                raise AdapterError("RESPONSE_TOO_LARGE")
            raw = source.read(cap + 1)
        if len(raw) > cap:
            raise AdapterError("RESPONSE_TOO_LARGE")
        return raw
    except OSError as exc:
        raise AdapterError("SOURCE_READ_FAILED") from exc


def _scale(quote_scale: int) -> None:
    if type(quote_scale) is not int or not 0 <= quote_scale <= 8:
        raise AdapterError("QUOTE_SCALE_REQUIRED_0_TO_8")


def _price(data, quote_scale: int) -> str:
    if not isinstance(data, dict) or type(data.get("price")) not in (int, Decimal):
        raise AdapterError("USD_PRICE_NUMBER_REQUIRED")
    value = Decimal(data["price"])
    if not value.is_finite() or value <= 0:
        raise AdapterError("POSITIVE_FINITE_PRICE_REQUIRED")
    sign, digits, exponent = value.as_tuple()
    exponent += quote_scale
    digits = list(digits)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    # Match the paper core's exact representation, without Decimal context rounding.
    if max(1, len(digits) + exponent) > 36 or max(0, -exponent) > 24:
        raise AdapterError("PRICE_OUTSIDE_EXACT_CORE_RANGE")
    return format(Decimal((sign, tuple(digits), exponent)), "f")


def _unwrap(raw: bytes):
    value = _json(raw)
    if not isinstance(value, dict) or type(value.get("code")) is not int:
        raise AdapterError("API_SUCCESS_ENVELOPE_REQUIRED")
    if value["code"] != 0:
        raise AdapterError("API_ERROR", provider_code=value["code"])
    if "data" not in value:
        raise AdapterError("API_SUCCESS_ENVELOPE_REQUIRED")
    return value["data"]


class _Cache:
    """Own only cache_dir/sosovalue; keep immutable evidence until capacity fills."""

    def __init__(self, directory):
        self.root = Path(directory).expanduser().resolve() / "sosovalue"
        try:
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError as exc:
            raise AdapterError("CACHE_IO_FAILED") from exc

    def write(self, name: str, raw: bytes, *, replace: bool = False) -> Path:
        path = self.root / name
        staging = None
        try:
            with _lock:
                if path.exists() and not replace:
                    if path.is_symlink() or _read_file(path) != raw:
                        raise AdapterError("CACHE_EVIDENCE_MISMATCH")
                    return path
                entries = list(self.root.iterdir())
                if any(item.is_symlink() or not item.is_file() for item in entries):
                    raise AdapterError("CACHE_LAYOUT_INVALID")
                prior = path.stat().st_size if path.exists() else 0
                if (sum(item.stat().st_size for item in entries) - prior + len(raw) > MAX_CACHE_BYTES
                        or len(entries) + (0 if path.exists() else 1) > MAX_CACHE_FILES):
                    raise AdapterError("CACHE_FULL", max_bytes=MAX_CACHE_BYTES,
                                       max_files=MAX_CACHE_FILES)
                with tempfile.NamedTemporaryFile(dir=self.root, prefix="pending-", delete=False) as out:
                    staging = Path(out.name)
                    out.write(raw)
                    out.flush()
                    os.fsync(out.fileno())
                if replace:
                    os.replace(staging, path)
                else:
                    try:
                        os.link(staging, path)
                    except FileExistsError:
                        if path.is_symlink() or _read_file(path) != raw:
                            raise AdapterError("CACHE_EVIDENCE_MISMATCH")
                return path
        except OSError as exc:
            raise AdapterError("CACHE_IO_FAILED") from exc
        finally:
            if staging is not None:
                staging.unlink(missing_ok=True)

    def retain(self, raw: bytes, endpoint: str, origin: str, *, rate=None, status=None) -> dict:
        acquired_at = _stamp()
        digest = _sha(raw)
        raw_path = self.write("raw-" + digest + ".json", raw)
        capture = {"schema": "proof-treasury.source-capture/v1", "endpoint": endpoint,
                   "origin": origin, "acquired_at": acquired_at, "raw_sha256": digest,
                   "byte_count": len(raw), "http_status": status, "rate_limit": rate or {}}
        metadata = _canonical(capture)
        capture_path = self.write("capture-" + _sha(metadata) + ".json", metadata)
        return {**capture, "raw_path": str(raw_path), "capture_path": str(capture_path),
                "cache_hit": False}

    def fresh(self, endpoint: str) -> dict | None:
        index = self.root / ("latest-" + _sha(endpoint.encode()) + ".json")
        if not index.exists():
            return None
        try:
            pointer = _json(_read_file(index))
            digest = pointer["capture_sha256"]
            if type(digest) is not str or not _SHA.fullmatch(digest):
                raise AdapterError("CACHE_EVIDENCE_MISMATCH")
            capture_path = self.root / ("capture-" + digest + ".json")
            metadata = _read_file(capture_path)
            if _sha(metadata) != digest:
                raise AdapterError("CACHE_EVIDENCE_MISMATCH")
            capture = _json(metadata)
            if (capture["endpoint"] != endpoint or capture["origin"] != "HTTP_RESPONSE"
                    or capture["http_status"] != 200 or not _SHA.fullmatch(capture["raw_sha256"])):
                raise AdapterError("CACHE_EVIDENCE_MISMATCH")
            age = time.time() - _epoch(capture["acquired_at"])
            if not 0 <= age < CACHE_SECONDS:
                return None
            raw_path = self.root / ("raw-" + capture["raw_sha256"] + ".json")
            if _sha(_read_file(raw_path)) != capture["raw_sha256"]:
                raise AdapterError("CACHE_EVIDENCE_MISMATCH")
            return {**capture, "raw_path": str(raw_path), "capture_path": str(capture_path),
                    "cache_hit": True}
        except (KeyError, TypeError) as exc:
            raise AdapterError("CACHE_METADATA_INVALID") from exc

    def index(self, capture: dict) -> None:
        name = "latest-" + _sha(capture["endpoint"].encode()) + ".json"
        digest = Path(capture["capture_path"]).stem.removeprefix("capture-")
        self.write(name, _canonical({"capture_sha256": digest}), replace=True)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward x-soso-api-key, even to another HTTPS origin.


def _reserve_request() -> None:
    with _lock:
        now = time.monotonic()
        while _requests and _requests[0] <= now - 60:
            _requests.popleft()
        wait = max(_cooldown_until - now, _requests[0] + 60 - now if len(_requests) >= 20 else 0)
        if wait > 0:
            raise AdapterError("RATE_LIMITED_LOCALLY", retry_after_seconds=math.ceil(wait))
        _requests.append(now)


def _rate(headers, raw: bytes, status: int) -> dict:
    global _cooldown_until
    result = {}
    for field, header in (("limit", "X-RateLimit-Limit"),
                          ("remaining", "X-RateLimit-Remaining"),
                          ("reset_epoch_ms", "X-RateLimit-Reset")):
        value = headers.get(header, "")
        if re.fullmatch(r"[0-9]{1,16}", value):
            result[field] = int(value)
    wait = 0.0
    if result.get("remaining") == 0 and "reset_epoch_ms" in result:
        wait = max(0, result["reset_epoch_ms"] / 1000 - time.time())
    if status == 429:
        wait = max(wait, 60)  # Conservative default when retry metadata is absent.
        try:
            delay = _json(raw).get("details", {}).get("retry_after")
            if type(delay) is int and 0 < delay <= 31536000:
                wait = max(wait if "reset_epoch_ms" in result else 0, delay)
        except (AdapterError, AttributeError):
            pass
    if wait:
        result["retry_after_seconds"] = math.ceil(wait)
        with _lock:
            _cooldown_until = max(_cooldown_until, time.monotonic() + wait)
    return result


def _body(response) -> bytes:
    deadline, chunks, size = time.monotonic() + TIMEOUT_SECONDS, [], 0
    reader = getattr(response, "read1", response.read)
    while True:
        if time.monotonic() >= deadline:
            raise AdapterError("PROVIDER_TIMEOUT")
        part = reader(min(65536, MAX_RESPONSE_BYTES + 1 - size))
        size += len(part)
        if size > MAX_RESPONSE_BYTES:
            raise AdapterError("RESPONSE_TOO_LARGE")
        if not part:
            return b"".join(chunks)
        chunks.append(part)


def _get(cache: _Cache, endpoint: str, key: str) -> dict:
    cached = cache.fresh(endpoint)
    if cached is not None:
        return cached
    _reserve_request()
    request = Request(endpoint, headers={"x-soso-api-key": key, "Accept": "application/json",
                                        "Accept-Encoding": "identity"}, method="GET")
    try:
        try:
            response = build_opener(_NoRedirect()).open(request, timeout=TIMEOUT_SECONDS)
        except HTTPError as exc:
            response = exc  # Retain a bounded error response; never follow its Location.
        with response:
            status = response.status
            raw = _body(response)
            rate = _rate(response.headers, raw, status)
        capture = cache.retain(raw, endpoint, "HTTP_RESPONSE", rate=rate, status=status)
        if status != 200:
            code = ({401: "KEY_REJECTED", 403: "ENDPOINT_PERMISSION_DENIED",
                     404: "RESOURCE_NOT_FOUND", 429: "PROVIDER_RATE_LIMITED"}.get(status)
                    or ("REDIRECT_REFUSED" if 300 <= status < 400 else "PROVIDER_HTTP_ERROR"))
            raise AdapterError(code, http_status=status, rate_limit=rate, responses=[capture])
        try:
            _unwrap(raw)
        except AdapterError as exc:
            exc.health["responses"] = [capture]
            raise
        cache.index(capture)
        return capture
    except (TimeoutError, socket.timeout) as exc:
        raise AdapterError("PROVIDER_TIMEOUT") from exc
    except (URLError, OSError, HTTPException) as exc:
        raise AdapterError("PROVIDER_UNAVAILABLE") from exc


def _result(cache: _Cache, records: list[dict], quotes: list[dict], quote_scale: int,
            source_kind: str, source_id: str, state: str) -> dict:
    manifest = {"schema": "proof-treasury.source-manifest/v1", "source_kind": source_kind,
                "source_id": source_id, "quote_currency": "USD", "quote_scale": quote_scale,
                "quotes": quotes, "responses": [
                    {key: record[key] for key in ("endpoint", "origin", "acquired_at", "raw_sha256")}
                    for record in records]}
    evidence = _canonical(manifest)
    digest = _sha(evidence)
    manifest_path = cache.write("manifest-" + digest + ".json", evidence)
    quote_records = records[1:] if source_kind == "SOSOVALUE_API" else records
    snapshot = {"schema": "proof-treasury.snapshot/v1", "source_kind": source_kind,
                "source_id": source_id, "observed_at": min(r["acquired_at"] for r in quote_records),
                "quote_as_of": None, "quote_currency": "USD", "quote_scale": quote_scale,
                "quotes": quotes, "evidence_sha256": digest}
    return {"snapshot": snapshot, "health": {"state": state, "quote_time": "UNKNOWN",
            "acquisition_time_is_quote_time": False, "format_reference": FORMAT_URL,
            "cache_hits": sum(record["cache_hit"] for record in records)},
            "evidence_manifest_path": str(manifest_path), "responses": records}


def collect_snapshot(currency_ids: list[str], quote_scale: int, cache_dir: str) -> dict:
    """Fetch up to 19 named currency IDs; API quote time always remains unknown.

    Returns {snapshot, health, evidence_manifest_path, responses}. Evidence SHA is
    the retained manifest SHA, binding original response SHAs and acquisition times.
    No key -> NO_KEY before filesystem/network use. A fresh local cache is at most
    30 seconds old; stale entries are retained but never returned after fetch failure.
    """
    _scale(quote_scale)
    if (type(currency_ids) is not list or not 1 <= len(currency_ids) <= MAX_ASSETS
            or any(type(item) is not str or not _ID.fullmatch(item) for item in currency_ids)
            or len(set(currency_ids)) != len(currency_ids)):
        raise AdapterError("DISTINCT_CURRENCY_IDS_REQUIRED", max_assets=MAX_ASSETS)
    key = os.environ.get("SOSO_API_KEY", "")
    if not key:
        raise AdapterError("NO_KEY", key_environment_variable="SOSO_API_KEY")
    if any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise AdapterError("KEY_FORMAT_INVALID")
    cache, records = _Cache(cache_dir), []
    try:
        listing = _get(cache, BASE_URL + "/currencies", key)
        records.append(listing)
        currencies = _unwrap(_read_file(Path(listing["raw_path"])))
        if (type(currencies) is not list or any(type(row) is not dict
                or type(row.get("currency_id")) is not str for row in currencies)):
            raise AdapterError("CURRENCY_LIST_FORMAT_INVALID")
        known = {row["currency_id"] for row in currencies}
        if any(asset not in known for asset in currency_ids):
            raise AdapterError("CURRENCY_ID_NOT_IN_LIST")
        quotes = []
        for asset in currency_ids:
            record = _get(cache, BASE_URL + "/currencies/" + quote(asset, safe="") + "/market-snapshot", key)
            records.append(record)
            data = _unwrap(_read_file(Path(record["raw_path"])))
            quotes.append({"asset_id": asset, "price_minor": _price(data, quote_scale)})
        return _result(cache, records, quotes, quote_scale, "SOSOVALUE_API", BASE_URL,
                       "ACQUIRED_QUOTE_TIME_UNKNOWN")
    except AdapterError as exc:
        exc.health["responses"] = records + exc.health.get("responses", [])
        raise


def import_snapshot_fragment(response_path: str, quote_scale: int, cache_dir: str) -> dict:
    """Import an unwrapped supplied fragment without asserting its currency/origin.

    The official documentation's response example is a suitable input, but this
    function makes no claim that supplied bytes came from that page or the API.
    Asset identity is UNBOUND_FRAGMENT, source is SUPPLIED_OFFLINE, observed_at is
    this import's acquisition time, and quote_as_of stays null. No API key/network.
    """
    _scale(quote_scale)
    raw = _read_file(Path(response_path))
    data = _json(raw)
    if type(data) is not dict or "code" in data or "data" in data:
        raise AdapterError("UNWRAPPED_SNAPSHOT_FRAGMENT_REQUIRED")
    price = _price(data, quote_scale)
    cache = _Cache(cache_dir)
    record = cache.retain(raw, "supplied:market-snapshot-fragment", "SUPPLIED_FRAGMENT")
    return _result(cache, [record], [{"asset_id": "UNBOUND_FRAGMENT", "price_minor": price}],
                   quote_scale, "SUPPLIED_OFFLINE", "supplied:sosovalue-market-snapshot-fragment",
                   "UNBOUND_SUPPLIED_FRAGMENT")
