#!/usr/bin/env python3
"""Receive original authored Chemistry records through Measurements and native binding."""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import sys
import time
from urllib.parse import urlencode
import zipfile

_bootstrap = argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--application", type=Path)
_bootstrap_args, _unused = _bootstrap.parse_known_args()
APP = (_bootstrap_args.application or Path(__file__).resolve().parents[1]).resolve(strict=True)
sys.path.insert(0, str(APP))

from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from model.workspace import Workspace
from model.chemistry import Chemistry
from model.reach_chemistry.model import Project
from model import chemistry_reports, chemistry_report_source, scientific_report_editions
from measurement_workspace.extension import MeasuredObservationExtension
from measurement_workspace import chemistry as measured

SCHEMA = "upstate.measured-chemistry-receiving/v1"
CASE = "ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb"
CALIBRATION = "6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d"
REVIEWER = "TokenJunkieLabs engineering — original authored reference"
REVIEW_REASON = ("Include the unchanged original authored numerical-method record for this "
                 "receiving exercise; its source explicitly identifies a constructed reference.")
CALENDAR = ("Transport encoding only: 2000-01-01T00:00:00Z plus the original model day. "
            "This authored reference has no field sampling date. Native timing uses the original "
            "day in an explicit reviewed day_override.")
IMPLEMENTATION = (
    "measurement_workspace/chemistry.py", "measurement_workspace/extension.py",
    "measurement_workspace/operator.py", "measurement_workspace/engine/workspace.mjs",
    "measurement_workspace/engine/http.mjs", "measurement_workspace/engine/normalise.mjs",
    "measurement_workspace/engine/collections.mjs", "measurement_workspace/engine/collection_zip.mjs",
    "model/chemistry.py", "model/reach_chemistry/inference.py", "model/reach_chemistry/model.py",
    "model/reach_chemistry/solver.py", "model/reach_chemistry/service.py",
    "model/chemistry_reports.py", "model/chemistry_report_source.py",
    "model/scientific_report_editions.py",
)
SPECIES = {
    "ammonium_n": {"characteristic": "Ammonium nitrogen — authored reference", "measurement": "ammonia_n"},
    "nitrate_n": {"characteristic": "Nitrate nitrogen — authored reference", "measurement": "nitrate"},
}
METHOD = "Original REACT12 numerical-method reference"
FRACTION = "Declared original model pool"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def equal_number(actual, expected, label, *, rtol=2e-5, atol=2e-7):
    require(isinstance(actual, (int, float)) and not isinstance(actual, bool)
            and math.isfinite(actual) and math.isfinite(expected)
            and math.isclose(actual, expected, rel_tol=rtol, abs_tol=atol),
            label + " differs from the retained original numerical result")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def input_member(path, raw, kind="companion", **extra):
    return {"path": path, "kind": kind, "label": path,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "base64": base64.b64encode(raw).decode("ascii"), **extra}


def original_inputs(workspace, case_id, run_id):
    chemistry = Chemistry(workspace)
    case = chemistry.get_case(case_id)
    require(case["project"].get("provenance", {}).get("kind") == "constructed-reference",
            "Select the retained original authored numerical-method case")
    run = chemistry.get_run(run_id)
    require(run["case_id"] == case_id and run["state"] == "complete" and run["mode"] == "calibrate",
            "Select the completed original calibration of that authored case")
    directory = chemistry._verified_artifacts(run_id, run)
    request = read_json(directory / "artifacts/request.json")
    project = read_json(directory / "artifacts/project.json")
    result = read_json(directory / "artifacts/result.json")
    require(request == run["selection"]["request"] and project == case["project"]
            and Project(project).fingerprint == run["selection"]["project_sha256"],
            "Original archived Project/request differs from its native selection")
    observations = request["observations"]
    require(len(observations) == 36 and len({row["id"] for row in observations}) == 36,
            "Retain the original complete 36-record calibration population")
    require(sum(row.get("role", "fit") == "fit" for row in observations) == 28
            and sum(row.get("role") == "holdout" for row in observations) == 8,
            "Retain the original 28 fit and 8 holdout choices")
    parsed = Project(project)
    for row in observations:
        require(row.get("provenance", {}).get("kind") == "constructed-reference"
                and row.get("species") in SPECIES and row.get("qualifier", "equal") == "equal",
                "Retain each original authored single-pool point observation")
        require(parsed.species[row["species"]]["basis"] == "N"
                and math.isfinite(row["mg_l"]) and row["mg_l"] >= 0
                and math.isfinite(row["day"]) and row["day"] >= 0
                and math.isfinite(row["sigma_mg_l"]) and row["sigma_mg_l"] > 0,
                "Original values, model days, error scales or nitrogen basis differ")
    return chemistry, case, run, directory, request, result


