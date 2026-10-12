"""Original merchant adjustment exports and their native buyer projection."""
from pathlib import Path
from datetime import datetime, timezone
import json
import re
import subprocess
from native_mcp import node_path
from native_woo import source_root
from domain import Problem, digest, amount

HEX = re.compile(r"[a-f0-9]{64}")
READER = "stellar/scf-starforge-20261009/merchant-settlement-accounting/buyer-expense-source.mjs"


def capture_adjustments(source_file, source_sha256, event_id, expected_job=None, node=None):
    source = Path(source_file).expanduser()
    if not source.is_absolute() or source.is_symlink() or not source.is_file():
        raise Problem("ADJUSTMENT_FILE", "Choose the absolute original accounting-export JSON file")
    if not isinstance(source_sha256, str) or not HEX.fullmatch(source_sha256):
        raise Problem("ADJUSTMENT_SOURCE_HASH", "Use the exact original export SHA-256")
    if not isinstance(event_id, str) or not HEX.fullmatch(event_id):
        raise Problem("ADJUSTMENT_EVENT", "Select the original accounting event ID")
    if expected_job is not None and not isinstance(expected_job, dict):
        raise Problem("ADJUSTMENT_JOB_BINDING", "Use the original job ID and settlement selection")
    reader = source_root() / READER
    if reader.is_symlink() or not reader.is_file():
        raise Problem("ADJUSTMENT_READER_MISSING", "Use the original installed merchant adjustment reader", 409)
    args = [node_path(node), str(reader), "--source-file", str(source), "--source-sha256", source_sha256, "--event-id", event_id]
    if expected_job is not None:
        args += ["--expected-job", json.dumps(expected_job, separators=(",", ":"), ensure_ascii=False)]
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=False)
    if result.returncode:
        raise Problem("ADJUSTMENT_SOURCE_REJECTED",
                      result.stderr.decode("utf-8", "replace")[-3000:] or "The original adjustment reader rejected the selected receipt", 422)
    try:
        native = json.loads(result.stdout)
        if (native["schema"] != "stellar-forge.buyer-adjustment-source.v1"
                or native["source_sha256"] != source_sha256 or native["source_identity"]["event_id"] != event_id
                or not isinstance(native["credits"], list) or not isinstance(native["adjustments"], list)
                or not HEX.fullmatch(native["manifest_sha256"])):
            raise ValueError()
        purchase = native["purchase"]
        if purchase is not None:
            amount(purchase["amount"])
            if not HEX.fullmatch(purchase["transfer_identity"]):
                raise ValueError()
        for credit in native["credits"]:
            amount(credit["amount"])
            if (not purchase or not HEX.fullmatch(credit["transfer_identity"])
                    or credit["original_transaction"] != purchase["transaction"]):
                raise ValueError()
    except (ValueError, KeyError, TypeError) as exc:
        raise Problem("ADJUSTMENT_SOURCE_FORMAT", "The original source reader did not return its complete native event binding", 422) from exc
    return native


def purchase_row(native, data_context):
    p = native["purchase"]
    if p is None:
        return None
    try:
        date = datetime.fromisoformat(p["source_time"].replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
    except (ValueError, AttributeError) as exc:
        raise Problem("PURCHASE_SOURCE_DATE", "The original merchant settlement row has no usable source timestamp", 422) from exc
    proof = p["observation"]
    detail = {"classification": "ORIGINAL_ADJUSTMENT_PAYMENT_REVIEWED", "native_status": "RELEASED",
              "data_context": data_context, "payer": p["payer"], "recipient": p["recipient"],
              "transaction": p["transaction"], "transfer_identity": p["transfer_identity"],
              "observation": proof, "observation_sha256": digest(proof), "source_reference": p["source_reference"],
              "original_event": native["original_event"], "declared_job": native["receipt"].get("expected_job"),
              "merchant_quoted_value_usd": p.get("merchant_quoted_value_usd"),
              "merchant_price_basis": p.get("merchant_price_basis"), "result_file": None, "result_preview": None}
    return {"request_id": "merchant:" + p["network"] + ":" + p["event_id"],
            "request_digest": p["identity_sha256"], "actor": p["payer"],
            "service": p["route_id"] + " / " + p["source_reference"],
            "network": p["network"], "asset": p["asset"], "scheme": "exact",
            "amount": p["amount"], "day": date, "state": "settled", "actual": p["amount"],
            "receipt_ref": p["network"] + "/" + p["transaction"], "proof_sha256": digest(proof),
            "settled_base_units": p["amount"], "reserved_base_units": "0", "released_capacity_base_units": "0",
            "age_utc_days": None, "source_kind": "merchant_adjustments",
            "native_date_basis": p["native_date_basis"],
            "native_context_sha256": digest({"context": data_context, "binding": native["receipt"]["selected_event"],
                                             "payer": p["payer"], "recipient": p["recipient"],
                                             "transfer_identity": p["transfer_identity"]}),
            "native_detail": detail}


def purchase_capture(native, source, packets, linked_item=None):
    row = purchase_row(native, source["data_context"])
    rows = [row] if row and not linked_item else []
    projection = {"original_event": native["source_identity"], "rows": rows,
                  "packets": [{"id": p["id"], "manifest_sha256": p["manifest_sha256"]} for p in packets],
                  "outcomes": native["adjustments"]}
    p = native["purchase"]
    report = {"schema": "stellar-forge.adjustment-expense-statement.v1", "captured_at": native["captured_at"],
              "source": {"kind": "merchant_adjustments", "record_kind": "original merchant payment and adjustment receipts",
                         "records": len(rows), "journal_events": len(packets), "last_sequence": len(packets),
                         "projection_sha256": digest(projection), "refund_packets": projection["packets"]},
              "rows": rows,
              "portfolio": [{"network": p["network"], "asset": p["asset"], "requests": len(rows),
                              "pending_requests": 0, "settled_base_units": p["amount"] if rows else "0",
                              "reserved_base_units": "0", "released_capacity_base_units": "0",
                              "accounted_base_units": p["amount"] if rows else "0"}] if p else [],
              "basis": "Original merchant adjustment export and retained independent payment proof; " + source["data_context"],
              "date_basis": "Original settlement-event day; operator recognition and reverse-transfer/observation dates remain separate",
              "linked_purchase_item": linked_item, "data_context": source["data_context"],
              "original_adjustment_outcomes": native["adjustments"], "original_payment_status": native["payment_status"],
              "original_source": native["receipt"]}
    return {"path": source["path"], "identity": source["identity"], "snapshot": projection, "report": report}
