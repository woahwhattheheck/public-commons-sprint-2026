"""Client tables from the retained receiving-water delivery inventory.

The presentation reads the registered inventory after its hash is verified.
Quantities, geographic scope and comparison support remain the recorded values.
"""
from __future__ import annotations

from collections.abc import Mapping
import math

from .common import read_json, verify_file

INVENTORY_SCHEMA = "upstate.receiving-water-delivery/v1"
LEGACY_SECTION_TITLE = "Receiving-water quantities and priorities"

_POLLUTANTS = {
    "nitrogen_export": "Nitrogen",
    "phosphorus_export": "Phosphorus",
    "sediment_export": "Sediment",
}
_FAMILIES = {
    "critical_drinking_water": "Drinking-water protection",
    "high_quality_waters": "High-quality waters",
}
_ASSET_TITLES = {
    "receiving_water_index": "Complete receiving-water delivery inventory",
    "receiving_water_analysis_quantities_csv": "Annual quantities and scenario changes (CSV)",
    "receiving_water_analysis_receiving_waters_gpkg": "Receiving waters and contributing land (GeoPackage)",
    "receiving_water_analysis_record": "Original receiving-water analysis",
    "receiving_water_plan_record": "Original source and relationship plan",
}


def _table(columns, rows, caption=None):
    return {"columns": list(columns), "rows": list(rows), "caption": caption}


def _section(key, title, paragraphs=(), tables=()):
    return {"id": key, "title": title, "paragraphs": list(paragraphs), "tables": list(tables)}


def _label(key):
    return _POLLUTANTS.get(key, str(key).replace("_", " ").capitalize())


def _records(value, prefix=""):
    """Keep every nested setting in a two-column table with an explicit path."""
    if isinstance(value, Mapping):
        for key, child in value.items():
            title = (prefix + " / " if prefix else "") + str(key).replace("_", " ")
            yield from _records(child, title)
    elif isinstance(value, (list, tuple)) and value:
        if any(isinstance(item, (Mapping, list, tuple)) for item in value):
            for index, item in enumerate(value, 1):
                yield from _records(item, prefix + " [" + str(index) + "]")
        elif len(value) > 12 or sum(len(str(item)) + 2 for item in value) > 400:
            chunk, start, characters = [], 1, 0
            for index, item in enumerate(value, 1):
                size = len(str(item)) + 2
                if chunk and (len(chunk) >= 12 or characters + size > 400):
                    label = prefix + " [" + str(start) + "–" + str(index - 1) + " of " + str(len(value)) + "]"
                    yield label, chunk
                    chunk, start, characters = [], index, 0
                chunk.append(item)
                characters += size
            if chunk:
                label = prefix + " [" + str(start) + "–" + str(len(value)) + " of " + str(len(value)) + "]"
                yield label, chunk
        else:
            yield prefix, value
    else:
        yield prefix, value


def _quantity(record, field, number):
    """Display an annual quantity only when its actual recorded support is positive."""
    support, value = record.get("valid_cells"), record.get(field)
    if (isinstance(support, bool) or not isinstance(support, (int, float))
            or not math.isfinite(support) or support <= 0
            or isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value)):
        return "Unavailable"
    return number(value)


def _physical_table(values, caption, number, text):
    return _table(
        ["Quantity", "Annual export", "Units", "Valid cells", "Valid fraction"],
        [[_label(pollutant), _quantity(row, "sum", number), text(row.get("sum_units")),
          number(row.get("valid_cells")), number(row.get("coverage_fraction"))]
         for pollutant, row in values.items()],
        caption,
    )


