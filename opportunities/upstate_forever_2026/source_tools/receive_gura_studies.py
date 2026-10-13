#!/usr/bin/env python3
"""Run resumable, source-bound Gura parameter studies in the native application."""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import traceback

EDITION = "gura-original-parameter-suite/1"
NDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
SCOPES = {"ndr": ("ndr",), "sdr": ("sdr",), "both": ("ndr", "sdr")}
PURPOSE = (
    "Evaluate explicit native parameter and routing choices on the original Gura study. "
    "Retain the release inputs, coefficient table, original watershed, 15 m grid and "
    "zero added buffer. Report each completed case's physical export and paired-cell "
    "coverage against the original parameter values for the same landscape."
)


def axes_for(scope):
    active = SCOPES[scope]
    result = []
    for model in active:
        result.append({
            "name": model.upper() + " connectivity shape",
            "parameters": [model + ".k_param"], "values": [1, 2],
            "reason": (
                "Compare explicit connectivity-shape values 1 and 2. The official "
                "guide illustrates this response; the original Gura reference is 2."
            ),
            "references": [NDR_GUIDE if model == "ndr" else SDR_GUIDE],
        })
    if "sdr" in active:
        result.append({
            "name": "SDR connectivity midpoint",
            "parameters": ["sdr.ic_0_param"], "values": [0.5, 2],
            "reason": (
                "Compare explicit sediment-connectivity midpoint values 0.5 and 2 "
                "from the documented delivery-ratio response illustration. Retain "
                "the original Gura midpoint 0.5 in the reference case."
            ),
            "references": [SDR_GUIDE, NDR_GUIDE],
        })
    result.append({
        "name": "Native flow routing",
        "parameters": [model + ".flow_dir_algorithm" for model in active],
        "values": ["mfd", "d8"],
        "reason": (
            "Compare the two routing algorithms supported by the original 3.20.0 "
            "models. In the combined study apply the same algorithm to both models. "
            "The archived Gura MFD argument is preserved and executed as lowercase mfd."
        ),
        "references": [NDR_GUIDE if model == "ndr" else SDR_GUIDE for model in active],
    })
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--application", type=Path, required=True)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--inputs", type=Path, required=True,
                   help="Original release NDR.zip and SDR.zip directory")
    p.add_argument("--baseline-run-id",
                   help="Existing completed original both-model Gura baseline")
    p.add_argument("--scopes", choices=tuple(SCOPES), nargs="+",
                   default=["ndr", "sdr", "both"])
    p.add_argument("--design", choices=("factorial", "one-at-a-time"), default="factorial")
    p.add_argument("--evaluation-run-id", action="append", default=[],
                   help="Also study a retained original-profile portfolio evaluation; repeatable")
    p.add_argument("--include-planning-evaluation", action="store_true",
                   help="Also use the actual evaluation in gura-planning-state.json")
    p.add_argument("--difference-maps", action="store_true",
                   help="Retain per-case difference rasters through the native comparison API")
    p.add_argument("--archive", type=Path,
                   help="Copy the completed/partial portable suite ZIP to this external path")
    return p


