"""Analyst report and complete, typed survey exports from a frozen selection."""
from __future__ import annotations
import csv
from decimal import Decimal
from html import escape
import io

from model import clone, encoded

PROPERTY_COLUMNS = ("key", "name", "address", "city", "state", "postal_code", "programs",
                    "target_population", "status", "market_area_membership", "year_built", "year_renovated",
                    "unit_count", "vacant_units", "occupancy_pct_reported", "waitlist", "quality",
                    "neighborhood", "parking", "amenities", "observation_start", "observation_end", "observation_label")
UNIT_COLUMNS = ("key", "bedrooms", "bathrooms", "style", "unit_count", "vacant_units", "sqft_min", "sqft_max",
                "rent_min", "rent_max", "rent_raw", "rent_basis", "rent_period", "currency", "ami_percent",
                "ami_raw", "utilities_owner", "utilities_tenant", "utility_note")


def export_rows(edition, selection):
    choices = {item["property_key"]: item for item in selection["items"]}
    rows = []
    for prop in edition["properties"]:
        item = choices[prop["key"]]
        if item["decision"] == "exclude":
            continue
        for unit in prop["units"]:
            if unit["key"] not in item["unit_keys"]:
                continue
            rows.append({
                "purpose": selection["purpose"], "selection": item["decision"], "selection_reason": item["reason"],
                **{"property_" + key: prop.get(key) for key in PROPERTY_COLUMNS},
                **{"unit_" + key: unit.get(key) for key in UNIT_COLUMNS},
                "property_citations": clone(prop["citations"]), "unit_citations": clone(unit["citations"]),
                "criterion_assessments": clone(item["assessments"]),
            })
    return rows


def csv_text(rows, columns=None):
    columns = columns or (list(rows[0]) if rows else ["purpose", "property_key", "unit_key"])
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\r\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: "" if row.get(key) is None else encoded(row[key]).decode() if isinstance(row[key], (dict, list)) else row[key] for key in columns})
    return stream.getvalue()


def display(value):
    if value is None or value == "":
        return "—"
    if isinstance(value, list):
        return ", ".join(display(x) for x in value) if value else "—"
    if isinstance(value, dict):
        return encoded(value).decode()
    return str(value)


def interval(low, high):
    if low is None and high is None:
        return "—"
    return display(low) if low == high else display(low) + " – " + display(high)


def table(headers, rows):
    return "<div class='table-wrap'><table><thead><tr>" + "".join("<th>" + escape(str(h)) + "</th>" for h in headers) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join("<td>" + escape(display(cell)) + "</td>" for cell in row) + "</tr>" for row in rows
    ) + "</tbody></table></div>"


