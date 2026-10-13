"""Summarize completed native baselines and scenarios from retained quantities."""
from __future__ import annotations
import csv
import io
import math
from pathlib import Path
from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_bytes, atomic_json,
                     describe_file, digest, finite, identifier, read_json)

SCHEMA = "upstate.scenario-summary/v1"
DIRECTION = "alternative minus baseline"
POLLUTANTS = {
    "nitrogen_export": ("Nitrogen", "ndr", "n_total_export", "kg"),
    "phosphorus_export": ("Phosphorus", "ndr", "p_surface_export", "kg"),
    "sediment_export": ("Sediment", "sdr", "sed_export", "metric_tonnes"),
}
KINDS = {
    "baseline": "Baseline",
    "landcover_alternative": "Land-cover alternative",
    "parameter_sensitivity": "Parameter sensitivity",
    "landcover_and_parameter_sensitivity": "Land cover and parameter sensitivity",
    "same_model_assumptions": "Same model assumptions",
}
REFERENCES = [
    {"title": "InVEST 3.20.0 Nutrient Delivery Ratio guide",
     "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"},
    {"title": "InVEST 3.20.0 Sediment Delivery Ratio guide",
     "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"},
    {"title": "Original InVEST 3.20.0 NDR source",
     "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py"},
    {"title": "Original InVEST 3.20.0 SDR source",
     "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py"},
]
CSV_FIELDS = (
    "run_names", "scenario_title", "profile_title", "comparison_kind", "pollutant",
    "sum", "sum_units", "valid_cells", "valid_area_ha", "average_per_valid_ha",
    "average_units", "sum_change", "avoided_export", "change_units",
    "joint_valid_cells", "joint_valid_area_ha", "benefit_percent",
    "benefit_percent_reason", "average_reason", "baseline_sum", "baseline_valid_cells",
    "profile_changed", "scenario_changed", "landcover_changed", "run_id",
    "baseline_run_id", "scenario_id", "profile_id", "grid_id", "comparison_id",
    "native_model", "native_output_id", "native_units", "units", "pixel_area_ha",
    "artifact_path", "artifact_sha256", "difference_path", "difference_sha256",
)


def _cells(value, label):
    if type(value) is not int or value < 0:
        raise ValueError(label + " must be a nonnegative integer")
    return value


def _scenario_assumptions(scenario):
    if scenario["kind"] == "baseline":
        return {"kind": "baseline"}
    return {key: scenario.get(key) for key in ("kind", "source_collection_id", "patches")}


def _run_context(workspace, run, names, baseline=None, comparison=None):
    scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
    profile = workspace._get("profiles", run["selection"]["profile_id"])
    profile_changed = baseline is not None and profile["id"] != baseline["profile"]["id"]
    scenario_changed = baseline is not None and scenario["id"] != baseline["scenario"]["id"]
    landcover_changed = baseline is not None and (
        _scenario_assumptions(scenario) != _scenario_assumptions(baseline["scenario"]))
    if baseline is None:
        kind = "baseline"
    elif profile_changed and landcover_changed:
        kind = "landcover_and_parameter_sensitivity"
    elif profile_changed:
        kind = "parameter_sensitivity"
    elif landcover_changed:
        kind = "landcover_alternative"
    else:
        kind = "same_model_assumptions"
    if comparison is not None:
        if comparison["selection"] != run["selection"]:
            raise ValueError("Comparison selection differs from its retained run")
        if comparison["profile_changed"] != profile_changed:
            raise ValueError("Comparison profile identity differs from its retained runs")
    return {
        "run_id": run["id"], "run_names": names, "selection": run["selection"],
        "scenario": scenario, "profile": profile, "comparison_kind": kind,
        "comparison_label": KINDS[kind], "profile_changed": profile_changed,
        "scenario_changed": scenario_changed, "landcover_changed": landcover_changed,
        "runtime": run.get("runtime"), "completed_at": run["completed_at"],
        "landcover_edits": run.get("stages", {}).get("landcover", {}).get("edits", []),
    }


