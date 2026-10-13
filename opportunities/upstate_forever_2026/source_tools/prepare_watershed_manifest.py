#!/usr/bin/env python3
"""Prepare a complete import edition while preserving its original received outputs."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from source_tools.watershed_source_validation import load_source_edition


def _member(directory: Path, descriptor: dict) -> tuple[str, dict]:
    name = descriptor.get("path")
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
            or Path(name).is_absolute() or any(part in ("", ".", "..") for part in name.split("/"))):
        raise ValueError("Original source members must have portable relative paths.")
    path = directory / name
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(directory):
        raise ValueError("The retained original source member is missing: " + name)
    body = path.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    if descriptor.get("sha256") != digest or (
            descriptor.get("bytes") is not None and descriptor["bytes"] != len(body)):
        raise ValueError("The retained original source identity changed: " + name)
    return name, {**descriptor, "bytes": len(body), "sha256": digest}


def prepare(directory: Path) -> dict:
    directory = directory.expanduser().resolve()
    edition = load_source_edition(directory)
    originals = [directory / name for name in ("original-sources.json", "sources.json")
                 if (directory / name).is_file()]
    if not originals:
        raise ValueError("Retain the original source manifest as original-sources.json or sources.json.")
    original_path = originals[0]
    original = original_path.read_bytes()
    if len(originals) > 1 and originals[1].read_bytes() != original:
        raise ValueError("The two original source manifest aliases have different bytes.")
    base = json.loads(original)
    if base.get("schema") != "upstate.sources/v1":
        raise ValueError("The original source manifest has an unsupported schema.")
    manifest_name = ("complete-native-sources.json" if edition["native_network"] is not None
                     else "complete-sources.json")
    target = directory / manifest_name
    prior = target if target.is_file() else directory / "complete-sources.json"
    manifest = json.loads(prior.read_bytes()) if prior.is_file() else base
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("The existing complete source manifest has an unsupported schema.")
    historical_path = directory / "complete-sources.json"
    if historical_path.is_file() and historical_path != prior:
        historical = json.loads(historical_path.read_bytes())
        if historical.get("schema") != "upstate.sources/v1":
            raise ValueError("Retain the original complete source manifest schema.")
        by_id = {row["id"]: row for row in manifest["entries"]}
        for previous in historical["entries"]:
            current = by_id.get(previous["id"])
            if current is None:
                manifest["entries"].append(previous)
                by_id[previous["id"]] = previous
                continue
            if (previous["path"] != current["path"]
                    or previous["sha256"] != current["sha256"]):
                raise ValueError("Original and native editions disagree on a source entry identity.")
            joined = {row["path"]: row for row in previous.get("companions", [])}
            for row in current.get("companions", []):
                old = joined.get(row["path"])
                if old and old["sha256"] != row["sha256"]:
                    raise ValueError("Original and native editions disagree on a companion.")
                joined[row["path"]] = {**(old or {}), **row}
            metadata = {**previous.get("metadata", {}), **current.get("metadata", {})}
            merged = {**previous, **current,
                      "companions": [joined[name] for name in sorted(joined)]}
            if metadata:
                merged["metadata"] = metadata
            current.clear()
            current.update(merged)
        manifest["notes"] = list(dict.fromkeys(
            list(historical.get("notes", [])) + list(manifest.get("notes", []))))
    original_contexts = [entry for entry in base.get("entries", [])
                         if entry.get("role") == "SOURCE_WATER_CONTEXT"
                         and entry.get("path") == "full-domain-water-context.json"]
    contexts = [entry for entry in manifest.get("entries", [])
                if entry.get("role") == "SOURCE_WATER_CONTEXT"
                and entry.get("path") == "full-domain-water-context.json"]
    if len(contexts) != 1 or len(original_contexts) != 1 or contexts[0]["id"] != original_contexts[0]["id"]:
        raise ValueError("Retain the original full-domain source context entry and identity.")
    entry = contexts[0]
    # Check the entire previous edition before replacing any declaration.
    for retained in manifest["entries"]:
        _member(directory, retained)
        for companion in retained.get("companions", []):
            _member(directory, companion)
    companions = {}
    for companion in entry.get("companions", []):
        name, checked = _member(directory, companion)
        if name in companions and companions[name] != checked:
            raise ValueError("Conflicting retained companion declarations: " + name)
        companions[name] = checked
    files = {row["name"]: row for row in edition["source_files"]}
    entry["sha256"] = files[entry["path"]]["sha256"]
    for name, row in sorted(files.items()):
        if name == entry["path"]:
            continue
        path = Path(row["path"]).resolve()
        if not path.is_relative_to(directory) or path.relative_to(directory).as_posix() != name:
            raise ValueError("Place every scientific companion inside the source edition.")
        if name in companions and companions[name]["sha256"] != row["sha256"]:
            raise ValueError("A scientific companion conflicts with the retained edition: " + name)
        companions[name] = {**companions.get(name, {}), "path": name,
                            "bytes": row["bytes"], "sha256": row["sha256"]}
    original_name = original_path.name
    companions[original_name] = {
        **companions.get(original_name, {}), "path": original_name, "bytes": len(original),
        "sha256": hashlib.sha256(original).hexdigest(),
    }
    entry["companions"] = [companions[name] for name in sorted(companions)]
    if "metadata" in entry:
        entry["metadata"]["original_manifest_file"] = original_name
    if edition.get("native_network_source_reference") is not None:
        reference = dict(edition["native_network_source_reference"])
        network_rows = [row for name, row in files.items()
                        if name in ("native-network.json", "native-network.json.gz")]
        if len(network_rows) != 1:
            raise ValueError("Retain the single selected native network alongside its source reference.")
        reference["uri"] = reference.get("uri") or reference.get("source_uri")
        reference["sha256"] = network_rows[0]["sha256"]
        reference["bytes"] = network_rows[0]["bytes"]
        entry["native_network_reference"] = reference
    notes = [
        "Retains every original primary, received report, archive, alias and source companion from the complete edition.",
        "Adds the complete validated scientific companions and native network provenance without changing the original captures.",
        "Completed report inputs remain bound to their original run; a new network analysis retains its separate model-input identity.",
    ]
    manifest["notes"] = list(dict.fromkeys(list(manifest.get("notes", [])) + notes))
    manifest["derivation"] = {
        **manifest.get("derivation", {}),
        "operation_id": "ECO-WATERSHED13-20261013",
        "original_manifest": {"path": original_name, "bytes": len(original),
                              "sha256": hashlib.sha256(original).hexdigest()},
        "method": "Union validated scientific sources with every verified member of the retained complete edition.",
    }
    payload = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if not target.is_file() or target.read_bytes() != payload:
        pending = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix=".complete-sources-",
                                             delete=False) as stream:
                pending = Path(stream.name)
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pending, target)
            pending = None
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)
    return {"path": str(target), "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "context_source_id": entry["id"], "scientific_files": len(files),
            "retained_companions": len(companions), "validation": edition["validation"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source_dir), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
