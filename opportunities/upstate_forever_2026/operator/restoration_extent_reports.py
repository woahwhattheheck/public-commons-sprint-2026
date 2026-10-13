"""Readable output for an existing immutable native restoration response."""
from __future__ import annotations
from html import escape
import json
import math

def text(value):
    return "Not defined" if value is None else str(value)

def table(rows, columns):
    return ('<div class="scroll"><table><thead><tr>' +
            ''.join('<th>'+escape(label)+'</th>' for _, label in columns) +
            '</tr></thead><tbody>' +
            ''.join('<tr>'+''.join('<td>'+escape(text(row.get(key)))+'</td>'
                                  for key, _ in columns)+'</tr>' for row in rows) +
            '</tbody></table></div>')

def plots(rows):
    groups = {}
    for row in rows:
        groups.setdefault((row["pollutant"], row["units"]), []).append(row)
    output = []
    for (pollutant, units), group in groups.items():
        usable = [r for r in group if type(r["export_reduction"]) in (int, float)
                  and math.isfinite(r["export_reduction"])]
        title = pollutant.replace("_", " ")+" — "+units
        if not usable:
            output.append('<section><h3>'+escape(title)+'</h3><p>No common valid native support. Original null values remain in the complete tables.</p></section>')
            continue
        xmax=max(r["changed_area_ha"] for r in usable) or 1
        ymin=min(0, min(r["export_reduction"] for r in usable))
        ymax=max(0, max(r["export_reduction"] for r in usable))
        if ymax == ymin: ymax=ymin+1
        x=lambda v: 70+650*v/xmax
        y=lambda v: 300-250*(v-ymin)/(ymax-ymin)
        svg=['<svg viewBox="0 0 800 370" role="img" aria-label="'+escape(title,quote=True)+'"><rect width="800" height="370" fill="white"/><path d="M70 40V300H720" fill="none" stroke="#222"/><path d="M70 '+str(y(0))+'H720" stroke="#999" stroke-dasharray="3 4"/>']
        for i in range(6):
            value=xmax*i/5
            svg.append('<text x="'+str(x(value))+'" y="322" text-anchor="middle">'+escape(format(value,'.5g'))+'</text>')
            v=ymin+(ymax-ymin)*i/5
            svg.append('<text x="60" y="'+str(y(v)+4)+'" text-anchor="end">'+escape(format(v,'.5g'))+'</text>')
        placements={}
        for row in group:
            placements.setdefault(row["placement_id"],[]).append(row)
        labels=[]
        for index,(placement, points) in enumerate(placements.items()):
            points=sorted(points,key=lambda r:r["width_m"])
            dash=['','8 4','2 4','10 3 2 3'][index%4]
            parts=[]
            for row in points:
                if row["export_reduction"] is None:
                    if parts:
                        svg.append('<polyline points="'+' '.join(parts)+'" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="'+dash+'"/>')
                        parts=[]
                    continue
                px,py=x(row["changed_area_ha"]),y(row["export_reduction"])
                parts.append(str(px)+','+str(py))
                tooltip=placement+'; width each side '+text(row["width_m"])+' m; '+text(row["changed_area_ha"])+' changed ha; signed export reduction '+text(row["export_reduction"])+' '+units
                svg.append('<circle cx="'+str(px)+'" cy="'+str(py)+'" r="4" fill="white" stroke="#111"><title>'+escape(tooltip)+'</title></circle>')
                svg.append('<text x="'+str(px+6)+'" y="'+str(py-6)+'" font-size="11">'+str(index+1)+'</text>')
            if parts:
                svg.append('<polyline points="'+' '.join(parts)+'" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="'+dash+'"/>')
            labels.append(str(index+1)+': '+points[0].get("placement_title",placement))
        svg.append('<text x="395" y="352" text-anchor="middle">Actual changed hectares</text><text x="70" y="22">Signed annual export reduction ('+escape(units)+')</text></svg>')
        output.append('<section><h3>'+escape(title)+'</h3>'+''.join(svg)+'<p>'+escape(' · '.join(labels))+'</p></section>')
    return ''.join(output)

