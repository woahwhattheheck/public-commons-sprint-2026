#!/usr/bin/env python3
"""Capture the four public RFP watersheds and run the native Community CSV workflow."""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import subprocess
import sys

APPLICATION = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APPLICATION))
sys.path.insert(0, str(APPLICATION / "source"))

from capture_upstream_network import Capture, digest, encode, exact_write
from model.workspace import Workspace

HUC12S = ("030601010703", "030601010704", "030601020502", "030601020507")


def capture_focus(output):
    """Retain the unchanged native response and its actual edition before importing."""
    capture = Capture(output)
    response = capture.get("community-four-focus-huc12", {
        "where": "huc12 IN (" + ",".join("'" + value + "'" for value in HUC12S) + ")",
        "outFields": "*", "returnGeometry": "true", "returnTrueCurves": "true",
    })
    if response.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("USGS must return native polygon features")
    fields = response.get("fields", [])
    huc_fields = [row["name"] for row in fields if row["name"].lower() == "huc12"]
    oid_fields = [row["name"] for row in fields if row["type"] == "esriFieldTypeOID"]
    if len(huc_fields) != 1 or len(oid_fields) != 1:
        raise ValueError("The current USGS response needs one HUC12 field and one native object-ID field")
    huc_field, oid_field = huc_fields[0], oid_fields[0]
    features = response.get("features", [])
    if len(features) != len(HUC12S):
        raise ValueError("USGS must return all four requested RFP watersheds exactly once")
    identities = [str(row["attributes"][huc_field]) for row in features]
    object_ids = [row["attributes"][oid_field] for row in features]
    if set(identities) != set(HUC12S) or len(set(object_ids)) != len(HUC12S):
        raise ValueError("The returned USGS identities differ from the four original RFP watersheds")
    if any(not (row.get("geometry", {}).get("rings") or row.get("geometry", {}).get("curveRings"))
           for row in features):
        raise ValueError("Each original watershed needs its complete native polygon geometry")
    crs = response.get("spatialReference", {})
    wkid = crs.get("latestWkid") or crs.get("wkid")
    if type(wkid) is not int or wkid <= 0:
        raise ValueError("The native response needs its published spatial reference")
    receipt = capture.responses["community-four-focus-huc12"]
    folder = Path(receipt["folder"])
    body_path = capture.root / folder / "body.json.gz"
    stored = body_path.read_bytes()
    decoded = gzip.decompress(stored)
    if (digest(stored) != receipt["stored_sha256"] or len(stored) != receipt["stored_bytes"]
            or digest(decoded) != receipt["sha256"] or len(decoded) != receipt["bytes"]):
        raise ValueError("The retained USGS response differs from its capture")
    source_id = ("usgs-wbd-focus-huc12-" + receipt["captured_at"][:10].replace("-", "")
                 + "-" + receipt["sha256"][:12])
    companions = []
    for filename in ("receipt.json", "wire.bin"):
        path = capture.root / folder / filename
        if path.exists():
            body = path.read_bytes()
            companions.append({"path": (folder / filename).as_posix(),
                               "bytes": len(body), "sha256": digest(body)})
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Public USGS WBD four RFP utility watersheds",
        "captured_at": receipt["captured_at"],
        "scope": {"selected_huc12": list(HUC12S), "feature_count": len(features),
                  "purpose": "Original native geometry for the Community work programme"},
        "entries": [{
            "id": source_id, "title": "USGS WBD four utility-focus HUC12s",
            "kind": "vector", "role": "FOCUS_CATCHMENTS",
            "path": (folder / "body.json.gz").as_posix(),
            "sha256": receipt["stored_sha256"], "bytes": receipt["stored_bytes"],
            "encoding": "gzip", "decoded_sha256": receipt["sha256"],
            "decoded_bytes": receipt["bytes"], "source_format": "Esri JSON",
            "source_crs": "EPSG:" + str(wkid), "uri": receipt["requested_url"],
            "vintage": receipt["captured_at"], "observed_at": receipt["captured_at"],
            "selected_huc12": list(HUC12S),
            "metadata": {"feature_count": len(features), "native_huc12_field": huc_field,
                         "native_object_id_field": oid_field,
                         "selection_method": "USGS native HUC12 attribute query for the four RFP watersheds",
                         "geometry_method": "Complete unchanged provider response; original coordinates, attributes and CRS",
                         "native_huc12": identities, "native_object_ids": object_ids},
            "companions": companions,
        }],
    }
    manifest_path = capture.root / "sources.json"
    exact_write(manifest_path, encode(manifest))
    return manifest_path, source_id


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Actual existing project, or the new project path with --create-workspace")
    parser.add_argument("--capture-output", required=True, type=Path,
                        help="Retained public USGS capture directory; reopening reuses its exact responses")
    parser.add_argument("--output", required=True, type=Path,
                        help="Directory for the actual Community CSV and saved-plan outputs")
    parser.add_argument("--create-workspace", action="store_true",
                        help="Initialize a working project at --workspace if one does not yet exist")
    parser.add_argument("--title", default="Upper Savannah Community planning workspace")
    parser.add_argument("--baseline-run")
    parser.add_argument("--scenario-run", action="append", default=[])
    args = parser.parse_args(argv)
    # Existing projects are opened before network acquisition so a mistaken path is visible.
    workspace = Workspace(args.workspace, create=args.create_workspace, title=args.title)
    manifest_path, source_id = capture_focus(args.capture_output)
    command = [
        sys.executable, str(APPLICATION / "operator/community_csv_walkthrough.py"),
        "--workspace", str(workspace.root), "--output", str(args.output.resolve()),
        "--geometry-manifest", str(manifest_path), "--geometry-source-id", source_id,
    ]
    if args.baseline_run:
        command.extend(["--baseline-run", args.baseline_run])
    for run_id in args.scenario_run:
        command.extend(["--scenario-run", run_id])
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}},
                         ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
