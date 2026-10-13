"""Serve immutable native purchased results through Query.Farm's VGI protocol.

The original buyer warehouse owns source acquisition, typed import, query
execution, publication records and backup. This module only reads a selected
published Arrow batch and lets the vendor SDK own its protocol and state token.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import logging
import os
import re
from typing import ClassVar

import pyarrow as pa
from vgi import Worker
from vgi.catalog import Catalog, Schema, Table
from vgi.table_function import (
    TableFunctionGenerator,
    bind_fixed_schema,
    init_single_worker,
)
from vgi_rpc import ArrowSerializableDataclass
from vgi.function_storage import FunctionStorageSqlite

from ..errors import StateError

SDK_VERSION = "0.43.1"
SDK_SOURCE = "bf8b0b3902e1ff165ac413e4a216801f03ed8693"
_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,119}$")
_HEX = re.compile(r"^[a-f0-9]{64}$")


@dataclass(slots=True)
class ScanCursor(ArrowSerializableDataclass):
    """The vendor's native state codec carries the exact next retained batch."""

    publication_id: str
    batch_index: int


def _need(condition, code):
    if not condition:
        raise StateError(code)


def _principal(params, local):
    context = params.auth_context
    if local:
        _need(not context.authenticated, "VGI_LOCAL_TRANSPORT_CONTEXT_CHANGED")
        return None
    context.require_authenticated()
    _need(isinstance(context.principal, str) and bool(context.principal),
          "VGI_AUTHENTICATED_PRINCIPAL_REQUIRED")
    return context.principal


def _publication_schema(publication):
    value = publication.get("arrow_schema_base64")
    _need(isinstance(value, str), "VGI_PUBLICATION_SCHEMA_REQUIRED")
    try:
        raw = base64.b64decode(value, validate=True)
        schema = pa.ipc.read_schema(pa.BufferReader(raw))
    except (ValueError, pa.ArrowException):
        raise StateError("VGI_PUBLICATION_SCHEMA_INVALID") from None
    _need(len(schema) > 0, "VGI_PUBLICATION_SCHEMA_EMPTY")
    return schema