def _quantity(run, context, pollutant, grid):
    label, model, native_id, mass = POLLUTANTS[pollutant]
    artifact = run["artifacts"][pollutant]
    units, sum_units, native_units = mass + "/pixel/year", mass + "/year", mass + "/ha/year"
    for field, expected in (("units", units), ("sum_units", sum_units), ("native_units", native_units)):
        if artifact[field] != expected:
            raise ValueError(pollutant + " has unexpected retained " + field)
    total = finite(artifact["sum"], pollutant + " total", minimum=0)
    count = _cells(artifact["valid_cells"], pollutant + " valid cells")
    area = finite(artifact["pixel_area_ha"], pollutant + " pixel area", positive=True)
    if not math.isclose(area, grid["grid"]["pixel_area_ha"], rel_tol=1e-10, abs_tol=1e-12):
        raise ValueError("Run pixel area differs from its retained grid")
    row = {
        "run_id": run["id"], "run_names": context["run_names"],
        "scenario_id": context["scenario"]["id"], "scenario_title": context["scenario"]["title"],
        "profile_id": context["profile"]["id"], "profile_title": context["profile"]["title"],
        "comparison_kind": context["comparison_kind"], "comparison_label": context["comparison_label"],
        "profile_changed": context["profile_changed"], "scenario_changed": context["scenario_changed"],
        "landcover_changed": context["landcover_changed"], "grid_id": grid["id"],
        "pollutant": pollutant, "pollutant_label": label, "native_model": model,
        "native_output_id": native_id, "native_units": native_units, "units": units,
        "sum": total, "sum_units": sum_units, "valid_cells": count, "pixel_area_ha": area,
        "valid_area_ha": count * area, "average_units": native_units,
        "artifact_path": "runs/" + run["id"] + "/" + artifact["path"],
        "artifact_sha256": artifact["sha256"], "artifact": artifact,
    }
    if count:
        row["average_per_valid_ha"] = total / row["valid_area_ha"]
    else:
        row["average_reason"] = "The retained export has zero valid reporting cells."
    return row


def _add_change(row, baseline, comparison, comparison_id):
    artifact = comparison["artifacts"][row["pollutant"]]
    if artifact["units"] != row["units"] or artifact["direction"] != DIRECTION:
        raise ValueError("Comparison quantity has different units or direction")
    change = finite(artifact["sum_change"], row["pollutant"] + " export change")
    joint = _cells(artifact["valid_cells"], row["pollutant"] + " joint-valid cells")
    if joint > min(baseline["valid_cells"], row["valid_cells"]):
        raise ValueError("Comparison coverage exceeds one of its source runs")
    row.update(
        baseline_sum=baseline["sum"], baseline_valid_cells=baseline["valid_cells"],
        comparison_id=comparison_id, sum_change=change, avoided_export=-change,
        change_units=row["sum_units"], direction=DIRECTION,
        joint_valid_cells=joint, joint_valid_area_ha=joint * row["pixel_area_ha"],
        difference_path="comparisons/" + comparison_id + "/" + artifact["path"],
        difference_sha256=artifact["sha256"], difference_artifact=artifact,
    )
    reasons = []
    if joint != baseline["valid_cells"] or joint != row["valid_cells"]:
        reasons.append(
            f"Joint-valid coverage is {joint} cells; baseline has "
            f"{baseline['valid_cells']} and alternative has {row['valid_cells']} valid cells.")
    if baseline["sum"] <= 0:
        reasons.append(f"Baseline export is {baseline['sum']:g} {baseline['sum_units']}; percentage benefit requires a positive baseline.")
    if reasons:
        row["benefit_percent_reason"] = " ".join(reasons)
    else:
        row["benefit_percent"] = -change / baseline["sum"] * 100.0


def _comparison(workspace, comparison_id):
    comparison_id = identifier(comparison_id)
    value = read_json(workspace.root / "comparisons" / comparison_id / "comparison.json")
    if value.get("schema") != "upstate.run-comparison/v1" or value["direction"] != DIRECTION:
        raise ValueError("Select the retained alternative-minus-baseline comparison")
    ids = [value["baseline_run_id"]] + [item["run_id"] for item in value["alternatives"]]
    if len(ids) < 2 or len(set(ids)) != len(ids):
        raise ValueError("Comparison must contain a baseline and distinct alternatives")
    from .native_versions import validate_run_comparison
    validate_run_comparison(workspace, value, expected_id=comparison_id)
    return value, ids


