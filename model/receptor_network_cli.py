"""Receive original HUC12/ToHUC source data as an editable upstream inventory.

This entrypoint needs only Python's standard library and the retained graph
module. It accepts the original Upper Savannah domain ZIP, GZIP or Esri JSON.
"""
from __future__ import annotations

import argparse
import csv
import gzip
from html import escape
import io
import json
from pathlib import Path
import re
import sys
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, now, read_json, verify_file)
from .receptor_network import upstream_memberships
from . import receptor_accounting

SCHEMA = "upstate.receptor-network-product/v1"
PRESENTATION_VERSION = "original-watershed-geography-accounting-v2"


def _read_source(path, member=None):
    path = Path(path).resolve(strict=True)
    input_sha256 = file_digest(path)
    selected_member = None
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            if member is None:
                candidates = [name for name in archive.namelist()
                              if Path(name).name in ("model-domain.esri.json.gz",
                                                     "model-domain.esri.json")]
                if len(candidates) != 1:
                    raise ValueError("Select the original domain JSON ZIP member with --member")
                selected_member = candidates[0]
            else:
                selected_member = member
            info = archive.getinfo(selected_member)
            if info.is_dir():
                raise ValueError("Select a regular original domain JSON member")
            retained = archive.read(info)
    else:
        if member is not None:
            raise ValueError("--member applies to a ZIP source")
        retained = path.read_bytes()
    decoded = gzip.decompress(retained) if retained[:2] == b"\x1f\x8b" else retained
    document = json.loads(decoded)
    if not isinstance(document, dict) or not isinstance(document.get("features"), list):
        raise ValueError("Select the retained original Esri feature JSON")
    fields = document.get("fields", [])
    oid_fields = [field["name"] for field in fields
                  if field.get("type") == "esriFieldTypeOID"]
    oid_field = document.get("objectIdFieldName")
    if not oid_field and len(oid_fields) == 1:
        oid_field = oid_fields[0]
    rows = []
    for index, feature in enumerate(document["features"]):
        properties = feature.get("attributes")
        if not isinstance(properties, dict):
            raise ValueError("Original Esri feature lacks its attribute record")
        native_id = properties.get(oid_field) if oid_field else None
        rows.append({"id": str(native_id if native_id is not None else index),
                     "properties": properties, "geometry": feature.get("geometry")})
    if not rows:
        raise ValueError("Original domain contains no feature records")
    import hashlib
    binding = {
        "input_filename": path.name, "input_sha256": input_sha256,
        "zip_member": selected_member, "body_bytes": len(retained),
        "body_sha256": hashlib.sha256(retained).hexdigest(),
        "decoded_bytes": len(decoded),
        "decoded_sha256": hashlib.sha256(decoded).hexdigest(),
        "feature_count": len(rows), "feature_identity_field": oid_field,
        "spatial_reference": document.get("spatialReference"),
        "source_fields": fields,
    }
    return rows, binding, retained


def _csv(path, columns, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: ("'" + value
                        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@"))
                        else value)
                         for key in columns for value in (row.get(key),)})
    atomic_bytes(path, stream.getvalue().encode("utf-8"))



def _simplify_display(points, tolerance=.2):
    """Reduce only screen drawing detail; retained source coordinates stay exact."""
    if len(points) <= 4:
        return points
    keep, pending = {0, len(points) - 1}, [(0, len(points) - 1)]
    threshold = tolerance * tolerance
    while pending:
        first, last = pending.pop()
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        maximum, chosen = threshold, None
        for index in range(first + 1, last):
            x, y = points[index]
            fraction = max(0., min(1., ((x - ax) * dx + (y - ay) * dy) / length)) if length else 0.
            distance = (x - ax - fraction * dx) ** 2 + (y - ay - fraction * dy) ** 2
            if distance > maximum:
                maximum, chosen = distance, index
        if chosen is not None:
            keep.add(chosen)
            pending.extend(((first, chosen), (chosen, last)))
    chosen = [points[index] for index in sorted(keep)]
    return chosen if len(chosen) >= 4 else points


