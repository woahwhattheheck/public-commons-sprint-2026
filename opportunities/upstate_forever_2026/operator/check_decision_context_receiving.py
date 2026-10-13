#!/usr/bin/env python3
"""Run one saved-source decision-report journey in an original Workspace."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.workspace import Workspace
from model.decision_context import DecisionContexts
from model import receiving_waters


def choice(value):
    collection, separator, source_id = value.partition("/")
    if not separator or not source_id:
        raise argparse.ArgumentTypeError("Use the original COLLECTION_ID/SOURCE_ID.")
    return {"source_collection_id": collection, "source_id": source_id}


def run(args):
    ws = Workspace(args.workspace)
    manager = DecisionContexts(ws)
    selection = {"title": args.title, "statuses": ["current"]}
    analysis = None
    if args.plan:
        selection["plan_id"] = args.plan
    else:
        analyses = [row for row in receiving_waters.list_analyses(ws) if row["state"] == "complete"]
        if args.analysis:
            analysis = receiving_waters.inspect(ws, args.analysis, verify=False)
        elif analyses:
            analysis = max(analyses, key=lambda row: row.get("created_at", ""))
        if analysis:
            selection["analysis_id"] = analysis["id"]
        else:
            plans = [row for row in receiving_waters.list_plans(ws) if row["state"] == "complete"]
            if not plans:
                raise ValueError("Save an original receiving-water plan before running this journey.")
            selection["plan_id"] = max(plans, key=lambda row: row.get("created_at", ""))["id"]
    for collection in sorted(ws.sources(), key=lambda row: row.get("captured_at", "")):
        for entry in collection["entries"]:
            selected = {"source_collection_id": collection["id"], "source_id": entry["id"]}
            if entry.get("role") == "SOURCE_WATER_CONTEXT":
                selection["water_context"] = selected
            if entry["id"] == "classified-water-crosswalk":
                selection["crosswalk"] = selected
    if args.water_context:
        selection["water_context"] = args.water_context
    if args.crosswalk:
        selection["crosswalk"] = args.crosswalk
    report = manager.build(selection)
    reused = manager.build(selection)
    if reused["id"] != report["id"] or reused.get("reused") is not True:
        raise AssertionError("Repeating the same retained selection must reopen the same report.")
    reopened = manager.inspect(report["id"])
    if analysis:
        originals = {row["id"]: row for row in analysis["subjects"]}
        for row in reopened["physical_rows"]:
            metrics = originals[row["subject_id"]]["metrics"]
            baseline = metrics["baseline_physical"][row["pollutant"]]
            if row["baseline_original_sum"] != baseline["sum"]:
                raise AssertionError("The report baseline differs from the original receiving analysis.")
            if row["alternative_run_id"] and row["paired_valid_cells"]:
                change = metrics["alternatives"][row["alternative_run_id"]]["changes"][row["pollutant"]]
                expected = (change["sum"], change["baseline_sum_on_common_cells"],
                            change["alternative_sum_on_common_cells"])
                actual = (row["signed_change"], row["baseline_paired_sum"], row["alternative_paired_sum"])
                if actual != expected:
                    raise AssertionError("The report changed an original paired physical quantity.")
    archive_path = ws.root / reopened["files"]["report_archive"]["path"]
    with zipfile.ZipFile(archive_path) as archive:
        exported = json.loads(archive.read("context.json"))
        if exported["id"] != report["id"] or exported["physical_rows"] != report["physical_rows"]:
            raise AssertionError("The portable report differs from the saved original result.")
        for kind, reference in report["identity"]["sources"].items():
            for body in [reference["body"]] + reference["companions"]:
                name = "inputs/" + kind + "/" + body.get("view_path", body["filename"])
                data = archive.read(name)
                if len(data) != body["bytes"] or hashlib.sha256(data).hexdigest() != body["sha256"]:
                    raise AssertionError("The portable package changed an original context source.")
    deliveries = manager.compatible_deliveries(report["id"])
    delivery_id = args.delivery or (
        max(deliveries, key=lambda row: row.get("completed_at", ""))["id"] if deliveries else None)
    if args.require_delivery and not delivery_id:
        raise ValueError("Choose a complete compatible map delivery for the requested delivery-link journey.")
    link = manager.link_delivery(report["id"], delivery_id) if delivery_id else None
    return {
        "project_id": ws.project["id"], "mode": "native_analysis" if analysis else "source_plan",
        "report_id": report["id"], "analysis_id": report["analysis_id"], "plan_id": report["plan_id"],
        "counts": report["counts"], "source_selections": {
            key: selection[key] for key in ("water_context", "crosswalk") if key in selection},
        "report_archive": report["files"]["report_archive"],
        "compatible_deliveries": len(deliveries), "delivery_link_id": link["id"] if link else None,
        "reused": reused["reused"], "portable_source_bytes_verified": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing original Workspace directory")
    original = parser.add_mutually_exclusive_group()
    original.add_argument("--analysis", help="Exact completed receiving-water analysis ID")
    original.add_argument("--plan", help="Exact original receiving-water plan ID")
    parser.add_argument("--water-context", type=choice, help="Retained COLLECTION_ID/SOURCE_ID")
    parser.add_argument("--crosswalk", type=choice, help="Retained COLLECTION_ID/SOURCE_ID")
    parser.add_argument("--delivery", help="Exact complete compatible original map delivery ID")
    parser.add_argument("--require-delivery", action="store_true")
    parser.add_argument("--title", default="Regional receiving-water decision review")
    args = parser.parse_args()
    print(json.dumps(run(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
