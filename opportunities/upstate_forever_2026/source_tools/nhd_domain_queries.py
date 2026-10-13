"""Verify the original 217-HUC source and reduce NHD inventory query area.

The historical source bank and its float CSV/plan remain unchanged. Query
geometry is rederived from the original Decimal polygon extrema. Final feature
membership is still evaluated against the original rings by the maintained
water-context receiver.
"""
from __future__ import annotations
import argparse
import csv
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path, PurePosixPath

from source_tools.original_huc12_bounds import extract, exact_json, parsed, JSON_SHA256

SOURCE_BANK_SHA256 = "338ebb7f6d7fb7d74a0e3064367206487c57b638a28268bed4af0692cc7641cc"
KEYS = ("xmin", "ymin", "xmax", "ymax")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_member(root, descriptor):
    name = descriptor["path"]
    relative = PurePosixPath(name)
    if relative.is_absolute() or not name or ".." in relative.parts:
        raise ValueError("Domain query source path must be relative")
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Domain query source escapes the retained directory")
    raw = path.read_bytes()
    if len(raw) != descriptor["bytes"] or digest(raw) != descriptor["sha256"]:
        raise ValueError("Domain query source identity differs: " + name)
    return raw


def original_members(root, descriptor):
    if (descriptor.get("schema") != "upstate.nhd-domain-query-bounds/v1"
            or descriptor.get("source_bank_sha256") != SOURCE_BANK_SHA256
            or descriptor.get("source_decoded_sha256") != JSON_SHA256):
        raise ValueError("Select the retained original 217-HUC source bank")
    members, original = {}, []
    for entry in descriptor["files"]:
        name = entry["original_path"]
        if name in members:
            raise ValueError("Duplicate original domain-bounds member")
        raw = checked_member(root, entry)
        members[name] = raw
        original.append({"path": name, "content": raw.decode("utf-8"),
                         "bytes": len(raw), "sha256": digest(raw)})
    bank = {
        "schema": "commons.source-map/1",
        "operation_id": "ECO-GEO-0D0F-DOMAIN217-NATIVE-BOUNDS",
        "edition": "original217-native3857-20261013",
        "source_decoded_sha256": JSON_SHA256, "files": original,
    }
    encoded = json.dumps(bank, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if digest(encoded) != SOURCE_BANK_SHA256:
        raise ValueError("Complete original domain-bounds bank differs")
    return members


def intersections(envelope, rows):
    pieces = []
    for row in rows:
        if (row["xmin"] <= envelope["xmax"] and row["xmax"] >= envelope["xmin"]
                and row["ymin"] <= envelope["ymax"] and row["ymax"] >= envelope["ymin"]):
            pieces.append((row["huc12"], {
                "xmin": max(row["xmin"], envelope["xmin"]),
                "ymin": max(row["ymin"], envelope["ymin"]),
                "xmax": min(row["xmax"], envelope["xmax"]),
                "ymax": min(row["ymax"], envelope["ymax"]),
            }))
    return pieces


def enclosing(pieces):
    if not pieces:
        return None
    return {key: (min if key.endswith("min") else max)(p[1][key] for p in pieces)
            for key in KEYS}


def verify_historical_plan(plan, grid, rows):
    if not isinstance(plan, list) or len(plan) != len(grid):
        raise ValueError("Original domain query plan must describe all retained grid cells")
    for tile, recorded in zip(grid, plan):
        envelope = tile["envelope"]
        pieces = intersections(envelope, rows)
        reduced = enclosing(pieces)
        if reduced is not None:
            reduced["spatialReference"] = {"wkid": 3857}
        if (recorded.get("id") != tile["id"] + "-domain217-bounds"
                or recorded.get("original_tile") != tile["id"]
                or recorded.get("original_envelope") != envelope
                or recorded.get("covered_huc12s") != [p[0] for p in pieces]
                or recorded.get("envelope") != reduced):
            raise ValueError("Historical query plan differs from its original CSV/grid")


def verify_original_grid(grid, report):
    target = [float(value) for value in report["original_summary_bounds"]]
    expected = []
    for row in range(4):
        for column in range(4):
            expected.append((
                target[0] + (target[2] - target[0]) * column / 4,
                target[1] + (target[3] - target[1]) * row / 4,
                target[2] if column == 3 else target[0] + (target[2] - target[0]) * (column + 1) / 4,
                target[3] if row == 3 else target[1] + (target[3] - target[1]) * (row + 1) / 4,
            ))
    if (len(grid) != 16 or len({tile["id"] for tile in grid}) != 16
            or [tuple(tile["envelope"][key] for key in KEYS) for tile in grid] != expected
            or any(tile["envelope"].get("spatialReference") != {"wkid": 3857} for tile in grid)):
        raise ValueError("Original grid must cover the complete retained domain envelope")


def derive_query_grid(manifest, retained, archive_path):
    """Return exact reduced scopes, complete provenance and outer source bounds."""
    descriptor = manifest["domain_query_bounds"]
    members = original_members(retained, descriptor)
    report = extract(Path(archive_path).resolve(strict=True))
    metadata = json.loads(members["domain217-native3857-bounds.json"])
    csv_raw = members["domain217-native3857-bounds.csv"]
    if (metadata["source"]["decoded_sha256"] != report["source"]["decoded"]["sha256"]
            or metadata["source"]["sha256"] != report["source"]["member"]["sha256"]
            or metadata["feature_count"] != report["feature_count"]
            or metadata["output"]["sha256"] != digest(csv_raw)
            or metadata["output"]["bytes"] != len(csv_raw)):
        raise ValueError("Original CSV metadata differs from the checked original archive")
    csv_rows = list(csv.DictReader(io.StringIO(csv_raw.decode("utf-8"))))
    native = {row["huc12"]: row for row in report["rows"]}
    if len(csv_rows) != len(native) or set(row["huc12"] for row in csv_rows) != set(native):
        raise ValueError("Original CSV must retain every unique native HUC")
    float_rows = []
    for row in csv_rows:
        source = native[row["huc12"]]
        if (str(source["object_id"]) != row["objectid"]
                or str(source["ring_count"]) != row["ring_count"]
                or str(source["vertex_count"]) != row["coordinate_count"]
                or any(float(row[key]) != float(source[key]) for key in KEYS)):
            raise ValueError("Original CSV differs from its declared native float conversion")
        float_rows.append({"huc12": row["huc12"],
                           **{key: float(row[key]) for key in KEYS}})
    plan_raw = checked_member(retained, descriptor["query_plan"])
    grid = manifest["coverage_grid"]
    verify_original_grid(grid, report)
    verify_historical_plan(json.loads(plan_raw), grid, float_rows)

    # Keep the original interior grid partitions; extend the four outer edges
    # when the original summary's historical float conversion rounded inward.
    old_outer = {key: (min if key.endswith("min") else max)(
        tile["envelope"][key] for tile in grid) for key in KEYS}
    exact_outer = {key: (min if key.endswith("min") else max)(
        Decimal(str(old_outer[key])), report["domain_bounds"][key]) for key in KEYS}
    ordered = [native[row["huc12"]] for row in csv_rows]
    effective, audit = [], []
    for tile in grid:
        envelope = {key: Decimal(str(tile["envelope"][key])) for key in KEYS}
        for key in KEYS:
            if tile["envelope"][key] == old_outer[key]:
                envelope[key] = exact_outer[key]
        pieces = intersections(envelope, ordered)
        reduced = enclosing(pieces)
        if reduced is not None:
            # A closed-boundary-only intersection is retained conservatively.
            # Real original 217-HUC data have no such degenerate cells.
            if not reduced["xmin"] < reduced["xmax"] or not reduced["ymin"] < reduced["ymax"]:
                reduced = envelope.copy()
            reduced["spatialReference"] = {"wkid": 3857}
            effective.append({"id": tile["id"] + "-domain217-exact",
                              "envelope": exact_json(reduced)})
        audit.append({"original_tile": tile["id"],
                      "covered_huc12s": [p[0] for p in pieces],
                      "envelope": reduced})
    evidence = {
        "schema": "upstate.nhd-domain-query-plan/v1",
        "source_bank_sha256": SOURCE_BANK_SHA256,
        "historical_plan_sha256": digest(plan_raw),
        "original_archive": report["source"],
        "source_feature_count": report["feature_count"],
        "source_vertex_count": report["vertex_count"],
        "coverage_grid_cells": len(grid), "query_cells": len(effective),
        "empty_cells": [row["original_tile"] for row in audit if row["envelope"] is None],
        "method": "Closed intersections of every original Decimal HUC envelope with original grid cells, then conservative per-cell enclosing rectangle. Original summary outer edges are expanded to original extrema where required.",
        "cells": audit,
    }
    return effective, evidence, tuple(exact_outer[key] for key in KEYS)


def load_domain_query_grid(manifest, retained, archive_path, root):
    grid, evidence, target = derive_query_grid(manifest, retained, archive_path)
    raw = (exact_json(evidence) + "\n").encode("utf-8")
    path = root / "domain-query-bounds" / "exact-query-plan.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != raw:
        raise ValueError("Retained exact domain query plan changed")
    path.write_bytes(raw)
    references = [str((retained / item["path"]).resolve().relative_to(root.resolve()))
                  for item in manifest["domain_query_bounds"]["files"]]
    references.append(str((retained / manifest["domain_query_bounds"]["query_plan"]["path"])
                          .resolve().relative_to(root.resolve())))
    references.append(path.resolve().relative_to(root.resolve()).as_posix())
    descriptor = {
        "path": references[-1], "bytes": len(raw), "sha256": digest(raw),
        "source_bank_sha256": SOURCE_BANK_SHA256,
        "source_feature_count": evidence["source_feature_count"],
        "query_cells": len(grid), "empty_cells": evidence["empty_cells"],
    }
    return grid, descriptor, references, target


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--retained", type=Path, required=True)
    parser.add_argument("--domain-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    grid, evidence, _ = derive_query_grid(
        json.loads(args.inventory.read_text()), args.retained, args.domain_archive)
    args.output.write_text(exact_json(evidence) + "\n", encoding="utf-8")
    print(json.dumps({"query_cells": len(grid), "empty_cells": evidence["empty_cells"],
                      "output": str(args.output), "sha256": digest(args.output.read_bytes())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
