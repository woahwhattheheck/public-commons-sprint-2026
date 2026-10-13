#!/usr/bin/env python3
"""Finish retained jurisdiction assessments through the original report and Study workflow."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

VERSION = "assessment-report-receiving/v1"
KINDS = {
    "upstate.nc-assessment-receiving/v1": (
        "NC", "ncdeq-final-2022-savannah-scientific-report",
        "ncdeq-final-2022-savannah-assessment-context", "upstate.nc-integrated-assessment/v1"),
    "upstate.ga-assessment-receiving/v1": (
        "GA", "ga2024-gis-observed-report",
        "ga2024-gis-assessments-json", "upstate.georgia-assessments/v1"),
}


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _runtime(application):
    application = Path(application).resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the complete receiving application")
    sys.path.insert(0, str(application))
    from model import workspace as module
    if not Path(module.__file__).resolve().is_relative_to(application):
        raise ValueError("Use one complete original application in this receiving process")
    return application, module.Workspace


def _source_snapshot(workspace, choice):
    from model.common import digest
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    return {"selection": choice, "entry": entry, "entry_sha256": digest(entry),
            "body_path": str(path)}


def _assessments(workspace, operations):
    """Bind each completed original source operation without reclassifying its rows."""
    from model.common import identifier
    result, choices = [], []
    for supplied in operations:
        state = _read(supplied) if isinstance(supplied, (str, Path)) else supplied
        if not isinstance(state, dict) or state.get("schema") not in KINDS:
            raise ValueError("Select a completed original NC or GA assessment receiving operation")
        jurisdiction, report_id, table_id, schema = KINDS[state["schema"]]
        if state.get("phase") != "complete" or state.get("binding", {}).get("project_id") != workspace.project["id"]:
            raise ValueError("Complete the assessment source in this same retained project")
        collection = identifier(state["normalized_source_collection_id"])
        if (state.get("scientific_report_source_id") != report_id
                or table_id not in state.get("normalized_source_ids", [])):
            raise ValueError("The original assessment operation changed its table/report source IDs")
        choice = {"source_collection_id": collection, "source_id": report_id}
        report = _source_snapshot(workspace, choice)
        if report["entry"].get("kind") != "document" or report["entry"].get("role") != "OBSERVED_CONTEXT":
            raise ValueError("Select the original typed jurisdiction scientific report")
        recipe = _read(report["body_path"])
        if recipe.get("schema") != "upstate.observed-report/v1":
            raise ValueError("The jurisdiction source is not the maintained scientific recipe")
        table = _source_snapshot(workspace, {"source_collection_id": collection, "source_id": table_id})
        bank = _read(table["body_path"])
        if bank.get("schema") != schema or bank.get("summary") != state.get("summary"):
            raise ValueError("The imported assessment table differs from its completed receiving operation")
        geographic_ids = state.get("geographic_source_ids")
        if (state.get("geographic_source_collection_id") != collection
                or not isinstance(geographic_ids, list) or not geographic_ids):
            raise ValueError("Retain the assessment's original regional geographic source")
        geography = []
        for key in geographic_ids:
            value = _source_snapshot(workspace, {"source_collection_id": collection, "source_id": key})
            if value["entry"].get("kind") != "vector":
                raise ValueError("The original assessment geography must remain a vector source")
            geography.append({"selection": value["selection"], "entry": value["entry"]})
        # The native collector independently verifies all companion paths/hashes.
        # These explicit table and map bodies must occur within this exact recipe.
        input_hashes = {row["sha256"] for row in recipe.get("inputs", [])}
        for value in [table, *[{"entry": row["entry"]} for row in geography]]:
            if value["entry"]["body"]["sha256"] not in input_hashes:
                raise ValueError("The report recipe omits its original assessment table or geographic layer")
        result.append({
            "jurisdiction": jurisdiction, "receiving_schema": state["schema"],
            "binding": state["binding"], "source": choice,
            "assessment_schema": schema, "summary": bank["summary"],
            "geography_summary": state.get("geography_summary"),
            "geographic_assessment_summary": state.get("geographic_assessment_summary"),
            "table": {"selection": table["selection"], "entry": table["entry"]},
            "geography": geography,
        })
        if choice not in choices:
            choices.append(choice)
    if not result:
        raise ValueError("Select at least one completed jurisdiction assessment")
    return result, choices


def _choices(workspace, original, additions):
    """Keep the caller's original source order and append each jurisdiction once."""
    from model import observed_context
    if original is None:
        payload = {}
    elif not isinstance(original, dict):
        raise ValueError("Use the original scientific report selection object")
    else:
        payload = dict(original)
    if "sources" in payload:
        values = payload["sources"]
    elif payload.get("observed_context_sources") or payload.get("source_roles"):
        values = observed_context.source_choices(payload)
    else:
        values = []
    if not isinstance(values, list):
        raise ValueError("Ordered scientific report sources must be a list")
    values = list(values)
    for choice in additions:
        if choice not in values:
            values.append(choice)
    choices = observed_context.source_choices({"observed_context_sources": values})
    snapshots = [_source_snapshot(workspace, choice) for choice in choices]
    return payload, choices, snapshots


