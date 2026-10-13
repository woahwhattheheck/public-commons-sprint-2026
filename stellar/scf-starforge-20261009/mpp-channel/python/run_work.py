#!/usr/bin/env python3
"""Run an actual retained channel work list and receive its original paid files."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from channel_client import ChannelClient, ChannelError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product", required=True, help="Actual running native MPP product directory")
    parser.add_argument("--work", required=True, help="Complete original stellar-forge.mpp-channel-work.v1 JSON")
    parser.add_argument("--out", required=True, help="Private receiving directory")
    parser.add_argument("--node", default="node", help="Actual Node 22+ executable")
    parser.add_argument("--wait-ms", type=int, default=30000)
    parser.add_argument("--timeout", type=float, default=600.0)
    args = parser.parse_args()
    output = Path(args.out).expanduser().resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        with ChannelClient(args.product, node=args.node) as client:
            saved = client.run_file(args.work, result_path=output / "channel-work.json",
                                    wait_ms=args.wait_ms, timeout=args.timeout)
            edition = json.loads(Path(saved["file"]["path"]).read_text(encoding="utf-8"))
            result = edition["result"]
            received = []
            for purchase in result.get("results", []):
                if not purchase.get("response"):
                    continue
                identifier = purchase["id"]
                received.append(client.receive_response(
                    identifier, output / (identifier + ".response"),
                    expected_sha256=purchase["response"]["sha256"],
                ))
            print(json.dumps({"work": saved, "responses": received}, ensure_ascii=False, indent=2))
            return 0 if result.get("state") == "COMPLETE" else 2
    except ChannelError as error:
        print(json.dumps(error.as_dict(), ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
