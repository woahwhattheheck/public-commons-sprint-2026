"""Transactional PostgreSQL delivery for the original Mercury event envelope.

Psycopg is optional and imported only when this destination is used. The customer
table is provisioned separately, so the delivery role needs INSERT and SELECT,
not ownership of the table or permission to change an already accepted event.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
import re
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .config import Config
    from .delivery import DeliveryResult


_IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,62}\Z")
_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def _table_name(schema: str, table: str) -> str:
    for value in (schema, table):
        if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
            raise ValueError("PostgreSQL schema and table must be simple identifiers of at most 63 characters")
    return f'"{schema}"."{table}"'


def schema_sql(schema: str = "public", table: str = "mercury_events") -> str:
    """Return the explicit one-time migration for the selected customer table.

    CREATE TABLE intentionally has no IF NOT EXISTS: a conflicting existing
    schema needs an operator decision, not a silently incompatible destination.
    The schema itself must already exist and be owned by the customer.
    """
    name = _table_name(schema, table)
    return f"""CREATE TABLE {name} (
    event_key TEXT PRIMARY KEY CHECK (event_key ~ '^[0-9a-f]{{64}}$'),
    payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{{64}}$'),
    network TEXT NOT NULL,
    provider_scope TEXT NOT NULL,
    provider_base TEXT NOT NULL,
    provider_row_id INTEGER NOT NULL,
    contract_id TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    event_index INTEGER,
    canonical_json JSONB NOT NULL,
    envelope_bytes BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
"""


def _received_at(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def deliver_postgres(config: Config, event: dict[str, Any], idempotency_key: str) -> DeliveryResult:
    """Commit, or recover the receipt for, one exact canonical event.

    ON CONFLICT waits for an in-flight insert with this key. Under READ COMMITTED,
    the following SELECT sees the committed winner. No UPDATE/DELETE is issued,
    and a result is not acknowledged until the connection context commits. A
    connection failure around COMMIT is retryable with the same retained key.
    """
    from .delivery import DeliveryResult, encode_event

    try:
        raw, digest = encode_event(event, idempotency_key)
        destination = config.destination
        schema = destination.get("schema", "public")
        table = destination.get("table", "mercury_events")
        name = _table_name(schema, table)
        variable = destination.get("dsn_env", "MERCURY_CUSTOMER_DATABASE_URL")
        if not isinstance(variable, str) or not _ENV_NAME.fullmatch(variable):
            return DeliveryResult("failed", "PostgreSQL dsn_env must name an environment variable")
        dsn = os.environ.get(variable, "")
        if not dsn.strip() or "\x00" in dsn:
            return DeliveryResult("failed", f"Set the PostgreSQL destination credential variable {variable}")
        timeout = config.request_timeout_seconds
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 1 <= timeout <= 120:
            return DeliveryResult("failed", "PostgreSQL request timeout must be between 1 and 120 seconds")
        canonical = event["canonical"]
        canonical_json = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        values = (
            idempotency_key, digest, event["network"], event["provider_scope"],
            event["provider_base"], event["provider_row_id"], canonical["contract_id"],
            canonical["tx"], canonical.get("event_index"), canonical_json, raw,
        )
    except (KeyError, TypeError, ValueError, OverflowError):
        return DeliveryResult("failed", "PostgreSQL delivery requires the unchanged canonical event envelope and valid destination configuration")

    receipt = {"event_id": idempotency_key, "payload_sha256": digest,
        "schema": schema, "table": table}
    try:
        import psycopg
        from psycopg import IsolationLevel
    except ImportError:
        return DeliveryResult("failed", "Install the PostgreSQL destination's optional psycopg[binary] driver as described in POSTGRES.md", receipt=receipt)

    try:
        # Bound connection attempts and SQL waits without taking credentials out
        # of their selected environment. Preserve the customer's DSN/TLS policy.
        with psycopg.connect(dsn, connect_timeout=max(2, math.ceil(timeout)),
                application_name="mercury-event-operations", client_encoding="UTF8") as connection:
            connection.isolation_level = IsolationLevel.READ_COMMITTED
            with connection.cursor() as cursor:
                milliseconds = str(math.ceil(timeout * 1000))
                cursor.execute("""SELECT
                    pg_catalog.set_config('statement_timeout', %s, true),
                    pg_catalog.set_config('lock_timeout', %s, true),
                    CASE WHEN pg_catalog.current_setting('synchronous_commit') = 'off'
                         THEN pg_catalog.set_config('synchronous_commit', 'on', true)
                         ELSE pg_catalog.current_setting('synchronous_commit') END""",
                    (milliseconds, milliseconds))
                cursor.execute(f"""INSERT INTO {name}
                    (event_key,payload_sha256,network,provider_scope,provider_base,
                     provider_row_id,contract_id,tx_hash,event_index,canonical_json,envelope_bytes)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
                    ON CONFLICT (event_key) DO NOTHING RETURNING received_at""", values)
                inserted = cursor.fetchone()
                if inserted is not None:
                    result = DeliveryResult("delivered", "Customer PostgreSQL database committed the canonical event",
                        receipt={**receipt, "reused": False, "received_at": _received_at(inserted[0])})
                else:
                    cursor.execute(f"SELECT payload_sha256,envelope_bytes,received_at FROM {name} WHERE event_key=%s", (idempotency_key,))
                    retained = cursor.fetchone()
                    if retained is None:
                        result = DeliveryResult("retry", "The destination event changed during delivery; retry the original event key",
                            receipt=receipt)
                    elif retained[0] != digest or bytes(retained[1]) != raw:
                        result = DeliveryResult("failed", "The destination already has different bytes under this canonical event key",
                            receipt={**receipt, "conflict": True, "retained_payload_sha256": retained[0],
                                "received_at": _received_at(retained[2])})
                    else:
                        result = DeliveryResult("delivered", "Customer PostgreSQL database already retains this exact event",
                            receipt={**receipt, "reused": True, "received_at": _received_at(retained[2])})
        # The connection context above commits before any delivered result escapes.
        return result
    except psycopg.Error as exc:
        code = exc.sqlstate
        retryable = (
            isinstance(exc, (psycopg.OperationalError, psycopg.InterfaceError)) and code is None
        ) or (code is not None and (
            code.startswith(("08", "53")) or code in {"40001", "40P01", "55P03", "55006", "57014", "57P01", "57P02", "57P03"}
        ))
        error_receipt = {**receipt, "acknowledged": False}
        if code:
            error_receipt["sqlstate"] = code
        if retryable:
            return DeliveryResult("retry", "PostgreSQL did not confirm the transaction; retrying the retained event key is safe", receipt=error_receipt)
        if code and code.startswith("28"):
            detail = "PostgreSQL authentication failed; check the selected credential and customer database role"
        elif code in {"42501", "42P01", "42703", "42804", "3F000", "25006"}:
            detail = "PostgreSQL destination schema or permissions do not match POSTGRES.md; provision the table and grant INSERT plus SELECT on the writable database"
        else:
            detail = "PostgreSQL could not accept the canonical event; inspect the SQLSTATE and customer destination configuration"
        # Native messages can contain a password, connection string or row values.
        # The stable SQLSTATE is sufficient for the original operator/retry flow.
        return DeliveryResult("failed", detail, receipt=error_receipt)
    except (OSError, TypeError, ValueError, OverflowError):
        return DeliveryResult("failed", "PostgreSQL destination could not encode or connect using the selected configuration", receipt=receipt)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the one-time Mercury customer PostgreSQL table migration; no connection is opened")
    parser.add_argument("--schema", default="public", help="Existing customer schema")
    parser.add_argument("--table", default="mercury_events", help="New event table")
    args = parser.parse_args()
    try:
        print(schema_sql(args.schema, args.table), end="")
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
