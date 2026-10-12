#!/usr/bin/env python3
"""MIT. Blockscout token consumption through the original durable Python buyer."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

CHECKOUT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(CHECKOUT / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"))
from stellar_forge_buyer import Buyer  # Original runtime, journals and response files.


def selection(review):
    # The original review shape is retained in full in the printed review.
    return {"intentId": review.intent_id, "configSha256": review.config_sha256,
            "bodySha256": review.body_sha256, "native": review.native}


def result_view(operation, result):
    return {"intentId": operation.intent_id, "directory": str(operation.directory),
            "status": result.status, "httpStatus": result.native.get("httpStatus"),
            "ok": result.ok, "delivery": result.delivery}


def require_token_config(operation):
    config = json.loads(operation.config_path.read_text())
    op = config["operation"]
    url = urlsplit(op["url"])
    if (op["method"] != "GET" or url.scheme != "https" or url.username or url.password or
            url.query or url.fragment or not re.fullmatch(r"/[1-9]\d{0,19}/api/v2/tokens/0x[A-Fa-f0-9]{40}", url.path) or
            op["expect"]["network"] not in ("stellar:testnet", "stellar:pubnet")):
        raise ValueError("BLOCKSCOUT_BUYER_ROUTE_INVALID")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "review", "execute", "recover", "save"):
        child = sub.add_parser(command)
        child.add_argument("--state", required=True, help="Private original Python buyer state directory")
        child.add_argument("--node", default="node", help="Existing Node executable used by the original runtime")
        if command == "prepare":
            child.add_argument("--workspace", required=True, help="Original initialized SF88 operator workspace")
        else:
            child.add_argument("--intent", required=True)
        if command == "execute":
            child.add_argument("--config-sha256", required=True, help="Exact configuration SHA displayed by review")
        if command == "save":
            child.add_argument("--out", required=True, help="New file for the original verified response")
    args = parser.parse_args(argv)
    buyer = Buyer(checkout=CHECKOUT, state_dir=args.state, node=args.node, timeout=360)
    if args.command == "prepare":
        op = buyer.from_workspace(args.workspace)
        require_token_config(op)
        review = op.review()
        value = {"directory": str(op.directory), "review": selection(review)}
    else:
        op = buyer.operation(args.intent)
        require_token_config(op)
        if args.command == "review":
            value = {"directory": str(op.directory), "review": selection(op.review())}
        elif args.command == "execute":
            review = op.review()
            if not re.fullmatch(r"[a-f0-9]{64}", args.config_sha256) or review.config_sha256 != args.config_sha256:
                raise ValueError("BLOCKSCOUT_BUYER_REVIEW_CHANGED")
            result = op.execute(review=review)
            value = result_view(op, result)
            print(json.dumps(value, indent=2))
            return 0 if result.ok else 1
        else:
            result = op.recover()
            value = result_view(op, result) if result is not None else {**op.inspect(), "status": "RESULT_NOT_AVAILABLE"}
            if args.command == "save":
                if result is None:
                    raise ValueError("BLOCKSCOUT_BUYER_RESULT_UNAVAILABLE")
                value["savedAs"] = str(result.save_as(args.out))
    print(json.dumps(value, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        code = getattr(exc, "code", None)
        if code is None and isinstance(exc, ValueError) and re.fullmatch(r"BLOCKSCOUT_[A-Z0-9_]+", str(exc)):
            code = str(exc)
        print(json.dumps({"error": code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]+", code)
                          else "BLOCKSCOUT_CUSTOMER_FAILED"}), file=sys.stderr)
        sys.exit(1)
