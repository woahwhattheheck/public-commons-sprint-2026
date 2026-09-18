
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .codec import canonical_json, digest_json, loads_strict

SCHEMA = "proofline.commercial-pilot.v2"
GENERATION = "commercial-pilot-2026-09-17-readiness-truth"
ASSUMPTION_SOURCE = "BUYER_SUPPLIED_OR_OWNER_SCENARIO_INPUT"
PRICE_STATES = {"PROPOSED_NOT_ACCEPTED", "OWNER_PRICING_REQUIRED"}
DATA_CLASSES = {"NON_SENSITIVE_SYNTHETIC", "BUYER_APPROVED_NON_SECRET"}
SOURCE_READINESS_STATE = "NOT_ATTESTED_BY_COMMERCIAL_PACKET"

FALSE_AUTHORITY = {
    "approve_product": False,
    "reject_product": False,
    "production_mutation": False,
    "vendor_contact": False,
    "purchase_or_payment": False,
    "external_send": False,
    "deploy_cloud": False,
    "accept_contract": False,
    "claim_revenue": False,
    "claim_savings": False,
}

FALSE_OUTCOMES = {
    "buyer_engaged": False,
    "pilot_accepted": False,
    "live_deployed": False,
    "observed_savings": False,
    "customer_result": False,
    "revenue_received": False,
}

SOURCE_EVIDENCE = [
    {
        "capability": "deterministic_visual_change_evidence",
        "source": "proofline/vision.py",
        "truth": "SOURCE_REFERENCE_NOT_READINESS_ATTESTATION",
    },
    {
        "capability": "receipt_bound_human_review_proposals",
        "source": "proofline/agent.py",
        "truth": "REVIEW_PROPOSAL_ONLY",
    },
    {
        "capability": "conditional_idempotent_aws_contract",
        "source": "proofline/aws_contract.py",
        "truth": "SOURCE_CONTRACT_NOT_LIVE_DEPLOYMENT",
    },
]

ACCEPTANCE_CRITERIA = [
    {
        "id": "A1",
        "criterion": "For an agreed reference/inspection pair, ProofLine emits a receipt-bound evidence packet or fails closed.",
        "proof": "verify_evidence_packet returns true for the exact packet used in review.",
    },
    {
        "id": "A2",
        "criterion": "Each review proposal is bound to an evidence receipt and cannot approve/reject product or mutate production.",
        "proof": "verify_review_proposal returns true and every authority bit is false.",
    },
    {
        "id": "A3",
        "criterion": "Replaying an identical source event does not create a second ledger row in the documented AWS contract.",
        "proof": "conditional idempotency-key behavior is reproduced with the source-level fake runtime.",
    },
    {
        "id": "A4",
        "criterion": "The commercial packet never self-attests source/test/demo readiness; owner-held source/test receipts are separate evidence.",
        "proof": "source_test_demo_ready remains false and source_generation is explicitly not attested by this packet.",
    },
]

class CommercialError(ValueError):
    pass

