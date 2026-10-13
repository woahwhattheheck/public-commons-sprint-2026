"""Total, incremental and union accounting for saved source-water networks.

The original ToHUC graph supplies membership. Equal upstream sets are one
accounting group, so a source cycle or repeated anchor cannot duplicate mass.
Geometry measurement is an optional native GIS operation on the original source.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from html import escape
import io
import json
import math
from pathlib import Path
import shutil
import sys

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, now, read_json, verify_file)
from .receptor_network import upstream_memberships

SCHEMA = "upstate.receptor-accounting/v1"
METHOD = "original-tohuc-selected-anchor-increments-v1"


def _source_area(rows, members):
    """Sum original published km2 attributes, retaining missing-area coverage."""
    known = []
    for key in members:
        attrs = rows[key]["attributes"]
        field = next((name for name in attrs if name.casefold() == "areasqkm"), None)
        value = attrs.get(field) if field else None
        if (isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and value >= 0):
            known.append(float(value) * 100)
    return {"known_area_ha": math.fsum(known) if known else None,
            "known_huc12_count": len(known), "missing_huc12_count": len(members) - len(known),
            "basis": "Original areasqkm attribute multiplied by 100; missing values stay missing"}


def calculate(network):
    """Partition selected upstream catchments without changing source records.

    A total contains an anchor and every retained unit reaching it. Its increment
    removes every strictly upstream selected catchment. Duplicate/equivalent
    catchments are coalesced before subtraction. Utility totals are set unions,
    not sums of their selected anchors' totals or the global increments.
    """
    original = {row["huc12"]: row for row in network["network"]}
    if len(original) != len(network["network"]):
        raise ValueError("Original network contains repeated HUC12 identifiers")
    anchor_areas = defaultdict(list)
    for area in network["areas"]:
        for anchor in area["anchor_huc12s"]:
            anchor_areas[anchor].append(area)
    profiles = []
    for anchor, areas in sorted(anchor_areas.items()):
        if anchor not in original:
            raise ValueError("Original network lacks selected anchor " + anchor)
        profiles.append({**areas[0], "id": "anchor-" + anchor,
                         "title": original[anchor].get("name") or anchor,
                         "anchor_huc12s": [anchor]})
    fields = network["source_fields"]
    single = upstream_memberships(
        [{"id": row["source_feature_id"], "properties": row["attributes"]}
         for row in network["network"]], profiles,
        huc12_field=fields["huc12"], tohuc_field=fields["tohuc"],
        name_field=fields.get("name"), type_field=fields.get("type"))
    equivalent = defaultdict(list)
    for area in single["areas"]:
        equivalent[tuple(area["huc12s"])].append(area["anchor_huc12s"][0])
    sets = {"catchment-" + digest(list(keys))[:20]: set(keys) for keys in equivalent}
    anchors_by_group = {"catchment-" + digest(list(keys))[:20]: sorted(values)
                        for keys, values in equivalent.items()}
    # A functional ToHUC graph has disjoint, nested or equivalent upstream sets.
    # Crossing sets indicate inconsistent source/selection semantics, not an
    # opportunity to assign the shared area to an arbitrary first winner.
    items = list(sets.items())
    for index, (left_id, left) in enumerate(items):
        for right_id, right in items[index + 1:]:
            if left & right and not (left <= right or right <= left):
                raise ValueError("Crossing upstream sets: " + left_id + " and " + right_id)
    groups, increments = [], set()
    for group_id, total in sorted(items, key=lambda item: (len(item[1]), item[0])):
        descendants = {key: value for key, value in sets.items() if value < total}
        nearest = sorted(key for key, value in descendants.items()
                         if not any(value < other for other in descendants.values()))
        upstream = set().union(*descendants.values()) if descendants else set()
        incremental = total - upstream
        if increments & incremental:
            raise ValueError("Selected incremental catchments overlap")
        increments.update(incremental)
        anchors = anchors_by_group[group_id]
        groups.append({"id": group_id, "anchor_huc12s": anchors,
            "title": " / ".join(original[key].get("name") or key for key in anchors),
            "area_ids": sorted({area["id"] for anchor in anchors for area in anchor_areas[anchor]}),
            "equivalent_anchor_count": len(anchors), "immediate_upstream_group_ids": nearest,
            "total_huc12s": sorted(total), "incremental_huc12s": sorted(incremental),
            "upstream_selected_huc12s": sorted(upstream),
            "total_huc12_count": len(total), "incremental_huc12_count": len(incremental),
            "total_source_area": _source_area(original, total),
            "incremental_source_area": _source_area(original, incremental)})
    union = set().union(*sets.values())
    if increments != union:
        raise ValueError("Incremental catchments do not cover the selected union")
    by_anchor = {anchor: group for group in groups for anchor in group["anchor_huc12s"]}
    areas = []
    for area in network["areas"]:
        members = set().union(*(set(by_anchor[key]["total_huc12s"])
                                for key in area["anchor_huc12s"]))
        if members != set(area["huc12s"]):
            raise ValueError("Saved area membership differs from its original ToHUC anchors: " + area["id"])
        areas.append({"id": area["id"], "title": area["title"], "role": area["role"],
            "reference": area["reference"], "anchor_huc12s": area["anchor_huc12s"],
            "group_ids": sorted({by_anchor[key]["id"] for key in area["anchor_huc12s"]}),
            "huc12s": sorted(members), "huc12_count": len(members),
            "source_area": _source_area(original, members)})
    members = []
    for key in sorted(union):
        total_groups = [group["id"] for group in groups if key in group["total_huc12s"]]
        incremental_group = next(group["id"] for group in groups if key in group["incremental_huc12s"])
        anchor_uses = sum(len(anchors_by_group[group_id]) for group_id in total_groups)
        members.append({"huc12": key, "name": original[key].get("name"),
            "source_feature_id": original[key]["source_feature_id"],
            "tohuc_original": original[key]["tohuc_original"], "hutype": original[key].get("hutype"),
            "total_group_ids": total_groups, "incremental_group_id": incremental_group,
            "area_ids": [area["id"] for area in areas if key in area["huc12s"]],
            "anchor_total_uses": anchor_uses,
            "source_area": _source_area(original, [key])})
    duplicate_rows = [row for row in members if row["anchor_total_uses"] > 1]
    complete_areas = all(row["source_area"]["missing_huc12_count"] == 0 for row in members)
    duplicate_area = math.fsum((row["anchor_total_uses"] - 1) *
        row["source_area"]["known_area_ha"] for row in duplicate_rows
        if row["source_area"]["known_area_ha"] is not None)
    return {"schema": SCHEMA, "method": METHOD,
        "network_huc12_count": len(original), "anchor_count": len(anchor_areas),
        "accounting_group_count": len(groups), "groups": groups, "areas": areas,
        "memberships": members, "union_huc12s": sorted(union), "union_huc12_count": len(union),
        "union_source_area": _source_area(original, union),
        "naive_anchor_total_huc12_count": sum(row["anchor_total_uses"] for row in members),
        "repeated_huc12s": [row["huc12"] for row in duplicate_rows],
        "repeated_source_area_ha": duplicate_area if complete_areas else None,
        "source_links_outside_domain": network.get("outside_network_links", []),
        "definitions": {
            "total": "Selected anchor and all upstream HUC12s in this retained ToHUC source edition.",
            "incremental": "Total minus the union of all strictly upstream selected accounting groups.",
            "equivalence": "Selected anchors with identical upstream sets share one accounting group.",
            "utility": "Union of its selected anchors' totals; independent of other utilities' choices.",
            "union": "Each selected HUC12 once across all groups and utilities.",
            "mass_basis": "Native NDR/SDR export is land-origin mass delivered to modeled streams. Reservoir and in-stream fate require their own model.",
            "area_basis": "Published source area and separately projected polygon area have different bases and are retained separately.",
        }}


def aggregate_values(accounting, values, *, unit, source):
    """Sum additive, whole-HUC quantities on total/increment/utility/union sets.

    `values` maps HUC12 to a finite number or None. Missing members are counted
    separately; partial sums are named known_sum, not a complete catchment total.
    Callers must supply one additive land-origin quantity per HUC, not cumulative
    outlet loads, rates, concentrations or repeated upstream sums.
    """
    if not isinstance(unit, str) or not unit.strip() or not isinstance(source, dict) or not source:
        raise ValueError("Retain the additive quantity unit and original producing source")
    clean = {}
    for key, value in values.items():
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))
                                  or not math.isfinite(value)):
            raise ValueError("Nonfinite or nonnumeric HUC value: " + str(key))
        clean[key] = value
    def summary(keys):
        selected = [clean.get(key) for key in keys]
        available = [value for value in selected if value is not None]
        known = math.fsum(available) if available else None
        return {"known_sum": known, "total": known if len(available) == len(selected) else None,
                "known_huc12_count": len(available), "missing_huc12_count": len(selected) - len(available)}
    return {"unit": unit, "source": source,
            "groups": {group["id"]: {name: summary(group[name + "_huc12s"])
                        for name in ("total", "incremental")} for group in accounting["groups"]},
            "areas": {area["id"]: summary(area["huc12s"]) for area in accounting["areas"]},
            "union": summary(accounting["union_huc12s"])}


def _csv(path, columns, rows):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        values = {}
        for key in columns:
            value = row.get(key)
            if isinstance(value, list):
                value = ";".join(str(item) for item in value)
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            values[key] = value
        writer.writerow(values)
    atomic_bytes(path, buffer.getvalue().encode("utf-8"))


def _number(value):
    return "Unavailable" if value is None else format(value, ",.2f")


def _report(path, account, svg, projected):
    def text(value):
        return escape(str(value if value is not None else ""), quote=True)
    data = json.dumps({"groups": account["groups"], "areas": account["areas"],
                       "memberships": account["memberships"]}, ensure_ascii=False,
                      allow_nan=False).replace("<", "\\u003c").replace("&", "\\u0026")
    rows = []
    for group in account["groups"]:
        rows.append('<tr data-group="' + text(group["id"]) + '"><td><button type="button" data-pick="' +
            text(group["id"]) + '">' + text(group["title"]) + '</button><br><code>' +
            text(", ".join(group["anchor_huc12s"])) + '</code></td>' +
            ''.join('<td>' + text(value) + '</td>' for value in (
                group["total_huc12_count"], group["incremental_huc12_count"],
                _number(group["total_source_area"]["known_area_ha"]),
                _number(group["incremental_source_area"]["known_area_ha"]))) + '</tr>')
    area_rows = ''.join('<tr><td>' + text(area["title"]) + '</td><td>' + str(area["huc12_count"]) +
        '</td><td>' + _number(area["source_area"]["known_area_ha"]) + '</td></tr>' for area in account["areas"])
    details = ''.join('<tr data-huc="' + text(row["huc12"]) + '"><td><code>' + text(row["huc12"]) +
        '</code></td><td>' + text(row["name"]) + '</td><td>' + text(row["tohuc_original"]) +
        '</td><td>' + str(row["anchor_total_uses"]) + '</td><td>' +
        _number(row["source_area"]["known_area_ha"]) + '</td></tr>' for row in account["memberships"])
    projection_section = ''
    if projected:
        projected_rows = ''.join('<tr><td>' + text(group["title"]) + '</td><td>' +
            _number(projected["groups"][group["id"]]["total_area_ha"]) + '</td><td>' +
            _number(projected["groups"][group["id"]]["incremental_area_ha"]) + '</td></tr>'
            for group in account["groups"])
        projection_section = ('<section><h2>Measured original polygon footprints</h2><p>' +
            text(projected["crs"]) + '. Total union: <strong>' + _number(projected["union_area_ha"]) +
            ' ha</strong>. These equal-area measurements use complete original polygon rings, separately from published source attributes.</p>' +
            '<table><thead><tr><th>Selected anchor group</th><th>Total polygon area (ha)</th><th>Incremental polygon area (ha)</th></tr></thead><tbody>' +
            projected_rows + '</tbody></table><p><a href="catchments.gpkg">GIS layers: total, incremental, utility and union</a> · ' +
            '<a href="projected-areas.json">Complete projected measurements</a></p></section>')
    duplicate = ('<strong>' + str(account["naive_anchor_total_huc12_count"]) + '</strong> entries become <strong>' +
                 str(account["union_huc12_count"]) + '</strong> distinct HUC12s. ' +
                 str(len(account["repeated_huc12s"])) + ' units occur under more than one selected anchor.')
    if account["repeated_source_area_ha"] is not None:
        duplicate += ' Summing all anchor totals would count an extra <strong>' + _number(account["repeated_source_area_ha"]) + ' ha</strong> of published source area.'
    html = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Selected watershed accounting</title><style>
body{font:15px system-ui,sans-serif;color:#202020;background:#fff;max-width:1320px;margin:32px auto;padding:0 24px;line-height:1.5}
h1{font-size:30px;margin:6px 0 12px}h2{font-size:21px;margin:24px 0 10px}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#555}
section{margin:26px 0}a{color:inherit}code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:10px 12px;border-bottom:1px solid #bbb;text-align:left;vertical-align:top}th{background:#eee}td:not(:first-child){white-space:nowrap}
.notice{padding:16px 20px;border:1px solid #888;background:#f6f6f6}.scroll{overflow-x:auto}button,select{font:inherit;padding:7px 10px;border:1px solid #999;background:#fff;color:#222}
button[data-pick]{padding:0;border:0;text-decoration:underline;text-align:left;cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid #111;outline-offset:3px}
.filters{display:flex;gap:16px;flex-wrap:wrap;align-items:end}label{display:grid;gap:5px}.map-wrap{border:1px solid #aaa;margin-top:12px;padding:12px}#watersheds{width:100%;max-height:530px;display:block}
#watersheds .unit{fill:#f4f4f4}#watersheds .unit.selected{fill:#777;stroke:#111}#watersheds .unit.anchor{stroke:#111;stroke-width:2}#watersheds .unit.chosen{fill:#222}
tr[hidden]{display:none}#selected-summary{font-weight:600}.small,footer{font-size:13px;color:#555}footer{border-top:1px solid #999;margin-top:32px;padding-top:16px}
@media print{body{font-size:9pt;margin:8mm;padding:0}h1{font-size:20pt}.filters,button#print{display:none}tr{break-inside:avoid}.map-wrap{break-inside:avoid}#watersheds{max-height:110mm}}
</style></head><body><div class="eyebrow">Source-water planning / original watershed network</div><h1>Selected watershed accounting</h1>
<p>Trace each selected anchor's full upstream catchment, separate its incremental contribution, and combine utilities without repeating shared land.</p>
<div class="notice">''' + duplicate + '''</div><p class="small">Source domain: ''' + str(account["network_huc12_count"]) + ''' HUC12s. Selection: ''' + str(account["anchor_count"]) + ''' anchors in ''' + str(len(account["areas"])) + ''' receiving areas.</p>
<section><h2>Total and incremental catchments</h2><p><strong>Total</strong> includes the selected anchor and all upstream units in the retained source. <strong>Incremental</strong> removes all strictly upstream selected catchments. Equivalent upstream sets share one accounting group.</p>
<div class="scroll"><table><thead><tr><th>Selected anchor group</th><th>Total HUC12s</th><th>Incremental HUC12s</th><th>Published total area (ha)</th><th>Published incremental area (ha)</th></tr></thead><tbody>''' + ''.join(rows) + '''</tbody></table></div>
<p class="small">Published areas are sums of original areasqkm attributes. Missing-area counts remain in accounting.json; these values are not substitutes for projected polygon measurements.</p></section>
<section><h2>Utility unions</h2><table><thead><tr><th>Receiving area</th><th>Distinct HUC12s</th><th>Published source area (ha)</th></tr></thead><tbody>''' + area_rows + '''</tbody></table>
<p>Each utility retains the union of its selected anchors' total catchments. A utility's total does not shrink when another utility selects an upstream anchor.</p></section>
<section><h2>Explore the source footprint</h2><div class="filters"><label>Selected anchor<select id="group"><option value="">All selected catchments</option>''' + ''.join('<option value="' + text(group["id"]) + '">' + text(group["title"]) + '</option>' for group in account["groups"]) + '''</select></label>
<label>Membership<select id="basis"><option value="total">Total upstream</option><option value="incremental">Incremental only</option></select></label><button type="button" id="print">Print report</button></div>
<p id="selected-summary" role="status">All distinct selected HUC12s are listed below.</p>''' + ('<div class="map-wrap">' + svg + '</div><p class="small">Original source coordinate view. The dark footprint follows the selected accounting basis; outlined polygons contain the selected anchors. Choose a polygon for its original identifier and name.</p>' if svg else '') + '''
<p id="map-detail" role="status"></p><div class="scroll"><table><thead><tr><th>Original HUC12</th><th>Original name</th><th>Original ToHUC</th><th>Anchor-total uses</th><th>Published area (ha)</th></tr></thead><tbody id="members">''' + details + '''</tbody></table></div></section>''' + projection_section + '''
<section><h2>Use the correct quantity</h2><p>Whole-HUC boundaries describe a planning footprint, not an intake-snapped delineation. Memberships are limited to the retained source edition. Source links outside that edition remain in accounting.json.</p>
<p>When applying native export rasters, use land-origin mass delivered to the modeled stream network. Reservoir retention, in-stream processing, intake delivery and concentration require separate calculations. Missing raster coverage is not zero export.</p>
<p><a href="https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html">InVEST nutrient delivery model methods</a></p></section>
<p><a href="accounting.json">Complete accounting</a> · <a href="catchments.csv">Catchment table</a> · <a href="incremental-memberships.csv">Incremental membership table</a> · <a href="utility-unions.csv">Utility unions</a></p>
<footer><p>Original network: <code>''' + text(account.get("original_network_id", "")) + '''</code><br>Method: <code>''' + METHOD + '''</code><br>Original source body: <code>''' + text(account.get("source_binding", {}).get("body_sha256", "")) + '''</code></p></footer>
<script type="application/json" id="account-data">''' + data + '''</script><script>
"use strict";
const data=JSON.parse(document.getElementById("account-data").textContent);
const group=document.getElementById("group"),basis=document.getElementById("basis"),tableRows=[...document.querySelectorAll("#members tr[data-huc]")];
const shapes=[...document.querySelectorAll("#watersheds path[data-huc]")];
function select(){
 const item=data.groups.find(row=>row.id===group.value),members=new Set(item?item[basis.value+"_huc12s"]:data.memberships.map(row=>row.huc12));
 const anchors=new Set(item?item.anchor_huc12s:data.groups.flatMap(row=>row.anchor_huc12s));
 for(const row of tableRows)row.hidden=!members.has(row.dataset.huc);
 for(const path of shapes){path.classList.toggle("selected",members.has(path.dataset.huc));path.classList.toggle("anchor",anchors.has(path.dataset.huc));path.classList.remove("chosen","member","quiet");}
 document.getElementById("selected-summary").textContent=(item?item.title+" / "+basis.options[basis.selectedIndex].text:"Distinct union across all selected catchments")+": "+members.size+" HUC12s.";
}
function pick(path){for(const other of shapes)other.classList.toggle("chosen",other===path);document.getElementById("map-detail").textContent=path.dataset.huc+" / "+path.dataset.name;}
for(const path of shapes){path.addEventListener("click",()=>pick(path));path.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();pick(path);}});}
for(const button of document.querySelectorAll("button[data-pick]"))button.addEventListener("click",()=>{group.value=button.dataset.pick;select();document.getElementById("selected-summary").scrollIntoView({block:"nearest"});});
group.addEventListener("change",select);basis.addEventListener("change",select);document.getElementById("print").addEventListener("click",()=>window.print());select();
</script></body></html>\n'''
    atomic_bytes(path, html.encode("utf-8"))


def write_product(directory, network, *, parent_network_id, source_binding, svg=None, projected=None):
    """Write a self-contained report and machine-readable accounting companions."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    account = calculate(network)
    account.update({"original_network_id": parent_network_id, "source_binding": source_binding})
    atomic_json(directory / "accounting.json", account)
    _csv(directory / "catchments.csv", ("id", "title", "anchor_huc12s", "total_huc12_count",
         "incremental_huc12_count", "total_source_area_ha", "incremental_source_area_ha",
         "immediate_upstream_group_ids", "total_huc12s", "incremental_huc12s"),
         [{**group, "total_source_area_ha": group["total_source_area"]["known_area_ha"],
           "incremental_source_area_ha": group["incremental_source_area"]["known_area_ha"]} for group in account["groups"]])
    _csv(directory / "incremental-memberships.csv", ("huc12", "name", "source_feature_id",
         "tohuc_original", "hutype", "incremental_group_id", "total_group_ids", "area_ids", "anchor_total_uses"), account["memberships"])
    _csv(directory / "utility-unions.csv", ("id", "title", "role", "anchor_huc12s", "huc12_count", "huc12s"), account["areas"])
    if projected:
        atomic_json(directory / "projected-areas.json", projected)
    if svg:
        atomic_bytes(directory / "watersheds.svg", svg.encode("utf-8"))
    _report(directory / "index.html", account, svg, projected)
    return account


