"""Import original regional gauge sources, build support, and reopen the same Workspace."""
from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import sys
from pathlib import Path

from model import gauge_support, portable
from model.common import atomic_bytes, atomic_json, describe_file, file_digest, read_json, now
from model.workspace import Workspace

DAILY_FILES = (
    "original/usgs-stations-expanded.tsv",
    "original/usgs-discharge-series-catalog.tsv",
    *(f"original/usgs-huc05-07-daily-discharge-{year}.tsv" for year in range(2020, 2026)),
    "source-manifest.json", "derived/daily-discharge.csv",
    "derived/station-year-coverage.csv", "derived/station-year-coverage.json",
    "derive-discharge.mjs", "README.md",
)
COVERAGE_PATH = "derived/station-year-coverage.json"
COVERAGE_ID = "usgs-huc05-07-daily-flow-coverage-20261013"
POINT_ID = "nldi-daily-flow-gauge-locations-20261013"
CATCHMENT_ID = "nldi-daily-flow-whole-catchments-20261013"


def _path(root, member):
    if not isinstance(member, str) or not member or "\\" in member:
        raise ValueError("Use a canonical original source member")
    relative = Path(member)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in member.split("/")):
        raise ValueError("Original source member leaves its edition")
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Original source member leaves its edition: " + member)
    return path


def prepare_coverage(source_root, output):
    """Retain all original14 members and register only their exact coverage array."""
    source_root = Path(source_root).resolve(strict=True)
    output = Path(output).resolve()
    if output == source_root or output.is_relative_to(source_root):
        raise ValueError("Use a separate prepared output directory for the original coverage")
    original = read_json(source_root / "source-manifest.json")
    if original.get("schema") != "upstate.original-discharge-source/v1":
        raise ValueError("Choose the maintained original-discharge-source/v1 edition")
    originals = original.get("originals")
    if not isinstance(originals, list) or len(originals) != 8:
        raise ValueError("Retain the original station inventory, series catalogue and six annual bodies")
    for item in originals:
        path = _path(source_root, item["path"])
        if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
            raise ValueError("An original discharge member differs from its captured manifest: " + item["path"])
    descriptors = {}
    for member in DAILY_FILES:
        path = _path(source_root, member)
        body = path.read_bytes()
        atomic_bytes(output / member, body, immutable=True)
        descriptors[member] = {"path": member, "bytes": len(body), "sha256": file_digest(path)}
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Original USGS HUC05–07 daily-flow calendar coverage, 2020–2025",
        "captured_at": original.get("captured_at") or "2026-10-13",
        "notes": [
            "The primary file is the unchanged original derived coverage array.",
            "The complete original14 source family is retained, including six original annual responses and the original derivation.",
            "Approved, estimated and provisional qualifier flags can overlap.",
            "Daily observed-water measurement import remains the original maintained flow intake.",
        ],
        "entries": [{
            "id": COVERAGE_ID, "title": "Original gauge / series / calendar-year flow coverage",
            "kind": "table", "role": "daily-flow-coverage", "format": "json",
            "uri": original["source_request"] if isinstance(original.get("source_request"), str)
                and original["source_request"].startswith(("https://", "http://")) else
                "https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791863575555249",
            "vintage": "USGS-original-daily-2020-2025-captured-20261013",
            **descriptors[COVERAGE_PATH],
            "companions": [descriptors[member] for member in DAILY_FILES if member != COVERAGE_PATH],
        }],
    }
    atomic_json(output / "model-sources.json", manifest, immutable=True)
    return output / "model-sources.json"


def _reference(collection, source_id):
    entry = next((row for row in collection["entries"] if row["id"] == source_id), None)
    if entry is None:
        raise ValueError("The imported original edition omits " + source_id)
    return {"collection_id": collection["id"], "source_id": source_id,
            "source_sha256": entry["body"]["sha256"]}


