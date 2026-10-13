"""Publish a saved calibration and its original flow support as a scientific source.

The original calibration, observations and uncertainty producers own every
numerical result. This adapter retains their exact records and uses the existing
ordered source collector and report formatter for all delivery formats.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, relative_file, verify_file)
from . import ensemble_consumers, ensemble_flow_support, ensemble_references

VERSION = 1
DIRECTORY = "ensemble-scientific-sources"
SOURCE_ID = "saved-calibration-scientific-report"
ROLE = "OBSERVED_CONTEXT"
RECIPE_SCHEMA = "upstate.observed-report/v1"


def _member(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Scientific source members need canonical relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Scientific source member escapes its retained package")
    return path


def _copy(workspace, descriptor, destination):
    actual = {"path": descriptor.get("path", descriptor.get("object")),
              "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
    verify_file(workspace.root, actual)
    source = relative_file(workspace.root, actual["path"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.stat().st_size != actual["bytes"] or file_digest(destination) != actual["sha256"]:
            raise ValueError("Existing scientific companion differs: " + str(destination))
    else:
        pending = destination.with_name("." + destination.name + ".pending")
        try:
            shutil.copyfile(source, pending)
            if pending.stat().st_size != actual["bytes"] or file_digest(pending) != actual["sha256"]:
                raise ValueError("Original scientific companion changed during copying")
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)


def _retained(workspace, consumer_id):
    plan = workspace._get(ensemble_consumers.KIND, identifier(consumer_id))
    if plan.get("mode") != "calibration" or plan.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Select this workspace's saved annual-reference calibration")
    state_path = workspace.root / "ensemble-consumer-results" / plan["id"] / "state.json"
    state = read_json(state_path)
    if (state.get("consumer_id") != plan["id"] or state.get("workspace_id") != workspace.project["id"]
            or not state.get("calibration_id")):
        raise ValueError("Evaluate the saved calibration before preparing its scientific source")
    result = workspace._get("calibrations", identifier(state["calibration_id"]))
    basis = workspace._get("calibration-plans", identifier(plan["calibration_plan_id"]))
    if (result.get("plan_id") != basis["id"] or result.get("workspace_id") != workspace.project["id"]
            or basis.get("workspace_id") != workspace.project["id"]
            or result.get("state") not in {"complete", "no_eligible_candidates"}):
        raise ValueError("The calibration result differs from its original saved plan")
    observed = workspace._get("observations", identifier(basis["selection"]["observation_id"]))
    if observed["id"] != result["observations"]["id"]:
        raise ValueError("Calibration observation identity changed")
    reference = plan.get("annual_reference")
    if reference:
        actual = ensemble_references.resolve(workspace, reference["import_id"], verify=True)
        for key in ("binding", "original_preparation_id", "reference_records"):
            if actual[key] != reference[key]:
                raise ValueError("Original annual-reference binding differs: " + key)
    support = plan.get("flow_support")
    if support:
        current = ensemble_flow_support.bind(workspace, reference, support["source"],
                                             record_ids=support["record_ids"])
        for key in ("source", "rows", "source_period", "record_ids"):
            if current[key] != support[key]:
                raise ValueError("Saved flow support differs: " + key)
        for item in support["files"].values():
            verify_file(workspace.root, item)
    uncertainty = None
    if state.get("uncertainty_id"):
        from . import calibration_uncertainty
        uncertainty = calibration_uncertainty.inspect(workspace, state["uncertainty_id"])
        if uncertainty["calibration_id"] != result["id"]:
            raise ValueError("Source-error sensitivity belongs to another calibration")
    selection = {"version": VERSION, "workspace_id": workspace.project["id"],
                 "consumer_id": plan["id"], "calibration_id": result["id"],
                 "uncertainty_id": uncertainty["id"] if uncertainty else None,
                 "flow_support_sha256": digest(support) if support else None}
    return selection, plan, state, basis, result, observed, uncertainty


def _table(columns, rows, caption=None):
    result = {"kind": "table", "columns": columns, "rows": rows}
    if caption:
        result["caption"] = caption
    return result


def _text(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return "" if value is None else str(value)


def _csv(directory, name, rows, fields):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(fields)
    for row in rows:
        values = []
        for field in fields:
            value = row.get(field)
            text = _text(value)
            if isinstance(value, str) and text.lstrip().startswith(("=", "+", "-", "@")):
                text = "'" + text
            values.append(text)
        writer.writerow(values)
    atomic_bytes(directory / name, output.getvalue().encode("utf-8"), immutable=True)


def _metric_rows(result):
    rows = []
    for candidate in result["ranked_candidates"]:
        for parameter, values in candidate.get("pollutant_metrics", {}).items():
            rows.append({"run_id": candidate["run_id"], "profile_id": candidate["profile_id"],
                         "rank": candidate["rank"], "parameter": parameter,
                         "objective_score": candidate["objective_score"], **values})
    return rows


def _sections(plan, basis, result, observed, uncertainty):
    title = result.get("title") or plan["selection"].get("title") or "Saved annual-reference calibration"
    sections = [
        ["Saved native calibration and original reference support", [
            title,
            "This saved study evaluates the selected completed native candidates against the original annual-load "
            "references. Candidate scores, physical units, source periods and spatial groups below are retained "
            "from the original calibration producer.",
            _table(["Result", "Retained value"], [
                ["Calibration state", result["state"]],
                ["Calibration identity", result["id"]],
                ["Selected run", result.get("selected_run_id")],
                ["Selected profile", result.get("selected_profile_id")],
                ["Evaluation design", result["evaluation_design"]],
                ["Actual native candidates", result["candidate_count"]],
                ["Distinct parameter profiles", result["distinct_profile_count"]],
                ["Evaluated parameters", ", ".join(result["predicted_parameters"])],
                ["Source interpretation", result["working_profile_status"]],
            ]),
            result["reference_interpretation"],
        ]],
        ["Original objective and temporal interpretation", [
            result["selection_method"], result["temporal_method"],
            _table(["Constituent", "Physical unit", "Declared weight", "Normalization"],
                   [[parameter, values.get("units"), values.get("weight"),
                     _text(result["normalization"].get(parameter))]
                    for parameter, values in result["objective"].items()]),
            "The physical residual is predicted annual mass minus observed annual mass. A positive residual "
            "indicates higher prediction than the retained reference. The selected objective is dimensionless; "
            "physical error summaries retain the original constituent units.",
        ]],
        ["Native candidate ranking", [
            _table(["Rank", "Native run", "Parameter profile", "Objective", "Selected models"],
                [[row["rank"], row["run_id"], row["profile_id"], row["objective_score"],
                  ", ".join(row.get("selected_models") or [])] for row in result["ranked_candidates"]]),
            _table(["Rank / constituent", "Unit", "Mean bias", "RMSE", "Equal-group RMSE", "Supported catchments"],
                [[str(row["rank"]) + " / " + row["parameter"], row.get("units"),
                  row.get("mean_bias"), row.get("rmse"), row.get("group_weighted_rmse"),
                  str(row.get("catchments")) + " / " + str(row.get("expected_catchments"))]
                 for row in _metric_rows(result)]),
        ]],
        ["Selected candidate: original catchment quantities", [
            _table(["Catchment / constituent", "Partition", "Unit", "Observed", "Native",
                    "External delivered load", "Predicted", "Residual"],
                [[row["catchment_id"] + " / " + row["parameter"], row["partition"], row["units"],
                  row["observed_annual_mass"], row.get("native_annual_mass"),
                  row.get("delivered_external_annual_mass"), row.get("predicted_annual_mass"),
                  row.get("residual")] for row in result["prediction_rows"]
                 if row["run_id"] == result.get("selected_run_id")]),
            "The complete candidate-predictions CSV and original result retain every evaluated native candidate, "
            "the included flag, geographic support and any original comparison issue.",
        ]],
        ["Original calibration and validation support", [
            _table(["Group", "Partition", "Catchments", "Original support"],
                [[row["id"], row.get("partition"), _text(row.get("catchment_ids", row.get("catchments"))),
                  _text(row)] for row in result["spatial_groups"]["groups"]]),
            _table(["Validation field", "Original retained result"],
                   [[key, _text(value)] for key, value in result["selected_validation"].items()]),
            "Validation is the retained spatial holdout evaluation of the originally selected candidate. "
            "The original group-stability folds and Pareto envelope are included in full structured data.",
        ]],
    ]
    selected_ids = {key for unit in basis["units"] for key in unit["observation_record_ids"]}
    originals = [row for row in observed["rows"] if row["id"] in selected_ids]
    sections.append(["Original annual-load records", [
        _text(observed["metadata"].get("annualization_method")),
        _table(["Record / constituent", "Station / catchment", "Start / exclusive end", "Original value / unit",
                "Original method", "Qualifier / uncertainty"],
               [[row["id"] + " / " + row["parameter"],
                 str(row.get("station_id") or "") + " / " + row["catchment_id"],
                 str(row["period_start"]) + " / " + str(row["period_end"]),
                 _text(row.get("value")) + " / " + str(row["unit"]), row.get("method"),
                 _text({"qualifier": row.get("qualifier"), "uncertainty": row.get("uncertainty")})]
                for row in originals]),
        "Each record retains its publisher method, qualifiers, estimator identity and exclusive period end. "
        "Original observation data and admitted/reference selection are supplied with this report.",
    ]])
    support = plan.get("flow_support")
    if support:
        sections.append(["Exact original daily-flow support", [
            "Daily discharge support is attached to the selected original annual-reference records. "
            "The original annual-load estimator and calibration weighting remain those saved by their producers. "
            "Covered-days volume sums available numeric daily means; complete-period volume is populated only "
            "when the original producer establishes full reference-period support.",
            _table(["Reference / constituent", "Observation / flow station", "Native series", "Start / exclusive end",
                    "Support", "Numeric / requested days", "Outside source days"],
                [[row["record_id"] + " / " + row["parameter"],
                  str(row.get("station_id") or "") + " / " + str(row.get("flow_station_id") or "Unresolved"),
                  row.get("flow_ts_id"), str(row["original_period_start"]) + " / " + str(row["original_period_end"]),
                  row["status"], str(row.get("numeric_days")) + " / " + str(row["expected_days"]),
                  row.get("days_outside_captured_period")] for row in support["rows"]]),
            _table(["Reference", "Approved days", "Estimated days", "Provisional days", "Covered volume m3",
                    "Complete-period volume m3"],
                [[row["record_id"], row.get("daily_summary", {}).get("approved_days"),
                  row.get("daily_summary", {}).get("estimated_days"),
                  row.get("daily_summary", {}).get("provisional_days"),
                  row.get("covered_days_volume_m3"), row.get("complete_reference_period_volume_m3")]
                 for row in support["rows"]]),
            "The original flow JSON, CSV, station-date availability, complete source response bodies and binding "
            "travel together. Qualifier categories retain their original definitions and may overlap.",
            _text(support.get("methods", {})),
        ]])
    else:
        sections.append(["Daily-flow source selection", [
            "This saved calibration has no selected exact-period daily-flow context. Its original annual "
            "references and calibration results are retained below and in the source package.",
        ]])
    if uncertainty:
        sections.append(["Published-source uncertainty and selection sensitivity", [
            _text(uncertainty.get("interpretation")),
            _table(["Selected analysis", "Original result"], [
                ["Published standard-error multiplier", uncertainty["standard_errors"]],
                ["Analysis state", uncertainty["state"]],
                ["Selection sensitivity", uncertainty["selection_sensitivity"]["state"]],
                ["Original uncertainty coverage", _text(uncertainty["coverage"])],
            ]),
            uncertainty["selection_sensitivity"]["gap_direction"],
            _table(["Challenger run / profile", "Original nominal gap", "Minimum gap", "Maximum gap",
                    "Source sensitivity", "Missing source record IDs"],
                [[row["run_id"] + " / " + row["profile_id"], row["nominal_gap"],
                  row["minimum_gap"], row["maximum_gap"], row["state"],
                  ", ".join(row["missing_record_ids"])] for row in uncertainty["pairwise"]]),
            "The complete supplement retains source-error attribution, the original objective reproduction, "
            "reference bounds and selected validation residual bounds.",
        ]])
    sections.append(["Candidate failures, excluded references and pending study members", [
        _table(["Kind", "Original record"],
            [["Candidate failure", _text(row)] for row in result.get("candidate_failures", [])]
            + [["Excluded reference", _text(row)] for row in result.get("excluded_reference_records", [])]
            + [["Pending study member", _text(row)] for row in plan["catalog"].get("pending_members", [])]),
        result["envelope_meaning"],
    ]])
    return title, sections


def _package(workspace, directory, plan, state, basis, result, observed, uncertainty):
    def saved(kind, key):
        value = workspace._get(kind, identifier(key))
        _copy(workspace, describe_file(workspace.root, workspace.root / kind / (key + ".json")),
              directory / "original" / kind / (key + ".json"))
        return value
    saved(ensemble_consumers.KIND, plan["id"])
    saved("calibration-plans", basis["id"])
    saved("calibrations", result["id"])
    saved("observations", observed["id"])
    if uncertainty:
        saved("calibration-uncertainties", uncertainty["id"])
    # The mutable consumer checkpoint is informational; immutable result IDs define this edition.
    atomic_json(directory / "consumer-selection.json",
                {"consumer_id": plan["id"], "calibration_id": result["id"],
                 "uncertainty_id": uncertainty["id"] if uncertainty else None}, immutable=True)
    _copy(workspace, observed["original"], directory / "original" / "observation-data" /
          observed["id"] / _member(observed["original"]["filename"]))
    sources = {}
    def add_source(collection, source_id):
        sources[(identifier(collection), source_id)] = None
    catchments = basis["selection"]["catchments"]
    add_source(catchments["source_collection_id"], catchments["source_id"])
    reference = plan.get("annual_reference")
    if reference:
        atomic_json(directory / "annual-reference.json", reference, immutable=True)
        original = read_json(relative_file(workspace.root, reference["operation"]["path"]))
        atomic_json(directory / "original" / "annual-import-operation.json", original, immutable=True)
        for index, descriptor in enumerate(original.get("result", {}).get("documents", [])):
            _copy(workspace, descriptor, directory / "original" / "annual-import-documents" /
                  ("%04d" % index) / _member(Path(descriptor["path"]).name))
    if plan.get("flow_support"):
        support = plan["flow_support"]
        atomic_json(directory / "flow-binding.json", support, immutable=True)
        add_source(support["source"]["collection_id"], support["source"]["source_id"])
        for name, descriptor in support["files"].items():
            _copy(workspace, descriptor, directory / "flow" / (name + Path(descriptor["path"]).suffix))
    for candidate in basis["candidates"]:
        run = workspace.inspect_run(candidate["run_id"])
        if run["selection"] != candidate["selection"]:
            raise ValueError("A selected original native run differs from its frozen calibration")
        _copy(workspace, describe_file(workspace.root,
              workspace.root / "runs" / run["id"] / "run.json"),
              directory / "original" / "runs" / (run["id"] + ".json"))
        profile = saved("profiles", run["selection"]["profile_id"])
        saved("scenarios", run["selection"]["scenario_id"])
        add_source(profile["source_collection_id"], profile["biophysical_source_id"])
        grid = workspace.get_grid(run["selection"]["grid_id"])
        _copy(workspace, describe_file(workspace.root,
              workspace.root / "grids" / grid["id"] / "grid.json"),
              directory / "original" / "grids" / (grid["id"] + ".json"))
    for comparison_id in set(result.get("comparison_ids", {}).values()):
        saved("observation-comparisons", comparison_id)
    source_records = []
    for index, (collection_id, source_id) in enumerate(sorted(sources)):
        unused, entry = workspace.source_file(collection_id, source_id)
        collection = workspace._get("sources", collection_id)
        folder = directory / "retained-sources" / collection_id / digest(source_id)
        atomic_json(folder / "entry.json", entry, immutable=True)
        _copy(workspace, collection["original_manifest"], folder / "original-manifest.json")
        for body in [entry["body"], *entry.get("companions", [])]:
            _copy(workspace, body, folder / "members" / _member(body.get("view_path", body["filename"])))
        source_records.append({"id": "retained-%03d" % index, "source_id": source_id,
                               "source_collection_id": collection_id,
                               "title": entry.get("title", source_id), "uri": entry.get("uri", ""),
                               "vintage": entry.get("vintage", ""), "body_sha256": entry["body"]["sha256"]})
    atomic_json(directory / "original-source-editions.json", source_records, immutable=True)
    _csv(directory, "candidate-metrics.csv", _metric_rows(result),
         ["run_id", "profile_id", "rank", "parameter", "units", "objective_score",
          "mean_observed", "mean_predicted", "mean_bias", "rmse", "group_weighted_rmse",
          "group_weighted_mean_bias", "normalized_mse", "catchments", "expected_catchments"])
    _csv(directory, "candidate-predictions.csv", result["prediction_rows"],
         ["run_id", "profile_id", "unit_id", "catchment_id", "group_id", "parameter", "partition",
          "units", "observed_annual_mass", "included", "native_annual_mass",
          "delivered_external_annual_mass", "predicted_annual_mass", "residual", "native_support", "issues"])
    _csv(directory, "original-reference-records.csv", observed["rows"],
         ["id", "admitted", "station_id", "catchment_id", "parameter", "period_start", "period_end",
          "value", "unit", "method", "qualifier", "uncertainty", "source_records"])
    return source_records


def _source_manifest(directory, title, selection, sections):
    members = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
               if path.is_file() and path not in {directory / "scientific-report.json", directory / "sources.json"}]
    recipe = {"schema": RECIPE_SCHEMA, "title": title,
              "edition": "saved-calibration-" + selection["calibration_id"],
              "basis": selection, "sections": sections,
              "inputs": members, "source_links": [item["path"] for item in members]}
    recipe["sections"].append(["Complete original records and report data", [
        {"kind": "links", "items": [
            {"title": "All candidate physical metrics", "path": "candidate-metrics.csv"},
            {"title": "All original candidate predictions and support", "path": "candidate-predictions.csv"},
            {"title": "Original admitted and context reference records", "path": "original-reference-records.csv"},
            {"title": "Original source editions", "path": "original-source-editions.json"},
            {"title": "Saved calibration result", "path": "original/calibrations/" + selection["calibration_id"] + ".json"},
        ]},
    ]])
    atomic_json(directory / "scientific-report.json", recipe, immutable=True)
    manifest = {"schema": "upstate.sources/v1", "title": title, "entries": [{
        "id": SOURCE_ID, "kind": "document", "role": ROLE, "title": title,
        "path": "scientific-report.json",
        "sha256": file_digest(directory / "scientific-report.json"),
        "uri": "urn:upstate:saved-calibration:" + selection["calibration_id"],
        "vintage": "Saved original calibration " + selection["calibration_id"],
        "units": "Original per-constituent annual mass and declared normalized objective",
        "metadata": {"report_schema": RECIPE_SCHEMA, "consumer_id": selection["consumer_id"],
                     "calibration_id": selection["calibration_id"], "source_basis": "saved_native_calibration"},
        "companions": [{"path": item["path"], "sha256": item["sha256"]} for item in members],
    }]}
    atomic_json(directory / "sources.json", manifest, immutable=True)
    return manifest


def latest(workspace, consumer_id):
    """Read the prepared source for the consumer's current immutable result IDs."""
    selection, unused, state, basis, result, observed, uncertainty = _retained(workspace, consumer_id)
    directory = workspace.root / DIRECTORY / digest(selection)
    path = directory / "operation.json"
    if not path.exists():
        return None
    operation = read_json(path)
    if operation.get("selection") != selection:
        raise ValueError("Saved scientific source identity differs")
    for item in operation.get("files", {}).values():
        verify_file(workspace.root, item)
    if operation.get("source"):
        workspace.source_file(operation["source"]["source_collection_id"], operation["source"]["source_id"])
    return operation


