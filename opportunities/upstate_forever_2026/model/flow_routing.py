"""Source-bound downstream routing explanations, saved in the original Workspace."""
from __future__ import annotations

from copy import deepcopy
import base64
import csv
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import zipfile

from . import routing_paths
from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, now, read_json, verify_file)
from .flow_routing_source import retained_source, OriginalRasterReader
from .verified_files import verified_operation

ROOT = "flow-routing"
SCHEMA = "upstate.flow-routing-report/v1"
SELECTION_SCHEMA = "upstate.flow-routing-selection/v1"
FILES = ("trace.json", "originals.json", "source-cells.json", "routing_paths.py",
         "cells.csv", "edges.csv", "terminals.csv", "routes.geojson",
         "route.svg", "terrain-preview.png", "index.html")
TERMINALS = {
    "stream": "First native stream or selected drainage cell",
    "outside_extent": "Leaves the retained raster extent",
    "terrain_nodata": "Reaches missing native terrain support",
    "stream_unknown": "Native stream status is unavailable",
    "direction_missing": "Native direction is unavailable on valid terrain",
}


def selection(value):
    if not isinstance(value, dict):
        raise ValueError("Select a retained run, native model and source cell")
    allowed = {"schema", "run_id", "model", "row", "column", "stop_at_stream", "title", "notes"}
    if set(value) - allowed:
        raise ValueError("The routing selection has unknown fields")
    if value.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Open a supported native routing selection")
    result = {"schema": SELECTION_SCHEMA, "run_id": identifier(value.get("run_id")),
              "model": value.get("model"), "row": value.get("row"),
              "column": value.get("column"), "stop_at_stream": value.get("stop_at_stream", True),
              "title": value.get("title", ""), "notes": value.get("notes", "")}
    if result["model"] not in ("ndr", "sdr"):
        raise ValueError("Select NDR or SDR from the original run")
    for name in ("row", "column"):
        if type(result[name]) is not int or result[name] < 0:
            raise ValueError("Select a zero-based integer native " + name)
    if type(result["stop_at_stream"]) is not bool:
        raise ValueError("Choose an explicit first-stream stopping option")
    if not isinstance(result["title"], str) or not result["title"].strip() or len(result["title"]) > 240:
        raise ValueError("Name the routing explanation in at most 240 characters")
    if not isinstance(result["notes"], str) or len(result["notes"]) > 16000:
        raise ValueError("Keep the complete interpretation note within 16000 characters")
    result["title"] = result["title"].strip()
    return result


def _kernel():
    path = Path(routing_paths.__file__)
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "path": path}


def _binding(workspace, chosen, source, kernel_sha):
    return {"schema": "upstate.flow-routing-binding/v1", "project_id": workspace.project["id"],
            "selection": chosen, "native_source_id": source["id"],
            "routing_kernel_sha256": kernel_sha}


def _csv(rows, fields):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        output = {}
        for key in fields:
            value = row.get(key)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True)
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            output[key] = value
        writer.writerow(output)
    return stream.getvalue().encode("utf-8-sig")


def route_svg(trace):
    cells = trace["cells"]
    rows, columns = [r["row"] for r in cells], [r["column"] for r in cells]
    left, top = min(columns)-1, min(rows)-1
    width, height = max(columns)-left+2, max(rows)-top+2
    stroke = max(width, height) / 900
    lines = []
    for edge in trace["edges"]:
        lines.append('<path d="M %s %s L %s %s" fill="none" stroke="#444" stroke-width="%s" />' % (
            edge["from_column"]+.5, edge["from_row"]+.5, edge["to_column"]+.5, edge["to_row"]+.5,
            stroke * (.6 + 2 * math.sqrt(max(0, edge["routed_share"])))))
    radius = max(width, height) / 110
    for cell in trace["terminals"]:
        fill = "#333" if cell["terminal"] == "stream" else "#fff"
        lines.append('<circle cx="%s" cy="%s" r="%s" fill="%s" stroke="#222" stroke-width="%s"><title>%s</title></circle>' % (
            cell["column"]+.5, cell["row"]+.5, radius, fill, stroke,
            html.escape(TERMINALS[cell["terminal"]] + " · share " + format(cell["routed_share"], ".8g"))))
    origin = trace["origin"]
    lines.append('<rect x="%s" y="%s" width="%s" height="%s" fill="#fff" stroke="#111" stroke-width="%s"><title>Selected original source cell</title></rect>' % (
        origin["column"]+.5-radius, origin["row"]+.5-radius, radius*2, radius*2, stroke*1.5))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" role="img" aria-label="Complete native routing graph in original raster-cell coordinates"><rect x="%s" y="%s" width="%s" height="%s" fill="#f5f5f5"/>%s</svg>' %
            (left, top, width, height, left, top, width, height, "".join(lines))).encode()


