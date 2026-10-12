#!/usr/bin/env python3
"""Reopen one original SF88 Census acquisition and restore its complete sources."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from census_delivery import CensusDeliveryError, receive_acquisition


def acquisition_for(args):
    checkout = Path(args.checkout).expanduser().resolve()
    sdk = checkout / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
    if not (sdk / "stellar_forge_buyer/datasets.py").is_file():
        raise CensusDeliveryError("ORIGINAL_SF88_PYTHON_SOURCE_REQUIRED")
    sys.path.insert(0, str(sdk))
    from stellar_forge_buyer.datasets import DatasetAcquisition
    return DatasetAcquisition(checkout=checkout, session=args.session,
                              node=args.node, timeout=args.timeout)


def source_arguments(parser):
    parser.add_argument("--checkout", required=True, help="Original repository or installed source root")
    parser.add_argument("--session", required=True, help="Existing original SF88 dataset acquisition")
    parser.add_argument("--delivery", required=True, help="Original SF100 data-room destination")
    parser.add_argument("--sources", required=True, help="New or matching restored source directory")
    parser.add_argument("--capture-id", required=True, help="Reviewed exact Census capture SHA256")
    parser.add_argument("--year", type=int, help="Expected original release year")
    parser.add_argument("--node", default="node")
    parser.add_argument("--timeout", type=int, default=360)


def receive(args):
    return receive_acquisition(acquisition_for(args), args.delivery, args.sources,
        expected_capture_id=args.capture_id, expected_year=args.year)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source_arguments(parser)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(receive(args).summary(), indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except CensusDeliveryError as error:
        print(json.dumps({"error": error.code, "details": error.details}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
