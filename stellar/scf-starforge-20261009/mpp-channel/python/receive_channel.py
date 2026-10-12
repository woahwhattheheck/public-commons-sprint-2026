#!/usr/bin/env python3
"""Receive a complete original operating channel through the existing product."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from channel_client import ChannelClient, ChannelError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-product", required=True)
    parser.add_argument("--receiving-product", required=True)
    parser.add_argument("--channel-file", required=True, help="Complete selected original channel identity JSON")
    parser.add_argument("--handover-id", required=True, help="Original stable handover ID")
    parser.add_argument("--out", required=True, help="Private directory for the original complete handover")
    parser.add_argument("--dependency-root", required=True, help="Receiving product's exact installed native SDK")
    parser.add_argument("--node", default="node")
    parser.add_argument("--wait-ms", type=int, default=30000)
    args = parser.parse_args()
    output = Path(args.out).expanduser().resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        channel = json.loads(Path(args.channel_file).expanduser().resolve().read_text(encoding="utf-8"))
        with ChannelClient(args.source_product, node=args.node) as source, ChannelClient(args.receiving_product, node=args.node) as target:
            origin = source.identity()
            destination = target.identity()
            if (origin["workspace"], origin["createdAt"]) == (destination["workspace"], destination["createdAt"]):
                raise ChannelError("MPP_CHANNEL_RECEIVING_WORKSPACE_REQUIRED", "Select the actual different receiving workspace before exporting.")
            exported = source.invoke("export", {"channel": channel, "handoverId": args.handover_id},
                                     wait_ms=args.wait_ms)
            if exported.get("state") != "COMPLETE":
                print(json.dumps({"export": exported}, ensure_ascii=False, indent=2))
                return 2
            bundle_sha256 = exported["result"]["sha256"]
            received_file = source.receive_handover(bundle_sha256, output / (bundle_sha256 + ".json"))
            received = target.receive_channel(received_file["path"], args.dependency_root,
                                              wait_ms=args.wait_ms)
            result = {"file": received_file, "receiving": received}
            if received.get("state") == "COMPLETE":
                result["workspace"] = target.identity()
                result["channelState"] = target.state()
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if received.get("state") == "COMPLETE" else 2
    except ChannelError as error:
        print(json.dumps(error.as_dict(), ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