def collection_input(case, run, directory, request):
    prefix = "react12-reference-" + run["id"][:16] + "-"
    columns = ("stationId", "stationName", "organization", "activityId", "resultId",
               "sampledDate", "sampledAt", "characteristic", "value", "unit", "fraction",
               "status", "medium", "activityType", "valueType", "method", "notes",
               "original_model_day", "original_sigma_mg_l", "original_role",
               "original_species", "original_observation_json")
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    origin = datetime(2000, 1, 1, tzinfo=timezone.utc)
    for row in request["observations"]:
        date = origin + timedelta(days=row["day"])
        writer.writerow({
            "stationId": prefix + row["reach"],
            "stationName": "Authored reference position: " + row["reach"],
            "organization": "TokenJunkieLabs authored reference",
            "activityId": row["reach"] + "-day-" + str(row["day"]),
            "resultId": row["id"],
            "sampledDate": date.date().isoformat(),
            "sampledAt": date.isoformat().replace("+00:00", "Z"),
            "characteristic": SPECIES[row["species"]]["characteristic"],
            "value": row["mg_l"], "unit": "mg/L as N", "fraction": FRACTION,
            "status": "Authored reference", "medium": "Water",
            "activityType": "Numerical-method reference", "valueType": "Reference concentration",
            "method": METHOD, "notes": CALENDAR + " " + row["provenance"]["reference"],
            "original_model_day": row["day"], "original_sigma_mg_l": row["sigma_mg_l"],
            "original_role": row.get("role", "fit"), "original_species": row["species"],
            "original_observation_json": json.dumps(row, ensure_ascii=False, allow_nan=False),
        })
    raw = buffer.getvalue().encode("utf-8")
    members = [
        input_member("reference-observations.csv", raw, "wqp",
                     origin={"type": "constructed-reference", "native_case_id": case["id"],
                             "native_run_id": run["id"], "calendar_encoding": CALENDAR}),
        input_member("original/case.json", json_bytes(case)),
        input_member("original/run.json", json_bytes(run)),
        input_member("REFERENCE.md", (
            "# Original authored numerical-method observations\n\n"
            "This collection retains all 36 original calibration observations with their "
            "exact values, species, model days, scales, roles and provenance. "
            "The CSV uses the original Measurements parser's column vocabulary; its origin "
            "is the retained REACT12 authored reference.\n\n" + CALENDAR + "\n\n"
            "Every native run artifact is included unchanged under original/run/.\n"
        ).encode("utf-8")),
    ]
    for item in run["artifacts"]:
        path = verify_file(directory, item)
        members.append(input_member("original/run/" + item["path"], path.read_bytes()))
    return {"format": "upper-savannah-measurement-collection/v1",
            "title": "Original REACT12 36-record authored reference", "files": members}, prefix


