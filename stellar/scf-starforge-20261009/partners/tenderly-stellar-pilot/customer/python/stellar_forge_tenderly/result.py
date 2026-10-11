"""Read complete saved simulation products and exchange immutable analyst exports."""
from __future__ import annotations

from pathlib import Path
import re
import stat
from typing import Any

from ._storage import copy_json, encode, object_file, parse, private_new_directory, read, require, sha256, write_new
from .models import (EXPORT_SCHEMA, MAX_BODY_BYTES, MAX_RESPONSE_BYTES, SimulationSummary,
                     assert_body_matches, validate_request_document, validate_response)

_REQUIRED = {"response.json", "request.json", "buyer-result.json", "request.body", "simulation-request.json"}
_OPTIONAL = {"buyer-evidence.json"}
_LIMITS = {"response.json": MAX_RESPONSE_BYTES, "request.json": 262_144,
           "buyer-result.json": 16_777_216, "request.body": MAX_BODY_BYTES,
           "simulation-request.json": MAX_BODY_BYTES, "buyer-evidence.json": 16_777_216}


def _validate_evidence(value: Any, intent_id: str) -> dict:
    require(isinstance(value, dict) and value.get("schema") == "scf82.checkout-evidence.v1"
            and value.get("intentId") == intent_id, "ORIGINAL_BUYER_EVIDENCE_BINDING_INVALID")
    observation = value.get("observation")
    require(isinstance(observation, dict) and observation.get("intentId") == intent_id,
            "ORIGINAL_BUYER_OBSERVATION_BINDING_INVALID")
    return value


