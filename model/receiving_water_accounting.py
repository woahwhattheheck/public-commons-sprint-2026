"""Partition original receiving-water domains into explicit, non-overlapping accounts.

The selected domain relationships come from retained source references. This
module adds spatial land-export accounting; it does not route or attenuate mass
through a river, reservoir or intake.
"""
from __future__ import annotations

import math
from .common import digest

SCHEMA = "upstate.receiving-water-accounting/v1"
EDITION = "receiving-water-accounting/1"
ROLES = {
    "upstream_union": "Combined upstream-domain export to streams",
    "reservoir_inflow": "Above-reservoir land export to streams",
    "other_upstream": "Other upstream land export to streams",
    "incremental": "Incremental land export to streams",
}


def _id(value, label):
    from .receiving_waters import _safe_label
    return _safe_label(value, label)


def _ids(value, label, *, required=False):
    if not isinstance(value, list) or required and not value:
        raise ValueError(label + " must contain distinct retained receptor IDs")
    result = [_id(item, label) for item in value]
    if len(set(result)) != len(result):
        raise ValueError(label + " repeats a retained receptor")
    return result


def _references(value):
    if not isinstance(value, list) or not value:
        raise ValueError("Supply original source references for the accounting relationships")
    for item in value:
        if isinstance(item, str) and item.strip():
            continue
        if isinstance(item, dict) and any(isinstance(item.get(k), str) and item[k].strip()
                                          for k in ("uri", "url", "citation", "source_id")):
            continue
        raise ValueError("Each accounting reference needs its original URI, citation or source ID")
    return value


def _union(geometries):
    from shapely.ops import unary_union
    return unary_union(geometries)


def _polygon_domain(geometry):
    """Match the core receiving-water positive-area/empty-polygon rule."""
    from shapely.geometry import Polygon
    from .receiving_waters import _polygon
    if geometry.is_empty or geometry.area <= 0:
        return Polygon()
    return _polygon(geometry, "Accounting source-domain intersection")