def _geography(path, rows, network, source):
    """Draw native original Esri polygon rings as an offline vector overview."""
    import math
    field = network["source_fields"]["huc12"]
    selected = []
    for row in rows:
        rings = (row.get("geometry") or {}).get("rings")
        if not rings:
            continue
        clean = []
        for ring in rings:
            if not isinstance(ring, list) or len(ring) < 4:
                raise ValueError("Original watershed polygon has an incomplete ring")
            points = []
            for point in ring:
                if (not isinstance(point, (list, tuple)) or len(point) < 2
                        or any(type(value) not in (int, float) or not math.isfinite(value)
                               for value in point[:2])):
                    raise ValueError("Original watershed polygon has invalid source coordinates")
                points.append((point[0], point[1]))
            clean.append(points)
        selected.append((row["properties"][field], clean))
    if not selected:
        return None, None
    xmin = min(x for _, rings in selected for ring in rings for x, y in ring)
    xmax = max(x for _, rings in selected for ring in rings for x, y in ring)
    ymin = min(y for _, rings in selected for ring in rings for x, y in ring)
    ymax = max(y for _, rings in selected for ring in rings for x, y in ring)
    if xmax <= xmin or ymax <= ymin:
        raise ValueError("Original watershed coordinates have an empty extent")
    width, height, margin = 1100., 620., 18.
    scale = min((width - 2 * margin) / (xmax - xmin),
                (height - 2 * margin) / (ymax - ymin))
    left = (width - scale * (xmax - xmin)) / 2
    top = (height - scale * (ymax - ymin)) / 2
    original = {row["huc12"]: row for row in network["network"]}
    units, point_count, rendered_count = [], 0, 0
    for huc, rings in selected:
        paths = []
        for ring in rings:
            points = [(left + (x - xmin) * scale, top + (ymax - y) * scale) for x, y in ring]
            point_count += len(points)
            points = _simplify_display(points)
            rendered_count += len(points)
            paths.append("M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in points) + "Z")
        areas = [area["id"] for area in network["areas"] if huc in area["huc12s"]]
        anchors = [area["id"] for area in network["areas"] if huc in area["anchor_huc12s"]]
        name = str(original[huc]["name"] or "")
        attributes = {
            "class": "unit" + (" member" if areas else "") + (" anchor" if anchors else ""),
            "data-huc": huc, "data-name": name,
            "data-areas": json.dumps(areas, separators=(",", ":")),
            "data-anchors": json.dumps(anchors, separators=(",", ":")),
            "tabindex": "0", "role": "button", "aria-label": huc + " " + name,
            "d": "".join(paths),
        }
        units.append("<path " + " ".join(key + '=\"' + escape(value, quote=True) + '\"'
                     for key, value in attributes.items()) + "><title>" +
                     escape(huc + " · " + name) + "</title></path>")
    svg = (
        '<svg id="watersheds" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 620" '
        'role="group" aria-label="Original watershed source polygons">'
        "<title>Original watershed source polygons</title>"
        "<desc>Source coordinates fitted linearly into the view. Select a HUC12 to find its original memberships.</desc>"
        "<style>.unit{fill:#f1f1f1;fill-rule:evenodd;stroke:#999;stroke-width:.55;vector-effect:non-scaling-stroke;cursor:pointer}"
        ".unit.member{fill:#bbb;stroke:#666}.unit.anchor{fill:#555;stroke:#222}"
        ".unit.quiet{opacity:.25}.unit.chosen,.unit:focus{stroke:#000;stroke-width:2;outline:none;opacity:1}</style>"
        + "".join(units) + "</svg>\n"
    )
    atomic_bytes(path, svg.encode("utf-8"))
    return svg, {
        "source_reference": source.get("spatial_reference"),
        "native_extent": [xmin, ymin, xmax, ymax],
        "polygon_huc12_count": len(selected),
        "original_ring_points": point_count, "drawn_ring_points": rendered_count,
        "drawing_tolerance_pixels": .2,
        "coordinate_view": "Original source coordinates fitted linearly to the view; full source rings are retained.",
        "file": "watersheds.svg",
    }



def _report(path, product, network, memberships, svg=None):
    def text(value):
        return escape("" if value is None else str(value))

    def cells(values):
        return "".join("<td>" + text(value) + "</td>" for value in values)

    overview = ""
    for area in network["areas"]:
        shared = sum(key in network["shared_huc12s"] for key in area["huc12s"])
        overview += "<tr>" + cells((area["title"], area["role"].replace("_", " "),
            area["huc12_count"], shared, ", ".join(area["anchor_huc12s"]))) + "</tr>"
    detail = ""
    for row in memberships:
        detail += '<tr data-area="' + escape(row["receptor_id"], quote=True) + '">' + cells((
            row["receptor_title"], row["huc12"], row["name"],
            row["anchor_huc12"], row["links_to_anchor"], row["downstream_huc12"],
            row["tohuc_original"], row["hutype"])) + "</tr>"
    options = '<option value="">All areas</option>' + "".join(
        '<option value="' + escape(area["id"], quote=True) + '">' + text(area["title"]) + "</option>"
        for area in network["areas"])
    references = "".join("<li><strong>" + text(area["title"]) + "</strong>: "
        + text(area["reference"]["basis"]) + " "
        + ('<a href="' + escape(area["reference"]["uri"], quote=True) + '">Original selection source</a>'
           if re.match(r"^https?://", area["reference"]["uri"]) else text(area["reference"]["uri"]))
        + "</li>" for area in network["areas"])
    source = product["source_binding"]
    accounting_link = ('<p><a href="accounting/index.html">Total, incremental and utility-union accounting</a></p>'
                       if product.get("accounting") else "")
    geographic = ""
    if svg is not None:
        reference = source.get("spatial_reference") or {}
        code = reference.get("latestWkid", reference.get("wkid"))
        label = ("EPSG/source code " + str(code)) if code else json.dumps(reference, ensure_ascii=False)
        geographic = (
            '<section class="geography"><h2>Original watershed geography</h2>'
            '<div class="map-tools filters"><button type="button" data-map-action="in">Zoom in</button>'
            '<button type="button" data-map-action="out">Zoom out</button>'
            '<button type="button" data-map-action="reset">Reset view</button></div>'
            + svg + '<p class="map-key"><span class="key source"></span> Original source domain '
            '<span class="key member"></span> Contributing units '
            '<span class="key anchor"></span> Selected anchors</p>'
            '<p id="map-selection" role="status">Select a watershed to open its original HUC12 memberships. Drag to pan; use the buttons or wheel to zoom.</p>'
            '<p class="map-source">Source coordinate view: ' + text(label)
            + '. Polygon rings are drawn at screen scale; the original source retains every coordinate. '
            '<a href="watersheds.svg">Download editable vector overview</a></p></section>'
        )
    html = (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>" + text(product["title"]) + "</title><style>"
        "body{font:15px system-ui,sans-serif;color:#222;background:#fff;max-width:1420px;margin:28px auto;padding:0 24px}"
        "h1{font-size:27px}h2{font-size:20px;margin-top:28px}p,li{line-height:1.5}"
        "a{color:inherit}section{overflow:auto}table{border-collapse:collapse;width:100%;margin:14px 0;font-variant-numeric:tabular-nums}"
        "th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}"
        ".filters{display:flex;gap:20px;flex-wrap:wrap}label{display:grid;gap:5px}"
        "select,input,button{font:inherit;border:1px solid #888;color:#222;background:#fff;padding:7px;max-width:420px}"
        ".geography{margin:22px 0;border:1px solid #bbb;padding:16px}.geography h2{margin-top:0}"
        "#watersheds{display:block;width:100%;height:auto;max-height:70vh;background:#fff;touch-action:none}"
        ".map-tools{gap:8px}.map-key{display:flex;align-items:center;flex-wrap:wrap;gap:8px}"
        ".key{display:inline-block;width:18px;height:12px;border:1px solid #888}.key.source{background:#f1f1f1}"
        ".key.member{background:#bbb}.key.anchor{background:#555}.map-source{color:#555;font-size:13px}"
        "@media print{.geography{break-inside:avoid}#watersheds{max-height:105mm}}"
        "code{overflow-wrap:anywhere}tr[hidden]{display:none}footer{border-top:1px solid #999;margin-top:28px;padding-top:16px}"
        "@media print{body{font-size:9pt;margin:8mm;padding:0;max-width:none}th,td{padding:4px}tr{break-inside:avoid}.filters{display:none}}"
        "</style><body><h1>" + text(product["title"]) + "</h1>"
        "<p>" + str(network["network_huc12_count"]) + " original hydrologic units · "
        + str(network["selected_huc12_count"]) + " distinct contributing units · "
        + str(len(network["areas"])) + " selected receiving areas.</p>"
        "<p>The original downstream links identify contributing HUC12 units for each saved area. "
        "Each anchor and its upstream units appear once within that area's selection.</p>"
        '<p><a href="memberships.csv">Editable memberships</a> · <a href="areas.csv">Area selections</a> · '
        '<a href="network.csv">Original link table</a> · <a href="network.json">Complete network and selections</a> · '
        '<a href="source-profile.json">Saved source profile</a> · <a href="'
        + escape(product["source_body_filename"], quote=True) + '">Original source geometry and attributes</a></p>'
        + accounting_link + "<section><h2>Selected areas</h2><table><thead><tr><th>Area</th><th>Purpose</th><th>Contributing units</th>"
        "<th>Shared with another area</th><th>Original anchors</th></tr></thead><tbody>"
        + overview + "</tbody></table></section>"
        '<h2>Watershed explorer</h2><div class="filters"><label>Receiving area<select id="area">'
        + options + '</select></label><label>Find a HUC12 or name<input id="search" type="search" placeholder="HUC12 or watershed name"></label></div>'
        + geographic + '<h3>Original upstream memberships</h3><p id="count"></p><section><table id="members"><thead><tr><th>Area</th><th>HUC12</th><th>Original name</th>'
        "<th>Selected anchor</th><th>Links to anchor</th><th>Next link toward anchor</th><th>Original ToHUC</th><th>Source unit type</th>"
        "</tr></thead><tbody>" + detail + "</tbody></table></section>"
        "<h2>Source relationships</h2><ul>" + references + "</ul>"
        "<p>Links to anchor counts original ToHUC edges. It is a network count, not a distance. "
        "The full HUC12 units supply the planning footprint. Original terminal labels, links outside the retained source, "
        "special hydrologic-unit types and shared memberships are available in network.json. "
        "Combine overlapping areas by their union when using the later GIS and physical-output inventory.</p>"
        "<footer><p>Captured source: " + text(source["input_filename"])
        + (" · member " + text(source["zip_member"]) if source["zip_member"] else "")
        + "<br>Original body SHA-256: <code>" + text(source["body_sha256"]) + "</code>"
        + "<br>Decoded source SHA-256: <code>" + text(source["decoded_sha256"]) + "</code>"
        + "<br>Saved " + text(product["created_at"]) + " · TokenJunkieLabs</p></footer>"
        '<script>const area=document.getElementById("area"),search=document.getElementById("search");'
        'const rows=[...document.querySelectorAll("#members tbody tr")];'
        'function apply(){let count=0;const q=search.value.trim().toLowerCase();for(const row of rows){'
        'row.hidden=(area.value&&row.dataset.area!==area.value)||(q&&!row.textContent.toLowerCase().includes(q));'
        'if(!row.hidden)count++;}document.getElementById("count").textContent=count+" memberships shown";syncMap();}'
        + "\nconst svg=document.getElementById(\"watersheds\");\nconst shapes=svg?[...svg.querySelectorAll(\"path[data-huc]\")]:[];\nconst areaLists=new Map(shapes.map(path=>[path,JSON.parse(path.dataset.areas)]));\nconst anchorLists=new Map(shapes.map(path=>[path,JSON.parse(path.dataset.anchors)]));\nlet chosen=null,view=[0,0,1100,620],drag=null;\nfunction syncMap(){\n  const q=search.value.trim().toLowerCase();\n  for(const path of shapes){\n    const inArea=areaLists.get(path).some(id=>!area.value||id===area.value);\n    const anchor=anchorLists.get(path).some(id=>!area.value||id===area.value);\n    path.classList.toggle(\"member\",inArea);path.classList.toggle(\"anchor\",anchor);\n    path.classList.toggle(\"quiet\",Boolean((area.value&&!inArea)||\n      (q&&!(path.dataset.huc+\" \"+path.dataset.name).toLowerCase().includes(q))));\n    path.classList.toggle(\"chosen\",path===chosen);\n  }\n}\nfunction pick(path){\n  chosen=path;search.value=path.dataset.huc;apply();\n  document.getElementById(\"map-selection\").textContent=path.dataset.huc+\" · \"+path.dataset.name+\n    (areaLists.get(path).length?\" · Original upstream memberships are shown below.\":\" · Original source unit outside the selected receiving-area memberships.\");\n}\nfunction showView(){svg.setAttribute(\"viewBox\",view.join(\" \"));}\nfunction zoom(factor,point){\n  const before=view[2],width=Math.max(1100/32,Math.min(1100,before*factor)),ratio=width/before;\n  const centre=point||[view[0]+view[2]/2,view[1]+view[3]/2];\n  view=[centre[0]-(centre[0]-view[0])*ratio,centre[1]-(centre[1]-view[1])*ratio,width,width*620/1100];\n  showView();\n}\nif(svg){\n  for(const button of document.querySelectorAll(\"[data-map-action]\"))button.addEventListener(\"click\",()=>{\n    if(button.dataset.mapAction===\"reset\"){view=[0,0,1100,620];showView();}\n    else zoom(button.dataset.mapAction===\"in\"?1/1.5:1.5);\n  });\n  svg.addEventListener(\"keydown\",event=>{const path=event.target.closest(\"path[data-huc]\");if(path&&[\"Enter\",\" \"].includes(event.key)){event.preventDefault();pick(path);}});\n  function sourcePoint(event,transform){\n    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;\n    return point.matrixTransform(transform);\n  }\n  svg.addEventListener(\"wheel\",event=>{\n    event.preventDefault();if(drag)return;\n    const transform=svg.getScreenCTM();if(!transform)return;\n    const local=sourcePoint(event,transform.inverse());\n    zoom(event.deltaY<0?1/1.25:1.25,[local.x,local.y]);\n  },{passive:false});\n  svg.addEventListener(\"pointerdown\",event=>{\n    if(event.button!==0||drag)return;\n    const transform=svg.getScreenCTM();if(!transform)return;\n    const inverse=transform.inverse(),point=sourcePoint(event,inverse);\n    drag={id:event.pointerId,x:event.clientX,y:event.clientY,point,inverse,view:[...view],\n      path:event.target.closest(\"path[data-huc]\"),moved:false};\n    svg.setPointerCapture(event.pointerId);\n  });\n  svg.addEventListener(\"pointermove\",event=>{\n    if(!drag||event.pointerId!==drag.id)return;\n    if(Math.abs(event.clientX-drag.x)+Math.abs(event.clientY-drag.y)>4)drag.moved=true;\n    if(!drag.moved)return;\n    const point=sourcePoint(event,drag.inverse);\n    view=[drag.view[0]-(point.x-drag.point.x),drag.view[1]-(point.y-drag.point.y),drag.view[2],drag.view[3]];\n    showView();\n  });\n  svg.addEventListener(\"pointerup\",event=>{\n    if(!drag||event.pointerId!==drag.id)return;\n    const finished=drag;drag=null;\n    if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);\n    if(!finished.moved&&finished.path){pick(finished.path);finished.path.focus({preventScroll:true});}\n  });\n  for(const name of [\"pointercancel\",\"lostpointercapture\"])svg.addEventListener(name,event=>{\n    if(drag&&event.pointerId===drag.id)drag=null;\n  });\n}\n"
        + 'area.addEventListener("change",apply);search.addEventListener("input",apply);apply();</script></body></html>\n'
    )
    atomic_bytes(path, html.encode("utf-8"))


def build(source, receptor_spec, output, *, member=None, expected_decoded_sha256=None):
    """Retain original bytes, original links and all selected upstream memberships."""
    rows, binding, retained = _read_source(source, member)
    if expected_decoded_sha256 is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", expected_decoded_sha256):
            raise ValueError("Use the complete original decoded source SHA-256")
        if binding["decoded_sha256"] != expected_decoded_sha256:
            raise ValueError("The selected source body differs from the retained decoded source")
    spec = json.loads(json.dumps(receptor_spec, ensure_ascii=False, allow_nan=False))
    identity = {"schema": SCHEMA, "source_body_sha256": binding["body_sha256"],
                "receptor_spec": spec, "presentation_version": PRESENTATION_VERSION}
    key = digest(identity)
    directory = Path(output).resolve() / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".network.lock", blocking=False):
        result_path = directory / "result.json"
        if result_path.exists():
            result = read_json(result_path)
            if result["id"] != key or result["schema"] != SCHEMA:
                raise ValueError("Retained network product belongs to another source selection")
            for item in result["files"].values():
                verify_file(directory, item)
            return {**result, "directory": str(directory), "reused": True}
        network = upstream_memberships(rows, spec["receptors"],
            huc12_field=spec.get("huc12_field"), tohuc_field=spec.get("tohuc_field"),
            name_field=spec.get("name_field"), type_field=spec.get("type_field"))
        network["source_binding"] = binding
        source_name = "source-domain.esri.json.gz" if retained[:2] == b"\x1f\x8b" else "source-domain.esri.json"
        atomic_bytes(directory / source_name, retained, immutable=True)
        atomic_json(directory / "source-profile.json", spec, immutable=True)
        atomic_json(directory / "network.json", network, immutable=True)
        original = {row["huc12"]: row for row in network["network"]}
        memberships = []
        for area in network["areas"]:
            for row in area["memberships"]:
                source_row = original[row["huc12"]]
                memberships.append({"receptor_id": area["id"], "receptor_title": area["title"],
                    **row, **{field: source_row[field] for field in
                              ("name", "tohuc_original", "hutype", "source_feature_id")}})
        _csv(directory / "memberships.csv",
             ("receptor_id", "receptor_title", "huc12", "name", "anchor_huc12",
              "links_to_anchor", "downstream_huc12", "is_anchor", "tohuc_original",
              "hutype", "source_feature_id"), memberships)
        _csv(directory / "areas.csv",
             ("id", "title", "role", "huc12_count", "anchor_huc12s", "huc12s"),
             [{**area, "anchor_huc12s": ";".join(area["anchor_huc12s"]),
               "huc12s": ";".join(area["huc12s"])} for area in network["areas"]])
        _csv(directory / "network.csv",
             ("huc12", "source_feature_id", "tohuc_original", "tohuc12", "name", "hutype"),
             network["network"])
        result = {"schema": SCHEMA, "id": key, "title": spec.get("title", "Upstream watershed memberships"),
            "created_at": now(), "source_binding": binding, "source_body_filename": source_name,
            "identity": identity, "network_huc12_count": network["network_huc12_count"],
            "selected_huc12_count": network["selected_huc12_count"],
            "areas": [{k: v for k, v in area.items() if k != "memberships"} for area in network["areas"]],
            "shared_huc12s": network["shared_huc12s"], "membership_rows": len(memberships), "files": {}}
        svg, geography = _geography(directory / "watersheds.svg", rows, network, binding)
        if geography is not None:
            result["geography"] = geography
            result["files"]["geography"] = describe_file(directory, directory / "watersheds.svg")
        accounting = receptor_accounting.write_product(directory / "accounting", network,
            parent_network_id=key, source_binding=binding, svg=svg)
        result["accounting"] = {"schema": accounting["schema"], "method": accounting["method"],
            "anchor_count": accounting["anchor_count"],
            "union_huc12_count": accounting["union_huc12_count"],
            "repeated_source_area_ha": accounting["repeated_source_area_ha"]}
        for item in sorted((directory / "accounting").iterdir()):
            if item.is_file():
                result["files"]["accounting_" + item.name] = describe_file(directory, item)
        _report(directory / "index.html", result, network, memberships, svg=svg)
        for name, filename in (("source_body", source_name), ("profile", "source-profile.json"),
                               ("network", "network.json"), ("memberships", "memberships.csv"),
                               ("areas", "areas.csv"), ("original_links", "network.csv"),
                               ("report", "index.html")):
            result["files"][name] = describe_file(directory, directory / filename)
        atomic_json(result_path, result, immutable=True)
        return {**result, "directory": str(directory), "reused": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Retained domain ZIP, GZIP or original Esri JSON")
    parser.add_argument("--profile", required=True, help="Original receptor specification JSON")
    parser.add_argument("--output", required=True, help="Directory receiving the complete retained source inventory")
    parser.add_argument("--member", help="Exact domain JSON ZIP member if the archive contains multiple domains")
    parser.add_argument("--expected-decoded-sha256", help="Optional original decoded source identity")
    args = parser.parse_args(argv)
    try:
        result = build(args.source, read_json(Path(args.profile)), args.output,
                       member=args.member, expected_decoded_sha256=args.expected_decoded_sha256)
        print(json.dumps({key: result[key] for key in
            ("id", "title", "directory", "network_huc12_count", "selected_huc12_count",
             "membership_rows", "areas", "shared_huc12s", "source_binding", "files", "reused")},
            ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
