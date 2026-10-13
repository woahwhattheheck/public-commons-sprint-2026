"""Compare saved native catchment outputs with explicitly selected original sources.

No native run or observation import is dispatched here. Original values, source
definitions and unmatched rows remain in the immutable comparison edition.
"""
from __future__ import annotations
import csv
import datetime as dt
import html
import io
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

from .common import (atomic_json, canonical, describe_file, digest, file_digest,
                     held, identifier, read_json, relative_file, verify_file)
from . import observation_support, observed_context, independent_comparison_figures

SCHEMA = "upstate.independent-comparison-selection/v1"
RESULT_SCHEMA = "upstate.independent-comparison/v1"
KIND = "independent-comparisons"
EDITION = "saved-native-independent-source-2"
SOURCE_ID = "independent-comparison"
APPLICATION = Path(__file__).resolve().parent.parent
FIELDS = ("record_id", "catchment_id", "parameter", "value", "unit", "period_start",
          "period_end", "qualifier", "method", "uncertainty", "source_records",
          "parameter_code", "species", "source_constituent")
EVIDENCE = ("field_load_estimate", "external_model_estimate", "reported_effluent",
            "concentration", "other")
SUPPORTS = ("landscape_to_stream", "station_catchment_load", "reach_incremental",
            "reach_accumulated", "point_source_discharge", "concentration", "other")
ASSESSMENTS = ("quantity", "fraction", "space", "time")
METHODS = "model/INDEPENDENT_COMPARISON_METHODS.md"
GUIDE = "model/INDEPENDENT_COMPARISON_DOMAIN.md"
CATALOG = "model/independent_comparison_reference_catalog.json"
# These are implementation/source custody limits, never scientific row sampling.
# Complete originals are parsed and exported; no scientific population is capped.


def _copy(value):
    return json.loads(canonical(value))


def _text(value, label, *, required=True):
    if not isinstance(value, str) or "\0" in value or (required and not value.strip()):
        raise ValueError("State " + label + " as original text")
    return value