def _build(workspace, metadata, ids, aliases, comparison, pollutants, delivery=None):
    grid = workspace.get_grid(metadata["grid_id"])
    collection = workspace._get("sources", metadata["source_collection_id"])
    if collection["id"] != grid["spec"]["source_collection_id"]:
        raise ValueError("Summary and grid select different source editions")
    if collection["original_manifest"]["sha256"] != metadata["source_manifest_sha256"]:
        raise ValueError("Summary and retained source manifest differ")
    comparison_id = comparison["id"] if comparison is not None else None
    runs, rows, baseline_rows = [], [], {}
    for index, run_id in enumerate(ids):
        run = workspace.inspect_run(run_id)
        if run["state"] != "complete" or run["id"] != run_id:
            raise ValueError("Summaries require completed retained native runs")
        if run["selection"]["grid_id"] != grid["id"] or run["selection"]["invest_version"] != INVEST_VERSION:
            raise ValueError("Summarized runs require the selected grid and InVEST version")
        if set(run["artifacts"]).intersection(POLLUTANTS) != set(pollutants):
            raise ValueError("Retained run exports differ from the selected native models")
        alternative = comparison["alternatives"][index - 1] if index else None
        context = _run_context(workspace, run, aliases[run_id],
                               baseline=runs[0] if index else None, comparison=alternative)
        runs.append(context)
        for pollutant in pollutants:
            row = _quantity(run, context, pollutant, grid)
            row.update(baseline_run_id=ids[0], comparison_id=comparison_id)
            if index:
                _add_change(row, baseline_rows[pollutant], alternative, comparison_id)
            else:
                baseline_rows[pollutant] = row
            rows.append(row)
    interpretation = [
        "Annual totals sum each pollutant's retained valid reporting-mask cells. Mean export per valid hectare is the saved total divided by valid area (valid cells multiplied by cell area).",
    ]
    if comparison is not None:
        interpretation.extend([
            "Change is alternative minus baseline over joint-valid cells. Avoided export is the negative of that change; positive avoided export means less modeled delivery to streams.",
            "Percentage benefit is 100 times avoided export divided by baseline export, when joint-valid coverage equals both original runs and baseline export is positive.",
            "Land-cover alternatives share the baseline parameter profile. Sensitivity labels identify changed parameter profiles and combinations of parameter and land-cover changes.",
        ])
    model_names = {POLLUTANTS[name][1] for name in pollutants}
    meanings = []
    if "ndr" in model_names:
        meanings.append("NDR nitrogen combines surface and subsurface export; phosphorus uses surface export.")
    if "sdr" in model_names:
        meanings.append("SDR sediment describes overland sediment delivered to mapped streams.")
    interpretation.append(" ".join(meanings))
    summary = {
        "schema": SCHEMA, "title": metadata["title"],
        "baseline_run_id": ids[0], "alternative_run_ids": ids[1:], "comparison_id": comparison_id,
        "completed_at": metadata["completed_at"], "direction": DIRECTION,
        "context": {
            "workspace": workspace.project, "native_selection_id": metadata["native_selection_id"],
            "source_reference": metadata["source_reference"],
            "source_manifest_sha256": metadata["source_manifest_sha256"],
            "invest_version": INVEST_VERSION, "invest_source": INVEST_SOURCE,
            "grid": {"id": grid["id"], "spec": grid["spec"], "definition": grid["grid"],
                     "inputs": grid["inputs"], "files": grid["files"]},
            "source_collection": {
                "id": collection["id"], "title": collection["title"],
                "original_manifest": collection["original_manifest"],
                "entries": [{key: item[key] for key in
                    ("id", "title", "kind", "role", "uri", "vintage", "units", "conversion",
                     "derived_from", "native_grid", "model_grid", "regional_grid_id",
                     "regional_preparation_id", "source_resolution", "citation", "body", "companions")
                    if key in item} for item in collection["entries"]],
            },
            **metadata.get("context", {}),
        },
        "runs": runs, "rows": rows, "interpretation": interpretation,
        "references": [item for item in REFERENCES
                       if any("/" + model + "." in item["url"] or "/" + model + "/" in item["url"]
                              for model in model_names)],
    }
    if delivery is not None:
        summary["delivery"] = {key: delivery[key] for key in
                              ("id", "state", "completed_at", "selection", "package", "files") if key in delivery}
    summary["id"] = digest(summary)
    return summary


