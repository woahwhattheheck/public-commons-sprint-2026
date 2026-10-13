"""Three-run same-cell export contrasts beside original intervention allocation.

Consumes native mass-per-cell blocks already read by geographic allocation.
No raster reader, geometry, matching, scenario, solver or sampling is added.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import hashlib
import json
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, verify_file
from . import native_versions, rasters

SCHEMA = "upstate.geographic-siting-contrasts/v1"
RUNS = ("baseline", "restoration", "control")
ALTERNATIVES = RUNS[1:]
PARTITIONS = ("changed_source_cells", "unchanged_source_cells", "unknown_categorical_support")
LINKS = ("siting-contrasts.json", "siting-contrasts.csv", "siting-change-partitions.csv",
         "siting-contrast-sources.json", "geographic_siting_contrasts.py")
NOTES = [
    "All three native totals and their differences use exactly the same finite source cells inside the original region. The common-mask hash binds the actual window positions and bits, not only their count.",
    "Avoided export is baseline minus alternative. Restoration advantage is control minus restoration on those same cells: positive means less modeled export under restoration; negative values remain visible.",
    "These sums describe export originating from source cells within the named support and delivered to streams along their modeled flow paths. They do not measure concentration, exposure or observed water quality.",
    "Local control and restoration allocations can differ in hectares and original classes despite global matching. The signed mass contrast remains a comparison of the two whole scenarios; it is not automatically an equal-local-budget siting effect.",
    "Per-treated-hectare values use the actual original changed-cell area in that region, not total catchment area or the number of finite output cells. A shared-area advantage is supplied only for positive equal area and equal original-class counts.",
    "Changes at unchanged source cells can result from modeled downstream retention or routing changes. They remain separate from changes at converted cells. This partition is descriptive source attribution, not an isolated causal effect of local treatment.",
    "Native nodata, including structural stream support where applicable, remains outside the finite mask and is never replaced with zero. Common cells and each original run's support must be read together; finite coverage alone does not establish complete native support.",
    "This reader sums float64 differences of the retained original mass-per-pixel values. Existing pairwise Receiving Float32 change-pixel totals keep their own arithmetic and masks; this new same-cell edition does not overwrite them.",
    "These are deterministic modeled results under simulated physical assumptions. They are not measured benefits, confidence intervals or monetized values. Original parameter sensitivities remain separate.",
]


def snapshot(runs, analyses, footprints):
    """Bind actual native output descriptors, observed versions and exact code."""
    pollutants = sorted({pollutant for analysis in analyses.values()
                         for selected in analysis["quantity_sources"].values()
                         for pollutant in selected})
    if not pollutants:
        raise ValueError("Retain original native outputs for the three-run contrast")
    cohort = native_versions.comparison_versions(
        list(runs.values()), native_versions.models_for_outputs(pollutants))
    for run in runs.values():
        for model, version in cohort["runs"][run["id"]].items():
            if not (version.get("observed_stage_version") or version.get("observed_run_version")):
                raise ValueError("Retain the actual observed native execution version: "
                                 + run["id"] + "/" + model)
    sources = {}
    for analysis in analyses.values():
        scope = analysis["quantity_scope"]
        selected = deepcopy(analysis["quantity_sources"])
        if scope in sources and sources[scope] != selected:
            raise ValueError("Same-scope contrasts require identical original native sources")
        sources[scope] = selected
    # The original geographic baseline is unchanged from the prepared grid.
    # This makes each verified footprint's final net change the whole-scenario
    # intervention relative to that same baseline, rather than a patch sum.
    if footprints["baseline"]["summary"]["net_changed_cells"] != 0:
        raise ValueError("Whole-scenario area requires the original unchanged geographic baseline")
    intervention = {}
    for role in ALTERNATIVES:
        footprint = footprints[role]
        summary = footprint["summary"]
        count, hectares = summary["net_changed_cells"], summary["net_changed_hectares"]
        pixel_area = summary["pixel_area_ha"]
        if (isinstance(count, bool) or not isinstance(count, int) or count < 0
                or not math.isfinite(hectares) or not math.isfinite(pixel_area)
                or pixel_area <= 0 or hectares != count * pixel_area):
            raise ValueError("Retain the original complete-footprint net changed area")
        intervention[role] = {
            "footprint_id": footprint["id"], "run_id": runs[role]["id"],
            "cells": count, "hectares": hectares, "pixel_area_ha": pixel_area,
            "basis": "verified complete-footprint final net change from the original unchanged baseline",
            "summary": deepcopy(summary),
        }
    body = Path(__file__).read_bytes()
    return {
        "schema": SCHEMA, "native_execution": cohort,
        "run_ids": {role: runs[role]["id"] for role in RUNS},
        "quantity_sources": sources,
        "whole_scenario_intervention": intervention,
        "support_method": "window-addressed-three-run-finite-native-mask/v1",
        "sum_basis": "compensated sum of float64 original mass values and direct per-cell differences",
        "difference_direction": "control minus restoration",
        "implementation": {"path": "model/geographic_siting_contrasts.py",
                           "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()},
    }, body


def verify_sources(workspace, binding):
    seen = set()
    for selected in binding["quantity_sources"].values():
        for run_id, metrics in selected.items():
            for source in metrics.values():
                descriptor = source["artifact"]
                key = (run_id, descriptor["path"], descriptor["sha256"])
                if key not in seen:
                    verify_file(workspace.root / "runs" / run_id, descriptor)
                    seen.add(key)


def empty():
    return {}


def _sum():
    return [0.0, 0.0]


def _add(accumulator, value):
    """Neumaier compensated merge of a finite window reduction."""
    if not math.isfinite(value):
        raise ValueError("Native export reduction exceeds finite float64 range")
    previous, correction = accumulator
    total = previous + value
    correction += ((previous - total) + value if abs(previous) >= abs(value)
                   else (value - total) + previous)
    if not math.isfinite(total) or not math.isfinite(correction):
        raise ValueError("Native export total exceeds finite float64 range")
    accumulator[:] = (total, correction)


def _total(accumulator):
    result = math.fsum(accumulator)
    if not math.isfinite(result):
        raise ValueError("Native export total exceeds finite float64 range")
    return result


def _partition():
    return {"cells": 0, "baseline": _sum(), "alternative": _sum(), "avoided": _sum()}


def _metric():
    return {
        "cells": 0, "categorical_common_cells": 0,
        "mass": {role: _sum() for role in RUNS},
        "avoided": {role: _sum() for role in ALTERNATIVES},
        "advantage": _sum(),
        "partitions": {role: {part: _partition() for part in PARTITIONS}
                       for role in ALTERNATIVES},
        "support": hashlib.sha256(b"window-addressed-three-run-finite-native-mask/v1\n"),
    }


def accumulate(state, arrays, categorical_common, inside, quantities, window):
    """quantities[pollutant][run] is the original (mass_values, finite_mask)."""
    import numpy as np
    for pollutant, runs in quantities.items():
        value = state.setdefault(pollutant, _metric())
        selected = inside & np.logical_and.reduce([runs[role][1] for role in RUNS])
        common = selected & categorical_common
        value["cells"] += int(np.count_nonzero(selected))
        value["categorical_common_cells"] += int(np.count_nonzero(common))
        address = [int(window.row_off), int(window.col_off), int(window.height), int(window.width)]
        value["support"].update(json.dumps(address, separators=(",", ":")).encode("ascii") + b"\n")
        value["support"].update(np.packbits(selected, bitorder="little").tobytes())
        # The reader already converted native density once, using original area.
        for role in RUNS:
            _add(value["mass"][role], float(np.sum(runs[role][0][selected], dtype="float64")))
        for role in ALTERNATIVES:
            difference = runs["baseline"][0][selected] - runs[role][0][selected]
            _add(value["avoided"][role], float(np.sum(difference, dtype="float64")))
        _add(value["advantage"], float(np.sum(
            runs["control"][0][selected] - runs["restoration"][0][selected], dtype="float64")))
        for role in ALTERNATIVES:
            changed = arrays[role] != arrays["baseline"]
            parts = {"changed_source_cells": common & changed,
                     "unchanged_source_cells": common & ~changed,
                     "unknown_categorical_support": selected & ~categorical_common}
            for name, mask in parts.items():
                item = value["partitions"][role][name]
                item["cells"] += int(np.count_nonzero(mask))
                baseline = runs["baseline"][0][mask]
                alternative = runs[role][0][mask]
                _add(item["baseline"], float(np.sum(baseline, dtype="float64")))
                _add(item["alternative"], float(np.sum(alternative, dtype="float64")))
                _add(item["avoided"], float(np.sum(baseline - alternative, dtype="float64")))


def finish(state, region, area, binding):
    """Use already-computed exact local areas; never manufacture a denominator."""
    result = {}
    for pollutant, support in region["native_support"].items():
        value = state.get(pollutant, _metric())
        n = value["cells"]
        if (n != support["native_common_cells"]
                or value["categorical_common_cells"] != support["landcover_and_native_common_cells"]):
            raise ValueError("Three-run sums lost the original allocation's native common support")
        masses = {role: _total(value["mass"][role]) if n else None for role in RUNS}
        common_class_budget = bool(region["balance"]["equal_local_original_class_counts"])
        common_area_budget = bool(region["balance"]["equal_local_changed_counts"])
        restoration_area = region["alternatives"]["restoration"]["changed_hectares"]
        control_area = region["alternatives"]["control"]["changed_hectares"]
        shared_budget = restoration_area > 0 and common_area_budget and common_class_budget
        advantage = _total(value["advantage"]) if n else None
        alternatives = {}
        for role in ALTERNATIVES:
            changed_area = region["alternatives"][role]["changed_hectares"]
            whole = binding["whole_scenario_intervention"][role]
            if not math.isclose(whole["pixel_area_ha"], area, rel_tol=1e-10, abs_tol=1e-12):
                raise ValueError("Original intervention and native grid pixel areas differ")
            whole_area = whole["hectares"]
            common_area = support[role + "_changed_hectares"]
            if (region["alternatives"][role]["changed_cells"] > whole["cells"]
                    or support[role + "_changed_cells"] > region["alternatives"][role]["changed_cells"]):
                raise ValueError("Local intervention support exceeds the original whole-scenario intervention")
            avoided = _total(value["avoided"][role]) if n else None
            partitions = {}
            for name, item in value["partitions"][role].items():
                count = item["cells"]
                partitions[name] = {
                    "cells": count, "hectares": count * area,
                    "baseline_mass": _total(item["baseline"]) if count else None,
                    "alternative_mass": _total(item["alternative"]) if count else None,
                    "avoided_export_mass": _total(item["avoided"]) if count else None,
                }
            if sum(item["cells"] for item in partitions.values()) != n:
                raise ValueError("Native source-cell change partitions do not cover common support")
            if partitions["changed_source_cells"]["cells"] != support[role + "_changed_cells"]:
                raise ValueError("Native changed-cell partition differs from original support")
            alternatives[role] = {
                "run_id": region["alternatives"][role]["run_id"],
                "avoided_export_mass": avoided,
                "avoided_export_percent": (100 * avoided / masses["baseline"]
                                           if n and masses["baseline"] else None),
                "whole_scenario_changed_hectares": whole_area,
                "region_changed_hectares": changed_area,
                "native_common_changed_hectares": common_area,
                "changed_native_support_fraction": common_area / changed_area if changed_area > 0 else None,
                "whole_scenario_footprint_id": whole["footprint_id"],
                "actual_changed_hectares": changed_area,
                "avoided_export_per_changed_ha": avoided / changed_area if n and changed_area > 0 else None,
                "avoided_export_per_whole_scenario_changed_ha": (
                    avoided / whole_area if n and whole_area > 0 else None),
                "avoided_export_per_native_common_changed_ha": (
                    avoided / common_area if n and common_area > 0 else None),
                "normalization_basis": "all common native source-cell change divided by actual local changed-cell hectares",
                "whole_scenario_normalization_basis": "region common native source-cell change divided by verified whole-scenario changed-cell hectares",
                "native_common_normalization_basis": "region common native source-cell change divided by changed-cell hectares inside that native common support",
                "local_rate_unavailable_reason": ("no_common_native_support" if not n else
                                                  "zero_region_changed_area" if changed_area == 0 else None),
                "whole_scenario_rate_unavailable_reason": ("no_common_native_support" if not n else
                                                           "zero_whole_scenario_changed_area" if whole_area == 0 else None),
                "native_common_rate_unavailable_reason": ("no_common_native_support" if not n else
                                                         "zero_native_common_changed_area" if common_area == 0 else None),
                "avoided_export_percent_unavailable_reason": ("no_common_native_support" if not n else
                                                             "zero_baseline_mass" if masses["baseline"] == 0 else None),
                "zero_local_treatment_with_native_change": bool(n and changed_area == 0 and avoided != 0),
                "source_cell_partitions": partitions,
            }
        if not n:
            interpretation = "No common finite native cells; no mass or normalized contrast is available."
        elif shared_budget and region["kind"] == "whole_selection":
            interpretation = ("Same-cell whole-selection modeled contrast with equal positive intervention area "
                              "and equal original-class counts. Remaining physical/site differences are retained "
                              "in the covariate report; this is a simulated scenario comparison.")
        elif shared_budget:
            interpretation = ("Same-cell local modeled contrast with equal local area and original-class counts. "
                              "Other parts of both scenarios can alter delivery from these source cells; "
                              "this is not an isolated local experiment.")
        else:
            interpretation = ("Same-cell modeled contrast with different or zero local intervention budgets. "
                              "Read actual changed hectares/classes; no equal-budget advantage per hectare is supplied.")
        result[pollutant] = {
            "schema": SCHEMA, "units": rasters.MASS_UNITS[pollutant].replace("/pixel", ""),
            "normalized_units": rasters.MASS_UNITS[pollutant].split("/")[0] + "/(ha*year)",
            "mass_unavailable_reason": "no_common_native_support" if not n else None,
            "native_common_cells": n, "native_common_hectares": n * area,
            "categorical_and_native_common_cells": value["categorical_common_cells"],
            "native_common_fraction_of_selected": n / region["selected_cells"] if region["selected_cells"] else None,
            "mask_sha256": value["support"].hexdigest(),
            "mask_method": "window-addressed-three-run-finite-native-mask/v1",
            "mass": masses, "alternatives": alternatives,
            "restoration_advantage_mass": advantage,
            "positive_advantage_means": "less modeled export under restoration than control",
            "equal_positive_local_area_and_class_budget": shared_budget,
            "shared_changed_hectares": restoration_area if shared_budget else None,
            "advantage_per_shared_changed_ha": advantage / restoration_area if n and shared_budget else None,
            "shared_advantage_label": "C-R per equal local changed ha (descriptive)",
            "shared_advantage_unavailable_reason": (
                "no_common_native_support" if not n else
                "zero_local_changed_area" if restoration_area == 0 or control_area == 0 else
                "unequal_local_changed_area" if not common_area_budget else
                "unequal_local_original_class_counts" if not common_class_budget else None),
            "original_restoration_changed_hectares": restoration_area,
            "original_control_changed_hectares": control_area,
            "interpretation": interpretation,
        }
        # Physical sums and divisions must never serialize nonfinite output.
        def finite_numbers(value):
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("A native siting ratio exceeds finite float64 range")
            if isinstance(value, dict):
                for item in value.values():
                    finite_numbers(item)
            elif isinstance(value, (list, tuple)):
                for item in value:
                    finite_numbers(item)
        finite_numbers(result[pollutant])
    return result


def report_sections(report):
    rows, denominators = [], []
    for region in report["regions"]:
        if region["kind"] not in ("whole_selection", "utility_upstream_union", "boundary_intersection"):
            continue
        for pollutant, value in region["siting_contrasts"].items():
            def show(number):
                return "Unavailable" if number is None else format(number, ".7g")
            for role, alternative in value["alternatives"].items():
                denominators.append([
                    region["title"], region["quantity_scope"], pollutant, role,
                    show(alternative["whole_scenario_changed_hectares"]),
                    show(alternative["region_changed_hectares"]),
                    show(alternative["native_common_changed_hectares"]),
                    show(alternative["avoided_export_per_changed_ha"]),
                    value["normalized_units"],
                ])
            rows.append([
                region["title"], region["quantity_scope"], pollutant, value["units"],
                value["native_common_cells"],
                show(value["alternatives"]["restoration"]["avoided_export_mass"]),
                show(value["alternatives"]["control"]["avoided_export_mass"]),
                show(value["restoration_advantage_mass"]),
                "equal positive area/classes" if value["equal_positive_local_area_and_class_budget"]
                else "different or zero local budget",
            ])
    boundary_sections = []
    for region in report["regions"]:
        if region["kind"] != "boundary_intersection":
            continue
        def amount(value):
            return "Unavailable" if value is None else format(value, ".7g")
        boundary_sections.append([region["title"], [
            "Original boundary: " + region["boundary_description"] + ". "
            "This region intersects the complete retained upstream model domain with that boundary. "
            "The selected reporting-HUC mask remains a separate region.",
            "Vector area: " + amount(region["vector_area_ha"]) + " ha; raster-selected area: "
            + amount(region["selected_pixel_area_ha"]) + " ha. Common output support below "
            "is the finite intersection of the same baseline, restoration and control rasters "
            "for each quantity. Missing outputs remain excluded.",
            {"kind": "table",
             "columns": ["Quantity", "Annual units", "Common cells", "Common ha",
                         "Baseline", "Restoration", "Matched control"],
             "rows": [[pollutant, value["units"], value["native_common_cells"],
                       amount(value["native_common_hectares"]),
                       *[amount(value["mass"][role]) for role in RUNS]]
                      for pollutant, value in region["siting_contrasts"].items()]},
            "These are contributions from source cells inside the named region reaching modeled streams. "
            "The original full-domain outputs retain upstream interactions; the region total does not "
            "represent flow across the state boundary or delivered load at an intake. Original masks, "
            "run identities and full-precision quantities remain in the linked source tables.",
        ]])
    return boundary_sections + [["Restoration versus control on identical native cells", [
        NOTES[0], NOTES[1], NOTES[2], NOTES[3],
        {"kind": "table",
         "columns": ["Original region", "Scope", "Quantity", "Units", "Common cells",
                     "Restoration avoided", "Control avoided", "Restoration advantage", "Local budget"],
         "rows": rows},
        NOTES[4],
        {"kind": "table",
         "columns": ["Original region", "Scope", "Quantity", "Scenario",
                     "Whole-scenario changed ha", "Changed ha in region",
                     "Changed ha in native common support", "B-R or B-C / local changed ha",
                     "Rate units"],
         "rows": denominators},
        "The three denominators answer different questions. Whole-scenario area describes the complete intervention; "
        "region area describes local allocation; common-support changed area shows which changed source cells have "
        "all three finite native outputs. Their ratios remain separately named. None isolates a local causal effect, "
        "and the entire region's mass difference is not reassigned exclusively to its converted pixels.",
        NOTES[5], NOTES[6], NOTES[7], NOTES[8],
        "The complete original-region totals, denominator values, common-mask identities and "
        "source-cell partitions are in siting-contrasts.csv, siting-change-partitions.csv and "
        "siting-contrasts.json. Historical pairwise quantities remain separately available.",
        {"kind": "links", "items": [{"title": path, "path": path} for path in LINKS]},
    ]]]


def write(directory, report, binding, implementation):
    if (len(implementation) != binding["implementation"]["bytes"]
            or hashlib.sha256(implementation).hexdigest() != binding["implementation"]["sha256"]):
        raise ValueError("The snapshotted siting reader changed before retention")
    rows, partitions = [], []
    prefix_fields = ("region_id", "title", "kind", "relationship", "quantity_scope", "baseline_run_id")
    for region in report["regions"]:
        prefix = {key: region[key] for key in prefix_fields if key not in ("region_id", "baseline_run_id")}
        prefix["region_id"] = region["id"]
        prefix["baseline_run_id"] = report["run_ids"]["baseline"]
        for pollutant, value in region["siting_contrasts"].items():
            row = {**prefix, "pollutant": pollutant, "units": value["units"],
                   "normalized_units": value["normalized_units"],
                   "mass_unavailable_reason": value["mass_unavailable_reason"],
                   "shared_advantage_label": value["shared_advantage_label"],
                   "shared_advantage_unavailable_reason": value["shared_advantage_unavailable_reason"],
                   **{key: value[key] for key in ("native_common_cells", "native_common_hectares",
                       "categorical_and_native_common_cells", "native_common_fraction_of_selected",
                       "mask_sha256", "restoration_advantage_mass",
                       "equal_positive_local_area_and_class_budget", "shared_changed_hectares",
                       "advantage_per_shared_changed_ha", "interpretation")}}
            for role in RUNS:
                row[role + "_mass"] = value["mass"][role]
            for role, alternative in value["alternatives"].items():
                for key in ("run_id", "avoided_export_mass", "avoided_export_percent",
                            "whole_scenario_changed_hectares", "region_changed_hectares",
                            "native_common_changed_hectares", "changed_native_support_fraction",
                            "whole_scenario_footprint_id", "actual_changed_hectares",
                            "avoided_export_per_changed_ha", "avoided_export_per_whole_scenario_changed_ha",
                            "avoided_export_per_native_common_changed_ha", "normalization_basis",
                            "whole_scenario_normalization_basis", "native_common_normalization_basis",
                            "local_rate_unavailable_reason", "whole_scenario_rate_unavailable_reason",
                            "native_common_rate_unavailable_reason", "avoided_export_percent_unavailable_reason",
                            "zero_local_treatment_with_native_change"):
                    row[role + "_" + key] = alternative[key]
                for name, item in alternative["source_cell_partitions"].items():
                    partitions.append({**prefix, "pollutant": pollutant, "units": value["units"],
                                       "scenario": role, "run_id": alternative["run_id"],
                                       "partition": name, **item})
            rows.append(row)
    fields = (*prefix_fields, "pollutant", "units", "normalized_units", "mass_unavailable_reason",
        "shared_advantage_label", "shared_advantage_unavailable_reason",
        "native_common_cells", "native_common_hectares",
        "categorical_and_native_common_cells", "native_common_fraction_of_selected", "mask_sha256",
        *[role + "_mass" for role in RUNS],
        *[role + "_" + key for role in ALTERNATIVES for key in (
            "run_id", "avoided_export_mass", "avoided_export_percent",
            "whole_scenario_changed_hectares", "region_changed_hectares",
            "native_common_changed_hectares", "changed_native_support_fraction",
            "whole_scenario_footprint_id", "actual_changed_hectares", "avoided_export_per_changed_ha",
            "avoided_export_per_whole_scenario_changed_ha", "avoided_export_per_native_common_changed_ha",
            "normalization_basis", "whole_scenario_normalization_basis", "native_common_normalization_basis",
            "local_rate_unavailable_reason", "whole_scenario_rate_unavailable_reason",
            "native_common_rate_unavailable_reason", "avoided_export_percent_unavailable_reason",
            "zero_local_treatment_with_native_change")],
        "restoration_advantage_mass", "equal_positive_local_area_and_class_budget",
        "shared_changed_hectares", "advantage_per_shared_changed_ha", "interpretation")
    directory = Path(directory)
    for name, data, columns in (
        ("siting-contrasts.csv", rows, fields),
        ("siting-change-partitions.csv", partitions, (*prefix_fields, "pollutant", "units",
            "scenario", "run_id", "partition", "cells", "hectares", "baseline_mass",
            "alternative_mass", "avoided_export_mass"))):
        with (directory / name).open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerows(data)
    atomic_json(directory / "siting-contrasts.json", {
        "schema": SCHEMA, "allocation_id": report["id"], "source_binding": binding,
        "notes": NOTES, "rows": rows, "source_cell_partitions": partitions})
    atomic_json(directory / "siting-contrast-sources.json", binding)
    atomic_bytes(directory / "geographic_siting_contrasts.py", implementation)
    return {"sections": report_sections(report), "source_links": list(LINKS)}