def compile_groups(plan, source_geometries, domain, selection):
    """Return ordinary analysis subjects plus exact runtime pixel-mask recipes."""
    requested = selection.get("accounting")
    if requested is None:
        return [], [], [], []
    if not isinstance(requested, dict) or set(requested) - {"groups"}:
        raise ValueError("Receiving-water accounting accepts a groups list")
    groups = requested.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("Select at least one source-linked receiving-water accounting group")
    if len(groups) > 100:
        raise ValueError("Select at most 100 accounting groups in one analysis")
    receptors = {row["id"]: row for row in plan["receptors"]}
    prepared, definitions, geometries, masks = [], [], [], []
    seen = set()
    for raw in groups:
        if not isinstance(raw, dict):
            raise ValueError("An accounting group must be an object")
        allowed = {"id", "title", "parent_receptor_id", "upstream_receptor_ids",
                   "reservoir_receptor_ids", "references", "rationale"}
        if set(raw) - allowed:
            raise ValueError("Unknown receiving-water accounting group fields")
        key = _id(raw.get("id"), "Accounting group ID")
        if key in seen:
            raise ValueError("Accounting group IDs must be distinct")
        seen.add(key)
        title, rationale = raw.get("title"), raw.get("rationale")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Supply a descriptive accounting group title")
        if not isinstance(rationale, str) or not rationale.strip():
            raise ValueError("Describe the original source relationship between the selected domains")
        parent_id = _id(raw.get("parent_receptor_id"), "Parent receiving-water ID")
        upstream = _ids(raw.get("upstream_receptor_ids"), "Upstream receiving-water IDs", required=True)
        reservoirs = _ids(raw.get("reservoir_receptor_ids", []), "Reservoir inflow receiving-water IDs")
        if parent_id in upstream or set(reservoirs) - set(upstream):
            raise ValueError("Reservoir inflow IDs must be selected upstream domains, excluding the parent")
        if set([parent_id, *upstream]) - set(receptors):
            raise ValueError("Accounting must select receptor IDs from the retained source plan")
        references = _references(raw.get("references"))
        parent, parent_shape = receptors[parent_id], source_geometries[parent_id]
        children = [source_geometries[value] for value in upstream]
        # Reject a relationship contradicted by the retained whole polygons.
        # A source-domain boundary is never silently clipped to manufacture nesting.
        outside = {}
        for value, shape in zip(upstream, children):
            area = shape.difference(parent_shape).area
            if not math.isfinite(area):
                raise ValueError("Accounting source-domain area is not finite")
            outside[value] = area / 10000
            tolerance = max(parent_shape.area, shape.area, 1.0) * 1e-12
            if area > tolerance:
                raise ValueError("Upstream domain " + value + " extends outside parent " + parent_id
                                 + "; select compatible original contribution domains")
        total = _polygon_domain(parent_shape.intersection(domain))
        group = {
            "id": key, "title": title.strip(), "parent_receptor_id": parent_id,
            "upstream_receptor_ids": upstream, "reservoir_receptor_ids": reservoirs,
            "references": references, "rationale": rationale.strip(),
            "parent_contribution_area_ha": parent_shape.area / 10000,
            "parent_area_in_quantity_scope_ha": total.area / 10000,
            "source_outside_parent_area_ha": outside,
            "source_relationships": [
                {"receptor_id": value, "title": receptors[value]["title"],
                 "relationship_precision": receptors[value]["relationship_precision"],
                 "relation": receptors[value]["relation"], "source": receptors[value]["source"]}
                for value in [parent_id, *upstream]
            ],
            "subject_ids": {"total": parent_id},
            "partition": "Parent mask AND selected upstream masks, with explicit set exclusion; pixel-centre selection.",
            "quantity_meaning": "Land export entering streams within each selected contribution domain.",
            "reservoir_transfer": "unmodelled" if reservoirs else "not_selected",
        }
        roles = [("upstream_union", children, []),
                 ("incremental", [], children)]
        if reservoirs:
            reservoir_shapes = [source_geometries[value] for value in reservoirs]
            roles.extend([("reservoir_inflow", reservoir_shapes, []),
                          ("other_upstream", children, reservoir_shapes)])
        for role, include, exclude in roles:
            subject_id = "account-" + digest({"group": key, "role": role})[:24]
            group["subject_ids"][role] = subject_id
            whole = parent_shape
            if include:
                whole = whole.intersection(_union(include))
            if exclude:
                whole = whole.difference(_union(exclude))
            whole = _polygon_domain(whole)
            shape = _polygon_domain(whole.intersection(domain))
            definition = {
                "id": subject_id, "kind": "accounting", "title": title.strip() + " / " + ROLES[role],
                "family": parent["family"], "source": parent["source"],
                "classification": parent.get("classification", {}),
                "relationship_precision": parent["relationship_precision"],
                "relation": {"method": "source-linked domain accounting", "group_id": key,
                             "role": role, "parent_receptor_id": parent_id,
                             "upstream_receptor_ids": upstream, "reservoir_receptor_ids": reservoirs,
                             "references": references, "rationale": rationale.strip()},
                "interpretation": group["quantity_meaning"] + (
                    " Above-reservoir exports and below-reservoir increments remain separate; reservoir throughput is unmodelled."
                    if reservoirs else
                    " Nested source domains are combined once before calculating the incremental area."),
                "contribution_area_ha": whole.area / 10000,
                "area_in_quantity_scope_ha": shape.area / 10000,
                "area_fraction_in_quantity_scope": shape.area / whole.area if whole.area else None,
                "source_plan_id": plan["id"], "accounting_group_id": key, "accounting_role": role,
            }
            # Keep the parent extent for raster reads. Intersections/exclusions
            # happen on Boolean masks so boundary cells belong to one partition.
            recipe = {"parent": total, "include": include, "exclude": exclude}
            definitions.append(definition)
            geometries.append(shape)
            masks.append(recipe)
        prepared.append(group)
    return prepared, definitions, geometries, masks


def geometry_identity(grid, geometry, recipe=None):
    if recipe is None:
        return digest({"crs": grid["crs"], "wkb": geometry.wkb_hex})
    return digest({
        "crs": grid["crs"], "accounting_edition": EDITION,
        "parent": recipe["parent"].wkb_hex,
        "include": sorted({shape.wkb_hex for shape in recipe["include"]}),
        "exclude": sorted({shape.wkb_hex for shape in recipe["exclude"]}),
    })


def inside(grid, geometry, window, recipe=None):
    from .receiving_waters import _inside
    import numpy as np
    if recipe is None:
        return _inside(grid, geometry, window)
    result = _inside(grid, recipe["parent"], window)
    if recipe["include"]:
        included = np.zeros(result.shape, dtype=bool)
        for shape in recipe["include"]:
            included |= _inside(grid, shape, window)
        result &= included
    if recipe["exclude"]:
        excluded = np.zeros(result.shape, dtype=bool)
        for shape in recipe["exclude"]:
            excluded |= _inside(grid, shape, window)
        result &= ~excluded
    return result


