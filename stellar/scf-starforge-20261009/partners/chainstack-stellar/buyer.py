#!/usr/bin/env python3
"""MIT. Import exact prepared requests through the original SF88 Python Buyer."""
import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile


def read(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1048576:
        raise ValueError("CHAINSTACK_REQUEST_FILE_INVALID")
    raw = path.read_bytes()
    if len(raw) > 1048576:
        raise ValueError("CHAINSTACK_REQUEST_FILE_INVALID")
    return raw


def save(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as file:
        json.dump(value, file, indent=2)
        file.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["review", "execute", "recover", "inspect"])
    parser.add_argument("--checkout", required=True, help="Complete original public-commons-sprint-2026 checkout")
    parser.add_argument("--state", required=True)
    parser.add_argument("--request")
    parser.add_argument("--intent")
    parser.add_argument("--review-file")
    parser.add_argument("--profile")
    parser.add_argument("--output")
    args = parser.parse_args()
    checkout = Path(args.checkout).resolve()
    runtime = checkout / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli"
    sys.path.insert(0, str(runtime / "python"))
    from stellar_forge_buyer import Buyer, Review
    buyer = Buyer(checkout=checkout, state_dir=Path(args.state).resolve())
    if args.command == "review":
        if not args.request or not args.review_file or args.intent or args.output:
            parser.error("review requires --request and --review-file")
        folder = Path(args.request).resolve()
        manifest = json.loads(read(folder / "request.json"))
        if (manifest.get("schema") != "stellar-forge.chainstack-request.v1"
                or manifest.get("bodyFile") != "request.body.json" or manifest.get("configFile") != "buyer-config.json"):
            raise ValueError("CHAINSTACK_REQUEST_MANIFEST_INVALID")
        body, raw_config = read(folder / manifest["bodyFile"]), read(folder / manifest["configFile"])
        for name, raw in (("body", body), ("config", raw_config)):
            if len(raw) != manifest[name + "Bytes"] or hashlib.sha256(raw).hexdigest() != manifest[name + "Sha256"]:
                raise ValueError("CHAINSTACK_REQUEST_CHANGED")
        config = json.loads(raw_config)
        if config["operation"]["intentId"] != manifest["intentId"]:
            raise ValueError("CHAINSTACK_REQUEST_INTENT_CHANGED")
        if args.profile:
            profile = json.loads(read(Path(args.profile).resolve()))
            if not isinstance(profile, dict) or set(profile) - {
                "operator", "signerModule", "trustedPayer", "bodyCaptureTimeoutMs", "buyerTransport", "requestTimeoutMs"
            }:
                raise ValueError("CHAINSTACK_OPERATOR_PROFILE_INVALID")
            config.update(profile)
        config["responseFile"] = {"destination": str(buyer.operation(manifest["intentId"]).directory / "response.bin"),
                                  "maxBytes": 1048576, "timeoutMs": 30000}
        with tempfile.TemporaryDirectory(prefix="chainstack-import-", dir=buyer.state_dir) as temporary:
            source = Path(temporary) / "config.json"
            save(source, config)
            operation = buyer.from_config(source, body=body)
        review = operation.review()
        save(Path(args.review_file).resolve(), asdict(review))
        print(json.dumps(asdict(review), indent=2))
        return
    if not args.intent or args.request or args.profile or (args.command == "execute" and not args.review_file):
        parser.error("execute, recover and inspect require the saved --intent; execute also requires --review-file")
    operation = buyer.operation(args.intent)
    if args.command == "inspect":
        print(json.dumps(operation.inspect(), indent=2))
        return
    result = (operation.execute(review=Review(**json.loads(read(Path(args.review_file).resolve()))))
              if args.command == "execute" else operation.recover())
    summary = {"intentId": args.intent, "status": result.status, "delivery": result.delivery}
    if args.output:
        summary["exported"] = str(result.save_as(Path(args.output).resolve()))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = getattr(error, "code", None) or str(error)
        print(code if code and all(c.isupper() or c.isdigit() or c == "_" for c in code)
              else "CHAINSTACK_BUYER_FAILED", file=sys.stderr)
        sys.exit(1)