def _copy_exports(workspace, directory, state):
    from model.common import atomic_bytes, atomic_json, describe_file, verify_file
    from model.parameter_exports import write_archive
    from model.reuse import copy_verified
    results, outputs, studies = [], {}, []
    for item in state["studies"]:
        key = item.get("study_id")
        if not key:
            studies.append(dict(item))
            continue
        from model import parameter_studies
        current = parameter_studies.inspect(workspace, key)
        item.update(state=current["state"], progress=current["progress"],
                    cases=[{name: case[name] for name in ("id", "run_id", "profile_id", "state")}
                           for case in current["cases"]])
        exported = {}
        for name, descriptor in current.get("artifacts", {}).items():
            # Preserve each report's own relative paths, including comparison
            # records and GIS files below difference-maps/<comparison-id>/.
            relative = (Path("studies") / key / descriptor["path"]).as_posix()
            exported[name] = copy_verified(
                workspace.root / "experiments" / key, descriptor, directory,
                path=relative, replace_mismatch=True)
        item["artifacts"] = exported
        outputs.update({key + "/" + name: value for name, value in exported.items()})
        artifact = current.get("artifacts", {}).get("results")
        if artifact:
            original = verify_file(workspace.root / "experiments" / key, artifact)
            result = json.loads(original.read_text(encoding="utf-8"))
            if (result.get("experiment_id") != key
                    or result.get("workspace_id") != workspace.project["id"]):
                raise ValueError("A study result belongs to another retained operation")
            for row in result["rows"]:
                results.append({
                    "study_id": key, "model_scope": item["model_scope"],
                    "landscape_run_id": item["landscape_run_id"],
                    "landscape": item["landscape"], **row,
                })
        studies.append(dict(item))
    result = {
        "schema": "upstate.gura-parameter-suite-results/v1",
        "suite_id": state["id"], "workspace_id": workspace.project["id"],
        "selection": state["selection"], "state": state["state"],
        "studies": studies, "rows": results,
        "mass_basis": "Sum of retained annual mass per pixel after one native-rate area conversion.",
        "comparison_basis": "Each case minus its same-landscape original-parameter reference on paired valid cells.",
        "interpretation": (
            "Responses describe the explicitly selected native parameter/routing cases. "
            "Original baseline parameters, all case values, spatial support and source references are retained."
        ),
    }
    atomic_json(directory / "results.json", result)
    fields = [
        "study_id", "model_scope", "landscape_run_id", "landscape",
        "case_id", "case", "run_id", "profile_id", "area_id", "area", "pollutant", "units",
        "baseline_mass", "case_mass", "change", "percent_change", "baseline_full_mass",
        "case_full_mass", "baseline_valid_cells", "case_valid_cells", "paired_valid_cells",
        "pixel_area_ha", "baseline_valid_area_ha", "case_valid_area_ha", "paired_area_ha",
        "support_changed", "overrides",
    ]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in results:
        writer.writerow({**row, "overrides": json.dumps(row["overrides"], sort_keys=True)})
    atomic_bytes(directory / "results.csv", output.getvalue().encode("utf-8"))
    escaped = lambda value: html.escape(str(value), quote=True)
    rows = []
    for item in studies:
        progress = item.get("progress", {})
        links = " ".join(
            '<a href="' + escaped(value["path"]) + '">' + escaped(name) + "</a>"
            for name, value in item.get("artifacts", {}).items()
            if name in {"report", "csv", "archive"})
        rows.append(
            "<tr><td>" + escaped(item["landscape"]) + "</td><td>" +
            escaped(item["model_scope"].upper()) + "</td><td>" + escaped(item["state"]) +
            "</td><td>" + escaped(progress.get("completed", 0)) + " / " +
            escaped(progress.get("total", 0)) + "</td><td>" + links + "</td></tr>")
    report = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gura native parameter studies</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#202428;background:#fff;max-width:1200px;margin:32px auto;padding:0 24px}
