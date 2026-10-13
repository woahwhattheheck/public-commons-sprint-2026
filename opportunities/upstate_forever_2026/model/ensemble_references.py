"""Resolve imported annual-load source bindings for saved scientific studies.

The original import owns estimation, observation admission and catchment choice.
This adapter retains those exact identities and exposes their published context.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy

from .common import describe_file, identifier, read_json, verify_file

OPTIONS = frozenset({
    "title", "observation_record_ids", "catchment_groups",
    "calibration_group_ids", "validation_group_ids", "objective",
    "delivered_external_loads", "notes", "leave_group_out", "temporal_weighting",
})


def _summary(observations):
    rows = [row for row in observations["rows"] if row.get("admitted")]
    metadata = observations["metadata"]
    groups = {}
    for row in rows:
        key = (row["parameter"], row["unit"], row.get("comparison_units"),
               row.get("method"), row.get("period_start"), row.get("period_end"))
        item = groups.setdefault(key, {
            "parameter": key[0], "original_unit": key[1], "comparison_unit": key[2],
            "method": key[3], "period_start": key[4], "period_end_exclusive": key[5],
            "records": 0, "published_standard_error_records": 0,
        })
        item["records"] += 1
        uncertainty = row.get("uncertainty")
        if (isinstance(uncertainty, dict)
                and uncertainty.get("kind") == "published standard error"
                and uncertainty.get("value") is not None):
            item["published_standard_error_records"] += 1
    return {
        "title": metadata["title"], "source_uri": metadata["source_uri"],
        "release": metadata.get("release"), "value_basis": metadata.get("value_basis"),
        "annualization_method": metadata.get("annualization_method"),
        "source_notes": deepcopy(metadata.get("notes", [])),
        "admitted_count": len(rows), "context_count": observations.get("context_count", 0),
        "parameters": sorted({row["parameter"] for row in rows}),
        "stations": sorted({row["station_id"] for row in rows if row.get("station_id")}),
        "catchment_ids": sorted({row["catchment_id"] for row in rows}),
        "period_method_groups": sorted(groups.values(), key=lambda row: (
            row["parameter"], str(row["period_start"]), str(row["period_end_exclusive"]), str(row["method"]))),
        "qualifiers": dict(sorted(Counter(row.get("qualifier", "") for row in rows).items())),
        "recommended_temporal_weighting": metadata.get("recommended_temporal_weighting", "whole_years"),
    }


def resolve(workspace, import_id, *, verify=False, include_records=True):
    """Read one completed original import; all retained paths stay relative."""
    key = identifier(import_id)
    directory = workspace.root / "annual-references" / key
    operation_path = directory / "operation.json"
    operation = read_json(operation_path)
    if (operation.get("task_id") != key or operation.get("project_id") != workspace.project["id"]
            or operation.get("action") != "annual-reference.import" or operation.get("state") != "complete"):
        raise ValueError("Choose a completed annual-reference import in this original workspace")
    result = operation.get("result") or {}
    binding = result.get("binding")
    if not isinstance(binding, dict) or binding.get("workspace_id") != workspace.project["id"]:
        raise ValueError("The annual-reference binding belongs to another workspace")
    if binding.get("original_preparation_id") != result.get("preparation_id"):
        raise ValueError("The imported annual-reference preparation identity differs")
    identifier(binding["original_preparation_id"])
    observations = workspace._get("observations", identifier(binding.get("observation_id")))
    if (observations["metadata"].get("value_basis") != "annual_mass_rate"
            or observations.get("admitted_count", 0) <= 0
            or binding.get("admitted_count") != observations["admitted_count"]):
        raise ValueError("This original import must contain admitted annual mass-rate observations")
    catchments = binding.get("catchments")
    if (not isinstance(catchments, dict) or not catchments.get("source_id")
            or not catchments.get("id_field")
            or catchments.get("source_collection_id") != binding.get("source_collection_id")):
        raise ValueError("The original import has no matching retained catchment binding")
    collection = workspace._get("sources", identifier(catchments["source_collection_id"]))
    matches = [entry for entry in collection["entries"] if entry["id"] == catchments["source_id"]]
    if len(matches) != 1 or matches[0].get("kind") != "vector":
        raise ValueError("The annual-reference catchment source is absent from its retained collection")
    source = matches[0]
    if source.get("id_field") and source["id_field"] != catchments["id_field"]:
        raise ValueError("The bound catchment identity field differs from its original source")
    if verify:
        # These are the original producer's prepared records, geometry, binding and manifest.
        for item in result.get("documents", []):
            verify_file(workspace.root, item)
        prepared = read_json(directory / "prepared" / "result.json")
        if prepared.get("id") != binding["original_preparation_id"]:
            raise ValueError("The retained annual-reference preparation changed")
    summary = _summary(observations)
    weighting = binding.get("recommended_temporal_weighting", summary["recommended_temporal_weighting"])
    if weighting not in {"whole_years", "elapsed_days"}:
        raise ValueError("Choose the original source-supported temporal weighting")
    selection = {
        "observation_id": observations["id"], "catchments": deepcopy(catchments),
        "temporal_weighting": weighting,
    }
    reference = {
        "import_id": key, "title": operation["title"], "source_edition": operation.get("source_edition", "f7dn436b"),
        "workspace_id": workspace.project["id"], "binding": deepcopy(binding),
        "selection": selection, "summary": summary,
        "source_collection_id": collection["id"], "original_preparation_id": binding["original_preparation_id"],
        "catchment_source": {name: source.get(name) for name in
                             ("id", "title", "uri", "vintage", "id_field", "body")},
        "operation": describe_file(workspace.root, operation_path),
    }
    if include_records:
        reference["reference_records"] = []
        for row in observations["rows"]:
            if not row.get("admitted"):
                continue
            original = row.get("source_records")
            reference["reference_records"].append({
                "id": row["id"], "record_id": row["id"], "observation_id": observations["id"],
                "original_preparation_id": binding["original_preparation_id"],
                "station_id": row.get("station_id"), "catchment_id": row["catchment_id"],
                "flow_station_id": original.get("flow_station_id") if isinstance(original, dict) else None,
                "parameter": row["parameter"], "method": row.get("method"),
                "period_start": row["period_start"], "period_end": row["period_end"],
                "unit": row["unit"], "comparison_units": row.get("comparison_units"),
                "source_records": deepcopy(original),
            })
    return reference


def catalog(workspace, *, include_records=False):
    """Read available source bindings without native geometry or raster work."""
    available, errors = [], []
    for path in sorted((workspace.root / "annual-references").glob("*/operation.json")):
        try:
            record = read_json(path)
            if record.get("action") != "annual-reference.import" or record.get("state") != "complete":
                continue
            available.append(resolve(workspace, path.parent.name, include_records=include_records))
        except (ValueError, OSError, KeyError, TypeError) as error:
            errors.append({"import_id": path.parent.name, "error": str(error)})
    return {"imports": available, "errors": errors}


def selection(workspace, import_id, options=None):
    """Keep the original observation and spatial support binding fixed."""
    reference = resolve(workspace, import_id, verify=True)
    if options is None:
        options = {}
    if not isinstance(options, dict) or set(options) - OPTIONS:
        raise ValueError("Annual-import options may change analysis choices, not its original observation/catchment binding")
    value = {**deepcopy(reference["selection"]), **deepcopy(options)}
    return value, reference
