"""Editable, source-bound geography for a retained conservation decision.

This module exports existing decisions and original WKB. It does not score,
optimize, reproject, simplify or modify the authoritative conservation plan.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import math
from pathlib import Path

from . import conservation
from .common import atomic_bytes, atomic_json, canonical, describe_file, digest, file_digest, read_json, verify_file

EDITION = "conservation-decision-geography/2"
SCHEMA = "upstate.conservation-decision-geography/v1"
INVENTORY = "decision-geography.json"
GPKG = "decision-geography.gpkg"

FIELDS = {
    "unit_id": "str", "label": "str", "analysis_id": "str", "study_id": "str", "plan_id": "str",
    "decision_score": "float", "decision_rank": "int", "selected": "int",
    "eligible": "int", "source_eligible": "int", "whole_area_ha": "float", "report_area_ha": "float",
    "preference_count": "int", "preference_selected": "int", "preference_eligible": "int",
    "preference_min_rank": "int", "preference_max_rank": "int",
    "case_count": "int", "case_selected": "int", "case_eligible": "int",
    "case_min_rank": "int", "case_max_rank": "int",
    "exclusions_json": "str", "source_identity_json": "str",
}

def implementation():
    from importlib.metadata import version
    from . import conservation_report_maps
    return {
        "edition": EDITION, "module_sha256": file_digest(__file__),
        "conservation_geometry_writer_sha256": file_digest(conservation.__file__),
        "geometry_check_sha256": file_digest(conservation_report_maps.__file__),
        "fiona_version": version("fiona"), "shapely_version": version("shapely"),
        "pyproj_version": version("pyproj"),
    }

def _json(value):
    return canonical(value).decode("utf-8")

def _binding(workspace, study, plan, analysis, candidate_data, geometry_data):
    from pyproj import CRS
    if (study.get("state") != "complete" or plan.get("state") != "complete"
            or plan.get("study_id") != study.get("id")
            or plan["selection"].get("study_id") != study["id"]):
        raise ValueError("Decision geography needs the same completed study and saved plan")
    original = dict(analysis)
    analysis_id = original.pop("id", None)
    reference = plan["selection"].get("optimization") or {}
    if (not isinstance(analysis_id, str) or digest(original) != analysis_id
            or reference.get("analysis_id") != analysis_id
            or reference.get("study_id") != study["id"]):
        raise ValueError("Decision geography must retain the original saved analysis")
    recorded = analysis.get("input", {})
    if (recorded.get("study_id") != study["id"]
            or recorded.get("selection") != study["selection"]
            or recorded.get("candidate_inventory") != study["files"]["candidates"]
            or recorded.get("geometry_inventory") != study["files"]["geometries"]
            or recorded.get("matched_family_support") != study.get("matched_family_support")
            or plan["selection"].get("candidates_sha256") != study["files"]["candidates"]["sha256"]
            or plan["selection"].get("geometries_sha256") != study["files"]["geometries"]["sha256"]):
        raise ValueError("Decision geography source inventories changed")
    crs = CRS.from_user_input(study["analysis_crs"])
    if (not crs.is_projected or crs.to_epsg() == 3857 or len(crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-8 for axis in crs.axis_info[:2])
            or CRS.from_user_input(plan["analysis_crs"]) != crs
            or CRS.from_user_input(geometry_data.get("analysis_crs")) != crs):
        raise ValueError("Decision layers require the original projected metre CRS")
    if (candidate_data.get("schema") != "upstate.conservation-candidates/v1"
            or candidate_data.get("study_id") != study["id"]
            or geometry_data.get("schema") != "upstate.conservation-geometries/v1"
            or geometry_data.get("study_id") != study["id"]):
        raise ValueError("Decision geometry inputs identify another retained study")
    candidates = candidate_data["candidates"]
    source = {row["id"]: row for row in candidates}
    rows = {row["feature_id"]: row for row in analysis["candidates"]}
    if (len(source) != len(candidates) or len(rows) != len(analysis["candidates"])
            or set(source) != set(rows) or set(source) != set(geometry_data["units"])):
        raise ValueError("Decision, source and geometry inventories must have exactly the same original IDs")
    selected = analysis.get("selected_ids")
    if (not isinstance(selected, list) or len(set(selected)) != len(selected)
            or set(selected) != set(plan["selected_ids"])
            or set(selected) != {key for key, row in rows.items() if row["selected"]}):
        raise ValueError("Decision geography cannot replace the saved plan's selected IDs")
    for key, row in rows.items():
        if (row["source_identity"] != source[key]["source_identity"]
                or row["whole_unit_area_ha"] != source[key]["area_ha"]
                or row["reporting_area_ha"] != source[key]["reporting_area_ha"]):
            raise ValueError("A decision row does not match its original candidate: " + key)
        for name in ("selected", "eligible", "source_eligible"):
            if not isinstance(row[name], bool):
                raise ValueError("Retain original boolean decision state: " + name)
        if row["score"] is not None and (isinstance(row["score"], bool)
                or not isinstance(row["score"], (int, float)) or not math.isfinite(row["score"])):
            raise ValueError("Decision geography cannot assign an unavailable score")
        if row["rank"] is not None and (isinstance(row["rank"], bool)
                or not isinstance(row["rank"], int) or row["rank"] < 1):
            raise ValueError("Retain the original positive decision rank")
    return crs, source, rows

def _stability_fields(analysis, row):
    result = {}
    for prefix, key, count, selected, eligible in (
        ("preference", "stability", "profile_count", "selected_profiles", "eligible_profiles"),
        ("case", "scenario_stability", "case_count", "selected_cases", "eligible_cases"),
    ):
        enabled = bool((analysis.get(key) or {}).get("enabled"))
        value = row.get("preference_stability" if prefix == "preference" else "scenario_stability") or {}
        for suffix, source_key in (("count", count), ("selected", selected), ("eligible", eligible),
                                   ("min_rank", "minimum_rank"), ("max_rank", "maximum_rank")):
            result[prefix + "_" + suffix] = value.get(source_key) if enabled else None
    return result

def _properties(study, plan, analysis, row):
    return {
        "unit_id": row["feature_id"], "label": row["label"], "analysis_id": analysis["id"],
        "study_id": study["id"], "plan_id": plan["id"], "decision_score": row["score"],
        "decision_rank": row["rank"], "selected": int(row["selected"]), "eligible": int(row["eligible"]),
        "source_eligible": int(row["source_eligible"]), "whole_area_ha": row["whole_unit_area_ha"],
        "report_area_ha": row["reporting_area_ha"], **_stability_fields(analysis, row),
        "exclusions_json": _json(row["exclusions"]), "source_identity_json": _json(row["source_identity"]),
    }

def _geometry(geometry_data, key, which, expected_area):
    from shapely import wkb
    from .conservation_report_maps import _checked_area
    value = wkb.loads(bytes.fromhex(geometry_data["units"][key][which]))
    if (not value.is_empty and (value.geom_type not in ("Polygon", "MultiPolygon") or not value.is_valid)):
        raise ValueError("Decision export requires original valid planning geometry: " + key)
    _checked_area(value, expected_area, "decision " + which + " unit " + key)
    return value

def _write_layers(path, crs, study, plan, analysis, rows, geometries):
    import fiona
    from shapely.geometry import mapping, shape
    layers = (("decision_units", "original", "whole_unit_area_ha"),
              ("decision_reporting", "reporting", "reporting_area_ha"))
    schema = {"geometry": "MultiPolygon", "properties": FIELDS}
    with conservation.rasters.vector_environment():
        for name, which, area in layers:
            with fiona.open(path, "w", driver="GPKG", layer=name, crs_wkt=crs.to_wkt(), schema=schema) as output:
                for key in sorted(rows):
                    row = rows[key]
                    geometry = _geometry(geometries, key, which, row[area])
                    output.write({"geometry": None if geometry.is_empty else
                                  mapping(conservation._multipolygon(geometry)),
                                  "properties": _properties(study, plan, analysis, row)})
        # Reopen the actual generated layers and verify identity, all decision
        # properties and exact retained vertices before publishing their bytes.
        for name, which, area in layers:
            seen = set()
            with fiona.open(path, layer=name) as original:
                from pyproj import CRS
                if CRS.from_user_input(original.crs_wkt) != crs:
                    raise ValueError("Generated decision layer changed its original CRS")
                for feature in original:
                    props = dict(feature["properties"])
                    key = props.get("unit_id")
                    if key not in rows or key in seen or props != _properties(study, plan, analysis, rows[key]):
                        raise ValueError("Generated decision layer changed its original IDs or values")
                    seen.add(key)
                    expected = _geometry(geometries, key, which, rows[key][area])
                    actual = feature["geometry"]
                    if expected.is_empty:
                        if actual is not None and not shape(actual).is_empty:
                            raise ValueError("An empty retained footprint acquired invented coordinates")
                    elif actual is None or not shape(actual).equals_exact(conservation._multipolygon(expected), 0):
                        raise ValueError("Generated decision geometry changed retained original vertices")
            if seen != set(rows):
                raise ValueError("Generated decision layer omitted original candidates")

def _write_csv(path, fields, records):
    # Raw string IDs remain lossless for GIS joins. Open/import these as data
    # columns, not spreadsheet formula cells; JSON/GPKG remain authoritative.
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="raise")
        writer.writeheader()
        for record in records:
            writer.writerow({key: _json(value) if isinstance(value, (dict, list)) else value
                             for key, value in record.items()})

def _criteria(analysis):
    request = analysis["request"]
    if request["objective"]["kind"] == "multi-criteria":
        return request["objective"]["criteria"]
    return [{"id": axis, "label": axis, "kind": request["objective"]["kind"], "axis": axis,
             "basis": request["objective"]["basis"], "direction": "maximize",
             "scenario_run_id": request["objective"].get("scenario_run_id"),
             **({"family_id": request["objective"]["family_id"]} if "family_id" in request["objective"] else {})}
            for axis in request["axes"]]

def _cases(analysis):
    selected = {"name": "Selected case", "candidates": analysis["candidates"],
                "criteria": _criteria(analysis)}
    comparison = analysis.get("scenario_stability") or {}
    return comparison["cases"] if comparison.get("enabled") else [selected]

def _criterion_values(analysis):
    for case_index, case in enumerate(_cases(analysis)):
        for row in case["candidates"]:
            for index, criterion in enumerate(case["criteria"]):
                key = criterion["id"]
                support = row["axis_support"][key]
                raw = row["objective_values"][key]
                scale = analysis["normalization"]["scales"][key]
                weight = analysis["request"]["weights"][key]
                direction = criterion["direction"]
                normalized = ((-1 if direction == "minimize" else 1) * raw / scale
                              if support["eligible_support"] and scale else 0.0)
                yield {"unit_id": row["feature_id"], "case_index": case_index,
                       "case_name": case["name"], "criterion_id": key, "criterion_index": index,
                       "raw_value": raw, "unit": row["objective_units"][key], "basis": criterion["basis"],
                       "direction": direction, "scale": scale, "weight": weight,
                       "normalized_value": normalized if support["eligible_support"] else None,
                       "weighted_contribution": weight * normalized if support["eligible_support"] else None,
                       "eligible_support": support["eligible_support"],
                       "availability": support.get("availability"),
                       "coverage_fraction": support.get("coverage_fraction"),
                       "reason": support.get("availability_reason"),
                       "analysis_source_ref": support.get("source_ref") or "/request/objective",
                       "family_id": criterion.get("family_id"),
                       **{key: support.get(key) for key in (
                           "baseline_run_id", "alternative_run_id", "support_id", "support_sha256",
                           "common_baseline", "common_alternative", "delta", "reduction", "valid_area_ha",
                           "common_covered_area_ha", "common_structural_stream_area_ha", "missing_area_ha")}}

def _case_values(analysis):
    for index, case in enumerate(_cases(analysis)):
        for row in case["candidates"]:
            yield {"unit_id": row["feature_id"], "case_index": index, "case_name": case["name"],
                   "selected": row["selected"], "eligible": row.get("eligible", row["rank"] is not None),
                   "rank": row["rank"], "score": row["score"], "exclusions": row["exclusions"]}


def _family_values(study, plan, candidate_data):
    """Original-unit and authoritative selected-union quantities stay separate."""
    families = {row["id"]: row for row in study["selection"]["spec"]["matched_families"]}
    runs = study["selection"]["bindings"]["runs"]
    rows = [("planning_unit", row["id"], row["pollutants"]) for row in candidate_data["candidates"]]
    rows.append(("selected_union", None, plan["summary"]["pollutants"]))
    for scope, unit_id, pollutants in rows:
        for pollutant, quantity in pollutants.items():
            for family_id, value in quantity.get("matched_families", {}).items():
                family = families[family_id]
                yield {
                    "scope": scope, "unit_id": unit_id, "family_id": family_id,
                    "family_label": family["label"], "pollutant": pollutant, "unit": quantity["unit"],
                    "profile_id": runs[family["baseline_run_id"]]["selection"]["profile_id"],
                    **{key: value.get(key) for key in (
                        "baseline_run_id", "alternative_run_id", "comparison_availability",
                        "comparison_availability_reason", "common_baseline", "common_alternative",
                        "delta", "reduction", "common_coverage_fraction", "common_valid_area_ha",
                        "common_structural_stream_area_ha", "common_covered_area_ha", "selected_area_ha",
                        "missing_area_ha", "support_id", "support_sha256")},
                }

def prepare(workspace, study, plan, analysis, directory):
    """Retain an editable counterpart of this exact completed decision."""
    directory = Path(directory)
    candidate_data = read_json(verify_file(workspace.root, study["files"]["candidates"]))
    geometry_data = read_json(verify_file(workspace.root, study["files"]["geometries"]))
    crs, source, rows = _binding(workspace, study, plan, analysis, candidate_data, geometry_data)
    identity = {
        "implementation": implementation(), "project_id": workspace.project["id"],
        "study_id": study["id"], "plan_id": plan["id"], "analysis_id": analysis["id"],
        "analysis_files": deepcopy(plan["selection"]["optimization"]["files"]),
        "candidate_inventory": deepcopy(study["files"]["candidates"]),
        "geometry_inventory": deepcopy(study["files"]["geometries"]),
        "selected_ids": list(plan["selected_ids"]), "analysis_crs": crs.to_wkt(),
        **({"matched_family_support_id": study["matched_family_support"]["id"]}
           if study.get("matched_family_support") else {}),
    }
    index = directory / INVENTORY
    if index.exists():
        saved = read_json(index)
        if saved.get("schema") != SCHEMA or saved.get("identity") != identity:
            raise ValueError("Retained decision geography binds another source or implementation")
        for item in saved["files"]:
            verify_file(directory, item)
        return {**saved, "files": saved["files"] + [describe_file(directory, index)]}
    directory.mkdir(parents=True, exist_ok=True)
    # Called inside the original export lock. Only this uncommitted successor's
    # known files can be replaced after interruption; old exports remain intact.
    gpkg = directory / GPKG
    gpkg.unlink(missing_ok=True)
    _write_layers(gpkg, crs, study, plan, analysis, rows, geometry_data)
    paths = [gpkg]
    criteria = _criteria(analysis)
    path = directory / "criteria.csv"
    _write_csv(path, ["criterion_index", "criterion_id", "label", "kind", "axis", "units", "basis", "direction",
                      "weight", "scale", "scenario_run_id", "family_id", "analysis_source_ref"], (
        {"criterion_index": index, "criterion_id": item["id"], "label": item["label"],
         "kind": item["kind"], "axis": item.get("axis"),
         "units": sorted({row["objective_units"][item["id"]] for row in analysis["candidates"]}, key=str),
         "basis": item["basis"],
         "direction": item["direction"], "weight": analysis["request"]["weights"][item["id"]],
         "scale": analysis["normalization"]["scales"][item["id"]],
         "scenario_run_id": item.get("scenario_run_id"), "family_id": item.get("family_id"),
         "analysis_source_ref": "/request/objective/criteria/" + str(index)
             if analysis["request"]["objective"]["kind"] == "multi-criteria" else "/request/objective"}
        for index, item in enumerate(criteria)))
    paths.append(path)
    path = directory / "criterion-values.csv"
    _write_csv(path, ["unit_id", "case_index", "case_name", "criterion_id", "criterion_index",
                      "raw_value", "unit", "basis", "direction", "scale", "weight", "normalized_value",
                      "weighted_contribution", "eligible_support", "availability", "coverage_fraction",
                      "reason", "analysis_source_ref", "family_id", "baseline_run_id", "alternative_run_id",
                      "support_id", "support_sha256", "common_baseline", "common_alternative", "delta", "reduction",
                      "valid_area_ha", "common_covered_area_ha", "common_structural_stream_area_ha", "missing_area_ha"],
               _criterion_values(analysis))
    paths.append(path)
    path = directory / "case-candidates.csv"
    _write_csv(path, ["unit_id", "case_index", "case_name", "selected", "eligible", "rank", "score", "exclusions"],
               _case_values(analysis))
    paths.append(path)
    path = directory / "preference-profiles.csv"
    _write_csv(path, ["profile_index", "name", "weights", "eligible_count", "selected_ids", "optimization"], (
        {"profile_index": index, **item} for index, item in enumerate(analysis["stability"]["profiles"])))
    paths.append(path)
    if study.get("matched_family_support"):
        support = study["matched_family_support"]
        # The original conservation packet carries each exact TIFF at its root.
        # This sidecar records verified Workspace sources and the portable paths;
        # it does not duplicate a raster for every criterion or planning unit.
        members = []
        for pollutant, metric in support["metrics"].items():
            if metric["mask"] is not None:
                original = verify_file(workspace.root, metric["mask"])
                members.append({"pollutant": pollutant, "source": metric["mask"],
                                "packet_path": "../../" + original.name})
        path = directory / "matched-family-support.json"
        atomic_json(path, {"schema": "upstate.conservation-decision-family-support/v1",
                          "study_id": study["id"], "analysis_id": analysis["id"],
                          "support": support, "mask_members": members}, immutable=True)
        paths.append(path)
        path = directory / "matched-family-values.csv"
        _write_csv(path, [
            "scope", "unit_id", "family_id", "family_label", "pollutant", "unit", "profile_id",
            "baseline_run_id", "alternative_run_id", "comparison_availability", "comparison_availability_reason",
            "common_baseline", "common_alternative", "delta", "reduction", "common_coverage_fraction",
            "common_valid_area_ha", "common_structural_stream_area_ha", "common_covered_area_ha",
            "selected_area_ha", "missing_area_ha", "support_id", "support_sha256",
        ], _family_values(study, plan, candidate_data))
        paths.append(path)
    readme = directory / "README.md"
    atomic_bytes(readme, _readme(analysis, plan).encode("utf-8"))
    paths.append(readme)
    record = {
        "schema": SCHEMA, "identity": identity, "layers": {
            "decision_units": "Complete original planning-unit polygons",
            "decision_reporting": "Original reporting-area footprints; null geometry retains an original empty footprint",
        },
        "join": {"field": "unit_id", "original": "../../candidates.json candidates[].id",
                 "analysis": "../analysis.json candidates[].feature_id",
                 "fiona_feature_id": "GeoPackage row identifier only; never use it as the source join"},
        "fields": FIELDS, "candidate_count": len(rows), "selected_count": len(plan["selected_ids"]),
        "preference_comparison_enabled": analysis["stability"]["enabled"],
        "scenario_comparison_enabled": (analysis.get("scenario_stability") or {}).get("enabled", False),
        "saved_union_summary": deepcopy(plan["summary"]),
        "score_meaning": "Retained weighted decision priority, not pollutant mass, probability or recomputed union benefit",
        "geometry_method": "Original WKB in original projected metre CRS; no reprojection or simplification",
        "files": [describe_file(directory, path) for path in paths],
    }
    atomic_json(index, record, immutable=True)
    return {**record, "files": record["files"] + [describe_file(directory, index)]}

def _readme(analysis, plan):
    return """# Editable decision geography

