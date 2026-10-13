"""Bind the maintained native scorer to the retained Lake Keowee source profile.

The native conservation engine still owns candidate ranking, geometry, portfolio
selection and paired experiments. This adapter supplies exact source intervals,
profile identity, typed observations and their retained table evidence.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINDING_FILE = ROOT / "source" / "keowee-native-binding-20261013.json"
CLASS_SCHEMA = "upstate.keowee-classification/v1"
LEVELS = ("low", "medium", "high")


def _copy(value):
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def load():
    mapping_raw = BINDING_FILE.read_bytes()
    mapping = json.loads(mapping_raw)
    target = mapping["profile"]
    raw = (ROOT / target["path"]).read_bytes()
    if len(raw) != target["bytes"] or hashlib.sha256(raw).hexdigest() != target["sha256"]:
        raise ValueError("The installed Keowee source profile differs from its retained binding")
    profile = json.loads(raw)
    if (profile.get("schema") != "upstate.keowee-methodology/v1"
            or profile.get("id") != target["id"] or profile.get("version") != target["version"]):
        raise ValueError("The installed Keowee profile identity differs")
    identity = {**target, "package_revision": mapping["package_revision"],
                "binding_sha256": hashlib.sha256(mapping_raw).hexdigest(),
                "adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return profile, mapping, identity


def compose_definition(document):
    """Add source precision without replacing native category or metric IDs."""
    profile, mapping, identity = load()
    categories = {row["id"]: row for row in profile["categories"]}
    criteria = {row["id"]: row for row in profile["criteria"]}
    result = _copy(document)
    for category in result["categories"]:
        published = categories[mapping["category_ids"][category["id"]]]
        if category["maximum"] != published["max_points"] or category["priority"] != published["priority_ranges"]:
            raise ValueError("Native category points differ from the retained source profile")
        category["source_profile_category_id"] = published["id"]
        def attach(rule):
            for child in rule.get("terms", []):
                attach(child)
            criterion_id = mapping["metric_profile_criteria"].get(rule.get("metric"))
            if criterion_id:
                original = criteria[criterion_id]
                rule["source_profile_criterion_id"] = criterion_id
                rule["source_profile_references"] = original["references"]
                if rule["type"] == "thresholds":
                    rule["source_profile_rule"] = _copy(original["rule"])
        for rule in category["criteria"]:
            attach(rule)
    result["source_profile"] = identity
    result["source_profile_semantics"] = _copy(profile["semantics"])
    result["source_profile_observation_contract"] = _copy(profile["observation_contract"])
    result["source_interpretations"].append({
        "id": "literal-source-intervals",
        "source_pages": [138, 139, 140, 142, 143],
        "default": "Numeric source thresholds retain literal endpoints, overlaps and gaps. Explicit and current-tertile export adaptations keep their own bindings.",
        "original_raster_pixel_area_m2": profile["semantics"]["original_raster_pixel_area_m2"],
        "sediment_ton_definition": profile["semantics"]["sediment_ton_definition"],
    })
    return result


def normalize_profile_binding(binding, metric, kind):
    """Resolve a requested literal profile band into a retained executable rule."""
    profile, mapping, identity = load()
    criterion_id = mapping["metric_profile_criteria"].get(metric)
    if metric not in ("cwa_priority", "nitrogen_export_priority",
                      "phosphorus_export_priority", "sediment_export_priority"):
        raise ValueError("Source profile bands apply to CWA and original export-level metrics")
    original = next(row for row in profile["criteria"] if row["id"] == criterion_id)
    rule = _copy(original["rule"])
    supplied = binding.get("unit")
    if kind == "native_export":
        if binding.get("statistic") != "parcel_mean_cell_mass":
            raise ValueError("Printed export bins require parcel mean cell mass, not an area rate")
        if "pixel_area_m2" not in binding:
            raise ValueError("Record the current native pixel_area_m2 for a source-band transfer")
        area = binding["pixel_area_m2"]
        if isinstance(area, bool) or not isinstance(area, (int, float)) or not math.isfinite(area) or area <= 0:
            raise ValueError("pixel_area_m2 must be a finite positive recorded value")
        if not isinstance(binding.get("adaptation_reference"), str) or not binding["adaptation_reference"].strip():
            raise ValueError("Record the current-grid interpretation used to transfer the printed export bins")
        if metric == "sediment_export_priority" and binding.get("sediment_ton_definition") != "metric_tonne":
            raise ValueError("A native metric-tonne transfer must explicitly record sediment_ton_definition='metric_tonne'")
        binding["profile_input_unit"] = rule["unit"]
        binding["profile_transfer"] = {
            "kind": "current_native_grid_adaptation",
            "pixel_area_m2": area, "reference": binding["adaptation_reference"],
            "original_raster_pixel_area_m2": None,
            "native_unit": supplied, "profile_unit": rule["unit"],
            "sediment_ton_definition": binding.get("sediment_ton_definition"),
        }
    elif supplied != rule["unit"]:
        raise ValueError(metric + " source bands require unit " + rule["unit"])
    else:
        binding["profile_input_unit"] = supplied
    binding["source_profile"] = identity
    binding["source_profile_rule"] = rule
    binding["source_profile_criterion_id"] = criterion_id
    binding["source_profile_references"] = original["references"]
    binding["transform"] = "profile_band"
    return binding


def classify(value, rule, *, criterion_id=None, identity=None, references=None):
    """Return all literal matches and attainable points, including source gaps."""
    bins = rule["bins"]
    all_points = sorted({row["points"] for row in bins})
    all_classes = list(dict.fromkeys(row["label"] for row in bins))
    if value is None or value == "":
        matches, state = [], "missing"
    else:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("A source-profile interval requires a finite numeric input")
        if value < 0:
            raise ValueError("A source-profile observation must be nonnegative")
        def contains(row):
            low = row["min"]
            high = row["max"]
            return ((low is None or value > low or value == low and row.get("min_inclusive", True))
                    and (high is None or value < high or value == high and row.get("max_inclusive", True)))
        matches = [row for row in bins if contains(row)]
        state = "ambiguous" if len(matches) > 1 else "scored" if matches else "unclassified"
    return {
        "schema": CLASS_SCHEMA, "criterion_id": criterion_id,
        "value": value, "unit": rule["unit"], "state": state,
        "matched_classes": [row["label"] for row in matches],
        "classes": [row["label"] for row in matches] if matches else all_classes,
        "score_options": sorted({row["points"] for row in matches}) if matches else all_points,
        "source_profile": _copy(identity), "references": _copy(references or []),
    }


def classify_binding(value, binding):
    return classify(value, binding["source_profile_rule"],
                    criterion_id=binding["source_profile_criterion_id"],
                    identity=binding["source_profile"], references=binding["source_profile_references"])


def typed_level(value, name):
    if not isinstance(value, dict) or value.get("schema") != CLASS_SCHEMA:
        return None
    classes = value.get("classes")
    if not isinstance(classes, list) or not classes or len(set(classes)) != len(classes) or any(x not in LEVELS for x in classes):
        raise ValueError(name + " has invalid source class alternatives")
    if value.get("state") not in ("scored", "ambiguous", "unclassified", "missing"):
        raise ValueError(name + " has an invalid source classification state")
    return _copy(value)


def numeric_component(rule, value, identity):
    classified = classify(value, rule["source_profile_rule"],
                          criterion_id=rule["source_profile_criterion_id"],
                          identity=identity, references=rule["source_profile_references"])
    options = classified["score_options"]
    return {
        "id": rule["id"], "metric": rule["metric"], "value": value,
        "known_points": min(options), "possible_points": max(options),
        "points": options[0] if len(options) == 1 else None,
        "score_options": options, "classification": classified, "reference": rule["reference"],
    }


def aggregate_options(children, *, operation="sum", cap=None):
    totals = {0}
    for child in children:
        options = child.get("score_options")
        if options is None:
            options = list(range(int(child["known_points"]), int(child["possible_points"]) + 1))
        totals = {max(left, right) if operation == "maximum" else left + right
                  for left in totals for right in options}
    if cap is not None:
        totals = {min(value, cap) for value in totals}
    return sorted(totals)


class CriterionTable(dict):
    """Keep original per-row evidence beside the unchanged native metric map."""
    def __init__(self):
        super().__init__()
        self.source_rows = {}
        self.metadata = {}

    def retain_row(self, key, row, id_column):
        if row.get(id_column) != key:
            raise ValueError("The criterion row's configured ID differs from its joined parcel ID")
        self.source_rows[key] = row


def _path(value, path):
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def observation_bundle(candidate, table, *, score, identity, profile_state=None):
    """Expose actual native observations to the retained JavaScript evaluator."""
    profile, mapping, loaded_identity = profile_state if profile_state is not None else load()
    if identity != loaded_identity:
        raise ValueError("The observation adapter and ranked profile editions differ")
    parcel_id = candidate["id"]
    raw_row = table.source_rows.get(parcel_id, {}) if isinstance(table, CriterionTable) else {}
    metrics = table.get(parcel_id, {})
    evidence = raw_row.get("evidence", {})
    table_metadata = table.metadata if isinstance(table, CriterionTable) else {}
    observations = {}
    point = candidate.get("point_score", {})
    resolved_metrics = point.get("metric_values", {})
    resolved_sources = point.get("metric_sources", {})
    field_definitions = {row["id"]: row for row in profile["fields"]}
    def put(name, value, detail):
        if value is None or value == "":
            return
        field = field_definitions[name]
        original = _copy(value)
        kind = field["type"]
        if kind == "boolean":
            if isinstance(value, str) and value.strip().lower() in ("true", "false", "1", "0"):
                value = value.strip().lower() in ("true", "1")
            elif isinstance(value, (int, float)) and value in (0, 1):
                value = bool(value)
            if not isinstance(value, bool):
                return
        elif kind in ("number", "integer"):
            if isinstance(value, bool):
                return
            try:
                value = float(value)
            except (TypeError, ValueError):
                return
            if (not math.isfinite(value) or value < field.get("minimum", 0)
                    or field.get("maximum") is not None and value > field["maximum"]):
                return
            if kind == "integer":
                if not value.is_integer():
                    return
                value = int(value)
        elif kind.endswith("[]"):
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except ValueError:
                    return
            if not isinstance(value, list):
                return
            if kind == "integer[]" and any(isinstance(x, bool) or not isinstance(x, int) or x < 1 for x in value):
                return
            if kind == "string[]" and any(not isinstance(x, str) for x in value):
                return
        elif kind == "string" and not isinstance(value, str):
            return
        if field.get("enum"):
            selected_values = value if isinstance(value, list) else [value]
            if any(item not in field["enum"] for item in selected_values):
                return
        observations[name] = {"value": _copy(value), "unit": field["unit"],
                              "original_value": original, **detail}
    for item in mapping["fields"]:
        name, source = item["profile_field"], item["native_metric"]
        if source is None or name in (
                "cwa_mean", "stream_classes", "wetland_classes", "agricultural_fraction",
                "nitrogen_export_class", "phosphorus_export_class", "sediment_export_class"):
            continue
        if source in resolved_metrics:
            # The selected binding owns this measurement, including an explicit
            # null backed by a closed interval. A canonical table column must
            # not replace a different field chosen for the retained score.
            value = resolved_metrics[source]
            selected = resolved_sources.get(source, {})
            detail = {
                "original_fields": [selected.get("field", source)],
                "method": "Actual selected native criterion binding",
                "source_binding": _copy(selected),
                "source_evidence": _copy(evidence.get(item["evidence_role"], {}))
                    if selected.get("kind") == "table" and selected.get("field") == source else {},
            }
        else:
            value = _path(metrics, source)
            detail = {"original_fields": [source], "method": "Retained parcel criterion table",
                      "source_evidence": _copy(evidence.get(item["evidence_role"], {}))}
        if name == "stream_length_miles" and value is not None:
            if isinstance(value, bool):
                continue
            detail["original_value"] = _copy(value)
            try:
                value = float(value) / 1609.344
            except (TypeError, ValueError):
                continue
            detail["conversion"] = {"from": "metre", "to": "mile", "divisor": 1609.344}
        put(name, value, detail)
    # Preserve numeric source bounds as bounds, including an unresolved exact
    # value. The original published scalar profile remains unchanged; the
    # evaluator accepts this optional, source-described observation extension.
    numeric_intervals = point.get("metric_bounds", {})
    for item in mapping["fields"]:
        name, source = item["profile_field"], item["native_metric"]
        if source is None or source not in numeric_intervals:
            continue
        field = field_definitions[name]
        if field["type"] != "number":
            continue
        original_interval = _copy(numeric_intervals[source])
        interval = _copy(original_interval)
        if interval.get("unit") == "acres" and field["unit"] == "acre":
            interval["original_unit"] = interval["unit"]
            interval["unit"] = "acre"
            interval["unit_interpretation"] = "Canonical acre spelling; numeric endpoints unchanged"
        if interval.get("unit") != field["unit"]:
            raise ValueError("The source interval unit differs from its profile observation: " + name)
        selected = resolved_sources.get(source, {})
        observation = observations.setdefault(name, {
            "value": None, "unit": field["unit"],
            "original_fields": [selected.get("field", source)],
            "method": "Actual retained closed source interval",
            "source_binding": _copy(selected),
        })
        observation["interval"] = interval
        observation["original_numeric_interval"] = original_interval
        observation["numeric_interval_source"] = "point_score.metric_bounds." + source
        if source in ("hydric_soil_acres", "sensitive_riparian_acres"):
            observation["spatial_scope"] = {
                "area_basis": interval.get("area_basis"),
                "meaning": "Area of the selected criterion footprint intersected with the retained parcel analysis geometry",
                "bound_applies_to": "In-parcel intersections only",
            }
    if ("parcel_area_acres" not in observations and "parcel_acres" not in resolved_metrics
            and candidate.get("area_ha") is not None):
        put("parcel_area_acres", candidate["area_ha"] * 10000 / 4046.8564224, {
            "original_fields": ["area_ha"], "source_identity": _copy(candidate.get("source_identity", {})),
            "method": "Whole original parcel area in the retained analysis CRS",
            "conversion": {"from": "hectare", "to": "acre", "factor": 10000 / 4046.8564224}})
    detail = resolved_sources.get("headwater_stream", {})
    if detail.get("kind") == "stream_order":
        # Recompute the observation from the actual selected order field. An
        # unrelated canonical stream_orders column cannot override that choice.
        observations.pop("stream_orders", None)
        if detail.get("raw") is not None:
            orders = detail["raw"]
            if isinstance(orders, str):
                orders = json.loads(orders)
            orders = orders if isinstance(orders, list) else [orders]
            if all(isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in orders):
                put("stream_orders", sorted(set(orders)), {"original_fields": [detail["field"]],
                    "method": "Original explicitly bound integer stream orders", "source_binding": detail})
    mean = table_metadata.get("population_statistics", {}).get("stream_length", {}).get("threshold_m")
    if mean is not None:
        put("watershed_mean_stream_length_miles", mean / 1609.344, {
            "original_fields": ["population_statistics.stream_length.threshold_m"],
            "method": "Retained complete positive-stream parcel population",
            "conversion": {"from": "metre", "to": "mile", "divisor": 1609.344}})
    cwa = metrics.get("critical_watershed_area")
    if isinstance(cwa, dict) and cwa.get("mean") is not None:
        missing, area = cwa.get("missing_area_m2"), cwa.get("area_m2")
        if isinstance(missing, (int, float)) and isinstance(area, (int, float)) and missing <= max(1e-6, area * 1e-10):
            put("cwa_mean", cwa["mean"], {"original_fields": ["critical_watershed_area.mean"],
                "source_evidence": _copy(evidence.get("critical_watershed_area", {})),
                "method": "Complete original CWA raster zonal mean"})
    land_cover = metrics.get("land_cover")
    if isinstance(land_cover, dict) and land_cover.get("area_m2", 0) > 0:
        area, missing = land_cover["area_m2"], land_cover.get("missing_area_m2")
        if isinstance(missing, (int, float)) and missing <= max(1e-6, area * 1e-10):
            codes = table_metadata.get("settings", {}).get("agricultural_codes")
            amounts = land_cover.get("class_area_m2", {})
            if isinstance(codes, list):
                amount = sum(amounts.get(str(code), amounts.get(code, 0)) for code in codes)
                put("agricultural_fraction", amount / area, {
                    "original_fields": ["land_cover.class_area_m2", "land_cover.area_m2"],
                    "source_evidence": _copy(evidence.get("land_cover", {})),
                    "method": "Actual selected agricultural class area divided by complete analysis area",
                    "original_codes": codes})
    # Only an explicit source-profile band supplies an original-bin scalar.
    # Current-study tertiles and independent preclassified levels retain their
    # native interpretation instead of becoming an original published class.
    native_point = candidate.get("point_score", {})
    for pollutant in ("nitrogen_export", "phosphorus_export", "sediment_export"):
        metric_name = pollutant + "_priority"
        classified = native_point.get("metric_values", {}).get(metric_name)
        binding = native_point.get("metric_sources", {}).get(metric_name, {})
        if (isinstance(classified, dict) and classified.get("schema") == CLASS_SCHEMA
                and classified.get("criterion_id") == pollutant
                and classified.get("source_profile") == identity
                and binding.get("transform") == "profile_band"):
            put(pollutant + "_mean", classified.get("value"), {
                "original_fields": [binding.get("field", metric_name)],
                "method": "Explicit retained source-profile interval binding",
                "source_binding": _copy(binding),
                "source_classification": _copy(classified),
                "unit_interpretation": _copy(binding.get("profile_transfer")),
            })
    classes = metrics.get("water_classifications")
    class_evidence = evidence.get("classifications", {})
    class_binding = table_metadata.get("source_bindings", {}).get("classifications", {}).get("selection", {})
    aliases = {"TPGT": "TGPT"}
    allowed = {"ORW", "TN", "TGPT", "FW"}
    scope = class_binding.get("class_scope")
    complete_scope = scope == "all" or (
        isinstance(scope, list) and allowed.issubset({aliases.get(value, value) for value in scope}))
    # The builder retains the three scoring-group presences even when a final
    # unfiltered evidence capture no longer records a missing class field.
    fw_known = isinstance(classes, list) and (
        "FW" in classes or (
            metrics.get("stream_fw_with_listed_impairment") is False
            and metrics.get("stream_fw_without_listed_impairment") is False))
    class_groups_known = (
        isinstance(metrics.get("stream_orw_or_tn"), bool)
        and isinstance(metrics.get("stream_tpgt"), bool) and fw_known)
    complete = (
        class_evidence.get("coverage_contains_analysis_geometry") is True
        and class_evidence.get("matching_field_unknown") is False
        and complete_scope and class_groups_known)
    if isinstance(classes, list) and complete:
        normalized = [aliases.get(value, value) for value in classes]
        if all(value in allowed for value in normalized):
            put("stream_classes", sorted(set(normalized)), {
                "source_class_values": classes, "original_fields": ["water_classifications", "H2OCLASS"],
                "source_evidence": _copy(class_evidence), "provider_adapter": "scdes-h2oclass-to-keowee-2020",
                "source_class_scope": _copy(scope), "scoring_groups_observed": True,
                "changes": [{"source": value, "target": aliases[value]} for value in classes if value in aliases]})
    wetlands = metrics.get("wetland_types")
    wet_evidence = evidence.get("wetlands", {})
    wet_names = {"Freshwater Forested/Shrub Wetland": "freshwater_forested_shrub",
                 "Freshwater Emergent Wetland": "freshwater_emergent", "Riverine": "riverine",
                 "Freshwater Pond": "freshwater_pond", "Lake": "lake"}
    if (isinstance(wetlands, list) and wet_evidence.get("coverage_contains_analysis_geometry") is True
            and wet_evidence.get("matching_field_unknown") is False
            and isinstance(metrics.get("wetland_forested_shrub_emergent_or_riverine"), bool)
            and isinstance(metrics.get("wetland_pond_or_lake"), bool)):
        put("wetland_classes", sorted({wet_names.get(value, "other") for value in wetlands}), {
            "original_fields": ["wetland_types"], "original_values": wetlands,
            "source_evidence": _copy(wet_evidence), "method": "Original NWI class names to printed wetland categories"})
    return {
        "schema": "upstate.keowee-observations/v1", "parcel_id": parcel_id,
        "observations": observations,
        "choices": {"protection_stream_order": "appendix_d" if score["headwater_orders"] == [1] else "table31"},
        "source_profile": identity,
        "geometry_context_sha256": table_metadata.get("geometry_context_sha256"),
        "unresolved_fields": [row["id"] for row in profile["fields"] if row["id"] not in observations],
    }


def candidate_trace(candidate, table, score, document, components, profile_state=None):
    """Add exact alternatives and source observations without changing plan APIs."""
    identity = document["source_profile"]
    point = candidate["point_score"]
    options = aggregate_options(components)
    point["score_options"] = options
    point["priority_options"] = [
        band["label"] for band in next(row for row in document["categories"] if row["id"] == score["category_id"])["priority"]
        if point["prerequisite"] is not False and any(band["min"] <= value <= band["max"] for value in options)
    ]
    point["source_profile"] = identity
    point["profile_observations"] = observation_bundle(candidate, table, score=score, identity=identity, profile_state=profile_state)
    if isinstance(table, CriterionTable):
        raw = table.source_rows.get(candidate["id"], {})
        point["original_criterion_evidence"] = _copy(raw.get("evidence", {}))
