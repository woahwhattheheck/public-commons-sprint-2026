"""MIT. Intrinio review functions executed by the original SF30 Python worker.

All state is selected source in the original Python workspace. This module only
reads that immutable materialized revision; it does not acquire data or save state.
"""
from __future__ import annotations

import hashlib
import html
import json
from pathlib import Path, PurePosixPath

from intrinio_review.model import ReviewError, canonical, compare_responses, csv_cell
from intrinio_review.domain import (SCHEMA as INDEX_SCHEMA, INDEX, index_document, read_document,
                                    snapshot as domain_snapshot, normalized_record, pointer)

ROOT = Path(__file__).resolve().parent
PAGE_BYTES = 650000


def _index():
    return index_document(read_document(ROOT))


def _snapshot(edition_id):
    return domain_snapshot(ROOT, edition_id)


def _plain_row(row):
    value = {key: item for key, item in row.items() if key not in ("provider_row", "dimensions")}
    value["dimensions"] = row["identity_fields"]["dimensions"]
    return value


def _page(rows, offset, limit):
    if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= 100:
        raise ReviewError("PAGE", "Choose an offset at or above zero and a page size from 1 to 100.")
    selected, used = [], 0
    for row in rows[offset:offset + limit]:
        size = len(canonical(row).encode("utf-8"))
        if used + size > PAGE_BYTES:
            if not selected:
                raise ReviewError("ROW_PREVIEW_SIZE", "This one row exceeds the original worker preview size. Download its complete original response from Source.")
            break
        selected.append(row)
        used += size
    next_offset = offset + len(selected)
    return {"rows": selected, "offset": offset, "returned": len(selected), "total": len(rows),
            "next_offset": next_offset if next_offset < len(rows) else None}


def _result(function, supplied):
    try:
        return {"ok": True, **function(supplied)}
    except ReviewError as error:
        return {"ok": False, "error": {"code": error.code, "message": str(error)}}


def list_editions(supplied):
    def run(_):
        state = _index()
        return {"schema": INDEX_SCHEMA, "captures": state["captures"],
                "editions": list(state["editions"].values()), "reviews": state["reviews"],
                "projections": list(state["projections"].values())}
    return _result(run, supplied)


def inspect_statement(supplied):
    def run(value):
        state, record, snapshot = _snapshot(value["edition_id"])
        review = state["reviews"].get(record["id"], {"revision": 0, "decisions": {}, "notes": "", "title": record["label"]})
        search = value.get("search", "").casefold()
        review_status = value.get("review_status", "all")
        if review_status not in ("all", "open", "confirmed", "question", "excluded"):
            raise ReviewError("REVIEW_STATUS", "Choose a supported review status.")
        if snapshot["facts"]:
            rows = []
            for fact in snapshot["facts"]:
                decision = review["decisions"].get(fact["id"], {"status": "open", "note": ""})
                if review_status != "all" and decision["status"] != review_status:
                    continue
                if search and search not in " ".join(str(item) for item in (fact["tag"], fact["name"], fact["unit"], fact["value"], canonical(fact["identity_fields"]["dimensions"]))).casefold():
                    continue
                rows.append({**_plain_row(fact), "review": decision})
        else:
            rows = [{"provider_row": row, "source_pointer": "/" + ("dimensions" if snapshot["family"] == "dimensions" else "fundamentals" if snapshot["family"] == "fundamentals" else "filings") + "/" + str(index)}
                    for index, row in enumerate(snapshot["catalog"]) if not search or search in canonical(row).casefold()]
        page = _page(rows, value.get("offset", 0), value.get("limit", 50))
        metadata = {key: item for key, item in snapshot.items() if key not in ("facts", "catalog", "provider_metadata")}
        return {"edition": record, "snapshot": metadata, "review": {key: item for key, item in review.items() if key != "decisions"},
                "total_facts": len(snapshot["facts"]), "total_catalog_records": len(snapshot["catalog"]),
                "page": page}
    return _result(run, supplied)


def compare_statements(supplied):
    def run(value):
        _, left_record, left = _snapshot(value["left_id"])
        _, right_record, right = _snapshot(value["right_id"])
        state = _index()
        binding = next((item for item in state["document"]["comparisonBindings"]
                        if item["id"] == value.get("binding_id")
                        and item["fromEditionId"] == left_record["editionId"]
                        and item["toEditionId"] == right_record["editionId"]), None)
        comparison = compare_responses(left, right, mode=value.get("mode", "revision"), binding=binding)
        if not comparison["compatible"]:
            return {"comparison": comparison, "page": None}
        changes = []
        for change in comparison["changes"]:
            if value.get("changes_only", True) and change["status"] == "unchanged":
                continue
            changes.append({**change, "before": [_plain_row(row) for row in change["before"]],
                            "after": [_plain_row(row) for row in change["after"]]})
        return {"left_edition": left_record, "right_edition": right_record,
                "comparison": {key: item for key, item in comparison.items() if key != "changes"},
                "page": _page(changes, value.get("offset", 0), value.get("limit", 50))}
    return _result(run, supplied)


