"""Portable explanations for retained conservation measurements and practice scores.

This module reads completed candidate results. It does not re-run a score, native
model, portfolio solver or source acquisition. New presentation editions remain
separate from the original completed study and plan.
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file, digest, verify_file
from .source_lineage import presentation_state, supplier_rows, supplier_tables, write_supplier_files

VERSION = 3
SCHEMA = "upstate.conservation-presentation/v1"
ACRES_PER_HECTARE = 10000 / 4046.8564224
AREA_METRICS = ("parcel_acres", "hydric_soil_acres", "sensitive_riparian_acres")
AREA_BASIS = {
    "whole_original_parcel": "Full original parcel geometry",
    "reporting_parcel": "Original parcel intersected with the retained reporting boundary",
}
METRIC_MEANINGS = {
    "already_protected": "Parcel is already protected under the selected original protected-land inventory.",
    "cwa_priority": "Low, medium or high parcel-mean critical-watershed-area priority from the selected CWA raster and retained classification.",
    "headwater_stream": "A stream of the selected order is present; retain actual stream orders for the [1] variant.",
    "stream_orw_or_tn": "The parcel's selected classified water is ORW or TN.",
    "stream_tpgt": "The parcel's selected water is the trout-grow/put/take designation; preserve the original TPGT field and the printed TGPT spelling.",
    "stream_fw_without_listed_impairment": "Freshwater classification with no impairment in the selected complete impairment inventory and relation.",
    "stream_fw_with_listed_impairment": "Freshwater classification associated with an impairment in the selected inventory and relation.",
    "sensitive_riparian_acres": "Acres of the actual sensitive riparian union intersecting the declared parcel scoring geometry.",
    "sensitive_riparian_present": "Positive intersection with that same sensitive riparian union.",
    "forested_sensitive_riparian_present": "Selected forest cover is present within the sensitive riparian intersection.",
    "wetland_forested_shrub_emergent_or_riverine": "The selected original wetland inventory contains a forested, shrub, emergent or riverine wetland in the parcel.",
    "wetland_pond_or_lake": "The selected original wetland inventory contains a pond or lake wetland in the parcel.",
    "hydric_soil_acres": "Acres of the selected hydric-soil geometry intersecting the declared parcel scoring geometry.",
    "floodplain_without_development": "The parcel intersects the selected floodplain and has no developed land under the explicit selected complete land-cover basis.",
    "floodplain_with_development": "The parcel intersects the selected floodplain and has developed land under the explicit selected land-cover basis.",
    "floodplain_present": "A selected published floodplain has a positive parcel intersection.",
    "source_water_protection_area_present": "An actual published source-water protection polygon intersects the parcel.",
    "stream_length_above_study_mean": "In-parcel stream length exceeds the actual selected study mean among parcels with positive stream length.",
    "adjacent_to_protected_land": "The parcel meets the selected explicit adjacency relation to the original protected-land footprint.",
    "parcel_acres": "Full original parcel area in acres; automatically derived from area_ha unless explicitly supplied.",
    "agricultural_cover_at_least_half": "At least half the original parcel is agriculture under the selected original land-cover classification; an explicit reporting-footprint adaptation is retained in the table.",
    "agriculture_adjacent_to_water": "Actual agricultural land on the parcel meets the selected stream or impoundment adjacency relation.",
    "nitrogen_export_priority": "Current parcel-mean nitrogen export class with explicit units and retained thresholds.",
    "phosphorus_export_priority": "Current parcel-mean phosphorus export class with explicit units and retained thresholds.",
    "sediment_export_priority": "Current parcel-mean sediment export class with explicit units and retained thresholds.",
    "associated_with_selected_impairment": "Parcel association with the selected impairment inventory, pollutant scope and spatial/upstream relation.",
    "agricultural_unpermitted_source": "A selected original record identifies an unpermitted agricultural source on the parcel.",
    "agricultural_permitted_source": "A selected original record identifies a permitted agricultural source on the parcel.",
    "modified_wetland_present": "Original source identifies a modified wetland on the parcel.",
    "historic_wetland_present": "Original source identifies a historic wetland on the parcel.",
    "dam_present": "A dam in the selected original inventory is spatially associated with the parcel.",
    "adjacent_to_drinking_water": "The parcel meets the selected explicit adjacency relation to a drinking-water reservoir or intake water.",
    "adjacent_to_other_water": "The parcel meets the selected explicit adjacency relation to another stream or impoundment.",
    "private_boat_ramp_present": "Original source identifies a private boat ramp on the parcel.",
    "private_dock_present": "Original source identifies a private dock on the parcel.",
    "developed_land_present": "Selected original land cover identifies developed land on the parcel.",
    "known_logging_operation": "Original activity data identify a logging operation on the parcel.",
    "stormwater_unpermitted_source": "Original selected records identify an unpermitted stormwater source on the parcel.",
    "stormwater_permitted_source": "Original selected records identify a permitted stormwater source on the parcel.",
    "pet_traffic_business_present": "Original business/use records identify a pet-related commercial use on the parcel.",
    "public_access_land": "Original public-access records identify public park or access land on the parcel."
}
POINT_FIELDS = {
    "whole_parcel_acres": "float", "reporting_parcel_acres": "float",
    "point_method": "str", "point_category": "str", "point_status": "str",
    "point_prerequisite": "str", "point_exact": "int", "point_lower": "int",
    "point_upper": "int", "point_maximum": "int",
    "point_interval_resolved_criteria": "int",
    "point_score_options": "str", "point_priority_options": "str",
    "point_source_profile": "str", "point_classification_states": "str",
}
for _metric in AREA_METRICS:
    POINT_FIELDS.update({
        _metric: "float", _metric + "_lower": "float", _metric + "_upper": "float",
        _metric + "_closed": "int", _metric + "_basis": "str",
        _metric + "_structural_only": "int",
    })

METRIC_FIELDS = [
    "id", "label", "selected", "metric", "value", "unit", "value_state",
    "lower", "upper", "closed", "area_basis", "analysis_area_acres",
    "observed_positive_acres", "unresolved_acres", "confirmed_absence_acres",
    "coverage_complete", "structural_only", "interval_method", "interval_reference",
    "binding_kind", "binding_field", "source_binding", "metric_geometry", "criterion_references",
    "raw_value", "raw_unit", "source_classifications", "source_profile",
    "native_pixel_area_m2", "original_profile_pixel_area_m2", "profile_transfer",
]
CONTRIBUTION_FIELDS = [
    "id", "label", "selected", "criterion", "rule_type", "point_exact",
    "point_lower", "point_upper", "evaluation", "interval_resolved",
    "source_uri", "printed_page", "table", "reference", "terms",
    "score_options", "source_classifications", "source_profile",
]


def identity():
    return {"schema": SCHEMA, "version": VERSION,
            "implementation_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "conservation_implementation_sha256": hashlib.sha256(Path(__file__).with_name("conservation.py").read_bytes()).hexdigest(),
            "source_lineage_implementation_sha256": hashlib.sha256(Path(__file__).with_name("source_lineage.py").read_bytes()).hexdigest()}


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"))


def _e(value):
    return html.escape(str(value), quote=True)


def _text(value):
    if value is None:
        return "Unresolved"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        return repr(value) if math.isfinite(value) else "Unresolved"
    if isinstance(value, (dict, list)):
        return _json(value)
    return str(value)


def _display(value):
    return _e(_text(value))


def _url(uri, title=None):
    if not isinstance(uri, str):
        return _display(title or uri)
    if uri.startswith(("https://", "http://")):
        return '<a href="' + _e(uri) + '">' + _e(title or uri) + "</a>"
    return _e(title or uri)


def _table(headers, rows):
    return '<div class="scroll"><table><thead><tr>' + "".join(
        "<th>" + _e(value) + "</th>" for value in headers
    ) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join("<td>" + _display(value) + "</td>" for value in row) + "</tr>"
        for row in rows
    ) + "</tbody></table></div>"


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = _json(value)
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _csv(path, fields, rows):
    # The source candidate list is already held by the maintained study builder.
    # Stream long-form records to avoid a second full parcel-by-criterion list.
    import os
    import tempfile
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", newline="", encoding="utf-8",
                dir=path.parent, prefix="." + path.name + "-", delete=False) as stream:
            temporary = Path(stream.name)
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows({key: _csv_value(row.get(key)) for key in fields} for row in rows)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _point_state(point):
    if not point:
        return "not_a_published_point_method"
    prerequisite = point.get("prerequisite")
    if prerequisite is False:
        return "prerequisite_absent"
    if prerequisite is not True:
        return "prerequisite_unresolved"
    return "exact" if point.get("points") is not None else "range"


def _leaves(component):
    children = component.get("terms")
    if children:
        for child in children:
            yield from _leaves(child)
    else:
        yield component


def _components(row):
    value = row.get("score_components") or {}
    return list(value.values()) if isinstance(value, dict) else value


def _interval_resolved(row):
    return sum(bool(item.get("points_determined_by_interval"))
               for component in _components(row) for item in _leaves(component))


def _classifications(component):
    """Retained literal classifications, including nested combined criteria."""
    for leaf in _leaves(component):
        value = leaf.get("classification")
        if isinstance(value, dict):
            yield {**value, "criterion": leaf["id"], "metric": leaf.get("metric")}


def _classification_states(row):
    return sorted({
        state
        for component in _components(row)
        for item in _classifications(component)
        for state in item.get("attainable_states", [item.get("state")])
        if state is not None
    })


def _retained_json(value):
    return _json(value) if value is not None else None


def flat_values(row, *, priority_ranges=None):
    point = row.get("point_score") or {}
    values = {
        "whole_parcel_acres": row["area_ha"] * ACRES_PER_HECTARE,
        "reporting_parcel_acres": row["reporting_area_ha"] * ACRES_PER_HECTARE,
        "point_method": point.get("method_id"), "point_category": point.get("category_id"),
        "point_status": _point_state(point),
        "point_prerequisite": (
            "met" if point.get("prerequisite") is True else
            "absent" if point.get("prerequisite") is False else
            "unresolved" if point else None),
        "point_exact": point.get("points"), "point_lower": point.get("known_points"),
        "point_upper": point.get("possible_points"), "point_maximum": point.get("maximum"),
        "point_interval_resolved_criteria": _interval_resolved(row) if point else None,
        "point_score_options": _retained_json(point.get("score_options")),
        "point_priority_options": _retained_json(point.get("priority_options")),
        "point_source_profile": _retained_json(point.get("source_profile")),
        "point_classification_states": _retained_json(_classification_states(row)) if point else None,
    }
    for name in AREA_METRICS:
        bound = point.get("metric_bounds", {}).get(name, {})
        value = point.get("metric_values", {}).get(name)
        values.update({
            name: value, name + "_lower": bound.get("lower"),
            name + "_upper": bound.get("upper"),
            name + "_closed": int(bound["closed"]) if "closed" in bound else None,
            name + "_basis": bound.get("area_basis"),
            name + "_structural_only": int(bound["structural_only"]) if "structural_only" in bound else None,
        })
        if name == "parcel_acres" and not bound and point.get("metric_sources", {}).get(name, {}).get("kind") == "derived":
            values[name + "_basis"] = "whole_original_parcel"
    return values


def csv_fields():
    return list(POINT_FIELDS)


def gis_fields():
    return dict(POINT_FIELDS)


def _category(state):
    return state.get("selection", {}).get("bindings", {}).get("published_method", {}).get("category", {})


def _rule_index(state):
    result = {}
    def visit(rule):
        if rule.get("metric"):
            result.setdefault(rule["metric"], []).append(rule.get("reference", {}))
            result[rule["metric"]].extend(rule.get("source_profile_references", []))
        for term in rule.get("terms", []):
            visit(term)
    for rule in _category(state).get("criteria", []):
        visit(rule)
    return result


def _selected(plan, key):
    return None if plan is None else key in plan["selected_ids"]


def metric_records(state, candidates, plan=None):
    references = _rule_index(state)
    metadata = state.get("normalization", {}).get("criterion_table", {}).get("metadata", {})
    geometry = metadata.get("metric_geometry", {})
    chosen = set(plan["selected_ids"]) if plan else None
    for row in candidates:
        point = row.get("point_score")
        if not point:
            continue
        classifications = {}
        for component in _components(row):
            for classified in _classifications(component):
                classifications.setdefault(classified["metric"], []).append(classified)
        for name, value in sorted(point.get("metric_values", {}).items()):
            limits = point.get("metric_bounds", {}).get(name, {})
            binding = point.get("metric_sources", {}).get(name, {})
            interval = bool(limits)
            selected_geometry = {}
            kind = binding.get("kind")
            if kind == "table" or kind in ("study_mean", "stream_order") and binding.get("input") == "table":
                selected_geometry = geometry.get(binding.get("field", name), {})
            elif kind == "native_export":
                selected_geometry = {"area_basis": "reporting_parcel",
                    "meaning": "Actual retained native model support within the reporting parcel."}
            elif kind in ("derived", "candidate"):
                field = binding.get("field")
                if field == "area_ha":
                    selected_geometry = {"area_basis": "whole_original_parcel"}
                elif field in ("reporting_area_ha", "protected_fraction", "protected_area_ha",
                               "source_water_fraction", "source_water_area_ha", "high_quality_context",
                               "high_quality_overlap_area_ha", "high_quality_contact_length_m"):
                    selected_geometry = {"area_basis": "reporting_parcel",
                        "meaning": "Retained candidate quantity on the study's reporting footprint."}
            yield {
                "id": row["id"], "label": row["label"],
                "selected": row["id"] in chosen if chosen is not None else None,
                "metric": name, "value": value,
                "unit": limits.get("unit") or ("acres" if name.endswith("_acres") else
                    "class" if name.endswith("_priority") else "boolean" if isinstance(value, bool) else None),
                "value_state": ("source_profile_classification" if isinstance(value, dict) and
                    value.get("schema") == "upstate.keowee-classification/v1" else
                    "exact" if value is not None else "closed_interval" if interval else "unresolved"),
                "lower": limits.get("lower"), "upper": limits.get("upper"),
                "closed": limits.get("closed"),
                "area_basis": limits.get("area_basis") or (
                    "whole_original_parcel" if name == "parcel_acres" and binding.get("kind") == "derived"
                    else selected_geometry.get("area_basis")),
                "analysis_area_acres": limits.get("analysis_area_acres"),
                "observed_positive_acres": limits.get("observed_positive_acres"),
                "unresolved_acres": limits.get("unresolved_acres"),
                "confirmed_absence_acres": limits.get("confirmed_absence_acres"),
                "coverage_complete": limits.get("coverage_complete"),
                "structural_only": limits.get("structural_only"),
                "interval_method": limits.get("method"), "interval_reference": limits.get("reference"),
                "binding_kind": binding.get("kind"), "binding_field": binding.get("field"),
                "source_binding": binding, "metric_geometry": selected_geometry,
                "criterion_references": references.get(name, []),
                "raw_value": binding.get("raw"), "raw_unit": binding.get("unit"),
                "source_classifications": classifications.get(name, []),
                "source_profile": point.get("source_profile"),
                "native_pixel_area_m2": binding.get("pixel_area_m2"),
                "original_profile_pixel_area_m2": binding.get("original_profile_pixel_area_m2"),
                "profile_transfer": binding.get("profile_transfer"),
            }


def contribution_records(state, candidates, plan=None):
    rules = {rule["id"]: rule for rule in _category(state).get("criteria", [])}
    chosen = set(plan["selected_ids"]) if plan else None
    for row in candidates:
        if not row.get("point_score"):
            continue
        for component in _components(row):
            reference = component.get("reference") or {}
            yield {
                "id": row["id"], "label": row["label"],
                "selected": row["id"] in chosen if chosen is not None else None,
                "criterion": component["id"],
                "rule_type": rules.get(component["id"], {}).get("type"),
                "point_exact": component.get("points"),
                "point_lower": component.get("known_points"),
                "point_upper": component.get("possible_points"),
                "evaluation": component.get("evaluation") or "combined_terms",
                "interval_resolved": any(bool(item.get("points_determined_by_interval"))
                                         for item in _leaves(component)),
                "source_uri": reference.get("source_uri") if isinstance(reference, dict) else None,
                "printed_page": reference.get("printed_page") if isinstance(reference, dict) else None,
                "table": reference.get("table") if isinstance(reference, dict) else None,
                "reference": reference,
                "terms": component.get("terms"),
                "score_options": component.get("score_options"),
                "source_classifications": list(_classifications(component)),
                "source_profile": row["point_score"].get("source_profile"),
            }


def source_register(state):
    records = []
    def visit(value, path):
        if isinstance(value, dict):
            if value.get("uri") is not None and isinstance(value.get("body"), dict) and value["body"].get("sha256"):
                choice = value.get("selection", {})
                records.append({
                    "role": path, "id": value.get("id"), "title": value.get("title"),
                    "uri": value["uri"], "vintage": value.get("vintage"),
                    "source_collection_id": choice.get("source_collection_id"),
                    "source_id": choice.get("source_id") or value.get("id"),
                    "layer": choice.get("layer") or value.get("layer"),
                    "reference": choice.get("reference") or value.get("reference"),
                    "meaning": choice.get("meaning") or value.get("meaning"),
                    "relation": choice.get("relation") or value.get("relation"),
                    "selection": choice, "body": value["body"], "scope": value.get("scope"),
                    "metadata": value.get("metadata"), "companions": value.get("companions", []),
                })
                # Coverage geometry is a distinct selected original source.
                if value.get("coverage_source"):
                    visit(value["coverage_source"], path + ".coverage_source")
                return
            for key, child in value.items():
                visit(child, path + "." + str(key) if path else str(key))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, path + "[" + str(index) + "]")
    bindings = state["selection"]["bindings"]
    visit(bindings.get("sources", {}), "study")
    visit(bindings.get("published_method", {}).get("criteria_source"), "criterion_table")
    metadata = state.get("normalization", {}).get("criterion_table", {}).get("metadata", {})
    visit(metadata.get("source_bindings", {}), "criterion_inputs")
    return records


def native_execution_register(state):
    """Present supplied execution records without reopening or resolving a run."""
    if isinstance(state.get("native_execution"), dict):
        return state["native_execution"]
    return {key: bound["execution"]
            for key, bound in state["selection"]["bindings"].get("runs", {}).items()
            if isinstance(bound.get("execution"), dict)}


def _native_execution_section(state):
    executions = native_execution_register(state)
    if not executions:
        return ""
    spec = state["selection"]["spec"]
    basis_labels = {
        "completed_stage_runtime": "Completed model stage",
        "observed_run_fallback": "Last observed run runtime (fallback)",
        "requested_legacy": "Requested version (legacy fallback)",
        "unavailable": "Unavailable",
    }
    rows, adapters = [], []
    for run_id, execution in executions.items():
        role = "Baseline" if run_id == spec.get("baseline_run_id") else (
            "Alternative" if run_id in spec.get("alternative_run_ids", []) else "Selected native run")
        adapters.append([role, run_id, execution.get("unit_contract_version"),
                         execution.get("supported")])
        for model, record in execution.get("model_versions", {}).items():
            basis = record.get("basis")
            rows.append([role, run_id, model.upper(), record.get("comparison_version"),
                         basis_labels.get(basis, basis), record.get("requested_version"),
                         record.get("observed_run_version"), record.get("stage_completed_at")])
    return (
        "<h2>Native model execution</h2><p>Each row identifies the version associated with an "
        "original selected model. A completed stage's observed runtime takes precedence over "
        "the latest run-level runtime. A resumed run can therefore retain different execution "
        "versions for NDR and SDR. When stage provenance is absent, the recorded fallback is "
        "shown explicitly; a requested legacy version is a declaration rather than an observed "
        "execution.</p>" +
        _table(["Case", "Original run ID", "Model", "Resolved execution version", "Provenance basis",
                "Requested version", "Last observed run version", "Stage completed at"], rows) +
        "<p>The quantity adapter uses the retained output-unit contract below. Its compatibility "
        "result applies to the selected model versions. N, P and sediment keep their separate "
        "physical units and coverage in the scientific results.</p>" +
        _table(["Case", "Original run ID", "Quantity adapter version", "Selected models compatible"], adapters) +
        "<details><summary>Original execution, stage reuse and runtime history</summary><pre>" +
        _e(json.dumps(executions, indent=2, ensure_ascii=False, allow_nan=False)) +
        "</pre></details><p>The <a href=\"source-register.json\">complete source register</a> "
        "retains these typed execution records with the original native selections and source "
        "identities.</p>"
    )


def _source_rows(state):
    for source in source_register(state):
        yield {
            "role": source["role"], "id": source["id"], "title": source["title"],
            "uri": source["uri"], "vintage": source["vintage"],
            "source_collection_id": source["source_collection_id"],
            "source_id": source["source_id"], "layer": source["layer"],
            "body_sha256": source["body"]["sha256"], "body_bytes": source["body"].get("bytes"),
            "reference": source["reference"], "meaning": source["meaning"],
            "relation": source["relation"], "selection": source["selection"],
        }


def dictionary():
    return {
        "schema": "upstate.conservation-report-dictionary/v1",
        "presentation": identity(),
        "metric_meanings": METRIC_MEANINGS,
        "native_execution": {
            "model_versions": "Per selected original run/model execution metadata, supplied by study bindings or the maintained native read-through.",
            "comparison_version": "Completed-stage runtime first, otherwise observed-run runtime, otherwise explicitly labeled requested legacy version.",
            "basis": "The actual provenance source used for that model; stage completion and reuse remain in the same original record.",
            "unit_contract_version": "Version of the quantity adapter's physical output-unit contract, kept separate from the original requested run selection.",
            "runtime_history": "Original retained sequence of runtime observations; it does not override completed-model provenance.",
        },
        "areas": {
            "whole_parcel_acres": "Full original selected parcel geometry: area_ha * 10000 / 4046.8564224.",
            "reporting_parcel_acres": "Original parcel intersected with the retained reporting boundary, in acres.",
            "parcel_acres": "Selected parcel-size criterion. Its source/binding is retained; the automatic value uses full original parcel area.",
            "hydric_soil_acres": "Selected hydric footprint intersected with the declared source-criterion geometry under the retained source interpretation.",
            "sensitive_riparian_acres": "Selected sensitive-riparian union intersected with the declared source-criterion geometry.",
            "area_basis": "Each interval declares its actual geometry. Imported external criteria retain their explicit source meaning.",
        },
        "points": {
            "point_exact": "Published total only when every contribution is determined and the practice prerequisite is met.",
            "point_lower": "Sum of the minimum retained criterion contributions; conditional on the practice prerequisite.",
            "point_upper": "Sum of the maximum retained criterion contributions; conditional on the practice prerequisite.",
            "point_status": "exact, range, prerequisite_absent, prerequisite_unresolved, or not_a_published_point_method.",
            "point_prerequisite": "The method's practice prerequisite: met, absent or unresolved. Separate from other eligibility rules.",
            "point_interval_resolved_criteria": "Leaf criteria whose exact contribution is established despite an unresolved exact acreage.",
            "criterion_contributions": "One top-level contribution per published criterion. Nested maximum/sum terms stay inside that row and are never added again.",
            "point_score_options": "JSON array of the actual retained attainable totals; numbers between the lower and upper bounds need not be attainable.",
            "point_priority_options": "Retained attainable published priority labels, conditional on the practice prerequisite.",
            "point_source_profile": "JSON identity of the original source profile and executable binding used by this saved score.",
            "point_classification_states": "Literal classification states found across criteria: scored, ambiguous, unclassified or missing; bounded inputs retain every attainable state.",
            "score_options": "Exact retained contribution alternatives; a source overlap keeps every matching class and a source gap keeps the original unresolved alternatives.",
            "source_classifications": "Original scalar or bounded classification, matching and possible classes, references, source-profile identity and score options. Bound-evaluation probes are not observed measurements.",
        },
        "intervals": {
            "closed": "Both endpoints are included. A threshold exactly at the upper endpoint remains possible.",
            "lower": "Positively mapped acreage in the selected analysis geometry, or zero for an explicitly geometry-only bound.",
            "upper": "Lower acreage plus geometry outside the positive footprint and actual certainty coverage, capped at the analysis area.",
            "observed_positive_acres": "Null for a geometry-only bound; zero is an actual evaluated zero.",
            "structural_only": "The original parcel geometry alone supplies the area limit because a required footprint is absent.",
            "certainty": "Returned-positive coverage, original query masks and certainty coverage have distinct meanings. Mixed or unknown soil units remain unresolved under the fully-hydric interpretation.",
            "exact_points": "A closed acreage interval may occupy one published point band. This resolves points while the exact acreage stays null.",
        },
        "native_quantities": {
            "nitrogen_export": "kg/year", "phosphorus_export": "kg/year",
            "sediment_export": "metric_tonnes/year",
            "basis": "Selected native rates multiplied by actual polygon-cell intersection hectares.",
            "comparisons": "Alternative minus baseline on common original native support. Omitted model families remain unavailable.",
            "portfolio": "Native quantities and context overlap use the selected reporting-geometry union; overlapping parcels are counted once.",
            "native_pixel_area_m2": "Actual retained current raster cell area used to convert the parcel mean area rate into mean cell mass.",
            "original_profile_pixel_area_m2": "Original published raster cell area only if established by the saved source; null means it was not established.",
            "profile_transfer": "Explicit current-grid interpretation for using original printed export bins: actual cell area, native/profile units, adaptation reference and sediment ton definition.",
            "raw_value": "Actual retained input to the declared classification or transform; separate from the class label and annual parcel mass.",
        },
        "files": {
            "criterion-contributions.csv": "All published top-level criterion contributions, selected flag and original rule references.",
            "criterion-values.csv": "All source metric values, closed limits, geometry basis and retained field binding.",
            "criterion-scores.json": "Original point_score and score_components for every candidate, preserving typed null/boolean/numeric values.",
            "source-register.json": "Complete source selections and their original byte identities, including underlying criterion input and coverage sources.",
            "source-register.csv": "Flat source identity/reference register.",
            "original-criteria": "Exact original selected JSON/CSV table bytes, using the recorded source format and compression.",
            "geodata.gpkg": "Original planning_units, reporting_footprints, and selected_union for a saved portfolio.",
        },
        "csv": "Formula-like text is escaped for spreadsheet viewing. Typed original data remain in JSON and GeoPackage.",
    }


def _copy_criterion_source(workspace, directory, state):
    source = state["selection"]["bindings"].get("published_method", {}).get("criteria_source")
    if not source:
        return None
    choice = source["selection"]
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    raw = path.read_bytes()
    original_hash = source["body"]["sha256"]
    if hashlib.sha256(raw).hexdigest() != original_hash or entry["body"]["sha256"] != original_hash:
        raise ValueError("The original criterion table changed before report export")
    extension = ".csv" if choice.get("format") == "csv" else ".json"
    if raw[:2] == b"\x1f\x8b":
        extension += ".gz"
    target = Path(directory) / ("original-criteria" + extension)
    atomic_bytes(target, raw)
    return describe_file(workspace.root, target, source_sha256=original_hash,
                         source_collection_id=choice["source_collection_id"], source_id=choice["source_id"])


def write_supplements(workspace, directory, state, candidates, *, plan=None):
    directory = Path(directory)
    files = {}
    state = presentation_state(workspace, state)
    sources = state["selection"]["bindings"]["sources"]
    if supplier_rows(sources):
        files.update(write_supplier_files(directory, sources, relative_to=workspace.root))
    records = source_register(state)
    document = {
        "schema": "upstate.conservation-source-register/v1", "study_id": state["id"],
        "plan_id": plan["id"] if plan else None, "presentation": identity(),
        "sources": records, "native_bindings": state["selection"]["bindings"].get("runs"),
        "native_grid": state["selection"]["bindings"].get("grid"),
        "native_execution": native_execution_register(state),
        "geometry_context": state["selection"]["bindings"].get("published_method", {}).get("geometry_context"),
        "criterion_metadata": state.get("normalization", {}).get("criterion_table", {}).get("metadata"),
        "published_method": state["selection"]["bindings"].get("published_method"),
        "source_profile": state.get("normalization", {}).get("source_profile"),
        "resolved_native_bands": state.get("normalization", {}).get("resolved_native_bands"),
        "native_pixel_area_m2": state.get("normalization", {}).get("native_pixel_area_m2"),
    }
    atomic_json(directory / "source-register.json", document)
    source_fields = ["role", "id", "title", "uri", "vintage", "source_collection_id", "source_id",
                     "layer", "body_sha256", "body_bytes", "reference", "meaning", "relation", "selection"]
    _csv(directory / "source-register.csv", source_fields, _source_rows(state))
    atomic_json(directory / "report-data-dictionary.json", dictionary())
    for role, name in (("source_register", "source-register.json"), ("source_register_csv", "source-register.csv"),
                       ("report_dictionary", "report-data-dictionary.json")):
        files[role] = describe_file(workspace.root, directory / name)
    if any(row.get("point_score") for row in candidates):
        _csv(directory / "criterion-contributions.csv", CONTRIBUTION_FIELDS,
             contribution_records(state, candidates, plan))
        _csv(directory / "criterion-values.csv", METRIC_FIELDS, metric_records(state, candidates, plan))
        chosen = set(plan["selected_ids"]) if plan else None
        atomic_json(directory / "criterion-scores.json", {
            "schema": "upstate.conservation-point-report/v1", "study_id": state["id"],
            "plan_id": plan["id"] if plan else None, "presentation": identity(),
            "normalization": state["normalization"],
            "candidates": [{
                "id": row["id"], "label": row["label"],
                "selected": row["id"] in chosen if chosen is not None else None,
                "eligible": row["eligible"], "exclusion_reasons": row["exclusion_reasons"],
                "area_ha": row["area_ha"], "reporting_area_ha": row["reporting_area_ha"],
                "point_score": row.get("point_score"), "score_components": row.get("score_components"),
            } for row in candidates],
        })
        for role, name in (("criterion_contributions", "criterion-contributions.csv"),
                           ("criterion_values", "criterion-values.csv"), ("criterion_scores", "criterion-scores.json")):
            files[role] = describe_file(workspace.root, directory / name)
        original = _copy_criterion_source(workspace, directory, state)
        if original:
            files["original_criteria"] = original
            document["portable_criterion_table"] = {
                "filename": Path(original["path"]).name, "bytes": original["bytes"],
                "sha256": original["sha256"], "source_id": original["source_id"],
                "source_collection_id": original["source_collection_id"],
            }
            atomic_json(directory / "source-register.json", document)
            files["source_register"] = describe_file(workspace.root, directory / "source-register.json")
    return files


def _reference_text(value):
    if isinstance(value, dict):
        parts = [str(value.get("edition", ""))]
        if value.get("printed_page") is not None:
            parts.append("printed page " + str(value["printed_page"]))
        if value.get("table") is not None:
            parts.append("table " + str(value["table"]))
        return "; ".join(part for part in parts if part) or value.get("source_uri", "")
    return _text(value)


def _decision(plan):
    if not plan:
        return ("<p>This study retains the candidate inventory and scoring rules. "
                "Its report covers the selected study geometry; a saved portfolio records a parcel decision.</p>")
    choice = plan["selection"]
    optimization = choice.get("optimization")
    if optimization:
        return ("<p><strong>Saved reviewed optimizer decision.</strong> This portfolio preserves the original "
                "selected parcel IDs from optimization analysis <code>" + _e(optimization.get("analysis_id")) +
                "</code>. The saved union, limits and costs are evaluated by the maintained portfolio builder.</p>"
                "<details><summary>Original objective and solver result</summary><pre>" +
                _e(json.dumps({key: optimization.get(key) for key in (
                    "analysis_id", "engine", "request", "normalization", "solver_result", "objective_scope", "geometry"
                )}, indent=2, ensure_ascii=False)) + "</pre></details>")
    if choice.get("mode") == "manual":
        return ("<p><strong>Explicit saved parcel selection.</strong> The selected IDs are retained in the supplied "
                "order. The saved portfolio enforces its original eligibility choice and area, cost and count limits.</p>")
    return ("<p><strong>Ranked portfolio.</strong> The saved objective <code>" + _e(choice.get("objective")) +
            "</code> determines the deterministic greedy order. Actual union area, full-unit cost and count "
            "limits are checked as parcels are added.</p>")


def _prerequisite_text(rule):
    if "constant" in rule:
        return "No additional published prerequisite" if rule["constant"] else "Published prerequisite is false"
    if "metric" in rule:
        return rule["metric"] + " = " + _text(rule.get("equals"))
    for operation in ("all", "any"):
        if operation in rule:
            word = " AND " if operation == "all" else " OR "
            return "(" + word.join(_prerequisite_text(item) for item in rule[operation]) + ")"
    return _text(rule)


def _point_detail(state, row):
    point = row["point_score"]
    flat = flat_values(row, priority_ranges=state.get("normalization", {}).get("priority_ranges"))
    title = row["id"] + " · " + row["label"] + " · " + flat["point_status"]
    summary = _table(
        ["Practice prerequisite", "Exact points", "Point lower", "Point upper", "Attainable point totals",
         "Published maximum", "Priority", "Possible priorities", "Eligible"],
        [[flat["point_prerequisite"], point.get("points"), point.get("known_points"),
          point.get("possible_points"), point.get("score_options"), point.get("maximum"),
          point.get("priority"), point.get("priority_options"), row["eligible"]]])
    rule_rows, classifications = [], []
    rule_definitions = {rule["id"]: rule for rule in _category(state).get("criteria", [])}
    for component in _components(row):
        rule = rule_definitions.get(component["id"], {})
        rule_rows.append([
            component["id"], rule.get("type"), component.get("points"),
            component.get("known_points"), component.get("possible_points"), component.get("score_options"),
            any(bool(item.get("points_determined_by_interval")) for item in _leaves(component)),
            _reference_text(component.get("reference")),
        ])
        classifications.extend(_classifications(component))
    metrics = list(metric_records(state, [row]))
    metric_rows = [[
        metric["metric"], METRIC_MEANINGS.get(metric["metric"]), metric["value"], metric["unit"], metric["lower"], metric["upper"],
        metric["closed"], AREA_BASIS.get(metric["area_basis"], metric["area_basis"]),
        metric["structural_only"], metric["binding_kind"], metric["binding_field"],
    ] for metric in metrics]
    details = [
        "<details><summary>" + _e(title) + "</summary>", summary,
        _table(["Criterion", "Combination", "Exact points", "Lower points", "Upper points",
                "Attainable contributions", "Resolved by acreage interval", "Published reference"], rule_rows),
        _table(["Source metric", "Meaning", "Retained value or classification", "Unit", "Lower", "Upper", "Closed", "Geometry basis",
                "Geometry-only bound", "Binding", "Original field"], metric_rows),
    ]
    if classifications:
        details += [
            "<h4>Literal published class interpretation</h4>",
            _table(["Criterion", "Metric", "State", "States across acreage interval", "Matched original classes",
                    "Possible classes", "Attainable contributions", "Original references"], (
                [item["criterion"], item["metric"], item.get("state"), item.get("attainable_states"),
                 item.get("matched_classes"), item.get("classes"), item.get("score_options"), item.get("references")]
                for item in classifications)),
        ]
    native = [metric for metric in metrics if metric["binding_kind"] == "native_export"]
    if native:
        details += [
            "<h4>Current native export classification</h4>",
            _table(["Metric", "Original input value", "Input unit", "Current cell area (m²)",
                    "Published source cell area (m²)", "Classification method", "Explicit current-grid transfer"], (
                [metric["metric"], metric["raw_value"], metric["raw_unit"], metric["native_pixel_area_m2"],
                 metric["original_profile_pixel_area_m2"], metric["source_binding"].get("band_method"),
                 metric["profile_transfer"]] for metric in native)),
            "<p>A missing published source cell area means that value was not established by the retained "
            "source. Current-study tertiles, explicit current cutoffs and an explicitly recorded transfer of "
            "the original printed bins are separate classifications. Annual parcel mass remains in its original pollutant fields.</p>",
        ]
    if point.get("source_profile"):
        details.append("<details><summary>Retained source-profile identity</summary><pre>" +
                       _e(json.dumps(point["source_profile"], ensure_ascii=False, indent=2)) + "</pre></details>")
    details.append("<p>Eligibility: " + _e("; ".join(row["exclusion_reasons"]) or "Eligible") + "</p></details>")
    return "".join(details)



def extend_report(base, state, candidates, *, plan=None):
    """Add explanations to the maintained native report without altering values."""
    chosen = set(plan["selected_ids"]) if plan else None
    shown = [row for row in candidates if chosen is None or row["id"] in chosen]
    point_rows = [row for row in shown if row.get("point_score")]
    metadata = state.get("normalization", {}).get("criterion_table", {}).get("metadata", {})
    basis = metadata.get("spatial_criteria_basis") or metadata.get("settings", {}).get("spatial_criteria_basis")
    geometry_note = ("<p><strong>Saved source criterion geometry:</strong> " +
                     _e(AREA_BASIS.get(basis, basis)) + ".</p>") if basis else (
                     "<p>Read each original metric binding and interval geometry below; the original table retains its declared source interpretation.</p>")
    sections = [
        "<h2>Parcel area and scoring geometry</h2><p><strong>Whole parcel acres</strong> uses the full original "
        "parcel geometry, including parts outside the reporting boundary. <strong>Reporting parcel acres</strong> "
        "uses its intersection with that retained boundary. Source-derived spatial criteria use the geometry "
        "saved with their original table; whole original parcel is the current default and a reporting intersection "
        "is an explicit adaptation. Each metric retains its actual basis below. Native annual quantities and selected portfolio totals use the reporting "
        "footprint and its geometric union.</p>",
        geometry_note,
        _table(["Original ID", "Unit", "Whole parcel acres", "Reporting parcel acres"], (
            [row["id"], row["label"], row["area_ha"] * ACRES_PER_HECTARE,
             row["reporting_area_ha"] * ACRES_PER_HECTARE] for row in shown[:500])),
    ]
    if len(shown) > 500:
        sections.append("<p>The area preview shows the first 500 of " + str(len(shown)) +
                        " reported units in the saved order. All units and full precision remain in candidates.csv "
                        "and the editable GeoPackage.</p>")
    if point_rows:
        normalization = state["normalization"]
        count = {name: sum(_point_state(row["point_score"]) == name for row in point_rows)
                 for name in ("exact", "range", "prerequisite_absent", "prerequisite_unresolved")}
        sections += [
            "<h2>Published practice points</h2><p>" + _e(normalization["title"]) + ": " +
            _display(normalization["maximum"]) + " possible points. " +
            _url(normalization["source_uri"], "Original published method") + ".</p>",
            _table(["Published class", "Minimum points", "Maximum points"], (
                [band["label"], band["min"], band["max"]] for band in normalization.get("priority_ranges", []))),
            "<p><strong>Practice prerequisite:</strong> " + _e(_prerequisite_text(_category(state).get("eligibility", {}))) + "</p>",
            _table(["Exact totals", "Point ranges", "Prerequisite absent", "Prerequisite unresolved"], [list(count.values())]),
            "<p>A point range retains the lowest and highest criterion totals supported by the original selected "
            "sources. Its total is conditional on the practice prerequisite. A missing prerequisite remains visible "
            "even when the numeric criterion total is determined. Other study eligibility rules are shown separately.</p>",
            "<p><strong>Attainable points are the retained discrete alternatives.</strong> A lower/upper pair does "
            "not imply that every intermediate integer is possible. Combinations across unresolved criteria "
            "remain conservative; correlations between missing observations are not inferred. "
            "Original published bin endpoints remain literal. "
            "An <strong>ambiguous</strong> value matches overlapping bins and keeps every matching class. An "
            "<strong>unclassified</strong> value falls in a printed gap or beyond the recorded bins and keeps "
            "the source profile's unresolved alternatives. <strong>Missing</strong> identifies an absent observation. "
            "A bounded acreage retains every classification state encountered across its closed interval.</p>",
            "<p>Acreage ranges have <strong>closed endpoints</strong>: both limits are included. An exact contribution "
            "can follow when every acreage inside that range falls in the same published point band. The report "
            "then retains the acreage as unresolved and displays the determined points. A geometry-only bound has "
            "no observed-positive acreage; mixed and unknown soil units retain unresolved coverage under the "
            "fully-hydric source interpretation.</p>",
            "<p><a href=\"criterion-contributions.csv\">All criterion contributions</a> · "
            "<a href=\"criterion-values.csv\">All metric values and closed ranges</a> · "
            "<a href=\"criterion-scores.json\">Typed complete point results</a></p>",
            _table(["Original ID", "Status", "Prerequisite", "Exact points", "Lower", "Upper", "Attainable totals", "Priority",
                    "Possible priorities", "Whole acres", "Reporting acres"], (
                [row["id"], _point_state(row["point_score"]),
                 flat_values(row)["point_prerequisite"], row["point_score"].get("points"),
                 row["point_score"].get("known_points"), row["point_score"].get("possible_points"),
                 row["point_score"].get("score_options"), row.get("point_priority"),
                 row["point_score"].get("priority_options"), row["area_ha"] * ACRES_PER_HECTARE,
                 row["reporting_area_ha"] * ACRES_PER_HECTARE]
                for row in point_rows[:500])),
            "<h3>Criterion and source details</h3>",
            "<p>Each top-level criterion contributes once. Its maximum or capped-sum subterms are retained in the "
            "machine-readable exports. The detailed preview follows the original saved candidate order.</p>",
        ]
        sections.extend(_point_detail(state, row) for row in point_rows[:60])
        if len(point_rows) > 60:
            sections.append("<p>The expandable preview contains the first 60 of " + str(len(point_rows)) +
                            " published-practice units. The complete criterion, metric and source records for every "
                            "unit are available in the linked CSV and JSON files.</p>")
    supplier_section = supplier_tables(state["selection"]["bindings"]["sources"], registry="source-register.json")
    if supplier_section:
        sections.append(supplier_section)
    native_section = _native_execution_section(state)
    if native_section:
        sections.append(native_section)
    sources = source_register(state)
    source_rows = []
    for source in sources:
        source_rows.append("<tr><td>" + _e(source["role"]) + "</td><td>" +
                           _url(source["uri"], source["title"] or source["id"]) + "</td><td>" +
                           _display(source["vintage"]) + "</td><td>" +
                           _display(source["meaning"] or source["relation"] or _reference_text(source["reference"])) +
                           "</td><td><code>" + _e(source["body"]["sha256"]) + "</code></td></tr>")
    sections += [
        "<h2>Criterion sources and reproducible interpretation</h2><p>"
        "<a href=\"source-register.json\">Complete source and geometry register</a> · "
        "<a href=\"source-register.csv\">Source reference table</a> · "
        "<a href=\"report-data-dictionary.json\">Field meanings and units</a></p>",
        '<div class="scroll"><table><thead><tr><th>Selected role</th><th>Original source</th><th>Edition</th>'
        '<th>Selected meaning</th><th>Original bytes SHA-256</th></tr></thead><tbody>' +
        "".join(source_rows) + "</tbody></table></div>",
    ]
    anchor = "<h2>Scoring and decision rules</h2>"
    if base.count(anchor) != 1:
        raise ValueError("The maintained conservation report lacks its unique decision-section anchor")
    base = base.replace(anchor, "".join(sections) + anchor, 1)
    old = ("<p>The saved purpose, ordering and thresholds determine this selection. Costs represent the supplied "
           "whole-unit amounts. Ranked selection follows a deterministic greedy order and checks actual union area "
           "as it proceeds.</p>")
    if base.count(old) != 1:
        raise ValueError("The maintained conservation report decision paragraph differs")
    return base.replace(old, _decision(plan), 1)


def presentation_members(workspace, directory, state, candidates, *, plan=None):
    """Create a fresh export edition while retaining original study/plan artifacts."""
    from pyproj import CRS
    from shapely import wkb
    from shapely.ops import unary_union
    from . import conservation

    directory = Path(directory)
    state = presentation_state(workspace, state)
    original_geometry = verify_file(workspace.root, state["files"]["geometries"])
    from .common import read_json
    geometry_document = read_json(original_geometry)
    if geometry_document.get("study_id") != state["id"]:
        raise ValueError("The retained candidate geometry belongs to another study")
    geometries = geometry_document["units"]
    crs = CRS.from_user_input(geometry_document["analysis_crs"])
    expected = {row["id"] for row in candidates}
    if set(geometries) != expected:
        raise ValueError("The retained candidate inventory and original geometries differ")
    selected = None if plan is None else set(plan["selected_ids"])
    if selected is not None and not selected <= expected:
        raise ValueError("The original portfolio contains an absent candidate")
    union = unary_union([wkb.loads(bytes.fromhex(geometries[key]["reporting"]))
                         for key in plan["selected_ids"]]) if plan else None
    alternatives = state["selection"]["spec"]["alternative_run_ids"]
    conservation._write_csv(directory / "candidates.csv", candidates, alternatives)
    conservation._write_gpkg(directory / "geodata.gpkg", crs, candidates, geometries,
                             selected=selected, union=union)
    if plan:
        conservation._write_csv(directory / "portfolio.csv",
                                [row for row in candidates if row["id"] in selected], alternatives)
    atomic_bytes(directory / "index.html", conservation._report(state, candidates, plan=plan).encode("utf-8"))
    files = write_supplements(workspace, directory, state, candidates, plan=plan)
    for name in ["candidates.csv", "geodata.gpkg", "index.html"] + (["portfolio.csv"] if plan else []):
        files[name] = describe_file(workspace.root, directory / name)
    inputs = {
        "study_id": state["id"], "plan_id": plan["id"] if plan else None,
        "candidate_inventory": state["files"]["candidates"],
        "geometry_inventory": state["files"]["geometries"],
        "original_study_files": state["files"], "original_plan_files": plan["files"] if plan else None,
        "selected_ids": plan["selected_ids"] if plan else None,
        "selected_geometry": "Original retained reporting polygons unioned in their saved analysis CRS",
    }
    edition = {
        "schema": SCHEMA, "presentation": identity(), "input": inputs,
        "files": {Path(item["path"]).name: {"bytes": item["bytes"], "sha256": item["sha256"]}
                  for item in files.values()},
        "interpretation": "This edition presents the original retained measurements, score results and parcel decision.",
    }
    atomic_json(directory / "presentation.json", edition)
    files["presentation"] = describe_file(workspace.root, directory / "presentation.json")
    return {Path(item["path"]).name: (workspace.root / item["path"], item) for item in files.values()}
