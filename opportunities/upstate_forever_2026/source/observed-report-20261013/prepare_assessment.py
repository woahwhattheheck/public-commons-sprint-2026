#!/usr/bin/env python3
"""Prepare and independently receive the original three assessment station studies.

The default course also invokes the existing scientific-report receiver. Each GIS
case runs in its own process; source models, report rendering and task ownership
remain with the maintained application.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP))
from model.common import atomic_json, digest, held, read_json, verify_file
from model.workspace import Workspace

SCHEMA = "upstate.assessment-receiving-preparation/v1"
ORIGIN = "https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791874731085779"
STUDIES = {
    "all164": ("upper-savannah-assessments-all-editions-164", 164, 293),
    "published159": ("upper-savannah-published-assessments-2024-2026-159", 159, 192),
    "draft87": ("upper-savannah-assessment-2026-87", 87, 101),
}
CONTEXTS = {
    "all-published-watersheds": ("published_watershed", {}, 293, 164, 77, 6),
    "all-computed-memberships": ("station_membership", {}, 293, 164, 78, 6),
    "july-fully-supported": ("published_watershed", {"supports": ["fully_supported"]}, 5, 5, 5, 0),
    "draft-2026": ("published_watershed", {"editions": ["2026"]}, 101, 87, 49, 0),
}
CASES = [*("study-" + name for name in STUDIES), *("context-" + name for name in CONTEXTS)]
CODE = [
    "model/station_study.py", "model/station_geography.py",
    "model/assessment_context.py", "model/assessment_report_context.py",
    "model/station_assessment_context.py", "model/station_inventory.py", "model/station_wbd_context.py",
    "model/common.py", "source/observed-report-20261013/prepare_assessment.py",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(path):
    path = Path(path).resolve(strict=True)
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": checksum.hexdigest()}


def binding(args):
    roots = [APP.resolve(), args.workspace.resolve(), args.receiving_workspace.resolve(), args.output.resolve()]
    for index, left in enumerate(roots):
        for right in roots[index + 1:]:
            require(not left.is_relative_to(right) and not right.is_relative_to(left),
                    "Keep application, original Workspace, receiving Workspace and output in separate trees.")
    workspace = Workspace(args.workspace)
    receiving = Workspace(args.receiving_workspace, create=args.create_receiving_workspace,
                          title="Upper Savannah independent assessment receiving")
    manifests = [identity(path) for path in args.manifest]
    require(len({row["path"] for row in manifests}) == len(manifests),
            "Supply each original source manifest once.")
    draft = identity(args.assessment_csv)
    require(draft["sha256"] == "545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f",
            "Choose the retained original 101-row draft assessment CSV.")
    return {"schema": SCHEMA, "origin": ORIGIN, "workspace": str(workspace.root),
            "project_id": workspace.project["id"], "receiving_workspace": str(receiving.root),
            "receiving_project_id": receiving.project["id"],
            "source_manifests": manifests, "assessment_csv": draft,
            "model_source": [identity(APP / name) for name in CODE]}


def report_course(args, selected):
    return {"schema": "upstate.scientific-report-receiving-course/v1",
            "operation_id": "assessment-receiving-" + digest(selected)[:24],
            "project_id": selected["project_id"],
            "steps": [{
                "id": "assessment-" + name, "origin": ORIGIN,
                "source_receipt": {
                    "path": str(args.output / "prepared" / (name + "-report.json")),
                    "sources_path": ["source"], "title_path": ["title"],
                    "checks": [{"path": ["workspace_id"], "equals": selected["project_id"]},
                               {"path": ["summary", "assessment_row_count"], "equals": spec[2]}]},
                "output_from_receipt": {
                    "directory": str(args.output / "reports"), "prefix": name + "-",
                    "path": ["operation_id"]},
                "selected_study": True,
            } for name, spec in CONTEXTS.items()]}


def prepare_case(args, selected):
    from model import station_study, station_geography, assessment_context, assessment_report_context
    workspace, receiving = Workspace(args.workspace), Workspace(args.receiving_workspace)
    case = args.case
    if case.startswith("study-"):
        name = case[len("study-"):]
        study_id, stations, records = STUDIES[name]
        result = station_study.operate(workspace, args.manifest, args.assessment_csv,
                                       receiving, study_id)
        require(result["study"]["ready"],
                "Complete the original study inputs: " + json.dumps(result["study"].get("missing", [])))
        summary = result["study"]["source_summary"]
        require(summary["station_count"] == stations and summary["assessment_rows"] == records
                and summary["watershed_count"] == 217, "Original station study scope changed.")
        require(result["received"]["original_station_memberships_preserved"],
                "Original station memberships differ after receiving.")
        edition = station_geography.inspect(workspace, result["edition"]["id"],
                                             verify=True, include_result=True)
        require(len(edition["result"]["stations"]) == stations,
                "The native station edition differs from its prepared study.")
        record = {"case": case, "project_id": selected["project_id"],
                  "study_id": study_id, "id": edition["id"],
                  "summary": edition["summary"], "source_summary": summary,
                  "received_id": result["received"]["edition"]["id"],
                  "archive": result["archive"], "original_station_memberships_preserved": True}
    else:
        name = case[len("context-"):]
        original = read_json(args.output / "prepared" / "study-all164.json")
        require(original["project_id"] == selected["project_id"],
                "Use this course's original all164 station study.")
        geography_id = original["id"]
        options = assessment_context.options(workspace, geography_id)
        inventories = [{"table": row["reference"], "fields": row["default_fields"],
                        "assessment": row["assessment_defaults"]} for row in options["tables"]]
        require(len(inventories) == 3 and sum(row["row_count"] for row in options["tables"]) == 293,
                "Retain all three original assessment inventories and their 293 records.")
        require(len(options["watershed_sources"]) == 1,
                "Choose the original unique 217-polygon watershed source.")
        basis, filters, count, station_count, watershed_count, differences = CONTEXTS[name]
        selection = {"title": "Upper Savannah — " + name, "station_geography_id": geography_id,
                     "inventories": inventories, "watershed_source": options["watershed_sources"][0]["reference"],
                     "relationship_basis": basis, "filters": filters}
        built = assessment_context.build(workspace, selection)
        edition = assessment_context.inspect(workspace, built["id"], verify=True, include_result=True)
        expected = {"assessment_row_count": count, "station_count": station_count,
                    "watershed_count": watershed_count, "differing_association_row_count": differences}
        require(all(edition["summary"].get(key) == value for key, value in expected.items()),
                "Assessment context differs from the original selected scope: " + json.dumps(edition["summary"]))
        archives = [item for item in edition["files"] if Path(item["path"]).name == "assessment-context.zip"]
        require(len(archives) == 1, "Retain the unique complete assessment archive.")
        path = verify_file(workspace.root, archives[0])
        reopened = assessment_context.receive(receiving, path)
        other = assessment_context.inspect(receiving, reopened["id"], verify=True, include_result=True)
        original_rows = {row["assessment_row_id"]: row["original"] for row in edition["result"]["rows"]}
        received_rows = {row["assessment_row_id"]: row["original"] for row in other["result"]["rows"]}
        require(len(original_rows) == count and original_rows == received_rows
                and edition["summary"] == other["summary"],
                "Independent receiving changed original assessment rows, positions or source identities.")
        report = assessment_report_context.prepare(workspace, edition["id"], import_source=True)
        received_report = assessment_report_context.prepare(receiving, other["id"], import_source=True)
        atomic_json(args.output / "prepared" / (name + "-report.json"), report, immutable=True)
        atomic_json(args.output / "prepared" / (name + "-received-report.json"), received_report, immutable=True)
        record = {"case": case, "project_id": selected["project_id"], "id": edition["id"],
                  "received_id": other["id"], "summary": edition["summary"],
                  "archive": {**archives[0], "absolute_path": str(path)},
                  "original_rows_preserved": True,
                  "report_source": report["source"], "received_report_source": received_report["source"]}
    atomic_json(args.output / "prepared" / (case + ".json"), record, immutable=True)
    return record


def execute_case(args, selected):
    with held(args.output / ".assessment-preparation.lock", blocking=False):
        atomic_json(args.output / "selection.json", selected, immutable=True)
        state_path = args.output / "assessment-preparation.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "selection_sha256": digest(selected),
            "project_id": selected["project_id"], "cases": {}}
        require(state["selection_sha256"] == digest(selected), "Resume the same original source selection.")
        state["cases"][args.case] = {"state": "running"}
        atomic_json(state_path, state)
        try:
            record = prepare_case(args, selected)
        except BaseException as error:
            state["cases"][args.case] = {"state": "interrupted" if not isinstance(error, Exception) else "failed",
                                        "error": {"type": type(error).__name__, "message": str(error)}}
            atomic_json(state_path, state)
            raise
        state["cases"][args.case] = {"state": "complete", "id": record["id"],
                                    "received_id": record["received_id"],
                                    "record": str(args.output / "prepared" / (args.case + ".json"))}
        state["preparation_complete"] = all(state["cases"].get(key, {}).get("state") == "complete" for key in CASES)
        atomic_json(state_path, state)
        print(json.dumps({"case": args.case, **state["cases"][args.case]}, sort_keys=True), flush=True)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path, help="Existing original 217-polygon project.")
    parser.add_argument("--receiving-workspace", required=True, type=Path)
    parser.add_argument("--create-receiving-workspace", action="store_true")
    parser.add_argument("--manifest", required=True, action="append", type=Path,
                        help="Original source manifest; repeat for all retained input sources.")
    parser.add_argument("--assessment-csv", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--case", choices=["all", *CASES], default="all")
    parser.add_argument("--prepare-only", action="store_true",
                        help="Prepare all report receipts and the existing receiver's course for its current owner.")
    parser.add_argument("--timeout", type=float, default=1800, help="Per report operation timeout in seconds.")
    parser.add_argument("--upload-limit-gib", type=int, default=4)
    args = parser.parse_args(argv)
    for name in ("workspace", "receiving_workspace", "assessment_csv", "output"):
        setattr(args, name, getattr(args, name).resolve())
    args.manifest = [path.resolve() for path in args.manifest]
    require(args.timeout > 0 and 1 <= args.upload_limit_gib <= 64, "Use valid report receiving limits.")
    selected = binding(args)
    args.output.mkdir(parents=True, exist_ok=True)
    with held(args.output / ".assessment-preparation.lock", blocking=False):
        atomic_json(args.output / "selection.json", selected, immutable=True)
        (args.output / "prepared").mkdir(exist_ok=True)
        atomic_json(args.output / "report-course.json", report_course(args, selected), immutable=True)
    if args.case != "all":
        return execute_case(args, selected)
    common = [sys.executable, str(Path(__file__).resolve()),
              "--workspace", str(args.workspace), "--receiving-workspace", str(args.receiving_workspace),
              "--assessment-csv", str(args.assessment_csv), "--output", str(args.output)]
    for manifest in args.manifest:
        common += ["--manifest", str(manifest)]
    failed = []
    for case in CASES:
        result = subprocess.run([*common, "--case", case], check=False)
        if result.returncode:
            failed.append({"case": case, "returncode": result.returncode})
    report_code = None
    if not args.prepare_only:
        receiver = Path(__file__).with_name("receive_operator.py")
        require(receiver.is_file() and receiver.with_name("receive_course.py").is_file(),
                "Retain the maintained scientific-report receiver and course module beside this command.")
        checkpoint = args.output / "report-receiving"
        command = [sys.executable, str(receiver), "--workspace", str(args.workspace),
                   "--output", str(checkpoint), "--course", str(args.output / "report-course.json"),
                   "--timeout", str(args.timeout), "--upload-limit-gib", str(args.upload_limit_gib)]
        if checkpoint.exists():
            command.append("--resume")
        report_code = subprocess.run(command, check=False).returncode
    print(json.dumps({"preparation_complete": not failed, "failed_cases": failed,
                      "report_receiving_returncode": report_code,
                      "course": str(args.output / "report-course.json")}, sort_keys=True), flush=True)
    return 0 if not failed and report_code in (None, 0) else 2


if __name__ == "__main__":
    raise SystemExit(main())
