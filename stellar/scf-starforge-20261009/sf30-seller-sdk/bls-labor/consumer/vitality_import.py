#!/usr/bin/env python3
"""Import acquired BLS bytes through the selected original Vitality catalogue."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import importlib
import json
from pathlib import Path
import sys

from bls_delivery import BlsDeliveryError, receive_existing as receive, source_arguments


@dataclass(frozen=True)
class OriginalVitality:
    directory: Path
    catalogue: object
    workspace_type: type


def load_original_vitality(source_directory):
    source = Path(source_directory).expanduser().resolve()
    for name in ("source_catalog", "sources", "store", "contracts", "runtime", "nek_model"):
        existing = sys.modules.get(name)
        if existing is not None and Path(existing.__file__).resolve().parent != source:
            raise BlsDeliveryError("VITALITY_IMPORT_CONFLICT", module=name)
    if not all((source / name).is_file() for name in
               ("source_catalog.py", "sources.py", "store.py", "contracts.py")):
        raise BlsDeliveryError("ORIGINAL_VITALITY_SOURCE_REQUIRED")
    sys.path.insert(0, str(source))
    catalogue = importlib.import_module("source_catalog")
    store = importlib.import_module("store")
    for module in (catalogue, store, sys.modules["sources"], sys.modules["contracts"]):
        if Path(module.__file__).resolve().parent != source:
            raise BlsDeliveryError("VITALITY_IMPORT_CONFLICT", module=module.__name__)
    if not callable(getattr(catalogue, "load_entry", None)) or not callable(getattr(store, "Workspace", None)):
        raise BlsDeliveryError("ORIGINAL_VITALITY_SOURCE_REQUIRED")
    return OriginalVitality(source, catalogue, store.Workspace)


def _selected(received, original, catalog, only):
    if only is not None and (
        not isinstance(only, (list, tuple)) or not only
        or any(not isinstance(key, str) or not key for key in only)
        or len(set(only)) != len(only)
    ):
        raise BlsDeliveryError("VITALITY_CATALOG_SELECTION_REQUIRED")
    keys = list(only) if only is not None else received.manifest.get("catalog_keys")
    if not keys:
        raise BlsDeliveryError("VITALITY_CATALOG_SELECTION_REQUIRED")
    entries = original.catalogue.entries(catalog, keys)
    prefix = received.manifest["source_prefix"]
    root = received.directory / prefix
    if root.resolve(strict=True) != root or not root.is_dir():
        raise BlsDeliveryError("VITALITY_SOURCE_ROOT_CHANGED")
    for entry in entries:
        if entry.get("adapter") not in ("laus", "qcew") or entry.get("prepared"):
            raise BlsDeliveryError("VITALITY_BLS_ENTRY_REQUIRED", key=entry["key"])
        paths = [entry["file"], *entry.get("definitions", {}).values(),
                 *entry.get("attachments", [])]
        for path in paths:
            received.source_path(prefix + path)
            received.source_path(prefix + path + ".capture.json")
    return entries, root


def import_received(received, original, workspace, operator, *, catalog=None, only=None):
    """Use original normalization and source-edition identity without rewriting it."""
    selected_catalog = Path(catalog).expanduser().resolve() if catalog else original.catalogue.CATALOG
    entries, root = _selected(received, original, selected_catalog, only)
    completed = []
    for entry in entries:
        try:
            envelope = original.catalogue.load_entry(root, entry, catalog=selected_catalog)
            result = workspace.import_source(envelope, operator)
            completed.append({"key": entry["key"], "result": result,
                              "scope": envelope["scope"], "issues": envelope["issues"]})
        except Exception as error:
            native = error.as_dict() if hasattr(error, "as_dict") else {
                "type": type(error).__name__, "code": getattr(error, "code", None),
                "message": str(error),
            }
            raise BlsDeliveryError("VITALITY_IMPORT_FAILED",
                completed_imports=completed, failed_key=entry["key"],
                native_error=native) from error
    return {"schema": "stellar-forge.bls-vitality-import.v1",
            "received": received.summary(), "imports": completed}


def reopen_received(received, original, workspace_directory, operator, *, catalog=None, only=None):
    """Open the original workspace and let its native import deduplication run."""
    with original.workspace_type(workspace_directory) as workspace:
        return import_received(received, original, workspace, operator,
                               catalog=catalog, only=only)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source_arguments(parser)
    parser.add_argument("--vitality-source", required=True, help="Selected original private application source")
    parser.add_argument("--workspace", required=True, help="Existing original Vitality workspace")
    parser.add_argument("--operator", required=True, help="Actual operator recorded by original workspace")
    parser.add_argument("--catalog", help="Explicit original catalogue JSON; defaults to selected application")
    parser.add_argument("--only", action="append", help="Original catalogue key; repeat for the selected sources")
    args = parser.parse_args(argv)
    try:
        received = receive(args)
        original = load_original_vitality(args.vitality_source)
        result = reopen_received(received, original, args.workspace, args.operator,
                                 catalog=args.catalog, only=args.only)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except BlsDeliveryError as error:
        print(json.dumps({"error": error.code, "details": error.details},
                         ensure_ascii=False, default=str), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

