"""Mercury Classic REST reads and the documented raw-body webhook signature."""
from __future__ import annotations

import base64
from dataclasses import dataclass
import email.utils
import hashlib
import hmac
import json
import math
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .config import CONTRACT_ID, checked_url
from .store import OpsError

TX = re.compile(r"[0-9a-fA-F]{64}\Z")


class ProviderError(OpsError):
    def __init__(self, code, message, *, retryable=False, retry_after=None, observation=None):
        super().__init__(code, message, 502)
        self.retryable, self.retry_after, self.observation = retryable, retry_after, observation


@dataclass(frozen=True)
class ProviderPage:
    rows: list
    raw_body: bytes
    request_path: str
    received_at: float
    http_status: int = 200


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def tx_hash(value):
    if not isinstance(value, str) or not TX.fullmatch(value):
        raise OpsError("INVALID_TRANSACTION_HASH", "A transaction hash must contain exactly 64 hexadecimal characters.")
    return value.lower()


def verify_webhook(raw_body, signature, secret):
    if not secret:
        raise OpsError("WEBHOOK_SECRET_REQUIRED", "Configure the workspace webhook secret before accepting notifications.", 503)
    if not isinstance(signature, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", signature):
        raise OpsError("INVALID_SIGNATURE", "The Mercury webhook signature is invalid.", 401)
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    if not hmac.compare_digest(bytes.fromhex(signature), expected):
        raise OpsError("INVALID_SIGNATURE", "The Mercury webhook signature is invalid.", 401)


def _xdr(value, label):
    if not isinstance(value, str):
        raise ProviderError("INVALID_CANONICAL_ROW", f"Mercury {label} must retain its XDR-base64 string.")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        raise ProviderError("INVALID_CANONICAL_ROW", f"Mercury {label} is not valid base64.") from None
    if len(decoded) < 4 or len(decoded) % 4:
        raise ProviderError("INVALID_CANONICAL_ROW", f"Mercury {label} is not an aligned XDR value.")


def validate_row(row):
    if not isinstance(row, dict):
        raise ProviderError("INVALID_CANONICAL_ROW", "Mercury returned an event that is not an object.")
    if type(row.get("id")) is not int or not -2147483648 <= row["id"] <= 2147483647:
        raise ProviderError("INVALID_CANONICAL_ROW", "Mercury returned an invalid canonical row ID.")
    if not isinstance(row.get("contract_id"), str) or not CONTRACT_ID.fullmatch(row["contract_id"]):
        raise ProviderError("INVALID_CANONICAL_ROW", "Mercury returned an invalid contract address.")
    try:
        tx_hash(row.get("tx"))
    except OpsError:
        raise ProviderError("INVALID_CANONICAL_ROW", "Mercury returned an invalid canonical transaction hash.") from None
    index = row.get("event_index")
    if index is not None and (type(index) is not int or not 0 <= index <= 2147483647):
        raise ProviderError("INVALID_CANONICAL_ROW", "Mercury returned an invalid event index.")
    _xdr(row.get("data"), "event data")
    for i in range(1, 11):
        value = row.get(f"topic{i}")
        if value is not None:
            _xdr(value, f"topic{i}")
    return row


def _retry_after(value):
    if not value:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            parsed = email.utils.parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                from datetime import timezone
                parsed = parsed.replace(tzinfo=timezone.utc)
            seconds = parsed.timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0.0, min(seconds, 86400.0)) if math.isfinite(seconds) else None


def _read_response(response, limit, deadline):
    # read1 performs one underlying read, so a trickle cannot keep filling one
    # large read forever. The socket timeout bounds each remaining read.
    chunks, length = [], 0
    read = getattr(response, "read1", response.read)
    while length <= limit:
        if time.monotonic() >= deadline:
            raise TimeoutError("Provider response deadline reached")
        chunk = read(min(65536, limit + 1 - length))
        if not chunk:
            break
        chunks.append(chunk)
        length += len(chunk)
    return b"".join(chunks)


def _reject_nonfinite(value):
    raise ValueError("Non-finite value is not JSON")


class MercuryProvider:
    def __init__(self, config):
        self.config = config
        self.base = checked_url(config.api_base, allow_local_http=config.allow_local_http)
        self.opener = build_opener(NoRedirect())

    def _get(self, path):
        token = self.config.provider_token()
        if not token:
            raise ProviderError("PROVIDER_TOKEN_REQUIRED", "Configure the Mercury JWT environment variable, then retry the retained task.")
        request = Request(self.base + path, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
        deadline = time.monotonic() + self.config.request_timeout_seconds
        try:
            with self.opener.open(request, timeout=self.config.request_timeout_seconds) as response:
                raw = _read_response(response, self.config.max_body_bytes, deadline)
                status = response.status
        except HTTPError as error:
            observation = None
            limit = min(self.config.max_body_bytes, 65536)
            try:
                raw = _read_response(error, limit, deadline)
                if len(raw) <= limit:
                    observation = ProviderPage([], raw, path, time.time(), error.code)
            except (URLError, TimeoutError, OSError):
                pass
            finally:
                error.close()
            retryable = error.code in {408, 425, 429} or 500 <= error.code <= 599
            code = "PROVIDER_AUTH_REJECTED" if error.code in {401, 403} else "PROVIDER_HTTP_ERROR"
            raise ProviderError(code, f"Mercury returned HTTP {error.code}.", retryable=retryable,
                                retry_after=_retry_after(error.headers.get("Retry-After")), observation=observation) from None
        except (URLError, TimeoutError, OSError):
            raise ProviderError("PROVIDER_UNREACHABLE", "The Mercury read did not complete; the retained request can be retried.", retryable=True) from None
        page = ProviderPage([], raw, path, time.time(), status)
        if len(raw) > self.config.max_body_bytes:
            raise ProviderError("PROVIDER_RESPONSE_TOO_LARGE", "The provider response exceeds max_body_bytes; adjust the configured bound or catch-up page size before retrying.")
        try:
            rows = json.loads(raw, parse_constant=_reject_nonfinite)
        except (ValueError, UnicodeError):
            raise ProviderError("INVALID_PROVIDER_JSON", "Mercury returned a response that is not valid JSON.", observation=page) from None
        if not isinstance(rows, list):
            raise ProviderError("INVALID_PROVIDER_ARRAY", "The Classic event endpoint did not return its documented JSON array.", observation=page)
        return ProviderPage(rows, raw, path, page.received_at, status)

    def by_tx(self, transaction):
        return self._get("/events/by-tx/" + tx_hash(transaction))

    def catchup_page(self, *, contracts, ledger_from, ledger_to, page_size, cursor):
        params = {"contracts": ",".join(contracts), "from": ledger_from, "to": ledger_to, "limit": page_size}
        if cursor is not None:
            params["cursor"] = cursor
        return self._get("/events/by-ledger/contracts?" + urlencode(params))