def _inside(path, root):
    return path == root or path.is_relative_to(root)


def _external(directory, application, workspace):
    directory = Path(directory).resolve()
    for root in (application.resolve(), workspace.root.resolve()):
        if _inside(directory, root) or _inside(root, directory):
            raise ValueError("Keep assessment report receiving outside the application and Workspace")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _cold_check(received, expected):
    """Runs only in a fresh process importing the selected archive's application."""
    from model.common import digest, read_json, verify_file
    from model import scientific_report_editions as reports, study_transfer
    from model.workspace import Workspace
    received = Path(received).resolve(strict=True)
    application = received / "application"
    for module in (reports, study_transfer, sys.modules[Workspace.__module__], sys.modules[__name__]):
        if not Path(module.__file__).resolve().is_relative_to(application):
            raise ValueError("Cold reopening must use only this archive's original application")
    workspace = Workspace(received / "workspace")
    if workspace.project != expected["project"]:
        raise ValueError("The received assessment study changed its original project")
    receipt = read_json(workspace.root / "study-transfers" / (expected["study_id"] + ".json"))
    if digest(receipt) != expected["study_receipt_sha256"]:
        raise ValueError("The independently received Study receipt differs")
    checks = study_transfer.verify_received_studies(workspace)
    matched = [row for row in checks if row["id"] == expected["study_id"] and row["identity"] == "MATCH"]
    if len(matched) != 1:
        raise ValueError("The original selected assessment study did not reopen")
    edition, directory, operation = reports.inspect(workspace, expected["scientific_report_edition_id"])
    if digest(edition) != expected["edition_sha256"] or digest(operation) != expected["operation_sha256"]:
        raise ValueError("Cold reopening changed the original report selection or output records")
    source_entries = []
    for source in expected["sources"]:
        choice = source["selection"]
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if entry != source["entry"]:
            raise ValueError("Cold reopening changed an original scientific source edition")
        source_entries.append(choice)
    for name, item in expected["report_files"].items():
        verify_file(directory, item)
    return {
        "schema": "upstate.assessment-report-cold-opening/v1", "state": "complete",
        "project_id": workspace.project["id"], "study_id": expected["study_id"],
        "scientific_report_edition_id": edition["id"], "sources": source_entries,
        "workspace": str(workspace.root), "application": str(application),
        "report_directory": str(directory), "study_identity": matched[0],
        "files": {role: {**item, "path": str(directory / item["path"])}
                  for role, item in expected["report_files"].items()},
    }