def _series(subject, baseline_id):
    """Expose original physical and paired-support quantities without changing units."""
    metrics = subject["metrics"]
    for pollutant, stats in metrics["baseline_physical"].items():
        yield (baseline_id, pollutant, "current_export"), stats
    for run_id, alternative in metrics["alternatives"].items():
        for pollutant, stats in alternative["physical"].items():
            yield (run_id, pollutant, "alternative_export"), stats
        for pollutant, stats in alternative["changes"].items():
            yield (run_id, pollutant, "alternative_minus_baseline"), stats
            for statistic, name, source in (
                ("common_baseline_export", "baseline_sum_on_common_cells", metrics["baseline_physical"][pollutant]),
                ("common_alternative_export", "alternative_sum_on_common_cells", alternative["physical"][pollutant]),
                ("positive_increased_export", "sum_increased_export", stats),
                ("positive_avoided_export", "sum_avoided_export", stats),
            ):
                if statistic in ("positive_increased_export", "positive_avoided_export") and stats["valid_cells"]:
                    original = metrics["baseline_physical"][pollutant]
                    alternate = alternative["physical"][pollutant]
                    bound = max(abs(original["minimum"]), abs(original["maximum"])) + max(
                        abs(alternate["minimum"]), abs(alternate["maximum"]))
                    low, high = 0.0, bound
                else:
                    low, high = source["minimum"], source["maximum"]
                yield (run_id, pollutant, statistic), {
                    **stats, "sum": stats[name],
                    # Retained original extrema bound paired subsets and raw
                    # positive differences before Float32 difference encoding.
                    "minimum": low, "maximum": high,
                }


def _sum_allowance(stats):
    """Conservative Float64 aggregation allowance, not physical uncertainty."""
    count = stats["valid_cells"]
    if count == 0:
        return 0.0
    values = [stats["sum"], stats["minimum"], stats["maximum"]]
    if any(value is None or not math.isfinite(value) for value in values):
        raise ValueError("Receiving-water accounting requires finite retained physical sums and extrema")
    # NumPy reductions plus repeated window addition use no more than 2n+2
    # Float64 additions. Use epsilon (twice unit roundoff) conservatively.
    operations = 2 * count + 2
    error = operations * (2.0 ** -52)
    if error >= 1:
        raise ValueError("Receiving-water accounting exceeds supported finite summation precision")
    bound = error / (1 - error) * count * max(abs(stats["minimum"]), abs(stats["maximum"]))
    if not math.isfinite(bound):
        raise ValueError("Receiving-water accounting summation allowance overflowed")
    return bound


def summarize(groups, subjects, baseline_id):
    """Retain parent/subtotal/partition amounts and exact support closure."""
    if not groups:
        return None
    by_id = {(row["kind"], row["id"]): row for row in subjects}
    result_groups = []
    for group in groups:
        parent = by_id[("receptor", group["parent_receptor_id"])]
        members = {"total": parent, **{
            role: by_id[("accounting", subject_id)] for role, subject_id in group["subject_ids"].items() if role != "total"
        }}
        partition = (["reservoir_inflow", "other_upstream", "incremental"]
                     if group["reservoir_receptor_ids"] else ["upstream_union", "incremental"])
        selected = {role: row["metrics"]["selected_cells"] for role, row in members.items()}
        selected_residual = selected["total"] - sum(selected[role] for role in partition)
        if selected_residual:
            raise ValueError("Receiving-water accounting masks do not partition the original parent pixels")
        series = {role: dict(_series(row, baseline_id)) for role, row in members.items()}
        keys = list(series["total"])
        if any(set(value) != set(keys) for value in series.values()):
            raise ValueError("Receiving-water accounting lost a retained run or selected physical quantity")
        quantities = []
        for run_id, pollutant, statistic in keys:
            values = {role: value[(run_id, pollutant, statistic)] for role, value in series.items()}
            count = values["total"]["valid_cells"]
            residual_cells = count - sum(values[role]["valid_cells"] for role in partition)
            if residual_cells:
                raise ValueError("Receiving-water accounting changed the original valid-pixel support")
            summed = math.fsum(
                values[role]["sum"] if values[role]["valid_cells"] else 0.0
                for role in partition
            )
            total = values["total"]["sum"]
            if count:
                allowance = math.fsum(_sum_allowance(values[role]) for role in ["total", *partition])
                allowance += (abs(total) + abs(summed)) * (2.0 ** -51)
                residual = total - summed
                if not math.isfinite(residual) or not math.isfinite(allowance):
                    raise ValueError("Receiving-water accounting requires finite closure quantities")
                within = abs(residual) <= allowance
                if not within:
                    raise ValueError("Receiving-water physical partitions do not close within their summation precision")
                status = "closed"
            else:
                residual, allowance, within, status = None, None, None, "no_valid_pixels"
            quantities.append({
                "run_id": run_id, "reference_run_id": baseline_id, "quantity": pollutant,
                "statistic": statistic, "units": values["total"]["sum_units"],
                "values": {
                    role: {key: value[key] for key in
                           ("sum", "valid_cells", "selected_cells", "coverage_fraction")}
                    for role, value in values.items()
                },
                "closure": {
                    "status": status, "partition_roles": partition,
                    "partition_sum": summed if count else None, "residual": residual,
                    "valid_cell_residual": residual_cells,
                    "float64_summation_allowance": allowance,
                    "within_summation_allowance": within,
                    "meaning": "Parent minus disjoint partition amounts on the same retained valid cells.",
                },
            })
        result_groups.append({
            **group, "partition_roles": partition,
            "selected_cells": selected, "selected_cell_residual": selected_residual,
            "quantities": quantities,
        })
    return {
        "schema": SCHEMA, "edition": EDITION, "groups": result_groups,
        "physical_meaning": "Original annual land export entering streams within source-selected contribution domains.",
        "reservoir_rule": "Above-reservoir land export is reported separately; reservoir throughput is unmodelled.",
        "source_guides": [
            "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
            "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
        ],
        "support": "Same parent pixel-centre mask partitioned by upstream-domain union and set exclusion.",
        "summation_allowance": "Conservative Float64 addition allowance; not physical uncertainty or calibration.",
    }


