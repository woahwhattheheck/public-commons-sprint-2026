"""Editable ODF 1.3 narrative from the original scientific report blocks.

Only presentation changes here. All displayed cells are literal strings; the
complete original report-data.json and verified SVG bytes travel inside the ODT.
No office application, scientific model, network client or new writer is used.
"""
from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED, ZIP_STORED

from .common import atomic_bytes, describe_file

FORMAT = "upstate.scientific-report-odt/v1"
MIME = "application/vnd.oasis.opendocument.text"
NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "style": "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    "fo": "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
    "xlink": "http://www.w3.org/1999/xlink",
    "svg": "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
    "meta": "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
    "dc": "http://purl.org/dc/elements/1.1/",
    "manifest": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
}
for _prefix, _uri in NS.items():
    ET.register_namespace(_prefix, _uri)


def _q(name):
    prefix, local = name.split(":", 1)
    return "{" + NS[prefix] + "}" + local


def _xml_text(value):
    value = str(value)
    if any(not (ch in "\t\n\r" or 0x20 <= ord(ch) <= 0xD7FF
                or 0xE000 <= ord(ch) <= 0xFFFD
                or 0x10000 <= ord(ch) <= 0x10FFFF) for ch in value):
        raise ValueError("Scientific editable report contains a non-XML character")
    return value


def _node(parent, tag, attributes=None, text=None):
    child = ET.SubElement(parent, _q(tag),
                          {_q(k): _xml_text(v) for k, v in (attributes or {}).items()})
    if text is not None:
        child.text = _xml_text(text)
    return child


def _root(tag):
    return ET.Element(_q(tag), {_q("office:version"): "1.3"})


