"""Complete BDNB publications in the original Analysis workspace.

Domain entities and exact source versions remain owned by bdnb_adapter. Every
file here is an original Analysis job output, selected by its native receipt.
"""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sqlite3
import zipfile
import tempfile
from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.storage import private_directory, sync_directory

ID = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
SCHEMA = "stellar-forge.bdnb-products.v1"
VIEWS = "sf_bdnb_product_intents"


def need(condition, code):
    if not condition:
        raise StateError(code)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def ident(value):
    need(isinstance(value, str) and ID.fullmatch(value), "BDNB_PRODUCT_ID_REQUIRED")
    return value


def quoted(value):
    need(isinstance(value, str) and value and "\0" not in value, "BDNB_PRODUCT_COLUMN_INVALID")
    return '"' + value.replace('"', '""') + '"'


def exact_body(action, body):
    need(isinstance(body, dict), "BDNB_PRODUCT_BODY_REQUIRED")
    body = json.loads(encoded(body))
    resume = body.pop("resume", False)
    need(type(resume) is bool, "BDNB_PRODUCT_RESUME_INVALID")
    keys = ({"publication_id", "entity_id", "title", "note"} if action == "bdnb.publish"
            else {"pack_id", "publication_id", "note"})
    need(set(body) == keys, "BDNB_PRODUCT_FIELDS_INVALID")
    for key in keys & {"publication_id", "entity_id", "pack_id"}:
        ident(body[key])
    for key in keys & {"title", "note"}:
        need(isinstance(body[key], str) and len(body[key].encode()) <= (600 if key == "title" else 8000)
             and (bool(body[key].strip()) and len(body[key]) <= 300 if key == "title" else True),
             "BDNB_PRODUCT_TEXT_INVALID")
    return body, resume


def intent(adapter, kind, identifier, body, make):
    """Freeze the first complete selection in the same database before jobs.

    This survives a process interruption and travels in the native SQLite
    archive. A later review or source edit cannot redefine this publication.
    """
    operation = adapter.model.operation_id
    request_sha = digest({"kind": kind, "body": body})
    with adapter.database._connection() as db:
        db.execute("CREATE TABLE IF NOT EXISTS " + VIEWS +
                   "(operation_id TEXT NOT NULL,id TEXT NOT NULL,request_sha256 TEXT NOT NULL,"
                   "record TEXT NOT NULL,PRIMARY KEY(operation_id,id))")
        prior = db.execute("SELECT request_sha256,record FROM " + VIEWS +
                           " WHERE operation_id=? AND id=?", (operation, identifier)).fetchone()
    if prior:
        need(prior[0] == request_sha, "BDNB_PRODUCT_INTENT_CHANGED")
        return json.loads(prior[1])
    value = make()
    value = {"schema": SCHEMA + "/intent", "kind": kind, "id": identifier,
             "operation_id": operation, "request_sha256": request_sha,
             "input": body, **value}
    raw = encoded(value).decode()
    with adapter.database._connection() as db:
        db.execute("BEGIN IMMEDIATE")
        prior = db.execute("SELECT request_sha256,record FROM " + VIEWS +
                           " WHERE operation_id=? AND id=?", (operation, identifier)).fetchone()
        if prior:
            need(prior[0] == request_sha, "BDNB_PRODUCT_INTENT_CHANGED")
            value = json.loads(prior[1])
        else:
            db.execute("INSERT INTO " + VIEWS + " VALUES(?,?,?,?)",
                       (operation, identifier, request_sha, raw))
        db.commit()
    return value


def source_lineage(entity):
    return {"kind": entity["kind"], "id": entity["id"], "sha256": entity["sha256"]}


