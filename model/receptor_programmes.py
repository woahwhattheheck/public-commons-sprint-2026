"""Bind prepared source-water interventions to the maintained paired experiment.

The original experiment planner owns profile pairing and the programme service
owns native calculation, pause, recovery and completed-result synchronization.
"""
from __future__ import annotations

from copy import deepcopy
import csv
from html import escape
import io

from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     identifier, now, read_json, selected_models, verify_file)
from . import receptor_scenarios

SCHEMA = "upstate.receptor-programme/v1"
SELECTION_SCHEMA = "upstate.receptor-programme-selection/v1"
FOLDER = "receptor-programmes"


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply " + label)
    return value.strip()


def _ids(value, label):
    if not isinstance(value, list) or not value:
        raise ValueError("Select at least one " + label)
    values = [identifier(item) for item in value]
    if len(set(values)) != len(values):
        raise ValueError("Select distinct " + label)
    return values


def _selection(workspace, selected):
    if not isinstance(selected, dict):
        raise ValueError("Supply the source-water programme selection")
    allowed = {"schema", "title", "reason", "preparation_id", "grid_id",
               "baseline_scenario_id", "profile_ids", "scenario_ids", "models"}
    if set(selected) - allowed:
        raise ValueError("Unknown source-water programme fields: "
                         + ", ".join(sorted(set(selected) - allowed)))
    if selected.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select an " + SELECTION_SCHEMA + " document")
    raw_models = selected.get("models")
    if (not isinstance(raw_models, list) or not raw_models
            or len(set(raw_models)) != len(raw_models)
            or any(item not in ("ndr", "sdr") for item in raw_models)):
        raise ValueError("Explicitly select NDR, SDR or both native models")
    selection = {
        "schema": SELECTION_SCHEMA, "title": _text(selected.get("title"), "a programme title"),
        "reason": _text(selected.get("reason"), "the comparison purpose"),
        "preparation_id": identifier(selected.get("preparation_id")),
        "grid_id": identifier(selected.get("grid_id")),
        "baseline_scenario_id": identifier(selected.get("baseline_scenario_id")),
        "profile_ids": _ids(selected.get("profile_ids"), "retained parameter profiles"),
        "scenario_ids": _ids(selected.get("scenario_ids"), "prepared land-cover scenarios"),
        "models": [model for model in ("ndr", "sdr") if model in raw_models],
    }
    prepared = receptor_scenarios.inspect(workspace, selection["preparation_id"])
    grid = workspace.get_grid(selection["grid_id"])
    if grid.get("state") != "complete":
        raise ValueError("Choose a completed original native grid")
    spec = grid["spec"]
    _, original = workspace.source_file(spec["source_collection_id"],
                                         spec["model_domain"]["source_id"])
    if original["body"]["sha256"] != prepared["source_binding"]["body_sha256"]:
        raise ValueError("Choose a model grid made from this study's original watershed source")
    baseline = workspace._get("scenarios", selection["baseline_scenario_id"])
    if baseline.get("kind") != "baseline":
        raise ValueError("Use the retained original land-cover baseline")
    scenarios = [workspace._get("scenarios", key) for key in selection["scenario_ids"]]
    areas = {area["id"]: area for area in prepared["areas"]}
    for scenario in scenarios:
        if (scenario.get("kind") != "landcover"
                or scenario.get("source_collection_id") != prepared["source_collection_id"]
                or scenario.get("source_area_selection", {}).get("preparation_id") != prepared["id"]):
            raise ValueError("Choose land-cover scenarios saved on these exact prepared source areas")
        patches = scenario.get("patches", [])
        if not patches or any(
                patch.get("receptor_id") not in areas
                or patch.get("source_plan_id") != prepared["id"]
                or patch.get("network_result_id") != prepared["network_result_id"]
                or patch.get("mask_source_id") != areas[patch["receptor_id"]]["source_id"]
                for patch in patches):
            raise ValueError("The saved scenario differs from its prepared original polygon sources")
    profiles = [workspace._get("profiles", key) for key in selection["profile_ids"]]
    for profile in profiles:
        if not set(selection["models"]).issubset(selected_models(profile)):
            raise ValueError("Each selected profile must support the chosen native models")
        available = set(profile["table_summary"]["lucodes"])
        destinations = {patch["to_code"] for scenario in scenarios for patch in scenario["patches"]}
        if destinations - available:
            raise ValueError("Profile " + profile["title"] + " lacks scenario destination codes: "
                             + ", ".join(map(str, sorted(destinations - available))))
    return selection, prepared, grid, original, baseline, profiles, scenarios