def _xml(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _plain_inline(parent, value):
    """ODF text elements retain repeated/leading spaces, tabs and line breaks."""
    value = _xml_text(value)
    for token in re.split(r"(\r\n|\r|\n|\t| +)", value):
        if not token:
            continue
        if token in ("\r\n", "\r", "\n"):
            _node(parent, "text:line-break")
        elif token == "\t":
            _node(parent, "text:tab")
        elif token.startswith(" "):
            _node(parent, "text:s", {"text:c": len(token)})
        elif len(parent):
            parent[-1].tail = (parent[-1].tail or "") + token
        else:
            parent.text = (parent.text or "") + token


def _inline(parent, value):
    # Reuse exactly the maintained link policy and displayed cell conversion.
    from .scientific_report import _cell
    cell = _cell(value)
    if isinstance(cell, dict):
        href = cell["href"]
        # ODF package-relative links address package members. "../" leaves the
        # content.xml package root and resolves beside the .odt, per Part 2 §3.7.
        if not urlsplit(href).scheme:
            href = "../" + href
        anchor = _node(parent, "text:a", {
            "xlink:href": href, "xlink:type": "simple",
            "text:style-name": "Link",
        })
        _plain_inline(anchor, cell["label"])
    else:
        _plain_inline(parent, cell)


def _paragraph(parent, value="", style="Body", *, level=None):
    attrs = {"text:style-name": style}
    if level is not None:
        attrs["text:outline-level"] = level
    element = _node(parent, "text:h" if level is not None else "text:p", attrs)
    _inline(element, value)
    return element


def _style(parent, name, family, *, paragraph=None, text=None, table=None, cell=None):
    result = _node(parent, "style:style", {"style:name": name, "style:family": family})
    for tag, attributes in (("style:paragraph-properties", paragraph),
                            ("style:text-properties", text),
                            ("style:table-properties", table),
                            ("style:table-cell-properties", cell)):
        if attributes:
            _node(result, tag, attributes)
    return result


def _styles():
    root = _root("office:document-styles")
    styles = _node(root, "office:styles")
    normal = _node(styles, "style:default-style", {"style:family": "paragraph"})
    _node(normal, "style:paragraph-properties", {
        "fo:line-height": "120%", "fo:margin-bottom": "0.08in",
        "fo:orphans": "2", "fo:widows": "2",
    })
    _node(normal, "style:text-properties", {
        "fo:font-family": "Liberation Sans", "fo:font-size": "10pt",
        "fo:color": "#171717",
    })
    _style(styles, "Body", "paragraph")
    _style(styles, "Title", "paragraph",
           paragraph={"fo:margin-bottom": "0.16in", "fo:keep-with-next": "always"},
           text={"fo:font-size": "22pt", "fo:font-weight": "bold"})
    _style(styles, "Heading", "paragraph",
           paragraph={"fo:margin-top": "0.18in", "fo:margin-bottom": "0.1in",
                      "fo:keep-with-next": "always"},
           text={"fo:font-size": "14pt", "fo:font-weight": "bold"})
    _style(styles, "Caption", "paragraph",
           paragraph={"fo:margin-top": "0.1in", "fo:keep-with-next": "always"},
           text={"fo:font-size": "9pt"})
    _style(styles, "FigureCaption", "paragraph",
           paragraph={"fo:margin-bottom": "0.14in"},
           text={"fo:font-size": "9pt"})
    _style(styles, "CellText", "paragraph",
           paragraph={"fo:margin-bottom": "0in", "fo:line-height": "115%"},
           text={"fo:font-size": "8.5pt"})
    _style(styles, "HeaderText", "paragraph",
           paragraph={"fo:margin-bottom": "0in", "fo:line-height": "115%"},
           text={"fo:font-size": "8.5pt", "fo:font-weight": "bold"})
    _style(styles, "Cell", "table-cell",
           cell={"fo:border": "0.5pt solid #b0b0b0", "fo:padding": "0.06in",
                 "style:vertical-align": "top", "fo:background-color": "#ffffff"})
    _style(styles, "HeaderCell", "table-cell",
           cell={"fo:border": "0.5pt solid #777777", "fo:padding": "0.06in",
                 "style:vertical-align": "top", "fo:background-color": "#eeeeee"})
    _style(styles, "Link", "text",
           text={"fo:color": "#171717", "style:text-underline-style": "solid",
                 "style:text-underline-width": "auto"})
    _style(styles, "Footer", "paragraph", text={"fo:font-size": "8pt"})
    automatic = _node(root, "office:automatic-styles")
    page = _node(automatic, "style:page-layout", {"style:name": "Page"})
    _node(page, "style:page-layout-properties", {
        "fo:page-width": "8.5in", "fo:page-height": "11in",
        "style:print-orientation": "portrait",
        "fo:margin-top": "0.65in", "fo:margin-bottom": "0.65in",
        "fo:margin-left": "0.7in", "fo:margin-right": "0.7in",
    })
    masters = _node(root, "office:master-styles")
    master = _node(masters, "style:master-page", {
        "style:name": "Standard", "style:page-layout-name": "Page"})
    footer = _node(master, "style:footer")
    paragraph = _paragraph(footer, "Scientific report · ", "Footer")
    _node(paragraph, "text:page-number", {"text:select-page": "current"}, "1")
    return _xml(root)


def _table(parent, automatic, block, number):
    columns, rows = block.get("columns"), block.get("rows")
    if (not isinstance(columns, list)
            or not isinstance(rows, list)
            or any(not isinstance(row, list) or len(row) != len(columns) for row in rows)):
        raise ValueError("Editable report table must retain every original column and cell")
    if not columns:
        _paragraph(parent, str(block.get("caption") or ("Table " + str(number))), "Caption")
        _paragraph(parent, "This original table declares no columns or display cells.", "FigureCaption")
        return
    widths = block.get("widths")
    if widths is None:
        widths = [1.0] * len(columns)
    if (not isinstance(widths, list) or len(widths) != len(columns)
            or any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) or v <= 0 for v in widths)):
        raise ValueError("Editable report table needs positive original column widths")
    banded = len(columns) > 5
    starts = range(0, len(columns), 5) if banded else [0]
    for band, start in enumerate(starts, 1):
        indexes = list(range(start, min(start + 5, len(columns))))
        caption = str(block.get("caption") or ("Table " + str(number)))
        if banded:
            caption += (" — columns " + str(start + 1) + "–" + str(indexes[-1] + 1)
                        + " of " + str(len(columns))
                        + "; row numbers identify the same original rows in each panel.")
        _paragraph(parent, caption, "Caption")
        table_name = "Table%04dPanel%04d" % (number, band)
        _style(automatic, table_name, "table",
               table={"style:width": "7.1in", "table:align": "left",
                      "fo:margin-bottom": "0.1in"})
        table = _node(parent, "table:table", {
            "table:name": table_name, "table:style-name": table_name})
        selected_weights = ([0.45] if banded else []) + [widths[index] for index in indexes]
        # Normalize relative weights without overflowing on individually finite values.
        scale = max(selected_weights)
        scaled = [value / scale for value in selected_weights]
        total = sum(scaled)
        for ordinal, value in enumerate(scaled):
            column_style = table_name + "Col" + str(ordinal + 1)
            style = _style(automatic, column_style, "table-column")
            _node(style, "style:table-column-properties", {
                "style:column-width": format(0.65 + (7.1 - 0.65 * len(scaled)) * value / total, ".8f") + "in"})
            _node(table, "table:table-column", {"table:style-name": column_style})
        head = _node(table, "table:table-header-rows")
        header = _node(head, "table:table-row")
        labels = (["Original row"] if banded else []) + [columns[index] for index in indexes]
        for label in labels:
            cell = _node(header, "table:table-cell", {
                "table:style-name": "HeaderCell", "office:value-type": "string"})
            _paragraph(cell, label, "HeaderText")
        for row_number, source_row in enumerate(rows, 1):
            row = _node(table, "table:table-row")
            values = ([str(row_number)] if banded else []) + [source_row[index] for index in indexes]
            for value in values:
                cell = _node(row, "table:table-cell", {
                    "table:style-name": "Cell", "office:value-type": "string"})
                _paragraph(cell, value, "CellText")
        if not rows:
            _paragraph(parent, "This original table contains no data rows.", "FigureCaption")


