"""Original Sampling receiver's saved-observation continuation.

This module is called by receive_sampling_recommendations.py. It prepares no
landscape model and imports no substitute measurements or inferred geometry.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from model.common import atomic_json, file_digest, held, read_json, verify_file
from model.workspace import Workspace
from model import monitoring_recommendations as recommendations
from model import monitoring_observed_context as observed
from model import monitoring_native_observations as native
from model import portable, study_transfer
from model.monitoring_network import build_network
from model.monitoring_sources import read_source, verify_retained_binding
from model.monitoring_workspace import MonitoringWorkspace


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _retain(path, value):
    atomic_json(path, value, immutable=True)


def _source_input(path):
    """Bind an existing source package before any native import."""
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("Select the complete original observation source file")
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path)}


def _original_package(path, course):
    """Read exact original members without extracting untrusted archive paths."""
    from zipfile import ZipFile
    expected = course["observation_original"]
    suffix = "source/temporal-workspace-observations/"
    with ZipFile(path) as archive:
        def member(name, descriptor):
            matches = [item for item in archive.infolist()
                       if item.filename == suffix + name
                       or item.filename.endswith("/" + suffix + name)]
            if len(matches) != 1:
                raise ValueError("The original source package needs exactly one " + name)
            item = matches[0]
            if (item.is_dir() or item.file_size != descriptor["bytes"]
                    or item.flag_bits & 1):
                raise ValueError("The original source member has a different size or is encrypted")
            body = archive.read(item)
            if hashlib.sha256(body).hexdigest() != descriptor["sha256"]:
                raise ValueError("The original source member differs: " + name)
            return body, item.filename
        record_bytes, record_member = member("original-workspace-record.json",
            expected["record_snapshot"])
        csv_bytes, csv_member = member("original.csv", expected)
    record = json.loads(record_bytes)
    if (not isinstance(record, dict) or record.get("id") != course["observation_id"]
            or record.get("schema") != "upstate.observations/v1"
            or not isinstance(record.get("metadata"), dict)
            or not isinstance(record.get("rows"), list)):
        raise ValueError("The source package does not contain this original observation record")
    from model.common import digest
    if digest({key: value for key, value in record.items() if key != "id"}) != record["id"]:
        raise ValueError("The retained original observation identity does not verify")
    original = record.get("original", {})
    if any(original.get(key) != expected[key] for key in ("bytes", "sha256")):
        raise ValueError("The original record names another source CSV")
    filename = original.get("filename", "original.csv")
    if not isinstance(filename, str) or Path(filename).name != filename or filename in ("", ".", ".."):
        raise ValueError("The original source filename must be one ordinary basename")
    return {
        "kind": "original_package", "csv": csv_bytes, "filename": filename,
        "metadata": copy.deepcopy(record["metadata"]), "rows": record["rows"],
        "columns": record["columns"],
        "provenance": {"original_record": record, "original_record_text": record_bytes.decode("utf-8"),
                       "original_record_member": record_member, "original_csv_member": csv_member},
    }


def _extracted_source(path, course):
    """Verify an explicit extracted table against the complete retained native source."""
    packet = json.loads(Path(path).read_text(encoding="utf-8"))
    if (not isinstance(packet, dict)
            or packet.get("schema") != "upstate.sampling-extracted-native-observations/v1"
            or packet.get("original_observation_id") != course["observation_id"]
            or packet.get("original_project_id") != course["project_id"]):
        raise ValueError("The extracted table names another original observation source")
    source_text = packet.get("source_packet_text")
    if not isinstance(source_text, str):
        raise ValueError("Retain the complete original source packet with the extracted table")
    source_bytes = source_text.encode("utf-8")
    if hashlib.sha256(source_bytes).hexdigest() != course["source_data"]["metadata_sha256"]:
        raise ValueError("The extracted table's original source packet differs")
    original = json.loads(source_text)
    if (original.get("project_id") != course["project_id"]
            or original.get("native", {}).get("observation_id") != course["observation_id"]):
        raise ValueError("The original source packet belongs to another observation")
    records = original["original_analysis"]["records"]
    if len(records) != course["observation_original"]["row_count"]:
        raise ValueError("The complete original observation roster is required")
    rows = []
    for row in sorted(records, key=lambda value: value["source_csv_row"]):
        raw = row.get("raw")
        if (not isinstance(raw, dict) or str(raw.get("id")) != str(row["original_record_id"])
                or raw.get("line") != row["source_csv_row"]
                or raw.get("original") != row.get("original_cells")):
            raise ValueError("The original source packet lost its raw row correspondence")
        rows.append(copy.deepcopy(raw))
    csv_info = packet.get("csv", {})
    if not isinstance(csv_info.get("text"), str):
        raise ValueError("The extracted source must include the complete CSV text")
    body = csv_info["text"].encode("utf-8")
    if len(body) != csv_info.get("bytes") or hashlib.sha256(body).hexdigest() != csv_info.get("sha256"):
        raise ValueError("The extracted CSV does not match its retained descriptor")
    metadata = packet.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("Retain the explicitly selected native import metadata")
    if metadata.get("columns") != original["source_store"]["original_import_mapping"]:
        raise ValueError("The extracted source changed its original column mapping")
    if (metadata.get("source_uri") != records[0]["source_references"][0]["uri"]
            or not metadata.get("title") or metadata.get("value_basis") == "annual_mass_rate"):
        raise ValueError("Retain the original source URI and observation quantity")
    # These are original native support declarations, not new scientific choices.
    supports = {"observation_kind": "context_kind", "time_support": "time_support",
                "measurement_support": "measurement_support", "quantity_basis": "quantity_basis"}
    for key, raw_key in supports.items():
        values = {json.dumps(row.get(raw_key), sort_keys=True) for row in rows}
        if len(values) != 1 or metadata.get(key) != rows[0].get(raw_key):
            raise ValueError("The extracted import changed or pooled original support: " + key)
    supplied_original = packet.get("provenance", {}).get("original_csv", {})
    if any(supplied_original.get(key) != course["observation_original"][key]
           for key in ("bytes", "sha256")):
        raise ValueError("The extracted table lost its different original CSV identity")
    filename = csv_info.get("filename")
    if (not isinstance(filename, str) or Path(filename).name != filename
            or filename in ("", ".", "..")):
        raise ValueError("The extracted source filename must be one ordinary basename")
    return {"kind": "extracted_original_cells", "csv": body, "filename": filename,
            "metadata": copy.deepcopy(metadata), "rows": rows, "columns": csv_info["columns"],
            "provenance": {
                "original_source_packet": {"bytes": len(source_bytes),
                    "sha256": hashlib.sha256(source_bytes).hexdigest(),
                    "git_blob": course["source_data"]["metadata_blob"]},
                "original_native_rows": rows,
                "extraction": copy.deepcopy(packet.get("provenance", {})),
                "original_import_mapping": copy.deepcopy(original["source_store"]["original_import_mapping"]),
            }}


def _source_rows(source):
    """Require a complete cell-by-cell correspondence before native publication."""
    import csv
    import io
    table = csv.DictReader(io.StringIO(source["csv"].decode("utf-8-sig")))
    if (table.fieldnames != source["columns"]
            or len(table.fieldnames or []) != len(set(table.fieldnames or []))):
        raise ValueError("The retained source CSV changed its complete column inventory")
    rows = list(table)
    originals = sorted(source["rows"], key=lambda value: value["line"])
    if (len(rows) != len(originals)
            or len({str(row["id"]) for row in originals}) != len(originals)
            or len({row["line"] for row in originals}) != len(originals)):
        raise ValueError("The source must preserve every unique original row")
    for cells, row in zip(rows, originals):
        if None in cells or cells != row["original"]:
            raise ValueError("The source CSV changed an original cell or row order")
    return originals


def _row_correspondence(originals, imported):
    """Bind actual returned row identities without copying donor IDs into a new record."""
    if len(originals) != len(imported):
        raise ValueError("The native import omitted an original row")
    result = []
    actuals = sorted(imported, key=lambda value: value["line"])
    if len({str(row["id"]) for row in actuals}) != len(actuals):
        raise ValueError("The native import returned repeated row identities")
    fields = ("station_id", "catchment_id", "parameter", "original_parameter",
              "value_text", "unit", "qualifier", "period_start", "period_end",
              "method", "species", "context_kind", "measurement_support", "quantity_basis", "time_support")
    for old, new in zip(originals, actuals):
        if old["original"] != new["original"]:
            raise ValueError("Native import changed original observation cells")
        for key in fields:
            if (key in old) != (key in new) or old.get(key) != new.get(key):
                raise ValueError("Native import changed original observation support: " + key)
        result.append({"original_record_id": str(old["id"]), "source_csv_row": old["line"],
                       "imported_record_id": str(new["id"]), "imported_csv_row": new["line"]})
    return result


def _recover_source(workspace, course, input_path, output):
    """Use normal native intake for a genuine retained source; preserve all authored choices."""
    from model.common import atomic_bytes
    from zipfile import is_zipfile
    if workspace.project["id"] != course["project_id"]:
        raise ValueError("The original observation source belongs to another project")
    descriptor = _source_input(input_path)
    source = (_original_package(input_path, course) if is_zipfile(input_path)
              else _extracted_source(input_path, course))
    originals = _source_rows(source)
    if _source_input(input_path) != descriptor:
        raise ValueError("The original source input changed during intake")
    if len(originals) != course["observation_original"]["row_count"]:
        raise ValueError("The original source package does not contain all authored rows")
    provenance = {"schema": "upstate.original-observation-source-recovery/v1",
        "kind": source["kind"], "original_project_id": course["project_id"],
        "original_observation_id": course["observation_id"],
        "original_csv": copy.deepcopy(course["observation_original"]),
        "received_input": {key: descriptor[key] for key in ("bytes", "sha256")},
        **source["provenance"]}
    # Preserve an already complete donor observation exactly. A missing object can
    # instead be recovered through the ordinary import below.
    existing = workspace.root / "observations" / (course["observation_id"] + ".json")
    imported = None
    receipt_path = output / "original-source-import.json"
    if receipt_path.exists():
        saved = read_json(receipt_path)
        if (saved.get("input") != descriptor
                or saved.get("original_project_id") != course["project_id"]
                or saved.get("original_observation_id") != course["observation_id"]
                or saved.get("original_course_sha256") != hashlib.sha256(_canonical(course)).hexdigest()):
            raise ValueError("The saved source import belongs to another input or authored course")
        imported = workspace._get("observations", saved["observation_id"])
        if hashlib.sha256(_canonical(imported)).hexdigest() != saved["imported_record_sha256"]:
            raise ValueError("The actual saved source import changed")
        verify_file(workspace.root, {**imported["original"], "path": imported["original"]["object"]})
    else:
        # Freeze reuse versus normal import before the latter can restore a donor
        # CAS object. A lost acknowledgement must not change this native choice.
        intent_path = output / "original-source-import-intent.json"
        binding = {"schema": "upstate.sampling-original-source-import-intent/v1",
            "input": descriptor, "original_project_id": course["project_id"],
            "original_observation_id": course["observation_id"],
            "original_course_sha256": hashlib.sha256(_canonical(course)).hexdigest()}
        if intent_path.exists():
            intent = read_json(intent_path)
            if (not isinstance(intent, dict)
                    or any(intent.get(key) != value for key, value in binding.items())
                    or intent.get("mode") not in ("reuse_original", "native_import")):
                raise ValueError("The saved source import intent belongs to another input or course")
        else:
            mode = "native_import"
            if existing.is_file():
                candidate = workspace._get("observations", course["observation_id"])
                original = candidate.get("original", {})
                if (workspace.root / original.get("object", "")).is_file():
                    imported = _original(workspace, course)
                    mode = "reuse_original"
            intent = {**binding, "mode": mode}
            _retain(intent_path, intent)
        if intent["mode"] == "reuse_original":
            imported = _original(workspace, course)
    if imported is None:
        metadata = copy.deepcopy(source["metadata"])
        if "original_observation_recovery" in metadata:
            raise ValueError("The original metadata already defines a source-recovery field")
        metadata["original_observation_recovery"] = provenance
        # The source hash describes the actual imported file. Its different
        # upstream CSV, if extracted, remains explicitly retained in provenance.
        metadata["sha256"] = hashlib.sha256(source["csv"]).hexdigest()
        source_dir = output / "received-original-source"
        source_dir.mkdir(parents=True, exist_ok=True)
        retained = source_dir / source["filename"]
        atomic_bytes(retained, source["csv"], immutable=True)
        imported = workspace.import_observations(retained, metadata)
    mapping = _row_correspondence(originals, imported["rows"])
    actual = copy.deepcopy(course)
    actual["observation_id"] = imported["id"]
    snapshot = _canonical(imported)
    actual["observation_original"] = {
        "bytes": imported["original"]["bytes"], "sha256": imported["original"]["sha256"],
        "row_count": len(imported["rows"]),
        "record_snapshot": {"bytes": len(snapshot), "sha256": hashlib.sha256(snapshot).hexdigest(),
                            "encoding": "JSON sorted keys, compact separators, UTF-8"}}
    lookup = {row["original_record_id"]: row["imported_record_id"] for row in mapping}
    for target in actual["sampling"]["targets"]:
        target["original_row_ids"] = [lookup[key] for key in target["original_row_ids"]]
    recovery = {"schema": "upstate.sampling-original-source-import/v1",
        "input": descriptor, "kind": source["kind"],
        "original_project_id": course["project_id"],
        "original_observation_id": course["observation_id"],
        "observation_id": imported["id"], "original_csv": course["observation_original"],
        "imported_csv": imported["original"], "row_correspondence": mapping,
        "original_course_sha256": hashlib.sha256(_canonical(course)).hexdigest(),
        "imported_record_sha256": hashlib.sha256(snapshot).hexdigest(),
        "reused_original_observation": imported["id"] == course["observation_id"]}
    if imported["id"] != course["observation_id"]:
        actual["source_recovery"] = copy.deepcopy(recovery)
    _retain(output / "original-source-import.json", recovery)
    _retain(output / "source-bound-course.json", actual)
    _original(workspace, actual)
    return actual, imported, recovery


def _original(workspace, course):
    if workspace.project["id"] != course["project_id"]:
        raise ValueError("The authored observation course names another original project")
    value = workspace._get("observations", course["observation_id"])
    expected = course["observation_original"]
    original = verify_file(workspace.root,
        {**value["original"], "path": value["original"]["object"]})
    if original.stat().st_size != expected["bytes"] or file_digest(original) != expected["sha256"]:
        raise ValueError("The saved observations differ from the authored original CSV")
    if len(value["rows"]) != expected["row_count"]:
        raise ValueError("The authored source's complete original row count differs")
    keys = [str(row["id"]) for row in value["rows"]]
    if len(set(keys)) != len(keys):
        raise ValueError("Original observation row identities are not unique")
    snapshot = expected.get("record_snapshot")
    if snapshot:
        body = _canonical(value)
        if len(body) != snapshot["bytes"] or hashlib.sha256(body).hexdigest() != snapshot["sha256"]:
            raise ValueError("The complete original native observation record differs")
    return value


def _network(workspace, course, output):
    choice = course["network"]
    service = MonitoringWorkspace(workspace)
    saved = output / "native-network.json"
    if saved.exists():
        value = read_json(saved)
        if service.get("networks", value["id"]) != value:
            raise ValueError("The retained receiving network changed")
        for binding in value["source_bindings"].values():
            if binding:
                verify_retained_binding(workspace, binding)
    else:
        domain, domain_binding = read_source(workspace, choice["domain_source_id"],
            collection_id=choice["domain_collection_id"])
        stations, station_binding = read_source(workspace, choice["station_source_id"],
            collection_id=choice["station_collection_id"])
        for binding, expected in ((domain_binding, choice["domain_expected"]),
                                  (station_binding, choice["station_expected"])):
            if binding["bytes"] != expected["bytes"] or binding["object_sha256"] != expected["sha256"]:
                raise ValueError("The original network source bytes differ from the authored selection")
        # The original import_network path uses this same reader, builder and
        # writer. Pin its authored timestamp so a lost acknowledgement cannot
        # create another network merely because the wall clock advanced.
        value = build_network(domain, stations,
            source_bindings={"domain": domain_binding, "stations": station_binding},
            title=choice["title"], **choice["options"])
        value["created_at"] = course["recorded_at"]
        value = service.save("networks", value)
        _retain(saved, value)
    if value["title"] != choice["title"] or value["created_at"] != course["recorded_at"]:
        raise ValueError("The saved network belongs to a different authored request")
    for role, prefix in (("domain", "domain"), ("stations", "station")):
        binding = value["source_bindings"][role]
        expected = choice[prefix + "_expected"]
        if (binding["source_collection_id"] != choice[prefix + "_collection_id"]
                or binding["source_id"] != choice[prefix + "_source_id"]
                or binding["bytes"] != expected["bytes"]
                or binding["object_sha256"] != expected["sha256"]):
            raise ValueError("The saved network lost its exact original source binding")
    expected_station = choice["required_station"]
    matches = [row for row in value["stations"] if row["id"] == expected_station["id"]]
    if len(matches) != 1:
        raise ValueError("The real source station is absent or ambiguous in the native network")
    station = matches[0]
    if (station["geometry"] != expected_station["geometry"]
            or station["huc_id"] != expected_station["huc_id"]
            or station["outlet_verified"] != expected_station["outlet_verified"]
            or station["assignment"] != "unique-spatial-match"):
        raise ValueError("The original polygon/point reader did not confirm the authored station support")
    return value


def _verify_context(workspace, course, source, network, context):
    if observed.inspect(workspace, context["id"]) != context:
        raise ValueError("The saved concentration context differs from its retained original source")
    if context["network_id"] != network["id"] or context["station_mapping"] != course["context"]["station_mapping"]:
        raise ValueError("The context lost its explicit original station/network selection")
    rows = context.get("observations", [])
    expected = course["context"]["expected"]
    if len(rows) != expected["source_observations"]:
        raise ValueError("This authored receiving course requires all original observation rows")
    originals = {str(row["id"]): row for row in source["rows"]}
    seen = set()
    for row in rows:
        key = str(row["original_record_id"])
        if (key in seen or key not in originals
                or row["original_observation_id"] != source["id"]
                or row["original_cells"] != originals[key]["original"]
                or row["station_id"] != originals[key]["station_id"]):
            raise ValueError("A context row changed its original source, row, cells or station")
        seen.add(key)
    if seen != set(originals):
        raise ValueError("The concentration context omitted an original source row")
    if (sum(row["status"] == "below_limit" for row in rows) != expected["censored_observations"]
            or sum(not row.get("unit") for row in source["rows"]) != expected["original_missing_measurement_units"]
            or context.get("excluded_observations")):
        raise ValueError("The explicit source qualifier/unit choices did not preserve this complete original course")
    for row in rows:
        if not originals[str(row["original_record_id"])].get("unit"):
            if not row.get("unit_origin") or row["unit"] != row["limit_unit"]:
                raise ValueError("An absent measurement unit lost its explicit original reporting-limit basis")
    if expected.get("no_flow"):
        scope = context.get("flow_scope") or {}
        if (scope.get("mode") != "unavailable"
                or context.get("flow_availability", {}).get("status") != "not_received"
                or context["summary"]["source_gauge_days"] != 0
                or context.get("high_flow_episodes")):
            raise ValueError("The concentration-only course acquired undeclared gauge/event evidence")
    if context["summary"]["matched_stations"] != expected["selected_station_count"]:
        raise ValueError("The original station match count changed")
    return rows


def _selection(workspace, course, context):
    view = recommendations.context(workspace, context["id"])
    groups = {}
    for row in context["observations"]:
        key, fields = recommendations._cohort(row)
        group = groups.setdefault(key, {"fields": fields, "rows": set()})
        group["rows"].add(str(row["original_record_id"]))
    selected, resolutions = [], []
    for choice in course["sampling"]["targets"]:
        wanted = set(choice["original_row_ids"])
        if len(wanted) != len(choice["original_row_ids"]):
            raise ValueError("The authored target repeats an original row identity")
        matches = [(key, group) for key, group in groups.items() if group["rows"] == wanted]
        if len(matches) != 1:
            raise ValueError("The full original row roster does not identify exactly one native cohort: " + choice["id"])
        cohort_id, group = matches[0]
        declared = choice["expected_source_cohort"]
        expected_fields = {
            "characteristic": declared["parameter"], "method": declared["method"],
            "unit": declared["unit"], "fraction": declared["fraction"],
            "speciation": declared["speciation"], "method_context": declared["method_authority"],
            "depth_value": declared["depth"], "depth_unit": declared["depth_unit"],
            "value_type": declared["value_type"],
        }
        if len(declared["project_ids"]) != 1:
            raise ValueError("The authored target must retain one exact original programme")
        expected_fields["project_id"] = declared["project_ids"][0]
        if any(group["fields"][key] != {"present": True, "value": value}
               for key, value in expected_fields.items()):
            raise ValueError("The native cohort changed an authored original scientific dimension")
        target = copy.deepcopy(choice["target"])
        target["cohort_id"] = cohort_id
        if target["station_id"] != choice["source_station_id"]:
            raise ValueError("The authored target changed its original source station")
        selected.append(target)
        resolutions.append({"target_id": target["id"], "cohort_id": cohort_id,
            "fields": group["fields"], "original_row_ids": sorted(wanted),
            "authored_source_cohort": choice["expected_source_cohort"]})
    value = {key: copy.deepcopy(course["sampling"][key]) for key in
             ("title", "operator", "planning_basis", "notes", "evidence_start", "evidence_end")}
    value.update(context_id=context["id"], recorded_at=course["recorded_at"], targets=selected)
    return value, resolutions, view


def _assert_counts(course, proposal):
    expected = course["sampling"]["expected"]
    if (len(proposal["targets"]) != expected["targets"]
            or sum(row["evidence"]["observations"] for row in proposal["targets"]) != expected["winter_observations"]
            or proposal["summary"]["missing_dates_to_operator_goal"] != expected["missing_dates_to_operator_goal"]):
        raise ValueError("Native Sampling counts differ from the exact authored original-row calculation")
    for actual, authored in zip(proposal["targets"], course["sampling"]["targets"]):
        if actual["target_id"] != authored["id"]:
            raise ValueError("The original target order changed")
        expected_months = authored["independent_original_counts"]["months"]
        actual_months = actual["evidence"]["monthly"]
        if len(actual_months) != len(expected_months):
            raise ValueError("The selected historical month roster changed")
        for received, original in zip(actual_months, expected_months):
            if (received["month"] != original["month"]
                    or received["dates"] != original["distinct_dates"]
                    or len(received["observation_ids"]) != original["observations"]):
                raise ValueError("Native Sampling changed the original dates or duplicate-row accounting")
        if actual["evidence"]["flow_scope_eligible"] or actual["evidence"]["high_flow_episodes"]:
            raise ValueError("The authored concentration-only target acquired flow/event applicability")
        if actual["cost"]["total_cents"] is not None:
            raise ValueError("The unknown original full assay costs became an invented price")
        if "model_evidence" in actual or "model_evidence" in actual["target"]:
            raise ValueError("The authored course did not select a native landscape report")


def verify_received(workspace, expected):
    from source_tools.receive_sampling_recommendations import _verify_evidence_received
    base = _verify_evidence_received(workspace, expected)
    course = expected["authored_course"]
    source = _original(workspace, course)
    network = MonitoringWorkspace(workspace).get("networks", expected["network"]["id"])
    context = observed.inspect(workspace, expected["context"]["id"])
    if network != expected["network"] or context != expected["context"]:
        raise ValueError("The cold copy changed the original editable network or concentration context")
    _verify_context(workspace, course, source, network, context)
    proposal = recommendations.inspect(workspace, expected["proposal"]["id"])
    selection, resolutions, _ = _selection(workspace, course, context)
    if selection != proposal["selection"] or resolutions != expected["cohort_resolutions"]:
        raise ValueError("Cold receiving changed the original cohort presence/value identities")
    _assert_counts(course, proposal)
    base.update(schema="upstate.sampling-native-observation-cold-receiving/v1",
        observation_id=source["id"], network_id=network["id"], context_id=context["id"],
        original_rows=len(source["rows"]), full_original_observation_equal=True,
        resolved_cohorts_equal=True, flow_availability="not_received")
    if "source_recovery" in course:
        base["source_recovery"] = copy.deepcopy(course["source_recovery"])
    return base


def cold_main():
    parser = argparse.ArgumentParser(description="Reopen the original saved-observation Sampling course")
    parser.add_argument("--verify-native-observation-received", action="store_true")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    value = verify_received(Workspace(args.workspace), read_json(args.expected))
    value["application"] = str(Path(__file__).resolve().parents[1])
    _retain(args.output, value)
    print(json.dumps(value, ensure_ascii=False, indent=2))


def receive(workspace, original_result, args):
    """Append to the existing issued course; never replace its sealed files."""
    from source_tools.receive_sampling_recommendations import (
        _extract_report, _member_inventory, _report_members, original)
    from model.monitoring_packet import _verify_existing
    output = args.output.resolve() / "native-observations"
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".course.lock", blocking=False):
        inputs = {"schema": "upstate.sampling-native-observation-course-input/v1",
            "original_operation_id": args.operation_id, "project": workspace.project,
            "original_proposal_id": original_result["proposal_id"],
            "authored_course": original(args.native_observation_course)}
        _retain(output / "original-observation-inputs.json", inputs)
        course = json.loads(inputs["authored_course"]["text"])
        if (course.get("schema") != "upstate.sampling-native-observation-course/v1"
                or course["original_operation_id"] != args.operation_id):
            raise ValueError("The authored continuation must retain this original Sampling operation")
        input_path = getattr(args, "native_observation_input", None)
        if input_path:
            _retain(output / "original-source-input.json", _source_input(input_path))
            course, source, source_import = _recover_source(workspace, course, input_path, output)
        else:
            source = _original(workspace, course)
        network = _network(workspace, course, output)
        native_selection = {"observation_id": source["id"], "network_id": network["id"],
            "plan_id": None, "campaign_id": None, "title": course["context"]["title"],
            "station_mapping": course["context"]["station_mapping"],
            "interpretation": course["context"]["interpretation"]}
        _retain(output / "native-context-selection.json", native_selection)
        context_path = output / "observed-context.json"
        if context_path.exists():
            context = read_json(context_path)
        else:
            preview = native.preview(workspace, selection=native_selection)
            _retain(output / "native-context-preview.json", preview)
            context = native.prepare(workspace, selection=native_selection, expected_preview_id=preview["id"])
            _retain(context_path, context)
        _verify_context(workspace, course, source, network, context)
        selection, resolutions, catalog = _selection(workspace, course, context)
        _retain(output / "original-context-catalogue.json", catalog)
        _retain(output / "original-cohort-resolutions.json", resolutions)
        _retain(output / "sampling-selection.json", selection)
        preview = recommendations.preview(workspace, selection=selection)
        _assert_counts(course, preview)
        _retain(output / "proposal-preview.json", preview)
        proposal = recommendations.prepare(workspace, selection=selection,
            operation_id=course["operation_id"] + "-proposal")
        if recommendations.prepare(workspace, selection=selection,
                operation_id=course["operation_id"] + "-proposal") != proposal:
            raise ValueError("An exact native observation proposal retry changed its retained request")
        _assert_counts(course, proposal)
        _retain(output / "proposal.json", proposal)
        design = recommendations.design(workspace, recommendation_id=proposal["id"],
            configuration=course["design_configuration"],
            operation_id=course["operation_id"] + "-design")
        if recommendations.inspect_design(workspace, design["id"]) != design:
            raise ValueError("The original native calendar design changed after saving")
        _retain(output / "native-design.json", design)
        files = _report_members(workspace, proposal["id"])
        report_path = output / "report-export.json"
        if report_path.exists():
            exported = read_json(report_path)
            if exported.get("recommendation_id") != proposal["id"]:
                raise ValueError("The retained report belongs to another proposal")
        else:
            exported = recommendations.export_recommendations(workspace,
                recommendation_id=proposal["id"], export_root=output / "reports")
            _retain(report_path, exported)
        actual = _verify_existing(Path(exported["path"]), files)
        if actual["bytes"] != exported["bytes"] or actual["sha256"] != exported["sha256"]:
            raise ValueError("The source-bound Sampling report archive changed")
        opened = _extract_report(exported["path"], output / "report-files", files)
        history = recommendations.history(workspace, proposal["id"])
        expected = {"schema": "upstate.sampling-native-observation-receiving-expectation/v1",
            "project": workspace.project, "authored_course": course, "network": network,
            "context": context, "cohort_resolutions": resolutions,
            "proposal": proposal, "design": design, "history": history,
            "native_evidence": [], "report_members": _member_inventory(files)}
        expected_path = output / "receiving-expectation.json"
        _retain(expected_path, expected)
        selected = {"title": proposal["title"], "include_related_results": True,
            "roots": [{"kind": "monitoring_recommendations", "id": proposal["id"]},
                      {"kind": "monitoring_recommendation_designs", "id": design["id"]}]}
        _retain(output / "study-selection.json", selected)
        archive = output / "sampling-observations-editable-study.zip"
        transfer = study_transfer.export_study(workspace, archive, selected)
        transfer = {k: v for k, v in transfer.items() if k != "reused_completed_output"}
        _retain(output / "study-export.json", transfer)
        included = {(row["kind"], row["id"]) for row in transfer["study"]["identity"]["nodes"]}
        required = {("observations", source["id"]), ("monitoring_networks", network["id"]),
                    ("monitoring_observed_contexts", context["id"])}
        for binding in network["source_bindings"].values():
            if binding:
                required.add(("sources", binding["source_collection_id"]))
        required.add(("sources", context["source_binding"]["source_collection_id"]))
        if not required.issubset(included):
            raise ValueError("Selected Study omitted editable original observation/network/source records")
        receiving = output / "received-study"
        restored = (portable.resume_restore(archive, receiving, expected_archive_sha256=file_digest(archive))
                    if receiving.exists() else portable.restore(archive, receiving))
        received = Workspace(restored["workspace"])
        reopened = verify_received(received, expected)
        request = proposal["request_payload"]
        if recommendations.prepare(received, selection=request["selection"],
                operation_id=proposal["operation_id"], parent_id=request["parent_id"],
                expected_parent_digest=request["expected_parent_digest"]) != proposal:
            raise ValueError("Cold receiving did not recover the original proposal operation")
        application = Path(restored["application"])
        receiver = application / "source_tools" / "receive_sampling_recommendations.py"
        if not receiver.is_file():
            raise ValueError("The received application lacks its original Sampling receiver")
        cold_path = output / "contained-application-reopen.json"
        process = subprocess.run([sys.executable, str(receiver),
            "--verify-native-observation-received", "--workspace", str(received.root),
            "--expected", str(expected_path), "--output", str(cold_path)],
            cwd=application, text=True, capture_output=True)
        (output / "contained-application-stdout.txt").write_text(process.stdout, encoding="utf-8")
        (output / "contained-application-stderr.txt").write_text(process.stderr, encoding="utf-8")
        if process.returncode:
            raise RuntimeError("The contained original Sampling application failed: " + process.stderr[-12000:])
        cold = read_json(cold_path)
        if {k: v for k, v in cold.items() if k != "application"} != reopened:
            raise ValueError("Contained application differs from the full original observation receiving")
        result = {"schema": "upstate.sampling-native-observation-course-result/v1",
            "original_operation_id": args.operation_id, "operation_id": course["operation_id"],
            "project_id": workspace.project["id"], "observation_id": source["id"],
            "network_id": network["id"], "context_id": context["id"],
            "context_source": context["source_binding"],
            "original_observations": len(source["rows"]), "cohort_resolutions": resolutions,
            "proposal_id": proposal["id"], "design_id": design["id"], "plan_id": design["plan_id"],
            "native_status": design["status"], "native_cost": design["native_cost"],
            "proposal_budget": proposal["budget"], "target_calendar": design["target_calendar"],
            "report": exported, "report_html": opened, "study": transfer,
            "received_application": str(application), "received_workspace": str(received.root),
            "contained_reopen": str(cold_path), "flow_availability": "not_received",
            "original_course_preserved": original_result, "rendered_inspection": False,
            "browser_course": "Operate the exact populated Observations and Sampling interfaces at desktop and390px. Open and LOOK at every outgoing report, CSV/JSON, original source, calendar and extracted Study; reopen the contained editable application. No source/DOM result substitutes for rendered inspection. Preserve TJLabs attribution."}
        if "source_recovery" in course:
            result["source_recovery"] = copy.deepcopy(course["source_recovery"])
        _retain(output / "sampling-native-observation-result.json", result)
        return result
