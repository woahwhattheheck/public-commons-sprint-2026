#!/usr/bin/env python3
"""Operate compound Chemistry inference and scientific reports from retained authored runs."""
from __future__ import annotations

import argparse
from copy import deepcopy
import csv
import json
import math
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import numpy as np

from model.common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from model.workspace import Workspace
from model.chemistry import Chemistry, ENGINE_VERSION
from model import chemistry_reports, chemistry_report_source, scientific_report_editions
from model.portable import backup, restore, inspect_archive
from model.reach_chemistry.model import Project
from model.reach_chemistry.inference import Parameters, tangent_predictions, observation_key

SCHEMA = "upstate.chemistry-compound-receiving/v1"
CASE = "ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb"
CALIBRATION = "6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d"
ENSEMBLE = "2296638a0531acf18d172955d3da5e7845dc71ccaf76189b36b0217565c40a5a"
MONITORING = "9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def close(actual, expected, label, *, rtol=2e-9, atol=2e-10):
    actual, expected = np.asarray(actual, float), np.asarray(expected, float)
    require(actual.shape == expected.shape and np.isfinite(actual).all()
            and np.isfinite(expected).all() and np.allclose(actual, expected, rtol=rtol, atol=atol),
            label + " differs from its original component calculation")
    return float(np.max(np.abs(actual - expected))) if actual.size else 0.0


def native_input(service, run_id, case_id):
    run = service.get_run(run_id)
    require(run["case_id"] == case_id and run["state"] == "complete",
            "Choose a completed original analysis of the selected authored case")
    root = service._verified_artifacts(run_id, run)
    request = read_json(root / "artifacts/request.json")
    project = read_json(root / "artifacts/project.json")
    result = read_json(root / "artifacts/result.json")
    require(request == run["selection"]["request"]
            and Project(project).fingerprint == run["selection"]["project_sha256"],
            "Original run request or Project differs")
    return run, request, result


def compound_inputs(project, original, calibration_run_id):
    """Derive a declared receiving exercise from paired original authored records."""
    by_location = {}
    for index, row in enumerate(original["observations"]):
        if row.get("species") in ("ammonium_n", "nitrate_n"):
            key = (row["reach"], row["day"])
            require(row["species"] not in by_location.setdefault(key, {}),
                    "Original paired reference repeats a species at one reach and day")
            by_location[key][row["species"]] = (index, row)
    require(len(by_location) == 18 and all(set(v) == {"ammonium_n", "nitrate_n"}
            for v in by_location.values()), "Retain all 18 paired original authored reference positions")
    require(all(project.species[sid]["basis"] == "N" for sid in ("ammonium_n", "nitrate_n")),
            "The original two pools must retain elemental nitrogen basis")
    definitions = [
        ("Dissolved inorganic nitrogen", [("ammonium_n", 1.0), ("nitrate_n", 1.0)]),
        ("Weighted nitrogen operator check", [("ammonium_n", 0.5), ("nitrate_n", 1.5)]),
    ]
    rows, mapping = [], []
    for position, ((reach, day), available) in enumerate(sorted(by_location.items())):
        for variant, (label, weights) in enumerate(definitions):
            originals = [available[sid][1] for sid, weight in weights]
            expected = sum(weight * available[sid][1]["mg_l"] for sid, weight in weights)
            # Explicit exercise policy: sum supplied absolute weighted scales.
            # No independence or field-measurement error model is inferred.
            sigma = sum(weight * available[sid][1]["sigma_mg_l"] for sid, weight in weights)
            row = {
                "id": "compound-" + str(position + 1) + "-" + str(variant + 1),
                "reach": reach, "day": day, "measurement": label, "basis": "N",
                "components": [{"species": sid, "weight": weight} for sid, weight in weights],
                "role": "holdout" if any(x.get("role") == "holdout" for x in originals) else "fit",
                "sigma_mg_l": sigma,
                "provenance": {
                    "kind": "constructed-reference",
                    "reference": "Weighted combination of retained authored calibration run "
                                 + calibration_run_id + "; input records "
                                 + ", ".join(x["id"] for x in originals),
                    "original_record_ids": [x["id"] for x in originals],
                    "error_scale_policy": "Sum of original absolute weighted scales for this authored exercise",
                },
            }
            if (position + variant) % 3 == 0:
                margin = sigma * 0.2
                row.update(qualifier="interval", lower_mg_l=max(0.0, expected - margin),
                           upper_mg_l=expected + margin, lower_closed=position % 2 == 0,
                           upper_closed=variant == 0)
                row["provenance"]["interval_policy"] = "Original weighted reference plus/minus 0.2 supplied weighted error scales"
            else:
                row.update(qualifier="equal", mg_l=expected)
            rows.append(row)
            mapping.append({"id": row["id"], "reference_mg_l": expected,
                            "indices": [[available[sid][0], weight] for sid, weight in weights]})
    return rows, mapping


