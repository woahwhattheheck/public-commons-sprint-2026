#!/usr/bin/env python3
"""Pass acquired Census source bytes to the selected original Peoria assembler.

The assembler remains in its original application checkout. This example adds
no housing calculations or application state and imports no private source into
the public SDK.
"""
from __future__ import annotations

import argparse
import importlib
import json
from pathlib import Path
import sys

from census_delivery import CensusDeliveryError
from receive import receive, source_arguments


def load_original_assembler(source_directory):
    source = Path(source_directory).expanduser().resolve()
    path = source / "acs.py"
    if not path.is_file():
        raise CensusDeliveryError("ORIGINAL_PEORIA_ASSEMBLER_REQUIRED")
    for name in ("acs", "housing", "acs_contract", "acs_source", "acs_statistics",
                 "acs_places", "place_statistics"):
        existing = sys.modules.get(name)
        if existing is not None and Path(existing.__file__).resolve().parent != source:
            raise CensusDeliveryError("PEORIA_ASSEMBLER_IMPORT_CONFLICT", module=name)
    sys.path.insert(0, str(source))
    module = importlib.import_module("acs")
    if Path(module.__file__).resolve() != path or not callable(getattr(module, "assemble_bundle", None)):
        raise CensusDeliveryError("ORIGINAL_PEORIA_ASSEMBLER_REQUIRED")
    return module.assemble_bundle


def assemble_received(received, assembler, output, *, base_bundle=None,
                      base_source_directory=None, supplements=(), method_sources=()):
    """Use the native assembler's existing source, calculation and revision contract."""
    if (base_bundle is None) != (base_source_directory is None):
        raise CensusDeliveryError("PEORIA_BASE_BUNDLE_AND_SOURCE_REQUIRED_TOGETHER")
    return assembler(
        base_bundle, base_source_directory, received.native_package_bytes(), output,
        supplements=supplements,
        method_sources=[*received.method_sources(), *method_sources],
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source_arguments(parser)
    parser.add_argument("--peoria-source", required=True, help="Original private application source directory")
    parser.add_argument("--output", required=True, help="Separate original assembler output directory")
    parser.add_argument("--base-bundle")
    parser.add_argument("--base-source-directory")
    parser.add_argument("--supplement", nargs=2, action="append", default=[],
                        metavar=("BUNDLE", "SOURCE_DIRECTORY"))
    parser.add_argument("--method-source", nargs=2, action="append", default=[],
                        metavar=("METHOD_FILE", "CAPTURE_METADATA_FILE"))
    args = parser.parse_args(argv)
    try:
        received = receive(args)
        result = assemble_received(received, load_original_assembler(args.peoria_source), args.output,
            base_bundle=args.base_bundle, base_source_directory=args.base_source_directory,
            supplements=args.supplement, method_sources=args.method_source)
        print(json.dumps({"received": received.summary(),
            "assembled": {key: value for key, value in result.items() if key != "bundle"}},
            indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except CensusDeliveryError as error:
        print(json.dumps({"error": error.code, "details": error.details}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
