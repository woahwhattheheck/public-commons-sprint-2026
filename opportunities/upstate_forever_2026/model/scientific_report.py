"""Readable scientific delivery reports from retained original model records.

The formatter does not recompute native exports, fit parameters, or choose
scenarios. PDF, offline HTML and structured report data share the same blocks.
"""
from __future__ import annotations

import base64
from hashlib import sha256
from html import escape as html_escape
import math
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .common import atomic_bytes, atomic_json, describe_file
from . import rasters, observation_diagnostics, observation_support
from .model_selection import run_scope
from .native_versions import (POLICY as EXECUTION_VERSION_POLICY, guide_url,
                              model_versions, models_for_outputs, version_label)

REPORT_VERSION = "upstate.scientific-report/v18-original-source-admission"
POLLUTANT_NAMES = {
    "nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
    "sediment_export": "Sediment", "nitrogen": "Nitrogen",
    "phosphorus": "Phosphorus", "sediment": "Sediment",
}
PARAMETERS = {
    "threshold_flow_accumulation": ("Stream threshold", "upstream cells"),
    "k_param": ("Connectivity response parameter", "dimensionless"),
    "flow_dir_algorithm": ("Flow direction", ""),
    "subsurface_critical_length_n": ("Subsurface nitrogen retention length", "m"),
    "subsurface_eff_n": ("Subsurface nitrogen retention efficiency", "fraction"),
    "runoff_proxy_av": ("Reference runoff proxy average", "original proxy units"),
    "sdr_max": ("Maximum sediment delivery ratio", "fraction"),
    "ic_0_param": ("Reference connectivity index", "dimensionless"),
    "l_max": ("Maximum USLE L factor", "dimensionless"),
}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _number(value, *, signed=False):
    if not _finite(value):
        return "Unavailable"
    if value == 0:
        return "0"
    return format(value, "+,.6g" if signed else ",.6g")


def _count(value):
    if not _finite(value) or value < 0 or int(value) != value:
        return "Unavailable"
    return format(int(value), ",")


def _unit(value):
    return str(value or "").replace("metric_tonnes", "metric tonnes").replace("hectare", "ha")


def _label(value):
    return POLLUTANT_NAMES.get(value, str(value).replace("_", " ").strip().capitalize())


