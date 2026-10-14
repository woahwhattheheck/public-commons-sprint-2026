"""Readable original scientific source inspections and saved source meanings.

TokenJunkieLabs. This presentation reads the maintained inspection and reviewed
selection records. It neither transforms source values nor infers scientific
units, meanings, approval, total workbook rows or native model completion.
"""
from __future__ import annotations

import html
import json

VERSION = "2026-10-13.2"
ROLES = {
    "CONTEXT": ("Reference context", "Retained for interpretation and discussion. Scientific use still needs review."),
    "MEASUREMENTS": ("Measurements", "Continue through the existing Measurements importer to review the observation columns and units."),
    "BIOPHYSICAL": ("Model coefficient table", "The selected original columns supply the explicitly mapped NDR/SDR parameters."),
    "MODEL_DOMAIN": ("Contributing model domain", "The selected polygon defines the upstream area included in the model."),
    "REPORTING_AREA": ("Reporting area", "The selected polygon defines where modeled results are summarized."),
    "WATERSHEDS": ("Watersheds", "The selected polygon layer supplies the named drainage units."),
    "STATIONS": ("Monitoring stations", "The selected layer supplies the original monitoring locations."),
    "DEM": ("Elevation", "The reviewed elevation source supplies terrain to the native grid preparation."),
    "NLCD": ("Land cover", "The original class codes supply categorical land cover to native grid preparation."),
    "PRECIPITATION": ("Precipitation", "The reviewed precipitation source supplies the selected hydrologic input."),
    "R_FACTOR": ("Rainfall erosivity", "The reviewed source supplies the erosion model's rainfall erosivity input."),
    "K_FACTOR": ("Soil erodibility", "The reviewed source supplies the erosion model's soil erodibility input."),
}
STYLE = """
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;color:#202020;background:#fff;
font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:auto;padding:32px 24px 64px}header{border-bottom:2px solid #333;padding-bottom:20px}
.brand,.eyebrow{font-size:.82rem;font-weight:650;letter-spacing:.03em;color:#555}
h1{font-size:1.85rem;line-height:1.2;margin:.45rem 0 1rem}h2{font-size:1.35rem;margin:2rem 0 .65rem}
h3{font-size:1.1rem;margin:1.4rem 0 .55rem}h4{font-size:1rem;margin:1.1rem 0 .4rem}
p{margin:.5rem 0 1rem}p,li,dd,dt,h1,h2,h3,h4,a,code,summary{overflow-wrap:anywhere}
.lead{font-size:1.08rem;max-width:78ch}.muted{color:#555}.facts{display:grid;
grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 20px;margin:1.2rem 0}
.facts div{border-top:1px solid #ccc;padding-top:.55rem}.facts dt{font-size:.85rem;color:#555}
.facts dd{margin:.15rem 0 0;font-weight:600}.file{margin:2rem 0;border-top:2px solid #555}
.part{margin:1.25rem 0;padding:0 0 1rem;border-bottom:1px solid #ccc}
.reading,.meaning{display:grid;grid-template-columns:minmax(140px,1fr) 3fr;gap:.25rem 1.2rem}
.reading dt,.meaning dt{font-weight:600}.reading dd,.meaning dd{margin:0}
.scroll{max-width:100%;overflow:auto;border:1px solid #bbb;margin:.8rem 0}
.scroll:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #444;outline-offset:3px}
table{border-collapse:collapse;min-width:100%;font-size:.92rem}caption{text-align:left;font-weight:600;
padding:.7rem;background:#f3f3f3}th,td{text-align:left;vertical-align:top;padding:.65rem .75rem;
border-bottom:1px solid #ddd;min-width:9rem;max-width:30rem;overflow-wrap:anywhere}
th{background:#f2f2f2;font-weight:600}tbody tr:last-child td{border-bottom:0}
.preview td{white-space:nowrap;max-width:none;overflow-wrap:normal}
.row-number{min-width:5rem;white-space:nowrap}.notice{border-left:3px solid #666;padding:.65rem 1rem;
background:#f5f5f5}.choice{border:1px solid #bbb;padding:1rem;margin:1rem 0}
.choice h4{margin-top:0}details{margin:1rem 0;border:1px solid #ccc;padding:.75rem 1rem}
summary{cursor:pointer;font-weight:600}pre{font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;
white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;margin:1rem 0}code{font-size:.9em}
ul,ol{padding-left:1.4rem}.empty{color:#666;font-style:italic}footer{border-top:1px solid #bbb;
margin-top:2rem;padding-top:1rem;font-size:.88rem;color:#555}
@media(max-width:600px){main{padding:20px 14px 40px}h1{font-size:1.5rem}.reading,.meaning{
grid-template-columns:1fr;gap:.2rem}.reading dd,.meaning dd{margin-bottom:.65rem}
.facts{grid-template-columns:1fr 1fr}.choice{padding:.75rem}}
@media print{body{font-size:10pt}main{max-width:none;padding:0}.scroll{overflow:visible;border:0}
table{width:100%;table-layout:fixed;font-size:8pt}th,td{min-width:0;max-width:none;padding:4pt;
overflow-wrap:anywhere}.preview td{white-space:normal;overflow-wrap:anywhere}.row-number{min-width:0;white-space:normal}thead{display:table-header-group}
tr,.facts div{break-inside:avoid}h2,h3,h4{break-after:avoid}details.provenance{break-before:page}
a{color:inherit;text-decoration:none}header{border-bottom:1pt solid}footer{font-size:8pt}
}
"""