def native_collection(adapter, entity_id, name):
    selected = adapter.collection(entity_id, name)
    original = adapter.database.version(selected["version_id"])
    need(original["table"] == selected["table"] and
         original["row_count"] == selected["row_count"] and
         original["row_order_column"] == selected["row_order_column"],
         "BDNB_PRODUCT_NATIVE_VERSION_CHANGED")
    columns = [c["column"] for c in original["column_types"]]
    need(columns == selected["columns"], "BDNB_PRODUCT_NATIVE_COLUMNS_CHANGED")
    return selected


def bind_view(adapter, identifier, label, version):
    name = "bdnbp_" + identifier[:20] + "_" + hashlib.sha256(label.encode()).hexdigest()[:12]
    current = adapter.database.current(name)
    if current.get("version") is None:
        current = adapter.database.activate(name, version["version_id"], expected_revision=current["revision"])
    need(current["version"]["version_id"] == version["version_id"], "BDNB_PRODUCT_VIEW_CHANGED")
    return {"name": name, "version_id": version["version_id"], "revision": current["revision"]}


def sql_rows(collection, view):
    return ("SELECT " + ",".join(quoted(c) for c in collection["columns"]) +
            " FROM " + quoted(view["name"]) + " ORDER BY " + quoted(collection["row_order_column"]))


def job(adapter, identifier, phase, kind, request, resume):
    result = adapter.model._job("BDNB:" + identifier + ":" + phase, kind, request, resume=resume)
    need(result["status"] == "COMPLETE", "BDNB_PRODUCT_COMPLETE_NATIVE_JOB_REQUIRED")
    return result


def file_record(identifier, label, filename, kind, job_id, native_name, native):
    need(type(native.get("bytes")) is int and native["bytes"] >= 0 and
         isinstance(native.get("sha256"), str) and HASH.fullmatch(native["sha256"]),
         "BDNB_PRODUCT_NATIVE_FILE_INVALID")
    return {"name": "bdnb-" + identifier + "-" + label, "filename": filename,
            "kind": kind, "job_id": job_id, "native_name": native_name,
            "bytes": native["bytes"], "sha256": native["sha256"],
            "content_type": native.get("mime") or native.get("content_type") or (
                "application/json" if filename.endswith(".json") else
                "application/x-ndjson" if filename.endswith(".jsonl") else
                "text/csv; charset=utf-8" if filename.endswith(".csv") else
                "text/html; charset=utf-8" if filename.endswith(".html") else
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                if filename.endswith(".xlsx") else "application/zip")}


def export_collection(adapter, identifier, name, collection, view, resume):
    sql = sql_rows(collection, view)
    fields = {"sql": sql, "parameters_text": "[]", "max_rows": 1}
    query = adapter.model._query("bdnbq_" + identifier[:20] + "_" +
                                hashlib.sha256(name.encode()).hexdigest()[:10], sql, 1)
    bindings = {"scope": "selected", "bindings": [view]}
    preview = job(adapter, identifier, "PREVIEW:" + name, "query",
                  {**fields, "expected_views": bindings}, resume)
    # The preview is an explicit one-row schema/binding input. The native
    # query-export re-executes the whole pinned SQL with its streaming reader.
    output = job(adapter, identifier, "ANNEX:" + name, "query-export", {
        "query_id": preview["id"], "result_sha256": preview["result"]["result_sha256"],
        "label": "BDNB complete " + name, "formats": ["jsonl", "csv"]}, resume)
    manifest = output["result"]["manifest"]
    need(manifest.get("queryComplete") is True and manifest["rowCount"] == collection["row_count"] and
         manifest["columns"] == collection["columns"], "BDNB_PRODUCT_ANNEX_INCOMPLETE")
    files = []
    for item in output["result"]["files"]:
        native_name = item["name"]
        need(native_name in {"rows.jsonl", "rows.csv", "manifest.json"}, "BDNB_PRODUCT_ANNEX_FILE_INVALID")
        label = name + "-" + native_name.replace(".", "-")
        files.append(file_record(identifier, label, "BDNB_" + identifier[:8] + "_" + name + "_" + native_name,
                                 "bdnb-query-export", output["id"], native_name, item))
    need({f["native_name"] for f in files} == {"rows.jsonl", "rows.csv", "manifest.json"},
         "BDNB_PRODUCT_ANNEX_FILES_INCOMPLETE")
    return {"collection": name, "rows": collection["row_count"], "version_id": collection["version_id"],
            "query": {"name": query["name"], "revision": query["revision"]},
            "job_id": output["id"], "manifest_sha256": output["result"]["manifest_sha256"],
            "preview_rows": 1, "preview_truncated": preview["result"]["truncated"],
            "complete": True, "files": files}