def _alternative_tables(alternatives, alternative_ids, run_names, number, text):
    tables = []
    for run_id in alternative_ids:
        alternative = alternatives.get(run_id)
        if not alternative:
            continue
        metrics = alternative.get("metrics", alternative)
        name = run_names.get(run_id) or run_id
        physical = metrics.get("physical") or {}
        if physical:
            tables.append(_physical_table(physical, name + ": annual export", number, text))
        changes = metrics.get("changes") or {}
        if changes:
            tables.append(_table(
                ["Quantity", "Signed change", "Increased export", "Avoided export", "Units"],
                [[_label(pollutant), _quantity(row, "sum", number),
                  _quantity(row, "sum_increased_export", number), _quantity(row, "sum_avoided_export", number),
                  text(row.get("sum_units"))]
                 for pollutant, row in changes.items()],
                name + ": annual change over paired valid cells. "
                + "; ".join(sorted({str(row["sum_basis"]) for row in changes.values()
                                    if row.get("sum_basis")})),
            ))
            tables.append(_table(
                ["Quantity", "Paired cells", "Valid fraction",
                 "Baseline on paired cells", "Alternative on paired cells", "Units"],
                [[_label(pollutant), number(row.get("valid_cells")),
                  number(row.get("coverage_fraction")),
                  _quantity(row, "baseline_sum_on_common_cells", number),
                  _quantity(row, "alternative_sum_on_common_cells", number),
                  text(row.get("sum_units"))]
                 for pollutant, row in changes.items()],
                name + ": comparison support and paired annual totals",
            ))
    return tables


