"""Readable client reporting for a retained regional or original native study.

This module consumes completed workspace objects. It does not run a model,
resample a raster, replace a scenario, or modify accepted scientific results.
Its PDF renderer uses ReportLab, already in the application's GIS environment.
"""
from __future__ import annotations

import html
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .common import INVEST_VERSION
from . import native_study
from .robust_decisions.eco_robust import decision_delivery
from .model_selection import MODEL_LABELS, MODEL_OUTPUTS, run_scope
from .native_versions import (POLICY as EXECUTION_VERSION_POLICY, guide_url,
                              model_versions, models_for_outputs, version_label)

SCHEMA = "upstate.client-report/v1"
REPORT_EDITION = "2026-10-13-client-report-observed-figures-15"
RFP_URL = "https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf"
RFP_SHA256 = "a519d33190eefaef7ec082c19642fc6b8ef89329ad3c648a561699c7dd277e74"
POLLUTANTS = (
    ("nitrogen_export", "Nitrogen", "kg/year"),
    ("phosphorus_export", "Phosphorus", "kg/year"),
    ("sediment_export", "Sediment", "metric tonnes/year"),
)
MAPS = (
    ("future_sediment_loss", "Future sediment loss",
     "Select land where a defined development or disturbance alternative increases sediment delivery.",
     "Read the signed change against the saved baseline. Positive values identify greater modeled delivery under that alternative; the scenario name and shared valid area identify the comparison."),
    ("future_nutrient_runoff", "Future nutrient runoff",
     "Select land where an explicit land-cover change increases nitrogen or phosphorus delivery.",
     "Read nitrogen and phosphorus separately with their annual mass units. Use the retained change polygons and replacement land-cover classes to explain the cause of each modeled difference."),
    ("critical_drinking_water", "Critical drinking-water protection",
     "Review land protection and restoration opportunities in relation to the retained source-water geography.",
     "Read the selected source-water overlay's own label and geographic meaning with physical exports and the relevant alternatives. Use the retained contributing-area analysis when interpreting upstream connections."),
    ("high_quality_waters", "High-quality water resources",
     "Review land influencing waters identified by the selected high-quality-water designation source.",
     "Read the original designation, mapped water feature and selected spatial relationship together. The designation source and any analysis buffer appear in the methods and source records."),
    ("current_nutrient_export", "Current nutrient exports",
     "Locate existing nitrogen and phosphorus delivery hotspots for restoration review.",
     "Each physical raster represents modeled annual export for the selected current land cover. Larger values identify more modeled annual mass delivered from a valid cell on the saved grid."),
    ("current_sediment_export", "Current sediment export",
     "Locate existing sediment-delivery hotspots for erosion and land-management review.",
     "Read the annual metric tonnes per pixel alongside the retained terrain, rainfall, soil and land-cover assumptions. The delivered reporting totals are summarized in this report."),
    ("combined_pollutant_export", "Combined pollutant priority",
     "Compare locations under the saved multi-pollutant planning priorities.",
     "The combined layer is a dimensionless planning index. Read its normalization and weights with the separate nitrogen, phosphorus and sediment layers when explaining why an area ranks highly."),
)

MAP_MODELS = {
    "future_sediment_loss": {"sdr"},
    "future_nutrient_runoff": {"ndr"},
    "critical_drinking_water": {"ndr", "sdr"},
    "high_quality_waters": {"ndr", "sdr"},
    "current_nutrient_export": {"ndr"},
    "current_sediment_export": {"sdr"},
    "combined_pollutant_export": {"ndr", "sdr"},
}
MODEL_GUIDES = {
    "ndr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/" + INVEST_VERSION + "/userguide/en/ndr.html",
    "sdr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/" + INVEST_VERSION + "/userguide/en/sdr.html",
}

def _grid_context(grid):
    """Resolve dimensions from retained geometry and preserve its source."""
    definition = grid.get("grid") or grid.get("definition") or {}
    transform = definition.get("transform")
    width = height = area = None
    if isinstance(transform, (list, tuple)) and len(transform) >= 6:
        values = [_num(value) for value in transform[:6]]
        if all(value is not None for value in values):
            a, b, _, d, e, _ = values
            width, height = math.hypot(a, d), math.hypot(b, e)
            area = abs(a * e - b * d) / 10000
    declared_resolution = _num(definition.get("resolution_m"))
    if width is None:
        width = declared_resolution
    if height is None:
        height = declared_resolution
    if area is None:
        area = _num(definition.get("pixel_area_ha"))
    label = (_fmt(width) + " m by " + _fmt(height) + " m cells"
             if width is not None and height is not None
             else "Cells on the retained grid")
    return {
        "cell_label": label,
        "cell_width_m": width,
        "cell_height_m": height,
        "pixel_area_ha": area,
        "crs": definition.get("crs_name") or definition.get("crs"),
        "crs_identifier": definition.get("crs"),
        "width": definition.get("width"),
        "height": definition.get("height"),
        "transform": list(transform) if isinstance(transform, (list, tuple)) else None,
        "geometry_source": "Retained affine transform" if transform else "Retained grid definition",
    }

def _run_pollutants(run):
    expected = set(run_scope(run)["expected_artifacts"])
    return [entry for entry in POLLUTANTS if entry[0] in expected]

def _units(value, fallback):
    return str(value or fallback).replace("metric_tonnes", "metric tonnes").replace("metric_tons", "metric tonnes")

def _source_label(source_records, source_id, role=None):
    for record in source_records:
        if ((source_id and source_id in (record.get("source_id"), record.get("id")))
                or (role and role == record.get("id"))):
            title = record.get("title") or record.get("source_id") or record.get("id")
            return _text(title) + (" | " + str(source_id) if source_id else "")
    return _text(source_id)

def _scenario_assumptions(scenario):
    return {key: scenario.get(key) for key in ("kind", "source_collection_id", "patches")}

def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None

def _fmt(value: Any, digits: int = 6) -> str:
    number = _num(value)
    if number is None:
        return "Not recorded"
    if number == 0:
        return "0"
    if abs(number) >= 1000000 or abs(number) < 0.001:
        return format(number, f".{digits}g")
    return f"{number:,.{digits}g}"

def _supported_quantity(value: Any, valid_cells: Any) -> str:
    support, quantity = _num(valid_cells), _num(value)
    if support is None or support <= 0 or quantity is None:
        return "Unavailable"
    return _fmt(quantity)


def _pct(value: Any) -> str:
    number = _num(value)
    return _fmt(number * 100, 4) + "%" if number is not None else "Not recorded"