def original_rows(snapshot, original, prefix):
    expected = {row["id"]: row for row in original["observations"]}
    require(snapshot["total"] == len(snapshot["records"]) == 36,
            "The selected original reference population must have exactly 36 records")
    result = {}
    for row in snapshot["records"]:
        raw = row["raw"]
        native = expected.get(row["sourceResultId"])
        require(native is not None and row["id"] not in result,
                "A reference record is absent, duplicated or replaced")
        require(json.loads(raw["original_observation_json"]) == native
                and row["stationId"] == prefix + native["reach"]
                and row["value"] == native["mg_l"] and row["unit"] == "mg/L"
                and row["basis"] == "N" and row["censor"] == "none"
                and float(raw["original_model_day"]) == native["day"]
                and float(raw["original_sigma_mg_l"]) == native["sigma_mg_l"]
                and raw["original_role"] == native.get("role", "fit"),
                "Original value, model time, scale, role, pool or provenance changed in Measurements")
        result[row["id"]] = native
    require({value["id"] for value in result.values()} == set(expected),
            "The original 36-record reference inventory differs")
    return result


def reviewed_selection(case, run, request, snapshot, originals, prefix):
    mappings = []
    for species, definition in SPECIES.items():
        sigmas = {row["sigma_mg_l"] for row in request["observations"] if row["species"] == species}
        require(len(sigmas) == 1, "The original method group must retain its common supplied error scale")
        mappings.append({
            "characteristic": definition["characteristic"], "method": METHOD, "fraction": FRACTION,
            "measurement": definition["measurement"], "basis": "N",
            "basis_reference": "Original project species " + species + "; native calibration " + run["id"],
            "basis_reason": "The original project declares this exact modeled species as elemental nitrogen.",
            "components": [{"species": species, "weight": 1.0}],
            "sigma_mg_l": next(iter(sigmas)),
            "uncertainty_reason": "Retain the original authored request's supplied sigma_mg_l without conversion.",
        })
    return {
        "case_id": case["id"], "title": "Original 36-record reference through Measurements",
        "reviewer": REVIEWER,
        "reason": "Operate the unchanged authored numerical-method calibration through complete source receiving.",
        "filters": {"q": prefix}, "expected_revision": snapshot["revision"],
        "station_bindings": [
            {"station_id": prefix + reach, "reach_id": reach,
             "reason": "The original authored record names this exact model reach.",
             "reference": "Retained original calibration " + run["id"]}
            for reach in sorted({row["reach"] for row in request["observations"]})
        ],
        "measurement_mappings": mappings,
        "time_origin": "",
        "day_overrides": {key: {"day": row["day"], "reason": "Original authored model day; " + CALENDAR}
                          for key, row in originals.items()},
        "roles": {"default": "fit", "by_record": {key: row.get("role", "fit") for key, row in originals.items()}},
        "allow_censored": False,
        "request": {key: deepcopy(value) for key, value in request.items() if key != "observations"},
    }


def compare_bound_observations(binding, originals):
    require(binding["counts"]["source_records"] == 36 and binding["counts"]["accepted"] == 36
            and binding["counts"]["excluded"] == 0 and binding["counts"]["derived"] == 0
            and binding["counts"]["fit"] == 28 and binding["counts"]["holdout"] == 8,
            "The binding changed the original complete fit/holdout population")
    rows = binding["native_payload"]["request"]["observations"]
    require({row["id"] for row in rows} == set(originals), "Bound native record identities differ")
    for row in rows:
        original = originals[row["id"]]
        require(row["components"] == [{"species": original["species"], "weight": 1.0}]
                and row["basis"] == "N" and row["reach"] == original["reach"]
                and row["day"] == original["day"] and row["sigma_mg_l"] == original["sigma_mg_l"]
                and row["mg_l"] == original["mg_l"] and row["qualifier"] == "equal"
                and row["role"] == original.get("role", "fit"),
                "The native binding changed an original operator, value, time, error scale or role")


def scientific_request(payload):
    request = deepcopy(payload["request"])
    metadata = request.get("metadata", {})
    metadata.pop("measurement_binding", None)
    if metadata:
        request["metadata"] = metadata
    else:
        request.pop("metadata", None)
    return request


def verify_companion(workspace, item):
    path = (workspace.root / item["object"]).resolve(strict=True)
    require(path.is_relative_to(workspace.root) and path.is_file()
            and path.stat().st_size == item["bytes"] and file_digest(path) == item["sha256"],
            "An original received source companion changed")
    return path


