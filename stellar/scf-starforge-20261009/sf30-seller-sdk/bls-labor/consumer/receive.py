#!/usr/bin/env python3
"""Deliver and reconstruct an existing original SF88 BLS acquisition."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from bls_delivery import BlsDeliveryError, source_arguments, receive_existing as receive



def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source_arguments(parser)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(receive(args).summary(), indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except BlsDeliveryError as error:
        print(json.dumps({"error": error.code, "details": error.details}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