def _escape(value):
    return html.escape(str(value), quote=True)


def _value(value, missing="Not recorded"):
    if value is None or value == "":
        return '<span class="empty">' + _escape(missing) + "</span>"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return _escape(json.dumps(value, ensure_ascii=False, allow_nan=False))
    return _escape(value)


def _number(value):
    return f"{value:,}" if type(value) is int else _value(value)


def _pairs(rows, css="meaning"):
    return '<dl class="' + css + '">' + "".join(
        "<dt>" + _escape(label) + "</dt><dd>" + _value(value) + "</dd>"
        for label, value in rows) + "</dl>"


def _list(values):
    return "<ul>" + "".join("<li>" + _escape(value) + "</li>" for value in values) + "</ul>"


def _field_label(part, key):
    if key in ("", None):
        return None
    for field in part.get("fields", []):
        if field.get("id") == key:
            return field.get("display") or field.get("label") or "Unnamed column"
    return "Original column unavailable in this inspection: " + str(key)


def _review_label(choice):
    if choice.get("confirmed") is not True:
        return "Interpretation remains unconfirmed"
    if choice.get("role") == "CONTEXT":
        return "Saved as context; scientific review remains open"
    return "Confirmed by the named reviewer for this selected role"


def _role_text(choice):
    code = choice.get("role", "CONTEXT")
    return ROLES.get(code, (str(code), "Read the original source and retained review before using this role."))


def _selection(choice, part, number):
    role, meaning = _role_text(choice)
    rows = [
        ("Scientific role", role),
        ("Source title", choice.get("title")),
        ("Identifier column", _field_label(part, choice.get("identifier_field"))),
        ("Display label column", _field_label(part, choice.get("label_field"))),
        ("Original units", choice.get("units")),
        ("Source period", choice.get("period")),
        ("Time zone", choice.get("timezone")),
        ("Source edition / vintage", choice.get("vintage")),
        ("Reviewer", choice.get("reviewer")),
        ("Review status", _review_label(choice)),
        ("Source / method reference", choice.get("reference")),
        ("Original source location", choice.get("uri")),
        ("Interpretation notes", choice.get("notes")),
    ]
    out = ['<section class="choice"><h4>Reviewed use ' + str(number) + ": " + _escape(role) + "</h4>",
           "<p>" + _escape(meaning) + "</p>", _pairs(rows)]
    mapping = choice.get("mapping") or {}
    if mapping:
        out.append('<h4>Explicit model column mapping</h4><div class="scroll" role="region" tabindex="0" '
                   'aria-label="Reviewed original model column mapping"><table><thead><tr>'
                   '<th scope="col">Native parameter</th><th scope="col">Original column</th>'
                   "</tr></thead><tbody>")
        for target, original in mapping.items():
            out.append("<tr><td>" + _escape(target) + "</td><td>" +
                       _value(_field_label(part, original)) + "</td></tr>")
        out.append("</tbody></table></div>")
        out.append("<p>Selected models: " + _value(", ".join(choice.get("models", []))) + ".</p>")
    if choice.get("conversion"):
        conversion = choice["conversion"]
        out.append("<h4>Explicit unit conversion</h4>" + _pairs([
            ("Original units", conversion.get("original_units", choice.get("units"))),
            ("Multiply by", conversion.get("factor")),
            ("Resulting units", conversion.get("target_units")),
            ("Conversion reference", conversion.get("reference")),
        ]))
    if part.get("kind") == "raster" and choice.get("role") != "CONTEXT":
        out.append("<p>Later grid preparation uses the selected " +
                   _escape(choice.get("resampling", "not recorded")) +
                   " resampling method. This inspection retains the original pixels.</p>")
    out.append("</section>")
    return "".join(out)