def _figure(parent, block, directory, members, figures):
    from .scientific_report import _figure as checked_figure
    figure = checked_figure(block, directory)
    path = (directory / figure["path"]).resolve(strict=True)
    raw = path.read_bytes()
    if len(raw) != figure["bytes"] or sha256(raw).hexdigest() != figure["sha256"]:
        raise ValueError("The original SVG changed during editable report preparation")
    try:
        svg = ET.fromstring(raw)
    except ET.ParseError as error:
        raise ValueError("The retained scientific SVG is not well-formed XML") from error
    if svg.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("The retained scientific figure must be an SVG document")
    if "viewBox" in svg.attrib:
        try:
            bounds = [float(value) for value in re.split(r"[\s,]+", svg.attrib["viewBox"].strip())]
        except ValueError:
            bounds = []
        if len(bounds) != 4 or not all(math.isfinite(v) for v in bounds) or min(bounds[2:]) <= 0:
            raise ValueError("The original scientific SVG needs a finite positive viewBox")
        width, height = bounds[2:]
    else:
        def length(name):
            value = re.fullmatch(r"\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|in|cm|mm)?\s*",
                                 svg.attrib.get(name, ""))
            if value is None:
                raise ValueError("The original scientific SVG needs dimensions or a viewBox")
            result = float(value[1]) * {"px": 1, "pt": 96 / 72, "pc": 16,
                                       "in": 96, "cm": 96 / 2.54,
                                       "mm": 96 / 25.4}[value[2] or "px"]
            if not math.isfinite(result) or result <= 0:
                raise ValueError("The original scientific SVG dimensions must be positive")
            return result
        width, height = length("width"), length("height")
    fit = min(7.1 / width, 8.2 / height)
    member = "Pictures/" + figure["sha256"] + ".svg"
    members[member] = (raw, "image/svg+xml")
    paragraph = _paragraph(parent)
    frame = _node(paragraph, "draw:frame", {
        "draw:name": "Figure" + str(len(figures) + 1), "text:anchor-type": "as-char",
        "svg:width": format(width * fit, ".8f") + "in",
        "svg:height": format(height * fit, ".8f") + "in",
    })
    _node(frame, "svg:title", text=figure.get("title") or figure["alt"])
    _node(frame, "svg:desc", text=figure["alt"])
    _node(frame, "draw:image", {
        "xlink:href": member, "xlink:type": "simple",
        "xlink:show": "embed", "xlink:actuate": "onLoad",
    })
    if figure.get("title"):
        _paragraph(parent, figure["title"], "FigureCaption")
    _paragraph(parent, figure["caption"], "FigureCaption")
    figures.append({**figure, "odt_member": member})


