"""Retain actual observations and compare annual N/P/sediment loads spatially."""
from __future__ import annotations
import csv
import datetime as dt
import io
import json
import math
from pathlib import Path
from .common import atomic_json, digest, finite, now, read_json, retain_file, verify_file
from . import rasters, observation_support, observation_diagnostics

COMPARISON_SCHEMA_VERSION = 7
NATIVE = {"nitrogen": ("ndr", "n_total_export", "kg/year"),
          "phosphorus": ("ndr", "p_surface_export", "kg/year"),
          "sediment": ("sdr", "sed_export", "metric_tonnes/year")}
MASS_FACTORS = {
    "nitrogen": {"kg/year": 1, "kg/yr": 1, "g/year": .001, "g/yr": .001,
                 "metric_tonnes/year": 1000, "t/year": 1000, "t/yr": 1000},
    "phosphorus": {"kg/year": 1, "kg/yr": 1, "g/year": .001, "g/yr": .001,
                   "metric_tonnes/year": 1000, "t/year": 1000, "t/yr": 1000},
    "sediment": {"metric_tonnes/year": 1, "t/year": 1, "t/yr": 1,
                 "kg/year": .001, "kg/yr": .001, "g/year": .000001},
}

def ingest(workspace, path, metadata):
    """Preserve all rows; admit only explicitly derived annual mass-rate values."""
    metadata = dict(metadata)
    annual = metadata.get("value_basis") == "annual_mass_rate"
    constants = {} if annual else metadata.get("constants", {})
    if not isinstance(constants, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                                              for k, v in constants.items()):
        raise ValueError("Context constants must use explicit text field names and values")
    if not metadata.get("title") or not metadata.get("source_uri"):
        raise ValueError("Actual observations need a title and original source URI")
    columns = {key: key for key in ("record_id", "station_id", "catchment_id",
                                    "parameter", "value", "unit", "period_start",
                                    "period_end", "qualifier", "method",
                                    "uncertainty", "source_records")}
    columns.update({key: key for key in observation_support.FIELDS})
    columns.update(metadata.get("columns", {}))
    original = retain_file(workspace.root, path, metadata.get("sha256"))
    raw = (workspace.root / original["object"]).read_text(encoding="utf-8-sig")
    table = csv.DictReader(io.StringIO(raw))
    required_keys = ("parameter", "value", "unit")
    required = [columns[k] for k in required_keys if k not in constants]
    if (not table.fieldnames or len(table.fieldnames) != len(set(table.fieldnames))
            or set(required) - set(table.fieldnames)):
        raise ValueError("Observation CSV requires distinct headers and the selected parameter, value and unit columns; catchment load rows also require original catchment identifiers")
    parameter_names = {"nitrogen": "nitrogen", "phosphorus": "phosphorus", "sediment": "sediment"}
    parameter_names.update(metadata.get("parameter_mapping", {}))
    if annual and not metadata.get("annualization_method"):
        raise ValueError("State the original method used to obtain annual load rates")
    accepted_qualifiers = set(str(v) for v in metadata.get("accepted_qualifiers", [""]))
    rows, ids = [], set()
    for number, original_row in enumerate(table, 2):
        if None in original_row:
            raise ValueError("CSV row has extra cells at line " + str(number))
        def cell(name, default=""):
            value = constants[name] if name in constants else original_row.get(columns[name], default)
            return str(value).strip() if value is not None else default
        def retained_detail(name):
            value = cell(name)
            if not value:
                return metadata.get(name)
            def reject_constant(token):
                raise ValueError("Nonfinite JSON detail: " + token)
            try:
                return json.loads(value, parse_constant=reject_constant)
            except (ValueError, TypeError):
                return value
        row_id = cell("record_id") or str(number - 1)
        if row_id in ids:
            raise ValueError("Observation record IDs must be unique")
        ids.add(row_id)
        parameter = parameter_names.get(cell("parameter"), cell("parameter"))
        row = {"id": row_id, "line": number, "original": original_row,
               "station_id": cell("station_id"), "catchment_id": cell("catchment_id"),
               "parameter": parameter, "value_text": cell("value"), "unit": cell("unit"),
               "qualifier": cell("qualifier"),
               "period_start": cell("period_start", metadata.get("period_start", "")),
               "period_end": cell("period_end", metadata.get("period_end", "")),
               "method": cell("method") or metadata.get("method") or metadata.get("annualization_method"),
               "uncertainty": retained_detail("uncertainty"),
               "source_records": retained_detail("source_records"),
               "admitted": False, "issues": []}
        row.update(observation_support.attributes(cell, metadata, parameter))
        row["native_comparison_issues"] = observation_support.comparison_issues(row, metadata)
        if annual:
            row["issues"].extend(row["native_comparison_issues"])
        try:
            row["value"] = finite(row["value_text"], "Observed value", minimum=0 if annual else None)
        except (ValueError, TypeError) as error:
            if annual:
                row["issues"].append(str(error))
            else:
                row["numeric_status"] = "Original value is not quantified numerically"
        if annual:
            if row["measurement_support"] == "catchment_export" and not row["catchment_id"]:
                row["issues"].append("No original catchment ID")
            if parameter not in NATIVE:
                row["issues"].append("This measurement is outside the native N/P/sediment annual-load comparison")
            elif row["unit"] not in MASS_FACTORS[parameter]:
                row["issues"].append("Select an explicit annual mass-rate unit")
            if row["qualifier"] not in accepted_qualifiers:
                row["issues"].append("Source qualifier is outside the selected accepted qualifier set")
        if annual or row["period_start"] or row["period_end"]:
            try:
                start = dt.date.fromisoformat(row["period_start"])
                if row["period_end"]:
                    end = dt.date.fromisoformat(row["period_end"])
                    if end < start or (annual and end == start):
                        raise ValueError()
                    row["period_days"] = (end - start).days + int(
                        not annual and metadata.get("period_end_inclusive") is True)
                elif annual:
                    raise ValueError()
            except (ValueError, TypeError):
                row["issues"].append("A complete original observation period is required" if annual
                                     else "Review the original context date or interval")
        if not annual:
            row["context_kind"] = metadata.get("observation_kind", "source_context")
            row["time_support"] = metadata.get("time_support", "original")
        if annual and not row["issues"]:
            row["admitted"] = True
            row["annual_mass"] = row["value"] * MASS_FACTORS[parameter][row["unit"]]
            row["comparison_units"] = NATIVE[parameter][2]
        rows.append(row)
    if not rows:
        raise ValueError("Observation CSV has no rows")
    return workspace._save("observations", {
        "metadata": metadata, "original": original, "columns": table.fieldnames,
        "rows": rows, "admitted_count": sum(r["admitted"] for r in rows),
        "context_count": sum(not r["admitted"] for r in rows),
        "support_summary": observation_support.summarize(rows),
    })

