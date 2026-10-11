"""Typed Tenderly transaction inputs and views of the complete provider response."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Mapping

from ._storage import TenderlyError, copy_json, encode, parse, require

REQUEST_SCHEMA = "stellar-forge.tenderly-customer-request.v1"
EXPORT_SCHEMA = "stellar-forge.tenderly-customer-export.v1"
MAX_BODY_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_SAFE_INTEGER = 9_007_199_254_740_991
_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
_INPUT = re.compile(r"0x(?:[0-9a-fA-F]{2})*\Z")
_HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_WIRE_FIELDS = {"block_number", "transaction_index", "from", "to", "input", "gas", "value"}


def _integer(value: Any, field: str, *, minimum: int = 0) -> int:
    require(type(value) is int and minimum <= value <= MAX_SAFE_INTEGER, field + "_INTEGER_REQUIRED")
    return value


def _string(value: Any, field: str, *, limit: int = 256) -> str:
    require(isinstance(value, str) and 0 < len(value) <= limit
            and value == value.strip() and all(ord(char) >= 32 for char in value), field + "_STRING_REQUIRED")
    return value


@dataclass(frozen=True)
class TenderlySimulationRequest:
    network_id: str
    block_number: int
    transaction_index: int
    from_address: str
    to_address: str
    input: str
    gas: int
    value: str

    def __post_init__(self):
        require(isinstance(self.network_id, str) and bool(re.fullmatch(r"[1-9][0-9]{0,19}", self.network_id)), "NUMERIC_STRING_NETWORK_ID_REQUIRED")
        _integer(self.block_number, "BLOCK_NUMBER")
        _integer(self.transaction_index, "TRANSACTION_INDEX")
        require(isinstance(self.from_address, str) and bool(_ADDRESS.fullmatch(self.from_address)), "FROM_ADDRESS_INVALID")
        require(isinstance(self.to_address, str) and bool(_ADDRESS.fullmatch(self.to_address)), "TO_ADDRESS_INVALID")
        require(isinstance(self.input, str) and bool(_INPUT.fullmatch(self.input)), "INPUT_HEX_BYTES_INVALID")
        _integer(self.gas, "GAS", minimum=1)
        require(self.gas <= 1_000_000_000, "GAS_EXCEEDS_MERCHANT_CONTRACT")
        require(len(self.input) <= 2 + 2 * 262_144, "INPUT_EXCEEDS_MERCHANT_CONTRACT")
        require(isinstance(self.value, str) and bool(re.fullmatch(r"(?:0|[1-9][0-9]{0,77})", self.value))
                and int(self.value) < 1 << 256, "VALUE_UINT256_DECIMAL_STRING_REQUIRED")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any], *, network_id: str) -> "TenderlySimulationRequest":
        require(isinstance(value, Mapping), "SIMULATION_REQUEST_OBJECT_REQUIRED")
        require(set(value) == _WIRE_FIELDS, "EXACT_SEVEN_FIELD_MERCHANT_REQUEST_REQUIRED")
        return cls(network_id=network_id, block_number=value["block_number"],
                   transaction_index=value["transaction_index"], from_address=value["from"],
                   to_address=value["to"], input=value["input"], gas=value["gas"], value=value["value"])

    @classmethod
    def from_bytes(cls, body: bytes, *, network_id: str) -> "TenderlySimulationRequest":
        require(isinstance(body, bytes) and len(body) <= MAX_BODY_BYTES, "REQUEST_BODY_LIMIT")
        return cls.from_mapping(parse(body), network_id=network_id)

    def to_mapping(self) -> dict:
        return {"block_number": self.block_number, "transaction_index": self.transaction_index,
                "from": self.from_address, "to": self.to_address, "input": self.input,
                "gas": self.gas, "value": self.value}

    def provider_context(self) -> dict:
        """Execution context for analysis; the original HTTP body has seven fields."""
        return {"network_id": self.network_id, "block_number": self.block_number,
                "transaction_index": self.transaction_index, "from": self.from_address.lower(),
                "to": self.to_address.lower(), "input": self.input.lower(), "gas": self.gas, "value": self.value}

    def to_bytes(self) -> bytes:
        body = encode(self.to_mapping())
        require(len(body) <= MAX_BODY_BYTES, "REQUEST_BODY_LIMIT")
        return body

    @property
    def expected(self) -> dict:
        return {"networkId": self.network_id, "blockNumber": self.block_number,
                "transactionIndex": self.transaction_index, "from": self.from_address.lower(),
                "to": self.to_address.lower(), "input": self.input.lower(), "gas": self.gas, "value": self.value}


def validate_expected(value: Any) -> dict:
    require(isinstance(value, dict), "EXPECTED_REQUEST_PINS_REQUIRED")
    keys = {"networkId", "blockNumber", "transactionIndex", "from", "to", "input", "gas", "value"}
    require(set(value) == keys, "EXPECTED_REQUEST_FIELDS_INVALID")
    request = TenderlySimulationRequest(network_id=value["networkId"], block_number=value["blockNumber"],
        transaction_index=value["transactionIndex"], from_address=value["from"], to_address=value["to"],
        input=value["input"], gas=value["gas"], value=value["value"])
    return request.expected


def validate_request_document(value: Any) -> dict:
    require(isinstance(value, dict) and value.get("schema") == REQUEST_SCHEMA, "CUSTOMER_REQUEST_SCHEMA_INVALID")
    required = {"schema", "intentId", "configSha256", "bodySha256", "expected"}
    require(required <= set(value) and set(value) <= required | {"selection"}, "CUSTOMER_REQUEST_FIELDS_INVALID")
    require(isinstance(value.get("intentId"), str)
            and bool(re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value["intentId"])), "CUSTOMER_INTENT_INVALID")
    for name in ("configSha256", "bodySha256"):
        require(isinstance(value.get(name), str) and bool(_DIGEST.fullmatch(value[name])), "CUSTOMER_DIGEST_INVALID")
    expected = validate_expected(value["expected"])
    if "selection" in value:
        from .selection import normalize_selection
        selection = normalize_selection(value["selection"])
        require(selection["networkId"] == expected["networkId"], "CUSTOMER_SELECTION_NETWORK_MISMATCH")
    return {**copy_json(value), "expected": expected}


def assert_body_matches(body: bytes, expected: dict) -> TenderlySimulationRequest:
    expected = validate_expected(expected)
    request = TenderlySimulationRequest.from_bytes(body, network_id=expected["networkId"])
    require(request.expected == expected, "RETAINED_REQUEST_BODY_PIN_MISMATCH")
    return request


@dataclass(frozen=True)
class SimulationSummary:
    simulation_id: str
    network_id: str
    block_number: int
    transaction_index: int
    status: bool
    transaction_hash: str | None

    def to_mapping(self) -> dict:
        return {"simulationId": self.simulation_id, "networkId": self.network_id,
                "blockNumber": self.block_number, "transactionIndex": self.transaction_index,
                "status": self.status, "transactionHash": self.transaction_hash}


def validate_response(value: Any, expected: dict) -> SimulationSummary:
    expected = validate_expected(expected)
    require(isinstance(value, dict), "TENDERLY_RESPONSE_OBJECT_REQUIRED")
    require(value.get("error") is None, "TENDERLY_PROVIDER_ERROR_RESPONSE")
    simulation, transaction = value.get("simulation"), value.get("transaction")
    require(isinstance(simulation, dict) and isinstance(transaction, dict), "TENDERLY_FULL_RESPONSE_REQUIRED")
    simulation_id = _string(simulation.get("id"), "SIMULATION_ID", limit=128)
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", simulation_id)), "SIMULATION_ID_INVALID")
    network_id = _string(simulation.get("network_id"), "RESPONSE_NETWORK_ID", limit=80)
    block_number = _integer(simulation.get("block_number"), "RESPONSE_BLOCK_NUMBER")
    transaction_index = _integer(simulation.get("transaction_index"), "RESPONSE_TRANSACTION_INDEX")
    require(type(simulation.get("status")) is bool, "SIMULATION_STATUS_BOOLEAN_REQUIRED")
    require(type(transaction.get("status")) is bool and transaction["status"] == simulation["status"], "TENDERLY_TRANSACTION_STATUS_MISMATCH")
    require(network_id == expected["networkId"] and block_number == expected["blockNumber"]
            and transaction_index == expected["transactionIndex"], "TENDERLY_RESPONSE_CONTEXT_MISMATCH")
    for name in ("from", "to", "input"):
        observed = simulation.get(name)
        require(isinstance(observed, str) and observed.lower() == expected[name].lower(),
                "TENDERLY_TRANSACTION_" + name.upper() + "_MISMATCH")
    require(type(simulation.get("gas")) is int and simulation["gas"] == expected["gas"], "TENDERLY_SIMULATION_GAS_MISMATCH")
    response_value = simulation.get("value")
    require(isinstance(response_value, str) and len(response_value) <= 256
            and bool(re.fullmatch(r"(?:[0-9]+|0x[0-9a-fA-F]*)", response_value)), "TENDERLY_SIMULATION_VALUE_INVALID")
    observed_value = 0 if response_value == "0x" else int(response_value, 16 if response_value.startswith("0x") else 10)
    require(observed_value == int(expected["value"]), "TENDERLY_SIMULATION_VALUE_MISMATCH")
    for name in ("from", "to", "input"):
        if name in transaction:
            require(isinstance(transaction[name], str) and transaction[name].lower() == expected[name],
                    "TENDERLY_TRANSACTION_" + name.upper() + "_MISMATCH")
    for name, pin in (("network_id", "networkId"), ("block_number", "blockNumber"),
                      ("transaction_index", "transactionIndex"), ("gas", "gas")):
        if name in transaction:
            observed = transaction[name]
            valid_type = isinstance(observed, str) if name == "network_id" else type(observed) is int
            require(valid_type and observed == expected[pin], "TENDERLY_TRANSACTION_" + name.upper() + "_MISMATCH")
    if "value" in transaction:
        amount = transaction["value"]
        require(isinstance(amount, str) and len(amount) <= 256
                and bool(re.fullmatch(r"(?:[0-9]+|0x[0-9a-fA-F]*)", amount)), "TENDERLY_TRANSACTION_VALUE_INVALID")
        amount = 0 if amount == "0x" else int(amount, 16 if amount.startswith("0x") else 10)
        require(amount == int(expected["value"]), "TENDERLY_TRANSACTION_VALUE_MISMATCH")
    transaction_hash = transaction.get("hash")
    require(transaction_hash is None or (isinstance(transaction_hash, str)
            and bool(_HASH.fullmatch(transaction_hash))), "EVM_TRANSACTION_HASH_INVALID")
    return SimulationSummary(simulation_id, network_id, block_number, transaction_index,
                             simulation["status"], transaction_hash)

