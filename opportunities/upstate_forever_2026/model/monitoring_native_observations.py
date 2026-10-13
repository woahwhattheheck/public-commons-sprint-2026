"""Project saved original observations into ordinary Monitoring source context.

Read-only preview retains the original import and explicit qualifier meanings.
Preparation uses Workspace.import_sources and the existing observed-context store.
No flow, station, annual mass, concentration trend or native model is generated.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile

from .common import identifier, relative_file, verify_file
from .monitoring_common import ContractError, canonical_bytes, digest, file_sha256
from . import monitoring_observed_context as observed

EDITION = "upstate.native-observation-monitoring-context/v1"
OPTIONAL_COLUMNS = (
    "activity", "fraction", "depth", "depth_unit", "method_authority", "value_type",
    "weight_basis", "time_basis", "temperature_basis", "particle_size_basis",
    "project", "time", "timezone", "reporting_limit", "reporting_limit_unit", "comment",
    "activity_type", "sample_media", "sample_media_subdivision", "method_name",
    "method_specification", "organization_id", "analytical_fraction",
    "result_depth", "result_depth_unit",
)
DEFAULT_INTERPRETATION = {
    "columns": {}, "below_qualifiers": ["<", "<="], "above_qualifiers": [">", ">="],
    "numeric_qualifiers": [""], "nonnegative": False, "use_limit_unit_when_missing": False,
}
SELECTION_KEYS = {"observation_id", "network_id", "plan_id", "campaign_id",
                  "station_mapping", "title", "interpretation"}
INLINE_LIMIT = re.compile(r"^\s*(<=|>=|<|>|≤|≥)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$")
FLOW_UNAVAILABLE = {
    "status": "not_received",
    "reason": "No daily-flow series was selected for this native observation context.",
}


def _text(value, label, *, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise ContractError(label + " must be original text")
    return value


def _number(value, label):
    if isinstance(value, bool):
        raise ContractError(label + " must be finite")
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError) as error:
        raise ContractError(label + " must be finite") from error
    if not math.isfinite(result):
        raise ContractError(label + " must be finite")
    return result


def interpretation(value, columns):
    if not isinstance(value, dict) or set(value) - set(DEFAULT_INTERPRETATION):
        raise ContractError("Choose the explicit original-column and qualifier interpretation")
    result = deepcopy(DEFAULT_INTERPRETATION)
    result.update(deepcopy(value))
    if any(type(result[key]) is not bool for key in ("nonnegative", "use_limit_unit_when_missing")):
        raise ContractError("Nonnegative support and missing-unit choices must be explicit booleans")
    selected = result["columns"]
    if not isinstance(selected, dict) or set(selected) - set(OPTIONAL_COLUMNS):
        raise ContractError("Optional mapping contains an unsupported context field")
    if any(not isinstance(column, str) or (column and column not in columns) for column in selected.values()):
        raise ContractError("Optional mappings must select exact retained original column names")
    groups = []
    for key in ("below_qualifiers", "above_qualifiers", "numeric_qualifiers"):
        values = result[key]
        if not isinstance(values, list) or any(not isinstance(token, str) or token != token.strip() for token in values):
            raise ContractError("Qualifier meanings must list exact retained tokens without surrounding whitespace")
        if len(values) != len(set(values)):
            raise ContractError("A qualifier meaning repeats")
        result[key] = sorted(values)
        groups.append(set(values))
    if any(groups[a] & groups[b] for a in range(3) for b in range(a + 1, 3)):
        raise ContractError("Each qualifier must have only one explicit meaning")
    return result


def _native(workspace, observation_id):
    key = identifier(observation_id)
    value = workspace._get("observations", key)
    if (value.get("schema") != "upstate.observations/v1"
            or not isinstance(value.get("metadata"), dict)
            or not isinstance(value.get("rows"), list)
            or any(not isinstance(row, dict) for row in value["rows"])
            or not isinstance(value.get("columns"), list)
            or any(not isinstance(column, str) for column in value["columns"])
            or len(value["columns"]) != len(set(value["columns"]))):
        raise ContractError("The native observation record lacks its original rows, columns or metadata")
    original = value.get("original")
    if not isinstance(original, dict) or not original.get("object"):
        raise ContractError("The native observation record lacks its retained original file")
    verify_file(workspace.root, {**original, "path": original["object"]})
    record = relative_file(workspace.root, "observations/" + key + ".json")
    return value, record


def catalog(workspace):
    values = []
    for path in sorted((workspace.root / "observations").glob("*.json")):
        source, _ = _native(workspace, path.stem)
        metadata = source.get("metadata", {})
        rows = source["rows"]
        values.append({
            "observation_id": source["id"], "title": metadata.get("title", source["id"]),
            "rows": len(rows), "columns": deepcopy(source["columns"]),
            "stations": sorted({str(row.get("station_id", "")) for row in rows}),
            "qualifiers": sorted({str(row.get("qualifier") or "").strip() for row in rows}),
            "source_uri": metadata.get("source_uri"),
            "value_basis": metadata.get("value_basis"),
            "original_mapping": deepcopy(metadata.get("columns", {})),
            "interpretation": deepcopy(DEFAULT_INTERPRETATION),
            "optional_columns": list(OPTIONAL_COLUMNS),
        })
    return {"observations": values}


def _selection(workspace, selection, source):
    if not isinstance(selection, dict) or set(selection) - SELECTION_KEYS:
        raise ContractError("Select an original observation, native network and explicit interpretation")
    title = _text(selection.get("title"), "Context title").strip()
    mapping = selection.get("station_mapping", {})
    if not isinstance(mapping, dict) or any(not isinstance(k, str) or not k or
            not isinstance(v, str) or not v for k, v in mapping.items()):
        raise ContractError("Station mapping must use exact source and saved network IDs")
    network, plan, campaign = observed._selection(
        workspace, selection.get("network_id"), selection.get("plan_id"), selection.get("campaign_id"))
    source_ids = {str(row.get("station_id") or "") for row in source["rows"]}
    network_ids = {row["id"] for row in network["stations"]}
    if set(mapping) - source_ids or set(mapping.values()) - network_ids or len(set(mapping.values())) != len(mapping):
        raise ContractError("Explicit station mapping must select distinct existing native stations")
    result = {
        "observation_id": source["id"], "network_id": network["id"],
        "plan_id": plan["id"] if plan and not campaign else None,
        "campaign_id": campaign["revision"]["campaign_id"] if campaign else None,
        "station_mapping": deepcopy(mapping), "title": title,
        "interpretation": interpretation(selection.get("interpretation", {}), source["columns"]),
    }
    return result, network


def _optional(row, metadata, options, field):
    # A deliberately blank optional mapping disables a retained default.
    if field in options["columns"]:
        column = options["columns"][field]
        return (column != ""), row.get("original", {}).get(column) if column else None
    column = metadata.get("columns", {}).get(field)
    if column:
        return column in row.get("original", {}), row.get("original", {}).get(column)
    if field in row:
        return True, row[field]
    if field in metadata:
        return True, metadata[field]
    return False, None


def _day(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError("Original date needs one complete ISO calendar day")
    return value


def _row(source, row, options):
    metadata = source.get("metadata", {})
    row_id = _text(row.get("id"), "Original row ID")
    raw = row.get("original")
    if not isinstance(raw, dict):
        raise ContractError("Each native row must retain its original cells")
    picked = {field: _optional(row, metadata, options, field) for field in OPTIONAL_COLUMNS}
    def text(field):
        present, value = picked[field]
        return str(value).strip() if present and value is not None else ""
    station = str(row.get("station_id") or "")
    activity = text("activity") or source["id"] + ":" + row_id
    result = {
        "observation_id": digest({"observation_id": source["id"], "original_record_id": row_id}),
        "original_observation_id": source["id"], "original_record_id": row_id,
        "source_row": row.get("line"), "source_file": deepcopy(source["original"]),
        "original_cells": deepcopy(raw), "original_record": deepcopy(row),
        "station_id": station, "activity_id": activity,
        "activity_identity_basis": "original_activity" if text("activity") else "original_record",
        "date": row.get("period_start"),
        "characteristic": row.get("original_parameter", row.get("parameter")),
        "method": row.get("method"), "unit": row.get("unit"), "original_unit": row.get("unit"),
        "qualifier": str(row.get("qualifier") or "").strip(),
        "result_text": str(row.get("value_text") or ""),
        "result_value": None, "limit_value": None, "lower": None, "upper": None,
        "lower_unbounded": False, "upper_unbounded": False,
        "status": "uninterpreted",
        "sampling_cohort_schema": "upstate.native-observation-sampling-cohort/v1",
    }
    # Preserve field presence, nulls and blank original values in cohort keys.
    names = {
        "fraction": ("fraction", "sample_fraction"),
        "depth": ("depth_value",), "depth_unit": ("depth_unit",),
        "method_authority": ("method_context",),
        "value_type": ("value_type", "result_value_type"),
        "project": ("project_id",), "time": ("time",), "timezone": ("timezone",),
        "comment": ("comment",), "result_depth": ("result_depth_value",),
        "result_depth_unit": ("result_depth_unit",),
    }
    for field, (present, value) in picked.items():
        if not present or field in ("activity", "reporting_limit", "reporting_limit_unit"):
            continue
        for key in names.get(field, (field,)):
            result[key] = deepcopy(value)
    for key in ("time_support", "quantity_basis", "measurement_support"):
        if key in row:
            result[key] = deepcopy(row[key])
    if "species" in row:
        result["speciation"] = deepcopy(row["species"])
    if "method" in row:
        result["method_id"] = deepcopy(row["method"])
    reasons = []
    try:
        _day(result["date"])
        if row.get("period_end") and row["period_end"] != result["date"]:
            reasons.append("Multi-day original support is not a single-day observation")
    except (ValueError, TypeError):
        reasons.append("Original date needs one complete ISO calendar day")
    if metadata.get("value_basis") == "annual_mass_rate":
        reasons.append("Annual mass-rate records remain in their original native load comparison")
    qualifier = result["qualifier"]
    raw_value = result["result_text"].strip()
    inline = INLINE_LIMIT.fullmatch(raw_value)
    direction = ("below" if qualifier in options["below_qualifiers"] else
                 "above" if qualifier in options["above_qualifiers"] else
                 "numeric" if qualifier in options["numeric_qualifiers"] else None)
    if inline:
        inline_direction = "below" if inline[1] in ("<", "<=", "≤") else "above"
        if qualifier and direction != inline_direction:
            reasons.append("Inline limit and original qualifier have different or unreviewed meanings")
        direction = inline_direction
    limit_text, limit_unit = text("reporting_limit"), text("reporting_limit_unit")
    result["limit_unit"] = limit_unit if picked["reporting_limit_unit"][0] else result["unit"]
    if limit_text:
        try:
            result["limit_value"] = _number(limit_text, "Original reporting limit")
        except ValueError as error:
            reasons.append(str(error))
    try:
        if direction in ("below", "above"):
            limit = _number(limit_text or (inline[2] if inline else raw_value), "Original reporting limit")
            unit = result["unit"]
            if not unit and limit_unit and options["use_limit_unit_when_missing"]:
                result["unit"] = limit_unit
                result["unit_origin"] = "Original reporting-limit unit; explicit missing-unit choice"
            if limit_unit and limit_unit != result["unit"]:
                raise ContractError("Reporting-limit and measurement units differ; no conversion was selected")
            if options["nonnegative"] and limit < 0:
                raise ContractError("Negative limit conflicts with selected nonnegative support")
            result["limit_value"] = limit
            result["limit_unit"] = limit_unit or result["unit"]
            if direction == "below":
                result.update(lower=0.0 if options["nonnegative"] else None, upper=limit,
                              lower_unbounded=not options["nonnegative"], status="below_limit")
            else:
                result.update(lower=limit, upper=None, upper_unbounded=True, status="above_limit")
            # No "<" versus "<=" meaning is invented for a textual qualifier.
            if inline:
                result["limit_operator"] = inline[1]
        elif direction == "numeric" and not inline:
            number = _number(raw_value, "Original result")
            if options["nonnegative"] and number < 0:
                raise ContractError("Negative result conflicts with selected nonnegative support")
            result.update(result_value=number, lower=number, upper=number, status="measured")
        else:
            reasons.append("Original qualifier has no explicitly selected numeric or limit meaning: " + repr(qualifier))
    except (ValueError, TypeError) as error:
        reasons.append(str(error))
    if not station or not result["characteristic"] or not result["unit"]:
        reasons.append("Original station, characteristic and measurement unit are required")
    if reasons:
        result["reasons"] = list(dict.fromkeys(reasons))
    return result


def _stations(source, selected, network):
    originals = sorted({str(row.get("station_id") or "") for row in source["rows"] if row.get("station_id")})
    native = {row["id"]: row for row in network["stations"]}
    result = []
    for key in originals:
        target = selected["station_mapping"].get(key, key)
        retained = native.get(target)
        point = retained.get("geometry", {}) if retained else {}
        coords = point.get("coordinates") if point.get("type") == "Point" else None
        item = {"station_id": key, "station_name": key, "longitude": None, "latitude": None,
                "datum": None, "coordinate_origin": "not_received"}
        if coords and len(coords) >= 2:
            item.update(longitude=coords[0], latitude=coords[1], datum="WGS84",
                        coordinate_origin="retained_network_station",
                        coordinate_network_station_id=target,
                        coordinate_network_id=network["id"],
                        coordinate_source_bindings=deepcopy(network.get("source_bindings", {})))
        result.append(item)
    return result


def _document(workspace, source, record_path, selected, network):
    binding = {
        "observation_id": source["id"], "project_id": workspace.project["id"],
        "record_sha256": file_sha256(record_path), "original_file": deepcopy(source["original"]),
        "source_uri": source.get("metadata", {}).get("source_uri"),
        "title": source.get("metadata", {}).get("title", source["id"]),
        "original_mapping": deepcopy(source.get("metadata", {}).get("columns", {})),
        "original_options": deepcopy(source.get("metadata", {})),
        "selection": deepcopy(selected), "row_count": len(source["rows"]),
    }
    rows = [_row(source, row, selected["interpretation"]) for row in source["rows"]]
    if len({row["original_record_id"] for row in rows}) != len(rows):
        raise ContractError("Original native row IDs repeat")
    # An activity is one original station/date. Ambiguous original IDs remain excluded.
    activity_dates = {}
    for row in rows:
        if "reasons" not in row:
            activity_dates.setdefault((row["station_id"], row["activity_id"]), set()).add(row["date"])
    for row in rows:
        if len(activity_dates.get((row["station_id"], row["activity_id"]), set())) > 1:
            row.setdefault("reasons", []).append("Original activity ID refers to more than one date")
    included = [row for row in rows if "reasons" not in row]
    excluded = [row for row in rows if "reasons" in row]
    dates = []
    for row in rows:
        try:
            dates.append(_day(row["date"]))
        except (ValueError, TypeError):
            pass
    if not dates:
        raise ContractError("No original ISO observation date is available; inspect the original import mapping")
    activities = {}
    for row in included:
        key = (row["station_id"], row["activity_id"])
        item = {"station_id": row["station_id"], "activity_id": row["activity_id"], "date": row["date"],
                "activity_identity_basis": row["activity_identity_basis"]}
        if "activity_type" in row:
            item["activity_type"] = row["activity_type"]
        activities.setdefault(key, item)
    value = {
        "schema": observed.CONCENTRATION_SOURCE_SCHEMA, "title": selected["title"],
        "source_edition": digest({"edition": EDITION, "native": binding, "network": digest(network)}),
        "native_observation_binding": binding,
        "source_period": {"start_inclusive": min(dates), "end_inclusive": max(dates)},
        "flow_scope": {"mode": "unavailable", "station_ids": []},
        "flow_availability": deepcopy(FLOW_UNAVAILABLE),
        "stations": _stations(source, selected, network),
        "activities": list(activities.values()), "observations": included, "excluded_observations": excluded,
        "daily_flow": [], "relations": [], "annual_coverage": [], "station_year_coverage": [],
        "monthly_coverage": [], "high_flow_episodes": [], "paired_contrasts": [],
        "interpretation": [
            "Values are original source observations with explicit qualifier and unit choices; censored limits are not measured values.",
            "All original rows, raw cells, original import mapping and the exact original file remain retained; excluded rows carry their individual reasons.",
            "When no original activity identifier is selected, an explicit original_record identity groups that row only; it does not establish a separate field activity or visit.",
            "No daily-flow series was selected or inferred from these observation rows. Flow-linked episodes, event coverage, mass loads and modeled export comparisons are unavailable.",
            "Station assignment uses only an existing native network station with exact identifier or explicit mapping. Network geometry is labeled as such.",
            "Methods, fractions, depth, value type, units, project metadata and declared time/quantity/measurement support remain separate original Sampling cohorts; no unit conversion is performed.",
        ],
    }
    observed._validate(value)
    return value


def _cohorts(context):
    from .monitoring_recommendations import _cohort
    values = {}
    for row in context["observations"]:
        key, fields = _cohort(row)
        item = values.setdefault(key, {"id": key, "fields": fields, "observation_count": 0,
                                      "station_ids": set(), "original_record_ids": []})
        item["observation_count"] += 1
        item["station_ids"].add(row["station_id"])
        item["original_record_ids"].append(row["original_record_id"])
    return [{**item, "station_ids": sorted(item["station_ids"])} for _, item in sorted(values.items())]


def _preview(workspace, selection):
    if not isinstance(selection, dict):
        raise ContractError("The native observation selection must be an object")
    source, record_path = _native(workspace, selection.get("observation_id"))
    selected, network = _selection(workspace, selection, source)
    document = _document(workspace, source, record_path, selected, network)
    body = canonical_bytes(document)
    binding = {"source_id": None, "source_collection_id": None, "source_record_id": None,
               "title": selected["title"], "filename": "observed-context.json",
               "bytes": len(body), "object_sha256": hashlib.sha256(body).hexdigest()}
    context = observed._preview(workspace, value=document, binding=binding,
        network_id=selected["network_id"], plan_id=selected["plan_id"],
        campaign_id=selected["campaign_id"], station_mapping=selected["station_mapping"], title=selected["title"])
    identity = digest({"edition": EDITION, "selection": selected, "document": binding["object_sha256"],
                       "context": context})
    result = {"id": identity, "selection": selected, "source": document["native_observation_binding"],
              "context": context, "cohorts": _cohorts(context),
              "summary": {**context["summary"], "included_source_rows": len(document["observations"]),
                          "excluded_source_rows": len(document["excluded_observations"]),
                          "status_counts": dict(Counter(row["status"] for row in document["observations"]))}}
    return result, document, source, record_path


def preview(workspace, *, selection):
    return _preview(workspace, selection)[0]


def verify_binding(workspace, binding):
    if not isinstance(binding, dict):
        raise ContractError("Native observation provenance must be a retained object")
    identifier(binding.get("observation_id"))
    identifier(binding.get("record_sha256"))
    if binding.get("project_id") != workspace.project["id"]:
        return  # Foreign ordinary source remains complete in its original CAS companions.
    source, path = _native(workspace, binding["observation_id"])
    if (file_sha256(path) != binding["record_sha256"]
            or source["original"] != binding.get("original_file")
            or len(source["rows"]) != binding.get("row_count")
            or source.get("metadata", {}).get("columns", {}) != binding.get("original_mapping")
            or source.get("metadata", {}) != binding.get("original_options")):
        raise ContractError("The saved native observation binding differs from its original import")


def prepare(workspace, *, selection, expected_preview_id):
    result, document, source, record_path = _preview(workspace, selection)
    if identifier(expected_preview_id) != result["id"]:
        raise ContractError("The original observation, network or interpretation changed; preview the same selection again")
    source_id = "native-observations-" + result["id"]
    with tempfile.TemporaryDirectory(prefix="monitoring-native-context-") as directory:
        folder = Path(directory)
        (folder / "observed-context.json").write_bytes(canonical_bytes(document))
        original = relative_file(workspace.root, source["original"]["object"])
        # Byte-exact source files; neither the native importer nor its record is modified.
        (folder / "original.csv").write_bytes(original.read_bytes())
        (folder / "original-native-observation.json").write_bytes(record_path.read_bytes())
        (folder / "native-selection.json").write_bytes(canonical_bytes(result["selection"]))
        manifest = {"schema": "upstate.sources/v1", "title": result["selection"]["title"],
            "notes": document["interpretation"], "entries": [{
                "id": source_id, "title": result["selection"]["title"],
                "uri": "urn:upstate:native-observation-context:" + workspace.project["id"] + ":" + result["id"],
                "vintage": document["source_period"]["end_inclusive"],
                "kind": "document", "role": "monitoring_observed_context",
                "path": "observed-context.json", "sha256": result["context"]["source_binding"]["object_sha256"],
                "metadata": {"native_observation_id": source["id"], "context_schema": document["schema"],
                             "preview_id": result["id"], "flow_availability": "not_received"},
                "companions": [
                    {"path": "original.csv", "sha256": source["original"]["sha256"]},
                    {"path": "original-native-observation.json", "sha256": document["native_observation_binding"]["record_sha256"]},
                    {"path": "native-selection.json", "sha256": digest(result["selection"])},
                ],
            }]}
        (folder / "manifest.json").write_bytes(canonical_bytes(manifest))
        verify_binding(workspace, document["native_observation_binding"])
        collection = workspace.import_sources(folder / "manifest.json")
    selected = result["selection"]
    actual = observed.preview(workspace, source_collection_id=collection["id"], source_id=source_id,
        network_id=selected["network_id"], plan_id=selected["plan_id"], campaign_id=selected["campaign_id"],
        station_mapping=selected["station_mapping"], title=selected["title"])
    if ({k: v for k, v in actual.items() if k != "source_binding"}
            != {k: v for k, v in result["context"].items() if k != "source_binding"}):
        raise ContractError("Native context projection changed during source preparation")
    saved = workspace._save(observed.COLLECTION, actual)
    return observed.inspect(workspace, saved["id"])


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog")
    for name in ("preview", "prepare"):
        command = commands.add_parser(name)
        command.add_argument("--selection", type=Path, required=True)
        if name == "prepare":
            command.add_argument("--expected-preview-id", required=True)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.command == "catalog":
        result = catalog(workspace)
    else:
        selection = json.loads(args.selection.read_text(encoding="utf-8"))
        result = (preview(workspace, selection=selection) if args.command == "preview" else
                  prepare(workspace, selection=selection, expected_preview_id=args.expected_preview_id))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