def md_table(headers, rows):
    def cell(value):
        return display(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")
    return "| " + " | ".join(map(cell, headers)) + " |\n| " + " | ".join("---" for _ in headers) + " |\n" + "".join(
        "| " + " | ".join(map(cell, row)) + " |\n" for row in rows)


def references(citations):
    return "; ".join(c["document_key"] + ", PDF " + display(c.get("pdf_page")) + ", " + display(c.get("printed_page")) + ": " + c["locator"] for c in citations)


def report(service, selection):
    edition = service._record("property_editions", selection["candidate_id"])
    study = service._record("property_studies", selection["study_id"])
    documents = {key: service.document(rid) for key, rid in edition["document_ids"].items()}
    choices = {item["property_key"]: item for item in selection["items"]}
    property_rows, schedule_rows, selection_rows, issue_rows = [], [], [], []
    for prop in edition["properties"]:
        choice = choices[prop["key"]]
        property_rows.append([prop["name"], prop.get("programs"), prop.get("unit_count"), prop.get("vacant_units"),
                              prop.get("occupancy_pct_reported"), prop.get("waitlist"),
                              prop.get("observation_label") or interval(prop.get("observation_start"), prop.get("observation_end")),
                              references(prop["citations"])])
        selection_rows.append([prop["name"], choice["decision"], choice["reason"],
                               "; ".join(k + ": " + v for k, v in choice["assessments"].items()),
                               ", ".join(choice["unit_keys"])])
        for u in prop["units"]:
            schedule_rows.append([prop["name"], u["key"], u.get("bedrooms"), u.get("bathrooms"),
                                  u.get("unit_count"), u.get("vacant_units"), interval(u.get("sqft_min"), u.get("sqft_max")),
                                  u.get("rent_raw") or interval(u.get("rent_min"), u.get("rent_max")),
                                  " / ".join(display(u.get(k)) for k in ("currency", "rent_period", "rent_basis")),
                                  u.get("ami_raw"), u.get("utility_note"), references(u["citations"])])
        for issue in edition["issues"].get(prop["key"], []):
            issue_rows.append([prop["name"], issue, selection["review_snapshot"]["decisions"].get(prop["key"], {}).get("note")])
    total = sum(p["unit_count"] for p in edition["properties"]) if all(p.get("unit_count") is not None for p in edition["properties"]) else None
    vacant = sum(p["vacant_units"] for p in edition["properties"]) if all(p.get("vacant_units") is not None for p in edition["properties"]) else None
    occupancy = str(((Decimal(total - vacant) * 100) / total).quantize(Decimal("0.01"))) if total and vacant is not None else None
    rows = export_rows(edition, selection)
    summary = {"surveyed_properties": len(edition["properties"]), "unit_schedules": len(schedule_rows), "reported_units_total": total,
               "reported_vacant_total": vacant, "occupancy_pct_from_counts": occupancy,
               "occupancy_calculation": "(sum of operating units − sum of vacant units) / sum of operating units × 100; only when every count is present",
               "comparison_purpose": selection["purpose"], "selection_counts": selection["counts"], "exported_unit_schedules": len(rows)}
    sections = [
        ("Property inventory", ["Property", "Programme", "Units", "Vacant", "Reported occupancy %", "Waitlist as reported", "Observation period", "Source"], property_rows),
        ("Original unit and rent schedules", ["Property", "Schedule", "Bedrooms", "Baths", "Units", "Vacant", "Square feet", "Rent as reported", "Rent basis", "AMHI as reported", "Utilities", "Source"], schedule_rows),
        ("Reviewed selection", ["Property", "Use for this purpose", "Reason", "Criteria", "Included schedules"], selection_rows),
        ("Source differences and review", ["Property", "Source detail", "Saved review"], issue_rows),
        ("Published comparison context", ["Purpose", "Property", "Source selected", "Source reason", "Source"], [
            [x["purpose"], x["property_key"], "yes" if x["selected"] else "no", x["reason"], references(x["citations"])] for x in edition["source_comparables"]]),
        ("Source and revision review", ["Record", "Change", "Paths", "Decision", "Operator", "Review note"], [
            [r["name"], r["kind"], ", ".join(r["changed_paths"]), selection["review_snapshot"]["decisions"][r["key"]]["action"],
             selection["review_snapshot"]["decisions"][r["key"]]["operator"], selection["review_snapshot"]["decisions"][r["key"]]["note"]]
            for r in selection["review_snapshot"]["rows"]]),
        ("Retained source documents", ["Document", "Publisher", "Publication date", "Observation label", "Original URL", "SHA-256"], [
            [d["label"], d["metadata"].get("publisher"), d["metadata"].get("published_date"), d["metadata"].get("observation_label"),
             d["metadata"]["url"], d["files"][0]["sha256"]] for d in documents.values()]),
    ]
    intro = [
        ("Study", study["name"]), ("Purpose", selection["purpose"]), ("Subject", study.get("subject", {}).get("name")),
        ("Effective date", study.get("effective_date")), ("Market area", study["market_area"]["name"]),
        ("Boundary", study["market_area"]["boundary_description"]), ("Area selection", study["market_area"].get("selection_notes")),
        ("Selection operator", selection["operator"]), ("Selection notes", selection["note"]), ("Study notes", study.get("notes")),
    ]
    note = ("Observation periods, original rent expressions, currency, rent basis, AMHI status and utility responsibility are carried with each schedule. "
            "The selection is frozen for its stated comparison purpose. Each other purpose retains its own selection. "
            "Source review notes and earlier survey editions remain available in this delivery.")
    body = "<h1>" + escape(selection["label"]) + "</h1>" + table(["Study basis", "Retained value"], intro)
    body += "<p>" + escape(note) + "</p>" + table(["Survey summary", "Value"], list(summary.items()))
    for title, headers, values in sections:
        body += "<h2>" + escape(title) + "</h2>" + table(headers, values)
    body += "<h2>Open original sources</h2><ul>" + "".join(
        "<li><a href='../property-documents/" + d["id"] + "/" + d["files"][0]["path"] + "'>" + escape(d["label"]) + "</a></li>"
        for d in documents.values()) + "</ul>"
    html = ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + escape(selection["label"]) + "</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#1e1e1e;background:#fff;margin:32px auto;padding:0 24px;max-width:1500px}"
            "h1{font-size:26px}h2{margin-top:32px;font-size:19px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#eee}td{max-width:400px;overflow-wrap:anywhere}a{color:inherit}"
            "@media print{body{margin:0;padding:0;font-size:9px}.table-wrap{overflow:visible}h2{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}}</style>" + body + "</html>")
    markdown = "# " + selection["label"] + "\n\n" + md_table(["Study basis", "Retained value"], intro) + "\n" + note + "\n\n"
    markdown += md_table(["Survey summary", "Value"], list(summary.items())) + "\n"
    for title, headers, values in sections:
        markdown += "## " + title + "\n\n" + md_table(headers, values) + "\n"
    return {"schema": "stellar-forge.property-report.v1", "selection_id": selection["id"], "study": study,
            "summary": summary, "rows": rows, "html": html, "markdown": markdown, "sections": sections}
