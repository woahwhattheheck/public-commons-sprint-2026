"""Receive the original WQP stations and activity events through bulk field intake.

This is an actual-source receiving workflow: three published stations, followed by
the same 88 published activity rows representing 48 station/date/time events.
It creates a separately named plan and leaves existing field/laboratory plans intact.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from model.common import (atomic_json, describe_file, digest, file_digest, held,
                          read_json, verify_file)
from model.implementation import ImplementationStore
from model.implementation_lab_results import _source
from model.implementation_schema import (ImplementationError, document_digest,
                                         make_plan)
from model.implementation_site_visit_intake import (
    EDITION as INTAKE_EDITION, import_site_visit_intake, preview_site_visit_intake)
from model.portable_implementation import report_edition
from model.workspace import Workspace

EDITION = "wqp-site-visit-receiving-20261013-v1"
SOURCE_DIRECTORY = Path("observations/eighteenmile_2023/wqp_20261013")
SOURCES = {
    "sites": {"filename": "three-lake-stations-original.csv", "bytes": 1764,
              "sha256": "85a33ed59d36327d6ec127e9d2f83cf688095103ef887b7ab1d408b45d4ec8e3"},
    "visits": {"filename": "three-lake-activities-2023-original.csv", "bytes": 32166,
               "sha256": "8118f52771b1bc87822e821f52c4980bdd8ab3471c8a5b790a9c8129ccf72f85"},
}


def _originals(source_root):
    result = {}
    for kind, expected in SOURCES.items():
        path = Path(source_root) / SOURCE_DIRECTORY / expected["filename"]
        source = _source(path, filename=expected["filename"])
        if any(source["source"][key] != expected[key] for key in ("bytes", "sha256")):
            raise ImplementationError("Select the exact retained original WQP " + kind + " CSV")
        result[kind] = {"path": path, "source": source}
    if len(result["sites"]["source"]["rows"]) != 3 or len(result["visits"]["source"]["rows"]) != 88:
        raise ImplementationError("The selected original WQP source counts differ")
    return result


def _mappings(originals):
    sites = {
        "schema": "upstate.implementation-site-visit-mapping/v1",
        "id_mode": "stable", "namespace": "WQP-21SC60WQ_WQX-stations",
        "coordinate_mode": "geographic", "crs_values": {"NAD83": "EPSG:4269"},
        "columns": {
            "id": "MonitoringLocationIdentifier", "label": "MonitoringLocationName",
            "latitude": "LatitudeMeasure", "longitude": "LongitudeMeasure",
            "coordinate_reference_system": "HorizontalCoordinateReferenceSystemDatumName",
            "notes": "MonitoringLocationDescriptionText",
        },
    }
    visits = {
        "schema": "upstate.implementation-site-visit-mapping/v1",
        "id_mode": "stable", "namespace": "WQP-21SC60WQ_WQX-original-collection-events",
        "site_binding": "source_id", "date_format": "iso",
        "time_zone_values": {"EST": "-05:00"},
        "columns": {
            "id": "ActivityIdentifier", "site_id": "MonitoringLocationIdentifier",
            "visited_date": "ActivityStartDate", "visited_time": "ActivityStartTime/Time",
            "utc_offset": "ActivityStartTime/TimeZoneCode",
        },
        "constants": {
            "status": "complete",
            "notes": "Historical collection event from the retained original WQP activity records.",
        },
        "row_actions": {},
    }
    events = {}
    for row in originals["visits"]["source"]["rows"]:
        cells = row["values"]
        event = [cells[name] for name in (
            "MonitoringLocationIdentifier", "ActivityStartDate",
            "ActivityStartTime/Time", "ActivityStartTime/TimeZoneCode")]
        if not all(value.strip() for value in event) or event[3] != "EST":
            raise ImplementationError("The original event's station, date, time or declared EST differs")
        key = digest(event)
        native_id = "wqp_visit_" + key[:24]
        visits["row_actions"][str(row["record"])] = {
            "action": "import", "id": native_id,
            "reason": "Group this actual station/date/time/EST event; retain every original activity row in the audit",
        }
        events.setdefault(key, {"id": native_id, "original_event": event,
                                "original_activity_identifiers": [], "csv_records": []})
        events[key]["original_activity_identifiers"].append(cells["ActivityIdentifier"])
        events[key]["csv_records"].append(row["record"])
    if len(events) != 48:
        raise ImplementationError("The original WQP activity source no longer identifies the expected 48 events")
    return {"sites": sites, "visits": visits}, list(events.values())


def _batch(workspace, base, kind, original, mapping, directory):
    inputs = [{"kind": kind, "path": original["path"],
               "filename": SOURCES[kind]["filename"], "mapping": mapping}]
    preview = preview_site_visit_intake(workspace, base, inputs)
    atomic_json(directory / (kind + "-preview.json"), preview, immutable=True)
    if not preview["can_import"]:
        raise ImplementationError("Original " + kind + " source review needs resolution; inspect its retained preview")
    expected = {"sites": {"append": 3, "identical": 0},
                "visits": {"append": 48, "identical": 40}}[kind]
    for status, count in expected.items():
        if preview["summary"][kind][status] != count:
            raise ImplementationError("The actual original " + kind + " mapping has different " + status + " coverage")
    result = import_site_visit_intake(
        workspace, base, inputs, expected_operation_id=preview["operation_id"],
        actor="source_tools.receive_wqp_sites_visits")
    if result["applied_revision"] != base["revision"] + 1:
        raise ImplementationError("The reviewed original batch did not commit exactly one native revision")
    return result


def _report(store, plan, directory):
    reports = directory / "reports"
    reports.mkdir(exist_ok=True)
    attempts = [path for path in reports.iterdir()
                if path.is_dir() and path.name.startswith("attempt-")
                and path.name[8:].isdigit()]
    for path in sorted(attempts):
        if not (path / "manifest.json").is_file():
            continue
        found = report_edition(store, path)
        if (found["plan_id"] != plan["id"] or found["revision"] != plan["revision"]
                or found["document_digest"] != document_digest(plan)):
            raise ImplementationError("A retained receiving report identifies another original plan revision")
        return store.retain_report(path)
    number = max((int(path.name[8:]) for path in attempts), default=0) + 1
    target = reports / ("attempt-%04d" % number)
    store.report(plan["id"], target, as_of="2023-10-17", revision=plan["revision"])
    return store.retain_report(target)


def receive(workspace, *, source_root=None):
    source_root = Path(source_root) if source_root is not None else Path(__file__).resolve().parents[1]
    originals = _originals(source_root)
    mappings, events = _mappings(originals)
    identity = {
        "schema": "upstate.wqp-site-visit-receiving/v1", "edition": EDITION,
        "intake_edition": INTAKE_EDITION, "project_id": workspace.project["id"],
        "sources": SOURCES, "mappings": mappings,
        "meaning": "Original historical station and collection-event onboarding in a separate native plan",
    }
    key = digest(identity)
    root = Path(workspace.root).resolve()
    directory = root / "implementation" / "site-visit-receiving" / key
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise ImplementationError("Keep this original receiving operation inside its Workspace")
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "receiving.lock"):
        atomic_json(directory / "identity.json", identity, immutable=True)
        atomic_json(directory / "mappings.json", mappings, immutable=True)
        atomic_json(directory / "original-event-groups.json", events, immutable=True)
        seed_path = directory / "seed-plan.json"
        if seed_path.exists():
            seed = read_json(seed_path)
        else:
            seed = make_plan(
                "eighteenmile-site-visit-" + key[:16],
                "Eighteenmile original stations and collection events",
                "2023-04-05",
                description="Original WQP 2023 sources received through reviewed site and visit CSV mappings.")
            seed["source_preparation"] = {
                "schema": "upstate.wqp-site-visit-source-preparation/v1",
                "identity": identity, "receiving_operation_id": key,
                "event_grouping": ["station identifier", "original date", "original time", "original time-zone code"],
                "time_interpretation": "Original EST is retained as fixed UTC-05:00, including summer dates",
            }
            atomic_json(seed_path, seed, immutable=True)
        if (seed.get("id") != "eighteenmile-site-visit-" + key[:16]
                or seed.get("source_preparation", {}).get("identity") != identity
                or any(seed.get(name) for name in ("sites", "visits", "activities", "observations"))):
            raise ImplementationError("The retained initial plan differs from this original-source receiving operation")
        store = ImplementationStore(workspace)
        store.import_document(seed, expected_revision=0, actor="source_tools.receive_wqp_sites_visits")
        base = store.get(seed["id"], 1)
        expected = dict(seed, revision=1)
        if document_digest(expected) != document_digest(base):
            raise ImplementationError("The original saved seed revision has different content")
        sites = _batch(workspace, base, "sites", originals["sites"], mappings["sites"], directory)
        visits = _batch(workspace, sites["plan"], "visits", originals["visits"], mappings["visits"], directory)
        final = visits["plan"]
        if (len(final["sites"]) != 3 or len(final["visits"]) != 48
                or final["activities"] or final["observations"]
                or any(row.get("coordinate_reference_system") != "EPSG:4269" for row in final["sites"])
                or any(row.get("status") != "complete" or not row["visited_at"].endswith("-05:00")
                       for row in final["visits"])):
            raise ImplementationError("The saved original source context differs from the selected actual records")
        atomic_json(directory / "applied-plan.json", final, immutable=True)
        report = _report(store, final, directory)
        report_path = Path(report["directory"])
        if not report_path.resolve().is_relative_to(root):
            raise ImplementationError("The retained original report leaves this Workspace")
        files = {}
        for path in sorted(directory.glob("*.json")):
            if path.name != "result.json":
                item = describe_file(root, path)
                files[item["path"]] = item
        for receipt in (sites, visits):
            for item in receipt["files"]:
                verify_file(root, item)
                files[item["path"]] = item
            path = root / receipt["receipt_path"]
            item = describe_file(root, path)
            files[item["path"]] = item
        for member in report["members"]:
            item = describe_file(root, report_path / member)
            files[item["path"]] = item
        result = {
            "schema": "upstate.wqp-site-visit-receiving-result/v1", "edition": EDITION,
            "operation_id": key, "project_id": workspace.project["id"],
            "plan_id": final["id"], "seed_revision": 1,
            "sites_applied_revision": sites["applied_revision"],
            "applied_revision": visits["applied_revision"],
            "document_digest": document_digest(final),
            "site_count": 3, "visit_count": 48, "original_activity_rows": 88,
            "repeated_event_rows_retained": 40,
            "site_import_operation_id": sites["operation_id"],
            "visit_import_operation_id": visits["operation_id"],
            "report": {**report, "directory": report_path.relative_to(root).as_posix()},
            "files": sorted(files.values(), key=lambda item: item["path"]),
            "result_path": (directory / "result.json").relative_to(root).as_posix(),
        }
        atomic_json(directory / "result.json", result, immutable=True)
        return {**result, "current_revision": store.get(final["id"])["revision"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--workspace-title", default="Eighteenmile original source onboarding")
    parser.add_argument("--source-root")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace, create=args.create_workspace, title=args.workspace_title)
    print(json.dumps(receive(workspace, source_root=args.source_root),
                     indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
