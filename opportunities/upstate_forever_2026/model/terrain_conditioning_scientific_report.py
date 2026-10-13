"""Scientific terrain sensitivity reports from original retained native rows."""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import json
import math
from model.common import atomic_bytes, atomic_json, describe_file
from model import scientific_report, scientific_figures, native_versions

def show(value):
    if value is None:
        return "Unavailable"
    if isinstance(value, (float, int)):
        if not math.isfinite(value):
            raise ValueError("Retain finite original terrain report quantities")
        return format(value, ".9g")
    return str(value)

def table(columns, rows, caption):
    return {"kind": "table", "columns": columns, "rows": rows, "caption": caption}

def _figure(root, name, figure):
    from reportlab.graphics import renderSVG
    scientific_figures._validate_figure(figure)
    drawings = scientific_figures.panel_drawings(figure, 560)
    if len(drawings) != 1:
        raise ValueError("Retain one terrain quantity per native response figure")
    payload = renderSVG.drawToString(drawings[0])
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    atomic_bytes(root / name, payload, immutable=True)
    return {"kind": "figure", **describe_file(root, root / name),
            "title": figure["title"], "alt": figure["title"] + ". " + figure["caption"],
            "caption": figure["caption"], "spec": figure}

def _source_sections(root, sections):
    copied, figures, choices = [], [], []
    for heading, blocks in sections:
        source_blocks = []
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "figure":
                figure = deepcopy(block["spec"])
                figure["id"] = Path(block["path"]).stem
                figures.append(figure)
                choices.append({"id": figure["id"], "path": block["path"]})
                source_blocks.extend([block["caption"], {"kind": "links", "items": [
                    {"title": block["title"], "path": block["path"]}]}])
            else:
                source_blocks.append(deepcopy(block))
        copied.append([heading, source_blocks])
    if not figures:
        return copied, {}
    name = "scientific-figures.json"
    atomic_json(root / name, {"schema": "upstate.scientific-figure-spec/v1", "figures": figures}, immutable=True)
    return copied, {"figure_spec": name, "figures": choices}

def _guides(binding):
    result, seen = [], set()
    for models in binding["native_versions"].get("runs", {}).values():
        for model, version in models.items():
            uri = native_versions.guide_url(model, version)
            if uri and uri not in seen:
                seen.add(uri)
                result.append([model.upper() + " " + native_versions.version_label(version),
                               scientific_report.link("Original producing-version model guide", uri)])
    method = binding["case"].get("method")
    if method:
        result.append(["Retained terrain conditioning method", scientific_report.link("Original method reference", method)])
    return result

