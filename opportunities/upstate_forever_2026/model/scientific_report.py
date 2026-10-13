"""Readable scientific delivery reports from retained original model records.

The formatter does not recompute native exports, fit parameters, or choose
scenarios. PDF, offline HTML and structured report data share the same blocks.
"""
from __future__ import annotations

from html import escape as html_escape
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file
from . import rasters

REPORT_VERSION = "upstate.scientific-report/v5"
POLLUTANT_NAMES = {
    "nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
    "sediment_export": "Sediment", "nitrogen": "Nitrogen",
    "phosphorus": "Phosphorus", "sediment": "Sediment",
}
PARAMETERS = {
    "threshold_flow_accumulation": ("Stream threshold", "upstream cells"),
    "k_param": ("Connectivity response parameter", "dimensionless"),
    "flow_dir_algorithm": ("Flow direction", ""),
    "subsurface_critical_length_n": ("Subsurface nitrogen retention length", "m"),
    "subsurface_eff_n": ("Subsurface nitrogen retention efficiency", "fraction"),
    "runoff_proxy_av": ("Reference runoff proxy average", "original proxy units"),
    "sdr_max": ("Maximum sediment delivery ratio", "fraction"),
    "ic_0_param": ("Reference connectivity index", "dimensionless"),
    "l_max": ("Maximum USLE slope length", "m"),
}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _number(value, *, signed=False):
    if not _finite(value):
        return "Unavailable"
    if value == 0:
        return "0"
    return format(value, "+,.6g" if signed else ",.6g")


def _count(value):
    if not _finite(value) or value < 0 or int(value) != value:
        return "Unavailable"
    return format(int(value), ",")


def _unit(value):
    return str(value or "").replace("metric_tonnes", "metric tonnes").replace("hectare", "ha")


def _label(value):
    return POLLUTANT_NAMES.get(value, str(value).replace("_", " ").strip().capitalize())


