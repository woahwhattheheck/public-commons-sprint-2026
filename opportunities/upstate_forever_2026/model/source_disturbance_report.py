"""Readable report over exact retained source masks and original native comparisons."""
from html import escape
import json


def render_html(result):
    def e(value):
        return escape(str(value))
    def number(value):
        return format(value, ".12g") if isinstance(value, (int, float)) else e(value)
    def table(headers, rows):
        return '<div class="table"><table><thead><tr>' + "".join("<th>" + e(x) + "</th>" for x in headers) + \
            "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(v) + "</td>" for v in row) + "</tr>" for row in rows) + \
            "</tbody></table></div>"
    sections = ['<header><p>TokenJunkie Labs · Original scientific workspace</p><h1>' + e(result["title"]) +
                '</h1><p>Source-selected development and protection scenarios</p></header>',
                '<section><h2>Scientific question</h2><p>' + e(result["selection"]["purpose"]) + '</p>',
                '<p>This is a conditional land-cover scenario. Its selected polygons and coefficient profiles are explicit assumptions. It is not a development forecast or an observed causal effect.</p>',
                '<p>Ordinary production remains on its retained 30 m grid; this report uses the exact saved grid identified below, with no diagnostic resampling presented as a model run.</p>',
                table(["Project", "Study", "Grid", "Completed"],
                      [[result["project_id"], result["study_id"], result["grid"]["id"], result["completed_at"]]]),
                '<h3>Source references</h3><ul>' + "".join("<li>" + e(x) + "</li>" for x in result["selection"]["references"]) + "</ul></section>"]
    sections.append("<section><h2>Original source selections and policy</h2>")
    for case in result["selection"]["cases"]:
        sections.append("<h3>" + e(case["label"]) + "</h3><p>" + e(case["reason"]) + "</p>")
        for number_index, patch in enumerate(case["patches"], 1):
            sections.append("<h4>Patch " + str(number_index) + ": " + e(patch["label"]) + "</h4><p>" + e(patch["reason"]) + "</p>")
            sections.append(table(["Policy", "Original classes", "Destination", "Collection", "Source", "Layer", "Original feature IDs"],
                [[patch["policy"], ", ".join(map(str, patch["from_codes"])), patch["to_code"],
                  patch["source"]["source_collection_id"], patch["source"]["source_id"],
                  patch["source"].get("layer") or "Original sole layer", ", ".join(patch["source"]["feature_ids"])]]))
            if patch["protections"]:
                sections.append(table(["Protection collection", "Source", "Layer", "Original feature IDs"],
                    [[x["source_collection_id"], x["source_id"], x.get("layer") or "Original sole layer",
                      ", ".join(x["feature_ids"])] for x in patch["protections"]]))
    sections.append("</section><section><h2>Exact native input areas</h2><p>Polygon area, selected cell area and actually changed cell area are separate. Protection exclusions apply to original cell centres. Excluded baseline-eligible counts use baseline classes; ordered eligibility and final ownership are retained in each original footprint.</p>")
    for case in result["footprints"]:
        sections.append("<h3>" + e(case["label"]) + "</h3>")
        sections.append(table(["Patch", "Selected polygon ha", "Selected valid cells", "Excluded valid cells",
                              "Excluded baseline-eligible cells", "Effective valid cells", "Native cell ha"],
            [[x["label"], number(x["selected_polygon_hectares"]), x["selected_valid_cells"], x["excluded_valid_cells"],
              x["excluded_baseline_eligible_cells"], x["effective_valid_cells"], number(x["grid_cell_hectares"])]
             for x in case["patches"]]))
        for patch in case["patches"]:
            stem = patch["mask_stem"]
            sections.append('<figure><img alt="' + e(patch["label"]) + ' effective native cell mask" src="masks/' +
                            e(stem) + '-effective.png"><figcaption>' + e(patch["label"]) +
                            " — display of the retained effective mask. Area totals use every original grid cell, not display pixels.</figcaption></figure>")
        for native in case["native"]:
            report = native["report"]
            sections.append("<h4>Original profile " + e(native["profile_id"]) + "</h4>")
            sections.append(table(["From code", "To code", "Cells", "Hectares"],
                [[x["from_code"], x["to_code"], x["cells"], number(x["hectares"])] for x in report["transitions"]]))
            sections.append("<details><summary>Complete original categorical footprint</summary><pre>" +
                            e(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)) + "</pre></details>")
    sections.append("</section><section><h2>Original annual export differences</h2><p>Each number is the maintained native comparison's alternative minus its matching baseline. Profiles are unchanged. Each pollutant uses its own pairwise valid support; a zero difference is distinct from absent support. Per-cell native mass is summed once, without a second hectare multiplier. Differences across pollutants or different supports are not a combined score.</p>")
    sections.append(table(["Case", "Pollutant", "Annual unit", "Alternative − baseline", "Valid cells", "Valid hectares", "Original baseline", "Original run"],
        [[x["label"], x["artifact"], x["units"], number(x["sum_change"]) if x["valid_cells"] else "Unavailable — no shared valid cells",
          x["valid_cells"], number(x["valid_hectares"]), x["baseline_run_id"], x["run_id"]] for x in result["measurement_rows"]]))
    sections.append("</section><section><h2>Original source editions</h2>")
    for source in result["original_sources"].values():
        entry = source["entry"]
        sections.append(table(["Title", "Original URI", "Vintage", "Original source SHA256"],
                              [[entry["title"], entry["uri"], entry["vintage"], entry["body"]["sha256"]]]))
    sections.append("<h2>Retained semantics and limitations</h2>" + "".join("<p><strong>" + e(k) + ".</strong> " + e(v) + "</p>" for k, v in result["semantics"].items()))
    sections.append('<p>Download the complete report ZIP to keep all figures, GIS masks, original source files, native output rasters, coefficient tables, JSON and full-precision CSVs together. The original Workspace backup retains editable scientific state and application source. This report retains completed original native model outputs.</p></section>')
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + \
        e(result["title"]) + '</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#222222;background:#f5f5f5}header,section{max-width:1100px;margin:20px auto;padding:24px;background:white;border:1px solid #cccccc}h1{font-size:2rem}h2{font-size:1.5rem}h3{border-bottom:1px solid #cccccc;padding-bottom:8px}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border:1px solid #cccccc;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere}.table{overflow:auto}th{background:#eeeeee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}img{max-width:100%;height:auto;image-rendering:pixelated}figure{margin:20px 0}figcaption{font-size:.85rem;color:#555555}a{color:#333333}@media(max-width:600px){header,section{padding:16px;margin:10px}h1{font-size:1.6rem}}@media print{body{background:white}header,section{border:0;margin:0;padding:12px}table{font-size:9pt}details{display:none}figure{break-inside:avoid}}</style><body>' + "".join(sections) + "</body></html>\n"