def _only(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(label + " contains unsupported fields")
    return value


def _list(value, label):
    if not isinstance(value, list):
        raise ValueError(label + " must be a complete list")
    return value


def _reference(value, *, complete=False):
    _only(value, {"source_collection_id", "source_id", "source_sha256", "format",
                  "columns", "defaults", "parameter_map", "definition"}, "Reference selection")
    result = _copy(value)
    identifier(result.get("source_collection_id"))
    identifier(result.get("source_sha256"))
    _text(result.get("source_id"), "the original source ID")
    if result.get("format", "csv") != "csv":
        raise ValueError("Select the retained original UTF-8 CSV table")
    result["format"] = "csv"
    if complete:
        columns = result.setdefault("columns", {})
        defaults = result.setdefault("defaults", {})
        for mapping, label in ((columns, "Source columns"), (defaults, "Source defaults")):
            _only(mapping, FIELDS, label)
            for key, item in mapping.items():
                _text(item, label + " " + key, required=False)
        parameters = result.setdefault("parameter_map", {})
        if not isinstance(parameters, dict) or any(
                not isinstance(k, str) or not k or v not in ("nitrogen", "phosphorus", "sediment")
                for k, v in parameters.items()):
            raise ValueError("Map exact original parameter labels to nitrogen, phosphorus or sediment")
        definition = result.get("definition")
        keys = {"evidence_kind", "quantity", "source_support", "fraction", "temporal_basis",
                "spatial_basis", "method", "source_period", "lineage", "reference_ids"}
        _only(definition, keys, "Reference definition")
        if definition.get("evidence_kind") not in EVIDENCE:
            raise ValueError("Select the original evidence kind")
        if definition.get("source_support") not in SUPPORTS:
            raise ValueError("Select the original scientific support")
        for key in keys - {"reference_ids"}:
            _text(definition.get(key), "reference " + key)
        _list(definition.get("reference_ids", []), "Context references")
        for item in definition.get("reference_ids", []):
            _text(item, "context reference")
        definition.setdefault("reference_ids", [])
    return result


def _selection(value):
    allowed = {"schema", "title", "author", "interpretation", "notes", "parent_id",
               "native_comparison_id", "reference", "input_sha256", "producers", "pairs"}
    _only(value, allowed, "Independent comparison selection")
    result = _copy(value)
    if result.get("schema") != SCHEMA:
        raise ValueError("Use " + SCHEMA)
    for key in ("title", "author", "interpretation"):
        _text(result.get(key), key)
    identifier(result.get("native_comparison_id"))
    identifier(result.get("input_sha256"))
    result["reference"] = _reference(result.get("reference"), complete=True)
    parent = result.setdefault("parent_id", None)
    if parent is not None:
        identifier(parent)
    result.setdefault("notes", [])
    for item in _list(result["notes"], "Notes"):
        _text(item, "note", required=False)
    seen, matches = set(), set()
    for pair in _list(result.get("pairs"), "Selected original pairs"):
        _only(pair, {"id", "native_observation_id", "reference_row_number",
                     "decision", "assessment", "rationale"}, "Pair")
        _text(pair.get("id"), "pair ID")
        _text(pair.get("native_observation_id"), "original native observation ID")
        n = pair.get("reference_row_number")
        if isinstance(n, bool) or not isinstance(n, int) or n < 1:
            raise ValueError("Reference row_number is its original one-based CSV data row")
        key = (pair["native_observation_id"], n)
        if pair["id"] in seen or key in matches:
            raise ValueError("Select each original pair once with a distinct pair ID")
        seen.add(pair["id"])
        matches.add(key)
        if pair.get("decision") not in ("comparable", "context-only"):
            raise ValueError("Select comparable or context-only")
        assessment = _only(pair.get("assessment"), ASSESSMENTS, "Pair assessment")
        if set(assessment) != set(ASSESSMENTS) or any(
                assessment[k] not in ("same", "different", "unknown") for k in ASSESSMENTS):
            raise ValueError("Assess quantity, fraction, space and time explicitly")
        _text(pair.get("rationale"), "the pair's support and period rationale")
    if not result["pairs"]:
        raise ValueError("Select at least one original pair; context-only pairs are valid")
    return result


def producers():
    names = ["model/independent_comparison.py", "model/common.py", "model/verified_files.py",
             "model/observations.py", "model/observation_support.py",
             "model/observed_context.py", "model/independent_comparison_figures.py",
             "model/scientific_figures.py", "model/scientific_map_figures.py",
             "model/rasters.py", METHODS, GUIDE, CATALOG]
    return {name: {"bytes": (APPLICATION / name).stat().st_size,
                   "sha256": file_digest(APPLICATION / name)} for name in names}


def reference_catalog():
    value = read_json(APPLICATION / CATALOG)
    if value.get("schema") != "upstate.independent-comparison-reference-catalog/v1":
        raise ValueError("Retain the installed independent source reference catalog")
    return value


def _native(workspace, key):
    original = workspace._get("observation-comparisons", identifier(key))
    run = workspace.inspect_run(original["run_id"])
    if run.get("state") != "complete":
        raise ValueError("Select an actual completed original native run")
    observations = workspace._get("observations", original["observation_id"])
    profile = workspace._get("profiles", run["selection"]["profile_id"])
    grid = workspace.get_grid(run["selection"]["grid_id"])
    if original.get("model_period") != profile.get("model_period"):
        raise ValueError("Saved native comparison and original profile period differ")
    if original.get("model_source_vintages") != grid.get("inputs"):
        raise ValueError("Saved native comparison and original grid source editions differ")
    catchment = original["catchment_selection"]
    catchment_path, entry = workspace.source_file(catchment["source_collection_id"], catchment["source_id"])
    if original.get("catchment_source", {}).get("sha256") != entry["body"]["sha256"]:
        raise ValueError("Original native comparison catchment source changed")
    observation_path = relative_file(workspace.root, observations["original"]["object"])
    if (file_digest(observation_path) != observations["original"]["sha256"]
            or observation_path.stat().st_size != observations["original"]["bytes"]):
        raise ValueError("Original observation input changed")
    originals = {row["id"]: row for row in observations["rows"]}
    if len(originals) != len(observations["rows"]):
        raise ValueError("Original observation identities are ambiguous")
    native_rows, seen = [], set()
    run_root = workspace.root / "runs" / run["id"]
    files = {}
    for row in original["comparisons"]:
        key = row["observation_id"]
        if key in seen or key not in originals:
            raise ValueError("Saved comparison has an ambiguous original observation")
        seen.add(key)
        support = row.get("spatial_coverage", {})
        binding = support.get("native_stream_source", {})
        # Older complete comparisons without same-stage custody are readable
        # elsewhere; this component requires the maintained full native binding.
        if not binding:
            raise ValueError("Select a maintained comparison retaining its original export and stream binding")
        if binding.get("run_id") != run["id"]:
            raise ValueError("Native spatial support belongs to another original run")
        stage = run["stages"].get(binding["model"])
        if not stage:
            raise ValueError("Selected comparison native model is absent")
        for name, registry, item in (
                ("export", binding["export_registry_id"], binding["export_file"]),
                ("stream", binding["registry_id"], binding["file"])):
            if stage["files"].get(registry) != item:
                raise ValueError("Comparison selected another native " + name)
            native_key = binding["model"] + "-" + registry
            if native_key in files and files[native_key] != item:
                raise ValueError("Repeated native output selects another original file")
            if native_key not in files:
                verify_file(run_root, item)
                files[native_key] = item
        if stage["arguments"] != binding["arguments"]:
            raise ValueError("Native arguments differ from the saved spatial comparison")
        argument_key = binding["model"] + "-arguments"
        if argument_key in files and files[argument_key] != stage["arguments"]:
            raise ValueError("Repeated native model selects different original arguments")
        if argument_key not in files:
            verify_file(run_root, stage["arguments"])
            files[argument_key] = stage["arguments"]
        native_rows.append({
            **_copy(row), "native_support": "landscape_to_stream",
            "native_evidence_kind": "native_model_output",
            "native_period": _copy(profile.get("model_period")),
            "native_reference_basis": observation_support.reference_basis(originals[key], observations["metadata"]),
            "original_observation": _copy(originals[key]),
        })
    return {"comparison": original, "rows": native_rows, "run": run,
            "observations": observations, "profile": profile, "grid": grid,
            "catchment_entry": entry, "catchment_path": catchment_path,
            "observation_path": observation_path, "native_files": files}


def _table(workspace, selection):
    reference = _reference(selection)
    path, entry = workspace.source_file(reference["source_collection_id"], reference["source_id"])
    if entry["kind"] != "table" or entry["body"]["sha256"] != reference["source_sha256"]:
        raise ValueError("Select the exact retained original table edition")
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames
        if not columns or any(not isinstance(k, str) or not k for k in columns) or len(set(columns)) != len(columns):
            raise ValueError("Original reference table needs distinct nonempty headers")
        rows = []
        for index, row in enumerate(reader, 1):
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Reference table row has a different field count at data row " + str(index))
            rows.append({"row_number": index, "original": dict(row)})
    if not rows:
        raise ValueError("Original reference table has no data rows")
    return path, {"selector": {k: reference[k] for k in
                    ("source_collection_id", "source_id", "source_sha256", "format")},
                  "entry": _copy(entry), "columns": list(columns), "rows": rows}


def catalog(workspace):
    native = []
    for item in workspace._list("observation-comparisons"):
        native.append({"id": item["id"], "run_id": item["run_id"],
                       "observation_id": item["observation_id"],
                       "title": item.get("observation_method", {}).get("title", "Saved native comparison"),
                       "rows": len(item["comparisons"]),
                       "parameters": sorted({r["parameter"] for r in item["comparisons"]}),
                       "model_period": item.get("model_period")})
    references = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry["kind"] == "table":
                references.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                   "source_sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
                                   **{k: entry.get(k) for k in ("title", "uri", "vintage", "kind")}})
    return {"schema": "upstate.independent-comparison-catalog/v1", "project_id": workspace.project["id"],
            "native_comparisons": native, "reference_sources": references,
            "reference_catalog": reference_catalog(), "editions": overview(workspace)}


