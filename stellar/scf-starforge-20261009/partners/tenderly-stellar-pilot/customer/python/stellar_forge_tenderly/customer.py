"""Tenderly customer workflows composed with the unchanged SF88 Python buyer."""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from ._storage import copy_json, encode, object_file, read, require, sha256, write_new
from .models import (MAX_BODY_BYTES, MAX_RESPONSE_BYTES, REQUEST_SCHEMA, TenderlySimulationRequest,
                     assert_body_matches, validate_expected)
from .result import TenderlyResult
from .selection import load_selection

if TYPE_CHECKING:
    from stellar_forge_buyer import Buyer, BuyerResult, Operation, Review

_BINDING_SCHEMA = "stellar-forge.tenderly-python-binding.v1"
_BINDING_FILE = "tenderly-customer.json"


def _operation_request(operation) -> tuple[dict, bytes, bytes]:
    config_bytes = read(operation.config_path, 65_536)
    from ._storage import parse
    config = parse(config_bytes)
    require(isinstance(config, dict), "ORIGINAL_CONFIGURATION_OBJECT_REQUIRED")
    request = config.get("operation")
    require(isinstance(request, dict) and request.get("intentId") == operation.intent_id
            and request.get("method") == "POST", "ORIGINAL_MERCHANT_POST_REQUIRED")
    body_path = request.get("bodyFile")
    require(isinstance(body_path, str) and Path(body_path).is_absolute(), "ORIGINAL_REQUEST_BODY_REQUIRED")
    body = read(body_path, MAX_BODY_BYTES)
    require(request.get("bodySha256") == sha256(body) and type(request.get("bodyBytes")) is int
            and request["bodyBytes"] == len(body), "ORIGINAL_REQUEST_BODY_BINDING_MISMATCH")
    return config, config_bytes, body


def _as_json_headers(headers) -> dict:
    require(isinstance(headers, dict) and all(isinstance(name, str) for name in headers),
            "ORIGINAL_REQUEST_HEADERS_INVALID")
    content_types = [(name, value) for name, value in headers.items() if name.lower() == "content-type"]
    require(len(content_types) <= 1, "DUPLICATE_CONTENT_TYPE")
    if content_types:
        value = content_types[0][1]
        require(isinstance(value, str) and value.split(";", 1)[0].lower() == "application/json",
                "MERCHANT_JSON_CONTENT_TYPE_REQUIRED")
    return dict(headers) if content_types else {**headers, "content-type": "application/json"}


def _json_headers(operation) -> None:
    config, _, _ = _operation_request(operation)
    headers = config["operation"].get("headers") or {}
    normalized = _as_json_headers(headers)
    if normalized != headers:
        operation.configure(headers=normalized)


def _selection_for(request, selection, *, url=None):
    require(isinstance(request, TenderlySimulationRequest), "TYPED_SIMULATION_REQUEST_REQUIRED")
    selected = load_selection(selection)
    if selected is not None:
        require(selected["networkId"] == request.network_id, "CUSTOMER_SELECTION_NETWORK_MISMATCH")
        require(url is None or selected["resource"] == url, "CUSTOMER_SELECTION_RESOURCE_MISMATCH")
    return selected