def delivery_selection(source, previous=None):
    """Append this source to an existing ordered report selection without losing choices."""
    from .observed_context import source_choices
    selection = deepcopy(previous or {})
    choices = source_choices(selection)
    if source not in choices:
        choices.append(deepcopy(source))
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[ROLE] = choices[0]
    selection.pop("observed_context_binding", None)
    return selection


def _render(workspace, directory, operation, source_records):
    from . import observed_context, scientific_report
    selection = delivery_selection(operation["source"])
    selection["observed_context_binding"] = observed_context.bind(workspace, selection)
    signature = {"source_binding": selection["observed_context_binding"],
                 "formatter_sha256": file_digest(Path(scientific_report.__file__)),
                 "collector_sha256": file_digest(Path(observed_context.__file__))}
    output = directory / "reports" / digest(signature)
    output.mkdir(parents=True, exist_ok=True)
    receipt = output / "release.json"
    if receipt.exists():
        release = read_json(receipt)
        if release["signature"] != signature:
            raise ValueError("Saved scientific report formatter identity differs")
        for item in release["files"].values():
            verify_file(workspace.root, item)
        return release
    collected = observed_context.collect(workspace, selection, output, {})
    title = operation["title"]
    scientific_report.report_pdf(output / "report.pdf", title, collected["sections"],
                                 contact={}, source_records=source_records)
    scientific_report.write_companions(output, title, collected["sections"], contact={},
                                      source_records=source_records, binding=selection["observed_context_binding"])
    atomic_json(output / "selection.json", selection, immutable=True)
    files = {name: describe_file(workspace.root, output / name) for name in
             ("report.pdf", "report.html", "report.md", "report-data.json", "selection.json")}
    archive = output / "scientific-report.zip"
    pending = output / ".scientific-report.pending"
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as writer:
            for path in sorted(output.rglob("*")):
                if path.is_file() and path not in {pending, archive, receipt}:
                    writer.write(path, path.relative_to(output).as_posix())
        pending.replace(archive)
    finally:
        pending.unlink(missing_ok=True)
    files["scientific-report.zip"] = describe_file(workspace.root, archive)
    release = {"schema": "upstate.ensemble-scientific-release/v1", "signature": signature,
               "source": operation["source"], "files": files}
    atomic_json(receipt, release, immutable=True)
    return release


