"""Property payloads inside the original study package, archive and receiving engine."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from model import SCHEMA, dump, encoded, fail, hash_id, identity, now, parse, private_directory, read, sync_directory, text, write
from workspace import DDL, Workspace, file_identity, unpack
from . import model as m
from .service import PropertyResearch, install
from .reporting import csv_text, export_rows


def _body(record):
    return {key: value for key, value in record.items() if key not in ("id", "created", "reopened")}


def _snapshot(service, path, selection, editions, documents):
    database = sqlite3.connect(path)
    os.chmod(path, 0o600)
    try:
        database.executescript(DDL + "\n" + m.DDL)
        database.execute("INSERT INTO meta VALUES('schema',?)", (SCHEMA,))
        database.execute("INSERT INTO meta VALUES('property_research',?)", (m.EXTENSION,))
        ids = {
            "property_documents": sorted(documents),
            "property_studies": sorted({e["study_id"] for e in editions}),
            "property_editions": sorted(e["id"] for e in editions),
            "property_selections": [selection["id"]],
        }
        references = {selection["review_id"]}
        for table, values in ids.items():
            references.update(values)
            for rid in values:
                row = service.w.connection.execute("SELECT * FROM " + table + " WHERE id=?", (rid,)).fetchone()
                database.execute("INSERT INTO " + table + " VALUES(?,?,?)", tuple(row))
        # A later review can coexist with an earlier frozen selection.
        # The received selection carries the exact review edition it used.
        original_review = service.w.connection.execute("SELECT created FROM property_reviews WHERE id=?", (selection["review_id"],)).fetchone()
        database.execute("INSERT INTO property_reviews VALUES(?,?,?)",
                         (selection["review_id"], encoded(selection["review_snapshot"]).decode(), original_review["created"]))
        for row in service.w.connection.execute("SELECT * FROM events ORDER BY id"):
            if row["reference"] in references:
                if row["operation"] == "property.review.apply" and unpack(row["body"])["version"] > selection["review_version"]:
                    continue
                database.execute("INSERT INTO events VALUES(?,?,?,?,?)", tuple(row))
        database.commit()
        if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("PROPERTY_DELIVERY_SNAPSHOT_INVALID")
    finally:
        database.close()


def export_package(service, selection_id, operator, label, destination=None):
    from delivery import DELIVERY_SCHEMA, copy_tree, inventory, verify_package
    text(operator, "operator", maximum=200)
    text(label, "label", maximum=1000)
    with service.w.mutation():
        selection = service.selection(selection_id)
        candidate = service._record("property_editions", selection["candidate_id"])
        editions, seen = [], set()
        pending = [candidate["id"]] + ([selection["baseline_id"]] if selection["baseline_id"] else [])
        while pending:
            eid = pending.pop()
            if eid in seen:
                continue
            seen.add(eid)
            edition = service._record("property_editions", eid)
            editions.append(edition)
            if edition["previous_id"]:
                pending.append(edition["previous_id"])
        document_ids = sorted({rid for edition in editions for rid in edition["document_ids"].values()})
        documents = {rid: service.document(rid) for rid in document_ids}
        request = {"kind": "property-research", "selection_id": selection_id, "operator": operator, "label": label}
        operation_id = identity(request)
        out = Path(destination).expanduser().absolute() if destination else service.w.directory / "deliveries" / operation_id
        parent = private_directory(out.parent)
        if parent != out.parent:
            fail("DELIVERY_OUTPUT_CANONICAL_REQUIRED")
        if out.exists():
            manifest = verify_package(out)
            if manifest["operation_id"] != operation_id:
                fail("DELIVERY_DESTINATION_CONFLICT")
            body = {"directory": str(out), **manifest}
            if not service.w.connection.execute("SELECT 1 FROM exports WHERE id=?", (manifest["package_id"],)).fetchone():
                service.w.connection.execute("INSERT INTO exports VALUES(?,?,?)", (manifest["package_id"], encoded(body).decode(), now()))
                service.w.event("property.export.create", manifest["package_id"], {"selection_id": selection_id, "rows": manifest["rows"], "recovered": True})
            return {"id": manifest["package_id"], "reopened": True, **body}
        stage = Path(tempfile.mkdtemp(prefix=".property-delivery-", dir=parent))
        try:
            for rid in document_ids:
                copy_tree(service.w.directory / "property-documents" / rid, stage / "property-documents" / rid)
            for edition in editions:
                service.packet(edition["id"])
                copy_tree(service.w.directory / "property-intakes" / edition["id"], stage / "property-intakes" / edition["id"])
            result = service.report(selection_id)
            dump(stage / "study.json", result["study"])
            dump(stage / "selection.json", selection)
            dump(stage / "review.json", selection["review_snapshot"])
            dump(stage / "all-surveys.json", candidate["properties"])
            dump(stage / "published-comparisons.json", candidate["source_comparables"])
            dump(stage / "source-manifest.json", {"schema": m.EXTENSION, "documents": list(documents.values()),
                                                "editions": [{k: v for k, v in e.items() if k != "properties"} for e in editions]})
            private_directory(stage / "report")
            write(stage / "report" / "report.html", result["html"].encode())
            write(stage / "report" / "report.md", result["markdown"].encode())
            dump(stage / "report" / "summary.json", result["summary"])
            private_directory(stage / "mapped-export")
            write(stage / "mapped-export" / "rows.jsonl", b"".join(encoded(row) + b"\n" for row in result["rows"]))
            write(stage / "mapped-export" / "table.csv", csv_text(result["rows"]).encode())
            dump(stage / "mapped-export" / "format.json", {"schema": "stellar-forge.property-export-format.v1",
                 "decimals": "Exact decimal strings", "null": {"jsonl": None, "csv": "empty cell"},
                 "compound_fields": "JSON in CSV cells; structured values in JSONL",
                 "selection": "Rows include only saved unit keys of comparable/context properties for the frozen purpose",
                 "spreadsheet_import": "Import original text columns as text; JSONL retains exact types",
                 "columns": list(result["rows"][0]) if result["rows"] else ["purpose", "property_key", "unit_key"]})
            dump(stage / "acceptance.json", {"schema": "stellar-forge.property-delivery-review.v1", "operator": operator,
                 "selection_id": selection_id, "review_version": selection["review_version"], "purpose": selection["purpose"],
                 "summary": result["summary"]})
            _snapshot(service, stage / "workspace.sqlite3", selection, editions, document_ids)
            write(stage / "OPERATE.md", (
                "# Retained property research\n\n"
                "Open report/report.html for the analyst report. Original PDFs and input packets are retained alongside the complete survey, "
                "purpose-specific comparable decisions and original review history.\n\n"
                "Use the installed Study Source Refresh CLI verify and receive commands, or import this ZIP through Delivery & reopen. "
                "Receiving uses the same workspace database, original event stream and package inventory. Existing later local review decisions "
                "are preserved; the delivered selection reopens its own frozen review snapshot.\n\n"
                "The mapped export carries original ranges, units, rent basis, observation periods, utility responsibility, "
                "published AMHI statuses and exact source pages. The complete all-surveys.json includes context and excluded properties. "
                "Use Property research to import a later source edition, reconcile its changes and freeze another selection for each purpose.\n"
            ).encode())
            core = {"schema": DELIVERY_SCHEMA, "kind": "property-research", "operation_id": operation_id,
                    "selection_id": selection_id, "comparison_id": selection["review_id"],
                    "candidate_id": selection["candidate_id"], "baseline_id": selection["baseline_id"],
                    "review_version": selection["review_version"], "label": label, "operator": operator,
                    "source_ids": [], "rows": len(result["rows"]), "excluded_rows": candidate["counts"]["unit_schedules"] - len(result["rows"]),
                    "property_bundle": {"document_ids": document_ids, "edition_ids": sorted(e["id"] for e in editions),
                                        "study_ids": sorted({e["study_id"] for e in editions})},
                    "files": inventory(stage)}
            manifest = {**core, "package_id": identity(core)}
            dump(stage / "manifest.json", manifest)
            verify_package(stage)
            os.rename(stage, out)
            stage = None
            sync_directory(parent)
            body = {"directory": str(out), **manifest}
            service.w.connection.execute("INSERT OR IGNORE INTO exports VALUES(?,?,?)", (manifest["package_id"], encoded(body).decode(), now()))
            service.w.event("property.export.create", manifest["package_id"], {"selection_id": selection_id, "rows": len(result["rows"])})
            return {"id": manifest["package_id"], "reopened": False, **body}
        finally:
            if stage is not None:
                shutil.rmtree(stage)


def verify_payload(directory, manifest):
    """Called only after the original delivery engine verifies every declared member."""
    directory = Path(directory)
    if manifest.get("source_ids") != []:
        fail("PROPERTY_DELIVERY_SOURCE_KIND_INVALID")
    database = sqlite3.connect((directory / "workspace.sqlite3").as_uri() + "?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    try:
        database.execute("PRAGMA trusted_schema=OFF")
        base_tables = {"meta", "sources", "source_rows", "revisions", "editions", "edition_rows",
                       "comparisons", "differences", "decisions", "exports", "events", "acquisitions", "sqlite_sequence"}
        schema = database.execute("SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger')").fetchall()
        if {r["name"] for r in schema if r["type"] == "table"} != base_tables | set(m.TABLES) or any(r["type"] != "table" for r in schema):
            fail("PROPERTY_DELIVERY_SCHEMA_CHANGED")
        meta = dict(database.execute("SELECT key,value FROM meta"))
        if meta.get("schema") != SCHEMA or meta.get("property_research") != m.EXTENSION:
            fail("PROPERTY_DELIVERY_SCHEMA_CHANGED")
        if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("PROPERTY_DELIVERY_DATABASE_INVALID")
        for table in base_tables - {"meta", "events", "sqlite_sequence"}:
            if database.execute("SELECT 1 FROM " + table + " LIMIT 1").fetchone():
                fail("PROPERTY_DELIVERY_UNRELATED_STATE", table=table)
        def records(table):
            return {r["id"]: unpack(r["body"]) for r in database.execute("SELECT * FROM " + table)}
        data = {table: records(table) for table in m.TABLES}
        for table in m.TABLES:
            if table != "property_reviews":
                for rid, body in data[table].items():
                    if identity(body) != rid:
                        fail("PROPERTY_DELIVERY_RECORD_CHANGED", kind=table, id=rid)
        bundle = manifest["property_bundle"]
        for table, field in (("property_documents", "document_ids"), ("property_editions", "edition_ids"), ("property_studies", "study_ids")):
            if set(data[table]) != set(bundle[field]) or len(bundle[field]) != len(set(bundle[field])):
                fail("PROPERTY_DELIVERY_CLOSURE_CHANGED", kind=table)
        if set(data["property_selections"]) != {manifest["selection_id"]} or set(data["property_reviews"]) != {manifest["comparison_id"]}:
            fail("PROPERTY_DELIVERY_SELECTION_CHANGED")
        selection = data["property_selections"][manifest["selection_id"]]
        review = data["property_reviews"][manifest["comparison_id"]]
        if (selection["review_id"] != manifest["comparison_id"] or selection["review_version"] != manifest["review_version"]
                or selection["candidate_id"] != manifest["candidate_id"] or selection["baseline_id"] != manifest["baseline_id"]
                or selection["review_snapshot"] != review or review["version"] != manifest["review_version"]):
            fail("PROPERTY_DELIVERY_REVIEW_CHANGED")
        request = {k: review[k] for k in ("baseline_id", "candidate_id", "operator", "label", "note", "unchanged")}
        if identity(request) != manifest["comparison_id"] or any(r["key"] not in review["decisions"] for r in review["rows"]):
            fail("PROPERTY_DELIVERY_REVIEW_INVALID")
        edition_ids = {manifest["candidate_id"]} | ({manifest["baseline_id"]} if manifest["baseline_id"] else set())
        pending = list(edition_ids)
        while pending:
            eid = pending.pop()
            if eid not in data["property_editions"]:
                fail("PROPERTY_DELIVERY_EDITION_CHANGED")
            previous_id = data["property_editions"][eid]["previous_id"]
            if previous_id and previous_id not in edition_ids:
                edition_ids.add(previous_id)
                pending.append(previous_id)
        if edition_ids != set(data["property_editions"]):
            fail("PROPERTY_DELIVERY_EDITION_CHANGED")
        if set(bundle["study_ids"]) != {e["study_id"] for e in data["property_editions"].values()}:
            fail("PROPERTY_DELIVERY_STUDY_CHANGED")
        if set(bundle["document_ids"]) != {rid for e in data["property_editions"].values() for rid in e["document_ids"].values()}:
            fail("PROPERTY_DELIVERY_DOCUMENT_CHANGED")
        for rid, doc in data["property_documents"].items():
            if doc["schema"] != "stellar-forge.property-document.v1" or len(doc["files"]) != 1 or m.document(doc["metadata"]) != doc["metadata"]:
                fail("PROPERTY_DELIVERY_DOCUMENT_CHANGED")
            for item in doc["files"]:
                from model import member
                path = directory / "property-documents" / rid / member(item["path"])
                if file_identity(path) != {k: item[k] for k in ("bytes", "sha256")}:
                    fail("PROPERTY_DELIVERY_DOCUMENT_CHANGED")
        for rid, edition in data["property_editions"].items():
            path = directory / "property-intakes" / rid / "intake.json"
            if file_identity(path) != edition["original_packet"]:
                fail("PROPERTY_DELIVERY_INTAKE_CHANGED")
            docs = {key: data["property_documents"][did]["metadata"] for key, did in edition["document_ids"].items()}
            value = m.intake(parse(read(path, 64 * 1024 * 1024)), docs)
            if value["properties"] != edition["properties"] or value["source_comparables"] != edition["source_comparables"]:
                fail("PROPERTY_DELIVERY_SURVEY_CHANGED")
            expected_study = {"schema": "stellar-forge.property-study.v1", **value["study"], "document_ids": edition["document_ids"]}
            if data["property_studies"][edition["study_id"]] != expected_study:
                fail("PROPERTY_DELIVERY_STUDY_CHANGED")
        candidate = data["property_editions"][manifest["candidate_id"]]
        if selection["study_id"] != candidate["study_id"]:
            fail("PROPERTY_DELIVERY_SELECTION_CHANGED")
        properties = {p["key"]: p for p in candidate["properties"]}
        if len(selection["items"]) != len(properties) or {i["property_key"] for i in selection["items"]} != set(properties):
            fail("PROPERTY_DELIVERY_SELECTION_CHANGED")
        for item in selection["items"]:
            if item["decision"] not in ("comparable", "context", "exclude"):
                fail("PROPERTY_DELIVERY_SELECTION_CHANGED")
            if not set(item["unit_keys"]) <= {u["key"] for u in properties[item["property_key"]]["units"]}:
                fail("PROPERTY_DELIVERY_SELECTION_CHANGED")
            if item["decision"] != "exclude" and review["decisions"][item["property_key"]]["action"] != "accept":
                fail("PROPERTY_DELIVERY_SELECTION_CHANGED")
        expected_rows = export_rows(candidate, selection)
        expected_jsonl = b"".join(encoded(row) + b"\n" for row in expected_rows)
        if file_identity(directory / "mapped-export" / "rows.jsonl") != {"bytes": len(expected_jsonl), "sha256": hashlib.sha256(expected_jsonl).hexdigest()}:
            fail("PROPERTY_DELIVERY_EXPORT_CHANGED")
        expected_csv = csv_text(expected_rows).encode()
        if file_identity(directory / "mapped-export" / "table.csv") != {"bytes": len(expected_csv), "sha256": hashlib.sha256(expected_csv).hexdigest()} or len(expected_rows) != manifest["rows"]:
            fail("PROPERTY_DELIVERY_EXPORT_CHANGED")
    finally:
        database.close()
    return manifest


def import_payload(workspace, source, manifest):
    from delivery import _copy_packet_subtree, _receive_events, _retain_packet
    install(workspace)
    packed = sqlite3.connect((Path(source) / "workspace.sqlite3").as_uri() + "?mode=ro", uri=True)
    packed.row_factory = sqlite3.Row
    preserved = []
    try:
        packed.execute("PRAGMA trusted_schema=OFF")
        with workspace.mutation():
            for prefix, ids in (("property-documents", manifest["property_bundle"]["document_ids"]),
                                ("property-intakes", manifest["property_bundle"]["edition_ids"])):
                for rid in ids:
                    _copy_packet_subtree(Path(source), workspace.directory / prefix / rid, manifest, prefix + "/" + rid)
            for table in m.TABLES:
                for row in packed.execute("SELECT * FROM " + table):
                    previous = workspace.connection.execute("SELECT * FROM " + table + " WHERE id=?", (row["id"],)).fetchone()
                    if previous:
                        if previous["body"] != row["body"]:
                            if table != "property_reviews":
                                fail("RECEIVED_RECORD_CONFLICT", kind=table, identity=row["id"])
                            existing, incoming = unpack(previous["body"]), unpack(row["body"])
                            immutable = ("baseline_id", "candidate_id", "operator", "label", "note", "unchanged", "rows")
                            if any(existing[k] != incoming[k] for k in immutable):
                                fail("RECEIVED_RECORD_CONFLICT", kind=table, identity=row["id"])
                            preserved.append({"review_id": row["id"], "local_version": existing["version"], "delivered_version": incoming["version"]})
                    else:
                        workspace.connection.execute("INSERT INTO " + table + " VALUES(?,?,?)", tuple(row))
            _receive_events(workspace, packed)
            retained = _retain_packet(workspace, Path(source), manifest)
            if not workspace.connection.execute("SELECT 1 FROM events WHERE operation=? AND reference=?", ("property.package.receive", manifest["package_id"])).fetchone():
                workspace.event("property.package.receive", manifest["package_id"], {"selection_id": manifest["selection_id"], "preserved_local_reviews": preserved})
        service = PropertyResearch(workspace)
        return {"package_id": manifest["package_id"], "directory": str(retained), "selection": service.selection(manifest["selection_id"]),
                "preserved_local_reviews": preserved}
    finally:
        packed.close()


def receive_payload(source, destination, manifest):
    out = Path(destination).expanduser().absolute()
    parent = private_directory(out.parent)
    if parent != out.parent:
        fail("RECEIVE_CANONICAL_PARENT_REQUIRED")
    receipt = {"schema": "stellar-forge.property-received.v1", "package_id": manifest["package_id"], "selection_id": manifest["selection_id"]}
    if out.exists():
        saved = parse(read(out / "received-property-package.json", 16384))
        if saved != receipt:
            fail("RECEIVE_WORKSPACE_CONFLICT")
    else:
        private_directory(out)
        dump(out / "received-property-package.json", receipt, exclusive=True)
    workspace = Workspace(out)
    try:
        result = import_payload(workspace, Path(source), manifest)
        return {**result, "workspace": str(out)}
    finally:
        workspace.close()
