"""Customer delivery adapters with retained event keys and explicit replay semantics."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import sqlite3
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .config import Config, checked_url


@dataclass(frozen=True)
class DeliveryResult:
    status: str
    detail: str
    http_status: int | None = None
    retry_after: float | None = None
    receipt: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.status not in {"delivered", "retry", "unknown", "failed"}:
            raise ValueError("Unsupported customer delivery result")


def retry_safe(config: Config) -> bool:
    kind = config.destination.get("kind")
    return kind in {"sqlite", "postgres"} or (kind == "http" and config.destination.get("idempotency_supported") is True)


def encode_event(event: dict[str, Any], idempotency_key: str) -> tuple[bytes, str]:
    if not re.fullmatch(r"[0-9a-f]{64}", idempotency_key) or event.get("event_id") != idempotency_key:
        raise ValueError("Delivery key must be the original canonical event ID")
    if event.get("schema") != "mercury-ops.event.v1" or not isinstance(event.get("canonical"), dict):
        raise ValueError("Delivery requires the canonical event envelope")
    raw = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return raw, hashlib.sha256(raw).hexdigest()


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        seconds = float(value)
        if seconds != seconds or seconds == float("inf") or seconds == float("-inf"):
            return None
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            seconds = (parsed - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0.0, min(seconds, 86400.0))


def _secret(config: Config, name: str) -> str | None:
    variable = config.destination.get(name)
    if not variable:
        return None
    value = os.environ.get(variable, "")
    if not value:
        raise ValueError(f"Set customer destination credential variable {variable}")
    if "\r" in value or "\n" in value:
        raise ValueError(f"Destination credential variable {variable} contains a line break")
    return value


def deliver_http(config: Config, event: dict[str, Any], idempotency_key: str) -> DeliveryResult:
    raw, digest = encode_event(event, idempotency_key)
    try:
        url = checked_url(config.destination.get("url"), allow_local_http=config.allow_local_http)
        token = _secret(config, "token_env")
        signing_secret = _secret(config, "hmac_secret_env")
    except ValueError as exc:
        return DeliveryResult("failed", str(exc))
    headers = {"Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "mercury-event-operations/1.0", "Idempotency-Key": idempotency_key,
        "X-Mercury-Ops-Payload-SHA256": digest}
    if token:
        headers["Authorization"] = "Bearer " + token
    if signing_secret:
        headers["X-Mercury-Ops-Signature"] = hmac.new(signing_secret.encode(), raw, hashlib.sha256).hexdigest()
    request = Request(url, data=raw, headers=headers, method="POST")
    status: int | None = None
    response_headers = None
    try:
        with build_opener(_NoRedirects()).open(request, timeout=config.request_timeout_seconds) as response:
            status = response.status
            response_headers = response.headers
            # The HTTP acknowledgement is sufficient. A customer response body can
            # contain confidential data and is deliberately neither read nor logged.
    except HTTPError as exc:
        status = exc.code
        response_headers = exc.headers
        exc.close()
    except (URLError, TimeoutError, OSError, ssl.SSLError, http.client.HTTPException):
        return DeliveryResult("retry" if retry_safe(config) else "unknown",
            "Customer connection ended without a durable acknowledgement; the original event key is retained",
            receipt={"event_id": idempotency_key, "payload_sha256": digest, "acknowledged": False})
    receipt = {"event_id": idempotency_key, "payload_sha256": digest, "http_status": status,
        "acknowledged": bool(status is not None and 200 <= status < 300)}
    if status is not None and 200 <= status < 300:
        return DeliveryResult("delivered", "Customer endpoint acknowledged the canonical event", status, receipt=receipt)
    retry_after = _retry_after(response_headers.get("Retry-After") if response_headers else None)
    if status is not None and (status in {408, 425, 429} or 500 <= status < 600):
        state = "retry" if retry_safe(config) else "unknown"
        return DeliveryResult(state, f"Customer returned HTTP {status}; retained event key supports reconciliation or deliberate retry", status, retry_after, receipt)
    if status in {301, 302, 303, 307, 308}:
        return DeliveryResult("failed", "Customer endpoint redirected; update the explicit destination URL", status, receipt=receipt)
    if status == 409:
        return DeliveryResult("failed", "Customer returned a conflict; inspect the existing event before retrying", status, receipt=receipt)
    return DeliveryResult("failed", f"Customer rejected the event with HTTP {status}", status, receipt=receipt)


def deliver_sqlite(config: Config, event: dict[str, Any], idempotency_key: str) -> DeliveryResult:
    raw, digest = encode_event(event, idempotency_key)
    path = Path(config.destination["path"])
    if not path.is_absolute():
        path = config.workspace / path
    path = path.resolve()
    table = config.destination.get("table", "mercury_events")
    if not isinstance(table, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", table):
        return DeliveryResult("failed", "Customer SQLite table name is invalid")
    canonical = event["canonical"]
    connection = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Pre-create with private permissions. SQLite still owns its normal
        # connection/transaction machinery; existing customer databases are reused.
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        connection = sqlite3.connect(path, timeout=config.request_timeout_seconds, isolation_level=None)
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(f'''CREATE TABLE IF NOT EXISTS "{table}" (
            event_key TEXT PRIMARY KEY,
            payload_sha256 TEXT NOT NULL,
            network TEXT NOT NULL,
            provider_scope TEXT NOT NULL,
            provider_base TEXT NOT NULL,
            provider_row_id INTEGER NOT NULL,
            contract_id TEXT NOT NULL,
            tx_hash TEXT NOT NULL,
            event_index INTEGER,
            canonical_json TEXT NOT NULL,
            envelope_json TEXT NOT NULL,
            received_at TEXT NOT NULL
        )''')
        old = connection.execute(f'SELECT payload_sha256,envelope_json FROM "{table}" WHERE event_key=?', (idempotency_key,)).fetchone()
        if old is not None:
            if old != (digest, raw.decode("utf-8")):
                connection.rollback()
                return DeliveryResult("failed", "The destination already has different bytes under this canonical event key",
                    receipt={"event_id": idempotency_key, "payload_sha256": digest, "conflict": True})
            connection.commit()
            return DeliveryResult("delivered", "Customer database already retains this exact event",
                receipt={"event_id": idempotency_key, "payload_sha256": digest, "reused": True, "table": table})
        connection.execute(f'''INSERT INTO "{table}"
            (event_key,payload_sha256,network,provider_scope,provider_base,provider_row_id,
             contract_id,tx_hash,event_index,canonical_json,envelope_json,received_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''', (
                idempotency_key, digest, event["network"], event["provider_scope"],
                event["provider_base"], event["provider_row_id"], canonical["contract_id"],
                canonical["tx"], canonical.get("event_index"),
                json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False),
                raw.decode("utf-8"), datetime.now(timezone.utc).isoformat(),
            ))
        connection.commit()
        return DeliveryResult("delivered", "Customer database committed the canonical event",
            receipt={"event_id": idempotency_key, "payload_sha256": digest, "reused": False, "table": table})
    except sqlite3.OperationalError as exc:
        detail = str(exc).lower()
        transient = "locked" in detail or "busy" in detail or "interrupted" in detail
        return DeliveryResult("retry" if transient else "failed",
            "Customer SQLite transaction could not complete: " + str(exc)[:300])
    except (sqlite3.Error, OSError, KeyError, TypeError, ValueError) as exc:
        return DeliveryResult("failed", "Customer SQLite destination could not accept the canonical event (" + type(exc).__name__ + ")")
    finally:
        if connection is not None:
            connection.close()


def deliver(config: Config, event: dict[str, Any], idempotency_key: str) -> DeliveryResult:
    kind = config.destination.get("kind")
    if kind == "sqlite":
        return deliver_sqlite(config, event, idempotency_key)
    if kind == "http":
        return deliver_http(config, event, idempotency_key)
    if kind == "postgres":
        try:
            from .delivery_postgres import deliver_postgres
        except ImportError:
            return DeliveryResult("failed", "Install the supplied PostgreSQL adapter and its documented driver")
        return deliver_postgres(config, event, idempotency_key)
    return DeliveryResult("failed", "Configure a supported customer destination")