def write(directory, record, original, case, copied):
    root = Path(directory)
    binding = record["binding"]
    source_case = case["case"]
    source_records = [{"id": s["collection_id"] + "/" + s["entry"]["id"],
                       "source_id": s["entry"]["id"], "title": s["entry"].get("title", s["entry"]["id"]),
                       "uri": s["entry"].get("uri", ""), "vintage": s["entry"].get("vintage", "")}
                      for s in binding["original_source_records"]]
    classification = binding.get("source_classification")
    classification_text = show(classification) if classification is not None else "Read the retained original input source record"
    sections = [["Scientific purpose and original source scope", [
        record["reason"], "Original input classification: " + classification_text + ".",
        "This report preserves completed native terrain-input sensitivity on the original fixed lattice. "
        "Land cover, original scenario, parameter profile, non-DEM inputs and native model identity remain those of the retained comparison. "
        "Interpret each changed elevation edition as a conditional model response. A favorable modeled change alone does not establish improved empirical accuracy.",
        table(["Original identity", "Retained value"], [
            ["Project", binding["project_id"]], ["Terrain case", binding["case_id"]],
            ["Native response", binding["response_id"]], ["Original baseline run", binding["baseline_run_id"]],
            ["DEM source", source_case["dem"].get("source_title") or source_case["dem"]["source_id"]],
            ["Original DEM units", "metres"], ["Original lattice columns", source_case["grid"]["width"]],
            ["Original lattice rows", source_case["grid"]["height"]],
            ["Outlet policy", source_case["nodata_boundary"]],
            ["Stream corridor half-width, metres", show(source_case["corridor_half_width_m"])]],
            "Original source classification and complete native provenance accompany every figure")]]]
    sources = []
    for item in binding["original_source_records"]:
        entry = item["entry"]
        sources.append([entry.get("title", entry["id"]), entry.get("role", entry.get("kind", "")),
                        entry.get("classification") or entry.get("data_classification") or entry.get("notes") or "See complete source metadata",
                        entry.get("uri", ""), entry.get("vintage", "")])
    sections.append(["Elevation and hydrography provenance", [
        table(["Original source", "Role", "Classification / notes", "Original URI", "Edition"], sources,
              "Inputs retain their original source labels, including model-derived or simulated provenance"),
        "The selected line source and its original feature filter determine stream-burning support. "
        "The original implementation rasterizes selected linework with all_touched. A source line or stream-cell count "
        "therefore need not equal the count of changed DEM cells.",
        "Entered burn depth is a conditioning choice in metres. Spill-level filling follows that change, so final local "
        "elevation differences need not equal the requested depth. Geometric fill volume describes elevation adjustment; "
        "it does not measure water storage. Local lower/equal-neighbour diagnostics describe cell adjacency, not routed connectivity.",
        {"kind": "links", "items": [{"title": "Complete original DEM, line source and native source metadata", "path": "input-binding.json"},
                                   {"title": "Complete original terrain case and edition statistics", "path": "original-terrain-case.json"}]}]])
    variants = case.get("variants", [])
    variant_rows = []
    for i, variant in enumerate(variants, 1):
        stats = variant["statistics"]
        variant_rows.append([i, variant["name"], show(variant["burn_depth_m"]), show(stats["changed_cells"]),
                             show(stats["changed_area_ha"]), show(stats["maximum_raise_m"]),
                             show(stats["maximum_lower_m"]), show(stats["fill_volume_m3"])])
    for offset in range(0, len(variant_rows), 14):
        sections.append(["Retained terrain editions", [
            table(["Index", "Terrain edition", "Entered depth m", "Changed cells", "Changed ha",
                   "Maximum raise m", "Maximum lower m", "Geometric fill m³"],
                  variant_rows[offset:offset+14], "Area and final elevation diagnostics are copied from the original case")]])
    quantities = list(binding["quantity_support"])
    for metric in quantities:
        rows = [r for r in original["rows"] if r["metric"] == metric]
        units = binding["quantity_support"][metric]["units"]
        for offset in range(0, len(rows), 12):
            chosen = rows[offset:offset+12]
            sections.append([metric.replace("_", " ").capitalize() + " — identical native support", [
                "Every alternative below uses the intersection of valid output cells across the original baseline and ALL "
                "changed alternatives in this saved response, separately for this quantity. Positive change increases modeled "
                "annual export; negative change decreases it. These totals use the original normalized pixel-mass outputs once.",
                table(["Index", "Terrain edition", "Baseline", "Alternative", "Alternative − baseline",
                       "Change %", "Annual mass units", "Common ha"],
                      [[offset+i+1, r["variant"], show(r["baseline_joint_total"]), show(r["alternative_joint_total"]),
                        show(r["change_joint_total"]), show(r["change_percent"]), r["units"],
                        show(r["joint_area_ha"])] for i, r in enumerate(chosen)],
                      "Signed changes retain the original direction and common mask; different pollutants retain distinct annual units")]])
            values = [r["change_joint_total"] for r in chosen]
            lo, hi = min([0.0, *values]), max([0.0, *values])
            margin = (hi-lo)*.12 if hi>lo else 1.0
            title = metric.replace("_", " ").capitalize() + ": retained terrain sensitivity"
            caption = ("Original completed native alternatives in display order, all on identical valid cells for this quantity. "
                       "The points are deterministic model cases. Positive values mean increased stream-delivery export. "
                       "No interpolated response or uncertainty interval is supplied.")
            figure = {"id": "terrain-response-" + metric + "-" + str(offset//12+1),
                "title": title, "caption": caption, "panels": [{
                    "title": "Alternative minus original baseline",
                    "x": {"domain": [offset+.4, offset+len(chosen)+.6], "label": "Terrain edition index",
                          "ticks": [{"value": offset+i+1, "label": str(offset+i+1)} for i in range(len(chosen))]},
                    "y": {"domain": [lo-margin, hi+margin], "label": "Change in annual modeled export", "unit": units,
                          "ticks": [{"value": v, "label": show(v)} for v in sorted(set([lo, 0.0, hi]))]},
                    "series": [{"geometry": "scatter", "label": "Retained native change",
                                "points": [{"x": offset+i+1, "y": r["change_joint_total"]} for i, r in enumerate(chosen)]}],
                    "reference_lines": [{"axis": "y", "value": 0.0, "label": "No modeled export change"}]}]}
            sections.append(["Native terrain response figure", [_figure(root, figure["id"]+".svg", figure)]])
        support_rows = [[r["variant"], show(r["joint_valid_cells"]), show(r["joint_area_ha"]),
                         show(r["baseline_valid_cells"]), show(r["alternative_valid_cells"]),
                         show(r["lost_valid_cells"]), show(r["gained_valid_cells"])] for r in rows]
        raw_rows = [[r["variant"], show(r["baseline_native_total"]), show(r["alternative_native_total"]), r["units"]] for r in rows]
        for offset in range(0, len(rows), 14):
            sections.append([metric.replace("_", " ").capitalize() + " — original output coverage", [
                table(["Terrain edition", "All-alternative common cells", "Common ha", "Valid baseline",
                       "Valid alternative", "Lost versus baseline", "Gained versus baseline"],
                      support_rows[offset:offset+14], "Lost and gained counts compare each alternative with baseline; they are distinct from the all-alternative intersection"),
                table(["Terrain edition", "Original full-support baseline", "Original full-support alternative", "Annual mass units"],
                      raw_rows[offset:offset+14], "These retained original totals can have different valid support. Their subtraction is not the reported common-support effect.")]])
    copied_paths = {m["path"] for m in copied}
    map_links = []
    for row in original["rows"]:
        path = "response/" + row["difference"]
        if path not in copied_paths:
            raise ValueError("The report lost an original native difference map")
        folder = str(Path(path).parent)
        items = [{"title": row["variant"]+" / "+row["metric"]+" — full native difference GeoTIFF", "path": path}]
        for filename, label in (("change.png", "Original grayscale display"), ("preview.json", "Original legend and display sampling")):
            member = folder + "/" + filename
            if member in copied_paths:
                items.append({"title": row["variant"]+" / "+row["metric"]+" — "+label, "path": member})
        map_links.extend(items)
    for offset in range(0, len(map_links), 15):
        sections.append(["Original native difference maps", [
            "Map values retain the original per-pixel annual mass unit. Their common mask matches the corresponding "
            "table quantity. PNGs retain the original display stride and legend; exact analytical values remain in the GeoTIFF.",
            {"kind": "links", "items": map_links[offset:offset+15]}]])
    mask_links = [{"title": Path(p).name, "path": p} for p in sorted(copied_paths) if p.endswith("-joint-support.tif")]
    sections.append(["Scientific interpretation and complete native record", [
        original["interpretation"],
        "Read nutrient and sediment responses together. A decrease in one quantity can accompany an increase in another. "
        "No composite ranking or optimal terrain setting is inferred from these outputs.",
        "An unchanged terrain edition reuses its exact original baseline where the original case records that equivalence. "
        "Retained baseline-reuse editions: " + ", ".join(original.get("baseline_reuse", [])) + ".",
        {"kind": "links", "items": [
            {"title": "Exact native response table", "path": "response/native-response.csv"},
            {"title": "Complete original native response, native runs and output descriptors", "path": "original-native-response.json"},
            {"title": "Original scientific source binding", "path": "input-binding.json"},
            {"title": "Retained terrain scientific report PDF", "path": "report.pdf"},
            {"title": "Structured report data", "path": "report-data.json"}, *mask_links]}]])
    guides = _guides(binding)
    if guides:
        sections.append(["Original methods and native units", [
            table(["Retained method", "Primary reference"], guides,
                  "Native guide editions follow the actual producing-version provenance retained in the original response")]])
    footer = "TokenJunkieLabs scientific engineering · Original source classifications, model versions and scientist interpretation retained."
    scientific_report.write_companions(root, record["title"], sections, contact={}, source_records=source_records,
        binding={"report_source_id": record["id"], "response_id": original["id"], "input_binding": binding},
        subtitle="Completed original terrain-input sensitivity on retained common native support.", footer=footer)
    scientific_report.report_pdf(root / "report.pdf", record["title"], sections, contact={}, source_records=source_records, footer=footer)
    return _source_sections(root, sections)
