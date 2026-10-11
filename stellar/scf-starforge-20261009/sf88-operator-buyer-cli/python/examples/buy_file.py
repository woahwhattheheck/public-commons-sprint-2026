#!/usr/bin/env python3
"""Use an existing merchant handoff and original workspace from a Python app.

Preparation, purchase, download and consumption are separate explicit actions.
The merchant file must already have been enrolled with original checkout.mjs.
"""
import argparse
import json
import sys

from stellar_forge_buyer import Buyer, BuyerError, DeliveryError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "review", "purchase", "download", "transfer", "reset-transfer", "consume", "finalize", "history"])
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--intent", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--handoff")
    parser.add_argument("--out")
    parser.add_argument("--timeout-ms", type=int, default=30000)
    parser.add_argument("--resume", action=argparse.BooleanOptionalAction, default=None)
    args = parser.parse_args()
    buyer = Buyer(checkout=args.checkout, state_dir=args.state)
    if args.action == "prepare":
        if not args.workspace or not args.handoff:
            parser.error("prepare requires --workspace and --handoff")
        operation = buyer.from_paid_file(args.handoff, workspace=args.workspace, intent_id=args.intent)
    else:
        operation = buyer.operation(args.intent)
    if args.action in ("prepare", "review", "purchase"):
        review = operation.review()
        print(json.dumps({"originalReview": review.native, "filePromise": review.file_promise,
                          "workspace": review.workspace_directory}, indent=2))
        if args.action == "purchase":
            result = operation.execute(review=review)
            print(json.dumps(result.record, indent=2))
            return 0 if result.ok else 2
    elif args.action == "download":
        delivery = operation.retrieve_file(destination=args.out, timeout_ms=args.timeout_ms, resume=args.resume)
        print(json.dumps(delivery.record, indent=2))
    elif args.action == "transfer":
        print(json.dumps(operation.inspect_file_transfer(destination=args.out).record, indent=2))
    elif args.action == "reset-transfer":
        print(json.dumps(operation.reset_file_transfer(destination=args.out).record, indent=2))
    elif args.action == "finalize":
        accounting = operation.finalize()
        print(json.dumps(accounting.record, indent=2))
        return 0 if accounting.finalized else 2
    elif args.action == "history":
        print(json.dumps(operation.inspect(), indent=2))
    else:
        delivery = operation.recover_file()
        if delivery is None:
            print(json.dumps(operation.inspect(), indent=2))
            return 2
        # Consume the merchant's actual CSV through the verified same descriptor.
        # Replace this accumulation with the application's own import operation.
        count, columns = 0, None
        for row in delivery.csv_rows():
            count += 1
            if columns is None:
                columns = list(row)
        print(json.dumps({"rows": count, "columns": columns or [],
            "sourceSha256": delivery.delivery["sha256"], "sourceBytes": delivery.delivery["bytes"],
            "localConsumption": True}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuyerError as error:
        result = {"error": error.code, "operationDirectory":
            str(error.operation.directory) if error.operation else None}
        if isinstance(error, DeliveryError):
            result.update(retainedBytes=error.retained_bytes, resumable=error.resumable,
                partialPath=error.partial_path, transferState=error.transfer_state_path)
        print(json.dumps(result), file=sys.stderr)
        raise SystemExit(1)