def _int(value: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise CommercialError(f"{name} must be an integer in [{lo}, {hi}]")
    return value

def _text(value: Any, name: str, max_len: int = 160) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_len:
        raise CommercialError(f"{name} must be non-empty text <= {max_len} chars")
    value.encode("utf-8", "strict")
    return value.strip()

def _minor_cost(units: int, seconds_per_unit: int, hourly_minor: int) -> int:
    # Deliberately conservative deterministic floor: scenario arithmetic, not observed savings.
    return (units * seconds_per_unit * hourly_minor) // 3600

def _normalize_intake(intake: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(intake, dict):
        raise CommercialError("intake must be an object")
    allowed = {
        "pilot_id", "buyer_label", "buyer_is_synthetic", "site_label", "use_case",
        "reference_policy", "sample_count", "retention_days", "input_data_classification",
        "price", "assumptions",
    }
    extra = set(intake) - allowed
    if extra:
        raise CommercialError(f"unexpected intake fields: {sorted(extra)}")

    buyer_is_synthetic = intake.get("buyer_is_synthetic")
    if not isinstance(buyer_is_synthetic, bool):
        raise CommercialError("buyer_is_synthetic must be boolean")

    data_class = intake.get("input_data_classification")
    if data_class not in DATA_CLASSES:
        raise CommercialError("unsupported input_data_classification")

    price = intake.get("price")
    if not isinstance(price, dict):
        raise CommercialError("price must be an object")
    if set(price) - {"currency", "fixed_minor", "state"}:
        raise CommercialError("unexpected price fields")
    if price.get("state") not in PRICE_STATES:
        raise CommercialError("price state must remain proposed/unaccepted or owner-required")
    currency = price.get("currency")
    if currency != "USD":
        raise CommercialError("this carrier currently supports USD scenario pricing only")
    fixed_minor = price.get("fixed_minor")
    if price["state"] == "OWNER_PRICING_REQUIRED":
        if fixed_minor is not None:
            raise CommercialError("OWNER_PRICING_REQUIRED cannot carry an amount")
    else:
        _int(fixed_minor, "price.fixed_minor", 1, 100_000_000)

    assumptions = intake.get("assumptions")
    if not isinstance(assumptions, dict):
        raise CommercialError("assumptions must be an object")
    expected_assumptions = {
        "source", "units_per_period", "periods_per_year", "manual_review_seconds_per_unit",
        "loaded_labor_cost_per_hour_minor", "modeled_review_share_bps",
    }
    if set(assumptions) != expected_assumptions:
        raise CommercialError("assumptions must contain exactly the documented scenario inputs")
    if assumptions.get("source") != ASSUMPTION_SOURCE:
        raise CommercialError("ROI inputs must be buyer/owner supplied scenario assumptions")

    normalized = {
        "pilot_id": _text(intake.get("pilot_id"), "pilot_id", 80),
        "buyer_label": _text(intake.get("buyer_label"), "buyer_label", 120),
        "buyer_is_synthetic": buyer_is_synthetic,
        "site_label": _text(intake.get("site_label"), "site_label", 120),
        "use_case": _text(intake.get("use_case"), "use_case", 240),
        "reference_policy": _text(intake.get("reference_policy"), "reference_policy", 240),
        "sample_count": _int(intake.get("sample_count"), "sample_count", 2, 10_000),
        "retention_days": _int(intake.get("retention_days"), "retention_days", 0, 3650),
        "input_data_classification": data_class,
        "price": {
            "currency": "USD",
            "fixed_minor": fixed_minor,
            "state": price["state"],
            "payment_link": None,
        },
        "assumptions": {
            "source": ASSUMPTION_SOURCE,
            "units_per_period": _int(assumptions["units_per_period"], "units_per_period", 1, 100_000_000),
            "periods_per_year": _int(assumptions["periods_per_year"], "periods_per_year", 1, 366),
            "manual_review_seconds_per_unit": _int(
                assumptions["manual_review_seconds_per_unit"],
                "manual_review_seconds_per_unit", 1, 86_400
            ),
            "loaded_labor_cost_per_hour_minor": _int(
                assumptions["loaded_labor_cost_per_hour_minor"],
                "loaded_labor_cost_per_hour_minor", 1, 100_000_000
            ),
            "modeled_review_share_bps": _int(
                assumptions["modeled_review_share_bps"], "modeled_review_share_bps", 0, 10_000
            ),
        },
    }
    return normalized

def _roi_scenario(assumptions: dict[str, Any]) -> dict[str, Any]:
    units = assumptions["units_per_period"]
    seconds = assumptions["manual_review_seconds_per_unit"]
    hourly = assumptions["loaded_labor_cost_per_hour_minor"]
    share = assumptions["modeled_review_share_bps"]
    periods = assumptions["periods_per_year"]

    baseline = _minor_cost(units, seconds, hourly)
    review_units = (units * share + 9_999) // 10_000
    modeled = _minor_cost(review_units, seconds, hourly)
    delta = max(0, baseline - modeled)
    return {
        "state": "USER_INPUT_SCENARIO_NOT_OBSERVED_SAVINGS",
        "currency": "USD",
        "baseline_manual_review_cost_minor_per_period": baseline,
        "modeled_scoped_review_cost_minor_per_period": modeled,
        "modeled_cost_delta_minor_per_period": delta,
        "modeled_cost_delta_minor_per_year": delta * periods,
        "observed_savings_minor": None,
        "notes": [
            "All inputs are buyer-supplied or owner scenario assumptions.",
            "The modeled delta is not an observed saving, guarantee, quote, or accounting result.",
            "Production yield, false-positive rate, defect escape rate, and integration cost are intentionally not inferred.",
        ],
    }

def build_pilot_packet(intake: dict[str, Any]) -> dict[str, Any]:
    pilot = _normalize_intake(intake)
    packet: dict[str, Any] = {
        "schema": SCHEMA,
        "generation": GENERATION,
        "source_generation": {
            "state": SOURCE_READINESS_STATE,
            "commit": None,
            "manifest_sha256": None,
            "test_execution_receipt": None,
        },
        "source_truth": {
            "source_test_demo_ready": False,
            "live_aws_deployed": False,
            "competition_submitted": False,
            "customer_validated": False,
        },
        "pilot": pilot,
        "source_evidence": SOURCE_EVIDENCE,
        "acceptance_criteria": ACCEPTANCE_CRITERIA,
        "roi_scenario": _roi_scenario(pilot["assumptions"]),
        "commercial_claims": dict(FALSE_OUTCOMES),
        "authority": dict(FALSE_AUTHORITY),
        "case_study_state": "SYNTHETIC_ONLY" if pilot["buyer_is_synthetic"] else "BUYER_INPUT_PACKET_NOT_CUSTOMER_RESULT",
    }
    packet["receipt_sha256"] = digest_json(packet)
    if not verify_pilot_packet(packet):
        raise CommercialError("internal packet verification failed")
    return packet

def verify_pilot_packet(packet: dict[str, Any]) -> bool:
    try:
        if not isinstance(packet, dict) or packet.get("schema") != SCHEMA:
            return False
        if packet.get("generation") != GENERATION:
            return False
        receipt = packet.get("receipt_sha256")
        if not isinstance(receipt, str) or len(receipt) != 64:
            return False
        body = dict(packet)
        body.pop("receipt_sha256", None)
        if digest_json(body) != receipt:
            return False

        source_truth = body.get("source_truth")
        if body.get("source_generation") != {
            "state": SOURCE_READINESS_STATE,
            "commit": None,
            "manifest_sha256": None,
            "test_execution_receipt": None,
        }:
            return False
        if source_truth != {
            "source_test_demo_ready": False,
            "live_aws_deployed": False,
            "competition_submitted": False,
            "customer_validated": False,
        }:
            return False
        if body.get("authority") != FALSE_AUTHORITY:
            return False
        if body.get("commercial_claims") != FALSE_OUTCOMES:
            return False
        if body.get("source_evidence") != SOURCE_EVIDENCE:
            return False
        if body.get("acceptance_criteria") != ACCEPTANCE_CRITERIA:
            return False

        if not isinstance(body.get("pilot"), dict):
            return False
        if body["pilot"].get("price", {}).get("payment_link") is not None:
            return False
        pilot = _normalize_intake(_packet_for_validation(body))
        if body["pilot"] != pilot:
            return False

        expected_roi = _roi_scenario(pilot["assumptions"])
        if body.get("roi_scenario") != expected_roi:
            return False
        if expected_roi["observed_savings_minor"] is not None:
            return False

        expected_case = "SYNTHETIC_ONLY" if pilot["buyer_is_synthetic"] else "BUYER_INPUT_PACKET_NOT_CUSTOMER_RESULT"
        if body.get("case_study_state") != expected_case:
            return False
        return True
    except (CommercialError, TypeError, ValueError, UnicodeError):
        return False

def _packet_for_validation(packet: dict[str, Any]) -> dict[str, Any]:
    # Internal adapter used to revalidate normalized pilot input without weakening the public schema.
    pilot = json.loads(json.dumps(packet["pilot"]))
    pilot["price"].pop("payment_link", None)
    return pilot

def write_packet(intake_path: Path, output_path: Path) -> dict[str, Any]:
    raw = intake_path.read_bytes()
    intake = loads_strict(raw, max_bytes=250_000)
    if not isinstance(intake, dict):
        raise CommercialError("intake JSON must be an object")
    packet = build_pilot_packet(intake)
    output_path.write_bytes(canonical_json(packet) + b"\n")
    return packet

def verify_file(packet_path: Path) -> bool:
    raw = packet_path.read_bytes()
    packet = loads_strict(raw, max_bytes=500_000)
    return isinstance(packet, dict) and verify_pilot_packet(packet)

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile or verify a fail-closed ProofLine commercial pilot packet")
    sub = parser.add_subparsers(dest="command", required=True)
    p_compile = sub.add_parser("compile")
    p_compile.add_argument("intake", type=Path)
    p_compile.add_argument("output", type=Path)
    p_verify = sub.add_parser("verify")
    p_verify.add_argument("packet", type=Path)
    args = parser.parse_args(argv)

    try:
        if args.command == "compile":
            write_packet(args.intake, args.output)
            return 0
        return 0 if verify_file(args.packet) else 2
    except (OSError, CommercialError, ValueError, UnicodeError):
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
