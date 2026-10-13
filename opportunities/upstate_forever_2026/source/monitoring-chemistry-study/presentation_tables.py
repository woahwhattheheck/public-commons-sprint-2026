"""Readable screen and paginated-print tables for retained scientific records.

Render every supplied field and row. Wide screen tables scroll horizontally;
printed tables use labeled column panels with the original row key repeated.
No scientific values, ordering, precision, or source data are changed.
"""
from __future__ import annotations

import html
import json
from collections.abc import Mapping, Sequence

TABLE_CSS = """
.scroll{max-width:100%;overflow-x:auto;margin:18px 0;overscroll-behavior-x:contain}
.scroll:focus-visible{outline:2px solid #333;outline-offset:3px}
.scroll table{margin:0;table-layout:fixed}
.scroll th,.scroll td{word-break:normal;overflow-wrap:anywhere;hyphens:none}
.scroll th{vertical-align:bottom}
.table-note{margin:0 0 8px;font-size:13px;color:#454545}
.print-panels{display:none}
@media(max-width:600px){main{padding:18px}h1{font-size:26px}.scroll th,.scroll td{padding:8px}figure{margin-right:0;min-width:0}.figures{min-width:0}.kv-table col:first-child{width:36%!important}}
@media print{
 @page{size:A4;margin:12mm}
 body{font-size:10pt;line-height:1.35}
 .scroll{overflow:visible;margin:12pt 0}
 .scroll table{width:100%!important;min-width:0!important;font-size:9pt}
 .scroll th,.scroll td{padding:5pt 6pt}
 .scroll col{width:auto!important}
 .kv-table col:first-child{width:27%!important}
 .screen-wide,.table-note{display:none!important}
 .print-panels{display:block}
 .print-panel{margin:14pt 0}
 .print-panel table{table-layout:fixed;width:100%;font-size:8.5pt;line-height:1.3}
 .print-panel th,.print-panel td{padding:5pt;word-break:normal;overflow-wrap:anywhere}
 .print-panel col:first-child{width:20%}
 .print-panel caption{font-size:9pt;font-weight:600;margin-bottom:6pt}
 thead{display:table-header-group}tr{break-inside:avoid}caption{break-after:avoid}
 h2,h3,summary{break-after:avoid}figure{break-inside:avoid;max-height:220mm}
 .figures{display:block}figure{max-width:142mm;margin:12pt auto}
 .print-panel+.print-panel{break-before:auto}
}
"""


def _escape(value: object) -> str:
    if value is None:
        text = "Not supplied"
    elif isinstance(value, bool):
        text = "Yes" if value else "No"
    elif isinstance(value, float):
        text = format(value, ".12g")
    elif isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    else:
        text = str(value)
    return html.escape(text, quote=True)


def _markup(rows: Sequence[Mapping], fields: Sequence[tuple[str, str]],
            caption: str, *, screen: bool = False) -> str:
    widths = [310 if key in {"source_reference", "components", "source_detail", "distribution"}
              else 145 for key, _ in fields]
    kv = len(fields) == 2
    width = "100%" if kv or not screen else str(sum(widths)) + "px"
    cls = "kv-table" if kv else "data-table"
    if kv:
        cols = "<col style='width:27%'><col>"
    elif screen:
        cols = "".join("<col style='width:" + str(w) + "px'>" for w in widths)
    else:
        cols = "<col>" * len(fields)
    return ("<table class='" + cls + "' style='width:" + width + "'>"
            + "<caption>" + _escape(caption) + "</caption><colgroup>" + cols + "</colgroup>"
            + "<thead><tr>" + "".join("<th scope='col'>" + _escape(label) + "</th>" for _, label in fields)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + _escape(row.get(key)) + "</td>" for key, _ in fields)
                      + "</tr>" for row in rows)
            + "</tbody></table>")


def render_table(rows: Sequence[Mapping], fields: Sequence[tuple[str, str]], caption: str) -> str:
    """Keep all original data in a scroll region and legible print panels."""
    if not rows:
        return "<p>No records in this retained result.</p>"
    if not fields:
        raise ValueError("A report table requires at least one field")
    wide = len(fields) > 4
    key_value = len(fields) == 2
    cls = "scroll screen-wide" if wide else "scroll"
    hint = ("<p class='table-note'>Scroll horizontally for all " + str(len(fields))
            + " columns. Printed copies repeat the record key in labeled column panels.</p>") if wide else ""
    table = ("<div class='" + cls + "' tabindex='0' role='region' aria-label='"
             + _escape(caption) + "'>" + hint + _markup(rows, fields, caption, screen=not key_value)
             + "</div>")
    if not wide:
        return table
    # Three data columns plus one repeated original key stay readable on A4.
    groups = [fields[1:][offset:offset + 3] for offset in range(0, len(fields) - 1, 3)]
    panels = []
    for index, group in enumerate(groups):
        panel_caption = caption + ": columns " + str(index + 1) + " of " + str(len(groups))
        panels.append("<div class='print-panel'>" + _markup(rows, [fields[0], *group], panel_caption) + "</div>")
    return table + "<div class='print-panels'>" + "".join(panels) + "</div>"