def metadata_collection(adapter, identifier, label, columns, rows):
    """Import complete small product metadata using the native row importer."""
    folder = private_directory(adapter.directory / "products" / identifier, create=True)
    fd, filename = tempfile.mkstemp(prefix=".metadata-", dir=folder)
    count, size, checksum = 0, 0, hashlib.sha256()
    try:
        with os.fdopen(fd, "wb") as target:
            for row in rows:
                need(set(row) == set(columns), "BDNB_PRODUCT_METADATA_COLUMNS_CHANGED")
                raw = encoded(row)
                need(len(raw) <= 2_097_152, "BDNB_PRODUCT_METADATA_ROW_CAPACITY")
                target.write(raw); size += len(raw); checksum.update(raw); count += 1
            target.flush(); os.fsync(target.fileno())
        source = {"bytes": size, "sha256": checksum.hexdigest()}
        manifest = {"schema": SCHEMA + "/metadata", "publication_id": identifier,
                    "label": label, "columns": columns, "rows": count, "source": source}
        raw_manifest = encoded(manifest)
        identity = {"schema": "stellar-forge.python-dataset-sqlite.v1",
                    "manifestSha256": hashlib.sha256(raw_manifest).hexdigest(),
                    "sourceBindingSha256": digest({"publication_id": identifier, "label": label, "source": source}),
                    "columns": [[column, column] for column in columns]}
        result = adapter.database._import_rows(
            manifest_bytes=raw_manifest, identity=identity, fields=columns, mapped=columns,
            total=count, source=source, opener=lambda: open(filename, "rb"), details={"bdnb_product": manifest})
        return {"version_id": result["version_id"], "table": result["table"],
                "row_count": result["row_count"], "columns": columns,
                "row_order_column": result["row_order_column"]}
    finally:
        Path(filename).unlink(missing_ok=True)


