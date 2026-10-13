"""Complete the original WQP field case as a readable, portable scientific delivery.

Uses the native field receiver, immutable implementation revisions, evidence
package, observed source binding and complete Workspace backup/restore. The
reader tables preserve every original result and expose the original CSV record.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from decimal import Decimal
import json
from pathlib import Path
import shutil
import sys

APPLICATION_ROOT = Path(__file__).resolve().parents[1]
if str(APPLICATION_ROOT) not in sys.path:
    sys.path.insert(0, str(APPLICATION_ROOT))

from model.common import atomic_json, describe_file, digest, file_digest, held, read_json
from model.workspace import Workspace
from model.implementation import ImplementationStore
from model.implementation_schema import document_digest
from model.implementation_evidence import export_package, import_package, read_package
from model.observed_context import collect
from model.scientific_report import report_pdf, write_companions
from model.portable import backup, restore, inspect_archive
from source_tools.receive_wqp_field_results import receive, SOURCE_DIRECTORY, CASE_DIRECTORY

EDITION = "wqp-complete-delivery-20261013-v1"


def _table(columns, rows, widths=None):
    result = {"kind": "table", "columns": columns, "rows": rows}
    if widths:
        result["widths"] = widths
    return result


def _records(plan):
    """Read literal WQP fields carried by the native laboratory operation."""
    rows = []
    for observation in plan["observations"]:
        original = observation.get("lab_source", {})
        if not isinstance(original.get("original_row"), dict):
            raise ValueError("This reader requires the retained original WQP laboratory rows")
        row = original["original_row"]
        required = ("MonitoringLocationIdentifier", "CharacteristicName", "ActivityStartDate")
        if any(not row.get(key) for key in required):
            raise ValueError("An original WQP result lacks its station, characteristic or date")
        rows.append((observation, row, original["record"]))
    return rows


def reader_sections(plan):
    rows = _records(plan)
    sites = {s["id"]: s for s in plan["sites"]}
    dates = sorted({r["ActivityStartDate"] for _, r, _ in rows})
    counts = Counter(o["result_type"] for o, _, _ in rows)
    groups = defaultdict(list)
    for original in rows:
        o, r, record = original
        # Keep distinct source units, fractions and bases separate. Methods and
        # reporting limits remain per result rather than silently harmonized.
        key = tuple(r.get(k, "") for k in (
            "MonitoringLocationIdentifier", "CharacteristicName", "ResultMeasure/MeasureUnitCode",
            "ResultSampleFractionText", "ResultWeightBasisText", "ResultTimeBasisText",
            "ResultTemperatureBasisText", "ResultParticleSizeBasisText"))
        if not key[2]:
            key = (*key[:2], r.get("DetectionQuantitationLimitMeasure/MeasureUnitCode", ""), *key[3:])
        groups[key].append(original)
    summary = []
    for key, members in sorted(groups.items()):
        detected = [Decimal(r["ResultMeasureValue"]) for o, r, _ in members if o["result_type"] == "numeric"]
        limits = sorted({r.get("DetectionQuantitationLimitMeasure/MeasureValue", "") for _, r, _ in members} - {""}, key=Decimal)
        summary.append([key[0].split("-")[-1], key[1], str(len(members)),
                        str(sum(o["result_type"] == "censored" for o, _, _ in members)),
                        (str(min(detected)) + " to " + str(max(detected))) if detected else "No numeric result",
                        ", ".join(limits) or "Not recorded", key[2]])
    sections = [["Study coverage", [
        f"{len(rows)} original laboratory results from {len(groups)} station-and-characteristic groups. "
        f"The retained collection dates run from {dates[0]} through {dates[-1]} across {len(dates)} distinct dates. "
        f"The saved case contains {counts['numeric']} numeric results and {counts['censored']} results reported below a reporting limit.",
        "Each reader-table record number is the one-based data-record number in the original laboratory CSV, excluding the header. "
        "The complete CSV, original activity and station records, native plan revision and evidence archive accompany this report.",
        _table(["Station", "Characteristic", "Rows", "Below limit", "Numeric range", "Reporting limits", "Unit"],
               summary, [0.5, 2.5, 0.45, 0.6, 1.05, 1.0, 0.45]),
        "Ranges describe only the original numeric measurements in the displayed group. "
        "Below-limit results remain below-limit results and retain their individual limits. "
        "Collection times are reproduced in the source's stated time zone. These are individual sample results.",
    ]]]
    locations = []
    for site_id in sorted({key[0] for key in groups}):
        site = sites[site_id]
        original = site.get("original_station", {})
        locations.append([site_id, original.get("MonitoringLocationDescriptionText", site.get("label", "")),
                          original.get("LatitudeMeasure", str(site.get("latitude", ""))),
                          original.get("LongitudeMeasure", str(site.get("longitude", ""))),
                          original.get("HorizontalCoordinateReferenceSystemDatumName", site.get("coordinate_reference_system", ""))])
    sections.append(["Original monitoring locations", [_table(
        ["Station identifier", "Publisher description", "Latitude", "Longitude", "Source datum"],
        locations, [1.6, 2.8, 1.0, 1.0, 0.9])]])
    method_rows = {}
    for o, r, _ in rows:
        key = (r.get("ResultAnalyticalMethod/MethodIdentifierContext", ""), r.get("ResultAnalyticalMethod/MethodIdentifier", ""))
        value = [*key, r.get("ResultAnalyticalMethod/MethodName", "")]
        if key in method_rows and method_rows[key] != value:
            raise ValueError("A retained method identifier has inconsistent original descriptions")
        method_rows[key] = value
    sections.append(["Analytical methods", [_table(
        ["Method context", "Identifier", "Original method name"], list(method_rows.values()), [1.2, 0.8, 4.6]),
        "Per-result reporting limits and method identifiers appear together below. "
        "Full source result definitions, fractions, QA, activity identifiers and original time-zone codes are preserved in result-index.json and the original CSV.",
    ]])
    for key, members in sorted(groups.items()):
        site_id, parameter, unit, fraction, weight_basis, time_basis, temperature_basis, particle_basis = key
        detail = []
        for o, r, record in sorted(members, key=lambda x: (x[1]["ActivityStartDate"], x[1].get("ActivityStartTime/Time", ""), x[2])):
            when = r["ActivityStartDate"]
            time = " ".join(v for v in (r.get("ActivityStartTime/Time", ""), r.get("ActivityStartTime/TimeZoneCode", "")) if v)
            if time:
                when += "\n" + time
            limit_value = r.get("DetectionQuantitationLimitMeasure/MeasureValue", "")
            limit_unit = r.get("DetectionQuantitationLimitMeasure/MeasureUnitCode", "")
            if limit_value and limit_unit and limit_unit != unit:
                limit_value += " " + limit_unit
            detail.append([str(record), when, r.get("ResultMeasureValue", "") or "Not reported",
                           r.get("ResultDetectionConditionText", "") or "Not recorded",
                           limit_value or "Not recorded", r.get("ResultAnalyticalMethod/MethodIdentifier", "")])
        definitions = "; ".join(f"{label}: {value}" for label, value in (
            ("Fraction", fraction), ("Weight basis", weight_basis), ("Time basis", time_basis),
            ("Temperature basis", temperature_basis), ("Particle-size basis", particle_basis)) if value)
        sections.append([site_id + " | " + parameter, [
            definitions or "Source measurement definitions are retained in result-index.json.",
            _table(["CSV record", "Collected, source time", "Reported value (" + unit + ")", "Original condition",
                    "Reporting limit (" + unit + ")", "Method"], detail,
                   [0.65, 1.3, 0.9, 1.75, 1.0, 0.65]),
        ]])
    sections.append(["Original data and saved work", [{"kind": "links", "items": [
        {"title": "Complete original laboratory results", "path": "sources/three-lake-results-2023-original.csv"},
        {"title": "Original monitoring locations", "path": "sources/three-lake-stations-original.csv"},
        {"title": "Original activities", "path": "sources/three-lake-activities-2023-original.csv"},
        {"title": "Every source field and its native observation", "path": "result-index.json"},
        {"title": "Portable original field evidence", "path": "field-evidence.zip"},
    ]}]])
    return sections


def complete(workspace_path, output, *, create_workspace=False, source_directory=SOURCE_DIRECTORY,
             case_directory=CASE_DIRECTORY, actor=""):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    # This lock is outside the Workspace, so the original portable snapshot may
    # independently acquire its complete Workspace lock set.
    with held(output / "operation.lock", blocking=False):
        result_file = output / "result.json"
        if result_file.is_file():
            existing = read_json(result_file)
            if Workspace(workspace_path).project != existing["project"]:
                raise ValueError("This output belongs to another original Workspace")
            for field in ("customer_archive", "workspace_archive"):
                item = existing[field]
                path = output / item["filename"]
                if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
                    raise ValueError("Completed delivery archive differs from its saved identity")
            return existing
        intake_path = output / "intake.json"
        if intake_path.exists():
            intake = read_json(intake_path)
            if Workspace(workspace_path).project["id"] != intake["identity"]["workspace_id"]:
                raise ValueError("Retained intake belongs to another original Workspace")
        else:
            intake = receive(Path(workspace_path), Path(source_directory), Path(case_directory),
                             actor=actor, create_workspace=create_workspace)
            atomic_json(intake_path, intake)
        workspace = Workspace(workspace_path)
        store = ImplementationStore(workspace)
        plan = store.get(intake["plan_id"], intake["applied_revision"])
        history = store.history(plan["id"])
        operation_id = digest({"edition": EDITION, "workspace_id": workspace.project["id"],
                               "plan_id": plan["id"], "revision": plan["revision"],
                               "document_digest": document_digest(plan)})
        customer = workspace.root / "observation-deliveries" / operation_id / "customer"
        customer.mkdir(parents=True, exist_ok=True)
        evidence = export_package(store, plan["id"], revision=plan["revision"])
        original_package = store.root / evidence["reference"]
        opened = read_package(original_package)
        if opened["plan"] != plan:
            raise ValueError("Evidence handover changed the selected native plan")
        back = import_package(store, original_package, expected_revision=plan["revision"],
                              expected_plan_id=plan["id"], actor=actor)
        if back["status"] != "unchanged" or store.get(plan["id"]) != plan or store.history(plan["id"]) != history:
            raise ValueError("Evidence receiving changed the selected plan or history")
        manifest_path = customer / "DELIVERY.json"
        if manifest_path.exists():
            previous = read_json(manifest_path)
            if (previous["operation_id"] != operation_id or
                    previous["workspace_id"] != workspace.project["id"] or
                    previous["revision"] != plan["revision"]):
                raise ValueError("The retained reader edition belongs to another field operation")
            for name, item in previous["files"].items():
                path = customer / name
                if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
                    raise ValueError("An original reader file changed: " + name)
        else:
            shutil.copyfile(original_package, customer / "field-evidence.zip")
            original_sources = customer / "sources"
            original_sources.mkdir(exist_ok=True)
            records = []
            for source in plan["source_links"]:
                if source["kind"] != "original_public_observation_source":
                    continue
                path = Path(source_directory) / source["filename"]
                if file_digest(path) != source["sha256"]:
                    raise ValueError("Original public observation source changed")
                shutil.copyfile(path, original_sources / path.name)
                records.append({"id": source["id"], "title": source["label"],
                                "vintage": "2023 sampling; original retained publisher response",
                                "uri": source["reference"], "publisher_uri": source.get("source_uri", ""),
                                "sha256": source["sha256"]})
            selection = read_json(workspace.root / intake["observed_report_source"]["delivery_selection_path"])
            source_product = collect(workspace, selection, customer, {})
            atomic_json(customer / "original-report-blocks.json", source_product)
            atomic_json(customer / "result-index.json", {"schema": "upstate.wqp-reader-records/v1",
                "plan_id": plan["id"], "revision": plan["revision"], "document_digest": document_digest(plan),
                "original_csv_sha256": intake["identity"]["original_source_hashes"]["results"],
                "record_numbering": "One-based original CSV data record, excluding header",
                "records": [{"csv_record": record, "observation_id": o["id"], "result_type": o["result_type"],
                             "original_row": r} for o, r, record in _records(plan)]})
            sections = reader_sections(plan)
            title = "Eighteenmile 2023: original lake-sample study"
            write_companions(customer, title, sections, contact={}, source_records=records,
                             binding=source_product["binding"])
            html = customer / "report.html"
            html.write_text(html.read_text().replace(
                "Scientific model results, scenario changes and retained source editions.",
                "Original measured concentrations, collection support and retained source editions."), encoding="utf-8")
            report_pdf(customer / "report.pdf", title, sections, contact={}, source_records=records)
            (customer / "README.md").write_text(
                "# Eighteenmile 2023 original observations\n\n"
                "Open report.html for the complete reader edition, or report.pdf for printing. "
                "The report displays every original result and its CSV record. sources/ retains "
                "the original three CSVs; result-index.json retains all original result fields.\n\n"
                "field-evidence.zip is the native implementation-evidence package for the selected revision. "
                "The accompanying complete Workspace ZIP includes the application, saved revisions, "
                "observation registry, report bindings, reports and original attachments. Restore it into a new directory with:\n\n"
                "```sh\npython application/model/cli.py restore WORKSPACE_ARCHIVE.zip NEW_DIRECTORY\n```\n\n"
                "The restored application opens the original project and immutable plan history. "
                "Use ImplementationStore(Workspace(path)) for native field access.\n", encoding="utf-8")
            fields = {str(p.relative_to(customer)): {"bytes": p.stat().st_size, "sha256": file_digest(p)}
                      for p in sorted(customer.rglob("*")) if p.is_file() and p.name != "DELIVERY.json"}
            atomic_json(customer / "DELIVERY.json", {"schema": "upstate.wqp-customer-delivery/v1",
                "operation_id": operation_id, "workspace_id": workspace.project["id"],
                "plan_id": plan["id"], "revision": plan["revision"], "observations": len(plan["observations"]),
                "binding": source_product["binding"], "files": fields})
        customer_archive = output / "Eighteenmile_Original_Observations.zip"
        import zipfile
        import hashlib
        if customer_archive.exists():
            expected = {x.relative_to(customer).as_posix(): x for x in customer.rglob("*") if x.is_file()}
            with zipfile.ZipFile(customer_archive) as archive:
                if len(archive.namelist()) != len(expected) or set(archive.namelist()) != set(expected):
                    raise ValueError("Retained customer archive has different members")
                for name, path in expected.items():
                    if hashlib.sha256(archive.read(name)).hexdigest() != file_digest(path):
                        raise ValueError("Retained customer archive has a different original member: " + name)
        else:
            with zipfile.ZipFile(customer_archive, "x", zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(customer.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(customer).as_posix())
        workspace_archive = output / "Eighteenmile_Complete_Workspace.zip"
        capture_path = output / "workspace-capture.json"
        if workspace_archive.exists():
            manifest = inspect_archive(workspace_archive, verify=False)
            if manifest["project"] != workspace.project:
                raise ValueError("Retained complete archive belongs to another project")
            captured = {"bytes": workspace_archive.stat().st_size, "sha256": file_digest(workspace_archive),
                        "members": len(manifest["members"])}
            if capture_path.exists():
                saved = read_json(capture_path)
                if any(saved[k] != captured[k] for k in captured):
                    raise ValueError("Retained complete archive changed after original capture")
        else:
            captured = backup(workspace, workspace_archive)
        atomic_json(capture_path, captured)
        receiving = output / "received"
        receiving_path = output / "workspace-receiving.json"
        if receiving.exists():
            returned = (read_json(receiving_path) if receiving_path.exists() else
                        {"recovered_existing_directory": str(receiving)})
        else:
            returned = restore(workspace_archive, receiving)
            atomic_json(receiving_path, returned)
        reopened = Workspace(receiving / "workspace")
        received_store = ImplementationStore(reopened)
        source_history = [{k: v for k, v in event.items() if k != "revision_ref"} for event in history]
        received_history = [{k: v for k, v in event.items() if k != "revision_ref"}
                            for event in received_store.history(plan["id"])]
        if reopened.project != workspace.project or received_store.get(plan["id"]) != plan or received_history != source_history:
            raise ValueError("The independently received Workspace differs from the delivered original")
        attachments = [x for x in plan["source_links"] if x["kind"] == "local_file"]
        for original in attachments:
            if file_digest(reopened.root / original["reference"]) != original["sha256"]:
                raise ValueError("The independently received original attachment differs")
        result = {"schema": "upstate.wqp-complete-delivery/v1", "state": "COMPLETE", "edition": EDITION,
            "operation_id": operation_id, "project": workspace.project, "plan_id": plan["id"],
            "revision": plan["revision"], "document_digest": document_digest(plan),
            "counts": dict(Counter(o["result_type"] for o in plan["observations"])),
            "customer_directory": str(customer), "source_receiver": intake, "evidence_export": evidence,
            "evidence_roundtrip": {"status": back["status"], "plan_and_history_preserved": True},
            "customer_archive": {"filename": customer_archive.name, "bytes": customer_archive.stat().st_size,
                                 "sha256": file_digest(customer_archive)},
            "workspace_archive": {"filename": workspace_archive.name, **{k: captured[k] for k in ("bytes", "sha256", "members")}},
            "independent_receiving": {"project_and_history_preserved": True, "observations": len(plan["observations"]),
                                      "original_attachments": len(attachments), "native_result": returned},
            "report": describe_file(customer, customer / "report.pdf")}
        atomic_json(result_file, result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--source-directory", type=Path, default=SOURCE_DIRECTORY)
    parser.add_argument("--case-directory", type=Path, default=CASE_DIRECTORY)
    parser.add_argument("--actor", default="")
    options = parser.parse_args()
    result = complete(options.workspace, options.output, create_workspace=options.create_workspace,
                      source_directory=options.source_directory, case_directory=options.case_directory, actor=options.actor)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