def receive(args):
    application = Path(__file__).resolve().parents[1]
    workspace = Workspace(args.workspace)
    output = Path(args.output).resolve()
    if output.is_relative_to(workspace.root.resolve()) or output.is_relative_to(application):
        raise ValueError("Choose a receiving output directory outside the application and Workspace")
    output.mkdir(parents=True, exist_ok=True)
    receipt_path = output / "receiving-gauge-support.json"
    identity = {"workspace": str(workspace.root.resolve()), "project_id": workspace.project["id"],
        "application": str(application), "report_id": args.report_id, "title": args.title,
        "daily_source": str(Path(args.daily_source).resolve()),
        "nldi_manifest": str(Path(args.nldi_manifest).resolve()),
        "huc_manifest": str(Path(args.huc_manifest).resolve()) if args.huc_manifest else None,
        "huc_collection": args.huc_collection, "huc_source_id": args.huc_source_id,
        "huc_id_field": args.huc_id_field, "reporting_huc12s": sorted(args.reporting_huc12 or []),
        "utility_selection": str(Path(args.utility_selection).resolve()) if args.utility_selection else None}
    # Original whole-source receipts keep their exact selection identity.
    if args.catchment_manifest or args.catchment_collection or args.catchment_source_id != CATCHMENT_ID:
        identity["catchment_selection"] = {
            "manifest": str(Path(args.catchment_manifest).resolve()) if args.catchment_manifest else None,
            "collection_id": args.catchment_collection, "source_id": args.catchment_source_id}
    if args.support_kind:
        identity["support_kind"] = args.support_kind
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt.get("identity") != identity:
            raise ValueError("This receiving output belongs to another saved source selection")
    else:
        receipt = {"schema": "upstate.gauge-support-receiving/v1", "identity": identity,
            "started_at": now(), "phases": {}, "state": "running"}
    receipt["state"] = "running"
    receipt.pop("error", None)
    receipt["process"] = {"hostname": socket.gethostname(), "pid": os.getpid(),
        "interpreter": sys.executable, "python": platform.python_version(), "started_at": now()}
    def checkpoint(phase, **value):
        receipt["phases"][phase] = value
        receipt["updated_at"] = now()
        atomic_json(receipt_path, receipt)
        print(json.dumps({"phase": phase, **value}, ensure_ascii=False, allow_nan=False), flush=True)
    atomic_json(receipt_path, receipt)
    try:
        # Source preparation is independent of the original native model/GIS job queue.
        manifest = prepare_coverage(args.daily_source, output / "daily-coverage-source")
        def imported(name, manifest_path):
            previous = receipt["phases"].get(name)
            if previous:
                collection = workspace._get("sources", previous["collection_id"])
                if previous["manifest_sha256"] != file_digest(manifest_path):
                    raise ValueError("The original manifest changed during receiving: " + name)
            else:
                collection = workspace.import_sources(manifest_path)
            checkpoint(name, collection_id=collection["id"], manifest_sha256=file_digest(manifest_path))
            return collection
        daily = imported("coverage_import", manifest)
        nldi = imported("nldi_import", Path(args.nldi_manifest).resolve(strict=True))
        if args.catchment_manifest:
            catchment = imported("catchment_import", Path(args.catchment_manifest).resolve(strict=True))
        elif args.catchment_collection:
            catchment = workspace._get("sources", args.catchment_collection)
        else:
            catchment = nldi
        if args.huc_manifest:
            huc = imported("huc_import", Path(args.huc_manifest).resolve(strict=True))
        else:
            if not args.huc_collection:
                raise ValueError("Select the original HUC polygon source by --huc-manifest or --huc-collection")
            huc = workspace._get("sources", args.huc_collection)
        huc_ref = {**_reference(huc, args.huc_source_id), "id_field": args.huc_id_field}
        selection = {"title": args.title, "report_id": args.report_id,
            "huc_sources": [huc_ref], "point_source": {
                **_reference(nldi, POINT_ID), "station_id_field": "station_id"},
            "catchment_source": _reference(catchment, args.catchment_source_id),
            "coverage_source": _reference(daily, COVERAGE_ID)}
        if args.support_kind:
            selection["support_kind"] = args.support_kind
        if args.reporting_huc12:
            selection["reporting_huc12s"] = args.reporting_huc12
        if args.utility_selection:
            utility = read_json(args.utility_selection)
            if not isinstance(utility, list):
                raise ValueError("Utility selection is a list of original polygon source references")
            selection["utility_sources"] = utility
        atomic_json(output / "gauge-support-selection.json", selection, immutable=True)
        checkpoint("selection", path=str(output / "gauge-support-selection.json"),
            report_id=args.report_id, huc_source_id=args.huc_source_id,
            catchment_source=selection["catchment_source"],
            declared_support_kind=selection.get("support_kind"))
        if args.prepare_only:
            receipt["state"] = "prepared"
            atomic_json(receipt_path, receipt)
            return receipt
        edition = gauge_support.build(workspace, selection)
        gauge_support.inspect(workspace, edition["id"], verify=True)
        checkpoint("support_build", edition_id=edition["id"], station_edition_id=edition["station_edition_id"],
            build_id=edition["build_id"], summary=edition["summary"],
            support=gauge_support.support_for_result(gauge_support.inspect(workspace,
                edition["id"], verify=True, include_result=True)["result"]))
        archive = output / ("gauge-support-workspace-" + edition["id"] + ".zip")
        if not archive.exists():
            portable.backup(workspace, archive)
        checkpoint("workspace_backup", archive=describe_file(output, archive))
        restored_root = output / ("reopened-" + edition["id"])
        if not restored_root.exists():
            portable.restore(archive, restored_root)
        reopened = Workspace(restored_root / "workspace")
        if reopened.project["id"] != workspace.project["id"]:
            raise ValueError("Reopened Workspace project identity differs")
        reopened_edition = gauge_support.inspect(reopened, edition["id"], verify=True, include_result=True)
        if reopened_edition["build_id"] != edition["build_id"] or reopened_edition["summary"] != edition["summary"]:
            raise ValueError("Reopened support report differs from its original selection")
        checkpoint("independent_reopen", workspace=str(reopened.root), project_id=reopened.project["id"],
            edition_id=reopened_edition["id"], station_edition_id=reopened_edition["station_edition_id"],
            regional_report_id=reopened_edition["regional"]["report_id"])
        receipt["state"], receipt["completed_at"] = "complete", now()
        atomic_json(receipt_path, receipt)
        return receipt
    except BaseException as error:
        receipt["state"] = "interrupted" if isinstance(error, KeyboardInterrupt) else "failed"
        receipt["error"] = {"type": type(error).__name__, "message": str(error)}
        receipt["updated_at"] = now()
        atomic_json(receipt_path, receipt)
        raise