def inputs(workspace, selection):
    identifier(selection.get("native_comparison_id"))
    native = _native(workspace, selection["native_comparison_id"])
    _, reference = _table(workspace, selection.get("reference"))
    body = {"schema": "upstate.independent-comparison-inputs/v1",
            "project_id": workspace.project["id"], "native_comparison": native["comparison"],
            "native_rows": native["rows"], "reference": reference,
            "original_run": native["run"], "original_profile": native["profile"],
            "original_grid": native["grid"], "original_observations": native["observations"],
            "catchment_entry": native["catchment_entry"], "native_files": native["native_files"]}
    return {**body, "input_sha256": digest(body), "producers": producers()}


def _mapped(reference, choice):
    columns, defaults = choice["columns"], choice["defaults"]
    missing = sorted({name for name in columns.values() if name and name not in reference["columns"]})
    if missing:
        raise ValueError("Mapped original columns are absent: " + ", ".join(missing))
    result = []
    for original in reference["rows"]:
        row = {"row_number": original["row_number"], "original": _copy(original["original"])}
        for field in FIELDS:
            # A selected original column always wins, including its blank value.
            name = columns.get(field)
            row[field] = original["original"][name] if name else defaults.get(field, "")
        row["original_parameter"] = row["parameter"]
        row["parameter"] = choice["parameter_map"].get(row["parameter"], row["parameter"])
        row["reference_basis"] = observation_support.reference_basis(row, choice["definition"])
        row["definition"] = _copy(choice["definition"])
        result.append(row)
    return result


def _number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def _period(value):
    if not isinstance(value, dict):
        return None
    start = value.get("start", value.get("period_start"))
    end = value.get("end", value.get("period_end"))
    if not isinstance(start, str) or not isinstance(end, str):
        return None
    try:
        a, b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    except ValueError:
        return None
    return (start, end) if b > a else None


