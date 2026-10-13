"""Saved matched-control outcome groups on original completed native support.

TokenJunkieLabs. This module prepares reports; it never executes a native model.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import math

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, read_json, selected_models, verify_file)
from . import multivariate_control as controls
from . import native_versions, rasters, scenario_footprint

SCHEMA = "upstate.multivariate-control-outcomes/v1"
SELECTION_SCHEMA = "upstate.multivariate-control-outcome-selection/v1"
FOLDER = "multivariate-control-outcomes"
VERSION = "multivariate-control-outcomes-20261013-v1"
SUPPORTS = ("per_design", "group_common")
NOTES = [
    "The selected designs share the exact original baseline, restoration, native grid and parameter profile. Only the explicitly retained completed control cases differ.",
    "Per-design support intersects the finite baseline, restoration and that control. Group-common support intersects the baseline, restoration and every selected control separately for each quantity. Compare placements on group-common rows; never subtract totals with different masks.",
    "Positive baseline minus alternative means less modeled export under that alternative. Positive control minus restoration means less modeled export under restoration than the selected control. Negative and zero outcomes remain visible.",
    "These are annual exports originating from source pixels inside the selected support and reaching modeled streams. They are not concentrations, intake delivery, observed benefits or an isolated causal estimate.",
    "Matching and residual balance describe the explicitly selected design constraints. Several saved designs are not automatically independent placements; identical final categorical placement hashes are identified. No confidence interval or independent-replicate count is inferred.",
    "Whole-scenario, selected-region and common-native changed areas remain distinct. Whole-region change can include unchanged source cells through routing/retention, so it is not reassigned exclusively to converted pixels.",
    "Reporting quantities use original mass-per-pixel outputs without another area multiplication. Model-domain quantities use the retained native density outputs and original projected pixel hectares exactly once.",
    "Original source classifications, optional covariate definitions, strata, pair rosters and residual balances remain in each complete retained design. Scientist interpretation remains with the original analyst and prime."
]


def normalize(selection):
    if not isinstance(selection, dict) or selection.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select an original matched-control outcome group")
    allowed = {"schema", "title", "reason", "design_ids", "pollutants", "quantity_scope"}
    if set(selection) - allowed:
        raise ValueError("Unknown outcome-group selection fields")
    title, reason = selection.get("title"), selection.get("reason")
    if any(not isinstance(v, str) or not v.strip() for v in (title, reason)):
        raise ValueError("Name this outcome group and its scientific question")
    ids = selection.get("design_ids")
    if not isinstance(ids, list) or not ids or any(not isinstance(v, str) for v in ids) or len(set(ids)) != len(ids):
        raise ValueError("Select distinct saved control designs in the intended display order")
    ids = [identifier(v) for v in ids]
    pollutants = selection.get("pollutants")
    if (not isinstance(pollutants, list) or not pollutants or any(not isinstance(p, str) for p in pollutants)
            or len(set(pollutants)) != len(pollutants)
            or any(p not in rasters.MASS_UNITS for p in pollutants)):
        raise ValueError("Select distinct original annual native quantities")
    pollutants = [p for p in rasters.MASS_UNITS if p in pollutants]
    scope = selection.get("quantity_scope", "reporting")
    if scope not in ("reporting", "model_domain"):
        raise ValueError("Choose original reporting or model-domain quantity support")
    return {"schema": SELECTION_SCHEMA, "title": title.strip(), "reason": reason.strip(),
            "design_ids": ids, "pollutants": pollutants, "quantity_scope": scope}


def _workspace_file(ws, root, descriptor):
    path = verify_file(root, descriptor)
    return {**deepcopy(descriptor), "path": path.relative_to(ws.root).as_posix()}


def _bind(ws, selection):
    selected = normalize(selection)
    designs, runs, footprints, members = [], {}, {}, []
    first = None
    for key in selected["design_ids"]:
        design = controls.inspect(ws, key)
        if design["state"] != "prepared" or not design.get("adoption"):
            raise ValueError("Adopt accepted complete design " + key + " before comparing native outcomes")
        bound, adoption = design["binding"], design["adoption"]
        cohort = {k: bound[k] for k in ("project_id", "grid_id", "profile_id", "baseline_run_id",
                                       "restoration_run_id", "restoration_footprint_id")}
        if first is None:
            first = cohort
        elif cohort != first:
            raise ValueError("Every selected design must share the exact original baseline and restoration cohort")
        for name, run_id in (("baseline", bound["baseline_run_id"]),
                             ("restoration", bound["restoration_run_id"]), ("control", adoption["run_id"])):
            run = ws.inspect_run(run_id)
            if run["id"] != run_id or digest(run["selection"]) != run_id or run.get("state") != "complete":
                raise ValueError("Finish the original retained " + name + " native case " + run_id)
            if (run["selection"]["grid_id"] != first["grid_id"]
                    or run["selection"]["profile_id"] != first["profile_id"]
                    or selected_models(run["selection"]) != selected_models(bound["native_selections"]["baseline"])):
                raise ValueError("The selected native outcome left its exact scientific cohort")
            runs[run_id] = run
        footprint = scenario_footprint.get_footprint(ws, adoption["footprint_id"])
        footprints[adoption["run_id"]] = footprint
        members.append({"design_id": key, "title": design["selection"]["title"],
            "control_run_id": adoption["run_id"], "control_scenario_id": adoption["scenario_id"],
            "control_footprint_id": adoption["footprint_id"], "experiment_id": adoption["experiment_id"],
            "design": describe_file(ws.root, ws.root / controls.ROOT / key / "design.json"),
            "adoption": describe_file(ws.root, ws.root / controls.ROOT / key / "adoption.json"),
            "selection": deepcopy(design["selection"]), "summary": deepcopy(design["summary"]),
            "balance": deepcopy(design["balance"]), "masks": deepcopy(design["masks"]),
            "source": deepcopy(design["source"])})
        designs.append(design)
    baseline = runs[first["baseline_run_id"]]
    restoration = runs[first["restoration_run_id"]]
    if ws._get("scenarios", baseline["selection"]["scenario_id"])["kind"] != "baseline":
        raise ValueError("Outcome comparison requires the original unchanged baseline")
    if restoration["selection"] != designs[0]["binding"]["native_selections"]["restoration"]:
        raise ValueError("The retained restoration selection changed")
    footprints[restoration["id"]] = scenario_footprint.get_footprint(ws, first["restoration_footprint_id"])
    grid = ws.get_grid(first["grid_id"])
    native = native_versions.comparison_versions(list(runs.values()),
                                                  native_versions.models_for_outputs(selected["pollutants"]))
    for run_id, models in native["runs"].items():
        for info in models.values():
            if not (info.get("observed_stage_version") or info.get("observed_run_version")):
                raise ValueError("Retain the actual observed producing-model version for " + run_id)
    grid_files = {role: _workspace_file(ws, ws.root / "grids" / grid["id"], grid["files"][role])
                  for role in ("NLCD", "reporting_mask", "model_domain")}
    quantities, landcover = {}, {}
    run_refs = {}
    for run_id, run in runs.items():
        if not set(selected["pollutants"]).issubset(run.get("artifacts", {})):
            raise ValueError("Select only quantities actually produced by every retained native case")
        run_refs[run_id] = {"id": run_id, "selection": deepcopy(run["selection"])}
        quantities[run_id] = {}
        for pollutant in selected["pollutants"]:
            artifact = run["artifacts"][pollutant]
            if artifact.get("units") != rasters.MASS_UNITS[pollutant]:
                raise ValueError("The original mass output has incompatible units: " + pollutant)
            if selected["quantity_scope"] == "reporting":
                source, factor, units = artifact, 1.0, rasters.MASS_UNITS[pollutant]
            else:
                source = artifact.get("native_output")
                if not isinstance(source, dict):
                    raise ValueError("Retain the original full-domain native output for " + pollutant)
                model = native_versions.models_for_outputs([pollutant])[0]
                if (native["runs"][run_id][model]["comparison_version"] != "3.20.0"
                        or artifact.get("native_units") != rasters.RATE_UNITS[pollutant]
                        or not math.isclose(float(artifact.get("pixel_area_ha", 0)), float(grid["grid"]["pixel_area_ha"]), rel_tol=1e-10, abs_tol=1e-12)):
                    raise ValueError("Full-domain density conversion requires actual producing InVEST3.20.0 and retained per-hectare source units")
                factor, units = float(grid["grid"]["pixel_area_ha"]), rasters.RATE_UNITS[pollutant]
            verify_file(ws.root / "runs" / run_id, source)
            quantities[run_id][pollutant] = {
                "run_id": run_id, "artifact": deepcopy(source), "source_units": units,
                "output_units": rasters.MASS_UNITS[pollutant], "multiplier": factor,
                "quantity_scope": selected["quantity_scope"],
                "original_conversion": {"native_units": artifact.get("native_units"),
                    "output_units": artifact["units"], "pixel_area_ha": artifact.get("pixel_area_ha")}}
        if run_id == baseline["id"]:
            landcover[run_id] = {"native": grid_files["NLCD"], "footprint": None,
                                "baseline_native": None}
            artifact = run.get("stages", {}).get("landcover", {}).get("artifact")
            if artifact:
                landcover[run_id]["baseline_native"] = _workspace_file(ws, ws.root / "runs" / run_id, artifact)
        else:
            artifact = run.get("stages", {}).get("landcover", {}).get("artifact")
            if not artifact:
                raise ValueError("Completed case lacks its actual executed land-cover artifact: " + run_id)
            footprint = footprints[run_id]
            if footprint["selection"] != run["selection"]:
                raise ValueError("The retained footprint is not this executed native case")
            landcover[run_id] = {
                "native": _workspace_file(ws, ws.root / "runs" / run_id, artifact),
                "footprint": _workspace_file(ws, ws.root, footprint["files"]["scenario_lulc"]),
                "record": describe_file(ws.root, ws.root / "scenario-footprints" / (footprint["id"] + ".json")),
                "footprint_id": footprint["id"], "summary": deepcopy(footprint["summary"])}
    binding = {"schema": "upstate.multivariate-control-outcome-binding/v1", **first,
        "grid": deepcopy(grid["grid"]), "grid_spec": deepcopy(grid["spec"]), "grid_files": grid_files,
        "members": members, "runs": run_refs, "landcover": landcover,
        "quantity_sources": quantities, "native_execution": native,
        "quantity_scope": selected["quantity_scope"], "pollutants": selected["pollutants"],
        "support_modes": list(SUPPORTS)}
    return selected, binding


def _producer():
    from . import multivariate_control_outcome_analysis as analysis
    from . import multivariate_control_outcome_report as report
    from . import geographic_scenario_allocation as allocation
    from . import geographic_siting_contrasts as siting
    from . import receiving_waters as waters
    modules = (Path(__file__), Path(analysis.__file__), Path(report.__file__),
               Path(allocation.__file__), Path(siting.__file__), Path(waters.__file__),
               Path(rasters.__file__), Path(native_versions.__file__),
               Path(report.scientific_report.__file__), Path(report.scientific_figures.__file__))
    return {path.name: {"bytes": path.stat().st_size, "sha256": file_digest(path)} for path in modules}, modules


def _identity(ws, selected, binding):
    producer, modules = _producer()
    return {"schema": SCHEMA, "version": VERSION, "project_id": ws.project["id"],
            "selection": selected, "binding": binding, "producer": producer}, modules


def _folder(ws, key):
    return ws.root / FOLDER / identifier(key)


def _verify_binding(ws, binding):
    if binding["project_id"] != ws.project["id"]:
        raise ValueError("Outcome group belongs to another original project")
    grid = ws.get_grid(binding["grid_id"])
    if grid["grid"] != binding["grid"] or grid["spec"] != binding["grid_spec"]:
        raise ValueError("The original outcome grid changed")
    for descriptor in binding["grid_files"].values():
        verify_file(ws.root, descriptor)
    for member in binding["members"]:
        verify_file(ws.root, member["design"])
        verify_file(ws.root, member["adoption"])
    current_runs = []
    for run_id, original in binding["runs"].items():
        run = ws.inspect_run(run_id)
        current_runs.append(run)
        if run.get("state") != "complete" or run["selection"] != original["selection"]:
            raise ValueError("Original completed outcome selection changed")
        for pollutant, source in binding["quantity_sources"][run_id].items():
            artifact = run["artifacts"][pollutant]
            selected = artifact if binding["quantity_scope"] == "reporting" else artifact.get("native_output")
            conversion = {"native_units": artifact.get("native_units"), "output_units": artifact["units"],
                          "pixel_area_ha": artifact.get("pixel_area_ha")}
            if selected != source["artifact"] or conversion != source["original_conversion"]:
                raise ValueError("Original native outcome artifact or conversion provenance changed")
            verify_file(ws.root / "runs" / run_id, source["artifact"])
        for name in ("native", "footprint", "record", "baseline_native"):
            descriptor = binding["landcover"][run_id].get(name)
            if descriptor:
                verify_file(ws.root, descriptor)
    current_versions = native_versions.comparison_versions(current_runs,
        native_versions.models_for_outputs(binding["pollutants"]))
    if current_versions != binding["native_execution"]:
        raise ValueError("The original producing-model runtime provenance changed")
    return binding


def catalog(ws):
    designs, issues = [], []
    for row in controls.catalog(ws)["designs"]:
        if row.get("state") != "prepared" or not row.get("adoption"):
            continue
        try:
            value = controls.inspect(ws, row["id"])
            adoption, bound = value["adoption"], value["binding"]
            run_ids = [bound["baseline_run_id"], bound["restoration_run_id"], adoption["run_id"]]
            runs = [ws.inspect_run(key) for key in run_ids]
            designs.append({"id": value["id"], "title": value["selection"]["title"],
                "baseline_run_id": bound["baseline_run_id"], "restoration_run_id": bound["restoration_run_id"],
                "control_run_id": adoption["run_id"], "grid_id": bound["grid_id"], "profile_id": bound["profile_id"],
                "restoration_footprint_id": bound["restoration_footprint_id"],
                "ready": all(r.get("state") == "complete" for r in runs),
                "run_states": {r["id"]: r.get("state") for r in runs},
                "pollutants": [p for p in rasters.MASS_UNITS if all(p in r.get("artifacts", {}) for r in runs)],
                "summary": deepcopy(value["summary"])})
        except (ValueError, KeyError, OSError) as error:
            issues.append({"id": row["id"], "message": str(error)})
    outcomes = []
    folder = ws.root / FOLDER
    for path in sorted(folder.glob("*/outcome.json")) if folder.exists() else []:
        try:
            value = inspect(ws, path.parent.name)
            outcomes.append({"id": value["id"], "title": value["selection"]["title"],
                             "selection": value["selection"], "summary": value["summary"]})
        except (ValueError, KeyError, OSError) as error:
            issues.append({"id": path.parent.name, "message": str(error)})
    return {"schema": SCHEMA, "project_id": ws.project["id"], "designs": designs,
            "outcomes": outcomes, "issues": issues, "quantity_scopes": ["reporting", "model_domain"],
            "support_modes": list(SUPPORTS), "interpretation": NOTES}


def preview(ws, selection):
    selected, bound = _bind(ws, selection)
    identity, _ = _identity(ws, selected, bound)
    key = digest(identity)
    result = {"id": key, "state": "ready", "selection": selected, "binding": bound,
              "summary": {"design_count": len(bound["members"]), "quantity_count": len(selected["pollutants"]),
                          "support_modes": list(SUPPORTS), "native_execution": False}}
    if (_folder(ws, key) / "outcome.json").exists():
        result["state"] = "existing"
        result["existing"] = inspect(ws, key)
    return result


def _source_matches(ws, root, record):
    collection = ws._get("sources", record["source"]["source_collection_id"])
    entry = next((e for e in collection["entries"] if e["id"] == record["source"]["source_id"]), None)
    if not entry:
        raise ValueError("The retained outcome scientific source is missing")
    manifest = read_json(root / "sources.json")["entries"][0]
    actual = {b.get("view_path", b["filename"]): (b["bytes"], b["sha256"])
              for b in [entry["body"], *entry.get("companions", [])]}
    expected = {b["path"]: (b["bytes"], b["sha256"]) for b in [manifest, *manifest["companions"]]}
    if actual != expected:
        raise ValueError("The outcome source lost an original report, map or companion")
    for body in [entry["body"], *entry.get("companions", [])]:
        verify_file(ws.root, {**body, "path": body["object"]})
    return entry


def inspect(ws, key):
    root = _folder(ws, key)
    value = read_json(root / "outcome.json")
    if value.get("schema") != SCHEMA or value.get("id") != identifier(key) or digest(value["identity"]) != key:
        raise ValueError("Original outcome-group identity changed")
    if (value["selection"] != value["identity"]["selection"]
            or value["binding"] != value["identity"]["binding"]):
        raise ValueError("Original outcome-group scientific selection changed")
    _verify_binding(ws, value["binding"])
    assessment = read_json(root / "assessment.json")
    if any(value.get(name) != original for name, original in assessment.items()):
        raise ValueError("Outcome record differs from its frozen complete assessment")
    for member in value["files"]:
        verify_file(ws.root, member)
    _source_matches(ws, root, value)
    return value


def prepare(ws, selection, progress=None):
    from . import multivariate_control_outcome_analysis as analysis
    from . import multivariate_control_outcome_report as report
    selected, bound = _bind(ws, selection)
    identity, modules = _identity(ws, selected, bound)
    key = digest(identity)
    root = _folder(ws, key)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".outcome.lock", blocking=False):
        if (root / "outcome.json").exists():
            return inspect(ws, key)
        atomic_json(root / "selection.json", selected, immutable=True)
        atomic_json(root / "input-binding.json", bound, immutable=True)
        atomic_json(root / "identity.json", identity, immutable=True)
        for module in modules:
            descriptor = identity["producer"][module.name]
            payload = module.read_bytes()
            from hashlib import sha256
            if len(payload) != descriptor["bytes"] or sha256(payload).hexdigest() != descriptor["sha256"]:
                raise ValueError("The retained outcome implementation changed")
            atomic_bytes(root / "implementation" / module.name, payload, immutable=True)
        for member in bound["members"]:
            for name in ("design", "adoption"):
                source = verify_file(ws.root, member[name])
                atomic_bytes(root / "originals" / member["design_id"] / (name + ".json"),
                             source.read_bytes(), immutable=True)
        def emit(event):
            atomic_json(root / "progress.json", {"outcome_id": key, **event})
            if progress:
                progress({"outcome_id": key, **event})
        if (root / "report-source.json").exists():
            # The finished report may already have been issued before an import
            # acknowledgement was lost. Reuse exact PDF/HTML/map bytes.
            recipe = read_json(root / "report-source.json")
            assessment = read_json(root / "assessment.json")
            if assessment["identity"] != identity or assessment["id"] != key:
                raise ValueError("The retained outcome report checkpoint changed")
            if (recipe.get("schema") != "upstate.observed-report/v1" or recipe.get("edition") != VERSION
                    or recipe.get("project_id") != ws.project["id"] or recipe.get("title") != selected["title"]):
                raise ValueError("The retained outcome report recipe changed")
            members = recipe["inputs"]
            if len({m["path"] for m in members}) != len(members):
                raise ValueError("The retained report repeats a source member")
            for member in members:
                verify_file(root, member)
        else:
            calculated = analysis.compute(ws, bound, root, progress=emit)
            assessment = {"schema": SCHEMA, "id": key, "identity": identity, "selection": selected,
                          "binding": bound, "state": "complete", **calculated}
            atomic_json(root / "assessment.json", assessment, immutable=True)
            sections = report.write(root, assessment, NOTES)
            sections, figure_fields = report.source_sections(root, sections)
            excluded = {"outcome.json", "progress.json", ".outcome.lock", "sources.json", "report-source.json"}
            members = [describe_file(root, path) for path in sorted(root.rglob("*"))
                       if path.is_file() and path.name not in excluded]
            recipe = {"schema": "upstate.observed-report/v1", "edition": VERSION,
                      "title": selected["title"], "project_id": ws.project["id"],
                      "inputs": members, "sections": sections, **figure_fields,
                      "source_links": ["report.html", "outcomes.csv", "partitions.csv", "placements.csv",
                                       "assessment.json", "selection.json", "input-binding.json", *report.guide_links(bound)]}
            atomic_json(root / "report-source.json", recipe, immutable=True)
        source_id = "multivariate-control-outcomes-" + key
        entry = {"id": source_id, "kind": "document", "role": "OBSERVED_CONTEXT", "title": selected["title"],
            "uri": "urn:upstate:multivariate-control-outcomes:" + key, "vintage": VERSION,
            **describe_file(root, root / "report-source.json"), "companions": members,
            "metadata": {"report_schema": "upstate.observed-report/v1", "project_id": ws.project["id"],
                "multivariate_control_outcomes_id": key, "design_ids": selected["design_ids"],
                "classification": "retained deterministic native-model outcome comparison",
                "native_calculation": False}}
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1", "title": selected["title"],
                                          "entries": [entry]}, immutable=True)
        _verify_binding(ws, bound)
        collection = ws.import_sources(root / "sources.json")
        files = [describe_file(ws.root, root / m["path"]) for m in members]
        files += [describe_file(ws.root, root / name) for name in ("report-source.json", "sources.json")]
        record = {**assessment, "directory": root.relative_to(ws.root).as_posix(), "files": files,
                  "source": {"source_collection_id": collection["id"], "source_id": source_id}}
        atomic_json(root / "outcome.json", record, immutable=True)
        emit({"stage": "complete", "state": "complete"})
        return inspect(ws, key)


def files(ws, key):
    return inspect(ws, key)["files"]