def measure_geometry(source, network, accounting, directory, *, target_crs="EPSG:5070"):
    """Measure complete original rings and export the same set-based GIS layers.

    EPSG:5070 is selected explicitly for this CONUS dataset. No coordinate
    repair, clipping, downstream attenuation or intake snapping is applied.
    """
    import fiona
    from pyproj import CRS
    from shapely.geometry import MultiPolygon, mapping
    from shapely.ops import unary_union
    from .rasters import vector_environment, vector_geometry
    crs = CRS.from_user_input(target_crs)
    if (not crs.is_projected or crs.coordinate_operation is None
            or "equal area" not in crs.coordinate_operation.method_name.casefold()
            or any(not math.isclose(axis.unit_conversion_factor, 1) for axis in crs.axis_info[:2])):
        raise ValueError("Choose an explicit equal-area projected CRS with metre units")
    rows, _ = vector_geometry(source, target_crs=crs)
    field = network["source_fields"]["huc12"]
    shapes = {}
    for row in rows:
        key = row["properties"].get(field)
        if key in shapes:
            raise ValueError("Original geometry contains repeated HUC12 " + str(key))
        if row["geometry"].geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Original watershed geometry must be polygonal")
        shapes[key] = row["geometry"]
    missing = set(accounting["union_huc12s"]) - shapes.keys()
    if missing:
        raise ValueError("Original source lacks geometry for selected HUC12s: " + ", ".join(sorted(missing)))
    def union(keys):
        geometry = unary_union([shapes[key] for key in keys])
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError("Selected original polygon union is empty or invalid")
        return geometry
    layers = {"total": [], "incremental": [], "utility": [], "selected_union": []}
    result = {"crs": crs.to_string(), "crs_wkt": crs.to_wkt(), "groups": {}, "areas": {},
              "method": "Reproject full original polygon rings, union selected HUC12s, measure square metres / 10000"}
    for group in accounting["groups"]:
        metrics = {}
        for basis in ("total", "incremental"):
            geometry = union(group[basis + "_huc12s"])
            metrics[basis + "_area_ha"] = geometry.area / 10000
            layers[basis].append((group["id"], group["title"], len(group[basis + "_huc12s"]), geometry))
        result["groups"][group["id"]] = metrics
    for area in accounting["areas"]:
        geometry = union(area["huc12s"])
        result["areas"][area["id"]] = {"area_ha": geometry.area / 10000}
        layers["utility"].append((area["id"], area["title"], area["huc12_count"], geometry))
    geometry = union(accounting["union_huc12s"])
    result["union_area_ha"] = geometry.area / 10000
    result["sum_incremental_polygon_area_ha"] = math.fsum(row["incremental_area_ha"] for row in result["groups"].values())
    result["incremental_polygon_overlap_ha"] = max(0.0, result["sum_incremental_polygon_area_ha"] - result["union_area_ha"])
    layers["selected_union"].append(("selected_union", "Distinct selected watershed union", accounting["union_huc12_count"], geometry))
    path = Path(directory) / "catchments.gpkg"
    if path.exists():
        path.unlink()  # Owned, incomplete derived product; original source is untouched.
    schema = {"geometry": "MultiPolygon", "properties": {"id": "str", "title": "str", "huc12_n": "int", "area_ha": "float"}}
    with vector_environment():
        for layer, features in layers.items():
            with fiona.open(path, "w", driver="GPKG", layer=layer, crs_wkt=crs.to_wkt(), schema=schema) as target:
                for key, title, count, shape in features:
                    target.write({"geometry": mapping(MultiPolygon([shape]) if shape.geom_type == "Polygon" else shape),
                        "properties": {"id": key, "title": title, "huc12_n": count, "area_ha": shape.area / 10000}})
    return result