def _scanner(service, publication, *, local, protocol_storage):
    publication_id = publication["publication_id"]
    _need(isinstance(publication_id, str) and _HEX.fullmatch(publication_id),
          "VGI_PUBLICATION_ID_INVALID")
    schema = _publication_schema(publication)
    batches = publication.get("batches")
    _need(isinstance(batches, list), "VGI_PUBLICATION_BATCHES_REQUIRED")
    for index, item in enumerate(batches):
        _need(isinstance(item, dict) and item.get("index") == index
              and type(item.get("rows")) is int and item["rows"] > 0
              and type(item.get("bytes")) is int and item["bytes"] > 0
              and isinstance(item.get("sha256"), str)
              and _HEX.fullmatch(item["sha256"]), "VGI_PUBLICATION_BATCH_INDEX_INVALID")
    _need(sum(item["rows"] for item in batches) == publication.get("rows"),
          "VGI_PUBLICATION_ROW_COUNT_CHANGED")
    function_name = "sf_result_" + publication_id

    @init_single_worker
    @bind_fixed_schema
    class PurchasedResultScan(TableFunctionGenerator[None, ScanCursor]):
        """Read the next verified batch of one original completed publication."""

        FIXED_SCHEMA: ClassVar[pa.Schema] = schema
        # This one-process scanner retains all durable state in the original
        # warehouse and the SDK token. Its optional protocol storage is local.
        storage = protocol_storage

        class Meta:
            name = function_name
            description = "Read the retained native result publication " + publication_id
            projection_pushdown = False
            filter_pushdown = False
            sampling_pushdown = False

        @classmethod
        def initial_state(cls, params):
            principal = _principal(params, local)
            service.authorize(publication_id, principal=principal, local=local)
            return ScanCursor(publication_id=publication_id, batch_index=0)

        @classmethod
        def process(cls, params, state, out):
            _need(isinstance(state, ScanCursor)
                  and state.publication_id == publication_id
                  and type(state.batch_index) is int
                  and 0 <= state.batch_index <= len(batches),
                  "VGI_RETAINED_CURSOR_CHANGED")
            principal = _principal(params, local)
            # Recheck the current principal and table policy even on a terminal
            # turn, so retirement and revocation do not rely on a restart.
            service.authorize(publication_id, principal=principal, local=local)
            if state.batch_index == len(batches):
                out.finish()
                return
            expected = batches[state.batch_index]
            raw = service.read_batch(publication_id, state.batch_index,
                                     principal=principal, local=local)
            _need(isinstance(raw, bytes) and len(raw) == expected["bytes"]
                  and hashlib.sha256(raw).hexdigest() == expected["sha256"],
                  "VGI_RETAINED_BATCH_CHANGED")
            try:
                with pa.ipc.open_stream(pa.BufferReader(raw)) as reader:
                    _need(reader.schema.equals(schema, check_metadata=True),
                          "VGI_RETAINED_SCHEMA_CHANGED")
                    batch = reader.read_next_batch()
                    try:
                        reader.read_next_batch()
                    except StopIteration:
                        pass
                    else:
                        raise StateError("VGI_RETAINED_BATCH_COUNT_CHANGED")
            except StopIteration:
                raise StateError("VGI_RETAINED_BATCH_MISSING") from None
            _need(batch.num_rows == expected["rows"]
                  and batch.schema.equals(schema, check_metadata=True),
                  "VGI_RETAINED_BATCH_SHAPE_CHANGED")
            # No client filter or projection was accepted. The original Arrow
            # columns remain exact, and DuckDB applies its SQL above this scan.
            _need(params.output_schema.equals(schema, check_metadata=False),
                  "VGI_SCAN_OUTPUT_SCHEMA_CHANGED")
            out.emit(batch)
            # A failed emission leaves the same cursor. The SDK seals the new
            # state only after this process tick returns successfully.
            state.batch_index += 1

    return PurchasedResultScan


