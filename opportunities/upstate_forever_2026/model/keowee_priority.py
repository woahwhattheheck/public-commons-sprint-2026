"""Published Lake Keowee point methods within the retained conservation workflow.

The module reads source-bound parcel criteria, assigns each practice's published
points, and returns candidates to the existing conservation portfolio engine.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path

from .common import canonical, digest, identifier, read_json, verify_file

METHOD_FILE = Path(__file__).resolve().parents[1] / "source" / "keowee-priority-methods-20261013.json"
METHOD_SCHEMA = "upstate.keowee-priority-methods/v1"
TABLE_SCHEMA = "upstate.parcel-criteria/v1"
VERSION = 2
ACRES_PER_HECTARE = 10000.0 / 4046.8564224
CANDIDATE_FIELDS = {
    "area_ha", "reporting_area_ha", "protected_fraction", "protected_area_ha",
    "source_water_fraction", "source_water_area_ha", "high_quality_context",
    "high_quality_overlap_area_ha", "high_quality_contact_length_m",
}
NUMERIC_METRIC_UNITS = {
    "parcel_acres": "acres", "hydric_soil_acres": "acres", "sensitive_riparian_acres": "acres",
}
EXPORT_UNITS = {
    "nitrogen_export": ("kg/ha/year", "kg/cell/year"),
    "phosphorus_export": ("kg/ha/year", "kg/cell/year"),
    "sediment_export": ("metric_tonnes/ha/year", "metric_tonnes/cell/year"),
}


def _copy(value):
    return json.loads(canonical(value))


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " requires nonempty text")
    return value.strip()


def _number(value, name, *, minimum=0):
    if isinstance(value, bool):
        raise ValueError(name + " requires a number")
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ValueError(name + " requires a finite number") from None
    if not math.isfinite(result) or result < minimum:
        raise ValueError(name + " requires a finite value at least " + str(minimum))
    return result


def _boolean(value, name):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.strip().lower() in ("true", "false", "0", "1"):
        return value.strip().lower() in ("true", "1")
    raise ValueError(name + " requires true/false or 1/0; an empty value means unavailable")


def definition():
    raw = METHOD_FILE.read_bytes()
    value = json.loads(raw)
    if value.get("schema") != METHOD_SCHEMA:
        raise ValueError("The installed Lake Keowee method document has another schema")
    return value, hashlib.sha256(raw).hexdigest()


def catalog():
    document, sha = definition()
    return {
        "schema": "upstate.parcel-method-catalog/v1",
        "id": document["id"], "title": document["title"],
        "reference": document["reference"], "source_uri": document["source_uri"],
        "definition_sha256": sha, "source_interpretations": document["source_interpretations"],
        "categories": [
            {"id": row["id"], "title": row["title"], "purpose": row["purpose"],
             "maximum": row["maximum"], "priority": row["priority"],
             "reference": row["reference"], "required_metrics": sorted(metric_types(row))}
            for row in document["categories"]
        ],
        "septic": document["septic"],
    }


def category(method_id, category_id):
    document, sha = definition()
    if method_id != document["id"]:
        raise ValueError("Select the installed published Lake Keowee method ID")
    found = [row for row in document["categories"] if row["id"] == category_id]
    if len(found) != 1:
        raise ValueError("Select one of the published point categories")
    return document, found[0], sha


def metric_types(method):
    result = {}
    def criterion(row):
        if "terms" in row:
            for term in row["terms"]:
                criterion(term)
        else:
            kind = {"boolean": "boolean", "thresholds": "number", "levels": "level"}[row["type"]]
            previous = result.setdefault(row["metric"], kind)
            if previous != kind:
                raise ValueError("Conflicting published metric types")
    def prerequisite(row):
        if "any" in row:
            for term in row["any"]:
                prerequisite(term)
        elif "metric" in row:
            result[row["metric"]] = "boolean"
    for row in method["criteria"]:
        criterion(row)
    prerequisite(method["eligibility"])
    return result


def _source_choice(value):
    if not isinstance(value, dict):
        raise ValueError("Select a retained parcel-criterion table")
    result = _copy(value)
    result["source_collection_id"] = identifier(result.get("source_collection_id"))
    result["source_id"] = _text(result.get("source_id"), "Criterion table source ID")
    result["id_column"] = _text(result.get("id_column", "id"), "Criterion table ID column")
    result["format"] = result.get("format", "json")
    if result["format"] not in ("json", "csv"):
        raise ValueError("Criterion table format must be json or csv")
    return result


def normalize_score(value, spec):
    result = _copy(value)
    document, selected, _ = category(
        result.get("method_id", "lake-keowee-2020-published-scorecards"),
        _text(result.get("category_id"), "Published category"),
    )
    if spec["unit_type"] != "parcel":
        raise ValueError("The published Lake Keowee methods score parcels; select retained parcel units")
    if result.get("scale", "total") != "total":
        raise ValueError("Published scores are points; choose score_per_hectare at the portfolio stage if useful")
    if spec["purpose"] not in ("screening", selected["purpose"]):
        raise ValueError("Study purpose differs from the selected published practice")
    result.update(basis="published_method", scale="total", method_id=document["id"])
    result["interpretation"] = _text(
        result.get("interpretation", "Published category points with the retained current-study criterion bindings."),
        "Method interpretation",
    )
    orders = result.get("headwater_orders", [1, 2])
    if orders not in ([1], [1, 2]):
        raise ValueError("Select [1, 2] for Table 31 or [1] for the protection Appendix D variant")
    if selected["id"] != "land_protection" and orders != [1, 2]:
        raise ValueError("The restoration headwater definition uses first- and second-order streams")
    result["headwater_orders"] = orders
    if result.get("metrics") is not None:
        result["metrics"] = _source_choice(result["metrics"])
    choices = result.get("bindings", {})
    if not isinstance(choices, dict):
        raise ValueError("Metric bindings must map criterion names to explicit source fields")
    required = metric_types(selected)
    if set(choices) - set(required):
        raise ValueError("A metric binding is outside the selected practice: " + ", ".join(sorted(set(choices) - set(required))))
    normalized, native = {}, set()
    for name, binding in choices.items():
        if not isinstance(binding, dict):
            raise ValueError("Metric " + name + " needs a binding object")
        binding = _copy(binding)
        kind = binding.get("kind")
        if kind not in ("table", "attribute", "candidate", "native_export", "study_mean", "stream_order"):
            raise ValueError("Unsupported metric binding kind for " + name)
        if kind in ("table", "attribute", "candidate", "study_mean", "stream_order"):
            binding["field"] = _text(binding.get("field"), name + " source field")
        if kind == "candidate" and binding["field"] not in CANDIDATE_FIELDS:
            raise ValueError("Candidate binding must use a declared retained quantity")
        if kind in ("study_mean", "stream_order"):
            binding["input"] = binding.get("input", "table")
            if binding["input"] not in ("table", "attribute"):
                raise ValueError(name + " input must be table or attribute")
            if binding["input"] == "table" and not result.get("metrics"):
                raise ValueError(name + " selects a table but the retained table is absent")
        if kind == "table" and not result.get("metrics"):
            raise ValueError(name + " selects a table but the retained table is absent")
        if kind == "native_export":
            pollutant = binding.get("pollutant")
            if pollutant not in EXPORT_UNITS or name != pollutant + "_priority":
                raise ValueError("Bind each current-export criterion to its matching pollutant")
            if spec["mode"] != "native_model":
                raise ValueError("A native export classification needs a selected completed native run")
            statistic = binding.get("statistic", "parcel_mean_cell_mass")
            if statistic not in ("parcel_mean_cell_mass", "parcel_mean_rate"):
                raise ValueError("Native published criteria use a parcel mean, with its selected area basis")
            binding["statistic"] = statistic
            binding["unit"] = EXPORT_UNITS[pollutant][0 if statistic == "parcel_mean_rate" else 1]
            native.add(pollutant)
            binding["band_method"] = binding.get("band_method", "explicit")
            if binding["band_method"] not in ("explicit", "current_tertiles"):
                raise ValueError("Choose explicit native cutoffs or a retained current_tertiles adaptation")
            binding["transform"] = "band"
        transform = binding.get("transform", "identity")
        if transform not in ("identity", "positive", "ha_to_acres", "ge", "gt", "equals", "band"):
            raise ValueError("Unknown criterion transform for " + name)
        if transform in ("ge", "gt"):
            binding["threshold"] = _number(binding.get("threshold"), name + " threshold")
        if transform == "band" and binding.get("band_method") != "current_tertiles":
            binding["medium_min"] = _number(binding.get("medium_min"), name + " medium cutoff")
            binding["high_min"] = _number(binding.get("high_min"), name + " high cutoff")
            if binding["medium_min"] >= binding["high_min"]:
                raise ValueError(name + " medium cutoff must be below its high cutoff")
        if transform == "equals" and "value" not in binding:
            raise ValueError(name + " equality transform requires its exact source value")
        if kind == "study_mean" and name != "stream_length_above_study_mean":
            raise ValueError("The study-mean binding applies to the published stream-length criterion")
        if kind == "stream_order" and name != "headwater_stream":
            raise ValueError("Stream-order binding applies to the published headwater criterion")
        if transform == "band" and required[name] != "level":
            raise ValueError("Band classification requires a priority-level metric")
        if transform in ("positive", "ge", "gt", "equals") and required[name] != "boolean":
            raise ValueError("The selected comparison requires a boolean metric")
        if transform == "ha_to_acres" and required[name] != "number":
            raise ValueError("Area conversion requires a numeric metric")
        if kind in ("candidate", "native_export", "study_mean", "stream_order") or transform != "identity":
            binding["reference"] = _text(binding.get("reference"), name + " source or method reference")
        binding["transform"] = transform
        normalized[name] = binding
    if orders == [1] and normalized.get("headwater_stream", {}).get("kind") != "stream_order":
        raise ValueError("The first-order variant needs the original stream orders to recompute its criterion")
    result["bindings"] = normalized
    result["native_required_pollutants"] = sorted(native)
    return result


def geometry_context(workspace, spec):
    """Describe the original parcel and reporting geometry used by a criterion table."""
    from pyproj import CRS

    def selected(choice):
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        return {
            "source_collection_id": choice["source_collection_id"], "source_id": choice["source_id"],
            "body_sha256": entry["body"]["sha256"], "body_bytes": entry["body"]["bytes"],
            "layer": choice.get("layer") or entry.get("layer"),
            "id_field": choice.get("id_field") or entry.get("id_field"),
            "where": choice.get("where") or {},
        }

    result = {"schema": "upstate.parcel-geometry-context/v1", "parcels": selected(spec["parcels"])}
    if spec["mode"] == "source_context":
        result["reporting"] = {"kind": "source", **selected(spec["reporting_area"])}
        crs = CRS.from_user_input(spec.get("analysis_crs", "EPSG:5070"))
    else:
        run = workspace.inspect_run(spec["baseline_run_id"])
        grid = workspace.get_grid(run["selection"]["grid_id"])
        descriptor = grid["files"]["reporting_area"]
        result["reporting"] = {
            "kind": "native_grid", "grid_id": grid["id"],
            "reporting_sha256": descriptor["sha256"], "reporting_bytes": descriptor["bytes"],
        }
        crs = CRS.from_user_input(grid["grid"]["crs"])
    result["analysis_crs_wkt"] = crs.to_wkt()
    return result


def _builder_geometry_context(raw, choice, workspace, spec):
    if choice["format"] != "json":
        return None
    decoded = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    payload = json.loads(decoded.decode("utf-8-sig"))
    if not isinstance(payload, dict) or payload.get("builder", {}).get("name") != "source_tools.parcel_criteria":
        return None
    recorded = payload.get("geometry_context")
    recorded_sha = payload.get("geometry_context_sha256")
    if not isinstance(recorded, dict) or digest(recorded) != recorded_sha:
        raise ValueError("The builder criterion table has an inconsistent original geometry context")
    current = geometry_context(workspace, spec)
    if recorded != current or recorded_sha != digest(current):
        raise ValueError("The criterion table uses another original parcel/reporting geometry edition; build its current source-derived table")
    return {"descriptor": current, "sha256": recorded_sha}


def bind(workspace, spec):
    score = spec["score"]
    document, selected, sha = category(score["method_id"], score["category_id"])
    result = {
        "version": VERSION, "method_id": document["id"], "category_id": selected["id"],
        "definition_sha256": sha,
        "implementation_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "source_uri": document["source_uri"], "reference": document["reference"],
        "category": selected, "interpretation": score["interpretation"],
        "headwater_orders": score["headwater_orders"],
    }
    if score.get("metrics"):
        choice = score["metrics"]
        path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if entry["kind"] != "table":
            raise ValueError("Parcel criteria must be imported as a retained table")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["body"]["sha256"]:
            raise ValueError("The retained criterion table bytes changed")
        bound_geometry = _builder_geometry_context(raw, choice, workspace, spec)
        if bound_geometry is not None:
            result["geometry_context"] = bound_geometry
        result["criteria_source"] = {
            "selection": choice, "id": entry["id"], "title": entry["title"],
            "uri": entry["uri"], "vintage": entry["vintage"], "body": entry["body"],
            "scope": entry.get("scope"), "reference": choice.get("reference"),
            "relation": "Exact original parcel-ID join; metric meaning remains in the retained table and selected bindings.",
            "companions": entry.get("companions", []),
        }
    return result


def _table(workspace, score, retained):
    if not score.get("metrics"):
        return {}, {"state": "parcel_attributes_and_native_quantities", "rows": 0}, {}
    choice = score["metrics"]
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    raw = path.read_bytes()
    original = retained["criteria_source"]["body"]["sha256"]
    if hashlib.sha256(raw).hexdigest() != original or entry["body"]["sha256"] != original:
        raise ValueError("The selected criterion table differs from the prepared study")
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8-sig")
    metadata = {}
    if choice["format"] == "csv":
        reader = csv.DictReader(io.StringIO(text, newline=""))
        if not reader.fieldnames or choice["id_column"] not in reader.fieldnames:
            raise ValueError("The criterion table is missing its original parcel-ID column")
        records = list(reader)
    else:
        payload = json.loads(text)
        if isinstance(payload, list):
            records = payload
        elif isinstance(payload, dict) and payload.get("schema") == TABLE_SCHEMA and isinstance(payload.get("rows"), list):
            records = payload["rows"]
            metadata = {key: value for key, value in payload.items() if key != "rows"}
        else:
            raise ValueError("A criterion JSON table must contain rows under upstate.parcel-criteria/v1")
    result, bounds = {}, {}
    for row in records:
        if not isinstance(row, dict):
            raise ValueError("Criterion table rows must be objects")
        key = row.get(choice["id_column"])
        if not isinstance(key, str) or not key:
            raise ValueError("Keep criterion-table parcel IDs as original nonempty strings")
        if key in result:
            raise ValueError("Duplicate criterion-table parcel ID: " + key)
        values = row.get("metrics", row)
        if not isinstance(values, dict):
            raise ValueError("Parcel criterion values must be an object")
        result[key] = values
        limits = row.get("metric_bounds", {})
        if isinstance(limits, str):
            limits = json.loads(limits) if limits.strip() else {}
        if not isinstance(limits, dict):
            raise ValueError("Parcel metric_bounds must map numeric field names to closed source intervals")
        bounds[key] = {
            _text(name, "Bounded metric field"): _numeric_interval(interval, name)
            for name, interval in limits.items()
        }
    return result, {
        "state": "retained_table", "rows": len(result), "body_sha256": original, "metadata": metadata,
        "rows_with_numeric_intervals": sum(bool(value) for value in bounds.values()),
    }, bounds


def _numeric_interval(value, name):
    if not isinstance(value, dict):
        raise ValueError(name + " requires a source interval object")
    result = _copy(value)
    lower = _number(result.get("lower"), name + " lower limit")
    upper = _number(result.get("upper"), name + " upper limit")
    if upper < lower:
        raise ValueError(name + " upper limit is below its lower limit")
    if result.get("closed", True) is not True:
        raise ValueError(name + " requires closed numeric interval endpoints")
    result.update(lower=lower, upper=upper, closed=True)
    result["unit"] = _text(result.get("unit"), name + " interval unit")
    result["method"] = _text(result.get("method"), name + " interval method")
    result["reference"] = _text(result.get("reference"), name + " interval source reference")
    return result


def _resolved_interval(original, binding, name):
    result = _copy(original)
    transform = binding.get("transform", "identity") if binding else "identity"
    if transform == "ha_to_acres":
        if result["unit"] not in ("ha", "hectares"):
            raise ValueError(name + " hectare conversion requires interval units ha or hectares")
        result["lower"] *= ACRES_PER_HECTARE
        result["upper"] *= ACRES_PER_HECTARE
        result["unit"] = "acres"
        result["input_interval"] = _copy(original)
        result["conversion"] = "hectares * 10000 / 4046.8564224"
    elif transform != "identity":
        raise ValueError(name + " numeric interval requires identity or ha_to_acres")
    expected = NUMERIC_METRIC_UNITS.get(name)
    if expected is not None and result["unit"] != expected:
        raise ValueError(name + " interval must be expressed in " + expected)
    return result


def _missing(value):
    return value is None or isinstance(value, str) and not value.strip()


def _typed(value, kind, name):
    if _missing(value):
        return None
    if kind == "boolean":
        return _boolean(value, name)
    if kind == "number":
        return _number(value, name)
    if not isinstance(value, str) or value.strip() not in ("low", "medium", "high"):
        raise ValueError(name + " requires low, medium or high")
    return value.strip()


def _transform(raw, binding, name):
    if _missing(raw):
        return None
    transform = binding.get("transform", "identity")
    if transform == "identity":
        return raw
    if transform == "equals":
        expected = binding["value"]
        return type(raw) is type(expected) and raw == expected
    value = _number(raw, name)
    if transform == "ha_to_acres":
        return value * ACRES_PER_HECTARE
    if transform == "positive":
        return value > 0
    if transform == "ge":
        return value >= binding["threshold"]
    if transform == "gt":
        return value > binding["threshold"]
    if transform == "band":
        if value == 0:
            return "low"
        if binding.get("_no_positive_population"):
            return None
        if binding.get("_tied_cutoffs"):
            return "low" if value < binding["medium_min"] else "high" if value > binding["high_min"] else "medium"
        if value >= binding["high_min"]:
            return "high"
        return "medium" if value >= binding["medium_min"] else "low"
    raise ValueError("Unknown criterion transformation")


def _field(row, table, binding):
    source = table.get(row["id"], {}) if binding.get("input", "table") == "table" else row["original_attributes"]
    return source.get(binding["field"])


def _stream_orders(raw, name):
    if _missing(raw):
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise ValueError(name + " must contain original integer orders or a JSON array of orders") from None
    values = raw if isinstance(raw, list) else [raw]
    if any(isinstance(x, bool) or not isinstance(x, int) or x < 1 for x in values):
        raise ValueError(name + " must contain positive original integer stream orders")
    return set(values)


def _resolve(row, table, score, required, means, cell_area_ha, table_bounds):
    values, provenance, resolved_bounds = {}, {}, {}
    for name, kind in required.items():
        binding = score["bindings"].get(name)
        interval_field = None
        if binding is None:
            if name in table.get(row["id"], {}):
                raw = table[row["id"]][name]
                detail = {"kind": "table", "field": name}
                interval_field = name
            elif name in table_bounds.get(row["id"], {}):
                raw, detail, interval_field = None, {"kind": "table", "field": name}, name
            elif name == "parcel_acres":
                raw = row["area_ha"] * ACRES_PER_HECTARE
                detail = {"kind": "derived", "field": "area_ha", "formula": "hectares * 10000 / 4046.8564224"}
            else:
                raw, detail = None, {"kind": "unbound"}
            value = _typed(raw, kind, name)
        else:
            source = binding["kind"]
            detail = _copy(binding)
            if source == "candidate":
                raw = row.get(binding["field"])
            elif source == "attribute":
                raw = row["original_attributes"].get(binding["field"])
            elif source == "table":
                raw = table.get(row["id"], {}).get(binding["field"])
                interval_field = binding["field"]
            elif source == "study_mean":
                raw = _field(row, table, binding)
                mean = means.get(name)
                value = None if _missing(raw) or mean is None else _number(raw, name) > mean
                detail.update(raw=raw, study_mean=mean, population="Selected study parcels with a positive recorded stream length")
            elif source == "stream_order":
                raw = _field(row, table, binding)
                orders = _stream_orders(raw, name)
                value = None if orders is None else bool(orders.intersection(score["headwater_orders"]))
                detail.update(raw=raw, headwater_orders=score["headwater_orders"])
            else:
                pollutant = binding["pollutant"]
                metric = row["pollutants"][pollutant]
                mass, area = metric["baseline"], metric["valid_area_ha"]
                raw = mass / area if mass is not None and area and area > 0 else None
                if binding["statistic"] == "parcel_mean_cell_mass" and raw is not None:
                    if cell_area_ha is None:
                        raise ValueError("A mean cell-mass criterion requires its original native raster")
                    raw *= cell_area_ha
                detail.update(raw=raw, baseline_run_id=score.get("_baseline_run_id"), valid_area_ha=area,
                              coverage_fraction=metric["coverage_fraction"],
                              structural_stream_area_ha=metric["structural_stream_area_ha"])
            if source not in ("study_mean", "stream_order"):
                value = _typed(_transform(raw, binding, name), kind, name)
                detail["raw"] = raw
        if kind == "number" and interval_field in table_bounds.get(row["id"], {}):
            original_interval = table_bounds[row["id"]][interval_field]
            interval = _resolved_interval(original_interval, binding, name)
            if value is not None and not interval["lower"] <= value <= interval["upper"]:
                raise ValueError(name + " exact value is outside its retained source interval")
            if value is None and interval["lower"] == interval["upper"]:
                value = interval["lower"]
            resolved_bounds[name] = interval
            detail["numeric_interval"] = interval
            detail["value_state"] = "exact" if value is not None else "source_interval"
        values[name] = value
        provenance[name] = detail
    return values, provenance, resolved_bounds


def _threshold_points(rule, value):
    return next((row["points"] for row in rule["thresholds"] if value >= row["min"]), rule["otherwise"])


def _threshold_interval(rule, interval):
    lower, upper = interval["lower"], interval["upper"]
    # Closed endpoints preserve an exact published boundary. Interior cutoffs
    # and their immediate left side cover every attainable step, even if a
    # future retained rule is not monotonic in point value.
    probes = [lower, upper]
    for threshold in rule["thresholds"]:
        cutoff = float(threshold["min"])
        if lower <= cutoff <= upper:
            probes.append(cutoff)
        if lower < cutoff <= upper:
            probes.append(max(lower, math.nextafter(cutoff, -math.inf)))
    points = [_threshold_points(rule, value) for value in probes]
    return min(points), max(points)


def _criterion(rule, metrics, metric_bounds=None):
    metric_bounds = metric_bounds or {}
    kind = rule["type"]
    if kind in ("maximum", "sum"):
        children = [_criterion(row, metrics, metric_bounds) for row in rule["terms"]]
        if kind == "maximum":
            lower = max(row["known_points"] for row in children)
            upper = max(row["possible_points"] for row in children)
        else:
            lower = min(rule["cap"], sum(row["known_points"] for row in children))
            upper = min(rule["cap"], sum(row["possible_points"] for row in children))
        return {"id": rule["id"], "known_points": lower, "possible_points": upper,
                "points": lower if lower == upper else None, "terms": children, "reference": rule["reference"]}
    value = metrics.get(rule["metric"])
    interval = metric_bounds.get(rule["metric"]) if kind == "thresholds" else None
    if kind == "boolean":
        upper = rule["points"] if value is None or value else 0
        lower = rule["points"] if value is True else 0
    elif kind == "levels":
        upper = max(rule["levels"].values()) if value is None else rule["levels"][value]
        lower = min(rule["levels"].values()) if value is None else upper
    elif kind == "thresholds":
        if value is not None:
            lower = upper = _threshold_points(rule, value)
        elif interval is not None:
            lower, upper = _threshold_interval(rule, interval)
        else:
            possible = [rule["otherwise"], *(row["points"] for row in rule["thresholds"])]
            lower, upper = min(possible), max(possible)
    else:
        raise ValueError("Unsupported published criterion type")
    result = {"id": rule["id"], "metric": rule["metric"], "value": value,
              "known_points": lower, "possible_points": upper,
              "points": lower if lower == upper else None, "reference": rule["reference"],
              "evaluation": "exact_metric" if value is not None else "bounded_metric" if interval else "undetermined_metric"}
    if interval is not None:
        result["value_interval"] = {
            key: interval[key] for key in ("lower", "upper", "unit", "method", "reference")
        }
        result["points_determined_by_interval"] = value is None and lower == upper
    return result



def _eligible(rule, metrics):
    if "constant" in rule:
        return rule["constant"]
    if "any" in rule:
        values = [_eligible(row, metrics) for row in rule["any"]]
        return True if True in values else None if None in values else False
    value = metrics.get(rule["metric"])
    return None if value is None else value == rule["equals"]


def _native_cell_area(workspace, spec, bindings):
    selected = [row for row in spec["score"]["bindings"].values()
                if row["kind"] == "native_export" and row["statistic"] == "parcel_mean_cell_mass"]
    if not selected:
        return None
    import rasterio
    run_id = spec["baseline_run_id"]
    output = bindings["runs"][run_id]["outputs"][selected[0]["pollutant"]]
    path = verify_file(workspace.root / "runs" / run_id, output["rate"])
    with rasterio.open(path) as raster:
        transform = raster.transform
        sides = (math.hypot(transform.a, transform.d), math.hypot(transform.b, transform.e))
        area = abs(transform.a * transform.e - transform.b * transform.d) / 10000
        if any(not math.isclose(side, 30, rel_tol=0, abs_tol=1e-8) for side in sides) or not math.isclose(
                area, 0.09, rel_tol=0, abs_tol=1e-10):
            raise ValueError("Mean cell-mass criteria require the actual retained 30-metre native raster")
    return area


def _native_bands(candidates, score, cell_area_ha):
    resolved = {}
    for name, binding in score["bindings"].items():
        if binding["kind"] != "native_export" or binding["band_method"] != "current_tertiles":
            continue
        values = []
        for row in candidates:
            if not row["eligible"]:
                continue
            metric = row["pollutants"][binding["pollutant"]]
            mass, area = metric["baseline"], metric["valid_area_ha"]
            if mass is None or area is None or area <= 0:
                continue
            value = mass / area
            if binding["statistic"] == "parcel_mean_cell_mass":
                value *= cell_area_ha
            if value > 0 and math.isfinite(value):
                values.append(value)
        values.sort()
        def quantile(fraction):
            location = (len(values) - 1) * fraction
            low = int(math.floor(location))
            high = int(math.ceil(location))
            return values[low] + (values[high] - values[low]) * (location - low)
        if values:
            binding["medium_min"] = quantile(1 / 3)
            binding["high_min"] = quantile(2 / 3)
            binding["_tied_cutoffs"] = binding["medium_min"] == binding["high_min"]
        else:
            binding["_no_positive_population"] = True
        resolved[name] = {
            "method": "current_tertiles", "quantile_definition": "Linear interpolation at (n - 1) * q",
            "quantiles": [1 / 3, 2 / 3], "positive_population": len(values),
            "population": "Positive parcel means among native-eligible selected study parcels",
            "medium_min": binding.get("medium_min"), "high_min": binding.get("high_min"),
            "tied_cutoffs": binding.get("_tied_cutoffs", False),
            "tie_rule": "Equal-cutoff values are medium; lower positive values are low and higher values are high.",
            "zero_rule": "Observed zero export is low.",
            "unit": binding["unit"], "statistic": binding["statistic"],
            "reference": binding["reference"],
            "meaning": "Current-study adaptation of the published point weights; thresholds are computed from the saved native study.",
        }
    return resolved


def rank(workspace, candidates, spec, retained, bindings):
    """Assign practice points to the maintained native candidate collection."""
    score = _copy(spec["score"])
    score["_baseline_run_id"] = spec.get("baseline_run_id")
    document, selected, sha = category(score["method_id"], score["category_id"])
    current_code = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if retained["definition_sha256"] != sha or retained["implementation_sha256"] != current_code:
        raise ValueError("The saved published method differs from the installed method; prepare a successor study")
    table, table_info, table_bounds = _table(workspace, score, retained)
    required = metric_types(selected)
    cell_area_ha = _native_cell_area(workspace, spec, bindings)
    resolved_bands = _native_bands(candidates, score, cell_area_ha)
    means = {}
    for name, binding in score["bindings"].items():
        if binding["kind"] == "study_mean":
            numbers = [_field(row, table, binding) for row in candidates]
            numbers = [_number(x, name) for x in numbers if not _missing(x)]
            numbers = [x for x in numbers if x > 0]
            means[name] = math.fsum(numbers) / len(numbers) if numbers else None
    summary = {
        "complete": 0, "partial": 0, "prerequisite_absent": 0, "prerequisite_unknown": 0,
        "parcels_with_numeric_intervals": 0, "criteria_determined_by_intervals": 0,
        "complete_scores_using_intervals": 0,
    }
    for row in candidates:
        metrics, provenance, metric_bounds = _resolve(
            row, table, score, required, means, cell_area_ha, table_bounds)
        components = [_criterion(rule, metrics, metric_bounds) for rule in selected["criteria"]]
        interval_criteria = sum(bool(item.get("points_determined_by_interval")) for item in components)
        summary["parcels_with_numeric_intervals"] += bool(metric_bounds)
        summary["criteria_determined_by_intervals"] += interval_criteria
        lower = sum(item["known_points"] for item in components)
        upper = sum(item["possible_points"] for item in components)
        prerequisite = _eligible(selected["eligibility"], metrics)
        complete = lower == upper
        priority = next((band["label"] for band in selected["priority"]
                         if complete and prerequisite is True and band["min"] <= lower <= band["max"]), None)
        if complete and prerequisite is True and priority is None:
            raise ValueError("A computed score lies outside the published category's attainable ranges")
        row["score"] = float(lower) if complete and prerequisite is True else None
        row["score_components"] = {item["id"]: item for item in components}
        row["point_score"] = {
            "method_id": document["id"], "category_id": selected["id"], "unit": "points",
            "points": lower if complete and prerequisite is True else None, "known_points": lower, "possible_points": upper,
            "maximum": selected["maximum"], "priority": priority,
            "prerequisite": prerequisite, "metric_values": metrics, "metric_sources": provenance,
            "metric_bounds": metric_bounds,
            "definition_sha256": sha,
        }
        row["point_priority"] = priority
        row["score_unit"] = "points"
        summary["complete" if complete else "partial"] += 1
        summary["complete_scores_using_intervals"] += bool(complete and prerequisite is True and interval_criteria)
        if prerequisite is False:
            row["exclusion_reasons"].append("Published " + selected["title"] + " prerequisite is absent")
            summary["prerequisite_absent"] += 1
        elif prerequisite is None:
            row["exclusion_reasons"].append("Published practice eligibility awaits its selected source criterion")
            summary["prerequisite_unknown"] += 1
        row["eligible"] = not row["exclusion_reasons"]
    count = 0
    for row in sorted(candidates, key=lambda x: (x["score"] is None, -(x["score"] or 0), x["id"])):
        if row["eligible"] and row["score"] is not None:
            count += 1
            row["rank"] = count
        else:
            row["rank"] = None
    table_ids, candidate_ids = set(table), {row["id"] for row in candidates}
    table_info.update(matched_parcels=len(table_ids & candidate_ids),
                      rows_outside_selected_parcels=len(table_ids - candidate_ids),
                      parcels_without_table_row=len(candidate_ids - table_ids) if score.get("metrics") else None)
    return {
        "basis": "published_method", "unit": "points", "scale": "total",
        "method_id": document["id"], "category_id": selected["id"], "title": selected["title"],
        "maximum": selected["maximum"], "priority_ranges": selected["priority"],
        "reference": selected["reference"], "source_uri": document["source_uri"],
        "definition_sha256": sha, "implementation_sha256": current_code,
        "formula": "Sum published criterion contributions, preserving each criterion maximum and practice prerequisite.",
        "numeric_intervals": (
            "Closed acreage limits retain observed positive geometry and unresolved source coverage; "
            "published steps are evaluated across the whole interval. Exact points can be determined "
            "without assigning an exact acreage."),
        "interpretation": score["interpretation"], "headwater_orders": score["headwater_orders"],
        "source_interpretations": document["source_interpretations"],
        "criterion_table": table_info, "study_means": means, "resolved_native_bands": resolved_bands,
        "score_coverage": summary,
        "physical_quantities": "Original native annual mass and paired alternatives remain separately available.",
    }


def main():
    from .workspace import Workspace
    from . import conservation

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("methods")
    for action in ("prepare", "build", "portfolio"):
        command = sub.add_parser(action)
        command.add_argument("selection", type=Path)
    for action in ("resume", "inspect"):
        command = sub.add_parser(action)
        command.add_argument("study_id")
    args = parser.parse_args()
    if args.action == "methods":
        result = catalog()
    else:
        if args.workspace is None:
            parser.error("--workspace is required for source and study operations")
        workspace = Workspace(args.workspace)
        if args.action in ("prepare", "build", "portfolio"):
            value = read_json(args.selection)
            action = {"prepare": conservation.prepare, "build": conservation.build,
                      "portfolio": conservation.save_plan}[args.action]
            result = action(workspace, value)
        elif args.action == "resume":
            result = conservation.build(workspace, args.study_id)
        else:
            result = conservation.inspect(workspace, args.study_id)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
