"""Complete agency statements, accounting tables and a portable source handoff."""
from __future__ import annotations

import csv
from decimal import Decimal
import html
import io
import json
import re
from xml.etree import ElementTree as ET
import zipfile

from .store import digest, encoded

X = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def csv_file(headers, rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        cells = []
        for value in row:
            if isinstance(value, Decimal):
                cells.append(format(value, "f"))
            elif isinstance(value, int):
                cells.append(value)
            else:
                value = str(value if value is not None else "")
                # Preserve text as text when opened by common spreadsheet tools.
                cells.append("'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value)
        writer.writerow(cells)
    return b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")


def zip_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, data)
    return stream.getvalue()


def xml_bytes(element):
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def column_name(index):
    value = ""
    while index:
        index, digit = divmod(index - 1, 26)
        value = chr(65 + digit) + value
    return value


def workbook(sheets, minor_units):
    """Write ordinary OOXML tables without adding a spreadsheet dependency."""
    ns = lambda tag: "{" + X + "}" + tag
    files = {}
    workbook_root = ET.Element(ns("workbook"))
    sheet_list = ET.SubElement(workbook_root, ns("sheets"))
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    relationships = ET.Element("Relationships", xmlns=rel_ns)
    types = ET.Element("Types", xmlns="http://schemas.openxmlformats.org/package/2006/content-types")
    ET.SubElement(types, "Default", Extension="rels", ContentType="application/vnd.openxmlformats-package.relationships+xml")
    ET.SubElement(types, "Default", Extension="xml", ContentType="application/xml")
    ET.SubElement(types, "Override", PartName="/xl/workbook.xml",
                  ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
    ET.SubElement(types, "Override", PartName="/xl/styles.xml",
                  ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")
    for index, (name, headers, values) in enumerate(sheets, 1):
        ET.SubElement(sheet_list, ns("sheet"), name=name, sheetId=str(index), attrib={"{"+R+"}id": "rId"+str(index)})
        ET.SubElement(relationships, "Relationship", Id="rId"+str(index), Type=R+"/worksheet",
                      Target="worksheets/sheet"+str(index)+".xml")
        ET.SubElement(types, "Override", PartName="/xl/worksheets/sheet"+str(index)+".xml",
                      ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
        root = ET.Element(ns("worksheet"))
        views = ET.SubElement(root, ns("sheetViews"))
        view = ET.SubElement(views, ns("sheetView"), workbookViewId="0")
        ET.SubElement(view, ns("pane"), ySplit="1", topLeftCell="A2", activePane="bottomLeft", state="frozen")
        widths = ET.SubElement(root, ns("cols"))
        for col in range(1, len(headers)+1):
            ET.SubElement(widths, ns("col"), min=str(col), max=str(col), width="23", customWidth="1")
        sheet_data = ET.SubElement(root, ns("sheetData"))
        for row_number, row in enumerate([headers, *values], 1):
            element = ET.SubElement(sheet_data, ns("row"), r=str(row_number))
            for col, value in enumerate(row, 1):
                cell = ET.SubElement(element, ns("c"), r=column_name(col)+str(row_number))
                if isinstance(value, (Decimal, int)) and len(str(value).replace("-", "").replace(".", "")) <= 15:
                    if isinstance(value, Decimal):
                        cell.set("s", "2")
                    ET.SubElement(cell, ns("v")).text = format(value, "f") if isinstance(value, Decimal) else str(value)
                else:
                    cell.set("t", "inlineStr")
                    if row_number == 1:
                        cell.set("s", "1")
                    inline = ET.SubElement(cell, ns("is"))
                    string = ET.SubElement(inline, ns("t"), attrib={"{http://www.w3.org/XML/1998/namespace}space": "preserve"})
                    string.text = str(value if value is not None else "")
        ET.SubElement(root, ns("autoFilter"), ref="A1:"+column_name(len(headers))+str(len(values)+1))
        files["xl/worksheets/sheet"+str(index)+".xml"] = xml_bytes(root)
    style = ET.Element(ns("styleSheet"))
    formats = ET.SubElement(style, ns("numFmts"), count="1")
    ET.SubElement(formats, ns("numFmt"), numFmtId="164", formatCode="0"+("."+"0"*minor_units if minor_units else ""))
    fonts = ET.SubElement(style, ns("fonts"), count="2")
    normal = ET.SubElement(fonts, ns("font"))
    ET.SubElement(normal, ns("sz"), val="11")
    ET.SubElement(normal, ns("name"), val="Calibri")
    bold = ET.SubElement(fonts, ns("font"))
    ET.SubElement(bold, ns("b"))
    ET.SubElement(bold, ns("sz"), val="11")
    ET.SubElement(bold, ns("name"), val="Calibri")
    fills = ET.SubElement(style, ns("fills"), count="2")
    ET.SubElement(ET.SubElement(fills, ns("fill")), ns("patternFill"), patternType="none")
    ET.SubElement(ET.SubElement(fills, ns("fill")), ns("patternFill"), patternType="gray125")
    ET.SubElement(ET.SubElement(style, ns("borders"), count="1"), ns("border"))
    ET.SubElement(ET.SubElement(style, ns("cellStyleXfs"), count="1"), ns("xf"),
                  numFmtId="0", fontId="0", fillId="0", borderId="0")
    cells = ET.SubElement(style, ns("cellXfs"), count="3")
    for numfmt, font in ((0, 0), (0, 1), (164, 0)):
        ET.SubElement(cells, ns("xf"), numFmtId=str(numfmt), fontId=str(font), fillId="0", borderId="0", xfId="0")
    ET.SubElement(ET.SubElement(style, ns("cellStyles"), count="1"), ns("cellStyle"),
                  name="Normal", xfId="0", builtinId="0")
    ET.SubElement(relationships, "Relationship", Id="rIdStyles", Type=R+"/styles", Target="styles.xml")
    root_rels = ET.Element("Relationships", xmlns=rel_ns)
    ET.SubElement(root_rels, "Relationship", Id="rId1", Type=R+"/officeDocument", Target="xl/workbook.xml")
    files.update({"[Content_Types].xml": xml_bytes(types), "_rels/.rels": xml_bytes(root_rels),
                  "xl/workbook.xml": xml_bytes(workbook_root),
                  "xl/_rels/workbook.xml.rels": xml_bytes(relationships),
                  "xl/styles.xml": xml_bytes(style)})
    return zip_bytes(files)


def agency_statement(record, agency, lines):
    p = record["payload"]
    esc = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    heading = esc(agency["label"]) + " · " + esc(p["period"])
    items = []
    for line in lines:
        for allocation in line["allocations"]:
            if allocation["agency_id"] != agency["id"]:
                continue
            items.append("<tr><td>"+esc(line["source_file"])+"<small>Record "+esc(line["source_row"])+
                "</small></td><td>"+esc(line.get("resource_id") or line.get("description") or "Shared billing scope")+
                "<small>"+esc(line.get("service", ""))+"</small></td><td>"+esc(line.get("charge_type", ""))+
                "</td><td>"+esc(line["rule_id"])+"</td><td class=\"amount\">"+esc(allocation["amount"])+"</td></tr>")
    supersedes = p.get("supersedes")
    correction = ("<p>This statement replaces period revision "+esc(supersedes["revision"])+". "+
                  esc(p.get("correction_reason", ""))+"</p>") if supersedes else ""
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+heading+"</title>"
        "<style>body{font:14px/1.55 Arial,sans-serif;color:#222;background:#fff;margin:42px auto;max-width:1100px;padding:0 24px}"
        "header{border-bottom:2px solid #333;padding-bottom:18px}h1{font-size:25px;font-weight:600;margin:7px 0}"
        "h2{font-size:18px}p{max-width:85ch}small{display:block;color:#666;font-size:11px;overflow-wrap:anywhere}"
        ".meta{display:grid;grid-template-columns:1fr 1fr;gap:5px 30px;margin:24px 0}"
        ".table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}"
        "th,td{border-bottom:1px solid #ccc;text-align:left;vertical-align:top;padding:11px 8px;overflow-wrap:anywhere}"
        "th{background:#eee}.amount{text-align:right;font-variant-numeric:tabular-nums}"
        "tfoot td{font-weight:bold;border-top:2px solid #333}.note{border-left:3px solid #888;padding-left:14px}"
        "@media(max-width:650px){body{margin:20px auto;padding:0 12px}.meta{grid-template-columns:1fr}table{min-width:650px}}"
        "@media print{body{margin:0;max-width:none;padding:0}thead{display:table-header-group}tr{break-inside:avoid}"
        ".table{overflow:visible}table{min-width:0}header{break-after:avoid}}</style></head><body>"
        "<header><small>COMMONS BI · AGENCY COST ALLOCATION</small><h1>"+heading+"</h1>"
        "<p>Monthly agency statement · "+esc(p["currency"])+"</p></header>"
        "<div class=\"meta\"><div>Agency ID: "+esc(agency["id"])+"</div><div>Finance code: "+esc(agency["code"])+
        "</div><div>Statement reference: "+esc(record["id"])+" / revision "+esc(record["revision"])+
        "</div><div>Supplier period: "+esc(p["invoice_status"])+
        "</div><div>Cost basis: "+esc(p["basis"])+"</div><div>Provider allocation view: "+esc(p["allocation_view"])+
        "</div></div>"+correction+"<p class=\"note\">"+esc(p["money_description"])+
        " The allocation uses retained policy revision "+esc(p["policy"]["revision"])+
        " and "+esc(p["minor_units"])+" statement decimal places.</p><div class=\"table\"><table>"
        "<thead><tr><th>Source record</th><th>Resource or shared charge</th><th>Charge</th><th>Allocation rule</th>"
        "<th class=\"amount\">"+esc(p["currency"])+"</th></tr></thead><tbody>"+"".join(items)+
        "</tbody><tfoot><tr><td colspan=\"4\">Agency total</td><td class=\"amount\">"+esc(agency["amount"])+
        "</td></tr></tfoot></table></div><h2>Period notes</h2><p>"+esc(p.get("notes") or "—")+
        "</p><p><small>Reviewed "+esc(p["review"]["at"])+" by "+esc(p["review"]["actor"])+
        ". Finalized "+esc(p["finalization"]["at"])+" by "+esc(p["finalization"]["actor"])+
        ". Original source rows, policy and calculation travel with this statement.</small></p></body></html>").encode("utf-8")


def export_period(billing, record):
    p = record["payload"]
    calculation = json.loads(billing.store.bytes(p["calculation"]["digest"]))
    lines = calculation["lines"]
    files = {
        "period.json": (encoded(record)+"\n").encode(),
        "calculation.json": billing.store.bytes(p["calculation"]["digest"]),
        "policy.json": (encoded(billing.store.get("billing_policy", p["policy"]["id"], p["policy"]["revision"]))+"\n").encode(),
        "agencies.json": (encoded(p["agencies"])+"\n").encode(),
    }
    imports = []
    for ref in p["cost_imports"] + p["usage_imports"]:
        imported = billing.store.get("billing_import", ref["id"], ref["revision"])
        source = imported["payload"]
        imports.append(imported)
        safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", source["file"]["name"])[:150] or "source"
        files["sources/"+ref["id"]+"/"+safe_name] = billing.store.bytes(source["file"]["digest"])
        files["sources/"+ref["id"]+"/normalized.json"] = billing.store.bytes(source["records"]["digest"])
    files["imports.json"] = (encoded(imports)+"\n").encode()
    agency_headers = ["Agency ID", "Agency name", "Finance code", "Agency revision", "Period", "Currency", "Amount", "Cost records"]
    agency_rows = [[a["id"], a["label"], a["code"], a["revision"], p["period"], p["currency"],
                   Decimal(a["amount"]), a["line_count"]] for a in p["agencies"]]
    allocation_headers = ["Agency ID", "Finance code", "Period", "Currency", "Source input", "Source file", "Record ordinal",
                          "Resource ID", "Service", "Charge type", "Rule", "Method", "Weight", "Allocated amount"]
    agency_map = {a["id"]: a for a in p["agencies"]}
    allocations = []
    for line in lines:
        for a in line["allocations"]:
            allocations.append([a["agency_id"], agency_map[a["agency_id"]]["code"], p["period"], p["currency"],
                line["input"]["id"] if line.get("input") else "period-adjustment",
                line["source_file"], line["source_row"], line.get("resource_id", ""), line.get("service", ""),
                line.get("charge_type", ""), line["rule_id"], line["method"], a["weight"], Decimal(a["amount"])])
    source_headers = ["Input", "Source file", "Record ordinal", "Source SHA256", "Resource ID", "Service", "Charge type",
                      "Original amount", "Statement amount", "Rounding", "Currency", "Rule", "Unallocated reason"]
    source_rows = [[line["input"]["id"] if line.get("input") else "period-adjustment", line["source_file"],
        line["source_row"], line.get("source_sha256") or "", line.get("resource_id", ""), line.get("service", ""),
        line.get("charge_type", ""), line["source_amount"], Decimal(line["amount"]), line["rounding"],
        p["currency"], line["rule_id"], line["reason"]] for line in lines]
    summary_headers = ["Field", "Value"]
    summary_rows = [["Period", p["period"]], ["Currency", p["currency"]], ["Statement revision", record["revision"]],
        ["Cost basis", p["basis"]], ["Provider allocation view", p["allocation_view"]],
        ["Supplier period", p["invoice_status"]], ["Source cost", p["totals"]["source"]],
        ["Explicit adjustments", p["totals"]["adjustments"]], ["Rounded total", Decimal(p["totals"]["total"])],
        ["Allocated", Decimal(p["totals"]["allocated"])], ["Unallocated", Decimal(p["totals"]["unallocated"])],
        ["Rounding difference", p["totals"]["rounding"]], ["Cost meaning", p["money_description"]],
        ["Rounding method", calculation["rounding_method"]]]
    files["accounting/agency-totals.csv"] = csv_file(agency_headers, agency_rows)
    files["accounting/allocation-lines.csv"] = csv_file(allocation_headers, allocations)
    files["accounting/source-costs.csv"] = csv_file(source_headers, source_rows)
    files["accounting/monthly-allocation.xlsx"] = workbook([
        ("Summary", summary_headers, summary_rows),
        ("Agencies", agency_headers, agency_rows),
        ("Allocation lines", allocation_headers, allocations),
        ("Source costs", source_headers, source_rows)], p["minor_units"])
    for agency in p["agencies"]:
        prefix = "statements/"+agency["id"]+"/"
        files[prefix+"statement.html"] = agency_statement(record, agency, lines)
        files[prefix+"statement.csv"] = csv_file(allocation_headers,
            [row for row in allocations if row[0] == agency["id"]])
    files["OPEN_FIRST.md"] = (
        "# "+p["label"]+"\n\n"
        "Open statements/<agency-id>/statement.html for the printable agency statement. "
        "Each agency folder also contains its allocation-line CSV. accounting/monthly-allocation.xlsx "
        "contains the complete summary, agency totals, allocations and original cost table.\n\n"
        "The included statement revision is "+str(record["revision"])+". "
        "A correction retains the earlier finalized revision and its original files; use the statement reference "
        "when reconciling a restatement. The supplier invoice period is "+p["invoice_status"]+".\n\n"
        +p["money_description"]+"\n\n"
        "The source cost total is rounded once to the chosen currency precision. Row pennies are assigned by "
        "largest fractional remainder, with original row identity breaking ties. Each row's signed minor units "
        "are then divided by its retained agency weights with agency ID breaking ties. This preserves refunds "
        "and reconciles the full monthly total. Source high-precision amounts and row adjustments are retained.\n\n"
        "sources/ retains every selected original CSV/ZIP and normalized input. imports.json identifies exact "
        "input editions and mappings; policy.json and agencies.json retain the selected policy and agency revisions. "
        "calculation.json contains the complete allocation and any excluded provider internal allocation rows. "
        "Duplicate-looking records in a source remain distinct by source and record ordinal.\n\n"
        "The workbook stores values exceeding Excel's 15-digit numeric precision as text. "
        "Source amount and rounding columns preserve the original decimal text. Currency allocations within "
        "that precision use ordinary numeric cells. CSV text that could be interpreted as a spreadsheet formula "
        "has a leading apostrophe; normalized JSON retains the original text.\n\n"
        "Use the original BI Operator Handoff & recovery view for an encrypted full-workspace backup and restore. "
        "That preserves all period revisions and original operation identities. This selected handoff contains "
        "the finalized period and its complete source closure.\n"
    ).encode("utf-8")
    manifest = {"format": "commons-bi-agency-billback/1", "period": billing.ref(record),
        "files": [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in sorted(files.items())]}
    files["MANIFEST.json"] = (encoded(manifest)+"\n").encode()
    data = zip_bytes(files)
    filename = p["period"]+"-agency-statements-"+record["id"]+"-r"+str(record["revision"])+".zip"
    archive = billing.store.blob(data, filename, "application/zip")
    return {"archive": archive, "files": len(files)}
