"""Source-bound whole-catchment annual yields and retained spatial dependence.

This presentation module reads completed records; it does not score candidates,
change observation admission, infer outlet transport, or dispatch native models.
"""
from __future__ import annotations

import math
from .common import digest, identifier
from . import observation_support

VERSION = "whole-catchment-yields-v1"
METHOD_URL = "https://water.usgs.gov/nawqa/sparrow/FAQs/faq.html"
MEANING = (
    "Whole-catchment annual yield is the retained annual mass divided by the "
    "complete selected source polygon area in hectares. The denominator is the "
    "original polygon projected into the native comparison's metre CRS, never "
    "the valid-pixel or clipped raster area. Reference and model numerators retain "
    "their own constituent, estimator and temporal meanings. Area normalization "
    "does not make TSS and SSC equivalent, add downstream transport, or make "
    "overlapping catchments independent. These descriptive values do not change "
    "the saved calibration objective, candidate ranking or held-out groups."
)
FIELDS = (
    "run_id", "comparison_id", "unit_id", "observation_id", "catchment_id",
    "parameter", "partition", "group_id", "units", "yield_units", "yield_status",
    "catchment_area_ha", "reference_denominator_ha", "native_denominator_ha",
    "denominator_crs", "denominator_basis", "covered_grid_area_ha",
    "outside_raster_area_ha", "reference_annual_mass", "native_annual_mass",
    "delivered_external_annual_mass", "predicted_annual_mass",
    "reference_annual_yield", "native_annual_yield", "external_annual_yield",
    "predicted_annual_yield", "annual_yield_difference",
    "partial_native_annual_mass", "reference_label", "reference_codes",
    "reference_status", "basis_interpretation", "source_record_ids",
    "source_periods", "source_methods", "source_uncertainty",
    "native_complete", "valid_cells", "structural_stream_omission_cells",
    "unexpected_missing_cells", "support_issues",
)
RELATION_FIELDS = (
    "catchment_a", "catchment_b", "basis", "overlap_ha", "station_id",
    "group_a", "group_b", "partition_a", "partition_b",
    "source_uri", "source_sha256",
)