def export(directory, record):
    """Write ordinary JSON and long-form quantities alongside the original analysis."""
    if record is None:
        return {}
    import csv
    from pathlib import Path
    from .common import atomic_json, describe_file
    directory = Path(directory)
    json_path = directory / "domain-accounting.json"
    csv_path = directory / "domain-accounting.csv"
    atomic_json(json_path, record)
    fields = (
        "group_id", "group_title", "parent_receptor_id", "quantity", "run_id", "reference_run_id",
        "statistic", "role", "partition_member", "sum", "units", "valid_cells", "selected_cells",
        "coverage_fraction", "closure_status", "closure_residual", "float64_summation_allowance",
        "reservoir_transfer", "source_relationships",
    )
    with csv_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        from .common import canonical
        for group in record["groups"]:
            for quantity in group["quantities"]:
                for role, value in quantity["values"].items():
                    writer.writerow({
                        "group_id": group["id"], "group_title": group["title"],
                        "parent_receptor_id": group["parent_receptor_id"],
                        **{key: quantity[key] for key in ("quantity", "run_id", "reference_run_id", "statistic", "units")},
                        "role": role, "partition_member": role in group["partition_roles"],
                        **value, "closure_status": quantity["closure"]["status"],
                        "closure_residual": quantity["closure"]["residual"],
                        "float64_summation_allowance": quantity["closure"]["float64_summation_allowance"],
                        "reservoir_transfer": group["reservoir_transfer"],
                        "source_relationships": canonical(group["source_relationships"]).decode("utf-8"),
                    })
    return {
        "domain_accounting_json": describe_file(directory, json_path),
        "domain_accounting_csv": describe_file(directory, csv_path),
    }


def empty_metrics(geometry_id, pollutants, alternative_ids):
    """Preserve every selected run and quantity when a domain has no selected cells."""
    from . import rasters
    from .receiving_waters import _empty_stats, _final_stats
    def physical():
        return {p: _final_stats(_empty_stats(), 0, units=rasters.MASS_UNITS[p], mass=True)
                for p in pollutants}
    def priority():
        return _final_stats(_empty_stats(), 0, units="dimensionless")
    alternatives = {}
    for run_id in alternative_ids:
        alternatives[run_id] = {
            "physical": physical(), "changes": {
                p: {**value, "sum_increased_export": None, "sum_avoided_export": None,
                    "baseline_sum_on_common_cells": None, "alternative_sum_on_common_cells": None,
                    "direction": "alternative minus baseline",
                    "sum_basis": "stored Float32 signed difference pixels"}
                for p, value in physical().items()
            },
            "current_priority": priority(), "increased_export_priority": priority(),
            "avoided_export_priority": priority(),
        }
    return {
        "geometry_id": geometry_id, "files": {}, "selected_cells": 0,
        "selected_pixel_area_ha": 0.0, "baseline_physical": physical(),
        "current_priority": priority(), "alternatives": alternatives,
        "elapsed_seconds": 0.0, "completed_windows": 0,
    }