def receive_collection_zip(service, raw, destination, expected):
    require(len(raw) == expected["bytes"] and hashlib.sha256(raw).hexdigest() == expected["sha256"],
            "The retained measured collection ZIP differs")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        require(len(names) == len(set(names)), "The retained measured collection repeats members")
        for item in entries:
            name = PurePosixPath(item.filename)
            require(not item.is_dir() and not item.flag_bits & 1 and not name.is_absolute()
                    and ".." not in name.parts and str(name) == item.filename
                    and "\\" not in item.filename and "\0" not in item.filename,
                    "The retained measured collection has an unsafe member")
        edition = json.loads(archive.read("edition.json"))
        require(edition["id"] == expected["edition_id"]
                and edition["collectionId"] == expected["collection_id"],
                "The original measured edition identities differ")
        files = {item["path"]: item for item in edition["files"]}
        require(set(names) == set(files) | {"edition.json"}, "The measured edition inventory differs")
        for name, descriptor in files.items():
            body = archive.read(name)
            require(len(body) == descriptor["bytes"] and hashlib.sha256(body).hexdigest() == descriptor["sha256"],
                    "An original measured edition member differs: " + name)
        collection = json.loads(archive.read("collection.json"))
        incoming = deepcopy(collection)
        incoming["files"] = [
            {**file, "base64": base64.b64encode(archive.read("sources/" + file["path"])).decode("ascii")}
            for file in collection["files"]
        ]
        preview = service.json("POST", "collections/preview", incoming)
        require(preview["id"] == expected["collection_id"], "Original collection identity changed on independent receive")
        received = service.json("POST", "collections/receive", {**incoming, "expectedId": preview["id"]})
        for item in entries:
            atomic_bytes(destination / item.filename, archive.read(item), immutable=True)
    return received