def basis_rows(selected, reviews):
    """Complete selected metadata, split without losing any original character."""
    for section, value in (("selected-entity", selected), ("review-set", reviews)):
        raw = encoded(value).decode()
        parts = max(1, (len(raw) + 11999) // 12000)
        for part in range(parts):
            yield {"section": section, "part": str(part + 1), "parts": str(parts),
                   "sha256": hashlib.sha256(raw.encode()).hexdigest(),
                   "text": raw[part * 12000:(part + 1) * 12000]}


def measured_rows(adapter, selected, reviews):
    """Count the complete immutable population without inferring energy results."""
    def metric(topic, value, meaning):
        return {"topic": topic, "value": str(value), "meaning": meaning}
    yield metric("Selected entity", selected["id"], selected["kind"])
    yield metric("Original identity", selected["sha256"], "Complete immutable entity SHA-256")
    # Scalar source metrics are readable. Lists remain complete in the basis
    # annex; their counts are labelled as list counts, never domain totals.
    def summary(value, path):
        if isinstance(value, dict):
            for key, child in sorted(value.items()):
                yield from summary(child, path + "/" + key)
        elif isinstance(value, list):
            yield metric(path + " / entries", len(value), "Complete list retained in source-basis annex")
        else:
            yield metric(path, "NULL" if value is None else value, "Original supplied source summary")
    yield from summary(selected["summary"], "Source")
    for name in sorted(selected["collections"]):
        counts, findings, states, geometries, classifications = 0, {}, {}, {}, {}
        rows_with_findings, unkeyed = 0, 0
        with adapter.stream_rows(selected["id"], name) as source_rows:
            for row in source_rows:
                counts += 1
                if row.get("key") is None and "key" in row:
                    unkeyed += 1
                original_findings = row.get("findings", [])
                if original_findings:
                    rows_with_findings += 1
                for finding in original_findings:
                    code = finding.get("code", "unspecified") if isinstance(finding, dict) else str(finding)
                    findings[code] = findings.get(code, 0) + 1
                for field, cell in row.get("typed", {}).items():
                    key = (field, cell.get("state", "unspecified"))
                    states[key] = states.get(key, 0) + 1
                geometry = row.get("geometry")
                if isinstance(geometry, dict):
                    key = geometry.get("state", "unspecified")
                    geometries[key] = geometries.get(key, 0) + 1
                classification = row.get("classification")
                if classification is not None:
                    classifications[classification] = classifications.get(classification, 0) + 1
        need(counts == selected["collections"][name]["row_count"], "BDNB_PRODUCT_METRIC_POPULATION_CHANGED")
        yield metric(name + " / complete rows", counts, "Entire selected immutable collection")
        yield metric(name + " / rows with findings", rows_with_findings, "Rows carrying original findings")
        yield metric(name + " / missing record keys", unkeyed, "Supplied rows with unresolved keys")
        for code, count in sorted(findings.items()):
            yield metric(name + " / finding / " + code, count, "Original finding occurrences; multiple may belong to one row")
        for (field, state), count in sorted(states.items()):
            yield metric(name + " / field / " + field + " / " + state, count,
                         "Exact typed state count; missing, null, invalid and value remain distinct")
        for state, count in sorted(geometries.items()):
            yield metric(name + " / geometry / " + state, count, "Supplied geometry validation state")
        for classification, count in sorted(classifications.items()):
            yield metric(name + " / change / " + classification, count, "Original correspondence classification")
    outcomes, reviewed = {}, set()
    for review in reviews["reviews"]:
        key = review["input"]["outcome"]
        outcomes[key] = outcomes.get(key, 0) + 1
        reviewed.add(review["input"]["item_id"])
    yield metric("Review set", reviews["sha256"], "Frozen complete current-tip review set")
    yield metric("Current review decisions", len(reviews["reviews"]), "Supplied operator decisions, including conflicting tips")
    yield metric("Distinct reviewed change items", len(reviewed), "Unique original item IDs with current reviews")
    yield metric("Conflicting review items", len(reviews["conflicts"]), "Unresolved competing current tips")
    for outcome, count in sorted(outcomes.items()):
        yield metric("Review outcome / " + outcome, count, "Supplied current-tip decisions")
    if selected["kind"] == "comparison":
        changes = selected["collections"]["changes"]["row_count"]
        yield metric("Change items without a review", changes - len(reviewed),
                     "Complete change population minus distinct reviewed original items")


def overview_rows(metrics, annexes):
    # Split every long display cell at a deterministic character boundary.
    # Each part is labelled; concatenation reproduces the complete cell.
    for original in metrics:
        pieces = max(1, *( (len(str(original[k])) + 11999) // 12000 for k in ("topic", "value", "meaning")))
        for part in range(pieces):
            row = {k: str(original[k])[part * 12000:(part + 1) * 12000] for k in ("topic", "value", "meaning")}
            if pieces > 1:
                row["meaning"] += " [cell parts " + str(part + 1) + "/" + str(pieces) + "]"
            yield row
    for item in annexes:
        for f in item["files"]:
            yield {"topic": "Complete annex / " + item["collection"], "value": f["filename"],
                   "meaning": str(item["rows"]) + " complete rows; SHA-256 " + f["sha256"]}


def publish(adapter, body, resume):
    identifier = body["publication_id"]
    existing, _ = adapter.begin("publication", identifier, body, body["title"])
    if existing is not None:
        for item in existing["files"]:
            with open_product_download(adapter, item):
                pass
        return {"entity": existing, "replayed": True}

    def selection():
        selected = adapter.get(body["entity_id"])
        need(selected["kind"] in {"selection", "comparison"}, "BDNB_PRODUCT_SELECTION_REQUIRED")
        reviews = adapter.current_reviews(selected["id"]) if selected["kind"] == "comparison" else {
            "comparison_id": None, "reviews": [], "conflicts": []}
        if "sha256" not in reviews:
            reviews["sha256"] = digest(reviews)
        collections = {name: native_collection(adapter, selected["id"], name)
                       for name in selected["collections"]}
        need(collections, "BDNB_PRODUCT_COLLECTIONS_REQUIRED")
        return {"selected": selected, "reviews": reviews, "collections": collections}

    selected_intent = intent(adapter, "publication", identifier, body, selection)
    selected, reviews = selected_intent["selected"], selected_intent["reviews"]
    need(adapter.get(selected["id"])["sha256"] == selected["sha256"], "BDNB_PRODUCT_ENTITY_CHANGED")
    collections, annexes, files = selected_intent["collections"], [], []
    # Every annex is complete; report/workbook contain the compact overview and
    # explicit file receipts. Large original body_json cells remain in JSONL.
    for name, collection in sorted(collections.items()):
        current = native_collection(adapter, selected["id"], name)
        need(current == collection, "BDNB_PRODUCT_COLLECTION_CHANGED")
        view = bind_view(adapter, identifier, name, collection)
        annex = export_collection(adapter, identifier, name, collection, view, resume)
        annexes.append(annex); files.extend(annex["files"])
    review_collection = metadata_collection(adapter, identifier, "reviews",
        ["id", "item_id", "outcome", "author", "reason", "body_json"],
        ({"id": r["id"], "item_id": r["input"]["item_id"], "outcome": r["input"]["outcome"],
          "author": r["input"]["author"], "reason": r["input"]["reason"],
          "body_json": encoded(r).decode().rstrip("\n")} for r in reviews["reviews"]))
    review_view = bind_view(adapter, identifier, "review-decisions", review_collection)
    review_annex = export_collection(adapter, identifier, "review-decisions", review_collection, review_view, resume)
    annexes.append(review_annex); files.extend(review_annex["files"])
    basis = metadata_collection(adapter, identifier, "source-basis",
                                ["section", "part", "parts", "sha256", "text"], basis_rows(selected, reviews))
    basis_view = bind_view(adapter, identifier, "source-basis", basis)
    basis_annex = export_collection(adapter, identifier, "source-basis", basis, basis_view, resume)
    annexes.append(basis_annex); files.extend(basis_annex["files"])
    metrics = list(measured_rows(adapter, selected, reviews))
    overview = metadata_collection(adapter, identifier, "overview", ["topic", "value", "meaning"],
                                   overview_rows(metrics, annexes))
    # Excel cells have a separate length limit. Full source summaries also stay
    # in the immutable intent; render one metric per row when supplied values
    # exceed an individual cell rather than shortening a value silently.
    with adapter.database.stream_query("SELECT * FROM " + quoted(overview["table"])) as rows:
        for row in rows:
            need(all(not isinstance(v, str) or len(v) <= 32000 for v in row),
                 "BDNB_PRODUCT_OVERVIEW_CELL_CAPACITY")
    overview_view = bind_view(adapter, identifier, "overview", overview)
    name = "bdnbr_" + identifier
    query = adapter.model._query(name, sql_rows(overview, overview_view), max(1000, overview["row_count"] + 1))
    intro = ("BDNB complete original selection " + selected["id"] + " / " + selected["sha256"] +
             ". Full raw/typed records, original field states, geometry and passage evidence remain in the "
             "complete JSONL annexes and original workspace. CSV uses spreadsheet-safe text; JSONL retains "
             "exact values. Workbook and report provide the complete annex index and source/review counts, "
             "not a preview of the entire territory. Review decisions are supplied operator records. "
             "Address-denominator weights are not prorated across a group's addresses. " + body["note"])
    definition = adapter.analysis.reports.save(name, {
        "id": adapter.model.identifier("BDNB:" + identifier + ":REPORT_DEFINITION"), "expected_revision": 0,
        "title": body["title"], "introduction": intro,
        "sections": [{"title": "Territory, coverage, changes, reviews and complete outputs", "note": "All listed annexes are complete.",
                      "query_name": name, "query_revision": query["revision"], "parameters_text": None}]})
    pinned = adapter.analysis.reports.definition(name, revision=definition["revision"])
    report = job(adapter, identifier, "REPORT", "report", {
        "name": name, "revision": definition["revision"], "definition_sha256": pinned["sha256"],
        "expected_views": {"scope": "selected", "bindings": [overview_view]}}, resume)
    need(report["result"]["total_rows"] == overview["row_count"], "BDNB_PRODUCT_REPORT_INCOMPLETE")
    publication = adapter.analysis.reports.publish(report["id"], {
        "id": adapter.model.identifier("BDNB:" + identifier + ":REPORT_PUBLICATION"),
        "result_sha256": report["result"]["result_sha256"], "expected_revision": 0,
        "note": "Complete original-source annexes and frozen operator reviews. " + body["note"]})
    section = adapter.analysis.workbooks.source({"kind": "report", "id": publication["id"], "section": 0})
    workbook_name = "bdnbw_" + identifier
    definition = adapter.analysis.workbooks.save(workbook_name, {
        "id": adapter.model.identifier("BDNB:" + identifier + ":WORKBOOK_DEFINITION"),
        "expected_revision": 0, "title": body["title"],
        "notes": "Complete overview and all full annex receipts. Territory records are in the named complete JSONL/CSV files; none are silently truncated to Excel.",
        "sheets": [{"name": "Territory and review summary",
                    "source": {"kind": "report", "id": publication["id"], "sha256": section["sha256"], "section": 0},
                    "columns": [{"source": c, "source_index": i, "header": c, "type": "native",
                                 "null": "text", "null_text": "NULL", "precision": "preserve"}
                                for i, c in enumerate(["topic", "value", "meaning"])]}]})
    workbook = job(adapter, identifier, "WORKBOOK", "workbook", {
        "name": workbook_name, "revision": definition["revision"],
        "definition_sha256": definition["definition_sha256"]}, resume)
    need(workbook["result"]["row_count"] == overview["row_count"], "BDNB_PRODUCT_WORKBOOK_INCOMPLETE")
    for native_name, label in [("workbook.xlsx", "workbook"), ("handoff.zip", "workbook-handover")]:
        with adapter.analysis.workbooks.download(workbook["id"], native_name) as (_, descriptor):
            files.append(file_record(identifier, label, "BDNB_" + identifier[:8] + "_" + native_name,
                                     "bdnb-workbook", workbook["id"], native_name, descriptor))
    for fmt, suffix in [("html", ".html"), ("json", ".json"), ("csv", "_tables.zip")]:
        result = job(adapter, identifier, "REPORT_EXPORT:" + fmt, "report-export", {
            "publication_id": publication["id"], "publication_sha256": section["sha256"], "format": fmt}, resume)
        _, descriptor = adapter.analysis.report_export_file(result["id"])
        files.append(file_record(identifier, "report-" + fmt, "BDNB_" + identifier[:8] + "_report" + suffix,
                                 "bdnb-report", result["id"], fmt, descriptor))
    summary = {"status": "COMPLETE", "source_entity_id": selected["id"], "source_entity_sha256": selected["sha256"],
               "source_summary": selected["summary"], "review_set_sha256": reviews["sha256"],
               "review_count": len(reviews["reviews"]), "review_conflicts": reviews["conflicts"],
               "annexes": annexes, "metrics": metrics, "overview_rows": overview["row_count"],
               "report_job_id": report["id"], "report_publication_id": publication["id"],
               "report_sha256": section["sha256"], "workbook_job_id": workbook["id"],
               "workbook_manifest_sha256": workbook["result"]["manifest_sha256"],
               "workbook_scope": "complete territory/coverage/change/review counts and full annex index"}
    entity = adapter.commit("publication", identifier, body, body["title"], summary,
                            collections=collections, files=files,
                            lineage=[source_lineage(selected)] + [source_lineage(r) for r in reviews["reviews"]])
    return {"entity": entity, "replayed": False}


def archive_catalogue(stream, manifest, operation_id, directory):
    """Read the complete catalogue in this archive's verified SQLite snapshot.

    The original archive remains the producer; the private temporary database
    is read-only inspection and is closed before its temporary bytes are removed.
    """
    expected = manifest["database"]
    need(expected["path"] == "datasets.sqlite3", "BDNB_ARCHIVE_DATABASE_REQUIRED")
    directory = private_directory(directory, create=True)
    fd, temporary = tempfile.mkstemp(prefix=".snapshot-read-", suffix=".sqlite3", dir=directory)
    database = None
    try:
        with os.fdopen(fd, "wb") as output, zipfile.ZipFile(stream) as archive:
            digestor, count = hashlib.sha256(), 0
            with archive.open("workspace/datasets.sqlite3") as original:
                while block := original.read(65536):
                    count += len(block)
                    need(count <= expected["bytes"], "BDNB_ARCHIVE_DATABASE_GREW")
                    output.write(block); digestor.update(block)
            need(count == expected["bytes"] and digestor.hexdigest() == expected["sha256"],
                 "BDNB_ARCHIVE_DATABASE_CHANGED")
            output.flush(); os.fsync(output.fileno())
        path = Path(temporary).absolute()
        database = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
        database.execute("PRAGMA trusted_schema=OFF")
        database.execute("PRAGMA query_only=ON")
        need(database.execute("SELECT workspace_id FROM sf_analysis_format WHERE id=1").fetchone()[0]
             == manifest["workspace_id"], "BDNB_ARCHIVE_WORKSPACE_CHANGED")
        entities = {}
        for identifier, kind, raw in database.execute(
                "SELECT id,kind,record FROM sf_bdnb_entities WHERE operation_id=? ORDER BY sequence", (operation_id,)):
            value = json.loads(raw)
            actual = value.pop("sha256")
            original_raw = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                                      separators=(",", ":")).encode()
            need(value["id"] == identifier and value["kind"] == kind and
                 hashlib.sha256(original_raw).hexdigest() == actual and identifier not in entities,
                 "BDNB_ARCHIVE_ENTITY_CHANGED")
            entities[identifier] = {"kind": kind, "sha256": actual}
        result = {"schema": SCHEMA + "/archive-catalogue", "workspace_id": manifest["workspace_id"],
                  "operation_id": operation_id, "archive_id": manifest["id"],
                  "database": expected, "entities": entities}
        result["sha256"] = digest(result)
        return result
    finally:
        if database is not None:
            database.close()
        Path(temporary).unlink(missing_ok=True)


def pack(adapter, body, resume):
    identifier = body["pack_id"]
    existing, _ = adapter.begin("pack", identifier, body, "BDNB complete workspace")
    if existing is not None:
        for item in existing["files"]:
            with open_product_download(adapter, item):
                pass
        return {"entity": existing, "replayed": True}

    def selection():
        publication = adapter.get(body["publication_id"])
        need(publication["kind"] == "publication" and publication["summary"]["status"] == "COMPLETE",
             "BDNB_COMPLETE_PUBLICATION_REQUIRED")
        for item in publication["files"]:
            with open_product_download(adapter, item):
                pass
        return {"publication": publication, "selected_catalogue": adapter.status()}
    selected = intent(adapter, "pack", identifier, body, selection)
    need(adapter.get(body["publication_id"])["sha256"] == selected["publication"]["sha256"],
         "BDNB_PACK_PUBLICATION_CHANGED")
    # The original archive manager persists its exact snapshot and request
    # before copying files. Retry the same job; never replace its generation.
    available = adapter.analysis.archives.review(include_previous_backups=False)
    need(available["ready"], "BDNB_WORKSPACE_FILES_INCOMPLETE")
    output = job(adapter, identifier, "WORKSPACE", "workspace-export",
                 {"include_previous_backups": False}, resume)
    files = []
    for native_name, label, filename in [
        ("workspace.zip", "workspace", "BDNB_Workspace_" + identifier + ".zip"),
        ("archive-manifest.json", "workspace-manifest", "BDNB_Workspace_" + identifier + "_manifest.json")]:
        with adapter.analysis.archives.download(output["id"], native_name) as (_, descriptor):
            files.append(file_record(identifier, label, filename, "bdnb-archive",
                                     output["id"], native_name, descriptor))
    with adapter.analysis.archives.download(output["id"], "archive-manifest.json") as (stream, _):
        manifest = json.load(stream)
    with adapter.analysis.archives.download(output["id"], "workspace.zip") as (stream, _):
        actual_catalogue = archive_catalogue(stream, manifest, adapter.operation_id,
                                             adapter.directory / "products" / identifier)
    need(actual_catalogue["entities"].get(body["publication_id"]) ==
         {"kind": "publication", "sha256": selected["publication"]["sha256"]},
         "BDNB_ARCHIVE_PUBLICATION_MISSING")
    summary = {"status": "COMPLETE", "publication_id": body["publication_id"],
               "publication_sha256": selected["publication"]["sha256"],
               "workspace_id": adapter.analysis.identity, "archive_job_id": output["id"],
               "archive": output["result"], "intent_catalogue": selected["selected_catalogue"],
               "archive_catalogue": actual_catalogue,
               "receiving": "Original Analysis archive receiver; reopen the same Datasette operation ID.",
               "earlier_archives": "Earlier portable ZIPs stay separate; their identities remain in SQLite."}
    entity = adapter.commit("pack", identifier, body, "BDNB complete workspace", summary,
                            files=files, lineage=[source_lineage(selected["publication"])])
    return {"entity": entity, "replayed": False}


@contextmanager
def open_product_download(adapter, item):
    need(isinstance(item, dict) and item.get("kind") in {
        "bdnb-query-export", "bdnb-workbook", "bdnb-report", "bdnb-archive"},
        "BDNB_PRODUCT_DOWNLOAD_KIND")
    kind = item["kind"]
    if kind == "bdnb-report":
        path, descriptor = adapter.analysis.report_export_file(item["job_id"])
        need(all(descriptor[k] == item[k] for k in ("bytes", "sha256")), "BDNB_PRODUCT_FILE_CHANGED")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            need(stat.S_ISREG(info.st_mode) and info.st_size == item["bytes"] and
                 hashlib.file_digest(stream, "sha256").hexdigest() == item["sha256"],
                 "BDNB_PRODUCT_FILE_CHANGED")
            stream.seek(0)
            yield stream, item
    else:
        manager = (adapter.analysis.exports if kind == "bdnb-query-export" else
                   adapter.analysis.workbooks if kind == "bdnb-workbook" else adapter.analysis.archives)
        with manager.download(item["job_id"], item["native_name"]) as (stream, descriptor):
            need(all(descriptor[k] == item[k] for k in ("bytes", "sha256")), "BDNB_PRODUCT_FILE_CHANGED")
            yield stream, item


def dispatch_bdnb_product(adapter, action, body):
    need(action in {"bdnb.publish", "bdnb.pack"}, "BDNB_PRODUCT_ACTION_INVALID")
    body, resume = exact_body(action, body)
    return publish(adapter, body, resume) if action == "bdnb.publish" else pack(adapter, body, resume)
