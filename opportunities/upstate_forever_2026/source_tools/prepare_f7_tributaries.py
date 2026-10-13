"""Prepare the exact F7 tributary successor using retained original source bytes.

This orchestration calls the maintained usgs_annual.prepare/bind implementation.
It never downloads NLDI, substitutes a flow-gauge basin, or modifies P9 inputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from model.common import atomic_bytes, atomic_json, digest, file_digest, held, read_json
from source_tools import usgs_annual

SOURCE_ID = "af89b23daa91db89d2abd558312ae50cf444e82c778d9832779a2ed27208f845"
ARCHIVE = {"bytes": 5287188,
           "sha256": "43868c684f747a92395ef570626a25253b517d702eb74ec2aa0eb3a68606112d"}
IMPORTER_SHA256 = "e95e60a2d1463ee9d1788928c9c78c8aea17d2a403d2d0fa58c04d8cdba72149"
BUNDLE_FILES = {
    "preparation-selection.json": {
        "bytes": 12965,
        "sha256": "380089ea4ac6ae22599a8097041906e0e765acb31d94f9ee7f1b35f1dc966994"
    },
    "retained-catchments.json": {
        "bytes": 6306,
        "sha256": "f05d1c43319c33acd1c44b82a7536921c728126565d2ff076e026237d7753df2"
    },
    "original-target-records.json": {
        "bytes": 36838,
        "sha256": "d30de5b49d45028a6b3e342ed266d68af3ccc5ca31d570ba675ff8b5aca1261e"
    }
}
DEFAULT_BUNDLE = (Path(__file__).resolve().parents[1] /
                  "source/usgs-annual-2012/upper-savannah")


def _checked(body, expected, label):
    if len(body) != expected["bytes"] or hashlib.sha256(body).hexdigest() != expected["sha256"]:
        raise ValueError("Original source identity differs: " + label)
    return body


def _json(body):
    return json.loads(body.decode("utf-8"))


def _originals(*, archive, original_root, definitions):
    if archive is not None:
        archive = Path(archive).resolve(strict=True)
        if not archive.is_file() or archive.stat().st_size != ARCHIVE["bytes"] or file_digest(archive) != ARCHIVE["sha256"]:
            raise ValueError("Select the complete original 9072 archive, 5,287,188 bytes / " + ARCHIVE["sha256"])
        with zipfile.ZipFile(archive) as opened:
            names = opened.namelist()
            if len(names) != len(set(names)):
                raise ValueError("Original archive contains duplicate member names")
            # No archive extraction or member-derived destination paths.
            bodies = {}
            for name, item in definitions.items():
                member = "original/" + name
                if member not in names or opened.getinfo(member).file_size != item["bytes"]:
                    raise ValueError("Original archive member is absent or changed: " + member)
                bodies[name] = _checked(opened.read(member), item, member)
        return bodies
    root = Path(original_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Select the actual extracted original archive directory")
    # Both the original archive root and its explicit original/ child are accepted.
    choices = [root, root / "original"]
    candidates = [candidate for candidate in choices
                  if all((candidate / name).is_file() for name in definitions)]
    if len(candidates) != 1:
        raise ValueError("Select one unambiguous original root containing the three published source files")
    return {name: _checked((candidates[0] / name).read_bytes(), item, name)
            for name, item in definitions.items()}


def _separate(path, *retained):
    for other in retained:
        if path == other or path in other.parents or other in path.parents:
            raise ValueError("Preparation and original source/Workspace paths must be separate: " + str(path))


def _admit(path, identity):
    marker = path / "source-preparation-input.json"
    if path.is_symlink():
        raise ValueError("Choose an ordinary preparation directory")
    if marker.exists():
        if read_json(marker) != identity:
            raise ValueError("Existing output belongs to another source preparation; keep it and choose a new output")
        return
    if path.exists() and any(path.iterdir()):
        raise ValueError("Unbound existing output is retained; choose a new preparation directory")
    path.mkdir(parents=True, exist_ok=True)
    atomic_json(marker, identity, immutable=True)


def _same_rows(actual, expected):
    by_id = {row["record_id"]: row for row in actual}
    if len(by_id) != len(actual):
        raise ValueError("Native source inventory contains repeated record IDs")
    for row in expected:
        if by_id.get(row["record_id"]) != row:
            raise ValueError("Current native inventory differs from the complete original target row: " + row["record_id"])
    return by_id


def operate(*, output, bundle=DEFAULT_BUNDLE, archive=None, original_root=None,
            staging_root=None, workspace=None):
    if (archive is None) == (original_root is None):
        raise ValueError("Select exactly one complete archive or extracted original root")
    bundle = Path(bundle).resolve(strict=True)
    bodies = {name: _checked((bundle / name).read_bytes(), item, name)
              for name, item in BUNDLE_FILES.items()}
    selection = _json(bodies["preparation-selection.json"])
    provenance = _json(bodies["retained-catchments.json"])
    context = _json(bodies["original-target-records.json"])
    if selection["schema"] != usgs_annual.SELECTION_SCHEMA or selection["source_id"] != SOURCE_ID:
        raise ValueError("Select the retained F7 seven-record source selection")
    if context["source"]["id"] != SOURCE_ID or len(context["records"]) != 11:
        raise ValueError("Keep all eleven original F7 target records with their original source identity")
    if len(selection["records"]) != 7:
        raise ValueError("The retained tributary selection has exactly seven source records")
    original = _originals(archive=archive, original_root=original_root,
                          definitions=context["source"]["files"])
    nldi = {}
    for item in provenance["files"]:
        path = Path(item["bundle_path"])
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Invalid retained source path")
        nldi[item["path"]] = _checked((bundle / path).read_bytes(), item, item["bundle_path"])
    if len(nldi) != 6:
        raise ValueError("Retain all six original NLDI response bodies")
    importer = Path(usgs_annual.__file__).resolve(strict=True)
    importer_body = importer.read_bytes()
    if hashlib.sha256(importer_body).hexdigest() != IMPORTER_SHA256:
        raise ValueError("Use the retained maintained F7 importer 104e82a7; its complete current source is required")
    output = Path(output).resolve()
    staging = Path(staging_root).resolve() if staging_root else output.with_name(output.name + "-original-inputs")
    retained = [bundle, Path(archive if archive is not None else original_root).resolve(strict=True)]
    if workspace is not None:
        retained.append(Path(workspace).resolve(strict=True))
    _separate(output, staging, *retained)
    _separate(staging, *retained)
    identity = {"schema": "upstate.f7-tributary-source-preparation/v1", "source_id": SOURCE_ID,
                "bundle": BUNDLE_FILES, "source_files": context["source"]["files"],
                "importer_sha256": IMPORTER_SHA256}
    output.parent.mkdir(parents=True, exist_ok=True)
    with held(output.with_name(output.name + ".source-preparation.lock")):
        _admit(staging, identity)
        for name, body in original.items():
            atomic_bytes(staging / name, body, immutable=True)
        for name, body in nldi.items():
            atomic_bytes(staging / name, body, immutable=True)
        source = usgs_annual._source(staging)
        if source != context["source"]:
            raise ValueError("Staged original annual source edition differs")
        inventory = usgs_annual.inventory(staging)
        by_id = _same_rows(inventory["records"], context["records"])
        context_ids = {row["record_id"] for row in context["records"]}
        selected_ids = [row["record_id"] for row in selection["records"]]
        if len(set(selected_ids)) != 7 or not set(selected_ids) <= context_ids:
            raise ValueError("Select seven distinct retained original records")
        for selected in selection["records"]:
            record = by_id[selected["record_id"]]
            catchment = selected["retained_catchment"]
            if record["issues"] or catchment["source"] != "comid" or catchment["identifier"] != record["comid"]:
                raise ValueError("Retain the usable original published-reach identity")
        _admit(output, identity)
        for name, body in bodies.items():
            atomic_bytes(output / "reference-context" / name, body, immutable=True)
        atomic_bytes(output / "reference-context/usgs_annual.py", importer_body, immutable=True)
        # All context is present before native prepare builds source companions.
        result = usgs_annual.prepare(output, original_root=staging,
                                     selection_path=output / "reference-context/preparation-selection.json")
        annual = read_json(output / "annual-records.json")
        if result["records"] != 7 or result["catchments"] != 3 or [r["record_id"] for r in annual] != selected_ids:
            raise ValueError("Prepared edition differs from the retained seven-record/three-basin selection")
        for row, selected in zip(annual, selection["records"]):
            if row["catchment_id"] != selected["expected_catchment_id"]:
                raise ValueError("Original P9 reach-basin identity changed: " + row["record_id"])
            original_row = by_id[row["record_id"]]
            for key in ("value", "unit", "period_start", "period_end", "uncertainty"):
                if row[key] != original_row[key]:
                    raise ValueError("Original F7 annual field changed: " + key)
        summary = {"schema": "upstate.f7-tributary-preparation-outcome/v1",
                   "preparation_id": result["id"], "source_id": SOURCE_ID,
                   "prepared_directory": str(output), "original_inputs": str(staging),
                   "source_manifest": str(output / result["source_manifest"]),
                   "records": 7, "context_records": 11, "catchments": 3,
                   "catchment_ids": sorted({row["catchment_id"] for row in annual}),
                   "preserved_p9_preparation_id": provenance["p9_preparation_id"],
                   "source_edition": "New F7DN436B original-source preparation; P9A682GW retained unchanged"}
        if workspace is not None:
            summary["binding"] = usgs_annual.bind(workspace, output)
        return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive", type=Path, help="Exact complete original 9072 ZIP, 5,287,188 bytes")
    source.add_argument("--original-root", type=Path, help="Actual extracted original archive root or its original/ directory")
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--output", type=Path, required=True, help="New prepared source directory; resume requires the same admitted source")
    parser.add_argument("--staging-root", type=Path, help="Separate source staging directory; defaults to OUTPUT-original-inputs")
    parser.add_argument("--workspace", type=Path, help="Optionally bind this new source through the existing native Workspace import")
    args = parser.parse_args(argv)
    result = operate(output=args.output, bundle=args.bundle, archive=args.archive,
                     original_root=args.original_root, staging_root=args.staging_root,
                     workspace=args.workspace)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
