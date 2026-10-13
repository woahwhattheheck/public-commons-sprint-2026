#!/usr/bin/env python3
"""Prepare the import manifest from the complete retained watershed source edition."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from source_tools.watershed_source_validation import load_source_edition


def prepare(directory: Path) -> dict:
    directory = directory.expanduser().resolve()
    edition = load_source_edition(directory)
    original_path = directory / "sources.json"
    original = original_path.read_bytes()
    manifest = json.loads(original)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("The original source manifest has an unsupported schema.")
    contexts = [entry for entry in manifest.get("entries", [])
                if entry.get("role") == "SOURCE_WATER_CONTEXT"
                and entry.get("path") == "full-domain-water-context.json"]
    if len(contexts) != 1:
        raise ValueError("Choose the original full-domain source context entry.")
    entry = contexts[0]
    files = {row["name"]: row for row in edition["source_files"]}
    primary = files[entry["path"]]
    entry["sha256"] = primary["sha256"]
    companions = []
    for name, row in sorted(files.items()):
        if name == entry["path"]:
            continue
        path = Path(row["path"]).resolve()
        if not path.is_relative_to(directory) or path.relative_to(directory).as_posix() != name:
            raise ValueError("Place every scientific companion inside the source edition.")
        companions.append({"path": name, "sha256": row["sha256"]})
    entry["companions"] = companions
    if edition.get("native_network_source_reference") is not None:
        entry["native_network_reference"] = edition["native_network_source_reference"]
    manifest["notes"] = [
        "The complete original 217-HUC12 domain, matched NRCS state rows, retained classified records and full-domain query responses are registered together.",
        "Source byte hashes preserve the original captures. Whole watershed areas and original state portions remain distinct.",
        "Optional native WBD topology retains original attributes and explicit reporting/upstream roles, with unchanged original sidecars.",
    ]
    manifest["derivation"] = {
        "operation_id": "ECO-WATERSHED13-20261013",
        "original_manifest": {"path": "sources.json", "bytes": len(original),
                              "sha256": hashlib.sha256(original).hexdigest()},
        "method": "Expand the original SOURCE_WATER_CONTEXT entry with every validated scientific source companion.",
    }
    payload = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    manifest_name = ("complete-native-sources.json" if edition["native_network"] is not None
                     else "complete-sources.json")
    target = directory / manifest_name
    target.write_bytes(payload)
    return {"path": str(target), "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "context_source_id": entry["id"], "scientific_files": len(files),
            "validation": edition["validation"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source_dir), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