def _text(value: Any) -> str:
    if value is None or value == "":
        return "Not recorded"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, Mapping):
        return "; ".join(str(k).replace("_", " ") + ": " + _text(v) for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return "; ".join(_text(item) for item in value) or "None selected"
    return str(value)

def _execution_source(record):
    """Describe the shared resolver's retained basis without choosing a version."""
    labels = {
        "completed_stage_runtime": "Completed model stage",
        "observed_run_fallback": "Observed run fallback; stage version absent",
        "requested_legacy": "Requested legacy version; observed version absent",
        "unavailable": "Version not recorded",
    }
    parts = [labels.get(record["basis"], str(record["basis"]).replace("_", " "))]
    if record.get("differs_from_requested"):
        parts.append("requested " + str(record["requested_version"]))
    if record.get("reused_from"):
        parts.append("retained reused stage")
    return "; ".join(parts)


def _execution_references(versions_by_run):
    """Group version-specific guides while retaining every producing run/basis."""
    references = {}
    for run_id, versions in versions_by_run.items():
        for model, record in versions.items():
            key = (model, record.get("comparison_version"), record.get("basis"),
                   record.get("requested_version"), record.get("differs_from_requested"))
            if key not in references:
                references[key] = {
                    "model": model, "version": record.get("comparison_version"),
                    "purpose": "Native model documentation for the retained version",
                    "basis": record.get("basis"), "version_label": version_label(record),
                    "requested_version": record.get("requested_version"),
                    "differs_from_requested": record.get("differs_from_requested"),
                    "url": guide_url(model, record), "run_ids": [],
                }
            references[key]["run_ids"].append(run_id)
    return list(references.values())


def _execution_summary(versions):
    return "; ".join(
        model.upper() + " " + _text(record["comparison_version"]) +
        " (" + _execution_source(record) + ")"
        for model, record in versions.items()
    ) or "No producing-model version is recorded"


def _safe_path(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("path")
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts or ":" in normalized or normalized.startswith("//"):
        return None
    return normalized

def _section(key, title, paragraphs=(), tables=()):
    return {"id": key, "title": title, "paragraphs": list(paragraphs), "tables": list(tables)}

def _table(columns, rows, caption=None):
    return {"columns": list(columns), "rows": list(rows), "caption": caption}

def _lookup(workspace, collection, identifier):
    if not identifier:
        return {}
    result = workspace._get(collection, identifier)
    return result if isinstance(result, Mapping) else {}

def _run_name(workspace, run):
    choice = run.get("selection", {})
    scenario = _lookup(workspace, "scenarios", choice.get("scenario_id"))
    return str(scenario.get("title") or run.get("title") or run["id"]), scenario

def _map_rows(state, selected_models):
    files = state.get("files", {})
    raw_maps = state.get("maps", {})
    result = []
    for role, title, decision, reading in MAPS:
        matched = []
        for key, raw in raw_maps.items():
            if key == role or key.startswith(role + "-"):
                path = _safe_path(files.get(raw)) if isinstance(raw, str) and raw in files else _safe_path(raw)
                if path and path not in [item["path"] for item in matched]:
                    matched.append({"role": key, "path": path})
        if not matched:
            for key, raw in files.items():
                if key in (role, "map_" + role):
                    path = _safe_path(raw)
                    if path:
                        matched.append({"role": role, "path": path})
        in_scope = MAP_MODELS[role].issubset(set(selected_models))
        status = ("Available" if matched else
                  "Outside selected model scope" if not in_scope else
                  "No map selected for this edition")
        result.append({"role": role, "title": title, "decision": decision,
                       "reading": reading, "files": matched, "status": status,
                       "within_model_scope": in_scope})
    return result

def _quantity_rows(baseline):
    rows = []
    for key, label, default_units in _run_pollutants(baseline):
        artifact = baseline.get("artifacts", {}).get(key, {})
        count = _num(artifact.get("valid_cells"))
        cell_area = _num(artifact.get("pixel_area_ha"))
        area = count * cell_area if count is not None and cell_area is not None else None
        total = _num(artifact.get("sum"))
        average = total / area if total is not None and area is not None and area > 0 else None
        units = _units(artifact.get("sum_units"), default_units)
        rows.append([label, _supported_quantity(total, count), str(units), _fmt(count), _fmt(area),
                     (_fmt(average) + " " + units.replace("/year", "/ha/year"))
                     if average is not None else "Not applicable"])
    return rows

def _difference(comparison, run_id, pollutant):
    for alternative in (comparison or {}).get("alternatives", []):
        if alternative.get("run_id") == run_id:
            return alternative.get("artifacts", {}).get(pollutant, {})
    return {}

def _scenario_rows(workspace, baseline, alternatives, comparison, summary):
    supplied = {(row.get("run_id"), row.get("pollutant")): row
                for row in (summary or {}).get("rows", [])}
    supplied_runs = {row.get("run_id"): row for row in (summary or {}).get("runs", [])}
    _, baseline_scenario = _run_name(workspace, baseline)
    baseline_pollutants = {key for key, _, _ in _run_pollutants(baseline)}
    rows, selections, support = [], [], []
    for alternative in alternatives:
        run_id = alternative["id"]
        name, scenario = _run_name(workspace, alternative)
        base_choice, choice = baseline.get("selection", {}), alternative.get("selection", {})
        profile_changed = choice.get("profile_id") != base_choice.get("profile_id")
        scenario_changed = _scenario_assumptions(scenario) != _scenario_assumptions(baseline_scenario)
        kind = supplied_runs.get(run_id, {}).get("comparison_label") or (
            "Land cover and parameter sensitivity" if profile_changed and scenario_changed
            else "Parameter sensitivity" if profile_changed
            else "Land-cover alternative" if scenario_changed else "Same model assumptions")
        selected_models = run_scope(alternative)["selected_models"]
        selections.append([name, run_id, _text(choice.get("scenario_id")),
                           _text(choice.get("profile_id")),
                           "; ".join(MODEL_LABELS.get(model, model.upper()) for model in selected_models),
                           kind])
        for key, label, default_units in _run_pollutants(alternative):
            if key not in baseline_pollutants:
                continue
            art = alternative.get("artifacts", {}).get(key, {})
            base = baseline.get("artifacts", {}).get(key, {})
            delta = _difference(comparison, run_id, key)
            supplied_row = supplied.get((run_id, key), {})
            total = supplied_row.get("sum", art.get("sum"))
            change = supplied_row.get("sum_change", delta.get("sum_change"))
            joint = supplied_row.get("joint_valid_cells", delta.get("joint_valid_cells", delta.get("valid_cells")))
            original_n = supplied_row.get("valid_cells", art.get("valid_cells"))
            baseline_n = supplied_row.get("baseline_valid_cells", base.get("valid_cells"))
            baseline_total = supplied_row.get("baseline_sum", base.get("sum"))
            units = _units(supplied_row.get("change_units", supplied_row.get("sum_units", art.get("sum_units"))),
                           default_units)
            cn, an, bn = _num(joint), _num(original_n), _num(baseline_n)
            bt, cv = _num(baseline_total), _num(change)
            equal_support = cn is not None and cn > 0 and cn == an == bn
            benefit = None
            if equal_support and bt is not None and bt > 0 and cv is not None:
                supplied_benefit = _num(supplied_row.get("benefit_percent"))
                benefit = supplied_benefit if supplied_benefit is not None else -100 * cv / bt
            benefit_text = ("Unavailable without paired valid cells" if cn is None or cn <= 0
                            else _fmt(benefit, 4) + "%" if benefit is not None
                            else "Not comparable across full supports" if not equal_support
                            else "Not applicable to zero baseline" if bt == 0
                            else "Not recorded")
            rows.append([name, label, _supported_quantity(total, an),
                         _supported_quantity(change, cn), units,
                         _fmt(cn), benefit_text])
            support.append({"run_id": run_id, "pollutant": key,
                            "baseline_valid_cells": baseline_n,
                            "alternative_valid_cells": original_n,
                            "joint_valid_cells": joint,
                            "equal_support": equal_support,
                            "difference": dict(delta),
                            "summary_row": dict(supplied_row)})
    return rows, selections, support

def _receptor_section(state, inventory):
    """Describe retained contributing-area evidence and its registered files."""
    rows = []
    for area in inventory.get("areas", []):
        if not isinstance(area, Mapping):
            continue
        title = _text(area.get("title"))
        role = area.get("role")
        if role:
            title += " | " + _text(role).replace("_", " ")
        rows.append([
            title, _text(area.get("anchor_huc12s")),
            _fmt(area.get("huc12_count")), _fmt(area.get("upstream_area_ha")),
            _fmt(area.get("reporting_area_ha")),
            _fmt(area.get("outside_reporting_area_ha")),
        ])
    labels = {
        "receptor_inventory": "Receiving-area inventory JSON",
        "receptor_geopackage": "Contributing-area native GIS",
        "receptor_memberships": "Upstream HUC12 memberships",
        "receptor_scenario_exports": "Annual quantities and paired scenario changes",
        "receptor_network": "Original hydrologic network links",
        "receptor_report": "Receiving-area navigator",
        "receptor_drinking_water_priority": "Drinking-water priority raster",
        "receptor_high_quality_waters_priority": "High-quality-water priority raster",
    }
    assets, seen = [], set()
    for role, descriptor in (state.get("files") or {}).items():
        if not role.startswith("receptor_"):
            continue
        path = _safe_path(descriptor)
        if not path or path in seen:
            continue
        seen.add(path)
        assets.append({"role": role, "path": path,
                       "title": labels.get(role, role.replace("_", " ").capitalize())})
    settings = [
        ["Method", _text(inventory.get("method"))],
        ["Annual quantity basis", _text(inventory.get("quantity_basis"))],
        ["Scenario change basis", _text(inventory.get("change_basis"))],
        ["Change direction", _text(inventory.get("change_direction")).replace("_", " ")],
        ["Network source", _text(inventory.get("network_source"))],
    ]
    tables = [
        _table(["Receiving area", "Anchor HUC12s", "HUC12 count",
                "Upstream area (ha)", "Inside reporting area (ha)",
                "Outside reporting area (ha)"], rows),
        _table(["Retained setting", "Value"], settings),
    ]
    if assets:
        tables.append(_table(["Working file", "Relative path"],
                             [[item["title"], item["path"]] for item in assets]))
    section = _section("receiving-areas", "Source-water receiving areas and contributing land", [
        "The selected receiving areas connect saved source-water or water-resource targets to contributing land through the retained hydrologic network. The table records the complete contributing-area extent and its overlap with this study's reporting area separately.",
        "The inventory's annual quantities describe land-origin nutrient and sediment export to the modeled stream network from contributing land inside the reporting basin. The complete scenario table retains baseline, alternative and paired quantities for each receiving area and pollutant.",
        "Scenario changes use common finite valid pixels within each receiving area's reporting footprint. Each quantitative row carries its common, baseline-only and alternative-only coverage counts. Shared upstream land is retained explicitly; combine overlapping receiving areas using their geographic union.",
        "Contributing-area GIS, original network links, upstream memberships and annual scenario quantities travel together in the receptors folder."
    ], tables)
    section["assets"] = assets
    return section

def compose_report(*, workspace, selection, state, baseline, alternatives, grid,
                   profile, source_records, observation_results, comparison=None,
                   scenario_summary=None, working_archive_path=None):
    """Return a JSON-serializable report model from original retained objects.

    baseline.artifacts are the existing rate_to_mass REPORTING-MASK outputs.
    sum is already annual mass. It must never be multiplied by cell area again.
    comparison artifacts contain stored paired-cell alternative-minus-baseline
    changes. The optional existing scenario_summary supplies its richer support
    labels directly, without traversing any regional raster.
    """
    baseline_name, baseline_scenario = _run_name(workspace, baseline)
    model_scopes = {run["id"]: run_scope(run) for run in [baseline] + alternatives}
    execution_models = {
        run["id"]: models_for_outputs(model_scopes[run["id"]]["available_artifacts"])
        for run in [baseline] + alternatives
    }
    execution_versions = {
        run["id"]: model_versions(run, execution_models[run["id"]])
        for run in [baseline] + alternatives
    }
    scientific_references = _execution_references(execution_versions)
    selected_models = model_scopes[baseline["id"]]["selected_models"]
    study_mode = native_study.mode(selection) == "native_study"
    study = dict(state.get("native_study") or selection.get("native_study") or {})
    title = (selection.get("title") or (study.get("title") if study_mode else None)
             or workspace.project.get("title")
             or ("Original native study" if study_mode else "Source-water assessment"))
    maps = _map_rows(state, selected_models)
    expected_families = set(native_study.MAP_FAMILIES) if study_mode else {item[0] for item in MAPS}
    if study_mode:
        expected_families.update(item["role"] for item in maps if item["files"])
        maps = [item for item in maps if item["role"] in expected_families]
    grid_context = _grid_context(grid)
    inventory = state.get("parcel_priorities") or {}
    scenario_rows, scenario_selections, supports = _scenario_rows(
        workspace, baseline, alternatives, comparison, scenario_summary)
    reporting_rows = _quantity_rows(baseline)
    grid_spec = grid.get("spec", {})
    overlay_choices = selection.get("overlays") or {}
    source_water_choice = (overlay_choices.get("drinking_water") or {}
                           if isinstance(overlay_choices, Mapping) else {})
    source_water_label = (source_water_choice.get("label")
                          if isinstance(source_water_choice, Mapping) else None)
    source_water_label = source_water_label or ("Drinking-water source areas" if source_water_choice else "No source-water overlay selected")
    map_count = sum(bool(item["files"]) for item in maps)
    sections = []

    sections.append(_section("decisions", "How to use this assessment", [
        "This assessment supports two related land decisions in the selected study area: protecting land where a defined future disturbance increases pollutant delivery, and restoring land that has high modeled exports under current land cover.",
        "Start with the current nitrogen, phosphorus and sediment maps to identify restoration questions. Then use the explicit alternatives to examine protection and management choices. Review source-water and high-quality-water context before assembling a parcel shortlist.",
        str(map_count) + " of " + str(len(expected_families)) +
        (" selected native-study map families" if study_mode else " regional RFP map families") +
        " are present in this edition. The available maps, physical GIS layers, source metadata, scenario comparisons and retained working project form one delivery. The map guide explains each map family and its current availability."
    ]))

    if study_mode:
        sections[0]["paragraphs"] = [
            "This report describes the original selected study and its retained baseline and land-cover alternatives.",
            "Start with the annual physical exports and their valid reporting support. Compare each alternative on the recorded common cells, then inspect its original land-cover changes and selected spatial context.",
            sections[0]["paragraphs"][-1],
        ]
        sections.insert(0, _section("native-study", "Original native study",
            [_text(study.get("title")), _text(study.get("purpose"))] +
            ([str(study["reference"])] if study.get("reference") else []) +
            [str(item) for item in study.get("methods", [])]))
        context_path = _safe_path((state.get("files") or {}).get("native_study_context"))
        if context_path:
            sections[0]["assets"] = [{
                "title": "Original study metadata and retained selections",
                "path": context_path,
            }]

    sections.append(_section("study", "Study area and retained selections", [
        "The selected reporting area is retained separately from the hydrologic modeling domain. The original model uses upstream context to represent contributing flow; delivered annual-mass artifacts and their totals use the reporting mask.",
        "Reporting support, hydrologic contribution and selected source-water geography retain their separate source identities. Read the actual source titles and grid below with the maps for this case."
    ], [_table(["Selection", "Retained value"], [
        ["Project", _text(workspace.project.get("id") or workspace.project.get("uuid") or workspace.project.get("title"))],
        ["Delivery", _text(state.get("id"))],
        ["Report contact", _text(selection.get("contact"))],
        ["Baseline", baseline_name + " | " + baseline["id"]],
        ["Grid", _text(grid.get("id"))],
        ["Grid cell dimensions", grid_context["cell_label"]],
        ["Coordinate system", _text(grid_context["crs"])],
        ["Cell area (ha)", _fmt(grid_context["pixel_area_ha"])],
        ["Grid shape", _fmt(grid_context["width"]) + " columns by " + _fmt(grid_context["height"]) + " rows"],
        ["Reporting support", grid_context["cell_label"] + " selected by the retained reporting mask; native NoData retained"],
        ["Reporting boundary source", _source_label(source_records, (grid_spec.get("reporting_area") or {}).get("source_id"), "REPORTING_BOUNDARY")],
        ["Model domain source", _source_label(source_records, (grid_spec.get("model_domain") or {}).get("source_id"), "MODEL_DOMAIN")],
        ["Source-water overlay", _text(source_water_label)],
        ["Source-water overlay selection", _text(source_water_choice)],
        ["Upstream context buffer", _fmt(grid_spec.get("upstream_buffer_m")) + " m"],
        ["Profile", _text(profile.get("title")) + " | " + _text(profile.get("id"))],
        ["Alternatives in this edition", str(len(alternatives))],
    ]), _table(["Run", "Model", "Available exports", "Version", "Version source"], [
        [run["id"], MODEL_LABELS.get(model, model.upper()),
         "; ".join(name for name in model_scopes[run["id"]]["available_artifacts"]
                   if name in MODEL_OUTPUTS[model]) or "None recorded",
         _text(execution_versions[run["id"]][model]["comparison_version"]),
         _execution_source(execution_versions[run["id"]][model])]
        for run in [baseline] + alternatives
        for model in execution_models[run["id"]]
    ], "Producing-model execution provenance; each fallback keeps its original retained basis.")]))

    sections.append(_section("current", "Current annual nutrient and sediment exports", [
        "The values below reuse the sums recorded with the delivered reporting-mask mass rasters for the selected models. Each layer retains its declared annual units, valid-cell count and represented area.",
        "Mean export per valid hectare is the annual total divided by that layer's valid reporting area. It is a descriptive rate for the represented cells. A valid value of zero remains zero; a cell with no usable data contributes no modeled value.",
        "The physical raster values already incorporate the native rate-to-cell-area conversion for the saved grid. Summing those mass pixels gives the displayed annual totals."
    ], [_table(["Pollutant", "Annual total", "Total units", "Valid cells", "Valid area (ha)", "Mean per valid ha"],
               reporting_rows, "Selected baseline: " + baseline_name),
        _table(["Output", "Native rate", "Delivered cell quantity", "Annual total"], [
            [label,
             _units(baseline.get("artifacts", {}).get(key, {}).get("native_units"),
                    "metric tonnes/ha/year" if key == "sediment_export" else "kg/ha/year"),
             _units(baseline.get("artifacts", {}).get(key, {}).get("units"),
                    "metric tonnes/pixel/year" if key == "sediment_export" else "kg/pixel/year"),
             _units(baseline.get("artifacts", {}).get(key, {}).get("sum_units"), default_units)]
            for key, label, default_units in _run_pollutants(baseline)
        ])]))

    scenario_paragraphs = [
        "Every alternative keeps its original run, scenario and profile identifiers. A land-cover alternative changes the declared polygons and classes; a parameter sensitivity also changes the scientific profile. Those different comparison types remain visible.",
        "Signed change is alternative minus baseline on cells with valid data in both runs. Negative change means less modeled export under the alternative. Annual totals use each run's own valid reporting support; the shared-cell count identifies the support used for the change.",
        "Percentage reduction uses the saved baseline and paired change only when the shared support equals both complete run supports and the baseline is positive. Read annual mass and shared coverage together when those conditions differ."
    ]
    scenario_tables = [
        _table(["Alternative", "Run", "Scenario", "Profile", "Models", "Comparison"], scenario_selections),
        _table(["Alternative", "Pollutant", "Annual total", "Paired change", "Units", "Shared cells", "Reduction"],
               scenario_rows)
    ] if alternatives else []
    if not alternatives:
        scenario_paragraphs.append("This edition contains the selected baseline. The same workspace retains explicit alternatives as they are selected for a later delivery edition.")
    sections.append(_section("alternatives", "Land-cover alternatives and modeled change",
                             scenario_paragraphs, scenario_tables))

    sections.append(_section("atlas", "Map decision guide" if study_mode else "Seven-map decision guide", [
        "Use the map titles, legends, scale bars and north arrows in the accompanying publication PDFs. The current-export maps show physical annual quantities; the combined planning map uses the saved normalization and weights. The future-map files retain each selected alternative.",
        "The file index below lists each publication map separately, including every selected alternative."
    ], [_table(["Map family", "Decision", "How to read it", "Availability"],
               [[m["title"], m["decision"], m["reading"],
                 str(len(m["files"])) + " map file(s)" if m["files"] else m["status"]]
                for m in maps])]))
    map_file_rows = [[m["title"], item["role"], item["path"]]
                     for m in maps for item in m["files"]]
    if map_file_rows:
        sections.append(_section("atlas-files", "Publication map file index", [
            "File paths are relative to this delivery. Family aliases that point to the same file appear once within that family."
        ], [_table(["Map family", "Retained map role", "Relative PDF path"], map_file_rows)]))

    priority = state.get("priority") or {}
    priority_rows = [[str(key).replace("_", " "), _text(value)] for key, value in priority.items()
                     if key not in {"path", "sha256", "files"}]
    sections.append(_section("priorities", "Interpreting combined priorities", [
        "Combined priority supports a transparent planning choice across pollutant layers. The saved normalization puts the selected pollutant signals onto a comparable planning scale; the saved nonnegative weights define their relative contribution.",
        "Read a high priority with the individual annual-mass layers, source-water context, land status and scenario response. Conservation or restoration decisions use that complete context.",
        "Weight and normalization settings are retained below and in the editable report model so a later edition can explain exactly which planning choice changed."
    ], [_table(["Setting", "Retained value"], priority_rows)] if priority_rows else []))

    receptor_inventory = state.get("receptor_inventory") or {}
    if receptor_inventory:
        sections.append(_receptor_section(state, receptor_inventory))

    if inventory:
        coverage = inventory.get("parcel_coverage") or {}
        top = inventory.get("top_by_current_priority") or []
        table_rows = [
            ["Source", _text(inventory.get("source"))],
            ["Features in inventory", _fmt(inventory.get("features"))],
            ["Features without valid modeled pixels", _fmt(inventory.get("features_without_valid_pixels"))],
            ["Reporting area (ha)", _fmt(coverage.get("reporting_area_ha"))],
            ["Parcel footprint (ha)", _fmt(coverage.get("parcel_footprint_area_ha"))],
            ["Reporting area covered by parcel inventory", _pct(coverage.get("reporting_fraction"))],
            ["Uncovered reporting area (ha)", _fmt(coverage.get("uncovered_reporting_area_ha"))],
            ["Coverage method", _text(coverage.get("method"))],
            ["Overlap handling", _text(coverage.get("overlap_handling") or inventory.get("overlap_handling"))],
            ["Scenario direction", _text(inventory.get("scenario_direction"))],
        ]
        shortlist = [[_text(row.get("feature_id")), _fmt(row.get("priority_mean")),
                      "Yes" if row.get("source_water") == 1 else "No" if row.get("source_water") == 0 else "Not recorded",
                      _pct(row.get("protected_fraction"))] for row in top]
        sections.append(_section("parcels", "Parcel review and inventory coverage", [
            "The parcel inventory translates the selected raster and overlay evidence into a practical review list. Its reported footprint describes the actual available parcel source; the selected study and a partial parcel inventory retain their different geographic coverage.",
            "The shortlist is ordered by retained mean combined priority. Source-water membership and protected-area overlap give additional review context. A protected fraction measures the mapped overlap within the parcel; the original source category remains available in the complete GIS inventory.",
            "Use the complete parcel-priorities CSV/GeoPackage for physical quantities and the parcel-scenarios CSV for annual baseline, alternative and paired-change quantities. The short list below carries the original compact priority fields. Parcel centre-cell quantities and any separate fractional-cell analysis retain their method labels."
        ], [_table(["Inventory measure", "Retained value"], table_rows),
            _table(["Parcel identifier", "Mean priority", "Source-water context", "Protected fraction"],
                   shortlist, "Retained top-by-current-priority list")]))
    else:
        sections.append(_section("parcels", "Using the maps for parcel decisions", [
            "Start from a map-supported protection or restoration question, identify the relevant source-water or high-quality-water context, then select the retained parcel source for the next inventory edition. The parcel inventory records its actual footprint, source identifiers and overlap method alongside its quantities.",
            "For each selected parcel, carry the original identifier, current exports, the relevant alternative's paired change, mapped protection status and the conservation action under consideration into the review."
        ]))

    model_names = [MODEL_LABELS.get(model, model.upper()) for model in selected_models]
    methods = [
        "The selected original InVEST models (" + "; ".join(model_names) + ") use the retained inputs, aligned grid, parameter profile and scenario selections. The working project carries native arguments, source files, intermediate outputs and run history.",
        "Baseline execution versions: " + _execution_summary(execution_versions[baseline["id"]]) + ". Each alternative's producing-model version and retained basis appear separately in the run table.",
        "Execution provenance uses the recorded runtime of each completed model stage. When that version is absent, the shared resolver labels an observed run runtime as fallback, or labels a retained requested version as requested legacy. Missing version metadata remains not recorded. Reused-stage lineage and the original completion time are retained in the report data.",
        "The physical output rasters preserve the original reporting-mask conversion and NoData. Scenario changes preserve paired native output support. Source vintages, coefficients, grid alignment and selected overlay relationships accompany interpretation.",
        "Original E. coli, cyanotoxin, concentration and sampling observations retain their measured quantity, unit, station and period. Those observations supply direct measurement context for microbial and algal concerns; model outputs retain their annual nutrient or sediment quantity.",
        "Channel-bank erosion, mass wasting, in-stream and reservoir processes, point sources and impoundment effects have their own scientific interpretation alongside the represented overland processes."
    ]
    if "ndr" in selected_models:
        methods.insert(1, "Nutrient modeling represents annual loading, retention and delivery under the selected land-cover and runoff assumptions. The retained nitrogen output includes modeled surface and subsurface export; the retained phosphorus output represents surface export to the modeled stream network.")
    if "sdr" in selected_models:
        methods.insert(1, "Sediment modeling represents overland erosion and sediment delivered to the modeled stream network under the selected terrain, rainfall erosivity, soil erodibility and land-management factors. Sediment export and modeled soil loss are distinct outputs; the sediment totals here use the export artifact.")
    parameter_rows = []
    for group in selected_models:
        for key, value in (profile.get(group) or {}).items():
            parameter_rows.append([group.upper(), str(key).replace("_", " "), _text(value)])
    sections.append(_section("methods", "Methods and scientific interpretation", methods,
                             [_table(["Model", "Parameter", "Selected value"], parameter_rows)]
                             if parameter_rows else []))

    observation_rows = []
    for observation in observation_results:
        metrics = observation.get("metrics") or {}
        for key, value in metrics.items():
            observation_rows.append([_text(observation.get("observation_id")),
                                     _text(observation.get("run_id")),
                                     str(key).replace("_", " "), _text(value)])
    sections.append(_section("observations", "Observed-load comparisons and source context", [
        "The observation comparison records bind the selected modeled run to their original observation sources. Annual-load interpretation uses the observation's catchment, complete period, measured pollutant and unit. The original observation files and comparison selections remain in the working project.",
        "Read a comparison metric with its sampling and catchment coverage. It describes the retained comparison, while the original observations preserve the meaning of each measured variable."
    ], [_table(["Observation source", "Run", "Metric", "Retained result"], observation_rows)]
    if observation_rows else []))

    source_rows = [[_text(r.get("id")), _text(r.get("vintage")), _text(r.get("uri"))]
                   for r in source_records]
    profile_references = profile.get("references") or []
    sections.append(_section("sources", "Source editions and lineage", [
        "The source inventory identifies the editions used in this delivery. The full working archive retains the original bodies, associated sidecars, saved selections and preparation lineage.",
        "Parameter references: " + _text(profile_references),
        ("The original study reference, reporting area, model domain, biophysical table and selected source editions are retained with this delivery."
         if study_mode else
         "The RFP's final mapping deliverables are listed on PDF page 2; the final/working-file and presentation requirements are on PDF page 3. Appendix PDF pages 6-9 provide the utility and broader sampling context.")
    ], [_table(["Source role", "Vintage", "Original URI"], source_rows),
        _table(["Scientific reference", "Version and source", "Original URI"], [
            [MODEL_LABELS.get(item["model"], item["model"].upper()) + " guide",
             item["version_label"], item["url"] or "Version-specific guide unavailable"]
            for item in scientific_references
        ], "Each reference follows the retained producing-model version; report data identify its runs.")]))

    files = state.get("files") or {}
    handoff_rows = []
    for key in ("nitrogen_export", "phosphorus_export", "sediment_export",
                "parcel_csv", "parcel_geopackage", "parcel_scenario_csv", "parcel_inventory",
                "working_archive"):
        path = _safe_path(files.get(key))
        if key == "working_archive" and working_archive_path is not None:
            planned = _safe_path(working_archive_path)
            if planned is None or (path is not None and path != planned):
                raise ValueError("The planned working archive must retain its package-relative path")
            path = planned
        if path:
            handoff_rows.append([key.replace("_", " "), path])
    sections.append(_section("handoff", "Open, review and reuse the delivery", [
        "Open the existing delivery navigator, select a map family and inspect the corresponding physical raster or parcel table. Use this report to keep the land decision, scientific quantity and source interpretation connected.",
        "For a scenario review, identify the saved baseline and alternative, read the signed physical change and its shared support, then inspect the selected change polygons and land-cover classes in the original operator.",
        "Receive the full working archive through the existing restore workflow into a new directory. Reopen the original study, inspect the same retained inputs and result identifiers, and build a later delivery edition from the selected runs when a reviewed source, scenario or planning choice changes.",
        "The final handoff includes publication maps, physical GIS layers, source/method metadata, this readable report and its editable forms, the complete scientific working project, and the operating guide used by the receiving team."
    ], [_table(["Delivered item", "Relative path"], handoff_rows)] if handoff_rows else []))
    sections[-1]["assets"] = [{"title": title, "path": path} for title, path in handoff_rows]

    scientific_assets = []
    asset_titles = {
        "report": "Complete scientific report (PDF)",
        "report_html": "Complete scientific report (HTML)",
        "report_markdown": "Editable scientific report (Markdown)",
        "report_data": "Scientific quantities, source editions and bindings (JSON)",
        "native_execution": "Producing native execution records (JSON)",
    }
    seen_scientific_paths = set()
    for role, item in files.items():
        if role not in asset_titles and not role.startswith(("economic_", "observed_context_", "decision_")):
            continue
        path = _safe_path(item)
        if path and path not in seen_scientific_paths:
            scientific_assets.append({"title": asset_titles.get(role, role.replace("_", " ")),
                                      "path": path})
            seen_scientific_paths.add(path)
    if scientific_assets:
        section = _section("scientific-evidence", "Scientific report and decision evidence", [
            "The scientific report retains the complete model parameters, annual quantities, comparison "
            "support, source editions and economic-analysis coverage for this same delivery. Its "
            "economic tables distinguish available estimates from alternatives without a recorded cost.",
            "Open the retained reports and selected evidence below from the extracted delivery folder. "
            "Keep the folder structure when sharing the study."
        ])
        section["assets"] = scientific_assets
        sections.append(section)

    if selection.get("notes"):
        sections.append(_section("project-notes", "Project-specific interpretation",
                                 [_text(x) for x in selection["notes"]]))

    return {
        "schema": SCHEMA, "title": title, "report_edition": REPORT_EDITION,
        "grid_context": grid_context,
        "model_scopes": model_scopes,
        "native_execution": {
            "schema": "upstate.client-native-execution/v1",
            "policy": EXECUTION_VERSION_POLICY,
            "run_order": [run["id"] for run in [baseline] + alternatives],
            "models": {key: list(value) for key, value in execution_models.items()},
            "runs": execution_versions,
        },
        "scientific_references": scientific_references,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project": dict(workspace.project),
        "delivery_id": state.get("id"),
        "baseline_run_id": baseline["id"],
        "alternative_run_ids": [r["id"] for r in alternatives],
        "contact": selection.get("contact"),
        "map_families_present": map_count,
        "map_families_expected": len(expected_families),
        "delivery_mode": native_study.mode(selection),
        "native_study": study if study_mode else None,
        "native_study_context": ((state.get("files") or {}).get("native_study_context")
                                 if study_mode else None),
        "selected_map_families": [item["role"] for item in maps if item["files"]],
        "report_kind_label": "Original native study" if study_mode else "Source-water assessment",
        "maps": maps, "sections": sections,
        "sources": list(source_records),
        "rfp_source": None if study_mode else {"url": RFP_URL, "sha256": RFP_SHA256,
                       "requirement_pages": [1, 2, 3, 4],
                       "version_note": "This retained 18-page PDF is distinct from the earlier 04313cdd source edition."},
        "quantity_provenance": {
            "reporting_support": "Original reporting-mask mass artifacts; pixel-centre selection; native NoData retained",
            "baseline_artifacts": {k: baseline.get("artifacts", {}).get(k, {}) for k, _, _ in _run_pollutants(baseline)},
            "scenario_support": supports,
            "baseline_scenario": dict(baseline_scenario),
            "grid_id": grid.get("id"), "profile_id": profile.get("id"),
            "priority": priority, "parcel_inventory": inventory,
            "receptor_inventory": dict(receptor_inventory),
            "observation_comparisons": list(observation_results)
        }
    }

def _md_cell(value):
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", "<br>")

def render_markdown(report):
    lines = ["# " + report["title"], "",
             "Delivery " + str(report.get("delivery_id") or "working edition"), "",
             "Baseline: " + report["baseline_run_id"], ""]
    for section in report["sections"]:
        lines.extend(["## " + section["title"], ""])
        for paragraph in section["paragraphs"]:
            lines.extend([str(paragraph), ""])
        for table in section["tables"]:
            if table.get("caption"):
                lines.extend(["**" + table["caption"] + "**", ""])
            lines.append("| " + " | ".join(_md_cell(x) for x in table["columns"]) + " |")
            lines.append("| " + " | ".join("---" for _ in table["columns"]) + " |")
            lines.extend("| " + " | ".join(_md_cell(x) for x in row) + " |" for row in table["rows"])
            lines.append("")
        for figure in section.get("figures", []):
            path = _safe_path(figure.get("path"))
            if path:
                title = str(figure.get("alt") or figure["title"]).replace("[", "\\[").replace("]", "\\]")
                lines.extend(["![" + title + "](<" + path + ">)", ""])
                if figure.get("caption"):
                    lines.extend([str(figure["caption"]), ""])
        for asset in section.get("assets", []):
            path = _safe_path(asset.get("path"))
            if path:
                title = str(asset.get("title") or path).replace("[", "\\[").replace("]", "\\]")
                lines.extend(["[" + title + "](<" + path + ">)", ""])
    if report.get("rfp_source"):
        lines.extend(["## RFP source", "", "[Official RFP and appendix](" + RFP_URL + "), PDF pages 1-4.",
                      "", "Retained source SHA-256: " + RFP_SHA256, ""])
    return "\n".join(lines)

def render_html(report, *, briefing_href=None):
    esc = html.escape
    sections = []
    for section in report["sections"]:
        chunks = ['<section id="' + esc(section["id"], quote=True) + '"><h2>' + esc(section["title"]) + "</h2>"]
        chunks.extend("<p>" + esc(str(p)) + "</p>" for p in section["paragraphs"])
        for table in section["tables"]:
            chunks.append('<div class="table-scroll"><table>')
            if table.get("caption"):
                chunks.append("<caption>" + esc(table["caption"]) + "</caption>")
            chunks.append("<thead><tr>" + "".join("<th scope=\"col\">" + esc(str(c)) + "</th>" for c in table["columns"]) + "</tr></thead><tbody>")
            for row in table["rows"]:
                chunks.append("<tr>" + "".join("<td>" + esc(str(c)) + "</td>" for c in row) + "</tr>")
            chunks.append("</tbody></table></div>")
        for figure in section.get("figures", []):
            path = _safe_path(figure.get("path"))
            if path:
                chunks.append('<figure class="scientific-source-figure"><h3>' +
                              esc(str(figure["title"])) + '</h3><img loading="lazy" src="' +
                              esc(path, quote=True) + '" alt="' +
                              esc(str(figure.get("alt") or figure["title"]), quote=True) + '">')
                if figure.get("caption"):
                    chunks.append("<figcaption>" + esc(str(figure["caption"])) + "</figcaption>")
                chunks.append("</figure>")
        links = []
        for asset in section.get("assets", []):
            path = _safe_path(asset.get("path"))
            if path:
                links.append('<li><a href="' + esc(path, quote=True) + '">' +
                             esc(str(asset.get("title") or path)) + "</a></li>")
        if links:
            chunks.append("<p>Open the retained working files:</p><ul>" + "".join(links) + "</ul>")
        chunks.append("</section>")
        sections.append("".join(chunks))
    map_links = []
    for item in report["maps"]:
        for file in item["files"]:
            path = _safe_path(file["path"])
            if path:
                map_links.append('<li><a href="' + esc(path, quote=True) + '">' +
                                 esc(item["title"] + " / " + file["role"]) + "</a></li>")
    nav = "".join('<a href="#' + esc(s["id"], quote=True) + '">' + esc(s["title"]) + "</a>"
                  for s in report["sections"])
    if briefing_href is not None:
        selected = _safe_path(briefing_href)
        if selected is None:
            raise ValueError("Customer briefing must remain in the same delivery")
        nav = '<a href="' + esc(selected, quote=True) + '">Open customer briefing and meeting notes</a>' + nav
    style = """*{box-sizing:border-box}body{margin:0;background:#f4f5f6;color:#1d242b;font:15px/1.55 Arial,Helvetica,sans-serif}
header,main,footer{max-width:1120px;margin:0 auto;padding:32px 36px;background:#fff}
header{border-bottom:3px solid #333f4b}header .label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#59636e}
h1{font-size:30px;line-height:1.2;margin:12px 0}h2{font-size:21px;line-height:1.3;border-bottom:1px solid #cdd2d7;padding-bottom:8px;margin-top:0}
.scientific-source-figure{margin:24px 0;break-inside:avoid}.scientific-source-figure img{display:block;width:100%;height:auto}.scientific-source-figure figcaption{font-size:12px;margin-top:12px}
.meta{color:#58626d;font-size:12px;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px}
nav a{font-size:12px}a{color:#243b50}section{padding:14px 0 30px;break-inside:auto}p{max-width:940px}
.table-scroll{overflow-x:auto;margin:16px 0}table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.45;table-layout:fixed}
th,td{border:1px solid #d4d9de;padding:9px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#edf0f2;font-weight:bold}caption{text-align:left;font-weight:bold;margin:0 0 8px}
tbody tr:nth-child(even){background:#fafbfc}footer{border-top:1px solid #cdd2d7;font-size:11px;overflow-wrap:anywhere}
@media(max-width:650px){header,main,footer{padding:22px 18px}h1{font-size:25px}table{min-width:600px}}
@media print{body{background:white;font-size:10pt}header,main,footer{max-width:none;padding:0}nav{display:none}section{padding-bottom:16px}h2{break-after:avoid}thead{display:table-header-group}tr{break-inside:avoid}table{font-size:8pt}.table-scroll{overflow:visible}a{color:inherit;text-decoration:none}}"""
    source_footer = (
        '<a href="' + esc(RFP_URL, quote=True) + '">Official RFP and appendix</a>, PDF pages 1-4.'
        '<p>Retained RFP SHA-256: ' + RFP_SHA256 + '</p>'
        if report.get("rfp_source") else
        "Original study source editions, native model selections and working files are retained with this report.")
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>" + esc(report["title"]) + "</title><style>" + style + "</style></head><body>"
            "<header><div class=\"label\">" + esc(report.get("report_kind_label", "Source-water assessment")) + "</div><h1>" + esc(report["title"]) +
            "</h1><div class=\"meta\">Delivery " + esc(str(report.get("delivery_id") or "working edition")) +
            " | Baseline " + esc(report["baseline_run_id"]) + "</div><nav aria-label=\"Report sections\">" +
            nav + "</nav></header><main>" + "".join(sections) +
            ("<section><h2>Open the publication maps</h2><ul>" + "".join(map_links) + "</ul></section>" if map_links else "") +
            "</main><footer>" + source_footer + "</footer></body></html>")

def render_pdf(path, report):
    """Render a sober, paginated report; keep all quantities as supplied."""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ClientBody", fontName="Helvetica", fontSize=9,
                              leading=13, spaceAfter=8, textColor=colors.HexColor("#26313b"),
                              wordWrap="CJK"))
    styles.add(ParagraphStyle(name="ClientCell", parent=styles["ClientBody"],
                              fontSize=7.0, leading=9.2, spaceAfter=0))
    styles.add(ParagraphStyle(name="ClientHeadCell", parent=styles["ClientCell"],
                              fontName="Helvetica-Bold"))
    styles.add(ParagraphStyle(name="ClientHeading", fontName="Helvetica-Bold",
                              fontSize=15, leading=19, spaceBefore=15, spaceAfter=10,
                              keepWithNext=True, textColor=colors.HexColor("#273541")))
    styles.add(ParagraphStyle(name="ClientTitle", fontName="Helvetica-Bold",
                              fontSize=25, leading=30, spaceAfter=16))
    styles.add(ParagraphStyle(name="ClientMeta", parent=styles["ClientBody"],
                              fontSize=8, textColor=colors.HexColor("#59636e")))
    width = 7.15 * inch
    doc = SimpleDocTemplate(str(path), pagesize=(8.5*inch, 11*inch),
                            leftMargin=.675*inch, rightMargin=.675*inch,
                            topMargin=.65*inch, bottomMargin=.65*inch,
                            title=report["title"],
                            author=(str((report.get("contact") or {}).get("organization") or "")
                                    if report.get("delivery_mode") == "native_study"
                                    else "TokenJunkie Labs"))
    p = lambda value, sty="ClientBody": Paragraph(html.escape(str(value)).replace("\n", "<br/>"), styles[sty])
    story = [p(report.get("report_kind_label", "Source-water assessment").upper(), "ClientMeta"),
             p(report["title"], "ClientTitle"),
             p("Delivery " + str(report.get("delivery_id") or "working edition") +
               " | Baseline " + report["baseline_run_id"], "ClientMeta"), Spacer(1, 10)]
    for section in report["sections"]:
        story.append(p(section["title"], "ClientHeading"))
        story.extend(p(text) for text in section["paragraphs"])
        for table in section["tables"]:
            if table.get("caption"):
                story.append(p(table["caption"], "ClientMeta"))
            count = len(table["columns"])
            if not count:
                continue
            weights = [1] * count
            if count == 2:
                weights = [1, 2.3]
            elif section["id"] == "study" and count == 5:
                weights = [1.1, .75, 1.15, .5, 1.4]
            elif section["id"] == "atlas" and count == 4:
                weights = [.85, 1.25, 1.7, 1.2]
            elif section["id"] == "atlas-files" and count == 3:
                weights = [.9, 1.1, 2.5]
            elif section["id"] == "sources" and count == 3:
                weights = [.8, .65, 2.5]
            cells = [[p(value, "ClientHeadCell") for value in table["columns"]]]
            cells.extend([p(value, "ClientCell") for value in row] for row in table["rows"])
            tbl = Table(cells, colWidths=[width*w/sum(weights) for w in weights],
                        repeatRows=1, hAlign="LEFT", splitByRow=1)
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#e8edf0")),
                ("GRID", (0,0), (-1,-1), .35, colors.HexColor("#c9d0d7")),
                ("VALIGN", (0,0), (-1,-1), "TOP"),
                ("LEFTPADDING", (0,0), (-1,-1), 6),
                ("RIGHTPADDING", (0,0), (-1,-1), 6),
                ("TOPPADDING", (0,0), (-1,-1), 6),
                ("BOTTOMPADDING", (0,0), (-1,-1), 6),
                ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f8f9fa")])
            ]))
            story.extend([tbl, Spacer(1, 12)])
        for figure in section.get("figures", []):
            from .scientific_figures import panel_drawings
            story.append(p(figure["title"], "ClientHeading"))
            if figure.get("caption"):
                story.append(p(figure["caption"], "ClientMeta"))
            for drawing in panel_drawings(figure["spec"], width):
                story.extend([drawing, Spacer(1, 12)])
        for asset in section.get("assets", []):
            relative = _safe_path(asset.get("path"))
            if relative:
                label = str(asset.get("title") or relative)
                story.append(Paragraph(
                    '<link href="' + html.escape(relative, quote=True) + '">' +
                    html.escape(label) + '</link>', styles["ClientBody"]))
                story.append(p(relative, "ClientMeta"))
    if report.get("rfp_source"):
        story.extend([p("RFP source", "ClientHeading"),
                      Paragraph('<link href="' + html.escape(RFP_URL, quote=True) +
                                '">Official RFP and appendix</link>, PDF pages 1-4.', styles["ClientBody"]),
                      p("Retained source SHA-256: " + RFP_SHA256, "ClientMeta")])
    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#c9d0d7"))
        canvas.line(.675*inch, .43*inch, 7.825*inch, .43*inch)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#59636e"))
        canvas.drawString(.675*inch, .28*inch, report.get("report_kind_label", "Source-water assessment"))
        canvas.drawRightString(7.825*inch, .28*inch, str(_doc.page))
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