class TenderlyCustomer:
    """Use an original Buyer or construct one from the matching installed release."""

    def __init__(self, *, buyer: "Buyer | None" = None, checkout=None, state_dir=None,
                 node="node", environment=None, timeout=360):
        if buyer is None:
            require(checkout is not None and state_dir is not None, "ORIGINAL_BUYER_RUNTIME_AND_STATE_REQUIRED")
            from stellar_forge_buyer import Buyer
            buyer = Buyer(checkout=checkout, state_dir=state_dir, node=node,
                          environment=environment, timeout=timeout)
        else:
            require(checkout is None and state_dir is None and environment is None,
                    "CHOOSE_EXISTING_BUYER_OR_RUNTIME")
        self.buyer = buyer

    def _bind(self, operation: "Operation", request: TenderlySimulationRequest, selection=None) -> "TenderlyOperation":
        config, _, body = _operation_request(operation)
        selected = _selection_for(request, selection, url=config["operation"]["url"])
        assert_body_matches(body, request.expected)
        _json_headers(operation)
        if selected is not None:
            config, _, _ = _operation_request(operation)
            capture = config.get("responseFile") or {}
            limit = capture.get("maxBytes", MAX_RESPONSE_BYTES)
            require(type(limit) is int and limit > 0, "ORIGINAL_RESPONSE_CAPTURE_LIMIT_INVALID")
            if limit > selected["maxResponseBytes"]:
                operation.configure(max_response_bytes=selected["maxResponseBytes"])
        binding = {"schema": _BINDING_SCHEMA, "intentId": operation.intent_id,
                   "expected": request.expected, "bodySha256": sha256(body)}
        if selected is not None:
            binding["selection"] = selected
        write_new(operation.directory / _BINDING_FILE, encode(binding))
        return TenderlyOperation(operation)

    def from_config(self, config_file, *, request: TenderlySimulationRequest,
                    request_body: bytes | None = None, selection=None) -> "TenderlyOperation":
        """Adopt the existing exact POST and its operator/signer configuration."""
        config = object_file(config_file, 65_536)
        original = config.get("operation") or {}
        require(original.get("method") == "POST", "ORIGINAL_MERCHANT_POST_REQUIRED")
        selected = _selection_for(request, selection, url=original.get("url"))
        if request_body is None:
            request_body = read(original["bodyFile"], MAX_BODY_BYTES) if original.get("bodyFile") else request.to_bytes()
        assert_body_matches(request_body, request.expected)
        operation = self.buyer.from_config(config_file, body=request_body)
        return self._bind(operation, request, selected)

    def from_workspace(self, directory, *, request: TenderlySimulationRequest,
                       intent_id=None, request_body: bytes | None = None, selection=None) -> "TenderlyOperation":
        selected = _selection_for(request, selection)
        if request_body is not None:
            assert_body_matches(request_body, request.expected)
        operation = self.buyer.from_workspace(directory, intent_id=intent_id, body=request_body)
        return self._bind(operation, request, selected)

    def from_operation_handoff(self, handoff_file, *, accept: int,
                               request: TenderlySimulationRequest, selection=None) -> "TenderlyOperation":
        """Use SF88's original ticket and request importer with the selected offer."""
        selected = _selection_for(request, selection)
        operation = self.buyer.from_operation_handoff(handoff_file, accept=accept)
        return self._bind(operation, request, selected)

    def prepare(self, discovery_file, *, row: int, accept: int, intent_id: str,
                url: str | None = None, request: TenderlySimulationRequest,
                request_body: bytes | None = None, operator_profile=None, selection=None) -> "TenderlyOperation":
        selected = _selection_for(request, selection, url=url)
        url = url if url is not None else selected["resource"] if selected is not None else None
        require(isinstance(url, str) and bool(url), "EXPLICIT_MERCHANT_RESOURCE_REQUIRED")
        body = request.to_bytes() if request_body is None else request_body
        assert_body_matches(body, request.expected)
        operation = self.buyer.prepare(discovery_file, row=row, accept=accept, intent_id=intent_id,
            url=url, method="POST", body=body, headers={"content-type": "application/json"})
        if operator_profile is not None:
            operation.configure(operator_profile)
        return self._bind(operation, request, selected)

    def operation(self, intent_id: str) -> "TenderlyOperation":
        """Reopen the same permanent original attempt instead of creating another."""
        return TenderlyOperation(self.buyer.operation(intent_id))

    def list_operations(self):
        for operation in self.buyer.list_operations():
            if (operation.directory / _BINDING_FILE).is_file():
                yield TenderlyOperation(operation)


