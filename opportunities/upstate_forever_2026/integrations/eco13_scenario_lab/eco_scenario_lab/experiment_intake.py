"""Adopt completed original experiments without submitting or changing any job.

Reads the NativeJobsEngine inspect envelope (plan/receipt/runs). Explicit JSON
Pointers bind the native inspection inside each original job record; no guessed
paths or fabricated model values. The original queue remains the only writer.
"""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path
import shutil
import tempfile
from typing import Any
from .engine import cost, safe_id, stamp
from .retention import RetentionSession
from .results import binding_for, build_comparison, read_results, render_report, rank
from .store import (ScenarioError, atomic_json, dataset_hash, digest, file_hash,
                    inside, read_json)

SUPPORTED = {"3.15.0", "3.20.0"}
DEFAULT_FIELDS = {"args": "/invest_args", "version": "/version",
                  "workspace": "/workspace", "model": "/model_type"}


def pointer(value: Any, path: str) -> Any:
    """Resolve an RFC6901 pointer, including escaped keys and array indices."""
    if path == "":
        return value
    if not isinstance(path, str) or not path.startswith("/"):
        raise ScenarioError("Native field selectors must be JSON Pointers")
    for encoded in path[1:].split("/"):
        key = encoded.replace("~1", "/").replace("~0", "~")
        try:
            if isinstance(value, list):
                if not key.isdigit() or (len(key) > 1 and key.startswith("0")):
                    raise KeyError(key)
                value = value[int(key)]
            elif isinstance(value, dict):
                value = value[key]
            else:
                raise KeyError(key)
        except (KeyError, IndexError) as exc:
            raise ScenarioError(f"Missing original native field at {path}") from exc
    return value