def build_summary(workspace, model_receiving, delivery=None):
    """Return full-delivery quantities using small retained JSON records."""
    if model_receiving.get("schema") != "upstate.native-model-receiving/v1":
        raise ValueError("Select a completed native model receiving document")
    if model_receiving["workspace_id"] != workspace.project["id"]:
        raise ValueError("Native receiving belongs to another workspace")
    comparison, ids = _comparison(workspace, model_receiving["comparison_id"])
    if ids[0] != model_receiving["delivery_selection"]["baseline_run_id"]:
        raise ValueError("Comparison and delivery select different baselines")
    aliases = {}
    for name, run_id in model_receiving["runs"].items():
        aliases.setdefault(run_id, []).append(name)
    if any(run_id not in aliases for run_id in ids):
        raise ValueError("Comparison contains a run outside the native receiving selection")
    metadata = {key: model_receiving[key] for key in
                ("grid_id", "source_collection_id", "source_manifest_sha256",
                 "native_selection_id", "source_reference", "completed_at")}
    metadata["title"] = model_receiving["delivery_selection"].get("title", workspace.project["title"])
    return _build(workspace, metadata, ids, aliases, comparison, tuple(POLLUTANTS), delivery)


def build_core_summary(workspace, core_result, scenarios_result=None, *, title=None):
    """Summarize an actual completed regional baseline and optional paired scenarios.

    Accepts the retained upstate.regional-core-result/v1 and, when supplied,
    upstate.regional-scenarios-result/v1. Selected NDR, SDR and combined results
    share the same physical quantity and comparison rules as full delivery.
    """
    from .common import output_models, selected_models
    if core_result.get("schema") != "upstate.regional-core-result/v1":
        raise ValueError("Select a completed original regional core result")
    if core_result["workspace_id"] != workspace.project["id"]:
        raise ValueError("Regional core belongs to another workspace")
    baseline_id = identifier(core_result["baseline_run_id"])
    baseline = workspace.inspect_run(baseline_id)
    expected = {key: core_result[key] for key in ("grid_id", "profile_id", "scenario_id")}
    if any(baseline["selection"][key] != value for key, value in expected.items()):
        raise ValueError("Regional core differs from its retained baseline selection")
    models = selected_models(core_result)
    if selected_models(baseline["selection"]) != models:
        raise ValueError("Regional core and retained baseline select different models")
    aliases, ids, comparison = {baseline_id: ["baseline"]}, [baseline_id], None
    source_record = {
        "schema": core_result["schema"], "core_selection_id": core_result["core_selection_id"],
        "baseline_run_id": baseline_id,
    }
    completed_at, selection_id = core_result["completed_at"], core_result["core_selection_id"]
    if scenarios_result is not None:
        if scenarios_result.get("schema") != "upstate.regional-scenarios-result/v1":
            raise ValueError("Select a completed original regional scenarios result")
        for key in ("workspace_id", "core_selection_id", "grid_id", "profile_id", "baseline_run_id"):
            if scenarios_result[key] != core_result[key]:
                raise ValueError("Regional scenarios differ from their selected core: " + key)
        if selected_models(scenarios_result) != models:
            raise ValueError("Regional scenarios and baseline select different models")
        if scenarios_result["source_collections"]["model"] != core_result["source_collection_id"]:
            raise ValueError("Regional scenarios and baseline use different core source editions")
        named = scenarios_result["scenario_runs"]
        if not isinstance(named, dict) or not named or len(set(named.values())) != len(named):
            raise ValueError("Regional scenarios require distinct named retained runs")
        if baseline_id in named.values():
            raise ValueError("Regional alternatives must differ from their baseline")
        comparison, ids = _comparison(workspace, scenarios_result["comparison_id"])
        if ids[0] != baseline_id or set(ids[1:]) != set(named.values()):
            raise ValueError("Regional comparison differs from the selected scenario runs")
        for name, run_id in named.items():
            run = workspace.inspect_run(run_id)
            if run["selection"]["profile_id"] != core_result["profile_id"]:
                raise ValueError("Regional land-cover alternatives require the original profile")
            if run["selection"]["scenario_id"] != scenarios_result["scenarios"][name]:
                raise ValueError("Regional scenario name differs from its retained run")
            if selected_models(run["selection"]) != models:
                raise ValueError("Regional scenario run selects different native models")
            aliases[run_id] = [name]
        source_record.update(
            scenarios_schema=scenarios_result["schema"],
            scenario_selection_id=scenarios_result["scenario_selection_id"],
            core_result_sha256=scenarios_result["core_result_sha256"],
        )
        completed_at = scenarios_result["completed_at"]
        selection_id = scenarios_result["scenario_selection_id"]
    metadata = {key: core_result[key] for key in
                ("grid_id", "source_collection_id", "source_manifest_sha256", "source_reference")}
    metadata.update(
        title=title or workspace.project["title"], completed_at=completed_at,
        native_selection_id=selection_id,
        context={"models": models, "source_record": source_record},
    )
    return _build(workspace, metadata, ids, aliases, comparison, tuple(output_models(models)))



