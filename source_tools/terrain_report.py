"""Portable monochrome terrain inspector built only from retained numeric data."""
from __future__ import annotations

import base64
import csv
import io
import json
import math
import os
from pathlib import Path
from html import escape
from urllib.parse import quote

from .terrain_io import atomic_bytes, atomic_json, relative_path


def write_report(root: Path, selection, plan_id, entry, coverage, selected):
    import numpy as np
    import rasterio
    from PIL import Image
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    root = Path(root).resolve()
    folder = root / "prepared" / plan_id / "inspector"
    folder.mkdir(parents=True, exist_ok=True)
    grid = selection["grid"]
    with rasterio.open(relative_path(root, entry["path"])) as source:
        ratio = min(1.0, 720/source.width, 520/source.height)
        width, height = max(1, round(source.width*ratio)), max(1, round(source.height*ratio))
        data = source.read(1, out_shape=(height, width), resampling=Resampling.nearest, masked=True)
        raw = np.ma.getdata(data)
        missing = np.ma.getmaskarray(data) | ~np.isfinite(raw)
        low, high = coverage["statistics"]["grid"]["minimum_m"], coverage["statistics"]["grid"]["maximum_m"]
        image = np.full((height, width), 245, dtype="uint8")
        if low is not None:
            normalized = (raw.astype("float64")-low)/(high-low) if high > low else np.full(raw.shape, 0.5)
            image[~missing] = np.clip(35 + normalized[~missing]*185, 35, 220).astype("uint8")
        png = io.BytesIO()
        Image.fromarray(image).save(png, format="PNG")
        atomic_bytes(folder/"preview.png", png.getvalue(), immutable=True)
        # Coordinates refer to the actual nearest sample, not to an invented interpolation.
        cols = np.minimum(source.width-1, np.floor((np.arange(width)+0.5)*source.width/width).astype(int))
        rows = np.minimum(source.height-1, np.floor((np.arange(height)+0.5)*source.height/height).astype(int))
        values = raw.astype(object)
        values[missing] = None
        preview = {"schema": "upstate.terrain-preview/v1", "plan_id": plan_id,
                   "width": width, "height": height, "source_columns": cols.tolist(),
                   "source_rows": rows.tolist(), "values_m": values.tolist(), "grid": grid,
                   "sampling": "Nearest original prepared DEM pixel; this preview is not a model input",
                   "elevation_minimum_m": low, "elevation_maximum_m": high,
                   "nodata_gray": 245, "valid_gray_range": [35, 220]}
        atomic_json(folder/"preview-data.json", preview, immutable=True)
    rows = []
    features = []
    for position, item in enumerate(selected):
        info = item["raster"]
        rows.append({"order": position+1, "source_id": item["id"], "label": item["label"],
                     "vintage": item["vintage"], "origin": item["uri"],
                     "vertical_datum": item["vertical_datum"], "vertical_units": item["vertical_units"],
                     "factor_to_metres": item["vertical_factor_to_m"],
                     "scale": info["scale"], "offset": info["offset"],
                     "width": info["width"], "height": info["height"], "crs": info["crs_name"],
                     "raster_sha256": item["raster_sha256"], "xml_sha256": item["metadata_sha256"],
                     "raster_path": item["files"][0]["path"], "metadata_path": item["files"][1]["path"]})
        left, bottom, right, top = info["bounds_wgs84"]
        features.append({"type": "Feature", "properties": {"source_id": item["id"],
                        "geometry_meaning": "Densified source-raster bounding rectangle; not a valid-data polygon"},
                        "geometry": {"type": "Polygon", "coordinates": [[[left,bottom],[right,bottom],
                                     [right,top],[left,top],[left,bottom]]]}})
    table = io.StringIO(newline="")
    writer = csv.DictWriter(table, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    atomic_bytes(folder/"sources.csv", table.getvalue().encode("utf-8"), immutable=True)
    atomic_json(folder/"source-footprints.geojson", {"type":"FeatureCollection", "features":features}, immutable=True)
    results = {"schema":"upstate.terrain-inspector/v1", "plan_id":plan_id, "title":selection["title"],
               "dem": {key:entry[key] for key in ("path","sha256","bytes","units","vertical_datum")},
               "coverage":coverage, "sources":rows, "preparation":selection,
               "preview":{"path":"preview.png","data":"preview-data.json","width":width,"height":height}}
    atomic_json(folder/"terrain-results.json", results, immutable=True)

    def link(path):
        return quote(os.path.relpath(root/path, folder).replace(os.sep, "/"), safe="/")
    def fmt(value, precision=3):
        return "—" if value is None else f"{value:,.{precision}f}"
    def stats(label, value):
        return f'<tr><th>{escape(label)}</th><td>{value["cells"]:,}</td><td>{value["valid_cells"]:,}</td><td>{value["nodata_cells"]:,}</td><td>{fmt(None if value["valid_fraction"] is None else 100*value["valid_fraction"],4)}%</td><td>{fmt(value["minimum_m"])}</td><td>{fmt(value["maximum_m"])}</td><td>{fmt(value["mean_m"])}</td></tr>'
    source_rows = "".join(f'<tr><td>{row["order"]}</td><td><strong>{escape(row["label"])}</strong><br><code>{escape(row["source_id"])}</code></td><td>{escape(str(row["vintage"]))}</td><td>{escape(row["vertical_datum"])}</td><td>{escape(row["vertical_units"])} × {row["factor_to_metres"]:.12g}</td><td><a href="{link(row["raster_path"])}">Original TIFF</a> · <a href="{link(row["metadata_path"])}">XML</a><br><a href="{escape(row["origin"],quote=True)}">Publisher</a></td></tr>' for row in rows)
    domain_label = "Selected domain, unique pixel centres" if selection["domain"] else "Whole target grid (no separate polygon selection)"
    status = ("All selected-domain pixel centres have elevation" if coverage["domain_complete"]
              else "The selected domain extends outside the computational grid" if not coverage["domain_within_grid"]
              else "Selected-domain elevation gaps are present" if coverage["statistics"]["domain"]["cells"]
              else "No selected-domain pixel centres occur on this grid")
    payload = json.dumps(preview, separators=(",", ":"), allow_nan=False).replace("<","\\u003c").replace("&","\\u0026")
    html = f'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(selection["title"])} — terrain inspector</title>
<style> :root{{color-scheme:light}}*{{box-sizing:border-box}}body{{margin:0;font:15px/1.5 system-ui,sans-serif;color:#222;background:#f5f5f5}}header,main,footer{{max-width:1180px;margin:auto;padding:24px}}header{{border-bottom:1px solid #aaa}}h1{{font-size:25px;margin:5px 0}}h2{{font-size:19px}}p{{max-width:88ch}}.eyebrow,dt{{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#555}}section{{background:white;border:1px solid #bbb;padding:20px;margin-bottom:20px}}a{{color:#111;text-decoration:underline;text-underline-offset:3px}}code{{overflow-wrap:anywhere;font-size:12px}}.scroll{{overflow:auto}}table{{border-collapse:collapse;width:100%;min-width:740px;font-size:13px}}td,th{{text-align:left;padding:10px 8px;border-bottom:1px solid #ddd;vertical-align:top}}th{{font-weight:600}}.map{{display:block;max-width:100%;width:auto;height:auto;image-rendering:pixelated;border:1px solid #aaa}}.readout{{font-family:monospace;min-height:48px;padding:10px;background:#eee}}dl{{display:grid;grid-template-columns:180px 1fr;gap:6px 18px}}dd{{margin:0;overflow-wrap:anywhere}}.legend{{height:12px;background:linear-gradient(to right,#232323,#dcdcdc);max-width:480px;margin:8px 0}}.links{{display:flex;gap:18px;flex-wrap:wrap}}@media(max-width:700px){{header,main,footer{{padding:14px}}section{{padding:14px}}dl{{grid-template-columns:1fr}}}}</style>
<header><div class="eyebrow">Upper Savannah • Source preparation</div><h1>{escape(selection["title"])}</h1><p>Retained static terrain, original source editions, and the exact computational grid.</p><code>Plan {plan_id}</code></header>
<main><section><h2>{escape(status)}</h2><p>Elevations are in <strong>metres</strong>, referenced to <strong>{escape(entry["vertical_datum"])}</strong>. Coverage below inspects every prepared cell. The computational DEM retains its full rectangle; the selected polygon changes coverage reporting, not the elevation surface.</p><p><strong>{coverage["statistics"]["domain"]["valid_cells"]:,} of {coverage["statistics"]["domain"]["cells"]:,} selected-domain cell centres have elevation; {coverage["statistics"]["domain"]["nodata_cells"]:,} are NoData.</strong> Tables scroll horizontally on narrow screens.</p><div class="scroll"><table><thead><tr><th>Coverage selection</th><th>Cells</th><th>Valid</th><th>NoData</th><th>Coverage</th><th>Min, m</th><th>Max, m</th><th>Mean, m</th></tr></thead><tbody>{stats("Full computational grid",coverage["statistics"]["grid"])}{stats(domain_label,coverage["statistics"]["domain"])}</tbody></table></div></section>
<section><h2>Elevation preview</h2><p>The preview samples {width} × {height} pixels from the full {grid["width"]:,} × {grid["height"]:,} DEM. Point at the preview to inspect an actual sampled cell. Very light grey means NoData; dark to light grey represents increasing elevation.</p><img class="map" id="terrain" src="data:image/png;base64,{base64.b64encode(png.getvalue()).decode("ascii")}" alt="Monochrome prepared terrain elevation with NoData distinguished"><div class="legend"></div><div>{fmt(low)} m → {fmt(high)} m</div><div class="readout" id="readout" aria-live="polite">Point at the elevation preview.</div><noscript><p>Interactive inspection requires JavaScript; all numeric preview cells are also in preview-data.json.</p></noscript></section>
<section><h2>Grid and method</h2><dl><dt>Domain outside grid</dt><dd>{fmt(coverage["outside_grid_area_ha"],6)} hectares of original vector area</dd><dt>Coordinate system</dt><dd>{escape(grid["crs_name"])}</dd><dt>Pixel size</dt><dd>30 × 30 metres; 0.09 hectares per pixel</dd><dt>Affine transform</dt><dd><code>{escape(str(grid["transform"]))}</code></dd><dt>Native overlap</dt><dd>{escape(selection["native_overlap"])}</dd><dt>Resampling</dt><dd>{escape(selection["resampling"])}; native mosaic followed by one horizontal reprojection</dd><dt>Vertical operation</dt><dd>{escape(selection["vertical_operation"])}</dd><dt>Hydrology</dt><dd>{escape(selection["hydrologic_conditioning"])}</dd><dt>Numeric data</dt><dd>Float32, explicit NoData; legitimate zero and negative elevations remain valid.</dd></dl></section>
<section><h2>Retained source editions</h2><div class="scroll"><table><thead><tr><th>Order</th><th>Source</th><th>Edition</th><th>Datum</th><th>Unit conversion</th><th>Open original</th></tr></thead><tbody>{source_rows}</tbody></table></div><p>Source footprints are raster bounding rectangles, not surveyed basin boundaries or valid-data masks. Full acquisition metadata, original XML, and source identities travel with this project.</p></section>
<section><h2>Open and reuse</h2><div class="links"><a href="{link(entry["path"])}">Prepared DEM</a><a href="{link('sources-'+plan_id+'.json')}">Workspace source manifest</a><a href="terrain-results.json">Complete result</a><a href="sources.csv">Source inventory</a><a href="source-footprints.geojson">Source footprints</a><a href="preview-data.json">Preview values</a></div><p>Import the retained source manifest through the existing Upper Savannah workspace. The original source identifiers and all companions are preserved. The preview is for inspection; the full prepared GeoTIFF is the numeric model input.</p></section></main>
<footer><code>DEM SHA-256 {entry["sha256"]}</code></footer>
<script id="preview-data" type="application/json">{payload}</script><script>
const d=JSON.parse(document.getElementById('preview-data').textContent), image=document.getElementById('terrain'), out=document.getElementById('readout');
image.addEventListener('pointermove',e=>{{const r=image.getBoundingClientRect(),c=Math.min(d.width-1,Math.max(0,Math.floor((e.clientX-r.left)/r.width*d.width))),j=Math.min(d.height-1,Math.max(0,Math.floor((e.clientY-r.top)/r.height*d.height))),col=d.source_columns[c],row=d.source_rows[j],t=d.grid.transform,v=d.values_m[j][c];out.textContent=`DEM column ${{col}}, row ${{row}} · x ${{(t[0]*(col+.5)+t[2]).toFixed(2)}}, y ${{(t[4]*(row+.5)+t[5]).toFixed(2)}} · ${{v===null?'NoData':v.toFixed(3)+' m'}}`;}});
</script></html>'''
    atomic_bytes(folder/"report.html", html.encode("utf-8"), immutable=True)
    return [folder/name for name in ("report.html","preview.png","preview-data.json","sources.csv",
                                     "source-footprints.geojson","terrain-results.json")]