def build_sections(directory, state, *, baseline_run_id, alternative_run_ids,
                   run_names, number, text):
    """Return structured report sections and exact retained provenance, or None."""
    descriptor = (state.get("files") or {}).get("receiving_water_index")
    if descriptor is None:
        return None
    path = verify_file(directory, descriptor)
    inventory = read_json(path)
    if inventory.get("schema") != INVENTORY_SCHEMA:
        raise ValueError("The retained receiving-water inventory has a different schema.")
    if inventory.get("baseline_run_id") != baseline_run_id:
        raise ValueError("The receiving-water report must use the selected baseline.")
    retained_alternatives = inventory.get("alternative_run_ids")
    if (not isinstance(retained_alternatives, list)
            or len(retained_alternatives) != len(alternative_run_ids)
            or set(retained_alternatives) != set(alternative_run_ids)):
        raise ValueError("The receiving-water report must use the selected alternatives.")
    retained_state = state.get("receiving_waters") or {}
    if retained_state.get("identity") and retained_state["identity"] != inventory.get("identity"):
        raise ValueError("The receiving-water inventory differs from the delivery selection.")

    measurement = inventory["measurement"]
    normalization = inventory["normalization"]
    scope = inventory["quantity_scope"]
    paragraphs = [
        "Receiving-water quantities use the saved " + scope.replace("_", " ")
        + " scope and each selected contributing-area footprint.",
    ]
    for key in ("physical", "coverage", "scenario_delta", "overlap", "relationship"):
        if measurement.get(key):
            paragraphs.append(str(measurement[key]))
    paragraphs.extend([
        "Signed change is alternative minus baseline. Increased export and avoided export "
        "are the retained positive components across cells; both can occur within the same "
        "receiving area. Read them with the paired-cell support.",
        "Valid fraction is the recorded share of selected cells with a usable value, from "
        "0 to 1. Each annual total and each paired change retains its own support.",
        "The priority maps use a dimensionless score with fixed normalization. The separate "
        "tables below retain each pollutant's physical annual units.",
        "An annual quantity is unavailable when its recorded valid-cell count is zero or absent. "
        "A supported zero remains zero. Net change and its increased/avoided components retain "
        "their original sum bases, so stored Float32 net-change sums and native Float64 "
        "positive/negative component sums can differ slightly at floating-point precision.",
    ])
    identity = inventory["identity"]
    selection_rows = [
        ["Analysis", text(identity.get("analysis_id"))],
        ["Source plan", text(identity.get("plan_id"))],
        ["Quantity scope", text(scope)],
        ["Baseline", text(run_names.get(baseline_run_id) or baseline_run_id)],
        ["Baseline run", baseline_run_id],
    ]
    selection_rows.extend(
        ["Alternative: " + (run_names.get(run_id) or run_id), run_id]
        for run_id in alternative_run_ids
    )
    normalization_rows = [
        [_label(pollutant), number(cap),
         text((normalization.get("cap_units") or {}).get(pollutant)),
         number((normalization.get("weights") or {}).get(pollutant))]
        for pollutant, cap in (normalization.get("caps") or {}).items()
    ]
    setting_rows = [
        [name, text(value)]
        for key in ("method", "scope", "formula", "comparison", "reference")
        if key in normalization
        for name, value in _records(normalization[key], key)
    ]
    context = _section(
        "receiving-water-context", "Receiving-water quantities and priorities",
        paragraphs,
        [_table(["Study selection", "Retained value"], selection_rows),
         _table(["Quantity", "Fixed cap", "Cap units", "Weight"], normalization_rows,
                "Saved normalization for the dimensionless priority maps"),
         _table(["Normalization setting", "Retained value"], setting_rows)],
    )
    assets = []
    seen_paths = set()
    for role, item in (state.get("files") or {}).items():
        if not role.startswith("receiving_water_") or not isinstance(item, Mapping):
            continue
        relative = item.get("path")
        if not relative or relative in seen_paths:
            continue
        seen_paths.add(relative)
        assets.append({
            "role": role, "path": relative,
            "title": _ASSET_TITLES.get(role, role.replace("_", " ").capitalize()),
        })
    context["assets"] = assets
    if assets:
        context["tables"].append(_table(
            ["Retained working file", "Relative path"],
            [[asset["title"], asset["path"]] for asset in assets],
        ))
    sections = [context]

    for index, (family, row) in enumerate(inventory.get("families", {}).items(), 1):
        title = text(row.get("title") or _FAMILIES.get(family, family))
        family_paragraphs = [
            "This family result uses the union of its selected contributing land. "
            "The native analysis counts shared land once within this family. "
            "Different families can overlap; their union totals must not be added together.",
        ]
        for key in ("interpretation", "relationship_precision"):
            if row.get(key):
                family_paragraphs.append(str(row[key]))
        tables = [
            _table(["Family selection", "Retained value"], [
                ["Family", _FAMILIES.get(family, family)],
                ["Receiving-area identifiers", text(row.get("receptor_ids"))],
            ]),
            _physical_table(row.get("baseline_physical") or {},
                            "Baseline annual export across the family union", number, text),
        ]
        tables.extend(_alternative_tables(row.get("alternatives") or {},
                                          alternative_run_ids, run_names, number, text))
        sections.append(_section("receiving-water-family-" + str(index),
                                 title + ": combined contributing land", family_paragraphs, tables))

    for index, receptor in enumerate(inventory.get("receptors", []), 1):
        metrics = receptor["metrics"]
        source = receptor.get("source") or {}
        context_rows = [
            ["Receiving area", text(receptor.get("id"))],
            ["Map family", _FAMILIES.get(receptor.get("family"), text(receptor.get("family")))],
            ["Geographic relationship", text(receptor.get("relationship_precision"))],
            ["Complete contributing area (ha)", number(receptor.get("contribution_area_ha"))],
            ["Area within quantity scope (ha)", number(receptor.get("area_in_quantity_scope_ha"))],
            ["Selected grid cells", number(metrics.get("selected_cells"))],
            ["Total selected pixel area (ha)", number(metrics.get("selected_pixel_area_ha"))],
        ]
        context_rows.extend(
            [name, text(value)]
            for key, label in (("title", "Source title"), ("source_id", "Source identifier"),
                               ("uri", "Original source URI"), ("vintage", "Source vintage"),
                               ("feature_ids", "Original selected features"))
            if key in source
            for name, value in _records(source[key], label)
        )
        context_rows.extend(
            ["Classification / " + name, text(value)]
            for name, value in _records(receptor.get("classification") or {})
        )
        tables = [
            _table(["Receiving-area context", "Retained value"], context_rows),
            _physical_table(metrics.get("baseline_physical") or {},
                            "Baseline annual export", number, text),
        ]
        tables.extend(_alternative_tables(metrics.get("alternatives") or {},
                                          alternative_run_ids, run_names, number, text))
        sections.append(_section(
            "receiving-water-receptor-" + str(index), text(receptor["title"]),
            ["These quantities use this receiving area's own selected land footprint. "
             "Use the family-union results above when combining receiving areas that overlap."],
            tables,
        ))
    sections.extend(accounting_sections(inventory, number=number, text=text, run_names=run_names))
    return {
        "sections": sections,
        "provenance": {
            "inventory_file": dict(descriptor),
            "inventory": inventory,
        },
    }


