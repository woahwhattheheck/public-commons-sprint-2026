"""Read the exact original Node accounting carrier through its maintained validators."""
from __future__ import annotations
import base64
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone

from domain import Problem, canonical, digest, amount
import native  # Establish the unchanged original SF36 module root.
from native_mcp import node_path, reader_path as original_source_path
from governor import validate_request, canonical as request_bytes

MAX_BYTES = 16_777_216
FORMAT = "stellar-forge.node-operation-accounting-inspection.v1"
FEATURE = "original-node-accounting-export-v1"
HEX = re.compile(r"[0-9a-f]{64}")
READER_FILES = (
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/operation-accounting-export.mjs",
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/operation-accounting.mjs",
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs",
    "stellar/scf-starforge-20261009/sf52-buyer-outcomes/outcomes.mjs",
    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs",
    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/verify.mjs",
    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs",
    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/networks.json",
    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/rpc-transport.mjs",
    "stellar/scf-starforge-20261009/sf43-agent-commerce/verify.mjs",
)


def original_bytes(payload):
    encoded, expected = payload.get("content_base64"), payload.get("source_sha256")
    if (not isinstance(encoded, str) or not encoded or len(encoded) > ((MAX_BYTES + 2) // 3) * 4 or
            not isinstance(expected, str) or not HEX.fullmatch(expected)):
        raise Problem("NODE_SOURCE_BYTES", "Choose the complete original Node accounting JSON and its exact SHA-256")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise Problem("NODE_SOURCE_BYTES", "The original source must retain exact base64-encoded bytes") from exc
    if (not 0 < len(raw) <= MAX_BYTES or base64.b64encode(raw).decode() != encoded or
            hashlib.sha256(raw).hexdigest() != expected):
        raise Problem("NODE_SOURCE_DIGEST", "The original export bytes differ from the reviewed SHA-256")
    return raw


def inspect_original(raw, node=None):
    root = original_source_path().parents[2]
    command = [node_path(node), str(root / READER_FILES[0])]
    completed = subprocess.run(command, input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30, check=False, env={"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"})
    if len(completed.stdout) > 24 * 1024 * 1024 or len(completed.stderr) > 1024 * 1024:
        raise Problem("NODE_SOURCE_LIMIT", "The original Node export exceeds the complete intake capacity", 422)
    if completed.returncode:
        code = "NODE_SOURCE_INVALID"
        try:
            selected = json.loads(completed.stderr.decode().splitlines()[-1]).get("code")
            if isinstance(selected, str) and re.fullmatch(r"[A-Z0-9_]{1,120}", selected):
                code = selected
        except (ValueError, UnicodeError, IndexError):
            pass
        raise Problem(code, "The original Node export did not pass its native source/result binding checks", 422)
    try:
        value = json.loads(completed.stdout)
        if (value["schema"] != FORMAT or value["sourceSha256"] != hashlib.sha256(raw).hexdigest() or
                value["sourceBytes"] != len(raw) or not HEX.fullmatch(value["sourceIdentitySha256"])):
            raise ValueError()
        return value
    except (ValueError, KeyError, TypeError) as exc:
        raise Problem("NODE_SOURCE_READER", "The original reader did not return a complete bound source", 422) from exc


def project_original(value, data_context):
    native, identity = value["native"], value["sourceIdentity"]
    result, approved = native["result"], value["approvedRequest"]
    settled = native["kind"] == "PAID_FINALIZATION" and result["outcome"] in ("FINALIZED", "IDEMPOTENT_FINALIZED")
    request = None
    proof = None
    transfer = None
    if approved is not None:
        # Use the original SF36 canonical intent contract and digest. No ledger,
        # policy, signing key, worker or RPC is opened by these pure functions.
        request = validate_request(approved)
        request_digest = hashlib.sha256(request_bytes(request)).hexdigest()
        if request_digest != native["approvedRequestSha256"]:
            raise Problem("NODE_APPROVAL_DIGEST", "The original SF36 approval digest differs from its complete request", 422)
        if settled:
            actual = str(amount(result["actual"]))
            if actual != request["max_amount"]:
                raise Problem("NODE_SETTLED_AMOUNT", "The native settled actual differs from the exact approved amount", 422)
            proof = result.get("verifiedFacts")
            if proof is not None:
                record = value["originalRecord"]
                expected = {"schema": "stellar-forge.sf36.verified-facts.v1",
                    "intentId": request["request_id"], "transaction": record["receipt"]["transaction"],
                    "network": request["network"], "asset": request["asset"], "payer": native["operator"]["payer"],
                    "recipient": request["pay_to"], "atomicAmount": request["max_amount"],
                    "request_sha256": request_digest}
                if (not isinstance(proof, dict) or any(proof.get(k) != v for k, v in expected.items()) or
                        type(proof.get("ledger")) is not int or proof["ledger"] < 1 or
                        not isinstance(proof.get("eventId"), str) or not 1 <= len(proof["eventId"]) <= 512 or
                        hashlib.sha256(request_bytes(proof)).hexdigest() != result["proof_sha256"]):
                    raise Problem("NODE_FINALITY_FACTS", "The retained SF36 finality facts do not match the original result", 422)
                transfer = digest({"network": proof["network"], "asset": proof["asset"],
                    "transaction": proof["transaction"], "event": proof["eventId"], "payer": proof["payer"],
                    "recipient": proof["recipient"], "amount": proof["atomicAmount"]})
    else:
        request_digest = value["sourceIdentitySha256"]
    source_day = datetime.fromisoformat(value["attemptCreatedAt"].replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
    observation = value["observation"]
    response = observation.get("buyer", {})
    detail = {"classification": "ORIGINAL_SF36_FINALIZED" if settled else result["outcome"],
        "native_status": result["outcome"], "data_context": data_context, "node_intent_id": value["intentId"],
        "node_command_id": value["commandId"], "node_context_sha256": value["contextSha256"],
        "node_source_sha256": value["sourceSha256"], "node_source_bytes": value["sourceBytes"],
        "node_source_identity": identity, "node_source_identity_sha256": value["sourceIdentitySha256"],
        "source_observed_at": value["sourceObservedAt"], "attempt_created_at": value["attemptCreatedAt"],
        "accounting_completed_at": native["completedAt"], "record_authority": native["recordAuthority"],
        "chain_observation": result.get("chainObservation"), "http_status": response.get("httpStatus"),
        "buyer_status": response.get("status"), "attempts": response.get("attempts"),
        "payer": native.get("operator", {}).get("payer"), "recipient": request["pay_to"] if request else None,
        "transaction": value["originalRecord"]["receipt"]["transaction"] if request else None,
        "transfer_identity": transfer, "observation": proof, "observation_sha256": result.get("proof_sha256"),
        "quoted_amount": value["originalRecord"]["requirement"]["amount"] if request else None,
        "approved_request": request, "original_operator_ledger": native.get("operator", {}).get("ledger"),
        "spending_request_sha256": request_digest if request else None,
        "spending_maximum": request["max_amount"] if request else None, "result_file": None, "result_preview": None}
    row = {"request_id": value["intentId"], "request_digest": request_digest,
        "actor": request["actor"] if request else "", "service": request["service"] if request else value["intentId"],
        "network": request["network"] if request else "", "asset": request["asset"] if request else "",
        "scheme": request["scheme"] if request else "", "amount": request["max_amount"] if request else "",
        "day": source_day, "state": "settled" if settled else "unpaid" if native["kind"] == "UNPAID_RESPONSE" else "accounting_unresolved",
        "actual": result["actual"] if settled else "", "receipt_ref": result["receipt_ref"] if settled else "",
        "proof_sha256": result["proof_sha256"] if settled else "", "settled_base_units": result["actual"] if settled else None,
        "reserved_base_units": "0", "released_capacity_base_units": "0", "age_utc_days": None,
        "source_kind": "node_operation", "native_date_basis": "Original Node producing-attempt UTC day",
        "native_detail": detail}
    stable = {k: detail[k] for k in ("data_context", "node_source_identity", "source_observed_at", "buyer_status",
        "http_status", "attempts", "payer", "recipient", "transaction", "approved_request")}
    stable["financial_state"] = row["state"]
    stable["finality"] = {k: result.get(k) for k in ("actual", "receipt_ref", "proof_sha256")}
    if not settled:
        stable["outcome"] = result["outcome"]
    row["native_context_sha256"] = digest(stable)
    portfolio = []
    if request:
        portfolio.append({"network": request["network"], "asset": request["asset"], "requests": 1,
            "pending_requests": 0, "unresolved_operations": 0 if settled else 1,
            "settled_base_units": row["actual"] if settled else "0", "accounted_base_units": row["actual"] if settled else "0",
            "reserved_base_units": "0", "released_capacity_base_units": "0"})
    return {"schema": "stellar-forge.node-operation-expense-statement.v1",
        "captured_at": native["completedAt"], "rows": [row], "portfolio": portfolio,
        "source": {"kind": "node_operation", "records": 1, "record_kind": "original Node operation",
            "journal_events": None, "last_sequence": None, "projection_sha256": digest([row]),
            "source_sha256": value["sourceSha256"], "source_bytes": value["sourceBytes"],
            "intent_id": value["intentId"], "command_id": value["commandId"], "outcome": result["outcome"]},
        "basis": "Original Node operation export, retained producing attempt/evidence, and original SF36 accounting result",
        "date_basis": "Original producing-attempt UTC day; observed response, accounting completion and operator recognition dates remain distinct",
        "notes": ["An unpaid response has no payment asset, settled amount or spending reservation.",
            "Unfinalized original outcomes stay available for review; this export contains no complete ledger balance.",
            "Only FINALIZED or IDEMPOTENT_FINALIZED original SF36 results support exact expense coding.",
            "The original ledger locator is provenance, not a physical ledger capture or spending-capacity measurement."]}


def capture_original(payload, node=None):
    raw = original_bytes(payload)
    inspected = inspect_original(raw, node)
    report = project_original(inspected, payload["data_context"])
    return {"path": "node-operation:" + inspected["sourceIdentitySha256"],
        "identity": {"kind": "node_operation", "sha256": inspected["sourceIdentitySha256"]},
        "snapshot": {"schema": FEATURE, "source_sha256": inspected["sourceSha256"], "source_bytes": len(raw),
            "content_base64": base64.b64encode(raw).decode(), "inspection": inspected},
        "report": report}