def _pair(native, reference, choice, definition):
    from .observations import NATIVE, MASS_FACTORS
    issues = []
    parameter = native["parameter"]
    if any(choice["assessment"][key] != "same" for key in ASSESSMENTS):
        issues.append("The analyst has not declared all quantity, fraction, spatial and temporal supports the same")
    if native.get("coverage_status") != "complete" or not native.get("included_in_metrics"):
        issues.append("Original native catchment support is incomplete")
    if definition["source_support"] != "landscape_to_stream":
        issues.append("Reference " + definition["source_support"] + " differs from native landscape-to-stream support")
    if definition["quantity"] != "annual_mass_rate":
        issues.append("Reference quantity is not an explicitly selected annual mass rate")
    if definition["evidence_kind"] in ("reported_effluent", "concentration", "other"):
        issues.append("Original evidence kind does not establish the same landscape-to-stream annual quantity")
    if reference["parameter"] != parameter:
        issues.append("Original reference constituent differs from the native parameter")
    fractions = {"nitrogen": "total_nitrogen", "phosphorus": "total_phosphorus", "sediment": "total_sediment"}
    if definition["fraction"] != fractions.get(parameter):
        issues.append("Original reference fraction differs from native " + fractions.get(parameter, parameter))
    basis = reference["reference_basis"]
    if basis["status"] in ("conflicting_parameter", "mixed_source_constituents"):
        issues.append("Original reference constituent evidence is conflicting or mixed")
    if parameter == "sediment" and set(basis["parameter_codes"]) & {"00530", "80154"}:
        issues.append("TSS or SSC analytical evidence is retained; it is not silently converted to total hillslope sediment")
    value, prediction = _number(reference["value"]), _number(native["modeled_annual_mass"])
    if value is None or value < 0:
        issues.append("Original reference is not a finite nonnegative point annual mass")
    if prediction is None or prediction < 0:
        issues.append("Original native result is not a finite nonnegative annual mass")
    if reference["qualifier"].strip() not in ("", "="):
        issues.append("Original qualifier is not an unqualified point value; its text is retained")
    factor = MASS_FACTORS.get(parameter, {}).get(reference["unit"])
    if factor is None:
        issues.append("Original reference unit has no maintained exact annual mass conversion")
    if native.get("units") != NATIVE.get(parameter, (None, None, None))[2]:
        issues.append("Original native comparison units differ from the maintained model output")
    native_period = _period(native.get("native_period"))
    reference_period = _period({"start": reference["period_start"], "end": reference["period_end"]})
    if reference["period_start"] or reference["period_end"]:
        if reference_period is None:
            issues.append("Original reference period is incomplete or invalid")
    if native_period and reference_period and native_period != reference_period:
        issues.append("Explicit original native and reference periods differ")
    # Nonidentical station/reach labels are not automatically wrong; the explicit
    # original spatial rationale must explain the actual selected geometry.
    warning = []
    if native.get("catchment_id") != reference.get("catchment_id"):
        warning.append("Original spatial IDs differ; inspect the retained geometry and explicit spatial rationale")
    if not native_period or not reference_period:
        warning.append("A calendar period is not resolved on both sides; retain the explicit temporal basis and rationale")
    if definition["evidence_kind"] == "external_model_estimate":
        warning.append("This is a comparison of model estimates, not independent field validation")
    warning.append("Reference lineage: " + definition["lineage"])
    eligible = choice["decision"] == "comparable" and not issues
    converted = value * factor if value is not None and factor is not None else None
    if converted is not None and not math.isfinite(converted):
        issues.append("Converted reference annual mass is non-finite")
        eligible = False
        converted = None
    difference = prediction - converted if eligible else None
    if difference is not None and not math.isfinite(difference):
        issues.append("Annual mass difference is non-finite")
        eligible = False
        difference = None
    relative = difference / converted if eligible and converted != 0 else None
    if relative is not None and not math.isfinite(relative):
        relative = None
    return {"id": choice["id"], "native_observation_id": choice["native_observation_id"],
            "reference_row_number": choice["reference_row_number"],
            "native": _copy(native), "reference": _copy(reference),
            "requested_decision": choice["decision"],
            "decision": "comparable" if eligible else "context-only",
            "assessment": _copy(choice["assessment"]), "rationale": choice["rationale"],
            "issues": issues, "notes": warning,
            "conversion": None if factor is None else
                {"source_unit": reference["unit"], "target_unit": native["units"], "factor": factor},
            "converted_reference_value": converted, "difference": difference, "relative_difference": relative,
            "relative_difference_reason": ("Reference value is zero" if eligible and converted == 0 else
                                           "Pair is context-only" if not eligible else
                                           "Non-finite relative arithmetic" if relative is None else None),
            "units": native["units"]}