class TenderlyResult:
    """A delivered simulation whose native purchase outcome remains unchanged.

    A reverted simulation is a valid result. Retained bytes can also be read when
    the native buyer recorded a pending settlement or an unrecorded process exit.
    """

    def __init__(self, *, response: bytes, request: dict, request_body: bytes,
                 buyer_record: dict, buyer_evidence: bytes | None = None):
        require(isinstance(response, bytes) and 0 < len(response) <= MAX_RESPONSE_BYTES,
                "SIMULATION_RESPONSE_LIMIT")
        require(isinstance(request_body, bytes) and len(request_body) <= MAX_BODY_BYTES,
                "REQUEST_BODY_LIMIT")
        self._request = validate_request_document(request)
        if "selection" in self._request:
            require(len(response) <= self._request["selection"]["maxResponseBytes"],
                    "SELECTED_MERCHANT_RESPONSE_LIMIT_EXCEEDED")
        self._body_request = assert_body_matches(request_body, self._request["expected"])
        require(sha256(request_body) == self._request["bodySha256"], "RETAINED_REQUEST_BODY_DIGEST_MISMATCH")
        require(isinstance(buyer_record, dict), "ORIGINAL_BUYER_RECORD_REQUIRED")
        native = buyer_record.get("native")
        require(isinstance(native, dict) and native.get("mode") == "ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT"
                and native.get("intentId") == self._request["intentId"]
                and buyer_record.get("intentId") == self._request["intentId"]
                and buyer_record.get("configSha256") == self._request["configSha256"],
                "ORIGINAL_BUYER_RESULT_BINDING_MISMATCH")
        saved = native.get("responseFile")
        require(isinstance(saved, dict) and saved.get("status") == "SAVED"
                and type(saved.get("bytes")) is int and saved["bytes"] == len(response)
                and saved.get("sha256") == sha256(response), "ORIGINAL_RESPONSE_DELIVERY_BINDING_MISMATCH")
        self._envelope = parse(response)
        self.summary: SimulationSummary = validate_response(self._envelope, self._request["expected"])
        self._buyer_record = copy_json(buyer_record)
        self._response = response
        self._request_body = request_body
        self._evidence_bytes = buyer_evidence
        self._evidence = None
        if buyer_evidence is not None:
            require(isinstance(buyer_evidence, bytes) and len(buyer_evidence) <= _LIMITS["buyer-evidence.json"],
                    "ORIGINAL_EVIDENCE_LIMIT")
            self._evidence = _validate_evidence(parse(buyer_evidence), self.intent_id)

    @property
    def intent_id(self) -> str:
        return self._request["intentId"]

    @property
    def simulation_id(self) -> str:
        return self.summary.simulation_id

    @property
    def evm_transaction_hash(self) -> str | None:
        return self.summary.transaction_hash

    @property
    def simulation_succeeded(self) -> bool:
        return self.summary.status

    @property
    def request(self) -> dict:
        return copy_json(self._request)

    @property
    def request_body(self) -> bytes:
        return self._request_body

    @property
    def provider_context(self) -> dict:
        return self._body_request.provider_context()

    @property
    def response_bytes(self) -> bytes:
        return self._response

    @property
    def envelope(self) -> dict:
        """Every field of the original Tenderly response, including traces/contracts."""
        return copy_json(self._envelope)

    @property
    def simulation(self) -> dict:
        return copy_json(self._envelope["simulation"])

    @property
    def transaction(self) -> dict:
        return copy_json(self._envelope["transaction"])

    @property
    def buyer_record(self) -> dict:
        return copy_json(self._buyer_record)

    @property
    def stellar_payment(self) -> dict:
        native = self._buyer_record["native"]
        observation = (self._evidence or {}).get("observation") or {}
        buyer = observation.get("buyer")
        receipt = buyer.get("receipt") if isinstance(buyer, dict) else None
        receipt = receipt if isinstance(receipt, dict) else None
        return copy_json({"status": native.get("status"),
            "sellerReportedSettlement": native.get("sellerReportedSettlement"),
            "operatorReservation": native.get("operatorReservation"),
            "originalOutcomeReport": native.get("originalOutcomeReport"),
            "receipt": receipt, "network": receipt.get("network") if receipt else None,
            "transactionHash": receipt.get("transaction") if receipt else None,
            "chain": observation.get("chain"),
            "reconciliation": (self._evidence or {}).get("reconciliation")})

    def describe(self) -> dict:
        return {"intentId": self.intent_id, "simulation": self.summary.to_mapping(),
                "stellarPayment": self.stellar_payment,
                "response": {"bytes": len(self._response), "sha256": sha256(self._response)},
                "buyer": {key: self._buyer_record.get(key) for key in
                          ("returncode", "exitCode", "exitSignal", "runtimeError", "recovered")},
                "buyerEvidenceIncluded": self._evidence_bytes is not None}

    def export(self, directory) -> Path:
        """Write the shared Node/Python export; its completion manifest is last."""
        files = {"response.json": self._response, "request.json": encode(self._request),
                 "buyer-result.json": encode(self._buyer_record), "request.body": self._request_body,
                 "simulation-request.json": encode(self.provider_context)}
        if self._evidence_bytes is not None:
            files["buyer-evidence.json"] = self._evidence_bytes
        target = private_new_directory(directory)
        for name, data in files.items():
            write_new(target / name, data)
        manifest = {"schema": EXPORT_SCHEMA, "intentId": self.intent_id,
                    "expected": self._request["expected"], "simulation": self.summary.to_mapping(),
                    "files": {name: {"bytes": len(data), "sha256": sha256(data)} for name, data in files.items()}}
        write_new(target / "manifest.json", encode(manifest))
        return target

    @classmethod
    def open_export(cls, directory) -> "TenderlyResult":
        """Open a completed export locally, without SDK, Node, wallet, or network."""
        target = Path(directory).expanduser().absolute()
        try:
            require(stat.S_ISDIR(target.lstat().st_mode), "EXPORT_DIRECTORY_REQUIRED")
        except OSError:
            require(False, "EXPORT_DIRECTORY_UNAVAILABLE")
        manifest = object_file(target / "manifest.json", 131_072)
        require(manifest.get("schema") == EXPORT_SCHEMA, "EXPORT_SCHEMA_INVALID")
        declarations = manifest.get("files")
        require(isinstance(declarations, dict) and _REQUIRED <= set(declarations)
                and set(declarations) <= _REQUIRED | _OPTIONAL, "EXPORT_EXACT_FILE_SET_REQUIRED")
        files = {}
        for name, entry in declarations.items():
            require(isinstance(entry, dict) and set(entry) == {"bytes", "sha256"}
                    and type(entry.get("bytes")) is int and 0 <= entry["bytes"] <= _LIMITS[name]
                    and isinstance(entry.get("sha256"), str)
                    and bool(re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])), "EXPORT_FILE_BINDING_INVALID")
            content = read(target / name, _LIMITS[name])
            require(len(content) == entry["bytes"] and sha256(content) == entry["sha256"], "EXPORT_FILE_CHANGED")
            files[name] = content
        result = cls(response=files["response.json"], request=parse(files["request.json"]),
                     request_body=files["request.body"], buyer_record=parse(files["buyer-result.json"]),
                     buyer_evidence=files.get("buyer-evidence.json"))
        require(manifest.get("intentId") == result.intent_id
                and manifest.get("expected") == result.request["expected"]
                and manifest.get("simulation") == result.summary.to_mapping(), "EXPORT_SUMMARY_MISMATCH")
        require(parse(files["simulation-request.json"]) == result.provider_context,
                "EXPORTED_PROVIDER_CONTEXT_MISMATCH")
        return result