Open decision-geography.gpkg in your GIS. Both layers contain every original
candidate, joined by unit_id. decision_units preserves the whole original unit;
decision_reporting preserves its original reporting footprint. GeoPackage's
internal feature ID is not the original planning-unit identifier.

decision_score, decision_rank, selected and eligible are the retained selected
decision. A null score/rank is unavailable or excluded; zero is an actual value.
Exclusion and source-identity JSON fields retain their exact original meaning.
Original source attributes and original study scores remain in the unchanged
geodata.gpkg at the packet root and the complete original candidate register.

Preference/case fields are null when that comparison was disabled. Counts refer
only to the explicitly retained profiles or native cases, including the selected
one. They are not probabilities. Eligibility and rank may change when coverage
differs. Native cases and named preference profiles are separate comparisons.

Join criterion-values.csv and case-candidates.csv to unit_id; filter case_index
and criterion_id before a one-to-one join. criteria.csv explains selected weights,
directions, scales and original case IDs. preference-profiles.csv retains each
actual profile's full weights, selected IDs and solver result. Dynamic criterion
names are values in these tables, never unstable GIS column names.

For matched families, matched-family-values.csv contains every retained pair and
pollutant for each original unit, plus separately identified selected_union rows.
Baseline and treatment share the same original profile within each family.
Each pollutant uses its own all-declared-family common mask; do not equate the
N, P and sediment footprints. matched-family-support.json retains the full native
roster and verified mask file hashes. mask_members.packet_path is relative to this
directory and locates the original TIFF in the complete decision ZIP. Mask code 1
is common finite-rate support, code 2 is common structural stream omission and
code 0 is excluded. Structural-only support has unavailable mass, never zero.
The export compares named hypotheses, not confidence bounds or joint probabilities.