def _number(value, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0 or (positive and value == 0):
        return None
    return float(value)


def _ratio(mass, area):
    if mass is None or area is None:
        return None
    result = mass / area
    return result if math.isfinite(result) else None


def _units(units):
    return {"kg/year": "kg/ha/year", "tonnes/year": "tonnes/ha/year",
            "t/year": "t/ha/year",
            "metric_tonnes/year": "metric_tonnes/ha/year"}.get(units)


def _row(source, support, *, metadata=None, complete=False, native=None,
         external=0.0, predicted=None):
    """Normalize original quantities with one explicit, complete-polygon area."""
    support = support or {}
    area = _number(support.get("catchment_area_ha"), positive=True)
    reference = _number(source.get("observed_annual_mass"))
    raw_native = _number(native)
    external = _number(external)
    unit = _units(source.get("units"))
    native_complete = complete is True and support.get("complete_catchment") is True
    native_mass = raw_native if native_complete else None
    predicted_mass = _number(predicted) if native_complete else None
    basis = observation_support.reference_basis(source, metadata)
    issues = list(support.get("coverage_issues") or [])
    if area is None:
        issues.append("The original comparison does not retain a positive whole-catchment area.")
    if unit is None:
        issues.append("The retained mass unit has no supported annual-yield interpretation.")
    reference_yield = _ratio(reference, area) if unit else None
    native_yield = _ratio(native_mass, area) if unit else None
    external_yield = _ratio(external, area) if unit else None
    predicted_yield = _ratio(predicted_mass, area) if unit else None
    difference = (predicted_yield - reference_yield
                  if predicted_yield is not None and reference_yield is not None else None)
    if difference is not None and not math.isfinite(difference):
        difference = None
    return {
        "units": source.get("units"), "yield_units": unit,
        "yield_status": ("denominator_unavailable" if area is None else
                         "annual_unit_unavailable" if unit is None else
                         "complete" if native_complete else "reference_only_incomplete_native"),
        "catchment_area_ha": area, "reference_denominator_ha": area,
        "native_denominator_ha": area if native_complete else None,
        "denominator_crs": support.get("raster_extent_crs"),
        "denominator_basis": "Whole original comparison catchment polygon in projected metres / 10000",
        "covered_grid_area_ha": _number(support.get("covered_area_ha")),
        "outside_raster_area_ha": _number(support.get("catchment_area_outside_raster_ha")),
        "reference_annual_mass": reference, "native_annual_mass": native_mass,
        "delivered_external_annual_mass": external, "predicted_annual_mass": predicted_mass,
        "reference_annual_yield": reference_yield, "native_annual_yield": native_yield,
        "external_annual_yield": external_yield, "predicted_annual_yield": predicted_yield,
        "annual_yield_difference": difference,
        "partial_native_annual_mass": raw_native if not native_complete else None,
        "reference_label": basis["label"], "reference_codes": basis["parameter_codes"],
        "reference_status": basis["status"], "basis_interpretation": basis["interpretation"],
        "native_complete": native_complete, "valid_cells": support.get("valid_cells"),
        "structural_stream_omission_cells": support.get("structural_stream_omission_cells"),
        "unexpected_missing_cells": support.get("unexpected_missing_cells"),
        "support_issues": issues,
    }


def from_comparison(comparison):
    """Describe each exact original period without collapsing repeated records."""
    rows = []
    for index, source in enumerate(comparison.get("comparisons", [])):
        raw = source.get("modeled_annual_mass")
        row = _row(source, source.get("spatial_coverage"),
                   metadata=comparison.get("observation_method"),
                   complete=source.get("included_in_metrics") is True,
                   native=raw, predicted=raw)
        rows.append({
            **row, "run_id": comparison.get("run_id"), "comparison_id": comparison.get("id"),
            "unit_id": None, "observation_id": source.get("observation_id"),
            "comparison_row_index": index, "catchment_id": source.get("catchment_id"),
            "parameter": source.get("parameter"), "partition": "original comparison",
            "source_record_ids": [source.get("observation_id")],
            "source_periods": [{"start": source.get("period_start"), "end": source.get("period_end"),
                                "days": source.get("period_days")}],
            "source_methods": [source.get("method")],
            "source_uncertainty": source.get("uncertainty"),
            "original_source_records": source.get("source_records"),
        })
    return {"version": VERSION, "meaning": MEANING, "method_url": METHOD_URL,
            "source_comparison_id": comparison.get("id"),
            "catchment_source": comparison.get("catchment_source"), "rows": rows}


def _relations(plan):
    """Expose the saved grouping graph without recomputing or reassigning it."""
    spatial = plan.get("spatial_groups", {})
    assignments = spatial.get("assignments", {})
    selection = plan["selection"]
    def partition(group):
        if group in selection.get("validation_group_ids", []):
            return "validation"
        if group in selection.get("calibration_group_ids", []):
            return "calibration"
        return "unselected"
    rows = []
    source = spatial.get("source", {})
    for index, relation in enumerate(spatial.get("connections", [])):
        ids = relation.get("catchment_ids", [])
        if len(ids) != 2 or any(name not in assignments for name in ids):
            raise ValueError("A retained spatial connection has an invalid original catchment identity")
        a, b = ids
        rows.append({
            "original_connection_index": index, "catchment_a": a, "catchment_b": b,
            "basis": relation.get("basis"), "overlap_ha": relation.get("overlap_ha"),
            "station_id": relation.get("station_id"), "group_a": assignments[a],
            "group_b": assignments[b], "partition_a": partition(assignments[a]),
            "partition_b": partition(assignments[b]), "source_uri": source.get("uri"),
            "source_sha256": source.get("sha256"), "original_connection": relation,
        })
    return rows


def collect(workspace, report, plan, observed):
    """Join completed calibration rows to their exact original comparison support."""
    if report["plan_id"] != plan["id"] or observed["id"] != plan["selection"]["observation_id"]:
        raise ValueError("Catchment interpretation requires the original calibration and observation edition")
    original_rows = {row["id"]: row for row in observed["rows"]}
    units = {unit["id"]: unit for unit in plan["units"]}
    comparisons, fingerprints = {}, {}
    for run_id, comparison_id in report["comparison_ids"].items():
        item = workspace._get("observation-comparisons", identifier(comparison_id))
        if (item["id"] != comparison_id or item["run_id"] != run_id
                or item["observation_id"] != observed["id"]
                or digest(item["catchment_selection"]) != digest(plan["selection"]["catchments"])
                or item["catchment_source"]["sha256"] != plan["spatial_groups"]["source"]["sha256"]):
            raise ValueError("Yield support belongs to a different original comparison selection")
        index = {}
        for row in item.get("comparisons", []):
            key = row["observation_id"]
            if key in index:
                raise ValueError("An original comparison repeats an observation identity")
            index[key] = row
        comparisons[run_id] = (item, index)
        fingerprints[comparison_id] = digest(item)
    rows = []
    for prediction in report["prediction_rows"]:
        unit = units[prediction["unit_id"]]
        run_id = prediction["run_id"]
        retained = comparisons.get(run_id)
        source_rows = [original_rows[key] for key in unit["observation_record_ids"]]
        selected = [retained[1][key] for key in unit["observation_record_ids"]
                    if retained and key in retained[1]]
        for item in selected:
            if (item["catchment_id"] != unit["catchment_id"]
                    or item["parameter"] != unit["parameter"] or item["units"] != unit["units"]):
                raise ValueError("Original yield support differs from its calibration reference unit")
        # All constituent periods must describe the same whole polygon. Recover
        # old summaries from saved comparisons, never from a valid-cell count.
        supports = [item.get("spatial_coverage", {}) for item in selected]
        identities = {(s.get("catchment_area_ha"), s.get("raster_extent_crs")) for s in supports}
        if len(identities) > 1:
            raise ValueError("Original reference periods retain inconsistent catchment denominators")
        support = supports[0] if supports else {}
        complete = (prediction.get("included") is True
                    and len(selected) == len(source_rows)
                    and all(item.get("included_in_metrics") is True for item in selected)
                    and all(s.get("complete_catchment") is True for s in supports))
        evidence = []
        def original_evidence(value):
            value = observation_support.detail(value)
            if isinstance(value, list):
                for item in value:
                    original_evidence(item)
            elif isinstance(value, dict):
                evidence.append(value)
        for item in source_rows:
            evidence.append(item)
            original_evidence(item.get("source_records"))
        enriched = {**unit, "source_records": evidence}
        raw_native = prediction.get("native_annual_mass")
        if raw_native is None and selected:
            partials = [_number(item.get("modeled_annual_mass")) for item in selected]
            if partials[0] is not None and all(value == partials[0] for value in partials):
                raw_native = partials[0]
        row = _row(enriched, support, metadata=observed.get("metadata"),
                   complete=complete, native=raw_native,
                   external=unit.get("delivered_external_annual_mass"),
                   predicted=prediction.get("predicted_annual_mass"))
        rows.append({
            **row, "run_id": run_id,
            "comparison_id": retained[0]["id"] if retained else prediction.get("comparison_id"),
            "unit_id": unit["id"], "observation_id": observed["id"],
            "catchment_id": unit["catchment_id"], "parameter": unit["parameter"],
            "partition": unit["partition"], "group_id": unit["group_id"],
            "source_record_ids": unit["observation_record_ids"],
            "source_periods": unit["periods"], "source_methods": unit["reference_methods"],
            "source_uncertainty": unit["reference_uncertainty"],
            "original_reference_rows": source_rows,
            "original_support": supports,
        })
    return {
        "version": VERSION, "meaning": MEANING, "method_url": METHOD_URL,
        "calibration_id": report["id"], "plan_id": plan["id"],
        "observation_id": observed["id"], "selected_run_id": report["selected_run_id"],
        "catchment_source": plan["spatial_groups"]["source"],
        "comparison_fingerprints": fingerprints, "rows": rows,
        "relations": _relations(plan), "groups": plan["spatial_groups"]["groups"],
        "group_method": plan["spatial_groups"]["method"],
        "temporal_method": report["temporal_method"],
    }


def _display(value):
    if value is None:
        return "unavailable"
    return format(value, ".7g") if isinstance(value, (int, float)) else str(value)


def _period_label(row):
    periods = row.get("source_periods") or []
    return "; ".join(str(item.get("start") or item.get("period_start") or "unknown start")
                     + " to " + str(item.get("end") or item.get("period_end") or "unknown end")
                     for item in periods if isinstance(item, dict)) or "period unavailable"


def blocks(result, *, selected_only=False):
    rows = [row for row in result["rows"]
            if ((not selected_only or row["run_id"] == result.get("selected_run_id"))
                and (not result.get("selected_run_id")
                     or row["run_id"] == result["selected_run_id"]
                     or row.get("partition") == "calibration"))]
    output = [MEANING,
        "Observed/reference yield uses the selected comparison polygon; a separately published "
        "gage drainage-area figure is not substituted. Native yield is shown only for retained "
        "complete support, including declared structural stream omissions without imputed mass.",
        {"kind": "table",
         "columns": ["Catchment / parameter", "Original reference basis", "Area (ha)",
                     "Annual yield unit", "Reference", "Native", "Total prediction", "Support"],
         "rows": [[str(row["catchment_id"]) + " / " + str(row["parameter"])
                   + "\n" + _period_label(row)
                   + ("\nRun " + str(row["run_id"]) if not selected_only else ""),
                   row["reference_label"], _display(row["catchment_area_ha"]),
                   row["yield_units"] or "unavailable", _display(row["reference_annual_yield"]),
                   _display(row["native_annual_yield"]), _display(row["predicted_annual_yield"]),
                   row["yield_status"]] for row in rows]},
        "Exact source periods, estimator methods, reference uncertainty, native/export support "
        "and denominator CRS are retained in the complete yield table. Repeated periods do not "
        "create independent spatial catchments. Numerical yield differences retain the original "
        "analytical-basis distinctions; no TSS-to-SSC conversion is applied.",
        "Definition reference: USGS SPARROW FAQ, total load divided by entire upstream drainage "
        "area: " + METHOD_URL,
    ]
    relations = result.get("relations")
    if relations is not None:
        output.extend([
            "Retained spatial dependence: " + result.get("group_method", ""),
            {"kind": "table", "columns": ["Catchment A", "Catchment B", "Original relationship",
                "Overlap (ha)", "Station", "Original group"],
             "rows": [[row["catchment_a"], row["catchment_b"], row["basis"],
                       _display(row["overlap_ha"]), row["station_id"] or "",
                       row["group_a"]] for row in relations]},
            "These are the saved calibration plan's positive-area overlap and shared-station "
            "connections. No new river connectivity, containment direction or independent "
            "incremental loads are inferred. An empty connection table means the retained plan "
            "contains no pair connection; explicit groups can still combine catchments.",
        ])
    return output


def figures(result):
    """Use the maintained scientific-figure scatter contract and renderer."""
    from .scientific_figures import _validate_figure
    cohorts = {}
    for row in result["rows"]:
        if (row["run_id"] != result.get("selected_run_id")
                or row["reference_annual_yield"] is None or row["predicted_annual_yield"] is None):
            continue
        key = (row["parameter"], row["yield_units"], row["reference_label"], row["reference_status"])
        cohorts.setdefault(key, []).append(row)
    output = []
    for key, rows in cohorts.items():
        parameter, unit, label, status = key
        maximum = max(row[field] for row in rows
                      for field in ("reference_annual_yield", "predicted_annual_yield"))
        upper = maximum * 1.06 if maximum else 1.0
        if not math.isfinite(upper):
            raise ValueError("Whole-catchment yields exceed the finite figure coordinate range")
        ticks = [{"value": upper * i / 4, "label": format(upper * i / 4, ".4g")} for i in range(5)]
        series = [{"geometry": "line", "label": "Numerical equality", "markers": False,
                   "points": [{"x": 0.0, "y": 0.0}, {"x": upper, "y": upper}]}]
        for partition, marker, title in (("calibration", "circle", "Calibration"),
                                         ("validation", "square-open", "Held-out")):
            series.append({"geometry": "scatter", "label": title, "marker": marker,
                "points": [{"x": row["reference_annual_yield"], "y": row["predicted_annual_yield"],
                            "unit_id": row["unit_id"], "catchment_id": row["catchment_id"],
                            "partition": row["partition"], "group_id": row["group_id"],
                            "source_periods": row["source_periods"],
                            "catchment_area_ha": row["catchment_area_ha"]}
                           for row in rows if row["partition"] == partition]})
        figure = {"id": "catchment-yield-" + parameter + "-" + digest(key)[:12],
                  "title": "Whole-catchment annual yield: " + parameter,
                  "reference_basis_label": label,
                  "caption": "Original reference basis: " + label + ". Both annual masses use each "
                  "point's complete original catchment area. Reference source periods and methods "
                  "remain attached to every point. Numerical equality is a visual guide, not proof "
                  "of analytical or transport equivalence. TSS, SSC and mixed/undeclared bases "
                  "remain separate cohorts. The saved fit, ranking and holdout selection are unchanged.",
                  "panels": [{"id": parameter, "title": label,
                    "x": {"label": "Original reference yield", "unit": unit, "domain": [0.0, upper], "ticks": ticks},
                    "y": {"label": "Selected prediction yield", "unit": unit, "domain": [0.0, upper], "ticks": ticks},
                    "series": series}]}
        _validate_figure(figure)
        output.append(figure)
    return output
