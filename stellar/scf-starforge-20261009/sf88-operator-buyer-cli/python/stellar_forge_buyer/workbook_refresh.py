"""Review and save a new workbook edition from complete retained result sources.

The original workbook store supplies definition CAS, request identities, typed
projection and complete delivery. This module never executes a query or purchase.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime
import json

from .analysis_reports import AnalysisReports
from .analysis_workbooks import _error, _hash, _id, _json, _page, _source_key, _text, _unpack, project_cell
from .errors import BuyerError
from .query_export import QueryExport, _bindings
from .storage import digest, parse

_SCHEMA = "stellar-forge.workbook-refresh-review.v1"
_ORIGIN = "stellar-forge.workbook-refresh-origin.v1"


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


class WorkbookRefresh:
    def __init__(self, workbooks):
        self.workbooks = workbooks
        self.database = workbooks.database

    def _base(self, name, revision, sha=None):
        if type(revision) is not int or revision < 1:
            _error("REFRESH_BASE_REVISION_REQUIRED")
        result = self.workbooks.definition(name, revision=revision)
        if sha is not None and _hash(sha) != result["definition_sha256"]:
            _error("REFRESH_BASE_CHANGED")
        return result

    def _lineage(self, source):
        current = self.workbooks.source(source)
        if current != source:
            _error("SOURCE_CHANGED")
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            if source["kind"] == "query-export":
                row = db.execute("SELECT sequence,request,finished_at FROM sf_analysis_jobs WHERE id=? AND kind='query-export' AND status='COMPLETE'",
                                 (source["id"],)).fetchone()
                if row is None:
                    _error("COMPLETE_TYPED_QUERY_EXPORT_REQUIRED")
                request = parse(row["request"].encode())
                manifest = QueryExport(self.database.directory / "analysis-query-exports" / source["id"]).manifest
                binding = manifest["binding"]
                return {"kind": "query-export", "sequence": row["sequence"], "completed_at": row["finished_at"],
                        "query_id": request.get("query_id"), "sql": binding["sql"], "parameters": binding["parameters"],
                        "views": binding["views"], "read_tables": binding["readTables"],
                        "source_versions": binding["sourceVersions"], "binding_sha256": manifest["bindingSha256"]}
            row = db.execute("SELECT * FROM sf_analysis_report_publications WHERE id=?", (source["id"],)).fetchone()
            publication = _unpack(row)
            publication, report = self.workbooks.reports._export_input(
                db, {"publication_id": source["id"], "publication_sha256": source["sha256"]})
            section = report["sections"][source["section"]]
            selected = report["definition"]["sections"][source["section"]]
            return {"kind": "report", "sequence": row["sequence"], "completed_at": publication["published_at"],
                    "report_name": publication["name"], "publication_revision": publication["revision"],
                    "definition_revision": publication["definition_revision"], "section": section["ordinal"],
                    "query_name": section["query_name"], "query_revision": section["query_revision"],
                    "query_sha256": section["query_sha256"], "sql": selected["query"]["sql"],
                    "parameters": _bindings(self.workbooks.reports.parse_parameters(section["parameters_text"])),
                    "query_sections": [s["ordinal"] for s in report["sections"] if s["query_name"] == section["query_name"]],
                    "views": report["views"], "read_tables": section["read_tables"], "source_versions": report["sources"]}

    @staticmethod
    def _match(before, after):
        if before["kind"] != after["kind"] or after["sequence"] <= before["sequence"]:
            return None
        if before["kind"] == "query-export":
            if before["sql"] == after["sql"] and _canonical(before["parameters"]) == _canonical(after["parameters"]):
                return "Exact original SQL and typed parameters"
            return None
        if before["report_name"] != after["report_name"] or before["query_name"] != after["query_name"]:
            return None
        if len(before["query_sections"]) == len(after["query_sections"]) == 1:
            return "Same saved report and uniquely identified saved query"
        if before["section"] == after["section"]:
            return "Same saved report, saved query and repeated-section position"
        return None

    @staticmethod
    def _comparison(before, after, old_lineage, new_lineage):
        old_names, new_names = before["columns"], after["columns"]
        old_counts, new_counts = Counter(old_names), Counter(new_names)
        return {"rows_before": before["row_count"], "rows_after": after["row_count"],
                "columns_before": old_names, "columns_after": new_names,
                "added_labels": list((new_counts - old_counts).elements()),
                "removed_labels": list((old_counts - new_counts).elements()),
                "duplicate_labels_before": [name for name, count in old_counts.items() if count > 1],
                "duplicate_labels_after": [name for name, count in new_counts.items() if count > 1],
                "column_order_changed": old_names != new_names,
                "sql_changed": old_lineage["sql"] != new_lineage["sql"],
                "parameters_changed": _canonical(old_lineage["parameters"]) != _canonical(new_lineage["parameters"]),
                "views_changed": _canonical(old_lineage["views"]) != _canonical(new_lineage["views"]),
                "source_versions_changed": _canonical(old_lineage["source_versions"]) != _canonical(new_lineage["source_versions"]),
                "section_moved": old_lineage.get("section") != new_lineage.get("section")}

    @staticmethod
    def _suggest_columns(sheet, source):
        result, unresolved = [], []
        for index, column in enumerate(sheet["columns"]):
            value = dict(column)
            positions = [i for i, name in enumerate(source["columns"]) if name == column["source"]]
            if len(positions) == 1 and sheet["source"]["columns"].count(column["source"]) == 1:
                value["source"] = source["columns"][positions[0]]
                if source["kind"] == "report":
                    value["source_index"] = positions[0]
                else:
                    value.pop("source_index", None)
            else:
                value["source"] = ""
                if source["kind"] == "report":
                    value["source_index"] = -1
                else:
                    value.pop("source_index", None)
                unresolved.append({"column": index, "header": column["header"], "old_source": column["source"],
                                   "reason": "Choose a source position for this repeated label." if positions else "Choose a replacement column or remove this Excel column."})
            result.append(value)
        return result, unresolved

    def candidates(self, name, *, revision, sheet=0, before=None, limit=25):
        _page(before, limit)
        base = self._base(name, revision)
        sheets = base["definition"]["sheets"]
        if type(sheet) is not int or not 0 <= sheet < len(sheets):
            _error("REFRESH_SHEET_REQUIRED")
        selected = sheets[sheet]
        lineage = self._lineage(selected["source"])
        with self.database._connection(readonly=True) as db:
            if lineage["kind"] == "query-export":
                rows = db.execute("SELECT sequence,id FROM sf_analysis_jobs WHERE kind='query-export' AND status='COMPLETE' AND sequence>? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                                  (lineage["sequence"], before, before, limit + 1)).fetchall()
            else:
                rows = db.execute("SELECT sequence,id,job_id FROM sf_analysis_report_publications WHERE name=? AND sequence>? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                                  (lineage["report_name"], lineage["sequence"], before, before, limit + 1)).fetchall()
        items, unavailable = [], []
        for row in rows[:limit]:
            requests = [{"kind": lineage["kind"], "id": row["id"]}]
            if lineage["kind"] == "report":
                with self.database._connection(readonly=True) as db:
                    report = AnalysisReports._report(db, row["job_id"])
                requests = [{"kind": "report", "id": row["id"], "section": s["ordinal"]} for s in report["sections"]]
            for request in requests:
                try:
                    source = self.workbooks.source(request)
                    candidate = self._lineage(source)
                except BuyerError as exc:
                    unavailable.append({"source": request, "error": exc.code})
                    continue
                basis = self._match(lineage, candidate)
                if basis is None:
                    continue
                columns, unresolved = self._suggest_columns(selected, source)
                items.append({"source": source, "lineage": candidate, "match_basis": basis,
                              "comparison": self._comparison(selected["source"], source, lineage, candidate),
                              "suggested_columns": columns, "unresolved_columns": unresolved})
        return {"name": name, "revision": revision, "definition_sha256": base["definition_sha256"],
                "sheet": sheet, "current_source": selected["source"], "current_lineage": lineage, "items": items,
                "unavailable": unavailable, "scanned_results": min(limit, len(rows)),
                "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

    def _preview(self, sheet, limit=20):
        keys = [_source_key(sheet["source"], column) for column in sheet["columns"]]
        rows, failures, observed = [], [], [set() for _ in keys]
        with self.workbooks._rows(sheet["source"]) as stream:
            for row_number, row in enumerate(stream, 1):
                values = []
                for index, (column, key) in enumerate(zip(sheet["columns"], keys)):
                    value = row[key]
                    observed[index].add("null" if value is None else "boolean" if type(value) is bool else
                                        "integer" if type(value) is int else "number" if type(value) is float else
                                        "binary" if isinstance(value, bytes) else "text")
                    try:
                        projected, number_format, conversion = project_cell(value, column)
                        display = (projected.isoformat() if isinstance(projected, (date, datetime))
                                   else str(projected) if type(projected) is int and abs(projected) >= 2**53 else projected)
                        values.append({"value": display, "format": number_format, "conversion": conversion,
                                       "excel_type": "blank" if projected is None else "text" if isinstance(projected, str) else
                                       "date" if isinstance(projected, (date, datetime)) else "boolean" if type(projected) is bool else "number"})
                    except BuyerError as exc:
                        failures.append({"row": row_number, "column": index, "header": column["header"], "error": exc.code})
                        values.append({"error": exc.code})
                rows.append(values)
                if row_number >= limit:
                    break
        return {"rows": rows, "errors": failures, "row_count": sheet["source"]["row_count"],
                "observed_types": [{"header": column["header"], "types": sorted(kinds)}
                                   for column, kinds in zip(sheet["columns"], observed)],
                "preview_only": len(rows) < sheet["source"]["row_count"]}

    def review(self, name, request, *, preview=True):
        if not isinstance(request, dict):
            _error("REFRESH_REQUEST_REQUIRED")
        base = self._base(name, request.get("base_revision"), request.get("definition_sha256"))
        expected = request.get("expected_revision")
        if type(expected) is not int or expected < base["definition"]["revision"]:
            _error("REVISION_REQUIRED")
        reason = _text(request.get("reason", ""), 8000, required=True)
        proposed = request.get("definition")
        if not isinstance(proposed, dict) or proposed.get("name") != name:
            _error("REFRESH_DEFINITION_REQUIRED")
        normalized = self.workbooks.compose(name, proposed)
        original = base["definition"]
        if len(original["sheets"]) != len(normalized["sheets"]):
            _error("REFRESH_KEEP_WORKSHEET_POSITIONS")
        changes, previews = [], []
        for index, (old, new) in enumerate(zip(original["sheets"], normalized["sheets"])):
            same = old["source"] == new["source"]
            old_lineage = self._lineage(old["source"])
            new_lineage = old_lineage if same else self._lineage(new["source"])
            basis = "Keep the original complete result" if same else self._match(old_lineage, new_lineage)
            if basis is None:
                _error("REFRESH_SOURCE_LINEAGE_CHANGED")
            change = {"sheet": index, "name_before": old["name"], "name_after": new["name"],
                      "action": "keep" if same else "replace", "before": old["source"], "after": new["source"],
                      "match_basis": basis, "lineage_before": old_lineage, "lineage_after": new_lineage,
                      "comparison": self._comparison(old["source"], new["source"], old_lineage, new_lineage),
                      "columns_before": old["columns"], "columns_after": new["columns"]}
            changes.append(change)
            if preview:
                previews.append({"sheet": index, "name": new["name"], **self._preview(new)})
        if not any(change["action"] == "replace" for change in changes):
            _error("REFRESH_NEW_COMPLETE_RESULT_REQUIRED")
        review = {"schema": _SCHEMA, "workspace_id": self.workbooks.identity, "name": name,
                  "base_revision": original["revision"], "definition_sha256": base["definition_sha256"],
                  "expected_revision": expected, "reason": reason, "definition": normalized, "sheets": changes}
        return {**review, "review_sha256": digest(_canonical(review).encode()),
                "current_head_revision": base["head_revision"], "previews": previews,
                "ready": all(not item["errors"] for item in previews)}

    def save(self, name, request):
        request_id = _id(request.get("id"))
        reviewed = self.review(name, request, preview=False)
        if _hash(request.get("review_sha256")) != reviewed["review_sha256"]:
            _error("REFRESH_REVIEW_CHANGED")
        origin = {"schema": _ORIGIN, "base_revision": reviewed["base_revision"],
                  "base_definition_sha256": reviewed["definition_sha256"],
                  "base_definition_file": "history/definition-" + str(reviewed["base_revision"]) + ".json",
                  "review_sha256": reviewed["review_sha256"],
                  "reason": reviewed["reason"], "sheets": reviewed["sheets"]}
        return self.workbooks.save(name, {"id": request_id, "expected_revision": reviewed["expected_revision"],
                                         **reviewed["definition"]}, refresh_origin=origin)

    def retain_history(self, definition, target, *, cancel=lambda: False):
        """Carry exact predecessor definitions and their complete sources once."""
        from .storage import private_directory, write
        result, current = [], definition
        while current.get("refresh_origin"):
            if cancel():
                _error("CANCELLED")
            origin = current["refresh_origin"]
            revision = origin["base_revision"]
            if type(revision) is not int or not 1 <= revision < current["revision"]:
                _error("REFRESH_HISTORY_CHANGED")
            parent = self._base(definition["name"], revision, origin["base_definition_sha256"])
            name = "history/definition-" + str(revision) + ".json"
            if origin.get("base_definition_file") != name:
                _error("REFRESH_HISTORY_CHANGED")
            private_directory(target / "history")
            raw = _json(parent["definition"]).encode()
            if digest(raw) != parent["definition_sha256"]:
                _error("REFRESH_HISTORY_CHANGED")
            write(target / name, raw)
            for sheet in parent["definition"]["sheets"]:
                if cancel():
                    _error("CANCELLED")
                if self.workbooks.source(sheet["source"]) != sheet["source"]:
                    _error("SOURCE_CHANGED")
                self.workbooks._retain_source(sheet["source"], target)
            result.append({"revision": revision, "definition_sha256": parent["definition_sha256"], "file": name})
            current = parent["definition"]
        return result
