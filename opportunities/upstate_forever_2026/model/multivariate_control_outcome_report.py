"""Readable original reports and map previews for retained control outcomes."""
from __future__ import annotations

from copy import deepcopy
import csv
import html
import json
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file
from . import scientific_report, scientific_figures, native_versions

LINKS = ("outcomes.csv", "partitions.csv", "placements.csv", "placement-overlaps.csv",
         "assessment.json", "selection.json", "input-binding.json", "report.pdf", "report.md", "report-data.json")


def _flat(value, prefix=""):
    result = {}
    for key, item in value.items():
        name = prefix + key
        if isinstance(item, dict):
            result.update(_flat(item, name + "."))
        elif isinstance(item, list):
            result[name] = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        else:
            result[name] = item
    return result


def _csv(path, rows):
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields or ["no_rows"])
        writer.writeheader()
        writer.writerows(rows)


def _show(value):
    return "Unavailable" if value is None else format(value, ".7g") if isinstance(value, (float, int)) else str(value)


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns, "rows": rows, "caption": caption}


def _figure(directory, name, spec, title, caption):
    from reportlab.graphics import renderSVG
    drawings = scientific_figures.panel_drawings(spec, 560)
    if len(drawings) != 1:
        raise ValueError("Outcome figure pages retain exactly one original panel")
    payload = renderSVG.drawToString(drawings[0])
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    atomic_bytes(Path(directory) / name, payload, immutable=True)
    return {"kind": "figure", **describe_file(directory, Path(directory) / name),
            "title": title, "alt": title + ". " + caption, "caption": caption, "spec": spec}


def _map_preview(directory, item, maximum, grid):
    """Bounded nearest-neighbour DISPLAY only; full Float64 GeoTIFF is authoritative."""
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    directory = Path(directory)
    with rasterio.open(directory / item["path"]) as source:
        scale = max(source.width, source.height) / 128
        width = min(source.width, max(1, round(source.width / max(1, scale))))
        height = min(source.height, max(1, round(source.height / max(1, scale))))
        values = source.read(1, out_shape=(height, width), masked=True, resampling=Resampling.nearest)
        raw = np.ma.getdata(values)
        valid = ~np.ma.getmaskarray(values) & np.isfinite(raw)
        extent = list(source.bounds)
    sample = {"schema": "upstate.native-outcome-map-preview/v1", "original": item["file"],
        "design_id": item["design_id"], "pollutant": item["pollutant"], "units": item["units"],
        "support_mode": item["support_mode"], "support_definition": item["support_definition"],
        "run_ids": item["run_ids"], "crs": grid["crs"], "bounds": extent,
        "width": width, "height": height, "resampling": "nearest neighbour for display only",
        "legend_maximum": maximum,
        "values": [[float(raw[y, x]) if valid[y, x] else None for x in range(width)] for y in range(height)]}
    name = item["path"].removesuffix(".tif")
    atomic_json(directory / (name + ".preview.json"), sample, immutable=True)
    e = lambda text: html.escape(str(text), quote=True)
    plot_w = 640
    plot_h = max(1, round(plot_w * (extent[3] - extent[1]) / (extent[2] - extent[0])))
    cell_w, cell_h = plot_w / width, plot_h / height
    title = "Placement " + str(item["design_index"]) + " · " + item["pollutant"].replace("_", " ")
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ' + str(plot_h + 180) + '" role="img">',
        "<title>" + e(title) + "</title><desc>Control minus restoration; group-common finite support. "
        "A nearest-neighbour display sample may omit small features; full original GeoTIFF retained.</desc>",
        '<rect width="720" height="' + str(plot_h + 180) + '" fill="white"/>',
        '<text x="40" y="25" font-family="sans-serif" font-size="17" fill="#17212b">' + e(title) + "</text>",
        '<text x="40" y="49" font-family="sans-serif" font-size="12">Control minus restoration · ' + e(item["units"]) + "</text>",
        '<rect x="40" y="64" width="640" height="' + str(plot_h) + '" fill="#e5e7eb"/>']
    limit = maximum if maximum > 0 else 1.0
    for y in range(height):
        for x in range(width):
            if not valid[y, x]:
                continue
            fraction = min(1.0, abs(float(raw[y, x])) / limit)
            low, high = ((178, 35, 35), (255, 255, 255)) if raw[y, x] < 0 else ((20, 100, 140), (255, 255, 255))
            colour = "#" + "".join(format(round(high[i] + fraction * (low[i] - high[i])), "02x") for i in range(3))
            parts.append('<rect x="' + format(40 + x * cell_w, ".3f") + '" y="' + format(64 + y * cell_h, ".3f") +
                         '" width="' + format(cell_w + .02, ".3f") + '" height="' + format(cell_h + .02, ".3f") +
                         '" fill="' + colour + '"/>')
    y = plot_h + 89
    for x, colour, label in [(40, "#b22323", "Negative: restoration exports more"),
                             (330, "#14648c", "Positive: restoration exports less")]:
        parts += ['<rect x="' + str(x) + '" y="' + str(y-11) + '" width="12" height="12" fill="' + colour + '"/>',
            '<text x="' + str(x+18) + '" y="' + str(y) + '" font-family="sans-serif" font-size="11">' + label + "</text>"]
    parts += ['<text x="40" y="' + str(y+22) + '" font-family="sans-serif" font-size="11">Shared legend ±' + e(_show(maximum)) + '; gray = NoData. Grid north is up.</text>',
        '<text x="40" y="' + str(y+43) + '" font-family="sans-serif" font-size="11">Display sample only; original grid, bounds, CRS and full pixels are retained.</text>',
        '<text x="40" y="' + str(y+65) + '" font-family="sans-serif" font-size="10">TokenJunkieLabs · Original source/model quantities; scientist interpretation retained.</text></svg>']
    atomic_bytes(directory / (name + ".svg"), "".join(parts).encode("utf-8"), immutable=True)
    return {**item, "preview": describe_file(directory, directory / (name + ".svg")),
            "preview_data": describe_file(directory, directory / (name + ".preview.json"))}