def _sample(part, suffix, rows=None, caption="Original preview rows"):
    fields = part.get("fields") or []
    rows = part.get("rows", []) if rows is None else rows
    if not rows:
        return '<p class="muted">No data rows are present in this retained preview.</p>'
    # Some delimited files have wider original rows than their chosen header.
    # Show every retained cell; extra cells must never disappear behind zip().
    count = max([len(fields)] + [len(row.get("cells") or []) for row in rows])
    out = ['<div class="scroll" role="region" tabindex="0" aria-label="' +
           _escape(part.get("name", "Original source") + " " + caption) + '"><table class="preview">',
           "<caption>" + _escape(caption) + "</caption><thead><tr>",
           '<th scope="col" class="row-number">Source row</th>']
    for index in range(count):
        field = fields[index] if index < len(fields) else {}
        label = field.get("display") or field.get("label") or "Unlabeled original column " + str(index + 1)
        out.append('<th scope="col">' + _escape(label) + "</th>")
    out.append("</tr></thead><tbody>")
    for row in rows:
        cells = row.get("cells") or []
        out.append('<tr><th scope="row" class="row-number">' + _value(row.get("row")) + "</th>")
        for index in range(count):
            if index >= len(cells):
                cell = '<span class="empty">No cell in this row</span>'
            else:
                cell = _value(cells[index], "Blank")
            out.append("<td>" + cell + "</td>")
        out.append("</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def _part(part, choices, suffix, committed, source_format=None):
    kind = part.get("kind", "document")
    name = part.get("name") or "Original source part"
    out = ['<section class="part" id="part-' + suffix + '"><h3>' + _escape(name) + "</h3>"]
    if part.get("error"):
        error = part["error"]
        out.append('<p class="notice">' + _escape(error.get("message", str(error))) +
                   "</p><p>Keep the original worksheet. Review its header row and inspect again; "
                   "other readable sheets remain available.</p></section>")
        return "".join(out)
    fields = part.get("fields") or []
    rows = part.get("rows") or []
    if kind in ("table", "vector"):
        sample_note = str(len(rows)) + " original rows shown"
        if part.get("more_rows"):
            sample_note += "; additional rows remain in the retained source"
        elif kind == "table" and part.get("more_rows") is False:
            sample_note += "; the reader reached the end after the selected header"
        info = [("Source kind", "Worksheet / table" if kind == "table" else "Geographic layer"),
                ("Header columns" if kind == "table" else "Attribute columns", len(fields)),
                ("Preview coverage", sample_note)]
        if kind == "table":
            workbook = source_format in ("xlsx", "xlsm")
            info.extend([("Worksheet" if workbook else "Table", part.get("sheet") or part.get("name")),
                         ("Header row", part.get("header_row"))])
            if workbook:
                info.append(("Formula reading", "Original cached values"
                             if part.get("formula_mode") == "cached" else "Original formulas"))
        else:
            info.extend([("Original features", part.get("feature_count")),
                         ("Geometry", part.get("geometry")),
                         ("Coordinate system", part.get("crs"))])
        out.append(_pairs(info, "reading"))
        out.append(_sample(part, suffix))
        if part.get("preamble"):
            out.append("<details><summary>Rows before the selected header</summary>" +
                       _sample(part, suffix + "-preamble", part["preamble"], "Original rows before header") +
                       "</details>")
        if fields:
            out.append("<details><summary>Original column names and types</summary>" +
                       '<div class="scroll" role="region" tabindex="0" aria-label="Original column names">'
                       '<table><thead><tr><th scope="col">Column</th><th scope="col">Original name</th>'
                       '<th scope="col">Declared source type</th></tr></thead><tbody>')
            for index, field in enumerate(fields):
                out.append("<tr><td>" + str(index + 1) + "</td><td>" +
                           _value(field.get("label"), "Unnamed") + "</td><td>" +
                           _value(field.get("native_type"), "No column type declared") + "</td></tr>")
            out.append("</tbody></table></div></details>")
    elif kind == "raster":
        out.append(_pairs([
            ("Source kind", "Raster band"), ("Band", part.get("band")),
            ("Columns × rows", str(part.get("width")) + " × " + str(part.get("height"))),
            ("Coordinate system", part.get("crs")), ("Declared units", part.get("declared_unit")),
            ("Pixel value type", part.get("dtype")), ("NoData value", part.get("nodata")),
            ("Native scale", part.get("scale")), ("Native offset", part.get("offset")),
            ("Original bounds", part.get("bounds")),
        ], "reading"))
    else:
        out.append("<p>The complete original document is retained. Open it in its normal application "
                   "to review its contents and intended use.</p>")
    out.append("<h4>Scientific meaning and next use</h4>")
    if choices:
        out.extend(_selection(choice, part, index + 1) for index, choice in enumerate(choices))
    elif committed:
        out.append("<p>This part remains in the original file and was not selected for this saved source edition.</p>")
    else:
        out.append("<p>Review the identifier and display columns, intended scientific role, original units, "
                   "source period and reference in the Original sources workbench. Save an explicitly "
                   "reviewed source edition when those meanings are settled.</p>")
    questions = part.get("questions") or []
    if questions:
        out.append(_list(questions))
    out.append("</section>")
    return "".join(out)


def render_inspection(record, reviewed_selection=None):
    """Return a complete standalone UTF-8 HTML presentation of retained records."""
    if not isinstance(record, dict) or not isinstance(record.get("files"), list):
        raise ValueError("Read the original source intake record before rendering its report")
    choices = [] if reviewed_selection is None else reviewed_selection.get("selections", [])
    if not isinstance(choices, list):
        raise ValueError("The retained reviewed source choices must be a list")
    if reviewed_selection is not None:
        if (reviewed_selection.get("project_id") != record.get("project_id") or
                reviewed_selection.get("inspection_id") != record.get("inspection_id")):
            raise ValueError("The reviewed source meaning belongs to another original inspection")
    files = record["files"]
    parts = [part for file in files for part in (file.get("inspection") or {}).get("parts", [])]
    committed = record.get("action") == "client-source.commit"
    title = record.get("title") or "Original scientific sources"
    status = record.get("state", "unknown")
    out = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
           '<meta name="viewport" content="width=device-width,initial-scale=1">',
           "<title>" + _escape(title) + " — source inspection</title>",
           "<style>" + STYLE + "</style></head><body><main><header>",
           '<div class="brand">TokenJunkieLabs · Ecosystem Sciences workbench</div>',
           '<p class="eyebrow">Original sources · ' + ("Reviewed edition" if committed and status == "complete"
                                                     else "Edition preparation" if committed else "Inspection") + "</p>",
           "<h1>" + _escape(title) + "</h1>",
           '<p class="lead">Read the actual worksheets, layers and bands, then check how each selected source '
           "will be used. Preview values remain as retained by the original reader.</p>",
           '<dl class="facts">']
    for label, value in [("Original files", len(files)), ("Inspected source parts", len(parts)),
                         ("Saved reviewed uses", len(choices)), ("Operation state", status)]:
        out.append("<div><dt>" + _escape(label) + "</dt><dd>" + _value(value) + "</dd></div>")
    out.append("</dl><p>Recorded: " + _value(record.get("completed_at") or record.get("created_at")) + "</p></header>")
    if status != "complete":
        out.append('<p class="notice">This operation is ' + _escape(status) +
                   ". The report shows the retained progress available so far.</p>")
        if record.get("error"):
            out.append("<p>" + _escape(record["error"].get("message", str(record["error"]))) + "</p>")
    out.append("<h2>What is ready to review</h2>")
    if committed and reviewed_selection is not None:
        out.append("<p>" + ("This saved edition retains " if status == "complete" else
                            "This unfinished preparation retains ") + str(len(choices)) +
                   " explicit source choices. Each reviewed use below names its original columns, scientific role "
                   "and recorded interpretation. Context selections remain available for further scientific review.</p>")
    elif committed:
        out.append('<p class="notice">The reviewed mapping is not yet available in this operation. '
                   "Use the current operation status and retained original inspection to continue.</p>")
    else:
        out.append("<p>The file structure and original previews are available below. Scientific role, units and "
                   "period are decisions to review and save in the workbench; the inspection does not infer them "
                   "from column names or sample values.</p>")
    out.append('<div class="scroll" role="region" tabindex="0" aria-label="Original file and worksheet inventory">'
               '<table><thead><tr><th scope="col">Original file</th><th scope="col">Worksheets / layers / bands</th>'
               '<th scope="col">Reading result</th></tr></thead><tbody>')
    for fi, file in enumerate(files):
        names = [str(part.get("name") or "Original part") for part in (file.get("inspection") or {}).get("parts", [])]
        errors = [part for part in (file.get("inspection") or {}).get("parts", []) if part.get("error")]
        outcome = (file["error"].get("message", "Original inspection needs attention") if file.get("error") else
                   (str(len(errors)) + " part(s) need reading choices" if errors else
                    "Original preview available" if file.get("inspection") else "Inspection pending"))
        out.append("<tr><td><a href=\"#file-" + str(fi) + "\">" +
                   _escape(file.get("filename", "Original file")) + "</a></td><td>" +
                   (_list(names) if names else "No parts recorded") + "</td><td>" + _escape(outcome) + "</td></tr>")
    out.append("</tbody></table></div>")
    for fi, file in enumerate(files):
        out.append('<section class="file" id="file-' + str(fi) + '"><h2>' +
                   _escape(file.get("filename", "Original file")) + "</h2>")
        inspection = file.get("inspection") or {}
        out.append("<p>Original format: " + _value(inspection.get("format")) + ".</p>")
        if file.get("error"):
            out.append('<p class="notice">' + _escape(file["error"].get("message", str(file["error"]))) +
                       "</p><p>Keep the complete original. Correct the reading choices or restore its declared "
                       "reader, then inspect the same source again.</p>")
        elif not file.get("inspection"):
            out.append("<p>The original is retained; its inspection has not completed.</p>")
        for pi, part in enumerate(inspection.get("parts", [])):
            selected = [choice for choice in choices
                        if choice.get("file_index") == fi and choice.get("part_index") == pi]
            out.append(_part(part, selected, str(fi) + "-" + str(pi), committed, inspection.get("format")))
        if inspection.get("questions"):
            out.append(_list(inspection["questions"]))
        out.append("</section>")
    out.append("<h2>Continue in the workbench</h2>")
    if record.get("next_steps"):
        out.append(_list(record["next_steps"]))
    elif committed:
        out.append(_list(["Open the saved source edition and its reviewed mapping.",
                          "Select that edition in the appropriate model or Measurements workflow.",
                          "Use the existing Workspace export and restore to reopen the complete originals and choices."]))
    else:
        out.append(_list(["Check the worksheet, header and original preview.",
                          "Select the original ID and display columns and review role, units, period and source reference.",
                          "Save the explicitly reviewed source edition; open the original file from its separate download when needed."]))
    provenance = {"presentation_version": VERSION, "original_operation": record,
                  "reviewed_selection": reviewed_selection}
    out.append('<details class="provenance"><summary>Complete original technical record and reviewed mapping</summary>'
               "<p>These complete retained records include file identities, storage references and all original "
               "metadata. The scientific summary above is a presentation of these values.</p><pre>" +
               _escape(json.dumps(provenance, ensure_ascii=False, indent=2, allow_nan=False)) + "</pre></details>")
    out.append("<footer>TokenJunkieLabs · Original source inspection · Presentation " + VERSION +
               ". Original files and source meanings remain available in the complete Workspace.</footer></main></body></html>")
    return "".join(out).encode("utf-8")