def analyze(supplied, selection):
    """Pure complete calculation over original inputs; no filesystem or mutation."""
    value = _selection(selection)
    expected_input = digest({k: v for k, v in supplied.items() if k not in ("input_sha256", "producers")})
    expected_source = {k: value["reference"][k] for k in
                       ("source_collection_id", "source_id", "source_sha256", "format")}
    if (expected_input != supplied["input_sha256"]
            or value["native_comparison_id"] != supplied["native_comparison"]["id"]
            or expected_source != supplied["reference"]["selector"]
            or value["input_sha256"] != supplied["input_sha256"]
            or value["producers"] != supplied["producers"]):
        raise ValueError("Selected original source or implementation edition changed; reopen its inputs")
    native = {r["observation_id"]: r for r in supplied["native_rows"]}
    if len(native) != len(supplied["native_rows"]):
        raise ValueError("Native row IDs are ambiguous")
    reference_rows = _mapped(supplied["reference"], value["reference"])
    reference = {r["row_number"]: r for r in reference_rows}
    pairs = []
    for choice in value["pairs"]:
        if choice["native_observation_id"] not in native or choice["reference_row_number"] not in reference:
            raise ValueError("A selected original pair is absent from the retained inputs")
        pairs.append(_pair(native[choice["native_observation_id"]], reference[choice["reference_row_number"]],
                           choice, value["reference"]["definition"]))
    statistics = []
    for parameter in ("nitrogen", "phosphorus", "sediment"):
        matched = [p for p in pairs if p["decision"] == "comparable" and p["native"]["parameter"] == parameter]
        if not matched:
            continue
        residuals = [p["difference"] for p in matched]
        scale = max(abs(x) for x in residuals)
        rmse = scale * math.sqrt(math.fsum((x / scale) ** 2 for x in residuals) / len(residuals)) if scale else 0.0
        bias = math.fsum(x / len(residuals) for x in residuals)
        statistics.append({
            "parameter": parameter, "units": matched[0]["units"], "n": len(matched),
            "pair_ids": [p["id"] for p in matched], "mean_difference": bias, "rmse_difference": rmse,
            "unique_native_values": len({(p["native"]["catchment_id"], parameter) for p in matched}),
            "unique_reference_rows": len({p["reference_row_number"] for p in matched}),
            "repeated_native_support": len({(p["native"]["catchment_id"], parameter) for p in matched}) < len(matched),
            "repeated_reference_rows": len({p["reference_row_number"] for p in matched}) < len(matched),
            "basis": "Descriptive differences for this explicitly selected matched set; no independence, holdout, fit or validation claim",
        })
    used_native = {p["native_observation_id"] for p in pairs}
    used_reference = {p["reference_row_number"] for p in pairs}
    return {"schema": RESULT_SCHEMA, "project_id": supplied["project_id"], "selection": value,
            "input_sha256": supplied["input_sha256"], "pairs": pairs, "statistics": statistics,
            "unpaired_native": [r for r in supplied["native_rows"] if r["observation_id"] not in used_native],
            "unpaired_reference": [r for r in reference_rows if r["row_number"] not in used_reference],
            "counts": {"pairs": len(pairs), "comparable": sum(p["decision"] == "comparable" for p in pairs),
                       "context_only": sum(p["decision"] == "context-only" for p in pairs),
                       "native_rows": len(native), "reference_rows": len(reference),
                       "unpaired_native": len(native) - len(used_native),
                       "unpaired_reference": len(reference) - len(used_reference)},
            "source_issues": {"original_exclusions": _copy(supplied["native_comparison"].get("exclusions", [])),
                              "original_context_rows": _copy(supplied["native_comparison"].get("context_rows", [])),
                              "original_metrics_exclusions": _copy(supplied["native_comparison"].get("metrics_exclusions", []))},
            "interpretation": value["interpretation"],
            "arithmetic": "difference = native - converted reference; relative_difference = difference / reference, undefined at zero; no summed reference loads or native rerun",
            "lineage": value["reference"]["definition"]["lineage"]}


def preview(workspace, selection):
    value = _selection(selection)
    return analyze(inputs(workspace, value), value)


