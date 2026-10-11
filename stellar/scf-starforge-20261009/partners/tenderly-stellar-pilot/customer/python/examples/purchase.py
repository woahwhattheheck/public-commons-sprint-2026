"""Use the real prepared merchant inputs and one retained customer intent."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from stellar_forge_tenderly import TenderlyCustomer, TenderlySimulationRequest, load_selection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "execute", "recover"))
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--intent-id")
    parser.add_argument("--config")
    parser.add_argument("--request")
    parser.add_argument("--selection")
    parser.add_argument("--operator-profile")
    parser.add_argument("--export")
    args = parser.parse_args()
    customer = TenderlyCustomer(checkout=args.checkout, state_dir=args.state_dir)
    if args.action == "prepare":
        if not all((args.config, args.request, args.selection)):
            parser.error("prepare requires --config, --request, and --selection")
        selection = load_selection(args.selection)
        body = Path(args.request).read_bytes()
        request = TenderlySimulationRequest.from_bytes(body, network_id=selection["networkId"])
        operation = customer.from_config(args.config, request=request, request_body=body, selection=selection)
        if args.operator_profile:
            operation.configure(operator_profile=args.operator_profile)
        review = operation.review()
        print(json.dumps({"request": operation.request_document(), "nativeReview": review.native}, indent=2))
        return
    if not args.intent_id:
        parser.error("execute and recover require --intent-id from the prepared request")
    operation = customer.operation(args.intent_id)
    result = operation.execute(review=operation.saved_review()) if args.action == "execute" else operation.recover()
    if result is None:
        print(json.dumps({"result": None, "operation": operation.inspect()}, indent=2))
        return
    summary = result.describe()
    if args.export:
        summary["exportDirectory"] = str(result.export(args.export))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
