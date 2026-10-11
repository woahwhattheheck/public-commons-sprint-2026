#!/usr/bin/env python3
"""Original SF101 approved-order reads for the original SF30 Python merchant.

This module neither creates a payment nor grants an entitlement. The existing
receiver owns enrollment, authenticated delivery, SQLite transactions and files.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import receiver


def describe(state: str, ref: str) -> dict:
    root = receiver.require_private_dir(state)
    if not receiver.is_match(receiver.REF_RE, ref):
        raise ValueError("ORDER_REFERENCE_INVALID")
    db = receiver.connect(root)
    try:
        db.execute("BEGIN")
        row = db.execute("SELECT * FROM orders WHERE order_ref=?", (ref,)).fetchone()
        access_policy = getattr(receiver, "access_allowed", None)
        access_allowed = access_policy(db, ref) if callable(access_policy) else True
        db.execute("COMMIT")
    except Exception:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()
    if row is None:
        raise ValueError("APPROVED_ORDER_NOT_FOUND")
    data, digest = receiver.read_private_file(row["file_path"])
    if digest != row["file_sha256"] or len(data) != row["file_bytes"]:
        raise ValueError("APPROVED_ORDER_FILE_CHANGED")
    return {
        "orderReference": row["order_ref"], "routeId": row["route_id"],
        "method": row["method"], "network": row["network"],
        "amountAtomic": row["amount_atomic"], "assetDigest": row["asset_digest"],
        "recipientDigest": row["recipient_digest"] if "recipient_digest" in row.keys() else None,
        "sourceSha256": row["file_sha256"], "sourceBytes": row["file_bytes"],
        "state": row["state"], "eventId": row["event_id"],
        "accessAllowed": access_allowed,
        "createdAt": row["created_at"], "entitledAt": row["entitled_at"],
    }


def purchase(values: dict) -> dict:
    context = json.loads(os.environ["SF101_CHECKOUT_CONTEXT"])
    order = describe(context["state"], values["sf98_order"])
    if order["state"] != "PENDING":
        raise ValueError("ORDER_ALREADY_ENTITLED")
    if not order["accessAllowed"]:
        raise ValueError("ORDER_ACCESS_SUSPENDED_OR_EXPIRED")
    for key in ("routeId", "method", "network", "amountAtomic", "assetDigest"):
        if order[key] != context[key]:
            raise ValueError("APPROVED_ORDER_TERMS_CHANGED")
    if order["recipientDigest"] is not None and order["recipientDigest"] != context["recipientDigest"]:
        raise ValueError("APPROVED_ORDER_RECIPIENT_CHANGED")
    return {
        "schema": "stellar-forge.sf101.purchase-response.v1",
        "orderReference": order["orderReference"],
        "sourceSha256": order["sourceSha256"], "sourceBytes": order["sourceBytes"],
        "deliveryPath": "/deliver/" + order["orderReference"],
        "delivery": "AWAIT_AUTHENTICATED_SF98_NOTIFICATION",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Original SF101 checkout order adapter")
    parser.add_argument("action", choices=["inspect", "enroll"])
    parser.add_argument("--state", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--file")
    parser.add_argument("--claim-env", default="SF101_CLAIM_TOKEN")
    args = parser.parse_args()
    if args.action == "enroll":
        context = json.loads(os.environ["SF101_CHECKOUT_CONTEXT"])
        original = argparse.Namespace(ref=args.ref, route=context["routeId"],
            method=context["method"], network=context["network"],
            amount=context["amountAtomic"], asset_digest=context["assetDigest"],
            recipient_digest=context["recipientDigest"], file=str(Path(args.file).resolve()),
            claim_env=args.claim_env)
        receiver.enroll(original, receiver.require_private_dir(args.state))
    print(json.dumps(describe(args.state, args.ref), separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("SF101_ORDER_OPERATION_FAILED", file=sys.stderr)
        sys.exit(1)