def _geojson(trace, geometry):
    from pyproj import Transformer
    transformer = Transformer.from_crs(geometry["crs_wkt"], "EPSG:4326", always_xy=True)
    features = []
    for edge in trace["edges"]:
        a = transformer.transform(edge["from_x"], edge["from_y"], errcheck=True)
        b = transformer.transform(edge["to_x"], edge["to_y"], errcheck=True)
        if not all(math.isfinite(v) for v in (*a, *b)):
            raise ValueError("An original route cannot be represented in WGS84")
        features.append({"type": "Feature",
                         "geometry": {"type": "LineString", "coordinates": [list(a), list(b)]},
                         "properties": deepcopy(edge)})
    return {"type": "FeatureCollection",
            "name": "Original native downstream routing",
            "native_crs": geometry["crs_wkt"], "native_affine": geometry["affine"],
            "coordinate_note": "GeoJSON geometry is WGS84 longitude/latitude; original native coordinates remain in every edge property.",
            "features": features}


def _html(document):
    trace, geo = document["trace"], document["geometry"]
    esc = html.escape
    data = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")).replace("<", "\\u003c")
    distance = geo["distance"]
    factor = distance.get("to_metres")
    distance_label = ("%.3f m" % (trace["mean_terminal_distance_native_units"] * factor)
                      if factor is not None else
                      "%.6g original coordinate units" % trace["mean_terminal_distance_native_units"])
    terminal_rows = "".join("<tr><th>%s</th><td>%.8g</td></tr>" %
                            (esc(TERMINALS[k]), v) for k, v in sorted(trace["terminal_shares"].items()))
    svg = route_svg(trace).decode()
    return ("""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + esc(document["selection"]["title"]) + """</title><style>
:root{color-scheme:light;background:#f2f2f2;color:#171717;font:15px/1.5 system-ui,sans-serif}body{margin:0}main{max-width:1120px;margin:auto;padding:24px}h1{font-size:26px}h2{font-size:19px;margin-top:28px}section{background:#fff;border:1px solid #bbb;padding:18px;margin:18px 0}button,input,select{font:inherit;color:#171717;background:#fff;border:1px solid #777;padding:7px}button{cursor:pointer}button:disabled{opacity:.5}table{border-collapse:collapse;min-width:600px;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:8px;overflow-wrap:anywhere}th{background:#eee;color:#171717}.scroll{overflow:auto}svg{display:block;width:100%;max-height:540px;border:1px solid #aaa}.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{display:block;color:#444}@media(max-width:600px){main{padding:12px}section{padding:10px}h1{font-size:22px}}
</style><main><h1>""" + esc(document["selection"]["title"]) + """</h1>
<p>Source-bound explanation of an existing native routing graph. No model was rerun to create this report.</p>
<section><h2>Selected source and interpretation</h2><p>""" + esc(document["selection"]["model"].upper()) + " · " +
            esc(trace["algorithm"].upper()) + " · " + esc(geo["crs_label"]) +
            "</p><p>Original zero-based row " + str(trace["origin"]["row"]) + ", column " + str(trace["origin"]["column"]) +
            ". " + ("Stop at first native stream." if trace["stop_at_stream"] else "Follow native routing through stream cells.") +
            "</p><p>" + esc(document["selection"]["notes"]) + "</p><p>Original run: <code>" +
            esc(document["selection"]["run_id"]) + "</code></p><p>Raster: " + str(geo["width"]) + " columns × " +
            str(geo["height"]) + " rows. Routed graph: " + str(trace["reachable_cells"]) + " cells and " +
            str(trace["edge_count"]) + " edges.</p></section><section><h2>Where the routed share ends</h2><p>One dimensionless unit is followed through every positive native branch. A stream terminal is first arrival at the retained stream or drainage mask. Missing data and raster edges remain separate outcomes.</p><div class=\"scroll\"><table><thead><tr><th>Terminal interpretation</th><th>Share of original unit</th></tr></thead><tbody>" +
            terminal_rows + "</tbody></table></div><p>Share-weighted mean graph distance: " + esc(distance_label) +
            ". This is pixel-centre route length, not travel time.</p><p>Accounting residual: " + format(trace["accounting_residual"], ".8g") +
            "; underflowed edges: " + str(trace["numerical_underflow_edges"]) +
            ".</p></section><section><h2>Complete routing graph</h2>" + svg +
            "<p>Square: selected cell. Filled circles: first native stream arrival. Open circles: unresolved support or extent boundary. Line width depicts dimensionless routed share; every retained edge is present. Axes follow original raster rows and columns.</p></section>" +
            """<section><h2>Original cells, branches and terminal records</h2><div class="bar"><label>Records <select id="kind"><option value="cells">Cells</option><option value="edges">Branches</option><option value="terminals">Terminals</option></select></label><label>Find <input id="find" type="search" placeholder="Row, column or terminal"></label><button id="prev">Previous</button><button id="next">Next</button><span id="count" role="status"></span></div><div class="scroll" id="rows"></div></section>
<section><h2>Scientific meaning and original source</h2><ul>""" +
            "".join("<li>"+esc(note)+"</li>" for note in trace["notes"]) +
            "</ul><p>Distances use original native CRS coordinates. Elevations retain the original terrain raster units, including an unavailable unit declaration. A path alone does not establish observed catchment membership, pollutant attenuation, discharge, concentration, travel time or utility-intake connectivity.</p>" +
            "<details><summary>Complete original binding and geometry</summary><pre id=\"source\"></pre></details></section>" +
            """<script type="application/json" id="document">""" + data + """</script><script>
const d=JSON.parse(document.getElementById('document').textContent);let page=0;
const el=id=>document.getElementById(id),e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function show(){const kind=el('kind').value,term=el('find').value.trim().toLowerCase(),all=d.trace[kind],rows=term?all.filter(r=>JSON.stringify(r).toLowerCase().includes(term)):all;page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));const shown=rows.slice(page*50,page*50+50),keys=shown.length?Object.keys(shown[0]):[];el('rows').innerHTML=shown.length?'<table><thead><tr>'+keys.map(k=>'<th>'+e(k.replaceAll('_',' '))+'</th>').join('')+'</tr></thead><tbody>'+shown.map(r=>'<tr>'+keys.map(k=>'<td>'+e(r[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p>No records match.</p>';el('count').textContent=rows.length+' records · page '+(page+1)+' of '+Math.max(1,Math.ceil(rows.length/50));el('prev').disabled=!page;el('next').disabled=(page+1)*50>=rows.length;}
el('kind').onchange=el('find').oninput=()=>{page=0;show()};el('prev').onclick=()=>{page--;show()};el('next').onclick=()=>{page++;show()};el('source').textContent=JSON.stringify({binding:d.binding,geometry:d.geometry},null,2);show();
</script></main></html>""").encode()


def _read_saved(workspace, directory):
    project_id = workspace.project['id']
    record = read_json(directory / "report.json")
    if record.get("schema") != SCHEMA or record.get("id") != directory.name or record.get("project_id") != project_id:
        raise ValueError("Open this original route in its selected Workspace or restored copy")
    files = record.get("files") or {}
    if set(files) != set(FILES) | {"MANIFEST.json", "routing.zip"}:
        raise ValueError("The saved routing report has an incomplete file inventory")
    for name, item in files.items():
        if item.get("path") != name:
            raise ValueError("A routing member no longer matches its original filename")
        verify_file(directory, item)
    originals = read_json(directory / "originals.json")
    document = read_json(directory / "trace.json")
    cells = read_json(directory / "source-cells.json")
    if (document.get("schema") != SCHEMA or document.get("id") != record["id"]
            or document.get("project_id") != project_id
            or document.get("captured_at") != originals.get("captured_at")
            or record.get("captured_at") != originals.get("captured_at")
            or record.get("source_id") != originals.get("source", {}).get("id")
            or record.get("title") != record["selection"]["title"]
            or digest(originals["binding"]) != record["id"] or originals["binding"]["project_id"] != project_id
            or document["binding"] != originals["binding"]
            or record["selection"] != originals["binding"]["selection"]
            or document["selection"] != record["selection"]
            or document["geometry"] != originals["geometry"]
            or document["source_id"] != originals["source"]["id"]):
        raise ValueError("The routing report differs from its original native source binding")
    source = deepcopy(originals["source"])
    source_id = source.pop("id")
    if digest(source) != source_id or source_id != originals["binding"]["native_source_id"]:
        raise ValueError("The original native routing source changed")
    if hashlib.sha256((directory / "routing_paths.py").read_bytes()).hexdigest() != originals["binding"]["routing_kernel_sha256"]:
        raise ValueError("The retained routing kernel differs from its selected source")
    if digest(cells) != originals["source_cells_sha256"] or digest(document["trace"]) != originals["trace_sha256"]:
        raise ValueError("Original cell or route accounting changed")
    if record["summary"] != {k: deepcopy(document["trace"][k]) for k in
            ("algorithm", "reachable_cells", "edge_count", "terminal_shares",
             "accounting_residual", "numerical_underflow_edges", "mean_terminal_distance_native_units")}:
        raise ValueError("The saved route summary differs from its complete report")
    lookup = {}
    for row in cells:
        key = (row["row"], row["column"])
        if key in lookup:
            raise ValueError("Original source cells contain a duplicate")
        lookup[key] = row["value"]
    chosen = record["selection"]
    actual_source = retained_source(workspace, chosen["run_id"], chosen["model"])
    if actual_source != originals["source"]:
        raise ValueError("The original native routing source no longer matches the saved explanation")
    with OriginalRasterReader(workspace, actual_source) as reader:
        if reader.geometry != document["geometry"]:
            raise ValueError("The original native raster geometry changed")
        if originals["binding"]["routing_kernel_sha256"] == _kernel()["sha256"]:
            replay = routing_paths.trace_paths(reader.read, reader.width, reader.height,
                source["algorithm"], (chosen["row"], chosen["column"]), reader.affine,
                stop_at_stream=chosen["stop_at_stream"])
            if replay != document["trace"] or reader.observed != lookup:
                raise ValueError("The routing result differs from the complete original raster cells")
        else:
            # Preserve historical source without executing archived Python.
            for (row, column), expected in lookup.items():
                if reader.read(row, column) != expected:
                    raise ValueError("A captured historical routing cell differs from its original raster")

    manifest = read_json(directory / "MANIFEST.json")
    expected = {name: item for name,item in files.items() if name not in ("MANIFEST.json","routing.zip")}
    if manifest != {"schema":"upstate.flow-routing-files/v1","id":record["id"],"members":expected}:
        raise ValueError("The original route manifest changed")
    with zipfile.ZipFile(directory / "routing.zip") as archive:
        members = {k:v for k,v in files.items() if k!="routing.zip"}
        if len(archive.infolist()) != len(members) or set(archive.namelist()) != set(members):
            raise ValueError("The complete routing ZIP has missing or duplicate members")
        for name,item in members.items():
            if archive.getinfo(name).file_size != item["bytes"]:
                raise ValueError("A route ZIP member changed length")
            checksum = hashlib.sha256()
            with archive.open(name) as stream:
                for part in iter(lambda: stream.read(1024*1024), b""):
                    checksum.update(part)
            if checksum.hexdigest() != item["sha256"]:
                raise ValueError("A route ZIP member changed")
    return record, document


@verified_operation
def inspect(workspace, key):
    return _read_saved(workspace, workspace.root / ROOT / identifier(key))


@verified_operation
def build(workspace, chosen, expected_source_id):
    chosen = selection(chosen)
    expected_source_id = identifier(expected_source_id)
    # Backup and publication share the original Workspace lock. The task uses
    # the existing serial operator queue and never invokes a scientific solver.
    with held(workspace.root / ".workspace.lock", blocking=False):
        source = retained_source(workspace, chosen["run_id"], chosen["model"])
        if source["id"] != expected_source_id:
            raise ValueError("The original native source changed after opening; inspect it again")
        kernel = _kernel()
        kernel_body = kernel["path"].read_bytes()
        if hashlib.sha256(kernel_body).hexdigest() != kernel["sha256"]:
            raise ValueError("Routing implementation changed while opening the source")
        binding = _binding(workspace, chosen, source, kernel["sha256"])
        key = digest(binding)
        directory = workspace.root / ROOT / key
        directory.mkdir(parents=True, exist_ok=True)
        if (directory / "report.json").exists():
            return inspect(workspace, key)[0]
        with OriginalRasterReader(workspace, source) as reader:
            if not (chosen["row"] < reader.height and chosen["column"] < reader.width):
                raise ValueError("Choose a source cell inside the original native raster")
            if not reader.read(chosen["row"], chosen["column"])["terrain_valid"]:
                raise ValueError("Choose a source point on valid original native terrain")
            trace = routing_paths.trace_paths(reader.read, reader.width, reader.height,
                source["algorithm"],(chosen["row"],chosen["column"]),reader.affine,
                stop_at_stream=chosen["stop_at_stream"])
            cells = [{"row":r,"column":c,"value":reader.observed[(r,c)]}
                     for r,c in sorted(reader.observed)]
            geometry = deepcopy(reader.geometry)
            overview = reader.overview_png()
        # Retained original files are rechecked after the full read.
        if retained_source(workspace, chosen["run_id"], chosen["model"]) != source:
            raise ValueError("A native routing source changed during explanation")
        original_path = directory / "originals.json"
        if original_path.exists():
            original = read_json(original_path)
            captured_at = original["captured_at"]
        else:
            captured_at = now()
        originals = {"schema":"upstate.flow-routing-originals/v1","binding":binding,
                     "source":source,"geometry":geometry,"captured_at":captured_at,
                     "source_cells_sha256":digest(cells),"trace_sha256":digest(trace)}
        document = {"schema":SCHEMA,"id":key,"project_id":workspace.project["id"],
                    "binding":binding,"source_id":source["id"],"selection":chosen,
                    "captured_at":captured_at,"geometry":geometry,"trace":trace}
        # This is the first immutable member: every later retry reuses its
        # original timestamp, even when the first trace write was interrupted.
        atomic_json(original_path, originals, immutable=True)
        bodies = {"originals.json":canonical(originals)+b"\n",
                  "trace.json":canonical(document)+b"\n",
                  "source-cells.json":canonical(cells)+b"\n",
                  "routing_paths.py":kernel_body,
                  "route.svg":route_svg(trace),
                  "terrain-preview.png":base64.b64decode(overview["data_base64"]),
                  "routes.geojson":canonical(_geojson(trace,geometry))+b"\n",
                  "index.html":_html(document)}
        for family in ("cells","edges","terminals"):
            rows = trace[family]
            fields = list(rows[0]) if rows else ["row","column"]
            bodies[family+".csv"] = _csv(rows,fields)
        files = {}
        for name,body in bodies.items():
            atomic_bytes(directory/name,body,immutable=True)
            files[name] = describe_file(directory,directory/name)
        manifest = {"schema":"upstate.flow-routing-files/v1","id":key,"members":deepcopy(files)}
        atomic_json(directory/"MANIFEST.json",manifest,immutable=True)
        files["MANIFEST.json"] = describe_file(directory,directory/"MANIFEST.json")
        target,pending = directory/"routing.zip",directory/".routing.zip.pending"
        if not target.exists():
            try:
                with zipfile.ZipFile(pending,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                    for name,item in sorted(files.items()):
                        path = verify_file(directory,item)
                        info = zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        with path.open("rb") as incoming,archive.open(info,"w",force_zip64=True) as out:
                            for block in iter(lambda:incoming.read(1024*1024),b""):
                                out.write(block)
                with pending.open("rb") as completed:
                    os.fsync(completed.fileno())
                os.replace(pending,target)
            finally:
                pending.unlink(missing_ok=True)
        files["routing.zip"] = describe_file(directory,target)
        record = {"schema":SCHEMA,"id":key,"project_id":workspace.project["id"],
                  "title":chosen["title"],"selection":chosen,"captured_at":captured_at,
                  "source_id":source["id"],
                  "summary":{k:deepcopy(trace[k]) for k in
                    ("algorithm","reachable_cells","edge_count","terminal_shares",
                     "accounting_residual","numerical_underflow_edges","mean_terminal_distance_native_units")},
                  "files":files}
        atomic_json(directory/"report.json",record,immutable=True)
        return inspect(workspace,key)[0]


def catalog(workspace):
    rows = []
    for path in sorted((workspace.root/ROOT).glob("*/report.json")):
        value = read_json(path)
        if value.get("schema") != SCHEMA or value.get("id") != path.parent.name or value.get("project_id") != workspace.project["id"]:
            raise ValueError("The saved routing catalogue belongs to another source")
        rows.append({k:deepcopy(value[k]) for k in ("id","title","selection","captured_at","source_id","summary")})
    return sorted(rows,key=lambda v:(v["captured_at"],v["id"]),reverse=True)


def verify_all(workspace):
    count = 0
    for path in sorted((workspace.root/ROOT).glob("*/report.json")):
        inspect(workspace,path.parent.name)
        count += 1
    return {"flow_routing_reports":count}
