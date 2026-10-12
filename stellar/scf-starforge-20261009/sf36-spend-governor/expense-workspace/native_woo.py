"""Original Woo refund receiving and the exact buyer purchase projection."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess
from native_mcp import node_path, reader_path as mcp_reader
from domain import Problem, canonical, digest, amount
HEX = re.compile(r"[a-f0-9]{64}")
REFUND_READER = "stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/buyer-expense-source.mjs"


def source_root():
    return mcp_reader().parents[2]


def reader_path():
    path = source_root() / REFUND_READER
    if path.is_symlink() or not path.is_file():
        raise Problem("REFUND_READER_MISSING", "Use the installed original Woo customer refund source with this expense application", 409)
    return path


def capture_refund(directory, manifest_sha256, site_url, intake, node=None):
    source = Path(directory).expanduser()
    if not source.is_absolute() or source.is_symlink() or not source.is_dir():
        raise Problem("REFUND_DIRECTORY", "Select the absolute original customer refund handoff directory")
    if not isinstance(manifest_sha256, str) or not HEX.fullmatch(manifest_sha256):
        raise Problem("REFUND_MANIFEST", "Select its exact original manifest SHA-256")
    intake = Path(intake)
    intake.mkdir(mode=0o700, parents=True, exist_ok=True)
    result = subprocess.run([node_path(node), str(reader_path()), "--source-dir", str(source),
                             "--manifest-sha256", manifest_sha256, "--site", site_url,
                             "--intake", str(intake)],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=120, check=False)
    if result.returncode:
        raise Problem("REFUND_SOURCE_REJECTED", result.stderr.decode("utf-8", "replace")[-3000:] or "The original refund receiver rejected the selected packet", 422)
    try:
        snapshot = json.loads(result.stdout)
        if snapshot["schema"] != "stellar-forge.buyer-refund-source.v1" or snapshot["manifest_sha256"] != manifest_sha256:
            raise ValueError()
        for item in (snapshot["purchase"], snapshot["credit"]):
            amount(item["amount"])
            if not HEX.fullmatch(item["transfer_identity"]):
                raise ValueError()
        if snapshot["credit"]["original_transaction"] != snapshot["purchase"]["transaction"]:
            raise ValueError()
    except (ValueError, KeyError, TypeError) as exc:
        raise Problem("REFUND_SOURCE_FORMAT", "The original refund receiver did not return a complete purchase and credit binding", 422) from exc
    return snapshot


def purchase_row(snapshot, data_context):
    purchase = snapshot["purchase"]
    source_time = purchase.get("approved_at") or purchase["original_snapshot_at"]
    try:
        date = datetime.fromisoformat(source_time.replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
    except (ValueError, AttributeError) as exc:
        raise Problem("PURCHASE_SOURCE_DATE", "The original merchant purchase has no usable approval or observation timestamp", 422) from exc
    original = purchase["observation"]
    detail = {"classification": "ORIGINAL_WOO_PAYMENT_REVIEWED", "native_status": "RELEASED",
              "data_context": data_context, "payer": purchase["payer"], "recipient": purchase["recipient"],
              "transaction": purchase["transaction"], "transfer_identity": purchase["transfer_identity"],
              "observation": original, "observation_sha256": digest(original),
              "site_url": purchase["site_url"], "order_reference": purchase["order_reference"],
              "store_currency": purchase["currency"], "store_amount": purchase["store_amount"],
              "price_decimals": purchase["price_decimals"], "result_file": None, "result_preview": None}
    return {"request_id": "woo:" + digest(purchase["site_url"])[:16] + ":" + purchase["order_reference"],
            "request_digest": purchase["identity_sha256"], "actor": purchase["payer"],
            "service": purchase["site_url"] + " / order " + purchase["order_reference"],
            "network": purchase["network"], "asset": purchase["asset"], "scheme": "exact",
            "amount": purchase["amount"], "day": date, "state": "settled",
            "actual": purchase["amount"], "receipt_ref": purchase["network"] + "/" + purchase["transaction"],
            "proof_sha256": digest(original), "settled_base_units": purchase["amount"],
            "reserved_base_units": "0", "released_capacity_base_units": "0", "age_utc_days": None,
            "source_kind": "woo_refund", "native_date_basis": "Original Woo payment approval day" if purchase.get("approved_at") else "Original Woo snapshot observation day",
            "native_context_sha256": digest({key: detail[key] for key in ("classification", "data_context", "payer", "recipient",
                "transaction", "transfer_identity", "site_url", "order_reference", "store_currency", "store_amount", "price_decimals")}),
            "native_detail": detail}


def purchase_capture(snapshot, source, packets, linked_item=None):
    rows = [] if linked_item else [purchase_row(snapshot, source["data_context"])]
    purchase = snapshot["purchase"]
    projection = {"purchase": purchase["transfer_identity"],
                  "rows": rows, "packets": [{"id": item["id"], "manifest_sha256": item["manifest_sha256"]} for item in packets]}
    report = {"schema": "stellar-forge.woo-refund-expense-statement.v1", "captured_at": snapshot["captured_at"],
              "source": {"kind": "woo_refund", "record_kind": "original merchant purchases",
                         "records": len(rows), "journal_events": len(packets), "last_sequence": len(packets),
                         "projection_sha256": digest(projection), "refund_packets": projection["packets"]},
              "rows": rows, "portfolio": [{"network": purchase["network"], "asset": purchase["asset"],
                  "requests": len(rows), "pending_requests": 0, "settled_base_units": purchase["amount"] if rows else "0",
                  "reserved_base_units": "0", "released_capacity_base_units": "0",
                  "accounted_base_units": purchase["amount"] if rows else "0"}],
              "basis": "Original verified Woo refund handoffs and their bound original merchant payment; " + source["data_context"],
              "date_basis": "Original merchant approval or snapshot day; operator recognition and reverse-transfer dates stay separate",
              "linked_purchase_item": linked_item, "data_context": source["data_context"]}
    return {"path": source["path"], "identity": source["identity"], "snapshot": projection, "report": report}