def receive(network_directory, output, *, with_geometry=False, target_crs="EPSG:5070"):
    """Consume one saved network edition and retain its original source files."""
    from .receptor_network_cli import _read_source, _geography
    original_directory = Path(network_directory).resolve(strict=True)
    original = read_json(original_directory / "result.json")
    if original.get("schema") != "upstate.receptor-network-product/v1":
        raise ValueError("Choose a saved source-water network result directory")
    originals = {name: verify_file(original_directory, original["files"][name])
                 for name in ("network", "profile", "source_body")}
    network = read_json(originals["network"])
    identity = {"schema": SCHEMA, "method": METHOD, "original_network_id": original["id"],
                "original_result_sha256": file_digest(original_directory / "result.json"),
                "source_body_sha256": file_digest(originals["source_body"]),
                "equal_area_crs": target_crs if with_geometry else None}
    key = digest(identity)
    directory = Path(output).resolve() / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".accounting.lock", blocking=False):
        completed = directory / "result.json"
        if completed.exists():
            result = read_json(completed)
            if result.get("identity") != identity:
                raise ValueError("Saved accounting belongs to another source selection")
            for item in result["files"].values():
                verify_file(directory, item)
            return {**result, "directory": str(directory), "reused": True}
        rows, binding, _ = _read_source(originals["source_body"])
        if binding["decoded_sha256"] != original["source_binding"]["decoded_sha256"]:
            raise ValueError("Original source differs from the saved network edition")
        svg, _ = _geography(directory / "watersheds.svg", rows, network, binding)
        accounting = calculate(network)
        projected = measure_geometry(originals["source_body"], network, accounting, directory,
                                     target_crs=target_crs) if with_geometry else None
        write_product(directory, network, parent_network_id=original["id"],
                      source_binding=original["source_binding"], svg=svg, projected=projected)
        for name, source in originals.items():
            shutil.copyfile(source, directory / ("original-" + source.name))
        shutil.copyfile(original_directory / "result.json", directory / "original-result.json")
        result = {"schema": SCHEMA, "id": key, "identity": identity, "created_at": now(),
                  "original_network_id": original["id"], "anchor_count": accounting["anchor_count"],
                  "union_huc12_count": accounting["union_huc12_count"],
                  "repeated_source_area_ha": accounting["repeated_source_area_ha"], "files": {}}
        for path in sorted(directory.iterdir()):
            if path.is_file() and not path.name.startswith(".") and path.name != "result.json":
                result["files"][path.name] = describe_file(directory, path)
        atomic_json(completed, result, immutable=True)
        return {**result, "directory": str(directory), "reused": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", required=True, help="Existing source-water network result directory")
    parser.add_argument("--output", required=True, help="Separate directory for the retained accounting edition")
    parser.add_argument("--with-geometry", action="store_true", help="Measure original polygons and create GeoPackage layers")
    parser.add_argument("--equal-area-crs", default="EPSG:5070", help="Explicit equal-area CRS in metres for the source region")
    args = parser.parse_args(argv)
    try:
        result = receive(args.network, args.output, with_geometry=args.with_geometry, target_crs=args.equal_area_crs)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
