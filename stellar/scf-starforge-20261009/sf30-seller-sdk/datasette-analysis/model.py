"""Datasette customer editions in the original Starforge Analysis workspace.

The existing database owns rows, queries, jobs, reports, workbooks and archives.
This composer stores its edition history in that same SQLite database so a full
native workspace restore also restores the Datasette product.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid

from stellar_forge_buyer.analysis_native_delivery import open_finalized, register_finalized_source
from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.storage import private_directory, sync_directory

SCHEMA = "stellar-forge.datasette-analysis.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_EDITION = re.compile(r"[a-f0-9]{64}")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")


def _sibling(name):
    key = "_starforge_datasette_analysis_" + name
    if key not in sys.modules:
        spec = importlib.util.spec_from_file_location(key, Path(__file__).with_name(name + ".py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[key] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(key, None)
            raise
    return sys.modules[key]


_source = _sibling("source")
_recipes = _sibling("recipes")
require, encoded, sha = _source.require, _source.encoded, _source.sha


def _now():
    return datetime.now(timezone.utc).isoformat()


def _identifier(name):
    require(isinstance(name, str) and name and "\0" not in name, "DATASETTE_SQL_COLUMN_INVALID")
    return '"' + name.replace('"', '""') + '"'


def _columns(value):
    result = [column["name"] if isinstance(column, dict) else column for column in value]
    require(result and len(result) == len(set(result))
            and all(isinstance(name, str) and _NAME.fullmatch(name) for name in result),
            "DATASETTE_ANALYSIS_COLUMNS_INVALID")
    return result


class DatasetteAnalysis:
    def __init__(self, analysis, *, operation_id, progress=None):
        require(isinstance(operation_id, str) and _ID.fullmatch(operation_id),
                "DATASETTE_OPERATION_ID_REQUIRED",
                "Use a retained 32-character lowercase hexadecimal ID.")
        self.analysis = analysis
        self.operation_id = operation_id
        self.progress_callback = progress or (lambda event: None)
        self._mutex = threading.RLock()
        self.directory = private_directory(
            analysis.database.directory / "datasette-analysis" / operation_id, create=True)
        with self.analysis.database._connection() as database:
            database.execute("BEGIN IMMEDIATE")
            database.execute("CREATE TABLE IF NOT EXISTS sf_datasette_analysis_operations("
                             "id TEXT PRIMARY KEY, record TEXT NOT NULL)")
            selected = database.execute("SELECT record FROM sf_datasette_analysis_operations WHERE id=?",
                                        (operation_id,)).fetchone()
            if selected is None:
                record = {"schema": SCHEMA, "operation_id": operation_id,
                          "workspace_id": analysis.identity, "created_at": _now(),
                          "status": "READY", "progress": {"phase": "READY"},
                          "editions": [], "current_edition": None,
                          "jobs": {}, "comparisons": [], "exports": []}
                database.execute("INSERT INTO sf_datasette_analysis_operations VALUES(?,?)",
                                 (operation_id, encoded(record).decode()))
            database.commit()
        self.record = self._read()

    def _read(self):
        with self.analysis.database._connection(readonly=True) as database:
            selected = database.execute("SELECT record FROM sf_datasette_analysis_operations WHERE id=?",
                                        (self.operation_id,)).fetchone()
        require(selected is not None, "DATASETTE_OPERATION_NOT_FOUND")
        record = json.loads(selected[0])
        require(record.get("schema") == SCHEMA
                and record.get("workspace_id") == self.analysis.identity
                and record.get("operation_id") == self.operation_id,
                "DATASETTE_OPERATION_WORKSPACE_CHANGED")
        return record

    def _save(self):
        self.record["updated_at"] = _now()
        with self.analysis.database._connection() as database:
            database.execute("BEGIN IMMEDIATE")
            database.execute("UPDATE sf_datasette_analysis_operations SET record=? WHERE id=?",
                             (encoded(self.record).decode(), self.operation_id))
            database.commit()

    def _emit(self, phase, **details):
        event = {"phase": phase, "operation_id": self.operation_id, **details}
        self.record["progress"] = event
        self._save()
        self.progress_callback(event)

    def identifier(self, phase):
        return sha((self.operation_id + "\0" + phase).encode())[:32]

    def _job(self, phase, kind, payload, *, resume=False):
        attempts = self.record["jobs"].setdefault(phase, [])
        identity = sha(encoded({"kind": kind, "request": payload}))
        if not attempts:
            attempts.append({"id": self.identifier(phase + ":0"), "kind": kind,
                             "request_sha256": identity})
            self._save()
        selected = attempts[-1]
        require(selected["kind"] == kind and selected["request_sha256"] == identity,
                "DATASETTE_SAVED_JOB_INPUT_CHANGED", phase)
        try:
            current = self.analysis.job(selected["id"])
        except StateError as error:
            if (getattr(error, "code", None) or str(error)) != "ANALYSIS_JOB_NOT_FOUND":
                raise
            current = None
        if current and current["status"] == "COMPLETE":
            return current
        if current and current["status"] in {"FAILED", "INTERRUPTED", "CANCELLED"}:
            require(resume, "DATASETTE_RESUME_REQUIRED",
                    phase + ": " + str(current.get("error") or current["status"]))
            if kind != "workspace-export":
                selected = {"id": self.identifier(phase + ":" + str(len(attempts))),
                            "kind": kind, "request_sha256": identity}
                attempts.append(selected)
                self._save()
        self._emit(phase, job_id=selected["id"], kind=kind)
        current = self.analysis.start(kind, {"id": selected["id"], **payload})
        while current["status"] == "RUNNING":
            time.sleep(0.05)
            current = self.analysis.job(selected["id"])
        require(current["status"] == "COMPLETE", "DATASETTE_NATIVE_JOB_FAILED",
                phase + ": " + str(current.get("error") or current["status"]))
        return current

    @staticmethod
    def _selected(record, edition_id=None):
        selected = edition_id or record.get("current_edition")
        edition = next((item for item in record["editions"] if item["edition_id"] == selected), None)
        require(edition is not None, "DATASETTE_EDITION_NOT_FOUND")
        return edition

    def status(self):
        record = self._read()
        result = json.loads(encoded(record))
        result["files"] = [item for edition in result["editions"] for item in edition.get("files", [])]
        available_exports = []
        for exported in result["exports"]:
            exported["availability"] = self.analysis.archives.availability(
                exported.get("job_id"), exported.get("status", "COMPLETE"))
            if exported["availability"]["can_download"]:
                available_exports.append(exported)
        if available_exports:
            result["files"] += available_exports[-1].get("files", [])
        result["jobs"] = [{"phase": phase, **attempts[-1]} for phase, attempts in record["jobs"].items()
                          if attempts]
        if record.get("current_edition"):
            selected = self._selected(record)
            result["source"] = selected.get("source")
            result["summary"] = selected.get("summary", {})
        return result

    def _table_rows(self, version, *, offset=0, limit=None):
        columns = [item["column"] for item in version["column_types"]]
        order = version["row_order_column"]
        sql = ("SELECT " + ",".join(_identifier(name) for name in columns)
               + " FROM " + _identifier(version["table"])
               + " ORDER BY " + _identifier(order))
        if limit is not None:
            sql += " LIMIT " + str(limit) + " OFFSET " + str(offset)
        if limit is None:
            with self.analysis.database.stream_query(sql) as result:
                rows = [dict(zip(result.columns, row)) for row in result]
            require(len(rows) == version["row_count"], "DATASETTE_ANALYSIS_ROWS_INCOMPLETE")
            return columns, rows
        result = self.analysis.database.query(sql, max_rows=max(1, limit + 1))
        require(not result.truncated, "DATASETTE_ANALYSIS_ROWS_INCOMPLETE")
        return columns, [dict(zip(result.columns, row)) for row in result.rows]

    def _finalized(self, selected, *, resume):
        value = selected["record"]
        delivery_spec = value["delivery"]
        delivery, native = open_finalized(
            self.analysis.checkout, self.analysis.node, delivery_spec["room"],
            session=delivery_spec.get("session"))
        expected = delivery_spec.get("expected_native")
        require(isinstance(expected, dict)
                and set(expected) == {"sourceFormat", "sourceBindingSha256", "manifestSha256"}
                and all(native.get(key) == item for key, item in expected.items()),
                "DATASETTE_FINALIZED_SOURCE_CHANGED")
        source = _source.normalize_source(value.get("source", {}))
        original_names = [column["name"] for column in native["columns"]]
        mapping, _ = _source.reviewed_columns(original_names, value.get("column_mapping"))
        identity = sha(encoded({"native": expected, "mapping": mapping,
                                "review": value.get("review", {})}))
        source_name = "datasette_" + identity[:20]
        registered = register_finalized_source(self.analysis, {
            "name": source_name, "expected_revision": 0,
            "room": native["room"], "session": native["session"], "expected_native": expected})
        imported = self._job(identity + ":NATIVE_IMPORT", "import", {
            "source": registered["name"], "source_revision": registered["revision"],
            "columns_text": json.dumps(mapping, ensure_ascii=False)}, resume=resume)
        version = imported["result"]["version"]
        columns, rows = self._table_rows(version)
        originals = [{"name": "handover.json", "raw": selected["raw"],
                      "content_type": "application/json", "role": "original-handover"}]
        for index, name in enumerate(delivery.file_names()):
            with delivery.file(name).open() as stream:
                raw = stream.read(_source.MAX_FILE + 1)
            require(len(raw) <= _source.MAX_FILE, "DATASETTE_NATIVE_SOURCE_FILE_CAPACITY", name)
            originals.append({"name": name, "raw": raw,
                              "content_type": ("application/json" if name.endswith(".json") else
                                               "application/x-ndjson" if name.endswith(".jsonl")
                                               else "application/octet-stream"),
                              "role": "original-native-file-" + str(index + 1)})
        source.update(source_mode="finalized", row_count=len(rows), source_columns=original_names,
                      column_mapping=mapping, native_receiving=native, native_delivery=delivery.native,
                      payment_status=delivery.payment_status, source_binding_sha256=native["sourceBindingSha256"],
                      manifest_sha256=native["manifestSha256"],
                      capture_sha256=source.get("capture_sha256") or native["manifestSha256"],
                      handover_sha256=selected["sha256"])
        require(source.get("captured_at"), "DATASETTE_SOURCE_CAPTURE_TIME_REQUIRED",
                "Keep the original source observation time in the handover.")
        return {"id": identity, "source": source, "columns": columns, "rows": rows,
                "originals": originals, "handover": value, "review": value.get("review", {}),
                "native_version": version}

    def _activate(self, name, version_id):
        current = self.analysis.database.current(name)
        if current.get("version") is not None:
            require(current["version"]["version_id"] == version_id,
                    "DATASETTE_RETAINED_VIEW_CHANGED", name)
            return current
        return self.analysis.database.activate(name, version_id, expected_revision=current["revision"])

    def _prepare_collection(self, edition, key, collection, document, *, native_version, resume):
        phase = edition["edition_id"] + ":" + key
        names = _columns(collection["columns"])
        source_name = edition["name"] + "_" + key
        require(_NAME.fullmatch(source_name), "DATASETTE_COLLECTION_NAME_INVALID")
        if native_version is not None:
            version = native_version
        else:
            registered = self.analysis.responses.register(source_name, "document", manifest=document)
            preview = self._job(phase + ":PREVIEW", "response-preview", {
                "source": source_name, "source_revision": registered["revision"],
                "mapping": {"collection": "/" + key, "sse_data": "text",
                    "columns": [{"name": name, "pointer": "/" + name.replace("~", "~0").replace("/", "~1"),
                                 "type": "native", "missing": "error"} for name in names]}}, resume=resume)
            imported = self._job(phase + ":IMPORT", "response-import", {
                "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
                "allow_incomplete": False}, resume=resume)
            version = imported["result"]["version"]
        require(version["row_count"] == len(collection["rows"]),
                "DATASETTE_IMPORTED_ROW_COUNT_CHANGED", key)
        view = self._activate(source_name, version["version_id"])
        return {"name": source_name, "version_id": version["version_id"],
                "view_revision": view["revision"], "row_count": version["row_count"],
                "columns": names, "table": version["table"],
                "row_order_column": version["row_order_column"]}

    def _query(self, name, sql, max_rows):
        fields = {"sql": sql, "parameters_text": "[]", "max_rows": max_rows}
        try:
            query = self.analysis.saved_query(name)
        except StateError as error:
            if (getattr(error, "code", None) or str(error)) != "ANALYSIS_QUERY_NOT_FOUND":
                raise
            query = self.analysis.save_query(name, fields, expected_revision=0)
        require(all(query.get(key) == value for key, value in fields.items()),
                "DATASETTE_QUERY_RECIPE_CHANGED", name)
        return query

    def _products(self, edition, plan, *, resume):
        recipes, queries = [], []
        for recipe in plan["recipes"]:
            key = recipe["collection"]
            if key not in edition["collections"]:
                continue
            collection = edition["collections"][key]
            columns = collection["columns"]
            order = recipe.get("order_by") or [collection["row_order_column"]]
            require(isinstance(order, list) and all(isinstance(name, str) for name in order),
                    "DATASETTE_RECIPE_ORDER_INVALID")
            require(all(name in columns or name == collection["row_order_column"] for name in order),
                    "DATASETTE_RECIPE_ORDER_COLUMN_MISSING")
            sql = ("SELECT " + ",".join(_identifier(name) for name in columns)
                   + " FROM " + _identifier(collection["name"])
                   + " ORDER BY " + ",".join(_identifier(name) for name in order))
            query = self._query(edition["name"] + "_" + recipe["key"], sql,
                                max(1000, collection["row_count"] + 1))
            recipes.append(recipe)
            queries.append(query)
        require(recipes, "DATASETTE_COMPLETE_REPORT_RECIPES_REQUIRED")
        report_name = edition["name"] + "_report"
        source = edition["source"]
        license_text = source.get("license")
        if not isinstance(license_text, str):
            license_text = json.dumps(license_text, ensure_ascii=False) if license_text else "Retained publisher terms"
        introduction = (source["publisher"] + ". " + license_text + ". " + source["url"] + "\n"
            "Full retained selection: " + str(edition["row_count"]) + " rows. "
            "Numeric source tokens and disclosed capacity totals remain exact text; counts are integers. "
            "Source capacity, commissioning and generation years retain their historical meaning. "
            "Retrieval time describes the observation window, not present-day plant telemetry.")
        publication_note = "Complete source edition, exact disclosed capacity and retained source-year context."
        workbook_notes = ("Exact source values and capacity totals remain text. Original nulls display as NULL; "
                          "empty strings stay empty. Counts are integers. Complete source files travel with the workspace.")
        if edition.get("product_profile") == "original-csv-strings-v1":
            introduction = (source["publisher"] + ". " + license_text + ". " + source["url"] + "\n"
                "Complete original CSV: " + str(edition["row_count"]) + " rows. "
                "Original columns: " + ", ".join(source.get("source_columns", [])) + ". "
                "Every original field remains its published string. Blank fields remain blank, "
                "and published zero values remain present. Original source keys, row and line "
                "numbers, full publisher metadata and source file accompany the workspace. ")
            if source.get("publisherEdition") is not None:
                introduction += "Publisher edition: " + str(source["publisherEdition"]) + ". "
            if source.get("captured_at"):
                introduction += "Local original-file import: " + source["captured_at"] + ". "
            amount_fields = [name for name in source.get("source_columns", [])
                             if name in {"amount_gbp", "charity_amount_gbp"}]
            if amount_fields:
                introduction += "Published " + ", ".join(amount_fields) + " values retain GBP. "
                if {"period", "display"}.issubset(source.get("source_columns", [])):
                    introduction += "Original billing period and display wording stay with each price tier. "
            publication_note = ("Complete original CSV and publisher metadata; original field strings, "
                                "source keys and native source review retained.")
            workbook_notes = ("Every original CSV field remains text, including blank fields and "
                              "published zero amounts. Profile counts are integers. Original field "
                              "names, source keys, row/line records and complete publisher metadata "
                              "travel with the source file in the workspace.")
        introduction = plan.get("introduction", introduction)
        require(isinstance(introduction, str), "DATASETTE_REPORT_INTRODUCTION_INVALID")
        publication_note = plan.get("publication_note", publication_note)
        workbook_notes = plan.get("workbook_note", workbook_notes)
        definition = self.analysis.reports.save(report_name, {
            "id": self.identifier(edition["edition_id"] + ":REPORT_DEFINITION"),
            "expected_revision": 0, "title": (edition["title"] + " — Analysis")[:200],
            "introduction": introduction,
            "sections": [{"title": recipe["title"], "note": recipe["note"],
                          "query_name": query["name"], "query_revision": query["revision"],
                          "parameters_text": None} for recipe, query in zip(recipes, queries)]})
        pinned = self.analysis.reports.definition(report_name, revision=definition["revision"])
        if "expected_views" not in edition:
            edition["expected_views"] = {"scope": "selected", "bindings": [
                {"name": item["name"], "version_id": item["version_id"],
                 "revision": item["view_revision"]}
                for item in sorted(edition["collections"].values(), key=lambda value: value["name"])]}
            self._save()
        report = self._job(edition["edition_id"] + ":REPORT", "report", {
            "name": report_name, "revision": definition["revision"],
            "definition_sha256": pinned["sha256"], "expected_views": edition["expected_views"]},
            resume=resume)
        publication = self.analysis.reports.publish(report["id"], {
            "id": self.identifier(edition["edition_id"] + ":REPORT_PUBLICATION"),
            "result_sha256": report["result"]["result_sha256"], "expected_revision": 0,
            "note": publication_note})
        section0 = self.analysis.workbooks.source({"kind": "report", "id": publication["id"], "section": 0})
        publication_sha = section0["sha256"]
        edition["report"] = {**publication, "sha256": publication_sha, "job_id": report["id"]}
        self._save()
        sheets = []
        for index, recipe in enumerate(recipes):
            selected = self.analysis.workbooks.source({"kind": "report", "id": publication["id"], "section": index})
            labels = [column["name"] if isinstance(column, dict) else column for column in selected["columns"]]
            numeric = set(recipe.get("numeric", []))
            sheets.append({"name": recipe["sheet"],
                "source": {"kind": "report", "id": publication["id"], "sha256": selected["sha256"],
                           "section": index},
                "columns": [{"source": name, "source_index": position, "header": name,
                             "type": "integer" if name in numeric else "native",
                             "null": "blank" if name in numeric else "text", "null_text": "NULL",
                             "precision": "preserve"} for position, name in enumerate(labels)]})
        workbook_name = edition["name"] + "_workbook"
        workbook_definition = self.analysis.workbooks.save(workbook_name, {
            "id": self.identifier(edition["edition_id"] + ":WORKBOOK_DEFINITION"),
            "expected_revision": 0, "title": edition["title"],
            "notes": workbook_notes,
            "sheets": sheets})
        workbook = self._job(edition["edition_id"] + ":WORKBOOK", "workbook", {
            "name": workbook_name, "revision": workbook_definition["revision"],
            "definition_sha256": workbook_definition["definition_sha256"]}, resume=resume)
        edition["workbook"] = {"job_id": workbook["id"],
                              "manifest_sha256": workbook["result"]["manifest_sha256"],
                              "rows": workbook["result"]["row_count"]}
        files = []
        for native_name, name, filename in (
                ("workbook.xlsx", "workbook", "Datasette_Analysis.xlsx"),
                ("handoff.zip", "workbook-handover", "Datasette_Workbook_Handover.zip")):
            with self.analysis.workbooks.download(workbook["id"], native_name) as (_, descriptor):
                files.append(self._file_record(edition, name, filename, "workbook", workbook["id"],
                                               native_name, descriptor))
        for format, name, filename in (
                ("html", "report-html", "Datasette_Report.html"),
                ("json", "report-json", "Datasette_Report.json"),
                ("csv", "report-tables", "Datasette_Report_Tables.zip")):
            job = self._job(edition["edition_id"] + ":REPORT_EXPORT:" + format, "report-export", {
                "publication_id": publication["id"], "publication_sha256": publication_sha,
                "format": format}, resume=resume)
            _, descriptor = self.analysis.report_export_file(job["id"])
            files.append(self._file_record(edition, name, filename, "report", job["id"], format, descriptor))
        edition["files"] = files
        edition["queries"] = [{"name": query["name"], "revision": query["revision"]} for query in queries]
        self._save()

    @staticmethod
    def _file_record(edition, name, filename, kind, job_id, native_name, descriptor):
        return {"name": name, "filename": filename, "kind": kind, "job_id": job_id,
                "native_name": native_name, "edition_id": edition["edition_id"],
                "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}

    def prepare(self, handover, *, prefix="datasette", resume=False):
        require(isinstance(prefix, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,15}", prefix),
                "DATASETTE_PREFIX_INVALID")
        with self._mutex:
            self.record = self._read()
            self.record["status"] = "PREPARING"
            self._emit("READ_SOURCE")
            current = None
            try:
                selected = _source.handover(handover)
                if selected["record"]["delivery"]["kind"] == "retained-source":
                    raw_edition = _source.read_retained(handover)
                elif selected["record"]["delivery"]["kind"] == "native-edition":
                    raw_edition = _source.read_native_edition(handover, node=self.analysis.node)
                elif selected["record"]["delivery"]["kind"] == "csv-source":
                    raw_edition = _source.read_csv_source(handover, node=self.analysis.node)
                else:
                    raw_edition = self._finalized(selected, resume=resume)
                identity = raw_edition["id"]
                current = next((item for item in self.record["editions"] if item["edition_id"] == identity), None)
                if current is not None and current["status"] == "COMPLETE":
                    self.record["status"] = "COMPLETE"
                    self.record["current_edition"] = identity
                    self._emit("COMPLETE", edition_id=identity, reused=True)
                    return current
                empty_csv = (not raw_edition["rows"]
                             and raw_edition["source"].get("source_mode") == "original-csv"
                             and bool(raw_edition["source"].get("source_columns")))
                require(raw_edition["rows"] or empty_csv, "DATASETTE_EMPTY_SELECTION",
                        "The source selection contains no rows or retained original CSV header.")
                raw_edition["source"]["edition_id"] = identity
                reviewed_keys = raw_edition.get("review", {}).get("keys")
                if isinstance(reviewed_keys, dict):
                    reviewed_keys = reviewed_keys.get("recommended")
                if reviewed_keys is not None:
                    raw_edition["source"]["reviewed_keys"] = reviewed_keys
                plan = _recipes.build_analysis(raw_edition["rows"], raw_edition["columns"], raw_edition["source"])
                if current is None:
                    current = {"edition_id": identity, "id": identity, "title": raw_edition["source"]["title"],
                               "created_at": _now(), "name": prefix + "_" + identity[:12],
                               "row_count": len(raw_edition["rows"]), "source": raw_edition["source"],
                               "review": plan["review"], "source_review": raw_edition["review"],
                               "product_profile": ("original-csv-strings-v1"
                                   if raw_edition["source"].get("source_mode") == "original-csv"
                                   else "datasette-exact-v1"),
                               "summary": plan.get("summary") or plan["review"].get("summary") or
                                          {"rows": len(raw_edition["rows"])},
                               "status": "PREPARING", "collections": {}, "files": []}
                    self.record["editions"].append(current)
                require(current["name"] == prefix + "_" + identity[:12],
                        "DATASETTE_ORIGINAL_PREFIX_CHANGED")
                self.record["current_edition"] = identity
                self._save()
                document = _source.source_document(
                    self.directory / identity / "source-document",
                    collections=plan["collections"], edition=raw_edition)
                for key, collection in plan["collections"].items():
                    # A complete header-only CSV is a real zero-row source table.
                    # The maintained response projection imports its declared
                    # columns and original bytes through the ordinary native path.
                    if not collection["rows"] and not (empty_csv and key == "plants"):
                        continue
                    current["collections"][key] = self._prepare_collection(
                        current, key, collection, document,
                        native_version=raw_edition.get("native_version") if key == "plants" else None,
                        resume=resume)
                    self._save()
                require("plants" in current["collections"], "DATASETTE_ORIGINAL_PLANTS_COLLECTION_REQUIRED")
                current["version_id"] = current["collections"]["plants"]["version_id"]
                self._products(current, plan, resume=resume)
                current["status"] = "COMPLETE"
                current["completed_at"] = _now()
                current.pop("error", None)
                self.record["status"] = "COMPLETE"
                self.record.pop("error", None)
                self._emit("COMPLETE", edition_id=identity, row_count=current["row_count"],
                           files=len(current["files"]))
                return current
            except BaseException as error:
                code = getattr(error, "code", None) or str(error)
                self.record["status"] = "FAILED"
                self.record["error"] = str(code)[:1000]
                if current is not None:
                    current["status"] = "FAILED"
                    current["error"] = str(code)[:1000]
                self._save()
                raise

    def rows(self, *, edition_id=None, offset=0, limit=100):
        require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 250,
                "DATASETTE_ROW_PAGE_INVALID")
        edition = self._selected(self._read(), edition_id)
        require(edition.get("version_id"), "DATASETTE_EDITION_IMPORT_INCOMPLETE")
        version = self.analysis.database.version(edition["version_id"])
        columns, rows = self._table_rows(version, offset=offset, limit=limit)
        return {"edition_id": edition["edition_id"], "columns": columns, "rows": rows,
                "offset": offset, "next_offset": offset + len(rows) if offset + len(rows) < version["row_count"] else None,
                "total": version["row_count"]}

    def compare(self, before, after, *, keys=None, resume=False):
        with self._mutex:
            self.record = self._read()
            left, right = self._selected(self.record, before), self._selected(self.record, after)
            require(left["status"] == right["status"] == "COMPLETE",
                    "DATASETTE_COMPLETED_EDITIONS_REQUIRED")
            if keys is None:
                keys = left.get("source_review", {}).get("keys") or left["review"].get("keys")
                if isinstance(keys, dict):
                    keys = keys.get("recommended")
            require(isinstance(keys, list) and keys and all(isinstance(key, str) for key in keys),
                    "DATASETTE_COMPARISON_KEYS_REQUIRED", "Select reviewed original business keys.")
            left_mapping = left.get("source", {}).get("column_mapping", {})
            right_mapping = right.get("source", {}).get("column_mapping", {})
            keys = [left_mapping.get(key, key) for key in keys]
            require(len(keys) == len(set(keys)), "DATASETTE_COMPARISON_KEYS_INVALID")
            local_locators = ({left_mapping.get("rowid", "rowid")} |
                              set(left.get("source", {}).get("local_locator_columns", [])) |
                              set(right.get("source", {}).get("local_locator_columns", [])))
            require(not (local_locators & set(keys)),
                    "DATASETTE_BUSINESS_KEY_REQUIRED",
                    "Datasette rowid is a locator within an edition; select the reviewed source key.")
            for key in keys:
                originals = [name for name, alias in left_mapping.items() if alias == key]
                require(not originals or right_mapping.get(originals[0], originals[0]) == key,
                        "DATASETTE_COMPARISON_COLUMN_MAPPING_CHANGED", key)
            compare_id = sha(encoded({"before": before, "after": after, "keys": keys}))[:32]
            chosen = next((item for item in self.record["comparisons"] if item["id"] == compare_id), None)
            if chosen is None:
                name = "datasette_compare_" + compare_id[:16]
                view = self._activate(name, left["version_id"])
                chosen = {"id": compare_id, "before": before, "after": after, "keys": keys,
                          "view": name, "view_revision": view["revision"]}
                self.record["comparisons"].append(chosen)
                self._save()
            job = self._job("COMPARE:" + compare_id, "compare", {
                "view": chosen["view"], "expected_revision": chosen["view_revision"],
                "base_version_id": left["version_id"], "candidate_version_id": right["version_id"],
                "keys": keys}, resume=resume)
            page = self.analysis.changes.page(job["id"], kind="all", limit=100)
            chosen.update(job_id=job["id"], status="COMPLETE", native=job["result"])
            self._save()
            return {"comparison_id": compare_id, "before": before, "after": after, "keys": keys,
                    "summary": job["result"].get("summary") or job["result"].get("counts") or job["result"],
                    "rows": page.get("rows") or page.get("changes") or [],
                    "page": page, "native": job["result"]}

    def export(self, *, destination=None, export_id=None, edition_id=None, resume=False):
        """Snapshot an exact edition and current work; an export ID replays it."""
        with self._mutex:
            self.record = self._read()
            require(any(edition["status"] == "COMPLETE" for edition in self.record["editions"]),
                    "DATASETTE_COMPLETED_EDITION_REQUIRED")
            require(edition_id is None or isinstance(edition_id, str) and _EDITION.fullmatch(edition_id),
                    "DATASETTE_EXPORT_EDITION_INVALID")
            if export_id is None:
                if resume:
                    pending = [item for item in self.record["exports"]
                               if item.get("status") in {"PREPARING", "FAILED"}]
                    require(len(pending) == 1, "DATASETTE_EXPORT_ID_REQUIRED",
                            "Resume the retained export ID or create a new archive.")
                    export_id = pending[0]["id"]
                else:
                    export_id = uuid.uuid4().hex
            require(isinstance(export_id, str) and _ID.fullmatch(export_id),
                    "DATASETTE_EXPORT_ID_INVALID")
            existing = next((item for item in self.record["exports"]
                             if item["id"] == export_id), None)
            if existing is not None and edition_id is not None:
                require(existing.get("edition_id") == edition_id,
                        "DATASETTE_EXPORT_EDITION_CHANGED")
            selected = self._selected(self.record, edition_id or (existing or {}).get("edition_id"))
            require(selected["status"] == "COMPLETE", "DATASETTE_COMPLETED_EDITION_REQUIRED")
            if existing is None:
                existing = {"id": export_id, "status": "PREPARING", "files": [],
                            "created_at": _now(), "edition_id": selected["edition_id"],
                            "workspace_id": self.analysis.identity}
                self.record["exports"].append(existing)
                self.record["status"] = "COMPLETE"
                self._save()
            if existing.get("status", "COMPLETE") != "COMPLETE":
                try:
                    availability = self.analysis.archives.review(include_previous_backups=False)
                    require(availability["ready"], "DATASETTE_WORKSPACE_FILES_INCOMPLETE",
                            json.dumps(availability.get("missing", []), ensure_ascii=False))
                    # Every new export ID snapshots current saved SQL, reports,
                    # workbooks and customer edits. Replaying that same ID uses
                    # the original native archive operation and exact snapshot.
                    existing["status"] = "PREPARING"
                    # Select the retained request edition before the native
                    # archive snapshots the operation record. The model mutex
                    # and original operator serialize source preparation here.
                    self.record["current_edition"] = existing["edition_id"]
                    self._save()
                    job = self._job("WORKSPACE_EXPORT:" + export_id, "workspace-export",
                                    {"include_previous_backups": False}, resume=resume)
                    files = []
                    for native_name, name, filename in (
                            ("workspace.zip", "workspace", "Datasette_Analysis_Workspace.zip"),
                            ("archive-manifest.json", "workspace-manifest", "Datasette_Workspace_Manifest.json")):
                        with self.analysis.archives.download(job["id"], native_name) as (_, descriptor):
                            files.append({"name": name, "filename": filename, "kind": "archive",
                                          "native_name": native_name, "job_id": job["id"],
                                          "export_id": export_id,
                                          "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]})
                    existing.update(job_id=job["id"], workspace=job["result"], files=files,
                                    status="COMPLETE", completed_at=_now())
                    existing.pop("error", None)
                    self._emit("EXPORTED", export_id=export_id, archive_id=job["result"].get("id"))
                except BaseException as error:
                    existing.update(status="FAILED", error=str(error), updated_at=_now())
                    self._save()
                    raise
            require(self.analysis.archives.availability(
                        existing.get("job_id"), "COMPLETE")["can_download"],
                    "DATASETTE_EXPORT_RETAINED_SEPARATELY",
                    "Create a new export ID to deliver the current restored customer workspace.")
            result = dict(existing)
            if destination is not None:
                destination_root = private_directory(
                    Path(destination).expanduser().absolute(), create=True)
                directory = private_directory(destination_root / export_id, create=True)
                exported_edition = self._selected(
                    self.record, existing.get("edition_id") or self.record["current_edition"])
                descriptors = [*existing["files"], *exported_edition.get("files", [])]
                received = []
                for item in descriptors:
                    target = directory / item["filename"]
                    self._copy_download(item, target)
                    received.append({key: item[key] for key in ("filename", "bytes", "sha256")})
                result.update(directory=str(directory), received_files=received)
            return result

    def _copy_download(self, item, target):
        if target.exists():
            require(not target.is_symlink() and target.is_file(), "DATASETTE_EXPORT_TARGET_INVALID")
            with target.open("rb") as stream:
                actual = hashlib.file_digest(stream, "sha256").hexdigest()
            require(target.stat().st_size == item["bytes"] and actual == item["sha256"],
                    "DATASETTE_EXPORT_TARGET_CHANGED", target.name)
            return
        descriptor, temporary = tempfile.mkstemp(prefix=".datasette-", dir=target.parent)
        try:
            digest, size = hashlib.sha256(), 0
            with os.fdopen(descriptor, "wb") as output:
                os.fchmod(output.fileno(), 0o600)
                with self.open_download(item["name"], edition_id=item.get("edition_id"),
                                        export_id=item.get("export_id")) as (stream, expected):
                    while chunk := stream.read(65536):
                        output.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                require(size == expected["bytes"] and digest.hexdigest() == expected["sha256"],
                        "DATASETTE_DOWNLOAD_SOURCE_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, target, follow_symlinks=False)
            sync_directory(target.parent)
        finally:
            Path(temporary).unlink(missing_ok=True)

    @contextmanager
    def open_download(self, name, *, edition_id=None, export_id=None):
        if isinstance(name, str) and name.startswith("bdnb-"):
            with _sibling("bdnb_adapter").open_bdnb_download(self, name) as selected:
                yield selected
            return
        if isinstance(name, str) and name.startswith("nld-"):
            with _sibling("nld_adapter").open_nld_download(self, name) as selected:
                yield selected
            return
        record = self._read()
        files = []
        if edition_id is not None or record.get("current_edition"):
            files += self._selected(record, edition_id).get("files", [])
        if export_id is not None:
            selected_export = next((item for item in record["exports"]
                                    if item["id"] == export_id), None)
            require(selected_export is not None, "DATASETTE_EXPORT_NOT_FOUND")
            files += selected_export.get("files", [])
        else:
            available_exports = [item for item in record["exports"]
                                 if self.analysis.archives.availability(
                                     item.get("job_id"), item.get("status", "COMPLETE"))["can_download"]]
            if available_exports:
                files += available_exports[-1].get("files", [])
        item = next((item for item in files if item["name"] == name), None)
        require(item is not None, "DATASETTE_DOWNLOAD_NOT_FOUND")
        content_types = {".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         ".json": "application/json", ".html": "text/html; charset=utf-8",
                         ".zip": "application/zip"}
        metadata = {**item, "content_type": content_types.get(Path(item["filename"]).suffix,
                                                            "application/octet-stream")}
        if item["kind"] in {"workbook", "archive"}:
            manager = self.analysis.workbooks if item["kind"] == "workbook" else self.analysis.archives
            with manager.download(item["job_id"], item["native_name"]) as (stream, descriptor):
                require(descriptor["bytes"] == item["bytes"] and descriptor["sha256"] == item["sha256"],
                        "DATASETTE_DOWNLOAD_BINDING_CHANGED")
                yield stream, metadata
        else:
            path, descriptor = self.analysis.report_export_file(item["job_id"])
            require(descriptor["bytes"] == item["bytes"] and descriptor["sha256"] == item["sha256"],
                    "DATASETTE_DOWNLOAD_BINDING_CHANGED")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                yield stream, metadata

    def dispatch(self, action, body=None):
        body = {} if body is None else body
        require(isinstance(body, dict), "DATASETTE_REQUEST_OBJECT_REQUIRED")
        if action in {"bdnb.schema", "bdnb.status", "bdnb.get", "bdnb.rows"}:
            return _sibling("bdnb_adapter").DatasetteBdnb(self).dispatch(action, body)
        if isinstance(action, str) and action.startswith("bdnb."):
            with self._mutex:
                return _sibling("bdnb_adapter").DatasetteBdnb(self).dispatch(action, body)
        if action in {"nld.status", "nld.rows"}:
            return _sibling("nld_adapter").DatasetteNld(self).dispatch(action, body)
        if isinstance(action, str) and action.startswith("nld."):
            with self._mutex:
                return _sibling("nld_adapter").DatasetteNld(self).dispatch(action, body)
        if action == "status":
            return self.status()
        if action == "prepare":
            return self.prepare(body.get("handover"), prefix=body.get("prefix", "datasette"),
                                resume=body.get("resume", False))
        if action == "rows":
            return self.rows(edition_id=body.get("edition_id"), offset=body.get("offset", 0),
                             limit=body.get("limit", 100))
        if action == "compare":
            return self.compare(body.get("before"), body.get("after"), keys=body.get("keys"),
                                resume=body.get("resume", False))
        if action == "export":
            return self.export(destination=body.get("destination"), export_id=body.get("export_id"),
                               edition_id=body.get("edition_id"), resume=body.get("resume", False))
        raise _source.SourceError("DATASETTE_ACTION_UNKNOWN", action)

    def close(self):
        """The caller retains ownership of the original AnalysisWorkspace."""
        return None