def adopt(selection_path: Path, destination: Path) -> dict:
    """Create a portable comparison workspace from original completed run records.

    Selection.names maps original job output shapes through JSON Pointers. All
    paths refer to the supplied original inspection's host, not a new scheduler.
    Caller may snapshot a whole `workspace.experiments.inspect(key)` to JSON.
    """
    selection = read_json(selection_path)
    if selection.get("source_format") == "upstate.experiment/v1":
        from .upstate_intake import adopt as adopt_upstate
        return adopt_upstate(selection_path, destination)
    if selection.get("schema") != 1:
        raise ScenarioError("Unsupported intake selection schema")
    for name in ("project_id", "setup_id"):
        safe_id(selection.get(name), name)
    if selection.get("currency") not in {"USD", "EUR", "GBP", "CAD", "AUD", "NZD"}:
        raise ScenarioError("Specify the original two-decimal currency")
    if destination.exists():
        raise ScenarioError("Experiment receiving is create-only")
    base = selection_path.resolve().parent
    inspection_path = (base / selection["inspection"]).resolve()
    inspection = read_json(inspection_path)
    receipt = inspection["receipt"]
    experiment_key = inspection["experiment_key"]
    if receipt["experiment_key"] != experiment_key or inspection["plan"]["experiment_key"] != experiment_key:
        raise ScenarioError("Inspection plan and receipt name different experiments")
    submitted = receipt["submitted"]
    if len(set(submitted.values())) != len(submitted):
        raise ScenarioError("Original experiment reuses a job key")
    planned_labels = [j["case_label"] for j in inspection["plan"]["jobs"]]
    if len(planned_labels) != len(set(planned_labels)) or not set(submitted).issubset(planned_labels):
        raise ScenarioError("Receipt submission differs from the original experiment plan")
    original_runs = {}
    for record in inspection["runs"]:
        key = str(record["job_key"])
        if key in original_runs or submitted.get(record["case_label"]) != key:
            raise ScenarioError("Original run identity does not match the submitted receipt")
        original_runs[key] = record
    definitions = {"baseline": {"id": "baseline", "cost_cents": 0}}
    for scenario in selection["scenarios"]:
        name = safe_id(scenario["id"], "scenario id")
        if name in definitions:
            raise ScenarioError("Duplicate scenario ID; baseline is reserved")
        definitions[name] = {**scenario, "cost_cents": cost(scenario["cost_cents"])}
    case_ids = [safe_id(c["id"], "case id") for c in selection["cases"]]
    if not case_ids or len(set(case_ids)) != len(case_ids):
        raise ScenarioError("Cases must be nonempty and unique")
    models = copy.deepcopy(selection["models"])
    if not models or not set(models) <= {"ndr", "sdr", "annual_water_yield"}:
        raise ScenarioError("Unsupported native model selection")
    for model, config in models.items():
        config["result"] = binding_for(model, config)
    selected = selection["runs"]
    if not selected:
        raise ScenarioError("Select original completed runs")
    if not models or not set(models) <= {"ndr", "sdr", "annual_water_yield"}:
        raise ScenarioError("Unsupported native model selection")
    original_root = Path(inspection["workspace"]).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".experiment-intake-", dir=destination.parent))
    input_inventory = {}
    retention = RetentionSession(stage)
    state = {"schema": 1, "jobs": {}, "active_jobs": {}, "prepared": {}}
    positions = set()
    native_receipts = set()
    native_versions = set()
    try:
        atomic_json(stage / "original-experiment.json", inspection)
        atomic_json(stage / "original-selection.json", selection)
        for choice in selected:
            original_key = str(choice["job_key"])
            if original_key not in original_runs:
                raise ScenarioError(f"Unsubmitted original job: {original_key}")
            record = original_runs[original_key]
            fields = {**DEFAULT_FIELDS, **selection.get("fields", {}), **choice.get("fields", {})}
            status = pointer(record, choice.get("status_pointer", selection.get("status_pointer", "/status")))
            complete_value = selection.get("complete_value", "complete")
            if status != complete_value:
                raise ScenarioError(f"Original job {original_key} is {status!r}, not {complete_value!r}")
            native_pointer = choice.get("native_pointer", selection.get("native_pointer", ""))
            native = pointer(record, native_pointer)
            model = choice["model"]
            if model not in models or pointer(native, fields["model"]) != model:
                raise ScenarioError("Selected model differs from the original native inspection")
            version = pointer(native, fields["version"])
            if isinstance(version, str) and version.startswith("invest/"):
                version = version[len("invest/"):]
            if not isinstance(version, str):
                raise ScenarioError("Native version must be an exact string")
            expected_engine = "invest/" + version
            if inspection["plan"]["native_engine"] != expected_engine:
                raise ScenarioError("Original plan and native result have different engine versions")
            if version not in SUPPORTED and not {"path", "id_field", "metrics"}.issubset(selection["models"][model].get("result", {})):
                raise ScenarioError("This native version requires explicit output path/fields/units")
            native_versions.add(version)
            case, scenario = choice["case_id"], choice["scenario_id"]
            position = (case, scenario, model)
            if case not in case_ids or scenario not in definitions or position in positions:
                raise ScenarioError("Unknown or duplicate case/scenario/model selection")
            positions.add(position)
            native_identity = (original_key, native_pointer)
            if native_identity in native_receipts:
                raise ScenarioError("A native result cannot stand in for two scenarios or cases")
            native_receipts.add(native_identity)
            args = copy.deepcopy(pointer(native, fields["args"]))
            if not isinstance(args, dict):
                raise ScenarioError("Original native arguments must be an object")
            if not args.get("watersheds_path") or not args.get("lulc_path"):
                raise ScenarioError("Original watershed and LULC inputs must be retained")
            absolute_args, retained_args, arg_digests = {}, {}, {}
            for key, value in args.items():
                if key.endswith("_path") and value not in (None, ""):
                    if not isinstance(value, str):
                        raise ScenarioError(f"Expected original native file argument: {key}")
                    source = (original_root / value).resolve()
                    relative, files = retention.snapshot(source)
                    input_inventory.update({f["path"]: f for f in files})
                    absolute_args[key] = str(source)
                    retained_args[key] = relative
                    arg_digests[key] = retention.dataset_hash(source)
                else:
                    absolute_args[key] = value
                    retained_args[key] = value
                    arg_digests[key] = value
            declared_digests = native.get("source_input_digests", {})
            for key, value in declared_digests.items():
                if key in absolute_args and isinstance(value, str):
                    source = Path(str(absolute_args[key]))
                    if source.is_file() and value not in {retention.source_hash(source), retention.dataset_hash(source)}:
                        raise ScenarioError(f"Native inspection input digest differs: {key}")
            native_dir = (original_root / pointer(native, fields["workspace"])).resolve()
            roots = [Path(r).resolve() for r in selection.get("native_roots", [str(original_root)])]
            if not roots or not any(native_dir.is_relative_to(r) for r in roots):
                raise ScenarioError("Native directory is outside the selected original host roots")
            if native_dir == Path(native_dir.anchor):
                raise ScenarioError("A filesystem root cannot be a selected native run directory")
            binding = models[model]["result"]
            table_name = Path(binding["path"])
            suffix = args.get("results_suffix", "")
            if suffix:
                suffix = suffix if suffix.startswith("_") else "_" + suffix
                table_name = table_name.with_name(table_name.stem + suffix + table_name.suffix)
            src_table = inside(native_dir, table_name.as_posix())
            # Reading the original table before copy fails immediately on wrong bindings.
            watershed_digest = retention.dataset_hash(Path(absolute_args["watersheds_path"]))
            original_values = read_results(src_table, binding, watershed_source_sha256=watershed_digest)
            provenance = {"experiment_key": experiment_key, "job_key": original_key,
                          "case_label": record["case_label"], "native_pointer": native_pointer,
                          "inspection_sha256": file_hash(inspection_path),
                          "args": args, "retained_args": retained_args,
                          "input_digests": arg_digests, "native": native}
            jid = digest({"provenance": provenance, "selection": position})[:32]
            run_root = stage / "runs" / jid
            retained_native = retention.native_directory(native_dir)
            native_reference = {key: retained_native[key] for key in
                                ("path", "directory_sha256", "logical_bytes")}
            atomic_json(run_root / "original-run.json", provenance)
            atomic_json(run_root / "native-files.json", retained_native["files"])
            atomic_json(run_root / "native-reference.json", native_reference)
            table = inside(stage, retained_native["path"] + "/" + table_name.as_posix())
            copied_values = read_results(table, binding, watershed_source_sha256=watershed_digest)
            if copied_values != original_values:
                raise ScenarioError("Native table changed between inspection and copy")
            result = run_root / "results.json"
            atomic_json(result, copied_values)
            identity = native.get("engine_identity", selection.get("engine_identity", "natcap.invest"))
            unchanged = {k: v for k, v in arg_digests.items() if k not in {
                "lulc_path", "workspace_dir", "results_suffix", "n_workers"}}
            comparison_key = digest({"model": model, "version": version,
                                     "engine_identity": identity, "case_id": case,
                                     "unchanged": unchanged,
                                     "runtime": pointer(native, fields["runtime"]) if "runtime" in fields else native.get("runtime", {}),
                                     "model_code": pointer(native, fields["model_code"]) if "model_code" in fields else native.get("module_sha256")})
            state["jobs"][jid] = {"id": jid, "case_id": case, "scenario_id": scenario,
                 "model": model, "status": "complete", "comparison_key": comparison_key,
                 "engine_identity": identity, "invest_version": version,
                 "original_job_key": original_key, "original_case_label": record["case_label"],
                 "original_experiment_key": experiment_key,
                 "native_table_path": table.relative_to(stage).as_posix(),
                 "native_storage": native_reference,
                 "native_dataset_sha256": dataset_hash(table),
                 "result_path": result.relative_to(stage).as_posix(), "result_sha256": file_hash(result),
                 "attempts": [{"workspace": run_root.relative_to(stage).as_posix(),
                               "status": "complete", "origin": "adopted-original-run"}]}
            state["active_jobs"]["/".join(position)] = jid
        plan = {"schema": 1, "mode": "adopted-experiment", "project_id": selection["project_id"],
                "setup_id": selection["setup_id"], "currency": selection["currency"],
                "cases": selection["cases"], "scenarios": list(definitions.values())[1:],
                "models": models, "native": {"invest_version": next(iter(native_versions))},
                "source_manifest": {"original_experiment_key": experiment_key,
                                    "inspection_sha256": file_hash(inspection_path)},
                "inputs": sorted(input_inventory.values(), key=lambda x: x["path"]),
                "created_at": stamp()}
        if len(native_versions) != 1:
            raise ScenarioError("An adopted experiment must use one native version")
        plan["plan_sha256"] = digest(plan)
        atomic_json(stage / "plan.json", plan)
        atomic_json(stage / "state.json", state)
        comparison = build_comparison(stage)
        ranking = None
        if selection.get("objectives") and not comparison["incomplete"]:
            ranking = rank(comparison, selection["objectives"], selection.get("budget_cents"))
            atomic_json(stage / "reports" / "ranking.json", ranking)
        report = render_report(stage, comparison, ranking)
        storage = retention.verify()
        atomic_json(stage / "receiving-storage.json", storage)
        if read_json(inspection_path) != inspection:
            raise ScenarioError("Original experiment inspection changed during receiving")
        stage.rename(destination)
        return {"workspace": str(destination), "original_experiment_key": experiment_key,
                "adopted_jobs": len(state["jobs"]), "paired_records": len(comparison["rows"]),
                "incomplete": comparison["incomplete"], "native_versions": sorted(native_versions),
                "storage": storage,
                "report": str(destination / report.relative_to(stage))}
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("selection", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args(argv)
    try:
        result = adopt(args.selection, args.destination)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 2 if result["incomplete"] else 0
    except (ScenarioError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