def operator_checks(project, parameters, observations):
    pars = Parameters.parse(project, parameters)
    flat = []
    for row in observations:
        for index, component in enumerate(row["components"]):
            flat.append({"id": row["id"] + "-component-" + str(index),
                         "reach": row["reach"], "day": row["day"], "species": component["species"]})
    predicted, jacobian = tangent_predictions(pars, pars.values, observations)
    component_values, component_jacobian = tangent_predictions(pars, pars.values, flat)
    expected, derivatives, offset = [], [], 0
    for row in observations:
        size = len(row["components"])
        weights = np.asarray([component["weight"] for component in row["components"]])
        expected.append(weights @ component_values[offset:offset + size])
        derivatives.append(weights @ component_jacobian[offset:offset + size])
        offset += size
    errors = {"component_prediction_max_abs": close(predicted, expected, "Weighted predictions"),
              "component_tangent_max_abs": close(jacobian, derivatives, "Weighted tangents")}
    finite = np.zeros_like(jacobian)
    for index, value in enumerate(pars.values):
        step = min(max(abs(value), 1.0) * 1e-5,
                   (value - pars.lower[index]) / 4, (pars.upper[index] - value) / 4)
        require(step > 0, "The retained original parameter must be interior for central differentiation")
        lower, upper = pars.values.copy(), pars.values.copy()
        lower[index] -= step
        upper[index] += step
        y0, unused = tangent_predictions(pars, lower, observations)
        y1, unused = tangent_predictions(pars, upper, observations)
        finite[:, index] = (y1 - y0) / (2 * step)
    errors["central_difference_max_abs"] = close(jacobian, finite, "Central-difference tangents",
                                                rtol=2e-5, atol=2e-7)
    return errors