def preview(workspace, selection):
    """Inspect actual retained inputs without preparing or executing native runs."""
    from .compute_programme import ComputeProgrammes
    selected, prepared, grid, original, baseline, profiles, scenarios = _selection(workspace, selection)
    rows = []
    for p, profile in enumerate(profiles):
        for s, scenario in enumerate([baseline, *scenarios]):
            rows.append({"key": "p" + str(p) + "-s" + str(s),
                         "title": profile["title"] + " / " + scenario["title"],
                         "profile_id": profile["id"], "scenario_id": scenario["id"],
                         "models": selected["models"]})
    planned = ComputeProgrammes(workspace).preview({
        "schema": "upstate.compute-programme-selection/v1", "title": selected["title"],
        "description": selected["reason"], "grid_id": grid["id"], "baseline_run": "p0-s0",
        "runs": rows, "source_reference": "upstate.receptor-scenario-areas:" + prepared["id"]})
    runs = planned["runs"]
    baseline_ids = {row["profile_id"]: row["run_id"] for row in runs
                    if row["scenario_id"] == baseline["id"]}
    for row in runs:
        row["paired_baseline_run_id"] = baseline_ids[row["profile_id"]]
        row["is_baseline"] = row["scenario_id"] == baseline["id"]
    identity = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
                "selection": selected, "source_body_sha256": prepared["source_binding"]["body_sha256"],
                "source_collection_id": prepared["source_collection_id"],
                "grid_identity": planned["grid_identity"],
                "native_run_ids": [row["run_id"] for row in runs]}
    return {"schema": "upstate.receptor-programme-preview/v1", "id": digest(identity),
            "identity": identity, "selection": selected, "title": selected["title"],
            "preparation_id": prepared["id"], "network_result_id": prepared["network_result_id"],
            "source_collection_id": prepared["source_collection_id"],
            "grid_id": grid["id"], "models": selected["models"], "runs": runs,
            "profiles": [{"id": row["id"], "title": row["title"]} for row in profiles],
            "scenarios": [{"id": row["id"], "title": row["title"]} for row in scenarios],
            "reference_profile_id": profiles[0]["id"],
            "counts": {"profiles": len(profiles), "alternatives": len(scenarios),
                       "runs": len(runs), "baselines": len(profiles),
                       "existing_runs": sum(row["existing"] for row in runs),
                       "complete_runs": sum(row["state"] == "complete" for row in runs),
                       "paired_comparisons": len(profiles) * len(scenarios)}}