def render_odt(directory, report_data_bytes):
    """Return one whole deterministic ODT from exact retained report-data bytes."""
    from .scientific_report import REPORT_VERSION, _source_block, _relative_link, link
    if not isinstance(report_data_bytes, bytes):
        raise ValueError("Retain the exact original UTF-8 report-data bytes")
    def unique_fields(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("Duplicate field in original scientific report data")
            value[key] = item
        return value
    def finite_json(value):
        raise ValueError("Nonfinite literal in original scientific report data: " + value)
    data = json.loads(report_data_bytes, object_pairs_hook=unique_fields,
                      parse_constant=finite_json)
    if (not isinstance(data, dict) or data.get("schema") != REPORT_VERSION
            or not isinstance(data.get("sections"), list)
            or not isinstance(data.get("contact"), dict)
            or not isinstance(data.get("source_records"), list)
            or not isinstance(data.get("binding"), dict)):
        raise ValueError("Use the complete original scientific report-data document")
    directory = Path(directory).resolve(strict=True)
    root = _root("office:document-content")
    automatic = _node(root, "office:automatic-styles")
    body = _node(root, "office:body")
    document = _node(body, "office:text")
    _paragraph(document, data["title"], "Title")
    presentation = data.get("presentation", {})
    _paragraph(document, presentation.get("subtitle", ""))
    all_sections = [(section["heading"], section["blocks"]) for section in data["sections"]]
    all_sections.append(("Source editions", [_source_block(data["source_records"])]))
    members, figures, tables = {}, [], 0
    for heading, blocks in all_sections:
        if not isinstance(blocks, list):
            raise ValueError("Scientific report sections must retain their ordered blocks")
        _paragraph(document, heading, "Heading", level=1)
        for block in blocks:
            kind = block.get("kind") if isinstance(block, dict) else None
            if kind == "table":
                tables += 1
                _table(document, automatic, block, tables)
            elif kind == "figure":
                _figure(document, block, directory, members, figures)
            elif kind == "links":
                for item in block["items"]:
                    _paragraph(document, link(item["title"], _relative_link(item["path"])))
            else:
                _paragraph(document, block)
    _paragraph(document, presentation.get("footer", ""))
    _paragraph(document, "Original report data", "Heading", level=1)
    _paragraph(document, "This editable copy retains its complete original report data and figure "
               "specifications inside the document package. Text or table edits in an office editor "
               "do not recalculate the scientific results or change the saved Workspace edition. "
               "Keep the complete report ZIP alongside a separately named edited copy.")
    checksum = sha256(report_data_bytes).hexdigest()
    _paragraph(document, "Original report-data.json SHA256: " + checksum)
    source_link = _node(_paragraph(document), "text:a", {
        "xlink:href": "Sources/report-data.json", "xlink:type": "simple",
        "text:style-name": "Link"})
    _plain_inline(source_link, "Complete original report data (embedded JSON)")
    members["Sources/report-data.json"] = (report_data_bytes, "application/json")
    inventory = {
        "schema": FORMAT, "report_schema": data["schema"], "binding": data["binding"],
        "original_report_data": {"path": "Sources/report-data.json",
                                 "bytes": len(report_data_bytes), "sha256": checksum},
        "figures": figures, "table_count": tables,
        "table_layout": "Original column order; at most five source columns per panel; "
                        "original row ordinals on wider tables; all cells retained as literal text",
        "source_precision": data.get("display_precision"),
    }
    members["Sources/edition.json"] = (
        (json.dumps(inventory, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"),
        "application/json")
    meta = _root("office:document-meta")
    metadata = _node(meta, "office:meta")
    _node(metadata, "meta:generator", text="TJLabs scientific report / " + FORMAT)
    _node(metadata, "dc:title", text=data["title"])
    creator = " · ".join(str(data["contact"].get(key) or "").strip()
                         for key in ("name", "organization") if data["contact"].get(key))
    if creator:
        _node(metadata, "dc:creator", text=creator)
    _node(metadata, "meta:user-defined", {
        "meta:name": "Original report-data SHA256", "meta:value-type": "string"}, checksum)
    members.update({"content.xml": (_xml(root), "text/xml"),
                    "styles.xml": (_styles(), "text/xml"),
                    "meta.xml": (_xml(meta), "text/xml")})
    manifest = ET.Element(_q("manifest:manifest"), {_q("manifest:version"): "1.3"})
    _node(manifest, "manifest:file-entry", {
        "manifest:full-path": "/", "manifest:media-type": MIME,
        "manifest:version": "1.3"})
    for name, (_, media_type) in sorted(members.items()):
        _node(manifest, "manifest:file-entry", {
            "manifest:full-path": name, "manifest:media-type": media_type})
    members["META-INF/manifest.xml"] = (_xml(manifest), "text/xml")
    output = BytesIO()
    with ZipFile(output, "w", allowZip64=True) as archive:
        for name, raw, compression in [("mimetype", MIME.encode("ascii"), ZIP_STORED)] + [
                (name, value[0], ZIP_DEFLATED) for name, value in sorted(members.items())]:
            info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = compression
            info.external_attr = 0o100600 << 16
            archive.writestr(info, raw)
    return output.getvalue()


def write_odt(directory, report_data_bytes):
    """Publish through the original report's atomic file/descriptor contract."""
    directory = Path(directory)
    if (directory / "report-data.json").read_bytes() != report_data_bytes:
        raise ValueError("Use the exact saved scientific report-data.json bytes")
    path = directory / "report.odt"
    atomic_bytes(path, render_odt(directory, report_data_bytes))
    return describe_file(directory, path)