class TenderlyOperation:
    def __init__(self, operation: "Operation"):
        self.native_operation = operation
        selection = object_file(operation.directory / _BINDING_FILE)
        require(selection.get("schema") == _BINDING_SCHEMA
                and selection.get("intentId") == operation.intent_id,
                "TENDERLY_OPERATION_BINDING_INVALID")
        required = {"schema", "intentId", "expected", "bodySha256"}
        require(required <= set(selection) and set(selection) <= required | {"selection"},
                "TENDERLY_BINDING_FIELDS_INVALID")
        self._selection = copy_json(selection)
        self._selection["expected"] = validate_expected(selection.get("expected"))
        if "selection" in selection:
            self._selection["selection"] = load_selection(selection["selection"])
        self._inputs()

    @property
    def intent_id(self) -> str:
        return self.native_operation.intent_id

    @property
    def directory(self) -> Path:
        return self.native_operation.directory

    @property
    def expected(self) -> dict:
        return copy_json(self._selection["expected"])

    @property
    def selection(self) -> dict | None:
        return copy_json(self._selection.get("selection"))

    def _inputs(self):
        current = object_file(self.directory / _BINDING_FILE)
        require(current == self._selection, "TENDERLY_SELECTION_CHANGED")
        config, raw, body = _operation_request(self.native_operation)
        assert_body_matches(body, self.expected)
        require(sha256(body) == self._selection["bodySha256"], "TENDERLY_REQUEST_BYTES_CHANGED")
        selected = self._selection.get("selection")
        if selected is not None:
            require(selected["networkId"] == self.expected["networkId"]
                    and selected["resource"] == config["operation"].get("url"),
                    "TENDERLY_CUSTOMER_SELECTION_MISMATCH")
            limit = (config.get("responseFile") or {}).get("maxBytes", MAX_RESPONSE_BYTES)
            require(type(limit) is int and 0 < limit <= selected["maxResponseBytes"],
                    "TENDERLY_CUSTOMER_CAPTURE_LIMIT_CHANGED")
        return config, raw, body

    def request_document(self, *, config_sha256=None) -> dict:
        _, raw, body = self._inputs()
        fingerprint = sha256(raw)
        require(config_sha256 is None or config_sha256 == fingerprint, "ORIGINAL_RESULT_CONFIGURATION_CHANGED")
        document = {"schema": REQUEST_SCHEMA, "intentId": self.intent_id,
                    "configSha256": fingerprint, "bodySha256": sha256(body), "expected": self.expected}
        if self.selection is not None:
            document["selection"] = self.selection
        return document

    def configure(self, operator_profile=None, **options) -> "TenderlyOperation":
        """Attach original operator settings and response limits before review."""
        require(not ({"body", "multipart"} & set(options)), "RETAIN_ORIGINAL_TENDERLY_REQUEST_BYTES")
        self._inputs()
        if options.get("headers") is not None:
            options["headers"] = _as_json_headers(options["headers"])
        if self.selection is not None and options.get("max_response_bytes") is not None:
            limit = options["max_response_bytes"]
            require(type(limit) is int and 0 < limit <= self.selection["maxResponseBytes"],
                    "TENDERLY_CUSTOMER_CAPTURE_LIMIT_EXCEEDED")
        self.native_operation.configure(operator_profile, **options)
        _json_headers(self.native_operation)
        self._inputs()
        return self

    def review(self) -> "Review":
        self._inputs()
        review = self.native_operation.review()
        self.request_document(config_sha256=review.config_sha256)
        require(review.body_sha256 == self._selection["bodySha256"], "ORIGINAL_REVIEW_BODY_CHANGED")
        return review

    def saved_review(self) -> "Review":
        """Reopen SF88's own saved review for a later explicit execution command."""
        from stellar_forge_buyer import Review
        record = object_file(self.directory / "review.json", 2_097_152)
        document = self.request_document(config_sha256=record.get("configSha256"))
        require(record.get("intentId") == self.intent_id
                and record.get("bodySha256") == document["bodySha256"]
                and isinstance(record.get("native"), dict), "SAVED_ORIGINAL_REVIEW_INVALID")
        return Review(intent_id=self.intent_id, config_sha256=document["configSha256"],
            body_sha256=document["bodySha256"], native=record["native"],
            workspace_directory=record.get("nativeWorkspace"), handoff_sha256=record.get("handoffSha256"),
            file_promise=record.get("filePromise"), operation_ticket_sha256=record.get("operationTicketSha256"))

    def _evidence(self, native_result: "BuyerResult", config: dict) -> bytes | None:
        filename = native_result.native.get("evidencePath")
        evidence_directory = config.get("evidenceDir")
        if not filename or not evidence_directory:
            return None
        target = Path(filename)
        original_directory = Path(evidence_directory)
        if not target.is_absolute() or not original_directory.is_absolute():
            return None
        try:
            target.resolve(strict=False).relative_to(original_directory.resolve(strict=True))
        except (ValueError, OSError):
            return None
        if target.name != sha256(self.intent_id.encode()) + ".json" or not target.exists():
            return None
        return read(target, 16_777_216)

    def consume(self, native_result: "BuyerResult") -> TenderlyResult:
        config, _, body = self._inputs()
        document = self.request_document(config_sha256=native_result.record.get("configSha256"))
        # SF31's reader verifies the actual saved file before returning its bytes.
        limit = min(MAX_RESPONSE_BYTES, self.selection["maxResponseBytes"]) if self.selection else MAX_RESPONSE_BYTES
        response = native_result.read_bytes(limit=limit)
        return TenderlyResult(response=response, request=document, request_body=body,
                              buyer_record=native_result.record,
                              buyer_evidence=self._evidence(native_result, config))

    def execute(self, *, review: "Review") -> TenderlyResult:
        self._inputs()
        native_result = self.native_operation.execute(review=review)
        return self.consume(native_result)

    def recover(self) -> TenderlyResult | None:
        """Local original recovery and saved-file reads; no new buyer or request."""
        self._inputs()
        saved = self.native_operation.recover()
        return None if saved is None else self.consume(saved)

    def inspect(self) -> dict:
        return {"intentId": self.intent_id, "expected": self.expected,
                "request": self.request_document(), "native": self.native_operation.inspect()}

    def finalize(self, **options):
        """Delegate original SF36 accounting; keep the same reservation and workspace."""
        return self.native_operation.finalize(**options)

    def recover_finalization(self):
        return self.native_operation.recover_finalization()