def _sections(data):
    rows = []
    for pair in data["pairs"]:
        rows.append([pair["id"], pair["native"]["parameter"], pair["native"]["catchment_id"],
                     str(pair["reference"].get("record_id", pair["reference_row_number"])),
                     str(pair["native"]["modeled_annual_mass"]), str(pair["reference"]["value"]),
                     pair["reference"]["unit"], pair["decision"],
                     "" if pair["difference"] is None else str(pair["difference"]),
                     "; ".join(pair["issues"]), pair["rationale"]])
    return [
        ["Comparison question and interpretation", [
            data["selection"]["title"], "Analyst: " + data["selection"]["author"],
            data["interpretation"], "Reference lineage: " + data["lineage"],
            "Original native outputs and selected external estimates are retained separately. "
            "Matched differences are descriptive and do not establish independent validation."]],
        ["Selected original pairs", [{"kind": "table",
            "columns": ["Pair", "Constituent", "Native catchment", "Reference record",
                        "Native annual mass", "Original reference", "Original unit",
                        "Decision", "Difference", "Source issues", "Rationale"], "rows": rows}]],
        ["Complete source and support", [
            "The downloadable inputs retain all original reference rows, native comparison, "
            "observation exclusions, context, original run/profile/grid and exact selected source files. "
            "The Workspace backup retains the complete executable native project.",
            json.dumps(data["selection"]["reference"]["definition"], ensure_ascii=False, sort_keys=True)]],
    ]


def _html(data, figures=None, directory=None):
    e = lambda x: html.escape(str(x), quote=True)
    parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>" + e(data["selection"]["title"]) + "</title>",
             "<style>body{margin:0;background:#f5f5f3;color:#202222;font:16px/1.5 system-ui}main{max-width:1500px;margin:auto;padding:24px}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;background:white}th,td{padding:10px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#e5e5e1}.scroll{overflow:auto}p,td{overflow-wrap:anywhere}a{color:#202222}pre{white-space:pre-wrap}@media(max-width:600px){main{padding:12px}table{font-size:14px}}</style><main>",
             "<h1>" + e(data["selection"]["title"]) + "</h1><p>Saved scientific comparison · original native and retained reference sources</p>",
             "<p><a href='comparison.json'>Complete result</a> · <a href='inputs.json'>Complete original inputs</a> · <a href='selection.json'>Editable selection</a> · <a href='pairs.csv'>Pair table</a></p>"]
    for title, blocks in _sections(data):
        parts.append("<h2>" + e(title) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                parts.append("<p>" + e(block) + "</p>")
            else:
                parts.append("<div class='scroll'><table><thead><tr>" + "".join("<th>" + e(x) + "</th>" for x in block["columns"]) + "</tr></thead><tbody>")
                for row in block["rows"]:
                    parts.append("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row) + "</tr>")
                parts.append("</tbody></table></div>")
    if figures is not None:
        parts.append("<h2>Saved comparison maps and figures</h2><p><a href='figures/index.html'>Complete figure reader and original source tables</a> · <a href='figures/figure-data.json'>Full pair and geometry data</a></p>")
        for item in figures["figures"]:
            svg = (Path(directory) / item["path"]).read_text(encoding="utf-8")
            start = svg.find("<svg")
            if start < 0 or not svg.rstrip().endswith("</svg>"):
                raise ValueError("Retain a complete generated native SVG")
            parts.append("<section><h3>" + e(item["title"]) +
                         "</h3><div class='scroll' style='max-width:100%;overflow:auto'>" +
                         svg[start:] + "</div><p>" + e(item["caption"]) + "</p></section>")
    parts.append("<h2>Arithmetic and coverage</h2><p>" + e(data["arithmetic"]) + "</p><pre>" +
                 e(json.dumps(data["statistics"], ensure_ascii=False, indent=2)) + "</pre></main></html>")
    return "".join(parts)


def _copy_file(source, target, expected):
    source, target = Path(source), Path(target)
    if source.stat().st_size != expected["bytes"] or file_digest(source) != expected["sha256"]:
        raise ValueError("Selected original file changed before export: " + source.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
        raise ValueError("Selected original file changed during export: " + source.name)


def _entry_files(workspace, entry, directory, prefix):
    copied, seen = [], set()
    for item in [entry["body"]] + entry.get("companions", []):
        # Preserve the original view names and companion relationships (including
        # shapefile/CSV sidecars), inside this selected source's own directory.
        name = item.get("view_path", item["filename"])
        member = Path(name)
        if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
                or member.is_absolute() or ".." in member.parts or member.as_posix() != name
                or name in seen):
            raise ValueError("Original source member name is not unique and portable")
        seen.add(name)
        target = prefix + "/" + name
        _copy_file(relative_file(workspace.root, item["object"]), directory / target, item)
        copied.append({"original": _copy(item), **describe_file(directory, directory / target)})
    return copied

def _archive(directory, names, destination):
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for name in sorted(names):
            path = directory / name
            if not path.is_file() or path.is_symlink():
                raise ValueError("Comparison archive needs original regular files")
            item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            with path.open("rb") as source, archive.open(item, "w", force_zip64=True) as output:
                shutil.copyfileobj(source, output, 1024 * 1024)


def _finish(workspace, directory, identity):
    plan = read_json(directory / "build.json")
    if plan["identity"] != identity:
        raise ValueError("Original interrupted comparison selection differs")
    for item in plan["files"].values():
        verify_file(directory, item)
    collection = workspace.import_sources(directory / "model-sources.json")
    source = {"source_collection_id": collection["id"], "source_id": SOURCE_ID}
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: source}})
    receipt = {"schema": "upstate.independent-comparison-edition/v1", "id": digest(identity),
               "state": "complete", "project_id": workspace.project["id"],
               "identity": identity, "selection": identity["selection"],
               "title": identity["selection"]["title"], "parent_id": identity["selection"]["parent_id"],
               "counts": plan["counts"], "source": source, "observed_binding": binding,
               "files": {name: describe_file(workspace.root, directory / item["path"])
                         for name, item in plan["files"].items()}}
    atomic_json(directory / "receipt.json", receipt, immutable=True)
    return receipt