def run_course(args):
    started = time.perf_counter()
    workspace = Workspace(args.workspace.resolve(strict=True), create=False)
    output = args.output.resolve()
    require(not output.is_relative_to(workspace.root) and not output.is_relative_to(APP),
            "Keep course output outside both the scientific Workspace and application")
    chemistry, case, original_run, original_directory, original_request, original_result = original_inputs(
        workspace, args.case_id, args.calibration_run)
    collection, prefix = collection_input(case, original_run, original_directory, original_request)
    request = {
        "schema": SCHEMA, "workspace": str(workspace.root), "project_id": workspace.project["id"],
        "case_id": case["id"], "calibration_run_id": original_run["id"],
        "original_case_sha256": digest(case), "original_run_sha256": digest(original_run),
        "collection_input_sha256": digest(collection), "application": str(APP),
        "script_sha256": file_digest(Path(__file__)),
        "implementation": {name: file_digest(APP / name) for name in IMPLEMENTATION},
    }
    state_path = output / "receiving.json"
    if not state_path.exists():
        require(not (output / "received-workspace").exists(),
                "Choose a new course directory; its independent receiving Workspace already exists")
    output.mkdir(parents=True, exist_ok=True)
    extension = MeasuredObservationExtension(None, lambda *value: ValueError(str(value)))
    incoming_extension = None
    try:
        with held(output / ".measured-course.lock", blocking=False):
            state = read_json(state_path) if state_path.exists() else {"request": request, "steps": {}}
            require(state["request"] == request, "Continue with this course's exact original request and implementation")
            atomic_json(output / "request.json", request, immutable=True)

            def save(name, value):
                state["steps"][name] = value
                atomic_json(state_path, state)
                return value

            if not state_path.exists():
                atomic_json(state_path, state)
            atomic_json(output / "collection-input.json", collection, immutable=True)
            service = extension._service(workspace)
            if "binding" not in state["steps"]:
                preview = service.json("POST", "collections/preview", collection)
                imported = service.json("POST", "collections/receive", {**collection, "expectedId": preview["id"]})
                require(imported["id"] == preview["id"], "The imported original collection differs")
                save("collection", {"collection_id": imported["id"], "input_sha256": digest(collection)})
                query = "snapshot?" + urlencode({"q": prefix})
                population = service.json("GET", query)
                originals = original_rows(population, original_request, prefix)
                revision = population["revision"]
                for row in population["records"]:
                    review = row.get("review", {})
                    if review.get("state") == "include" and review.get("reviewer") == REVIEWER and review.get("reason") == REVIEW_REASON:
                        continue
                    require(review.get("state", "pending") == "pending",
                            "This original reference record has a different retained review; inspect it before continuing")
                    response = service.json("PUT", "records/" + row["id"] + "/review", {
                        "state": "include", "reviewer": REVIEWER, "reason": REVIEW_REASON,
                        "expectedRevision": revision,
                    })
                    revision = response["revision"]
                population = service.json("GET", query + "&expected_revision=" + str(revision))
                originals = original_rows(population, original_request, prefix)
                selection_path = output / "binding-selection.json"
                if selection_path.exists():
                    selection = read_json(selection_path)
                    candidate = reviewed_selection(case, original_run, original_request, population, originals, prefix)
                    require({k: v for k, v in selection.items() if k != "expected_revision"} ==
                            {k: v for k, v in candidate.items() if k != "expected_revision"},
                            "Original reviewed selection changed after interruption")
                else:
                    selection = reviewed_selection(case, original_run, original_request, population, originals, prefix)
                    atomic_json(selection_path, selection, immutable=True)
                existing = [row for row in workspace._list(measured.FAMILY)
                            if row.get("selection") == selection and row.get("project_sha256") == case["project_sha256"]]
                if existing:
                    require(len(existing) == 1, "More than one original binding matches the saved selection")
                    binding = measured.get(workspace, existing[0]["id"])
                else:
                    require(selection["expected_revision"] == population["revision"],
                            "Measurements advanced before binding; inspect the saved original selection and use a new course output")
                    binding = measured.prepare(workspace, service, selection)
                atomic_json(output / "original-record-map.json", originals, immutable=True)
                save("binding", {"binding_id": binding["id"], "case_id": binding["case_id"],
                                 "source": binding["source"], "source_sha256": binding["source_sha256"]})
            else:
                binding = measured.get(workspace, state["steps"]["binding"]["binding_id"])
                originals = read_json(output / "original-record-map.json")
            compare_bound_observations(binding, originals)
            collections = binding.get("source_collections", [])
            require(collections and any(item["collection_id"] == state["steps"]["collection"]["collection_id"]
                                        for item in collections),
                    "Install the complete original collection-companion binding update before this course")
            atomic_json(output / "bound-native-request.json", binding["native_payload"], immutable=True)
            exported_binding = measured.export(workspace, binding["id"])
            atomic_json(output / "downloads" / exported_binding["filename"], exported_binding["document"], immutable=True)

            run_started = time.perf_counter()
            native = chemistry.run(binding["native_payload"])
            native_seconds = time.perf_counter() - run_started
            require(native["state"] == "complete" and native["case_id"] == binding["case_id"],
                    "The native measured calibration did not complete")
            native_root = chemistry._verified_artifacts(native["id"], native)
            result = read_json(native_root / "artifacts/result.json")
            require(result["converged"], "The original native fit did not converge")
            expected_parameters = {row["id"]: row["fitted"] for row in original_result["parameters"]}
            actual_parameters = {row["id"]: row["fitted"] for row in result["parameters"]}
            require(set(expected_parameters) == set(actual_parameters), "The original fitted parameter inventory differs")
            for key, value in expected_parameters.items():
                equal_number(actual_parameters[key], value, "Original fitted parameter " + key)
            original_predictions = {row["id"]: row["predicted_mg_l"] for row in original_result["observations"]}
            require({row["id"] for row in result["observations"]} == set(originals),
                    "The native calibration omitted original reference records")
            for row in result["observations"]:
                original = originals[row["id"]]
                equal_number(row["predicted_mg_l"], original_predictions[original["id"]],
                             "Original observation prediction " + original["id"], rtol=3e-5, atol=3e-7)
            for item in native["artifacts"]:
                atomic_bytes(output / "downloads" / "native-calibration" / item["path"],
                             verify_file(native_root, item).read_bytes(), immutable=True)
            save("native_calibration", {"run_id": native["id"], "parameters": actual_parameters,
                                       "original_observations": 36, "fit": 28, "holdout": 8,
                                       "this_invocation_seconds": native_seconds})

            report = chemistry_reports.prepare(workspace, native["id"])
            report_source = chemistry_report_source.prepare(workspace, report["id"])
            preview_path = output / "scientific-preview.json"
            if preview_path.exists():
                prepared = read_json(preview_path)
            else:
                prepared = scientific_report_editions.preview(workspace, {
                    "sources": [{"source_collection_id": report_source["source_collection_id"],
                                 "source_id": report_source["source_id"]}],
                    "title": "Original 36-record authored reference received through Measurements",
                })
                atomic_json(preview_path, prepared, immutable=True)
            rendered = scientific_report_editions.render_prepared(workspace, prepared)
            edition_id = rendered["scientific_report_edition_id"]
            edition, edition_root, _ = scientific_report_editions.inspect(workspace, edition_id)
            edition_files = scientific_report_editions.files(edition, edition_root)
            for item in edition_files.values():
                atomic_bytes(output / "downloads" / "scientific-report" / item["path"],
                             verify_file(edition_root, item).read_bytes(), immutable=True)
            require(any(item["path"].endswith(".pdf") for item in edition_files.values()),
                    "The original scientific composer did not produce its PDF")
            save("scientific_report", {"report_id": report["id"], "source_record_id": report_source["id"],
                                      "edition_id": edition_id, "files": edition_files})

            exported = chemistry.export({"case_id": binding["case_id"], "run_ids": [native["id"]]})
            archive = verify_file(workspace.root, exported["artifact"])
            atomic_bytes(output / "downloads" / "editable-measured-chemistry.zip", archive.read_bytes(), immutable=True)
            save("editable_export", {"archive_sha256": file_digest(archive), "bytes": archive.stat().st_size})
            receiving_root = output / "received-workspace"
            receiving = Workspace(receiving_root, create=True)
            if "receiving_project" in state["steps"]:
                require(state["steps"]["receiving_project"] == receiving.project, "The receiving Workspace identity changed")
            else:
                save("receiving_project", receiving.project)
            incoming = Chemistry(receiving)
            receipt = incoming.receive(archive)
            incoming_case = incoming.get_case(receipt["case_id"])
            require(incoming_case["project"] == case["project"], "Editable receiving changed the original Project")
            adopted_runs = {row["original_run_id"]: row["run_id"] for row in receipt["adopted_runs"]}
            require(set(adopted_runs) == {native["id"]}, "Editable receiving omitted the retained native calibration")
            incoming_run = incoming.get_run(adopted_runs[native["id"]])
            require(incoming_run["selection"]["request"] == native["selection"]["request"]
                    and incoming_run["artifacts"] == native["artifacts"], "Editable receiving changed native request or files")
            incoming._verified_artifacts(incoming_run["id"], incoming_run)
            choices = [ref for ref in incoming_case["source_refs"] if ref["sha256"] == binding["source_sha256"]]
            require(len(choices) == 1, "Choose the exact original measured binding source carried by the received case")
            choice = {key: choices[0][key] for key in ("source_collection_id", "source_id")}
            source_path, source_entry = receiving.source_file(choice["source_collection_id"], choice["source_id"])
            source_document = read_json(source_path)
            require(source_document["original_records"] and source_document["request"] == binding["request"]
                    and file_digest(source_path) == binding["source_sha256"],
                    "The received original binding source changed")
            by_hash = {item["sha256"]: item for item in source_entry.get("companions", [])}
            for item in source_entry.get("companions", []):
                verify_companion(receiving, item)
            portable_items = [item for item in source_entry["companions"]
                              if PurePosixPath(item.get("view_path", item["filename"])).name == "measurements.json"]
            require(len(portable_items) == 1, "The complete original measured workspace is absent")
            portable = read_json(verify_companion(receiving, portable_items[0]))
            incoming_extension = MeasuredObservationExtension(None, lambda *value: ValueError(str(value)))
            incoming_measurements = incoming_extension._service(receiving)
            current = incoming_measurements.json("GET", "portable")
            if not current["tables"]["imports"] and not current["tables"]["records"]:
                incoming_measurements.json("POST", "receive", portable)
                current = incoming_measurements.json("GET", "portable")
            for name, rows in portable["tables"].items():
                if name != "events":
                    require(current["tables"][name] == rows, "Independent measured receiving changed original table " + name)
            original_events = {row["id"]: row for row in portable["tables"]["events"]}
            received_events = {row["id"]: row for row in current["tables"]["events"]}
            require(all(received_events.get(key) == row for key, row in original_events.items()),
                    "Independent measured receiving changed original source/review history")
            for item in collections:
                require(item["sha256"] in by_hash, "The complete original measured collection ZIP is absent")
                raw = verify_companion(receiving, by_hash[item["sha256"]]).read_bytes()
                atomic_bytes(output / "downloads" / (item["collection_id"] + ".zip"), raw, immutable=True)
                receive_collection_zip(incoming_measurements, raw,
                                       output / "downloads" / "measured-studies" / item["collection_id"], item)
            received_snapshot = incoming_measurements.json("GET", "snapshot?" + urlencode({"q": prefix}))
            require(original_rows(received_snapshot, original_request, prefix) == originals,
                    "Reopened original measured population differs")
            adopted = measured.adopt_source(receiving, {"case_id": incoming_case["id"], **choice})
            reopened = measured.get(Workspace(receiving.root, create=False), adopted["id"])
            require(reopened == adopted and scientific_request(adopted["native_payload"]) ==
                    scientific_request(binding["native_payload"]), "Adoption changed the original scientific native request")
            require(adopted["received_from"]["selection"] == binding["selection"]
                    and adopted["source_collections"] == binding["source_collections"],
                    "Adoption lost the original selection or source collection editions")
            compare_bound_observations(adopted, originals)
            atomic_json(output / "downloads" / "received-binding.json", adopted, immutable=True)
            require(chemistry.get_case(case["id"]) == case and chemistry.get_run(original_run["id"]) == original_run,
                    "The original authored case or calibration changed")
            summary = {
                "complete": True, "schema": SCHEMA, "project_id": workspace.project["id"],
                "operator_workspace_key": digest({"directory": str(workspace.root)}),
                "binding_id": binding["id"], "case_id": binding["case_id"], "run_id": native["id"],
                "source_collection_id": binding["source"]["source_collection_id"],
                "source_id": binding["source"]["source_id"], "source_collections": collections,
                "scientific_report_edition_id": edition_id,
                "received_workspace": str(receiving.root), "received_project_id": receiving.project["id"],
                "received_operator_workspace_key": digest({"directory": str(receiving.root)}),
                "received_case_id": incoming_case["id"], "received_binding_id": adopted["id"],
                "received_run_id": incoming_run["id"], "records": 36, "fit": 28, "holdout": 8,
                "downloads": str(output / "downloads"), "calendar_encoding": CALENDAR,
            }
            save("summary", summary)
            save("last_invocation_seconds", time.perf_counter() - started)
            atomic_json(output / "opening.json", summary, immutable=True)
            return summary
    finally:
        if incoming_extension is not None:
            incoming_extension.close()
        extension.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=APP)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case-id", default=CASE)
    parser.add_argument("--calibration-run", default=CALIBRATION)
    args = parser.parse_args()
    print(json.dumps(run_course(args), ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
