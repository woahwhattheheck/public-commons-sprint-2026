#!/usr/bin/env python3
"""Create and revise a source-bound Community programme in a retained Workspace."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys

APPLICATION = Path(__file__).resolve().parent.parent
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model import communities
from model.common import atomic_bytes, canonical, verify_file
from model.workspace import Workspace

OPERATION = "ES-20261012-RECOVERY-SCIENCE-2329"
HUC12 = "030601010704"
UTILITY = "ARJWS"
INTERVENTION = "ARJWS-L620-RIPARIAN-REVIEW"
TABLE_SOURCE = "RFP_COMMUNITIES_2024_ACS"
TABLE_SHA = "377d4f860fb545215534070309b67e1d26135cdab1ee03a70c657107692b06e4"
WBD_SOURCE = "usgs-wbd-focus-huc12-20261012"
DOMAIN_SOURCE = "upstate-wbd-upstream-domain-20261012"
WBD_SHA = "c5e0af7bd6fb8aa72ebb7283ceae6bb694bc203ce98ef0a0e33ce200800c6806"


def retained_source(workspace, source_id, checksum, manifest):
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry["id"] == source_id and entry["body"]["sha256"] == checksum:
                path, entry = workspace.source_file(collection["id"], source_id)
                return collection, path, entry
    collection = workspace.import_sources(manifest)
    path, entry = workspace.source_file(collection["id"], source_id)
    if entry["body"]["sha256"] != checksum:
        raise ValueError("The retained source edition differs: " + source_id)
    return collection, path, entry


def retained_geometry(workspace, manifest=None, source_id=None):
    """Reuse this Workspace's original upstream domain or focus-feature edition."""
    if source_id is not None and manifest is None:
        raise ValueError("An explicit geometry source ID needs its retained manifest")
    collections = workspace.sources()
    if manifest is not None:
        selected = workspace.import_sources(manifest)
        collections = [selected]
    else:
        collections = sorted(collections, key=lambda row: (
            str(row.get("captured_at") or ""), row["id"]), reverse=True)
    for selected_id in ((source_id,) if source_id is not None else (DOMAIN_SOURCE, WBD_SOURCE)):
        for collection in collections:
            for entry in collection["entries"]:
                if entry["id"] != selected_id:
                    continue
                if (entry["kind"] != "vector" or entry.get("encoding") != "gzip"
                        or entry.get("source_format") != "Esri JSON"
                        or not entry.get("decoded_sha256") or not entry.get("source_crs")):
                    raise ValueError("The original WBD source needs its native format, CRS and decoded hash")
                if selected_id == WBD_SOURCE and entry["body"]["sha256"] != WBD_SHA:
                    continue
                path, entry = workspace.source_file(collection["id"], selected_id)
                return collection, path, entry
    if manifest is not None:
        raise ValueError("The geometry manifest needs the selected native WBD source entry")
    return retained_source(workspace, WBD_SOURCE, WBD_SHA, APPLICATION / "source/sources.json")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing retained Upper Savannah Workspace")
    parser.add_argument("--output", required=True, type=Path,
                        help="Directory for actual plan, CSV, geometry and report exports")
    parser.add_argument("--geometry-manifest", type=Path,
                        help="Original retained domain sources.json when its collection is not yet in this Workspace")
    parser.add_argument("--geometry-source-id",
                        help="Exact fresh WBD edition ID in --geometry-manifest; otherwise original domain/focus IDs are reused")
    parser.add_argument("--baseline-run", help="An actual retained baseline to bind to this programme")
    parser.add_argument("--scenario-run", action="append", default=[],
                        help="An actual compatible alternative; repeat for several alternatives")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    table_collection, original_table_path, _ = retained_source(
        workspace, TABLE_SOURCE, TABLE_SHA,
        APPLICATION / "source/communities-rfp-20261012/source-manifest.json")
    geometry_collection, geometry_path, geometry_entry = retained_geometry(
        workspace, args.geometry_manifest, args.geometry_source_id)
    geometry_body = geometry_path.read_bytes()
    decoded = gzip.decompress(geometry_body)
    if hashlib.sha256(decoded).hexdigest() != geometry_entry["decoded_sha256"]:
        raise ValueError("The original WBD decoded source differs")
    geometry = json.loads(decoded)
    huc_field = geometry_entry.get("metadata", {}).get("native_huc12_field")
    features = [
        feature for feature in geometry["features"]
        if (str(feature["attributes"].get(huc_field)) == HUC12 if huc_field else
            any(str(value) == HUC12 for name, value in feature["attributes"].items()
                if name.lower() == "huc12"))
    ]
    if len(features) != 1 or not features[0].get("geometry"):
        raise ValueError("Select the single original Lower Six and Twenty Creek WBD geometry")
    selected_geometry = {
        **{key: value for key, value in geometry.items() if key != "features"},
        "features": features,
    }

    table = communities.import_table(workspace, {
        "source_collection_id": table_collection["id"], "source_id": TABLE_SOURCE,
    })
    context = {
        "source_collection_ids": list(dict.fromkeys([
            table_collection["id"], geometry_collection["id"]])),
        "baseline_run_id": args.baseline_run, "scenario_run_ids": args.scenario_run,
    }
    title = "Lower Six and Twenty Creek riparian review programme"
    plan = communities.save_plan(workspace, {
        "table_id": table["id"], "title": title,
        "purpose": "Prepare a source-bound desk review and field-planning work item for "
                   "Anderson Regional Joint Water System in Lower Six and Twenty Creek.",
        "selection": {"utility_ids": [UTILITY], "watershed_ids": [HUC12], "geoids": []},
        "context": context,
        "interventions": [{
            "id": INTERVENTION,
            "title": "Screen riparian restoration opportunities in Lower Six and Twenty Creek",
            "priority": "medium", "strategy": "investigate", "status": "proposed",
            "utility_id": UTILITY, "watershed_id": HUC12, "geoids": [],
            "reason": "The RFP assigns six whole census block groups to this ARJWS focus "
                      "watershed. Use their retained context with the original WBD geometry "
                      "to prepare an accountable source-water planning work item.",
            "owner": "GIS and field planning team (proposed)",
            "next_step": "Prepare a desk-review layer of candidate riparian reaches and "
                         "access constraints for team review.",
            "cost_estimate_usd": None,
            "notes": "Review the retained watershed, land cover, streams and available parcel "
                     "sources. Use existing native model results where available to rank "
                     "candidate reaches for reconnaissance. This programme retains the "
                     "whole-block-group basis of the original demographic source.",
        }],
        "notes": [
            "Original WBD source: " + geometry_entry["id"] + "; HUC12 " + HUC12
            + "; source CRS " + geometry_entry["source_crs"] + ".",
            "Interventions are proposed planning work; costs remain unspecified until scoped.",
        ],
    })
    original_report = workspace.build_community_report({"plan_id": plan["id"]})
    original_csv = verify_file(
        workspace.root, original_report["files"]["interventions.csv"]).read_bytes()
    reader = csv.DictReader(io.StringIO(original_csv.decode("utf-8"), newline=""))
    headings, rows = reader.fieldnames, list(reader)
    if len(rows) != 1 or rows[0]["id"] != INTERVENTION:
        raise ValueError("The actual saved report does not contain the intended programme")
    rows[0]["next_step"] = (
        "Prepare a ranked desktop review map and field reconnaissance checklist for "
        "Lower Six and Twenty Creek; retain candidate reach references and landowner-access questions.")
    rows[0]["notes"] += (
        "\nCSV revision: add a field reconnaissance checklist and access-screening output "
        "to the proposed work programme.")
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=headings, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    edited_csv = text.getvalue().encode("utf-8")
    edited_path = output / "edited-interventions.csv"
    atomic_bytes(edited_path, edited_csv, immutable=True)
    received = subprocess.run([
        sys.executable, str(APPLICATION / "model/community_cli.py"),
        "--workspace", str(workspace.root), "plan-revise-csv", plan["id"],
        str(edited_path), "--title", title + " - revision 2",
    ], capture_output=True, text=True, check=False)
    if received.returncode:
        raise RuntimeError("Native CSV revision failed:\n" + received.stderr)
    revised = json.loads(received.stdout)
    revised_report = workspace.build_community_report({"plan_id": revised["id"]})

    if communities.get_plan(workspace, plan["id"]) != plan:
        raise ValueError("The saved original plan changed")
    if (revised["previous_plan_id"] != plan["id"]
            or revised["revision_number"] != plan["revision_number"] + 1
            or revised["table_id"] != table["id"]
            or revised["selection"] != plan["selection"]
            or revised["context"] != plan["context"]):
        raise ValueError("The native revision differs from its original plan lineage")
    comparison = revised["intervention_import"]["summary"]
    if (comparison["changed_ids"] != [INTERVENTION]
            or comparison["added_ids"] or comparison["removed_ids"]):
        raise ValueError("The native import comparison differs from the edited work programme")
    if verify_file(workspace.root, revised_report["files"]["received-interventions.csv"]).read_bytes() != edited_csv:
        raise ValueError("The revised report differs from the exact received CSV")

    artifacts = {}
    def emit(name, body):
        if not isinstance(body, bytes):
            body = canonical(body) + b"\n"
        path = output / name
        atomic_bytes(path, body, immutable=True)
        artifacts[name] = {"path": str(path), "bytes": len(body),
                           "sha256": hashlib.sha256(body).hexdigest()}

    emit("original-table.json", table)
    emit("original-plan.json", plan)
    emit("revised-plan.json", revised)
    emit("original-report.json", original_report)
    emit("revised-report.json", revised_report)
    emit("original-community-source.csv", original_table_path.read_bytes())
    emit("original-interventions.csv", original_csv)
    emit("selected-watershed.esri.json", selected_geometry)
    emit("original-wbd-source.esri.json.gz", geometry_body)
    emit("revised-interventions.csv", verify_file(
        workspace.root, revised_report["files"]["interventions.csv"]).read_bytes())
    emit("received-interventions.csv", verify_file(
        workspace.root, revised_report["files"]["received-interventions.csv"]).read_bytes())
    emit("INTERVENTION_IMPORT.json", verify_file(
        workspace.root, revised_report["files"]["INTERVENTION_IMPORT.json"]).read_bytes())
    emit("community-report.zip", verify_file(
        workspace.root, revised_report["files"]["community-report.zip"]).read_bytes())
    result = {
        "schema": "upstate.community-csv-workflow/v1", "operation_id": OPERATION,
        "workspace_id": workspace.project["id"], "workspace": str(workspace.root),
        "table_id": table["id"], "original_plan_id": plan["id"],
        "revised_plan_id": revised["id"], "original_report_id": original_report["id"],
        "revised_report_id": revised_report["id"], "huc12": HUC12,
        "utility_id": UTILITY, "source_crs": geometry_entry["source_crs"],
        "geometry_source_id": geometry_entry["id"],
        "geometry_source_collection_id": geometry_collection["id"],
        "geometry_source_sha256": geometry_entry["body"]["sha256"],
        "geometry_decoded_sha256": geometry_entry["decoded_sha256"],
        "selected_wbd_attributes": features[0]["attributes"],
        "community_summary": plan["summaries"]["all"],
        "import_summary": comparison, "artifacts": artifacts,
        "edited_csv": {"path": str(edited_path), "bytes": len(edited_csv),
                       "sha256": hashlib.sha256(edited_csv).hexdigest()},
    }
    atomic_bytes(output / "community-csv-workflow.json", canonical(result) + b"\n", immutable=True)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}},
                         ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