def build(workspace, selection):
    value = _selection(selection)
    identity = {"edition": EDITION, "project_id": workspace.project["id"],
                "selection": value, "input_sha256": value["input_sha256"],
                "producers": value["producers"]}
    key = digest(identity)
    parent = workspace.root / KIND
    parent.mkdir(parents=True, exist_ok=True)
    with held(parent / ("." + key + ".lock"), blocking=False):
        final = parent / key
        if (final / "receipt.json").exists():
            return inspect(workspace, key)["edition"]
        if final.exists():
            return _finish(workspace, final, identity)
        selected_inputs = inputs(workspace, value)
        data = analyze(selected_inputs, value)
        if value["parent_id"] is not None:
            inspect(workspace, value["parent_id"])
        temporary = Path(tempfile.mkdtemp(prefix="." + key + "-", dir=parent))
        try:
            native = _native(workspace, value["native_comparison_id"])
            _, reference = _table(workspace, value["reference"])
            originals = []
            originals.extend(_entry_files(workspace, reference["entry"], temporary, "originals/reference"))
            originals.extend(_entry_files(workspace, native["catchment_entry"], temporary, "originals/catchments"))
            observed = native["observations"]["original"]
            observation_name = Path(observed["filename"]).name
            if not observation_name or "\\" in observation_name or "\0" in observation_name:
                raise ValueError("Original observation filename is not portable")
            observation_target = temporary / "originals/observations" / observation_name
            _copy_file(native["observation_path"], observation_target, observed)
            originals.append({"original": observed, **describe_file(temporary, observation_target)})
            for name, item in native["native_files"].items():
                target = temporary / "originals/native" / (name + "-" + item["sha256"] + Path(item["path"]).suffix)
                _copy_file(verify_file(workspace.root / "runs" / native["run"]["id"], item), target, item)
                originals.append({"original": item, **describe_file(temporary, target)})
            atomic_json(temporary / "original-files.json", originals, immutable=True)
            atomic_json(temporary / "selection.json", value, immutable=True)
            atomic_json(temporary / "inputs.json", selected_inputs, immutable=True)
            atomic_json(temporary / "comparison.json", data, immutable=True)
            figures = independent_comparison_figures.prepare(temporary, selected_inputs, data, originals)
            (temporary / "report.html").write_text(_html(data, figures, temporary), encoding="utf-8")
            with (temporary / "pairs.csv").open("w", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream)
                table = _sections(data)[1][1][0]
                writer.writerow(table["columns"])
                writer.writerows(table["rows"])
            for name in selected_inputs["producers"]:
                target = temporary / "implementation" / name
                _copy_file(APPLICATION / name, target, selected_inputs["producers"][name])
            atomic_json(temporary / "reference-catalog.json", reference_catalog(), immutable=True)
            # The complete imported original report remains selectable in Study
            # without a second source store or scheduler.
            retained = sorted(p.relative_to(temporary).as_posix() for p in temporary.rglob("*") if p.is_file())
            recipe = {"schema": observed_context.SCHEMA, "edition": EDITION, "title": value["title"],
                      "report_context_kind": "independent-source-comparison",
                      "sections": _sections(data),
                      "inputs": [describe_file(temporary, temporary / name) for name in retained],
                      "source_links": [{"title": "Complete comparison report", "path": "report.html"},
                                       {"title": "Complete original input records", "path": "inputs.json"},
                                       {"title": "Editable original selection", "path": "selection.json"},
                                       {"title": "Original files and source identities", "path": "original-files.json"}]}
            recipe["figure_spec"] = figures["spec"]
            recipe["figures"] = [{"id": row["id"], "path": row["path"]} for row in figures["figures"]]
            recipe["source_links"].extend([
                {"title": "Saved comparison map and figure reader", "path": figures["reader"]},
                {"title": "Complete pair and source geometry data", "path": figures["data_path"]},
                {"title": "All pair values and original definitions", "path": figures["csv"]},
                {"title": "Complete original and projected geometry", "path": figures["geometry_path"]},
                {"title": "Scientific figure specifications", "path": figures["spec"]}])
            # Keep every body under one recipe-root so original view_path preserves
            # all report links and original member relationships.
            source = temporary
            atomic_json(source / "observed-context.json", recipe, immutable=True)
            members = ["observed-context.json"] + retained
            source_manifest = {"schema": "upstate.sources/v1", "title": value["title"],
                "entries": [{"id": SOURCE_ID, "kind": "document", "title": value["title"],
                    "uri": "urn:upstate:independent-comparison:" + key, "vintage": EDITION,
                    "path": members[0], "sha256": file_digest(source / members[0]),
                    "metadata": {"independent_comparison": {"id": key, "project_id": workspace.project["id"]}},
                    "companions": [{"path": name, "sha256": file_digest(source / name)} for name in members[1:]]}]}
            atomic_json(source / "model-sources.json", source_manifest, immutable=True)
            all_names = sorted(p.relative_to(temporary).as_posix() for p in temporary.rglob("*") if p.is_file())
            _archive(temporary, all_names, temporary / "independent-comparison.zip")
            files = {name: describe_file(temporary, temporary / name)
                     for name in all_names + ["independent-comparison.zip"]}
            atomic_json(temporary / "build.json", {"identity": identity, "counts": data["counts"], "files": files}, immutable=True)
            if inputs(workspace, value) != selected_inputs:
                raise ValueError("Original comparison inputs changed during export")
            os.rename(temporary, final)
            temporary = None
            return _finish(workspace, final, identity)
        finally:
            if temporary is not None:
                shutil.rmtree(temporary)


