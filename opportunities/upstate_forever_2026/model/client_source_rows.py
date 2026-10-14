"""Page and export the complete retained original scientific table.

TokenJunkieLabs. Reuses client_source_files.table_records and its exact reading
choices. No scientific conversion, formula evaluation or reviewed-source mutation.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from .client_source_files import headers, need, options, scalar, table_records

SCHEMA = "upstate.client-source-rows/v1"
PAGE_SIZE = 100
MAX_PAGE_SIZE = 250
MAX_PAGE_BYTES = 4 * 1024 * 1024


def _integer(value, name, minimum, maximum):
    need(type(value) is int and minimum <= value <= maximum,
         "Choose " + name + " between " + str(minimum) + " and " + str(maximum) + ".")
    return value


def _row(record, header_row):
    number = record["row"]
    result = {
        "row": number, "line_start": record["line_start"], "line_end": record["line_end"],
        "kind": "preamble" if number < header_row else "header" if number == header_row else "data",
        "cells": [scalar(value) for value in record["values"]],
    }
    for source, target in (("stored_values", "stored_cells"),
                           ("number_formats", "number_formats"),
                           ("cell_metadata", "cell_metadata")):
        if source in record:
            result[target] = [scalar(value) if source == "stored_values" else value
                              for value in record[source]]
    return result


def _source(path, reading, sheet):
    opts = options(reading)
    iterator = table_records(path, opts, sheet)
    return opts, iterator


def read_rows(path, reading, sheet=None, *, start_row=None, page_size=PAGE_SIZE,
              query="", case_sensitive=False):
    """Return the next full source records, with a stable original-row continuation.

    A search scans the original reader in order. next_row points after the last
    returned physical record, so no duplicate-heading or blank-row information is
    used as identity. A total is supplied only when the real end was encountered.
    """
    opts, iterator = _source(path, reading, sheet)
    start = opts["header_row"] + 1 if start_row is None else _integer(
        start_row, "the first original row", 1, 2_147_483_647)
    limit = _integer(page_size, "rows per page", 1, MAX_PAGE_SIZE)
    need(isinstance(query, str) and len(query) <= 2000, "Enter a search of up to 2,000 characters.")
    need(type(case_sensitive) is bool, "Choose an explicit case-sensitive search setting.")
    needle = query if case_sensitive else query.casefold()
    rows, fields, last_seen, more, body_bytes = [], None, 0, False, 0
    if start <= opts["header_row"]:
        header_reader = table_records(path, opts, sheet)
        try:
            for record in header_reader:
                if record["row"] == opts["header_row"]:
                    fields = headers(record["values"])
                    break
        finally:
            header_reader.close()
    try:
        for original in iterator:
            last_seen = original["row"]
            if last_seen == opts["header_row"]:
                fields = headers(original["values"])
            if last_seen < start:
                continue
            row = _row(original, opts["header_row"])
            if needle:
                values = row["cells"] + row.get("stored_cells", [])
                if not any(needle in (str(value) if case_sensitive else str(value).casefold())
                           for value in values if value is not None):
                    continue
            if len(rows) == limit:
                more = True
                break
            row_bytes = len(json.dumps(row, ensure_ascii=False, allow_nan=False).encode("utf-8"))
            need(row_bytes <= MAX_PAGE_BYTES,
                 "This original row exceeds the readable page size. Download its complete table export or original file.")
            if rows and body_bytes + row_bytes > MAX_PAGE_BYTES:
                more = True
                break
            rows.append(row)
            body_bytes += row_bytes
        need(fields is not None, "The retained header row is beyond the original table.")
        return {
            "schema": SCHEMA, "sheet": sheet, "reading": opts, "fields": fields,
            "start_row": start, "page_size": limit, "query": query, "case_sensitive": case_sensitive,
            "rows": rows, "has_more": more,
            "next_row": rows[-1]["row"] + 1 if more and rows else None,
            "last_scanned_row": last_seen,
            "total_original_rows": None if more else last_seen,
            "source_note": "Original record/worksheet rows and physical CSV lines are retained. "
                           "Displayed zero-padded Excel identifiers and stored values remain separate. "
                           "Formulas are not evaluated; values follow the saved formula-reading choice.",
        }
    finally:
        iterator.close()


def _json_html(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c")


def _offline_start(stream, metadata):
    from html import escape
    source = metadata["original"]
    stream.write('<!doctype html><html lang="en"><meta charset="utf-8">'
                 '<meta name="viewport" content="width=device-width,initial-scale=1">'
                 '<title>Complete original table</title><style>'
                 'body{margin:24px;font:15px Arial,sans-serif;color:#202428;background:white}'
                 'h1{font-size:26px}p{line-height:1.5;overflow-wrap:anywhere}'
                 'button,input,select{font:inherit;padding:9px;border:1px solid #858d94;background:#fff;border-radius:3px}'
                 'form,.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:18px 0}'
                 'label{display:flex;flex-direction:column;gap:6px}'
                 '.ci-scroll{overflow:auto;max-width:100%;border:1px solid #ccd0d3}'
                 'table{border-collapse:collapse;min-width:100%;width:max-content}'
                 'th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #ddd;white-space:pre-wrap;min-width:130px;max-width:500px;overflow-wrap:anywhere}'
                 'th{background:#f0f2f3}caption{text-align:left;padding:10px;font-weight:bold}'
                 'details{margin-top:8px}dd{margin:5px 0 12px}dt{font-weight:bold}'
                 '.ci-row-empty{color:#60676c;font-style:italic}'
                 '@media(max-width:600px){body{margin:12px}button{min-height:44px}}'
                 '@media print{form,.controls{display:none}.ci-scroll{overflow:visible}table{width:100%}th,td{min-width:0;max-width:none;font-size:10px}}'
                 '</style><h1>Complete original table</h1><p>' +
                 escape(str(source.get("filename", "Original file"))) + ' · worksheet ' +
                 escape(str(metadata["sheet"] or "CSV / delimited table")) +
                 '</p><p>Original SHA-256: ' + escape(source["sha256"]) +
                 '</p><p>This file contains every original reader record, including notes, heading and blank rows. '
                 'Search and page locally; no server is needed. Selected-reader and stored Excel values remain separate. '
                 'Formulas follow the saved reading choice and are never evaluated here. The complete original file and '
                 'JSONL export retain source detail; CSV carries the selected-reader values. Print shows the current page.</p>'
                 '<details><summary>Saved source and reading selection</summary><pre>' +
                 escape(json.dumps(metadata, ensure_ascii=False, indent=2)) +
                 '</pre></details><form id="search"><label>Search all original values<input id="query" maxlength="2000" type="search"></label>'
                 '<label><span>Case sensitive</span><input id="case" type="checkbox"></label>'
                 '<button type="submit">Search all rows</button></form>'
                 '<div class="controls"><button id="previous">Previous 100</button><button id="next">Next 100</button>'
                 '<label>Cell values<select id="mode"><option value="displayed">Selected-reader values</option>'
                 '<option value="stored">Stored values</option></select></label></div>'
                 '<p id="status" role="status" aria-live="polite"></p><div id="table"></div>'
                 '<script id="source-selection" type="application/json">' + _json_html(metadata) +
                 '</script><script id="source-rows" type="application/x-ndjson">\n')


def _offline_end(stream, fields):
    source = (Path(__file__).resolve().parents[1] / "operator" / "web" /
              "client_source_rows.mjs").read_text(encoding="utf-8")
    marker = "export function createOriginalTableReader"
    need(marker in source, "The complete original-table reader module is missing.")
    renderer = source.split(marker, 1)[0].replace("export function originalRowsTable", "function originalRowsTable")
    script = "\nconst meta=JSON.parse(document.querySelector('#source-selection').textContent);\nconst lines=document.querySelector('#source-rows').textContent.trim().split('\\n').filter(Boolean);\nconst fields=JSON.parse(document.querySelector('#source-fields').textContent);\nconst q=s=>document.querySelector(s);\nlet start=0,matching=null;\nfunction selected(){if(matching)return matching;return Array.from({length:lines.length},(_,i)=>i);}\nfunction draw(){\n const indices=selected(),page=indices.slice(start,start+100).map(i=>JSON.parse(lines[i]));\n q('#table').innerHTML=originalRowsTable({rows:page,fields},q('#mode').value);\n q('#status').textContent=indices.length+' matching original records of '+lines.length+'; showing '+(page.length?start+1:0)+'–'+(start+page.length)+'.';\n q('#previous').disabled=start===0;q('#next').disabled=start+100>=indices.length;\n}\nq('#search').addEventListener('submit',e=>{\n e.preventDefault();const text=q('#query').value,needle=q('#case').checked?text:text.toLocaleLowerCase();\n matching=needle?lines.map((line,i)=>[JSON.parse(line),i]).filter(([r])=>\n  [...r.cells,...(r.stored_cells||[])].some(value=>value!==null&&(q('#case').checked?String(value):String(value).toLocaleLowerCase()).includes(needle))).map(([,i])=>i):null;\n start=0;draw();\n});\nq('#previous').addEventListener('click',()=>{start=Math.max(0,start-100);draw();});\nq('#next').addEventListener('click',()=>{start+=100;draw();});\nq('#mode').addEventListener('change',draw);\ndraw();\n"
    stream.write('</script><script id="source-fields" type="application/json">' +
                 _json_html(fields) + '</script><script>' + renderer + script +
                 '</script></html>')


def export_table(path, reading, sheet, output_directory, *, identity):
    """Stream every original record to JSONL and an exact selected-reader CSV.

    Both outputs include preamble, the selected header and every later row. JSONL
    retains row roles, physical lines, cell types, stored/displayed variants and
    Excel format metadata. The original workbook/CSV remains the source of truth.
    """
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    selected = options(reading)
    metadata = {
        "schema": "upstate.client-source-table-export/v1",
        "original": identity, "sheet": sheet, "reading": selected,
        "coverage": "Every original reader record, including preamble, header, blank and data rows.",
        "csv_semantics": "Exact selected-reader values in UTF-8 CSV, with original column positions; "
                         "duplicate or blank headings are preserved. CSV does not carry native cell types.",
        "jsonl_semantics": "First line is this source selection; every following line is one complete "
                           "original record with physical line/worksheet positions and retained value metadata.",
    }
    jsonl_path, csv_path = output / "Original_Table_Rows.jsonl", output / "Original_Table_Values.csv"
    opts, iterator = _source(path, selected, sheet)
    count, fields = 0, []
    html_path = output / "Original_Table.html"
    try:
        with jsonl_path.open("x", encoding="utf-8", newline="\n") as jsonl, \
                csv_path.open("x", encoding="utf-8", newline="") as csv_stream, \
                html_path.open("x", encoding="utf-8", newline="\n") as html_stream:
            _offline_start(html_stream, metadata)
            jsonl.write(json.dumps(metadata, ensure_ascii=False, allow_nan=False) + "\n")
            writer = csv.writer(csv_stream)
            for original in iterator:
                row = _row(original, opts["header_row"])
                jsonl.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                writer.writerow(["" if value is None else value for value in row["cells"]])
                html_stream.write(_json_html(row) + "\n")
                if row["kind"] == "header":
                    fields = headers(original["values"])
                count += 1
            _offline_end(html_stream, fields)
        need(count >= opts["header_row"], "The retained header row is beyond the original table.")
        return {
            "schema": "upstate.client-source-table-export-result/v1", "original": identity,
            "sheet": sheet, "reading": opts, "total_original_rows": count,
            "data_rows": max(0, count - opts["header_row"]),
            "files": [html_path, jsonl_path, csv_path],
        }
    finally:
        iterator.close()