h1{font-size:26px}h2{font-size:19px}table{width:100%;border-collapse:collapse}
td,th{padding:12px;text-align:left;border-bottom:1px solid #cdd1d4;vertical-align:top}
small{color:#515b63}a{color:#273844;margin-right:12px}code{overflow-wrap:anywhere}
</style><h1>Gura native parameter studies</h1><p>""" + escaped(PURPOSE) + (
        "</p><p><strong>Suite state: " + escaped(state["state"]) +
        "</strong> · Original grid: 15 m · Added watershed buffer: 0 m</p>" +
        '<p><a href="results.csv">All completed physical results (CSV)</a>' +
        '<a href="results.json">Selections, cases and coverage (JSON)</a>' +
        '<a href="selection.json">Original suite design</a></p>' +
        "<table><thead><tr><th>Landscape</th><th>Models</th><th>State</th>" +
        "<th>Completed native cases</th><th>Study exports</th></tr></thead><tbody>" +
        "".join(rows) + "</tbody></table><h2>Interpretation</h2><p>" +
        escaped(result["interpretation"]) + "</p><p>" + escaped(result["comparison_basis"]) +
        " " + escaped(result["mass_basis"]) + "</p><p>Open a study report to inspect " +
        "its quantities, native run IDs, actual coverage and explicit coefficients. " +
        "Every study includes the original parameter reference for its own landscape.</p>" +
        "<h2>Original methods</h2><p><a href=\"" + NDR_GUIDE + "\">InVEST 3.20 NDR guide</a>" +
        "<a href=\"" + SDR_GUIDE + "\">InVEST 3.20 SDR guide</a></p>" +
        "<small>Suite <code>" + escaped(state["id"]) + "</code></small></html>")
    atomic_bytes(directory / "index.html", report.encode("utf-8"))
    for name in ("selection.json", "results.json", "results.csv", "index.html"):
        outputs[name] = describe_file(directory, directory / name)
    manifest = {"schema": "commons.gura-parameter-suite-package/v1",
                "suite_id": state["id"], "workspace_id": workspace.project["id"],
                "state": state["state"], "files": outputs}
    atomic_json(directory / "manifest.json", manifest)
    write_archive(
        directory, directory / "gura-parameter-suite.zip",
        [describe_file(directory, directory / "manifest.json"), *outputs.values()])
    return {"report": describe_file(directory, directory / "index.html"),
            "csv": describe_file(directory, directory / "results.csv"),
            "results": describe_file(directory, directory / "results.json"),
            "manifest": describe_file(directory, directory / "manifest.json"),
            "archive": describe_file(directory, directory / "gura-parameter-suite.zip")}


def main(argv=None):
    args = parser().parse_args(argv)
    application = args.application.resolve(strict=True)
    sys.path.insert(0, str(application))
    sys.path.insert(0, str(application / "source_tools"))
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("GDAL_CACHEMAX", "64")
    import receive_gura_native as receiver
    from receive_gura_planning import original_baseline
    from model import parameter_studies
    from model.common import atomic_json, digest, held, identifier, now, read_json
    from model.model_selection import run_models, validate_completed_run
    from model.workspace import Workspace
    from model.native_execution import storage_exhausted

    root = args.workspace.resolve()
    receiving = root / "gura-receiving"
    receiving.mkdir(parents=True, exist_ok=True)
    inputs = args.inputs.resolve(strict=True)
    scopes = [name for name in SCOPES if name in set(args.scopes)]
    state, directory = None, None

    class ReusingWorkspace(Workspace):
        """Expose original completed donors to native identity-checked stage reuse."""
        def __init__(self, path):
            super().__init__(path)
            self.donors = set()

        def remember(self, run_id):
            record = self.inspect_run(run_id)
            validate_completed_run(record)
            if record["state"] == "complete":
                self.donors.add(record["id"])
            return record

        def run(self, key, *, reuse_source_run_ids=None):
            donors = sorted(self.donors | set(reuse_source_run_ids or ()))
            result = super().run(key, reuse_source_run_ids=[value for value in donors if value != key])
            if result["state"] == "complete":
                self.donors.add(result["id"])
            return result

    def checkpoint(stage, **values):
        if state is None:
            receiver.atomic(receiving / "parameter-suite-receiving.json", {
                "schema": "upstate.gura-parameter-suite-receiving/v1",
                "stage": stage, "updated_at": now(),
                "request": {"baseline_run_id": args.baseline_run_id,
                            "scopes": scopes, "design": args.design,
                            "evaluation_run_ids": args.evaluation_run_id}, **values})
            receiver.emit("gura-studies-" + stage, **values)
            return
        state.update(stage=stage, updated_at=now(), **values)
        atomic_json(directory / "state.json", state)
        receiver.emit("gura-studies-" + stage, suite_id=state["id"],
                      state_path=str(directory / "state.json"), **values)

    with held(receiving / ".parameter-suite.lock", blocking=False), held(
            root / ".native-model-batch.lock", blocking=False):
        try:
            baseline_id = args.baseline_run_id
            recorded = receiving / "gura-receiving-state.json"
            if baseline_id is None and recorded.is_file():
                baseline_id = read_json(recorded).get("workspace_baseline", {}).get("run_id")
            if baseline_id is not None and args.baseline_run_id is None:
                candidate = Workspace(root).inspect_run(identifier(baseline_id))
                if run_models(candidate) != ("ndr", "sdr"):
                    baseline_id = None
            if baseline_id is None:
                checkpoint("original-reference")
                code = receiver.main([
                    "--application", str(application), "--workspace", str(root),
                    "--inputs", str(inputs), "--models", "ndr", "sdr", "--mode", "both"])
                if code:
                    raise RuntimeError("Original Gura receiving requires recovery; inspect its retained state")
                baseline_id = read_json(recorded)["workspace_baseline"]["run_id"]
            workspace = ReusingWorkspace(root)
            originals = {model: receiver.unpack_original(inputs, receiving, model)
                         for model in ("ndr", "sdr")}
            # Resume only the explicitly retained original both-model selection.
            candidate = workspace.inspect_run(identifier(baseline_id))
            if (run_models(candidate) != ("ndr", "sdr") or workspace._get(
                    "scenarios", candidate["selection"]["scenario_id"]).get("kind") != "baseline"):
                raise ValueError("Choose the original both-model Gura baseline run")
            workspace.run(candidate["id"])
            baseline, grid = original_baseline(workspace, baseline_id, originals, receiver)
            workspace.remember(baseline["id"])
            target_ids = list(args.evaluation_run_id)
            if args.include_planning_evaluation:
                planning = read_json(receiving / "gura-planning-state.json")
                if planning.get("evaluation_run_id"):
                    target_ids.append(planning["evaluation_run_id"])
                else:
                    raise ValueError("The retained planning operation has no selected-treatment evaluation")
            targets = [{"id": baseline["id"], "label": "Original Gura landscape",
                        "scenario_id": baseline["selection"]["scenario_id"], "portfolio_id": None}]
            for value in dict.fromkeys(target_ids):
                run = workspace.inspect_run(identifier(value))
                selection = run["selection"]
                scenario = workspace._get("scenarios", selection["scenario_id"])
                if (selection["grid_id"] != grid["id"]
                        or selection["profile_id"] != baseline["selection"]["profile_id"]
                        or run_models(run) != ("ndr", "sdr")
                        or scenario.get("kind") != "landcover" or not scenario.get("portfolio_id")):
                    raise ValueError("Additional landscapes must be original-profile Gura portfolio evaluations")
                workspace.run(run["id"])
                workspace.remember(run["id"])
                targets.append({"id": run["id"], "label": scenario["title"],
                                "scenario_id": scenario["id"], "portfolio_id": scenario["portfolio_id"]})
            selection = {
                "schema": "upstate.gura-parameter-suite-selection/v1", "edition": EDITION,
                "workspace_id": workspace.project["id"], "baseline_run_id": baseline["id"],
                "grid_id": grid["id"], "original_profile_id": baseline["selection"]["profile_id"],
                "targets": targets, "scopes": scopes, "design": args.design,
                "axes": {scope: axes_for(scope) for scope in scopes},
                "difference_maps": args.difference_maps,
                "original_argument_sha256": {
                    model: receiver.sha(Path(originals[model]["argument_path"]))
                    for model in ("ndr", "sdr")},
                "original_archive_sha256": {model: originals[model]["archive"]["sha256"]
                                            for model in ("ndr", "sdr")},
                "references": [NDR_GUIDE, SDR_GUIDE],
            }
            suite_id = digest(selection)
            directory = receiving / "parameter-studies" / suite_id
            directory.mkdir(parents=True, exist_ok=True)
            atomic_json(directory / "selection.json", selection, immutable=True)
            path = directory / "state.json"
            state = read_json(path) if path.exists() else {
                "schema": "upstate.gura-parameter-suite/v1", "id": suite_id,
                "selection": selection, "created_at": now(), "studies": [],
                "original_runtime": baseline.get("runtime"),
                "implementation": {"driver_sha256": receiver.sha(Path(__file__)),
                                   "engine_sha256": receiver.sha(Path(parameter_studies.__file__))},
            }
            if state["selection"] != selection:
                raise ValueError("Retained suite selection differs from its immutable source identity")
            for item in state["studies"]:
                if item.get("study_id"):
                    current = parameter_studies.inspect(workspace, item["study_id"])
                    for case in current["cases"]:
                        workspace.remember(case["run_id"])
            checkpoint("prepared", state="running")
            failures = []
            for target in targets:
                for scope in scopes:
                    item_key = target["id"] + ":" + scope
                    item = next((row for row in state["studies"] if row["key"] == item_key), None)
                    if item is None:
                        item = {"key": item_key, "landscape_run_id": target["id"],
                                "landscape": target["label"], "portfolio_id": target["portfolio_id"],
                                "model_scope": scope, "state": "preparing"}
                        state["studies"].append(item)
                    try:
                        scoped = workspace.prepare_run({
                            "grid_id": grid["id"], "profile_id": baseline["selection"]["profile_id"],
                            "scenario_id": target["scenario_id"], "models": list(SCOPES[scope])})
                        item["reference_run_id"] = scoped["id"]
                        checkpoint("reference-prepared", active_study_key=item_key)
                        workspace.run(scoped["id"])
                        study_selection = {
                            "title": "Gura " + scope.upper() + " parameters — " + target["label"],
                            "purpose": PURPOSE, "baseline_run_id": scoped["id"],
                            "design": args.design, "axes": selection["axes"][scope],
                            "reporting_areas": [], "difference_maps": args.difference_maps,
                        }
                        study = parameter_studies.prepare(workspace, study_selection)
                        item["study_id"] = study["id"]
                        checkpoint("study-prepared", active_study_key=item_key)

                        def progress(current):
                            item.update(state=current["state"], progress=current["progress"],
                                        active_run_id=current.get("active_run_id"),
                                        active_case_id=current.get("active_case_id"),
                                        aggregation_progress=current.get("aggregation_progress"))
                            checkpoint("native-cases", active_study_key=item_key)

                        current = parameter_studies.execute(workspace, study["id"], progress=progress)
                        item.update(state=current["state"], progress=current["progress"])
                        item.pop("error", None)
                        if current["state"] != "complete":
                            failures.append(item_key)
                    except Exception as error:
                        item.update(state="failed", error={
                            "type": type(error).__name__, "message": str(error),
                            "traceback": traceback.format_exc()})
                        failures.append(item_key)
                        if storage_exhausted(error):
                            raise
                        logging.exception("Gura parameter study needs recovery: %s", item_key)
                    # Keep the completed reports usable while remaining native cases continue.
                    state["state"] = "running"
                    state["files"] = _copy_exports(workspace, directory, state)
                    checkpoint("study-reported", active_study_key=item_key)
            complete = not failures and all(row["state"] == "complete" for row in state["studies"])
            state["state"] = "complete" if complete else "partial"
            state["files"] = _copy_exports(workspace, directory, state)
            if args.archive:
                destination = args.archive.resolve()
                if destination.is_relative_to(root):
                    raise ValueError("Save the external suite ZIP outside the source workspace")
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_name("." + destination.name + ".partial")
                shutil.copyfile(directory / "gura-parameter-suite.zip", temporary)
                os.replace(temporary, destination)
                state["external_archive"] = receiver.artifact(destination, destination.parent)
            checkpoint("complete" if complete else "partial", active_study_key=None,
                       failed_study_keys=failures, completed_at=now() if complete else None)
            return 0 if complete else 1
        except Exception as error:
            try:
                checkpoint("error", state="error", error={
                    **(getattr(error, "native_failure", None) or {}),
                    "type": type(error).__name__, "message": str(error),
                    "traceback": traceback.format_exc()})
            except OSError:
                if not storage_exhausted(error):
                    raise
            logging.exception("Gura parameter suite stopped at its actual operation")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