def validate_review(supplied):
    def run(value):
        state, record, snapshot = _snapshot(value["edition_id"])
        current = state["reviews"].get(record["id"], {"revision": 0, "decisions": {}})
        if value["expected_revision"] != current["revision"]:
            raise ReviewError("REVIEW_CHANGED", "The retained review revision changed.")
        candidate = value["decisions"]
        valid = {row["id"] for row in snapshot["facts"]}
        if any(key not in valid or item.get("status") not in ("open", "confirmed", "question", "excluded")
               or not isinstance(item.get("note", ""), str) or len(item.get("note", "")) > 10000
               for key, item in candidate.items()):
            raise ReviewError("REVIEW_IDENTITY", "A decision is not attached to a fact in this exact original response.")
        return {"validated": {"edition_id": record["id"], "source_sha256": record["sha256"],
                              "review_revision": current["revision"], "decision_count": len(candidate)}}
    return _result(run, supplied)


def validate_selection(supplied):
    def run(value):
        state, record, snapshot = _snapshot(value["edition_id"])
        current = state["reviews"].get(record["id"], {"revision": 0, "decisions": {}})
        if value["expected_revision"] != current["revision"]:
            raise ReviewError("REVIEW_CHANGED", "Choose the currently retained review revision.")
        selected = value["row_ids"]
        valid = {row["id"] for row in snapshot["facts"]}
        columns = value.get("columns", state["document"]["export"]["columns"])
        if not isinstance(columns, dict) or not 1 <= len(columns) <= 100:
            raise ReviewError("COLUMN_MAP", "Choose 1–100 explicit customer columns.")
        for name, path in columns.items():
            if not isinstance(name, str) or not name or len(name) > 160:
                raise ReviewError("COLUMN_MAP", "Customer column labels must be explicit text.")
            pointer({}, path)
        if not selected or len(selected) != len(set(selected)) or any(key not in valid for key in selected):
            raise ReviewError("SELECTION_IDENTITY", "Choose distinct facts from this exact original response.")
        return {"validated": {"edition_id": record["id"], "source_sha256": record["sha256"],
                              "review_revision": current["revision"], "selected_count": len(selected)}}
    return _result(run, supplied)

def validate_comparison(supplied):
    def run(value):
        _, left_record, left = _snapshot(value["left_id"])
        _, right_record, right = _snapshot(value["right_id"])
        binding = {"fromEditionId": left_record["editionId"], "toEditionId": right_record["editionId"],
                   "fromFundamentalId": (left["fundamental"] or {}).get("id"),
                   "toFundamentalId": (right["fundamental"] or {}).get("id"),
                   "reviewer": value["reviewer"], "note": value["note"],
                   "fromSourceSha256": left_record["sha256"], "toSourceSha256": right_record["sha256"],
                   "mode": value.get("mode", "revision")}
        result = compare_responses(left, right, mode=binding["mode"], binding=binding)
        if not result["compatible"]:
            raise ReviewError("COMPARISON_CONTEXT", result["reason"])
        return {"validated": {"binding": binding}}
    return _result(run, supplied)


def _projection(projection_id):
    state = _index()
    projection = state["projections"].get(projection_id)
    if not isinstance(projection, dict):
        raise ReviewError("PROJECTION_NOT_FOUND", "Choose a saved customer extract in this exact revision.")
    _, edition, snapshot = _snapshot(projection["editionId"])
    selected = set(projection["rowIds"])
    facts = [row for row in snapshot["facts"] if row["id"] in selected]
    if len(facts) != len(selected):
        raise ReviewError("PROJECTION_SOURCE_CHANGED", "The saved selection no longer matches every original fact.")
    rows = [normalized_record(row, snapshot, edition, projection["review"]["decisions"].get(row["id"])) for row in facts]
    columns = projection.get("columns", state["document"]["export"]["columns"])
    mapped = [{"recordId": row["id"], "cells": {name: pointer(row, path) for name, path in columns.items()}} for row in rows]
    safe_source = {key: snapshot["source"].get(key) for key in
                   ("kind", "sourceKind", "id", "body_sha256", "body_bytes", "url", "retrieved_at", "originalWireBytes")}
    return {"schema": "stellar-forge.intrinio-extract.v1",
            "projection": {key: item for key, item in projection.items() if key not in ("source",)},
            "edition": {"id": edition["editionId"], "sourceId": edition["responseId"], "sha256": edition["sha256"]},
            "columns": columns, "rows": mapped,
            "snapshot": {**{key: item for key, item in snapshot.items() if key not in
                            ("provider_metadata", "facts", "catalog", "source", "collection_coverage")},
                         "facts": [_plain_row(row) for row in facts], "source": safe_source,
                         "collection_coverage": {key: item for key, item in snapshot["collection_coverage"].items()
                                                if key not in ("acquisition", "observations")}}}


def export_selection_json(supplied):
    return _result(lambda value: _projection(value["projection_id"]), supplied)