def accounting_sections(inventory, *, number, text, run_names=None):
    """Present saved disjoint accounting and closure without recomputing quantities."""
    run_names = run_names or {}
    roles = {
        "total": "Downstream total", "upstream_union": "Upstream union",
        "incremental": "Downstream incremental",
        "reservoir_inflow": "Above-reservoir land", "other_upstream": "Other upstream land",
    }
    statistics = {
        "current_export": "Baseline export", "alternative_export": "Alternative export",
        "alternative_minus_baseline": "Signed change",
        "positive_increased_export": "Increased export",
        "positive_avoided_export": "Avoided export",
        "common_baseline_export": "Baseline on common valid cells",
        "common_alternative_export": "Alternative on common valid cells",
    }
    sections = []
    for index, group in enumerate((inventory.get("accounting") or {}).get("groups", []), 1):
        ordered = list(dict.fromkeys(["total", "upstream_union"] + group["partition_roles"]))
        paragraphs = [
            str(group.get("rationale") or ""),
            "These quantities describe modeled land export to streams inside the original source "
            "catchments. Above-reservoir land retains that interpretation. Reservoir throughput "
            "requires additional sourced modelling.",
            "Disjoint partition: " + " + ".join(roles.get(role, role)
                                                for role in group["partition_roles"])
            + ". The upstream union is a subtotal.",
        ]
        tables = [_table(["Accounting selection", "Retained value"], [
            ["Group", text(group["id"])],
            ["Downstream total receptor", text(group["subject_ids"]["total"])],
            ["Selected-cell partition residual", number(group.get("selected_cell_residual"))],
            *[[roles.get(role, role) + " subject", text(group["subject_ids"][role])]
              for role in ordered if role != "total" and role in group["subject_ids"]],
        ])]
        items = group.get("quantities", [])
        for run_id in dict.fromkeys(item["run_id"] for item in items):
            run_items = [item for item in items if item["run_id"] == run_id]
            run_title = run_names.get(run_id) or run_id
            for statistic in dict.fromkeys(item["statistic"] for item in run_items):
                rows = [item for item in run_items if item["statistic"] == statistic]
                label = run_title + ": " + statistics.get(statistic, statistic)
                tables.append(_table(
                    ["Quantity", "Accounting area", "Annual quantity", "Units",
                     "Valid cells", "Valid fraction"],
                    [[_label(item["quantity"]), roles.get(role, role),
                      _quantity(item["values"].get(role, {}), "sum", number),
                      text(item["units"]),
                      number(item["values"].get(role, {}).get("valid_cells")),
                      number(item["values"].get(role, {}).get("coverage_fraction"))]
                     for item in rows for role in ordered if role in item["values"]],
                    label,
                ))
                tables.append(_table(
                    ["Quantity", "Partition sum", "Residual", "Units",
                     "Cell residual", "Closure"],
                    [[_label(item["quantity"]), number(item["closure"].get("partition_sum")),
                      number(item["closure"].get("residual")), text(item["units"]),
                      number(item["closure"].get("valid_cell_residual")),
                      text(item["closure"].get("status", "pending")).replace("_", " ")]
                     for item in rows],
                    label + ": saved reconciliation of disjoint areas with the total",
                ))
                tables.append(_table(
                    ["Quantity", "Float64 summation allowance", "Within allowance"],
                    [[_label(item["quantity"]),
                      number(item["closure"].get("float64_summation_allowance")),
                      text(item["closure"].get("within_summation_allowance"))]
                     for item in rows],
                    "The recorded allowance accounts for floating-point summation only.",
                ))
        source_rows = [[name, text(value)] for name, value in _records({
            "Original source relationships": group.get("source_relationships", []),
            "Relationship references": group.get("references", []),
        })]
        tables.append(_table(["Source and relationship", "Retained value"], source_rows))
        sections.append(_section("receiving-water-accounting-" + str(index),
                                 text(group.get("title") or group["id"]), paragraphs, tables))
    return sections