def guide_links(binding):
    result, seen = [], set()
    for models in binding["native_execution"]["runs"].values():
        for model, info in models.items():
            url = native_versions.guide_url(model, info)
            if url and url not in seen:
                seen.add(url)
                result.append({"title": model.upper() + " methods and units · " +
                               native_versions.version_label(info), "url": url})
    return result


def source_sections(directory, sections):
    """Use the maintained observed-source figure companion contract."""
    result, figures, choices = [], [], []
    for heading, blocks in sections:
        copied = []
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "figure":
                key = Path(block["path"]).stem
                figure = {**deepcopy(block["spec"]), "id": key, "title": block["title"],
                          "caption": block["caption"]}
                scientific_figures._validate_figure(figure)
                figures.append(figure)
                choices.append({"id": key, "path": block["path"]})
                copied += [block["caption"], {"kind": "links", "items": [
                    {"title": block["title"], "path": block["path"]}]}]
            else:
                copied.append(deepcopy(block))
        result.append([heading, copied])
    if not figures:
        return result, {}
    name = "scientific-figures.json"
    atomic_json(Path(directory) / name,
                {"schema": "upstate.scientific-figure-spec/v1", "figures": figures}, immutable=True)
    return result, {"figure_spec": name, "figures": choices}


def write(directory, assessment, notes):
    root = Path(directory)
    selected, binding = assessment["selection"], assessment["binding"]
    outcomes, partitions = [], []
    for region in assessment["regions"]:
        for pollutant, result in region["siting_contrasts"].items():
            prefix = {"design_id": region["design_id"], "title": region["title"],
                      "support_mode": region["support_mode"], "support_definition": region["support_definition"],
                      "quantity_scope": region["quantity_scope"], "pollutant": pollutant,
                      "run_ids": json.dumps(region["run_ids"], separators=(",", ":"))}
            outcomes.append({**prefix, **_flat(result)})
            for role, alternative in result["alternatives"].items():
                for partition, value in alternative["source_cell_partitions"].items():
                    partitions.append({**prefix, "scenario": role, "partition": partition, **value})
    _csv(root / "outcomes.csv", outcomes)
    _csv(root / "partitions.csv", partitions)
    _csv(root / "placements.csv", [_flat(v) for v in assessment["placements"]])
    _csv(root / "placement-overlaps.csv", assessment["placement_overlaps"])
    primary = [r for r in assessment["regions"] if r["support_mode"] == "group_common"]
    per_design = {r["design_id"]: r for r in assessment["regions"] if r["support_mode"] == "per_design"}
    by_id = {p["design_id"]: p for p in assessment["placements"]}
    blocks = [["Scientific question and retained cohort", [
        selected["reason"], *notes,
        _table(["Retained choice", "Value"], [
            ["Outcome edition", assessment["id"]], ["Quantity scope", selected["quantity_scope"]],
            ["Explicit saved designs", len(assessment["placements"])],
            ["Distinct categorical placements", assessment["summary"]["distinct_placements"]],
            ["Duplicate placements", assessment["summary"]["duplicate_placements"]],
            ["Original restoration changed ha", _show(assessment["summary"]["restoration_changed_hectares"])],
            ["Baseline", binding["baseline_run_id"]], ["Restoration", binding["restoration_run_id"]]],
            "All original native cases and design selections remain unchanged")]]]
    placement_rows = [[p["index"], p["title"], p["design_id"], _show(p["changed_hectares"]),
                       p["same_placement_as"] or "Distinct in this selection", p["placement_sha256"]]
                      for p in assessment["placements"]]
    for offset in range(0, len(placement_rows), 12):
        blocks.append(["Explicit control placements", [_table(
            ["Index", "Saved design", "Design identity", "Changed ha", "Placement duplication", "Exact spatial hash"],
            placement_rows[offset:offset+12], "Display order is the authored selection, not a ranking")]])
    for pollutant in selected["pollutants"]:
        rows, coverage = [], []
        for region in primary:
            p = by_id[region["design_id"]]
            value = region["siting_contrasts"][pollutant]
            own = per_design[region["design_id"]]["siting_contrasts"][pollutant]
            rows.append([p["index"], p["title"], _show(value["mass"]["baseline"]), _show(value["mass"]["restoration"]),
                _show(value["mass"]["control"]), _show(value["alternatives"]["restoration"]["avoided_export_mass"]),
                _show(value["alternatives"]["control"]["avoided_export_mass"]), _show(value["restoration_advantage_mass"])])
            coverage.append([p["index"], *[value["original_run_valid_cells"][role] for role in ("baseline", "restoration", "control")],
                own["native_common_cells"], value["native_common_cells"],
                own["native_common_cells"] - value["native_common_cells"],
                value["mass_unavailable_reason"] or "Available"])
        units = primary[0]["siting_contrasts"][pollutant]["units"]
        for offset in range(0, len(rows), 12):
            blocks.append([pollutant.replace("_", " ").capitalize() + " · common selected-roster support", [
                "All quantities on this page use the same finite baseline/restoration/all-controls mask. Annual units: " + units + ".",
                _table(["Index", "Saved control", "Baseline", "Restoration", "Control", "B − R", "B − C", "C − R"],
                       rows[offset:offset+12], "Positive C − R means less modeled export under restoration"),
                _table(["Index", "Valid B", "Valid R", "Valid C", "Triple common", "All-controls common", "Lost vs triple", "Outcome"],
                       coverage[offset:offset+12], "Missing support remains excluded. Empty common support yields unavailable, never zero.")]])
            points = [{"x": p["index"], "y": primary[i]["siting_contrasts"][pollutant]["restoration_advantage_mass"]}
                      for i, p in enumerate(assessment["placements"]) if offset <= i < offset+12]
            finite = [p["y"] for p in points if p["y"] is not None]
            if finite:
                lo, hi = min([0.0, *finite]), max([0.0, *finite])
                margin = (hi-lo) * .1 if hi > lo else 1.0
                panel = {"title": "Control minus restoration on shared finite support",
                    "x": {"domain": [points[0]["x"]-.6, points[-1]["x"]+.6], "label": "Saved placement index",
                          "ticks": [{"value": p["x"], "label": str(p["x"])} for p in points]},
                    "y": {"domain": [lo-margin, hi+margin], "label": "Annual export advantage", "unit": units,
                          "ticks": [{"value": v, "label": _show(v)} for v in (lo, (lo+hi)/2, hi)]},
                    "series": [{"geometry": "scatter", "label": "C − R", "points": points}],
                    "reference_lines": [{"axis": "y", "value": 0, "label": "Equal modeled export"}]}
                figure = _figure(root, "outcome-" + pollutant + "-" + str(offset//12+1) + ".svg",
                    {"panels": [panel]}, pollutant.replace("_", " ") + ": selected control outcomes",
                    "Authored placements on one actual common mask. Duplicates remain identified; no error bars, sampling distribution or causal estimate is implied.")
                blocks.append(["Shared-support outcome figure", [figure]])
    denominators = []
    for region in primary:
        for pollutant, value in region["siting_contrasts"].items():
            for role, item in value["alternatives"].items():
                denominators.append([by_id[region["design_id"]]["index"], pollutant, role,
                    _show(item["whole_scenario_changed_hectares"]), _show(item["region_changed_hectares"]),
                    _show(item["native_common_changed_hectares"]), _show(item["avoided_export_per_changed_ha"]),
                    value["normalized_units"], item["local_rate_unavailable_reason"] or "Available"])
    for offset in range(0, len(denominators), 18):
        blocks.append(["Intervention area and supported denominators", [
            _table(["Index", "Quantity", "Scenario", "Whole changed ha", "Region changed ha", "Common changed ha",
                    "Avoided / region changed ha", "Units", "Availability"],
                   denominators[offset:offset+18], "Complete alternate denominators and changed/unchanged source partitions remain in outcomes.csv and partitions.csv")]])
    for placement in assessment["placements"]:
        member = next(m for m in binding["members"] if m["design_id"] == placement["design_id"])
        dims = [[r["role"], r["units"], ", ".join(map(str, r["boundaries"])) or "One unconstrained bin",
                 r.get("definition", "Original prepared native-grid input")] for r in member["selection"]["strata"]]
        balance = [[r["role"], r["units"], r["residual"]["count"], _show(r["residual"]["mean"]),
                    _show(r["residual"]["mean_absolute"]), _show(r["residual"]["max_absolute"])]
                   for r in member["balance"] if r["stratum"] == "__all__"]
        blocks.append(["Placement " + str(placement["index"]) + " · declared design and residual balance", [
            member["selection"]["reason"],
            _table(["Role", "Units", "Explicit boundaries", "Physical definition"], dims, "Empty boundaries still require valid source support"),
            _table(["Role", "Units", "Paired count", "Mean C − T", "Mean absolute residual", "Maximum absolute residual"],
                   balance, "Actual finite paired balance; overall pre-admission target/candidate populations remain separately recorded"),
            {"kind": "links", "items": [
                {"title": "Complete original design, every stratum and pair source", "path": "originals/" + member["design_id"] + "/design.json"},
                {"title": "Original native adoption", "path": "originals/" + member["design_id"] + "/adoption.json"}]}]])
    # Map display uses the common full-raster absolute scale for each quantity.
    # It is a second, bounded display read, not another scientific calculation.
    import numpy as np
    import rasterio
    previews = []
    for pollutant in selected["pollutants"]:
        chosen = [m for m in assessment["maps"] if m["pollutant"] == pollutant and
                  m["support_mode"] == "group_common" and m["difference"] == "control_minus_restoration"]
        maximum = 0.0
        for item in chosen:
            with rasterio.open(root / item["path"]) as src:
                for _, window in src.block_windows(1):
                    values = src.read(1, window=window, masked=True)
                    valid = values.compressed()
                    if valid.size:
                        maximum = max(maximum, float(np.max(np.abs(valid))))
        for item in chosen:
            previews.append(_map_preview(root, item, maximum, binding["grid"]))
    atomic_json(root / "map-previews.json", previews, immutable=True)
    for item in previews:
        blocks.append(["Placement " + str(item["design_index"]) + " · " + item["pollutant"].replace("_", " ") + " map", [
            "The original Float64 GeoTIFF retains every signed control-minus-restoration pixel on group-common support. "
            "The directly viewable SVG uses nearest-neighbour display sampling on a common quantity legend; small features can be omitted from that preview. "
            "NoData stays gray, positive blue means lower export under restoration, and negative red means higher export. Read full pixels in the original GIS map.",
            {"kind": "links", "items": [
                {"title": "Open readable map preview", "path": item["preview"]["path"]},
                {"title": "Open original full-resolution GeoTIFF", "path": item["path"]},
                {"title": "Exact preview values, CRS and bounds", "path": item["preview_data"]["path"]}]}]])
    all_maps = [{"title": "Placement " + str(m["design_index"]) + " · " + m["support_mode"] + " · " +
                m["pollutant"] + " · " + m["difference"], "path": m["path"]} for m in assessment["maps"]]
    for offset in range(0, len(all_maps), 18):
        blocks.append(["Complete original-grid outcome maps", [{"kind": "links", "items": all_maps[offset:offset+18]}]])
    blocks.append(["Complete scientific tables and source choices", [{"kind": "links",
        "items": [{"title": name, "path": name} for name in LINKS] + [
            {"title": "Placement overlap/Jaccard and exact duplicate identities", "path": "placement-overlaps.csv"},
            {"title": "All actual support masks", "path": "assessment.json"}]}]])
    blocks.append(["Native methods and source-unit references", [
        _table(["Reference", "Original guide"], [[item["title"], scientific_report.link("Open original model guide", item["url"])]
            for item in guide_links(binding)], "The retained producing-runtime identity determines these model guides; source bindings retain exact conversions")]])
    sources = [{"id": m["design_id"], "title": m["title"], "vintage": "Original saved design",
                "uri": "urn:upstate:multivariate-control:" + m["design_id"],
                "source_id": m["source"]["source_id"]} for m in binding["members"]]
    scientific_report.write_companions(root, selected["title"], blocks, contact={}, source_records=sources,
        binding={"outcome_id": assessment["id"], "selection": selected, "input_binding": binding},
        subtitle="Retained native outcomes for explicit matched-control placements on common support.",
        footer="TokenJunkieLabs scientific engineering · Original sources, native models and scientist interpretation retained.")
    scientific_report.report_pdf(root / "report.pdf", selected["title"], blocks, contact={}, source_records=sources,
        footer="TokenJunkieLabs · Original native outcomes and explicit scientific choices")
    return blocks
