"""Receive an existing export and consume its original native result files."""
from __future__ import annotations

import argparse
import json

from stellar_forge_buyer.analysis_export_delivery import receive_export


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", required=True)
    parser.add_argument("--out", required=True, help="Private transfer directory")
    parser.add_argument("--launch", help="Private analysis-launch.json; optional after delivery completes")
    parser.add_argument("--copy-to", help="New private directory for a portable native copy")
    args = parser.parse_args()

    def progress(value):
        print(json.dumps({"transfer": value}))

    received = receive_export(job_id=args.job, destination=args.out,
                              launch_file=args.launch, progress=progress)
    result = received.export
    manifest = result.manifest
    print(json.dumps({"directory": str(result.directory), "rows": manifest["rowCount"],
                      "manifest_sha256": received.manifest_sha256,
                      "downloaded": received.downloaded_files, "reused": received.reused_files,
                      "network_requests": received.network_requests,
                      "resumed_files": received.resumed_files, "resumed_bytes": received.resumed_bytes}))
    if "rows.jsonl" in manifest["outputs"]:
        for index, row in enumerate(result.rows()):
            # Replace this bounded display with the application's row consumer.
            if index == 5:
                break
            print(repr(row))
    if args.copy_to:
        recipient = result.copy_to(args.copy_to)
        print(json.dumps({"recipient": str(recipient.directory), "rows": recipient.manifest["rowCount"]}))


if __name__ == "__main__":
    main()