def complete(workspace, operations, output, *, application=None, selection=None,
             title=None, contact=None):
    """Publish/reopen one ordered report and its original selected Study archive."""
    from model.common import atomic_json, describe_file, digest, held, read_json, verify_file
    from model import portable, scientific_report_editions as reports, study_transfer
    application = Path(application or Path(__file__).resolve().parents[1]).resolve(strict=True)
    output = _external(output, application, workspace)
    assessments, own_choices = _assessments(workspace, operations)
    original, choices, snapshots = _choices(workspace, selection, own_choices)
    payload = {"sources": choices}
    payload["title"] = title if title is not None else original.get("title") or "Upper Savannah jurisdiction assessment context"
    if contact is not None or original.get("contact") is not None:
        payload["contact"] = contact if contact is not None else original["contact"]
    # Request identity excludes machine-local source-view paths. The report
    # publisher retains its own exact renderer and original Workspace identity.
    sources = [{"selection": row["selection"], "entry": row["entry"]} for row in snapshots]
    request = {"schema": VERSION, "project_id": workspace.project["id"],
               "payload": payload, "sources": sources, "assessments": assessments}
    key = digest(request)
    directory = output / ("assessment-report-" + key[:20])
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "receiving.json"
    with held(directory / ".receiving.lock", blocking=False):
        atomic_json(directory / "request.json", request, immutable=True)
        state = read_json(state_path) if state_path.exists() else {
            "schema": "upstate.assessment-report-receiving/v1", "id": key,
            "project_id": workspace.project["id"], "request": request}
        if state.get("id") != key or state.get("request") != request:
            raise ValueError("Reuse the original assessment report receiving selection")

        def checkpoint(phase, **values):
            state.update({"phase": phase, **values})
            atomic_json(state_path, state)

        preview_path = directory / "preview.json"
        if preview_path.exists():
            prepared = read_json(preview_path)
        else:
            prepared = reports.preview(workspace, payload)
            atomic_json(preview_path, prepared, immutable=True)
        checkpoint("scientific-report", scientific_report_edition_id=prepared["id"])
        # render() recovers operation.json published before a prior interrupted
        # edition.json write, preserving the original preview/renderer identity.
        saved = reports.render(workspace, {**payload, "preview_id": prepared["id"]})
        edition, report_directory, operation = reports.inspect(workspace, saved["scientific_report_edition_id"])
        exported = reports.export(workspace, edition["id"])
        report_files = reports.files(edition, report_directory)
        study_selection = {
            "schema": "upstate.study-selection/v1", "title": edition["title"],
            "roots": [{"kind": "scientific-report-editions", "id": edition["id"]}],
            "include_related_results": False,
        }
        atomic_json(directory / "study-selection.json", study_selection, immutable=True)
        archive = directory / "assessment-study.zip"
        checkpoint("selected-study-export", report_files=report_files,
                   report_directory=str(report_directory), report_archive=exported)
        transferred = study_transfer.export_study(
            workspace, archive, study_selection,
            progress=lambda value: checkpoint("selected-study-export", export_progress=value))
        inspected = study_transfer.inspect_transfer_archive(archive, verify=True)
        if inspected["study"]["id"] != transferred["id"] or inspected["manifest"]["project"] != workspace.project:
            raise ValueError("The original selected assessment archive changed")
        expected = {
            "project": workspace.project, "study_id": transferred["id"],
            "study_receipt_sha256": digest(inspected["study"]),
            "scientific_report_edition_id": edition["id"],
            "edition_sha256": digest(edition), "operation_sha256": digest(operation),
            "sources": sources, "report_files": report_files,
        }
        atomic_json(directory / "cold-opening-selection.json", expected, immutable=True)
        received = directory / "reopened"
        checkpoint("selected-study-restore", selected_study={
            "id": transferred["id"], **describe_file(directory, archive)})
        if not received.exists():
            portable.restore(archive, received)
        else:
            # Resume after native restore's atomic completion without replacing
            # a previously received application or any original source member.
            for name, item in inspected["manifest"]["members"].items():
                verify_file(received, {**item, "path": name})
        archived_helper = received / "application" / "source_tools" / "assessment_report_receiving.py"
        if not archived_helper.is_file():
            raise ValueError("The selected application archive lacks its assessment report receiver")
        command = [sys.executable, "-I", "-B", "-c",
                   "import json,sys;from pathlib import Path;"
                   "root=Path(sys.argv[1]).resolve();sys.path.insert(0,str(root/'application'));"
                   "from source_tools.assessment_report_receiving import _cold_check;"
                   "print(json.dumps(_cold_check(root,json.load(sys.stdin)),ensure_ascii=False,allow_nan=False))",
                   str(received)]
        checkpoint("independent-cold-opening")
        log = directory / "cold-opening.stderr.log"
        with log.open("w", encoding="utf-8") as errors:
            child = subprocess.run(command, input=json.dumps(expected, ensure_ascii=False, allow_nan=False),
                                   stdout=subprocess.PIPE, stderr=errors, text=True,
                                   cwd=received, check=False)
        if child.returncode:
            raise RuntimeError("Original archived application cold reopening failed; full log " + str(log))
        try:
            opened = json.loads(child.stdout)
        except json.JSONDecodeError as error:
            (directory / "cold-opening.stdout.log").write_text(child.stdout, encoding="utf-8")
            raise ValueError("The archived receiver did not return its original opening result") from error
        if (opened.get("state") != "complete" or opened.get("study_id") != transferred["id"]
                or opened.get("scientific_report_edition_id") != edition["id"]
                or opened.get("project_id") != workspace.project["id"]):
            raise ValueError("The archived application returned a different assessment study")
        atomic_json(directory / "cold-opening.json", opened, immutable=True)
        checkpoint(
            "complete", state="complete", scientific_report_edition_id=edition["id"],
            report_files={role: {**item, "absolute_path": str(report_directory / item["path"])}
                          for role, item in report_files.items()},
            sources=choices, assessment_sources=assessments, report_archive=exported,
            selected_study={"id": transferred["id"], **describe_file(directory, archive)},
            received=opened, result_path=str(state_path),
            operator_selection={"sources": choices, "title": edition["title"]})
        return state


def add_arguments(parser):
    parser.add_argument("--report", action="store_true",
                        help="Continue this original source through saved report, Study export and cold reopening")
    parser.add_argument("--report-with-operation", action="append", default=[],
                        help="Append another completed NC/GA operation from the same project; repeat in report order")
    parser.add_argument("--report-selection",
                        help="Original ordered scientific report selection JSON; preserve and append assessment sources")
    parser.add_argument("--report-title")


def continue_operation(args, state):
    if not args.report:
        return state
    application, Workspace = _runtime(args.application)
    source = _read(args.report_selection) if args.report_selection else None
    result = complete(Workspace(args.workspace), [state, *args.report_with_operation],
                      Path(args.output) / "scientific-report", application=application,
                      selection=source, title=args.report_title)
    return {**state, "scientific_delivery": result}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", action="append", required=True,
                        help="Completed original NC/GA receiving JSON, in requested report order")
    parser.add_argument("--output", required=True)
    parser.add_argument("--selection", help="Preserve this original ordered scientific source selection")
    parser.add_argument("--title")
    args = parser.parse_args(argv)
    application, Workspace = _runtime(args.application)
    value = complete(Workspace(args.workspace), args.operation, args.output,
                     application=application, selection=_read(args.selection) if args.selection else None,
                     title=args.title)
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