def build_delivery_summary(workspace, selection, comparison, *, baseline=None,
                           alternatives=None, grid=None):
    """Summarize a delivery on the current regional quantity and support path."""
    retained, ids = _comparison(workspace, comparison["id"])
    selected = [identifier(selection["baseline_run_id"])] + [
        identifier(value) for value in selection.get("scenario_run_ids", [])]
    if ids != selected:
        raise ValueError("Delivery summary must use its exact retained comparison")
    baseline = baseline or workspace.inspect_run(ids[0])
    alternatives = alternatives if alternatives is not None else [
        workspace.inspect_run(value) for value in ids[1:]]
    runs = [baseline, *alternatives]
    if [run["id"] for run in runs] != ids:
        raise ValueError("Delivery summary runs differ from the selected order")
    grid = grid or workspace.get_grid(baseline["selection"]["grid_id"])
    collection = workspace._get("sources", grid["spec"]["source_collection_id"])
    pollutants = tuple(name for name in POLLUTANTS if name in baseline["artifacts"])
    if not pollutants:
        raise ValueError("Delivery summary has no selected native export quantities")
    aliases = {value: ["baseline" if index == 0 else "alternative-" + str(index)]
               for index, value in enumerate(ids)}
    metadata = {
        "grid_id": grid["id"], "source_collection_id": collection["id"],
        "source_manifest_sha256": collection["original_manifest"]["sha256"],
        "native_selection_id": None,
        "source_reference": selection.get("source_reference") or
            "Retained application source accompanies this delivery",
        "completed_at": max(run["completed_at"] for run in runs),
        "title": selection.get("title", workspace.project["title"]),
        "context": {"delivery_selection": dict(selection)},
    }
    return _build(workspace, metadata, ids, aliases, retained, pollutants)


def _text(value):
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _number(value):
    if value is None:
        return "—"
    if value == 0:
        return "0"
    if abs(value) < .001:
        return f"{value:.3g}"
    return f"{value:,.3f}".rstrip("0").rstrip(".")


def _quantity_text(value, units, *, signed=False):
    if value is None:
        return "—"
    number = ("+" if signed and value > 0 else "") + _number(value)
    return number + " " + units.replace("metric_tonnes", "t")