def catchment_load(path, geometry, stream_path, *, stream_source=None):
    """Retain native mass and distinguish original stream omissions from missing support."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.errors import WindowError
    from pyproj import CRS
    from shapely.geometry import Polygon

    if (geometry.is_empty or not geometry.is_valid
            or geometry.geom_type not in ("Polygon", "MultiPolygon")
            or not math.isfinite(geometry.area) or geometry.area <= 0):
        return {"annual_mass": None, "selected_cells": 0, "valid_cells": 0,
                "covered_area_ha": 0, "complete_catchment": False,
                "coverage_issues": ["The original catchment is not a valid nonempty polygon"],
                "issue": "The original catchment is not a valid nonempty polygon"}
    with rasterio.open(path) as src, rasterio.open(stream_path) as streams:
        crs = CRS.from_user_input(src.crs)
        factors = [a.unit_conversion_factor for a in crs.axis_info[:2]]
        if not crs.is_projected or len(factors) != 2 or any(abs(v - 1) > 1e-8 for v in factors):
            raise ValueError("Native load aggregation requires projected metre coordinates")
        if (src.crs != streams.crs or src.transform != streams.transform
                or src.width != streams.width or src.height != streams.height):
            raise ValueError("Original same-stage stream and export grids differ")
        cell_area_ha = abs(src.transform.a * src.transform.e - src.transform.b * src.transform.d) / 10000
        # A clipped read window is never a whole-catchment denominator.
        extent = Polygon([src.transform * corner for corner in
                          ((0, 0), (src.width, 0), (src.width, src.height), (0, src.height))])
        outside_area_ha = geometry.difference(extent).area / 10000
        area_ha = geometry.area / 10000
        within_extent = extent.covers(geometry)
        coverage = {
            "catchment_area_ha": area_ha,
            "catchment_area_outside_raster_ha": outside_area_ha,
            "raster_extent_coverage_fraction": max(0.0, min(1.0, 1 - outside_area_ha / area_ha)),
            "catchment_within_raster_extent": within_extent,
            "raster_extent_crs": src.crs.to_string(),
            "raster_extent_coordinates": [list(point) for point in extent.exterior.coords],
            "native_cell_area_ha": cell_area_ha,
            "native_stream_source": stream_source,
            "coverage_basis": "Whole source polygon against the original affine raster extent; "
                              "pixel-centre support distinguishes valid native exports, original "
                              "NoData on same-stage stream cells and unexpected missing support. "
                              "Covered cell area is a grid measure.",
            "structural_stream_policy": "Only export cells masked by the original raster NoData "
                                        "and marked 1 in the verified same-stage stream raster are "
                                        "declared structural omissions. No mass is added or imputed.",
        }
        try:
            selected_window = geometry_window(src, [geometry.__geo_interface__])
        except WindowError:
            issue = "Catchment is outside the original native model output"
            return {**coverage, "annual_mass": None, "selected_cells": 0, "valid_cells": 0,
                    "covered_area_ha": 0, "valid_fraction_of_selected_cells": None,
                    "native_support_fraction": None, "structural_stream_omission_cells": 0,
                    "unexpected_missing_cells": 0, "complete_catchment": False,
                    "coverage_issues": [issue], "issue": issue}
        total, selected, valid = 0.0, 0, 0
        stream_cells = structural = missing_nonstream = unknown_missing = nonfinite_stream = 0
        unknown_stream_support = 0
        block_height, block_width = src.block_shapes[0]
        windows = (rasterio.windows.Window(col, row, min(block_width, src.width-col),
                                          min(block_height, src.height-row))
                   for row in range(int(selected_window.row_off) // block_height * block_height,
                                    math.ceil(selected_window.row_off + selected_window.height), block_height)
                   for col in range(int(selected_window.col_off) // block_width * block_width,
                                    math.ceil(selected_window.col_off + selected_window.width), block_width))
        for window in windows:
            block = src.read(1, window=window, masked=True)
            stream_block = streams.read(1, window=window, masked=True)
            inside = geometry_mask([geometry.__geo_interface__], out_shape=block.shape,
                                   transform=src.window_transform(window), invert=True, all_touched=False)
            masked = np.ma.getmaskarray(block)
            good = inside & ~masked & np.isfinite(block.data)
            stream_known = (~np.ma.getmaskarray(stream_block)
                            & np.isfinite(stream_block.data)
                            & ((stream_block.data == 0) | (stream_block.data == 1)))
            is_stream = inside & stream_known & (stream_block.data == 1)
            missing = inside & ~good
            # Original stream NoData is expected by NDR/SDR. An unmasked
            # nonfinite export is still an error even on a stream cell.
            structural_mask = missing & masked & is_stream
            if np.any(block.data[good] < 0):
                raise ValueError("Original modeled export contains negative mass rates")
            selected += int(np.count_nonzero(inside))
            valid += int(np.count_nonzero(good))
            stream_cells += int(np.count_nonzero(is_stream))
            structural += int(np.count_nonzero(structural_mask))
            missing_nonstream += int(np.count_nonzero(missing & stream_known & (stream_block.data == 0)))
            unknown_missing += int(np.count_nonzero(missing & ~stream_known))
            nonfinite_stream += int(np.count_nonzero(missing & is_stream & ~masked))
            unknown_stream_support += int(np.count_nonzero(inside & ~stream_known))
            total += float(np.sum(block.data[good], dtype="float64")) * cell_area_ha
        unexpected = selected - valid - structural
        issues = []
        if not within_extent:
            issues.append("Part of the original upstream catchment lies outside the native raster extent")
        if not selected:
            issues.append("No native pixel centre falls inside the original catchment")
        if missing_nonstream:
            issues.append("Original nonstream cells have missing or nonfinite export values")
        if unknown_missing:
            issues.append("Missing export cells lack a valid original stream classification")
        if nonfinite_stream:
            issues.append("Original stream cells contain unmasked nonfinite export values")
        if not valid:
            issues.append("No valid original native export cells to aggregate")
        return {**coverage, "annual_mass": total if valid else None, "selected_cells": selected,
                "valid_cells": valid, "missing_selected_cells": selected - valid,
                "stream_cells": stream_cells, "structural_stream_omission_cells": structural,
                "missing_nonstream_cells": missing_nonstream,
                "missing_unclassified_cells": unknown_missing,
                "nonfinite_stream_cells": nonfinite_stream,
                "stream_classification_unknown_cells": unknown_stream_support,
                "unexpected_missing_cells": unexpected,
                "covered_area_ha": valid * cell_area_ha,
                "structural_stream_omission_area_ha": structural * cell_area_ha,
                "unexpected_missing_area_ha": unexpected * cell_area_ha,
                "valid_fraction_of_selected_cells": valid / selected if selected else None,
                "native_support_fraction": (valid + structural) / selected if selected else None,
                "complete_catchment": not issues, "coverage_issues": issues,
                "selection": "Original pixel-centre exports; native stream omissions remain NoData "
                             "and complete upstream catchment coverage is retained"}

def compare(workspace, run_id, observation_id, catchments):
    from pyproj import CRS, Transformer
    from shapely.ops import transform
    import rasterio
    state = workspace.inspect_run(run_id)
    if state["state"] != "complete":
        raise ValueError("Finish the original native model run")
    from .model_selection import run_models, validate_completed_run
    scope = validate_completed_run(state)
    active = run_models(state)
    observations = workspace._get("observations", observation_id)
    source, entry = workspace.source_file(catchments["source_collection_id"], catchments["source_id"])
    features, source_crs = rasters.vector_geometry(source, layer=catchments.get("layer") or entry.get("layer"),
                                                   where=catchments.get("where"))
    field = catchments.get("id_field")
    if not field:
        raise ValueError("Select the original observation catchment ID field")
    indexed = {}
    for feature in features:
        value = feature["properties"].get(field)
        if value is None or str(value) in indexed:
            raise ValueError("The catchment source needs a unique, non-null selected identity")
        indexed[str(value)] = feature["geometry"]
    native_files = {}
    run_directory = workspace.root / "runs" / run_id
    for parameter, (model, output_id, units) in NATIVE.items():
        if model not in active:
            continue
        stage = state["stages"][model]
        arguments = read_json(verify_file(run_directory, stage["arguments"]))
        stream_id = ("stream_and_drainage" if model == "sdr" and arguments.get("drainage_path")
                     else "stream")
        item = stage["files"][output_id]
        if stream_id not in stage["files"]:
            raise ValueError("Retained native " + model.upper() + " stage lacks its original " + stream_id)
        stream_item = stage["files"][stream_id]
        native_files[parameter] = {
            "export": verify_file(run_directory, item),
            "stream": verify_file(run_directory, stream_item),
            "stream_source": {"run_id": run_id, "model": model, "registry_id": stream_id,
                              "file": stream_item, "arguments": stage["arguments"],
                              "export_registry_id": output_id, "export_file": item,
                              "native_module": stage.get("runtime", state.get("runtime", {})).get("modules", {}).get(model)},
        }
    comparisons, exclusions, cached, context = [], [], {}, []
    for observed in observations["rows"]:
        support_issues = observation_support.comparison_issues(observed, observations["metadata"])
        if not observed["admitted"] or support_issues:
            retained = observation_support.context_record(observed, observations["metadata"])
            context.append(retained)
            exclusions.append({"observation_id": observed["id"], "issues": retained["comparison_issues"],
                               "measurement_support": retained["measurement_support"],
                               "species": retained["species"]})
            continue
        geometry = indexed.get(observed["catchment_id"])
        if geometry is None:
            exclusions.append({"observation_id": observed["id"], "issues": ["Original catchment ID is absent"]})
            continue
        parameter = observed["parameter"]
        if parameter not in native_files:
            exclusions.append({"observation_id": observed["id"], "parameter": parameter,
                               "issues": ["This parameter's native model was not selected for this run"]})
            continue
        cache_key = (parameter, observed["catchment_id"])
        if cache_key not in cached:
            with rasterio.open(native_files[parameter]["export"]) as src:
                projection = Transformer.from_crs(CRS.from_user_input(source_crs), src.crs, always_xy=True)
            native_geometry = transform(projection.transform, geometry)
            selected_native = native_files[parameter]
            cached[cache_key] = catchment_load(selected_native["export"], native_geometry,
                                              selected_native["stream"],
                                              stream_source=selected_native["stream_source"])
        modeled = cached[cache_key]
        if modeled["annual_mass"] is None:
            exclusions.append({"observation_id": observed["id"], "issues": [modeled.get("issue", "No valid native output cells")]})
            continue
        expected, predicted = observed["annual_mass"], modeled["annual_mass"]
        complete = modeled["complete_catchment"]
        comparisons.append({
            "observation_id": observed["id"], "parameter": parameter,
            "measurement_support": "catchment_export",
            "species": observation_support.source_species(observed, observations["metadata"]),
            "original_parameter": observed.get("original_parameter"),
            "support_origin": observed.get("support_origin", "legacy_catchment_import_contract"),
            "catchment_id": observed["catchment_id"], "station_id": observed["station_id"],
            "period_start": observed["period_start"], "period_end": observed["period_end"],
            "observed_annual_mass": expected, "modeled_annual_mass": predicted,
            "residual": predicted - expected if complete else None,
            "relative_residual": (predicted - expected) / expected if complete and expected else None,
            "partial_catchment_difference": predicted - expected if not complete else None,
            "included_in_metrics": complete, "coverage_status": "complete" if complete else "partial",
            "method": observed.get("method") or observations["metadata"].get("annualization_method"),
            "uncertainty": observed.get("uncertainty", observations["metadata"].get("uncertainty")),
            "source_records": observed.get("source_records"),
            "observed_value_text": observed["value_text"], "observed_source_unit": observed["unit"],
            "observed_qualifier": observed["qualifier"], "period_days": observed.get("period_days"),
            "source_mass_conversion_factor": MASS_FACTORS[parameter][observed["unit"]],
            "units": observed["comparison_units"], "spatial_coverage": modeled,
        })
    metrics = {}
    for parameter in NATIVE:
        rows = [r for r in comparisons if r["parameter"] == parameter and r["included_in_metrics"]]
        if not rows:
            continue
        observed_values = [r["observed_annual_mass"] for r in rows]
        residuals = [r["residual"] for r in rows]
        n = len(rows)
        mean = sum(observed_values) / n
        variance = sum((v - mean) ** 2 for v in observed_values)
        squared_error = sum(v * v for v in residuals)
        metrics[parameter] = {
            "n": n, "units": NATIVE[parameter][2], "mean_bias": sum(residuals) / n,
            "rmse": math.sqrt(squared_error / n),
            "nash_sutcliffe_efficiency": 1 - squared_error / variance if n > 1 and variance > 0 else None,
            "repeated_catchments": len({r["catchment_id"] for r in rows}) < n,
            "unique_catchments": len({r["catchment_id"] for r in rows}),
            "periods": sorted({(r["period_start"], r["period_end"]) for r in rows}),
            "partial_catchments_excluded": sum(r["parameter"] == parameter
                                              and not r["included_in_metrics"] for r in comparisons),
        }
    profile = workspace._get("profiles", state["selection"]["profile_id"])
    value = {
        "comparison_version": COMPARISON_SCHEMA_VERSION, "run_id": run_id, "observation_id": observation_id, "catchment_selection": catchments,
        "model_scope": scope,
        "catchment_source": {"uri": entry["uri"], "vintage": entry["vintage"],
                             "sha256": entry["body"]["sha256"]},
        "observation_method": observations["metadata"],
        "model_period": profile.get("model_period"),
        "model_source_vintages": workspace.get_grid(state["selection"]["grid_id"])["inputs"],
        "comparisons": comparisons, "exclusions": exclusions, "metrics": metrics,
        "context_rows": context, "support_summary": observation_support.summarize(observations["rows"]),
        "source_admission": observation_support.admission_projection(observations["rows"], observations["metadata"]),
        "measurement_support_basis": "Residuals use annual receiving-water catchment loads of the "
                                     "same species. Facility/outfall discharges and concentrations "
                                     "retain their source quantities separately.",
        "metrics_exclusions": [{"observation_id": row["observation_id"],
                                "issues": row["spatial_coverage"]["coverage_issues"]}
                               for row in comparisons if not row["included_in_metrics"]],
        "metrics_basis": "Only whole source catchments inside the native raster extent with complete "
                         "expected export support. Original NoData on verified same-stage stream cells is "
                         "retained as structural omission; other missing support is excluded. Each station-period "
                         "row is one comparison; repeated catchments are identified and periods are not independent replicates.",
        "interpretation": "Annual modeled delivered exports are summed over each original observed catchment. "
                          "Partial native totals remain visible; full-load residuals and fit metrics require complete "
                          "catchment coverage, including the native stream-mask definition. No mass is imputed "
                          "to stream omissions. Original observation periods, source methods, qualifiers and uncertainty "
                          "remain with every row. Review reservoir and point-source influences, model/source vintages "
                          "and repeated station periods when interpreting the descriptive comparison.",
    }
    value["diagnostics"] = observation_diagnostics.build(value)
    return workspace._save("observation-comparisons", value)