def _plain(value):
    """Render source-supplied labels and references without JSON punctuation."""
    if value is None:
        return "Unspecified"
    if isinstance(value, dict):
        return "; ".join(_label(key) + ": " + _plain(item) for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return "; ".join(_plain(item) for item in value) or "None"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def _mass_units(pollutant, record=None):
    record = record or {}
    return _unit(record.get("sum_units") or rasters.MASS_UNITS.get(pollutant, record.get("units", "")).replace("/pixel", ""))


def _quantity(record, field="sum", *, signed=False):
    # A native comparison's accumulator starts at zero even with no valid pair.
    # Only a positive actual support count makes that scalar a measured result.
    support = record.get("valid_cells")
    if not _finite(support) or support <= 0:
        return "Unavailable"
    return _number(record.get(field), signed=signed)


def _percent(value):
    return _number(100 * value) + "%" if _finite(value) else "Unavailable"


def link(title, target):
    """Retain a readable label and exact safe original/reference target."""
    label, href = str(title), str(target or "")
    if not href or "\\" in href or any(ord(char) < 32 or ord(char) == 127 for char in href):
        return label
    try:
        parsed = urlsplit(href)
    except ValueError:
        return label
    if parsed.scheme:
        if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
            return label
    else:
        decoded = unquote(parsed.path)
        if (parsed.netloc or not decoded or decoded.startswith(("/", "\\"))
                or "\\" in decoded or any(ord(char) < 32 or ord(char) == 127 for char in decoded)
                or any(part == ".." for part in decoded.split("/"))):
            return label
    return {"kind": "link", "label": label, "href": href}

def _cell(value):
    if isinstance(value, dict) and value.get("kind") == "link":
        return link(value.get("label", value.get("href", "")), value.get("href"))
    return str(value)


def _table(columns, rows, *, widths=None, caption=None):
    columns = [str(value) for value in columns]
    normalized = [[_cell(value) for value in row] for row in rows]
    if any(len(row) != len(columns) for row in normalized):
        raise ValueError("Scientific report table row does not match its columns")
    if widths is not None and (len(widths) != len(columns) or any(not _finite(v) or v <= 0 for v in widths)):
        raise ValueError("Scientific report table needs one positive width per column")
    return {"kind": "table", "columns": columns, "rows": normalized,
            "widths": widths, "caption": caption}


def _current_exports(baseline, grid):
    cell_area = grid.get("grid", grid).get("pixel_area_ha")
    rows = []
    for pollutant in rasters.MASS_UNITS:
        item = baseline.get("artifacts", {}).get(pollutant)
        if item is None:
            continue
        area = item.get("pixel_area_ha", cell_area)
        cells = item.get("valid_cells")
        support = cells * area if _finite(cells) and _finite(area) else None
        rows.append([_label(pollutant), _quantity(item), _mass_units(pollutant, item),
                     _count(cells), _number(support)])
    return [
        "Annual exports are totals over the valid modeled cells inside the retained reporting mask. "
        "The supporting area is the area of those valid cells. Original missing cells remain absent.",
        _table(["Pollutant", "Annual export", "Unit", "Valid cells", "Support (ha)"],
               rows, widths=[1.0, 1.0, 1.3, .9, 1.0]),
        "Figures are displayed to six significant digits. Complete numeric values and the original "
        "rasters are retained in the working project. An unavailable value has no usable reported support.",
    ]


def _biophysical(workspace, profile, *, execution_versions=None):
    """Read the exact original CSV bound to the saved native profile."""
    from .model_selection import selected
    from .profiles import inspect_table

    path, entry = workspace.source_file(
        profile["source_collection_id"], profile["biophysical_source_id"])
    if entry["kind"] != "table":
        raise ValueError("Select the original biophysical CSV source")
    if entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("Original biophysical table differs from the saved profile")
    active = selected(profile)
    table = inspect_table(path, selected_models=active)

    def cell(row, key):
        value = row.get(key)
        if value is None:
            return "(missing source cell)"
        return value if value != "" else "(empty source cell)"

    blocks = [
        "Original biophysical coefficients",
        "The following tables preserve every row and source value from the CSV selected by this profile. "
        "The nutrient loading basis is retained for each land-cover code. "
        "Values are the saved input assumptions used by the native model.",
        _table(["Source property", "Retained value"], [
            ["Profile", str(profile.get("id", profile["title"]))],
            ["Selected native models", ", ".join(name.upper() for name in active)],
            ["Source collection", str(profile["source_collection_id"])],
            ["Source ID", str(profile["biophysical_source_id"])],
            ["Source title", str(entry.get("title", entry["id"]))],
            ["Source edition", _plain(entry.get("vintage"))],
            ["Original reference", _plain(entry.get("uri"))],
            ["Original CSV", str(entry["body"]["filename"])],
            ["SHA256", str(entry["body"]["sha256"])],
            ["Original rows / columns", str(len(table["rows"])) + " / " + str(len(table["columns"]))],
        ], widths=[1.4, 4.6]),
    ]
    used = {"lucode"}
    if "ndr" in active:
        for nutrient, name in (("n", "Nitrogen"), ("p", "Phosphorus")):
            fields = ["lucode", "load_" + nutrient, "load_type_" + nutrient,
                      "eff_" + nutrient, "crit_len_" + nutrient]
            headings = ["Land-cover code", "Load (kg/ha/year)", "Loading basis",
                        "Maximum retention (fraction)", "Critical length (m)"]
            widths = [.7, .9, 1.4, 1.0, 1.0]
            if nutrient == "n":
                fields.append("proportion_subsurface_n")
                headings.append("Subsurface share (fraction)")
                widths.append(1.0)
            used.update(fields)
            blocks.append(_table(
                headings, [[cell(row, key) for key in fields] for row in table["rows"]],
                widths=widths, caption=name + " coefficients in original source order.",
            ))
        blocks.append(
            "Loading basis follows the selected InVEST engine: application-rate inputs are adjusted "
            "using load * (1 - eff); measured-runoff inputs enter without that on-pixel adjustment. "
            "The displayed loads remain the original CSV values. Retention and subsurface shares "
            "are fractions; critical lengths are metres."
        )
    if "sdr" in active:
        fields = ["lucode", "usle_c", "usle_p"]
        used.update(fields)
        blocks.append(_table(
            ["Land-cover code", "Cover-management factor C", "Support-practice factor P"],
            [[cell(row, key) for key in fields] for row in table["rows"]],
            widths=[.8, 2.1, 2.1],
            caption="Sediment coefficients in original source order. Both USLE factors are dimensionless.",
        ))
    extra = [key for key in table["columns"] if key not in used]
    if extra:
        blocks.append(_table(
            ["Land-cover code", "Original field", "Original value"],
            [[cell(row, "lucode"), key, cell(row, key)]
             for row in table["rows"] for key in extra],
            widths=[.8, 1.4, 3.8],
            caption="Additional original CSV fields, including source descriptions and references. "
                    "Fields outside the selected model requirements retain their original names and values.",
        ))
    versions = execution_versions or {}
    if versions:
        references = []
        for name in active:
            record = versions.get(name)
            if record is None:
                continue
            url = guide_url(name, record)
            references.append([
                name.upper(), version_label(record),
                link("Version-specific model guide", url) if url else "Version-specific guide unavailable",
            ])
        if references:
            blocks.append(_table(
                ["Model", "Baseline version and source", "Field definitions"],
                references, widths=[.6, 3.0, 2.4],
                caption="Guides follow the baseline's retained producing-model version. "
                        "Completed-stage, observed-run fallback and requested-legacy bases remain distinct.",
            ))
    else:
        blocks.append("This profile preserves its original field definitions and coefficient values. "
                      "Version-specific execution references accompany the retained native runs.")
    return blocks


def _profile(profile, workspace, *, execution_versions=None):
    rows = []
    for model in ("ndr", "sdr"):
        for key, value in profile.get(model, {}).items():
            name, unit = PARAMETERS.get(key, (_label(key), ""))
            shown = _number(value) if _finite(value) else _plain(value)
            rows.append([model.upper(), name, shown, unit])
    blocks = [str(profile.get("title") or "Selected model profile"),
              _table(["Model", "Setting", "Value", "Unit"], rows, widths=[.55, 2.5, 1.05, 1.5])]
    for reference in (profile.get("references") if isinstance(profile.get("references"), list)
                      else [profile.get("references")]):
        if reference is not None:
            blocks.append("Profile reference: " + _plain(reference))
    if profile.get("model_period"):
        blocks.append("Model period: " + _plain(profile["model_period"]))
    blocks.extend(_biophysical(workspace, profile, execution_versions=execution_versions))
    return blocks


def _scenario_patch_context(scenario, retained_edits):
    """Read original native patch accounting without recomputing raster values."""
    patches = scenario.get("patches", [])
    if not patches:
        return ["This scenario declares no land-cover patches."]
    by_index = {row.get("index"): row for row in retained_edits}
    blocks, declared, accounting, areas, support, transitions, legacy = [], [], [], [], [], [], []
    modern = []
    modern_fields = ("eligible_cells", "already_destination_cells", "changed_cells",
                     "final_owned_cells", "eligible_hectares", "changed_hectares",
                     "final_owned_hectares")
    for index, patch in enumerate(patches):
        label = "P" + str(index + 1)
        edit = by_index.get(index, {})
        declared.append([label, patch["mask_source_id"],
                         ", ".join(str(code) for code in patch["from_codes"])
                         + " to " + str(patch["to_code"]), str(patch["reason"])])
        is_modern = all(_finite(edit.get(field)) and edit[field] >= 0 for field in modern_fields)
        if not is_modern:
            legacy.append([label, _count(edit.get("changed_cells")),
                           _number(edit.get("changed_hectares")),
                           "No complete retained eligible/unchanged/final-owned accounting"])
            continue
        modern.append(edit)
        accounting.append([label, _count(edit["eligible_cells"]),
                           _count(edit["already_destination_cells"]), _count(edit["changed_cells"]),
                           _count(edit["final_owned_cells"])])
        areas.append([label, _number(edit["eligible_hectares"]),
                      _number(edit["changed_hectares"]), _number(edit["final_owned_hectares"])])
        support.append([label, _count(edit.get("valid_mask_cells")),
                        _count(edit.get("nodata_mask_cells")),
                        _count(edit.get("overlap_with_earlier_masks_cells")),
                        _count(edit.get("changed_earlier_cells")),
                        _count(edit.get("cascaded_change_cells")),
                        _count(edit.get("reverted_to_baseline_cells"))])
        for row in edit.get("transitions", []):
            transitions.append([label, str(row["from_code"]), str(row["to_code"]),
                                _count(row["cells"]), _number(row["hectares"])])
        if edit.get("source"):
            blocks.append(_table(["Patch", "Original mask source property", "Retained value"],
                                 [[label, name, value] for name, value in _retained_rows(edit["source"])],
                                 widths=[.5, 1.8, 3.7]))
    declaration = _table(["Patch", "Original mask source", "Declared land-cover codes", "Purpose"],
                         declared, widths=[.5, 1.5, 1.4, 2.6],
                         caption="P1, P2 and subsequent labels follow the original declared application order. "
                                 "Each source-code predicate sees the values left by preceding patches.")
    # The human-readable tables and complete original native edit records travel together.
    declaration["retained_native_edits"] = retained_edits
    result = [declaration]
    if accounting:
        result.append(_table(["Patch", "Eligible cells", "Already destination",
                              "Immediate value changes", "Final changed cells owned"],
                             accounting, widths=[.5, 1.2, 1.3, 1.5, 1.5],
                             caption="Eligible cells include those already carrying the destination code. "
                                     "Immediate changes count only actual value changes at that patch. "
                                     "Final ownership assigns each cell still different from baseline to its "
                                     "last value-changing patch, making those final sets disjoint."))
        result.append(_table(["Patch", "Eligible area (ha)", "Immediate changed area (ha)",
                              "Final owned changed area (ha)"],
                             areas, widths=[.5, 1.6, 1.9, 2.0],
                             caption="Retained areas use the original projected model grid. Eligible and "
                                     "immediate-change areas can overlap across patches and are not added."))
        result.append(_table(["Patch", "Valid mask cells", "Original NoData cells",
                              "Earlier mask overlap", "Cells changed earlier",
                              "Cascaded changes", "Reversions at this patch"],
                             support,
                             caption="These are original patch-stage counts. Overlap, cascades and reversions "
                                     "describe the ordered editing process, not additive final areas. "
                                     "Original NoData remains outside the valid categorical footprint."))
        if len(modern) == len(patches) and len(by_index) == len(patches):
            result.append(
                "Final net land-cover footprint across all declared patches: "
                + _count(sum(row["final_owned_cells"] for row in modern)) + " cells; "
                + _number(sum(row["final_owned_hectares"] for row in modern)) + " ha. "
                "This total sums only the disjoint retained final-owned sets. It describes land-cover "
                "change, while the paired native outputs below describe modeled export change."
            )
        if transitions:
            result.append(_table(["Patch", "Previous code", "Assigned code", "Eligible assignments", "Assigned ha"],
                                 transitions, widths=[.5, 1.3, 1.3, 1.45, 1.45],
                                 caption="Original eligible assignments at each patch, including same-code rows "
                                         "whose values remain unchanged. A cell can occur again after a later patch."))
    if legacy:
        result.append(_table(["Patch", "Retained counter", "Retained counter area (ha)", "Available accounting"],
                             legacy, widths=[.5, 1.1, 1.5, 2.9],
                             caption="Earlier native records lack complete current footprint fields. "
                                     "Their saved counters are displayed as recorded; they do not establish "
                                     "actual immediate changes or a final net changed area."))
        result.append("The final net footprint remains unavailable from these retained patch records. "
                      "The paired model comparison below keeps its original valid-cell support.")
    result.extend(blocks)
    return result


def _scenario_sections(workspace, alternatives, comparison):
    blocks = [
        "Each alternative uses its retained land-cover assumptions. Changes are alternative minus baseline "
        "over cells valid in both runs. Positive values mean higher modeled export; negative values mean "
        "lower modeled export. Baseline and alternative totals over different valid footprints are not subtracted.",
    ]
    compared = {row["run_id"]: row for row in comparison.get("alternatives", [])}
    for run in alternatives:
        scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
        blocks.extend([str(scenario["title"]), str(scenario["reason"])])
        retained_edits = run.get("stages", {}).get("landcover", {}).get("edits", [])
        blocks.extend(_scenario_patch_context(scenario, retained_edits))
        rows = []
        for pollutant, item in compared.get(run["id"], {}).get("artifacts", {}).items():
            if pollutant not in rasters.MASS_UNITS:
                continue
            count, change = item.get("valid_cells"), item.get("sum_change")
            if count == 0:
                direction = "No shared valid cells"
            elif not _finite(count) or count < 0 or not _finite(change):
                direction = "Unavailable"
            else:
                direction = "Higher export" if change > 0 else "Lower export" if change < 0 else "No net change"
            rows.append([_label(pollutant), _quantity(item, "sum_change", signed=True),
                         _mass_units(pollutant), _count(count), direction])
        if rows:
            blocks.append(_table(
                ["Pollutant", "Net annual change", "Unit", "Paired cells", "Interpretation"],
                rows, widths=[1.0, 1.1, 1.3, .9, 1.8],
            ))
        else:
            blocks.append("No paired quantitative comparison is attached for this scenario.")
        blocks.append("Saved scenario " + str(scenario.get("id", run["selection"]["scenario_id"]))
                      + "; native run " + str(run["id"]) + ".")
    return blocks


def _priorities(priority):
    caps, weights = priority.get("caps", {}), priority.get("weights", {})
    cap_units = priority.get("cap_units", {})
    rows = [[_label(key), _number(weights.get(key)), _number(caps.get(key)),
             _unit(cap_units.get(key, rasters.MASS_UNITS.get(key, "")))]
            for key in rasters.MASS_UNITS if key in caps or key in weights]
    blocks = [
        "The combined map is a dimensionless planning index. Each pollutant stays in its own physical "
        "unit before normalization; the selected weights express the planning emphasis.",
        _table(["Pollutant", "Weight", "Normalization cap", "Cap unit"], rows, widths=[1.1, .7, 1.3, 1.7]),
    ]
    if priority.get("percentile") is not None:
        blocks.append("Reference cap percentile: " + _number(priority["percentile"]) + ".")
    if priority.get("method"):
        blocks.append("Recorded normalization method: " + _plain(priority["method"]) + ".")
    for key in ("reference", "scope", "comparison"):
        if priority.get(key) is not None:
            blocks.append("Recorded normalization " + key + ": " + _plain(priority[key]) + ".")
    blocks.append("Use the separate physical export and scenario-change tables when comparing annual quantities.")
    return blocks


def _context_source_links(value):
    """Retain distinct publisher URLs from original contextual source records."""
    found = {}
    def visit(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if isinstance(child, str) and (child.startswith("https://") or child.startswith("http://")):
                    label = str(item.get("source_response_id") or item.get("title") or _label(key))
                    found.setdefault(child, label)
                else:
                    visit(child)
        elif isinstance(item, (list, tuple)):
            for child in item:
                visit(child)
    visit(value)
    return [link(label, target) for target, label in found.items()]


def _observation_context(result):
    """Present original non-fit quantities without converting their support."""
    blocks = []
    summary = result.get("support_summary", {})
    counts = summary.get("counts", {})
    if counts:
        titles = summary.get("titles", {})
        blocks.append(_table(
            ["Original imported measurement support", "Source rows"],
            [[titles.get(key, _label(key)), _count(value)] for key, value in counts.items()],
            widths=[4.6, 1.0],
            caption="Counts describe the imported source edition before catchment matching. "
                    "Only the separately listed admitted catchment comparisons enter fit metrics.",
        ))
    admission = result.get("source_admission")
    if isinstance(admission, dict):
        used = sum(bool(row.get("included_in_metrics")) for row in result.get("comparisons", []))
        admission_table = _table(
            ["Source admission at this comparison", "Original rows"],
            [["Retained source edition", _count(admission.get("source_row_count"))],
             ["Admitted by the original import", _count(admission.get("original_admitted_count"))],
             ["Eligible under this comparison's source rules", _count(admission.get("eligible_count"))],
             ["Retained as source context", _count(admission.get("excluded_count"))],
             ["Entered fit metrics after native catchment matching", _count(used)]],
            widths=[4.8, 1.0],
            caption="Admission is captured with this comparison. The original import stays unchanged; "
                    "native model availability, catchment matching and complete raster support "
                    "can further reduce the metric rows.",
        )
        admission_table["retained_source_admission"] = admission
        blocks.append(admission_table)
        reasons = admission.get("exclusion_reasons", [])
        if reasons:
            blocks.append(_table(
                ["Current source exclusion", "Affected original rows"],
                [[row["reason"], _count(row["count"])] for row in reasons],
                widths=[4.8, 1.0],
                caption="One original row can have several reasons. These counts are not additive; "
                        "the report data retains each reason's original observation record IDs.",
            ))
    if result.get("measurement_support_basis"):
        blocks.append(str(result["measurement_support_basis"]))
    context = result.get("context_rows", [])
    if not context:
        return blocks
    blocks.append(
        "Original measurements retained as context: " + _count(len(context)) + ". "
        "The following values keep their original species, units, dates, qualifiers and reporting support. "
        "They are neither converted to annual landscape exports nor substituted into catchment residuals. "
        "An unquantified source value remains unquantified."
    )
    groups = {}
    for index, row in enumerate(context, 1):
        source = row.get("source_records")
        source = source if isinstance(source, dict) else {}
        key = tuple(_plain(row.get(name)) for name in (
            "measurement_support", "station_id", "catchment_id", "facility_id", "outfall_id",
            "reporting_feature", "species", "original_parameter", "unit", "quantity_basis"))
        groups.setdefault(key, []).append((index, row, source))
    for group in groups.values():
        first, source = group[0][1], group[0][2]
        support = first.get("measurement_support") or "other_context"
        name = summary.get("titles", {}).get(support, _label(support))
        blocks.append(name + " — " + str(first.get("station_id") or first.get("facility_id")
                                       or first.get("catchment_id") or "Original source"))
        identity = [
            ["Original station", first.get("station_id")],
            ["Original catchment identifier / context", first.get("catchment_id")],
            ["Original parameter", first.get("original_parameter")],
            ["Retained species", first.get("species")],
            ["Quantity basis", first.get("quantity_basis")],
            ["Original unit", first.get("unit")],
        ]
        for field in ("facility_id", "facility_name", "outfall_id", "reporting_feature",
                      "monitoring_location", "parameter_code", "gauge_id", "gauge_relation", "relation_method"):
            if first.get(field) not in (None, ""):
                identity.append([_label(field), first[field]])
        for field in ("source_kind", "permit_id", "reporting_feature", "parameter_code",
                      "parameter_name", "catchment_reference", "state_mapped_outfall"):
            values = list(dict.fromkeys(_plain(record.get(field)) for _, _, record in group
                                        if record.get(field) not in (None, "")))
            if values:
                identity.append(["Original source: " + _label(field), "; ".join(values)])
        blocks.append(_table(["Retained context", "Original value"],
                             [[name, _plain(value)] for name, value in identity],
                             widths=[1.8, 4.2]))
        quantities, qualifications, provenance = [], [], []
        for index, row, source in group:
            label = "C" + str(index)
            period = str(row.get("period_start") or "Unspecified")
            if row.get("period_end"):
                period += " to " + str(row["period_end"])
            original = row.get("value_text")
            value = original if original not in (None, "") else "Unquantified"
            qualifier = row.get("qualifier")
            quantity = (str(qualifier) + " " if qualifier not in (None, "", "=") else "") + str(value)
            coverage = []
            if row.get("coverage_days") is not None:
                coverage.append("Represented days: " + _count(row["coverage_days"]))
            if row.get("expected_days") is not None:
                coverage.append("Expected days: " + _count(row["expected_days"]))
            if row.get("coverage_complete") is not None:
                coverage.append("Source complete: " + _plain(row["coverage_complete"]))
            if source.get("calendar_days") not in (None, ""):
                coverage.append("Original calendar days: " + str(source["calendar_days"]))
            if source.get("period_status") not in (None, ""):
                coverage.append("Original reporting status: " + str(source["period_status"]))
            quantities.append([label, period, quantity, _unit(row.get("unit")),
                               "\n".join(coverage) or "Unspecified"])
            qualifications.append([
                label, _plain(row.get("method")), _plain(qualifier) if qualifier not in (None, "") else "None recorded",
                _plain(row.get("uncertainty")), _plain(row.get("comparison_issues", [])),
            ])
            provenance.append([label, str(row["observation_id"]),
                               _plain(source.get("selected_dmr_value_ids") or source.get("result_ids")
                                      or source.get("result_id") or source.get("activity_id"))])
        table = _table(["Context row", "Original period", "Original quantity", "Unit",
                        "Retained temporal coverage / status"],
                       quantities, widths=[.55, 1.2, 1.0, .8, 2.45],
                       caption="Dates retain the source interval convention. Each row is one original "
                               "measurement or reporting period; its displayed quantity is not annualized.")
        # Complete originals travel in the downloadable report data alongside
        # their readable rows; the PDF/HTML render only the typed display fields.
        table["retained_context_records"] = [row for _, row, _ in group]
        blocks.append(table)
        blocks.append(_table(["Context row", "Method", "Original qualifier", "Source uncertainty",
                              "Reason retained outside annual fit"],
                             qualifications, widths=[.55, 1.4, .7, 1.1, 2.25]))
        blocks.append(_table(["Context row", "Original observation ID", "Selected original result IDs"],
                             provenance, widths=[.55, 3.4, 2.05],
                             caption="Context row labels follow the original retained row order. "
                                     "Complete unchanged context records, original source objects and row values "
                                     "are included in report-data.json under retained_context_records."))
        references = _context_source_links([row.get("source_records") for _, row, _ in group])
        if references:
            blocks.append(_table(["Original publisher reference"], [[item] for item in references]))
        extra = []
        for index, row, _ in group:
            for field in ("coverage_detail", "source_quantity"):
                if row.get(field) not in (None, ""):
                    extra.extend([["C" + str(index), name, value]
                                  for name, value in _retained_rows(row[field], _label(field))])
        if extra:
            blocks.append(_table(["Context row", "Original quantity / coverage field", "Saved value"],
                                 extra, widths=[.55, 1.8, 3.65]))
    return blocks


def _observations(results):
    if not results:
        return [
            "This delivery uses the selected published parameter profile. No annual-load observation "
            "comparison was selected for this report. The current model outputs can be compared with "
            "retained source catchments and annual references through the workspace.",
        ]
    blocks = [
        "The following descriptive comparisons use the selected observation periods and original catchments. "
        "Residual and bias are modeled minus observed annual mass. Repeated periods at one catchment share "
        "the same steady-state model prediction; they are not independent spatial replicates.",
    ]
    for result in results:
        blocks.append("Observation edition " + str(result["observation_id"])
                      + "; selected run " + str(result["run_id"]) + ".")
        blocks.extend(_observation_context(result))
        rows = []
        for parameter, metrics in result.get("metrics", {}).items():
            rows.append([
                _label(parameter), _count(metrics.get("n")), _count(metrics.get("unique_catchments")),
                _number(metrics.get("rmse")), _number(metrics.get("mean_bias"), signed=True),
                _number(metrics.get("nash_sutcliffe_efficiency")), _unit(metrics.get("units")),
            ])
        if rows:
            blocks.append(_table(
                ["Pollutant", "Rows", "Catchments", "RMSE", "Mean bias", "NSE", "Mass unit"],
                rows, widths=[1.1, .6, .8, .9, .9, .9, 1.2],
                caption="RMSE and mean bias use the mass unit shown; NSE is dimensionless and is undefined "
                        "when the reference has insufficient variation.",
            ))
        if result.get("metrics_basis"):
            blocks.append(str(result["metrics_basis"]))
        blocks.extend(observation_support.reference_basis_blocks(
            result.get("comparisons", []), result.get("observation_method")))
        blocks.extend(observation_diagnostics.build(result)["blocks"])
        methods = result.get("observation_method", {})
        if methods:
            blocks.append(_table(["Observation source / method field", "Retained value"],
                                 list(_retained_rows(methods)), widths=[1.7, 4.3],
                                 caption="Original observation metadata and source references."))
        for parameter in ("nitrogen", "phosphorus", "sediment"):
            selected = [row for row in result.get("comparisons", []) if row.get("parameter") == parameter]
            if not selected:
                continue
            detail = []
            for row in selected:
                place = str(row["catchment_id"])
                if row.get("station_id"):
                    place += "\nStation " + str(row["station_id"])
                period = str(row.get("period_start", "")) + " to " + str(row.get("period_end", ""))
                included = row.get("included_in_metrics") is True
                detail.append([
                    place + "\n" + observation_support.reference_basis(
                        row, result.get("observation_method"))["label"],
                    period, _number(row.get("observed_annual_mass")),
                    _number(row.get("modeled_annual_mass")),
                    _number(row.get("residual"), signed=True) if included else "Unavailable",
                    "Complete" if included else "Partial support",
                ])
            unit = _unit(selected[0].get("units"))
            blocks.append(_table(
                ["Catchment", "Observation period", "Observed", "Modeled", "Residual", "Coverage"],
                detail, widths=[1.3, 1.45, .9, .9, .9, 1.1],
                caption=_label(parameter) + ": annual quantities in " + unit + ".",
            ))
        support_rows, seen_support = [], set()
        for row in result.get("comparisons", []):
            key = (row["parameter"], row["catchment_id"])
            if key in seen_support:
                continue
            seen_support.add(key)
            support = row.get("spatial_coverage", {})
            support_rows.append([
                _label(key[0]) + "\n" + str(key[1]),
                _count(support.get("valid_cells")),
                _count(support.get("structural_stream_omission_cells")),
                _count(support.get("unexpected_missing_cells")),
                _number(support.get("catchment_area_outside_raster_ha")),
                _plain(support.get("coverage_issues", [])),
            ])
        if support_rows:
            blocks.append(_table(
                ["Catchment / pollutant", "Export cells", "Native stream omissions",
                 "Unexpected missing cells", "Outside raster (ha)", "Coverage findings"],
                support_rows, widths=[1.4, .75, .9, .9, .9, 2.1],
                caption="Coverage is reported once per catchment and pollutant. Native stream omissions "
                        "retain their original NoData and contribute no imputed mass. Partial comparisons "
                        "keep their available modeled total; only complete catchments enter residual and fit metrics.",
            ))
        source_rows = []
        for row in result.get("comparisons", []):
            source_rows.append([
                _label(row["parameter"]) + "\n" + str(row.get("station_id") or row["catchment_id"])
                + "\n" + str(row.get("period_start", "")) + " to " + str(row.get("period_end", "")),
                _plain(row.get("observed_value_text")) + " " + _unit(row.get("observed_source_unit")),
                _plain(row.get("method")) + "\nQualifier: " + _plain(row.get("observed_qualifier") or "None"),
                _plain(row.get("uncertainty")) + "\n" + _plain(row.get("source_records")),
            ])
        if source_rows:
            blocks.append(_table(
                ["Observation", "Original value / unit", "Method and qualifier", "Uncertainty and source"],
                source_rows, widths=[1.5, 1.1, 1.8, 2.1],
                caption="Original annual-reference values and source qualifications before conversion "
                        "to the comparison units. The source's uncertainty retains its original definition.",
            ))
        exclusions = result.get("exclusions", [])
        if exclusions:
            blocks.append(_table(
                ["Original observation", "Reason excluded from the comparison"],
                [[str(row.get("observation_id", "")), _plain(row.get("issues", []))] for row in exclusions],
                widths=[1.2, 4.8],
            ))
        if result.get("interpretation"):
            blocks.append(str(result["interpretation"]))
    return blocks


def _receptors(inventory):
    if not inventory:
        return None
    blocks = [str(inventory.get("method", "")), str(inventory.get("quantity_basis", ""))]
    rows = []
    for area in inventory.get("areas", []):
        rows.append([str(area.get("title", area.get("id", ""))),
                     ", ".join(str(value) for value in area.get("anchor_huc12s", [])),
                     _count(area.get("huc12_count")), _number(area.get("reporting_area_ha"))])
    blocks.append(_table(["Contributing area", "Anchor HUC12s", "HUC12 count", "Reporting ha"],
                         rows, widths=[2.0, 2.0, .8, 1.0]))
    blocks.append("The retained GIS includes original network links and upstream memberships. "
                  "Per-area quantities can overlap. Use their geographic union for a combined total.")
    return blocks


def execution_provenance(baseline, alternatives):
    """Freeze original producing-model identity without recomputing quantities."""
    runs = [baseline] + list(alternatives)
    selected = {run["id"]: models_for_outputs(run.get("artifacts", {})) for run in runs}
    def source(runtime):
        return {key: runtime[key] for key in ("version", "declared_source", "modules", "selected_models")
                if key in (runtime or {})}
    return {
        "schema": "upstate.native-execution/v1", "policy": EXECUTION_VERSION_POLICY,
        "run_order": [run["id"] for run in runs],
        "models": {key: list(value) for key, value in selected.items()},
        "runs": {run["id"]: {
            "selection": run["selection"],
            "model_versions": model_versions(run, selected[run["id"]]),
            "run_runtime_source": source(run.get("runtime")),
            "stage_runtime_sources": {
                model: source(((run.get("stages") or {}).get(model) or {}).get("runtime"))
                for model in selected[run["id"]]},
        } for run in runs},
        "source_note": "Exact full run, stage, environment and original source records remain in the retained working project.",
    }


def _native_execution(baseline, alternatives):
    provenance = execution_provenance(baseline, alternatives)
    blocks = [
        "The producing version is read separately for each completed native model stage. "
        "A later stage can change the run's last recorded runtime without changing earlier completed outputs. "
        "Fallback and legacy declarations are identified explicitly.",
        link("Retained native execution records", "native-execution.json"),
    ]
    sources = {"completed_stage_runtime": "Completed model stage",
               "observed_run_fallback": "Observed run fallback; stage version absent",
               "requested_legacy": "Requested legacy; observed version absent",
               "unavailable": "Not recorded"}
    for index, run_id in enumerate(provenance["run_order"]):
        run = provenance["runs"][run_id]
        selection = run["selection"]
        blocks.append(("Reference" if index == 0 else "Alternative " + str(index)) +
                      " native run " + run_id + ". Scenario " + str(selection.get("scenario_id")) +
                      "; profile " + str(selection.get("profile_id")) + ".")
        rows = []
        for name, value in run["model_versions"].items():
            rows.append([name.upper(), value.get("comparison_version") or "Not recorded",
                         sources.get(value.get("basis"), "Not recorded"),
                         value.get("requested_version") or "Not recorded",
                         value.get("stage_completed_at") or "Not recorded"])
        blocks.append(_table(["Model", "Producing InVEST", "Retained source", "Requested", "Stage completed"],
                             rows, widths=[.6, .9, 1.7, .8, 1.4]))
        blocks.append("Last recorded run runtime: " +
                      str(run["run_runtime_source"].get("version") or "Not recorded") + ".")
        for name, value in run["model_versions"].items():
            if value.get("reused_from"):
                blocks.append(_table(
                    [name.upper() + " reused-stage lineage", "Original retained value"],
                    list(_retained_rows(value["reused_from"])), widths=[2.2, 3.8]))
    return blocks

def refine_sections(sections, *, workspace, baseline, alternatives, comparison,
                    profile, grid, priority, observation_results, receptor_inventory=None):
    """Replace machine-record paragraphs and retain independently installed sections."""
    replacements = {
        "Selected parameter profile": _profile(
            profile, workspace,
            execution_versions=model_versions(
                baseline, models_for_outputs(run_scope(baseline)["available_artifacts"]))),
        "Current quantitative exports": _current_exports(baseline, grid),
        "Future conservation and development scenarios": _scenario_sections(workspace, alternatives, comparison),
        "Combined priorities": _priorities(priority),
        "Observed watershed loads": _observations(observation_results),
    }
    receptor_blocks = _receptors(receptor_inventory)
    if receptor_blocks is not None:
        replacements["Source-water contributing land"] = receptor_blocks
    replacements["Native execution provenance"] = _native_execution(baseline, alternatives)
    result = [(heading, replacements.get(heading, blocks)) for heading, blocks in sections]
    if not any(heading == "Native execution provenance" for heading, _ in result):
        at = next((i + 1 for i, (heading, _) in enumerate(result) if heading == "Model and units"), 0)
        result.insert(at, ("Native execution provenance", replacements["Native execution provenance"]))
    return result


def _retained_rows(value, prefix=""):
    """Expose original nested settings and identifiers with their field paths."""
    if isinstance(value, dict):
        for key, child in value.items():
            name = (prefix + " / " if prefix else "") + _label(key)
            yield from _retained_rows(child, name)
    elif isinstance(value, (list, tuple)) and value:
        if any(isinstance(item, (dict, list, tuple)) for item in value):
            for index, item in enumerate(value, 1):
                yield from _retained_rows(item, prefix + " [" + str(index) + "]")
        elif len(value) > 12 or len(_plain(value)) > 400:
            # Large selected native cohorts must remain readable, splittable table
            # rows rather than one cell taller than an entire PDF page.
            chunk, start, characters = [], 1, 0
            for index, item in enumerate(value, 1):
                text = _plain(item)
                if chunk and (len(chunk) >= 12 or characters + len(text) > 400):
                    label = prefix + " [" + str(start) + "–" + str(index - 1) + " of " + str(len(value)) + "]"
                    yield [label, _plain(chunk)]
                    chunk, start, characters = [], index, 0
                chunk.append(item)
                characters += len(text) + 2
            if chunk:
                label = prefix + " [" + str(start) + "–" + str(len(value)) + " of " + str(len(value)) + "]"
                yield [label, _plain(chunk)]
        else:
            yield [prefix, _plain(value)]
    else:
        yield [prefix, _plain(value)]


def _receiving_metric_blocks(baseline_physical, alternatives):
    """Read retained subject metrics without recomputing or merging receptor areas."""
    def physical_table(physical, caption):
        rows = [[_label(key), _quantity(value), _mass_units(key, value),
                 _count(value.get("valid_cells")), _percent(value.get("coverage_fraction"))]
                for key, value in physical.items()]
        return _table(["Pollutant", "Annual export", "Unit", "Valid cells", "Coverage"],
                      rows, widths=[1.0, 1.0, 1.4, .9, .9], caption=caption)

    blocks = [physical_table(
        baseline_physical, "Baseline annual exports over the retained valid cells for this subject."
    )]
    for run_id, alternative in alternatives.items():
        if alternative.get("physical"):
            blocks.append(physical_table(
                alternative["physical"],
                "Native run " + str(run_id) + ". Alternative annual exports over this run's valid cells. "
                "The paired scenario-change table uses the common baseline and alternative cells.",
            ))
        changes = alternative.get("changes", {})
        paired_rows = [
            [_label(key), _quantity(value, "baseline_sum_on_common_cells"),
             _quantity(value, "alternative_sum_on_common_cells"), _mass_units(key, value),
             _count(value.get("valid_cells")), _percent(value.get("coverage_fraction"))]
            for key, value in changes.items()
        ]
        if paired_rows:
            blocks.append(_table(
                ["Pollutant", "Paired baseline", "Paired alternative", "Unit", "Paired cells", "Coverage"],
                paired_rows, widths=[1.0, 1.1, 1.1, 1.2, .8, .8],
                caption="Native run " + str(run_id) + ". Baseline and alternative annual exports over "
                        "the same paired valid cells. These quantities can differ from each run's "
                        "full-support totals above. Coverage is the paired share of the selected cells.",
            ))
        rows = []
        bases = {}
        for key, value in changes.items():
            rows.append([_label(key), _quantity(value, signed=True),
                         _quantity(value, "sum_increased_export"),
                         _quantity(value, "sum_avoided_export"), _mass_units(key, value),
                         _count(value.get("valid_cells")), _percent(value.get("coverage_fraction"))])
            if value.get("sum_basis"):
                bases.setdefault(str(value["sum_basis"]), []).append(_label(key))
        caption = ("Native run " + str(run_id) + ". Net change is alternative minus baseline. "
                   "Increased and avoided exports sum the positive and negative cell-level components separately.")
        for basis, pollutants in bases.items():
            caption += " Net-change sum basis (" + ", ".join(pollutants) + "): " + basis + "."
        if "stored Float32 signed difference pixels" in bases:
            caption += (" Increased and avoided exports retain the native Float64 paired-difference sums; "
                        "their difference can therefore vary slightly from the stored net at floating-point precision.")
        blocks.append(_table(
            ["Pollutant", "Net change", "Increased export", "Avoided export", "Unit", "Paired cells", "Coverage"],
            rows, widths=[1.0, .9, 1.0, 1.0, 1.2, .8, .8], caption=caption,
        ))
    return blocks


def receiving_sections(product):
    """Format the existing receiving-water delivery's actual quantities and support."""
    if product is None:
        return []
    inventory = product["inventory"]
    measurement = inventory.get("measurement", {})
    blocks = ["Receiving-water quantity scope: " + inventory["quantity_scope"].replace("_", " ") + ".",
              *[str(measurement[key]) for key in ("physical", "coverage", "scenario_delta", "overlap", "relationship")
                if measurement.get(key)]]
    identity = inventory.get("identity", {})
    selection_rows = [
        ["Receiving-water analysis", _plain(identity.get("analysis_id"))],
        ["Original source plan", _plain(identity.get("plan_id"))],
        ["Quantity scope", _plain(inventory.get("quantity_scope"))],
        ["Baseline run", _plain(inventory.get("baseline_run_id"))],
    ]
    selection_rows.extend(["Alternative run", _plain(run_id)]
                          for run_id in inventory.get("alternative_run_ids", []))
    blocks.append(_table(["Study selection", "Retained value"], selection_rows, widths=[1.8, 4.2]))
    identity_rows = list(_retained_rows(identity))
    if identity_rows:
        blocks.append(_table(["Original receiving-water identity", "Retained value"],
                             identity_rows, widths=[2.2, 3.8]))
    normalization = inventory.get("normalization", {})
    blocks.extend(_priorities(normalization))
    setting_rows = [row for key, value in normalization.items()
                    if key not in ("caps", "weights", "cap_units")
                    for row in _retained_rows(value, _label(key))]
    if setting_rows:
        blocks.append(_table(["Original normalization setting", "Retained value"],
                             setting_rows, widths=[2.2, 3.8]))
    for family, union in inventory.get("families", {}).items():
        blocks.append("Unduplicated family union: " + str(union.get("title", family)) + ".")
        blocks.append("Each contributing cell is counted once within this family. "
                      "Different families can overlap; their union totals must not be added together.")
        if union.get("interpretation"):
            blocks.append(str(union["interpretation"]))
        if union.get("relationship_precision"):
            blocks.append("Contribution relationship: " + str(union["relationship_precision"]) + ".")
        receptor_rows = list(_retained_rows(union.get("receptor_ids", []), "Original receiving-area identifiers"))
        if receptor_rows:
            blocks.append(_table(["Family selection", "Retained identifiers"],
                                 receptor_rows, widths=[2.2, 3.8]))
        blocks.extend(_receiving_metric_blocks(
            union.get("baseline_physical", {}),
            {run_id: value["metrics"] for run_id, value in union.get("alternatives", {}).items()},
        ))
    for receptor in inventory.get("receptors", []):
        blocks.append(str(receptor["title"]) + " — " + str(receptor["relationship_precision"]) + ".")
        metrics = receptor["metrics"]
        context_rows = [
            ["Receiving-area identifier", _plain(receptor.get("id"))],
            ["Map family", _plain(receptor.get("family"))],
            ["Geographic relationship", _plain(receptor.get("relationship_precision"))],
            ["Complete contributing area (ha)", _number(receptor.get("contribution_area_ha"))],
            ["Area within quantity scope (ha)", _number(receptor.get("area_in_quantity_scope_ha"))],
            ["Selected grid cells", _count(metrics.get("selected_cells"))],
            ["Total selected pixel area (ha)", _number(metrics.get("selected_pixel_area_ha"))],
        ]
        source = receptor.get("source") or {}
        for key, value in source.items():
            if key == "uri":
                original = str(value)
                reference = link("Open original receiving-water source", original)
                context_rows.append(["Original source reference",
                                     reference if isinstance(reference, dict) else original])
            else:
                context_rows.extend(_retained_rows(value, "Source / " + _label(key)))
        context_rows.extend(_retained_rows(receptor.get("classification") or {}, "Classification"))
        blocks.append(_table(
            ["Receiving-area context", "Retained value"], context_rows, widths=[2.2, 3.8],
            caption="Areas, selected grid cells, original feature identifiers and designations retain "
                    "the source analysis values. Total selected pixel area is the area of all selected "
                    "cells; each quantity's valid support is reported separately.",
        ))
        blocks.extend(_receiving_metric_blocks(
            metrics.get("baseline_physical", {}), metrics.get("alternatives", {}),
        ))
    sections = [("Receiving-water quantities and priorities", blocks)]
    from .client_receiving_waters import accounting_sections
    for part in accounting_sections(inventory, number=_number, text=_plain):
        account_blocks = list(part["paragraphs"])
        for item in part["tables"]:
            account_blocks.append(_table(item["columns"], item["rows"], caption=item.get("caption")))
        sections.append((part["title"], account_blocks))
    return sections


def _source_block(source_records):
    rows = []
    for source in source_records:
        identity = [str(source.get("title") or source["id"]),
                    "Role: " + str(source["id"])]
        if source.get("source_id"):
            identity.append("Retained source: " + str(source["source_id"]))
        edition = [str(source["vintage"])]
        for field, label in (("data_status", "Publisher data status"),
                             ("legal_edition_status", "Legal edition")):
            if source.get(field):
                edition.append(label + ": " + str(source[field]))
        uri = str(source["uri"])
        try:
            host = urlsplit(uri).netloc
        except ValueError:
            host = ""
        reference = link("Open original source" + (" — " + host if host else ""), uri)
        # A non-web publisher identifier remains visible rather than an inactive "Open" action.
        if not isinstance(reference, dict):
            reference = uri
        rows.append(["\n".join(identity), "\n".join(edition), reference])
    return _table(["Source and retained identity", "Edition", "Original reference"],
                  rows, widths=[2.6, 1.3, 2.1],
                  caption="Links retain the original publisher reference. Complete source IDs, "
                          "URIs and body hashes are also retained in report-data.json.")




def economic_coverage_sections(value):
    """Expose original economic-zone coverage and estimate completeness."""
    if value is None:
        return [("Economic analysis status", [
            "This delivery contains physical model results and scenario comparisons. "
            "An economic decision edition has not been selected for this delivery."
        ])]
    report, binding = value["report"], value["binding"]
    alternatives = report["alternatives"]
    scope = report["scope"]
    zone = report.get("physical_source", {}).get("zone", {})
    costed = sum(item.get("cost") is not None for item in alternatives)
    rows = [
        ["Selected economic reporting zone", str(binding["zone_title"])],
        ["Original zone ID", str(binding["zone_id"])],
        ["Economic decision edition", str(binding["edition_id"])],
        ["Available alternatives with estimates", str(costed) + " of " + str(len(alternatives))],
        ["Unavailable original alternatives", str(len(report.get("unavailable_alternatives") or []))],
        ["Modeled responses", ", ".join(_label(key) for key in scope.get("modeled_metrics", [])) or "None"],
        ["Unmodeled responses", ", ".join(_label(key) for key in scope.get("unmodeled_metrics", [])) or "None"],
    ]
    if zone.get("scope") is not None:
        rows.append(["Original zone scope", _plain(zone["scope"])])
    for key, title in (("area_ha", "Recorded zone area (ha)"),
                       ("original_area_ha", "Recorded original geometry area (ha)")):
        if zone.get(key) is not None:
            rows.append([title, _number(zone[key])])
    coverage, estimate_rows = [], []
    for item in alternatives:
        label = str(item.get("label") or item["run_id"])
        for metric, output in item.get("outputs", {}).items():
            support = output.get("support", {})
            coverage.append([label, _label(metric), _number(support.get("area_ha")),
                             _percent(support.get("baseline_fraction")),
                             _percent(support.get("alternative_fraction")),
                             _plain(support.get("status"))])
        cost = item.get("cost")
        if cost is None:
            estimate_rows.append([label, "Unentered", "", ""])
        else:
            source = cost.get("source") or {}
            estimate_rows.append([label, str(cost["currency"]),
                                  str(source.get("as_of") or "Unspecified"),
                                  link(str(source.get("title") or "Original estimate"), source.get("uri"))])
    blocks = [
        "The economic zone is the original selected reporting unit. Its footprint and "
        "common modeled support remain distinct from the complete regional model domain.",
        _table(["Selected scope", "Recorded value"], rows, widths=[2.2, 3.8]),
        "The coverage percentages are the original all-run common cells divided by each run's "
        "own valid modeled cells for that pollutant. They do not represent a percentage of the "
        "whole watershed. Unmodeled responses remain absent rather than zero.",
    ]
    if coverage:
        blocks.append(_table(
            ["Alternative", "Pollutant", "Common ha", "Baseline valid-cell coverage",
             "Alternative valid-cell coverage", "Support"],
            coverage, widths=[1.4, .9, .8, 1.1, 1.1, .8]))
    blocks.extend([
        "Capital and present value are in the recorded currency. Operating and annualized costs "
        "are in that currency per year; the retained discount rate is a real annual rate. "
        "The model annualizes implementation costs and does not monetize environmental benefits.",
        "Unentered estimates are excluded from cost-per-mass calculations. Frontier comparisons "
        "use annualized costs only for candidates with complete estimates in a common currency; "
        "the recorded decision tables retain their actual budget and target outcomes.",
        _table(["Alternative", "Estimate currency / status", "Estimate as of", "Original estimate"],
               estimate_rows, widths=[1.6, 1.3, 1.1, 2.0]),
    ])
    return [("Economic scope and source coverage", blocks)]


def delivery_sections(state, *, working_archive_path=None):
    """Link retained files and the builder's explicit final workspace archive path.

    The planned path creates a report reference only. The package builder records
    the real archive descriptor after its single final backup succeeds.
    """
    blocks = []
    asset_rows = []
    for key, title in (("map_atlas", "Complete publication map atlas"),
                       ("map_atlas_index", "Publication map index"),
                       ("source_report_html", "Original watershed report"),
                       ("source_report_json", "Original watershed report data"),
                       ("working_archive", "Complete scientific workspace"),
                       ("display_scales", "Map scale definitions"),
                       ("native_execution", "Original producing native execution records"),
                       ("receptor_inventory", "Source-water contributing areas"),
                       ("parcel_source_lineage_report", "County parcel source editions"),
                       ("parcel_source_lineage", "Complete typed parcel source lineage"),
                       ("parcel_source_editions", "County parcel supplier spreadsheet"),
                       ("parcel_source_coverage", "Captured county parcel coverage"),
                       ("receiving_water_index", "Receiving-water source inventory")):
        item = state.get("files", {}).get(key)
        if item and item.get("path"):
            asset_rows.append([title, link("Open retained file", item["path"]), item["path"]])
    if working_archive_path is not None:
        relative = _relative_link(working_archive_path)
        retained = state.get("files", {}).get("working_archive")
        if retained and retained.get("path") != relative:
            raise ValueError("The retained and planned working archive paths differ")
        if not retained:
            asset_rows.append(["Complete scientific workspace",
                               link("Open retained file", relative), relative])
    seen_paths = {row[2] for row in asset_rows}
    receiving_titles = {
        "receiving_water_analysis_quantities_csv": "Receiving-water annual quantities and scenario changes",
        "receiving_water_analysis_receiving_waters_gpkg": "Receiving waters and contributing land",
        "receiving_water_analysis_record": "Original receiving-water analysis",
        "receiving_water_plan_record": "Original receiving-water source and relationship plan",
    }
    for key, item in state.get("files", {}).items():
        if not key.startswith("receiving_water_") or not isinstance(item, dict):
            continue
        path = item.get("path")
        if path and path not in seen_paths:
            title = receiving_titles.get(key, _label(key))
            asset_rows.append([title, link("Open retained file", path), path])
            seen_paths.add(path)
    if asset_rows:
        blocks.append(_table(["Working material", "Retained file", "Package path"],
                             asset_rows, widths=[2.1, 1.1, 2.8]))
    if not blocks:
        return []
    blocks.insert(0, "Open this report inside the extracted delivery folder to follow the retained "
                     "map and working-material links. Preserve the folder structure when sharing it. "
                     "The scientific workspace archive contains the original inputs and native model outputs.")
    return [("Working materials and source reports", blocks)]


def _relative_link(value):
    if not isinstance(value, str) or not value:
        raise ValueError("Report links require an original relative file path")
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts or ":" in normalized or normalized.startswith("//"):
        raise ValueError("Report links must remain within the delivered package")
    return normalized


def _figure(block, root=None):
    """Bind a readable figure to its retained SVG and original numeric specification."""
    relative = _relative_link(block.get("path"))
    if Path(relative).suffix.lower() != ".svg":
        raise ValueError("Scientific figures require their retained original SVG")
    for name in ("alt", "caption"):
        if not isinstance(block.get(name), str) or not block[name].strip():
            raise ValueError("Scientific figures require nonempty " + name)
    if not isinstance(block.get("spec"), dict):
        raise ValueError("Scientific figures require the original numeric specification")
    size, sha = block.get("bytes"), block.get("sha256")
    if (not isinstance(size, int) or isinstance(size, bool) or size <= 0
            or not isinstance(sha, str) or len(sha) != 64
            or any(value not in "0123456789abcdef" for value in sha)):
        raise ValueError("Scientific figures require the retained SVG length and SHA256")
    if root is not None:
        directory = Path(root).resolve(strict=True)
        source = (directory / relative).resolve(strict=True)
        if not source.is_relative_to(directory):
            raise ValueError("Scientific figure is outside the original delivery")
        actual = describe_file(directory, source)
        if actual["bytes"] != size or actual["sha256"] != sha:
            raise ValueError("Scientific figure differs from its retained original SVG")
    return {**block, "path": relative}


def report_pdf(path, title, sections, *, contact, source_records,
               footer="Scientific report · original model and source editions"):
    """Render the original report content with repeating, page-aware data tables."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
    from xml.sax.saxutils import escape

    styles = getSampleStyleSheet()
    styles["BodyText"].fontName = "Helvetica"
    styles["BodyText"].fontSize = 9
    styles["BodyText"].leading = 13
    cell_style = ParagraphStyle("ScientificTable", parent=styles["BodyText"],
                                fontSize=8, leading=10, splitLongWords=1)
    story = [Paragraph(escape(str(title)), styles["Title"]), Spacer(1, .15 * inch)]

    def paragraph(value, style=None):
        value = _cell(value)
        if isinstance(value, dict):
            href = escape(value["href"], {'"': "&quot;"})
            body = '<link href="' + href + '">' + escape(value["label"]).replace("\n", "<br/>") + "</link>"
        else:
            body = escape(value).replace("\n", "<br/>")
        return Paragraph(body, style or styles["BodyText"])

    def source_links(block):
        """Shorten only path-derived labels; preserve explicit source titles."""
        targets = [_relative_link(item["path"]) for item in block["items"]]
        titles = [str(item["title"]) for item in block["items"]]
        path_titles = [
            title == target or ("/" in title and target.endswith("/" + title))
            for title, target in zip(titles, targets)
        ]
        for index, (title, target) in enumerate(zip(titles, targets)):
            label = title
            if path_titles[index]:
                parts = target.split("/")
                for count in range(1, len(parts) + 1):
                    candidate = "/".join(parts[-count:])
                    conflict = any(
                        other_target != target
                        and ((path_titles[other] and
                              "/".join(targets[other].split("/")[-count:]) == candidate)
                             or (not path_titles[other] and titles[other] == candidate))
                        for other, other_target in enumerate(targets) if other != index
                    )
                    if not conflict:
                        label = candidate
                        break
            yield target, label

    def append(block):
        if isinstance(block, dict) and block.get("kind") == "figure":
            from .scientific_figures import panel_drawings
            figure = _figure(block, Path(path).parent)
            if figure.get("title"):
                story.append(paragraph(figure["title"], styles["Heading3"]))
            drawings = list(panel_drawings(figure["spec"], 7.1 * inch))
            if not drawings:
                raise ValueError("Scientific figure contains no native report panels")
            for drawing in drawings[:-1]:
                story.extend([drawing, Spacer(1, .08 * inch)])
            story.append(KeepTogether([
                drawings[-1], Spacer(1, .05 * inch), paragraph(figure["caption"]),
            ]))
        elif isinstance(block, dict) and block.get("kind") == "links":
            for relative, label in source_links(block):
                story.append(Paragraph('<link href="' + html_escape(relative, quote=True) + '">' +
                    escape(label) + "</link>", styles["BodyText"]))
                story.append(Spacer(1, .05 * inch))
        elif isinstance(block, dict) and block.get("kind") == "table":
            if block.get("caption"):
                story.extend([paragraph(block["caption"]), Spacer(1, .05 * inch)])
            from .scientific_tables import pdf_table_flowables
            story.extend(pdf_table_flowables(
                block, width=7.1 * inch, paragraph=paragraph, cell_style=cell_style,
            ))
        else:
            story.append(paragraph(block))
        story.append(Spacer(1, .08 * inch))

    for heading, blocks in sections:
        story.append(paragraph(heading, styles["Heading2"]))
        for block in blocks:
            append(block)
    story.append(paragraph("Source editions", styles["Heading2"]))
    append(_source_block(source_records))
    prepared = " · ".join(str(contact[key]).strip() for key in ("name", "organization", "email") if contact.get(key))
    if prepared:
        story.append(paragraph("Prepared by " + prepared))

    def page_number(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.drawString(.7 * inch, .42 * inch, str(footer))
        canvas.drawRightString(7.8 * inch, .42 * inch, str(document.page))
        canvas.restoreState()

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    SimpleDocTemplate(str(path), pagesize=letter, rightMargin=.7 * inch, leftMargin=.7 * inch,
                      topMargin=.65 * inch, bottomMargin=.65 * inch,
                      title=str(title), author=str(contact.get("organization", ""))).build(
                          story, onFirstPage=page_number, onLaterPages=page_number)


def _figure_image(block, root):
    """Encode the exact verified source bytes for self-contained HTML viewing."""
    figure = _figure(block)
    directory = Path(root).resolve(strict=True)
    source = (directory / figure["path"]).resolve(strict=True)
    if not source.is_relative_to(directory):
        raise ValueError("Scientific figure is outside the original delivery")
    payload = source.read_bytes()
    if len(payload) != figure["bytes"] or sha256(payload).hexdigest() != figure["sha256"]:
        raise ValueError("Scientific figure differs from its retained original SVG")
    return "data:image/svg+xml;base64," + base64.b64encode(payload).decode("ascii")


def _html_block(block, *, figure_images=None):
    def cell(value):
        value = _cell(value)
        if isinstance(value, dict):
            return '<a href="' + html_escape(value["href"], quote=True) + '">' + html_escape(value["label"]).replace("\n", "<br>") + "</a>"
        return html_escape(value).replace("\n", "<br>")
    if isinstance(block, dict) and block.get("kind") == "figure":
        figure = _figure(block)
        title = ("<strong>" + cell(figure["title"]) + "</strong> "
                 if figure.get("title") else "")
        return ('<figure class="scientific-figure"><img src="' +
                html_escape(figure_images[figure["path"]] if figure_images is not None
                            else figure["path"], quote=True) + '" alt="' +
                html_escape(figure["alt"], quote=True) + '"><figcaption>' +
                title + cell(figure["caption"]) + "</figcaption></figure>")
    if isinstance(block, dict) and block.get("kind") == "links":
        return "<ul>" + "".join(
            '<li><a href="' + html_escape(_relative_link(item["path"]), quote=True) + '">' +
            cell(item["title"]) + "</a></li>" for item in block["items"]) + "</ul>"
    if not isinstance(block, dict) or block.get("kind") != "table":
        return "<p>" + cell(block) + "</p>"
    caption = "<caption>" + cell(block["caption"]) + "</caption>" if block.get("caption") else ""
    head = "".join("<th scope=\"col\">" + cell(value) + "</th>" for value in block["columns"])
    rows = "".join("<tr>" + "".join("<td>" + cell(value) + "</td>" for value in row)
                   + "</tr>" for row in block["rows"])
    return "<div class=\"table-wrap\"><table>" + caption + "<thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>"


def _markdown_cell(value):
    def plain(text):
        return (str(text).replace("\\", "\\\\").replace("|", "\\|")
                .replace("[", "\\[").replace("]", "\\]")
                .replace("*", "\\*").replace("_", "\\_")
                .replace("`", "\\`").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\r", "").replace("\n", "<br>"))
    value = _cell(value)
    if isinstance(value, dict):
        href = value["href"].replace("<", "%3C").replace(">", "%3E").replace(" ", "%20").replace("|", "%7C")
        return "[" + plain(value["label"]) + "](<" + href + ">)"
    return plain(value)


def _markdown_report(title, sections, prepared):
    lines = ["# " + _markdown_cell(title), ""]
    for heading, blocks in sections:
        lines.extend(["## " + _markdown_cell(heading), ""])
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "figure":
                figure = _figure(block)
                # Reuse the maintained link/cell escaping for original captions and paths.
                lines.extend(["!" + _markdown_cell(link(figure["alt"], figure["path"])), ""])
                if figure.get("title"):
                    lines.extend([_markdown_cell(figure["title"]), ""])
                lines.extend([_markdown_cell(figure["caption"]), ""])
            elif isinstance(block, dict) and block.get("kind") == "table":
                if block.get("caption"):
                    lines.extend([_markdown_cell(block["caption"]), ""])
                lines.append("| " + " | ".join(_markdown_cell(v) for v in block["columns"]) + " |")
                lines.append("| " + " | ".join("---" for _ in block["columns"]) + " |")
                lines.extend("| " + " | ".join(_markdown_cell(v) for v in row) + " |" for row in block["rows"])
                lines.append("")
            elif isinstance(block, dict) and block.get("kind") == "links":
                for item in block["items"]:
                    lines.append("- " + _markdown_cell(link(item["title"], _relative_link(item["path"]))))
                lines.append("")
            else:
                lines.extend([_markdown_cell(block), ""])
    lines.extend([_markdown_cell(prepared), ""])
    return "\n".join(lines)


def write_companions(directory, title, sections, *, contact, source_records, binding,
                     subtitle="Scientific model results, scenario changes and retained source editions.",
                     footer="Original scientific study, source editions and model selections retained with this report."):
    """Retain offline HTML and complete structured report blocks in the delivery."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    all_sections = list(sections) + [("Source editions", [_source_block(source_records)])]
    figure_images = {}
    for _, blocks in all_sections:
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "figure":
                figure = _figure(block)
                figure_images[figure["path"]] = _figure_image(figure, directory)
    headings = "".join("<li><a href=\"#section-" + str(index) + "\">" + html_escape(str(heading))
                       + "</a></li>" for index, (heading, _) in enumerate(all_sections))
    content = "".join("<section id=\"section-" + str(index) + "\"><h2>"
                      + html_escape(str(heading)) + "</h2>"
                      + "".join(_html_block(block, figure_images=figure_images)
                                for block in blocks) + "</section>"
                      for index, (heading, blocks) in enumerate(all_sections))
    supplied_contact = " · ".join(str(contact[key]).strip() for key in ("name", "organization", "email") if contact.get(key))
    prepared = ("Prepared by " + supplied_contact if supplied_contact
                else str(footer))
    body = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>" + html_escape(str(title)) + "</title><style>"
        "*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font:15px/1.5 Arial,sans-serif}"
        "main{max-width:1120px;margin:auto;padding:32px}h1{font-size:30px;line-height:1.2}"
        "h2{font-size:21px;border-bottom:1px solid #777;padding-bottom:8px;margin-top:32px}"
        "a{color:inherit;text-decoration:underline}nav{border:1px solid #aaa;padding:12px 20px}"
        "nav ol{columns:2;margin:8px 0;padding-left:20px}section{scroll-margin-top:20px}"
        "p{max-width:95ch;overflow-wrap:anywhere}.table-wrap{overflow-x:auto;margin:16px 0}"
        "table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;"
        "padding:8px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}th{background:#eee;border-bottom:1px solid #444}"
        "caption{text-align:left;margin-bottom:8px}.scientific-figure{margin:20px 0}"
        ".scientific-figure img{display:block;max-width:100%;height:auto}"
        ".scientific-figure figcaption{margin-top:8px;font-size:13px;max-width:95ch}"
        "footer{border-top:1px solid #777;margin-top:32px;padding-top:16px}"
        "@media(max-width:620px){main{padding:16px}nav ol{columns:1}h1{font-size:25px}}"
        "@media print{main{max-width:none;padding:0}nav{display:none}.table-wrap{overflow:visible}"
        "thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}body{font-size:10pt}"
        "table{font-size:8pt}a{text-decoration:none}@page{margin:16mm}}"
        "</style></head><body><main><h1>" + html_escape(str(title))
        + "</h1><p>" + html_escape(str(subtitle)) + "</p>"
        "<nav aria-label=\"Report sections\"><strong>Contents</strong><ol>" + headings + "</ol></nav>"
        + content + "<footer>" + html_escape(prepared) + "</footer></main></body></html>\n"
    )
    html_path, data_path = directory / "report.html", directory / "report-data.json"
    markdown_path = directory / "report.md"
    atomic_bytes(markdown_path, _markdown_report(title, all_sections, prepared).encode("utf-8"))
    atomic_bytes(html_path, body.encode("utf-8"))
    atomic_json(data_path, {
        "schema": REPORT_VERSION, "title": title, "binding": binding,
        "sections": [{"heading": heading, "blocks": blocks} for heading, blocks in sections],
        "source_records": source_records, "contact": contact,
        "presentation": {"subtitle": str(subtitle), "footer": prepared},
        "display_precision": "Six significant digits; complete original numeric data remains in the working project",
    })
    return {"report_html": describe_file(directory, html_path),
            "report_markdown": describe_file(directory, markdown_path),
            "report_data": describe_file(directory, data_path)}