def _markdown(summary):
    grid = summary["context"]["grid"]
    definition = grid["definition"]
    compared = bool(summary["alternative_run_ids"])
    lines = [
        "# " + _text(summary["title"]) + (" — scenario decisions" if compared else " — annual export"), "",
        "InVEST " + summary["context"]["invest_version"] + "; " +
        _text(definition.get("crs_name", definition["crs"])) + "; " +
        _number(definition["resolution_m"]) + " m cells; " +
        _number(definition["pixel_area_ha"]) + " ha per cell; " +
        str(definition["width"]) + " × " + str(definition["height"]) + " grid.", "",
    ]
    if summary["context"].get("models"):
        lines.extend(["Completed native models: " +
                      ", ".join(model.upper() for model in summary["context"]["models"]) + ".", ""])
    lines.extend(["## Annual export" + (" and scenario change" if compared else ""), ""])
    if compared:
        lines.extend([
            "| Scenario | Pollutant | Annual export | Valid ha | Per valid ha | Change | Avoided export | Benefit |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
    else:
        lines.extend([
            "| Scenario | Pollutant | Annual export | Valid ha | Per valid ha |",
            "| --- | --- | ---: | ---: | ---: |",
        ])
    for row in summary["rows"]:
        name = row["scenario_title"]
        if row["comparison_kind"] not in ("baseline", "landcover_alternative"):
            name += " (" + row["comparison_label"].lower() + ": " + row["profile_title"] + ")"
        cells = [
            name, row["pollutant_label"], _quantity_text(row["sum"], row["sum_units"]),
            _number(row["valid_area_ha"]), _quantity_text(row.get("average_per_valid_ha"), row["average_units"]),
        ]
        if compared:
            benefit = (_number(row["benefit_percent"]) + "%") if "benefit_percent" in row else "—"
            cells.extend([
                _quantity_text(row.get("sum_change"), row["sum_units"], signed=True),
                _quantity_text(row.get("avoided_export"), row["sum_units"], signed=True), benefit,
            ])
        lines.append("| " + " | ".join(_text(cell) for cell in cells) + " |")
    reasons = [row for row in summary["rows"] if row.get("benefit_percent_reason") or row.get("average_reason")]
    if reasons:
        lines.extend(["", "### Coverage and percentage calculations", ""])
        for row in reasons:
            reason = " ".join(row[key] for key in ("benefit_percent_reason", "average_reason") if key in row)
            lines.append("- " + _text(row["scenario_title"] + " / " + row["pollutant_label"] + ": " + reason))
    lines.extend(["", "## Compared selections" if compared else "## Selected run", "",
                  "| Run name | Scenario | Comparison | Parameter profile |",
                  "| --- | --- | --- | --- |"])
    for run in summary["runs"]:
        cells = [", ".join(run["run_names"]), run["scenario"]["title"],
                 run["comparison_label"], run["profile"]["title"]]
        lines.append("| " + " | ".join(_text(cell) for cell in cells) + " |")
    lines.extend(["", "## Interpretation", ""])
    lines.extend("- " + _text(item) for item in summary["interpretation"])
    lines.extend(["", "## Source and grid context", "",
                  "- Source edition: " + _text(summary["context"]["source_collection"]["title"]),
                  "- Reporting source: " + _text(grid["spec"]["reporting_area"]["source_id"]),
                  "- Model-domain source: " + _text(grid["spec"]["model_domain"]["source_id"]) +
                  "; context buffer " + _number(grid["spec"]["upstream_buffer_m"]) + " m.",
                  ("- Comparison ID: " + summary["comparison_id"]) if compared
                  else ("- Native run ID: " + summary["baseline_run_id"]),
                  "- Application source: " + _text(summary["context"]["source_reference"]), ""])
    lines.extend("- [" + item["title"] + "](" + item["url"] + ")" for item in summary["references"])
    return "\n".join(lines) + "\n"


def write_summary(directory, summary):
    """Write JSON, tidy CSV and Markdown; return relative file records."""
    if summary.get("schema") != SCHEMA:
        raise ValueError("Select an original scenario summary")
    if digest({key: value for key, value in summary.items() if key != "id"}) != summary.get("id"):
        raise ValueError("Scenario summary differs from its original content")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in summary["rows"]:
        record = {key: row.get(key, "") for key in CSV_FIELDS}
        record["run_names"] = "; ".join(row["run_names"])
        writer.writerow(record)
    paths = {"json": directory / "scenario-summary.json",
             "csv": directory / "scenario-summary.csv",
             "markdown": directory / "scenario-summary.md"}
    atomic_json(paths["json"], summary)
    atomic_bytes(paths["csv"], stream.getvalue().encode("utf-8"))
    atomic_bytes(paths["markdown"], _markdown(summary).encode("utf-8"))
    return {key: describe_file(directory, path) for key, path in paths.items()}