def retained_table_preview(workspace, source):
    """Read the original native preview of an unchanged client worksheet/table.

    New source editions carry this compact native record through source-only
    transfers. Older full Workspaces resolve the same original inspection.
    Projected model CSVs continue through the existing source-info CSV reader.
    """
    from copy import deepcopy
    from model.common import identifier, read_json
    client = source.get("client_source")
    if source.get("kind") != "table" or not isinstance(client, dict) or source.get("field_projection"):
        return None
    choice = client.get("selection") or {}
    saved = client.get("inspection")
    if saved is not None:
        if not isinstance(saved, dict) or saved.get("schema") != "upstate.client-source-preview/v1":
            raise ValueError("Restore the original saved worksheet inspection.")
        if saved.get("source_sha256") != client.get("source_sha256"):
            raise ValueError("The saved worksheet preview belongs to another original file.")
        part = saved.get("part")
        reading = saved.get("options")
        source_format = saved.get("format")
    else:
        key = identifier(client["inspection_id"])
        record = read_json(workspace.root / "client-source-intake" / key / "operation.json")
        if (record.get("id") != key or record.get("project_id") != workspace.project["id"]
                or record.get("action") != "client-source.inspect" or record.get("state") != "complete"):
            raise ValueError("Open the complete original worksheet inspection in this Workspace.")
        fi, pi = choice.get("file_index"), choice.get("part_index")
        files = record.get("files", [])
        if type(fi) is not int or not 0 <= fi < len(files):
            raise ValueError("The saved worksheet has no matching original file position.")
        original = files[fi]
        if (original.get("original", {}).get("sha256") != client.get("source_sha256")
                or original.get("filename") != client.get("filename")):
            raise ValueError("The saved worksheet belongs to another original file.")
        inspection = original.get("inspection") or {}
        parts = inspection.get("parts", [])
        if type(pi) is not int or not 0 <= pi < len(parts):
            raise ValueError("The saved worksheet has no matching original part position.")
        part, reading, source_format = parts[pi], original.get("options"), inspection.get("format")
    if (not isinstance(part, dict) or part.get("kind") != "table" or part.get("error")
            or part.get("name") != client.get("part_name")
            or not isinstance(reading, dict)
            or source.get("body", {}).get("sha256") != client.get("source_sha256")):
        raise ValueError("Restore the matching original table, reading choices and native inspection.")
    original_fields = part.get("fields") or []
    if source.get("original_fields") is not None and source["original_fields"] != original_fields:
        raise ValueError("The retained worksheet columns differ from the saved source edition.")
    rows = part.get("rows") or []
    width = max([len(original_fields)] + [len(row.get("cells") or []) for row in rows])
    columns = []
    for index in range(width):
        field = original_fields[index] if index < len(original_fields) else {}
        # Native display labels include the original column position, preserving
        # duplicate/blank headers. Extra cells remain available and unrenamed.
        label = field.get("display") or field.get("label") or "Unlabeled original column " + str(index + 1)
        if label in columns:
            label += " · original column " + str(index + 1)
        columns.append(label)
    result = {
        "columns": columns,
        "sample": [dict(zip(columns, row.get("cells") or [])) for row in rows],
        "sample_limit": part.get("sample_limit"),
        "sample_row_numbers": [row.get("row") for row in rows],
        "sample_records": deepcopy(rows),
        "original_fields": deepcopy(original_fields),
        "original_worksheet": part.get("sheet"),
        "original_header_row": part.get("header_row"),
        "original_preamble": deepcopy(part.get("preamble") or []),
        "reading_options": deepcopy(reading),
        "source_format": source_format,
        "preview_basis": "retained-original-native-inspection",
    }
    if "more_rows" in part:
        result["more_rows"] = part["more_rows"]
    if source_format in ("xlsx", "xlsm"):
        result["formula_mode"] = part.get("formula_mode", reading.get("formula_mode"))
    return result