def html_document(study, report):
    spec=study["spec"]
    rows=report["curves"]
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        '<title>'+escape(study["title"])+' — restoration response</title><style>'+
        'body{font:16px/1.5 system-ui,sans-serif;color:#18222a;background:#f2f3f4;margin:0;padding:24px}main{max-width:1280px;margin:auto}h1{font-size:2rem}section{background:white;color:#18222a;padding:22px;margin:20px 0;border:1px solid #b7bec5}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #bcc3c9;padding:8px;text-align:left;vertical-align:top}th{background:#e9ecef}.scroll{overflow:auto}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}dt{font-weight:bold}dd{margin:0 0 14px}svg{width:100%;height:auto;max-height:500px;font:13px system-ui}small{color:#46535e}@media(max-width:600px){body{padding:10px}section{padding:12px}h1{font-size:1.5rem}}@media print{body{background:white;padding:0}.scroll{overflow:visible}section{break-inside:avoid}table{font-size:9px}}'+
        '</style><main><p>TokenJunkieLabs · Native restoration response</p><h1>'+escape(study["title"])+'</h1><p>'+escape(spec["reason"])+'</p>'+
        '<p>Study <code>'+escape(study["id"])+'</code><br>Report <code>'+escape(report["id"])+'</code><br>Original common-support analysis <code>'+escape(report["analysis_id"])+'</code></p>'+
        '<section><h2>Selected native source</h2><dl><dt>Original baseline run</dt><dd><code>'+escape(spec["baseline_run_id"])+'</code></dd>'+
        '<dt>Retained stream source</dt><dd><code>'+escape(spec["stream_source"]["source_collection_id"])+' / '+escape(spec["stream_source"]["source_id"])+'</code></dd>'+
        '<dt>Clipping scope</dt><dd>'+escape(spec["scope"])+'</dd><dt>Land-cover change</dt><dd>'+escape(', '.join(map(str,spec["from_codes"])))+' → '+escape(str(spec["to_code"]))+'</dd></dl>'+
        '<p>Buffer distances are metres on each side of the selected stream lines. Lines in the following plots connect discrete native scenarios; they are not a fitted response model or an inferred optimum.</p></section>'+
        '<section><h2>Native response by actual changed area</h2>'+plots(rows)+'</section>'+
        '<section><h2>All selected scenarios and support</h2>'+table(rows,[
        ("placement_title","Placement"),("pollutant","Pollutant"),("width_m","Width each side (m)"),("changed_area_ha","Changed ha"),("corridor_area_ha","Corridor ha"),
        ("native_export","Native export"),("export_reduction","Signed reduction"),("units","Units"),
        ("percent_reduction","Reduction %"),("reduction_per_changed_ha","Reduction / changed ha"),
        ("common_valid_cells","Common cells"),("common_area_ha","Common ha"),("common_coverage_fraction","Common coverage fraction"),
        ("status","Status"),("run_id","Prepared run"),("execute_run_id","Effective native run")])+'</section>'+
        '<section><h2>Marginal response between adjacent widths</h2>'+table(report["marginals"],[
        ("placement_id","Placement"),("pollutant","Pollutant"),("from_width_m","From width (m)"),("to_width_m","To width (m)"),
        ("additional_changed_area_ha","Additional changed ha"),("additional_export_reduction","Additional signed reduction"),
        ("marginal_reduction_per_ha","Marginal reduction / ha"),("units","Units"),("nested","Nested"),("status","Status")])+'</section>'+
        '<section><h2>Interpretation</h2><dl>'+''.join('<dt>'+escape(k.replace('_',' ').capitalize())+'</dt><dd>'+escape(v)+'</dd>'
        for k,v in report["interpretation"].items())+'</dl></section>'+
        '<section><h2>Exact selected definition</h2><pre>'+escape(json.dumps(spec,ensure_ascii=False,indent=2))+'</pre></section>'+
        '<section><h2>Complete original response</h2><details><summary>Show complete retained report, source identities and file hashes</summary><pre>'+
        escape(json.dumps(report,ensure_ascii=False,indent=2))+'</pre></details></section></main></html>')