def export_selection_csv(supplied):
    result = _projection(supplied["projection_id"])
    import csv
    import io
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    columns = result["columns"]
    writer.writerow([csv_cell(name) for name in columns])
    for row in result["rows"]:
        cells = []
        for name in columns:
            cell = row["cells"][name]
            value = cell["value"] if cell["present"] else ""
            if isinstance(value, (dict, list)):
                value = canonical(value)
            cells.append(csv_cell(value, exact_number=columns[name] == "/valueText"))
        writer.writerow(cells)
    return output.getvalue().encode("utf-8-sig")


def export_selection_html(supplied):
    result = _projection(supplied["projection_id"])
    projection, snapshot = result["projection"], result["snapshot"]
    escape = lambda value: html.escape("" if value is None else str(value), quote=True)
    facts = []
    for row in snapshot["facts"]:
        decision = projection["review"]["decisions"].get(row["id"], {"status": "open", "note": ""})
        dimensions = canonical(row["dimensions"])
        facts.append("<tr><td>" + escape(row["tag"]) + "<small>" + escape(row["name"]) + "</small></td><td class=value>" +
                     escape(row["value"]) + "</td><td>" + escape(row["unit"]) + "</td><td>" + escape(dimensions) +
                     "</td><td>" + escape(decision["status"]) + "<small>" + escape(decision.get("note", "")) + "</small></td></tr>")
    fundamental, company = snapshot.get("fundamental") or {}, snapshot.get("company") or {}
    context = " · ".join(str(value) for value in (company.get("name") or company.get("id"), fundamental.get("statement_code"),
                                                  fundamental.get("fiscal_year"), fundamental.get("fiscal_period")) if value is not None)
    document = ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                "<title>" + escape(projection["title"]) + "</title><style>"
                "body{font:15px/1.5 system-ui,sans-serif;color:#181818;max-width:1250px;margin:36px auto;padding:0 24px}"
                "h1{font-size:25px}table{border-collapse:collapse;width:100%}th,td{text-align:left;border:1px solid #bbb;padding:8px;vertical-align:top}"
                "th{background:#eee}small{display:block;color:#555}.value{font-family:ui-monospace,monospace;white-space:nowrap}"
                "pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;padding:12px}.notes{white-space:pre-wrap}"
                "@media print{body{margin:0;max-width:none}table{font-size:10px}tr{break-inside:avoid}}</style><main><h1>" +
                escape(projection["title"]) + "</h1><p>" + escape(context) + "</p><p>Saved " + escape(projection["createdAt"]) +
                " by " + escape(projection["actor"]) + " · review revision " + str(projection["review"]["revision"]) +
                "</p><p class=notes>" + escape(projection["notes"]) + "</p><table><thead><tr><th>Original fact</th><th>Exact value</th><th>Unit</th><th>Dimensions</th><th>Review</th></tr></thead><tbody>" +
                "".join(facts) + "</tbody></table><h2>Source and coverage</h2><p>Source class: " +
                escape(snapshot["source"]["kind"]) + " · " + escape(snapshot["coverage"]["status"]) +
                ". This saved extract contains selected original facts. Missing facts were not treated as zero.</p><pre>" +
                escape(json.dumps({"source": snapshot["source"], "fundamental": snapshot["fundamental"], "coverage": snapshot["coverage"]}, ensure_ascii=False, indent=2)) +
                "</pre><h2>Retained review notes</h2><p class=notes>" + escape(projection["review"]["notes"]) + "</p></main></html>")
    return document.encode("utf-8")


def inspect_fundamentals(supplied):
    """Original source ABI entry: inventory or one exact retained statement view."""
    return inspect_statement(supplied) if supplied.get("edition_id") else list_editions(supplied)


def build_fundamentals(supplied):
    """Complete named edition projection; original output limits fail visibly."""
    def run(value):
        state = _index()
        edition_id = value.get("edition_id") or state["document"].get("selectedEdition")
        edition = next((item for item in state["document"]["editions"] if item["id"] == edition_id), None)
        if edition is None:
            raise ReviewError("EDITION_NOT_FOUND", "Choose an original retained edition ID.")
        records, coverage, context, cache = [], [], [], {}
        for key, record in state["editions"].items():
            if record["editionId"] != edition_id:
                continue
            _, _, data = domain_snapshot(ROOT, key, cache)
            review = state["reviews"][key]
            records.extend(normalized_record(fact, data, record, review["decisions"].get(fact["id"])) for fact in data["facts"])
            coverage.append({"sourceId": record["responseId"], "response": data["coverage"], "collection": data["collection_coverage"]})
            if not data["facts"]:
                context.append({"sourceId": record["responseId"], "kind": record["operation"], "records": data["catalog"],
                                "company": data["company"], "fundamental": data["fundamental"], "filing": data["filing"]})
        return {"schema": "tj.intrinio-fundamentals-build.v1", "editionId": edition_id, "scope": edition["scope"],
                "records": records, "context": context, "coverage": coverage, "acquisition": edition.get("acquisition"),
                "reviewHistory": [item for item in state["document"]["reviews"] if item["editionId"] == edition_id],
                "comparisonBindings": state["document"]["comparisonBindings"]}
    return _result(run, supplied)


def customer_fundamentals(supplied):
    """Customer-visible saved projection, separate from private operator export."""
    return export_selection_json(supplied)
