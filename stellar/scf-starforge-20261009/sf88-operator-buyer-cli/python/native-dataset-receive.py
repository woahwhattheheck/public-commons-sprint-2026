#!/usr/bin/env python3
"""Host-only receiving entry point over the original Python/Node data libraries."""
from pathlib import Path
import argparse
import json
import sys

# -I is supported: import only this selected package's own original library.
PACKAGE = Path(__file__).resolve().parent
sys.path.insert(0, str(PACKAGE))
from stellar_forge_buyer.analysis_native_delivery import open_finalized

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--room", required=True)
    parser.add_argument("--session")
    parser.add_argument("--node", required=True)
    args = parser.parse_args()
    checkout = PACKAGE.parents[3]
    _, receipt = open_finalized(checkout, args.node, args.room, session=args.session)
    print(json.dumps(receipt, ensure_ascii=False, allow_nan=False, separators=(",", ":")))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = getattr(error, "code", None)
        import re
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,120}", code):
            code = "FINALIZED_DATASET_RECEIVING_FAILED"
        print(json.dumps({"error": code}), file=sys.stderr)
        raise SystemExit(1)