def build_worker(service, *, local=False, snapshot=None):
    """Build one catalog from an atomic, immutable original service snapshot.

    A running catalog keeps its selected publication IDs. A restart selects the
    latest reviewed heads; existing scans keep their original batch sequence.
    """
    selected = service.snapshot() if snapshot is None else snapshot
    _need(isinstance(selected, dict), "VGI_CATALOG_SNAPSHOT_REQUIRED")
    configuration = selected.get("configuration")
    _need(isinstance(configuration, dict), "VGI_CONFIGURATION_REQUIRED")
    name = configuration.get("catalog_name")
    _need(isinstance(name, str) and _IDENTIFIER.fullmatch(name),
          "VGI_CATALOG_NAME_INVALID")
    _need(type(selected.get("revision")) is int and selected["revision"] >= 0,
          "VGI_CATALOG_REVISION_INVALID")
    if local:
        service.authorize_service(local=True)
    publications = selected.get("retained_publications", selected.get("publications"))
    _need(isinstance(publications, list), "VGI_SNAPSHOT_PUBLICATIONS_REQUIRED")
    by_id = {row["publication_id"]: row for row in publications}
    _need(len(by_id) == len(publications), "VGI_SNAPSHOT_PUBLICATION_DUPLICATE")
    protocol_storage = FunctionStorageSqlite(":memory:")
    scanners = {publication_id: _scanner(service, row, local=local, protocol_storage=protocol_storage)
                for publication_id, row in by_id.items()}
    tables = []
    selected_tables = []
    for head in selected.get("tables", []):
        if not head.get("active"):
            continue
        table_name = head.get("name")
        _need(isinstance(table_name, str) and _IDENTIFIER.fullmatch(table_name),
              "VGI_TABLE_NAME_INVALID")
        publication = by_id.get(head.get("publication_id"))
        _need(publication is not None and publication.get("table_name") == table_name,
              "VGI_SNAPSHOT_HEAD_CHANGED")
        scanner = scanners[publication["publication_id"]]
        source = publication.get("source", {})
        comment = "Retained native result; export " + str(source.get("export_id", "")) \
                  + "; publication " + publication["publication_id"]
        tables.append(Table(name=table_name, function=scanner, comment=comment,
                            inline_bind=False, supports_time_travel=False))
        selected_tables.append({
            "name": table_name,
            "head_revision": head["head_revision"],
            "publication_id": publication["publication_id"],
            "rows": publication["rows"],
            "function_name": scanner.Meta.name,
        })
    _need(len({row["name"].casefold() for row in selected_tables}) == len(selected_tables),
          "VGI_CATALOG_TABLE_DUPLICATE")

    class PurchasedResultWorker(Worker):
        # Keep old immutable function identities available to the vendor's
        # original continuation tokens after a new head is selected or restored.
        functions = list(scanners.values())
        catalog = Catalog(
            name=name,
            default_schema="results",
            schemas=[Schema(path=["results"], tables=tables)],
            comment=configuration.get("label") or "Native purchased results",
            tags={
                "workspace_id": selected["workspace_id"],
                "service_id": selected["service_id"],
                "service_revision": str(selected["revision"]),
            },
            source_url="https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace",
        )

    descriptor = {
        "schema": "stellar-forge.vgi-catalog.v1",
        "workspace_id": selected["workspace_id"],
        "service_id": selected["service_id"],
        "revision": selected["revision"],
        "catalog_name": name,
        "tables": selected_tables,
        "sdk": {"package": "vgi-python", "version": SDK_VERSION, "source": SDK_SOURCE},
        "transport": "stdio" if local else "http",
    }
    return PurchasedResultWorker, descriptor


def create_http_app(service, *, authenticate=None, snapshot=None):
    """Use the vendor HTTP and authentication implementation without another RPC layer."""
    from vgi.serve import create_app, _resolve_authenticate, _resolve_oauth_resource_metadata

    # The vendor CLI reports malformed pairs by printing the full entry.
    # Validate that syntax at the private operator boundary before resolution.
    if authenticate is None:
        bearer = os.environ.get("VGI_BEARER_TOKENS", "")
        _need(all(not item.strip() or "=" in item.strip()
                  for item in bearer.split(",")),
              "VGI_BEARER_CONFIGURATION_INVALID")
    try:
        original_authenticate = authenticate or _resolve_authenticate()
        oauth_metadata = _resolve_oauth_resource_metadata()
    except SystemExit:
        # A CLI-style exit must become the original operator's JSON error,
        # while its current process remains available to correct configuration.
        raise StateError("VGI_AUTHENTICATION_CONFIGURATION_INVALID") from None
    _need(callable(original_authenticate), "VGI_HTTP_AUTHENTICATION_REQUIRED")
    worker, descriptor = build_worker(service, local=False, snapshot=snapshot)

    def current_access(_evidence, context):
        # The vendor applies this policy after its complete bearer/JWT/grant
        # authentication chain, including an original proxy proof gate.
        context.require_authenticated()
        try:
            service.authorize_service(principal=context.principal, local=False)
        except StateError as error:
            raise PermissionError("Current result-service access is required") from error
        return context

    app = create_app(
        worker, authenticate=original_authenticate, signing_key=service.signing_key(),
        peer_authentication_policy=current_access,
        peer_service_name=descriptor["service_id"],
        cors_origins="", describe=True, log_level=logging.WARNING,
        oauth_resource_metadata=oauth_metadata,
        max_stream_response_bytes=8 * 1024 * 1024,
        max_externalized_response_bytes=16 * 1024 * 1024,
    )
    return app, descriptor