def prepare(workspace, consumer_id, *, render=True):
    """Package, register and optionally render the original saved scientific result."""
    if not isinstance(render, bool):
        raise ValueError("Render must be true or false")
    selection, plan, state, basis, result, observed, uncertainty = _retained(workspace, consumer_id)
    key = digest(selection)
    directory = workspace.root / DIRECTORY / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        operation_path = directory / "operation.json"
        operation = read_json(operation_path) if operation_path.exists() else {
            "schema": "upstate.ensemble-scientific-source/v1", "id": key,
            "workspace_id": workspace.project["id"], "consumer_id": plan["id"],
            "ensemble_id": plan["ensemble_id"], "selection": selection,
            "state": "preparing", "created_at": now(), "files": {}}
        if operation["selection"] != selection:
            raise ValueError("Retained scientific source belongs to another original calibration")
        try:
            source_directory = directory / "source"
            source_directory.mkdir(parents=True, exist_ok=True)
            title, sections = _sections(plan, basis, result, observed, uncertainty)
            if not operation.get("source"):
                manifest_path = source_directory / "sources.json"
                if manifest_path.exists():
                    recipe = read_json(source_directory / "scientific-report.json")
                    if recipe.get("basis") != selection:
                        raise ValueError("Prepared scientific source belongs to another saved result")
                    for member in recipe["inputs"]:
                        verify_file(source_directory, member)
                    source_records = read_json(source_directory / "original-source-editions.json")
                else:
                    source_records = _package(workspace, source_directory, plan, state, basis, result, observed, uncertainty)
                    _source_manifest(source_directory, title, selection, sections)
                collection = workspace.import_sources(manifest_path)
                operation.update(title=title, source={"source_collection_id": collection["id"], "source_id": SOURCE_ID},
                                 state="source_ready", source_records=source_records)
                operation["files"]["source_manifest"] = describe_file(workspace.root, source_directory / "sources.json")
                operation["files"]["source_recipe"] = describe_file(workspace.root, source_directory / "scientific-report.json")
                atomic_json(operation_path, operation)
            else:
                workspace.source_file(operation["source"]["source_collection_id"], SOURCE_ID)
            if render:
                release = _render(workspace, directory, operation, operation["source_records"])
                operation["report"] = release
                operation["files"].update(release["files"])
                operation["state"] = "complete"
            operation["delivery_selection"] = delivery_selection(operation["source"])
            operation.pop("error", None)
            operation["updated_at"] = now()
            atomic_json(operation_path, operation)
            return operation
        except BaseException as error:
            operation.update(state="source_ready" if operation.get("source") else "failed",
                             error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(operation_path, operation)
            raise