def main(argv=None):
    application = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing regional Workspace")
    parser.add_argument("--output", required=True)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--title", default="Upper Savannah original gauge and catchment support")
    parser.add_argument("--daily-source", default=str(application / "source/hydrology-huc05-07-20261013"))
    parser.add_argument("--nldi-manifest", default=str(application / "source/hydrology-huc05-07-20261013/nldi/model-sources.json"))
    catchment = parser.add_mutually_exclusive_group()
    catchment.add_argument("--catchment-manifest", help="Exact completed source edition model-sources.json")
    catchment.add_argument("--catchment-collection", help="Already retained catchment source collection")
    parser.add_argument("--catchment-source-id", default=CATCHMENT_ID,
        help="Exact source ID in the selected whole or split edition")
    parser.add_argument("--support-kind", choices=sorted(gauge_support.SUPPORT_DEFINITIONS),
        help="Optional explicit expected method, verified against every original feature")
    parser.add_argument("--huc-manifest")
    parser.add_argument("--huc-collection")
    parser.add_argument("--huc-source-id", default="upstate-wbd-upstream-domain-20261012")
    parser.add_argument("--huc-id-field", default="huc12")
    parser.add_argument("--reporting-huc12", action="append")
    parser.add_argument("--utility-selection", help="JSON list of actual Workspace polygon source references")
    parser.add_argument("--prepare-only", action="store_true", help="Retain originals and a selection before the geometry runtime is ready")
    args = parser.parse_args(argv)
    print(json.dumps(receive(args), ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
