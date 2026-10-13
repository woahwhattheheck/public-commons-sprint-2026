"""Definitions and interpretation for the original InVEST 3.20 process outputs.

This module performs no spatial computation and never creates a pixel-retention map.
"""
from __future__ import annotations
import math

EDITION = "native-process-quantities/1"
VERSION = "3.20.0"
GUIDES = {m: "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/"
          + VERSION + "/userguide/en/" + m + ".html" for m in ("ndr", "sdr")}
SOURCE_BLOBS = {"ndr": "f518b2867d4a327675fcb1c9b4ba56f29b12188d",
                "sdr": "0cac27add172011df367ff8026427dbbdbcda5b2"}
# Native vector field, original registry raster, readable quantity.
FIELDS = {
    "ndr": (
        ("n_surface_load", "surface_load_n", "Nitrogen surface load"),
        ("n_subsurface_load", "sub_load_n", "Nitrogen subsurface load"),
        ("n_surface_export", "n_surface_export", "Nitrogen surface export"),
        ("n_subsurface_export", "n_subsurface_export", "Nitrogen subsurface export"),
        ("n_total_export", "n_total_export", "Nitrogen total export"),
        ("p_surface_load", "surface_load_p", "Phosphorus surface load"),
        ("p_surface_export", "p_surface_export", "Phosphorus surface export"),
    ),
    "sdr": (
        ("usle_tot", "usle", "Soil loss under selected land cover (USLE)"),
        ("sed_export", "sed_export", "Sediment delivered to the stream"),
        ("sed_dep", "sed_deposition", "Sediment deposited from upslope"),
        ("avoid_eros", "avoided_erosion", "Avoided local erosion"),
        ("avoid_exp", "avoided_export", "Avoided sediment export"),
    ),
}
UNITS = {"ndr": "kg/year", "sdr": "metric_tonnes/year"}
RATE_UNITS = {"ndr": "kg/ha/year", "sdr": "metric_tonnes/ha/year"}
NOTES = [
    "Native watershed totals retain the original model aggregation and polygon geometry.",
    "Raster values in this 3.20 contract are annual mass per hectare. Raster totals use the "
    "original projected pixel area once; native vector totals already contain annual mass.",
    "NDR watershed retention is total load minus export. It describes the whole selected "
    "watershed; subtracting pixel load and export does not locate where retention occurred.",
    "SDR USLE soil loss, export, deposition, avoided erosion and avoided export are distinct "
    "quantities. Avoided export combines avoided local erosion delivered to the stream and "
    "upslope sediment trapped; these service outputs must not be summed as a mass budget.",
    "The model-domain watershed can extend beyond the reporting area. The original native "
    "watershed totals use that domain, while delivery-map totals may use a reporting mask.",
    "Pixel-centre support diagnostics use an explicit finite-value mask for each quantity. "
    "Native zonal aggregation may treat very small boundary polygons differently; original "
    "vector totals and independently reconstructed totals are both retained.",
    "Scenario changes are alternative minus baseline. Common-support raster changes compare "
    "the same cells; original watershed changes preserve each run's complete native domain.",
    "The model represents average annual landscape processes. Point discharges, measured "
    "stream concentrations and seasonal gauge flows remain separate contextual quantities.",
    "Export values are model predictions. Calibration and scenario assumptions belong with "
    "their interpretation; this report does not assign treatment prices or monetary benefits.",
]


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def ratio(numerator, denominator):
    return numerator / denominator if (numerator is not None and denominator is not None
                                       and denominator > 0) else None


def quantities(model, properties):
    """Read original scalar fields and derive only explicitly named watershed quantities."""
    result = []
    values = {name: number(properties.get(name)) for name, _, _ in FIELDS[model]}
    for name, raster, label in FIELDS[model]:
        result.append({"quantity": name, "label": label, "value": values[name],
                       "units": UNITS[model], "basis": "original_native_watershed_field",
                       "fields": [name], "raster_registry_id": raster})
    if model == "ndr":
        def add(name, label, inputs, calculate, units=UNITS["ndr"]):
            present = all(values.get(key) is not None for key in inputs)
            value = calculate(values) if present else None
            result.append({"quantity": name, "label": label, "value": value, "units": units,
                           "basis": "derived_from_native_watershed_fields", "fields": inputs})
        add("nitrogen_load", "Total nitrogen load", ["n_surface_load", "n_subsurface_load"],
            lambda v: v["n_surface_load"] + v["n_subsurface_load"])
        add("nitrogen_retention", "Watershed nitrogen retention",
            ["n_surface_load", "n_subsurface_load", "n_total_export"],
            lambda v: v["n_surface_load"] + v["n_subsurface_load"] - v["n_total_export"])
        add("phosphorus_retention", "Watershed phosphorus retention",
            ["p_surface_load", "p_surface_export"],
            lambda v: v["p_surface_load"] - v["p_surface_export"])
        add("nitrogen_export_fraction", "Nitrogen export / total load",
            ["n_surface_load", "n_subsurface_load", "n_total_export"],
            lambda v: ratio(v["n_total_export"], v["n_surface_load"] + v["n_subsurface_load"]),
            "fraction")
        add("phosphorus_export_fraction", "Phosphorus export / load",
            ["p_surface_load", "p_surface_export"],
            lambda v: ratio(v["p_surface_export"], v["p_surface_load"]), "fraction")
        add("nitrogen_component_residual", "Total export minus surface and subsurface export",
            ["n_total_export", "n_surface_export", "n_subsurface_export"],
            lambda v: v["n_total_export"] - v["n_surface_export"] - v["n_subsurface_export"])
    return result


def changes(baseline, alternative):
    first = {row["quantity"]: row for row in baseline}
    result = []
    for row in alternative:
        old = first[row["quantity"]]
        a, b = old["value"], row["value"]
        delta = b - a if a is not None and b is not None else None
        result.append({**row, "baseline": a, "alternative": b, "change": delta,
                       "relative_change_pct": 100 * delta / a if delta is not None and a > 0 else None,
                       "direction": "alternative_minus_baseline"})
    return result


def interpretation(model, rows, *, profile_changed, scenario_changed):
    by_name = {r["quantity"]: r for r in rows}
    scope = ("Joint parameter-profile and scenario response" if profile_changed and scenario_changed
             else "Parameter-profile response" if profile_changed
             else "Scenario response" if scenario_changed else "Repeated original selection")
    paragraphs = [scope + "; the retained selections identify every changed input."]
    if model == "ndr":
        for species, load, export, retention in (
                ("nitrogen", "nitrogen_load", "n_total_export", "nitrogen_retention"),
                ("phosphorus", "p_surface_load", "p_surface_export", "phosphorus_retention")):
            selected = [by_name.get(k, {}) for k in (load, export, retention)]
            if any(row.get("change") is None for row in selected):
                continue
            dl, de, dr = [row["change"] for row in selected]
            paragraphs.append(
                species.title() + ": watershed load changes by " + format(dl, ".8g") +
                " kg/year and export by " + format(de, ".8g") +
                " kg/year; their difference is the retention change " + format(dr, ".8g") +
                " kg/year. A greater retained amount can accompany a greater initial load.")
    else:
        paragraphs.append("Compare soil loss and delivered sediment separately. Increased "
                          "avoided export is a modeled service response, not an additional "
                          "mass removed from the reported exported sediment.")
    return paragraphs