def inspect(workspace, key, *, live=True):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    record = read_json(directory / "result.json")
    if (record.get("schema") != SCHEMA or record.get("id") != key
            or digest(record["identity"]) != key
            or record.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Choose a retained source-water programme in this workspace")
    for item in record["files"].values():
        verify_file(directory, item)
    result = {**record, "files": {**record["files"],
              "result": describe_file(directory, directory / "result.json")}}
    if live:
        from .compute_programme import ComputeProgrammes
        programme = ComputeProgrammes(workspace).status(record["programme_id"],
                                                         include_ensemble_candidates=False)
        if programme["selection"].get("source_reference") != "upstate.experiment:" + record["experiment_id"]:
            raise ValueError("The native programme differs from its retained paired experiment")
        result["native_programme"] = programme
        result["state"] = programme["state"]
    return result


def _write_report(directory, previewed, experiment_id, programme_id):
    rows = "".join("<tr><td>" + escape(row["profile_title"]) + "</td><td>"
                   + escape(row["scenario_title"]) + "</td><td>"
                   + ("Original baseline" if row["is_baseline"] else "Land-cover alternative")
                   + "</td><td><code>" + row["run_id"] + "</code></td><td><code>"
                   + row["paired_baseline_run_id"] + "</code></td></tr>"
                   for row in previewed["runs"])
    body = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>'
            + escape(previewed["title"]) + '</title><style>body{font:16px system-ui;color:#222;'
            'max-width:1200px;margin:40px auto;padding:0 24px}table{border-collapse:collapse;'
            'width:100%}th,td{border-bottom:1px solid #bbb;padding:8px;text-align:left}'
            'code{font-size:12px;overflow-wrap:anywhere}a{color:inherit}</style><h1>'
            + escape(previewed["title"]) + '</h1><p>' + escape(previewed["selection"]["reason"])
            + '</p><p>Every retained parameter profile has its own original land-cover baseline. '
            'The maintained experiment planner prepares these scientific pairs; the native programme '
            'runs and resumes them using their existing selections and completed stages.</p>'
            '<table><thead><tr><th>Profile</th><th>Scenario</th><th>Case</th>'
            '<th>Native run</th><th>Matching baseline</th></tr></thead><tbody>' + rows
            + '</tbody></table><p>Native programme: <code>' + programme_id
            + '</code></p><p>Paired experiment: <code>' + experiment_id + '</code></p><p>'
            '<a href="planned-runs.csv">Complete planned run table</a> · '
            '<a href="selection.json">Source-water programme selection</a> · '
            '<a href="source-water-comparison.json">Prepared source-water comparison selection</a>'
            '</p><p>This retained plan records the saved selections. Open the programme in the '
            'workbench for current execution state, original logs, paired maps and completed results.</p></html>\n')
    atomic_bytes(directory / "index.html", body.encode("utf-8"), immutable=True)
    stream = io.StringIO(newline="")
    fields = ["profile_id", "profile_title", "scenario_id", "scenario_title",
              "run_id", "paired_baseline_run_id", "is_baseline"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows({name: row[name] for name in fields} for row in previewed["runs"])
    atomic_bytes(directory / "planned-runs.csv", stream.getvalue().encode("utf-8"), immutable=True)


def create(workspace, selection, *, expected_preview_id=None):
    """Create the actual experiment and its existing native programme."""
    from . import experiments, programme_experiments
    proposed = preview(workspace, selection)
    key = proposed["id"]
    if expected_preview_id is not None and identifier(expected_preview_id) != key:
        raise ValueError("The source-water selections changed; review the current programme")
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        if (directory / "result.json").exists():
            return inspect(workspace, key)
        selected = proposed["selection"]
        baseline = workspace.prepare_run({
            "grid_id": selected["grid_id"], "profile_id": selected["profile_ids"][0],
            "scenario_id": selected["baseline_scenario_id"], "models": selected["models"]})
        experiment = experiments.prepare(workspace, {
            "schema": "upstate.experiment-selection/v1", "title": selected["title"],
            "reason": selected["reason"], "baseline_run_id": baseline["id"],
            "scenario_ids": selected["scenario_ids"], "profile_ids": selected["profile_ids"][1:],
            "design": "one_at_a_time", "axes": []})
        programme = programme_experiments.create(workspace, experiment["id"])
        actual_ids = {row["run_id"] for row in programme["runs"]}
        if actual_ids != {row["run_id"] for row in proposed["runs"]}:
            raise ValueError("The maintained experiment differs from the reviewed native selections")
        prepared = receptor_scenarios.inspect(workspace, selected["preparation_id"])
        source_directory = workspace.root / receptor_scenarios.FOLDER / prepared["id"]
        receptor_spec = deepcopy(read_json(verify_file(source_directory, prepared["files"]["profile"])))
        selected_areas = {area["id"] for area in prepared["areas"]}
        receptor_spec["receptors"] = [area for area in receptor_spec["receptors"]
                                      if area["id"] in selected_areas]
        grid = workspace.get_grid(selected["grid_id"])
        spec = grid["spec"]
        _, original = workspace.source_file(spec["source_collection_id"], spec["model_domain"]["source_id"])
        receptor_spec["source_network_reference"] = deepcopy(receptor_spec.get("source_reference") or prepared["source_binding"])
        receptor_spec["source_collection_id"] = spec["source_collection_id"]
        receptor_spec["network_source_id"] = spec["model_domain"]["source_id"]
        receptor_spec["source_reference"] = {
            "source_collection_id": spec["source_collection_id"], "source_id": original["id"],
            **{name: original[name] for name in ("title", "uri", "vintage")},
            "sha256": original["body"]["sha256"]}
        comparison = {"title": selected["title"] + " — source-water comparisons",
                      "experiment_id": experiment["id"], "receptor_spec": receptor_spec,
                      "profile_ids": [], "scenario_ids": selected["scenario_ids"]}
        atomic_json(directory / "selection.json", selected, immutable=True)
        atomic_json(directory / "source-water-comparison.json", comparison, immutable=True)
        _write_report(directory, proposed, experiment["id"], programme["id"])
        record = {"schema": SCHEMA, "id": key, "identity": proposed["identity"],
                  "workspace_id": workspace.project["id"], "title": selected["title"],
                  "created_at": now(), "state": "prepared", "selection": selected,
                  "preparation_id": prepared["id"], "network_result_id": prepared["network_result_id"],
                  "source_collection_id": prepared["source_collection_id"],
                  "source_binding": deepcopy(prepared["source_binding"]),
                  "grid_id": selected["grid_id"], "models": selected["models"],
                  "experiment_id": experiment["id"], "programme_id": programme["id"],
                  "counts": proposed["counts"], "runs": proposed["runs"],
                  "comparison_selection": comparison,
                  "files": {name: describe_file(directory, directory / filename) for name, filename in
                            (("selection", "selection.json"), ("comparison", "source-water-comparison.json"),
                             ("runs", "planned-runs.csv"), ("report", "index.html"))}}
        atomic_json(directory / "result.json", record, immutable=True)
    return inspect(workspace, key)


def compare(workspace, key):
    """Collect completed original pairs and build their receiving-area reports."""
    from . import programme_experiments, receptor_experiments
    record = inspect(workspace, key)
    programme = record["native_programme"]
    if programme["state"] != "complete":
        raise ValueError("Continue the saved native programme before collecting its complete source-water comparison")
    programme_experiments.sync_completed(workspace, programme)
    return receptor_experiments.build(workspace, record["comparison_selection"])