def write_report(directory, report, *, pdf_name="report.pdf", output_stem=None,
                 file_key_prefix=""):
    """Write coordinated reports using canonical or companion filenames.

    Defaults preserve the original report state keys. For a client companion to
    an existing scientific report, use output_stem="client-report" and
    file_key_prefix="client_". All map paths stay relative to the same directory.
    pdf_name retains its original direct-writer behavior when no stem is set.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if not isinstance(file_key_prefix, str) or not re.fullmatch(r"[A-Za-z0-9_]*", file_key_prefix):
        raise ValueError("file_key_prefix must contain only ASCII letters, digits and underscores")
    if output_stem is not None:
        if not isinstance(output_stem, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", output_stem):
            raise ValueError("output_stem must be a simple filename stem")
        if pdf_name != "report.pdf":
            raise ValueError("Choose output_stem or pdf_name, rather than both")
        stem = output_stem
        pdf_relative = stem + ".pdf"
    else:
        stem = "report"
        pdf_relative = _safe_path(pdf_name)
        if pdf_relative is None or Path(pdf_relative).name != pdf_relative:
            raise ValueError("pdf_name must be a simple relative filename")
    names = {"report": pdf_relative, "report_html": stem + ".html",
             "report_markdown": stem + ".md", "report_model": stem + "-model.json"}
    (directory / names["report_html"]).write_text(
        render_html(report, briefing_href=stem + "-briefing.html"), encoding="utf-8")
    (directory / names["report_markdown"]).write_text(render_markdown(report), encoding="utf-8")
    (directory / names["report_model"]).write_text(json.dumps(report, ensure_ascii=False,
                                                           indent=2, allow_nan=False) + "\n", encoding="utf-8")
    render_pdf(directory / names["report"], report)
    from .client_briefing import write as write_briefing
    names.update(write_briefing(directory, report, stem=stem))
    return {file_key_prefix + key: value for key, value in names.items()}

def _observed_sections(product):
    """Adapt already collected observed blocks without an Implementation dependency."""
    if product is None:
        return []
    def original_path(value):
        relative = _safe_path(value)
        if relative is None:
            raise ValueError("Observed client assets must remain in the retained delivery.")
        return relative
    sections = []
    for index, (heading, blocks) in enumerate(product["sections"]):
        section = {"id": "observed-context-" + str(index + 1), "title": _text(heading),
                   "paragraphs": [], "tables": [], "assets": [], "figures": []}
        for block in blocks:
            if isinstance(block, str):
                section["paragraphs"].append(block)
            elif isinstance(block, dict) and block.get("kind") == "table":
                columns, rows = block.get("columns", []), block.get("rows", [])
                if not columns or any(len(row) != len(columns) for row in rows):
                    raise ValueError("An observed client table has inconsistent columns.")
                section["tables"].append({
                    "columns": [_text(value) for value in columns],
                    "rows": [[_text(value) for value in row] for row in rows],
                    "caption": block.get("caption"),
                })
            elif isinstance(block, dict) and block.get("kind") == "links":
                for item in block.get("items", []):
                    relative = original_path(item["path"])
                    section["assets"].append({"path": relative, "title": item.get("title") or relative})
            elif isinstance(block, dict) and block.get("kind") == "figure":
                relative = original_path(block["path"])
                title = block.get("title") or "Original scientific source figure"
                from .scientific_figures import _validate_figure
                specification = block.get("spec")
                _validate_figure(specification)
                section["figures"].append({
                    "path": relative, "title": title, "caption": str(block.get("caption") or ""),
                    "alt": str(block.get("alt") or title), "spec": specification,
                    "bytes": block["bytes"], "sha256": block["sha256"],
                })
                section["assets"].append({"path": relative, "title": title})
            else:
                raise ValueError("An observed report block has no supported client representation.")
        sections.append(section)
    return sections


def build_report(*, workspace, directory, selection, state, baseline, alternatives,
                 grid, profile, records, observation_results, comparison=None,
                 scenario_summary=None, additional_sections=(), decision_product=None,
                 observed_product=None, output_stem=None, file_key_prefix="", working_archive_path=None):
    """Drop-in report hook for the existing delivery.py report branch."""
    from .client_receiving_waters import build_sections, LEGACY_SECTION_TITLE

    report = compose_report(workspace=workspace, selection=selection, state=state,
                            baseline=baseline, alternatives=alternatives, grid=grid,
                            profile=profile, source_records=records,
                            observation_results=observation_results, comparison=comparison,
                            scenario_summary=scenario_summary,
                            working_archive_path=working_archive_path)
    run_names = {run["id"]: _run_name(workspace, run)[0]
                 for run in [baseline] + list(alternatives)}
    water_report = build_sections(
        directory, state, baseline_run_id=baseline["id"],
        alternative_run_ids=[run["id"] for run in alternatives],
        run_names=run_names, number=_fmt, text=_text,
    )
    appended = list(decision_delivery.client_sections(decision_product))
    appended.extend(_observed_sections(observed_product))
    if observed_product is not None:
        report["observed_context"] = observed_product["binding"]
        report["quantity_provenance"]["observed_context"] = observed_product["binding"]
    if decision_product is not None:
        report["source_decision"] = decision_product["binding"]
        report["quantity_provenance"]["source_decision"] = decision_product["binding"]
    for index, (title, paragraphs) in enumerate(additional_sections, 1):
        if water_report is not None and title == LEGACY_SECTION_TITLE:
            continue
        appended.append(_section("receiving-water-" + str(index), title, paragraphs))
    if water_report is not None:
        appended.extend(water_report["sections"])
        report["quantity_provenance"]["receiving_waters"] = water_report["provenance"]
    section_ids = {section["id"] for section in report["sections"]}
    for section in appended:
        key = section["id"]
        while key in section_ids:
            key += "-additional"
        report["sections"].append(dict(section, id=key))
        section_ids.add(key)
    return write_report(directory, report, output_stem=output_stem,
                        file_key_prefix=file_key_prefix)