CSV keeps exact string IDs for GIS joins; import ID columns as text. Treat source
strings as data, not spreadsheet formulas. Full lossless analysis is ../analysis.json.
analysis_source_ref is a JSON Pointer into that same analysis. Numerical criterion
values retain separate original units; decision scores do not combine their units.

The saved plan's authoritative union totals remain in decision-geography.json.
Do not sum overlapping unit polygons or scores to recreate union mass/area. Editing
these outgoing GIS copies does not silently revise the saved plan: make an explicit
new source/decision in the original application and retain its own analysis.

This export was reopened by Fiona and checked against all original unit IDs,
decision fields and retained vertices before its manifest was written.
""" + "\nAnalysis: " + analysis["id"] + "\nSaved plan: " + plan["id"] + "\n"

def capture_scenario_stability(workspace, study, plan, geometry_data, candidate_data):
    """Original two-role map inputs: any-case versus every-case selected land."""
    if not isinstance(plan["selection"].get("optimization"), dict):
        return None
    from .conservation_optimization import get_analysis
    retained = get_analysis(workspace, study["id"], plan["selection"]["optimization"]["analysis_id"])
    analysis = retained["analysis"]
    if retained["state"]["files"] != plan["selection"]["optimization"]["files"]:
        raise ValueError("Stability map analysis files differ from the original plan")
    comparison = analysis.get("scenario_stability") or {}
    if not comparison.get("enabled") or len(comparison.get("cases", [])) < 2:
        return None
    crs, source, rows = _binding(workspace, study, plan, analysis, candidate_data, geometry_data)
    from shapely.ops import unary_union
    from shapely.geometry import mapping
    cases = comparison["cases"]
    signatures = [(tuple(sorted(case["scenario_run_ids"].items())),
                   tuple(sorted(case.get("family_ids", {}).items()))) for case in cases]
    if len(set(signatures)) != len(signatures):
        raise ValueError("Stability map requires distinct retained native cases")
    sets = []
    for case in cases:
        selected = case["selected_ids"]
        if len(set(selected)) != len(selected) or not set(selected).issubset(rows):
            raise ValueError("Stability map case has different original unit identities")
        sets.append(set(selected))
    any_ids, every_ids = set.union(*sets), set.intersection(*sets)
    def union(keys):
        value = unary_union([_geometry(geometry_data, key, "reporting", rows[key]["reporting_area_ha"])
                             for key in sorted(keys)])
        return {"geometry": None if value.is_empty else mapping(value), "area_ha": value.area / 10000}
    return {
        "analysis_id": analysis["id"], "analysis_file": deepcopy(retained["state"]["files"]["analysis"]),
        "case_count": len(cases), "cases": [{"name": case["name"],
             "scenario_run_ids": deepcopy(case["scenario_run_ids"]),
             **({"family_ids": deepcopy(case["family_ids"])} if "family_ids" in case else {}),
             "selected_ids": list(case["selected_ids"])} for case in cases],
        "any_selected_ids": sorted(any_ids), "every_selected_ids": sorted(every_ids),
        "any_selected": union(any_ids), "every_selected": union(every_ids),
        "meaning": "Union of reporting footprints of units selected in any/every declared native case; not pixelwise intersection or probability",
    }