def inspect(workspace, key):
    key = identifier(key)
    directory = workspace.root / KIND / key
    receipt = read_json(directory / "receipt.json")
    identity = receipt["identity"]
    if (digest(identity) != key or receipt.get("id") != key
            or receipt.get("project_id") != workspace.project["id"]
            or identity.get("project_id") != workspace.project["id"]
            or receipt.get("state") != "complete" or receipt.get("selection") != identity["selection"]):
        raise ValueError("Retained independent comparison identity differs")
    plan = read_json(directory / "build.json")
    expected_files = {name: {**item, "path": (directory / item["path"]).relative_to(workspace.root).as_posix()}
                      for name, item in plan["files"].items()}
    if plan["identity"] != identity or receipt["files"] != expected_files:
        raise ValueError("Original comparison file inventory differs")
    for item in receipt["files"].values():
        verify_file(workspace.root, item)
    selected_inputs = read_json(directory / "inputs.json")
    data = read_json(directory / "comparison.json")
    if digest({k: v for k, v in selected_inputs.items() if k not in ("input_sha256", "producers")}) != selected_inputs["input_sha256"]:
        raise ValueError("Retained comparison input identity differs")
    if (selected_inputs["input_sha256"] != identity["input_sha256"]
            or selected_inputs["producers"] != identity["producers"]
            or data["selection"] != identity["selection"]
            or data["counts"] != receipt["counts"]):
        raise ValueError("Retained comparison result and original selection differ")
    # Reopening verifies original files and identity. It does not recompute an old
    # result with a changed future implementation or change its source edition.
    source = receipt["source"]
    _, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    if entry.get("metadata", {}).get("independent_comparison") != {"id": key, "project_id": workspace.project["id"]}:
        raise ValueError("Comparison Study source differs")
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: source}})
    old = receipt["observed_binding"]
    if {k: v for k, v in binding.items() if k != "edition"} != {k: v for k, v in old.items() if k != "edition"}:
        raise ValueError("Original comparison Study members changed")
    figures = independent_comparison_figures.inspect(directory, plan["files"], data)
    if identity.get("edition") == EDITION and figures is None:
        raise ValueError("Current comparison edition requires its complete original figures")
    result = {"edition": receipt, "data": data, "inputs": selected_inputs}
    if figures is not None:
        result["figures"] = figures
    return result


def overview(workspace):
    result = []
    for path in sorted((workspace.root / KIND).glob("*/receipt.json")):
        receipt = read_json(path)
        key = path.parent.name
        if digest(receipt["identity"]) != key or receipt.get("project_id") != workspace.project["id"]:
            raise ValueError("Retained independent comparison identity changed")
        result.append({k: receipt[k] for k in ("id", "title", "parent_id", "counts", "source", "selection")})
    return result


def verify_all(workspace):
    return [inspect(workspace, item["id"])["edition"] for item in overview(workspace)]