def _plain(value):
    """Render source-supplied labels and references without JSON punctuation."""
    if value is None:
        return "Unspecified"
    if isinstance(value, dict):
        return "; ".join(_label(key) + ": " + _plain(item) for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return "; ".join(_plain(item) for item in value) or "None"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def _mass_units(pollutant, record=None):
    record = record or {}
    return _unit(record.get("sum_units") or rasters.MASS_UNITS.get(pollutant, record.get("units", "")).replace("/pixel", ""))


def _quantity(record, field="sum", *, signed=False):
    # A native comparison's accumulator starts at zero even with no valid pair.
    # Only a positive actual support count makes that scalar a measured result.
    support = record.get("valid_cells")
    if not _finite(support) or support <= 0:
        return "Unavailable"
    return _number(record.get(field), signed=signed)


def _percent(value):
    return _number(100 * value) + "%" if _finite(value) else "Unavailable"


def _table(columns, rows, *, widths=None, caption=None):
    columns = [str(value) for value in columns]
    normalized = [[str(value) for value in row] for row in rows]
    if any(len(row) != len(columns) for row in normalized):
        raise ValueError("Scientific report table row does not match its columns")
    if widths is not None and (len(widths) != len(columns) or any(not _finite(v) or v <= 0 for v in widths)):
        raise ValueError("Scientific report table needs one positive width per column")
    return {"kind": "table", "columns": columns, "rows": normalized,
            "widths": widths, "caption": caption}


def _current_exports(baseline, grid):
    cell_area = grid.get("grid", grid).get("pixel_area_ha")
    rows = []
    for pollutant in rasters.MASS_UNITS:
        item = baseline.get("artifacts", {}).get(pollutant)
        if item is None:
            continue
        area = item.get("pixel_area_ha", cell_area)
        cells = item.get("valid_cells")
        support = cells * area if _finite(cells) and _finite(area) else None
        rows.append([_label(pollutant), _quantity(item), _mass_units(pollutant, item),
                     _count(cells), _number(support)])
    return [
        "Annual exports are totals over the valid modeled cells inside the retained reporting mask. "
        "The supporting area is the area of those valid cells. Original missing cells remain absent.",
        _table(["Pollutant", "Annual export", "Unit", "Valid cells", "Support (ha)"],
               rows, widths=[1.0, 1.0, 1.3, .9, 1.0]),
        "Figures are displayed to six significant digits. Complete numeric values and the original "
        "rasters are retained in the working project. An unavailable value has no usable reported support.",
    ]


def _profile(profile):
    rows = []
    for model in ("ndr", "sdr"):
        for key, value in profile.get(model, {}).items():
            name, unit = PARAMETERS.get(key, (_label(key), ""))
            shown = _number(value) if _finite(value) else _plain(value)
            rows.append([model.upper(), name, shown, unit])
    blocks = [str(profile.get("title") or "Selected model profile"),
              _table(["Model", "Setting", "Value", "Unit"], rows, widths=[.55, 2.5, 1.05, 1.5])]
    for reference in (profile.get("references") if isinstance(profile.get("references"), list)
                      else [profile.get("references")]):
        if reference is not None:
            blocks.append("Profile reference: " + _plain(reference))
    if profile.get("model_period"):
        blocks.append("Model period: " + _plain(profile["model_period"]))
    return blocks


def _scenario_sections(workspace, alternatives, comparison):
    blocks = [
        "Each alternative uses its retained land-cover assumptions. Changes are alternative minus baseline "
        "over cells valid in both runs. Positive values mean higher modeled export; negative values mean "
        "lower modeled export. Baseline and alternative totals over different valid footprints are not subtracted.",
    ]
    compared = {row["run_id"]: row for row in comparison.get("alternatives", [])}
    for run in alternatives:
        scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
        blocks.extend([str(scenario["title"]), str(scenario["reason"])])
        edits = {row.get("index"): row for row in run.get("stages", {}).get("landcover", {}).get("edits", [])}
        patch_rows = []
        for index, patch in enumerate(scenario.get("patches", [])):
            edit = edits.get(index, {})
            patch_rows.append([
                patch["mask_source_id"],
                ", ".join(str(code) for code in patch["from_codes"]) + " to " + str(patch["to_code"]),
                _count(edit.get("changed_cells")), _number(edit.get("changed_hectares")),
                str(patch["reason"]),
            ])
        if patch_rows:
            blocks.append(_table(
                ["Source area", "Land-cover codes", "Patch cells", "Patch ha", "Purpose"],
                patch_rows, widths=[1.2, 1.0, .85, .85, 2.0],
                caption="Retained native patch counts in declared application order. Overlapping patches "
                        "can count the same cell more than once; these counts are not the final net changed area.",
            ))
        if any(patch["to_code"] in patch["from_codes"] for patch in scenario.get("patches", [])):
            blocks.append("A destination code is also included among the selected source codes. "
                          "The retained native patch counter can include cells already assigned that destination; "
                          "the saved scenario raster and paired export changes retain the resulting land-cover effect.")
        rows = []
        for pollutant, item in compared.get(run["id"], {}).get("artifacts", {}).items():
            if pollutant not in rasters.MASS_UNITS:
                continue
            count, change = item.get("valid_cells"), item.get("sum_change")
            if count == 0:
                direction = "No shared valid cells"
            elif not _finite(count) or count < 0 or not _finite(change):
                direction = "Unavailable"
            else:
                direction = "Higher export" if change > 0 else "Lower export" if change < 0 else "No net change"
            rows.append([_label(pollutant), _quantity(item, "sum_change", signed=True),
                         _mass_units(pollutant), _count(count), direction])
        if rows:
            blocks.append(_table(
                ["Pollutant", "Net annual change", "Unit", "Paired cells", "Interpretation"],
                rows, widths=[1.0, 1.1, 1.3, .9, 1.8],
            ))
        else:
            blocks.append("No paired quantitative comparison is attached for this scenario.")
        blocks.append("Saved scenario " + str(scenario.get("id", run["selection"]["scenario_id"]))
                      + "; native run " + str(run["id"]) + ".")
    return blocks


def _priorities(priority):
    caps, weights = priority.get("caps", {}), priority.get("weights", {})
    rows = [[_label(key), _number(weights.get(key)), _number(caps.get(key)),
             _unit(rasters.MASS_UNITS.get(key, ""))] for key in rasters.MASS_UNITS if key in caps or key in weights]
    blocks = [
        "The combined map is a dimensionless planning index. Each pollutant stays in its own physical "
        "unit before normalization; the selected weights express the planning emphasis.",
        _table(["Pollutant", "Weight", "Normalization cap", "Cap unit"], rows, widths=[1.1, .7, 1.3, 1.7]),
    ]
    if priority.get("percentile") is not None:
        blocks.append("Reference cap percentile: " + _number(priority["percentile"]) + ".")
    if priority.get("method"):
        blocks.append("Recorded normalization method: " + _plain(priority["method"]) + ".")
    blocks.append("Use the separate physical export and scenario-change tables when comparing annual quantities.")
    return blocks


def _observations(results):
    if not results:
        return [
            "This delivery uses the selected published parameter profile. No annual-load observation "
            "comparison was selected for this report. The current model outputs can be compared with "
            "retained source catchments and annual references through the workspace.",
        ]
    blocks = [
        "The following descriptive comparisons use the selected observation periods and original catchments. "
        "Residual and bias are modeled minus observed annual mass. Repeated periods at one catchment share "
        "the same steady-state model prediction; they are not independent spatial replicates.",
    ]
    for result in results:
        blocks.append("Observation edition " + str(result["observation_id"])
                      + "; selected run " + str(result["run_id"]) + ".")
        rows = []
        for parameter, metrics in result.get("metrics", {}).items():
            rows.append([
                _label(parameter), _count(metrics.get("n")), _count(metrics.get("unique_catchments")),
                _number(metrics.get("rmse")), _number(metrics.get("mean_bias"), signed=True),
                _number(metrics.get("nash_sutcliffe_efficiency")), _unit(metrics.get("units")),
            ])
        if rows:
            blocks.append(_table(
                ["Pollutant", "Rows", "Catchments", "RMSE", "Mean bias", "NSE", "Mass unit"],
                rows, widths=[1.1, .6, .8, .9, .9, .9, 1.2],
                caption="RMSE and mean bias use the mass unit shown; NSE is dimensionless and is undefined "
                        "when the reference has insufficient variation.",
            ))
        if result.get("metrics_basis"):
            blocks.append(str(result["metrics_basis"]))
        methods = result.get("observation_method", {})
        if methods:
            blocks.append("Observation method and original references: " + _plain(methods))
        for parameter in ("nitrogen", "phosphorus", "sediment"):
            selected = [row for row in result.get("comparisons", []) if row.get("parameter") == parameter]
            if not selected:
                continue
            detail = []
            for row in selected:
                place = str(row["catchment_id"])
                if row.get("station_id"):
                    place += "\nStation " + str(row["station_id"])
                period = str(row.get("period_start", "")) + " to " + str(row.get("period_end", ""))
                included = row.get("included_in_metrics") is True
                detail.append([
                    place, period, _number(row.get("observed_annual_mass")),
                    _number(row.get("modeled_annual_mass")),
                    _number(row.get("residual"), signed=True) if included else "Unavailable",
                    "Complete" if included else "Partial support",
                ])
            unit = _unit(selected[0].get("units"))
            blocks.append(_table(
                ["Catchment", "Observation period", "Observed", "Modeled", "Residual", "Coverage"],
                detail, widths=[1.3, 1.45, .9, .9, .9, 1.1],
                caption=_label(parameter) + ": annual quantities in " + unit + ".",
            ))
        support_rows, seen_support = [], set()
        for row in result.get("comparisons", []):
            key = (row["parameter"], row["catchment_id"])
            if key in seen_support:
                continue
            seen_support.add(key)
            support = row.get("spatial_coverage", {})
            support_rows.append([
                _label(key[0]) + "\n" + str(key[1]),
                _count(support.get("valid_cells")),
                _count(support.get("structural_stream_omission_cells")),
                _count(support.get("unexpected_missing_cells")),
                _number(support.get("catchment_area_outside_raster_ha")),
                _plain(support.get("coverage_issues", [])),
            ])
        if support_rows:
            blocks.append(_table(
                ["Catchment / pollutant", "Export cells", "Native stream omissions",
                 "Unexpected missing cells", "Outside raster (ha)", "Coverage findings"],
                support_rows, widths=[1.4, .75, .9, .9, .9, 2.1],
                caption="Coverage is reported once per catchment and pollutant. Native stream omissions "
                        "retain their original NoData and contribute no imputed mass. Partial comparisons "
                        "keep their available modeled total; only complete catchments enter residual and fit metrics.",
            ))
        source_rows = []
        for row in result.get("comparisons", []):
            source_rows.append([
                _label(row["parameter"]) + "\n" + str(row.get("station_id") or row["catchment_id"])
                + "\n" + str(row.get("period_start", "")) + " to " + str(row.get("period_end", "")),
                _plain(row.get("observed_value_text")) + " " + _unit(row.get("observed_source_unit")),
                _plain(row.get("method")) + "\nQualifier: " + _plain(row.get("observed_qualifier") or "None"),
                _plain(row.get("uncertainty")) + "\n" + _plain(row.get("source_records")),
            ])
        if source_rows:
            blocks.append(_table(
                ["Observation", "Original value / unit", "Method and qualifier", "Uncertainty and source"],
                source_rows, widths=[1.5, 1.1, 1.8, 2.1],
                caption="Original annual-reference values and source qualifications before conversion "
                        "to the comparison units. The source's uncertainty retains its original definition.",
            ))
        exclusions = result.get("exclusions", [])
        if exclusions:
            blocks.append(_table(
                ["Original observation", "Reason excluded from the comparison"],
                [[str(row.get("observation_id", "")), _plain(row.get("issues", []))] for row in exclusions],
                widths=[1.2, 4.8],
            ))
        if result.get("interpretation"):
            blocks.append(str(result["interpretation"]))
    return blocks


def _receptors(inventory):
    if not inventory:
        return None
    blocks = [str(inventory.get("method", "")), str(inventory.get("quantity_basis", ""))]
    rows = []
    for area in inventory.get("areas", []):
        rows.append([str(area.get("title", area.get("id", ""))),
                     ", ".join(str(value) for value in area.get("anchor_huc12s", [])),
                     _count(area.get("huc12_count")), _number(area.get("reporting_area_ha"))])
    blocks.append(_table(["Contributing area", "Anchor HUC12s", "HUC12 count", "Reporting ha"],
                         rows, widths=[2.0, 2.0, .8, 1.0]))
    blocks.append("The retained GIS includes original network links and upstream memberships. "
                  "Per-area quantities can overlap. Use their geographic union for a combined total.")
    return blocks


def refine_sections(sections, *, workspace, baseline, alternatives, comparison,
                    profile, grid, priority, observation_results, receptor_inventory=None):
    """Replace machine-record paragraphs and retain independently installed sections."""
    replacements = {
        "Selected parameter profile": _profile(profile),
        "Current quantitative exports": _current_exports(baseline, grid),
        "Future conservation and development scenarios": _scenario_sections(workspace, alternatives, comparison),
        "Combined priorities": _priorities(priority),
        "Observed watershed loads": _observations(observation_results),
    }
    receptor_blocks = _receptors(receptor_inventory)
    if receptor_blocks is not None:
        replacements["Source-water contributing land"] = receptor_blocks
    return [(heading, replacements.get(heading, blocks)) for heading, blocks in sections]


def _receiving_metric_blocks(baseline_physical, alternatives):
    """Read retained subject metrics without recomputing or merging receptor areas."""
    def physical_table(physical, caption):
        rows = [[_label(key), _quantity(value), _mass_units(key, value),
                 _count(value.get("valid_cells")), _percent(value.get("coverage_fraction"))]
                for key, value in physical.items()]
        return _table(["Pollutant", "Annual export", "Unit", "Valid cells", "Coverage"],
                      rows, widths=[1.0, 1.0, 1.4, .9, .9], caption=caption)

    blocks = [physical_table(
        baseline_physical, "Baseline annual exports over the retained valid cells for this subject."
    )]
    for run_id, alternative in alternatives.items():
        if alternative.get("physical"):
            blocks.append(physical_table(
                alternative["physical"],
                "Native run " + str(run_id) + ". Alternative annual exports over this run's valid cells. "
                "The paired scenario-change table uses the common baseline and alternative cells.",
            ))
        changes = alternative.get("changes", {})
        rows = []
        bases = {}
        for key, value in changes.items():
            rows.append([_label(key), _quantity(value, signed=True),
                         _quantity(value, "sum_increased_export"),
                         _quantity(value, "sum_avoided_export"), _mass_units(key, value),
                         _count(value.get("valid_cells")), _percent(value.get("coverage_fraction"))])
            if value.get("sum_basis"):
                bases.setdefault(str(value["sum_basis"]), []).append(_label(key))
        caption = ("Native run " + str(run_id) + ". Net change is alternative minus baseline. "
                   "Increased and avoided exports sum the positive and negative cell-level components separately.")
        for basis, pollutants in bases.items():
            caption += " Net-change sum basis (" + ", ".join(pollutants) + "): " + basis + "."
        if "stored Float32 signed difference pixels" in bases:
            caption += (" Increased and avoided exports retain the native Float64 paired-difference sums; "
                        "their difference can therefore vary slightly from the stored net at floating-point precision.")
        blocks.append(_table(
            ["Pollutant", "Net change", "Increased export", "Avoided export", "Unit", "Paired cells", "Coverage"],
            rows, widths=[1.0, .9, 1.0, 1.0, 1.2, .8, .8], caption=caption,
        ))
    return blocks


def receiving_sections(product):
    """Format the existing receiving-water delivery's actual quantities and support."""
    if product is None:
        return []
    inventory = product["inventory"]
    measurement = inventory.get("measurement", {})
    blocks = ["Receiving-water quantity scope: " + inventory["quantity_scope"].replace("_", " ") + ".",
              *[str(measurement[key]) for key in ("physical", "coverage", "scenario_delta", "overlap")
                if measurement.get(key)]]
    normalization = inventory.get("normalization", {})
    blocks.extend(_priorities(normalization))
    for family, union in inventory.get("families", {}).items():
        blocks.append("Unduplicated family union: " + str(union.get("title", family)) + ".")
        blocks.append("Each contributing cell is counted once within this family. "
                      "Different families can overlap; their union totals must not be added together.")
        if union.get("interpretation"):
            blocks.append(str(union["interpretation"]))
        if union.get("relationship_precision"):
            blocks.append("Contribution relationship: " + str(union["relationship_precision"]) + ".")
        blocks.append("Retained receptor IDs: " + ", ".join(str(value) for value in union.get("receptor_ids", [])) + ".")
        blocks.extend(_receiving_metric_blocks(
            union.get("baseline_physical", {}),
            {run_id: value["metrics"] for run_id, value in union.get("alternatives", {}).items()},
        ))
    for receptor in inventory.get("receptors", []):
        blocks.append(str(receptor["title"]) + " — " + str(receptor["relationship_precision"]) + ".")
        if receptor.get("classification"):
            blocks.append("Retained designation: " + _plain(receptor["classification"]))
        blocks.append("Contributing area: " + _number(receptor.get("contribution_area_ha"))
                      + " ha; area within the selected quantity scope: "
                      + _number(receptor.get("area_in_quantity_scope_ha")) + " ha.")
        metrics = receptor["metrics"]
        blocks.extend(_receiving_metric_blocks(
            metrics.get("baseline_physical", {}), metrics.get("alternatives", {}),
        ))
        if receptor.get("source"):
            blocks.append("Original receiving-water source: " + _plain(receptor["source"]))
    return [("Receiving-water quantities and priorities", blocks)]


def _source_block(source_records):
    return _table(
        ["Source", "Edition", "Original reference"],
        [[str(source.get("title", source["id"])) + "\n" + str(source["id"]),
          str(source["vintage"]), str(source["uri"])] for source in source_records],
        widths=[2.0, 1.0, 3.0],
    )


def _relative_link(value):
    if not isinstance(value, str) or not value:
        raise ValueError("Report links require an original relative file path")
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts or ":" in normalized or normalized.startswith("//"):
        raise ValueError("Report links must remain within the delivered package")
    return normalized


def report_pdf(path, title, sections, *, contact, source_records):
    """Render the original report content with repeating, page-aware data tables."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    styles = getSampleStyleSheet()
    styles["BodyText"].fontName = "Helvetica"
    styles["BodyText"].fontSize = 9
    styles["BodyText"].leading = 13
    cell_style = ParagraphStyle("ScientificTable", parent=styles["BodyText"], fontSize=8, leading=10)
    story = [Paragraph(escape(str(title)), styles["Title"]), Spacer(1, .15 * inch)]

    def paragraph(value, style=None):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), style or styles["BodyText"])

    def append(block):
        if isinstance(block, dict) and block.get("kind") == "links":
            for item in block["items"]:
                relative = _relative_link(item["path"])
                story.append(Paragraph('<link href="' + html_escape(relative, quote=True) + '">' +
                    escape(str(item["title"])) + "</link>", styles["BodyText"]))
                story.extend([paragraph(relative, cell_style), Spacer(1, .05 * inch)])
        elif isinstance(block, dict) and block.get("kind") == "table":
            if block.get("caption"):
                story.extend([paragraph(block["caption"]), Spacer(1, .05 * inch)])
            widths = block.get("widths") or [1.0] * len(block["columns"])
            total = sum(widths)
            rows = [[paragraph(value, cell_style) for value in block["columns"]]]
            rows.extend([paragraph(value, cell_style) for value in row] for row in block["rows"])
            table = Table(rows, colWidths=[7.1 * inch * value / total for value in widths],
                          repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                ("LINEBELOW", (0, 0), (-1, 0), .6, colors.black),
                ("LINEBELOW", (0, 1), (-1, -1), .25, colors.HexColor("#cccccc")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(table)
        else:
            story.append(paragraph(block))
        story.append(Spacer(1, .08 * inch))

    for heading, blocks in sections:
        story.append(paragraph(heading, styles["Heading2"]))
        for block in blocks:
            append(block)
    story.append(paragraph("Source editions", styles["Heading2"]))
    append(_source_block(source_records))
    story.append(paragraph("Prepared by " + str(contact["name"]) + " · "
                           + str(contact["organization"]) + " · " + str(contact["email"])))

    def page_number(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.drawString(.7 * inch, .42 * inch, "Scientific report · original model and source editions")
        canvas.drawRightString(7.8 * inch, .42 * inch, str(document.page))
        canvas.restoreState()

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    SimpleDocTemplate(str(path), pagesize=letter, rightMargin=.7 * inch, leftMargin=.7 * inch,
                      topMargin=.65 * inch, bottomMargin=.65 * inch,
                      title=str(title), author=str(contact["organization"])).build(
                          story, onFirstPage=page_number, onLaterPages=page_number)


def _html_block(block):
    def cell(value):
        return html_escape(str(value)).replace("\n", "<br>")
    if isinstance(block, dict) and block.get("kind") == "links":
        return "<ul>" + "".join(
            '<li><a href="' + html_escape(_relative_link(item["path"]), quote=True) + '">' +
            cell(item["title"]) + "</a></li>" for item in block["items"]) + "</ul>"
    if not isinstance(block, dict) or block.get("kind") != "table":
        return "<p>" + cell(block) + "</p>"
    caption = "<caption>" + cell(block["caption"]) + "</caption>" if block.get("caption") else ""
    head = "".join("<th scope=\"col\">" + cell(value) + "</th>" for value in block["columns"])
    rows = "".join("<tr>" + "".join("<td>" + cell(value) + "</td>" for value in row)
                   + "</tr>" for row in block["rows"])
    return "<div class=\"table-wrap\"><table>" + caption + "<thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>"


def _markdown_report(title, sections, prepared):
    def cell(value):
        return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", "<br>")
    lines = ["# " + str(title), ""]
    for heading, blocks in sections:
        lines.extend(["## " + str(heading), ""])
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "table":
                if block.get("caption"):
                    lines.extend([str(block["caption"]), ""])
                lines.append("| " + " | ".join(cell(value) for value in block["columns"]) + " |")
                lines.append("| " + " | ".join("---" for _ in block["columns"]) + " |")
                lines.extend("| " + " | ".join(cell(value) for value in row) + " |" for row in block["rows"])
                lines.append("")
            elif isinstance(block, dict) and block.get("kind") == "links":
                for item in block["items"]:
                    relative = _relative_link(item["path"])
                    target = relative.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
                    label = str(item["title"]).replace("[", "\\[").replace("]", "\\]")
                    lines.append("- [" + label + "](" + target + ")")
                lines.append("")
            else:
                lines.extend([str(block), ""])
    lines.extend([prepared, ""])
    return "\n".join(lines)


def write_companions(directory, title, sections, *, contact, source_records, binding):
    """Retain offline HTML and complete structured report blocks in the delivery."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    all_sections = list(sections) + [("Source editions", [_source_block(source_records)])]
    headings = "".join("<li><a href=\"#section-" + str(index) + "\">" + html_escape(str(heading))
                       + "</a></li>" for index, (heading, _) in enumerate(all_sections))
    content = "".join("<section id=\"section-" + str(index) + "\"><h2>"
                      + html_escape(str(heading)) + "</h2>"
                      + "".join(_html_block(block) for block in blocks) + "</section>"
                      for index, (heading, blocks) in enumerate(all_sections))
    prepared = "Prepared by " + str(contact["name"]) + " · " + str(contact["organization"]) + " · " + str(contact["email"])
    body = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>" + html_escape(str(title)) + "</title><style>"
        "*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font:15px/1.5 Arial,sans-serif}"
        "main{max-width:1120px;margin:auto;padding:32px}h1{font-size:30px;line-height:1.2}"
        "h2{font-size:21px;border-bottom:1px solid #777;padding-bottom:8px;margin-top:32px}"
        "a{color:inherit;text-decoration:underline}nav{border:1px solid #aaa;padding:12px 20px}"
        "nav ol{columns:2;margin:8px 0;padding-left:20px}section{scroll-margin-top:20px}"
        "p{max-width:95ch;overflow-wrap:anywhere}.table-wrap{overflow-x:auto;margin:16px 0}"
        "table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;"
        "padding:8px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}th{background:#eee;border-bottom:1px solid #444}"
        "caption{text-align:left;margin-bottom:8px}footer{border-top:1px solid #777;margin-top:32px;padding-top:16px}"
        "@media(max-width:620px){main{padding:16px}nav ol{columns:1}h1{font-size:25px}}"
        "@media print{main{max-width:none;padding:0}nav{display:none}.table-wrap{overflow:visible}"
        "thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}body{font-size:10pt}"
        "table{font-size:8pt}a{text-decoration:none}@page{margin:16mm}}"
        "</style></head><body><main><h1>" + html_escape(str(title))
        + "</h1><p>Scientific model results, scenario changes and retained source editions.</p>"
        "<nav aria-label=\"Report sections\"><strong>Contents</strong><ol>" + headings + "</ol></nav>"
        + content + "<footer>" + html_escape(prepared) + "</footer></main></body></html>\n"
    )
    html_path, data_path = directory / "report.html", directory / "report-data.json"
    markdown_path = directory / "report.md"
    atomic_bytes(markdown_path, _markdown_report(title, all_sections, prepared).encode("utf-8"))
    atomic_bytes(html_path, body.encode("utf-8"))
    atomic_json(data_path, {
        "schema": REPORT_VERSION, "title": title, "binding": binding,
        "sections": [{"heading": heading, "blocks": blocks} for heading, blocks in sections],
        "source_records": source_records, "contact": contact,
        "display_precision": "Six significant digits; complete original numeric data remains in the working project",
    })
    return {"report_html": describe_file(directory, html_path),
            "report_markdown": describe_file(directory, markdown_path),
            "report_data": describe_file(directory, data_path)}