def run_course(args):
    workspace = Workspace(args.workspace.resolve(strict=True), create=False)
    output = args.output.resolve()
    require(not output.is_relative_to(workspace.root), "Keep receiving output outside the scientific Workspace")
    output.mkdir(parents=True, exist_ok=True)
    service = Chemistry(workspace)
    case = service.get_case(args.case_id)
    require(case["project"].get("provenance", {}).get("kind") == "constructed-reference",
            "Use the retained authored numerical-method reference case")
    original_cal, calibration, calibration_result = native_input(service, args.calibration_run, case["id"])
    original_ensemble, ensemble, ensemble_result = native_input(service, args.ensemble_run, case["id"])
    original_monitor, monitoring, unused_monitor_result = native_input(service, args.monitoring_run, case["id"])
    require(calibration["mode"] == "calibrate" and ensemble["mode"] == "uncertainty"
            and monitoring["mode"] == "monitoring"
            and ensemble["parameters"] == calibration["parameters"] == monitoring["parameters"]
            and ensemble["observations"] == calibration["observations"]
            and ensemble["draws"] == 512,
            "Use the original paired calibration, 512-draw ensemble and design requests")
    original_ids = [args.calibration_run, args.ensemble_run, args.monitoring_run]
    request = {"schema": SCHEMA, "workspace": str(workspace.root), "project_id": workspace.project["id"],
               "case_id": case["id"], "original_run_ids": original_ids, "engine_version": ENGINE_VERSION,
               "source_records": {run["id"]: digest(run) for run in (original_cal, original_ensemble, original_monitor)},
               "script_sha256": file_digest(Path(__file__))}
    state_path = output / "receiving.json"
    state = read_json(state_path) if state_path.exists() else {"request": request, "steps": {}}
    require(state["request"] == request, "Resume this receiving directory with its original inputs and installed script")
    def save(name, value):
        state["steps"][name] = value
        atomic_json(state_path, state)
        return value

    with held(output / ".compound-course.lock", blocking=False):
        atomic_json(output / "request.json", request, immutable=True)
        for name, value in (("case", case), ("calibration-request", calibration),
                            ("calibration-result", calibration_result), ("ensemble-request", ensemble),
                            ("ensemble-result", ensemble_result), ("monitoring-request", monitoring)):
            atomic_json(output / "original" / (name + ".json"), value, immutable=True)
        if "prior_reports" not in state["steps"]:
            save("prior_reports", {
                "reports": {row["id"]: digest(chemistry_reports.inspect(workspace, row["id"]))
                            for row in chemistry_reports.catalog(workspace)},
                "sources": {row["id"]: digest(chemistry_report_source.inspect(workspace, row["id"]))
                            for row in chemistry_report_source.list_saved(workspace)}})
        project = Project(case["project"])
        observations, mapping = compound_inputs(project, calibration, original_cal["id"])
        atomic_json(output / "derived-observations.json", {"observations": observations, "mapping": mapping}, immutable=True)
        if "operator_checks" not in state["steps"]:
            save("operator_checks", operator_checks(project, calibration["parameters"], observations))

        # Day zero uses the original reservoir inventory, independent of the two
        # fitted rate/load parameters. Exact endpoint membership is observable.
        endpoint = {"id": "endpoint-included", "reach": "reservoir", "day": 0,
                    "measurement": "Initial dissolved inorganic nitrogen", "basis": "N",
                    "components": [{"species": "ammonium_n", "weight": 1.0},
                                   {"species": "nitrate_n", "weight": 1.0}],
                    "role": "holdout", "qualifier": "interval", "sigma_mg_l": 0.03,
                    "lower_closed": True, "upper_closed": False,
                    "provenance": {"kind": "constructed-reference",
                                   "reference": "Retained original reservoir initial inventory at model day 0"}}
        pars = Parameters.parse(project, calibration["parameters"])
        initial, unused = tangent_predictions(pars, pars.values, [endpoint])
        endpoint.update(lower_mg_l=float(initial[0]), upper_mg_l=float(initial[0]) + 0.03)
        excluded = {**deepcopy(endpoint), "id": "endpoint-excluded", "lower_closed": False}
        requests = {
            "calibration": {**deepcopy(calibration), "observations": observations + [endpoint, excluded]},
            "sensitivity": {"mode": "sensitivity", "parameters": deepcopy(calibration["parameters"]),
                            "observations": observations},
            "uncertainty": {**deepcopy(ensemble), "observations": observations},
            "monitoring": {**deepcopy(monitoring), "observations": observations},
        }
        completed, results = {}, {}
        for name, selected in requests.items():
            atomic_json(output / "requests" / (name + ".json"), selected, immutable=True)
            expected_id = digest({"case_id": case["id"], "project_sha256": case["project_sha256"],
                                  "request": selected, "engine_version": ENGINE_VERSION})
            save("intent-" + name, {"run_id": expected_id, "case_id": case["id"], "request": selected})
            run = service.run({"case_id": case["id"], "request": selected})
            require(run["id"] == expected_id and run["state"] == "complete", "Native analysis selection differs")
            completed[name] = run
            results[name] = read_json(service._verified_artifacts(run["id"], run) / "artifacts/result.json")
            save(name, {"run_id": run["id"], "run_record_sha256": digest(run),
                        "result_sha256": file_digest(service.root / run["id"] / "artifacts/result.json")})

        fit = results["calibration"]
        expected_parameters = [row["fitted"] for row in calibration_result["parameters"]]
        fit_error = close([row["fitted"] for row in fit["parameters"]], expected_parameters,
                          "Recovery of original authored parameter values", rtol=2e-5, atol=2e-7)
        require(fit["converged"], "Original native compound fit did not converge")
        by_id = {row["id"]: row for row in fit["observations"]}
        for original in observations + [endpoint, excluded]:
            row = by_id[original["id"]]
            require(observation_key(row) == observation_key(original)
                    and row["role"] == original["role"], "Native result changed its operator or role")
            if original["qualifier"] == "interval":
                lo, hi = original["lower_mg_l"], original["upper_mg_l"]
                prediction = row["predicted_mg_l"]
                distance = prediction - lo if prediction < lo else prediction - hi if prediction > hi else 0.0
                membership = (prediction >= lo if original["lower_closed"] else prediction > lo) and (
                    prediction <= hi if original["upper_closed"] else prediction < hi)
                require(row["observed_mg_l"] is None and row["interval_contains_prediction"] == membership,
                        "Native interval membership or absent point value differs")
                close([row["weighted_residual"]], [distance / original["sigma_mg_l"]], "Native interval residual")
        require(by_id["endpoint-included"]["interval_contains_prediction"]
                and not by_id["endpoint-excluded"]["interval_contains_prediction"]
                and by_id["endpoint-included"]["weighted_residual"] == 0
                and by_id["endpoint-excluded"]["weighted_residual"] == 0,
                "Open endpoint membership must differ while both closure distances remain zero")
        require(sum(row["count"] for row in fit["scores"]) ==
                sum(row["qualifier"] == "equal" for row in fit["observations"])
                and sum(row["count"] for row in fit["interval_scores"]) ==
                sum(row["qualifier"] == "interval" for row in fit["observations"]),
                "Point and interval support were combined or lost")
        paged = service.result_page({"run_id": completed["calibration"]["id"], "field": "interval_scores"})
        require(paged["rows"] == fit["interval_scores"], "Native result page lost interval support")
        native_csv = service.root / completed["calibration"]["id"] / "artifacts/observation-fit.csv"
        with native_csv.open(newline="") as stream:
            csv_rows = list(csv.DictReader(stream))
        csv_by_id = {row["id"]: row for row in csv_rows}
        for row in observations:
            require(json.loads(csv_by_id[row["id"]]["components"]) == row["components"],
                    "Native CSV changed compound component weights")
            if row["qualifier"] == "interval":
                require(csv_by_id[row["id"]]["observed_mg_l"] == ""
                        and float(csv_by_id[row["id"]]["lower_mg_l"]) == row["lower_mg_l"],
                        "Native CSV replaced or lost an original interval")
        require((native_csv.parent / "interval-support.csv").is_file(), "Native interval support CSV is missing")

        quantiles = results["uncertainty"]
        close(quantiles["parameter_draws"], ensemble_result["parameter_draws"], "Original seeded parameter draws",
              rtol=0, atol=0)
        original_predictions = np.asarray(ensemble_result["prediction_draws_mg_l"], float)
        expected_draws = np.column_stack([sum(weight * original_predictions[:, index]
                                            for index, weight in row["indices"]) for row in mapping])
        ensemble_error = close(quantiles["prediction_draws_mg_l"], expected_draws,
                               "Original 512-draw weighted concentrations", rtol=2e-10, atol=2e-10)
        require(len(results["monitoring"]["selected"]) == monitoring["count"],
                "Native information design did not retain the requested candidate count")
        save("numerical_summary", {"fitted_parameter_max_abs": fit_error,
             "weighted_ensemble_max_abs": ensemble_error, "draws": quantiles["draw_count"],
             "compound_records": len(observations), "interval_records": len([r for r in fit["observations"]
                                                                          if r["qualifier"] == "interval"]),
             "selected_candidates": len(results["monitoring"]["selected"]),
             "endpoint_membership_distinguished": True})

        report_ids, source_ids, choices = [], [], []
        for name, run in completed.items():
            report = chemistry_reports.prepare(workspace, run["id"])
            report_ids.append(report["id"])
            source = chemistry_report_source.prepare(workspace, report["id"])
            source_ids.append(source["id"])
            choices.append({"source_collection_id": source["source_collection_id"], "source_id": source["source_id"]})
            save("report-" + name, {"report_id": report["id"], "source_id": source["id"],
                                   "figure_count": source["figure_count"]})
        original_source = chemistry_report_source.inspect(workspace, source_ids[0])
        source_directory = workspace.root / original_source["directory"]
        figures = read_json(source_directory / "figures/specification.json")["figures"]
        require(any(row["id"].startswith("interval-") for row in figures)
                and any(row["id"].startswith("fit-") for row in figures),
                "Saved scientific source must retain point and interval figures")
        require((source_directory / "tables/interval-support.csv").is_file(),
                "Saved scientific source lacks its complete interval support table")
        preview_path = output / "scientific-preview.json"
        if preview_path.exists():
            prepared = read_json(preview_path)
        else:
            prepared = scientific_report_editions.preview(workspace, {
                "sources": choices,
                "title": "Authored four-reach compound measurements and interval inference"})
            atomic_json(preview_path, prepared, immutable=True)
        edition = scientific_report_editions.render_prepared(workspace, prepared)
        edition_id = edition["scientific_report_edition_id"]
        edition_record, edition_root, unused = scientific_report_editions.inspect(workspace, edition_id)
        pdfs = [verify_file(edition_root, item) for item in edition_record["files"].values()
                if item["path"].lower().endswith(".pdf")]
        require(pdfs, "The original scientific composer must produce its native PDF")
        for path in pdfs:
            with path.open("rb") as stream:
                require(path.stat().st_size > 1000 and stream.read(5) == b"%PDF-",
                        "The original scientific composer must produce a complete native PDF")
        save("scientific_report", {"edition_id": edition_id, "record_sha256": digest(edition_record),
                                  "report_ids": report_ids, "source_ids": source_ids,
                                  "files": scientific_report_editions.files(edition_record, edition_root)})

        # Export the existing saved analyses and reopen their editable scientific
        # project through the original receiving API in an independent Workspace.
        export = service.export({"case_id": case["id"], "run_ids": [run["id"] for run in completed.values()]})
        archive = verify_file(workspace.root, export["artifact"])
        editable_workspace = Workspace(output / "editable-received", create=True)
        incoming_service = Chemistry(editable_workspace)
        editable = incoming_service.receive(archive)
        require(incoming_service.get_case(editable["case_id"])["project"] == case["project"],
                "Editable receiving changed the authored physical project")
        for adoption in editable["adopted_runs"]:
            original_run = service.get_run(adoption["original_run_id"])
            new_run = incoming_service.get_run(adoption["run_id"])
            require(new_run["selection"]["request"] == original_run["selection"]["request"]
                    and new_run["artifacts"] == original_run["artifacts"],
                    "Editable receiving changed an original request or artifact inventory")
            incoming_service._verified_artifacts(new_run["id"], new_run)
        save("editable_receiving", editable)

        # Snapshot every selected saved identity before whole-project transfer.
        retained = {
            "case": case, "runs": {run["id"]: run for run in completed.values()},
            "original_runs": {rid: service.get_run(rid) for rid in original_ids},
            "reports": {rid: chemistry_reports.inspect(workspace, rid) for rid in report_ids},
            "sources": {sid: chemistry_report_source.inspect(workspace, sid) for sid in source_ids},
            "edition": edition_record,
        }
        retained_path = output / "retained-science.json"
        if retained_path.exists():
            require(read_json(retained_path) == retained, "Saved scientific selections changed during continuation")
        else:
            atomic_json(retained_path, retained, immutable=True)
        for rid, expected in state["steps"]["prior_reports"]["reports"].items():
            require(digest(chemistry_reports.inspect(workspace, rid)) == expected,
                    "A previous original scientific report changed")
        for sid, expected in state["steps"]["prior_reports"]["sources"].items():
            require(digest(chemistry_report_source.inspect(workspace, sid)) == expected,
                    "A previous original scientific source edition changed")

        complete_archive = output / "complete-workspace.zip"
        archive_intent = {"path": str(complete_archive), "selection_sha256": digest(retained)}
        pending = output / (".archive-" + complete_archive.name + ".pending")
        if pending.exists() and not complete_archive.exists():
            require(state["steps"].get("archive_intent") == archive_intent,
                    "Archive staging belongs to another operation; choose its original receiving directory")
            # Only our exact unfinished archive is discarded, after excluding an
            # active native capture. Native backup creates a fresh atomic staging file.
            with held(workspace.root / ".workspace.lock", blocking=False):
                pending.unlink()
        if "archive_intent" in state["steps"]:
            require(state["steps"]["archive_intent"] == archive_intent, "Retain the original complete archive selection")
        else:
            save("archive_intent", archive_intent)
        if not complete_archive.exists():
            backup(workspace, complete_archive, include_intermediates=True, include_deliveries=True)
        manifest = inspect_archive(complete_archive, verify=True)
        require(manifest["project"] == workspace.project, "The completed archive belongs to another original project")
        # On a lost response, adopt only an archive that already holds these exact
        # immutable saved scientific outputs, then continue its original restore.
        selected_files = []
        for run in completed.values():
            selected_files.append(service.root / run["id"] / "run.json")
            selected_files.extend(verify_file(service.root / run["id"], item) for item in run["artifacts"])
        for rid in report_ids:
            selected_files.extend(verify_file(workspace.root, item)
                                  for item in retained["reports"][rid]["artifacts"])
        for sid in source_ids:
            source = retained["sources"][sid]
            selected_files.extend(verify_file(workspace.root / source["directory"], item)
                                  for item in source["files"].values())
        selected_files.extend(verify_file(edition_root, item)
                              for item in scientific_report_editions.files(edition_record, edition_root).values())
        for path in selected_files:
            member = "workspace/" + path.relative_to(workspace.root).as_posix()
            require(member in manifest["members"]
                    and manifest["members"][member]["sha256"] == file_digest(path)
                    and manifest["members"][member]["bytes"] == path.stat().st_size,
                    "Complete archive differs from the retained selected scientific file: " + member)
        archive_record = describe_file(output, complete_archive)
        save("workspace_archive", archive_record)
        destination = output / "received"
        if not destination.exists():
            receiving = restore(complete_archive, destination)
            save("workspace_receiving", receiving)
        else:
            require((destination / "workspace/workspace.json").is_file(),
                    "Existing receiving destination is not the original published Workspace")
        received = Workspace(destination / "workspace", create=False)
        reopened = Chemistry(received)
        require(received.project == workspace.project and reopened.get_case(case["id"]) == retained["case"],
                "Whole receiving changed the original project or case")
        for rid, expected in {**retained["original_runs"], **retained["runs"]}.items():
            actual = reopened.get_run(rid)
            require(actual == expected, "Whole receiving changed an original native run")
            reopened._verified_artifacts(rid, actual)
        for rid, expected in retained["reports"].items():
            require(chemistry_reports.inspect(received, rid) == expected,
                    "Whole receiving changed a saved scientific report")
        for sid, expected in retained["sources"].items():
            require(chemistry_report_source.inspect(received, sid) == expected,
                    "Whole receiving changed an original scientific source edition")
        received_edition, unused, unused = scientific_report_editions.inspect(received, edition_id)
        require(received_edition == retained["edition"], "Whole receiving changed the rendered scientific report")
        for rid, expected in state["steps"]["prior_reports"]["reports"].items():
            require(digest(chemistry_reports.inspect(received, rid)) == expected,
                    "Whole receiving changed a prior report edition")
        for sid, expected in state["steps"]["prior_reports"]["sources"].items():
            require(digest(chemistry_report_source.inspect(received, sid)) == expected,
                    "Whole receiving changed a prior scientific-source edition")
        summary = {"complete": True, "project_id": workspace.project["id"], "case_id": case["id"],
                   "native_runs": {name: run["id"] for name, run in completed.items()},
                   "scientific_report_edition_id": edition_id, "report_ids": report_ids,
                   "source_ids": source_ids, "receiving_workspace": str(received.root),
                   "whole_archive": archive_record, **state["steps"]["numerical_summary"],
                   "original_source_record_ids": [row["id"] for row in calibration["observations"]]}
        save("summary", summary)
        return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case-id", default=CASE)
    parser.add_argument("--calibration-run", default=CALIBRATION)
    parser.add_argument("--ensemble-run", default=ENSEMBLE)
    parser.add_argument("--monitoring-run", default=MONITORING)
    args = parser.parse_args()
    print(json.dumps(run_course(args), ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
